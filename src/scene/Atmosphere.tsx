import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  BufferGeometry,
  CustomBlending,
  Float32BufferAttribute,
  MathUtils,
  Matrix4,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PerspectiveCamera,
  ShaderMaterial,
  Vector3,
} from 'three';
import { currentSimTime, useApp } from '../app/store';
import { gmst, moonPosition, sunDirection, sunPosition } from '../core/astro';
import {
  ATMOSPHERE,
  atmosphereTables,
  EXPOSURE,
  luminance,
  meterSky,
  meterView,
  NIGHT_EXPOSURE,
  type Rgb,
  skyExposure,
  skyViewHorizon,
  skyViewReach,
  sunlightReaching,
} from '../core/atmosphere';
import { bodyExposure } from '../core/bodies';
import { EARTH_RADIUS_KM } from '../core/constants';
import { SUN_RADIUS_KM, sunHiddenByMoon } from '../core/eclipse';
import type { Vec3 } from '../core/kinematics';
import { groundOrigin } from '../core/landscape';
import { ATMOSPHERE_GLSL, atmosphereUniforms } from './atmosphereGlsl';
import { directionToWorld, OVERLAY_ORDER, TEME_FROM_WORLD } from './frame';
import { LANDSCAPE_GLSL, landscapeUniforms } from './landscapeGlsl';
import { SKY_CLOUDS_FRAGMENT } from './skyCloudsGlsl';
import { renderSkyView } from './skyView';
import { groundView } from './standing';

/**
 * How bright the Sun's face is drawn, before the air dims it. Far less than
 * it is, but far more than any sky: white while it is up, and yellow, then
 * amber, then orange only in the last degree or so, where the sky round it
 * has dimmed enough for it still to stand out.
 */
const SUN_BRIGHTNESS = 150;
/** The same for the glare around it, which goes sooner. */
const GLARE_BRIGHTNESS = 6;
/** The view goes over to a telescope's exposure as it narrows from the second of these to the first, degrees. */
const CLOSE_UP_FOV = [1.5, 12] as const;
/** The clouds are drawn after the Moon (-0.3, see `SunAndMoon`) and before the satellites. */
const CLOUDS_ORDER = -0.2;
/** The Moon's shadow can only be on the Earth with the two this close in the sky, radians. */
const ECLIPSE_SEPARATION = 0.03;

