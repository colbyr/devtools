// ThreadFront is the main interface used to interact with the singleton
// WRP session. This interface is based on the one normally used when the
// devtools interact with a thread: at any time the thread is either paused
// at a particular point, or resuming on its way to pause at another point.
//
// This model is different from the one used in the WRP, where queries are
// performed on the state at different points in the recording. This layer
// helps with adapting the devtools to the WRP.

import {
  BreakpointId,
  ExecutionPoint,
  FrameId,
  Location,
  MappedLocation,
  Message,
  missingRegions,
  newSource,
  ObjectId,
  PauseDescription,
  RecordingId,
  ScreenShot,
  SessionId,
  SourceId,
  SourceKind,
  SourceLocation,
  TimeStamp,
  unprocessedRegions,
  loadedRegions,
  annotations,
  SameLineSourceLocations,
} from "@recordreplay/protocol";
import { client, log } from "../socket";
import { defer, assert, EventEmitter, ArrayMap } from "../utils";
import { MappedLocationCache } from "../mapped-location-cache";
import { ValueFront } from "./value";
import { Pause } from "./pause";

export interface RecordingDescription {
  duration: TimeStamp;
  length?: number;
  lastScreen?: ScreenShot;
  commandLineArguments?: string[];
}

export interface Source {
  kind: SourceKind;
  url?: string;
  generatedSourceIds?: SourceId[];
}

export interface PauseEventArgs {
  point: ExecutionPoint;
  time: number;
  hasFrames: boolean;
}

interface FindTargetParameters {
  point: ExecutionPoint;
}
interface FindTargetResult {
  target: PauseDescription;
}
type FindTargetCommand = (
  p: FindTargetParameters,
  sessionId: SessionId
) => Promise<FindTargetResult>;

export type WiredMessage = Omit<Message, "argumentValues"> & {
  argumentValues?: ValueFront[];
};

// Target applications which can create recordings.
export enum RecordingTarget {
  gecko = "gecko",
  chromium = "chromium",
  node = "node",
  unknown = "unknown",
}

function getRecordingTarget(buildId: string): RecordingTarget {
  if (buildId.includes("gecko")) {
    return RecordingTarget.gecko;
  }
  if (buildId.includes("chromium")) {
    return RecordingTarget.chromium;
  }
  if (buildId.includes("node")) {
    return RecordingTarget.node;
  }
  return RecordingTarget.unknown;
}

declare global {
  interface Window {
    Test?: any;
  }
}

class _ThreadFront {
  // When replaying there is only a single thread currently. Use this thread ID
  // everywhere needed throughout the devtools client.
  actor: string = "MainThreadId";

  currentPoint: ExecutionPoint = "0";
  currentTime: number = 0;
  currentPointHasFrames: boolean = false;

  // Any pause for the current point.
  currentPause: Pause | null = null;

  // Pauses created for async parent frames of the current point.
  asyncPauses: Pause[] = [];

  // Recording ID being examined.
  recordingId: RecordingId | null = null;

  // Waiter for the associated session ID.
  sessionId: SessionId | null = null;
  sessionWaiter = defer<SessionId>();

  // Waiter which resolves with the target used to create the recording.
  recordingTargetWaiter = defer<RecordingTarget>();

  // Waiter which resolves when the debugger has loaded and we've warped to the endpoint.
  initializedWaiter = defer<void>();

  // Map sourceId to info about the source.
  sources = new Map<string, Source>();

  // Resolve hooks for promises waiting on a source ID to be known.
  sourceWaiters = new ArrayMap<string, () => void>();

  // Waiter which resolves when all sources have been loaded.
  private allSourcesWaiter = defer<void>();
  private hasAllSources = false;

  // Map URL to sourceId[].
  urlSources = new ArrayMap<string, SourceId>();

  // Map each preferred or alternate sourceId to the sourceIds of identical sources
  private correspondingSourceIds = new Map<SourceId, SourceId[]>();

  // Map sourceId to sourceId[], reversing the generatedSourceIds map.
  originalSources = new ArrayMap<SourceId, SourceId>();

  // Source IDs for generated sources which should be preferred over any
  // original source.
  preferredGeneratedSources = new Set<SourceId>();

  // Map sourceId to breakpoint positions.
  breakpointPositions = new Map<string, Promise<SameLineSourceLocations[]>>();

  onSource: ((source: newSource) => void) | undefined;

  mappedLocations = new MappedLocationCache();

  skipPausing = false;

  // Points which will be reached when stepping in various directions from a point.
  resumeTargets = new Map<string, PauseDescription>();

