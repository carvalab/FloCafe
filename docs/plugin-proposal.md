# Flo country and provider plugin proposal

Status: implemented Stage 1 architecture; hosted and external stages remain proposed.

This proposal defines the changes needed for Flo to support country-specific payments, fiscal compliance, and delivery integrations without adding every country and provider to the Flo core. The first concrete package is Argentina. India and other countries must be addable without changing the core contracts.

## Purpose

This document records the architecture decisions and boundaries for the plugin system. It is not the package implementation guide or the research survey:

- `docs/plugin-authoring.md` explains how to add or change a plugin.
- `docs/plugin-references.md` records the external systems that informed these decisions.

Keep this document focused on host contracts, lifecycle rules, security boundaries, and the migration from core logic to plugins.

## Decision Summary

Use three layers:

```text
Flo core
  stable payment, tax, invoice, order, and delivery contracts

Local plugin
  Flo-owned code runs in-process
  external country code runs in Electron utilityProcess

Hosted connector
  provider APIs, public webhooks, OAuth, credentials, retries, and reconciliation
```

Use the following references:

| Need | Reference | Flo decision |
|---|---|---|
| Payment lifecycle | Vendure | Use explicit capability, authorize/settle, cancel, refund, and eligibility contracts |
| Package and provider composition | Medusa | Let a country package contain payment, tax, fiscal, delivery, and admin capabilities |
| Hosted app and transaction events | Saleor | Use a manifest, permissions, signed events, provider references, and asynchronous status reporting |
| Country fiscal packages | Odoo | Keep tax, document rules, numbering, and fiscal authorization inside a country package |
| Connector approval and activation | Shopify | Install, authorize, configure, verify readiness, then activate |
| Local process isolation | Electron `utilityProcess` | Run external local plugins outside the Electron main process |

### Stage 1 rules

- Flo owns every manifest type, permission, capability operation, and runtime contract. Country packages implement those contracts; they do not define competing interfaces.
- A package manifest is written with `satisfies PluginManifest`. Misspelled permissions, invalid capability operations, or missing payment primitives fail TypeScript compilation.
- Catalog registration imports only `manifest.ts`. Runtime registration imports only `runtime.ts`. Viewing the catalog never loads provider or tax implementation code.
- Built-in package IDs and capability IDs are unique-checked in contract tests; runtime registration rejects duplicate package IDs, duplicate runtime capability IDs, and runtime/manifest kind mismatches.
- Tax calculation is synchronous in Stage 1 because order creation runs inside synchronous SQLite transactions. Fiscal, payment, delivery, and hosted operations retain their own lifecycle contracts. Async tax engines require a future pre-transaction calculation phase.
- Tax, fiscal invoices, payments, and delivery are all plugin capabilities. Flo core owns only the stable contracts, lifecycle state, and dispatch; country and provider behavior belongs to a package.
- Tax behavior belongs to plugins. Every store has one active built-in tax package selected from its saved country: a matching `country.<iso>` package when available, otherwise the global default package. Existing stores are provisioned during startup; new stores are provisioned immediately after country selection in setup.
- The default package is a real plugin, not a core fallback. It gives every uncovered country a maintainable baseline while a dedicated country package can replace individual capabilities over time.
- The global default package contains only generic product-rate calculation. Country-specific rules belong in their country packages.

## Absolute Webhook Rule

**The Flo POS never receives provider webhooks directly.** No direct POS URL, local port, public IP, tunnel, or `direct` webhook mode is part of this design.

All provider-originated HTTP traffic terminates at either:

- the Flo-owned hosted broker; or
- an approved publisher-owned hosted connector declared in the manifest.

The POS only makes outbound connections and receives normalized events through the broker connection. This rule applies equally to payment, fiscal, and delivery integrations.

## Goals

- Support Argentina first without hardcoding Argentine providers into the core.
- Allow an external country developer to ship a country package independently.
- Keep payment, tax, and delivery contracts stable across countries.
- Support providers that require public webhooks even though Flo runs behind NAT.
- Make provider events idempotent, auditable, retryable, and recoverable.
- Keep merchant credentials out of the POS when a hosted connector is used.
- Allow a country package to use local code, hosted code, or both.

## Non-goals

- Building a marketplace before the plugin ABI and security model are stable.
- Allowing arbitrary third-party code to run in the Electron main process.
- Giving every plugin an arbitrary public URL.
- Modeling every provider or payment rail as a new core payment method.
- Replacing the existing Flo cloud transport immediately.

## Target Package Shape

A country package should be a versioned product, not a loose collection of provider files:

```text
main/plugins/ar/
  manifest.ts       # Typed catalog metadata only
  runtime.ts        # Typed in-process runtime bundle
  tax-engine.ts     # Implements Flo TaxEngine
  index.ts          # Re-exports only
```

The package may contain only the capabilities it needs. For example:

```text
flo-country-ar/
  fiscal/arca-invoice-provider.ts
```

is valid if a merchant only needs Argentine invoicing.

The manifest must declare:

| Field | Purpose |
|---|---|
| `id` | Stable package identifier, for example `country.ar` |
| `version` | Package version |
| `floApiVersion` | Compatible Flo plugin ABI |
| `scope` | `country`, `multi_country`, or `global` |
| `countries` | ISO country codes when `scope` is `country` or `multi_country` |
| `capabilities` | Payment, tax, fiscal, delivery, or admin features |
| `execution` (manifest) | Coarse-grained: which execution modes the package supports. Today the per-capability `execution` field is the source of truth. |
| `execution` (per capability) | `in_process` if a typed runtime lives in this package; `hosted` if the Stage 3 broker satisfies the capability. The runtime registry only carries runtimes for `in_process` capabilities; the activation gate refuses to mark a `hosted` capability `verified` based on local checks alone. |
| `permissions` | Network, settings, database proxy, printing, and event access |
| `configurationSchema` | Merchant configuration fields and validation |
| `connectorIds` | Hosted connector identifiers used by the package |
| `signature` | Package integrity and publisher verification |

## Proposed v1 Manifest

The following is the canonical starting shape for `manifest.json`. It is a proposal for the refactor, not an existing runtime contract yet.

```json
{
  "manifestVersion": 1,
  "id": "country.ar",
  "version": "1.0.0",
  "publisher": {
    "id": "flo-verified",
    "name": "Flo"
  },
  "displayName": {
    "en": "Argentina operations",
    "es": "Operaciones de Argentina"
  },
  "scope": "country",
  "countries": ["AR"],
  "floApiVersion": ">=1.0.0 <2.0.0",
  "execution": ["utility_process", "hosted"],
  "capabilities": [
    {
      "id": "tax.iva",
      "kind": "tax",
      "execution": "in_process",
      "provider": "ar_iva",
      "operations": ["calculate"]
    },
    {
      "id": "payment.mercado_pago_qr",
      "kind": "payment",
      "execution": "hosted",
      "primitive": "qr",
      "provider": "mercado_pago",
      "operations": ["initialize", "status", "refund"]
    },
    {
      "id": "fiscal.arca",
      "kind": "fiscal",
      "execution": "hosted",
      "provider": "arca",
      "operations": ["issue", "retry", "cancel"]
    },
    {
      "id": "delivery.pedidosya",
      "kind": "delivery",
      "execution": "hosted",
      "provider": "pedidosya",
      "operations": ["receive_order", "accept", "deny", "ready", "cancel"]
    }
  ],
  "permissions": [
    "settings.read",
    "settings.write",
    "payment.write",
    "fiscal.write",
    "delivery.events",
    "broker.connect"
  ],
  "configurationSchema": "schemas/configuration.json",
  "hosted": {
    "serviceBaseUrl": "https://connect.flo.example",
    "webhookRoutes": [
      {
        "provider": "mercado_pago",
        "events": ["payment.updated"],
        "signature": "provider_defined"
      },
      {
        "provider": "pedidosya",
        "events": ["order.created", "order.cancelled", "order.updated"],
        "signature": "provider_defined"
      }
    ],
    "allowedOutboundHosts": [
      "api.mercadopago.com",
      "api.pedidosya.example"
    ],
    "healthEndpoint": "/health"
  },
  "artifact": {
    "digest": "sha256:...",
    "signature": "..."
  }
}
```

