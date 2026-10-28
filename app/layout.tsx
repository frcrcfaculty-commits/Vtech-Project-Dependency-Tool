import type { ReactNode } from 'react';
import type { Viewport } from 'next';
import './globals.css';

export const metadata = {
  title: 'VTech Site Tracker',
  description: 'Site dependency tracking for VTech Technologies',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
