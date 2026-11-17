import { Matrix4, SphereGeometry, Texture, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { SPHERE_POLES_TO_Z } from './frame';
import { configureSkyMap } from './skyMap';

/**
 * Where a star at the given right ascension and declination (degrees) sits in
 * NASA's map: RA 0h at the center, increasing to the left; north at the top.
 * This layout was established by finding the six stars below in the image.
 */
function mapPosition(raDeg: number, decDeg: number) {
  return { u: (((0.5 - raDeg / 360) % 1) + 1) % 1, v: (decDeg + 90) / 180 };
}

/** The texture coordinate the sky sphere samples in a given inertial direction. */
function sampledPosition(raDeg: number, decDeg: number) {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const direction = new Vector3(
    Math.cos(dec) * Math.cos(ra),
    Math.cos(dec) * Math.sin(ra),
    Math.sin(dec),
  );

  const segments = 720;
  const geometry = new SphereGeometry(1, segments, segments / 2);
  geometry.applyMatrix4(new Matrix4().makeRotationX(SPHERE_POLES_TO_Z[0]));
  const positions = geometry.getAttribute('position');
  const uvs = geometry.getAttribute('uv');

  let nearest = 0;
  let nearestDot = -Infinity;
  const vertex = new Vector3();
  for (let i = 0; i < positions.count; i++) {
    const dot = vertex.fromBufferAttribute(positions, i).dot(direction);
    if (dot > nearestDot) {
      nearestDot = dot;
      nearest = i;
    }
  }

  const texture = new Texture();
  configureSkyMap(texture);
  const u = uvs.getX(nearest) * texture.repeat.x + texture.offset.x;
  return { u: ((u % 1) + 1) % 1, v: uvs.getY(nearest) };
}

describe('the sky sphere', () => {
  it.each([
    ['Sirius', 101.287, -16.716],
    ['Canopus', 95.988, -52.696],
    ['Vega', 279.235, 38.784],
    ['Arcturus', 213.915, 19.182],
    ['Rigel', 78.634, -8.202],
    ['Achernar', 24.429, -57.237],
  ])('shows %s where it really is', (_name, ra, dec) => {
    const expected = mapPosition(ra, dec);
    const actual = sampledPosition(ra, dec);
    // Within one grid cell of the test sphere (half a degree).
    expect(actual.u).toBeCloseTo(expected.u, 2);
    expect(actual.v).toBeCloseTo(expected.v, 2);
  });
});
