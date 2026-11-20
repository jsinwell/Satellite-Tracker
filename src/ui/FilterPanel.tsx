import { constellationColor, REGIME_LABELS, TYPE_COLORS, TYPE_LABELS } from '../app/palette';
import { type ColorBy, useApp } from '../app/store';
import type { World } from '../app/world';
import { OBJECT_TYPES } from '../core/catalog';
import { CONSTELLATION_IDS, CONSTELLATION_LABELS, soleEnabled } from '../core/constellation';
import { ORBIT_REGIMES } from '../core/orbit';
import { formatInteger } from './format';
import { ChevronIcon } from './icons';
import { LaunchSlider } from './LaunchSlider';
import { Panel, SURFACE } from './Panel';

interface ToggleProps {
  label: string;
  /** Shown after the label, quieter: a detail about the group. */
  detail?: string;
  title?: string;
  count: number;
  enabled: boolean;
  /** Legend swatch; omitted for filters that do not affect color. */
  color?: string;
  onToggle(): void;
  /** If given, the row offers to show this group alone. */
  onSolo?(): void;
}

function Toggle({ label, detail, title, count, enabled, color, onToggle, onSolo }: ToggleProps) {
  return (
    <div className="group relative flex items-center">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={enabled}
        title={title}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs text-graphite/70 hover:bg-chalk/10 aria-pressed:text-chalk"
      >
        {/* Filled when shown, hollow when hidden. Color-neutral filters get a neutral square. */}
        <span
          className={`size-2 shrink-0 border border-graphite bg-graphite ${
            color ? 'rounded-full' : 'rounded-[2px]'
          } ${enabled ? '' : '!bg-transparent'}`}
          style={color ? { backgroundColor: color, borderColor: color } : undefined}
        />
        <span className={enabled ? '' : 'line-through'}>{label}</span>
        {detail && <span className="text-graphite">{detail}</span>}
        {/* On rows with an "only" control, the count steps aside for it rather than being overlapped. */}
        <span
          className={`ml-auto pl-3 tabular-nums ${
            onSolo ? 'group-hover:invisible group-has-[:focus-visible]:invisible' : ''
          }`}
        >
          {formatInteger(count)}
        </span>
      </button>
      {onSolo && (
        <button
          type="button"
          onClick={onSolo}
          aria-label={`Show only ${label}`}
          className="absolute right-1.5 hidden rounded-full bg-chalk px-2 py-px text-2xs font-medium text-night group-hover:block group-has-[:focus-visible]:block hover:bg-chalk/85"
        >
          only
        </button>
      )}
    </div>
  );
}

const COLOR_MODES: { value: ColorBy; label: string }[] = [
  { value: 'type', label: 'Type' },
  { value: 'constellation', label: 'Constellation' },
];

function formatAltitude(km: number | null): string | undefined {
  if (km === null) return undefined;
  // Round to the nearest 10 km: shells are not sharper than that.
  return `${formatInteger(Math.round(km / 10) * 10)} km`;
}

/** Doubles as the color legend: each swatch is that group's color on the globe. */
/**
 * How tall the panel may be from tablet widths up, by what shares its column:
 * the search box above always, on tablet widths the time bar below, the sky
 * panel if it is open, which then gets the upper half, and the one-line
 * legend under it while looking up.
 */
const HEIGHT_CAPS = {
  alone: 'sm:max-h-[calc(100dvh-8.5rem)] lg:max-h-[calc(100dvh-5.5rem)]',
  aloneOverLegend: 'sm:max-h-[calc(100dvh-11.25rem)] lg:max-h-[calc(100dvh-8.25rem)]',
  sharing: 'sm:max-h-[calc(50dvh-4.5rem)] lg:max-h-[calc(50dvh-3rem)]',
  sharingOverLegend: 'sm:max-h-[calc(50dvh-7.25rem)] lg:max-h-[calc(50dvh-5.75rem)]',
};

interface FilterPanelProps {
  world: World;
  /**
   * The sky panel is open above, in the same column. The filters then keep
   * to the lower half of it, so neither has to cover the other; the sky
   * panel takes whatever they leave.
   */
  sharingColumn: boolean;
  /** The one-line legend is showing under it: see `LegendLine`. */
  overLegend: boolean;
}