### Manifest rules

- `id` is stable forever; a provider rename creates a migration, not a new identity by accident.
- `capabilities` are what Flo can activate. Package folders and implementation classes are not activation units.
- `execution` describes where the package has code. A package may use `utility_process`, `hosted`, or both.
- `hosted.serviceBaseUrl` is optional for broker-owned connectors and required only for approved publisher-owned services.
- `webhookRoutes` declares requirements; the broker creates the actual merchant-specific URL.
- `allowedOutboundHosts` is an allowlist, not permission to call any other domain.
- The catalog listing is derived from this manifest and may add support, pricing, trust, and availability metadata.
- An installed manifest is immutable. A new manifest version requires compatibility checks and activation.

### Catalog and runtime registration

Stage 1 has two deliberate registries:

```text
main/plugins/registry.ts
  imports manifest.ts only
  serves catalog, installation, country filtering, and UI

main/plugins/runtime-registry.ts
  imports runtime.ts only
  registers PluginRuntimeBundle values through PluginRegistry
  serves executable in-process contracts such as TaxEngine
```

`manifest.ts` must not import provider, tax, or delivery code. `runtime.ts` owns that dependency. Each runtime bundle is declared through `definePluginRuntimeBundle({ manifest, runtimes })`; it binds the runtime's literal capability ID and `PluginRuntimeKind` to a capability declared by that manifest at compile time. A provider connector and its Zod configuration schema live together inside the country or multi-country package, never in a core provider directory. Every plugin boundary parses unknown input through an exported Zod schema, including manifests, runtime bundles, connector configuration, and envelopes. `PluginRuntimeBundleSchema` validates runtime bundles before `PluginRegistry.register()` accepts them. Its discriminated union rejects unknown kinds and requires the Flo contract methods for the declared kind, such as `calculate()` for `tax`. This follows Medusa's declarative module exports while keeping Flo's catalog safe to load without executing provider code.

Use `npm run plugin:create -- --name "Mexico operations" --countries MX` to create a typed `manifest.ts`, package re-export, README, and manifest-only registry entry. The author then adds `runtime.ts` only for real local implementations of Flo contracts.

### Contract lessons from reference systems

Vendure uses narrow typed handler lifecycles and stable operation codes. Flo mirrors that by tying each capability kind to a closed operation union and a matching runtime contract. A tax capability cannot declare `refund`; a payment capability cannot omit its primitive.

Medusa separates declarative module definitions from executable service exports. Flo mirrors that with manifest-only catalog registration and runtime-only bundle registration. A country plugin is not allowed to invent host interfaces: it declares Flo's `PluginManifest` and implements Flo's `TaxEngine`, `PaymentConnector`, `FiscalDocumentProvider`, or `DeliveryConnector` contracts.

The Pi extension examples reinforce the same operational rule for future external loading: discovery is not trust. Stage 1 keeps discovery explicit and bundled. Any future auto-discovery path must validate the manifest, identity, permissions, ABI compatibility, and execution mode before runtime code loads.

The implemented TypeScript representation is intentionally closed over host-owned concepts:

```ts
export type PluginScope = 'country' | 'multi_country' | 'global';
export type PluginExecution = 'in_process' | 'utility_process' | 'hosted';
export const PLUGIN_PERMISSIONS = [
  'settings.read', 'settings.write', 'payment.write',
  'fiscal.write', 'delivery.events', 'broker.connect',
] as const;
export type PluginPermission = typeof PLUGIN_PERMISSIONS[number];

// Per-capability execution is the source of truth. The manifest-level
// `execution` array is a coarse-grained hint for the merchant UI; the
// runtime registry only carries runtimes for `in_process` capabilities,
// and the activation gate refuses to mark a `hosted` capability
// `verified` based on local checks alone.
export type PluginCapabilityExecution = 'in_process' | 'hosted';

type Capability<Kind extends string, Operation extends string> = {
  id: string;
  kind: Kind;
  execution: PluginCapabilityExecution;
  provider?: string;
  countries?: string[];
  operations: Operation[];
};
export type PluginCapability =
  | (Capability<'payment', 'initialize' | 'status' | 'settle' | 'cancel' | 'refund'> & { primitive: 'cash' | 'card' | 'qr' })
  | Capability<'tax', 'calculate'>
  | Capability<'fiscal', 'issue' | 'retry' | 'cancel'>
  | Capability<'delivery', 'receive_order' | 'accept' | 'deny' | 'ready' | 'cancel'>
  | Capability<'admin', 'configure'>;

export type PluginManifest = {
  manifestVersion: 1;
  id: string;
  version: string;
  publisher: { id: string; name: string };
  displayName: { en: string; es?: string };
  scope: PluginScope;
  countries: CountryCode[];
  floApiVersion: string;
  execution: PluginExecution[];
  capabilities: PluginCapability[];
  permissions: PluginPermission[];
  configurationSchema?: string;
  connectorIds?: string[];
  hosted?: HostedTopology;
  artifact: { digest: string; signature: string };
};
```

## Proposed v1 Contracts

These interfaces are the small core seam. Provider APIs, HTTP parsing, credentials, retries, and country rules stay behind adapters that implement them.

```ts
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
```

### Payment contract

```ts
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

export interface PaymentConnector {
  describe(context: ConnectorContext): Promise<PaymentCapability>;
  initialize(request: PaymentRequest): Promise<OperationResult & { paymentId?: string }>;
  status(request: PaymentReference & ConnectorContext): Promise<OperationResult>;
  settle(request: PaymentReference & ConnectorContext): Promise<OperationResult>;
  cancel(request: PaymentReference & ConnectorContext): Promise<OperationResult>;
  refund(request: PaymentReference & ConnectorContext & { amount?: Money }): Promise<OperationResult>;
}
```

Cash can implement the same contract locally with immediate success. QR, terminal, and hosted wallet connectors can return `pending` or `action` metadata. The core never treats a provider redirect or QR display as proof of payment.

### Tax contract

```ts
export type TaxLine = {
  code: string;
  label: string;
  rate: number;
  amount: Money;
  included: boolean;
};

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
    fiscalIdentity?: { type: string; value: string };
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

export interface TaxEngine {
  calculate(request: TaxRequest): TaxResult;
}
```

### Fiscal document contract

Tax calculation is not fiscal authorization. They must remain separate interfaces even when one country package implements both.

```ts
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

export interface FiscalDocumentProvider {
  issue(request: FiscalDocumentRequest): Promise<FiscalDocumentResult>;
  retry(request: FiscalDocumentRequest & { documentId?: string }): Promise<FiscalDocumentResult>;
  cancel(request: ConnectorContext & { documentId: string; reason: string }): Promise<FiscalDocumentResult>;
}
```

For Argentina, `authorizationCode` carries CAE where applicable. For India, the same field can carry IRN or another country-specific authorization reference without adding a new core field.

### Delivery contract

Provider-specific HTTP payloads must be normalized before entering the POS domain.

```ts
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

export interface DeliveryConnector {
  poll(context: ConnectorContext, cursor?: string): Promise<{
    events: DeliveryEvent[];
    nextCursor?: string;
    retryAfterSeconds?: number;
  }>;
  send(context: ConnectorContext, command: DeliveryCommand, idempotencyKey: string): Promise<OperationResult>;
}
```

`poll` is the v1 synchronization seam. The hosted connector polls the provider API, stores the cursor and raw event, normalizes the result into `DeliveryEvent`, and sends it to Flo. The local POS receives only normalized events; it does not parse raw PedidosYa or Uber Eats payloads.

An optional future adapter may add `normalizeWebhookEvent()` inside the hosted connector, but it must produce the same `DeliveryEvent` and use the same deduplication and reconciliation path as polling. It must never deliver a provider webhook directly to the POS.

### Delivery lifecycle

The core must model the provider order lifecycle explicitly:

