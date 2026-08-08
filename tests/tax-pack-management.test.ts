/**
 * Integration tests for Settings → Tax pack management.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/tax-pack-management.test.ts
 */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateKeyPairSync, sign } = require('crypto');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-tax-pack-manager-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: true,
        getPath: () => testDir,
        getVersion: () => '2.4.0',
      },
    };
  }
  return originalLoad.apply(this, arguments as any);
};

const {
  initTestDb,
  createApp,
  startServer,
  seedOwnerUser,
  seedManagerUser,
  seedCategory,
  seedProduct,
  installAndActivateTestTaxPack,
  api,
  assert,
  assertEqual,
  getResults,
  closeDatabase,
} = require('./helpers/test-setup');
const { registerRoutes } = require('../main/routes/index');
const { calculateConfiguredChargeTaxes } = require('../main/services/tax');
const {
  installCatalogEntry,
  validationChecklist,
} = require('../main/routes/tax-packs');
const {
  taxPackSha256,
} = require('../main/tax-packs/catalog');
const { LEGACY_TRUSTED_PACK_DIGESTS } = require('../main/routes/tax-packs');
const dualRatePackData = require('./fixtures/synthetic-dual-rate-pack.json');
const flatRatePackData = require('./fixtures/synthetic-flat-rate-pack.json');
// Synthetic stand-ins for the pre-signing-era "official-india"/"official-thailand"
// rows real customer databases still carry. Country/currency stay IN/INR and
// TH/THB so getActiveCountryPack() and ensure-country resolve them the same
// way; the digest is injected below instead of depending on real historical
// tax-pack content, so this test never needs actual GST/VAT data.
const testIndiaPack = { ...dualRatePackData, id: 'test-legacy-in-pack', country: 'IN', currency: 'INR', publisher: 'FreeOpenSourcePOS' };
const testThailandPack = { ...flatRatePackData, id: 'test-legacy-th-pack', country: 'TH', currency: 'THB', publisher: 'FreeOpenSourcePOS' };
LEGACY_TRUSTED_PACK_DIGESTS[testIndiaPack.id] = taxPackSha256(JSON.stringify(testIndiaPack));
LEGACY_TRUSTED_PACK_DIGESTS[testThailandPack.id] = taxPackSha256(JSON.stringify(testThailandPack));

