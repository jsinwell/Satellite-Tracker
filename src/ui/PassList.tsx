import type { ReactNode } from 'react';
import { useApp } from '../app/store';
import type { World } from '../app/world';
import { MIN_PASS_ELEVATION, type Observer, type Pass } from '../core/observer';
import { formatCompass, formatLocalTime, localTimeZone } from './format';
import { PASS_HORIZON_MS, usePasses } from './hooks';

/** Jumping to a pass lands this long before it rises, to see it come up. */
const LEAD_IN_MS = 60_000;

function PassRow({ pass }: { pass: Pass }) {
  const minutes = Math.max(1, Math.round((pass.setMs - pass.riseMs) / 60_000));
  const seeable = pass.seeable;
  return (
    <li>
      <button
        type="button"
        onClick={() => useApp.getState().jumpTo(pass.riseMs - LEAD_IN_MS)}
        title="Go to this pass"
        className="w-full rounded-md px-2 py-1 text-left text-xs hover:bg-white/10"
      >
        <span className="flex items-baseline gap-2">
          <span className="flex-1 text-slate-100">{formatLocalTime(pass.riseMs)}</span>
          {seeable && (
            <span
              className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[0.65rem] text-emerald-300"
              title={`Sunlit in a dark sky from ${formatLocalTime(seeable.fromMs)} to ${formatLocalTime(seeable.toMs)}`}
            >
              visible
            </span>
          )}
        </span>
        <span className="block font-mono text-slate-400 tabular-nums">
          {Math.round(pass.peakElevation)}° high · {minutes} min · {formatCompass(pass.riseAzimuth)}{' '}
          → {formatCompass(pass.setAzimuth)}
        </span>
      </button>
    </li>
  );
}

/** When the satellite next goes over the viewer's chosen place. */
export function PassList({
  world,
  index,
  observer,
}: {
  world: World;
  index: number;
  observer: Observer;
}) {
  const prediction = usePasses(world, index, observer);
  const days = Math.round(PASS_HORIZON_MS / 86_400_000);

  let body: ReactNode;
  if (prediction === null) {
    body = (
      <p className="px-2 text-xs text-slate-400">Passes can't be predicted from these elements.</p>
    );
  } else if (prediction.kind === 'always-up') {
    body = (
      <p className="px-2 text-xs text-slate-300">
        Always above your horizon, {Math.round(prediction.elevation)}° up in the{' '}
        {formatCompass(prediction.azimuth)}.
      </p>
    );
  } else if (prediction.passes.length === 0) {
    body = (
      <p className="px-2 text-xs text-slate-400">
        Doesn't rise more than {MIN_PASS_ELEVATION}° over you in the next {days} days.
      </p>
    );
  } else {
    body = (
      <>
        <ul aria-label="Next passes">
          {prediction.passes.map((pass) => (
            <PassRow key={pass.riseMs} pass={pass} />
          ))}
        </ul>
        <p className="mt-1 px-2 text-[0.7rem] text-slate-500">
          Your local time ({localTimeZone(prediction.passes[0].riseMs)}). Highest point, length, and
          where it rises and sets. Select one to watch it.
        </p>
      </>
    );
  }

  return (
    <div className="border-t border-white/10 px-2 py-2.5">
      <h3 className="mb-1 px-2 text-[0.65rem] font-semibold tracking-widest text-slate-500 uppercase">
        Passes over you
      </h3>
      {body}
    </div>
  );
}
