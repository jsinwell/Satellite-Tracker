import { type RefObject, useEffect, useRef } from 'react';

/**
 * Which way the keyboard is steering the camera, each from −1 to 1: to the
 * right, upward, and in closer.
 */
export interface Steer {
  right: number;
  up: number;
  zoomIn: number;
}

/**
 * By physical key, so WASD stays under the left hand on any keyboard layout.
 * The arrow keys do the same as WASD.
 */
const BINDINGS: Readonly<Record<string, Partial<Steer>>> = {
  KeyW: { up: 1 },
  ArrowUp: { up: 1 },
  KeyS: { up: -1 },
  ArrowDown: { up: -1 },
  KeyA: { right: -1 },
  ArrowLeft: { right: -1 },
  KeyD: { right: 1 },
  ArrowRight: { right: 1 },
  KeyE: { zoomIn: 1 },
  KeyQ: { zoomIn: -1 },
};

const clampUnit = (value: number) => Math.min(1, Math.max(-1, value));

/** How the keys held down steer. Opposite keys cancel; the same way twice is no faster. */
export function steerFrom(pressed: Iterable<string>): Steer {
  const steer: Steer = { right: 0, up: 0, zoomIn: 0 };
  for (const code of pressed) {
    const binding = BINDINGS[code];
    if (!binding) continue;
    steer.right += binding.right ?? 0;
    steer.up += binding.up ?? 0;
    steer.zoomIn += binding.zoomIn ?? 0;
  }
  return {
    right: clampUnit(steer.right),
    up: clampUnit(steer.up),
    zoomIn: clampUnit(steer.zoomIn),
  };
}

export function isSteering({ right, up, zoomIn }: Steer): boolean {
  return right !== 0 || up !== 0 || zoomIn !== 0;
}

/** Whether a key press there is meant for the element: typing, or a slider's arrows. */
function wantsKeys(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * The steering keys being held down, kept up to date as they are pressed and
 * released. Read it each frame; it never causes a render.
 */
export function useSteeringKeys(): RefObject<Set<string>> {
  const pressed = useRef(new Set<string>());
  useEffect(() => {
    const held = pressed.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.code in BINDINGS) || wantsKeys(event.target)) return;
      // Leave the browser's own shortcuts alone.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      held.add(event.code);
      // Arrow keys would otherwise scroll whatever panel has focus.
      if (event.code.startsWith('Arrow')) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => held.delete(event.code);
    // A key released while the window is in the background is never heard.
    const onBlur = () => held.clear();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      held.clear();
    };
  }, []);
  return pressed;
}
