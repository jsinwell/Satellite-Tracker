import { useEffect } from 'react';
import { useApp } from './app/store';
import { setLabelLayer } from './scene/labelLayer';
import { Scene } from './scene/Scene';
import { BootScreen } from './ui/BootScreen';
import { DesktopHud } from './ui/DesktopHud';
import { HoverLabel } from './ui/HoverLabel';
import { usePhoneScreen } from './ui/hooks';
import { PhoneHud } from './ui/PhoneHud';

/**
 * Escape backs out one step: out of choosing a place on the globe, off a
 * ride, up from the ground, and last of all out of the selection. Not while
 * a text field wants the key.
 */
function useEscapeToDeselect() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.target instanceof HTMLInputElement) return;
      const state = useApp.getState();
      if (state.pickingObserver) state.setPickingObserver(false);
      else if (state.riding) state.setRiding(false);
      else if (state.watching !== null) state.watch(null);
      else if (state.lookingUp) state.setLookingUp(false);
      else state.select(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

export function App() {
  const phase = useApp((state) => state.phase);
  const world = useApp((state) => state.world);
  const phone = usePhoneScreen();
  useEscapeToDeselect();

  if (phase !== 'ready' || world === null) return <BootScreen />;

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-space font-sans text-chalk">
      <h1 className="sr-only">Satellite Tracker</h1>
      <div className="absolute inset-0">
        <Scene world={world} />
      </div>
      {/* Text the scene pins to places on the globe; under the HUD, over the canvas. */}
      <div
        ref={setLabelLayer}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      />

      {/*
        The HUD floats over the scene; only its panels take pointer input. A
        phone has a layout of its own, and not a narrower one of the same:
        what goes at the sides of a wide screen has nowhere to go on it.
      */}
      <div className="pointer-events-none absolute inset-0">
        {phone ? <PhoneHud world={world} /> : <DesktopHud world={world} />}
      </div>

      <HoverLabel world={world} />
    </main>
  );
}
