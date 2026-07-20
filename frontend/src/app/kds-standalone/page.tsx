'use client';

import axios from 'axios';
import { KdsLoginForm } from '@/components/kds/KdsLoginForm';
import { KdsWorkspace } from '@/components/kds/KdsWorkspace';
import { useKdsConnection } from '@/hooks/useKdsConnection';
import { useServerKdsInfo } from '@/hooks/useServerKdsInfo';
import { useSyncServerLanguage } from '@/lib/i18n';
import { useMemo } from 'react';

// Standalone axios client — points at this KDS server's origin (e.g. :3002),
// separate from the dashboard's `lib/api` which targets the main backend.
function createStandaloneApi() {
  const api = axios.create({
    baseURL: window.location.origin,
    timeout: 10000,
  });
  api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });
  api.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401) {
        localStorage.removeItem('token');
        window.location.reload();
      }
      return Promise.reject(error);
    },
  );
  return api;
}

export default function KdsStandalonePage() {
  useSyncServerLanguage();
  // Lazy-init the axios instance — must not run during SSR prerender.
  const api = useMemo(() => (typeof window !== 'undefined' ? createStandaloneApi() : null), []);
  const conn = useKdsConnection(api ? { api } : { api: axios.create() });
  const { kdsDefaultView } = useServerKdsInfo(typeof window !== 'undefined' ? window.location.origin : '');

  if (conn.loading || !conn.user) return <KdsLoginForm conn={conn} />;
  return <KdsWorkspace conn={conn} serverDefault={kdsDefaultView} />;
}