```text
received
  -> accepted
  -> preparing
  -> ready
  -> dispatched
  -> delivered

received -> rejected
received -> cancelled
accepted -> cancelled
preparing -> cancelled
```

Provider names differ, so the connector maps them into this vocabulary:

| Flo state | Example provider meaning |
|---|---|
| `received` | New order waiting for restaurant action |
| `accepted` | Restaurant accepted the order |
| `preparing` | Kitchen started preparing the order |
| `ready` | Food is ready for courier pickup |
| `dispatched` | Courier picked up or order was sent |
| `delivered` | Provider confirms delivery |
| `rejected` | Restaurant declined the order |
| `cancelled` | Provider, customer, or restaurant cancelled it |

The POS may initiate `accept`, `start_preparing`, `ready`, `dispatched`, and `cancel`. The connector must not claim that the provider accepted the command until polling confirms the provider state or returns a provider acknowledgement with a durable reference.

### Polling-first delivery synchronization

For v1, every delivery connector must support a polling loop:

```text
1. Broker loads connector account and last cursor.
2. Connector requests new and changed orders from the provider.
3. Connector returns normalized events and the next cursor.
4. Broker stores raw response and normalized events before acknowledging the poll.
5. Broker deduplicates by connector account, provider order ID, and provider event/update ID.
6. Broker sends new events to Flo over its outbound connection.
7. Flo applies valid state transitions to POS/KDS.
8. POS commands are sent through the broker to the provider.
9. Later polls confirm accepted, preparing, ready, dispatched, cancelled, or delivered state.
```

Polling requirements:

- Store a cursor or last-seen timestamp per connector account.
- Use an overlap window when the provider API is timestamp-based.
- Deduplicate every page and every retry.
- Persist the cursor only after events are durably stored.
- Use provider-specific rate limits and `retryAfter` values.
- Back off on transient failures without losing the cursor.
- Reconcile open orders even when no new order was returned.
- Mark an order `stale` or `sync_error` operationally without inventing a business state.
- Keep a replayable synchronization log for support.

If a provider offers no usable polling API and no approved hosted webhook integration, Flo cannot support that provider in v1. The POS must not be made public as a workaround.

### Delivery reference comparison

| Reference | Useful delivery idea | Flo adaptation |
|---|---|---|
| Medusa fulfillment providers | Separate fulfillment creation, shipment, and cancellation operations | Use explicit `accept`, `ready`, `dispatched`, and `cancel` commands |
| Odoo connectors | Synchronize external order and shipment status through connector jobs | Use broker-owned scheduled polling with cursors and replay |
| Saleor apps | Normalize external transaction events and keep provider references | Use the same event envelope for delivery events and state reconciliation |

The conclusion is not to copy one platform's shipping model. Flo needs a restaurant-order lifecycle, not a parcel-label lifecycle.

## Event-Driven Plugin Integration

Vendure and Medusa both use events to connect core state changes to plugin behavior:

| Reference | Pattern | Flo adaptation |
|---|---|---|
| Vendure `EventBus` | Plugins subscribe to order, payment, fulfillment, and state-transition events | Typed Flo events are written to an outbox after the POS transaction commits |
| Medusa subscribers and workflows | An event subscriber starts an asynchronous workflow or provider action | An event dispatcher creates an account-scoped connector command |
| Odoo connectors | Connector jobs synchronize external state and push status back into the business document | Polling publishes normalized external events into the same event path |

The plugin should listen to **normalized Flo events**, not database changes and not raw provider payloads.

### Event flow

```text
POS changes order state
  -> database transaction commits order and outbox event
  -> event dispatcher reads outbox
  -> dispatcher resolves the store's connector account
  -> dispatcher creates an account-scoped connector command
  -> hosted connector calls provider API
  -> result is stored as an integration event
  -> Flo receives the normalized result over its outbound connection
```

The event dispatcher must not call a provider API inside the POS transaction. This avoids holding a database transaction open while waiting for PedidosYa, Uber Eats, Mercado Pago, or another provider.

### Canonical event envelope

```ts
export type FloEvent<T> = {
  eventId: string;
  schemaVersion: number;
  type: string;
  occurredAt: string;
  storeId: string;
  aggregateType: 'order' | 'payment' | 'fiscal_document' | 'delivery';
  aggregateId: string;
  connectorAccountId?: string;
  idempotencyKey: string;
  payload: T;
};
```

The `connectorAccountId` is important. It prevents a store with multiple delivery or payment accounts from sending an event to the wrong provider account. If the event does not carry an account ID, the dispatcher resolves exactly one active account from the capability configuration. If there is more than one match, it must stop and require configuration instead of guessing.

### Event subscription contract

```ts
export type EventSubscription = {
  id: string;
  eventTypes: string[];
  capabilityId: string;
  connectorAccountId?: string;
};

export interface FloEventBus {
  publish<T>(event: FloEvent<T>): Promise<void>;
  subscribe(subscription: EventSubscription, handler: (event: FloEvent<unknown>) => Promise<void>): Promise<void>;
}
```

External plugins do not subscribe to arbitrary internal events. The host filters events by manifest capability, granted permission, store, and connector account before delivery.

### Connector command contract

Events describe what happened. Commands ask a provider to do something:

```ts
export type ConnectorCommand = {
  commandId: string;
  schemaVersion: number;
  type: 'payment.status' | 'delivery.accept' | 'delivery.deny' |
    'delivery.preparing' | 'delivery.ready' | 'delivery.dispatched' |
    'delivery.cancel';
  storeId: string;
  connectorAccountId: string;
  aggregateId: string;
  externalReference: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};
```

Commands are persisted before delivery, retried by the broker, and completed by a normalized result event. A plugin must not create a command for an account it does not own.

### Example: order becomes ready

The restaurant finishes a PedidosYa order:

```text
1. Kitchen marks order `ord_123` as ready in Flo.
2. Flo commits the order state and writes `delivery.ready` to the outbox.
3. The event includes `storeId`, `connectorAccountId`, and `externalOrderId`.
4. The dispatcher creates `delivery.ready` for that connector account.
5. Broker sends the command to the PedidosYa connector.
6. Connector calls the provider's status/ready API.
7. Connector returns provider reference and accepted/pending/failed result.
8. Broker stores the result and retry state.
9. Later polling confirms `ready`, `dispatched`, `delivered`, or `cancelled`.
10. Flo updates the local delivery record and KDS history.
```

The provider account is selected from the order's source account, not from whichever plugin happens to be listening:

```text
order.source = pedidosya
order.connectorAccountId = pedidosya-ar-store-42
```

This is the same pattern for payment:

```text
payment.pending
  -> payment connector account resolves Mercado Pago account for this store
  -> broker polls or receives hosted provider update
  -> payment.paid / payment.failed / payment.expired
```

### Event reliability rules

- Write the outbox event in the same transaction as the state change.
- Deliver events at least once; make handlers idempotent.
- Deduplicate by `eventId` and `idempotencyKey`.
- Store delivery attempts, retry count, last error, and next attempt time.
- Preserve event order per aggregate where provider state depends on order.
- Do not block cashier or kitchen actions on provider response.
- Use a blocking handler only for small local validation; use the outbox for network work.
- Polling results and future webhooks must publish the same normalized event types.
- Keep raw provider payloads in the hosted connector audit store, not in the POS event payload by default.

### Plugin host contract

```ts
export interface PluginHost {
  start(manifest: PluginManifest): Promise<void>;
  health(pluginId: string): Promise<{ status: 'healthy' | 'degraded' | 'stopped'; version: string }>;
  stop(pluginId: string): Promise<void>;
  revoke(pluginId: string, reason: string): Promise<void>;
}
```

All local calls cross the host through a versioned request envelope with a request ID, timeout, bounded payload, typed result, and idempotency key for state-changing operations.

## Refactor Mapping

The current `main/integrations/registry/types.ts` is a prototype and should be replaced incrementally:

