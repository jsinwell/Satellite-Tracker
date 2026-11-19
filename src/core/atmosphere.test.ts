import { describe, expect, it } from 'vitest';
import {
  ATMOSPHERE,
  atmosphereTables,
  ECLIPSE_SKYLIGHT,
  EXPOSURE,
  integrateTransmittance,
  luminance,
  meterSky,
  meterView,
  NIGHT_EXPOSURE,
  type Rgb,
  SUN_ANGULAR_RADIUS,
  skyExposure,
  skyLight,
  sunlightReaching,
  transmittanceToSpace,
  transmittanceToTop,
} from './atmosphere';
import type { Vec3 } from './kinematics';

const DEG = Math.PI / 180;
const rgb = (): Rgb => [0, 0, 0];

const tables = atmosphereTables();
/** Standing a little above sea level, at the pole so that z is up. */
const eye: Vec3 = { x: 0, y: 0, z: ATMOSPHERE.bottomKm + 0.6 };
const UP: Vec3 = { x: 0, y: 0, z: 1 };
/** A direction in the x-z plane, `elevation` degrees above level. */
const above = (elevation: number, facing = 1): Vec3 => ({
  x: facing * Math.cos(elevation * DEG),
  y: 0,
  z: Math.sin(elevation * DEG),
});
const zenith = (sunElevation: number) => skyLight(tables, eye, UP, above(sunElevation), rgb());
const brightness = (sunElevation: number) =>
  luminance(meterSky(tables, eye, above(sunElevation), rgb()));

describe('the transmittance table', () => {
  it('agrees with integrating along the line directly', () => {
    for (const height of [0, 0.6, 3.7, 12, 41, 88]) {
      for (const mu of [1, 0.63, 0.21, 0.04]) {
        const r = ATMOSPHERE.bottomKm + height;
        const direct = integrateTransmittance(r, mu, rgb());
        const read = transmittanceToTop(tables, r, mu, rgb());
        for (let c = 0; c < 3; c++) expect(read[c] / direct[c]).toBeCloseTo(1, 2);
      }
    }
  });

  it('lets most light through straight up, and more red than blue', () => {
    const [red, green, blue] = transmittanceToTop(tables, ATMOSPHERE.bottomKm, 1, rgb());
    expect(red).toBeGreaterThan(green);
    expect(green).toBeGreaterThan(blue);
    expect(red).toBeLessThan(0.95);
    expect(blue).toBeGreaterThan(0.7);
  });

  it('lets through no more than there is, and less the lower the line', () => {
    const r = ATMOSPHERE.bottomKm + 2;
    let last = 1;
    for (const mu of [1, 0.5, 0.2, 0.05, 0]) {
      const through = luminance(transmittanceToTop(tables, r, mu, rgb()));
      expect(through).toBeLessThan(last);
      expect(through).toBeGreaterThan(0);
      last = through;
    }
  });
});

describe('transmittanceToSpace', () => {
  const outside: Vec3 = { x: 0, y: 0, z: ATMOSPHERE.topKm + 5000 };

  it('is everything looking away from the Earth, and nothing through it', () => {
    expect(transmittanceToSpace(tables, outside, UP, rgb())).toEqual([1, 1, 1]);
    expect(transmittanceToSpace(tables, outside, { x: 0, y: 0, z: -1 }, rgb())).toEqual([0, 0, 0]);
  });

  it('is reddened along a line that grazes the Earth', () => {
    // From far away, past the Earth's edge 10 km above the ground.
    const graze = Math.asin((ATMOSPHERE.bottomKm + 10) / outside.z);
    const direction: Vec3 = { x: Math.sin(graze), y: 0, z: -Math.cos(graze) };
    const [red, green, blue] = transmittanceToSpace(tables, outside, direction, rgb());
    expect(red).toBeGreaterThan(green);
    expect(green).toBeGreaterThan(blue);
    expect(red).toBeLessThan(1);
    expect(blue).toBeGreaterThan(0);
  });
});

