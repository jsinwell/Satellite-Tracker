import type { ReactNode } from 'react';
import { useApp } from '../app/store';
import { BODY_NAMES, type SkyBody } from '../core/bodies';
import type { Observer } from '../core/observer';
import { brightnessWords } from '../core/planets';
import {
  formatAngularSize,
  formatBodyDistance,
  formatCompass,
  formatLightTime,
  litWords,
} from './format';
import { useBodyView } from './hooks';
import { Panel } from './Panel';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right font-mono text-slate-100 tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * What the view is held on while looking up: the Moon or a planet, as it is
 * seen from the observer right now.
 */
export function BodyPanel({ body, observer }: { body: SkyBody; observer: Observer }) {
  const view = useBodyView(body, observer);
  const up = view.elevation > 0;

  return (
    <Panel aria-label={`Watching ${BODY_NAMES[body]}`} className="w-full text-sm">
      <header className="flex items-start gap-3 px-4 pt-3 pb-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-white">{BODY_NAMES[body]}</h2>
          <p className="text-xs text-slate-400">
            {body === 'moon' ? 'The Moon' : 'Planet'} · in {view.constellation}
          </p>
        </div>
        <button
          type="button"
          onClick={() => useApp.getState().watch(null)}
          aria-label="Close"
          className="-mt-0.5 -mr-1.5 rounded-md px-2 py-0.5 text-lg leading-none text-slate-400 hover:bg-white/10 hover:text-white"
        >
          ×
        </button>
      </header>

      <div className="border-t border-white/10 px-4 py-2.5">
        <dl>
          <Row label="Distance">{formatBodyDistance(view.distanceKm)}</Row>
          <Row label="Light takes">{formatLightTime(view.distanceKm)}</Row>
          <Row label="Looks">{formatAngularSize(view.angularDiameter)} wide</Row>
          <Row label="Phase">{litWords(view.litFraction)}</Row>
          <Row label="Brightness">
            {view.magnitude.toFixed(1)}, {brightnessWords(view.magnitude)}
          </Row>
          <Row label="In the sky">
            {up
              ? `${Math.round(view.elevation)}° up, ${formatCompass(view.azimuth)}`
              : 'below the horizon'}
          </Row>
        </dl>
      </div>

      <p className="border-t border-white/10 px-4 py-2.5 text-xs text-slate-400">
        {up
          ? 'Scroll or pinch to zoom. Drag to look somewhere else.'
          : 'It has set, so the ground is in the way. Try another time of day.'}
      </p>
    </Panel>
  );
}
