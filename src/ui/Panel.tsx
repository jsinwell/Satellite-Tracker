import type { ComponentProps } from 'react';

/** The translucent surface every piece of the HUD sits on. */
export function Panel({ className = '', ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={`pointer-events-auto rounded-xl border border-white/10 bg-slate-950/75 shadow-xl shadow-black/40 backdrop-blur-md ${className}`}
      {...props}
    />
  );
}
