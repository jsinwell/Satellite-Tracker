import { REGIME_LABELS, TYPE_COLORS, TYPE_LABELS } from '../app/palette';
import { useApp } from '../app/store';
import type { World } from '../app/world';
import { OBJECT_TYPES } from '../core/catalog';
import { ORBIT_REGIMES } from '../core/orbit';
import { formatInteger } from './format';
import { LaunchSlider } from './LaunchSlider';
import { Panel } from './Panel';

interface ToggleProps {
  label: string;
  title?: string;
  count: number;
  enabled: boolean;
  /** Legend swatch; omitted for filters that do not affect color. */
  color?: string;
  onToggle(): void;
}

function Toggle({ label, title, count, enabled, color, onToggle }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      title={title}
      className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-slate-500 hover:bg-white/10 aria-pressed:text-slate-200"
    >
      {/* Filled when shown, hollow when hidden. Color-neutral filters get a neutral square. */}
      <span
        className={`size-2 shrink-0 border border-slate-400 bg-slate-400 group-aria-[pressed=false]:!bg-transparent ${
          color ? 'rounded-full' : 'rounded-[2px]'
        }`}
        style={color ? { backgroundColor: color, borderColor: color } : undefined}
      />
      <span className="group-aria-[pressed=false]:line-through">{label}</span>
      <span className="ml-auto pl-3 font-mono tabular-nums">{formatInteger(count)}</span>
    </button>
  );
}

/** Doubles as the color legend: each object type's swatch is its color on the globe. */
export function FilterPanel({ world }: { world: World }) {
  const filters = useApp((state) => state.filters);
  const toggleType = useApp((state) => state.toggleType);
  const toggleRegime = useApp((state) => state.toggleRegime);

  return (
    <Panel aria-label="Filters" className="w-52 p-1.5">
      {OBJECT_TYPES.filter((type) => world.countByType[type] > 0).map((type) => (
        <Toggle
          key={type}
          label={TYPE_LABELS[type]}
          count={world.countByType[type]}
          enabled={filters.types[type]}
          color={TYPE_COLORS[type]}
          onToggle={() => toggleType(type)}
        />
      ))}
      <hr className="my-1.5 border-white/10" />
      {ORBIT_REGIMES.map((regime) => (
        <Toggle
          key={regime}
          label={regime}
          title={REGIME_LABELS[regime]}
          count={world.countByRegime[regime]}
          enabled={filters.regimes[regime]}
          onToggle={() => toggleRegime(regime)}
        />
      ))}
      <hr className="my-1.5 border-white/10" />
      <LaunchSlider world={world} />
    </Panel>
  );
}
