import { uniqueId } from "lodash";
import { sendMessage } from "protocol/socket";
import { ThreadFront } from "protocol/thread";
import { getSessionId } from "ui/reducers/app";
import { query } from "ui/utils/apolloClient";
import { UIThunkAction } from ".";

export type FullTextSearchAction =
  | {
      type: "FULL_TEXT_SEARCH_STARTED";
      query: string;
    }
  | {
      type: "FULL_TEXT_SEARCH_MATCHES";
      query: string;
      matches: any[];
    };

export function startFullTextSearch(query: string): UIThunkAction {
  return async ({ dispatch }) => {
    dispatch({ type: "FULL_TEXT_SEARCH_STARTED", query });
    console.info("search", { query });

    const search: UIThunkAction = async ({ dispatch, getState }) => {
      console.info("maybe do search");
      const sessionId = getSessionId(getState());

      const handleMatches = result => {
        console.info("MATCHES", result);
        dispatch({
          type: "FULL_TEXT_SEARCH_MATCHES",
          query,
          matches: result,
        });
      };
      addEventListener("Debugger.searchSourceContentsMatches", handleMatches);
      await sendMessage("Debugger.searchSourceContents", { searchId: query, query }, sessionId);
      console.info("DONE");
      removeEventListener("Debugger.searchSourceContentsMatches", handleMatches);
    };

    return search;
  };
}