async function main() {
  console.log('Tax Pack Management Integration Tests');
  console.log('='.repeat(56));

  const db = initTestDb();
  const owner = seedOwnerUser(db);
  const manager = seedManagerUser(db);
  seedCategory(db, 'tax-pack-products', 'Tax Pack Products');
  seedProduct(db, 'override-product', 'tax-pack-products', 'Override Product', 100, {
    tax_type: 'none',
    tax_category_id: null,
  });

  const app = createApp({});
  registerRoutes(app);
  const { baseUrl, server } = await startServer(app);

  try {
    console.log('\n1. Fresh installs start generic; explicitly installed packs are readable');
    const freshListRes = await api(baseUrl, '/api/tax-packs', { headers: manager.authHeader });
    assertEqual(freshListRes.status, 200, 'manager can view installed packs');
    assertEqual(freshListRes.data.packs.length, 1, 'only the generic pack is preinstalled');
    assertEqual(freshListRes.data.packs[0].id, 'local-generic', 'the preinstalled pack is generic');
    assertEqual(freshListRes.data.packs[0].active_for_store, true, 'generic no-tax behavior is active');

    installAndActivateTestTaxPack(db, testIndiaPack);
    installAndActivateTestTaxPack(db, testThailandPack);
    // Tax calculation is intentionally zeroed while the merchant toggle is
    // off. Enable it here so the management assertions exercise the active
    // country-plugin path rather than the generic no-tax default.
    db.prepare("UPDATE settings SET value = 'true' WHERE key = 'taxes_enabled'").run();
    const listRes = await api(baseUrl, '/api/tax-packs', { headers: manager.authHeader });
    const installedPack = listRes.data.packs.find((pack: any) => pack.id === 'test-legacy-in-pack');
    assert(!!installedPack, 'legacy pack is listed');
    assertEqual(installedPack.versions[0].version, testIndiaPack.version, 'legacy pack version is shown');
    assertEqual(installedPack.active_for_store, true, 'legacy pack is active for its configured country');

    const detailRes = await api(baseUrl, '/api/tax-packs/test-legacy-in-pack', { headers: manager.authHeader });
    assertEqual(detailRes.status, 200, 'manager can view active pack details');
    assert(detailRes.data.categories.length > 0, 'categories are available for reference');
    assert(detailRes.data.rules.length > 0, 'rules are available for reference');
    assertEqual(detailRes.data.active_version.validation.checks.length, 24, 'all 24 activation checks are reported');
    assertEqual(detailRes.data.active_version.validation.valid, true,
      'an exact legacy unsigned artifact remains trusted after upgrade');
    for (const packId of ['test-legacy-th-pack', 'local-generic']) {
      const packDetail = await api(baseUrl, `/api/tax-packs/${packId}`, { headers: manager.authHeader });
      assertEqual(packDetail.status, 200, `${packId} details are readable`);
      assertEqual(
        packDetail.data.active_version.validation.checks.length,
        24,
        `${packId} reports all 24 activation checks`,
      );
      const failedCheckIds = packDetail.data.active_version.validation.checks
        .filter((check: any) => !check.passed)
        .map((check: any) => check.id)
        .join(',');
      assertEqual(failedCheckIds, '', `${packId} passes activation validation`);
    }

    const legacyPackRow = db.prepare(
      'SELECT * FROM country_pack_versions WHERE id = ?'
    ).get(`${testIndiaPack.id}@${testIndiaPack.version}`);
    const tamperedPackJson = JSON.stringify({ ...testIndiaPack, currency: 'USD' });
    const tamperedValidation = validationChecklist({
      ...legacyPackRow,
      pack_json: tamperedPackJson,
      digest: taxPackSha256(tamperedPackJson),
    });
    assertEqual(
      tamperedValidation.checks.find((check: any) => check.id === 6)?.passed,
      false,
      'an unsigned modified legacy artifact is still rejected',
    );

    db.prepare(`UPDATE products SET tax_category_id = NULL WHERE id = 'override-product'`).run();
    const enableLegacyPack = await api(baseUrl, '/api/tax-packs/ensure-country', {
      method: 'POST',
      body: { country: 'IN' },
      headers: owner.authHeader,
    });
    assertEqual(enableLegacyPack.status, 200, 'owner can enable taxes with the exact legacy pack');
    assertEqual(
      db.prepare(`SELECT tax_category_id FROM products WHERE id = 'override-product'`).get().tax_category_id,
      testIndiaPack.defaultCategories.product,
      'enabling taxes assigns the official default to uncategorized products',
    );
    db.prepare(`UPDATE products SET tax_category_id = NULL WHERE id = 'override-product'`).run();

    console.log('\n2. Test calculation is available to managers');
    const calculationRes = await api(baseUrl, '/api/tax-packs/test-calculation', {
      method: 'POST',
      body: { category_id: 'standard', amount: '100', tax_behavior: 'exclusive' },
      headers: manager.authHeader,
    });
    assertEqual(calculationRes.status, 200, 'manager can run a test calculation');
    assertEqual(calculationRes.data.calculation.taxableBase, '100.00', 'test calculation returns the taxable base');
    assertEqual(calculationRes.data.calculation.taxAmount, '5.00', '₹100 standard category produces ₹5 tax');
    assertEqual(calculationRes.data.calculation.payableTotal, '105', 'test payable total is ₹105');

    console.log('\n3. Override mutations are owner-only');
    const managerCreate = await api(baseUrl, '/api/tax-packs/overrides', {
      method: 'POST',
      body: {
        entity_type: 'product',
        entity_id: 'override-product',
        category_id: 'standard',
      },
      headers: manager.authHeader,
    });
    assertEqual(managerCreate.status, 403, 'manager cannot create an override');

    const createOverride = await api(baseUrl, '/api/tax-packs/overrides', {
      method: 'POST',
      body: {
        entity_type: 'product',
        entity_id: 'override-product',
        category_id: 'standard',
      },
      headers: owner.authHeader,
    });
    assertEqual(createOverride.status, 201, 'owner can create a product override');
    const overrideId = createOverride.data.override.id;

    const duplicateOverride = await api(baseUrl, '/api/tax-packs/overrides', {
      method: 'POST',
      body: {
        entity_type: 'product',
        entity_id: 'override-product',
        category_id: 'standard',
      },
      headers: owner.authHeader,
    });
    assertEqual(duplicateOverride.status, 409, 'duplicate target overrides are rejected');

    console.log('\n4. Merchant override participates in checkout precedence');
    const orderWithOverride = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        type: 'takeaway',
        items: [{ product_id: 'override-product', quantity: 1 }],
      },
      headers: owner.authHeader,
    });
    assertEqual(orderWithOverride.status, 201, 'uncategorized product checks out through its merchant override');
    assertEqual(orderWithOverride.data.order.tax_amount, 5, 'override assigns the standard 5% category');
    const rawItemSnapshot = orderWithOverride.data.order.items[0].tax_snapshot;
    const itemSnapshot =
      typeof rawItemSnapshot === 'string' ? JSON.parse(rawItemSnapshot) : rawItemSnapshot;
    assertEqual(itemSnapshot.lines[0].categorySource, 'merchant_override', 'snapshot records merchant precedence source');
    assertEqual(itemSnapshot.merchantOverridesApplied[0].overrideId, overrideId, 'snapshot records exact override id');

    const updateOverride = await api(baseUrl, `/api/tax-packs/overrides/${overrideId}`, {
      method: 'PUT',
      body: { category_id: 'unclassified' },
      headers: owner.authHeader,
    });
    assertEqual(updateOverride.status, 200, 'owner can edit an override');

    const managerDelete = await api(baseUrl, `/api/tax-packs/overrides/${overrideId}`, {
      method: 'DELETE',
      headers: manager.authHeader,
    });
    assertEqual(managerDelete.status, 403, 'manager cannot reset an override');

    const deleteOverride = await api(baseUrl, `/api/tax-packs/overrides/${overrideId}`, {
      method: 'DELETE',
      headers: owner.authHeader,
    });
    assertEqual(deleteOverride.status, 200, 'owner can reset an override to official behavior');

    const orderWithoutOverride = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        type: 'takeaway',
        items: [{ product_id: 'override-product', quantity: 1 }],
      },
      headers: owner.authHeader,
    });
    assertEqual(orderWithoutOverride.status, 201, 'uncategorized checkout remains available after reset');
    assertEqual(orderWithoutOverride.data.order.tax_amount, 0, 'reset removes merchant category assignment');
    assert(!orderWithoutOverride.data.order.items[0].tax_snapshot, 'reset returns the product to the no-tax path');

    console.log('\n5. Charge categories persist and stay stable across every recompute path');
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('discount_max_percentage', '100', datetime('now'))",
    ).run();
    const chargeOverrideIds: string[] = [];
    for (const entityType of ['packaging', 'delivery', 'service_charge']) {
      const chargeOverride = await api(baseUrl, '/api/tax-packs/overrides', {
        method: 'POST',
        body: {
          entity_type: entityType,
          entity_id: null,
          category_id: 'standard',
        },
        headers: owner.authHeader,
      });
      assertEqual(chargeOverride.status, 201, `owner can configure ${entityType} category`);
      chargeOverrideIds.push(chargeOverride.data.override.id);
    }
    const serviceChargeTax = calculateConfiguredChargeTaxes(
      { country: 'IN', business_type: 'restaurant', state_code: '27', taxes_enabled: true },
      {
        service_charge: 20,
        service_charge_tax_category_id: 'standard',
      },
      null,
    );
    assertEqual(serviceChargeTax.taxAmount, 1, 'configured ₹20 service charge uses the same 5% engine path');
    assertEqual(
      JSON.parse(serviceChargeTax.snapshotJson[0]).chargeKind,
      'service_charge',
      'service charge snapshot identifies its charge kind',
    );

    const chargeOrder = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        type: 'takeaway',
        packaging_charge: 20,
        delivery_charge: 20,
        items: [{ product_id: 'override-product', quantity: 1 }],
      },
      headers: owner.authHeader,
    });
    assertEqual(chargeOrder.status, 201, 'order with configured charges is created');
    const chargeOrderId = chargeOrder.data.order.id;
    const firstChargeItemId = chargeOrder.data.order.items[0].id;
    assertEqual(chargeOrder.data.order.tax_amount, 2, 'two ₹20 charges add ₹2 tax');
    assertEqual(chargeOrder.data.order.total, 142, 'untaxed item plus configured charge tax total correctly');
    assertEqual(chargeOrder.data.order.packaging_tax_category_id, 'standard', 'packaging category is frozen on the order');
    assertEqual(chargeOrder.data.order.delivery_tax_category_id, 'standard', 'delivery category is frozen on the order');
    assertEqual(chargeOrder.data.order.service_charge_tax_category_id, 'standard', 'service category is frozen even when its amount is zero');
    const chargeSnapshots = typeof chargeOrder.data.order.tax_snapshot === 'string'
      ? JSON.parse(chargeOrder.data.order.tax_snapshot)
      : chargeOrder.data.order.tax_snapshot;
    assertEqual(chargeSnapshots.length, 2, 'only non-zero configured charges produce snapshots');
    assertEqual(
      chargeSnapshots.map((snapshot: any) => snapshot.chargeKind).sort().join(','),
      'delivery,packaging',
      'snapshot identifies both charge kinds',
    );

    const chargeOrderDiscount = await api(baseUrl, `/api/orders/${chargeOrderId}/discount`, {
      method: 'PATCH',
      body: { discount_type: 'percentage', discount_value: 50 },
      headers: owner.authHeader,
    });
    assertEqual(chargeOrderDiscount.status, 200, 'order discount recomputes configured charge tax');
    assertEqual(chargeOrderDiscount.data.order.tax_amount, 2, 'order discount does not scale charge tax');
    assertEqual(chargeOrderDiscount.data.order.total, 92, 'discounted item plus unchanged charges total correctly');

    const addChargeItem = await api(baseUrl, `/api/orders/${chargeOrderId}/items`, {
      method: 'POST',
      body: { items: [{ product_id: 'override-product', quantity: 1 }] },
      headers: owner.authHeader,
    });
    assertEqual(addChargeItem.status, 200, 'add-item recompute succeeds with configured charges');
    const secondChargeItemId = addChargeItem.data.order.items.find(
      (item: any) => item.id !== firstChargeItemId,
    ).id;
    assertEqual(addChargeItem.data.order.tax_amount, 2, 'add-item recompute does not duplicate charge tax');
    assertEqual(addChargeItem.data.order.total, 142, 'add-item recompute reapplies the percentage item discount and retains charges');

    const cancelChargeItem = await api(baseUrl, `/api/orders/${chargeOrderId}/items/${secondChargeItemId}/cancel`, {
      method: 'PATCH',
      body: {},
      headers: owner.authHeader,
    });
    assertEqual(cancelChargeItem.status, 200, 'cancel recompute succeeds with configured charges');
    assertEqual(cancelChargeItem.data.order.tax_amount, 2, 'cancel recompute retains charge tax once');
    assertEqual(cancelChargeItem.data.order.total, 92, 'cancel recompute returns to one active item');

    const restoreChargeItem = await api(baseUrl, `/api/orders/${chargeOrderId}/items/${secondChargeItemId}/restore`, {
      method: 'PATCH',
      body: {},
      headers: owner.authHeader,
    });
    assertEqual(restoreChargeItem.status, 200, 'restore recompute succeeds with configured charges');
    assertEqual(restoreChargeItem.data.order.tax_amount, 2, 'restore recompute retains charge tax once');
    assertEqual(restoreChargeItem.data.order.total, 142, 'restore recompute returns to two active items with percentage discount');

    const itemChargeDiscount = await api(
      baseUrl,
      `/api/orders/${chargeOrderId}/items/${firstChargeItemId}/discount`,
      {
        method: 'PATCH',
        body: { discount_type: 'percentage', discount_value: 10 },
        headers: owner.authHeader,
      },
    );
    assertEqual(itemChargeDiscount.status, 200, 'item discount recompute succeeds with configured charges');
    const afterItemChargeDiscount = (await api(
      baseUrl,
      `/api/orders/${chargeOrderId}`,
      { headers: owner.authHeader },
    )).data.order;
    assertEqual(afterItemChargeDiscount.tax_amount, 2, 'item discount does not scale charge tax');
    assertEqual(afterItemChargeDiscount.total, 137, 'item discount and order discount preserve charge totals');

    const chargeBill = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      body: { order_id: chargeOrderId },
      headers: owner.authHeader,
    });
    assertEqual(chargeBill.status, 201, 'bill generation copies the charge-tax rollup');
    assertEqual(chargeBill.data.bill.tax_amount, 2, 'generated bill retains charge tax');
    assertEqual(chargeBill.data.bill.total, 137, 'generated bill matches the order');

    const chargeBillDiscount = await api(baseUrl, `/api/bills/${chargeBill.data.bill.id}/applyDiscount`, {
      method: 'POST',
      body: { type: 'percentage', value: 50 },
      headers: owner.authHeader,
    });
    assertEqual(chargeBillDiscount.status, 200, 'bill discount recomputes configured charges');
    assertEqual(chargeBillDiscount.data.bill.tax_amount, 2, 'bill discount leaves charge tax unscaled');
    assertEqual(chargeBillDiscount.data.bill.total, 137, 'bill discount scales items but not charges');

    for (const overrideIdToRemove of chargeOverrideIds) {
      const resetCharge = await api(baseUrl, `/api/tax-packs/overrides/${overrideIdToRemove}`, {
        method: 'DELETE',
        headers: owner.authHeader,
      });
      assertEqual(resetCharge.status, 200, 'charge category can return to the no-tax default');
    }
    const unconfiguredChargeOrder = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        type: 'takeaway',
        packaging_charge: 20,
        delivery_charge: 20,
        items: [{ product_id: 'override-product', quantity: 1 }],
      },
      headers: owner.authHeader,
    });
    assertEqual(unconfiguredChargeOrder.status, 201, 'unconfigured charge order remains valid');
    assertEqual(unconfiguredChargeOrder.data.order.tax_amount, 0, 'unconfigured charges remain untaxed');
    assertEqual(unconfiguredChargeOrder.data.order.total, 140, 'unconfigured charge total is unchanged');

    console.log('\n6. Activation/rollback are owner-gated and installed-only');
    const versionId = installedPack.active_version_id;
    const managerActivate = await api(
      baseUrl,
      `/api/tax-packs/test-legacy-in-pack/versions/${encodeURIComponent(versionId)}/activate`,
      { method: 'POST', body: {}, headers: manager.authHeader },
    );
    assertEqual(managerActivate.status, 403, 'manager cannot activate a pack');

    const ownerActivate = await api(
      baseUrl,
      `/api/tax-packs/test-legacy-in-pack/versions/${encodeURIComponent(versionId)}/activate`,
      { method: 'POST', body: {}, headers: owner.authHeader },
    );
    assertEqual(ownerActivate.status, 200, 'owner can select an already-installed version');
    assertEqual(ownerActivate.data.changed, false, 'selecting the active version is a safe no-op');

    const rollbackRes = await api(baseUrl, '/api/tax-packs/test-legacy-in-pack/rollback', {
      method: 'POST',
      body: {},
      headers: owner.authHeader,
    });
    assertEqual(rollbackRes.status, 400, 'rollback is blocked when no previous installed version exists');

    console.log('\n7. Every override mutation is audited');
    const auditRes = await api(baseUrl, '/api/tax-packs/audit', { headers: manager.authHeader });
    assertEqual(auditRes.status, 200, 'manager can view tax audit history');
    const actions = auditRes.data.audit.map((entry: any) => entry.action);
    assert(actions.includes('create_override'), 'create override audit exists');
    assert(actions.includes('update_override'), 'update override audit exists');
    assert(actions.includes('reset_override'), 'reset override audit exists');
    const createAudit = auditRes.data.audit.find((entry: any) => entry.action === 'create_override');
    assertEqual(createAudit.actor_name, 'Test Owner', 'audit identifies the acting user');

    console.log('\n8. Signed catalog packs install without activating');
    const managerInstall = await api(baseUrl, '/api/tax-packs/catalog/install', {
      method: 'POST',
      body: { pack_id: 'test-legacy-in-pack', version: '1.1.0' },
      headers: manager.authHeader,
    });
    assertEqual(managerInstall.status, 403, 'manager cannot install a catalog pack');

    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const downloadedPack = {
      ...testIndiaPack,
      version: '1.1.0',
      publishedAt: '2026-07-30',
    };
    const downloadedPackJson = JSON.stringify(downloadedPack, null, 2);
    const downloadedSignature = sign(
      null,
      Buffer.from(downloadedPackJson, 'utf8'),
      privateKey,
    ).toString('base64');
    const releaseTag = 'tax-pack-test-legacy-in-pack-v1.1.0';
    const releaseBase = `https://github.com/FreeOpenSourcePOS/FloCafe-Plugins/releases/download/${releaseTag}`;
    const catalogEntry = {
      id: downloadedPack.id,
      publisher: downloadedPack.publisher,
      country: downloadedPack.country,
      jurisdiction: downloadedPack.jurisdiction,
      version: downloadedPack.version,
      publishedAt: downloadedPack.publishedAt,
      minFloVersion: downloadedPack.minFloVersion,
      downloadUrl: `${releaseBase}/test-legacy-in-pack-v1.1.0.json`,
      signatureUrl: `${releaseBase}/test-legacy-in-pack-v1.1.0.json.sig`,
      digest: taxPackSha256(downloadedPackJson),
    };
    const fetchImpl = async (input: string | URL | Request) => new Response(
      String(input) === catalogEntry.downloadUrl ? downloadedPackJson : downloadedSignature,
      { status: 200 },
    );
    const installed = await installCatalogEntry(catalogEntry, {
      actorUserId: owner.userId,
      fetchImpl,
      publicKey,
    });
    assertEqual(installed.version, '1.1.0', 'verified downloaded version is installed');
    assertEqual(installed.validation.checks.length, 24, 'download uses the existing 24-check validation');
    assertEqual(installed.validation.valid, true, 'signed download passes all activation validation');

    const storedVersion = db.prepare(
      'SELECT status, digest, signature FROM country_pack_versions WHERE id = ?'
    ).get(installed.versionId);
    assertEqual(storedVersion.status, 'installed', 'downloaded version is installed, not active');
    assertEqual(storedVersion.digest, catalogEntry.digest, 'verified catalog digest is persisted');
    assertEqual(storedVersion.signature, downloadedSignature, 'detached signature is persisted');
    const unchangedActiveVersion = db.prepare(
      'SELECT active_version_id FROM country_packs WHERE id = ?'
    ).get('test-legacy-in-pack');
    assertEqual(
      unchangedActiveVersion.active_version_id,
      versionId,
      'install does not implicitly activate the downloaded version',
    );
    const storedChildren = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM tax_categories WHERE pack_version_id = ?) AS categories,
        (SELECT COUNT(*) FROM tax_rules WHERE pack_version_id = ?) AS rules
    `).get(installed.versionId, installed.versionId);
    assertEqual(
      storedChildren.categories,
      downloadedPack.categories.length,
      'downloaded categories are installed',
    );
    assertEqual(storedChildren.rules, downloadedPack.rules.length, 'downloaded rules are installed');
    const installAudit = db.prepare(`
      SELECT audit.action, audit.actor_user_id
      FROM tax_config_audit AS audit
      WHERE audit.pack_version_id = ?
    `).get(installed.versionId);
    assertEqual(installAudit.action, 'install_downloaded_pack', 'download installation is audited');
    assertEqual(installAudit.actor_user_id, owner.userId, 'install audit identifies the owner');

    // Regression: the activation vector check must never be keyed off a
    // hardcoded list of known pack ids -- a genuinely new pack (a real
    // country never bundled with the app) must be able to pass activation
    // validation on its own declared data, or the entire signed-catalog
    // download feature can only ever "install" versions of packs that
    // already shipped in the app.
    const newCountryPack = {
      ...testIndiaPack,
      id: 'brand-new-country-pack',
      publisher: 'some-third-party',
      version: '1.0.0',
      publishedAt: '2026-07-30',
    };
    const newCountryPackJson = JSON.stringify(newCountryPack, null, 2);
    const newCountrySignature = sign(
      null,
      Buffer.from(newCountryPackJson, 'utf8'),
      privateKey,
    ).toString('base64');
    const newCountryTag = 'tax-pack-brand-new-country-pack-v1.0.0';
    const newCountryBase = `https://github.com/FreeOpenSourcePOS/FloCafe-Plugins/releases/download/${newCountryTag}`;
    const newCountryEntry = {
      id: newCountryPack.id,
      publisher: newCountryPack.publisher,
      country: newCountryPack.country,
      jurisdiction: newCountryPack.jurisdiction,
      version: newCountryPack.version,
      publishedAt: newCountryPack.publishedAt,
      minFloVersion: newCountryPack.minFloVersion,
      downloadUrl: `${newCountryBase}/brand-new-country-pack-v1.0.0.json`,
      signatureUrl: `${newCountryBase}/brand-new-country-pack-v1.0.0.json.sig`,
      digest: taxPackSha256(newCountryPackJson),
    };
    const newCountryFetch = async (input: string | URL | Request) => new Response(
      String(input) === newCountryEntry.downloadUrl ? newCountryPackJson : newCountrySignature,
      { status: 200 },
    );
    const newCountryInstalled = await installCatalogEntry(newCountryEntry, {
      actorUserId: owner.userId,
      fetchImpl: newCountryFetch,
      publicKey,
    });
    assertEqual(
      newCountryInstalled.validation.valid,
      true,
      'a genuinely new pack id passes activation validation on its own declared data',
    );

    const incompatiblePack = {
      ...downloadedPack,
      version: '1.2.0',
      minFloVersion: '999.0.0',
    };
    const incompatiblePackJson = JSON.stringify(incompatiblePack);
    const incompatibleSignature = sign(
      null,
      Buffer.from(incompatiblePackJson, 'utf8'),
      privateKey,
    ).toString('base64');
    const incompatibleTag = 'tax-pack-test-legacy-in-pack-v1.2.0';
    const incompatibleEntry = {
      ...catalogEntry,
      version: incompatiblePack.version,
      minFloVersion: incompatiblePack.minFloVersion,
      downloadUrl: `https://github.com/FreeOpenSourcePOS/FloCafe-Plugins/releases/download/${incompatibleTag}/test-legacy-in-pack-v1.2.0.json`,
      signatureUrl: `https://github.com/FreeOpenSourcePOS/FloCafe-Plugins/releases/download/${incompatibleTag}/test-legacy-in-pack-v1.2.0.json.sig`,
      digest: taxPackSha256(incompatiblePackJson),
    };
    const incompatibleFetch = async (input: string | URL | Request) => new Response(
      String(input) === incompatibleEntry.downloadUrl ? incompatiblePackJson : incompatibleSignature,
      { status: 200 },
    );
    let rejectedValidation: any = null;
    try {
      await installCatalogEntry(incompatibleEntry, {
        actorUserId: owner.userId,
        fetchImpl: incompatibleFetch,
        publicKey,
      });
    } catch (error) {
      rejectedValidation = error;
    }
    assertEqual(
      rejectedValidation?.statusCode,
      400,
      'a correctly signed pack still fails when the 24-check validation rejects it',
    );
    assert(
      rejectedValidation?.validation?.checks.some(
        (check: any) => check.id === 4 && check.passed === false,
      ),
      'the failed compatibility check is returned to the caller',
    );
    assertEqual(
      db.prepare('SELECT COUNT(*) AS count FROM country_pack_versions WHERE id = ?')
        .get('test-legacy-in-pack@1.2.0').count,
      0,
      'failed validation leaves no installed version behind',
    );

    console.log('\n9. Argentina IVA pack passes activation validation and computes inclusive tax');
    const argentinaPackData = require('../main/tax-packs/argentina.json');
    const argentinaPackJson = JSON.stringify(argentinaPackData);
    const argentinaSignature = sign(
      null,
      Buffer.from(argentinaPackJson, 'utf8'),
      privateKey,
    ).toString('base64');
    const argentinaTag = `tax-pack-${argentinaPackData.id}-v${argentinaPackData.version}`;
    const argentinaEntry = {
      id: argentinaPackData.id,
      publisher: argentinaPackData.publisher,
      country: argentinaPackData.country,
      jurisdiction: argentinaPackData.jurisdiction,
      version: argentinaPackData.version,
      publishedAt: argentinaPackData.publishedAt,
      minFloVersion: argentinaPackData.minFloVersion,
      downloadUrl: `https://github.com/FreeOpenSourcePOS/FloCafe-Plugins/releases/download/${argentinaTag}/${argentinaPackData.id}-v${argentinaPackData.version}.json`,
      signatureUrl: `https://github.com/FreeOpenSourcePOS/FloCafe-Plugins/releases/download/${argentinaTag}/${argentinaPackData.id}-v${argentinaPackData.version}.json.sig`,
      digest: taxPackSha256(argentinaPackJson),
    };
    const argentinaFetch = async (input: string | URL | Request) => new Response(
      String(input) === argentinaEntry.downloadUrl ? argentinaPackJson : argentinaSignature,
      { status: 200 },
    );
    const argentinaInstalled = await installCatalogEntry(argentinaEntry, {
      actorUserId: owner.userId,
      fetchImpl: argentinaFetch,
      publicKey,
    });
    assertEqual(
      argentinaInstalled.validation.checks.length,
      24,
      'Argentina pack goes through the same 24-check validation as every other country pack',
    );
    assertEqual(
      argentinaInstalled.validation.valid,
      true,
      'Argentina IVA pack passes activation validation',
    );

    // Schema sanity: the Argentina pack source JSON declares
    // registrationNumberLabel so receipt/footer consumers resolve the label
    // through getActiveCountryPack as through countries.ts.
    assertEqual(argentinaPackData.registrationNumberLabel, 'CUIT', 'Argentina pack declares registration label "CUIT"');

    // Mirror ensure-country's category backfill (main/routes/tax-packs.ts:739-744)
    // so the active pack's default product category is what uncategorized
    // products resolve to. The install helper writes the version row directly
    // without going through the route, so it has to reproduce that step.
    db.prepare(
      `UPDATE products SET tax_category_id = ? WHERE tax_category_id IS NULL AND deleted_at IS NULL`
    ).run(argentinaPackData.defaultCategories.product);
    db.prepare(
      `UPDATE addons SET tax_category_id = ? WHERE tax_category_id IS NULL`
    ).run(argentinaPackData.defaultCategories.addon);
    // The store country must match the pack for getActiveCountryPack to pick
    // it up; the other sections set it to IN/TH through the legacy fixtures.
    db.prepare("UPDATE settings SET value = 'AR' WHERE key = 'country'").run();
    db.prepare("UPDATE settings SET value = 'true' WHERE key = 'taxes_enabled'").run();
    // Switch to the Argentina catalog entry's installed pack by making it
    // the active row for country=AR.
    db.prepare(`
      UPDATE country_packs
      SET active_version_id = ?, status = 'active', updated_at = ?
      WHERE id = ?
    `).run(argentinaInstalled.versionId, new Date().toISOString(), argentinaPackData.id);
    // activePackForCountry() picks the active row whose country matches the
    // store's setting; mark the AR-installed pack as the one that resolves.
    db.prepare(`
      UPDATE country_packs SET status = 'installed', updated_at = ?
      WHERE country = 'AR' AND id != ?
    `).run(new Date().toISOString(), argentinaPackData.id);

    const arCalculation = await api(baseUrl, '/api/tax-packs/test-calculation', {
      method: 'POST',
      body: { category_id: 'iva_21', amount: '1000', tax_behavior: 'inclusive' },
      headers: manager.authHeader,
    });
    assertEqual(arCalculation.status, 200, 'Argentina test calculation runs against the active pack');
    assertEqual(
      arCalculation.data.calculation.taxAmount,
      '173.55',
      'ARS 1000 inclusive at 21% extracts ARS 173.55 tax',
    );
    assertEqual(
      arCalculation.data.calculation.payableTotal,
      '1000',
      'inclusive payable total stays at ARS 1000',
    );

    console.log('\n10. Manual-config installs a synthetic local pack when no official pack exists');
    // Reset Argentina's pack so manual-config can claim the country. The
    // 409 path under it relies on a clean slate, which is what an owner
    // sees in real life after they disable taxes.
    db.prepare("UPDATE country_packs SET status = 'installed', active_version_id = NULL WHERE id = ?")
      .run(argentinaPackData.id);
    db.prepare("UPDATE country_pack_versions SET status = 'installed' WHERE pack_id = ?")
      .run(argentinaPackData.id);
    db.prepare("UPDATE settings SET value = 'false' WHERE key = 'taxes_enabled'").run();
    // Reset the test product so the manual-config backfill is observable;
    // earlier sections in this test set its tax_category_id to iva_21.
    db.prepare(`UPDATE products SET tax_category_id = NULL WHERE id = 'override-product'`).run();

    const managerManual = await api(baseUrl, '/api/tax-packs/manual-config', {
      method: 'POST',
      body: { rate: '21', inclusive: true, label: 'CUIT' },
      headers: manager.authHeader,
    });
    assertEqual(managerManual.status, 403, 'manager cannot save manual tax configuration');

    const outOfRange = await api(baseUrl, '/api/tax-packs/manual-config', {
      method: 'POST',
      body: { rate: '101' },
      headers: owner.authHeader,
    });
    assertEqual(outOfRange.status, 400, 'rates above 100 are rejected');

    const negative = await api(baseUrl, '/api/tax-packs/manual-config', {
      method: 'POST',
      body: { rate: '-1' },
      headers: owner.authHeader,
    });
    assertEqual(negative.status, 400, 'negative rates are rejected');

    const manual = await api(baseUrl, '/api/tax-packs/manual-config', {
      method: 'POST',
      body: { rate: '21', inclusive: true, label: 'CUIT' },
      headers: owner.authHeader,
    });
    assertEqual(manual.status, 200, 'owner can save a manual rate');
    assertEqual(manual.data.enabled, true, 'manual-config returns enabled=true');
    assertEqual(manual.data.country, 'AR', 'manual-config targets the store country');
    assertEqual(manual.data.pack_id, 'manual-ar', 'manual-config uses a synthetic pack id');
    assertEqual(
      manual.data.validation.checks.length,
      24,
      'manual-config pack goes through the same 24-check validation',
    );
    assertEqual(manual.data.validation.valid, true, 'manual-config pack passes all checks');

    // The settings panel tells a saved manual config apart from a pristine
    // install by asking whether the active local pack carries a rate. Both
    // halves of that invariant have to hold or the form silently prefills the
    // bundled no-tax defaults (exclusive pricing, "Tax registration") and an
    // owner can save them by accident.
    const genericRules = db.prepare(`
      SELECT rule.rate FROM tax_rules AS rule
      JOIN country_pack_versions AS version ON version.id = rule.pack_version_id
      WHERE version.pack_id = 'local-generic'
    `).all() as Array<{ rate: string | null }>;
    assertEqual(genericRules.length, 0, 'the bundled local-generic pack carries no tax rules');
    const manualRules = db.prepare(`
      SELECT rule.rate FROM tax_rules AS rule
      WHERE rule.pack_version_id = (SELECT active_version_id FROM country_packs WHERE id = 'manual-ar')
    `).all() as Array<{ rate: string | null }>;
    assertEqual(manualRules.length, 1, 'a saved manual pack carries exactly one rule');
    assertEqual(manualRules[0].rate, '21', 'that rule carries the configured rate');

    const activeManual = db.prepare(
      `SELECT pack.*, version.pack_json FROM country_packs AS pack
       JOIN country_pack_versions AS version ON version.id = pack.active_version_id
       WHERE pack.id = 'manual-ar'`
    ).get() as any;
    assert(!!activeManual, 'manual-ar is the active pack for AR');
    assertEqual(activeManual.publisher, 'local', 'manual pack is marked local');
    assertEqual(activeManual.status, 'active', 'manual pack is active');
    // Trust status surfaces 'Local' for publisher='local' so the panel can
    // distinguish a manual configuration from a verified official pack
    // (docs/tax-engine-v2-spec.md:646). Re-fetch the list — the captured
    // listRes from section 1 predates the manual-config save.
    const refreshedList = await api(baseUrl, '/api/tax-packs', { headers: manager.authHeader });
    const manualPackSummary = refreshedList.data.packs.find((pack: any) => pack.id === 'manual-ar');
    assert(!!manualPackSummary, 'manual pack is included in the listed packs');
    assertEqual(manualPackSummary.trust_status, 'Local', 'manual pack reports trust status Local');
    const manualPack = JSON.parse(activeManual.pack_json);
    assertEqual(manualPack.inclusivePricingDefault, true, 'inclusive flag is persisted');
    assertEqual(manualPack.registrationNumberLabel, 'CUIT', 'label is persisted');
    assertEqual(manualPack.rules[0].rate, '21', 'rate is persisted');
    assertEqual(
      db.prepare("SELECT value FROM settings WHERE key = 'taxes_enabled'").get().value,
      'true',
      'taxes_enabled is flipped on after manual-config',
    );
    assertEqual(
      db.prepare(`SELECT tax_category_id FROM products WHERE id = 'override-product'`).get().tax_category_id,
      'standard',
      'uncategorized products are backfilled to the manual standard category',
    );

    const manualAudit = db.prepare(`
      SELECT details_json FROM tax_config_audit
      WHERE pack_id = 'manual-ar' AND action = 'activate_pack'
      ORDER BY id DESC LIMIT 1
    `).get() as { details_json: string };
    assert(!!manualAudit, 'manual-config writes an audit row');
    const auditDetails = JSON.parse(manualAudit.details_json);
    assertEqual(auditDetails.source, 'manual_config', 'audit details identify manual_config source');
    assertEqual(auditDetails.rate, '21', 'audit captures the rate that was configured');
    assertEqual(auditDetails.previousVersionId, null, 'first save has no previous version');

    const manualCalculation = await api(baseUrl, '/api/tax-packs/test-calculation', {
      method: 'POST',
      body: { category_id: 'standard', amount: '1000', tax_behavior: 'inclusive' },
      headers: manager.authHeader,
    });
    assertEqual(manualCalculation.status, 200, 'test calculation works against the manual pack');
    assertEqual(
      manualCalculation.data.calculation.taxAmount,
      '173.55',
      'manual 21% inclusive extracts the same ARS 173.55 as the Argentina IVA pack',
    );

    console.log('\n11. Manual-config needs an explicit override to replace an active official pack');
    // Reactivate Argentina's official pack so manual-config sees it as a
    // blocking pack and refuses with 409 unless override:true is sent.
    db.prepare("UPDATE country_packs SET status = 'active', active_version_id = ? WHERE id = ?")
      .run(`${argentinaPackData.id}@${argentinaPackData.version}`, argentinaPackData.id);
    db.prepare("UPDATE country_pack_versions SET status = 'active' WHERE id = ?")
      .run(`${argentinaPackData.id}@${argentinaPackData.version}`);
    // A product carrying an Argentina-only category: after the override the
    // manual pack has no 'iva_21', and leaving it there would make the engine
    // match no rule and throw a 400 on every checkout line.
    db.prepare(`UPDATE products SET tax_category_id = 'iva_21' WHERE id = 'override-product'`).run();

    const officialBlocks = await api(baseUrl, '/api/tax-packs/manual-config', {
      method: 'POST',
      body: { rate: '10.5' },
      headers: owner.authHeader,
    });
    assertEqual(
      officialBlocks.status,
      409,
      'manual-config is rejected while an official pack is active for the country',
    );
    assertEqual(officialBlocks.data.can_override, true, '409 tells the panel an override is possible');

    const officialOverridden = await api(baseUrl, '/api/tax-packs/manual-config', {
      method: 'POST',
      body: { rate: '10.5', override: true },
      headers: owner.authHeader,
    });
    assertEqual(officialOverridden.status, 200, 'override:true replaces the active official pack');
    assertEqual(
      db.prepare("SELECT status FROM country_packs WHERE id = ?").get(argentinaPackData.id).status,
      'installed',
      'the replaced official pack is demoted to installed',
    );
    assertEqual(
      db.prepare(`SELECT tax_category_id FROM products WHERE id = 'override-product'`).get().tax_category_id,
      'standard',
      'categories the replacing pack does not define are remapped to its default',
    );
    // Decision K: the remap must record its mapping, not guess in silence.
    const remapAudit = db.prepare(`
      SELECT details_json FROM tax_config_audit
      WHERE action = 'remap_categories' ORDER BY id DESC LIMIT 1
    `).get() as { details_json: string } | undefined;
    assert(!!remapAudit, 'the remap writes an audit row');
    const remapped = JSON.parse(remapAudit!.details_json).remapped as Array<{
      entity: string; from: string; to: string; count: number;
    }>;
    const productRemap = remapped.find((entry) => entry.entity === 'product' && entry.from === 'iva_21');
    assert(!!productRemap, 'the audit records the category that was overwritten');
    assertEqual(productRemap!.to, 'standard', 'the audit records what it was overwritten with');
    assert(productRemap!.count >= 1, 'the audit records how many rows changed');
    assertEqual(
      officialOverridden.data.remapped.length > 0,
      true,
      'the response tells the owner assignments were remapped',
    );
    assertEqual(
      typeof officialOverridden.data.dormant_overrides,
      'number',
      'the response reports how many merchant overrides stopped applying',
    );
    const replaceAudit = JSON.parse((db.prepare(`
      SELECT details_json FROM tax_config_audit
      WHERE pack_id = 'manual-ar' AND action = 'activate_pack'
      ORDER BY id DESC LIMIT 1
    `).get() as { details_json: string }).details_json);
    assertEqual(
      replaceAudit.replacedPackId,
      argentinaPackData.id,
      'audit records which pack the manual rate replaced',
    );

    console.log('\n12. Manual-config re-saves create a new version on the same manual pack');
    // Demote the Argentina official pack so the re-save path can run.
    db.prepare("UPDATE country_packs SET status = 'installed', active_version_id = NULL WHERE id = ?")
      .run(argentinaPackData.id);
    db.prepare("UPDATE country_pack_versions SET status = 'installed' WHERE pack_id = ?")
      .run(argentinaPackData.id);
    // The manual pack is still active from section 10 — exercise the re-save path.
    const firstVersionId = db.prepare(
      `SELECT active_version_id FROM country_packs WHERE id = 'manual-ar'`
    ).get() as { active_version_id: string };
    assertEqual(firstVersionId.active_version_id.startsWith('manual-ar@1.0.'), true,
      'manual-ar has a 1.0.x version from section 10');

    // Decision F: re-save must preserve merchant overrides across versions.
    // Create an override against the current active version; after the
    // re-save below, activateInstalledPack should re-point its
    // pack_version_id at the new version so the override keeps applying.
    const overrideCreate = await api(baseUrl, '/api/tax-packs/overrides', {
      method: 'POST',
      body: { entity_type: 'product', entity_id: 'override-product', category_id: 'standard' },
      headers: owner.authHeader,
    });
    assertEqual(overrideCreate.status, 201, 'owner can create a product override against the manual pack');
    const manualOverrideId = overrideCreate.data.override.id;
    const overrideBefore = db.prepare(
      'SELECT pack_version_id FROM tax_overrides WHERE id = ?'
    ).get(manualOverrideId) as { pack_version_id: string };
    assertEqual(
      overrideBefore.pack_version_id,
      firstVersionId.active_version_id,
      'override is pinned to the active version before re-save',
    );

    const resave = await api(baseUrl, '/api/tax-packs/manual-config', {
      method: 'POST',
      body: { rate: '10.5', inclusive: false, label: 'GST' },
      headers: owner.authHeader,
    });
    assertEqual(resave.status, 200, 'manual-config re-saves over the existing manual pack');
    assertEqual(resave.data.pack_id, 'manual-ar', 're-save keeps the same pack id');
    assert(resave.data.version !== firstVersionId.active_version_id.split('@')[1],
      're-save produces a fresh patch version');
    assertEqual(
      resave.data.validation.checks.length,
      24,
      're-saved pack still passes through the full 24-check validation',
    );
    assertEqual(resave.data.validation.valid, true, 're-saved pack is valid');

    const activeRows = db.prepare(
      `SELECT version, status FROM country_pack_versions WHERE pack_id = 'manual-ar' ORDER BY version DESC`
    ).all() as Array<{ version: string; status: string }>;
    assertEqual(activeRows[0].status, 'active', 'the new version is the active one');
    assert(activeRows.length >= 2, 'the old version row is retained for rollback');
    const demoted = activeRows.find((row) => row.version === firstVersionId.active_version_id.split('@')[1]);
    assertEqual(demoted?.status, 'installed', 'the previous version is demoted to installed');

    const latestPack = db.prepare(
      'SELECT pack_json FROM country_pack_versions WHERE id = ?'
    ).get(`manual-ar@${resave.data.version}`) as { pack_json: string };
    const parsedPack = JSON.parse(latestPack.pack_json);
    assertEqual(parsedPack.rules[0].rate, '10.5', 'the new version carries the new rate');
    assertEqual(parsedPack.inclusivePricingDefault, false, 're-save updates the inclusive flag');
    assertEqual(parsedPack.registrationNumberLabel, 'GST', 're-save updates the registration label');

    const resaveAudit = db.prepare(`
      SELECT details_json FROM tax_config_audit
      WHERE pack_id = 'manual-ar' AND action = 'activate_pack'
      ORDER BY id DESC LIMIT 1
    `).get() as { details_json: string };
    const resaveDetails = JSON.parse(resaveAudit.details_json);
    assertEqual(resaveDetails.source, 'manual_config', 're-save audit identifies manual_config');
    assertEqual(resaveDetails.rate, '10.5', 're-save audit captures the new rate');
    assertEqual(
      resaveDetails.previousVersionId,
      firstVersionId.active_version_id,
      're-save audit points at the previous version for traceability',
    );

    const resaveCalculation = await api(baseUrl, '/api/tax-packs/test-calculation', {
      method: 'POST',
      body: { category_id: 'standard', amount: '1000', tax_behavior: 'exclusive' },
      headers: manager.authHeader,
    });
    assertEqual(
      resaveCalculation.data.calculation.taxAmount,
      '105.00',
      're-saved 10.5% exclusive computes ARS 105.00 tax on ARS 1000',
    );

    // Decision F carry-over: merchant override created against version N
    // must apply against version N+1 after the re-save.
    const overrideAfter = db.prepare(
      'SELECT pack_version_id FROM tax_overrides WHERE id = ?'
    ).get(manualOverrideId) as { pack_version_id: string };
    assertEqual(
      overrideAfter.pack_version_id,
      `manual-ar@${resave.data.version}`,
      'merchant override is re-pointed at the new active version after re-save',
    );
    assert(
      overrideAfter.pack_version_id !== overrideBefore.pack_version_id,
      'override moved off the demoted previous version',
    );

    console.log('\n13. resolveTaxIdLabel prefers the active pack over main/countries.ts');
    const { resolveTaxIdLabel } = require('../main/services/tax');
    // Manual pack (section 12 re-save) is active for AR — the label comes
    // from the latest active version: section 10 set label="CUIT"; section
    // 12 re-saved with label="GST", so the active version wins.
    assertEqual(
      resolveTaxIdLabel('AR'),
      'GST',
      'latest active manual version wins over countries.ts for the registration label',
    );
    // Unknown country: only the bundled generic pack covers it (country='*'),
    // but `resolveTaxIdLabel` only trusts country-specific pack labels — for
    // an unknown country it falls through to countries.ts (no entry) and the
    // hardcoded "Tax ID" fallback.
    assertEqual(
      resolveTaxIdLabel('ZZ'),
      'Tax ID',
      'unknown country falls back to the hardcoded "Tax ID" default',
    );
    // Country that only lives in countries.ts (no pack installed) still
    // resolves through the legacy fallback.
    assertEqual(
      resolveTaxIdLabel('TH'),
      'Tax ID',
      'TH falls back to countries.ts "Tax ID" when no pack is installed',
    );
  } finally {
    server.close();
    closeDatabase();
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  }

  const { passed, failed, total } = getResults();
  console.log('\n' + '='.repeat(56));
  console.log(`${passed}/${total} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error: any) => {
  console.error('Tax pack management test runner failed:', error);
  process.exit(1);
});
