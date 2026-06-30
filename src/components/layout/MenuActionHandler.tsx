'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

declare global {
  interface Window {
    electronAPI?: {
      onMenuAction: (callback: (action: string) => void) => void;
      backupDatabase: () => Promise<{ success: boolean; path?: string; error?: string }>;
      restoreBackup: () => Promise<{ success: boolean; error?: string }>;
      getAppInfo: () => Promise<{
        version: string;
        name: string;
        electron: string;
        node: string;
        platform: string;
      }>;
      getStatus: () => Promise<{
        server: string;
        memory: { heapUsed: number; heapTotal: number; rss: number };
        uptime: number;
        port: number;
      }>;
      platform: string;
    };
  }
}

export default function MenuActionHandler() {
  const router = useRouter();

  async function handleBackup() {
    console.log('[MenuActionHandler] handleBackup called');
    if (!window.electronAPI?.backupDatabase) {
      console.error('[MenuActionHandler] backupDatabase API not available');
      return;
    }

    toast.loading('Creating backup...', { id: 'backup' });
    const result = await window.electronAPI.backupDatabase();
    console.log('[MenuActionHandler] backup result:', result);
    toast.remove('backup');

    if (result.success) {
      toast.success(`Backup saved to ${result.path}`);
    } else {
      toast.error(`Backup failed: ${result.error}`);
    }
  }

  async function handleRestore() {
    if (!window.electronAPI?.restoreBackup) return;

    const result = await window.electronAPI.restoreBackup();
    if (result.success) {
      toast.success('Database restored successfully. Restarting...');
      setTimeout(() => window.location.reload(), 1500);
    } else if (result.error !== 'Cancelled') {
      toast.error(`Restore failed: ${result.error}`);
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.onMenuAction) return;

    window.electronAPI.onMenuAction((action: string) => {
      console.log('[Menu] Action received:', action);

      switch (action) {
        case 'new-order':
          router.push('/pos');
          break;
        case 'quick-search':
          router.push('/pos');
          break;
        case 'view-orders':
          router.push('/orders');
          break;
        case 'report-daily':
        case 'report-sales':
        case 'report-x':
        case 'report-z':
          router.push('/reports');
          break;
        case 'settings-business':
        case 'settings-tax':
        case 'settings-printer':
        case 'settings-kitchen':
          router.push('/settings');
          break;
        case 'backup-database':
          handleBackup();
          break;
        case 'restore-backup':
          handleRestore();
          break;
        default:
          console.log('[Menu] Unknown action:', action);
      }
    });
  }, [router]);

  return null;
}
