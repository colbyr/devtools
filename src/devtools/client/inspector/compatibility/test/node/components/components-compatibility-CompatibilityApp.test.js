/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/**
 * Unit tests for the CompatibilityApp component.
 */

const { shallow } = require("enzyme");
const { createFactory } = require("react");
const { thunk } = require("devtools/client/shared/redux/middleware/thunk.js");
const configureStore = require("redux-mock-store").default;

const CompatibilityApp = createFactory(
  require("devtools/client/inspector/compatibility/components/CompatibilityApp")
);

describe("CompatibilityApp component", () => {
  it("renders zero issues", () => {
    const mockStore = configureStore([thunk]);
    const store = mockStore({
      compatibility: {
        selectedNodeIssues: [],
      },
    });
    const wrapper = shallow(CompatibilityApp({ store })).dive();
    expect(wrapper).toMatchSnapshot();
  });
});
