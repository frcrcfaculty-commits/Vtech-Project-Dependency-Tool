'use client';

import { use, useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/client/supabase';
import { AppHeader } from '@/components/app-header';
import { RoomProductPicker } from '@/components/room-product-picker';
import Link from 'next/link';

export default function RoomDependenciesPage({
  params,
}: {
  params: Promise<{ projectId: string; roomId: string }>;
}) {
  const { projectId, roomId } = use(params);
  const [projectName, setProjectName] = useState<string>('');

  useEffect(() => {
    async function loadProject() {
      const sb = supabaseBrowser();
      const { data } = await sb.from('projects').select('name').eq('id', projectId).single();
      if (data) setProjectName(data.name);
    }
    loadProject();
  }, [projectId]);

  return (
    <div className="min-h-dvh bg-surface-alt pb-16">
      <AppHeader />

      <main className="mx-auto max-w-4xl px-4 pt-6 space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <Link
              href={`/projects/${projectId}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text-primary mb-2"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back to {projectName || 'Project'}
            </Link>
            <h1 className="text-xl font-bold tracking-tight text-text-primary">
              Room Products — {projectName}
            </h1>
            <p className="text-xs text-text-secondary mt-1">
              Place products VTech sells with location and step tracking.
            </p>
          </div>

        </div>

        {/* Room Picker Component */}
        <RoomProductPicker projectId={projectId} roomId={roomId} />
      </main>
    </div>
  );
}
