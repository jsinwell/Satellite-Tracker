import { describe, expect, it } from 'vitest';
import type { Rgb } from './atmosphere';
import {
  cityGlow,
  colorFromFile,
  GROUND_PERIOD_KM,
  groundOrigin,
  LAND_ALBEDO,
  lampsInView,
  landAlbedo,
  MAP_WATER,
  mapLatitude,
  SEA,
  seaReflectance,
  waterShare,
} from './landscape';

const DEG = Math.PI / 180;

// Colors read from the maps at these places.
const DAY = {
  pacific: colorFromFile(30, 59, 115),
  redSea: colorFromFile(29, 58, 114),
  bahamas: colorFromFile(34, 63, 121),
  lakeSuperior: colorFromFile(30, 59, 115),
  sahara: colorFromFile(232, 208, 182),
  amazon: colorFromFile(46, 62, 23),
  taiga: colorFromFile(51, 63, 27),
  chicago: colorFromFile(114, 128, 105),
  greenland: colorFromFile(225, 225, 225),
  arcticIce: colorFromFile(212, 216, 228),
  scandinavia: colorFromFile(82, 77, 55),
};
const NIGHT = {
  pacific: colorFromFile(4, 6, 21),
  sahara: colorFromFile(14, 16, 29),
  boreal: colorFromFile(23, 26, 33),
  uk: colorFromFile(141, 125, 89),
  losAngeles: colorFromFile(253, 249, 222),
};

describe('waterShare', () => {
  it('is all water at sea and on the lakes', () => {
    for (const color of [DAY.pacific, DAY.redSea, DAY.bahamas, DAY.lakeSuperior, MAP_WATER]) {
      expect(waterShare(color)).toBe(1);
    }
  });

  it('is no water on land, whatever the land', () => {
    for (const color of [DAY.sahara, DAY.amazon, DAY.taiga, DAY.chicago, DAY.scandinavia]) {
      expect(waterShare(color)).toBe(0);
    }
  });

  it('does not take ice for water', () => {
    expect(waterShare(DAY.greenland)).toBe(0);
    expect(waterShare(DAY.arcticIce)).toBe(0);
  });

  it('is part water along a shore, where the map blends the two', () => {
    const shore: Rgb = [0, 0, 0];
    let last = 1;
    for (const land of [0.1, 0.2, 0.3, 0.5, 0.8, 1]) {
      for (let c = 0; c < 3; c++) shore[c] = DAY.pacific[c] * (1 - land) + DAY.amazon[c] * land;
      const share = waterShare(shore);
      expect(share).toBeLessThanOrEqual(last);
      last = share;
    }
    expect(last).toBe(0);
  });
});

describe('landAlbedo', () => {
  const albedo = (color: Rgb) => landAlbedo(color, [0, 0, 0]);

  it('sends back what sand does, in the desert', () => {
    const [red, green, blue] = albedo(DAY.sahara);
    expect(red).toBeGreaterThan(0.3);
    expect(red).toBeLessThan(0.45);
    expect(red).toBeGreaterThan(green);
    expect(green).toBeGreaterThan(blue);
  });

  it('is sand along a shore, where the map is neither land nor sea', () => {
    // Malibu on the map: a gray-blue.
    const [red, green, blue] = albedo(colorFromFile(68, 70, 83));
    expect(red).toBeGreaterThan(green);
    expect(green).toBeGreaterThan(blue);
    expect(red).toBeGreaterThan(0.15);
  });

  it('is dark and green in forest, but not black', () => {
    const [red, green, blue] = albedo(DAY.amazon);
    expect(green).toBeGreaterThan(red);
    expect(green).toBeGreaterThan(blue);
    expect(green).toBeLessThan(0.08);
    expect(blue).toBeGreaterThanOrEqual(LAND_ALBEDO.floor);
  });
});

