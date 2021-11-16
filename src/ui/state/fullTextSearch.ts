type FullTextSearchEntry = {
  matches: any[];
};

export type FullTextSearchState = {
  [query: string]: FullTextSearchEntry;
};