  // Epoch which invalidates step targets when advanced.
  resumeTargetEpoch = 0;

  // How many in flight commands can change resume targets we get from the server.
  numPendingInvalidateCommands = 0;

  // Resolve hooks for promises waiting for pending invalidate commands to finish. wai
  invalidateCommandWaiters: (() => void)[] = [];

  // Pauses for each point we have stopped or might stop at.
  allPauses = new Map<ExecutionPoint, Pause>();

  // Map breakpointId to information about the breakpoint, for all installed breakpoints.
  breakpoints = new Map<BreakpointId, { location: Location }>();

  // Any callback to invoke to adjust the point which we zoom to.
  warpCallback:
    | ((
        point: ExecutionPoint,
        time: number,
        hasFrames?: boolean
      ) => { point: ExecutionPoint; time: number; hasFrames?: boolean } | null)
    | null = null;

  testName: string | undefined;

  // added by EventEmitter.decorate(ThreadFront)
  eventListeners!: Map<string, ((value?: any) => void)[]>;
  on!: (name: string, handler: (value?: any) => void) => void;
  off!: (name: string, handler: (value?: any) => void) => void;
  emit!: (name: string, value?: any) => void;

  async setSessionId(sessionId: SessionId) {
    this.sessionId = sessionId;
    this.sessionWaiter.resolve(sessionId);

    log(`GotSessionId ${sessionId}`);

    const { buildId } = await client.Session.getBuildId({}, sessionId);
    this.recordingTargetWaiter.resolve(getRecordingTarget(buildId));
  }

  async initializeToolbox() {
    const sessionId = await this.waitForSession();

    await this.initializedWaiter.promise;
    await this.ensureAllSources();
    this.ensureCurrentPause();

    if (this.testName) {
      client.Internal.labelTestSession({ sessionId });
      await gToolbox.selectTool("debugger");
      window.Test = require("test/harness");
      const script = document.createElement("script");
      script.src = `/test?${this.testName}`;
      document.head.appendChild(script);
    }
  }

  setTest(test: string | undefined) {
    this.testName = test;
  }

  waitForSession() {
    return this.sessionWaiter.promise;
  }

  async ensureProcessed(
    level: "basic" | "executionIndexed",
    onMissingRegions?: ((parameters: missingRegions) => void) | undefined,
    onUnprocessedRegions?: ((parameters: unprocessedRegions) => void) | undefined
  ) {
    const sessionId = await this.waitForSession();

    if (onMissingRegions) {
      client.Session.addMissingRegionsListener(onMissingRegions);
    }

    if (onUnprocessedRegions) {
      client.Session.addUnprocessedRegionsListener(onUnprocessedRegions);
    }

    await client.Session.ensureProcessed({ level }, sessionId);
  }

  async listenForLoadChanges(listenerCallback: (params: loadedRegions) => void) {
    // This is a placeholder which logs loading changes to the console.
    const sessionId = await this.waitForSession();

    client.Session.addLoadedRegionsListener((parameters: loadedRegions) => {
      console.log("LoadedRegions", parameters);
      listenerCallback(parameters);
    });

    await client.Session.listenForLoadChanges({}, sessionId);
  }

  async getAnnotations(onAnnotations: (annotations: annotations) => void) {
    const sessionId = await this.waitForSession();

    client.Session.addAnnotationsListener(onAnnotations);
    await client.Session.findAnnotations({}, sessionId);
  }

  timeWarp(point: ExecutionPoint, time: number, hasFrames?: boolean, force?: boolean) {
    log(`TimeWarp ${point}`);

    // The warp callback is used to change the locations where the thread is
    // warping to.
    if (this.warpCallback && !force) {
      const newTarget = this.warpCallback(point, time, hasFrames);
      if (newTarget) {
        point = newTarget.point;
        time = newTarget.time;
        hasFrames = newTarget.hasFrames;
      }
    }

    this.currentPoint = point;
    this.currentTime = time;
    this.currentPointHasFrames = !!hasFrames;
    this.currentPause = null;
    this.asyncPauses.length = 0;
    this.emit("paused", { point, hasFrames, time });

    this._precacheResumeTargets();
  }

  timeWarpToPause(pause: Pause) {
    log(`TimeWarp ${pause.point} using existing pause`);

    const { point, time, hasFrames } = pause;
    assert(point && time && typeof hasFrames === "boolean");
    this.currentPoint = point;
    this.currentTime = time;
    this.currentPointHasFrames = hasFrames;
    this.currentPause = pause;
    this.asyncPauses.length = 0;
    this.emit("paused", { point, hasFrames, time });

    this._precacheResumeTargets();
  }