| Current prototype | v1 target |
|---|---|
| `PaymentProvider.charge()` | `PaymentConnector.initialize()`, `status()`, `settle()`, `cancel()`, and `refund()` |
| `ChargeResult.status: done` | `OperationResult.status: success` plus explicit payment state in the core |
| `TaxEngine.compute()` | `TaxEngine.calculate()` with cart lines, customer identity, and legal metadata |
| `InvoiceProvider.issue()` | `FiscalDocumentProvider.issue()`, `retry()`, and `cancel()` |
| `DeliveryAdapter.parseIncomingOrder()` | Hosted `normalizeEvent()` returning `DeliveryEvent` |
| `DeliveryAdapter.webhookTopology: direct` | Delete the direct POS mode; use broker-owned or approved publisher-owned ingress only |
| `countries: string[]` | Manifest `scope` plus `countries` and capability-level availability |
| `IntegrationBundle` | Marketplace listing and package manifest; bundles group capabilities but do not replace their contracts |

Do not wire the exploratory `main/integrations/` files directly into production. Use them as migration input only, then implement the v1 contracts behind contract tests.

Hosted packages may also declare their network topology:

| Field | Purpose |
|---|---|
| `serviceBaseUrl` | Verified service owned by the publisher, if the connector is externally hosted |
| `polling` | Provider API host, resource paths, authentication mode, and recommended interval |
| `webhookRoutes` | Provider event types and broker-managed paths required by the connector |
| `redirectUris` | Approved browser or provider redirect destinations |
| `allowedOutboundHosts` | Provider API hosts the connector may call |
| `healthEndpoint` | Connector health check path |

These fields describe what the connector needs. They do not give a plugin permission to open arbitrary public listeners or send merchant data to arbitrary hosts. The broker verifies and provisions the public endpoint.

## Core Changes Required

### 1. Replace hardcoded provider concepts with contracts

Add shared domain contracts under `main/` for:

```text
PaymentConnector
TaxEngine
FiscalDocumentProvider
DeliveryConnector
```

The core owns generic state and accounting. A provider connector owns the provider API details.

### 2. Separate payment primitives from provider capabilities

Flo's core primitives remain:

```text
cash
card
qr
```

Providers may add capabilities such as:

```text
Mercado Pago QR
Payway debit
Fiserv terminal
UPI intent
bank transfer
wallet
```

These must be represented as provider capabilities or payment subtypes, not as permanent core methods.

### 3. Add a plugin registry and loader

The loader must:

- Read and validate manifests.
- Check the Flo ABI version.
- Check country and capability compatibility.
- Verify package signatures before installation.
- Start in-process or `utilityProcess` plugins according to the manifest.
- Connect hosted connectors through the approved broker.
- Expose only declared permissions.
- Report health, timeout, crash, restart, and version state.

The loader must not expose the raw database, Electron APIs, arbitrary filesystem access, or arbitrary network destinations to third-party plugins.

### Current Flo areas to change

| Area | Current location | Required change |
|---|---|---|
| Tax selection | `main/services/tax.ts` | Resolve the active registered `TaxEngine`. Startup/setup provisions the matching country package, or the global default package when no country package exists. The dispatcher is activation-aware and safely returns no engine only when the selected package was explicitly disabled or uninstalled. |
| Payment recording | `main/routes/bills.ts` | Validate payment capability, provider reference, status, and idempotency before recording the bill |
| Payment UI | `frontend/src/lib/payment-methods.ts` | Load available capabilities from the backend instead of hardcoding `cash`, `card`, and `upi` |
| Cloud transport | `main/services/cloud-sync.ts` | Generalize the existing outbound connection for normalized connector events without breaking Blue/FloAdmin behavior |
| Database | `main/db.ts` and migrations | Add plugin, connector, event, and fiscal-document state using non-destructive schema versions |
| POS/KDS orders | Existing order routes and KDS flow | Accept normalized delivery orders and preserve their external source and ID |
| Webhooks | Hosted broker service | Add provider-facing routes outside the restaurant PC; do not expose them from Electron |
| Tests | Existing `test/` and integration tests | Add contract, idempotency, replay, fiscal recovery, and provider sandbox tests |

### 4. Add a versioned plugin ABI

External local plugins communicate through serializable envelopes over `MessagePort`:

```json
{
  "schemaVersion": 1,
  "requestId": "req_123",
  "pluginId": "country.ar",
  "capability": "payment.initialize",
  "payload": {}
}
```

Every request needs:

- A timeout.
- A request ID.
- A bounded payload.
- A typed result or typed error.
- An idempotency key where the operation changes money or order state.

### 5. Add hosted connector infrastructure

The hosted broker must provide:

- One authenticated outbound connection from Flo.
- Tenant and store routing.
- Provider-specific public webhook endpoints.
- Signature verification.
- Durable event storage.
- Event deduplication.
- Retry and dead-letter handling.
- Connector credentials and OAuth lifecycle.
- Connector health and readiness state.
- Normalized events delivered to Flo.

Flo must not be the public webhook endpoint for delivery providers.

### Polling is an outbound request, not a listener

When we say that a delivery connector polls a URL, the connector is making an outbound HTTPS request to the provider's API. It is not opening a port and it is not waiting for the provider to call Flo.

```text
Broker scheduler
      |
      | outbound HTTPS GET/POST
      v
Hosted connector
      |
      | provider API URL from the approved manifest
      v
PedidosYa, Uber Eats, Mercado Pago, or another provider
```

For example, a polling connector may declare:

```json
{
  "polling": {
    "baseUrl": "https://api.pedidosya.example",
    "resources": ["/orders", "/orders/status"],
    "intervalSeconds": 30
  }
}
```

The broker or the approved hosted connector calls those resources with the merchant's connector credentials. It stores the cursor, normalizes the response, and sends the event to Flo over the existing outbound connection.

The manifest may declare the provider API host, but it does not allow a package to call arbitrary domains. The host must also be present in `allowedOutboundHosts`, and the listing must be signed and approved.

### Hosted endpoint topology

The public HTTP endpoint belongs to the hosted connector or the Flo broker, never to the restaurant POS URL:

```text
Payment provider or delivery platform
              |
              | HTTPS webhook
              v
  approved connector service or Flo broker
              |
              | verified, normalized event
              v
       Flo outbound connection
              |
              v
             POS
```

This means a provider does not need to know the restaurant's LAN address, public IP, tunnel, or local Flo port. Flo can be offline or closed and the hosted service can retain events for later delivery.

There are two valid hosted endpoint shapes:

```text
Broker-owned ingress
  provider -> Flo broker -> connector -> Flo POS

Publisher-owned ingress
  provider -> verified connector service -> Flo broker -> Flo POS
```

The broker-owned shape is the default because it gives Flo consistent signature verification, tenant routing, retries, event storage, and revocation. Publisher-owned ingress is allowed only for a reviewed hosted connector that proves control of its `serviceBaseUrl` and implements the connector event contract.

The plugin manifest may declare the endpoint requirements, but it must not be treated as an unrestricted reverse proxy configuration. The broker should provision a route such as:

```text
https://connect.flo.example/webhooks/pedidosya/{connectorAccountId}
https://connect.flo.example/webhooks/uber-eats/{connectorAccountId}
https://connect.flo.example/webhooks/mercadopago/{connectorAccountId}
```

The provider receives that registered URL during connector activation. The POS never becomes the provider-facing endpoint.

### HTTP endpoint rules

- Every endpoint is registered to one `publisherId`, `connectorId`, and merchant account.
- Provider signatures are checked before business payloads are accepted.
- The event is durably stored before the endpoint returns success.
- Duplicate events are ignored by provider event ID and connector account.
- Provider retries are safe because processing is idempotent.
- The endpoint accepts only the event types declared by the manifest.
- The connector cannot change its endpoint, allowed hosts, or redirect URIs without a signed listing update and reapproval.
- Connector secrets are scoped to the connector account and never shared with unrelated plugins.
- A disabled or revoked connector returns a controlled response and preserves the event for audit.
- Local `utilityProcess` plugins do not listen on public HTTP; they receive normalized events through the host ABI.

### Which plugins need HTTP endpoints?

HTTP is a future hosted connector capability, not a separate plugin category. For the first delivery implementation, polling is the only provider synchronization path. A hosted connector may add HTTP later without changing the local contract:

