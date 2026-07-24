/**
 * Shared plugin API types — safe to import from the frontend.
 *
 * This file contains only browser-safe types and Zod schemas. It has no
 * express, better-sqlite3, or Node-only imports, so the static-export
 * frontend can validate API responses without pulling in the backend.
 */

import { z } from 'zod';

export type PluginScope = 'country' | 'multi_country' | 'global';

/**
 * Where the package's executable code lives. Stage 1 in-repo packages only
 * use `in_process` (typed runtime inside the Flo main process) and
 * `hosted` (declared provider connector waiting for the Stage 3 broker).
 * `utility_process` is kept for the future ABI plan in docs/plugin-proposal.md.
 */
export type PluginExecution = 'in_process' | 'utility_process' | 'hosted';

export const PluginCapabilityKind = {
  Payment: 'payment',
  Tax: 'tax',
  Fiscal: 'fiscal',
  Delivery: 'delivery',
  Admin: 'admin',
} as const;

export type PluginCapabilityKind = typeof PluginCapabilityKind[keyof typeof PluginCapabilityKind];

/**
 * Where a single capability's executable code lives. This is distinct from
 * the manifest-level `execution` array: a country package may declare both
 * local in-process capabilities (its tax engine) and hosted capabilities
 * (Mercado Pago, PedidosYa) at the same time. The runtime registry only
 * contains a runtime for the in-process ones, and the activation gate
 * refuses to claim a hosted capability is "verified" when no in-process
 * runtime exists.
 */
export type PluginCapabilityExecution = 'in_process' | 'hosted';

export type PluginCapabilityPrimitive = 'cash' | 'card' | 'qr';

export const PluginRuntimeKind = {
  Payment: PluginCapabilityKind.Payment,
  Tax: PluginCapabilityKind.Tax,
  Fiscal: PluginCapabilityKind.Fiscal,
  Delivery: PluginCapabilityKind.Delivery,
} as const;

export type PluginRuntimeKind = typeof PluginRuntimeKind[keyof typeof PluginRuntimeKind];

export const PluginPermission = {
  SettingsRead: 'settings.read',
  SettingsWrite: 'settings.write',
  PaymentWrite: 'payment.write',
  FiscalWrite: 'fiscal.write',
  DeliveryEvents: 'delivery.events',
  BrokerConnect: 'broker.connect',
} as const;

export const PLUGIN_PERMISSIONS = [
  PluginPermission.SettingsRead,
  PluginPermission.SettingsWrite,
  PluginPermission.PaymentWrite,
  PluginPermission.FiscalWrite,
  PluginPermission.DeliveryEvents,
  PluginPermission.BrokerConnect,
] as const;

export type PluginPermission = typeof PLUGIN_PERMISSIONS[number];

export interface PluginPublisher {
  id: string;
  name: string;
}

/**
 * Localized display metadata. The catalog and detail dialog surface this
 * verbatim, so a package's operator-facing copy lives on the manifest it
 * shipped, not in the frontend. `locale` accepts the same tags as the
 * Flo i18n module (e.g. `en`, `es`).
 */
export interface PluginDisplayText {
  en: string;
  es?: string;
}

/**
 * Field metadata for a configurable capability. The frontend renders each
 * field with the right control and submits the value back through
 * `/api/plugins/installations/:id/connectors/:capabilityId` along with
 * `providerAccountRef`. Adding a new provider no longer requires editing
 * the frontend.
 */
export type PluginConfigField =
  | { name: string; label: PluginDisplayText; kind: 'text'; required: boolean; placeholder?: PluginDisplayText; help?: PluginDisplayText }
  | { name: string; label: PluginDisplayText; kind: 'select'; required: boolean; options: Array<{ value: string; label: PluginDisplayText }>; help?: PluginDisplayText }
  | { name: string; label: PluginDisplayText; kind: 'number'; required: boolean; min?: number; max?: number; step?: number; suffix?: PluginDisplayText; help?: PluginDisplayText }
  | { name: string; label: PluginDisplayText; kind: 'boolean'; required: boolean; help?: PluginDisplayText };

export interface PluginCapabilityConfiguration {
  /** Stable provider id matching `capability.provider` (e.g. `mercado_pago`). */
  provider: string;
  fields: PluginConfigField[];
}

export type PluginCapabilityReadinessNeed = 'connector_account' | 'connector_authorization' | 'connector_verification' | 'connector_verification_hosted';

type PluginCapabilityBase<Kind extends PluginCapabilityKind, Operation extends string> = {
  id: string;
  kind: Kind;
  /**
   * Whether this capability has an executable in-process runtime in this
   * package. `in_process` means the runtime registry owns a function
   * implementation; `hosted` means the package only declares the
   * capability and lets the Stage 3 broker satisfy it. The runtime
   * registry must NOT carry a runtime for `hosted` capabilities.
   */
  execution: PluginCapabilityExecution;
  provider?: string;
  /** ISO country codes this capability is available in. Empty array = inherits package scope. */
  countries?: string[];
  operations: Operation[];
  /** Operator-facing label and description. Surfaced verbatim in the merchant UI. */
  displayName: PluginDisplayText;
  description?: PluginDisplayText;
  /** Configuration schema surfaced by the merchant detail dialog. Optional. */
  configuration?: PluginCapabilityConfiguration;
};

export type PluginCapability =
  | (PluginCapabilityBase<'payment', 'initialize' | 'status' | 'settle' | 'cancel' | 'refund'> & { primitive: PluginCapabilityPrimitive })
  | PluginCapabilityBase<'tax', 'calculate'>
  | PluginCapabilityBase<'fiscal', 'issue' | 'retry' | 'cancel'>
  | PluginCapabilityBase<'delivery', 'receive_order' | 'accept' | 'deny' | 'ready' | 'cancel'>
  | PluginCapabilityBase<'admin', 'configure'>;

