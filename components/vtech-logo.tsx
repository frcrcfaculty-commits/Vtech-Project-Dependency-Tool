// VTech wordmark, traced from the company's email signature (white on a blue → violet → magenta band).
// Brand colours sampled from the same artwork: #2811EB (blue), #611DBC (violet), #952C85 (magenta), #6F01EC (purple).
import { useId } from 'react';
import { VTECH_REGISTERED, VTECH_WORDMARK_PATH, VTECH_WORDMARK_VIEWBOX } from '@/lib/brand';

type Props = {
  /** 'gradient' fills the letters with the brand gradient; 'white' / 'currentColor' are solid. */
  tone?: 'gradient' | 'white' | 'current';
  className?: string;
  title?: string;
};

export function VTechLogo({ tone = 'gradient', className, title = 'VTech' }: Props) {
  const id = useId().replace(/:/g, '');
  const fill = tone === 'gradient' ? `url(#vt-g-${id})` : tone === 'white' ? '#fff' : 'currentColor';
  const { cx, cy, r } = VTECH_REGISTERED;
  return (
    <svg viewBox={VTECH_WORDMARK_VIEWBOX} className={className} role="img" aria-label={title}>
      {tone === 'gradient' && (
        <defs>
          <linearGradient id={`vt-g-${id}`} x1="0" y1="0" x2="1" y2="0.35">
            <stop offset="0" stopColor="#2811EB" />
            <stop offset="0.55" stopColor="#5B1BC9" />
            <stop offset="1" stopColor="#952C85" />
          </linearGradient>
        </defs>
      )}
      <path fill={fill} d={VTECH_WORDMARK_PATH} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={fill} strokeWidth={0.9} />
      <text x={cx} y={cy + 2.1} fontFamily="Arial,Helvetica,sans-serif" fontSize={6} fontWeight={700} textAnchor="middle" fill={fill}>
        R
      </text>
    </svg>
  );
}
