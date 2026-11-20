import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/store';
import type { World } from '../app/world';
import { SKY_SHOWS } from '../core/brightness';
import { BodyPanel } from './BodyPanel';
import { FilterSheet } from './FilterPanel';
import { InfoPanel } from './InfoPanel';
import { CloudIcon, FiltersIcon, MoreIcon, SkyIcon } from './icons';
import { FLOATING_BUTTON, OPENED, type Sheet, SheetContext, SURFACE } from './Panel';
import { SearchBox } from './SearchBox';
import { SkyPanel } from './SkyPanel';
import { SKY_SHOWS_CHOICES } from './SkyShowsButton';
import { StatusLine } from './StatusLine';
import { TimeBar } from './TimeBar';

/** What the sheet can be about. One at a time: a phone has room for one. */
type Subject = 'body' | 'satellite' | 'sky' | 'filters';

/**
 * When the one in front is put away, the next of these that is still open
 * takes its place: what the view is held on first, then what is selected,
 * then what was asked for from the menu.
 */
const BEHIND: Subject[] = ['body', 'satellite', 'sky', 'filters'];

interface MenuRowProps {
  icon: ReactNode;
  label: string;
  /** Said at the end of the row: what it is set to, if it is a setting. */
  value?: string;
  onClick(): void;
}

function MenuRow({ icon, label, value, onClick }: MenuRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-chalk hover:bg-chalk/10"
    >
      <span className="text-chalk/80">{icon}</span>
      <span className="flex-1">{label}</span>
      {value && <span className="text-graphite">{value}</span>}
    </button>
  );
}

/**
 * The controls over the scene on a phone, laid out the way a maps app is.
 * Search and one menu at the top. At the bottom the clock, in a row, and
 * over it one sheet, which is about one thing at a time and folds down to
 * its heading. Everything else is the scene.
 */
export function PhoneHud({ world }: { world: World }) {
  const selected = useApp((state) => state.selected);
  const watching = useApp((state) => state.watching);
  const observer = useApp((state) => state.observer);
  const lookingUp = useApp((state) => state.lookingUp);
  const haveClouds = useApp((state) => state.cloudsAtMs !== null);
  const showClouds = useApp((state) => state.showClouds);
  const skyShows = useApp((state) => state.skyShows);
  const [menuOpen, setMenuOpen] = useState(false);
  const [skyOpen, setSkyOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** What was opened last, which is what the sheet shows while it is still open. */
  const [front, setFront] = useState<Subject | null>(null);
  /** Whether the sheet is folded, said about one subject: the next starts as it should. */
  const [fold, setFold] = useState<{ subject: Subject | null; folded: boolean }>({
    subject: null,
    folded: false,
  });

  // What is chosen in the scene comes to the front, and looking up folds the
  // sky's own sheet out of the way of the sky. Settled while rendering, not
  // in an effect, so the sheet never shows the old subject for a frame.
  const [seen, setSeen] = useState({ selected, watching, lookingUp });
  if (seen.selected !== selected || seen.watching !== watching || seen.lookingUp !== lookingUp) {
    setSeen({ selected, watching, lookingUp });
    if (selected !== null && seen.selected !== selected) setFront('satellite');
    if (watching !== null && seen.watching !== watching) setFront('body');
    if (lookingUp && !seen.lookingUp) setFold({ subject: 'sky', folded: true });
  }

  const open: Record<Subject, boolean> = {
    body: watching !== null && observer !== null,
    satellite: selected !== null,
    sky: skyOpen,
    filters: filtersOpen,
  };
  const subject = front && open[front] ? front : (BEHIND.find((each) => open[each]) ?? null);
  // Held on the Moon or a planet, the thing itself is in the middle of the
  // screen: that sheet starts folded. The others start open.
  const folded = fold.subject === subject ? fold.folded : subject === 'body';
  const sheet = useMemo(
    (): Sheet => ({ folded, toggle: () => setFold({ subject, folded: !folded }) }),
    [folded, subject],
  );

  // A new place replaces what the sky's sheet shows; start it from the top.
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (observer) sheetRef.current?.scrollTo({ top: 0 });
  }, [observer]);

  // A touch anywhere else puts the menu away, as it would any menu.
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  const show = (asked: 'sky' | 'filters') => {
    if (asked === 'sky') setSkyOpen(true);
    else setFiltersOpen(true);
    setFront(asked);
    setFold({ subject: asked, folded: false });
    setMenuOpen(false);
  };
  const nextShows = SKY_SHOWS[(SKY_SHOWS.indexOf(skyShows) + 1) % SKY_SHOWS.length];

  return (
    <>
      {/* Over the sheet, which the list of search results can reach down to. */}
      <div className="absolute inset-x-3 top-3 z-10 flex gap-2">
        <div className="min-w-0 flex-1">
          <SearchBox world={world} />
        </div>
        <div ref={menuRef} className="relative flex">
          <button
            type="button"
            onClick={() => setMenuOpen((isOpen) => !isOpen)}
            aria-expanded={menuOpen}
            aria-controls="menu"
            aria-label="Menu"
            className={`${FLOATING_BUTTON} text-chalk/80 ${OPENED}`}
          >
            <MoreIcon />
          </button>
          {menuOpen && (
            <div
              id="menu"
              className={`pointer-events-auto absolute top-full right-0 mt-2 w-64 divide-y divide-chalk/10 overflow-hidden rounded-2xl ${SURFACE}`}
            >
              <MenuRow icon={<SkyIcon />} label="Your sky" onClick={() => show('sky')} />
              <MenuRow icon={<FiltersIcon />} label="Filters" onClick={() => show('filters')} />
              {haveClouds && (
                <MenuRow
                  icon={<CloudIcon hidden={!showClouds} />}
                  label="Clouds"
                  value={showClouds ? 'On' : 'Off'}
                  onClick={() => useApp.getState().setShowClouds(!showClouds)}
                />
              )}
              {lookingUp && (
                <MenuRow
                  icon={
                    <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
                      {SKY_SHOWS_CHOICES[skyShows].icon}
                    </svg>
                  }
                  label="Satellites shown"
                  value={SKY_SHOWS_CHOICES[skyShows].name}
                  onClick={() => useApp.getState().setSkyShows(nextShows)}
                />
              )}
              <div className="px-4 py-3">
                <StatusLine world={world} listed />
                {haveClouds && (
                  // Says whose data it is, as its license asks.
                  <p className="text-2xs leading-relaxed text-graphite">
                    Clouds contain modified EUMETSAT data
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="absolute inset-x-3 bottom-3 flex flex-col gap-2">
        {subject && (
          <SheetContext value={sheet}>
            <div
              ref={sheetRef}
              className="thin-scrollbar pointer-events-auto max-h-[60dvh] overflow-y-auto rounded-2xl"
            >
              {subject === 'body' && watching !== null && observer && (
                <BodyPanel body={watching} observer={observer} />
              )}
              {subject === 'satellite' && selected !== null && (
                <InfoPanel
                  key={selected}
                  world={world}
                  index={selected}
                  expanded={detailsOpen}
                  onToggleExpanded={() => setDetailsOpen((isOpen) => !isOpen)}
                />
              )}
              {subject === 'sky' && <SkyPanel world={world} onClose={() => setSkyOpen(false)} />}
              {subject === 'filters' && (
                <FilterSheet world={world} onClose={() => setFiltersOpen(false)} />
              )}
            </div>
          </SheetContext>
        )}
        <TimeBar />
      </div>
    </>
  );
}
