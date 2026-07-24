/**
 * Plugin installation state — DB-backed.
 *
 * Persists per-store: which packages are installed, which are activated,
 * per-feature activation state, and per-connector account metadata
 * (without secrets). The schema is defined by migration v33 in main/db.ts.
 *
 * All writes are direct on the better-sqlite3 handle (the migration's
 * `user_version` already enforced a non-destructive upgrade). Reads
 * return the typed shapes from ./types so the route handlers don't deal
 * with raw rows.
 *
 * ponytail: no factory helpers. Each function is one SQL statement, one
 * row shape, one purpose. The handler composes them.
 */

import { getDatabase, now, withTxn } from '../db';
import { getPackageById } from './registry';
import { PluginConnectorConfigSchema } from './api-types';
import type {
  Installation,
  InstallationFeature,
  ConnectorAccount,
  FeatureActivationStatus,
} from './api-types';

interface InstallationRow {
  id: string;
  package_id: string;
  package_version: string;
  status: string;
  installed_at: string;
  activated_at: string | null;
  disabled_at: string | null;
  installed_by: string | null;
  notes: string | null;
  granted_permissions_json: string | null;
}

interface FeatureRow {
  installation_id: string;
  capability_id: string;
  status: string;
  activated_at: string | null;
  deactivated_at: string | null;
  notes: string | null;
}

interface ConnectorRow {
  id: string;
  store_id: string;
  installation_id: string;
  package_id: string;
  capability_id: string;
  provider: string;
  provider_account_ref: string | null;
  auth_status: string;
  readiness: string;
  last_health_check_at: string | null;
  last_error: string | null;
  config_json: string | null;
  created_at: string;
  updated_at: string;
}

function rowToInstallation(row: InstallationRow): Installation {
  let grantedPermissions: string[] = [];
  try {
    const parsed = row.granted_permissions_json ? JSON.parse(row.granted_permissions_json) : [];
    if (Array.isArray(parsed) && parsed.every((permission) => typeof permission === 'string')) {
      grantedPermissions = parsed;
    }
  } catch {
    grantedPermissions = [];
  }
  return {
    id: row.id,
    packageId: row.package_id,
    packageVersion: row.package_version,
    status: row.status as Installation['status'],
    installedAt: row.installed_at,
    activatedAt: row.activated_at,
    disabledAt: row.disabled_at,
    installedBy: row.installed_by,
    notes: row.notes,
    grantedPermissions,
  };
}

function rowToFeature(row: FeatureRow): InstallationFeature {
  return {
    installationId: row.installation_id,
    capabilityId: row.capability_id,
    status: row.status as FeatureActivationStatus,
    activatedAt: row.activated_at,
    deactivatedAt: row.deactivated_at,
    notes: row.notes,
  };
}

function rowToConnector(row: ConnectorRow): ConnectorAccount {
  return {
    id: row.id,
    storeId: row.store_id,
    installationId: row.installation_id,
    packageId: row.package_id,
    capabilityId: row.capability_id,
    provider: row.provider,
    providerAccountRef: row.provider_account_ref,
    authStatus: row.auth_status as ConnectorAccount['authStatus'],
    readiness: row.readiness as ConnectorAccount['readiness'],
    lastHealthCheckAt: row.last_health_check_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function generateInstallationId(): string {
  // Tight prefix + 12 chars makes these easy to spot in logs while
  // remaining collision-resistant in a single-store POS DB.
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 12; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `inst_${suffix}`;
}

function generateConnectorId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 12; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `conn_${suffix}`;
}

export function listInstallations(): Installation[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM plugin_installations ORDER BY installed_at DESC')
    .all() as InstallationRow[];
  return rows.map(rowToInstallation);
}

export function getInstallation(id: string): Installation | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM plugin_installations WHERE id = ?').get(id) as InstallationRow | undefined;
  return row ? rowToInstallation(row) : null;
}

export function hasGrantedPermission(id: string, permission: string): boolean {
  return getInstallation(id)?.grantedPermissions.includes(permission) ?? false;
}

export function findInstallationByPackageId(packageId: string): Installation | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM plugin_installations WHERE package_id = ? ORDER BY installed_at DESC LIMIT 1')
    .get(packageId) as InstallationRow | undefined;
  return row ? rowToInstallation(row) : null;
}

/**
 * Enables the built-in tax package for a configured store only when the
 * merchant has not already made an installation choice.
 */
