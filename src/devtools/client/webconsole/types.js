/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const {
  MESSAGE_SOURCE,
  MESSAGE_TYPE,
  MESSAGE_LEVEL,
} = require("devtools/client/webconsole/constants");

exports.ConsoleCommand = function (props) {
  return Object.assign(
    {
      id: null,
      allowRepeating: false,
      messageText: null,
      source: MESSAGE_SOURCE.JAVASCRIPT,
      type: MESSAGE_TYPE.COMMAND,
      level: MESSAGE_LEVEL.LOG,
      groupId: null,
      indent: 0,
      private: false,
      timeStamp: null,
    },
    props
  );
};

exports.ConsoleMessage = function (props) {
  return Object.assign(
    {
      id: null,
      innerWindowID: null,
      allowRepeating: true,
      source: null,
      timeStamp: null,
      type: null,
      level: null,
      category: null,
      messageText: null,
      parameters: null,
      repeatId: null,
      stacktrace: null,
      frame: null,
      groupId: null,
      errorMessageName: null,
      exceptionDocURL: null,
      executionPoint: undefined,
      userProvidedStyles: null,
      notes: null,
      indent: 0,
      prefix: "",
      private: false,
      logpointId: undefined,
    },
    props
  );
};

exports.PaywallMessage = function (props) {
  return Object.assign(
    {
      id: null,
      innerWindowID: null,
      allowRepeating: true,
      source: null,
      timeStamp: null,
      type: MESSAGE_TYPE.RESULT,
      level: MESSAGE_LEVEL.LOG,
      category: null,
      messageText: null,
      parameters: null,
      repeatId: null,
      stacktrace: null,
      frame: null,
      groupId: null,
      errorMessageName: null,
      exceptionDocURL: null,
      executionPoint: undefined,
      userProvidedStyles: null,
      notes: null,
      indent: 0,
      prefix: "",
      private: false,
      logpointId: undefined,
    },
    props
  );
};