| Plugin example | Outbound request | V1 provider update source | Future hosted HTTP source |
|---|---|---|---|
| Mercado Pago QR | Create payment and query status | Status polling | Flo broker or approved payment connector |
| ARCA fiscal provider | Calculate and authorize invoice | Request result and reconciliation polling | Flo broker or approved fiscal connector |
| PedidosYa delivery | Accept, deny, ready, cancel | Order and status polling | Flo broker or approved delivery connector |
| Uber Eats delivery | Accept, deny, ready, cancel | Order and status polling | Flo broker or approved delivery connector |

The local plugin does not need to implement an HTTP server for these flows. Its interface can remain small:

```text
payment.initialize(request)
delivery.poll(cursor)
fiscal.issue(request)
```

The hosted connector absorbs provider authentication, polling, retries, cursors, and provider-specific payloads. It then sends the same normalized result to Flo. If HTTP is added later, it is handled by the hosted connector and follows the same event path as polling.

If a publisher needs its own site, the manifest may identify it as a verified service:

```json
{
  "execution": "hosted",
  "serviceBaseUrl": "https://connect.partner.example",
  "webhookRoutes": [
    {
      "provider": "pedidosya",
      "events": ["order.created", "order.cancelled"],
      "signature": "hmac-sha256"
    }
  ],
  "allowedOutboundHosts": ["api.pedidosya.example"]
}
```

Flo must verify ownership and health of that service, issue a connector-account-specific route, and keep the broker as the event and identity boundary. A manifest must not let a publisher silently redirect payment or order events to a newly changed domain. This configuration is optional for v1; a polling-only connector does not need `serviceBaseUrl` or `webhookRoutes`.

### Payment example: polling versus webhook

Mercado Pago can be integrated without making the POS public:

```text
1. Flo asks the hosted connector to initialize a QR payment.
2. The connector calls the provider API and returns pending plus a provider reference.
3. The broker polls the provider status URL using that reference.
4. The connector returns paid, failed, expired, or cancelled.
5. The broker sends the normalized result to Flo.
```

If the provider later requires or supports webhooks, the provider calls one of these hosted locations:

```text
provider -> Flo broker webhook URL
provider -> verified publisher-owned connector URL
```

The hosted service verifies the event and sends the same normalized payment result to Flo. Polling and webhooks are two transport mechanisms behind the same `PaymentConnector.status()` contract.

### Delivery example: polling versus webhook

For PedidosYa or Uber Eats in v1:

```text
1. Broker polls the provider orders URL.
2. Connector returns new, changed, or cancelled orders.
3. Broker sends normalized orders to Flo.
4. Flo sends accept, deny, preparing, ready, or cancel through the broker.
5. Broker calls the provider command API.
6. Later polling confirms the provider state.
```

If the provider later supports a webhook integration, only the hosted connector changes:

```text
provider webhook -> hosted connector -> normalized DeliveryEvent -> Flo
```

The POS contract and delivery state machine do not change.

### 6. Add persistent configuration and audit state

Add non-destructive migrations for:

```text
plugin_packages
plugin_installations
plugin_configuration
plugin_permissions
connector_accounts
connector_events
connector_event_attempts
integration_outbox
integration_commands
integration_subscriptions
integration_delivery_attempts
fiscal_documents
fiscal_document_attempts
```

Transaction and fiscal records must retain:

```text
provider
provider_reference
idempotency_key
status
request_time
response_time
error_code
error_message
raw_reference_metadata
```

Do not store provider secrets in ordinary order or bill rows.

### 7. Replace hardcoded frontend payment buttons

The frontend should load payment capabilities from the backend:

```text
GET /api/payment-methods
```

Each result should include:

```text
id
label
primitive: cash | card | qr
provider
country
capabilities
configuration status
availability
```

The frontend must not decide that `upi`, `wallet`, or `mercado_pago` is universally available.

## Stable Contracts

### Payment connector

```text
describe(context)
  -> methods, country, currency, capabilities, configuration needs

initialize(request)
  -> pending, paid, failed, action_required, provider reference

getStatus(request)
  -> current payment status

settle(request)
  -> paid or failed

cancel(request)
  -> cancelled or failed

refund(request)
  -> refunded or failed
```

The core owns the payment state, amount, currency, receipt, and reconciliation link. The connector owns provider-specific requests, tokens, QR payloads, terminal commands, and references.

### Tax engine

```text
calculate(request)
  -> tax lines, rates, totals, legal metadata
```

The request must include country, region, customer tax identity, product tax category, prices, discounts, and shipping or delivery charges where applicable.

### Fiscal document provider

```text
issue(request)
  -> document type, number, authorization code, QR data, status

retry(request)
  -> same document identity or a typed recovery result

cancel(request)
  -> cancellation or credit-note reference where supported
```

Tax calculation and fiscal authorization may be separate internal interfaces, but the country package owns the legal workflow.

### Delivery connector

```text
receiveExternalEvent(event)
  -> normalized order, cancellation, update, or status event

accept(order)
deny(order)
markReady(order)
markDispatched(order)
cancel(order)
updateMenu(data)
updateAvailability(data)
```

The core owns the normalized order and POS state. The connector owns provider-specific IDs, payloads, signatures, deadlines, and retry rules.

## Argentina Example 1: Payment

Example: a restaurant accepts a Mercado Pago QR payment.

```text
1. Cashier selects QR.
2. Flo asks the installed Argentina connector for available QR capabilities.
3. Flo sends amount, currency, order ID, and idempotency key.
4. Connector creates the Mercado Pago payment or QR request.
5. Connector returns a QR payload, provider reference, and pending status.
6. Flo shows the QR and records the payment as pending.
7. Mercado Pago sends a provider callback to the hosted broker.
8. Broker verifies the callback and stores the event.
9. Broker sends a normalized payment event to Flo.
10. Flo verifies the order and idempotency key, then marks the payment paid.
11. The receipt and fiscal workflow use the final payment state.
```

The payment record must not be considered paid only because the customer returned from a QR page. The provider event or a verified status query must confirm the payment.

The same contract can support Payway, Fiserv, a terminal, or another Argentine provider without changing the order or bill model.

## Argentina Example 2: Tax and ARCA Fiscal Invoice

Example: an Argentine restaurant completes an order and must issue an electronic invoice through ARCA.

```text
1. Flo sends the order lines, prices, discounts, customer data, and store tax identity to the Argentina fiscal package.
2. The tax engine calculates IVA and returns tax lines and totals.
3. The fiscal provider selects the document type and next valid number.
4. The provider submits the invoice request through the configured ARCA path or approved fiscal service.
5. ARCA or the fiscal service returns authorization data, including CAE where applicable.
6. Flo stores the fiscal document, number, authorization, expiry, QR data, and request status.
7. The receipt prints or displays the legal invoice information.
8. If the request fails, Flo records a recoverable fiscal state and shows the required operator action.
```

The Argentina package must own:

- IVA rules and tax categories.
- Document types and legal invoice fields.
- Point-of-sale and numbering rules.
- Customer CUIT and document validation.
- ARCA authorization flow.
- CAE and CAE expiry handling where applicable.
- Fiscal QR data.
- Retry and recovery behavior.
- Credit notes or cancellation behavior where required.

Fiscal authorization is not the same as ordinary tax calculation. A successful tax calculation must not be treated as a legally authorized invoice.

## Argentina Example 3: Delivery from PedidosYa or Uber Eats

Example: a customer places an order on PedidosYa or Uber Eats.

```text
1. Broker polls PedidosYa or Uber Eats for new and changed orders.
2. Connector stores the provider response, cursor, and synchronization record.
3. Connector deduplicates the result and normalizes the order.
4. Broker sends the normalized order to Flo over the existing outbound connection.
5. Flo displays the order in the POS/KDS and checks store availability.
6. Flo accepts or rejects the order.
7. Flo sends the decision to the broker.
8. Broker calls the provider API and records the provider response.
9. Later polling confirms accepted, rejected, or failed state.
10. Kitchen starts preparing the order and Flo records `preparing`.
11. Kitchen marks the order ready and Flo sends `ready` through the broker.
12. Broker calls the provider API and later polling confirms `dispatched` or `delivered`.
13. Cancellation and modification polling events follow the same event log.
```

