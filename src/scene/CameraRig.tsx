import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { type Camera, MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { sunDirection } from '../core/astro';
import { EARTH_RADIUS_KM } from '../core/constants';
import { extrapolatePosition, extrapolateVelocity, hasState, type Vec3 } from '../core/kinematics';
import { directionToWorld } from './frame';
import { rideElevation } from './ride';

// Distances from the Earth's center, in Earth radii.
const MIN_DISTANCE = 1.12;
const MAX_DISTANCE = 40;
const INITIAL_DISTANCE = 3.6;
/** The most of the screen's width the globe may fill at the start. */
const GLOBE_WIDTH_FRACTION = 0.8;
/** The closest the camera will sit above a satellite it has flown to. */
const FOCUS_STANDOFF = 2.2;
const FLIGHT_SECONDS = 1.2;

// Riding along: distances from the satellite, in Earth radii.
const RIDE_MIN_DISTANCE = 0.06;
const RIDE_MAX_DISTANCE = 12;
/** How far below the Earth's limb the satellite sits in the view a ride starts with. */
const RIDE_LIMB_MARGIN = MathUtils.degToRad(6);
/** How long the camera takes to join a satellite, or to come back from one. */
const BLEND_SECONDS = 1.4;

const scratch: Vec3 = { x: 0, y: 0, z: 0 };
const direction = new Vector3();
const goal = new Vector3();
const turn = new Quaternion();
const step = new Quaternion();
const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);
const ORIGIN = new Vector3();

/**
 * How far back to start so the whole globe is in view. On a wide screen the
 * height is the limit and the usual distance does it; on a tall, narrow one
 * (a phone held upright) the width is, and the camera has to pull back.
 */
function initialDistance(camera: Camera): number {
  if (!(camera instanceof PerspectiveCamera)) return INITIAL_DISTANCE;
  const halfHeight = MathUtils.degToRad(camera.fov / 2);
  const halfWidth = Math.atan(Math.tan(halfHeight) * camera.aspect);
  // The Earth, a unit sphere, should span at most this much of the width.
  const toFitWidth = 1 / Math.sin(halfWidth * GLOBE_WIDTH_FRACTION);
  return MathUtils.clamp(Math.max(INITIAL_DISTANCE, toFitWidth), MIN_DISTANCE, MAX_DISTANCE);
}

/** Starts over the daylit hemisphere, off-axis enough to show the terminator. */
function placeInitially(camera: Camera): void {
  directionToWorld(sunDirection(currentSimTime(), scratch), direction);
  direction.applyAxisAngle(UP, 0.6);
  direction.y += 0.3;
  camera.position.copy(direction.normalize().multiplyScalar(initialDistance(camera)));
}

/** A camera flight in progress; `progress` runs from 0 to 1 over `FLIGHT_SECONDS`. */
interface Flight {
  progress: number;
}

const easeInOut = (x: number) => x * x * (3 - 2 * x);

/**
 * Moves the camera one frame along a flight to look straight down on the
 * selected satellite. Returns whether the flight is still under way.
 *
 * The target moves — quickly, at high time rates — so the flight cannot follow
 * a path fixed at the start. Instead each frame covers a share of whatever
 * distance *remains*, with the shares chosen so they add up to an eased curve
 * and the last one is the whole remainder. The flight therefore always ends
 * exactly on the satellite, after exactly `FLIGHT_SECONDS`, however it moved.
 */
function advanceFlight(
  camera: Camera,
  world: World,
  flight: Flight,
  deltaSeconds: number,
): boolean {
  const { selected } = useApp.getState();
  const { simulation } = world;
  if (selected === null) return false;
  // A satellite linked to in the URL is selected before the first state lands.
  if (Number.isNaN(simulation.stateTimeMs)) return true;
  if (!hasState(simulation.state, selected)) return false;

  const dt = simulation.dtSeconds(currentSimTime());
  const position = extrapolatePosition(simulation.state, selected, dt, scratch);
  const radius = Math.hypot(position.x, position.y, position.z) / EARTH_RADIUS_KM;
  directionToWorld(position, goal).normalize();

  const distance = camera.position.length();
  direction.copy(camera.position).divideScalar(distance);
  // Pull back if the satellite is too close to see in context; never push in.
  const goalDistance = Math.min(Math.max(distance, radius + FOCUS_STANDOFF), MAX_DISTANCE);

  const covered = easeInOut(flight.progress);
  flight.progress = Math.min(1, flight.progress + deltaSeconds / FLIGHT_SECONDS);
  const share = flight.progress === 1 ? 1 : (easeInOut(flight.progress) - covered) / (1 - covered);

  turn.setFromUnitVectors(direction, goal);
  direction.applyQuaternion(step.identity().slerp(turn, share));
  camera.position.copy(direction).multiplyScalar(distance + (goalDistance - distance) * share);

  return flight.progress < 1;
}

