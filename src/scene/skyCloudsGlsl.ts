import { CLOUD_COVER, CLOUD_LATITUDES, SKY_CLOUDS } from '../core/clouds';
import { ATMOSPHERE_GLSL } from './atmosphereGlsl';
import { LANDSCAPE_GLSL } from './landscapeGlsl';

const float = (value: number) => value.toExponential(8);

/**
 * The fragment shader for the clouds seen from under them: one layer, a few
 * km up, drawn over the whole screen after the sky and before the satellites.
 *
 * How much cloud there is over each place comes from the same picture the
 * globe wears, which says so to within 20 km or so. The clouds themselves,
 * their edges and their lumps, are made up, the same way each time for a
 * given place, as the ground's hills are: see `landscapeGlsl.ts`, whose
 * noise this borrows.
 *
 * Goes with the sky's vertex shader, and needs `uSkyAmbient`, the light of
 * the sky averaged, like the ground's.
 */
export const SKY_CLOUDS_FRAGMENT = /* glsl */ `
  uniform vec3 uSkyAmbient;
  uniform float uCloudsShown;

  varying vec3 vRay;

  ${ATMOSPHERE_GLSL}
  ${LANDSCAPE_GLSL}

  const float CLOUD_HEIGHT = ${float(SKY_CLOUDS.heightKm)};
  const float CLOUD_HAZE = ${float(SKY_CLOUDS.hazeKm)};

  // How brightly a cloud shows a light coming from "toLight", for one as
  // bright as the Sun: the underside of the cloud, the side of each lump that
  // faces the light, and the glow through thin cloud toward it.
  float cloudLit(vec3 direction, vec2 slope, vec3 toLight, float under, float thick) {
    vec2 along = vec2(dot(toLight, uLandEast), dot(toLight, uLandNorth));
    float side = clamp(0.5 - 1.2 * dot(slope, along), 0.0, 1.0);
    float toward = max(dot(direction, toLight), 0.0);
    return under * (0.07 + 0.16 * side) + 0.5 * (1.0 - thick) * pow(toward, 6.0);
  }

  void main() {
    vec3 direction = normalize(vRay);
    float r = SKY_BOTTOM + uSkyEyeHeight;
    float shell = SKY_BOTTOM + CLOUD_HEIGHT;
    float b = dot(uSkyEye, direction);
    // How far along this line of sight the layer is: from below it, there
    // is always one crossing ahead. Written so that looking straight up,
    // where it is the small difference of two large numbers, it stays exact.
    float c = (CLOUD_HEIGHT - uSkyEyeHeight) * (r + shell);
    float s = sqrt(max(b * b + c, 0.0));
    float reach = b > 0.0 ? c / (b + s) : s - b;

    // Where that is, km east and north of the camera, and how much of the
    // layer a pixel takes in there. Worked out for every pixel, as each is
    // measured against the pixels next to it.
    vec2 at = reach * vec2(dot(direction, uLandEast), dot(direction, uLandNorth));
    float footprint = max(length(dFdx(at)), length(dFdy(at)));

    // Not from above the layer, and not below the horizon, which is the ground's.
    float horizon = -sqrt(uSkyEyeHeight * (r + SKY_BOTTOM)) / r;
    if (uLandClouded * uCloudsShown <= 0.0 || c <= 0.0 || b / r < horizon) discard;

    // How much cloud the picture has over that place. Mirrors cloudCover,
    // cloudsDrawnAt and, for the latitude, mapLatitude.
    vec3 up = normalize(uSkyEye + direction * reach);
    vec3 earth = uLandFromWorld * up;
    float latitude = atan(earth.z, LAND_FLATTENING * sqrt(max(0.0, 1.0 - earth.z * earth.z)));
    vec2 place = vec2(atan(earth.y, earth.x) / (2.0 * SKY_PI) + 0.5, latitude / SKY_PI + 0.5);
    float cover = smoothstep(${float(CLOUD_COVER.from)}, ${float(CLOUD_COVER.to)}, textureLod(uLandClouds, place, 0.0).r)
      * (1.0 - smoothstep(${float(CLOUD_LATITUDES.full / 90)}, ${float(CLOUD_LATITUDES.none / 90)}, abs(latitude) / (0.5 * SKY_PI)));
    if (cover <= 0.01) discard;

    // The clouds: lumps from 9 km across down to 300 m, each size dropped
    // where it is too fine for the screen. More cover lowers the bar for
    // what counts as cloud, until at full cover everything does.
    vec2 p = at + uLandOrigin;
    float lumps = 0.0;
    vec2 slope = vec2(0.0);
    float across = 9.0;
    float weight = 0.5;
    mat2 back = mat2(1.0);
    for (int i = 0; i < 6; i++) {
      float keep = 1.0 - smoothstep(0.15, 0.5, footprint / across);
      if (keep <= 0.0) break;
      vec3 n = landNoise(p / across + 17.0);
      lumps += keep * weight * n.x;
      // Only the larger lumps have sides for the Sun to light: the small
      // ones would make every cloud look brushed toward it.
      if (i < 3) slope += keep * weight * (back * n.yz);
      p = LAND_TURN * p + 9.1;
      back = back * transpose(LAND_TURN);
      across *= 0.45;
      weight *= 0.55;
    }
    // The lumps, spread over 0 to 1: as much of the sky is cloud as the
    // picture has cover there, the highest lumps first.
    float over = clamp(0.5 + 2.2 * lumps, 0.0, 1.0) - (1.0 - cover);
    float thick = smoothstep(0.0, 0.4, over);
    float alpha = smoothstep(-0.05, 0.07, over);
    if (alpha <= 0.0) discard;

    // Lit by the Sun as it is from up there: later into the evening than the
    // ground is, and redder. From below, thick cloud is gray and thin cloud
    // bright; toward the Sun its thin edges shine; and each lump is a little
    // brighter on the side the Sun is on.
    float sunHeight = dot(up, uSkySun);
    float left = 1.0;
    if (uSkyEclipse > 0.5) left -= sunHiddenByMoon(up, uSkySunPosition, uSkyMoonPosition);
    vec3 sunlight = skySunlight(shell, sunHeight) * left;
    // And by the Moon, the same way, when it is the light there is.
    vec3 moonlight = skyByNight(skySunlight(shell, dot(up, uSkyMoon)) * uSkyMoonlight);
    float under = mix(1.0, 0.3, thick);
    vec3 light = sunlight * cloudLit(direction, slope, uSkySun, under, thick)
      + moonlight * cloudLit(direction, slope, uSkyMoon, under, thick)
      + uSkyAmbient * (0.5 + 0.7 * under);

    // The air between: far clouds go the color of the sky they are seen
    // against, and are gone into it by the horizon.
    vec3 air;
    vec3 through;
    skyView(direction, false, air, through);
    float haze = 1.0 - exp(-reach / CLOUD_HAZE);
    vec3 color = mix(skyTone(light), air, haze);
    alpha *= uLandClouded * uCloudsShown * (1.0 - haze * haze);

    // Blended as the sky is: the color is what to add, the alpha how much
    // of what is behind to hide.
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
    gl_FragColor.rgb *= alpha;
  }
`;