const vertexShader = /* glsl */ `
  varying vec3 vRay;

  void main() {
    // The line of sight through this corner of the screen: first as the
    // camera sees it, then turned to the world's axes.
    vec3 ray = vec3(position.x / projectionMatrix[0][0], position.y / projectionMatrix[1][1], -1.0);
    vRay = transpose(mat3(viewMatrix)) * ray;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  // Toward the Sun from the camera, and its radius in the sky, radians.
  uniform vec3 uSunFromEye;
  uniform float uSunRadius;
  // The color and strength of the glare around the Sun.
  uniform vec3 uSunGlare;
  // How much of the stars' light is left, for eyes used to this sky.
  uniform float uStarKeep;
  // The light of the sky above the camera, averaged: what lights ground in shade.
  uniform vec3 uSkyAmbient;

  varying vec3 vRay;

  ${ATMOSPHERE_GLSL}
  #ifdef COVER
    ${LANDSCAPE_GLSL}
  #endif

  const float SUN_BRIGHTNESS = ${SUN_BRIGHTNESS.toFixed(1)};

  // The glare around the Sun, by how far from its center, in its own radii:
  // as bright as the Sun against its edge, and falling off as the square of
  // the distance, as light spread by an eye or a lens does. It is made
  // there, not in the sky, so it lies over everything.
  float sunGlare(float x) {
    float away = max(x, 1.0);
    return 2.0 / (1.0 + away * away) * (1.0 - smoothstep(30.0, 70.0, x));
  }

  void main() {
    vec3 direction = normalize(vRay);
    float start;
    float end;
    bool ground;
    // The light of the air along this line of sight, as it is shown, and how
    // much of what is behind the air gets through.
    vec3 air = vec3(0.0);
    vec3 through = vec3(1.0);
    // How far this line of sight is below the horizon, in pixels.
    float r = SKY_BOTTOM + uSkyEyeHeight;
    float mu = dot(uSkyEye, direction) / r;
    float horizon = -sqrt(uSkyEyeHeight * (r + SKY_BOTTOM)) / r;
    float pastHorizon = (horizon - mu) / max(fwidth(mu), 1e-7);
    #ifndef COVER
      // Close to the ground the other pass draws the ground, and softens the
      // edge of it. Under that edge there has to be sky, so the sky is drawn
      // a little way past the horizon as it is on it.
      if (uSkyGround >= 1.0 && pastHorizon > 0.0) {
        if (pastHorizon > 2.0) discard;
        direction = normalize(direction + uSkyEye / r * (horizon - mu + 2e-5));
      }
    #endif
    bool inAir = skySpan(direction, start, end, ground);
    #ifdef COVER
      // Where this line of sight meets the ground, km east and north of the
      // camera, and how much ground and how much of the view a pixel takes
      // in there. Worked out for every pixel, as each is measured against
      // the pixels next to it.
      vec2 landAt = end * vec2(dot(direction, uLandEast), dot(direction, uLandNorth));
      float landFootprint = max(length(dFdx(landAt)), length(dFdy(landAt)));
    #endif
    // How much of this pixel is this pass's to draw.
    float share = 1.0;
    #ifndef COVER
      if (ground) {
        // Seen from above, the Earth draws the air over itself: see its
        // shader. All but its very edge, where the line of sight meets the
        // ground at a glancing angle and the air hides it anyway. Drawn here,
        // the edge is this pass's on both sides and so is seamless, where the
        // Earth's own outline is a polygon's.
        float slope = -(dot(uSkyEye, direction) + end) / SKY_BOTTOM;
        share = 1.0 - smoothstep(0.02, 0.06, slope);
      }
    #endif
    if (inAir && share > 0.0) {
      skyView(direction, ground, air, through);
    }

    float x = atan(length(cross(direction, uSunFromEye)), dot(direction, uSunFromEye)) / uSunRadius;
    vec3 glare = uSunGlare * sunGlare(x);

    vec3 color;
    float alpha;
    #ifdef COVER
      // The ground, over everything: nothing below the horizon shows.
      // The ground's edge is softened over the first pixel of it.
      float below = clamp(pastHorizon, 0.0, 1.0);
      if (below <= 0.0) discard;
      vec3 surface = vec3(0.0);
      if (ground) {
        surface = through * landLight(direction, end, landAt, landFootprint);
      }
      color = skyAdd(skyAdd(air, skyTone(surface)), glare);
      alpha = below * uSkyGround;
    #else
      if (ground) {
        color = skyAdd(air * share, glare);
        alpha = share;
      } else {
        // The Sun's face: darker toward its edge, and dimmed and reddened by
        // the air it is seen through, which is why it sets red.
        float edge = 0.75 * fwidth(x);
        float disc = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, x);
        float slant = sqrt(max(0.0, 1.0 - min(x * x, 1.0)));
        vec3 darkened = 1.0 - vec3(0.5, 0.6, 0.72) * (1.0 - slant);
        vec3 sun = (1.0 - exp(-SUN_BRIGHTNESS * through * darkened)) * disc;
        color = skyAdd(skyAdd(air, sun), glare);
        // What is behind the sky: stars, lost in the light of it by day.
        float keep = skyLuminance(through) * mix(1.0, uStarKeep, uSkyGround)
          * (1.0 - smoothstep(0.02, 0.2, skyLuminance(air)));
        alpha = max(1.0 - keep, disc);
      }
      if (alpha <= 0.0 && max(color.r, max(color.g, color.b)) <= 0.0) discard;
    #endif

    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
    #ifdef COVER
      // Blended the ordinary way, so the color is scaled by how much of it there is.
      gl_FragColor.rgb *= alpha;
    #endif
    gl_FragColor.rgb += (skyNoise(gl_FragCoord.xy + 31.7) - 0.5) / 255.0;
  }
`;

const tables = atmosphereTables();
const eye = new Vector3();
const sun: Vec3 = { x: 0, y: 0, z: 0 };
const sunKm: Vec3 = { x: 0, y: 0, z: 0 };
const moonKm: Vec3 = { x: 0, y: 0, z: 0 };
const toSun: Vec3 = { x: 0, y: 0, z: 0 };
const ambient: Rgb = [0, 0, 0];
const reaching: Rgb = [0, 0, 0];
const forward = new Vector3();
const upward = new Vector3();
const POLE = new Vector3(0, 1, 0);
/** Turns the world's axes to the TEME frame's: the scene's turn, undone. */
const TEME_AXES_FROM_WORLD = new Matrix4().makeRotationX(Math.PI / 2);
const earthFromWorld = new Matrix4();
const fixed = new Vector3();
const origin = { x: 0, y: 0 };
const looking: Vec3 = { x: 0, y: 0, z: 0 };
const moonShadow = (point: Vec3) => 1 - sunHiddenByMoon(point, sunKm, moonKm);

