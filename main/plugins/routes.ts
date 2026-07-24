/**
 * Plugin management routes.
 *
 * Owner/manager-only. The proposal's Stage 1 surfaces four read endpoints
 * and three write endpoints. Public webhook endpoints and external
 * package loaders are explicitly NOT wired here — that's Stage 3.
 *
 * All routes are mounted under /api/plugins by main/routes/index.ts.
 *
 *   GET    /api/plugins/catalog
 *   GET    /api/plugins/installations
 *   GET    /api/plugins/installations/:id/configuration-status
 *   GET    /api/plugins/available-countries
 *   GET    /api/plugins/payment-methods
 *   POST   /api/plugins/installations       body: { packageId, packageVersion }
 *   POST   /api/plugins/installations/:id/activate
 *   POST   /api/plugins/installations/:id/deactivate
 *   PATCH  /api/plugins/installations/:id/features/:capabilityId   body: { status, notes? }
 *   PUT    /api/plugins/installations/:id/connectors/:capabilityId body: connector config
 *   DELETE /api/plugins/installations/:id   (uninstall)
 *
 * Activation gate: payment and delivery capabilities require a verified
 * connector account. The route refuses to mark a feature as `active`
 * unless the connector has `authStatus: 'authorized'` AND `readiness:
 * 'verified'`. For Stage 1 hosted providers, the `readiness` field is
 * updated only by the Stage 3 broker; the route cannot set it itself.
 */

import { Router, Request, Response } from 'express';
import { requireRole } from '../middleware/security';
import {
  getCatalog,
  getCatalogEntry,
  getStoreCountry,
  isListingAvailableForCountry,
} from './catalog';
import { getAllPackages, getPackageById } from './registry';
import {
  installPackage,
  findInstallationByPackageId,
  hasGrantedPermission,
  uninstallPackage,
  setInstallationStatus,
  setFeatureStatus,
  upsertConnectorAccount,
  getConnectorAccountConfig,
  getInstallation,
  listFeatures,
  listConnectorAccounts,
} from './installations';
import { validateManifest } from './manifest';
import { PluginConnectorConfigSchema } from './api-types';
import { getConnectorHandler } from './connector-handlers';
import type { ConfigurationStatus, PluginPaymentMethod } from './api-types';

const router = Router();

function badRequest(res: Response, message: string): Response {
  return res.status(400).json({ error: message });
}

function notFound(res: Response, message: string): Response {
  return res.status(404).json({ error: message });
}