/** Where the camera was when it set off for somewhere else, and how far along it is. */
interface Blend {
  position: Vector3;
  quaternion: Quaternion;
  /** From 0 to 1 over `BLEND_SECONDS`. */
  progress: number;
}

const leaving = (camera: Camera): Blend => ({
  position: camera.position.clone(),
  quaternion: camera.quaternion.clone(),
  progress: 0,
});

/**
 * Puts the camera at `position`, facing `quaternion`, or, while a blend is
 * running, part of the way there from where the blend began. Returns the
 * blend if it still has further to go.
 *
 * Unlike a flight, this owns the whole pose, so it can simply mix the starting
 * pose with the destination, which is free to keep moving. The position swings
 * around the Earth's center while its distance changes, so the path stays
 * outside the Earth even when the destination is on the far side.
 */
function approach(
  camera: Camera,
  blend: Blend | null,
  position: Vector3,
  quaternion: Quaternion,
  deltaSeconds: number,
): Blend | null {
  if (blend) blend.progress = Math.min(1, blend.progress + deltaSeconds / BLEND_SECONDS);
  if (!blend || blend.progress === 1) {
    camera.position.copy(position);
    camera.quaternion.copy(quaternion);
    return null;
  }
  const share = easeInOut(blend.progress);
  const from = blend.position.length();
  const to = position.length();
  direction.copy(blend.position).divideScalar(from);
  turn.setFromUnitVectors(direction, goal.copy(position).divideScalar(to));
  direction.applyQuaternion(step.identity().slerp(turn, share));
  camera.position.copy(direction).multiplyScalar(from + (to - from) * share);
  camera.quaternion.slerpQuaternions(blend.quaternion, quaternion, share);
  return blend;
}

/** The camera is in one of three states. */
type Mode =
  /** Orbiting the Earth's center under the user's control. */
  | { kind: 'globe' }
  /** Traveling with satellite `index`; `blend` runs while it is catching up with it. */
  | { kind: 'riding'; index: number; blend: Blend | null }
  /** On the way back from a ride to a pose the globe controls can take over from. */
  | { kind: 'returning'; blend: Blend; position: Vector3; quaternion: Quaternion };

const satellite = new Vector3();
const up = new Vector3();
const back = new Vector3();
const right = new Vector3();
const basis = new Matrix4();

/**
 * Finds satellite `index` (written to `satellite`: Earth radii, world axes)
 * and the axes that travel with it (written to `basis`): x to its right, y
 * away from the Earth, z back along the way it came. Returns its distance
 * from the Earth's center.
 */
function locate(world: World, index: number): number {
  const { simulation } = world;
  const dt = simulation.dtSeconds(currentSimTime());
  directionToWorld(extrapolatePosition(simulation.state, index, dt, scratch), satellite);
  satellite.divideScalar(EARTH_RADIUS_KM);
  directionToWorld(extrapolateVelocity(simulation.state, index, dt, scratch), back).negate();

  const radius = satellite.length();
  up.copy(satellite).divideScalar(radius);
  // Level off the direction of travel: a climbing satellite still has the
  // horizon straight ahead of it.
  back.addScaledVector(up, -back.dot(up));
  // Heading straight up or down, nothing is "behind". Any level direction will do.
  if (back.lengthSq() < 1e-12) back.crossVectors(up, Math.abs(up.y) < 0.9 ? UP : RIGHT);
  back.normalize();
  right.crossVectors(up, back);
  basis.makeBasis(right, up, back);
  return radius;
}

/**
 * Sets the ride camera behind and above a satellite `radius` from the Earth's
 * center, looking forward over it at the horizon. It keeps a distance in
 * proportion to the satellite's height, so the ground below looks about as
 * far away as it is.
 */
function placeBehind(rideCamera: Camera, radius: number): void {
  const distance = MathUtils.clamp((radius - 1) * 1.5, 0.15, 0.6);
  const elevation = rideElevation(radius, distance, RIDE_LIMB_MARGIN);
  rideCamera.position.set(0, distance * Math.sin(elevation), distance * Math.cos(elevation));
}

const ridePosition = new Vector3();
const rideTurn = new Quaternion();
const lookAtOrigin = new Matrix4();

/**
 * Orbit controls around the Earth's center, a fly-to when a satellite is
 * selected, and a ride along with one. The camera lives in the inertial frame,
 * so left alone it watches the Earth rotate rather than rotating with it.
 *
 * A ride has controls of its own. They do not move the real camera but a
 * stand-in that orbits the origin of the satellite's own axes (see `locate`),
 * which gives where the camera sits relative to the satellite: drag to look
 * around it, zoom to close in. Each frame that is carried over to wherever the
 * satellite has got to. Only one set of controls listens at a time.
 */
