'use client';

import { Suspense, type ReactNode } from 'react';
import { AuthProvider } from '@/components/auth-provider';
import { AddDependencyFab } from '@/components/v4/add-dependency-fab';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      {children}
      <Suspense fallback={null}>
        <AddDependencyFab />
      </Suspense>
    </AuthProvider>
  );
}

