import { SHADOW_EDGE_KM } from '../core/astro';
import { EARTH_MU, EARTH_RADIUS_KM } from '../core/constants';

/** How bright a satellite in the Earth's shadow is drawn, relative to a sunlit one. */
const SHADOW_BRIGHTNESS = 0.22;

/**
 * GLSL shared by everything that draws satellites from the simulation's state
 * buffer. Each function mirrors one in `core/`, which is where it is tested;
 * the two must be kept in step, or what is drawn drifts from what is picked
 * and reported.
 */
export const ORBIT_GLSL = /* glsl */ `
  const float MU = ${EARTH_MU.toFixed(4)};
  const float EARTH_RADIUS = ${EARTH_RADIUS_KM.toFixed(3)};
  const float SHADOW_EDGE = ${SHADOW_EDGE_KM.toFixed(1)};
  const float SHADOW_BRIGHTNESS = ${SHADOW_BRIGHTNESS.toFixed(2)};

  // Mirrors extrapolatePosition in core/kinematics.ts.
  vec3 extrapolate(vec3 position, vec3 velocity, float dt) {
    float r2 = dot(position, position);
    vec3 acceleration = -MU * position / (r2 * sqrt(r2));
    return position + velocity * dt + 0.5 * acceleration * dt * dt;
  }

  // Mirrors shadowDepth in core/astro.ts. Returns a brightness multiplier.
  float sunlight(vec3 position, vec3 sunDirection) {
    float along = dot(position, sunDirection);
    if (along >= 0.0) return 1.0;
    float fromAxis = length(position - along * sunDirection);
    float shadow = 1.0 - smoothstep(EARTH_RADIUS - SHADOW_EDGE, EARTH_RADIUS + SHADOW_EDGE, fromAxis);
    return mix(1.0, SHADOW_BRIGHTNESS, shadow);
  }
`;