  async findSources(onSource: (source: newSource) => void) {
    const sessionId = await this.waitForSession();
    this.onSource = onSource;

    client.Debugger.findSources({}, sessionId).then(() => {
      this.groupSourceIds();
      this.hasAllSources = true;
      this.allSourcesWaiter.resolve();
    });
    client.Debugger.addNewSourceListener(source => {
      let { sourceId, kind, url, generatedSourceIds } = source;
      this.sources.set(sourceId, { kind, url, generatedSourceIds });
      if (url) {
        this.urlSources.add(url, sourceId);
      }
      for (const generatedId of generatedSourceIds || []) {
        this.originalSources.add(generatedId, sourceId);
      }
      const waiters = this.sourceWaiters.map.get(sourceId);
      (waiters || []).forEach(resolve => resolve());
      this.sourceWaiters.map.delete(sourceId);
    });

    await this.ensureAllSources();
    for (const [sourceId, source] of this.sources) {
      if (sourceId === this.getCorrespondingSourceIds(sourceId)[0]) {
        onSource({ sourceId, ...source });
      }
    }
  }

  getSourceKind(sourceId: SourceId) {
    const info = this.sources.get(sourceId);
    return info ? info.kind : null;
  }

  async ensureSource(sourceId: SourceId) {
    if (!this.sources.has(sourceId)) {
      const { promise, resolve } = defer<void>();
      this.sourceWaiters.add(sourceId, resolve as () => void);
      await promise;
    }
    return this.sources.get(sourceId)!;
  }

  async ensureAllSources() {
    await this.allSourcesWaiter.promise;
  }

  getSourceURLRaw(sourceId: SourceId) {
    const info = this.sources.get(sourceId);
    return info && info.url;
  }

  async getSourceURL(sourceId: SourceId) {
    const info = await this.ensureSource(sourceId);
    return info.url;
  }

  getSourceIdsForURL(url: string) {
    // Ignore IDs which are generated versions of another ID with the same URL.
    // This happens with inline sources for HTML pages, in which case we only
    // want the ID for the HTML itself.
    const ids = this.urlSources.map.get(url) || [];
    return ids.filter(id => {
      const originalIds = this.originalSources.map.get(id);
      return (originalIds || []).every(originalId => !ids.includes(originalId));
    });
  }

  getGeneratedSourceIdsForURL(url: string) {
    // Ignore IDs which are original versions of another ID with the same URL.
    const ids = this.urlSources.map.get(url) || [];
    return ids.filter(id => {
      const generatedIds = this.sources.get(id)?.generatedSourceIds;
      return (generatedIds || []).every(generatedId => !ids.includes(generatedId));
    });
  }

  async getSourceContents(sourceId: SourceId) {
    assert(this.sessionId);
    const { contents, contentType } = await client.Debugger.getSourceContents(
      { sourceId },
      this.sessionId
    );
    return { contents, contentType };
  }

  getBreakpointPositionsCompressed(
    sourceId: SourceId,
    range?: { start: SourceLocation; end: SourceLocation }
  ) {
    let breakpointPositionsPromise = this.breakpointPositions.get(sourceId);
    if (!breakpointPositionsPromise) {
      breakpointPositionsPromise = this._getBreakpointPositionsCompressed(sourceId, range);
      if (!range) {
        this.breakpointPositions.set(sourceId, breakpointPositionsPromise);
      }
    }
    return breakpointPositionsPromise;
  }

  private async _getBreakpointPositionsCompressed(
    sourceId: SourceId,
    range?: { start: SourceLocation; end: SourceLocation }
  ) {
    assert(this.sessionId);
    const begin = range ? range.start : undefined;
    const end = range ? range.end : undefined;
    const { lineLocations } = await client.Debugger.getPossibleBreakpoints(
      { sourceId, begin, end },
      this.sessionId
    );
    return lineLocations;
  }

  setSkipPausing(skip: boolean) {
    this.skipPausing = skip;
  }

  async setBreakpoint(initialSourceId: SourceId, line: number, column: number, condition?: string) {
    try {
      this._invalidateResumeTargets(async () => {
        assert(this.sessionId);
        await this.ensureAllSources();
        const sourceIds = this.getCorrespondingSourceIds(initialSourceId);
        await Promise.all(
          sourceIds.map(async sourceId => {
            await ThreadFront.getBreakpointPositionsCompressed(sourceId);
            const location = { sourceId, line, column };
            const { breakpointId } = await client.Debugger.setBreakpoint(
              { location, condition },
              this.sessionId!
            );
            if (breakpointId) {
              this.breakpoints.set(breakpointId, { location });
            }
          })
        );
      });
    } catch (e) {
      // An error will be generated if the breakpoint location is not valid for
      // this source. We don't keep precise track of which locations are valid
      // for which inline sources in an HTML file (which share the same URL),
      // so ignore these errors.
    }
  }