export function FilterPanel({ world, sharingColumn, overLegend }: FilterPanelProps) {
  const filters = useApp((state) => state.filters);
  // What each row would show under the other filters, so the numbers follow the globe.
  const counts = useApp((state) => state.counts);
  const colorBy = useApp((state) => state.colorBy);
  const alone = soleEnabled(filters.constellations);
  const { setColorBy, toggleType, toggleRegime, toggleConstellation, soloConstellation } =
    useApp.getState();

  return (
    <Panel
      aria-label="Filters"
      // Scrolls rather than running under the search box on a short window.
      className={`thin-scrollbar max-h-[42dvh] w-56 overflow-y-auto p-1.5 ${
        HEIGHT_CAPS[
          sharingColumn
            ? overLegend
              ? 'sharingOverLegend'
              : 'sharing'
            : overLegend
              ? 'aloneOverLegend'
              : 'alone'
        ]
      }`}
    >
      <fieldset className="mb-1.5 flex gap-0.5 rounded-lg bg-chalk/10 p-0.5 text-xs">
        <legend className="sr-only">Color by</legend>
        {COLOR_MODES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setColorBy(value)}
            aria-pressed={colorBy === value}
            className="flex-1 rounded-md px-2 py-0.5 text-graphite hover:text-chalk aria-pressed:bg-chalk/25 aria-pressed:font-medium aria-pressed:text-chalk"
          >
            {label}
          </button>
        ))}
      </fieldset>

      {colorBy === 'type'
        ? OBJECT_TYPES.filter((type) => world.countByType[type] > 0).map((type) => (
            <Toggle
              key={type}
              label={TYPE_LABELS[type]}
              count={counts.types[type]}
              enabled={filters.types[type]}
              color={TYPE_COLORS[type]}
              onToggle={() => toggleType(type)}
            />
          ))
        : CONSTELLATION_IDS.filter((id) => world.countByConstellation[id] > 0).map((id) => (
            <Toggle
              key={id}
              label={CONSTELLATION_LABELS[id]}
              // "Everything else" spans every altitude, so a typical one would mislead.
              detail={
                id === 'other' ? undefined : formatAltitude(world.altitudeByConstellation[id])
              }
              title={id === 'other' ? undefined : 'Typical altitude of this constellation'}
              count={counts.constellations[id]}
              enabled={filters.constellations[id]}
              color={constellationColor(id, alone === id)}
              onToggle={() => toggleConstellation(id)}
              onSolo={() => soloConstellation(id)}
            />
          ))}
      <hr className="my-1.5 border-chalk/10" />
      {ORBIT_REGIMES.map((regime) => (
        <Toggle
          key={regime}
          label={regime}
          title={REGIME_LABELS[regime]}
          count={counts.regimes[regime]}
          enabled={filters.regimes[regime]}
          onToggle={() => toggleRegime(regime)}
        />
      ))}
      <hr className="my-1.5 border-chalk/10" />
      <LaunchSlider world={world} />
    </Panel>
  );
}

interface LegendEntry {
  label: string;
  color: string;
  /** False if the filters are hiding every satellite of this color. */
  shown: boolean;
}

/** What each color on the globe stands for at the moment, in the legend's order. */
function legendEntries(
  world: World,
  colorBy: ColorBy,
  filters: ReturnType<typeof useApp.getState>['filters'],
): LegendEntry[] {
  if (colorBy === 'type') {
    return OBJECT_TYPES.filter((type) => world.countByType[type] > 0).map((type) => ({
      label: TYPE_LABELS[type],
      color: TYPE_COLORS[type],
      shown: filters.types[type],
    }));
  }
  const alone = soleEnabled(filters.constellations);
  const muted = constellationColor('other', false);
  const entries: LegendEntry[] = [];
  // The groups without a color of their own share one entry, as they share a color.
  const others: LegendEntry = { label: 'Others', color: muted, shown: false };
  let anyOthers = false;
  for (const id of CONSTELLATION_IDS) {
    if (world.countByConstellation[id] === 0) continue;
    const color = constellationColor(id, alone === id);
    if (color === muted) {
      anyOthers = true;
      others.shown ||= filters.constellations[id];
    } else {
      entries.push({ label: CONSTELLATION_LABELS[id], color, shown: filters.constellations[id] });
    }
  }
  if (anyOthers) entries.push(others);
  return entries;
}

interface LegendLineProps {
  world: World;
  /** Whether the filters it opens are showing. */
  open: boolean;
  onToggle(): void;
}

/**
 * The legend on one line: what each color stands for, and nothing else. It
 * stands in for the filters while looking up, where the sky is the thing to
 * see, and opens them. Not on a phone, which has a button for that already
 * and no width for this. And between the `lg` and `xl` breakpoints, where
 * the time bar has just moved up beside it and left it a couple of hundred
 * pixels, the colors go without their names.
 */
export function LegendLine({ world, open, onToggle }: LegendLineProps) {
  const filters = useApp((state) => state.filters);
  const colorBy = useApp((state) => state.colorBy);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="filters"
      aria-label="Filters"
      title={open ? 'Hide the filters' : 'Show the filters'}
      className={`pointer-events-auto hidden max-w-full items-center gap-2.5 rounded-full py-2 pr-3 pl-3.5 text-xs text-chalk/80 hover:text-chalk sm:flex ${SURFACE}`}
    >
      {/* It wraps, onto lines that are cut off: an entry there is no room for drops out whole. */}
      <span className="flex h-4 min-w-0 flex-wrap gap-x-3 overflow-hidden">
        {legendEntries(world, colorBy, filters).map(({ label, color, shown }) => (
          <span
            key={label}
            className={`flex h-4 items-center gap-1.5 ${shown ? '' : 'text-graphite/70 line-through'}`}
          >
            <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
            <span className="lg:hidden xl:inline">{label}</span>
          </span>
        ))}
      </span>
      <span className="hidden lg:inline xl:hidden">Filters</span>
      <span className="shrink-0 text-graphite">
        <ChevronIcon pointing={open ? 'down' : 'up'} />
      </span>
    </button>
  );
}
