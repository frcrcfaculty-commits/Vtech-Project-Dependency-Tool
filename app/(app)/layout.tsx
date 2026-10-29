'use client';

import { Suspense, type ReactNode } from 'react';
import { AuthProvider } from '@/components/auth-provider';
import { AddDependencyAnywhere } from '@/components/add-dependency-anywhere';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      {children}
      <Suspense fallback={null}>
        <AddDependencyAnywhere />
      </Suspense>
    </AuthProvider>
  );
}

