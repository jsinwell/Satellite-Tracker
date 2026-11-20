import { useApp } from '../app/store';
import type { World } from '../app/world';
import { formatAgo, formatInteger } from './format';
import { useWallTime } from './hooks';

/**
 * What is on screen and how fresh it is, plus attribution for the data. Over
 * the scene, in a corner, unless `listed`: then it is a line in a menu, with
 * a surface behind it.
 */
export function StatusLine({ world, listed = false }: { world: World; listed?: boolean }) {
  const visibleCount = useApp((state) => state.visibleCount);
  // Real time, not simulated: this is how old the data actually is.
  const now = useWallTime(30_000);
  const total = world.satellites.length;

  return (
    <p
      className={`pointer-events-auto text-2xs leading-relaxed text-graphite ${
        listed ? '' : 'text-right [text-shadow:0_1px_3px_#000]'
      }`}
    >
      {visibleCount === total
        ? `${formatInteger(total)} objects tracked`
        : `${formatInteger(visibleCount)} of ${formatInteger(total)} objects shown`}
      <br />
      Data from{' '}
      <a
        href="https://celestrak.org"
        target="_blank"
        rel="noreferrer"
        className="underline decoration-graphite/50 hover:text-chalk"
      >
        CelesTrak
      </a>
      , fetched {formatAgo(now - world.generatedAtMs)}
    </p>
  );
}
