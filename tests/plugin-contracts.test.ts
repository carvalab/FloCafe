import assert from 'node:assert/strict';
import {
  PluginRegistry,
  type PaymentConnector,
  validatePluginRequestEnvelope,
  validatePluginResultEnvelope,
} from '../main/plugins/contracts';
import { evaluateMercadoPagoConfiguration, mercadoPagoConnectorHandler } from '../main/plugins/ar/mercado-pago';
import { validateDeliveryPollingConfig, deliveryPollingHandlers } from '../main/plugins/connectors/delivery-polling';
import { getConnectorHandler, hasConnectorHandler, listConnectorHandlers } from '../main/plugins/connector-handlers';
import { getTaxEngineForCountry } from '../main/plugins/runtime-registry';
import { arTaxEngine } from '../main/plugins/ar/tax-engine';
import { getAllPackages } from '../main/plugins/registry';
import { satisfiesSemverRange, validateManifest } from '../main/plugins/manifest';
import {
  definePluginRuntimeBundle,
  isRuntimeCapabilityKind,
  PluginRuntimeKind,
  type PluginManifest,
  type TaxEngine,
} from '../main/plugins/api-types';
import { calculateItemTax } from '../main/services/tax';

const manifest: PluginManifest = {
  manifestVersion: 1,
  id: 'country.ar',
  version: '1.0.0',
  publisher: { id: 'flo', name: 'Flo' },
  displayName: { en: 'Argentina' },
  scope: 'country',
  countries: ['AR'],
  floApiVersion: '^1.0.0',
  execution: ['in_process', 'hosted'],
  capabilities: [{
    // In-process tax engine: the registry accepts this as a runtime.
    id: 'tax.iva',
    kind: 'tax',
    execution: 'in_process',
    provider: 'ar_iva',
    operations: ['calculate'],
    displayName: { en: 'IVA calculation' },
  }, {
    // Hosted payment capability: declared only, no runtime expected.
    id: 'payment.mercado_pago',
    kind: 'payment',
    execution: 'hosted',
    provider: 'mercado_pago',
    primitive: 'qr',
    operations: ['initialize', 'status', 'refund'],
    displayName: { en: 'Mercado Pago QR' },
  }],
  permissions: ['payment.write', 'fiscal.write'],
  artifact: { digest: 'built-in', signature: 'built-in' },
};

const taxConnector: TaxEngine<'tax.iva'> = {
  capabilityId: 'tax.iva',
  calculate() {
    return {
      subtotal: { amountMinor: 0, currency: 'ARS' },
      lines: [],
      totalTax: { amountMinor: 0, currency: 'ARS' },
      total: { amountMinor: 0, currency: 'ARS' },
    };
  },
};

const connector: PaymentConnector = {
  capabilityId: 'payment.mercado_pago',
  primitive: 'qr',
  async describe() {
    return {
      id: 'payment.mercado_pago',
      primitive: 'qr',
      provider: 'mercado_pago',
      countries: ['AR'],
      currencies: ['ARS'],
      onlineRequired: true,
      operations: ['initialize', 'status', 'settle', 'cancel', 'refund'],
    };
  },
  async initialize() { return { status: 'success', paymentId: 'pay-1' }; },
  async status() { return { status: 'success', providerReference: 'pay-1' }; },
  async settle() { return { status: 'success', providerReference: 'pay-1' }; },
  async cancel() { return { status: 'success', providerReference: 'pay-1' }; },
  async refund() { return { status: 'success', providerReference: 'refund-1' }; },
};

