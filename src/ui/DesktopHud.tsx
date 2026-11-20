import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../app/store';
import type { World } from '../app/world';
import { BodyPanel } from './BodyPanel';
import { FilterPanel, LegendLine } from './FilterPanel';
import { InfoPanel } from './InfoPanel';
import { CloudIcon, SkyIcon } from './icons';
import { FLOATING_BUTTON, OPENED } from './Panel';
import { SearchBox } from './SearchBox';
import { SkyPanel } from './SkyPanel';
import { SkyShowsButton } from './SkyShowsButton';
import { StatusLine } from './StatusLine';
import { TimeBar } from './TimeBar';

/** The space kept between two panels stacked in a column, px; Tailwind's `gap-3`. */
const PANEL_GAP = 12;

/**
 * Caps the height of `panel` to the room between its top and the top of
 * `below`, which shares its column further down, so that the two never
 * overlap however short the window. Measured, rather than set in CSS, because
 * the room depends on how tall `below` is at the moment.
 *
 * `beside` is in the next column along, and counts only while it reaches
 * under the panel: on a window not much wider than the two of them, with
 * `below` folded down to a line, it is what the panel would run into.
 */
function useRoomAbove(
  panel: RefObject<HTMLElement | null>,
  below: RefObject<HTMLElement | null>,
  beside: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useLayoutEffect(() => {
    const top = panel.current;
    const bottom = below.current;
    const next = beside.current;
    if (!active || !top || !bottom) return;
    const refit = () => {
      const box = top.getBoundingClientRect();
      let floor = bottom.getBoundingClientRect().top;
      const other = next?.getBoundingClientRect();
      if (other && other.width > 0 && other.left < box.right && other.right > box.left) {
        floor = Math.min(floor, other.top);
      }
      top.style.maxHeight = `${Math.max(0, floor - box.top - PANEL_GAP)}px`;
    };
    refit();
    // The filters change height when switching what color stands for, and
    // fold away looking up; the time bar grows a strip once there is a place.
    const observer = new ResizeObserver(refit);
    observer.observe(bottom);
    if (next) observer.observe(next);
    window.addEventListener('resize', refit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', refit);
      top.style.maxHeight = '';
    };
  }, [panel, below, beside, active]);
}

/**
 * Placed by named grid areas that change at a fixed breakpoint, so the layout
 * depends on the width of the screen and not on whether the panels happen to
 * fit side by side.
 *   tablet:  filters, status / time, centered
 *   desktop: filters, time, status in one row
 */
const BOTTOM_ROW = [
  'absolute inset-x-3 bottom-3 grid items-end gap-x-3 gap-y-2',
  "grid-cols-[auto_1fr] [grid-template-areas:'filters_status'_'time_time']",
  "lg:grid-cols-[1fr_auto_1fr] lg:[grid-template-areas:'filters_time_status']",
].join(' ');

/**
 * The controls over the scene on anything wider than a phone: search and the
 * sky on the left, what is selected on the right, the filters, the clock and
 * the status along the bottom. The top and the bottom are anchored
 * separately, so a tall panel in one cannot push the other off the screen.
 */
export function DesktopHud({ world }: { world: World }) {
  const selected = useApp((state) => state.selected);
  const watching = useApp((state) => state.watching);
  const haveClouds = useApp((state) => state.cloudsAtMs !== null);
  const showClouds = useApp((state) => state.showClouds);
  const lookingUp = useApp((state) => state.lookingUp);
  const observer = useApp((state) => state.observer);
  // Looking up, the sky is the thing to see, and the filters wait behind
  // the one-line legend until they are asked for.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The selected satellite shows a summary until asked for the rest.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Closed at the start, even with a place remembered: it covers part of the
  // globe, and is one click away on the moon button.
  const [skyOpen, setSkyOpen] = useState(false);
  const skyRef = useRef<HTMLDivElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  useRoomAbove(skyRef, filtersRef, timeRef, skyOpen);
  // A new place replaces what the sky panel shows; start it from the top,
  // not wherever typing the coordinates left it scrolled.
  useEffect(() => {
    if (observer) skyRef.current?.scrollTo({ top: 0 });
  }, [observer]);

  return (
    <>
      <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-3">
        <div className="flex w-80 flex-col gap-3">
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <SearchBox world={world} />
            </div>
            <button
              type="button"
              onClick={() => setSkyOpen((open) => !open)}
              aria-expanded={skyOpen}
              aria-controls="your-sky"
              aria-label="Your sky"
              title="What's over you"
              className={`${FLOATING_BUTTON} text-chalk/80 ${OPENED}`}
            >
              <SkyIcon />
            </button>
            {haveClouds && (
              <button
                type="button"
                onClick={() => useApp.getState().setShowClouds(!showClouds)}
                aria-pressed={showClouds}
                aria-label="Clouds"
                // Says whose data it is, as its license asks.
                title={`${showClouds ? 'Hide' : 'Show'} the clouds (contains modified EUMETSAT data)`}
                className={`${FLOATING_BUTTON} text-graphite aria-pressed:text-chalk/80`}
              >
                <CloudIcon hidden={!showClouds} />
              </button>
            )}
            {lookingUp && <SkyShowsButton />}
          </div>
          {skyOpen && (
            // It shares the left column with the filters, and is fitted to
            // the room above them.
            <div
              id="your-sky"
              ref={skyRef}
              className="thin-scrollbar pointer-events-auto max-h-[calc(50dvh-4.5rem)] overflow-y-auto rounded-2xl lg:max-h-[calc(50dvh-3rem)]"
            >
              <SkyPanel world={world} onClose={() => setSkyOpen(false)} />
            </div>
          )}
        </div>
        {watching !== null && observer && (
          <div className="pointer-events-auto w-72">
            <BodyPanel body={watching} observer={observer} />
          </div>
        )}
        {selected !== null && (
          // Capped and scrollable, so it can never run under the bottom row.
          <div className="thin-scrollbar pointer-events-auto max-h-[calc(100dvh-7.5rem)] w-72 overflow-y-auto rounded-2xl">
            <InfoPanel
              key={selected}
              world={world}
              index={selected}
              expanded={detailsOpen}
              onToggleExpanded={() => setDetailsOpen((open) => !open)}
            />
          </div>
        )}
      </div>

      <div className={BOTTOM_ROW}>
        {/* Looking up, the filters shrink to a line that says what the colors mean, and open from it. */}
        <div ref={filtersRef} className="flex flex-col items-start gap-2 [grid-area:filters]">
          <div id="filters" className={filtersOpen || !lookingUp ? '' : 'hidden'}>
            <FilterPanel world={world} sharingColumn={skyOpen} overLegend={lookingUp} />
          </div>
          {lookingUp && (
            <LegendLine
              world={world}
              open={filtersOpen}
              onToggle={() => setFiltersOpen((open) => !open)}
            />
          )}
        </div>
        <div ref={timeRef} className="justify-self-center [grid-area:time]">
          <TimeBar />
        </div>
        <div className="justify-self-end [grid-area:status]">
          <StatusLine world={world} />
        </div>
      </div>
    </>
  );
}
