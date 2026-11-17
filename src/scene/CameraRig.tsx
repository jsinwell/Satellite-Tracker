import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { type Camera, MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { sunDirection } from '../core/astro';
import { EARTH_RADIUS_KM } from '../core/constants';
import { extrapolatePosition, extrapolateVelocity, hasState, type Vec3 } from '../core/kinematics';
import { createObserverFrame, type Observer, observerFrame } from '../core/observer';
import { CAMERA_FOV, directionToWorld } from './frame';
import { rideElevation } from './ride';
import { createStance, SKY_FOV, stand, zoomFov } from './standing';

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

// Looking up from the ground.
/** How far the sky controls' stand-in sits from the eye. Anything small does. */
const SKY_PIVOT = 1e-3;
/**
 * The view starts this high, toward the equator: low enough to keep the
 * horizon and its compass points in sight above the time bar.
 */
const SKY_START_ELEVATION = MathUtils.degToRad(25);
/** How far below the horizon the view may tip, to keep the ground in sight. */
const SKY_BELOW_HORIZON = MathUtils.degToRad(5);

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

/**
 * A camera flight in progress, to look straight down on the selected
 * satellite or on the viewer's place. `progress` runs from 0 to 1 over
 * `FLIGHT_SECONDS`.
 */
interface Flight {
  target: 'selected' | 'observer';
  progress: number;
}

const easeInOut = (x: number) => x * x * (3 - 2 * x);
const observerScratch = createObserverFrame();

/**
 * Points `goal` at where a flight is headed and returns how far from the
 * Earth's center that is, in Earth radii: null if there is nothing to fly to
 * any more, NaN if it is not known yet.
 */
function aim(world: World, target: Flight['target']): number | null {
  const { selected, observer } = useApp.getState();
  if (target === 'observer') {
    if (!observer) return null;
    const { position } = observerFrame(observer, currentSimTime(), observerScratch);
    directionToWorld(position, goal).normalize();
    return 1;
  }

  const { simulation } = world;
  if (selected === null) return null;
  // A satellite linked to in the URL is selected before the first state lands.
  if (Number.isNaN(simulation.stateTimeMs)) return Number.NaN;
  if (!hasState(simulation.state, selected)) return null;
  const dt = simulation.dtSeconds(currentSimTime());
  const position = extrapolatePosition(simulation.state, selected, dt, scratch);
  directionToWorld(position, goal).normalize();
  return Math.hypot(position.x, position.y, position.z) / EARTH_RADIUS_KM;
}

/**
 * Moves the camera one frame along a flight. Returns whether the flight is
 * still under way.
 *
 * The target moves — quickly, at high time rates — so the flight cannot follow
 * a path fixed at the start. Instead each frame covers a share of whatever
 * distance *remains*, with the shares chosen so they add up to an eased curve
 * and the last one is the whole remainder. The flight therefore always ends
 * exactly on target, after exactly `FLIGHT_SECONDS`, however it moved.
 */
function advanceFlight(
  camera: Camera,
  world: World,
  flight: Flight,
  deltaSeconds: number,
): boolean {
  const radius = aim(world, flight.target);
  if (radius === null) return false;
  if (Number.isNaN(radius)) return true;

  const distance = camera.position.length();
  direction.copy(camera.position).divideScalar(distance);
  // Pull back if the target is too close to see in context; never push in.
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
  fov: number;
  /** From 0 to 1 over `BLEND_SECONDS`. */
  progress: number;
}

const leaving = (camera: PerspectiveCamera): Blend => ({
  position: camera.position.clone(),
  quaternion: camera.quaternion.clone(),
  fov: camera.fov,
  progress: 0,
});

function setFov(camera: PerspectiveCamera, fov: number): void {
  if (Math.abs(camera.fov - fov) < 1e-3) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

/**
 * Puts the camera at `position`, facing `quaternion`, with a field of view of
 * `fov`, or, while a blend is running, part of the way there from where the
 * blend began. Returns the blend if it still has further to go.
 *
 * Unlike a flight, this owns the whole pose, so it can simply mix the starting
 * pose with the destination, which is free to keep moving. The position swings
 * around the Earth's center while its distance changes, so the path stays
 * outside the Earth even when the destination is on the far side.
 */
function approach(
  camera: PerspectiveCamera,
  blend: Blend | null,
  position: Vector3,
  quaternion: Quaternion,
  fov: number,
  deltaSeconds: number,
): Blend | null {
  if (blend) blend.progress = Math.min(1, blend.progress + deltaSeconds / BLEND_SECONDS);
  if (!blend || blend.progress === 1) {
    camera.position.copy(position);
    camera.quaternion.copy(quaternion);
    setFov(camera, fov);
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
  setFov(camera, blend.fov + (fov - blend.fov) * share);
  return blend;
}

/** The camera is in one of four states. */
type Mode =
  /** Orbiting the Earth's center under the user's control. */
  | { kind: 'globe' }
  /** Traveling with satellite `index`; `blend` runs while it is catching up with it. */
  | { kind: 'riding'; index: number; blend: Blend | null }
  /** On the ground at the observer, looking at the sky; `blend` runs on the way down. */
  | { kind: 'standing'; blend: Blend | null }
  /** On the way back from a ride or the ground, to a pose the globe controls can take over from. */
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

const stance = createStance();
const south = new Vector3();

/**
 * Finds the observer's eye (in `stance`) and their local axes (written to
 * `basis`): x east, y up, z south.
 */
function standAt(observer: Observer): void {
  stand(observer, currentSimTime(), stance);
  basis.makeBasis(stance.east, stance.up, south.copy(stance.north).negate());
}

/**
 * Turns the stand-in for the sky controls to look toward the equator, partway
 * up: where the sky has most to show from most places.
 */
function faceTheSky(skyCamera: Camera, observer: Observer): void {
  // In the observer's axes, the equator is to the south (+z) from the north.
  const toward = observer.latitude >= 0 ? 1 : -1;
  // The stand-in looks at the pivot from the opposite side.
  skyCamera.position
    .set(0, -Math.sin(SKY_START_ELEVATION), -toward * Math.cos(SKY_START_ELEVATION))
    .multiplyScalar(SKY_PIVOT);
}

/**
 * Keeps the near clipping plane in proportion to the camera's height above
 * the ground. Standing on it, the ground at the eye's feet must not be cut
 * away; far out, a near plane that close would leave too little depth
 * precision to tell the ground from what is drawn just above it.
 */
function fitNearPlane(camera: PerspectiveCamera): void {
  const near = MathUtils.clamp((camera.position.length() - 1) * 0.25, 5e-5, 0.05);
  if (Math.abs(camera.near - near) <= near * 0.01) return;
  camera.near = near;
  camera.updateProjectionMatrix();
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
  // The canvas is given a perspective camera; see `Scene`.
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const element = useThree((state) => state.gl.domElement);
  const controlsRef = useRef<{
    globe: OrbitControls;
    ride: OrbitControls;
    sky: OrbitControls;
  } | null>(null);
  /** The field of view while looking up, which the wheel changes. */
  const skyFov = useRef(SKY_FOV);
  const flight = useRef<Flight | null>(null);
  const mode = useRef<Mode>({ kind: 'globe' });
  const focusRequests = useApp((state) => state.focusRequests);
  const observerFocusRequests = useApp((state) => state.observerFocusRequests);

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

    // Looking up: the stand-in sits a hair from the pivot and looks through
    // it, so orbiting the pivot turns the view about the eye, and dragging
    // moves the sky along with the pointer. There is nothing to zoom toward,
    // so the wheel and a pinch change the field of view instead.
    const sky = new OrbitControls(new PerspectiveCamera(), element);
    sky.enabled = false;
    sky.enablePan = false;
    sky.enableZoom = false;
    sky.enableDamping = true;
    sky.dampingFactor = 0.08;
    // From just below the horizon (the stand-in level with the pivot) to the
    // zenith (the stand-in straight below it).
    sky.minPolarAngle = Math.PI / 2 - SKY_BELOW_HORIZON;
    sky.maxPolarAngle = Math.PI - 1e-3;
    const onWheel = (event: WheelEvent) => {
      if (!sky.enabled) return;
      event.preventDefault();
      skyFov.current = zoomFov(skyFov.current, Math.exp(event.deltaY * 0.001));
    };
    element.addEventListener('wheel', onWheel, { passive: false });

    // Two fingers spreading apart narrow the view, as they would enlarge a
    // photo. The sky controls ignore two-finger gestures, having nothing to
    // pan or dolly.
    const touches = new Map<number, { x: number; y: number }>();
    let spread = 0;
    const span = () => {
      const [a, b] = [...touches.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 2) spread = span();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!touches.has(event.pointerId)) return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size !== 2 || !sky.enabled) return;
      const now = span();
      if (spread > 0 && now > 0) skyFov.current = zoomFov(skyFov.current, spread / now);
      spread = now;
    };
    const onPointerEnd = (event: PointerEvent) => {
      touches.delete(event.pointerId);
      spread = 0;
    };
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerEnd);
    element.addEventListener('pointercancel', onPointerEnd);

    mode.current = { kind: 'globe' };
    controlsRef.current = { globe, ride, sky };
    return () => {
      globe.removeEventListener('start', cancelFlight);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerEnd);
      element.removeEventListener('pointercancel', onPointerEnd);
      globe.dispose();
      ride.dispose();
      sky.dispose();
      controlsRef.current = null;
    };
  }, [camera, element]);

  useEffect(() => {
    // During a ride the camera is on the satellite already, and from the
    // ground there is nowhere to fly.
    const { riding, lookingUp } = useApp.getState();
    if (focusRequests > 0 && !riding && !lookingUp) {
      flight.current = { target: 'selected', progress: 0 };
    }
  }, [focusRequests]);

  useEffect(() => {
    const { riding, lookingUp } = useApp.getState();
    if (observerFocusRequests > 0 && !riding && !lookingUp) {
      flight.current = { target: 'observer', progress: 0 };
    }
  }, [observerFocusRequests]);

  useFrame((_, deltaSeconds) => {
    const controls = controlsRef.current;
    if (!controls) return;
    fitNearPlane(camera);
    const { globe, ride, sky } = controls;
    const { simulation } = world;
    const { riding, selected, setRiding, lookingUp, observer } = useApp.getState();
    const standing = lookingUp ? observer : null;

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
      sky.enabled = false;
      ride.enabled = true;
    } else if (wanted === null && standing && current.kind !== 'standing') {
      // Down to the ground, facing the sky.
      faceTheSky(sky.object, standing);
      sky.target.set(0, 0, 0);
      sky.update();
      mode.current = { kind: 'standing', blend: leaving(camera) };
      flight.current = null;
      globe.enabled = false;
      ride.enabled = false;
      sky.enabled = true;
    } else if (!standing && current.kind === 'standing') {
      // Back up to where the globe controls can take over, over the same place.
      const position = camera.position.clone().setLength(1 + FOCUS_STANDOFF);
      const quaternion = new Quaternion().setFromRotationMatrix(
        lookAtOrigin.lookAt(position, ORIGIN, UP),
      );
      mode.current = { kind: 'returning', blend: leaving(camera), position, quaternion };
      sky.enabled = false;
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
      now.blend = approach(camera, now.blend, ridePosition, rideTurn, CAMERA_FOV, deltaSeconds);
      return;
    }
    if (now.kind === 'standing' && standing) {
      // Turns the view by about as much as the pointer moves across it.
      sky.rotateSpeed = camera.fov / 360;
      sky.update();
      standAt(standing);
      rideTurn.setFromRotationMatrix(basis).multiply(sky.object.quaternion);
      now.blend = approach(camera, now.blend, stance.eye, rideTurn, skyFov.current, deltaSeconds);
      return;
    }
    if (now.kind === 'returning') {
      if (approach(camera, now.blend, now.position, now.quaternion, CAMERA_FOV, deltaSeconds)) {
        return;
      }
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
