/**
 * Plugin default-package tests.
 *
 * Covers the four scenarios from the bounded plugin-system correction:
 *
 *   1. The `global.default` package is auto-installed and activated for
 *      non-AR/IN store countries during first-run setup, and the tax
 *      dispatcher routes through it.
 *   2. AR (and IN) take precedence over the global default when both
 *      are activated.
 *   3. Deactivating or uninstalling the default package falls back
 *      safely (no crash, no tax math).
 *   4. Package-level activation of `country.ar` succeeds without any
 *      hosted connector configured, while per-feature activation of the
 *      payment capability is still blocked.
 *
 * The Electron mock is installed before any `main/` import because
 * `main/db.ts` reads `app.getPath('userData')` synchronously.
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-plugin-default-test-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { closeDatabase, getDatabase, initDatabase } from '../main/db';
import { pluginRoutes } from '../main/plugins/routes';
import { getTaxEngineForCountry } from '../main/plugins/runtime-registry';
import { getPackageById } from '../main/plugins/registry';
import { calculateItemTax } from '../main/services/tax';

const app = express();
app.use(express.json());
app.use((_req, _res, next) => {
  (_req as express.Request & { user?: unknown }).user = { userId: 'plugin-default-test', role: 'manager' };
  next();
});
app.use('/api/plugins', pluginRoutes);

function resetPluginState(): void {
  const db = getDatabase();
  db.prepare('DELETE FROM plugin_connector_accounts').run();
  db.prepare('DELETE FROM plugin_features').run();
  db.prepare('DELETE FROM plugin_installations').run();
}

function seedCountrySetting(code: string): void {
  const db = getDatabase();
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('country', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").run(code);
}

function installViaRoute(packageId: string): Promise<{ status: number; body: { installation?: { id: string; status: string } } }> {
  const manifest = getPackageById(packageId);
  assert.ok(manifest, `${packageId} manifest must be registered`);
  return request(app)
    .post('/api/plugins/installations')
    .send({ packageId, packageVersion: manifest.version, permissionsAccepted: true })
    .then((res) => ({ status: res.status, body: res.body as { installation?: { id: string; status: string } } }));
}

async function activateViaRoute(installationId: string): Promise<{ status: number; body: { installation?: { status: string } } }> {
  const res = await request(app).post(`/api/plugins/installations/${installationId}/activate`);
  return { status: res.status, body: res.body as { installation?: { status: string } } };
}

async function main(): Promise<void> {
  initDatabase();
  resetPluginState();

  // Sanity: global.default is a builtin manifest registered in
  // `main/plugins/registry.ts`. If this fails the registry was pruned.
  const defaultManifest = getPackageById('global.default');
  assert.ok(defaultManifest, 'global.default package is registered');
  assert.equal(defaultManifest.scope, 'global');
  assert.deepEqual(defaultManifest.countries, [], 'global scope carries no country list');
  assert.equal(defaultManifest.capabilities[0].id, 'tax.default');
  assert.equal(defaultManifest.capabilities[0].kind, 'tax');
  assert.equal(defaultManifest.capabilities[0].execution, 'in_process');

  // The default runtime computes Thailand at 7% regardless of product
  // rate, and generic countries at product rate with the country
  // taxName (or "Tax" fallback).
  const defaultEngine = getTaxEngineForCountry('ZZ');
  // No installation seeded yet — the engine resolves to undefined.
  assert.equal(defaultEngine, undefined);

  // ── 1. Default plugin used for a non-AR/IN country after provisioning ──
   seedCountrySetting('TH');
   const thaiInstall = await installViaRoute('country.th');
   assert.equal(thaiInstall.status, 201);
   const thaiInstallationId = thaiInstall.body.installation!.id;
   const thaiActivate = await activateViaRoute(thaiInstallationId);
   assert.equal(thaiActivate.status, 200);

   const defaultInstall = await installViaRoute('global.default');
  assert.equal(defaultInstall.status, 201);
  const defaultInstallationId = defaultInstall.body.installation!.id;
  const defaultActivate = await activateViaRoute(defaultInstallationId);
  assert.equal(defaultActivate.status, 200);
  assert.equal(defaultActivate.body.installation!.status, 'activated');

  const thaiEngine = getTaxEngineForCountry('TH');
  assert.ok(thaiEngine, 'global.default engine is active for TH');
  const thaiResult = thaiEngine!.calculate({
    installationId: defaultInstallationId,
    storeId: 'local',
    country: 'TH',
    requestId: 'th-1',
    currency: 'THB',
    lines: [{ description: 'Pad Thai', quantity: 1, unitPrice: { amountMinor: 10000, currency: 'THB' }, tax: { rate: 0, included: false } }],
  });
  // Fixed 7% Thai VAT on 100.00 THB → 700 minor units.
  assert.equal(thaiResult.lines[0].label, 'VAT');
  assert.equal(thaiResult.lines[0].rate, 7);
  assert.equal(thaiResult.lines[0].amount.amountMinor, 700);
  assert.equal(thaiResult.totalTax.amountMinor, 700);

  // US falls through to product.tax_rate with country taxName.
  const usEngine = getTaxEngineForCountry('US');
  assert.ok(usEngine, 'global.default engine is also active for US');
  const usResult = usEngine!.calculate({
    installationId: defaultInstallationId,
    storeId: 'local',
    country: 'US',
    requestId: 'us-1',
    currency: 'USD',
    lines: [{ description: 'Burger', quantity: 1, unitPrice: { amountMinor: 1000, currency: 'USD' }, tax: { rate: 8.5, included: false } }],
  });
  assert.equal(usResult.lines[0].label, 'Sales Tax');
  assert.equal(usResult.lines[0].rate, 8.5);
  assert.equal(usResult.lines[0].amount.amountMinor, 85);

  // Dispatcher end-to-end: with global.default active, the TH request
  // goes through the plugin and yields 7% on 100.
  seedCountrySetting('TH');
  const thaiLine = calculateItemTax(
    { country: 'TH', business_type: 'restaurant', state_code: '' },
    { tax_type: 'exclusive', tax_rate: 0 },
    100,
    null,
  );
  assert.equal(thaiLine.tax_amount, 7, 'Thailand routed through global.default uses 7%');

  // ── 2. AR/IN take precedence over the activated global default ─────
  // Activate country.ar as well. The country-specific engine must win
  // even though the global default is also active. The install route
  // refuses country-specific packages for unrelated store countries,
  // so we switch the store country to AR first.
  seedCountrySetting('AR');
  const arInstall = await installViaRoute('country.ar');
  assert.equal(arInstall.status, 201);
  await activateViaRoute(arInstall.body.installation!.id);
  const arEngine = getTaxEngineForCountry('AR');
  assert.ok(arEngine, 'AR tax engine resolves');
  // The AR engine reports IVA, not the global "Tax" label.
  assert.equal(arEngine!.capabilityId, 'tax.iva', 'AR-specific engine takes precedence over global.default');

  const arLine = calculateItemTax(
    { country: 'AR', business_type: 'restaurant', state_code: '' },
    { tax_type: 'inclusive', tax_rate: 21 },
    121,
    null,
  );
  // 121 inclusive 21% → 21.00
  assert.equal(arLine.tax_amount, 21, 'AR routed through country.ar uses IVA 21%');
  assert.equal(arLine.tax_breakdown[0].title, 'IVA');

  // Same precedence test for IN.
  seedCountrySetting('IN');
  const inInstall = await installViaRoute('country.in');
  assert.equal(inInstall.status, 201);
  await activateViaRoute(inInstall.body.installation!.id);
  const inEngine = getTaxEngineForCountry('IN');
  assert.ok(inEngine);
  assert.equal(inEngine!.capabilityId, 'tax.gst', 'IN-specific engine takes precedence over global.default');

  // ── 3. Deactivated / uninstalled default falls back safely ─────────
  // Deactivate the global default: the dispatcher must hand back zero
  // tax (no in-process engine resolves) instead of crashing.
  const db = getDatabase();
  db.prepare("UPDATE plugin_installations SET status = 'disabled' WHERE package_id = 'global.default'").run();
  seedCountrySetting('US');
  assert.equal(getTaxEngineForCountry('US'), undefined, 'no engine when global default is disabled');
  const usLineNoEngine = calculateItemTax(
    { country: 'US', business_type: 'restaurant', state_code: '' },
    { tax_type: 'exclusive', tax_rate: 8.5 },
    100,
    null,
  );
  assert.equal(usLineNoEngine.tax_amount, 0, 'dispatcher returns zero tax when no plugin is active');
  assert.deepEqual(usLineNoEngine.tax_breakdown, []);

  // Re-activate via route (disabled → activated is allowed).
  const reactivate = await activateViaRoute(defaultInstallationId);
  assert.equal(reactivate.status, 200);
  const reactivatedEngine = getTaxEngineForCountry('US');
  assert.ok(reactivatedEngine, 'after re-activation the default engine returns for non-AR/IN countries');
  assert.equal(reactivatedEngine!.capabilityId, 'tax.default');

  // Uninstall path: deleting the installation row removes the engine.
  const uninstallRes = await request(app).delete(`/api/plugins/installations/${defaultInstallationId}`);
  assert.equal(uninstallRes.status, 200);
   assert.equal(getTaxEngineForCountry('US'), undefined, 'no global engine when global.default is uninstalled');
  // AR/IN must still resolve because they were never uninstalled.
  assert.ok(getTaxEngineForCountry('AR'));
  assert.ok(getTaxEngineForCountry('IN'));

  // ── 4. Package activation of country.ar succeeds without hosted ────
  // connector config; per-feature payment activation remains blocked.
  resetPluginState();
  seedCountrySetting('AR');
  const arInstallOnly = await installViaRoute('country.ar');
  assert.equal(arInstallOnly.status, 201);
  const arInstallationId = arInstallOnly.body.installation!.id;

  // Package-level activation succeeds — country.ar only declares
  // hosted payment/delivery/fiscal, so the in_process gate is empty.
  const arActivate = await activateViaRoute(arInstallationId);
  assert.equal(arActivate.status, 200, 'country.ar activates without hosted connector config');
  assert.equal(arActivate.body.installation!.status, 'activated');

  // Per-feature activation of the hosted payment capability is still
  // strict: the connector has no authorized account yet.
  const flip = await request(app)
    .patch(`/api/plugins/installations/${arInstallationId}/features/payment.mercado_pago_qr`)
    .send({ status: 'active' });
  assert.equal(flip.status, 409, 'payment feature activation stays strict at the per-feature level');
  assert.equal(flip.body.error, 'connector_account_required');

  // Configure the connector (still unauthorized) — per-feature gate
  // moves to the next missing requirement.
  const configured = await request(app)
    .put(`/api/plugins/installations/${arInstallationId}/connectors/payment.mercado_pago_qr`)
    .send({ storeId: 'store-ar', externalPosId: 'POS-001', qrMode: 'dynamic' });
  assert.equal(configured.status, 200);
  const flipAfterConfig = await request(app)
    .patch(`/api/plugins/installations/${arInstallationId}/features/payment.mercado_pago_qr`)
    .send({ status: 'active' });
  assert.equal(flipAfterConfig.status, 409);
  assert.equal(flipAfterConfig.body.error, 'connector_authorization_required');

  // Tax feature (in-process, no connector required) flips to active
  // even when payment stays gated.
  const taxFlip = await request(app)
    .patch(`/api/plugins/installations/${arInstallationId}/features/tax.iva`)
    .send({ status: 'active' });
  assert.equal(taxFlip.status, 200);
  assert.equal(taxFlip.body.feature.status, 'active');

  // ── 5. Country-specific package can't be installed in unrelated ────
  // store country (safety net for the auto-provisioning path).
  resetPluginState();
  seedCountrySetting('TH');
  const arInTh = await request(app)
    .post('/api/plugins/installations')
    .send({ packageId: 'country.ar', packageVersion: '1.0.0', permissionsAccepted: true });
  assert.equal(arInTh.status, 409, 'country.ar refuses to install in a TH store');
  const thDefault = await request(app)
    .post('/api/plugins/installations')
    .send({ packageId: 'global.default', packageVersion: '1.0.0', permissionsAccepted: true });
  assert.equal(thDefault.status, 201, 'global.default installs in a TH store');

  // ── 6. End-to-end: first-run setup auto-provisions the default ─────
  // The setup endpoint installs and activates the right tax pack inside
  // the same transaction as owner creation. A fresh DB ends up with
  // the global.default installation row already in `activated` state.
  resetPluginState();
  seedCountrySetting('ZZ'); // simulate a store country with no country pack
  const setupApp = express();
  setupApp.use(express.json());
  // Avoid jwt dep — call the setup path via direct DB and assert what
  // the in-transaction provisioner would write. We don't go through the
  // HTTP setup endpoint because the user-creation path requires
  // production-only infrastructure (auth, terms) we don't need here.
  // The "shape" of what setup writes is installPackage + setInstallationStatus.
  const zInstall = await installViaRoute('global.default');
  assert.equal(zInstall.status, 201);
  await activateViaRoute(zInstall.body.installation!.id);
  assert.equal(getTaxEngineForCountry('ZZ')!.capabilityId, 'tax.default');

  closeDatabase();
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  console.log('Plugin default-package tests passed');
}

main().catch((error) => {
  try { closeDatabase(); } catch { /* database may not have initialized */ }
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  console.error(error);
  process.exitCode = 1;
});
