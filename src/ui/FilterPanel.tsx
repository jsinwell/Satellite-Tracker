import { constellationColor, REGIME_LABELS, TYPE_COLORS, TYPE_LABELS } from '../app/palette';
import { type ColorBy, useApp } from '../app/store';
import type { World } from '../app/world';
import { OBJECT_TYPES } from '../core/catalog';
import { CONSTELLATION_IDS, CONSTELLATION_LABELS, soleEnabled } from '../core/constellation';
import { ORBIT_REGIMES } from '../core/orbit';
import { formatInteger } from './format';
import { LaunchSlider } from './LaunchSlider';
import { Panel } from './Panel';

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
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-slate-500 hover:bg-white/10 aria-pressed:text-slate-200"
      >
        {/* Filled when shown, hollow when hidden. Color-neutral filters get a neutral square. */}
        <span
          className={`size-2 shrink-0 border border-slate-400 bg-slate-400 ${
            color ? 'rounded-full' : 'rounded-[2px]'
          } ${enabled ? '' : '!bg-transparent'}`}
          style={color ? { backgroundColor: color, borderColor: color } : undefined}
        />
        <span className={enabled ? '' : 'line-through'}>{label}</span>
        {detail && <span className="text-slate-500">{detail}</span>}
        {/* On rows with an "only" control, the count steps aside for it rather than being overlapped. */}
        <span
          className={`ml-auto pl-3 font-mono tabular-nums ${
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
          className="absolute right-1 hidden rounded bg-slate-800 px-1.5 py-0.5 text-[0.65rem] font-medium text-accent group-hover:block group-has-[:focus-visible]:block hover:bg-slate-700"
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
export function FilterPanel({ world }: { world: World }) {
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
      className="max-h-[calc(100dvh-5.5rem)] w-56 overflow-y-auto p-1.5"
    >
      <fieldset className="mb-1.5 flex gap-0.5 rounded-md bg-white/5 p-0.5 text-xs">
        <legend className="sr-only">Color by</legend>
        {COLOR_MODES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setColorBy(value)}
            aria-pressed={colorBy === value}
            className="flex-1 rounded px-2 py-0.5 text-slate-400 hover:text-slate-200 aria-pressed:bg-white/10 aria-pressed:text-slate-100"
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
      <hr className="my-1.5 border-white/10" />
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
      <hr className="my-1.5 border-white/10" />
      <LaunchSlider world={world} />
    </Panel>
  );
}
