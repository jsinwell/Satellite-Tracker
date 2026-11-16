import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { TYPE_COLORS } from '../app/palette';
import { useApp } from '../app/store';
import type { World } from '../app/world';
import type { SearchResults } from '../core/search';
import { formatInteger } from './format';

/**
 * A one-letter query matches thousands of satellites. Only the best few are
 * ever rendered; the rest are summarised as a count.
 */
const MAX_RESULTS = 40;

function summarize({ indices, total }: SearchResults): string {
  if (total === 0) return 'No satellites match.';
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

  const results = useMemo(() => world.search.search(query, MAX_RESULTS), [world, query]);
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
    <div className="pointer-events-auto relative">
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search satellites by name, NORAD ID or designator"
        aria-expanded={showResults}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          showResults && results.indices.length > 0 ? optionId(active) : undefined
        }
        autoComplete="off"
        spellCheck={false}
        placeholder="Search satellites…  ( / )"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="w-full rounded-xl border border-white/10 bg-slate-950/75 px-4 py-2.5 text-sm text-slate-100 shadow-xl shadow-black/40 backdrop-blur-md outline-none placeholder:text-slate-500 focus:border-accent/60 [&::-webkit-search-cancel-button]:hidden"
      />

      {showResults && (
        <div className="absolute top-full right-0 left-0 z-10 mt-2 overflow-hidden rounded-xl border border-white/10 bg-slate-950/90 shadow-xl shadow-black/40 backdrop-blur-md">
          <div
            id={listId}
            role="listbox"
            aria-label="Matching satellites"
            className="max-h-80 overflow-y-auto py-1"
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
                  className="flex cursor-pointer items-center gap-2.5 px-4 py-1.5 text-sm aria-selected:bg-white/10"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: TYPE_COLORS[satellite.objectType] }}
                  />
                  <span className="truncate text-slate-100">{satellite.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-xs text-slate-500">
                    {satellite.noradId}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="border-t border-white/10 px-4 py-1.5 text-xs text-slate-500">
            {summarize(results)}
          </p>
        </div>
      )}
    </div>
  );
}
