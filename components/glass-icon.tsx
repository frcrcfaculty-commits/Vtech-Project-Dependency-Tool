// Glass icons in the spirit of iOS 26 "liquid glass": a frosted, slightly opaque tile with a brand tint, a bright
// rim and a soft inner highlight, holding a simple line glyph. One component so every icon in the app matches.

import type { ReactNode } from 'react';

export type GlyphName =
  | 'building' | 'bell' | 'send' | 'edit' | 'lock' | 'trash' | 'archive' | 'rooms' | 'floors' | 'products'
  | 'check' | 'cross' | 'plus' | 'filter' | 'history' | 'clock' | 'alert' | 'phone' | 'mail' | 'flag' | 'reopen';

const PATHS: Record<GlyphName, ReactNode> = {
  building: <><path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" /><path d="M15 9h4a1 1 0 0 1 1 1v11" /><path d="M8 8h3M8 12h3M8 16h3M3 21h18" /></>,
  bell: <><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  send: <><path d="M21 3 10 14" /><path d="M21 3 14.5 21l-4-7.5L3 9.5z" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10h14V9M10 13h4" /></>,
  rooms: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 12h9V3M12 12v9" /></>,
  floors: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>,
  products: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  cross: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  filter: <path d="M4 5h16l-6 8v6l-4-2v-4z" />,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  alert: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h12l-2 4 2 4H5" /></>,
  reopen: <><path d="M4 12a8 8 0 0 1 14-5.3L20 9" /><path d="M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15" /><path d="M4 20v-5h5" /></>,
};

const TINTS = {
  brand: 'linear-gradient(145deg, rgba(40,17,235,0.85), rgba(97,29,188,0.78) 55%, rgba(149,44,133,0.72))',
  green: 'linear-gradient(145deg, rgba(18,135,90,0.82), rgba(36,170,120,0.7))',
  red: 'linear-gradient(145deg, rgba(212,33,61,0.85), rgba(240,90,110,0.72))',
  amber: 'linear-gradient(145deg, rgba(194,106,0,0.85), rgba(240,160,40,0.72))',
  slate: 'linear-gradient(145deg, rgba(85,77,120,0.7), rgba(132,124,163,0.6))',
  clear: 'linear-gradient(145deg, rgba(255,255,255,0.75), rgba(240,236,255,0.55))',
} as const;

export function Glyph({ name, className = 'h-4 w-4' }: { name: GlyphName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}

export function GlassIcon({
  name,
  tint = 'brand',
  size = 36,
  className = '',
}: {
  name: GlyphName;
  tint?: keyof typeof TINTS;
  size?: number;
  className?: string;
}) {
  const dark = tint === 'clear';
  return (
    <span
      aria-hidden
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${dark ? 'text-accent' : 'text-white'} ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: TINTS[tint],
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.65), inset 0 -1px 0 rgba(0,0,0,0.08), inset 0 0 0 1px rgba(255,255,255,0.35), 0 6px 16px -6px rgba(40,17,120,0.45)',
        backdropFilter: 'blur(14px) saturate(170%)',
        WebkitBackdropFilter: 'blur(14px) saturate(170%)',
      }}
    >
      {/* specular highlight */}
      <span
        className="pointer-events-none absolute inset-x-[8%] top-[4%] h-[46%] rounded-[40%]"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0))' }}
      />
      <Glyph name={name} className="relative h-[52%] w-[52%] drop-shadow-[0_1px_1px_rgba(0,0,0,0.18)]" />
    </span>
  );
}
