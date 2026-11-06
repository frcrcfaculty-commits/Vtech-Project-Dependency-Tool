'use client';

import { use } from 'react';
import { AppHeader } from '@/components/app-header';
import { ReminderBoard } from '@/components/v10/reminder-board';

export default function ProjectRemindersPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);

  return (
    <div className="min-h-dvh bg-surface-alt pb-24">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 pt-5">
        <ReminderBoard projectId={projectId} showBreadcrumbNav={true} />
      </main>
    </div>
  );
}
