import { describe, expect, it } from 'vitest';
import {
  angularDiameter,
  BODY_SHAPES,
  bodyExposure,
  bodyShown,
  bodyView,
  closestFov,
  framingFov,
  isSkyBody,
  JUPITER_MOONS,
  jupiterMoonOffsets,
  moonGlare,
  moonlight,
  moonlightSeen,
  moonVeil,
  NARROWEST_FOV,
  type PlanetDisc,
  planetDiscs,
  SATURN_RINGS,
  STAR_VEIL,
  starsKept,
} from './bodies';
import type { Vec3 } from './kinematics';
import { type Planet, planetPositions } from './planets';

const DEG = Math.PI / 180;
const ARCSEC = DEG / 3600;
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (v: Vec3) => Math.hypot(v.x, v.y, v.z);

const august2027 = Date.UTC(2027, 7, 4, 3);
const discs = (timeMs: number) =>
  Object.fromEntries(planetDiscs(timeMs).map((disc) => [disc.planet, disc])) as Record<
    Planet,
    PlanetDisc
  >;
const luxor = { latitude: 25.69, longitude: 32.64 };

describe('angularDiameter', () => {
  it('is half a degree for the Moon, and for the Sun', () => {
    expect(angularDiameter(1737.4, 384_400) / DEG).toBeCloseTo(0.518, 2);
    expect(angularDiameter(695_700, 149_597_870.7) / DEG).toBeCloseTo(0.533, 2);
  });
});

describe('planetDiscs', () => {
  it('puts the planets where planetPositions does', () => {
    const positions = planetPositions(august2027);
    planetDiscs(august2027).forEach((disc, i) => {
      expect(disc.planet).toBe(positions[i].planet);
      expect(dot(disc.direction, positions[i].direction)).toBeCloseTo(1, 12);
      expect(disc.distanceKm).toBeCloseTo(positions[i].distanceKm, 3);
      expect(disc.magnitude).toBeCloseTo(positions[i].magnitude, 9);
    });
  });

  it('gives each the size a telescope shows', () => {
    const seen = discs(august2027);
    const arcsec = (planet: Planet) => seen[planet].angularDiameter / ARCSEC;
    // The ranges each planet stays within, whenever it is looked at.
    expect(arcsec('mercury')).toBeGreaterThan(4.5);
    expect(arcsec('mercury')).toBeLessThan(13);
    expect(arcsec('venus')).toBeGreaterThan(9.5);
    expect(arcsec('venus')).toBeLessThan(66);
    expect(arcsec('mars')).toBeGreaterThan(3.4);
    expect(arcsec('mars')).toBeLessThan(25.2);
    expect(arcsec('jupiter')).toBeGreaterThan(29);
    expect(arcsec('jupiter')).toBeLessThan(51);
    expect(arcsec('saturn')).toBeGreaterThan(14);
    expect(arcsec('saturn')).toBeLessThan(21);
    expect(arcsec('uranus')).toBeCloseTo(3.6, 0);
    expect(arcsec('neptune')).toBeCloseTo(2.3, 0);
  });

  it('has the outer planets all but full, always', () => {
    for (const timeMs of [august2027, Date.UTC(2026, 0, 10), Date.UTC(2030, 5, 1)]) {
      const seen = discs(timeMs);
      expect(seen.jupiter.litFraction).toBeGreaterThan(0.98);
      expect(seen.saturn.litFraction).toBeGreaterThan(0.99);
      expect(seen.neptune.litFraction).toBeGreaterThan(0.999);
    }
  });

  it('shows Venus as a crescent near the Earth and nearly full beyond the Sun', () => {
    // Inferior conjunction, 23 October 2026: a few weeks before it.
    const near = discs(Date.UTC(2026, 9, 1)).venus;
    expect(near.litFraction).toBeLessThan(0.2);
    expect(near.angularDiameter / ARCSEC).toBeGreaterThan(40);
    const far = discs(august2027).venus;
    expect(far.litFraction).toBeGreaterThan(0.95);
    expect(far.angularDiameter / ARCSEC).toBeLessThan(12);
  });

  it('lights each disc by as much as the Sun is round to the side', () => {
    for (const disc of planetDiscs(Date.UTC(2026, 9, 1))) {
      // Toward the Earth from the planet is the other way from `direction`.
      const cosPhase = -dot(disc.sunward, disc.direction);
      expect(length(disc.sunward)).toBeCloseTo(1, 12);
      expect((1 + cosPhase) / 2).toBeCloseTo(disc.litFraction, 2);
    }
  });

  it('gives each an axis and a meridian square to it', () => {
    for (const disc of planetDiscs(august2027)) {
      expect(length(disc.pole)).toBeCloseTo(1, 12);
      expect(length(disc.meridian)).toBeCloseTo(1, 12);
      expect(dot(disc.pole, disc.meridian)).toBeCloseTo(0, 9);
    }
  });

  it('points the axes where they are known to point', () => {
    const seen = discs(august2027);
    // Saturn's pole is 6.5° from the Earth's; Jupiter's and Mars's well away from it.
    expect(Math.acos(seen.saturn.pole.z) / DEG).toBeCloseTo(6.5, 0);
    expect(Math.acos(seen.jupiter.pole.z) / DEG).toBeCloseTo(25.5, 0);
    expect(Math.acos(seen.mars.pole.z) / DEG).toBeCloseTo(37.1, 0);
  });

  it('turns Jupiter once in just under ten hours', () => {
    const day = 9.925 * 3_600_000;
    const now = discs(august2027).jupiter.meridian;
    expect(dot(now, discs(august2027 + day).jupiter.meridian)).toBeCloseTo(1, 3);
    expect(dot(now, discs(august2027 + day / 2).jupiter.meridian)).toBeCloseTo(-1, 3);
    expect(dot(now, discs(august2027 + day / 4).jupiter.meridian)).toBeCloseTo(0, 2);
  });
});

