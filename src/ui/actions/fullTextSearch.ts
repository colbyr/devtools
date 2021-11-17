import { SearchSourceContentsMatch } from "@recordreplay/protocol";
import { uniqueId } from "lodash";
import { client, sendMessage } from "protocol/socket";
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
      matches: SearchSourceContentsMatch[];
    };

export function startFullTextSearch(query: string): UIThunkAction {
  return async ({ dispatch, getState }) => {
    dispatch({ type: "FULL_TEXT_SEARCH_STARTED", query });
    console.info("search", { query });

    console.info("maybe do search");

    await ThreadFront.searchSources({ query }, matches => {
      console.info("MATCHES", matches);
      dispatch({
        type: "FULL_TEXT_SEARCH_MATCHES",
        query,
        matches,
      });
    });
    console.info("DONE");
  };
}
