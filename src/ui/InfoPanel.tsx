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
import { OverlayLegend } from './OverlayLegend';
import { CloseButton, Panel, PanelHeading, PanelTitle } from './Panel';
import { PassList } from './PassList';

/**
 * SGP4 loses roughly a kilometer or more of accuracy per day away from the
 * epoch of its elements. Past this, the position shown is not trustworthy.
 */
const STALE_ELEMENTS_MS = 14 * 86_400_000;

const actionClass =
  'flex-1 rounded-lg bg-chalk/10 px-2 py-1.5 text-xs font-medium whitespace-nowrap text-chalk hover:bg-chalk/20';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <dt className="text-graphite">{label}</dt>
      <dd className="text-right text-chalk tabular-nums">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-chalk/10 px-4 py-2.5">
      <PanelHeading>{title}</PanelHeading>
      <dl>{children}</dl>
    </div>
  );
}

interface InfoPanelProps {
  world: World;
  index: number;
  /**
   * Whether everything is shown, or just a summary that leaves the scene in
   * view: what it is, where it is, and what can be done with it.
   */
  expanded: boolean;
  onToggleExpanded(): void;
}

/**
 * The selected satellite. A few lines to begin with, since its name is
 * already beside it in the scene: see `SelectedName`. Asked for the rest, it
 * says where it is now, when it passes over, and the orbit it is on.
 */
export function InfoPanel({ world, index, expanded, onToggleExpanded }: InfoPanelProps) {
  const satellite = world.satellites[index];
  const orbit = world.orbits[index];
  const telemetry = useTelemetry(world, index);
  const riding = useApp((state) => state.riding);
  const lookingUp = useApp((state) => state.lookingUp);
  const observer = useApp((state) => state.observer);
  const simMs = useSimTime(1000);
  const elementsAgeMs = simMs - Date.parse(satellite.elements.epoch);
  const stale = Math.abs(elementsAgeMs) > STALE_ELEMENTS_MS;

  return (
    <Panel aria-label="Selected satellite" className="w-full text-sm">
      <header className="flex items-start gap-3 px-4 pt-3 pb-2.5">
        <div className="min-w-0 flex-1">
          <PanelTitle className="truncate" title={satellite.name}>
            {satellite.name}
          </PanelTitle>
          <p className="text-xs text-graphite tabular-nums">
            NORAD {satellite.noradId}
            {satellite.intlDesignator && `, ${satellite.intlDesignator}`}
          </p>
          {/* What it is, where it orbits and whose it is, each its own word. */}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-chalk/80">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: TYPE_COLORS[satellite.objectType] }}
              />
              {TYPE_LABELS[satellite.objectType]}
            </span>
            <span title={REGIME_LABELS[orbit.regime]}>{orbit.regime}</span>
            {satellite.owner && <span>{satellite.owner}</span>}
          </p>
        </div>
        <CloseButton onClick={() => useApp.getState().select(null)} />
      </header>

      {!expanded && telemetry && (
        <p className="border-t border-chalk/10 px-4 py-2 text-xs text-chalk tabular-nums">
          {`${formatInteger(telemetry.altitudeKm)} km up, ${telemetry.speedKmS.toFixed(2)} km/s, ${
            telemetry.sunlit ? 'sunlit' : 'in eclipse'
          }`}
        </p>
      )}

      <div id="satellite-details" className={expanded ? '' : 'hidden'}>
        <Section title="Position now">
          {telemetry ? (
            <>
              <Row label="Latitude">{formatLatitude(telemetry.latitude)}</Row>
              <Row label="Longitude">{formatLongitude(telemetry.longitude)}</Row>
              <Row label="Altitude">{formatInteger(telemetry.altitudeKm)} km</Row>
              <Row label="Speed">{telemetry.speedKmS.toFixed(2)} km/s</Row>
              <Row label="Lighting">{telemetry.sunlit ? 'Sunlit' : 'In eclipse'}</Row>
              <Row label="Coverage">{formatInteger(telemetry.footprintKm)} km across</Row>
            </>
          ) : (
            <p className="py-1 text-graphite">
              No position: these elements cannot be propagated to this time.
            </p>
          )}
        </Section>

        {observer && <PassList world={world} index={index} observer={observer} />}

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
            <span className={stale ? 'text-caution' : undefined}>
              {formatDuration(elementsAgeMs)}
              {elementsAgeMs < 0 && ' ahead'}
            </span>
          </Row>
          {stale && (
            <p className="pt-1 text-xs text-caution">
              This far from the elements' epoch, the position shown is only approximate.
            </p>
          )}
        </Section>

        <OverlayLegend world={world} index={index} />
      </div>

      {/* Stays in reach at the bottom of the panel while the details scroll behind it. */}
      <div className="sticky bottom-0 flex gap-2 rounded-b-2xl border-t border-chalk/10 bg-night/90 p-2 backdrop-blur-xl">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-controls="satellite-details"
          className={actionClass}
        >
          {expanded ? 'Less' : 'Details'}
        </button>
        {/* During a ride the camera is already on the satellite; on the ground it stays put. */}
        {!riding && !lookingUp && (
          <button
            type="button"
            onClick={() => useApp.getState().focusSelected()}
            className={actionClass}
          >
            Center view
          </button>
        )}
        {/* Nothing to ride along with until the satellite has a position. */}
        {(telemetry || riding) && (
          <button
            type="button"
            onClick={() => useApp.getState().setRiding(!riding)}
            className={actionClass}
          >
            {riding ? 'Stop riding' : 'Ride along'}
          </button>
        )}
      </div>
    </Panel>
  );
}