describe('the sky from the ground', () => {
  it('is blue overhead by day', () => {
    for (const sun of [60, 30, 10]) {
      const [red, green, blue] = zenith(sun);
      expect(blue).toBeGreaterThan(1.5 * green);
      expect(green).toBeGreaterThan(1.5 * red);
    }
  });

  it('stays blue overhead through twilight, which is the ozone at work', () => {
    for (const sun of [0, -2, -4, -6, -9]) {
      const [red, green, blue] = zenith(sun);
      expect(blue).toBeGreaterThan(1.5 * green);
      expect(green).toBeGreaterThan(red);
    }
  });

  it('is whiter and brighter toward the horizon than overhead', () => {
    const sun = above(50);
    const overhead = skyLight(tables, eye, UP, sun, rgb());
    // Facing away from the Sun, so that its glow is not what is measured.
    const low = skyLight(tables, eye, above(3, -1), sun, rgb());
    expect(luminance(low)).toBeGreaterThan(2 * luminance(overhead));
    expect(low[2] / low[0]).toBeLessThan(0.5 * (overhead[2] / overhead[0]));
  });

  it('glows around a low Sun, and is warmer there than opposite it', () => {
    const sun = above(3);
    const toward = skyLight(tables, eye, above(4), sun, rgb());
    const opposite = skyLight(tables, eye, above(4, -1), sun, rgb());
    expect(luminance(toward)).toBeGreaterThan(2 * luminance(opposite));
    expect(toward[0] / toward[2]).toBeGreaterThan(opposite[0] / opposite[2]);
  });

  it('darkens as the Sun goes down, and is all but black by the end of twilight', () => {
    const elevations = [60, 30, 10, 0, -3, -6, -9, -12, -18];
    const levels = elevations.map(brightness);
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeLessThan(levels[i - 1]);
    // The Sun on the horizon still lights the whole sky; 6° under it, far less.
    expect(brightness(0)).toBeGreaterThan(0.05 * brightness(60));
    expect(brightness(-6)).toBeLessThan(0.002 * brightness(60));
    expect(brightness(-18)).toBeLessThan(1e-7 * brightness(60));
  });

  it('has no light from above the air', () => {
    const outside: Vec3 = { x: 0, y: 0, z: ATMOSPHERE.topKm + 1 };
    expect(skyLight(tables, outside, UP, above(40), rgb())).toEqual([0, 0, 0]);
  });

  it('goes dark in the shadow of the Moon, but for the light from around it', () => {
    const sun = above(60);
    const open = luminance(meterSky(tables, eye, sun, rgb()));
    const shadowed = luminance(meterSky(tables, eye, sun, rgb(), () => 0));
    expect(shadowed).toBeGreaterThan(0);
    expect(shadowed).toBeLessThan(ECLIPSE_SKYLIGHT * open);
    const half = luminance(meterSky(tables, eye, sun, rgb(), () => 0.5));
    expect(half).toBeGreaterThan(0.45 * open);
    expect(half).toBeLessThan(0.55 * open);
  });
});

describe('meterView', () => {
  const view = (direction: Vec3, sunElevation: number) =>
    meterView(tables, eye, above(sunElevation), direction);

  it('is brighter toward the horizon than overhead', () => {
    expect(view(above(15, -1), 50)).toBeGreaterThan(1.5 * view(UP, 50));
  });

  it('is brighter facing a low Sun than with it behind, and far more so after sunset', () => {
    for (const sun of [3, 0]) {
      expect(view(above(10), sun)).toBeGreaterThan(1.2 * view(above(10, -1), sun));
    }
    expect(view(above(10), -4)).toBeGreaterThan(3 * view(above(10, -1), -4));
  });

  it('is about the brightness of the whole sky, looking up', () => {
    for (const sun of [60, 5, -3]) {
      const ratio = view(UP, sun) / brightness(sun);
      expect(ratio).toBeGreaterThan(0.6);
      expect(ratio).toBeLessThan(1.2);
    }
  });

  it('measures the sky at the horizon, not the ground, when looking down', () => {
    const down = view(above(-40), 30);
    const level = view(above(2), 30);
    expect(down).toBeGreaterThan(0.5 * level);
    expect(down).toBeLessThan(2 * level);
  });

  it('goes dark in the shadow of the Moon', () => {
    const sun = above(60);
    const open = meterView(tables, eye, sun, above(50));
    const shadowed = meterView(tables, eye, sun, above(50), () => 0);
    expect(shadowed).toBeGreaterThan(0);
    expect(shadowed).toBeLessThan(0.01 * open);
  });
});

