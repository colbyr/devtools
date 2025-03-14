/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  getCurrentZoom,
  getWindowDimensions,
  getViewportDimensions,
  loadSheet,
} = require("devtools/shared/layout/utils");
const EventEmitter = require("devtools/shared/event-emitter");

const lazyContainer = {
  get CssLogic() {
    return require("devtools/server/actors/inspector/css-logic").CssLogic;
  },
};

exports.getComputedStyle = node => lazyContainer.CssLogic.getComputedStyle(node);

exports.getBindingElementAndPseudo = node =>
  lazyContainer.CssLogic.getBindingElementAndPseudo(node);

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

require("devtools/server/actors/highlighters.css");

const _tokens = Symbol("classList/tokens");

/**
 * Shims the element's `classList` for anonymous content elements; used
 * internally by `CanvasFrameAnonymousContentHelper.getElement()` method.
 */
function ClassList(className) {
  const trimmed = (className || "").trim();
  this[_tokens] = trimmed ? trimmed.split(/\s+/) : [];
}

ClassList.prototype = {
  item(index) {
    return this[_tokens][index];
  },
  contains(token) {
    return this[_tokens].includes(token);
  },
  add(token) {
    if (!this.contains(token)) {
      this[_tokens].push(token);
    }
    EventEmitter.emit(this, "update");
  },
  remove(token) {
    const index = this[_tokens].indexOf(token);

    if (index > -1) {
      this[_tokens].splice(index, 1);
    }
    EventEmitter.emit(this, "update");
  },
  toggle(token, force) {
    // If force parameter undefined retain the toggle behavior
    if (force === undefined) {
      if (this.contains(token)) {
        this.remove(token);
      } else {
        this.add(token);
      }
    } else if (force) {
      // If force is true, enforce token addition
      this.add(token);
    } else {
      // If force is falsy value, enforce token removal
      this.remove(token);
    }
  },
  get length() {
    return this[_tokens].length;
  },
  [Symbol.iterator]: function* () {
    for (let i = 0; i < this.tokens.length; i++) {
      yield this[_tokens][i];
    }
  },
  toString() {
    return this[_tokens].join(" ");
  },
};

/**
 * Is this content window a XUL window?
 * @param {Window} window
 * @return {Boolean}
 */
function isXUL(window) {
  // XXX: We temporarily return true for HTML documents if the document disables
  // scroll frames since the regular highlighter is broken in this case. This
  // should be removed when bug 1594587 is fixed.
  return (
    window.document.documentElement.namespaceURI === XUL_NS ||
    (window.isChromeWindow && window.document.documentElement.getAttribute("scrolling") === "false")
  );
}
exports.isXUL = isXUL;

/**
 * Returns true if a DOM node is "valid", where "valid" means that the node isn't a dead
 * object wrapper, is still attached to a document, and is of a given type.
 * @param {DOMNode} node
 * @param {Number} nodeType Optional, defaults to ELEMENT_NODE
 * @return {Boolean}
 */
function isNodeValid(node, nodeType = Node.ELEMENT_NODE) {
  // Is it still alive?
  if (!node) {
    return false;
  }

  // NodeBoundsFront objects don't have information about the node itself,
  // but are only constructed for valid, connected elements.
  if (node.isNodeBoundsFront()) {
    return true;
  }

  // Is it of the right type?
  if (node.nodeType !== nodeType) {
    return false;
  }

  // Is the node connected to the document?
  if (!node.isConnected) {
    return false;
  }

  return true;
}
exports.isNodeValid = isNodeValid;

/**
 * Helper function that creates SVG DOM nodes.
 * @param {Window} This window's document will be used to create the element
 * @param {Object} Options for the node include:
 * - nodeType: the type of node, defaults to "box".
 * - attributes: a {name:value} object to be used as attributes for the node.
 * - prefix: a string that will be used to prefix the values of the id and class
 *   attributes.
 * - parent: if provided, the newly created element will be appended to this
 *   node.
 */
function createSVGNode(win, options) {
  if (!options.nodeType) {
    options.nodeType = "box";
  }
  options.namespace = SVG_NS;
  return createNode(win, options);
}
exports.createSVGNode = createSVGNode;

/**
 * Helper function that creates DOM nodes.
 * @param {Window} This window's document will be used to create the element
 * @param {Object} Options for the node include:
 * - nodeType: the type of node, defaults to "div".
 * - namespace: the namespace to use to create the node, defaults to XHTML namespace.
 * - attributes: a {name:value} object to be used as attributes for the node.
 * - prefix: a string that will be used to prefix the values of the id and class
 *   attributes.
 * - parent: if provided, the newly created element will be appended to this
 *   node.
 * - text: if provided, set the text content of the element.
 */
