import type { ReactNode } from 'react';
import { useApp } from '../app/store';
import { SKY_SHOWS, type SkyShows } from '../core/brightness';
import { SURFACE } from './Panel';

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinejoin: 'round',
  strokeLinecap: 'round',
} as const;

/** The three answers to which satellites the view from the ground shows. */
export const SKY_SHOWS_CHOICES: Record<
  SkyShows,
  { name: string; showing: string; icon: ReactNode }
> = {
  eye: {
    name: 'By eye',
    showing: 'the satellites you could see by eye',
    icon: (
      <>
        <path
          d="M2.5 10s2.8-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.8 4.5-7.5 4.5S2.5 10 2.5 10Z"
          {...stroke}
        />
        <circle cx="10" cy="10" r="2" {...stroke} />
      </>
    ),
  },
  binoculars: {
    name: 'Binoculars',
    showing: 'the satellites binoculars would show',
    icon: (
      <>
        <circle cx="6" cy="12.5" r="3.2" {...stroke} />
        <circle cx="14" cy="12.5" r="3.2" {...stroke} />
        <path d="M5 9.4 6.6 5h1.8l.6 4.6M15 9.4 13.4 5h-1.8L11 9.6M9 11.5h2" {...stroke} />
      </>
    ),
  },
  all: {
    name: 'All',
    showing: 'every satellite above the horizon',
    icon: (
      <>
        <circle cx="5" cy="6" r="1.3" fill="currentColor" />
        <circle cx="12" cy="4.5" r="1.3" fill="currentColor" />
        <circle cx="15.5" cy="10" r="1.3" fill="currentColor" />
        <circle cx="8.5" cy="11" r="1.3" fill="currentColor" />
        <circle cx="4.5" cy="15" r="1.3" fill="currentColor" />
        <circle cx="13" cy="15.5" r="1.3" fill="currentColor" />
      </>
    ),
  },
};

/**
 * Which satellites the view from the ground shows: the ones that could be
 * seen from there, by eye or with binoculars, drawn as the lights they are;
 * or all of them, marked. One button that steps through the three, so that
 * it takes no more room than the one answer it shows.
 */
export function SkyShowsButton() {
  const shows = useApp((state) => state.skyShows);
  const next = SKY_SHOWS[(SKY_SHOWS.indexOf(shows) + 1) % SKY_SHOWS.length];
  const { name, showing, icon } = SKY_SHOWS_CHOICES[shows];
  return (
    <button
      type="button"
      onClick={() => useApp.getState().setSkyShows(next)}
      aria-label={`Satellites shown: ${name}`}
      title={`Showing ${showing}. Click for ${SKY_SHOWS_CHOICES[next].name.toLowerCase()}.`}
      className={`pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-full px-3 text-xs text-chalk/80 hover:text-chalk ${SURFACE}`}
    >
      <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
        {icon}
      </svg>
      <span>{name}</span>
    </button>
  );
}
