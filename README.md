![](https://replay.io/assets/logo.svg)

## Replay

Replay is a new debugger for recording and replaying software. Debugging with Replay should be as simple as viewing print statements and more powerful than pausing with breakpoints. Of course, debugging should be collaborative as well!

### Issues

Feel free to file any issues you see while recording or replaying.

### Setup instructions:

Replay's DevTools is a React app built on top of the Replay [protocol](https://www.notion.so/replayio/Protocol-d8e7b5f428594589ab60c42afad782c1). Getting started is as simple as:

```
git clone git@github.com:RecordReplay/devtools.git
cd devtools
npm install
npm start
```

Once you see `Compiled succesfully` in your terminal, open your browser and go to [this link](http://localhost:8080/recording/d5ce272f-a3de-4af6-8943-2595cb54f1e3).

**You just successfully opened your first Replay recording!** That recording uses your locally running copy of Replay DevTools to debug our test recording.

### Next steps

You can now debug recordings, but you can't make them. _Yet._

To get started with recordings, say hi to us [on Discord 👋](https://replay.io/discord/) and request recording instructions. We're happy to get you set up with a recording account from there!

### Community

Everybody's welcome to join us [on Discord](https://replay.io/discord/). We can help with getting started with the project, finding issues to work on and chatting about the future of DevTools.

### Running tests:

To run the end-to-end tests make sure that devtools is running locally on port 8080 and run:

```
node test/run.js [--pattern pat]
```

To run the unit tests:

```
npm test
```

Note that any options passed after `--` will be passed on to the test runner (jest). So, if you wanted jest to watch the project for changes and run tests when files were saved you could run:

```
npm test -- --watch
```

#### Running tests against local builds of the browser

If you want to run the tests against a local build of the browser, you'll need to invoke the tests like so:

```
RECORD_REPLAY_PATH=~/devel/gecko-dev/rr-opt/dist/Replay.app RECORD_REPLAY_BUILD_PATH=~/devel/gecko-dev node test/run.js
```

Replace the paths with the appropriate paths to and within `gecko-dev` as appropriate in your environment.

#### Running tests against local builds of the backend

If you want to run the tests against a local build of the backend, you'll need to invoke the tests like so:

```
RECORD_REPLAY_SERVER=ws://localhost:8000 RECORD_REPLAY_DRIVER=~/devel/backend/out/macOS-recordreplay.so node test/run.js
```

Replace the paths with the appropriate paths within the `backend` repo as appropriate in your environment.