/**
 * Capability kinds that may declare a runtime. `tax` is the only kind with
 * a real in-process implementation worth bundling in Stage 1: a country
 * package's local tax engine runs synchronously inside the order/bill
 * transaction. Everything else is provider-owned and lives in the hosted
 * broker; the package only declares it.
 */
export const RUNTIME_CAPABILITY_KINDS: readonly PluginCapabilityKind[] = ['tax'];

export interface HostedTopology {
  serviceBaseUrl?: string;
  polling?: {
    baseUrl: string;
    resources: string[];
    intervalSeconds: number;
  };
  webhookRoutes?: Array<{
    provider: string;
    events: string[];
    signature: string;
  }>;
  allowedOutboundHosts?: string[];
  healthEndpoint?: string;
}

export interface PluginManifest {
  manifestVersion: 1;
  id: string;
  version: string;
  publisher: PluginPublisher;
  displayName: PluginDisplayText;
  description?: PluginDisplayText;
  scope: PluginScope;
  countries: string[];
  floApiVersion: string;
  /**
   * Coarse-grained execution modes the package supports. Today this is
   * purely informational; the per-capability `execution` field is the
   * source of truth for whether a runtime exists.
   */
  execution: PluginExecution[];
  capabilities: PluginCapability[];
  permissions: PluginPermission[];
  configurationSchema?: string;
  /**
   * Optional. Kept only for backwards compatibility; the canonical
   * host-facing provider identifiers are the per-capability `provider`
   * values plus the connector handler registry, not this list.
   * @deprecated
   */
  connectorIds?: string[];
  hosted?: HostedTopology;
  artifact: { digest: string; signature: string };
}

/** Catalog entry — what the merchant-facing catalog derives from a manifest. */
export interface CatalogListing {
  listingId: string;
  packageId: string;
  packageVersion: string;
  publisher: PluginPublisher;
  name: PluginDisplayText;
  description?: PluginDisplayText;
  scope: PluginScope;
  countries: string[];
  capabilities: PluginCapability[];
  trustLevel: 'flo_builtin' | 'flo_verified' | 'partner_verified' | 'community';
  execution: PluginExecution[];
  /** Whether installing requires a merchant-supplied provider account before activation. */
  providerAccountRequired: boolean;
  supportUrl?: string;
  /** Full manifest, so the frontend doesn't need a separate fetch. */
  manifest: PluginManifest;
}

/** Installation state per store. */
export type InstallationStatus = 'installed' | 'activated' | 'disabled' | 'uninstalled';

/** Per-feature state inside an installation. */
export type FeatureActivationStatus = 'inactive' | 'activating' | 'active' | 'deactivating' | 'deactivated';

/** Connector account readiness — separate from feature activation because some features
 *  need an authorized provider account before they can be activated. */
export type ConnectorReadinessStatus = 'unconfigured' | 'configured' | 'verified' | 'failed';

