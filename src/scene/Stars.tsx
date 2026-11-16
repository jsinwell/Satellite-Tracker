import { useMemo } from 'react';

const STAR_COUNT = 3500;
/** Scene units (Earth radii): far beyond any orbit, inside the camera's far plane. */
const SKY_RADIUS = 900;

/** A small seeded generator, so the sky is identical on every load. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSky() {
  const random = mulberry32(20261115);
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    // Uniform on the sphere.
    const z = random() * 2 - 1;
    const azimuth = random() * 2 * Math.PI;
    const ring = Math.sqrt(1 - z * z);
    positions.set(
      [
        ring * Math.cos(azimuth) * SKY_RADIUS,
        z * SKY_RADIUS,
        ring * Math.sin(azimuth) * SKY_RADIUS,
      ],
      i * 3,
    );
    // Mostly faint, a few bright, with a slight warm/cool spread.
    const brightness = 0.15 + 0.85 * random() ** 4;
    const warmth = random() * 0.2 - 0.1;
    colors.set([brightness * (1 + warmth), brightness, brightness * (1 - warmth)], i * 3);
  }
  return { positions, colors };
}

/**
 * A decorative backdrop, not a star catalog. It is fixed in the inertial
 * frame like the real sky, so the Earth visibly turns against it.
 */
export function Stars() {
  const { positions, colors } = useMemo(buildSky, []);
  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={1.6} sizeAttenuation={false} vertexColors depthWrite={false} />
    </points>
  );
}