  setBreakpointByURL(url: string, line: number, column: number, condition?: string) {
    const sources = this.getSourceIdsForURL(url);
    if (!sources) {
      return;
    }
    const sourceIds = this._chooseSourceIdList(sources);
    return Promise.all(
      sourceIds.map(({ sourceId }) => this.setBreakpoint(sourceId, line, column, condition))
    );
  }

  async removeBreakpoint(initialSourceId: SourceId, line: number, column: number) {
    await this.ensureAllSources();
    const sourceIds = this.getCorrespondingSourceIds(initialSourceId);
    for (const [breakpointId, { location }] of this.breakpoints.entries()) {
      if (
        sourceIds.includes(location.sourceId) &&
        location.line == line &&
        location.column == column
      ) {
        this.breakpoints.delete(breakpointId);
        this._invalidateResumeTargets(async () => {
          assert(this.sessionId);
          await client.Debugger.removeBreakpoint({ breakpointId }, this.sessionId);
        });
      }
    }
  }

  removeBreakpointByURL(url: string, line: number, column: number) {
    const sources = this.getSourceIdsForURL(url);
    if (!sources) {
      return;
    }
    const sourceIds = this._chooseSourceIdList(sources);
    return Promise.all(
      sourceIds.map(({ sourceId }) => this.removeBreakpoint(sourceId, line, column))
    );
  }

  ensurePause(point: ExecutionPoint, time: number) {
    assert(this.sessionId);
    let pause = this.allPauses.get(point);
    if (pause) {
      return pause;
    }
    pause = new Pause(this.sessionId);
    pause.create(point, time);
    this.allPauses.set(point, pause);
    return pause;
  }

  ensureCurrentPause() {
    if (!this.currentPause) {
      this.currentPause = this.ensurePause(this.currentPoint, this.currentTime);
    }
  }

  async getFrames() {
    if (!this.currentPointHasFrames) {
      return [];
    }

    await this.ensureAllSources();
    this.ensureCurrentPause();
    return await this.currentPause!.getFrames();
  }

  lastAsyncPause() {
    this.ensureCurrentPause();
    return this.asyncPauses.length
      ? this.asyncPauses[this.asyncPauses.length - 1]
      : this.currentPause;
  }

  async loadAsyncParentFrames() {
    await this.ensureAllSources();
    const basePause = this.lastAsyncPause();
    assert(basePause);
    const baseFrames = await basePause.getFrames();
    if (!baseFrames) {
      return [];
    }
    const steps = await basePause.getFrameSteps(baseFrames[baseFrames.length - 1].frameId);
    if (basePause != this.lastAsyncPause()) {
      return [];
    }
    const entryPause = this.ensurePause(steps[0].point, steps[0].time);
    this.asyncPauses.push(entryPause);
    const frames = await entryPause.getFrames();
    if (entryPause != this.lastAsyncPause()) {
      return [];
    }
    assert(frames);
    return frames.slice(1);
  }

  pauseForAsyncIndex(asyncIndex: number) {
    this.ensureCurrentPause();
    return asyncIndex ? this.asyncPauses[asyncIndex - 1] : this.currentPause;
  }

  async getScopes(asyncIndex: number, frameId: FrameId) {
    await this.ensureAllSources();
    const pause = this.pauseForAsyncIndex(asyncIndex);
    assert(pause);
    return await pause.getScopes(frameId);
  }

  async evaluate(asyncIndex: number, frameId: FrameId | undefined, text: string) {
    await this.ensureAllSources();
    const pause = this.pauseForAsyncIndex(asyncIndex);
    assert(pause);
    const rv = await pause.evaluate(frameId, text);
    if (rv.returned) {
      rv.returned = new ValueFront(pause, rv.returned);
    } else if (rv.exception) {
      rv.exception = new ValueFront(pause, rv.exception);
    }
    return rv;
  }

