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
import { Panel, PanelBody, PanelHeader, useSheet } from './Panel';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <dt className="text-graphite">{label}</dt>
      <dd className="text-right text-chalk tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * What the view is held on while looking up: the Moon or a planet, as it is
 * seen from the observer right now. As a phone's sheet it starts folded down
 * to two lines: the thing itself is in the middle of the screen, and a full
 * panel would sit on top of it.
 */
export function BodyPanel({ body, observer }: { body: SkyBody; observer: Observer }) {
  const view = useBodyView(body, observer);
  const up = view.elevation > 0;
  const sheet = useSheet();
  const where = up
    ? `${Math.round(view.elevation)}° up, ${formatCompass(view.azimuth)}`
    : 'below the horizon';

  return (
    <Panel aria-label={`Watching ${BODY_NAMES[body]}`} className="w-full text-sm">
      <PanelHeader title={BODY_NAMES[body]} onClose={() => useApp.getState().watch(null)}>
        <p className="truncate text-xs text-graphite">
          {body === 'moon' ? 'In' : 'Planet in'} {view.constellation}
          {/* On a sheet this line may be all there is, so it says where to look as well. */}
          {sheet && `, ${where}`}
        </p>
      </PanelHeader>

      <PanelBody>
        <div className="border-t border-chalk/10 px-4 py-2.5">
          <dl>
            <Row label="Distance">{formatBodyDistance(view.distanceKm)}</Row>
            <Row label="Light takes">{formatLightTime(view.distanceKm)}</Row>
            <Row label="Looks">{formatAngularSize(view.angularDiameter)} wide</Row>
            <Row label="Phase">{litWords(view.litFraction)}</Row>
            <Row label="Brightness">
              {view.magnitude.toFixed(1)}, {brightnessWords(view.magnitude)}
            </Row>
            <Row label="In the sky">{where}</Row>
          </dl>
        </div>

        <p className="border-t border-chalk/10 px-4 py-2.5 text-xs text-graphite">
          {up
            ? 'Scroll or pinch to zoom. Click or tap the sky, or press Esc, to let go.'
            : 'It has set, so the ground is in the way. Try another time of day.'}
        </p>
      </PanelBody>
    </Panel>
  );
}
