// VTech logo ("VTECH – Luxury Home Automation"), from the company's Logo.pdf (2026-11-07): public/vtech-logo.png (transparent).
// The same artwork is embedded in every PDF (lib/pdf/logo.ts) and used in emails (public/vtech-logo-email.png).
/* eslint-disable @next/next/no-img-element */
type Props = {
  /** 'white' = on a dark background: the logo sits on a white chip so the gradient and tagline stay readable. */
  tone?: 'gradient' | 'white' | 'current';
  className?: string;
  title?: string;
};

export function VTechLogo({ tone = 'gradient', className, title = 'VTech – Luxury Home Automation' }: Props) {
  const img = <img src="/vtech-logo.png" alt={title} className={tone === 'white' ? 'h-full w-auto' : className} />;
  if (tone !== 'white') return img;
  return <span className={`inline-flex items-center rounded-xl bg-white px-3 py-1.5 ${className ?? ''}`}>{img}</span>;
}