  // Preload step target information and pause data for nearby points.
  private async _precacheResumeTargets() {
    if (!this.currentPointHasFrames) {
      return;
    }

    const point = this.currentPoint;
    const epoch = this.resumeTargetEpoch;

    // Each step command, and the transitive steps to queue up after that step is known.
    const stepCommands = [
      {
        command: client.Debugger.findReverseStepOverTarget,
        transitive: [client.Debugger.findReverseStepOverTarget, client.Debugger.findStepInTarget],
      },
      {
        command: client.Debugger.findStepOverTarget,
        transitive: [client.Debugger.findStepOverTarget, client.Debugger.findStepInTarget],
      },
      {
        command: client.Debugger.findStepInTarget,
        transitive: [client.Debugger.findStepOutTarget, client.Debugger.findStepInTarget],
      },
      {
        command: client.Debugger.findStepOutTarget,
        transitive: [
          client.Debugger.findReverseStepOverTarget,
          client.Debugger.findStepOverTarget,
          client.Debugger.findStepInTarget,
          client.Debugger.findStepOutTarget,
        ],
      },
    ];

    stepCommands.forEach(async ({ command, transitive }) => {
      const target = await this._findResumeTarget(point, command);
      if (epoch != this.resumeTargetEpoch || !target.frame) {
        return;
      }

      // Precache pause data for the point.
      this.ensurePause(target.point, target.time);

      if (point != this.currentPoint) {
        return;
      }

      // Look for transitive resume targets.
      transitive.forEach(async command => {
        const transitiveTarget = await this._findResumeTarget(target.point, command);
        if (
          epoch != this.resumeTargetEpoch ||
          point != this.currentPoint ||
          !transitiveTarget.frame
        ) {
          return;
        }
        this.ensurePause(transitiveTarget.point, transitiveTarget.time);
      });
    });
  }

  // Perform an operation that will change our cached targets about where resume
  // operations will finish.
  private async _invalidateResumeTargets(callback: () => Promise<void>) {
    this.resumeTargets.clear();
    this.resumeTargetEpoch++;
    this.numPendingInvalidateCommands++;

    try {
      await callback();
    } finally {
      if (--this.numPendingInvalidateCommands == 0) {
        this.invalidateCommandWaiters.forEach(resolve => resolve());
        this.invalidateCommandWaiters.length = 0;
        this._precacheResumeTargets();
      }
    }
  }

  // Wait for any in flight invalidation commands to finish. Note: currently
  // this is only used during tests. Uses could be expanded to ensure that we
  // don't perform resumes until all invalidating commands have settled, though
  // this risks slowing things down and/or getting stuck if the server is having
  // a problem.
  waitForInvalidateCommandsToFinish() {
    if (!this.numPendingInvalidateCommands) {
      return;
    }
    const { promise, resolve } = defer<void>();
    this.invalidateCommandWaiters.push(resolve as () => void);
    return promise;
  }

  private async _findResumeTarget(point: ExecutionPoint, command: FindTargetCommand) {
    assert(this.sessionId);
    await this.ensureAllSources();

    // Check already-known resume targets.
    const key = `${point}:${command.name}`;
    const knownTarget = this.resumeTargets.get(key);
    if (knownTarget) {
      return knownTarget;
    }

    const epoch = this.resumeTargetEpoch;
    const { target } = await command({ point }, this.sessionId);
    if (epoch == this.resumeTargetEpoch) {
      this.updateMappedLocation(target.frame);
      this.resumeTargets.set(key, target);
    }

    return target;
  }

  private async _resumeOperation(
    command: FindTargetCommand,
    selectedPoint: ExecutionPoint,
    loadedRegions: loadedRegions
  ) {
    // Don't allow resumes until we've finished loading and did the initial
    // warp to the endpoint.
    await this.initializedWaiter.promise;

    let resumeEmitted = false;
    let resumeTarget: PauseDescription | null = null;

    const warpToTarget = () => {
      const { point, time, frame } = resumeTarget!;
      this.timeWarp(point, time, !!frame);
    };

    setTimeout(() => {
      resumeEmitted = true;
      this.emit("resumed");
      if (resumeTarget) {
        setTimeout(warpToTarget, 0);
      }
    }, 0);

    const point = selectedPoint || this.currentPoint;
    try {
      resumeTarget = await this._findResumeTarget(point, command);
    } catch {
      this.emit("paused", {
        point: this.currentPoint,
        hasFrames: this.currentPointHasFrames,
        time: this.currentTime,
      });
    }
    if (
      resumeTarget &&
      loadedRegions.loaded.every(
        region => resumeTarget!.time < region.begin.time || resumeTarget!.time > region.end.time
      )
    ) {
      resumeTarget = null;
    }
    if (resumeTarget && resumeEmitted) {
      warpToTarget();
    }
  }

