import type { ReactNode } from 'react';
import { REGIME_LABELS, TYPE_COLORS, TYPE_LABELS } from '../app/palette';
import { useApp } from '../app/store';
import type { World } from '../app/world';
import {
  formatDuration,
  formatInteger,
  formatLatitude,
  formatLongitude,
  formatPeriod,
} from './format';
import { useSimTime, useTelemetry } from './hooks';
import { Panel } from './Panel';

/**
 * SGP4 loses roughly a kilometer or more of accuracy per day away from the
 * epoch of its elements. Past this, the position shown is not trustworthy.
 */
const STALE_ELEMENTS_MS = 14 * 86_400_000;

const actionClass =
  'flex-1 rounded-lg px-3 py-1.5 text-xs font-medium text-accent hover:bg-white/10';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right font-mono text-slate-100 tabular-nums">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-white/10 px-4 py-2.5">
      <h3 className="mb-1 text-[0.65rem] font-semibold tracking-widest text-slate-500 uppercase">
        {title}
      </h3>
      <dl>{children}</dl>
    </div>
  );
}

interface InfoPanelProps {
  world: World;
  index: number;
  /**
   * Narrow screens only: whether everything is shown, or just a summary that
   * leaves the globe in view. Wide screens always show everything.
   */
  expanded: boolean;
  onToggleExpanded(): void;
}

/** Details of the selected satellite: where it is now, and the orbit it is on. */
export function InfoPanel({ world, index, expanded, onToggleExpanded }: InfoPanelProps) {
  const satellite = world.satellites[index];
  const orbit = world.orbits[index];
  const telemetry = useTelemetry(world, index);
  const simMs = useSimTime(1000);
  const elementsAgeMs = simMs - Date.parse(satellite.elements.epoch);
  const stale = Math.abs(elementsAgeMs) > STALE_ELEMENTS_MS;

  return (
    <Panel aria-label="Selected satellite" className="w-full text-sm">
      <header className="flex items-start gap-3 px-4 pt-3 pb-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-white" title={satellite.name}>
            {satellite.name}
          </h2>
          <p className="font-mono text-xs text-slate-400">
            NORAD {satellite.noradId}
            {satellite.intlDesignator && ` · ${satellite.intlDesignator}`}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: TYPE_COLORS[satellite.objectType] }}
              />
              {TYPE_LABELS[satellite.objectType]}
            </span>
            <span className="text-slate-600">·</span>
            <span title={REGIME_LABELS[orbit.regime]}>{orbit.regime}</span>
            {satellite.owner && (
              <>
                <span className="text-slate-600">·</span>
                <span>{satellite.owner}</span>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => useApp.getState().select(null)}
          aria-label="Close"
          className="-mt-0.5 -mr-1.5 rounded-md px-2 py-0.5 text-lg leading-none text-slate-400 hover:bg-white/10 hover:text-white"
        >
          ×
        </button>
      </header>

      {!expanded && telemetry && (
        <p className="border-t border-white/10 px-4 py-2 font-mono text-xs text-slate-100 tabular-nums sm:hidden">
          {`${formatInteger(telemetry.altitudeKm)} km up · ${telemetry.speedKmS.toFixed(2)} km/s · ${
            telemetry.sunlit ? 'sunlit' : 'in eclipse'
          }`}
        </p>
      )}

      <div id="satellite-details" className={`sm:block ${expanded ? '' : 'hidden'}`}>
        <Section title="Position now">
          {telemetry ? (
            <>
              <Row label="Latitude">{formatLatitude(telemetry.latitude)}</Row>
              <Row label="Longitude">{formatLongitude(telemetry.longitude)}</Row>
              <Row label="Altitude">{formatInteger(telemetry.altitudeKm)} km</Row>
              <Row label="Speed">{telemetry.speedKmS.toFixed(2)} km/s</Row>
              <Row label="Lighting">{telemetry.sunlit ? 'Sunlit' : 'In eclipse'}</Row>
            </>
          ) : (
            <p className="py-1 text-slate-400">
              No position: these elements cannot be propagated to this time.
            </p>
          )}
        </Section>

        <Section title="Orbit">
          <Row label="Period">{formatPeriod(orbit.periodMinutes)}</Row>
          <Row label="Inclination">{satellite.elements.inclination.toFixed(2)}°</Row>
          <Row label="Apogee">{formatInteger(orbit.apogeeKm)} km</Row>
          <Row label="Perigee">{formatInteger(orbit.perigeeKm)} km</Row>
          <Row label="Eccentricity">{satellite.elements.eccentricity.toFixed(4)}</Row>
        </Section>

        <Section title="Record">
          {satellite.launchDate && <Row label="Launched">{satellite.launchDate}</Row>}
          <Row label="Elements age">
            <span className={stale ? 'text-amber-300' : undefined}>
              {formatDuration(elementsAgeMs)}
              {elementsAgeMs < 0 && ' ahead'}
            </span>
          </Row>
          {stale && (
            <p className="pt-1 text-xs text-amber-300/90">
              This far from the elements' epoch, the position shown is only approximate.
            </p>
          )}
        </Section>
      </div>

      {/* Stays in reach at the bottom of the panel while the details scroll behind it. */}
      <div className="sticky bottom-0 flex gap-1 rounded-b-xl border-t border-white/10 bg-slate-950/90 p-2 backdrop-blur-md">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-controls="satellite-details"
          className={`${actionClass} sm:hidden`}
        >
          {expanded ? 'Hide details' : 'Show details'}
        </button>
        <button
          type="button"
          onClick={() => useApp.getState().focusSelected()}
          className={actionClass}
        >
          Center view<span className="max-sm:hidden"> on satellite</span>
        </button>
      </div>
    </Panel>
  );
}
