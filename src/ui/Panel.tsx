import { type ComponentProps, createContext, type ReactNode, useContext } from 'react';
import { CloseIcon } from './icons';

/**
 * What every piece of the HUD is made of: dark glass, with the scene behind
 * it blurred and still showing through, a hairline edge, and a faint light
 * along the top of it. Its corners are for whoever uses it to say: a panel's
 * are rounded, a single control is a capsule.
 */
export const SURFACE =
  'border border-chalk/10 bg-night/75 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-xl backdrop-saturate-150';

/** A control floating over the scene by itself: a capsule of the same glass. */
export const FLOATING_BUTTON = `pointer-events-auto flex shrink-0 items-center rounded-full px-3 text-xs hover:text-chalk ${SURFACE}`;
/** How one looks while what it opens is open: lit, so it reads over any sky. */
export const OPENED =
  'aria-expanded:border-transparent aria-expanded:bg-chalk aria-expanded:text-night aria-expanded:hover:text-night';

/** The word that marks what is lit by the Sun in a dark sky, and so can be seen. */
export const SUNLIT_TAG =
  'shrink-0 rounded-full bg-sunlit/15 px-2 py-px text-2xs font-medium text-sunlit';

/**
 * On a phone a panel is the sheet at the bottom of the screen, and can be
 * folded down to its heading to leave the scene in view. A panel finds out
 * here that it is one, and whether it is folded; anywhere else there is
 * nothing to find and it is simply a panel.
 */
export interface Sheet {
  folded: boolean;
  toggle(): void;
}
export const SheetContext = createContext<Sheet | null>(null);

/** The sheet this panel is, if it is one. */
export function useSheet(): Sheet | null {
  return useContext(SheetContext);
}

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

interface PanelHeaderProps {
  title: string;
  /** What is said under the title: a line or two. */
  children?: ReactNode;
  onClose(): void;
}

/**
 * The top of a panel: what it is about, and the way to put it away. On a
 * sheet it also has the handle across the top that folds and unfolds it.
 */
export function PanelHeader({ title, children, onClose }: PanelHeaderProps) {
  const sheet = useSheet();
  return (
    <header className={`relative flex items-start gap-3 px-4 pb-2.5 ${sheet ? 'pt-5' : 'pt-3'}`}>
      {sheet && (
        <button
          type="button"
          onClick={sheet.toggle}
          aria-expanded={!sheet.folded}
          aria-label={sheet.folded ? 'Show more' : 'Show less'}
          className="absolute inset-x-0 top-0 flex h-5 justify-center rounded-t-2xl pt-2"
        >
          <span className="h-1 w-9 rounded-full bg-chalk/30" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <PanelTitle className="truncate" title={title}>
          {title}
        </PanelTitle>
        {children}
      </div>
      <CloseButton onClick={onClose} />
    </header>
  );
}

/** Everything in a panel under its header: what a folded sheet leaves out. */
export function PanelBody({ children }: { children: ReactNode }) {
  const sheet = useSheet();
  // Hidden, not removed: what was typed or worked out in it is still there
  // when the sheet is unfolded again.
  return <div className={sheet?.folded ? 'hidden' : undefined}>{children}</div>;
}
