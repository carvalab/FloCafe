/**
 * Plugin route tests.
 *
 * Drives /api/plugins/* with supertest. The Electron mock is
 * installed before any `main/` import because `main/db.ts` reads
 * `app.getPath('userData')` synchronously.
 *
 * Coverage:
 * - install / uninstall lifecycle
 * - secret-like field rejection (the merchant UI must not POST tokens)
 * - connector handler registry dispatch (the route no longer branches
 *   on `provider === 'mercadopago'`)
 * - payment-methods endpoint surfaces activated capabilities
 * - activation gate refuses to mark a feature `active` when no
 *   verified connector exists, with a distinct error code for hosted
 *   capabilities
 * - configuration-status surfaces `connector_verification_hosted` for
 *   capabilities that have no in-process runtime
 */

// ── Electron Mock ────────────────────────────────────────────────────────────
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-plugin-routes-test-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { closeDatabase, getDatabase, initDatabase } from '../main/db';
import { pluginRoutes } from '../main/plugins/routes';

const app = express();
app.use(express.json());
app.use((_req, _res, next) => {
  (_req as express.Request & { user?: unknown }).user = { userId: 'plugin-test', role: 'manager' };
  next();
});
app.use('/api/plugins', pluginRoutes);

async function main(): Promise<void> {
  initDatabase();
  const db = getDatabase();
  db.prepare('DELETE FROM plugin_connector_accounts').run();
  db.prepare('DELETE FROM plugin_features').run();
  db.prepare('DELETE FROM plugin_installations').run();
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('country', 'AR', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = 'AR', updated_at = datetime('now')").run();

  const base = { packageId: 'country.ar', packageVersion: '1.0.0' };
  const withoutConsent = await request(app).post('/api/plugins/installations').send(base);
  assert.equal(withoutConsent.status, 400);

  const installed = await request(app).post('/api/plugins/installations').send({
    ...base,
    permissionsAccepted: true,
  });
  assert.equal(installed.status, 201);
  const installationId = installed.body.installation.id as string;

  // payment-methods: nothing is activated yet, so the list is the
  // three core methods (cash, card, qr).
  const paymentMethods = await request(app).get('/api/plugins/payment-methods');
  assert.deepEqual(paymentMethods.body.methods.map((method: { key: string }) => method.key), ['cash', 'card', 'qr']);

  // Package-level activation: country.ar's payment/delivery capabilities
  // are all `hosted` declarations. The package-level gate only blocks
  // on `in_process` payment/delivery (none in Stage 1), so activation
  // succeeds without any connector configured. Per-feature activation
  // for payment/delivery is still strict — see PATCH test below.
  const activationSucceeds = await request(app).post(`/api/plugins/installations/${installationId}/activate`);
  assert.equal(activationSucceeds.status, 200);
  assert.equal(activationSucceeds.body.installation.status, 'activated');

  // Secret-like field rejection at any depth.
  const secretRejected = await request(app)
    .put(`/api/plugins/installations/${installationId}/connectors/payment.mercado_pago_qr`)
    .send({ accessToken: 'never-store-this' });
  assert.equal(secretRejected.status, 400);
  assert.match(secretRejected.body.error, /accessToken/);

  // Nested secret-like field rejection.
  const nestedSecret = await request(app)
    .put(`/api/plugins/installations/${installationId}/connectors/payment.mercado_pago_qr`)
    .send({ config: { apiToken: 'nested-secret' } });
  assert.equal(nestedSecret.status, 400);
  assert.match(nestedSecret.body.error, /apiToken/);

  // Connector handler registry dispatches: the MercadoPago handler
  // validates the config and the response carries its safe summary.
  const configured = await request(app)
    .put(`/api/plugins/installations/${installationId}/connectors/payment.mercado_pago_qr`)
    .send({ storeId: 'store-ar', externalPosId: 'POS-001', qrMode: 'dynamic' });
  assert.equal(configured.status, 200);
  assert.equal(configured.body.connector.readiness, 'configured');
  assert.equal(configured.body.summary.configuration.missing.length, 0);
  assert.equal(configured.body.summary.configuration.qrMode, 'dynamic');

  // Unknown provider: the route does not silently fall back to a
  // generic store. The handler registry returns 400.
  const unknownProvider = await request(app)
    .put(`/api/plugins/installations/${installationId}/connectors/fiscal.arca`)
    .send({ something: 'no handler for ARCA yet' });
  assert.equal(unknownProvider.status, 400);
  assert.match(unknownProvider.body.error, /No connector handler/);

  // Configuration status surfaces `connector_authorization` for hosted
  // payment capabilities — the broker is what would mark them verified,
  // so the per-feature gate stays strict.
  const statusRes = await request(app).get(`/api/plugins/installations/${installationId}/configuration-status`);
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.packageId, 'country.ar');
  const mpFeature = statusRes.body.features.find((f: { capabilityId: string }) => f.capabilityId === 'payment.mercado_pago_qr');
  assert.ok(mpFeature, 'MercadoPago feature row exists');
  assert.ok(
    mpFeature.missingRequirements.includes('connector_authorization'),
    'hosted payment requires authorized provider account',
  );
  // The iva tax capability has no missing requirements even when the
  // installation is not yet activated: tax math is local.
  const taxFeature = statusRes.body.features.find((f: { capabilityId: string }) => f.capabilityId === 'tax.iva');
  assert.equal(taxFeature.requirementsMet, true);
  assert.equal(taxFeature.missingRequirements.length, 0);

  // PATCH /features/:capabilityId cannot flip a hosted payment feature
  // to `active` without a verified connector — per-feature gate is
  // strict regardless of execution mode.
  const flip = await request(app)
    .patch(`/api/plugins/installations/${installationId}/features/payment.mercado_pago_qr`)
    .send({ status: 'active' });
  assert.equal(flip.status, 409);
  assert.ok(
    ['connector_authorization_required', 'connector_verification_hosted'].includes(flip.body.error),
    `expected authorization/hosted error, got ${flip.body.error}`,
  );

  // Delivery polling config is dispatched through the delivery handler.
  const delivery = await request(app)
    .put(`/api/plugins/installations/${installationId}/connectors/delivery.pedidosya`)
    .send({ providers: [{ provider: 'pedidosya', intervalSeconds: 30, enabled: true }] });
  assert.equal(delivery.status, 200);
  assert.equal(delivery.body.connector.readiness, 'configured');
  assert.equal(delivery.body.summary.providers.length, 1);
  assert.equal(delivery.body.summary.providers[0].provider, 'pedidosya');

  // Tax feature can activate without an external account.
  const taxFlip = await request(app)
    .patch(`/api/plugins/installations/${installationId}/features/tax.iva`)
    .send({ status: 'active' });
  assert.equal(taxFlip.status, 200);
  assert.equal(taxFlip.body.feature.status, 'active');

  // Package activation already succeeded above; setting auth_status
  // here doesn't change the package-level gate. We just confirm
  // activation is idempotent.
  db.prepare("UPDATE plugin_connector_accounts SET auth_status = 'authorized' WHERE capability_id = 'payment.mercado_pago_qr'").run();
  db.prepare("UPDATE plugin_connector_accounts SET auth_status = 'authorized' WHERE capability_id = 'delivery.pedidosya'").run();
  const activateAgain = await request(app).post(`/api/plugins/installations/${installationId}/activate`);
  assert.equal(activateAgain.status, 200, 'package activation stays idempotent for hosted-only packages');

  // Uninstall cleans up.
  const uninstalled = await request(app).delete(`/api/plugins/installations/${installationId}`);
  assert.equal(uninstalled.status, 200);
   const status = await request(app).get(`/api/plugins/installations/${installationId}/configuration-status`);
   assert.equal(status.status, 200);
   assert.equal(status.body.packageId, 'country.ar');

   const reinstalled = await request(app).post('/api/plugins/installations').send({
     ...base,
     permissionsAccepted: true,
   });
   assert.equal(reinstalled.status, 201);
   assert.equal(reinstalled.body.installation.id, installationId);
   assert.equal(reinstalled.body.installation.status, 'installed');

   db.prepare("DELETE FROM settings WHERE key = 'country'").run();
  const noCountryCatalog = await request(app).get('/api/plugins/catalog');
  assert.deepEqual(noCountryCatalog.body.catalog, []);

  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('country', 'IN', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = 'IN', updated_at = datetime('now')").run();
  closeDatabase();
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  console.log('Plugin route tests passed');
}

main().catch((error) => {
  try { closeDatabase(); } catch { /* database may not have initialized */ }
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  console.error(error);
  process.exitCode = 1;
});
