'use client';

import { Glyph, type GlyphName } from '@/components/glass-icon';

export type SortBy = 'room' | 'agency' | 'product';

interface GroupingToggleProps {
  value: SortBy;
  onChange: (value: SortBy) => void;
  className?: string;
}

const OPTIONS: { key: SortBy; label: string; icon: GlyphName }[] = [
  { key: 'room', label: 'Room-wise', icon: 'rooms' },
  { key: 'agency', label: 'Agency-wise', icon: 'agencies' },
  { key: 'product', label: 'Product-wise', icon: 'products' },
];

export function GroupingToggle({ value, onChange, className = '' }: GroupingToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Sort and grouping"
      className={`inline-flex w-full rounded-xl border border-border bg-surface-alt p-1 sm:w-auto ${className}`}
    >
      {OPTIONS.map(({ key, label, icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(key)}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium transition sm:flex-none sm:px-3 ${
              active
                ? 'bg-surface text-accent shadow-xs'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Glyph name={icon} /> {label}
          </button>
        );
      })}
    </div>
  );
}
