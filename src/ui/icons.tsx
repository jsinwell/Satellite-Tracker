/**
 * The small drawings on the controls. Drawn here, not typed as characters:
 * a character comes out of whichever font happens to have it, at whatever
 * size and weight that font gives it.
 */

const line = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
      <path d="m3.5 3.5 9 9m0-9-9 9" {...line} />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3" aria-hidden="true">
      <path d="M4 2.5v11l9.5-5.5Z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3" aria-hidden="true">
      <path d="M3.5 2.5h3v11h-3Zm6 0h3v11h-3Z" fill="currentColor" />
    </svg>
  );
}

/** An arrowhead, for stepping back and forward and for what opens and shuts. */
export function ChevronIcon({ pointing }: { pointing: 'left' | 'right' | 'up' | 'down' }) {
  const turn = { right: 0, down: 90, left: 180, up: 270 }[pointing];
  return (
    <svg viewBox="0 0 16 16" className="size-3" aria-hidden="true">
      <path d="m6 3 5 5-5 5" transform={`rotate(${turn} 8 8)`} {...line} />
    </svg>
  );
}
