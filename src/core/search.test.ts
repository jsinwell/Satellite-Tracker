import { describe, expect, it } from 'vitest';
import { iss } from './__fixtures__/satellites';
import type { SatelliteRecord } from './catalog';
import { createSearchIndex } from './search';

function satellite(noradId: number, name: string, intlDesignator = '2020-001A'): SatelliteRecord {
  return { ...iss, noradId, name, intlDesignator };
}

const records = [
  satellite(25544, 'ISS (ZARYA)', '1998-067A'),
  satellite(49044, 'ISS (NAUKA)', '2021-066A'),
  satellite(44714, 'STARLINK-1008'),
  satellite(44715, 'STARLINK-1009'),
  satellite(20580, 'HST', '1990-037B'),
  satellite(27424, 'AQUA'),
  satellite(40000, 'SWISSCUBE'),
  satellite(25545, 'COSMOS 2251 DEB'),
  satellite(25546, 'COSMOS 2251 DEB'),
];
const index = createSearchIndex(records);
const names = (query: string, limit = 10) =>
  index.search(query, limit).indices.map((i) => records[i].name);

describe('createSearchIndex', () => {
  it('returns nothing for a blank query', () => {
    expect(index.search('   ', 10)).toEqual({ indices: [], total: 0 });
  });

  it('matches names case-insensitively', () => {
    expect(names('hst')).toEqual(['HST']);
    expect(names('Aqua')).toEqual(['AQUA']);
  });

  it('finds a satellite by its NORAD ID', () => {
    expect(names('20580')).toEqual(['HST']);
  });

  it('finds a satellite by its international designator', () => {
    expect(names('1990-037')).toEqual(['HST']);
  });

  it('ranks an exact ID above IDs that merely start with the query', () => {
    const exact = satellite(2554, 'EXACT');
    const local = createSearchIndex([...records, exact]);
    const results = local.search('2554', 10).indices;
    expect(results[0]).toBe(records.length);
    expect(results).toHaveLength(4); // EXACT, then 25544, 25545 and 25546 by prefix
  });

  it('ranks name prefixes above matches inside a name', () => {
    // "ISS" starts two names and is buried inside SWISSCUBE.
    expect(names('iss')).toEqual(['ISS (ZARYA)', 'ISS (NAUKA)', 'SWISSCUBE']);
  });

  it('ranks a match at the start of a word above one mid-word', () => {
    const local = createSearchIndex([satellite(1, 'ATOM2'), satellite(2, 'METEOR-M2')]);
    expect(local.search('m2', 10).indices).toEqual([1, 0]);
  });

  it('keeps satellites that share a name as separate results', () => {
    const results = index.search('cosmos 2251 deb', 10);
    expect(results.indices.map((i) => records[i].noradId)).toEqual([25545, 25546]);
  });

  it('caps the results but reports the full match count', () => {
    const results = index.search('s', 2);
    expect(results.indices).toHaveLength(2);
    expect(results.total).toBeGreaterThan(2);
  });

  it('still surfaces the best match when weaker matches fill the limit first', () => {
    const local = createSearchIndex([
      satellite(1, 'XAQUAX'),
      satellite(2, 'XXAQUA'),
      satellite(3, 'AQUA'),
    ]);
    expect(local.search('aqua', 1).indices).toEqual([2]);
  });
});
