import { useEffect, useRef } from 'react';
import { useApp } from '../app/store';
import type { World } from '../app/world';

/** Names the satellite under the pointer, in a label that follows the pointer. */
export function HoverLabel({ world }: { world: World }) {
  const hovered = useApp((state) => state.hovered);
  const labelRef = useRef<HTMLDivElement>(null);

  // Position is written straight to the DOM: pointer moves must not re-render React.
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const label = labelRef.current;
      if (label)
        label.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 14}px)`;
    };
    window.addEventListener('pointermove', onPointerMove);
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, []);

  const satellite = hovered === null ? null : world.satellites[hovered];
  return (
    <div
      ref={labelRef}
      role="tooltip"
      className={`pointer-events-none fixed top-0 left-0 z-20 flex items-baseline gap-2 rounded-lg border border-chalk/10 bg-night/90 px-2 py-1 whitespace-nowrap ${
        satellite ? '' : 'invisible'
      }`}
    >
      <span className="text-xs font-medium text-chalk">{satellite?.name}</span>
      {satellite && (
        <span className="text-2xs text-graphite tabular-nums">{satellite.noradId}</span>
      )}
    </div>
  );
}