export function CameraRig({ world }: { world: World }) {
  const camera = useThree((state) => state.camera);
  const element = useThree((state) => state.gl.domElement);
  const controlsRef = useRef<{ globe: OrbitControls; ride: OrbitControls } | null>(null);
  const flight = useRef<Flight | null>(null);
  const mode = useRef<Mode>({ kind: 'globe' });
  const focusRequests = useApp((state) => state.focusRequests);

  useEffect(() => {
    placeInitially(camera);
    const globe = new OrbitControls(camera, element);
    globe.enablePan = false;
    globe.enableDamping = true;
    globe.dampingFactor = 0.08;
    globe.zoomSpeed = 0.8;
    globe.minDistance = MIN_DISTANCE;
    globe.maxDistance = MAX_DISTANCE;
    // Taking hold of the camera cancels any flight in progress.
    const cancelFlight = () => {
      flight.current = null;
    };
    globe.addEventListener('start', cancelFlight);

    const ride = new OrbitControls(new PerspectiveCamera(), element);
    ride.enabled = false;
    ride.enablePan = false;
    ride.enableDamping = true;
    ride.dampingFactor = 0.08;
    ride.zoomSpeed = 0.8;
    ride.minDistance = RIDE_MIN_DISTANCE;
    ride.maxDistance = RIDE_MAX_DISTANCE;
    // Never from underneath: that way lies the ground.
    ride.maxPolarAngle = Math.PI / 2;

    mode.current = { kind: 'globe' };
    controlsRef.current = { globe, ride };
    return () => {
      globe.removeEventListener('start', cancelFlight);
      globe.dispose();
      ride.dispose();
      controlsRef.current = null;
    };
  }, [camera, element]);

  useEffect(() => {
    // During a ride the camera is on the satellite already.
    if (focusRequests > 0 && !useApp.getState().riding) flight.current = { progress: 0 };
  }, [focusRequests]);

  useFrame((_, deltaSeconds) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const { globe, ride } = controls;
    const { simulation } = world;
    const { riding, selected, setRiding } = useApp.getState();

    // Which satellite to be riding with this frame, if any.
    let wanted = riding ? selected : null;
    if (wanted !== null && Number.isNaN(simulation.stateTimeMs)) {
      // A ride linked to in the URL is asked for before the first state lands.
      wanted = null;
    } else if (wanted !== null && !hasState(simulation.state, wanted)) {
      // Its elements cannot be propagated to this time: there is nowhere to be.
      setRiding(false);
      wanted = null;
    }

    const current = mode.current;
    if (wanted !== null && (current.kind !== 'riding' || current.index !== wanted)) {
      // Setting off, or changing to another satellite mid-ride. Either way the
      // view starts afresh: one set up around a satellite in low orbit would
      // not even have the Earth in it from a high one.
      placeBehind(ride.object, locate(world, wanted));
      mode.current = { kind: 'riding', index: wanted, blend: leaving(camera) };
      flight.current = null;
      globe.enabled = false;
      ride.enabled = true;
    } else if (wanted === null && current.kind === 'riding') {
      // Getting off: pull straight back until the satellite can be seen in
      // context again, turning to face the Earth as the globe controls will.
      const distance = camera.position.length();
      const radius = hasState(simulation.state, current.index) ? locate(world, current.index) : 1;
      const position = camera.position
        .clone()
        .multiplyScalar(
          MathUtils.clamp(Math.max(distance, radius + FOCUS_STANDOFF), MIN_DISTANCE, MAX_DISTANCE) /
            distance,
        );
      const quaternion = new Quaternion().setFromRotationMatrix(
        lookAtOrigin.lookAt(position, ORIGIN, UP),
      );
      mode.current = { kind: 'returning', blend: leaving(camera), position, quaternion };
      ride.enabled = false;
    }

    const now = mode.current;
    if (now.kind === 'riding') {
      ride.update();
      locate(world, now.index);
      ridePosition.copy(ride.object.position).applyMatrix4(basis).add(satellite);
      rideTurn.setFromRotationMatrix(basis).multiply(ride.object.quaternion);
      now.blend = approach(camera, now.blend, ridePosition, rideTurn, deltaSeconds);
      return;
    }
    if (now.kind === 'returning') {
      if (approach(camera, now.blend, now.position, now.quaternion, deltaSeconds)) return;
      mode.current = { kind: 'globe' };
      globe.enabled = true;
    }

    if (flight.current && !advanceFlight(camera, world, flight.current, deltaSeconds)) {
      flight.current = null;
    }
    // Rotate more gently when close, so a drag moves the ground under the
    // pointer by about the same amount at any zoom.
    const altitude = camera.position.length() - 1;
    globe.rotateSpeed = MathUtils.clamp(altitude * 0.4, 0.05, 1);
    globe.update();
  });

  return null;
}