  rewind(point: ExecutionPoint, loadedRegions: loadedRegions) {
    this._resumeOperation(client.Debugger.findRewindTarget, point, loadedRegions);
  }
  resume(point: ExecutionPoint, loadedRegions: loadedRegions) {
    this._resumeOperation(client.Debugger.findResumeTarget, point, loadedRegions);
  }
  reverseStepOver(point: ExecutionPoint, loadedRegions: loadedRegions) {
    this._resumeOperation(client.Debugger.findReverseStepOverTarget, point, loadedRegions);
  }
  stepOver(point: ExecutionPoint, loadedRegions: loadedRegions) {
    this._resumeOperation(client.Debugger.findStepOverTarget, point, loadedRegions);
  }
  stepIn(point: ExecutionPoint, loadedRegions: loadedRegions) {
    this._resumeOperation(client.Debugger.findStepInTarget, point, loadedRegions);
  }
  stepOut(point: ExecutionPoint, loadedRegions: loadedRegions) {
    this._resumeOperation(client.Debugger.findStepOutTarget, point, loadedRegions);
  }

  async resumeTarget(point: ExecutionPoint) {
    await this.initializedWaiter.promise;
    return this._findResumeTarget(point, client.Debugger.findResumeTarget);
  }

  blackbox(sourceId: SourceId, begin: SourceLocation, end: SourceLocation) {
    return this._invalidateResumeTargets(async () => {
      assert(this.sessionId);
      await client.Debugger.blackboxSource({ sourceId, begin, end }, this.sessionId);
    });
  }

  unblackbox(sourceId: SourceId, begin: SourceLocation, end: SourceLocation) {
    return this._invalidateResumeTargets(async () => {
      assert(this.sessionId);
      await client.Debugger.unblackboxSource({ sourceId, begin, end }, this.sessionId);
    });
  }

  async findConsoleMessages(onConsoleMessage: (pause: Pause, message: Message) => void) {
    const sessionId = await this.waitForSession();

    client.Console.findMessages({}, sessionId);
    client.Console.addNewMessageListener(async ({ message }) => {
      await this.ensureAllSources();
      const pause = new Pause(sessionId);
      pause.instantiate(
        message.pauseId,
        message.point.point,
        message.point.time,
        !!message.point.frame,
        message.data
      );
      if (message.argumentValues) {
        (message as WiredMessage).argumentValues = message.argumentValues.map(
          v => new ValueFront(pause, v)
        );
      }
      this.updateMappedLocation(message.point.frame);
      if (message.sourceId) {
        message.sourceId = this.getCorrespondingSourceIds(message.sourceId)[0];
      }
      onConsoleMessage(pause, message);
    });
  }

  async getRootDOMNode() {
    if (!this.sessionId) {
      return null;
    }
    await this.ensureAllSources();
    this.ensureCurrentPause();
    const pause = this.currentPause;
    await this.currentPause!.loadDocument();
    return pause == this.currentPause ? this.getKnownRootDOMNode() : null;
  }

  getKnownRootDOMNode() {
    assert(this.currentPause?.documentNode !== undefined);
    return this.currentPause.documentNode;
  }

  async searchDOM(query: string) {
    if (!this.sessionId) {
      return [];
    }
    await this.ensureAllSources();
    this.ensureCurrentPause();
    const pause = this.currentPause;
    const nodes = await this.currentPause!.searchDOM(query);
    return pause == this.currentPause ? nodes : null;
  }

  async loadMouseTargets() {
    if (!this.sessionId) {
      return;
    }
    const pause = this.currentPause;
    await this.ensureAllSources();
    this.ensureCurrentPause();
    await this.currentPause!.loadMouseTargets();
    return pause == this.currentPause;
  }

  async getMouseTarget(x: number, y: number, nodeIds?: string[]) {
    if (!this.sessionId) {
      return null;
    }
    const pause = this.currentPause;
    await this.ensureAllSources();
    this.ensureCurrentPause();
    const nodeBounds = await this.currentPause!.getMouseTarget(x, y, nodeIds);
    return pause == this.currentPause ? nodeBounds : null;
  }

  async ensureNodeLoaded(objectId: ObjectId) {
    assert(this.currentPause);
    const pause = this.currentPause;
    const node = await pause.ensureDOMFrontAndParents(objectId);
    if (pause != this.currentPause) {
      return null;
    }
    await node.ensureParentsLoaded();
    return pause == this.currentPause ? node : null;
  }

