import type { ComponentProps } from 'react';
import { CloseIcon } from './icons';

/**
 * What every piece of the HUD is made of: dark glass with a hairline edge,
 * and the scene still showing through it. No shadow: the blur already sets
 * it apart from what is behind.
 */
export const SURFACE = 'rounded-md border border-chalk/10 bg-night/80 backdrop-blur-md';

/** The word that marks what is lit by the Sun in a dark sky, and so can be seen. */
export const SUNLIT_TAG = 'shrink-0 rounded-sm bg-sunlit/15 px-1.5 text-2xs text-sunlit';

/** The translucent surface every piece of the HUD sits on. */
export function Panel({ className = '', ...props }: ComponentProps<'section'>) {
  return <section className={`pointer-events-auto ${SURFACE} ${className}`} {...props} />;
}

/** What a panel is about: the name of a thing, lettered as the scene letters it. */
export function PanelTitle({ className = '', ...props }: ComponentProps<'h2'>) {
  return <h2 className={`atlas-name text-base text-chalk ${className}`} {...props} />;
}

/** The name of one part of a panel. */
export function PanelHeading({ className = '', ...props }: ComponentProps<'h3'>) {
  return <h3 className={`atlas-name mb-1 text-sm text-chalk/70 ${className}`} {...props} />;
}

/** Puts a panel away, from its top right corner. */
export function CloseButton({ onClick }: { onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className="-mt-1 -mr-2 rounded p-1.5 text-graphite hover:bg-chalk/10 hover:text-chalk"
    >
      <CloseIcon />
    </button>
  );
}