/** Connector account: one merchant-scoped provider account per package installation. */
export interface ConnectorAccount {
  id: string;
  storeId: string;
  installationId: string;
  packageId: string;
  capabilityId: string;
  provider: string;
  /** Opaque store-side reference (e.g. "mercadopago-store-42"). No secrets. */
  providerAccountRef: string | null;
  authStatus: 'unauthorized' | 'authorized' | 'expired' | 'revoked';
  readiness: ConnectorReadinessStatus;
  lastHealthCheckAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Feature state inside an installation. */
export interface InstallationFeature {
  installationId: string | null;
  capabilityId: string;
  status: FeatureActivationStatus;
  activatedAt: string | null;
  deactivatedAt: string | null;
  notes: string | null;
  requirementsMet?: boolean;
  missingRequirements?: PluginCapabilityReadinessNeed[];
}

/** Installation record. */
export interface Installation {
  id: string;
  packageId: string;
  packageVersion: string;
  status: InstallationStatus;
  installedAt: string;
  activatedAt: string | null;
  disabledAt: string | null;
  installedBy: string | null;
  notes: string | null;
  grantedPermissions: string[];
}

/** Catalog entry merged with per-store install/feature state — the response shape for /api/plugins/catalog. */
export interface CatalogEntry extends CatalogListing {
  installation: Installation | null;
  features: InstallationFeature[];
  connectorAccounts: ConnectorAccount[];
}

/** Configuration-status summary — the response shape for /api/plugins/installations/:id/configuration-status. */
export interface ConfigurationStatus {
  installationId: string;
  packageId: string;
  packageVersion: string;
  features: Array<{
    capabilityId: string;
    status: FeatureActivationStatus;
    /** True when every requirement listed in `missingRequirements` is empty. */
    requirementsMet: boolean;
    missingRequirements: PluginCapabilityReadinessNeed[];
    warnings: string[];
  }>;
  connectors: Array<{
    connectorId: string;
    capabilityId: string;
    provider: string;
    authStatus: ConnectorAccount['authStatus'];
    readiness: ConnectorAccount['readiness'];
    lastHealthCheckAt: string | null;
  }>;
}

/** Standard error shape for manifest validation — never throw a stack on the merchant UI. */
export interface ManifestValidationError {
  field: string;
  message: string;
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: ManifestValidationError[];
}

/**
 * Wire-shape payment method exposed by `/api/plugins/payment-methods`. The
 * frontend gets the canonical `key`, label resource key, and provider
 * identity, then maps it to a local icon based on `primitive` so the UI
 * never hard-codes vendor ids.
 */
export interface PluginPaymentMethod {
  key: string;
  labelKey?: string;
  label?: PluginDisplayText;
  provider: string;
  /**
   * One of `cash` | `card` | `qr`. Lets the frontend pick an icon
   * without hard-coding provider-specific identification.
   */
  primitive?: PluginCapabilityPrimitive;
  countries?: string[];
}

export type PaymentMethodDescriptor = PluginPaymentMethod;

// ── Connector runtime hooks (no DB, no express, no Node-only APIs) ────────

/**
 * Generic fiscal identity. The frontend and the backend only know that
 * it has a stable `type` (e.g. `gstin`, `cuit`, `ein`) and a `value`.
 * Country-specific tax engines (India GST, AR IVA) interpret the type
 * they recognize. GST computation lives in the India tax engine; the
 * fiscal invoice authorization is a separate `fiscal.*` capability and
 * is not part of tax math.
 */
export interface FiscalIdentity {
  type: string;
  value: string;
}

export type CountryCode = string;
export type CurrencyCode = string;

export type Money = {
  amountMinor: number;
  currency: CurrencyCode;
};

export type ConnectorContext = {
  installationId: string;
  storeId: string;
  country: CountryCode;
  requestId: string;
};

export type OperationResult =
  | { status: 'success'; providerReference?: string; metadata?: Record<string, unknown> }
  | { status: 'pending'; providerReference?: string; action?: string; metadata?: Record<string, unknown> }
  | { status: 'failed'; code: string; message: string; retryable: boolean };

export type PluginRequestEnvelope<T = Record<string, unknown>> = {
  schemaVersion: 1;
  requestId: string;
  idempotencyKey: string;
  pluginId: string;
  capability: string;
  createdAt: string;
  payload: T;
};

export type PluginResultEnvelope<T = Record<string, unknown>> = {
  schemaVersion: 1;
  requestId: string;
  status: 'success' | 'pending' | 'failed';
  result?: T;
  error?: { code: string; message: string; retryable: boolean };
};

export type PaymentPrimitive = 'cash' | 'card' | 'qr';

export type PaymentCapability = {
  id: string;
  primitive: PaymentPrimitive;
  provider: string;
  countries: CountryCode[];
  currencies: CurrencyCode[];
  onlineRequired: boolean;
  operations: Array<'initialize' | 'status' | 'settle' | 'cancel' | 'refund'>;
};

export type PaymentRequest = ConnectorContext & {
  capabilityId: string;
  orderId: string;
  amount: Money;
  idempotencyKey: string;
  customerId?: string;
  metadata?: Record<string, unknown>;
};

export type PaymentReference = {
  paymentId: string;
  providerReference?: string;
};

export interface PaymentConnector<CapabilityId extends string = string> {
  readonly capabilityId: CapabilityId;
  readonly primitive: PluginCapabilityPrimitive;
  describe(context: ConnectorContext): Promise<PaymentCapability>;
  initialize(request: PaymentRequest): Promise<OperationResult & { paymentId?: string }>;
  status(request: PaymentReference & ConnectorContext): Promise<OperationResult>;
  settle(request: PaymentReference & ConnectorContext): Promise<OperationResult>;
  cancel(request: PaymentReference & ConnectorContext): Promise<OperationResult>;
  refund(request: PaymentReference & ConnectorContext & { amount?: Money }): Promise<OperationResult>;
}

export interface TaxLine {
  code: string;
  label: string;
  rate: number;
  amount: Money;
  included: boolean;
}

export type TaxRequest = ConnectorContext & {
  currency: CurrencyCode;
  storeRegionCode?: string;
  lines: Array<{
    productId?: string;
    description: string;
    quantity: number;
    unitPrice: Money;
    tax: { rate: number; included: boolean; category?: string };
  }>;
  discounts?: Money;
  customer?: {
    fiscalIdentity?: FiscalIdentity;
    regionCode?: string;
    documentType?: string;
  };
};

export type TaxResult = {
  subtotal: Money;
  lines: TaxLine[];
  totalTax: Money;
  total: Money;
  legalMetadata?: Record<string, unknown>;
};

export interface TaxEngine<CapabilityId extends string = string> {
  readonly capabilityId: CapabilityId;
  calculate(request: TaxRequest): TaxResult;
}

export type FiscalDocumentRequest = ConnectorContext & {
  orderId: string;
  paymentId?: string;
  documentType: string;
  currency: CurrencyCode;
  issueDate: string;
  seller: {
    taxId: string;
    legalName: string;
    pointOfSale?: string;
  };
  customer?: {
    taxId?: string;
    documentType?: string;
    documentNumber?: string;
    name?: string;
  };
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: Money;
    taxLines: TaxLine[];
  }>;
  totals: TaxResult;
  idempotencyKey: string;
};

export type FiscalDocumentResult = OperationResult & {
  documentId?: string;
  documentNumber?: string;
  authorizationCode?: string;
  authorizationExpiresAt?: string;
  qrPayload?: string;
};

export interface FiscalDocumentProvider<CapabilityId extends string = string> {
  readonly capabilityId: CapabilityId;
  issue(request: FiscalDocumentRequest): Promise<FiscalDocumentResult>;
  retry(request: FiscalDocumentRequest & { documentId?: string }): Promise<FiscalDocumentResult>;
  cancel(request: ConnectorContext & { documentId: string; reason: string }): Promise<FiscalDocumentResult>;
}

export type DeliveryOrder = {
  externalOrderId: string;
  source: string;
  storeId: string;
  customer?: { name?: string; phone?: string; address?: string };
  items: Array<{ externalItemId?: string; name: string; quantity: number; notes?: string }>;
  total: Money;
  tax?: Money;
  deliveryFee?: Money;
  paymentStatus: 'pending' | 'paid' | 'failed' | 'unknown';
  requestedAt: string;
  acceptDeadline?: string;
};

