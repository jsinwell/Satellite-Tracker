import { type ReactNode, useId } from 'react';
import { COVERAGE_COLOR, GROUND_TRACK_COLOR, satelliteColor } from '../app/palette';
import { type Overlay, useApp } from '../app/store';
import type { World } from '../app/world';
import { soleEnabled } from '../core/constellation';

/** Small pictures of each drawing, as it looks on the globe. */
function OrbitSwatch({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 14" className="h-3.5 w-6" aria-hidden="true">
      <ellipse cx="12" cy="7" rx="10.5" ry="5" fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

function GroundTrackSwatch() {
  return (
    <svg viewBox="0 0 24 14" className="h-3.5 w-6" aria-hidden="true">
      <path
        d="M1.5 11.5 C 6 1.5, 11 1.5, 15 7 S 21 12, 22.5 4"
        fill="none"
        stroke={GROUND_TRACK_COLOR}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="8.6" cy="4.1" r="2" fill={GROUND_TRACK_COLOR} stroke="#05070d" />
      <circle cx="17.6" cy="9.6" r="2" fill={GROUND_TRACK_COLOR} stroke="#05070d" />
    </svg>
  );
}

function CoverageSwatch() {
  return (
    <svg viewBox="0 0 24 14" className="h-3.5 w-6" aria-hidden="true">
      <circle
        cx="12"
        cy="7"
        r="6"
        fill={COVERAGE_COLOR}
        fillOpacity="0.25"
        stroke={COVERAGE_COLOR}
        strokeWidth="1.5"
      />
    </svg>
  );
}

interface RowProps {
  overlay: Overlay;
  label: string;
  hint: string;
  swatch: ReactNode;
}

function OverlayRow({ overlay, label, hint, swatch }: RowProps) {
  const on = useApp((state) => state.overlays[overlay]);
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-hint`}
      onClick={() => useApp.getState().toggleOverlay(overlay)}
      className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
    >
      <span className="shrink-0 opacity-35 transition-opacity group-aria-checked:opacity-100">
        {swatch}
      </span>
      <span className="min-w-0 flex-1">
        <span
          id={`${id}-label`}
          className="block text-xs text-slate-400 group-aria-checked:text-slate-100"
        >
          {label}
        </span>
        <span id={`${id}-hint`} className="block text-[0.7rem] leading-snug text-slate-500">
          {hint}
        </span>
      </span>
      {/* The switch itself: a track with a knob that slides across when on. */}
      <span
        aria-hidden="true"
        className="relative h-4 w-7 shrink-0 rounded-full bg-slate-700 transition-colors group-aria-checked:bg-accent/70"
      >
        <span className="absolute top-0.5 left-0.5 size-3 rounded-full bg-slate-300 transition-transform group-aria-checked:translate-x-3 group-aria-checked:bg-white" />
      </span>
    </button>
  );
}

/**
 * Says what each line and shape drawn for the selected satellite is, with a
 * switch to turn each one off.
 */
export function OverlayLegend({ world, index }: { world: World; index: number }) {
  const orbitColor = useApp((state) =>
    satelliteColor(world, index, state.colorBy, soleEnabled(state.filters.constellations)),
  );

  return (
    <div className="border-t border-white/10 px-2 py-2.5">
      <h3 className="mb-1 px-2 text-[0.65rem] font-semibold tracking-widest text-slate-500 uppercase">
        On the globe
      </h3>
      <OverlayRow
        overlay="orbit"
        label="Orbit"
        hint="Its path through space"
        swatch={<OrbitSwatch color={orbitColor} />}
      />
      <OverlayRow
        overlay="groundTrack"
        label="Ground track"
        hint="The ground it passes over next, with times in UTC"
        swatch={<GroundTrackSwatch />}
      />
      <OverlayRow
        overlay="coverage"
        label="Coverage"
        hint="Everywhere it is above the horizon now"
        swatch={<CoverageSwatch />}
      />
    </div>
  );
}