The delivery connector must normalize provider differences into one Flo order shape:

```text
externalOrderId
source
customer
items
modifiers
notes
total
tax
deliveryFee
paymentStatus
requestedAt
acceptDeadline
```

Future webhook support may use broker-owned URLs such as:

```text
/webhooks/pedidosya/<connector-account>
/webhooks/uber-eats/<connector-account>
```

Flo does not expose these URLs directly from the restaurant PC.

## Adding India

An India package should be added without changing the core payment, tax, fiscal, or delivery contracts:

```text
flo-country-in/
  payment/upi.ts
  payment/razorpay.ts
  payment/cashfree.ts
  fiscal/gst-invoice.ts
  fiscal/einvoice.ts
  delivery/zomato.ts
  delivery/swiggy.ts
```

The India package would define:

- INR currency and Indian locale defaults.
- UPI as a QR or intent capability, not as a new universal core primitive.
- Provider-specific UPI connectors such as Razorpay or Cashfree.
- GST calculations with CGST, SGST, and IGST.
- GSTIN and HSN/SAC fields.
- Indian invoice formatting and legal text.
- Optional e-invoice or IRN integration where required.
- Indian delivery provider mappings and deadlines.
- Country-specific customer and business identity validation.

The core should only see:

```text
payment capability
tax lines
fiscal document result
normalized delivery order
```

## Adding Any Other Country

Before accepting a new country package, the contributor must provide:

### Country identity

- ISO country code.
- Currency and locale.
- Tax authority and business identifiers.
- Supported regions or states.

### Payment

- Core primitive mapping: cash, card, or QR.
- Provider capabilities.
- Authorization, settlement, cancellation, refund, and status behavior.
- Idempotency behavior.
- Customer action requirements such as QR, terminal, redirect, or PIN.
- Whether the provider requires hosted credentials or webhooks.

### Tax and fiscal compliance

- Tax categories and rate rules.
- Inclusive or exclusive pricing behavior.
- Regional tax rules.
- Invoice document types.
- Numbering rules.
- Customer and business identity fields.
- Fiscal authority authorization flow.
- Offline and recovery rules.
- Credit note and cancellation behavior.
- Required receipt and QR content.

### Delivery

- Provider order schema mapping.
- Menu and availability synchronization.
- Accept, deny, ready, dispatch, cancel, and modify operations.
- Webhook signature verification.
- Acceptance and preparation deadlines.
- Provider retry and reconciliation behavior.

### Package quality

- Manifest and ABI compatibility.
- Configuration schema.
- Declared permissions.
- Unit and contract tests.
- Sandbox or certification tests against the provider.
- Migration and upgrade notes.
- Localized operator and customer messages.
- Clear ownership of hosted infrastructure, credentials, and support.

## Marketplace and Plugin Catalog

The marketplace must be designed from the first version, but the first version should be a **signed catalog and installation flow**, not a public app store. The catalog is the control plane. Plugin execution and provider traffic remain in the local plugin host or hosted broker.

```text
Catalog
  what exists, who publishes it, what it can do, what it needs

Installation
  verify package, permissions, compatibility, and signature

Runtime
  local utilityProcess or approved hosted connector
```

Do not make the marketplace a list of arbitrary URLs or npm packages. Flo must control the package metadata, compatibility checks, publisher identity, and activation state.

### Marketplace entry types

The catalog should list capabilities in terms a restaurant understands:

| Entry type | Example | Runtime | What installation does |
|---|---|---|---|
| Built-in capability | Cash or card recording | Flo core | Enables an existing core capability; no package installation |
| Local country package | Argentina fiscal pack | Signed `utilityProcess` package | Installs local rules, receipt behavior, and optional POS features |
| Hosted payment connector | Mercado Pago | Hosted broker | Registers a connector account and starts provider authorization |
| Hosted delivery connector | PedidosYa | Hosted broker | Registers webhook routing and provider credentials |
| Country bundle | Argentina operations bundle | Local plus hosted | Installs a compatible group of payment, fiscal, and delivery capabilities |

Flo-owned in-process modules are implementation details, not marketplace downloads. External local code must use the `utilityProcess` ABI. A hosted connector must not require arbitrary code execution on the POS.

### Publisher trust levels

Every listing must show its trust level before installation:

| Level | Meaning | Production policy |
|---|---|---|
| Flo built-in | Shipped and signed by Flo | Allowed by default |
| Flo verified | Package reviewed, signed, and tested by Flo | Allowed after merchant configuration |
| Partner verified | Publisher identity and provider relationship verified | Allowed after merchant approval |
| Community | Package is not verified by Flo | Developer/test environments only until a stronger policy exists |

Trust level is not a substitute for permissions. A verified package must still declare exactly what it can access.

### What the merchant sees

The merchant should not need to understand Vendure, Medusa, Electron, or broker topology. The marketplace should answer:

```text
What does this enable?
Which country and providers does it support?
Does it run locally or in the cloud?
What data and permissions does it need?
Will it work offline?
Who supports it?
What version of Flo does it require?
How is it billed?
```

The primary browse filters should be:

```text
country -> capability -> provider -> installation mode
```

For Argentina, a merchant should see something like:

```text
Argentina
  Payments
    Mercado Pago QR
    Payway terminal
  Fiscal
    ARCA electronic invoicing
  Delivery
    PedidosYa
    Uber Eats
```

The user should not see five separate technical packages when one country bundle can present one coherent setup flow.

### Listing metadata

Each catalog entry needs a stable signed record:

```json
{
  "listingId": "connector.mercadopago.ar",
  "publisherId": "flo-verified",
  "name": "Mercado Pago QR",
  "type": "hosted_connector",
  "scope": "country",
  "countries": ["AR"],
  "capabilities": ["payment.qr", "payment.status", "payment.refund"],
  "execution": "hosted",
  "floApiVersion": ">=1.0.0 <2.0.0",
  "permissions": ["payment.write", "connector.events"],
  "providerAccountRequired": true,
  "offlineMode": "not_supported",
  "supportUrl": "https://example.invalid/support",
  "termsUrl": "https://example.invalid/terms",
  "privacyUrl": "https://example.invalid/privacy",
  "artifactDigest": "sha256:...",
  "signature": "..."
}
```

The listing is not the package itself. It points to an immutable artifact or an approved hosted connector identity. Updating a listing must not silently replace an installed artifact.

### Country scope

Every plugin or connector must declare whether it is country-specific or global:

```text
country
  One country only, for example Argentina.

multi_country
  A declared list of countries, for example Argentina and Uruguay.

global
  Not limited to a country, for example a generic printer, loyalty,
  analytics, or provider that operates across supported markets.
```

Examples:

```json
{
  "scope": "country",
  "countries": ["AR"]
}
```

```json
{
  "scope": "multi_country",
  "countries": ["AR", "UY", "CL"]
}
```

```json
{
  "scope": "global",
  "countries": []
}
```

The installation country is the store's configured legal and operating country. The marketplace must use that country as a hard filter:

| Store country | Listing scope | Show in marketplace? |
|---|---|---|
| Argentina | `country: ["AR"]` | Yes |
| Argentina | `multi_country: ["AR", "UY"]` | Yes |
| Argentina | `country: ["IN"]` | No |
| Argentina | `global` | Yes |
| No country configured | Any country-scoped listing | No; ask the merchant to configure the store country |

The filter applies before search results, recommendations, installation, and activation. A merchant must not be able to install an Argentina-only fiscal package into an India store by manually entering a package ID.

Global packages still need capability-level availability. A global package may provide a generic feature everywhere but expose a provider connector only in selected countries. The manifest should express that restriction per capability rather than incorrectly presenting every provider in every market.

If the store country changes after installation:

