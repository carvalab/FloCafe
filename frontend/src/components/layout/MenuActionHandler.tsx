'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { MasterPinPrompt } from '@/components/settings/MasterPinPrompt';

type PendingPinAction = 'backup' | 'restore' | null;

export default function MenuActionHandler() {
  const router = useRouter();
  const [pendingPinAction, setPendingPinAction] = useState<PendingPinAction>(null);

  async function runBackup(pin: string) {
    if (!window.electronAPI?.backupDatabase) return { success: false, error: 'Not available' };

    toast.loading('Creating backup...', { id: 'backup' });
    const result = await window.electronAPI.backupDatabase(pin);
    toast.remove('backup');

    if (result.success) {
      toast.success(`Backup saved to ${result.path}`);
    } else if (result.error !== 'Cancelled') {
      toast.error(`Backup failed: ${result.error}`);
    }
    return result;
  }

  async function runRestore(pin: string) {
    if (!window.electronAPI?.restoreBackup) return { success: false, error: 'Not available' };

    const result = await window.electronAPI.restoreBackup(pin);
    if (result.success) {
      toast.success('Database restored successfully. Restarting...');
      setTimeout(() => window.location.reload(), 1500);
    } else if (result.error !== 'Cancelled') {
      toast.error(`Restore failed: ${result.error}`);
    }
    return result;
  }

  async function handlePinSubmit(pin: string) {
    const result = pendingPinAction === 'backup' ? await runBackup(pin) : await runRestore(pin);
    if (result.success || result.error === 'Cancelled') {
      setPendingPinAction(null);
    }
    return result;
  }

  async function beginPinGatedAction(action: 'backup' | 'restore') {
    const status = await window.electronAPI?.getMasterPinStatus?.();

    if (!status?.available) {
      // No OS-backed encryption on this machine — the gate is inert, proceed directly.
      if (action === 'backup') runBackup('');
      else runRestore('');
      return;
    }

    if (!status.isSet) {
      toast.error('Set a Master PIN in Settings → Data before performing this action');
      router.push('/settings?tab=data&action=master-pin');
      return;
    }

    setPendingPinAction(action);
  }

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.onMenuAction) return;

    const unsubscribe = window.electronAPI.onMenuAction((action: string) => {
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
          beginPinGatedAction('backup');
          break;
        case 'restore-backup':
          beginPinGatedAction('restore');
          break;
        case 'menu-db-health-check':
          router.push('/settings?tab=data&action=health-check');
          break;
        case 'menu-db-initialize':
          router.push('/settings?tab=data&action=initialize-db');
          break;
        case 'menu-master-pin':
          router.push('/settings?tab=data&action=master-pin');
          break;
        default:
          console.log('[Menu] Unknown action:', action);
      }
    });

    return () => { unsubscribe?.(); };
  }, [router]);

  return (
    <MasterPinPrompt
      open={pendingPinAction !== null}
      mode="verify"
      title={pendingPinAction === 'backup' ? 'Confirm Backup' : 'Confirm Restore'}
      description="Enter your device Master PIN to continue."
      onCancel={() => setPendingPinAction(null)}
      onSubmit={handlePinSubmit}
    />
  );
}
