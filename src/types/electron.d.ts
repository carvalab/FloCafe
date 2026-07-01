/**
 * Shared type definitions for Electron API exposed via preload.ts.
 * Used across frontend components to avoid `any` casts on window.electronAPI.
 */

export interface ElectronAPI {
  // Menu
  onMenuAction: (callback: (action: string) => void) => void;

  // Database
  backupDatabase: () => Promise<{ success: boolean; path?: string; error?: string }>;
  restoreBackup: () => Promise<{ success: boolean; error?: string }>;

  // App info
  getAppInfo: () => Promise<{
    version: string;
    name: string;
    electron: string;
    node: string;
    platform: string;
  }>;

  // Status
  getStatus: () => Promise<{
    server: string;
    memory: { heapUsed: number; heapTotal: number; rss: number };
    uptime: number;
    port: number;
  }>;

  // Updates
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => (() => void);
  getUpdateStatus: () => Promise<UpdateStatus>;
  checkForUpdates: () => Promise<void>;

  // Platform
  platform: string;
}

export interface UpdateStatus {
  status: 'checking' | 'available' | 'downloading' | 'installing' | 'up-to-date' | 'error' | 'dev-mode';
  info?: {
    version?: string;
    releaseDate?: string;
  };
  progress?: number;
  error?: string;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