  async getFrameSteps(asyncIndex: number, frameId: FrameId) {
    await this.ensureAllSources();
    const pause = this.pauseForAsyncIndex(asyncIndex);
    assert(pause);
    return await pause.getFrameSteps(frameId);
  }

  getPreferredLocationRaw(locations: MappedLocation) {
    const { sourceId } = this._chooseSourceId(locations.map(l => l.sourceId));
    const preferredLocation = locations.find(l => l.sourceId == sourceId);
    assert(preferredLocation);
    this.updateLocation(preferredLocation);
    return preferredLocation;
  }

  async getCurrentPauseSourceLocation() {
    const frame = (await this.currentPause?.getFrames())?.[0];
    if (!frame) {
      return;
    }
    const { location } = frame;
    const preferredLocation = await this.getPreferredLocation(location);
    if (!preferredLocation) {
      return;
    }

    const sourceUrl = await this.getSourceURL(preferredLocation.sourceId);
    if (!sourceUrl) {
      return;
    }

    return {
      sourceUrl,
      sourceId: preferredLocation.sourceId,
      line: preferredLocation.line,
      column: preferredLocation.column,
    };
  }

  // Given an RRP MappedLocation array with locations in different sources
  // representing the same generated location (i.e. a generated location plus
  // all the corresponding locations in original or pretty printed sources etc.),
  // choose the location which we should be using within the devtools. Normally
  // this is the most original location, except when preferSource has been used
  // to prefer a generated source instead.
  async getPreferredLocation(locations: MappedLocation) {
    await this.ensureAllSources();
    return this.getPreferredLocationRaw(locations);
  }

  async getAlternateLocation(locations: MappedLocation) {
    await Promise.all(locations.map(({ sourceId }) => this.ensureSource(sourceId)));
    const { alternateId } = this._chooseSourceId(locations.map(l => l.sourceId));
    if (alternateId) {
      return locations.find(l => l.sourceId == alternateId);
    }
    return null;
  }

  // Get the source which should be used in the devtools from an array of
  // sources representing the same location. If the chosen source is an
  // original or generated source and there is an alternative which users
  // can switch to, also returns that alternative.
  private _chooseSourceId(sourceIds: SourceId[]) {
    // Ignore inline sources if we have an HTML source containing them.
    if (sourceIds.some(id => this.getSourceKind(id) == "html")) {
      sourceIds = sourceIds.filter(id => this.getSourceKind(id) != "inlineScript");
    }

    // Ignore minified sources.
    sourceIds = sourceIds.filter(id => !this.isMinifiedSource(id));

    // Determine the base generated/original ID to use for the source.
    let generatedId, originalId;
    for (const id of sourceIds) {
      const info = this.sources.get(id);
      if (!info) {
        // Sources haven't finished loading, bail out and return this one.
        return { sourceId: id };
      }
      // Determine the kind of this source, or its minified version.
      let kind = info.kind;
      if (kind == "prettyPrinted") {
        const minifiedInfo = info.generatedSourceIds
          ? this.sources.get(info.generatedSourceIds[0])
          : undefined;
        if (!minifiedInfo) {
          return { sourceId: id };
        }
        kind = minifiedInfo.kind;
        assert(kind != "prettyPrinted");
      }
      if (kind == "sourceMapped") {
        originalId = id;
      } else {
        assert(!generatedId);
        generatedId = id;
      }
    }

    if (!generatedId) {
      assert(originalId);
      return { sourceId: originalId };
    }

    if (!originalId) {
      return { sourceId: generatedId };
    }

    // Prefer original sources over generated sources, except when overridden
    // through user action.
    if (this.preferredGeneratedSources.has(generatedId)) {
      return { sourceId: generatedId, alternateId: originalId };
    }
    return { sourceId: originalId, alternateId: generatedId };
  }

  // Get the set of chosen sources from a list of source IDs which might
  // represent different generated locations.
  private _chooseSourceIdList(sourceIds: SourceId[]) {
    const groups = this._groupSourceIds(sourceIds);
    return groups.map(ids => this._chooseSourceId(ids));
  }

  // Group together a set of source IDs according to whether they are generated
  // or original versions of each other.
  private _groupSourceIds(sourceIds: SourceId[]) {
    const groups = [];
    while (sourceIds.length) {
      const id = sourceIds[0];
      const group = this._getAlternateSourceIds(id).filter(id => sourceIds.includes(id));
      groups.push(group);
      sourceIds = sourceIds.filter(id => !group.includes(id));
    }
    return groups;
  }

