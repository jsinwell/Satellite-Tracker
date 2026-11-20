import { useApp } from '../app/store';

/** Shown until the catalog has loaded and the simulation is running, or if that fails. */
export function BootScreen() {
  const error = useApp((state) => state.error);

  return (
    <div className="absolute inset-0 grid place-items-center bg-space p-6 text-center font-sans">
      {error === null ? (
        <output className="text-sm text-graphite">
          <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-chalk" />
          Loading the satellite catalog…
        </output>
      ) : (
        <div role="alert" className="max-w-md">
          <h1 className="atlas-name text-base text-chalk">The tracker could not start</h1>
          <p className="mt-2 text-sm text-chalk/80">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded border border-chalk/30 px-4 py-1.5 text-sm text-chalk hover:bg-chalk/10"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