export type DeliveryEvent =
  | { type: 'order.created'; eventId: string; order: DeliveryOrder }
  | { type: 'order.updated'; eventId: string; order: DeliveryOrder }
  | { type: 'order.cancelled'; eventId: string; externalOrderId: string; reason?: string };

export type DeliveryCommand =
  | { type: 'accept'; externalOrderId: string; readyAt?: string }
  | { type: 'deny'; externalOrderId: string; reason: string }
  | { type: 'start_preparing'; externalOrderId: string }
  | { type: 'ready'; externalOrderId: string }
  | { type: 'dispatched'; externalOrderId: string }
  | { type: 'cancel'; externalOrderId: string; reason: string };

export interface DeliveryConnector<CapabilityId extends string = string> {
  readonly capabilityId: CapabilityId;
  poll(context: ConnectorContext, cursor?: string): Promise<{
    events: DeliveryEvent[];
    nextCursor?: string;
    retryAfterSeconds?: number;
  }>;
  send(context: ConnectorContext, command: DeliveryCommand, idempotencyKey: string): Promise<OperationResult>;
}

export interface PluginEvent<T = Record<string, unknown>> {
  schemaVersion: 1;
  eventId: string;
  idempotencyKey: string;
  pluginId: string;
  capability: string;
  aggregateId: string;
  occurredAt: string;
  payload: T;
}

export interface ConnectorCommand<T = Record<string, unknown>> {
  schemaVersion: 1;
  commandId: string;
  idempotencyKey: string;
  pluginId: string;
  connectorAccountId: string;
  capability: string;
  createdAt: string;
  payload: T;
}

export type PluginRuntime =
  | { kind: typeof PluginRuntimeKind.Payment; connector: PaymentConnector }
  | { kind: typeof PluginRuntimeKind.Tax; connector: TaxEngine }
  | { kind: typeof PluginRuntimeKind.Fiscal; connector: FiscalDocumentProvider }
  | { kind: typeof PluginRuntimeKind.Delivery; connector: DeliveryConnector };

/**
 * Result of validating a connector configuration payload. The plugin
 * package owns this shape; the route just dispatches.
 */
export interface ConnectorConfigValidation {
  valid: boolean;
  errors: string[];
  /** Normalized payload ready to persist in `plugin_connector_accounts.config_json`. */
  resolved: unknown;
}

/**
 * The plugin package returns a small "config handler" bundle for each
 * provider capability that has a local configuration UI. The route
 * imports this from the plugin (currently via `main/plugins/<country>/<provider>.ts`)
 * and never branches on `provider === 'foo'`.
 */
export interface ConnectorConfigHandler {
  /** Provider id matching `capability.provider` (e.g. `mercadopago`). */
  provider: string;
  /** Capability id from the manifest this handler validates. */
  capabilityId: string;
  /** Field metadata rendered verbatim by the merchant detail dialog. */
  fields: PluginConfigField[];
  /**
   * Validate + normalize the inbound config payload. Returns the
   * validated fields resolved against any provider-specific defaults.
   */
  validate: (raw: unknown) => ConnectorConfigValidation;
  /**
   * Render a safe summary for the merchant UI. The connector account row
   * already exposes id/authStatus/readiness; this may add provider-specific
   * fields like `qrMode` or `providers`.
   */
  summarize: (account: {
    providerAccountRef: string | null;
    authStatus: ConnectorAccount['authStatus'];
    readiness: ConnectorAccount['readiness'];
    lastHealthCheckAt: string | null;
    lastError: string | null;
  }, resolvedConfig: unknown) => unknown;
}

type CapabilityForKind<Kind extends PluginCapabilityKind> =
  Extract<PluginCapability, { kind: Kind }>;

type RuntimeForCapability<Capability extends PluginCapability> =
  Capability extends { kind: typeof PluginRuntimeKind.Payment }
    ? { kind: typeof PluginRuntimeKind.Payment; connector: PaymentConnector<Capability['id']> }
    : Capability extends { kind: typeof PluginRuntimeKind.Tax }
      ? { kind: typeof PluginRuntimeKind.Tax; connector: TaxEngine<Capability['id']> }
      : Capability extends { kind: typeof PluginRuntimeKind.Fiscal }
        ? { kind: typeof PluginRuntimeKind.Fiscal; connector: FiscalDocumentProvider<Capability['id']> }
        : Capability extends { kind: typeof PluginRuntimeKind.Delivery }
          ? { kind: typeof PluginRuntimeKind.Delivery; connector: DeliveryConnector<Capability['id']> }
          : never;

type RuntimeForManifest<Manifest extends PluginManifest> = RuntimeForCapability<Manifest['capabilities'][number]>;

/** Flo-owned package boundary. Every bundled plugin exports this one shape. */
export type PluginRuntimeBundle = {
  manifest: PluginManifest;
  runtimes: PluginRuntime[];
};

/** Binds each bundled runtime to a capability declared by its own manifest. */
export function definePluginRuntimeBundle<const Manifest extends PluginManifest>(bundle: {
  manifest: Manifest;
  runtimes: RuntimeForManifest<Manifest>[];
}): PluginRuntimeBundle & { manifest: Manifest; runtimes: RuntimeForManifest<Manifest>[] } {
  return bundle;
}

/**
 * In-memory registry of plugin packages. Pure data structure — the backend
 * uses this for runtime registration; the frontend doesn't need it but
 * remains able to import it (no Node-only APIs).
 */
export class PluginRegistry {
  private readonly manifests = new Map<string, PluginManifest>();
  private readonly runtimes = new Map<string, PluginRuntime>();

