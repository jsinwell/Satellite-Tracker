import type { ObjectType } from '../core/catalog';
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

export const ACCENT_COLOR = '#5eead4';
