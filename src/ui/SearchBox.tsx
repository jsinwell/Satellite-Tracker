import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { satelliteColor } from '../app/palette';
import { useApp } from '../app/store';
import type { World } from '../app/world';
import { soleEnabled } from '../core/constellation';
import type { SearchResults } from '../core/search';
import { formatInteger } from './format';
import { SearchIcon } from './icons';
import { SURFACE } from './Panel';

/**
 * A one-letter query matches thousands of satellites. Only the best few are
 * ever rendered; the rest are summarized as a count.
 */
const MAX_RESULTS = 40;

function summarize({ indices, total }: SearchResults, filtered: boolean): string {
  // Say so when filters may be why: otherwise a hidden satellite just looks missing.
  if (total === 0)
    return filtered ? 'No matches among the satellites shown.' : 'No satellites match.';
  if (total > indices.length) {
    return `Showing the best ${indices.length} of ${formatInteger(total)} matches`;
  }
  return total === 1 ? '1 match' : `${formatInteger(total)} matches`;
}

export function SearchBox({ world }: { world: World }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Search covers what is on the globe: a satellite hidden by the filters is not offered.
  const visible = useApp((state) => state.visible);
  const filtered = useApp((state) => state.visibleCount < world.satellites.length);
  const colorBy = useApp((state) => state.colorBy);
  const alone = useApp((state) => soleEnabled(state.filters.constellations));
  const results = useMemo(
    () => world.search.search(query, MAX_RESULTS, visible),
    [world, query, visible],
  );
  const showResults = open && query.trim() !== '';
  const optionId = (position: number) => `${listId}-option-${position}`;

  // "/" focuses the search from anywhere, as on most data-heavy sites.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Keep the keyboard-highlighted option in view.
  useEffect(() => {
    if (showResults) {
      document.getElementById(`${listId}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [showResults, listId, active]);

  const choose = (index: number) => {
    useApp.getState().selectAndFocus(index);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = results.indices.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setOpen(true);
        setActive((position) => Math.min(position + 1, last));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((position) => Math.max(position - 1, 0));
        break;
      case 'Enter': {
        const index = results.indices[active];
        if (showResults && index !== undefined) choose(index);
        break;
      }
      case 'Escape':
        setQuery('');
        inputRef.current?.blur();
        break;
    }
  };

  return (
    <div className="@container pointer-events-auto relative">
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search satellites by name, NORAD ID or designator"
        aria-expanded={showResults}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-keyshortcuts="/"
        aria-activedescendant={
          showResults && results.indices.length > 0 ? optionId(active) : undefined
        }
        autoComplete="off"
        spellCheck={false}
        placeholder="Search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={`peer w-full rounded-full py-2.5 pr-4 pl-9 text-sm text-chalk outline-none placeholder:text-graphite focus:border-chalk/40 [&::-webkit-search-cancel-button]:hidden ${SURFACE}`}
      />
      <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-graphite peer-focus:text-chalk">
        <SearchIcon />
      </span>
      {/*
        The key that brings the keyboard here. Not on a phone, which has no
        such key, nor where the box is too narrow to hold it and the words.
      */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3.5 hidden -translate-y-1/2 rounded-md bg-chalk/10 px-1.5 py-px text-2xs text-graphite sm:@[9rem]:peer-placeholder-shown:block"
      >
        /
      </span>

      {showResults && (
        <div className="absolute top-full right-0 left-0 z-10 mt-2 overflow-hidden rounded-2xl border border-chalk/10 bg-night/90 backdrop-blur-xl backdrop-saturate-150">
          <div
            id={listId}
            role="listbox"
            aria-label="Matching satellites"
            className="thin-scrollbar max-h-80 overflow-y-auto py-1"
          >
            {results.indices.map((index, position) => {
              const satellite = world.satellites[index];
              return (
                <div
                  key={satellite.noradId}
                  id={optionId(position)}
                  role="option"
                  aria-selected={position === active}
                  // Focus stays in the input; it points here via aria-activedescendant.
                  tabIndex={-1}
                  // mousedown, not click: it fires before the input's blur closes the list.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(index);
                  }}
                  onMouseEnter={() => setActive(position)}
                  className="flex cursor-pointer items-center gap-2.5 px-4 py-1.5 text-sm aria-selected:bg-chalk/10"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: satelliteColor(world, index, colorBy, alone) }}
                  />
                  <span className="truncate text-chalk">{satellite.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-graphite tabular-nums">
                    {satellite.noradId}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="border-t border-chalk/10 px-4 py-1.5 text-xs text-graphite">
            {summarize(results, filtered)}
          </p>
        </div>
      )}
    </div>
  );
}
