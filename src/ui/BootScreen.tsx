import { useApp } from '../app/store';

/** Shown until the catalog has loaded and the simulation is running, or if that fails. */
export function BootScreen() {
  const error = useApp((state) => state.error);

  return (
    <div className="absolute inset-0 grid place-items-center bg-space p-6 text-center">
      {error === null ? (
        <output className="text-sm tracking-wide text-slate-400">
          <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-accent" />
          Loading satellite catalog…
        </output>
      ) : (
        <div role="alert" className="max-w-md">
          <h1 className="text-lg font-semibold text-white">The tracker could not start</h1>
          <p className="mt-2 text-sm text-slate-300">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg border border-white/15 px-4 py-1.5 text-sm text-slate-200 hover:bg-white/10"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
