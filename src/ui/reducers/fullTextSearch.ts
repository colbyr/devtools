import { has, uniqueId, update } from "lodash";
import { FullTextSearchAction } from "ui/actions/fullTextSearch";
import { FullTextSearchState } from "ui/state/fullTextSearch";

export default function fullTextSearch(
  state: FullTextSearchState = {},
  action: FullTextSearchAction
) {
  switch (action.type) {
    case "FULL_TEXT_SEARCH_STARTED":
      return {
        [action.query]: {
          searchId: uniqueId("search-"),
        },
        ...state,
      };
    case "FULL_TEXT_SEARCH_MATCHES": {
      if (has(state, action.query)) {
        return state;
      }

      return update(state, action.query, searchEntry => ({
        ...searchEntry,
        matches: action.matches,
      }));
    }
    default:
      return state;
  }
}
