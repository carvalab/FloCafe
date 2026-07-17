'use client';

import api from '@/lib/api';
import { KdsLoginForm } from '@/components/kds/KdsLoginForm';
import { KdsWorkspace } from '@/components/kds/KdsWorkspace';
import { useKdsConnection } from '@/hooks/useKdsConnection';
import { useServerKdsInfo } from '@/hooks/useServerKdsInfo';
import { useSyncServerLanguage } from '@/lib/i18n';

export default function KdsPage() {
  useSyncServerLanguage();
  const conn = useKdsConnection({ api });
  const { kdsDefaultView } = useServerKdsInfo();

  if (conn.loading || !conn.user) return <KdsLoginForm conn={conn} />;
  return <KdsWorkspace conn={conn} serverDefault={kdsDefaultView} />;
}