function createNode(win, options) {
  const type = options.nodeType || "div";
  const namespace = options.namespace || XHTML_NS;
  const doc = win.document;

  const node = doc.createElementNS(namespace, type);

  for (const name in options.attributes || {}) {
    let value = options.attributes[name];
    if (options.prefix && (name === "class" || name === "id")) {
      value = options.prefix + value;
    }
    node.setAttribute(name, value);
  }

  if (options.parent) {
    options.parent.appendChild(node);
  }

  if (options.text) {
    node.appendChild(doc.createTextNode(options.text));
  }

  return node;
}
exports.createNode = createNode;

/**
 * Every highlighters should insert their markup content into the document's
 * canvasFrame anonymous content container (see dom/webidl/Document.webidl).
 *
 * Since this container gets cleared when the document navigates, highlighters
 * should use this helper to have their markup content automatically re-inserted
 * in the new document.
 *
 * Since the markup content is inserted in the canvasFrame using
 * insertAnonymousContent, this means that it can be modified using the API
 * described in AnonymousContent.webidl.
 * To retrieve the AnonymousContent instance, use the content getter.
 *
 * @param {HighlighterEnv} highlighterEnv
 *        The environemnt which windows will be used to insert the node.
 * @param {Function} nodeBuilder
 *        A function that, when executed, returns a DOM node to be inserted into
 *        the canvasFrame.
 */
function CanvasFrameAnonymousContentHelper(highlighterEnv, nodeBuilder) {
  this.highlighterEnv = highlighterEnv;
  this.nodeBuilder = nodeBuilder;
  this.anonymousContentDocument = document;

  this.listeners = new Map();
  this.elements = new Map();

  this._onWindowReady();
}

