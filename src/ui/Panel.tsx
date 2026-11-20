import type { ComponentProps } from 'react';
import { CloseIcon } from './icons';

/**
 * What every piece of the HUD is made of: dark glass, with the scene behind
 * it blurred and still showing through, a hairline edge, and a faint light
 * along the top of it. Its corners are for whoever uses it to say: a panel's
 * are rounded, a single control is a capsule.
 */
export const SURFACE =
  'border border-chalk/10 bg-night/75 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-xl backdrop-saturate-150';

/** The word that marks what is lit by the Sun in a dark sky, and so can be seen. */
export const SUNLIT_TAG =
  'shrink-0 rounded-full bg-sunlit/15 px-2 py-px text-2xs font-medium text-sunlit';

/** The translucent surface every piece of the HUD sits on. */
export function Panel({ className = '', ...props }: ComponentProps<'section'>) {
  return (
    <section className={`pointer-events-auto rounded-2xl ${SURFACE} ${className}`} {...props} />
  );
}

/** What a panel is about. */
export function PanelTitle({ className = '', ...props }: ComponentProps<'h2'>) {
  return (
    <h2
      className={`text-base font-semibold tracking-[-0.01em] text-chalk ${className}`}
      {...props}
    />
  );
}

/** The name of one part of a panel. */
export function PanelHeading({ className = '', ...props }: ComponentProps<'h3'>) {
  return <h3 className={`mb-1 text-xs font-semibold text-graphite ${className}`} {...props} />;
}

/** Puts a panel away, from its top right corner. */
export function CloseButton({ onClick }: { onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className="-mr-1 grid size-6 shrink-0 place-items-center rounded-full bg-chalk/10 text-chalk/70 hover:bg-chalk/20 hover:text-chalk"
    >
      <CloseIcon />
    </button>
  );
}
