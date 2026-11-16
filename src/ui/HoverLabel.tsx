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
      className={`pointer-events-none fixed top-0 left-0 z-20 rounded-md border border-white/10 bg-slate-950/90 px-2 py-1 text-xs whitespace-nowrap text-slate-100 shadow-lg ${
        satellite ? '' : 'invisible'
      }`}
    >
      {satellite?.name}{' '}
      {satellite && <span className="ml-2 font-mono text-slate-500">{satellite.noradId}</span>}
    </div>
  );
}