/**
 * The air: the sky seen from the ground, the haze and the blue rim seen from
 * space, and the Sun, whose color is the air's doing. See `core/atmosphere.ts`
 * for the model.
 *
 * The stepping through the air is done once a frame for a small map of the
 * whole sky (`skyView.ts`), which everything here and the Earth and Moon read
 * from.
 *
 * It is drawn over the whole screen, twice. The first pass goes behind the
 * satellites, planets and Moon, over the stars: it adds the light of the air
 * along each line of sight and takes away what the air blocks of what lies
 * behind. Over the Earth seen from space the Earth's own shader does the
 * same, where the two can be put together before the picture is encoded for
 * the screen. The second pass, only near the ground, draws the ground over
 * everything. The Earth itself cannot be trusted to hide what is
 * below the horizon from that close: it is drawn as a polygon, whose flat
 * faces sag up to 2 km inside the true sphere, more than the eye's height.
 */
export function Atmosphere() {
  const { sky, clouds, cover, uniforms } = useMemo(() => {
    const uniforms = {
      ...atmosphereUniforms(),
      ...landscapeUniforms(),
      uSunFromEye: { value: new Vector3(1, 0, 0) },
      uSunRadius: { value: 0.00465 },
      uSunGlare: { value: new Vector3() },
      uStarKeep: { value: 1 },
      uSkyAmbient: { value: new Vector3() },
    };
    // One triangle that covers the screen.
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
    const pass = (
      defines: Record<string, string>,
      renderOrder: number,
      fragment = fragmentShader,
    ) => {
      const mesh = new Mesh(
        geometry,
        new ShaderMaterial({
          uniforms,
          defines,
          vertexShader,
          fragmentShader: fragment,
          transparent: true,
          depthWrite: false,
          depthTest: false,
          // The color is what to add; the alpha, how much to hide of what is behind.
          blending: CustomBlending,
          blendSrc: OneFactor,
          blendDst: OneMinusSrcAlphaFactor,
        }),
      );
      mesh.renderOrder = renderOrder;
      mesh.frustumCulled = false;
      return mesh;
    };
    return {
      // After the star map and the Earth, before the satellites and the Moon.
      sky: pass({}, -0.5),
      // The clouds from under them: over the stars, the Sun, the Moon and the
      // planets, which they hide, and under the satellites, which are what
      // the view is for.
      clouds: pass({}, CLOUDS_ORDER, SKY_CLOUDS_FRAGMENT),
      // After everything, the selection ring included.
      cover: pass({ COVER: '' }, OVERLAY_ORDER.marker + 1),
      uniforms,
    };
  }, []);

  useEffect(
    () => () => {
      sky.geometry.dispose();
      sky.material.dispose();
      clouds.material.dispose();
      cover.material.dispose();
    },
    [sky, clouds, cover],
  );

  useFrame(({ camera, gl }) => {
    const simMs = currentSimTime();
    const height = Math.max(camera.position.length() - 1, 1e-6);
    const ground = groundView(height);
    cover.visible = ground > 0;
    clouds.visible = ground > 0 && uniforms.uLandClouded.value > 0;

    sunDirection(simMs, sun);
    sunPosition(simMs, sunKm);
    moonPosition(simMs, moonKm);
    eye.copy(camera.position).applyMatrix4(TEME_FROM_WORLD);

    uniforms.uSkyEye.value
      .copy(camera.position)
      .normalize()
      .multiplyScalar((1 + height) * EARTH_RADIUS_KM);
    uniforms.uSkyEyeHeight.value = height * EARTH_RADIUS_KM;
    uniforms.uSkyGround.value = ground;
    directionToWorld(sun, uniforms.uSkySun.value);
    directionToWorld(sunKm, uniforms.uSkySunPosition.value).divideScalar(EARTH_RADIUS_KM);
    directionToWorld(moonKm, uniforms.uSkyMoonPosition.value).divideScalar(EARTH_RADIUS_KM);

    const moonDistance = Math.hypot(moonKm.x, moonKm.y, moonKm.z);
    const together = (sun.x * moonKm.x + sun.y * moonKm.y + sun.z * moonKm.z) / moonDistance;
    const eclipse = together > Math.cos(ECLIPSE_SEPARATION);
    uniforms.uSkyEclipse.value = eclipse ? 1 : 0;

    // The map of the sky is laid out round the camera's own up, with its
    // compass starting toward the Sun, or anywhere if the Sun is overhead.
    const r = ATMOSPHERE.bottomKm + height * EARTH_RADIUS_KM;
    uniforms.uSkyViewHorizon.value = skyViewHorizon(r);
    uniforms.uSkyViewReach.value = skyViewReach(r);
    upward.copy(camera.position).normalize();
    const ahead = uniforms.uSkyViewAhead.value;
    ahead.copy(uniforms.uSkySun.value).addScaledVector(upward, -upward.dot(uniforms.uSkySun.value));
    if (ahead.lengthSq() < 1e-8) {
      ahead.set(Math.abs(upward.x) < 0.9 ? 1 : 0, 0, Math.abs(upward.x) < 0.9 ? 0 : 1);
      ahead.addScaledVector(upward, -upward.dot(ahead));
    }
    ahead.normalize();
    uniforms.uSkyViewSide.value.crossVectors(upward, ahead);

    // Out in space the exposure is fixed. On the ground it follows the sky,
    // and the part of the sky the camera faces.
    let exposure: number = EXPOSURE.space;
    uniforms.uStarKeep.value = 1;
    if (ground > 0) {
      const shadow = eclipse ? moonShadow : undefined;
      meterSky(tables, eye, sun, ambient, shadow);
      const sky = luminance(ambient);
      camera.getWorldDirection(forward).transformDirection(TEME_FROM_WORLD);
      looking.x = forward.x;
      looking.y = forward.y;
      looking.z = forward.z;
      const adapted = skyExposure(sky, meterView(tables, eye, sun, looking, shadow));
      exposure = EXPOSURE.space ** (1 - ground) * adapted ** ground;
      uniforms.uSkyAmbient.value.set(ambient[0], ambient[1], ambient[2]);
      // Stars are drawn as a dark-adapted eye sees them. Short of that, less.
      uniforms.uStarKeep.value = (skyExposure(sky) / NIGHT_EXPOSURE) ** 0.4;
    }
    // Closed in on the Moon or a planet, the picture is exposed for that, as
    // through a telescope, if it is brighter than the sky: by night the sky
    // around it goes black. Not more than for the sky, by day, when the sky
    // is what the eye is used to. It comes in as the view narrows.
    const { watching } = useApp.getState();
    if (watching !== null && ground > 0 && camera instanceof PerspectiveCamera) {
      const closeUp = 1 - MathUtils.smoothstep(camera.fov, CLOSE_UP_FOV[0], CLOSE_UP_FOV[1]);
      const fitted = Math.min(exposure, bodyExposure(watching));
      exposure = exposure ** (1 - closeUp) * fitted ** closeUp;
    }
    uniforms.uSkyExposure.value = exposure;
    renderSkyView(gl);

    // The ground, for when it is in view: which way the Earth is turned
    // under the camera, which ways are east and north there, and where in
    // the ground's pattern that is.
    if (ground > 0) {
      earthFromWorld.makeRotationZ(-gmst(simMs)).multiply(TEME_AXES_FROM_WORLD);
      uniforms.uLandFromWorld.value.setFromMatrix4(earthFromWorld);
      const east = uniforms.uLandEast.value.crossVectors(POLE, upward);
      // At a pole every way is south, or north; any will do.
      if (east.lengthSq() < 1e-12) east.set(1, 0, 0);
      east.normalize();
      uniforms.uLandNorth.value.crossVectors(upward, east);
      fixed.copy(upward).applyMatrix4(earthFromWorld);
      groundOrigin(
        MathUtils.radToDeg(Math.asin(MathUtils.clamp(fixed.z, -1, 1))),
        MathUtils.radToDeg(Math.atan2(fixed.y, fixed.x)),
        origin,
      );
      uniforms.uLandOrigin.value.set(origin.x, origin.y);
      // Wrapped, to keep the number small enough to stay exact.
      uniforms.uLandTime.value = (performance.now() / 1000) % 3600;
    }

    // The Sun as it looks from the camera: where, how big, and how much of
    // its light arrives past the Earth, the air and the Moon.
    const distance = Math.hypot(sunKm.x - eye.x, sunKm.y - eye.y, sunKm.z - eye.z);
    toSun.x = (sunKm.x - eye.x) / distance;
    toSun.y = (sunKm.y - eye.y) / distance;
    toSun.z = (sunKm.z - eye.z) / distance;
    const radius = Math.asin(SUN_RADIUS_KM / distance);
    directionToWorld(toSun, uniforms.uSunFromEye.value);
    uniforms.uSunRadius.value = radius;
    sunlightReaching(tables, eye, toSun, radius, reaching);
    // Even a thin crescent of Sun is dazzling: the glare only goes in the
    // last few percent before totality.
    const shown = MathUtils.smoothstep(1 - sunHiddenByMoon(eye, sunKm, moonKm), 0, 0.08);
    uniforms.uSunGlare.value.set(
      shown * (1 - Math.exp(-GLARE_BRIGHTNESS * reaching[0])),
      shown * (1 - Math.exp(-GLARE_BRIGHTNESS * reaching[1])),
      shown * (1 - Math.exp(-GLARE_BRIGHTNESS * reaching[2])),
    );
  });

  return (
    <>
      <primitive object={sky} />
      <primitive object={clouds} />
      <primitive object={cover} />
    </>
  );
}
