import type { ReactNode } from 'react';

export const metadata = { title: 'VTech Site Tracker', description: 'Site dependency tracking for VTech Technologies' };

// Placeholder shell. Antigravity owns everything under app/(app) and components/ — see docs/BRIEF_ANTIGRAVITY.md.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