describe('sunlightReaching', () => {
  const reaching = (elevation: number) =>
    sunlightReaching(tables, eye, above(elevation), SUN_ANGULAR_RADIUS, rgb());

  it('is nearly white with the Sun high', () => {
    const [red, green, blue] = reaching(60);
    expect(red).toBeGreaterThan(0.85);
    expect(blue).toBeGreaterThan(0.6);
    expect(red).toBeGreaterThan(green);
    expect(green).toBeGreaterThan(blue);
  });

  it('reddens and dims as the Sun nears the horizon', () => {
    let lastWarmth = 0;
    let lastLight = 1;
    for (const elevation of [60, 20, 5, 2, 0.5]) {
      const light = reaching(elevation);
      const warmth = light[0] / light[2];
      expect(warmth).toBeGreaterThan(lastWarmth);
      expect(luminance(light)).toBeLessThan(lastLight);
      lastWarmth = warmth;
      lastLight = luminance(light);
    }
    const [red, green, blue] = reaching(0.5);
    expect(red).toBeGreaterThan(3 * green);
    expect(green).toBeGreaterThan(10 * blue);
  });

  it('is nothing once the Earth is in the way', () => {
    expect(reaching(-2)).toEqual([0, 0, 0]);
  });

  it('is the whole of it in space', () => {
    const outside: Vec3 = { x: 0, y: 0, z: ATMOSPHERE.topKm + 5000 };
    const light = sunlightReaching(tables, outside, above(30), SUN_ANGULAR_RADIUS, rgb());
    for (const channel of light) expect(channel).toBeCloseTo(1, 12);
  });
});

describe('skyExposure', () => {
  it('is the daytime setting under a daytime sky, which the model produces', () => {
    expect(skyExposure(EXPOSURE.daySky)).toBeCloseTo(EXPOSURE.day, 9);
    expect(brightness(60) / EXPOSURE.daySky).toBeGreaterThan(0.7);
    expect(brightness(60) / EXPOSURE.daySky).toBeLessThan(1.4);
  });

  it('makes up for part of a dimmer sky, not all of it', () => {
    const dusk = EXPOSURE.daySky / 1000;
    expect(skyExposure(dusk)).toBeGreaterThan(skyExposure(EXPOSURE.daySky));
    // The picture is still dimmer at dusk than by day.
    expect(dusk * skyExposure(dusk)).toBeLessThan(EXPOSURE.daySky * EXPOSURE.day);
  });

  it('takes no notice of a view no brighter than the horizon is by day', () => {
    const sky = EXPOSURE.daySky;
    expect(skyExposure(sky, sky / 3)).toBe(skyExposure(sky));
    expect(skyExposure(sky, EXPOSURE.brightView * sky)).toBe(skyExposure(sky));
  });

  it('turns down for a view much brighter than the rest of the sky', () => {
    const sky = EXPOSURE.daySky / 10;
    expect(skyExposure(sky, 4 * sky)).toBeLessThan(skyExposure(sky));
    expect(skyExposure(sky, 4 * sky)).toBeCloseTo(skyExposure((4 * sky) / EXPOSURE.brightView), 9);
  });

  it('stops adapting at night', () => {
    expect(skyExposure(EXPOSURE.darkestSky)).toBe(NIGHT_EXPOSURE);
    expect(skyExposure(EXPOSURE.darkestSky / 100)).toBe(NIGHT_EXPOSURE);
    expect(skyExposure(0)).toBe(NIGHT_EXPOSURE);
  });
});