- Keep historical records and installed package metadata readable.
- Disable country-incompatible capabilities until the merchant configures a compatible package.
- Do not silently uninstall or delete the package.
- Require a new activation check for payment, tax, fiscal, and delivery capabilities.
- Show the affected installation in settings with a clear incompatibility reason.

### Installation and activation

Installation should have two distinct stages:

```text
Install
  verify publisher, signature, ABI, permissions, country, and artifact

Activate
  configure merchant account, authorize provider, test connection, enable capability
```

The merchant flow is:

1. Configure the store country if it is not already configured.
2. Select a capability from the country-filtered catalog.
3. Review provider, trust level, permissions, data location, offline behavior, support, and pricing.
4. Install the local package or register the hosted connector.
5. Authorize the provider account if required.
6. Configure store, terminal, tax identity, or delivery settings.
7. Run a connection and sandbox test.
8. Enable the capability for this store.
9. Show health, last successful operation, and any required action.

Disabling a plugin must stop new operations without deleting historical payments, invoices, orders, or connector events. Uninstalling must be a separate action and must preserve records needed for audit and recovery.

### Catalog data model

Create the data model before creating a public marketplace:

```text
marketplace_listings
  listing_id, publisher_id, type, country_scope, capabilities,
  trust_level, latest_version, support_urls, artifact_digest

plugin_packages
  package_id, version, flo_api_version, signature, artifact_digest, status

plugin_installations
  installation_id, package_id, store_id, execution_mode, status,
  installed_at, activated_at, disabled_at

plugin_permissions
  installation_id, permission, granted_by, granted_at, revoked_at

connector_accounts
  connector_id, installation_id, store_id, provider_account_ref,
  auth_status, readiness_status, last_health_check

marketplace_events
  installation_id, event_type, actor, occurred_at, metadata
```

Keep `marketplace_listings` separate from `plugin_installations`. A catalog update must not mutate a merchant's active installation. Keep `connector_accounts` separate from package installation because one package may serve many stores and a store may have multiple provider accounts.

### Versioning and revocation

The catalog and loader must support:

- Flo ABI compatibility ranges.
- Package and connector version pinning.
- Upgrade previews before activation.
- Rollback to the previous compatible local package.
- Package revocation by digest or publisher.
- Connector suspension without deleting historical data.
- Migration hooks for configuration changes.
- A clear state when a package is no longer supported.

For hosted connectors, revocation disables new provider calls while preserving the event log and reconciliation tools. For local packages, revocation prevents startup and marks affected capabilities as unavailable; historical records remain readable.

### Marketplace rollout

Build the marketplace in stages:

| Stage | Catalog | Installation | Audience |
|---|---|---|---|
| 1 | Versioned signed JSON or bundled catalog | Flo-owned packages and hosted connectors only | Internal pilots |
| 2 | Hosted catalog API with publisher records | Flo verified and partner verified packages | Selected merchants |
| 3 | Publisher portal and review workflow | Approved external country packages | Production marketplace |
| 4 | Community channel | Explicit developer-mode installation | Developers and testers |

The plugin ABI, manifest, listing schema, permissions, installation records, and activation states must exist in Stage 1. The public marketplace UI and third-party publishing workflow can wait.

## Plugin Security Model

Vendure and Medusa provide useful security patterns, but neither treats an installed plugin as untrusted code:

| Reference | Security pattern | Limitation for Flo |
|---|---|---|
| Vendure | RBAC, custom permissions, guarded API resolvers, compatibility checks, peer dependency conventions, host hardening, rate limiting, and container guidance | Plugin code still runs in the trusted application process |
| Medusa | Modular providers, package exports, explicit configuration, and separated module/provider responsibilities | Package exports control module resolution, not runtime privileges or process isolation |
| Flo | Manifest permissions, signed packages, `utilityProcess`, broker isolation, capability checks, and revocation | Requires Flo-specific implementation; the marketplace cannot rely on npm trust alone |

Installing an npm package or loading a JavaScript entry point is code execution. A package name, `package.json` exports field, or publisher label is not a security boundary.

### Security by execution mode

| Execution mode | Trust assumption | Required controls |
|---|---|---|
| `in_process` | Flo-owned and trusted | Code review, tests, release signing, least-privilege internal APIs |
| `utility_process` | External local code is not trusted by the main process | Signed package, isolated process, MessagePort ABI, permission broker, timeouts, bounded payloads, crash restart, no raw DB or Electron access |
| `hosted` | Publisher service is separately reviewed and accountable | Verified domain, signed manifest, tenant isolation, connector-account credentials, egress allowlist, HMAC or mTLS, health checks, rate limits, revocation |

`utilityProcess` improves crash and access isolation, but it is not a complete operating-system sandbox. Flo must still require publisher trust, package signing, explicit capabilities, review, updates, and revocation. A future hardening step may add a stronger OS sandbox or container for higher-risk packages.

### Permission model

Permissions must be capability-specific and enforced by the host, not only displayed in the manifest:

```text
settings.read
settings.write
payment.initialize
payment.status
payment.refund
fiscal.calculate
fiscal.issue
delivery.poll
delivery.command
orders.read
orders.create_external
events.receive
printing.receipt
broker.connect
```

The host must reject a request when:

- The permission is not declared by the manifest.
- The merchant did not grant the permission during activation.
- The capability is not enabled for the store country.
- The installation is disabled, revoked, incompatible, or unhealthy.
- The request targets a different store or connector account.
- The request exceeds its payload, timeout, rate, or resource limit.

The plugin receives host-provided functions, not unrestricted objects:

```text
Allowed:
  host.settings.read(pluginId, key)
  host.payment.status(paymentId)
  host.events.emit(normalizedEvent)

Not allowed:
  plugin.db.exec(sql)
  plugin.fetch(anyUrl)
  plugin.electron.mainWindow
  plugin.fs.readFile(anyPath)
```

### Installation security flow

Before installation, Flo must:

1. Verify the catalog signature.
2. Verify the package digest and publisher signature.
3. Check the Flo ABI compatibility range.
4. Check country scope and capability availability.
5. Review requested permissions and hosted domains.
6. Reject undeclared entry points or artifacts.
7. Scan package metadata and dependencies according to the publisher policy.
8. Install into an isolated package location.
9. Start a health check without activating payment, fiscal, or delivery operations.
10. Require merchant activation and permission grants.

The installed artifact must be immutable. Updates are new signed artifacts with a preview, compatibility check, migration step, health check, and rollback path.

### Hosted connector security

The hosted broker must enforce the same manifest permissions even when the connector runs outside Flo:

- Bind every request to `publisherId`, `connectorId`, `installationId`, and `storeId`.
- Store provider credentials per connector account, never globally.
- Use HMAC or mTLS between the broker and a publisher-owned connector.
- Verify provider signatures before accepting events.
- Allow outbound calls only to manifest-approved provider hosts.
- Do not trust a `serviceBaseUrl` merely because it appears in a package.
- Verify domain ownership and service health before activation.
- Prevent a connector from returning events for another merchant.
- Redact secrets and payment data from logs.
- Rate-limit polling, commands, and event delivery.
- Revoke the connector without deleting historical records.

### Threats and required responses

| Threat | Required response |
|---|---|
| Malicious local package | Do not run in-process; verify signature; use `utilityProcess`; enforce host permissions |
| Compromised publisher | Revoke publisher and package signatures; stop new operations; preserve audit data |
| Package exfiltrates credentials | Keep credentials behind host/broker APIs; never pass unrelated secrets to plugins |
| Provider webhook replay | Verify signature and deduplicate by connector account plus provider event ID |
| Cross-store data access | Bind every request and credential to `storeId` and `connectorAccountId` |
| Connector sends data to an unknown site | Enforce `allowedOutboundHosts` and verified `serviceBaseUrl` |
| Plugin hangs or consumes resources | Request deadlines, process limits, restart policy, polling rate limits |
| Bad update breaks operations | Immutable versions, health checks, staged activation, and rollback |
| Revoked provider or package | Disable new operations while preserving payments, invoices, orders, and events |

The minimum safe policy is: **trusted code may run in-process; external code runs out-of-process; provider-facing traffic runs through an approved hosted connector.**