export function provisionBuiltinTaxPackage(country: string): Installation | null {
  const normalized = country.toUpperCase();
  const countryPackage = normalized ? getPackageById(`country.${normalized.toLowerCase()}`) : undefined;
  const manifest = countryPackage || getPackageById('global.default');
  if (!manifest) return null;

  const existing = findInstallationByPackageId(manifest.id);
  if (existing) return existing;

   const installed = installPackage({
     packageId: manifest.id,
     packageVersion: manifest.version,
     grantedPermissions: manifest.permissions,
   });
   const activated = setInstallationStatus(installed.id, 'activated');
   for (const capability of manifest.capabilities) {
     if (capability.execution === 'in_process') setFeatureStatus(installed.id, capability.id, 'active');
   }
   return activated;
}

export interface InstallOptions {
  packageId: string;
  packageVersion: string;
  installedBy?: string | null;
  notes?: string | null;
  grantedPermissions?: string[];
}

/**
 * Install a package. Installed manifests are immutable: an exact-version
 * reinstall is idempotent, while a new version requires an explicit upgrade
 * flow once compatibility checks exist.
 */
export function installPackage(opts: InstallOptions): Installation {
  const db = getDatabase();
  return withTxn(() => {
    const existing = findInstallationByPackageId(opts.packageId);
     if (existing) {
       if (existing.packageVersion !== opts.packageVersion) {
         throw new Error(
           `Package "${opts.packageId}" is already installed at version ${existing.packageVersion}; upgrade is not supported yet`,
         );
       }
       if (existing.status === 'uninstalled') {
         db.prepare('DELETE FROM plugin_connector_accounts WHERE installation_id = ?').run(existing.id);
         db.prepare('DELETE FROM plugin_features WHERE installation_id = ?').run(existing.id);
         db.prepare(`
           UPDATE plugin_installations
           SET status = 'installed', installed_at = ?, activated_at = NULL, disabled_at = NULL,
               installed_by = ?, notes = ?, granted_permissions_json = ?
           WHERE id = ?
         `).run(
           now(),
           opts.installedBy ?? null,
           opts.notes ?? null,
           JSON.stringify(opts.grantedPermissions ?? []),
           existing.id,
         );
         return getInstallation(existing.id)!;
       }
       return existing;
     }
    const id = generateInstallationId();
     db.prepare(`
       INSERT OR IGNORE INTO plugin_installations
         (id, package_id, package_version, status, installed_at, installed_by, notes, granted_permissions_json)
       VALUES (?, ?, ?, 'installed', ?, ?, ?, ?)
     `).run(
       id,
       opts.packageId,
       opts.packageVersion,
       now(),
       opts.installedBy ?? null,
       opts.notes ?? null,
       JSON.stringify(opts.grantedPermissions ?? []),
     );
     const installed = findInstallationByPackageId(opts.packageId)!;
     if (installed.packageVersion !== opts.packageVersion) {
       throw new Error(
         `Package "${opts.packageId}" is already installed at version ${installed.packageVersion}; upgrade is not supported yet`,
       );
     }
     return installed;
  });
}

export function setInstallationStatus(id: string, status: Installation['status']): Installation | null {
  const db = getDatabase();
  const ts = now();
  if (status === 'activated') {
    db.prepare('UPDATE plugin_installations SET status = ?, activated_at = ?, disabled_at = NULL WHERE id = ?')
      .run(status, ts, id);
  } else if (status === 'disabled') {
    db.prepare('UPDATE plugin_installations SET status = ?, disabled_at = ? WHERE id = ?')
      .run(status, ts, id);
  } else {
    db.prepare('UPDATE plugin_installations SET status = ? WHERE id = ?').run(status, id);
  }
  return getInstallation(id);
}

export function uninstallPackage(id: string): boolean {
  const db = getDatabase();
  return withTxn(() => db.prepare(
    `UPDATE plugin_installations
     SET status = 'uninstalled', disabled_at = COALESCE(disabled_at, ?)
     WHERE id = ? AND status != 'uninstalled'`,
  ).run(now(), id).changes > 0);
}

export function listFeatures(installationId: string): InstallationFeature[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM plugin_features WHERE installation_id = ? ORDER BY capability_id')
    .all(installationId) as FeatureRow[];
  return rows.map(rowToFeature);
}

export function getFeature(installationId: string, capabilityId: string): InstallationFeature | null {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT * FROM plugin_features WHERE installation_id = ? AND capability_id = ?',
  ).get(installationId, capabilityId) as FeatureRow | undefined;
  return row ? rowToFeature(row) : null;
}

