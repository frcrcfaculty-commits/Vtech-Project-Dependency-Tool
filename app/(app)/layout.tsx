'use client';

import { Suspense, type ReactNode } from 'react';
import { AuthProvider } from '@/components/auth-provider';
import { SendReminderFab } from '@/components/v6/send-reminder-fab';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      {children}
      <Suspense fallback={null}>
        <SendReminderFab />
      </Suspense>
    </AuthProvider>
  );
}

