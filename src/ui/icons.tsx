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
    <svg viewBox="0 0 16 16" className="size-3" aria-hidden="true">
      <path d="m3.5 3.5 9 9m0-9-9 9" {...line} strokeWidth={2} />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" {...line} />
      <path d="m10.5 10.5 3.5 3.5" {...line} />
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

/** A crescent and a star: the night sky. */
export function SkyIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
      <path d="M11.5 3.2a6.8 6.8 0 1 0 5.3 9.9 5.6 5.6 0 0 1-5.3-9.9Z" {...line} />
      <path d="m15 2.5.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6Z" fill="currentColor" />
    </svg>
  );
}

/** A cloud, struck through when the clouds are hidden. */
export function CloudIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
      <path
        d="M6 15.5a3.5 3.5 0 0 1-.6-6.95 4.75 4.75 0 0 1 9.15 1.2A3 3 0 0 1 14 15.5Z"
        {...line}
      />
      {hidden && <path d="m3.5 3.5 13 13" {...line} />}
    </svg>
  );
}

/** Three lines, each shorter than the last: the filters. */
export function FiltersIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
      <path d="M3 6h14M5.5 10h9M8 14h4" {...line} />
    </svg>
  );
}

/** Three dots: more. */
export function MoreIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
      <circle cx="4.5" cy="10" r="1.5" fill="currentColor" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" />
      <circle cx="15.5" cy="10" r="1.5" fill="currentColor" />
    </svg>
  );
}
