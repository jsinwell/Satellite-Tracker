import { useApp } from '../app/store';
import type { World } from '../app/world';
import { formatAgo, formatInteger } from './format';
import { useWallTime } from './hooks';

/** What is on screen and how fresh it is, plus attribution for the data. */
export function StatusLine({ world }: { world: World }) {
  const visibleCount = useApp((state) => state.visibleCount);
  const cloudsAtMs = useApp((state) => (state.showClouds ? state.cloudsAtMs : null));
  // Real time, not simulated: this is how old the data actually is.
  const now = useWallTime(30_000);
  const total = world.satellites.length;

  return (
    <p className="pointer-events-auto text-right text-[0.7rem] leading-relaxed text-slate-400 [text-shadow:0_1px_3px_#000]">
      {visibleCount === total
        ? `${formatInteger(total)} objects tracked`
        : `${formatInteger(visibleCount)} of ${formatInteger(total)} objects shown`}
      <br />
      Data from{' '}
      <a
        href="https://celestrak.org"
        target="_blank"
        rel="noreferrer"
        className="underline decoration-slate-600 hover:text-slate-200"
      >
        CelesTrak
      </a>
      , fetched {formatAgo(now - world.generatedAtMs)}
      {cloudsAtMs !== null && (
        <>
          <br />
          <a
            href="https://github.com/matteason/live-cloud-maps"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-slate-600 hover:text-slate-200"
          >
            Clouds
          </a>{' '}
          from {formatAgo(now - cloudsAtMs)}; contains modified EUMETSAT data
        </>
      )}
    </p>
  );
}
