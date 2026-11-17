import type { SatelliteRecord } from './catalog';

export interface SearchResults {
  /** Catalog indices of the best matches, best first. */
  indices: number[];
  /** How many satellites matched in total, including those beyond the limit. */
  total: number;
}

export interface SearchIndex {
  /**
   * Finds the satellites matching `query`. If `among` is given (one byte per
   * satellite, as `visibilityMask` produces), only those it marks are
   * considered, so results never include a satellite that is filtered out.
   */
  search(query: string, limit: number, among?: Uint8Array): SearchResults;
}

/** Match quality, best first. Its numeric value is the bucket a match lands in. */
const Rank = {
  ExactId: 0,
  ExactName: 1,
  NamePrefix: 2,
  WordPrefix: 3,
  NameSubstring: 4,
  IdOrDesignatorPrefix: 5,
} as const;
const RANK_COUNT = Object.keys(Rank).length;

function isWordStart(text: string, position: number): boolean {
  if (position === 0) return true;
  const previous = text.charCodeAt(position - 1);
  const isAlphanumeric =
    (previous >= 48 && previous <= 57) || // 0-9
    (previous >= 97 && previous <= 122); // a-z (text is lower-cased)
  return !isAlphanumeric;
}

function rank(query: string, name: string, id: string, designator: string): number {
  if (id === query) return Rank.ExactId;
  const at = name.indexOf(query);
  if (at === 0) return name.length === query.length ? Rank.ExactName : Rank.NamePrefix;
  if (at > 0) return isWordStart(name, at) ? Rank.WordPrefix : Rank.NameSubstring;
  if (id.startsWith(query) || designator.startsWith(query)) return Rank.IdOrDesignatorPrefix;
  return -1;
}

/**
 * Builds a case-insensitive search over satellite names, NORAD IDs and
 * international designators.
 *
 * Each query is a linear scan over pre-lowered strings: about a millisecond
 * for 20k satellites, so there is no index structure to build or maintain.
 * What needs care is the *output* — a one-letter query matches thousands of
 * satellites, so results are ranked and capped before they reach the DOM.
 */
export function createSearchIndex(records: readonly SatelliteRecord[]): SearchIndex {
  const names = records.map((record) => record.name.toLowerCase());
  const ids = records.map((record) => String(record.noradId));
  const designators = records.map((record) => record.intlDesignator.toLowerCase());

  return {
    search(query, limit, among) {
      const needle = query.trim().toLowerCase();
      if (needle === '') return { indices: [], total: 0 };

      const buckets: number[][] = Array.from({ length: RANK_COUNT }, () => []);
      let total = 0;
      for (let i = 0; i < records.length; i++) {
        if (among && among[i] === 0) continue;
        const matchRank = rank(needle, names[i], ids[i], designators[i]);
        if (matchRank === -1) continue;
        total++;
        const bucket = buckets[matchRank];
        // Better buckets are filled independently, so each can stop at the limit.
        if (bucket.length < limit) bucket.push(i);
      }
      return { indices: buckets.flat().slice(0, limit), total };
    },
  };
}
