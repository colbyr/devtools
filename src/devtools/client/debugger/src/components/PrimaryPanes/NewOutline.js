import React, { useEffect, useState, memo, useMemo, useCallback } from "react";
import { FixedSizeList as List } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import classnames from "classnames";

import actions from "../../actions";
import * as selectors from "../../selectors";
import { Redacted } from "ui/components/Redacted";

import PreviewFunction from "../shared/PreviewFunction";
import { fuzzySearch } from "../../utils/function";
import uniq from "lodash/uniq";
import OutlineFilter from "./OutlineFilter";

import { connect } from "devtools/client/debugger/src/utils/connect";

function formatData(symbols, filter) {
  if (!symbols || !symbols.functions) {
    return { classes: [], namedFunctions: [], functions: [] };
  }

  const functions = symbols.functions.filter(func => func.name != "anonymous");

  let classes = uniq(functions.map(func => func.klass));

  let namedFunctions = functions.filter(
    func => fuzzySearch(func.name, filter) && !func.klass && !classes.includes(func.name)
  );

  return { classes, namedFunctions };
}

function NewOutline({ selectLocation, symbols }) {
  const namedFunctions = useMemo(() => {
    console.info("symbol change!", symbols);
    const { namedFunctions } = formatData(symbols);
    return namedFunctions;
  }, [symbols]);

  const Function = useCallback(
    function Function({ index, style }) {
      const func = namedFunctions[index];
      const { name, location, parameterNames } = func;

      return (
        <li
          className={classnames("outline-list__element cursor-pointer px-2 py-1", {
            focused: false,
          })}
          style={style}
        >
          <span className="outline-list__element-icon">λ</span>
          <Redacted className="inline-block">
            <PreviewFunction func={{ name, parameterNames }} />
          </Redacted>
        </li>
      );
    },
    [namedFunctions]
  );

  return (
    <div className="outline">
      <div className="outline__container">
        {/* <OutlineFilter filter={filter} updateFilter={this.updateFilter} /> */}
        <AutoSizer>
          {({ height, width }) => (
            <List
              innerElementType="ol"
              height={height}
              width={width}
              itemCount={namedFunctions.length}
              itemSize={22}
            >
              {Function}
            </List>
          )}
        </AutoSizer>
      </div>
    </div>
  );
}

const mapStateToProps = state => {
  const selectedSource = selectors.getSelectedSourceWithContent(state);
  const symbols = selectedSource ? selectors.getSymbols(state, selectedSource) : null;

  return {
    selectedSource,
    symbols,
  };
};

export default connect(mapStateToProps, {
  selectLocation: actions.selectLocation,
})(NewOutline);