async function main(): Promise<void> {
  assert.equal(validateManifest(manifest).valid, true);
  assert.equal(satisfiesSemverRange('1.9.0', '^1.0.0'), true);
  assert.equal(satisfiesSemverRange('2.0.0', '^1.0.0'), false);
   assert.equal(satisfiesSemverRange('1.2.9', '~1.2.3'), true);
   assert.equal(satisfiesSemverRange('1.3.0', '~1.2.3'), false);
   assert.equal(satisfiesSemverRange('1.0.0', '>=2.0.0 || >=1.0.0'), true);
   assert.equal(satisfiesSemverRange('1.0.0-rc.1', '>=1.0.0-rc.1 <1.0.0'), true);
   assert.equal(satisfiesSemverRange('1.0.0', '<1.0.0-rc.1'), false);

  const invalidScope = { ...manifest, scope: 'country' as const, countries: [] };
  assert.equal(validateManifest(invalidScope).valid, false);
  assert.match(validateManifest(invalidScope).errors[0].field, /countries/);

  const invalidCapability = {
    ...manifest,
    capabilities: [manifest.capabilities[0], manifest.capabilities[0]],
  };
  assert.equal(validateManifest(invalidCapability).valid, false);
  assert.match(validateManifest(invalidCapability).errors[0].field, /capabilities/);

  // Per-capability `execution` is required.
  const missingExecution = {
    ...manifest,
    capabilities: [{ id: 'tax.x', kind: 'tax', operations: ['calculate'], displayName: { en: 'Tax X' } }],
  };
  assert.equal(validateManifest(missingExecution).valid, false);

  const incompatibleApi = { ...manifest, floApiVersion: '>=2.0.0' };
  assert.equal(validateManifest(incompatibleApi).valid, false);
  assert.equal(validateManifest({ ...manifest, version: '1.0.0-invalid' }).valid, false);
  assert.equal(validateManifest({ ...manifest, configurationSchema: '' }).valid, false);
  assert.equal(validateManifest({ ...manifest, connectorIds: ['mercado', 'mercado'] }).valid, false);
  assert.equal(validateManifest({ ...manifest, permissions: ['payment.write', 'payment.write'] }).valid, false);
  assert.equal(validateManifest({ ...manifest, permissions: ['unknown.permission'] as any }).valid, false);
  assert.equal(validateManifest({ ...manifest, artifact: { digest: '', signature: 'sig' } }).valid, false);

  const deliveryDefaults = validateDeliveryPollingConfig({ providers: [{ provider: 'rappi', enabled: true } as any] });
  assert.equal(deliveryDefaults.valid, true);
  assert.equal(deliveryDefaults.resolved.providers[0].intervalSeconds, 30);
  assert.equal(validateDeliveryPollingConfig({ providers: [
    { provider: 'rappi', intervalSeconds: 14, enabled: true },
  ] }).valid, false);

  assert.equal(validatePluginRequestEnvelope({
    schemaVersion: 1,
    requestId: 'req-1',
    idempotencyKey: 'idem-1',
    pluginId: manifest.id,
    capability: 'payment.mercado_pago',
    createdAt: new Date().toISOString(),
    payload: { amountMinor: 1000 },
  }), true);
  assert.equal(validatePluginRequestEnvelope({
    schemaVersion: 2,
    requestId: 'req-1',
    idempotencyKey: 'idem-1',
    pluginId: manifest.id,
    capability: 'payment.mercado_pago',
    createdAt: new Date().toISOString(),
    payload: {},
  }), false);
  // Tax engines are only exposed when the country package is installed
  // AND activated. Without a DB seed, both built-ins look "uninstalled"
  // and the dispatcher must fall back to the default. The tax
  // dispatcher is exercised end-to-end below; here we just check the
  // activation-aware guard returns undefined for an unactivated store.
  const unactivatedTax = getTaxEngineForCountry('ZZ');
  assert.equal(unactivatedTax, undefined);
  const arTax = arTaxEngine.calculate({
    installationId: 'test', storeId: 'test', country: 'AR', requestId: 'tax-1', currency: 'ARS',
    lines: [{ description: 'Coffee', quantity: 1, unitPrice: { amountMinor: 10_000, currency: 'ARS' }, tax: { rate: 21, included: true } }],
  });
  assert.equal(arTax.lines[0].label, 'IVA');
  assert.equal(arTax.totalTax.amountMinor, 1736);
  const builtinPackages = getAllPackages();
  assert.equal(new Set(builtinPackages.map((plugin) => plugin.id)).size, builtinPackages.length);
  assert.equal(builtinPackages.every((plugin) => validateManifest(plugin).valid), true);
  assert.equal(validatePluginResultEnvelope({
    schemaVersion: 1,
    requestId: 'req-1',
    status: 'success',
    result: { providerReference: 'pay-1' },
  }), true);
  assert.equal(validatePluginResultEnvelope({
    schemaVersion: 1,
    requestId: 'req-1',
    status: 'failed',
  }), false);
  assert.equal(validateDeliveryPollingConfig({ providers: [
    { provider: 'rappi', intervalSeconds: 30, enabled: true },
    { provider: 'rappi', intervalSeconds: 60, enabled: true },
  ] }).valid, false);

  const mercadoPagoConfig = evaluateMercadoPagoConfiguration({
    storeId: 'store-ar',
    externalPosId: 'POS-001',
    qrMode: 'dynamic',
  });
  assert.deepEqual(mercadoPagoConfig.missing, []);
  assert.equal(mercadoPagoConfig.qrMode, 'dynamic');

  // ── Connector handler registry (provider-specific behavior moved
  //    out of the route layer) ───────────────────────────────────────
  assert.equal(hasConnectorHandler('mercado_pago'), true);
  assert.equal(getConnectorHandler('mercado_pago')?.provider, 'mercado_pago');
  assert.equal(getConnectorHandler('pedidosya')?.provider, 'pedidosya');
  assert.equal(getConnectorHandler('unknown_provider'), undefined);
  const handlerList = listConnectorHandlers();
  assert.ok(handlerList.length >= 4, 'all delivery providers + Mercado Pago registered');

  // The MercadoPago handler validates config and summarizes safely.
  const mpValidation = mercadoPagoConnectorHandler.validate({
    storeId: 's', externalPosId: 'p', qrMode: 'dynamic',
  });
  assert.equal(mpValidation.valid, true);
  assert.deepEqual(mpValidation.resolved, { storeId: 's', externalPosId: 'p', qrMode: 'dynamic' });
  const mpSummary = mercadoPagoConnectorHandler.summarize(
    { providerAccountRef: null, authStatus: 'unauthorized', readiness: 'configured', lastHealthCheckAt: null, lastError: null },
    { storeId: 's', externalPosId: 'p', qrMode: 'dynamic' },
  );
  assert.equal((mpSummary as { configuration: { missing: string[] } }).configuration.missing.length, 0);

  // Delivery providers each have their own handler with the right id.
  for (const provider of ['pedidosya', 'rappi', 'uber_eats', 'swiggy', 'zomato']) {
    const handler = deliveryPollingHandlers[provider];
    assert.ok(handler, `delivery handler for ${provider} registered`);
    const validation = handler.validate({ providers: [{ provider, enabled: true }] });
    assert.equal(validation.valid, true);
  }
  // Cross-provider rejection: pedidosya handler refuses unknown provider.
  const crossProvider = deliveryPollingHandlers.pedidosya!.validate({
    providers: [{ provider: 'unknown_provider' as any, enabled: true }],
  });
  assert.equal(crossProvider.valid, false);
  // The pedidosya handler does accept swiggy (delivery config is
  // shared). That's fine — a merchant could legitimately operate
  // pedidosya and swiggy from the same delivery account. The provider
  // routing in the route layer is based on the capability's `provider`,
  // not the polling config.

  // ── Plugin registry: distinguishes in-process vs hosted runtimes ──
  const registry = new PluginRegistry();
  // Hosted capabilities must not have a runtime; passing one is an
  // error. The bundle only declares a runtime for the in-process tax
  // engine.
  const bundle = definePluginRuntimeBundle({
    manifest,
    runtimes: [{ kind: PluginRuntimeKind.Tax, connector: taxConnector }],
  });
  registry.register(bundle);
  assert.equal(registry.capabilities('tax')[0].capabilityId, 'tax.iva');
  assert.equal(registry.capabilities('payment')[0].capabilityId, 'payment.mercado_pago');
  assert.equal(registry.runtime(manifest.id, 'tax.iva')?.kind, 'tax');
  // No runtime was registered for the hosted payment capability.
  assert.equal(registry.runtime(manifest.id, 'payment.mercado_pago'), undefined);
  assert.throws(() => registry.register(bundle), /already registered/);

  // Hosted capability + runtime is a registration error.
  const hostedWithRuntime = new PluginRegistry();
  assert.throws(
    () => hostedWithRuntime.register({
      manifest,
      runtimes: [
        { kind: PluginRuntimeKind.Tax, connector: taxConnector },
        { kind: PluginRuntimeKind.Payment, connector },
      ],
    }),
    /hosted capabilities must not have an in-process runtime/,
  );

  // In-process capability without a runtime is a registration error.
  const inProcessMissing = new PluginRegistry();
  assert.throws(
    () => inProcessMissing.register({
      manifest,
      runtimes: [],
    }),
    /is declared as in_process but no runtime was provided/,
  );

  // Kind mismatch: runtime kind is `tax` but the declared capability
  // is `payment`. We use a fresh manifest with two tax capabilities so
  // this test isolates the kind-mismatch path (a hosted capability
  // would trip the in_process/hosted gate first).
  const taxOnlyManifest: PluginManifest = {
    ...manifest,
    capabilities: [
      { id: 'tax.alpha', kind: 'tax', execution: 'in_process', operations: ['calculate'], displayName: { en: 'Tax Alpha' } },
      { id: 'tax.beta', kind: 'tax', execution: 'in_process', operations: ['calculate'], displayName: { en: 'Tax Beta' } },
    ],
  };
  const invalidRegistry = new PluginRegistry();
  assert.throws(
    () => invalidRegistry.register({
      manifest: taxOnlyManifest,
      runtimes: [
        // Right kind, wrong capability id. Bypasses the
        // `not declared` check (tax.beta is declared as tax) and
        // instead exercises the kind-mismatch check.
        { kind: PluginRuntimeKind.Tax, connector: { capabilityId: 'tax.beta', calculate() { return { subtotal: { amountMinor: 0, currency: 'ARS' }, lines: [], totalTax: { amountMinor: 0, currency: 'ARS' }, total: { amountMinor: 0, currency: 'ARS' } }; } } },
        // Wrong kind: runtime is `payment` but capability `tax.alpha` is `tax`.
        { kind: PluginRuntimeKind.Payment, connector: { capabilityId: 'tax.alpha', primitive: 'qr', async describe() { return { id: 'tax.alpha', primitive: 'qr', provider: 'x', countries: [], currencies: [], onlineRequired: false, operations: [] }; }, async initialize() { return { status: 'success' as const }; }, async status() { return { status: 'success' as const }; }, async settle() { return { status: 'success' as const }; }, async cancel() { return { status: 'success' as const }; }, async refund() { return { status: 'success' as const }; } } },
      ],
    }),
    /not declared as payment/,
  );

  // Generic fiscal identity is `{type, value}`. GSTIN is one possible
  // type. Tax math doesn't depend on it; the tax engine receives the
  // generic envelope and decides whether the type matters.
  const genericIdentity = { type: 'gstin', value: '27ABCDE1234F1Z5' };
  const cuitIdentity = { type: 'cuit', value: '20-12345678-9' };
  const result = await connector.initialize(
    {
      installationId: 'install-1',
      storeId: 'store-1',
      country: 'AR',
      requestId: 'request-1',
      capabilityId: 'payment.mercado_pago',
      orderId: 'order-1',
      amount: { amountMinor: 10000, currency: 'ARS' },
      idempotencyKey: 'payment-order-1',
    },
  );
  assert.equal(result.paymentId, 'pay-1');
  // The two identities are structurally the same — only the type tag differs.
  assert.equal(typeof genericIdentity.type, 'string');
  assert.equal(typeof cuitIdentity.type, 'string');
  assert.notEqual(genericIdentity.type, cuitIdentity.type);

  // ── Tax engine kind gating ─────────────────────────────────────────
  // Only `tax` is runnable in Stage 1. Everything else is hosted.
  assert.equal(isRuntimeCapabilityKind('tax'), true);
  assert.equal(isRuntimeCapabilityKind('payment'), false);
  assert.equal(isRuntimeCapabilityKind('delivery'), false);
  assert.equal(isRuntimeCapabilityKind('fiscal'), false);

  // ── No active tax pack: the dispatcher must not crash ─────────────
  // Without an active AR/IN or global default installation, the tax
  // dispatcher returns a zero-tax line. The country switch and default
  // / Thailand branches were moved into the `global.default` runtime —
  // the dispatcher only retains the early `tax_type === 'none'` guard.
  const noEngine = calculateItemTax(
    { country: 'ZZ', business_type: 'restaurant', state_code: '' },
    { tax_type: 'exclusive', tax_rate: 10 },
    100,
    null,
  );
  assert.equal(noEngine.tax_type, 'exclusive');
  assert.equal(noEngine.tax_amount, 0);
  assert.deepEqual(noEngine.tax_breakdown, []);

  // tax_type === 'none' is the only fast-path the dispatcher retains
  // directly; everything else flows through the plugin runtime.
  const noTax = calculateItemTax(
    { country: 'ZZ', business_type: 'restaurant', state_code: '' },
    { tax_type: 'none', tax_rate: 0 },
    100,
    null,
  );
  assert.equal(noTax.tax_type, 'none');
  assert.equal(noTax.tax_amount, 0);

  console.log('Plugin contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
