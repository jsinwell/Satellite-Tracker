import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('parseSettings', () => {
  it.each([
    ['nothing saved', null],
    ['something that is not settings', 'hello'],
    ['an array', [1, 2, 3]],
    ['an empty object', {}],
  ])('gives the defaults for %s', (_, raw) => {
    expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps what was saved', () => {
    const saved = {
      colorBy: 'type',
      filters: {
        types: { payload: true, 'rocket-body': false, debris: false, unknown: true },
        constellations: DEFAULT_SETTINGS.filters.constellations,
        regimes: { LEO: true, MEO: false, GEO: true, HEO: true },
        launchedBy: 1998,
      },
      overlays: { orbit: true, groundTrack: false, coverage: false },
      clouds: false,
    };
    expect(parseSettings(saved)).toEqual(saved);
  });

  it('defaults each value that is missing or of the wrong kind, and keeps the rest', () => {
    const settings = parseSettings({
      colorBy: 'rainbow',
      filters: { regimes: { LEO: false, MEO: 'no' }, launchedBy: '1998' },
      overlays: { coverage: false, sparkles: true },
    });
    expect(settings.colorBy).toBe('type');
    expect(settings.filters.regimes).toEqual({ LEO: false, MEO: true, GEO: true, HEO: true });
    expect(settings.filters.launchedBy).toBeNull();
    expect(settings.overlays).toEqual({ orbit: true, groundTrack: true, coverage: false });
  });

  it('never keeps a filter the legend would not show', () => {
    // Coloring by type shows the type filter only, so constellations must all
    // be on, and the other way round; otherwise satellites would be hidden by
    // a switch nobody can see.
    const byType = parseSettings({
      colorBy: 'type',
      filters: { constellations: { starlink: false } },
    });
    expect(Object.values(byType.filters.constellations).every(Boolean)).toBe(true);

    const byConstellation = parseSettings({
      colorBy: 'constellation',
      filters: { types: { debris: false }, constellations: { starlink: false } },
    });
    expect(Object.values(byConstellation.filters.types).every(Boolean)).toBe(true);
    expect(byConstellation.filters.constellations.starlink).toBe(false);
  });

  it.each([1956, 2201, 1998.5, Number.NaN])('ignores a launch year of %d', (year) => {
    expect(parseSettings({ filters: { launchedBy: year } }).filters.launchedBy).toBeNull();
  });
});
