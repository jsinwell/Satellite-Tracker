import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { type Camera, MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { sunDirection } from '../core/astro';
import { EARTH_RADIUS_KM } from '../core/constants';
import { extrapolatePosition, hasState, type Vec3 } from '../core/kinematics';
import { directionToWorld } from './frame';

// Distances from the Earth's center, in Earth radii.
const MIN_DISTANCE = 1.12;
const MAX_DISTANCE = 40;
const INITIAL_DISTANCE = 3.6;
/** The most of the screen's width the globe may fill at the start. */
const GLOBE_WIDTH_FRACTION = 0.8;
/** The closest the camera will sit above a satellite it has flown to. */
const FOCUS_STANDOFF = 2.2;
const FLIGHT_SECONDS = 1.2;

const scratch: Vec3 = { x: 0, y: 0, z: 0 };
const direction = new Vector3();
const goal = new Vector3();
const turn = new Quaternion();
const step = new Quaternion();
const UP = new Vector3(0, 1, 0);

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

/**
 * Orbit controls around the Earth's center, plus a fly-to when a satellite is
 * selected. The camera lives in the inertial frame, so left alone it watches
 * the Earth rotate rather than rotating with it.
 */
export function CameraRig({ world }: { world: World }) {
  const camera = useThree((state) => state.camera);
  const element = useThree((state) => state.gl.domElement);
  const controlsRef = useRef<OrbitControls | null>(null);
  const flight = useRef<Flight | null>(null);
  const focusRequests = useApp((state) => state.focusRequests);

  useEffect(() => {
    placeInitially(camera);
    const controls = new OrbitControls(camera, element);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.zoomSpeed = 0.8;
    controls.minDistance = MIN_DISTANCE;
    controls.maxDistance = MAX_DISTANCE;
    // Taking hold of the camera cancels any flight in progress.
    const cancelFlight = () => {
      flight.current = null;
    };
    controls.addEventListener('start', cancelFlight);
    controlsRef.current = controls;
    return () => {
      controls.removeEventListener('start', cancelFlight);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, element]);

  useEffect(() => {
    if (focusRequests > 0) flight.current = { progress: 0 };
  }, [focusRequests]);

  useFrame((_, deltaSeconds) => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (flight.current && !advanceFlight(camera, world, flight.current, deltaSeconds)) {
      flight.current = null;
    }
    // Rotate more gently when close, so a drag moves the ground under the
    // pointer by about the same amount at any zoom.
    const altitude = camera.position.length() - 1;
    controls.rotateSpeed = MathUtils.clamp(altitude * 0.4, 0.05, 1);
    controls.update();
  });

  return null;
}
