import { useCallback, useMemo } from 'react';
import { useAuthStore } from '@/store/auth';
import { getCountryByCode } from '@/lib/countries';

export function useFormatDate() {
  const currentTenant = useAuthStore((s) => s.currentTenant);
  
  const locale = useMemo(() => {
    if (!currentTenant?.country) return 'en-US';
    return getCountryByCode(currentTenant.country)?.locale ?? 'en-US';
  }, [currentTenant?.country]);

  const timeZone = currentTenant?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const formatDate = useCallback((date?: string | Date | number | null, options?: Intl.DateTimeFormatOptions) => {
    if (!date) return '';
    try {
      const d = new Date(date);
      if (isNaN(d.getTime())) return String(date);
      return new Intl.DateTimeFormat(locale, {
        timeZone,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        ...options
      }).format(d);
    } catch {
      return String(date);
    }
  }, [locale, timeZone]);

  const formatTime = useCallback((date?: string | Date | number | null, options?: Intl.DateTimeFormatOptions) => {
    if (!date) return '';
    try {
      const d = new Date(date);
      if (isNaN(d.getTime())) return String(date);
      return new Intl.DateTimeFormat(locale, {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        ...options
      }).format(d);
    } catch {
      return String(date);
    }
  }, [locale, timeZone]);

  const formatDateTime = useCallback((date?: string | Date | number | null, options?: Intl.DateTimeFormatOptions) => {
    if (!date) return '';
    try {
      const d = new Date(date);
      if (isNaN(d.getTime())) return String(date);
      return new Intl.DateTimeFormat(locale, {
        timeZone,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        ...options
      }).format(d);
    } catch {
      return String(date);
    }
  }, [locale, timeZone]);

  return { formatDate, formatTime, formatDateTime };
}
