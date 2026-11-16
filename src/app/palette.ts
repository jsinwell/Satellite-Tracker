import type { ObjectType } from '../core/catalog';
import type { ConstellationId } from '../core/constellation';
import type { OrbitRegime } from '../core/orbit';

/** Shared by the renderer and the legend, so the two cannot disagree. */
export const TYPE_COLORS: Record<ObjectType, string> = {
  payload: '#67e8f9',
  'rocket-body': '#fbbf24',
  debris: '#fb7185',
  unknown: '#a1a1aa',
};

export const TYPE_LABELS: Record<ObjectType, string> = {
  payload: 'Payloads',
  'rocket-body': 'Rocket bodies',
  debris: 'Debris',
  unknown: 'Unclassified',
};

export const REGIME_LABELS: Record<OrbitRegime, string> = {
  LEO: 'Low Earth orbit',
  MEO: 'Medium Earth orbit',
  GEO: 'Geosynchronous orbit',
  HEO: 'Highly elliptical orbit',
};

/** Drawn for anything that is not one of the highlighted constellations. */
const MUTED_COLOR = '#7c8594';

/**
 * Only the three largest constellations get a color of their own. Satellites
 * are scattered points, so any two colors can end up side by side, and three
 * is as many hues as stay clearly distinct that way for every viewer,
 * including the common forms of color blindness (checked pairwise in OKLab;
 * a fourth hue drops below the threshold). Every other group is muted, and is
 * told apart by isolating it in the legend instead.
 *
 * The hues are a cyan, orange and violet chosen for that separation, in tints
 * light enough to read as small dots over both ocean and night-side imagery.
 */
const CONSTELLATION_COLORS: Record<ConstellationId, string> = {
  starlink: '#67e8f9',
  oneweb: '#ff9a5c',
  kuiper: '#b9a5ff',
  qianfan: MUTED_COLOR,
  guowang: MUTED_COLOR,
  navigation: MUTED_COLOR,
  planet: MUTED_COLOR,
  iridium: MUTED_COLOR,
  other: MUTED_COLOR,
};

export const ACCENT_COLOR = '#5eead4';

/**
 * The color a constellation is drawn in. `alone` says it is the only group
 * being shown: then it is the subject of the view rather than its backdrop,
 * so a group that would otherwise be muted takes the accent color instead.
 */
export function constellationColor(id: ConstellationId, alone: boolean): string {
  const color = CONSTELLATION_COLORS[id];
  return alone && color === MUTED_COLOR ? ACCENT_COLOR : color;
}