  register(plugin: unknown): void {
    const bundleValidation = PluginRuntimeBundleSchema.safeParse(plugin);
    if (!bundleValidation.success) {
      throw new Error(`Invalid plugin runtime bundle: ${bundleValidation.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
    }
    if (!plugin || typeof plugin !== 'object') {
      throw new Error('Plugin bundle must be an object');
    }
    const { manifest, runtimes } = plugin as { manifest?: unknown; runtimes?: unknown };
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('Plugin manifest is missing');
    }
    if (!Array.isArray(runtimes)) {
      throw new Error('Plugin runtimes must be an array');
    }
    const manifestValidation = validateManifest(manifest);
    if (!manifestValidation.valid) {
      throw new Error(`Invalid plugin manifest: ${manifestValidation.errors.map((error) => error.field).join(', ')}`);
    }
    const m = manifest as PluginManifest;
    if (this.manifests.has(m.id)) throw new Error(`Plugin "${m.id}" is already registered`);

    const declared = new Map(m.capabilities.map((capability) => [capability.id, capability] as const));
    const seen = new Set<string>();
    for (const runtime of runtimes as PluginRuntime[]) {
      const capabilityId = runtime.connector.capabilityId;
      if (seen.has(capabilityId)) throw new Error(`Capability "${capabilityId}" has multiple runtimes`);
      const declaredCapability = declared.get(capabilityId);
      if (!declaredCapability) {
        throw new Error(`Runtime "${capabilityId}" is not declared in the manifest`);
      }
      if (declaredCapability.execution !== 'in_process') {
        throw new Error(
          `Runtime "${capabilityId}" is declared as hosted; hosted capabilities must not have an in-process runtime`,
        );
      }
      if (declaredCapability.kind !== runtime.kind) {
        throw new Error(`Runtime "${capabilityId}" is not declared as ${runtime.kind}`);
      }
      seen.add(capabilityId);
    }

    for (const capability of m.capabilities) {
      if (capability.execution === 'in_process' && !seen.has(capability.id)) {
        throw new Error(
          `Capability "${capability.id}" is declared as in_process but no runtime was provided`,
        );
      }
    }

    this.manifests.set(m.id, m);
    for (const runtime of runtimes as PluginRuntime[]) {
      this.runtimes.set(`${m.id}:${runtime.connector.capabilityId}`, runtime);
    }
  }

  manifest(pluginId: string): PluginManifest | undefined {
    return this.manifests.get(pluginId);
  }

  capabilities(kind?: PluginCapabilityKind): Array<{ pluginId: string; capabilityId: string; kind: PluginCapabilityKind }> {
    return Array.from(this.manifests.values()).flatMap((manifest) => manifest.capabilities
      .filter((capability) => !kind || capability.kind === kind)
      .map((capability) => ({ pluginId: manifest.id, capabilityId: capability.id, kind: capability.kind })));
  }

  runtime(pluginId: string, capabilityId: string): PluginRuntime | undefined {
    return this.runtimes.get(`${pluginId}:${capabilityId}`);
  }
}

/**
 * Structural manifest validation. Returns errors instead of throwing so the
 * UI can render them. This deliberately does NOT check runtime presence —
 * the runtime registry does that with full type checking.
 */
export function validateManifest(raw: unknown): ManifestValidationResult {
  const parsed = PluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    };
  }
  const errors: ManifestValidationError[] = [];
  const m = raw as Partial<PluginManifest>;

  if (m.manifestVersion !== 1) {
    errors.push({ field: 'manifestVersion', message: 'must be 1' });
  }
  if (typeof m.id !== 'string' || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(m.id)) {
    errors.push({ field: 'id', message: 'must be a dotted package identifier like "country.ar"' });
  }
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.version)) {
    errors.push({ field: 'version', message: 'must be a semver string like "1.0.0"' });
  }
  if (!m.publisher || typeof m.publisher !== 'object') {
    errors.push({ field: 'publisher', message: 'must be an object with id and name' });
  } else {
    if (typeof (m.publisher as PluginPublisher).id !== 'string' || !(m.publisher as PluginPublisher).id) {
      errors.push({ field: 'publisher.id', message: 'must be a non-empty string' });
    }
    if (typeof (m.publisher as PluginPublisher).name !== 'string' || !(m.publisher as PluginPublisher).name) {
      errors.push({ field: 'publisher.name', message: 'must be a non-empty string' });
    }
  }
  if (!m.displayName || typeof m.displayName !== 'object') {
    errors.push({ field: 'displayName', message: 'must be an object with at least an English label' });
  } else if (typeof (m.displayName as { en?: unknown }).en !== 'string' || !(m.displayName as { en: string }).en) {
    errors.push({ field: 'displayName.en', message: 'must be a non-empty string' });
  }
  if (m.scope !== 'country' && m.scope !== 'multi_country' && m.scope !== 'global') {
    errors.push({ field: 'scope', message: 'must be country, multi_country, or global' });
  }
  if (!Array.isArray(m.countries) || !m.countries.every((c) => typeof c === 'string' && c)) {
    errors.push({ field: 'countries', message: 'must be an array of non-empty strings' });
  } else if ((m.scope === 'country' || m.scope === 'multi_country') && m.countries.length === 0) {
    errors.push({ field: 'countries', message: 'country and multi_country scopes must list at least one country' });
  } else if (m.scope === 'global' && m.countries.length > 0) {
    errors.push({ field: 'countries', message: 'global scope must have an empty countries list' });
  }
  if (typeof m.floApiVersion !== 'string' || !m.floApiVersion) {
    errors.push({ field: 'floApiVersion', message: 'must be a semver range string' });
  }
  if (!Array.isArray(m.execution) || m.execution.length === 0) {
    errors.push({ field: 'execution', message: 'must list at least one execution mode' });
  } else {
    for (const mode of m.execution) {
      if (mode !== 'in_process' && mode !== 'utility_process' && mode !== 'hosted') {
        errors.push({ field: 'execution', message: `unknown mode "${String(mode)}"` });
      }
    }
  }
  if (!Array.isArray(m.capabilities) || m.capabilities.length === 0) {
    errors.push({ field: 'capabilities', message: 'must declare at least one capability' });
  } else {
    const ids = new Set<string>();
    for (const capability of m.capabilities) {
      if (!capability || typeof capability !== 'object') {
        errors.push({ field: 'capabilities', message: 'each capability must be an object' });
        continue;
      }
      const cap = capability as PluginCapability;
      const capId = typeof cap.id === 'string' ? cap.id : undefined;
      if (!capId) {
        errors.push({ field: 'capabilities.id', message: 'must be a non-empty string' });
      } else if (ids.has(capId)) {
        errors.push({ field: 'capabilities', message: 'must not contain duplicate capability IDs' });
      } else {
        ids.add(capId);
      }
      if (cap.execution !== 'in_process' && cap.execution !== 'hosted') {
        errors.push({ field: `capabilities.${capId ?? '?'}.execution`, message: 'must be in_process or hosted' });
      }
      if (!Array.isArray(cap.operations) || cap.operations.length === 0) {
        errors.push({ field: `capabilities.${capId ?? '?'}.operations`, message: 'must list at least one operation' });
      }
      if (!cap.displayName || typeof cap.displayName !== 'object' || typeof cap.displayName.en !== 'string' || !cap.displayName.en) {
        errors.push({ field: `capabilities.${capId ?? '?'}.displayName.en`, message: 'must be a non-empty string' });
      }
      if (cap.configuration && cap.configuration.provider !== cap.provider) {
        errors.push({ field: `capabilities.${capId ?? '?'}.configuration.provider`, message: 'must match capability.provider' });
      }
    }
  }
  if (!Array.isArray(m.permissions)) {
    errors.push({ field: 'permissions', message: 'must be an array' });
  } else {
    const seen = new Set<string>();
    for (const p of m.permissions) {
      if (typeof p !== 'string' || !PLUGIN_PERMISSIONS.includes(p as PluginPermission)) {
        errors.push({ field: 'permissions', message: `unknown permission "${String(p)}"` });
      } else if (seen.has(p)) {
        errors.push({ field: 'permissions', message: 'must not contain duplicates' });
      } else {
        seen.add(p);
      }
    }
  }
  if (m.connectorIds !== undefined) {
    if (!Array.isArray(m.connectorIds) || m.connectorIds.length === 0) {
      errors.push({ field: 'connectorIds', message: 'must be a non-empty array when present' });
    } else if (new Set(m.connectorIds).size !== m.connectorIds.length) {
      errors.push({ field: 'connectorIds', message: 'must not contain duplicates' });
    } else {
      for (const capability of m.capabilities || []) {
        if (capability.execution === 'hosted' && capability.provider && !m.connectorIds.includes(capability.provider)) {
          errors.push({ field: 'connectorIds', message: `must include hosted provider "${capability.provider}"` });
        }
      }
    }
  }
  if (m.configurationSchema !== undefined && m.configurationSchema === '') {
    errors.push({ field: 'configurationSchema', message: 'must be a non-empty string when present' });
  }
  if (!m.artifact || typeof m.artifact !== 'object') {
    errors.push({ field: 'artifact', message: 'must be an object with digest and signature' });
  } else {
    const artifact = m.artifact as { digest?: unknown; signature?: unknown };
    if (typeof artifact.digest !== 'string' || !artifact.digest) {
      errors.push({ field: 'artifact.digest', message: 'must be a non-empty string' });
    }
    if (typeof artifact.signature !== 'string' || !artifact.signature) {
      errors.push({ field: 'artifact.signature', message: 'must be a non-empty string' });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Type-level check: a `kind` is runnable in-process iff its runtime kind
 * matches and it appears in `RUNTIME_CAPABILITY_KINDS`. Today only `tax`
 * is runnable; payment, delivery, and fiscal authorization all live in
 * the hosted broker.
 */
export function isRuntimeCapabilityKind(kind: PluginCapabilityKind): boolean {
  return RUNTIME_CAPABILITY_KINDS.includes(kind);
}

const nonEmptyStringSchema = z.string().min(1);
const displayTextSchema = z.object({
  en: nonEmptyStringSchema,
  es: nonEmptyStringSchema.optional(),
});

const pluginConfigFieldSchema = z.discriminatedUnion('kind', [
  z.object({
    name: nonEmptyStringSchema,
    label: displayTextSchema,
    kind: z.literal('text'),
    required: z.boolean(),
    placeholder: displayTextSchema.optional(),
    help: displayTextSchema.optional(),
  }),
  z.object({
    name: nonEmptyStringSchema,
    label: displayTextSchema,
    kind: z.literal('select'),
    required: z.boolean(),
    options: z.array(z.object({ value: nonEmptyStringSchema, label: displayTextSchema })).min(1),
    help: displayTextSchema.optional(),
  }),
  z.object({
    name: nonEmptyStringSchema,
    label: displayTextSchema,
    kind: z.literal('number'),
    required: z.boolean(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    suffix: displayTextSchema.optional(),
    help: displayTextSchema.optional(),
  }),
  z.object({
    name: nonEmptyStringSchema,
    label: displayTextSchema,
    kind: z.literal('boolean'),
    required: z.boolean(),
    help: displayTextSchema.optional(),
  }),
]);

export const PluginCapabilitySchema = z.discriminatedUnion('kind', [
  z.object({
    id: nonEmptyStringSchema,
    kind: z.literal(PluginCapabilityKind.Payment),
    execution: z.enum(['in_process', 'hosted']),
    provider: nonEmptyStringSchema.optional(),
    countries: z.array(nonEmptyStringSchema).optional(),
    operations: z.array(z.enum(['initialize', 'status', 'settle', 'cancel', 'refund'])).min(1),
    displayName: displayTextSchema,
    description: displayTextSchema.optional(),
    configuration: z.object({ provider: nonEmptyStringSchema, fields: z.array(pluginConfigFieldSchema).min(1) }).optional(),
    primitive: z.enum(['cash', 'card', 'qr']),
  }),
  z.object({
    id: nonEmptyStringSchema,
    kind: z.literal(PluginCapabilityKind.Tax),
    execution: z.enum(['in_process', 'hosted']),
    provider: nonEmptyStringSchema.optional(),
    countries: z.array(nonEmptyStringSchema).optional(),
    operations: z.array(z.literal('calculate')).min(1),
    displayName: displayTextSchema,
    description: displayTextSchema.optional(),
    configuration: z.object({ provider: nonEmptyStringSchema, fields: z.array(pluginConfigFieldSchema).min(1) }).optional(),
  }),
  z.object({
    id: nonEmptyStringSchema,
    kind: z.literal(PluginCapabilityKind.Fiscal),
    execution: z.enum(['in_process', 'hosted']),
    provider: nonEmptyStringSchema.optional(),
    countries: z.array(nonEmptyStringSchema).optional(),
    operations: z.array(z.enum(['issue', 'retry', 'cancel'])).min(1),
    displayName: displayTextSchema,
    description: displayTextSchema.optional(),
    configuration: z.object({ provider: nonEmptyStringSchema, fields: z.array(pluginConfigFieldSchema).min(1) }).optional(),
  }),
  z.object({
    id: nonEmptyStringSchema,
    kind: z.literal(PluginCapabilityKind.Delivery),
    execution: z.enum(['in_process', 'hosted']),
    provider: nonEmptyStringSchema.optional(),
    countries: z.array(nonEmptyStringSchema).optional(),
    operations: z.array(z.enum(['receive_order', 'accept', 'deny', 'ready', 'cancel'])).min(1),
    displayName: displayTextSchema,
    description: displayTextSchema.optional(),
    configuration: z.object({ provider: nonEmptyStringSchema, fields: z.array(pluginConfigFieldSchema).min(1) }).optional(),
  }),
  z.object({
    id: nonEmptyStringSchema,
    kind: z.literal(PluginCapabilityKind.Admin),
    execution: z.enum(['in_process', 'hosted']),
    provider: nonEmptyStringSchema.optional(),
    countries: z.array(nonEmptyStringSchema).optional(),
    operations: z.array(z.literal('configure')).min(1),
    displayName: displayTextSchema,
    description: displayTextSchema.optional(),
    configuration: z.object({ provider: nonEmptyStringSchema, fields: z.array(pluginConfigFieldSchema).min(1) }).optional(),
  }),
]);

export const PluginManifestSchema = z.object({
  manifestVersion: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  publisher: z.object({ id: nonEmptyStringSchema, name: nonEmptyStringSchema }),
  displayName: displayTextSchema,
  description: displayTextSchema.optional(),
  scope: z.enum(['country', 'multi_country', 'global']),
  countries: z.array(nonEmptyStringSchema),
  floApiVersion: nonEmptyStringSchema,
  execution: z.array(z.enum(['in_process', 'utility_process', 'hosted'])).min(1),
  capabilities: z.array(PluginCapabilitySchema).min(1),
  permissions: z.array(z.enum(PLUGIN_PERMISSIONS)),
  configurationSchema: nonEmptyStringSchema.optional(),
  connectorIds: z.array(nonEmptyStringSchema).min(1).optional(),
  hosted: z.object({
    serviceBaseUrl: nonEmptyStringSchema.optional(),
    polling: z.object({
      baseUrl: nonEmptyStringSchema,
      resources: z.array(nonEmptyStringSchema),
      intervalSeconds: z.number().positive(),
    }).optional(),
    webhookRoutes: z.array(z.object({
      provider: nonEmptyStringSchema,
      events: z.array(nonEmptyStringSchema),
      signature: nonEmptyStringSchema,
    })).optional(),
    allowedOutboundHosts: z.array(nonEmptyStringSchema).optional(),
    healthEndpoint: nonEmptyStringSchema.optional(),
  }).optional(),
  artifact: z.object({ digest: nonEmptyStringSchema, signature: nonEmptyStringSchema }),
});

function hasConnectorMethods(value: unknown, methods: string[]): boolean {
  return typeof value === 'object' && value !== null
    && typeof (value as { capabilityId?: unknown }).capabilityId === 'string'
    && methods.every((method) => typeof (value as Record<string, unknown>)[method] === 'function');
}

export const PluginRuntimeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(PluginRuntimeKind.Payment), connector: z.custom<PaymentConnector>((value) => hasConnectorMethods(value, ['describe', 'initialize', 'status', 'settle', 'cancel', 'refund'])) }),
  z.object({ kind: z.literal(PluginRuntimeKind.Tax), connector: z.custom<TaxEngine>((value) => hasConnectorMethods(value, ['calculate'])) }),
  z.object({ kind: z.literal(PluginRuntimeKind.Fiscal), connector: z.custom<FiscalDocumentProvider>((value) => hasConnectorMethods(value, ['issue', 'retry', 'cancel'])) }),
  z.object({ kind: z.literal(PluginRuntimeKind.Delivery), connector: z.custom<DeliveryConnector>((value) => hasConnectorMethods(value, ['poll', 'send'])) }),
]);

export const PluginRuntimeBundleSchema = z.object({
  manifest: PluginManifestSchema,
  runtimes: z.array(PluginRuntimeSchema),
});

const serializableRecordSchema = z.record(z.string(), z.unknown()).refine((value) => {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' && new TextEncoder().encode(serialized).byteLength <= 256 * 1024;
  } catch {
    return false;
  }
}, 'must be JSON serializable and at most 256 KiB');

export const PluginRequestEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  requestId: nonEmptyStringSchema,
  idempotencyKey: nonEmptyStringSchema,
  pluginId: nonEmptyStringSchema,
  capability: nonEmptyStringSchema,
  createdAt: nonEmptyStringSchema,
  payload: serializableRecordSchema,
});

export const PluginResultEnvelopeSchema = z.discriminatedUnion('status', [
  z.object({ schemaVersion: z.literal(1), requestId: nonEmptyStringSchema, status: z.literal('success'), result: serializableRecordSchema.optional() }),
  z.object({ schemaVersion: z.literal(1), requestId: nonEmptyStringSchema, status: z.literal('pending'), result: serializableRecordSchema.optional() }),
  z.object({ schemaVersion: z.literal(1), requestId: nonEmptyStringSchema, status: z.literal('failed'), error: z.object({ code: nonEmptyStringSchema, message: nonEmptyStringSchema, retryable: z.boolean() }) }),
]);

export const PluginConnectorConfigSchema = z.record(z.string(), z.unknown()).refine((value) => {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' && new TextEncoder().encode(serialized).byteLength <= 32 * 1024;
  } catch {
    return false;
  }
}, 'connector config must be a JSON object no larger than 32 KiB');

export const PluginPaymentMethodSchema = z.object({
  key: nonEmptyStringSchema,
  labelKey: nonEmptyStringSchema.optional(),
  label: displayTextSchema.optional(),
  provider: nonEmptyStringSchema,
  primitive: z.enum(['cash', 'card', 'qr']).optional(),
  countries: z.array(nonEmptyStringSchema).optional(),
});

const installationSchema = z.object({
  id: nonEmptyStringSchema,
  packageId: nonEmptyStringSchema,
  packageVersion: nonEmptyStringSchema,
  status: z.enum(['installed', 'activated', 'disabled', 'uninstalled']),
  installedAt: nonEmptyStringSchema,
  activatedAt: z.string().nullable(),
  disabledAt: z.string().nullable(),
  installedBy: z.string().nullable(),
  notes: z.string().nullable(),
  grantedPermissions: z.array(z.string()),
});

const installationFeatureSchema = z.object({
  installationId: z.string().nullable(),
  capabilityId: nonEmptyStringSchema,
  status: z.enum(['inactive', 'activating', 'active', 'deactivating', 'deactivated']),
  activatedAt: z.string().nullable(),
  deactivatedAt: z.string().nullable(),
  notes: z.string().nullable(),
  requirementsMet: z.boolean().optional(),
  missingRequirements: z.array(z.enum(['connector_account', 'connector_authorization', 'connector_verification', 'connector_verification_hosted'])).optional(),
});

const connectorAccountSchema = z.object({
  id: nonEmptyStringSchema,
  storeId: nonEmptyStringSchema,
  installationId: nonEmptyStringSchema,
  packageId: nonEmptyStringSchema,
  capabilityId: nonEmptyStringSchema,
  provider: nonEmptyStringSchema,
  providerAccountRef: z.string().nullable(),
  authStatus: z.enum(['unauthorized', 'authorized', 'expired', 'revoked']),
  readiness: z.enum(['unconfigured', 'configured', 'verified', 'failed']),
  lastHealthCheckAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: nonEmptyStringSchema,
  updatedAt: nonEmptyStringSchema,
});

const catalogListingSchema = z.object({
  listingId: nonEmptyStringSchema,
  packageId: nonEmptyStringSchema,
  packageVersion: nonEmptyStringSchema,
  publisher: z.object({ id: nonEmptyStringSchema, name: nonEmptyStringSchema }),
  name: displayTextSchema,
  description: displayTextSchema.optional(),
  scope: z.enum(['country', 'multi_country', 'global']),
  countries: z.array(nonEmptyStringSchema),
  capabilities: z.array(PluginCapabilitySchema),
  trustLevel: z.enum(['flo_builtin', 'flo_verified', 'partner_verified', 'community']),
  execution: z.array(z.enum(['in_process', 'utility_process', 'hosted'])),
  providerAccountRequired: z.boolean(),
  supportUrl: z.string().url().optional(),
  manifest: PluginManifestSchema,
});

export const PluginCatalogEntrySchema = catalogListingSchema.extend({
  installation: installationSchema.nullable(),
  features: z.array(installationFeatureSchema),
  connectorAccounts: z.array(connectorAccountSchema),
});

export const PluginCatalogResponseSchema = z.object({
  country: z.string(),
  catalog: z.array(PluginCatalogEntrySchema),
});

export const PluginInstallationsResponseSchema = z.object({
  installations: z.array(installationSchema),
});

export const PluginInstallationResponseSchema = z.object({
  installation: installationSchema.nullable(),
});

export const PluginUninstallResponseSchema = z.object({
  id: nonEmptyStringSchema,
  uninstalled: z.literal(true),
});

export const PluginFeatureResponseSchema = z.object({
  feature: installationFeatureSchema,
});

export const PluginConnectorResponseSchema = z.object({
  connector: connectorAccountSchema,
  summary: z.unknown(),
});

export const PluginPaymentMethodsResponseSchema = z.object({
  methods: z.array(PluginPaymentMethodSchema),
});