export function setFeatureStatus(
  installationId: string,
  capabilityId: string,
  status: FeatureActivationStatus,
  notes: string | null = null,
): InstallationFeature {
  const db = getDatabase();
  return withTxn(() => {
    const ts = now();
    const existing = getFeature(installationId, capabilityId);
    if (existing) {
      const activatedAt = status === 'active' ? existing.activatedAt ?? ts : existing.activatedAt;
      const deactivatedAt = status === 'deactivated' || status === 'inactive' ? ts : null;
      db.prepare(`
        UPDATE plugin_features
        SET status = ?, activated_at = ?, deactivated_at = ?, notes = ?
        WHERE installation_id = ? AND capability_id = ?
      `).run(status, activatedAt, deactivatedAt, notes, installationId, capabilityId);
    } else {
      const activatedAt = status === 'active' ? ts : null;
      const deactivatedAt = status === 'deactivated' ? ts : null;
      db.prepare(`
        INSERT INTO plugin_features (installation_id, capability_id, status, activated_at, deactivated_at, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(installationId, capabilityId, status, activatedAt, deactivatedAt, notes);
    }
    return getFeature(installationId, capabilityId)!;
  });
}

export function listConnectorAccounts(installationId: string): ConnectorAccount[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM plugin_connector_accounts WHERE installation_id = ? ORDER BY created_at')
    .all(installationId) as ConnectorRow[];
  return rows.map(rowToConnector);
}

export interface UpsertConnectorAccountInput {
  storeId?: string;
  installationId: string;
  packageId: string;
  capabilityId: string;
  provider: string;
  providerAccountRef?: string | null;
  authStatus?: ConnectorAccount['authStatus'];
  readiness?: ConnectorAccount['readiness'];
  /** JSON-serializable configuration. Stored as TEXT. */
  config?: unknown;
}

/**
 * Upserts one connector account per (installation, capability). The
 * `config_json` column holds the safe-to-store configuration summary;
 * secrets are explicitly out of scope and rejected by the route layer.
 */
export function upsertConnectorAccount(input: UpsertConnectorAccountInput): ConnectorAccount {
  const db = getDatabase();
  return withTxn(() => {
    const existing = db.prepare(
      'SELECT * FROM plugin_connector_accounts WHERE installation_id = ? AND capability_id = ?',
    ).get(input.installationId, input.capabilityId) as ConnectorRow | undefined;
     const ts = now();
     let configJson: string | null = null;
     if (input.config !== undefined) {
       const parsed = PluginConnectorConfigSchema.safeParse(input.config);
       if (!parsed.success) throw new Error('Connector config must be a JSON object no larger than 32 KiB');
       configJson = JSON.stringify(parsed.data);
     }
    if (existing) {
      db.prepare(`
        UPDATE plugin_connector_accounts
        SET store_id = ?, provider = ?, provider_account_ref = ?, auth_status = ?, readiness = ?, config_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        input.storeId ?? existing.store_id,
        input.provider,
        input.providerAccountRef ?? null,
        input.authStatus ?? existing.auth_status,
        input.readiness ?? existing.readiness,
        configJson,
        ts,
        existing.id,
      );
      const refreshed = db.prepare('SELECT * FROM plugin_connector_accounts WHERE id = ?').get(existing.id) as ConnectorRow;
      return rowToConnector(refreshed);
    }
    const id = generateConnectorId();
    db.prepare(`
      INSERT INTO plugin_connector_accounts
        (id, store_id, installation_id, package_id, capability_id, provider, provider_account_ref, auth_status, readiness, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.storeId ?? 'local',
      input.installationId,
      input.packageId,
      input.capabilityId,
      input.provider,
      input.providerAccountRef ?? null,
      input.authStatus ?? 'unauthorized',
      input.readiness ?? 'unconfigured',
      configJson,
      ts,
      ts,
    );
    const refreshed = db.prepare('SELECT * FROM plugin_connector_accounts WHERE id = ?').get(id) as ConnectorRow;
    return rowToConnector(refreshed);
  });
}

export function getConnectorAccountConfig(id: string): { configJson: string | null; provider: string } | null {
  const db = getDatabase();
  const row = db.prepare('SELECT config_json, provider FROM plugin_connector_accounts WHERE id = ?').get(id) as { config_json: string | null; provider: string } | undefined;
  return row ? { configJson: row.config_json, provider: row.provider } : null;
}