describe('jupiterMoonOffsets', () => {
  const jupiter = discs(august2027).jupiter;
  const offsets = jupiterMoonOffsets(august2027, jupiter.distanceKm);

  it('keeps each moon at its distance from Jupiter', () => {
    expect(length(offsets.io) / 421_800).toBeCloseTo(1, 1);
    expect(length(offsets.europa) / 671_100).toBeCloseTo(1, 1);
    expect(length(offsets.ganymede) / 1_070_400).toBeCloseTo(1, 1);
    expect(length(offsets.callisto) / 1_882_700).toBeCloseTo(1, 1);
  });

  it('has them go round near the plane of the equator of Jupiter', () => {
    for (const moon of JUPITER_MOONS) {
      const above = dot(offsets[moon], jupiter.pole) / length(offsets[moon]);
      expect(Math.abs(above)).toBeLessThan(0.02);
    }
  });

  it('takes Io round in a day and three quarters', () => {
    const later = jupiterMoonOffsets(august2027 + 1.769 * 86_400_000, jupiter.distanceKm);
    const angle = Math.acos(dot(offsets.io, later.io) / (length(offsets.io) * length(later.io)));
    expect(angle / DEG).toBeLessThan(2);
  });

  it('shows them as they were when their light left', () => {
    // Asked about the moment the light left, as if Jupiter were at no
    // distance, they are where they are seen now.
    const lightMs = (jupiter.distanceKm / 299_792.458) * 1000;
    const then = jupiterMoonOffsets(august2027 - lightMs, 0);
    for (const moon of JUPITER_MOONS) {
      const apart = length({
        x: then[moon].x - offsets[moon].x,
        y: then[moon].y - offsets[moon].y,
        z: then[moon].z - offsets[moon].z,
      });
      // But for the frame having turned a hair in the meantime.
      expect(apart).toBeLessThan(200);
    }
  });
});