CanvasFrameAnonymousContentHelper.prototype = {
  destroy() {
    this._remove();
    if (this.highlighterEnv) {
      this.highlighterEnv.off("window-ready", this._onWindowReady);
      this.highlighterEnv = this.nodeBuilder = this._content = null;
    }
    this.anonymousContentDocument = null;
    this.anonymousContentGlobal = null;

    this._removeAllListeners();
    this.elements.clear();
  },

  _insert() {
    const node = this.nodeBuilder();

    const container = document.getElementById("highlighter-root");
    container.appendChild(node);
    this._content = node;
  },

  _remove() {
    const container = document.getElementById("highlighter-root");
    if (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    this._content = null;
  },

  /**
   * The "window-ready" event can be triggered when:
   *   - a new window is created
   *   - a window is unfrozen from bfcache
   *   - when first attaching to a page
   *   - when swapping frame loaders (moving tabs, toggling RDM)
   */
  _onWindowReady() {
    this._removeAllListeners();
    this.elements.clear();
    this._insert();
    this.anonymousContentDocument = document;
  },

  getComputedStylePropertyValue(id, property) {
    if (this.content) {
      const node = this.content.querySelector(`#${id}`);
      const computed = window.getComputedStyle(node);
      return computed.getPropertyValue(property);
    }
  },

  getTextContentForElement(id) {
    if (this.content) {
      const node = this.content.querySelector(`#${id}`);
      return node.innerText;
    }
  },

  setTextContentForElement(id, text) {
    if (this.content) {
      const node = this.content.querySelector(`#${id}`);
      node.innerText = text;
    }
  },

  setAttributeForElement(id, name, value) {
    if (this.content) {
      const node = this.content.querySelector(`#${id}`);
      node.setAttribute(name, value);
    }
  },

  getAttributeForElement(id, name) {
    if (this.content) {
      const node = this.content.querySelector(`#${id}`);
      return node.getAttribute(name);
    }
    return "";
  },

  removeAttributeForElement(id, name) {
    if (this.content) {
      const node = this.content.querySelector(`#${id}`);
      node.removeAttribute(name);
    }
  },

  hasAttributeForElement(id, name) {
    return typeof this.getAttributeForElement(id, name) === "string";
  },

  getCanvasContext(id, type = "2d") {
    return this.content && this.content.getCanvasContext(id, type);
  },

  /**
   * Add an event listener to one of the elements inserted in the canvasFrame
   * native anonymous container.
   * Like other methods in this helper, this requires the ID of the element to
   * be passed in.
   *
   * Note that if the content page navigates, the event listeners won't be
   * added again.
   *
   * Also note that unlike traditional DOM events, the events handled by
   * listeners added here will propagate through the document only through
   * bubbling phase, so the useCapture parameter isn't supported.
   * It is possible however to call e.stopPropagation() to stop the bubbling.
   *
   * IMPORTANT: the chrome-only canvasFrame insertion API takes great care of
   * not leaking references to inserted elements to chrome JS code. That's
   * because otherwise, chrome JS code could freely modify native anon elements
   * inside the canvasFrame and probably change things that are assumed not to
   * change by the C++ code managing this frame.
   * See https://wiki.mozilla.org/DevTools/Highlighter#The_AnonymousContent_API
   * Unfortunately, the inserted nodes are still available via
   * event.originalTarget, and that's what the event handler here uses to check
   * that the event actually occured on the right element, but that also means
   * consumers of this code would be able to access the inserted elements.
   * Therefore, the originalTarget property will be nullified before the event
   * is passed to your handler.
   *
   * IMPL DETAIL: A single event listener is added per event types only, at
   * browser level and if the event originalTarget is found to have the provided
   * ID, the callback is executed (and then IDs of parent nodes of the
   * originalTarget are checked too).
   *
   * @param {String} id
   * @param {String} type
   * @param {Function} handler
   */
  addEventListenerForElement(id, type, handler) {
    if (typeof id !== "string") {
      throw new Error("Expected a string ID in addEventListenerForElement but" + " got: " + id);
    }

    // If no one is listening for this type of event yet, add one listener.
    if (!this.listeners.has(type)) {
      const target = this.highlighterEnv.pageListenerTarget;
      target.addEventListener(type, this, true);
      // Each type entry in the map is a map of ids:handlers.
      this.listeners.set(type, new Map());
    }

    const listeners = this.listeners.get(type);
    listeners.set(id, handler);
  },

  /**
   * Remove an event listener from one of the elements inserted in the
   * canvasFrame native anonymous container.
   * @param {String} id
   * @param {String} type
   */
  removeEventListenerForElement(id, type) {
    const listeners = this.listeners.get(type);
    if (!listeners) {
      return;
    }
    listeners.delete(id);

    // If no one is listening for event type anymore, remove the listener.
    if (!this.listeners.has(type)) {
      const target = this.highlighterEnv.pageListenerTarget;
      target.removeEventListener(type, this, true);
    }
  },

  handleEvent(event) {
    const listeners = this.listeners.get(event.type);
    if (!listeners) {
      return;
    }

    // Hide the originalTarget property to avoid exposing references to native
    // anonymous elements. See addEventListenerForElement's comment.
    let isPropagationStopped = false;
    const eventProxy = new Proxy(event, {
      get: (obj, name) => {
        if (name === "originalTarget") {
          return null;
        } else if (name === "stopPropagation") {
          return () => {
            isPropagationStopped = true;
          };
        }
        return obj[name];
      },
    });

    // Start at originalTarget, bubble through ancestors and call handlers when
    // needed.
    let node = event.originalTarget;
    while (node) {
      const handler = listeners.get(node.id);
      if (handler) {
        handler(eventProxy, node.id);
        if (isPropagationStopped) {
          break;
        }
      }
      node = node.parentNode;
    }
  },

  _removeAllListeners() {
    if (this.highlighterEnv && this.highlighterEnv.pageListenerTarget) {
      const target = this.highlighterEnv.pageListenerTarget;
      for (const [type] of this.listeners) {
        target.removeEventListener(type, this, true);
      }
    }
    this.listeners.clear();
  },

  getElement(id) {
    if (this.elements.has(id)) {
      return this.elements.get(id);
    }

    const classList = new ClassList(this.getAttributeForElement(id, "class"));

    EventEmitter.on(classList, "update", () => {
      this.setAttributeForElement(id, "class", classList.toString());
    });

    const element = {
      getTextContent: () => this.getTextContentForElement(id),
      setTextContent: text => this.setTextContentForElement(id, text),
      setAttribute: (name, val) => this.setAttributeForElement(id, name, val),
      getAttribute: name => this.getAttributeForElement(id, name),
      removeAttribute: name => this.removeAttributeForElement(id, name),
      hasAttribute: name => this.hasAttributeForElement(id, name),
      getCanvasContext: type => this.getCanvasContext(id, type),
      addEventListener: (type, handler) => {
        return this.addEventListenerForElement(id, type, handler);
      },
      removeEventListener: (type, handler) => {
        return this.removeEventListenerForElement(id, type, handler);
      },
      computedStyle: {
        getPropertyValue: property => this.getComputedStylePropertyValue(id, property),
      },
      classList,
    };

    this.elements.set(id, element);

    return element;
  },

  get content() {
    return this._content;
  },
};
exports.CanvasFrameAnonymousContentHelper = CanvasFrameAnonymousContentHelper;

/**
 * Move the infobar to the right place in the highlighter. This helper method is utilized
 * in both css-grid.js and box-model.js to help position the infobar in an appropriate
 * space over the highlighted node element or grid area. The infobar is used to display
 * relevant information about the highlighted item (ex, node or grid name and dimensions).
 *
 * This method will first try to position the infobar to top or bottom of the container
 * such that it has enough space for the height of the infobar. Afterwards, it will try
 * to horizontally center align with the container element if possible.
 *
 * @param  {DOMNode} container
 *         The container element which will be used to position the infobar.
 * @param  {Object} bounds
 *         The content bounds of the container element.
 * @param  {Window} win
 *         The window object.
 * @param  {Object} [options={}]
 *         Advanced options for the infobar.
 * @param  {String} options.position
 *         Force the infobar to be displayed either on "top" or "bottom". Any other value
 *         will be ingnored.
 * @param  {Boolean} options.hideIfOffscreen
 *         If set to `true`, hides the infobar if it's offscreen, instead of automatically
 *         reposition it.
 */
function moveInfobar(container, bounds, win, options = {}) {
  const zoom = getCurrentZoom(win);
  const viewport = getViewportDimensions(win);

  const { computedStyle } = container;

  const margin = 2;
  const arrowSize = parseFloat(computedStyle.getPropertyValue("--highlighter-bubble-arrow-size"));
  const containerHeight = parseFloat(computedStyle.getPropertyValue("height"));
  const containerWidth = parseFloat(computedStyle.getPropertyValue("width"));
  const containerHalfWidth = containerWidth / 2;

  const viewportWidth = viewport.width * zoom;
  const viewportHeight = viewport.height * zoom;
  let { pageXOffset, pageYOffset } = win;

  pageYOffset *= zoom;
  pageXOffset *= zoom;

  // Defines the boundaries for the infobar.
  const topBoundary = margin;
  const bottomBoundary = viewportHeight - containerHeight - margin - 1;
  const leftBoundary = containerHalfWidth + margin;
  const rightBoundary = viewportWidth - containerHalfWidth - margin;

  // Set the default values.
  let top = bounds.y - containerHeight - arrowSize;
  const bottom = bounds.bottom + margin + arrowSize;
  let left = bounds.x + bounds.width / 2;
  let isOverlapTheNode = false;
  let positionAttribute = "top";
  let position = "absolute";

  // Here we start the math.
  // We basically want to position absolutely the infobar, except when is pointing to a
  // node that is offscreen or partially offscreen, in a way that the infobar can't
  // be placed neither on top nor on bottom.
  // In such cases, the infobar will overlap the node, and to limit the latency given
  // by APZ (See Bug 1312103) it will be positioned as "fixed".
  // It's a sort of "position: sticky" (but positioned as absolute instead of relative).
  const canBePlacedOnTop = top >= pageYOffset;
  const canBePlacedOnBottom = bottomBoundary + pageYOffset - bottom > 0;
  const forcedOnTop = options.position === "top";
  const forcedOnBottom = options.position === "bottom";

  if ((!canBePlacedOnTop && canBePlacedOnBottom && !forcedOnTop) || forcedOnBottom) {
    top = bottom;
    positionAttribute = "bottom";
  }

  const isOffscreenOnTop = top < topBoundary + pageYOffset;
  const isOffscreenOnBottom = top > bottomBoundary + pageYOffset;
  const isOffscreenOnLeft = left < leftBoundary + pageXOffset;
  const isOffscreenOnRight = left > rightBoundary + pageXOffset;

  if (isOffscreenOnTop) {
    top = topBoundary;
    isOverlapTheNode = true;
  } else if (isOffscreenOnBottom) {
    top = bottomBoundary;
    isOverlapTheNode = true;
  } else if (isOffscreenOnLeft || isOffscreenOnRight) {
    isOverlapTheNode = true;
    top -= pageYOffset;
  }

  if (isOverlapTheNode && options.hideIfOffscreen) {
    container.setAttribute("hidden", "true");
    return;
  } else if (isOverlapTheNode) {
    left = Math.min(Math.max(leftBoundary, left - pageXOffset), rightBoundary);

    position = "fixed";
    container.setAttribute("hide-arrow", "true");
  } else {
    position = "absolute";
    container.removeAttribute("hide-arrow");
  }

  // We need to scale the infobar Independently from the highlighter's container;
  // otherwise the `position: fixed` won't work, since "any value other than `none` for
  // the transform, results in the creation of both a stacking context and a containing
  // block. The object acts as a containing block for fixed positioned descendants."
  // (See https://www.w3.org/TR/css-transforms-1/#transform-rendering)
  // We also need to shift the infobar 50% to the left in order for it to appear centered
  // on the element it points to.
  container.setAttribute(
    "style",
    `
    position:${position};
    transform-origin: 0 0;
    transform: scale(${1 / zoom}) translate(calc(${left}px - 50%), ${top}px)`
  );

  container.setAttribute("position", positionAttribute);
}
exports.moveInfobar = moveInfobar;
