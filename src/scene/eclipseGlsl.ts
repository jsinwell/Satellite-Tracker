import { EARTH_RADIUS_KM } from '../core/constants';
import { EARTH_SHADOW_RADIUS_KM, MOON_SHADOW_RADIUS_KM, SUN_RADIUS_KM } from '../core/eclipse';

const inEarthRadii = (km: number) => (km / EARTH_RADIUS_KM).toFixed(7);

/**
 * GLSL for eclipses, in world units (Earth radii) with the Earth's center at
 * the origin. Mirrors `core/eclipse.ts`, where it is tested; the two must be
 * kept in step. Angles stay precise when small: separations come from the
 * length of a cross product, not the arccosine of a dot product, which in
 * single precision could not tell a quarter of a degree from nothing.
 */
export const ECLIPSE_GLSL = /* glsl */ `
  const float SUN_RADIUS = ${inEarthRadii(SUN_RADIUS_KM)};
  const float MOON_SHADOW_RADIUS = ${inEarthRadii(MOON_SHADOW_RADIUS_KM)};
  const float EARTH_SHADOW_RADIUS = ${inEarthRadii(EARTH_SHADOW_RADIUS_KM)};
  const float ECLIPSE_PI = 3.14159265;

  // Mirrors discCoverage.
  float discCoverage(float body, float cover, float d) {
    if (d >= body + cover) return 0.0;
    if (d <= abs(cover - body)) return cover >= body ? 1.0 : (cover * cover) / (body * body);
    float a = acos(clamp((d * d + body * body - cover * cover) / (2.0 * d * body), -1.0, 1.0));
    float b = acos(clamp((d * d + cover * cover - body * body) / (2.0 * d * cover), -1.0, 1.0));
    float kite = sqrt(max(0.0, (-d + body + cover) * (d + body - cover) * (d - body + cover) * (d + body + cover)));
    return min(1.0, (body * body * a + cover * cover * b - 0.5 * kite) / (ECLIPSE_PI * body * body));
  }

  float angleBetween(vec3 from, vec3 a, vec3 b) {
    vec3 u = a - from;
    vec3 v = b - from;
    return atan(length(cross(u, v)), dot(u, v));
  }

  // Mirrors sunHiddenByMoon.
  float sunHiddenByMoon(vec3 point, vec3 sun, vec3 moon) {
    float separation = angleBetween(point, sun, moon);
    // Most of the time the Moon is nowhere near the Sun: skip the rest.
    if (separation > 0.03) return 0.0;
    return discCoverage(
      asin(SUN_RADIUS / length(sun - point)),
      asin(MOON_SHADOW_RADIUS / length(moon - point)),
      separation
    );
  }

  // Mirrors sunHiddenByEarth.
  float sunHiddenByEarth(vec3 point, vec3 sun) {
    float separation = angleBetween(point, sun, vec3(0.0));
    if (separation > 0.06) return 0.0;
    return discCoverage(
      asin(SUN_RADIUS / length(sun - point)),
      asin(min(1.0, EARTH_SHADOW_RADIUS / length(point))),
      separation
    );
  }
`;