describe('bodyView', () => {
  it('finds the Moon new at the eclipse of 2 August 2027, high over Luxor', () => {
    const view = bodyView('moon', luxor, Date.UTC(2027, 7, 2, 10, 7));
    expect(view.litFraction).toBeLessThan(0.001);
    expect(view.elevation).toBeGreaterThan(80);
    expect(view.angularDiameter / DEG).toBeGreaterThan(0.54);
    expect(view.angularDiameter / DEG).toBeLessThan(0.57);
    expect(view.constellation).toBe('Cancer');
  });

  it('finds it full two weeks later', () => {
    const view = bodyView('moon', luxor, Date.UTC(2027, 7, 17, 7, 30));
    expect(view.litFraction).toBeGreaterThan(0.99);
    expect(view.magnitude).toBeLessThan(-12);
  });

  it('measures the Moon from where the observer stands', () => {
    // Overhead, it is most of an Earth radius nearer than it is to the center.
    const overhead = bodyView('moon', luxor, Date.UTC(2027, 7, 2, 10, 7));
    const elsewhere = bodyView(
      'moon',
      { latitude: -60, longitude: -140 },
      Date.UTC(2027, 7, 2, 10, 7),
    );
    expect(elsewhere.distanceKm - overhead.distanceKm).toBeGreaterThan(5000);
    expect(overhead.angularDiameter).toBeGreaterThan(elsewhere.angularDiameter);
  });

  it('describes a planet as planetDiscs does, and says where to look', () => {
    const view = bodyView('jupiter', luxor, august2027);
    const disc = discs(august2027).jupiter;
    expect(view.distanceKm).toBeCloseTo(disc.distanceKm, 3);
    expect(view.angularDiameter).toBeCloseTo(disc.angularDiameter, 12);
    expect(view.magnitude).toBeCloseTo(disc.magnitude, 9);
    expect(view.azimuth).toBeGreaterThanOrEqual(0);
    expect(view.azimuth).toBeLessThan(360);
    expect(view.constellation).toBe('Leo');
  });
});

describe('framing', () => {
  it('leaves room for Callisto on either side of Jupiter', () => {
    const jupiter = discs(august2027).jupiter;
    const fov = framingFov('jupiter', jupiter.angularDiameter) * DEG;
    // On a screen at least 4:3, the view is that much wider than it is tall.
    const halfWidth = (fov / 2) * (4 / 3);
    expect(halfWidth).toBeGreaterThan(Math.asin(1_882_700 / jupiter.distanceKm));
  });

  it('takes in the whole of the rings of Saturn', () => {
    const saturn = discs(august2027).saturn;
    const fov = framingFov('saturn', saturn.angularDiameter) * DEG;
    expect(fov).toBeGreaterThan(2 * Math.asin(SATURN_RINGS.outerKm / saturn.distanceKm));
  });

  it('shows the Moon whole, most of the height of the view', () => {
    const moon = angularDiameter(BODY_SHAPES.moon.radiusKm, 384_400);
    const fov = framingFov('moon', moon);
    expect(fov).toBeGreaterThan(moon / DEG);
    expect(fov).toBeLessThan(1.1);
  });

  it('never goes narrower than the narrowest', () => {
    expect(framingFov('neptune', 0.1 * ARCSEC)).toBe(NARROWEST_FOV);
    expect(closestFov(0.1 * ARCSEC)).toBe(NARROWEST_FOV);
    expect(closestFov(30 * ARCSEC)).toBeCloseTo(0.01, 3);
  });
});

describe('exposure', () => {
  it('needs more for the planets further from the Sun', () => {
    const order = ['venus', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] as const;
    for (let i = 1; i < order.length; i++) {
      expect(bodyExposure(order[i])).toBeGreaterThan(bodyExposure(order[i - 1]));
    }
  });

  it('shows a body whole when exposed for it, or for anything dimmer', () => {
    expect(bodyShown('jupiter', bodyExposure('jupiter'))).toBeCloseTo(1, 12);
    expect(bodyShown('jupiter', 1e5)).toBe(1);
  });

  it('leaves Jupiter a ghost in a picture exposed for the daytime sky, and Venus plain', () => {
    // 14 is the exposure by day: see EXPOSURE in atmosphere.ts.
    expect(bodyShown('jupiter', 14)).toBeLessThan(0.1);
    expect(bodyShown('venus', 14)).toBe(1);
  });
});

