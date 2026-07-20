'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { KdsLoginForm } from '@/components/kds/KdsLoginForm';
import { KdsWorkspace } from '@/components/kds/KdsWorkspace';
import { useKdsConnection } from '@/hooks/useKdsConnection';
import { useSyncServerLanguage } from '@/lib/i18n';
import type { KdsViewMode } from '@/hooks/useKdsView';

// Dashboard `/kds` runs on the main API origin (port 3001), which has
// `/api/settings/kds` but not `/api/kds/info` (that one lives on the
// standalone KDS server). Fetch the default view from the main API instead
// of `useServerKdsInfo` so chef toggles reflect admin-set defaults here.
function useDashboardKdsDefault(): KdsViewMode | null {
  const [view, setView] = useState<KdsViewMode | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get('/settings/kds')
      .then(({ data }) => {
        if (cancelled) return;
        setView(data?.kds_default_view === 'kanban' ? 'kanban' : 'tabs');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return view;
}

export default function KdsPage() {
  useSyncServerLanguage();
  const conn = useKdsConnection({ api });
  const kdsDefaultView = useDashboardKdsDefault();

  if (conn.loading || !conn.user) return <KdsLoginForm conn={conn} />;
  return <KdsWorkspace conn={conn} serverDefault={kdsDefaultView} />;
}