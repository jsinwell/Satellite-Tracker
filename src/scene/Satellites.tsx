import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  Color,
  CustomBlending,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  LineSegments,
  MathUtils,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PerspectiveCamera,
  Points,
  ShaderMaterial,
} from 'three';
import { satelliteColor } from '../app/palette';
import { type ColorBy, currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { sunDirection } from '../core/astro';
import { faintestSeen } from '../core/brightness';
import type { ObjectType } from '../core/catalog';
import { wallNow } from '../core/clock';
import { type ConstellationId, soleEnabled } from '../core/constellation';
import { trailSeconds, type Vec3 } from '../core/kinematics';
import { STATE_STRIDE } from '../core/propagator';
import { TEME_FROM_WORLD } from './frame';
import { SHADOW_BRIGHTNESS } from './orbitGlsl';
import {
  createSatelliteUniforms,
  MIN_POINT_SIZE,
  SATELLITE_POINT_FRAGMENT,
  SATELLITE_POINT_VERTEX,
  SATELLITE_TRAIL_FRAGMENT,
  SATELLITE_TRAIL_VERTEX,
} from './satelliteGlsl';
import { groundView, SKY_FOV } from './standing';

/** Relative point size by object type; debris is drawn smaller so payloads read first. */
const TYPE_SIZES: Record<ObjectType, number> = {
  payload: 1,
  'rocket-body': 1,
  debris: 0.7,
  unknown: 0.8,
};

/**
 * From space every satellite trails where it was this many simulated seconds
 * ago, at any speed: about 150 km in low orbit, a tail a few pixels long,
 * which is enough to see which way each is going and the swarm as so many
 * streams. Much longer and the tails cross into a net over the globe.
 */
const SPACE_TRAIL_SECONDS = 20;
/**
 * Looking up, every satellite that can be seen trails where it was this many
 * simulated seconds ago, even at real speed or paused: the tail is what
 * tells a satellite from a star at a glance. Seven seconds is about five
 * degrees for one passing overhead, three fingers at arm's length, and one
 * finger for one low down and far off.
 */
const GROUND_TRAIL_SECONDS = 7;

const scratch: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * How the satellites are laid over what is behind them: the color the
 * shader gives is added, and its alpha says how much of what is behind to
 * hide. With the two the same that is ordinary blending; with less hidden
 * than added, lights on top of each other add up.
 */
const LIGHT_BLENDING = {
  blending: CustomBlending,
  blendSrc: OneFactor,
  blendDst: OneMinusSrcAlphaFactor,
} as const;

function buildSatellites(world: World) {
  const { simulation, satellites } = world;
  const count = satellites.length;

  // The simulation's state buffer *is* the vertex data: position and velocity
  // interleaved, uploaded as-is whenever a new state arrives. It is instanced,
  // one entry per satellite, so the points (one vertex each) and the trails
  // (two vertices each) read the same GPU buffer.
  const stateBuffer = new InstancedInterleavedBuffer(simulation.state, STATE_STRIDE);
  stateBuffer.setUsage(DynamicDrawUsage);

  const sizes = Float32Array.from(satellites, (satellite) => TYPE_SIZES[satellite.objectType]);
  // Only working satellites have solar panels to glint; the seed tells each
  // one's panels apart. Debris and rocket bodies get none.
  const seeds = Float32Array.from(satellites, (satellite, i) =>
    satellite.objectType === 'payload' ? Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1 : -1,
  );

  // Filled in by the component, since both change while the app runs.
  const colors = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const visibility = new InstancedBufferAttribute(new Uint8Array(count), 1);
  visibility.setUsage(DynamicDrawUsage);

  const perSatellite = {
    aPosition: new InterleavedBufferAttribute(stateBuffer, 3, 0),
    aVelocity: new InterleavedBufferAttribute(stateBuffer, 3, 3),
    aColor: colors,
    aVisible: visibility,
    aMagnitude: new InstancedBufferAttribute(world.standardMagnitudes, 1),
  };
  const instanced = (vertices: number[]) => {
    const geometry = new InstancedBufferGeometry();
    geometry.instanceCount = count;
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    for (const [name, attribute] of Object.entries(perSatellite)) {
      geometry.setAttribute(name, attribute);
    }
    return geometry;
  };

  // Shared, so one assignment per frame updates both materials.
  const uniforms = createSatelliteUniforms();

  const pointGeometry = instanced([0, 0, 0]);
  pointGeometry.setAttribute('aSize', new InstancedBufferAttribute(sizes, 1));
  pointGeometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
  const points = new Points(
    pointGeometry,
    new ShaderMaterial({
      uniforms,
      vertexShader: SATELLITE_POINT_VERTEX,
      fragmentShader: SATELLITE_POINT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      ...LIGHT_BLENDING,
    }),
  );

  const trails = new LineSegments(
    instanced([0, 0, 0, 1, 0, 0]),
    new ShaderMaterial({
      uniforms,
      vertexShader: SATELLITE_TRAIL_VERTEX,
      fragmentShader: SATELLITE_TRAIL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      ...LIGHT_BLENDING,
    }),
  );

  // Positions change on the GPU every frame, so CPU bounding volumes would be wrong.
  points.frustumCulled = false;
  trails.frustumCulled = false;

  return { points, trails, uniforms, stateBuffer, colors, visibility };
}

/** The color of each satellite under the current color scheme, as packed RGB. */
function paint(
  world: World,
  colorBy: ColorBy,
  alone: ConstellationId | null,
  out: Float32Array,
): void {
  const color = new Color();
  for (let i = 0; i < world.satellites.length; i++) {
    color.set(satelliteColor(world, i, colorBy, alone)).toArray(out, i * 3);
  }
}

/**
 * Every satellite in one draw call, plus one more for their trails when time
 * is running fast. Also drives the simulation: each frame it lets the
 * simulation request a fresh state if needed, uploads the state when one has
 * arrived, and tells the shaders how far to extrapolate from it.
 */
export function Satellites({ world }: { world: World }) {
  const { points, trails, uniforms, stateBuffer, colors, visibility } = useMemo(
    () => buildSatellites(world),
    [world],
  );
  const visible = useApp((state) => state.visible);
  const colorBy = useApp((state) => state.colorBy);
  const alone = useApp((state) => soleEnabled(state.filters.constellations));

  useEffect(() => {
    paint(world, colorBy, alone, colors.array as Float32Array);
    colors.needsUpdate = true;
  }, [world, colorBy, alone, colors]);

  useEffect(() => {
    (visibility.array as Uint8Array).set(visible);
    visibility.needsUpdate = true;
  }, [visibility, visible]);

  useEffect(
    () => () => {
      for (const object of [points, trails]) {
        object.geometry.dispose();
        object.material.dispose();
      }
    },
    [points, trails],
  );

  const uploadedVersion = useRef(-1);
  useFrame(({ gl, camera, size }) => {
    const { simulation } = world;
    const { clock, skyShows, selected } = useApp.getState();
    simulation.update(clock, wallNow());
    if (uploadedVersion.current !== simulation.version) {
      uploadedVersion.current = simulation.version;
      stateBuffer.needsUpdate = true;
    }

    const simMs = currentSimTime();
    uniforms.uDt.value = simulation.dtSeconds(simMs);
    const sun = sunDirection(simMs, scratch);
    uniforms.uSunDirection.value.set(sun.x, sun.y, sun.z);
    uniforms.uPixelRatio.value = gl.getPixelRatio();
    // Brighter and bigger from the ground, eased in on the way down.
    const ground = groundView(camera.position.length() - 1);
    uniforms.uShadowBrightness.value = MathUtils.lerp(
      SHADOW_BRIGHTNESS.space,
      SHADOW_BRIGHTNESS.ground,
      ground,
    );
    uniforms.uMinSize.value = MathUtils.lerp(MIN_POINT_SIZE.space, MIN_POINT_SIZE.ground, ground);

    uniforms.uGround.value = ground;
    // Lighting from the ground: where the camera is, how dark its sky is.
    const eyeTeme = uniforms.uEye.value.copy(camera.position).applyMatrix4(TEME_FROM_WORLD);
    const sunHeight =
      (sun.x * eyeTeme.x + sun.y * eyeTeme.y + sun.z * eyeTeme.z) / Math.max(1, eyeTeme.length());
    uniforms.uSkyDark.value = 1 - MathUtils.smoothstep(sunHeight, -0.17, -0.03);
    // Looking up, the satellites are the lights they are, unless all of
    // them are asked for.
    uniforms.uLight.value = ground > 0.5 && skyShows !== 'all' ? 1 : 0;
    // With all of them shown, the ones the eye could see are the ones that
    // stand out.
    uniforms.uFaintest.value = faintestSeen(
      skyShows === 'all' ? 'eye' : skyShows,
      MathUtils.radToDeg(Math.asin(MathUtils.clamp(sunHeight, -1, 1))),
    );
    uniforms.uSelected.value = selected ?? -1;
    const fov = camera instanceof PerspectiveCamera ? camera.fov : SKY_FOV;
    uniforms.uZoom.value = MathUtils.clamp(
      Math.tan(MathUtils.degToRad(SKY_FOV) / 2) / Math.tan(MathUtils.degToRad(fov) / 2),
      1,
      4,
    );
    uniforms.uAspect.value = size.width / Math.max(1, size.height);
    // Always a trail, behind the way time is running: short from the
    // ground, longer from space, and longer yet with time running fast.
    const steadyTrail =
      (clock.rate < 0 ? -1 : 1) * (ground > 0.5 ? GROUND_TRAIL_SECONDS : SPACE_TRAIL_SECONDS);
    const fastTrail = trailSeconds(clock.rate);
    uniforms.uTrailSeconds.value =
      Math.abs(fastTrail) > Math.abs(steadyTrail) ? fastTrail : steadyTrail;
  });

  return (
    <>
      <primitive object={trails} />
      <primitive object={points} />
    </>
  );
}