function hasSecretLikeKey(value: unknown, depth = 0): string | undefined {
  if (depth > 32 || !value || typeof value !== 'object') return undefined;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[A-Z]/g, (letter) => `_${letter}`).toLowerCase();
    const words = normalized.split(/[^a-z0-9]+/).filter(Boolean);
    if (words.some((word) => ['secret', 'token', 'password', 'credential'].includes(word))) return key;
    const nested = hasSecretLikeKey(child, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

router.get('/catalog', requireRole('owner', 'manager'), (req: Request, res: Response) => {
  try {
    const override = typeof req.query.country === 'string' ? req.query.country : undefined;
    const country = override || getStoreCountry();
    const catalog = getCatalog(country);
    res.json({ country, catalog });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/payment-methods', requireRole('owner', 'manager', 'cashier'), (_req: Request, res: Response) => {
  try {
    const methods: PluginPaymentMethod[] = [
      { key: 'cash', labelKey: 'pos.methodCash', provider: 'core', primitive: 'cash' as const },
      { key: 'card', labelKey: 'pos.methodCard', provider: 'core', primitive: 'card' as const },
      { key: 'qr', labelKey: 'pos.methodQr', provider: 'core', primitive: 'qr' as const },
    ];
    for (const entry of getCatalog()) {
      if (entry.installation?.status !== 'activated') continue;
      for (const capability of entry.capabilities) {
        if (capability.kind !== 'payment') continue;
        const feature = entry.features.find((item) => item.capabilityId === capability.id);
        if (feature?.status !== 'active') continue;
         const key = capability.id;
         if (methods.some((method) => method.key === key)) continue;
         methods.push({
           key,
           label: capability.displayName,
           provider: capability.provider || 'plugin',
           primitive: capability.primitive,
         });
      }
    }
    res.json({ methods });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/available-countries', requireRole('owner', 'manager'), (_req: Request, res: Response) => {
  try {
    const countries = Array.from(
      new Set(getAllPackages().flatMap((m) => m.countries.map((c) => c.toUpperCase()))),
    ).sort();
    const activeCountry = getStoreCountry();
    res.json({
      activeCountry,
      countries,
      packages: getAllPackages().map((m) => ({
        id: m.id,
        version: m.version,
        scope: m.scope,
        countries: m.countries,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/installations', requireRole('owner', 'manager'), (_req: Request, res: Response) => {
  try {
    const { listInstallations } = require('./installations');
    res.json({ installations: listInstallations() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/installations/:id/configuration-status', requireRole('owner', 'manager'), (req: Request, res: Response) => {
  try {
    const installation = getInstallation(req.params.id);
    if (!installation) return notFound(res, 'Installation not found');
    const manifest = getPackageById(installation.packageId);
    if (!manifest) return notFound(res, 'Package manifest not found for installation');

    const features = listFeatures(installation.id);
    const connectors = listConnectorAccounts(installation.id);

    const featureRows = manifest.capabilities.map((cap) => {
      const row = features.find((f) => f.capabilityId === cap.id);
      const status = row?.status ?? 'inactive';
       const missing: ConfigurationStatus['features'][number]['missingRequirements'] = [];
      const warnings: string[] = [];

      // tax / fiscal capabilities don't require an external account, but
      // payment and delivery do. Surface that as the activation gate.
       if (cap.execution === 'hosted' && cap.kind !== 'admin') {
        const account = connectors.find((c) => c.capabilityId === cap.id);
        if (!account) {
          missing.push('connector_account');
        } else {
          if (account.authStatus !== 'authorized') missing.push('connector_authorization');
           if (account.readiness !== 'verified') {
             missing.push('connector_verification_hosted');
           }
        }
      }
      if (status === 'active' && missing.length > 0) {
        warnings.push('feature_active_but_requirements_missing');
      }
      return {
        capabilityId: cap.id,
        status,
        requirementsMet: missing.length === 0,
        missingRequirements: missing,
        warnings,
      };
    });

    const connectorRows = connectors.map((c) => ({
      connectorId: c.id,
      capabilityId: c.capabilityId,
      provider: c.provider,
      authStatus: c.authStatus,
      readiness: c.readiness,
      lastHealthCheckAt: c.lastHealthCheckAt,
    }));

    const payload: ConfigurationStatus = {
      installationId: installation.id,
      packageId: installation.packageId,
      packageVersion: installation.packageVersion,
      features: featureRows,
      connectors: connectorRows,
    };
    res.json(payload);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/installations', requireRole('owner', 'manager'), (req: Request, res: Response) => {
  try {
    const { packageId, packageVersion } = req.body || {};
    if (typeof packageId !== 'string' || !packageId) return badRequest(res, 'packageId is required');
    if (typeof packageVersion !== 'string' || !packageVersion) return badRequest(res, 'packageVersion is required');

    const manifest = getPackageById(packageId);
    if (!manifest) return notFound(res, `Unknown package "${packageId}"`);
    if (manifest.version !== packageVersion) {
      return badRequest(res, `packageVersion ${packageVersion} does not match catalog version ${manifest.version}`);
    }
    const validation = validateManifest(manifest);
    if (!validation.valid) return res.status(400).json({ error: 'Manifest failed validation', details: validation.errors });
    if (req.body?.permissionsAccepted !== true) {
      return badRequest(res, 'permissionsAccepted must be true before installation');
    }

    if (!isListingAvailableForCountry(manifest, getStoreCountry())) {
      return res.status(409).json({ error: `Package "${packageId}" is not available for the current store country` });
    }

    const existing = findInstallationByPackageId(packageId);
    if (existing && existing.packageVersion !== packageVersion) {
      return res.status(409).json({
        error: `Package "${packageId}" is already installed at version ${existing.packageVersion}; upgrade is not supported yet`,
      });
    }

    const installed = installPackage({
      packageId,
      packageVersion,
      installedBy: (req as any).user?.userId ?? null,
      grantedPermissions: manifest.permissions,
    });
    res.status(201).json({ installation: installed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/installations/:id/activate', requireRole('owner', 'manager'), (req: Request, res: Response) => {
  try {
    const installation = getInstallation(req.params.id);
    if (!installation) return notFound(res, 'Installation not found');
    if (installation.status === 'uninstalled') return res.status(409).json({ error: 'installation_uninstalled' });
    const manifest = getPackageById(installation.packageId);
    if (!manifest) return notFound(res, 'Package manifest not found for installation');
    for (const cap of manifest.capabilities) {
      // Only in-process payment/delivery capabilities are gating at the
      // package level. Hosted capabilities are declarations the Stage 3
      // broker will verify; their per-feature activation is gated by
      // PATCH /features/:capabilityId instead. Tax (in-process or
      // otherwise) and fiscal never block package activation here.
      if (cap.kind !== 'payment' && cap.kind !== 'delivery') continue;
      if (cap.execution !== 'in_process') continue;
      const requiredPermission = cap.kind === 'payment' ? 'payment.write' : 'delivery.events';
      if (!hasGrantedPermission(installation.id, requiredPermission)) {
        return res.status(403).json({ error: 'permission_not_granted', permission: requiredPermission, capabilityId: cap.id });
      }
      const account = listConnectorAccounts(installation.id).find((c) => c.capabilityId === cap.id);
      if (!account) return res.status(409).json({ error: 'connector_account_required', capabilityId: cap.id });
      if (account.authStatus !== 'authorized') {
        return res.status(409).json({ error: 'connector_authorization_required', capabilityId: cap.id });
      }
      if (account.readiness !== 'verified') {
        return res.status(409).json({ error: 'connector_verification_required', capabilityId: cap.id });
      }
    }
     const updated = setInstallationStatus(installation.id, 'activated');
     for (const capability of manifest.capabilities) {
       if (capability.execution === 'in_process') setFeatureStatus(installation.id, capability.id, 'active');
     }
     res.json({ installation: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/installations/:id/deactivate', requireRole('owner', 'manager'), (req: Request, res: Response) => {
  try {
    const installation = getInstallation(req.params.id);
    if (!installation) return notFound(res, 'Installation not found');
    const updated = setInstallationStatus(installation.id, 'disabled');
    res.json({ installation: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/installations/:id', requireRole('owner', 'manager'), (req: Request, res: Response) => {
  try {
    const installation = getInstallation(req.params.id);
    if (!installation) return notFound(res, 'Installation not found');
    const removed = uninstallPackage(installation.id);
    if (!removed) return notFound(res, 'Installation not found');
    res.json({ id: installation.id, uninstalled: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/installations/:id/features/:capabilityId', requireRole('owner', 'manager'), (req: Request, res: Response) => {
  try {
    const installation = getInstallation(req.params.id);
    if (!installation) return notFound(res, 'Installation not found');
    const manifest = getPackageById(installation.packageId);
    if (!manifest) return notFound(res, 'Package manifest not found for installation');
    const cap = manifest.capabilities.find((c) => c.id === req.params.capabilityId);
    if (!cap) return notFound(res, `Unknown capability "${req.params.capabilityId}" for package "${manifest.id}"`);
    const requiredPermission = cap.kind === 'payment'
      ? 'payment.write'
      : cap.kind === 'delivery'
        ? 'delivery.events'
        : cap.kind === 'fiscal' || cap.kind === 'tax'
          ? 'fiscal.write'
          : null;
    if (requiredPermission && !hasGrantedPermission(installation.id, requiredPermission)) {
      return res.status(403).json({ error: 'permission_not_granted', permission: requiredPermission });
    }

    const status = (req.body || {}).status;
    const validStatuses = ['inactive', 'activating', 'active', 'deactivating', 'deactivated'];
    if (typeof status !== 'string' || !validStatuses.includes(status)) {
      return badRequest(res, `status must be one of ${validStatuses.join(', ')}`);
    }
    // Activation gate: payment and delivery features require a verified
    // connector account before they're allowed to flip to `active`.
     if (status === 'active' && cap.execution === 'hosted' && cap.kind !== 'admin') {
      const account = listConnectorAccounts(installation.id).find((c) => c.capabilityId === cap.id);
      if (!account) return res.status(409).json({ error: 'connector_account_required' });
      if (account.authStatus !== 'authorized') return res.status(409).json({ error: 'connector_authorization_required' });
      if (account.readiness !== 'verified') {
        return res.status(409).json({
          error: cap.execution === 'hosted' ? 'connector_verification_hosted' : 'connector_verification_required',
        });
      }
    }

    const notes = typeof (req.body || {}).notes === 'string' ? (req.body || {}).notes : null;
    const feature = setFeatureStatus(installation.id, cap.id, status as any, notes);
    res.json({ feature });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/installations/:id/connectors/:capabilityId', requireRole('owner', 'manager'), (req: Request, res: Response) => {
  try {
    const installation = getInstallation(req.params.id);
    if (!installation) return notFound(res, 'Installation not found');
    const manifest = getPackageById(installation.packageId);
    if (!manifest) return notFound(res, 'Package manifest not found for installation');
    const cap = manifest.capabilities.find((c) => c.id === req.params.capabilityId);
    if (!cap) return notFound(res, `Unknown capability "${req.params.capabilityId}" for package "${manifest.id}"`);

    const requiredPermission = cap.kind === 'payment' ? 'payment.write'
      : cap.kind === 'delivery' ? 'delivery.events'
        : cap.kind === 'fiscal' || cap.kind === 'tax' ? 'fiscal.write' : null;
    if (requiredPermission && !hasGrantedPermission(installation.id, requiredPermission)) {
      return res.status(403).json({ error: 'permission_not_granted', permission: requiredPermission });
    }

     const body = req.body || {};
     const bodyValidation = PluginConnectorConfigSchema.safeParse(body);
     if (!bodyValidation.success) {
       return badRequest(res, 'Connector config must be a JSON object no larger than 32 KiB');
     }
     // Refuse anything that looks like a raw secret. Stage 1 has no
    // broker to receive secrets anyway — the merchant UI should hand
    // off authorization through the hosted connector in Stage 3.
    const secretKey = hasSecretLikeKey(body);
    if (secretKey) return res.status(400).json({ error: `Secret-like field "${secretKey}" must not be sent to the POS. Use the hosted connector instead.` });

    const provider = cap.provider || cap.kind;
    const handler = getConnectorHandler(provider);
    if (!handler) {
      // Unknown provider: refuse and point at the package owner. Don't
      // silently fall back to a generic "store the raw config" branch.
      return res.status(400).json({
        error: `No connector handler registered for provider "${provider}"`,
        provider,
      });
    }

    const validation = handler.validate(body);
    if (!validation.valid) {
      return badRequest(res, `Invalid ${provider} connector config: ${validation.errors.join('; ')}`);
    }

    const readiness = isTruthy(validation.resolved) ? 'configured' : 'unconfigured';
    const account = upsertConnectorAccount({
      installationId: installation.id,
      packageId: installation.packageId,
      capabilityId: cap.id,
      provider,
      providerAccountRef: typeof body.providerAccountRef === 'string' ? body.providerAccountRef : null,
      authStatus: 'unauthorized',
      readiness,
      config: validation.resolved,
    });

    const configRow = getConnectorAccountConfig(account.id);
    const resolvedConfig = configRow?.configJson ? JSON.parse(configRow.configJson) : null;
    const summary = handler.summarize(account, resolvedConfig);

    res.json({ connector: account, summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

/**
 * Internal helper for tests and the tax service: returns the activated
 * plugin manifest for a country, or null when none is installed/active.
 * Stage 1 only matches one package per country, so this is a single row.
 */
export function getActiveManifestForCountry(country: string): ReturnType<typeof getCatalogEntry> {
  return getCatalogEntry(getPackageById(`country.${country.toLowerCase()}`)?.id || '', country);
}

export const pluginRoutes = router;