  // Get all original/generated IDs which can represent a location in sourceId.
  private _getAlternateSourceIds(sourceId: SourceId) {
    const rv = new Set<SourceId>();
    const worklist = [sourceId];
    while (worklist.length) {
      sourceId = worklist.pop()!;
      if (rv.has(sourceId)) {
        continue;
      }
      rv.add(sourceId);
      const sources = this.sources.get(sourceId);
      assert(sources);
      const { generatedSourceIds } = sources;
      (generatedSourceIds || []).forEach(id => worklist.push(id));
      const originalSourceIds = this.originalSources.map.get(sourceId);
      (originalSourceIds || []).forEach(id => worklist.push(id));
    }
    return [...rv];
  }

  // Return whether sourceId is minified and has a pretty printed alternate.
  isMinifiedSource(sourceId: SourceId) {
    const originalIds = this.originalSources.map.get(sourceId) || [];
    return originalIds.some(id => {
      const info = this.sources.get(id);
      return info && info.kind == "prettyPrinted";
    });
  }

  isSourceMappedSource(sourceId: SourceId) {
    const info = this.sources.get(sourceId);
    if (!info) {
      return false;
    }
    let kind = info.kind;
    if (kind == "prettyPrinted") {
      const minifiedInfo = info.generatedSourceIds
        ? this.sources.get(info.generatedSourceIds[0])
        : undefined;
      if (!minifiedInfo) {
        return false;
      }
      kind = minifiedInfo.kind;
      assert(kind != "prettyPrinted");
    }
    return kind == "sourceMapped";
  }

  preferSource(sourceId: SourceId, value: SourceId) {
    assert(!this.isSourceMappedSource(sourceId));
    if (value) {
      this.preferredGeneratedSources.add(sourceId);
    } else {
      this.preferredGeneratedSources.delete(sourceId);
    }
  }

  hasPreferredGeneratedSource(location: MappedLocation) {
    return location.some(({ sourceId }) => {
      return this.preferredGeneratedSources.has(sourceId);
    });
  }

  // Given a location in a generated source, get the preferred location to use.
  // This has to query the server to get the original / pretty printed locations
  // corresponding to this generated location, so getPreferredLocation is
  // better to use when possible.
  async getPreferredMappedLocation(location: Location) {
    const mappedLocation = await this.mappedLocations.getMappedLocation(location);
    return this.getPreferredLocation(mappedLocation);
  }

  async getRecordingDescription() {
    assert(this.recordingId);
    let description;
    try {
      description = await client.Recording.getDescription({
        recordingId: this.recordingId,
      });
    } catch (e) {
      // Getting the description will fail if it was never set. For now we don't
      // set the last screen in this case.
      const sessionId = await this.waitForSession();
      const { endpoint } = await client.Session.getEndpoint({}, sessionId);
      description = { duration: endpoint.time };
    }

    return description;
  }

  // Get the chosen (i.e. preferred and alternate) sources for the given URL.
  getChosenSourceIdsForUrl(url: string) {
    return this._chooseSourceIdList(this.getSourceIdsForURL(url));
  }

  private groupSourceIds() {
    for (const [sourceId, source] of this.sources.entries()) {
      if (!source.url) {
        this.correspondingSourceIds.set(sourceId, [sourceId]);
        continue;
      }
      if (this.correspondingSourceIds.has(sourceId)) {
        continue;
      }

      const groups = this.getChosenSourceIdsForUrl(source.url);
      assert(groups.length > 0);
      const sourceIds = groups.map(group => group.sourceId);
      for (const sourceId of sourceIds) {
        this.correspondingSourceIds.set(sourceId, sourceIds);
      }
      const alternateIds = groups
        .map(group => group.alternateId)
        .filter((alternateId): alternateId is SourceId => !!alternateId);
      for (const alternateId of alternateIds) {
        this.correspondingSourceIds.set(alternateId, alternateIds);
      }

      if (!this.correspondingSourceIds.has(sourceId)) {
        this.correspondingSourceIds.set(sourceId, [sourceId]);
      }
    }
  }

  getCorrespondingSourceIds(sourceId: SourceId) {
    assert(this.hasAllSources);
    return this.correspondingSourceIds.get(sourceId) || [sourceId];
  }

  updateLocation(location: Location) {
    location.sourceId = this.getCorrespondingSourceIds(location.sourceId)[0];
  }

  updateMappedLocation(mappedLocation: MappedLocation | undefined) {
    if (!mappedLocation) {
      return;
    }
    for (const location of mappedLocation) {
      this.updateLocation(location);
    }
  }
}

export const ThreadFront = new _ThreadFront();
EventEmitter.decorate(ThreadFront);