## Security and Reliability Requirements

- Sign plugin packages and verify signatures before installation.
- Do not run external plugin code in the Electron main process.
- Use capability-based permissions instead of unrestricted access.
- Keep provider credentials in the broker or OS-protected storage.
- Verify webhook signatures before parsing business data.
- Deduplicate every external event by provider, connector account, and event ID.
- Use idempotency keys for payment and order mutations.
- Persist events before acknowledging provider webhooks.
- Retry transient failures with bounded backoff.
- Move permanently failing events to a dead-letter state.
- Expose health and last-success information to the operator.
- Never silently mark a payment or fiscal document successful after a timeout.

## Implementation Order

### Implemented Stage 1

- Flo-owned manifest, permission, capability-operation, and runtime contracts.
- Typed Argentina and India manifests using `satisfies PluginManifest`.
- Manifest-only catalog registry and separate typed runtime registry.
- Synchronous in-process Argentina IVA and India GST `TaxEngine` runtimes.
- Per-capability `execution: 'in_process' | 'hosted'`. Tax is the only in-process kind in Stage 1; payment, fiscal, and delivery are declared as hosted. The runtime registry refuses a bundle that mixes them incorrectly.
- Activation-aware tax dispatcher: `main/services/tax.ts` only calls the country tax engine when the matching package is installed AND activated. A package installed but not activated falls back to the core calculation, so we never silently change tax math for a country whose pack the operator has not enabled.
- Generic fiscal identity `{type, value}`. GSTIN is one possible type. GST computation is in the India tax engine; the GST invoice / IRN authorization is a separate `fiscal.gst_invoice` capability and is not part of tax math.
- Connector configuration handlers: each provider exports a `ConnectorConfigHandler` and the route dispatches by `capability.provider`. No more `if (provider === 'mercadopago')` branch in `main/plugins/routes.ts`.
- Hosted payment and delivery capabilities cannot be marked `verified` by the local POS. The activation gate surfaces `connector_verification_hosted` so the merchant UI points at the broker, not the local API.
- Feature-level installation, permission grants, readiness gates, connector state, and soft uninstall.
- Capability-derived POS payment methods and Settings integrations UI.
- Manifest, runtime bundle, duplicate-ID, permission, readiness, and connector contract tests.
- Zod v4 validation of manifests and runtime bundles before registry acceptance.
- A first-party scaffold command for new country manifests.
- Shared `shared/plugin-api.ts` — types and Zod schemas imported by both the frontend (via the `@flo-plugin-api` path alias) and the backend. The frontend does not import any server runtime.

### Phase 1: Core contracts

- Define payment, tax, fiscal, and delivery types.
- Add provider references, idempotency keys, and explicit statuses.
- Add canonical event envelopes, connector commands, and an outbox seam.
- Replace hardcoded frontend payment methods with capability discovery.
- Add contract tests using fake connectors.

### Phase 2: First-party Argentina package

- Add Argentina payment capabilities.
- Add Argentina tax calculation.
- Add ARCA fiscal document workflow.
- Add receipt and recovery states.
- Keep the first implementation in-process if it is Flo-owned.

### Phase 3: Hosted broker foundation

- Reuse or generalize the existing outbound cloud connection.
- Add connector accounts and normalized event envelopes.
- Add durable polling, cursors, deduplication, retries, and reconciliation.
- Add asynchronous event dispatch and account-scoped command delivery.
- Add one hosted payment connector and one hosted delivery connector.

### Phase 4: Argentina delivery

- Add PedidosYa and Uber Eats provider adapters behind the broker.
- Poll for new and changed orders; persist cursors and synchronization logs.
- Add normalized orders to POS/KDS.
- Add accept, deny, preparing, ready, dispatched, delivered, cancel, and modification flows.
- Confirm outbound commands through later polling.
- Test polling replay, cursor recovery, and duplicate delivery.

### Phase 5: External plugin ABI

- Publish the versioned SDK and manifest schema.
- Add `utilityProcess` lifecycle and MessagePort envelopes.
- Add package signature and compatibility checks.
- Provide a sample country package that does not access Flo internals.

### Phase 6: India and additional countries

- Add each country as a package using the same contracts.
- Add provider certification tests before enabling production accounts.
- Do not add country-specific branches to the core unless the contract itself is missing a generic concept.

## Acceptance Criteria

- Argentina payment providers can be added without changing order accounting tables.
- Argentina fiscal authorization is distinguishable from tax calculation.
- ARCA failures are recoverable and auditable.
- PedidosYa and Uber Eats webhooks never require inbound connectivity to the POS.
- V1 delivery synchronization uses hosted polling and never requires a public POS endpoint.
- Delivery orders can move through received, accepted, preparing, ready, dispatched, delivered, rejected, and cancelled states.
- Polling cursors are durable, replayable, and advanced only after events are stored.
- Duplicate provider events do not create duplicate orders, payments, or invoices.
- A country package declares its capabilities and permissions before installation.
- A third-party local package cannot access unrestricted main-process APIs.
- A plugin request without a declared and granted permission is rejected by the host.
- External local packages cannot run in-process, read the raw database, or call arbitrary hosts.
- Hosted connectors are bound to one publisher, connector account, store, and approved outbound host set.
- A signed package can be disabled or revoked without deleting historical business records.
- India can add UPI, GST, and an Indian delivery provider without adding a new core payment primitive.
- A new country can be evaluated using the country-package checklist above.
- The catalog distinguishes built-in, local, hosted, and bundled capabilities.
- A merchant can review permissions, trust level, offline behavior, support, and pricing before activation.
- Installing or updating a catalog listing cannot silently replace an active package.
- Disabling or revoking a package preserves historical payments, fiscal documents, orders, and connector events.
- Stage 1 can use a signed catalog without requiring a public marketplace or publisher portal.

## Open Decisions

- Is the existing Blue/FloAdmin service the first hosted broker, or should the broker be a separate service?
- Which Argentine fiscal service should be the first ARCA implementation target?
- Which Mercado Pago flow is required first: QR, Point terminal, or both?
- Which provider should be the first delivery certification target: PedidosYa or Uber Eats?
- Should the first Argentina package be Flo-owned only, or should the external ABI be implemented before it?
- What package signing and publisher trust model will be used?
- Which hosted connector credentials may be stored locally during temporary offline operation?
- Who owns the initial signed catalog and package review process?
- Will country bundles be curated by Flo, or can publishers assemble bundles from independently verified capabilities?
- Which capabilities require Flo verification before production, especially fiscal and payment capabilities?
- Will hosted connectors be billed by Flo, by the publisher, or through an external provider agreement?

## References

- [Vendure plugins](https://docs.vendure.io/guides/developer-guide/plugins/)
- [Vendure permissions](https://docs.vendure.io/reference/typescript-api/common/permission/)
- [Vendure security guide](https://docs.vendure.io/guides/developer-guide/security/)
- [Vendure EventBus](https://docs.vendure.io/reference/typescript-api/events/event-bus/)
- [Vendure payment integrations](https://docs.vendure.io/guides/core-concepts/payment/)
- [Medusa plugins](https://docs.medusajs.com/learn/fundamentals/plugins/create)
- [Medusa event subscribers](https://docs.medusajs.com/learn/fundamentals/events-and-subscribers)
- [Saleor payment apps](https://docs.saleor.io/developer/payments/payment-apps)
- [Saleor transaction events](https://docs.saleor.io/developer/payments/transactions)
- [Odoo fiscal localizations](https://www.odoo.com/documentation/saas-19.3/applications/finance/fiscal_localizations.html)
- [Shopify app extensions](https://shopify.dev/docs/apps)
- [Electron `utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process)
- [Mercado Pago Point](https://www.mercadopago.com.ar/developers/en/docs/mp-point/overview)
- [PedidosYa Partner API](https://developer.pedidosya.com/api-specifications)
- [Uber Eats order integration](https://developer.uber.com/docs/eats/guides/order_integration)
- [ARCA](https://www.afip.gob.ar/fe/)
