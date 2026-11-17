import { json2satrec, type OMMJsonObject, type SatRec, sgp4 } from 'satellite.js';
import type { SatelliteRecord } from './catalog';
import { EARTH_RADIUS_KM, MS_PER_DAY, UNIX_EPOCH_JD } from './constants';

/**
 * Floats per satellite in a state buffer: position (km) then velocity (km/s),
 * both in the TEME inertial frame that SGP4 works in.
 */
export const STATE_STRIDE = 6;

const MS_PER_MINUTE = 60_000;
/** Anything SGP4 places this far inside the Earth has decayed or diverged. */
const MIN_RADIUS_SQUARED_KM = (EARTH_RADIUS_KM * 0.98) ** 2;

/** Converts a catalog record back to the OMM shape satellite.js initializes from. */
export function toOmm(record: SatelliteRecord): OMMJsonObject {
  const { elements } = record;
  return {
    OBJECT_NAME: record.name,
    OBJECT_ID: record.intlDesignator,
    NORAD_CAT_ID: record.noradId,
    EPOCH: elements.epoch,
    MEAN_MOTION: elements.meanMotion,
    ECCENTRICITY: elements.eccentricity,
    INCLINATION: elements.inclination,
    RA_OF_ASC_NODE: elements.raan,
    ARG_OF_PERICENTER: elements.argOfPericenter,
    MEAN_ANOMALY: elements.meanAnomaly,
    BSTAR: elements.bstar,
    MEAN_MOTION_DOT: elements.meanMotionDot,
    MEAN_MOTION_DDOT: elements.meanMotionDdot,
    EPHEMERIS_TYPE: 0,
    ELEMENT_SET_NO: 999,
  };
}

/** Initializes SGP4 for one satellite, or returns null if its elements are unusable. */
export function createSatRec(record: SatelliteRecord): SatRec | null {
  try {
    const satrec = json2satrec(toOmm(record));
    return satrec.error === 0 ? satrec : null;
  } catch {
    return null;
  }
}

function epochMs(satrec: SatRec): number {
  return (satrec.jdsatepoch - UNIX_EPOCH_JD) * MS_PER_DAY;
}

/**
 * Writes the state of `satrec` at `timeMs` into `out` at `offset`.
 * Returns false, leaving `out` untouched, if the satellite cannot be
 * propagated to that time.
 */
function writeState(
  satrec: SatRec,
  satrecEpochMs: number,
  timeMs: number,
  out: Float32Array,
  offset: number,
): boolean {
  const result = sgp4(satrec, (timeMs - satrecEpochMs) / MS_PER_MINUTE);
  if (result === null) return false;
  const { position, velocity } = result;
  const radiusSquared = position.x ** 2 + position.y ** 2 + position.z ** 2;
  // Written this way round so that NaN fails the check.
  if (!(radiusSquared > MIN_RADIUS_SQUARED_KM)) return false;
  out[offset] = position.x;
  out[offset + 1] = position.y;
  out[offset + 2] = position.z;
  out[offset + 3] = velocity.x;
  out[offset + 4] = velocity.y;
  out[offset + 5] = velocity.z;
  return true;
}

/**
 * Propagates a fixed set of satellites to arbitrary instants.
 *
 * Construction runs SGP4 initialization once per satellite; `propagate` then
 * only does the per-instant work and writes into a caller-owned buffer, so the
 * steady state allocates no typed arrays.
 */
export class Propagator {
  readonly count: number;
  /** Indices of records whose elements SGP4 rejected outright. */
  readonly invalid: readonly number[];

  private readonly satrecs: (SatRec | null)[];
  private readonly epochsMs: Float64Array;

  constructor(records: readonly SatelliteRecord[]) {
    this.count = records.length;
    this.satrecs = records.map(createSatRec);
    this.epochsMs = Float64Array.from(this.satrecs, (satrec) => (satrec ? epochMs(satrec) : 0));
    this.invalid = this.satrecs.flatMap((satrec, index) => (satrec ? [] : [index]));
  }

  /**
   * Fills `out` with every satellite's state at `timeMs`, `STATE_STRIDE`
   * floats each in catalog order. Satellites that cannot be propagated are
   * written as all zeros — a position no real object has, which consumers
   * treat as "absent". Returns the number of satellites propagated.
   */
  propagate(timeMs: number, out: Float32Array): number {
    if (out.length < this.count * STATE_STRIDE) {
      throw new RangeError(
        `State buffer holds ${out.length} floats; ${this.count * STATE_STRIDE} are required.`,
      );
    }
    let propagated = 0;
    for (let i = 0; i < this.count; i++) {
      const satrec = this.satrecs[i];
      const offset = i * STATE_STRIDE;
      if (satrec && writeState(satrec, this.epochsMs[i], timeMs, out, offset)) {
        propagated++;
      } else {
        out.fill(0, offset, offset + STATE_STRIDE);
      }
    }
    return propagated;
  }
}

/**
 * The TEME position (km) of a satellite at each of `timesMs`, three floats per
 * instant. Returns null if any sample fails.
 */
export function samplePositions(
  record: SatelliteRecord,
  timesMs: ArrayLike<number>,
  out: Float32Array = new Float32Array(timesMs.length * 3),
): Float32Array | null {
  const satrec = createSatRec(record);
  if (!satrec) return null;
  const satrecEpochMs = epochMs(satrec);
  const state = new Float32Array(STATE_STRIDE);
  for (let i = 0; i < timesMs.length; i++) {
    if (!writeState(satrec, satrecEpochMs, timesMs[i], state, 0)) return null;
    out.set(state.subarray(0, 3), i * 3);
  }
  return out;
}

/**
 * Samples one full revolution of a satellite's orbit, centered on `timeMs`, as
 * `segments + 1` TEME positions (km). Returns null if any sample fails.
 */
export function sampleOrbit(
  record: SatelliteRecord,
  timeMs: number,
  segments: number,
  out: Float32Array = new Float32Array((segments + 1) * 3),
): Float32Array | null {
  const periodMs = MS_PER_DAY / record.elements.meanMotion;
  const timesMs = Float64Array.from(
    { length: segments + 1 },
    (_, i) => timeMs + (i / segments - 0.5) * periodMs,
  );
  return samplePositions(record, timesMs, out);
}