describe('moonlight', () => {
  const full = Date.UTC(2027, 7, 17, 12);
  const firstQuarter = Date.UTC(2027, 7, 9, 5);
  const newMoon = Date.UTC(2027, 7, 2, 10, 7);

  it('is a few millionths of sunlight at full Moon', () => {
    expect(moonlight(full)).toBeGreaterThan(1.5e-6);
    expect(moonlight(full)).toBeLessThan(3.5e-6);
  });

  it('is about a tenth of that at the quarter, not half', () => {
    const share = moonlight(firstQuarter) / moonlight(full);
    expect(share).toBeGreaterThan(0.06);
    expect(share).toBeLessThan(0.14);
  });

  it('is next to nothing at new Moon', () => {
    expect(moonlight(newMoon)).toBeLessThan(1e-8);
  });

  it('goes out in a total eclipse of the Moon', () => {
    // 3 March 2026, greatest eclipse at 11:34 UTC.
    const totality = Date.UTC(2026, 2, 3, 11, 34);
    expect(moonlight(totality)).toBeLessThan(0.01 * moonlight(totality - 6 * 3_600_000));
  });
});

describe('moonlightSeen', () => {
  it('is nothing with no Moon', () => {
    expect(moonlightSeen(0)).toBe(0);
    expect(moonlightSeen(-1)).toBe(0);
  });

  it('draws a full Moon several times stronger than it is', () => {
    expect(moonlightSeen(2.5e-6) / 2.5e-6).toBeCloseTo(6);
  });

  it('draws a half Moon about a quarter as strong as a full one, not a tenth', () => {
    const share = moonlightSeen(2.5e-7) / moonlightSeen(2.5e-6);
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.3);
  });
});

describe('moonGlare', () => {
  // The exposures of a dark night, of day, and of a telescope on the Moon.
  it('is strong on a dark night and gone by day or through a telescope', () => {
    expect(moonGlare(2.5e-6, 30_000)).toBeGreaterThan(0.9);
    expect(moonGlare(2.5e-7, 30_000)).toBeGreaterThan(0.3);
    expect(moonGlare(2.5e-6, 14)).toBeLessThan(0.01);
    expect(moonGlare(2.5e-6, 26)).toBeLessThan(0.01);
  });

  it('is nothing with no Moon', () => {
    expect(moonGlare(0, 80_000)).toBe(0);
  });
});

describe('moonVeil', () => {
  it('is nothing with no Moon, or with it down', () => {
    expect(moonVeil(0, 60)).toBe(0);
    expect(moonVeil(2.5e-6, -10)).toBe(0);
  });

  it('is all there with a full Moon high up, or a brighter one', () => {
    expect(moonVeil(2.5e-6, 50)).toBe(1);
    expect(moonVeil(9e-6, 50)).toBe(1);
  });

  it('is half of it by half Moon, and still something for a crescent', () => {
    expect(moonVeil(2.5e-7, 50)).toBeGreaterThan(0.45);
    expect(moonVeil(2.5e-7, 50)).toBeLessThan(0.55);
    expect(moonVeil(1e-8, 50)).toBeGreaterThan(0.12);
    expect(moonVeil(1e-8, 50)).toBeLessThan(0.25);
  });

  it('is less the lower the Moon is', () => {
    expect(moonVeil(2.5e-6, 3)).toBeLessThan(moonVeil(2.5e-6, 50));
    expect(moonVeil(2.5e-6, 3)).toBeGreaterThan(0);
  });
});

describe('starsKept', () => {
  it('leaves the stars alone with no veil and dims them under one', () => {
    expect(starsKept(0)).toBe(1);
    expect(starsKept(1)).toBeCloseTo(1 - STAR_VEIL.dimming);
    expect(starsKept(0.5)).toBeGreaterThan(starsKept(1));
    expect(starsKept(7)).toBeCloseTo(1 - STAR_VEIL.dimming);
  });
});

describe('isSkyBody', () => {
  it('knows the Moon and the planets, and nothing else', () => {
    expect(isSkyBody('moon')).toBe(true);
    expect(isSkyBody('saturn')).toBe(true);
    expect(isSkyBody('pluto')).toBe(false);
    expect(isSkyBody(3)).toBe(false);
    expect(isSkyBody(null)).toBe(false);
  });
});