describe('cityGlow', () => {
  it('is nothing over sea, desert and forest', () => {
    expect(cityGlow(NIGHT.pacific)).toBe(0);
    expect(cityGlow(NIGHT.sahara)).toBe(0);
    expect(cityGlow(NIGHT.boreal)).toBe(0);
  });

  it('is all of it in a big city, and some of it in a lived-in countryside', () => {
    expect(cityGlow(NIGHT.losAngeles)).toBeGreaterThan(0.95);
    expect(cityGlow(NIGHT.uk)).toBeGreaterThan(0.15);
    expect(cityGlow(NIGHT.uk)).toBeLessThan(0.5);
  });
});

describe('seaReflectance', () => {
  it('is a few percent looking straight down', () => {
    expect(seaReflectance(1)).toBeCloseTo(0.02, 6);
  });

  it('rises toward the horizon, and stops short of half', () => {
    let last = 0;
    for (const angle of [0, 30, 60, 75, 85, 89, 90]) {
      const mirror = seaReflectance(Math.cos(angle * DEG));
      expect(mirror).toBeGreaterThan(last);
      last = mirror;
    }
    expect(last).toBeGreaterThan(0.35);
    expect(last).toBeLessThan(0.5);
  });

  it('is a full mirror at a glancing angle only if the sea is flat', () => {
    expect(seaReflectance(0, 0)).toBeCloseTo(1, 6);
    expect(seaReflectance(0, SEA.roughness * 2)).toBeLessThan(seaReflectance(0));
  });
});

describe('lampsInView', () => {
  const height = 0.64;

  it('is single lamps close by, even in a city', () => {
    expect(lampsInView(1, height, 12 * DEG)).toBeLessThan(1);
    expect(lampsInView(1, height, 30 * DEG)).toBeLessThan(0.1);
  });

  it('is many lamps to a patch toward the horizon', () => {
    expect(lampsInView(1, height, 1.5 * DEG)).toBeGreaterThan(20);
    expect(lampsInView(0.05, height, 1.5 * DEG)).toBeGreaterThan(1);
  });

  it('grows the lower the look', () => {
    let last = 0;
    for (const depression of [60, 30, 12, 5, 2, 1]) {
      const lamps = lampsInView(0.5, height, depression * DEG);
      expect(lamps).toBeGreaterThan(last);
      last = lamps;
    }
  });

  it('is none where nothing is built', () => {
    expect(lampsInView(0, height, 1 * DEG)).toBe(0);
  });
});

describe('mapLatitude', () => {
  it('is the same as the angle from the center at the equator and the poles', () => {
    expect(mapLatitude(0)).toBe(0);
    expect(mapLatitude(1)).toBeCloseTo(Math.PI / 2, 12);
    expect(mapLatitude(-1)).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('is nearer the pole in between, by up to a fifth of a degree', () => {
    expect(mapLatitude(Math.sin(45 * DEG)) / DEG).toBeCloseTo(45.19, 2);
    expect(mapLatitude(Math.sin(-45 * DEG)) / DEG).toBeCloseTo(-45.19, 2);
    // Malibu: the beach is at 34.03° on the map.
    expect(mapLatitude(Math.sin(33.852 * DEG)) / DEG).toBeCloseTo(34.03, 2);
  });
});

describe('groundOrigin', () => {
  const at = (latitude: number, longitude: number) =>
    groundOrigin(latitude, longitude, { x: 0, y: 0 });

  it('stays within the pattern', () => {
    for (const [latitude, longitude] of [
      [0, 0],
      [25.69, 32.64],
      [-33.9, 18.4],
      [64.1, -21.9],
      [-89, 179.9],
      [41.88, -87.63],
    ]) {
      const { x, y } = at(latitude, longitude);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(GROUND_PERIOD_KM);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(GROUND_PERIOD_KM);
    }
  });

  it('is the same each time for one place, and different for another', () => {
    expect(at(25.69, 32.64)).toEqual(at(25.69, 32.64));
    const luxor = at(25.69, 32.64);
    const cairo = at(30.04, 31.24);
    expect(Math.hypot(luxor.x - cairo.x, luxor.y - cairo.y)).toBeGreaterThan(10);
  });

  it('moves a km for a km walked north', () => {
    const here = at(10, 20);
    const there = at(10 + 1 / 111.2, 20);
    expect(there.y - here.y).toBeCloseTo(1, 6);
  });
});
