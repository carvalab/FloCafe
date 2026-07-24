# Flo Plugin Architecture

Status: implemented Stage 1. This document describes the shipped in-repository plugin system. Hosted providers, external package loading, and utility-process execution are future stages, not current behavior.

## Purpose

Flo keeps country and provider behavior outside the POS core while retaining Flo-owned contracts. A plugin declares what it offers in a manifest and implements only Flo capability contracts. Core code never imports a provider-specific contract or accepts a provider-defined runtime kind.

## Package Layout

```text
shared/
  plugin-api.ts             Browser-safe types + Zod schemas + PluginRegistry
main/plugins/
  api-types.ts              Backend re-export of the shared contract
  schemas.ts                Backend aliases for shared envelope schemas
  contracts.ts              Re-exports the shared types; this file is the single import path for plugin shapes
  manifest.ts               Manifest semantic validation (semver range, country scope)
  registry.ts               Manifest-only catalog registry
  runtime-registry.ts       Activation-aware resolver for in-process tax engines
  connector-handlers.ts     Connector config-handler registry (provider → validate/summarize)
  catalog.ts                Country-filtered, state-merged catalog entry builder
  installations.ts          DB-backed installation, feature, and connector-account state
  routes.ts                 /api/plugins/* route handlers
  ar/
    manifest.ts
    runtime.ts
    tax-engine.ts
    mercado-pago.ts         Argentina-specific connector implementation + ConnectorConfigHandler
  in/
    manifest.ts
    runtime.ts
    tax-engine.ts
```

`manifest.ts` is declarative metadata only. `runtime.ts` owns executable imports. The catalog registry imports manifests only; it never imports providers or runtimes.

Provider behavior and its Zod configuration schema belong in its country or multi-country package. For example, Mercado Pago belongs in `ar/`; Swiggy and Zomato belong in `in/`. Core does not own a provider connector directory.

## Shared API Boundary

The frontend (Next.js static export) and the backend (Express) both import the same plugin types and Zod schemas from `shared/plugin-api.ts`. That file has only browser-safe imports; the frontend can statically export without pulling in `better-sqlite3`, `express`, or any other server module. The backend re-exports the same contract through `main/plugins/api-types.ts`.

When the frontend renders the plugins catalog, the wire shape is `CatalogEntry` from the shared module. The backend never hands the frontend a different shape than what the shared module describes.

## Flo-Owned Contracts

The public contracts are in `shared/plugin-api.ts` (re-exported through `main/plugins/contracts.ts`):

- `TaxEngine`
- `PaymentConnector`
- `FiscalDocumentProvider`
- `DeliveryConnector`

Manifests use `PluginCapabilityKind.*`; executable entries use `PluginRuntimeKind.*`. Plugins do not add raw kinds, operations, permissions, or parallel host interfaces.

Every executable package uses:

```ts
definePluginRuntimeBundle({ manifest, runtimes })
```

The helper binds a runtime's literal `capabilityId` and kind to a capability declared by that same manifest at compile time. For example, `TaxEngine<'tax.iva'>` cannot be registered as a payment runtime or against an undeclared capability.

## Per-Capability Execution

Each capability declares whether it is `in_process` (a typed runtime lives in this package) or `hosted` (the Stage 3 broker satisfies it). The manifest-level `execution` array stays as a coarse-grained hint for the merchant UI, but the per-capability field is the source of truth.

Rules:

- An `in_process` capability MUST have a runtime in the runtime bundle. The registry rejects a bundle that omits the runtime.
- A `hosted` capability MUST NOT have a runtime. The registry rejects a bundle that tries to attach one.
- The runtime registry (`runtime-registry.ts`) only exposes the in-process runtimes to the rest of the codebase.
- Tax is the only kind with `in_process` capabilities in Stage 1. Payment, fiscal authorization, and delivery all live in the hosted broker.

## Validation

All plugin boundary data is untrusted and parsed through exported Zod schemas. The shared schemas cover manifests, capabilities, runtime bundles, request/result envelopes, catalog responses, installation responses, connector responses, and payment-method responses. Provider configuration schemas remain beside each provider implementation.

`PluginRegistry.register()` validates a bundle with the shared Zod runtime-bundle schema, validates semantic manifest rules, rejects duplicate package and runtime capability IDs, verifies that each runtime matches a declared manifest capability, and verifies that the in-process/hosted declarations are consistent with the runtimes that arrived in the bundle.

Semantic rules remain separate from structural parsing: supported Flo API ranges, country scope, and duplicate declaration checks.

## Activation-Aware Tax Resolution

The tax dispatcher (`main/services/tax.ts`) calls `getTaxEngineForCountry(country)`, which returns a `TaxEngine` only when the matching country package is **installed AND activated**. A package installed but not activated falls back to the core calculation; we never silently change tax math for a country whose tax pack the operator has not enabled.

This avoids the legacy `if (country === 'IN')` country switch in core: the dispatcher asks the registry for whatever package is currently active for the store country. New countries drop a new package into `main/plugins/<code>/` and register it in `runtime-registry.ts`; no core change.

## Connector Configuration Handlers

Each provider's connector module exports a `ConnectorConfigHandler` (validate + summarize). The route layer dispatches to the handler by `capability.provider` and never branches on a hard-coded provider name. Adding a new provider is one new file in the country or multi-country package; the routes do not change.

The handler registry (`main/plugins/connector-handlers.ts`) is the single import path for providers. The route's connector endpoint looks up `getConnectorHandler(provider)` and calls its `validate` / `summarize`. An unknown provider is rejected with `No connector handler registered for provider "${provider}"` — the route never silently stores a raw config it doesn't understand.

## Country And Multi-Country Packages

A package has one installation identity and can cover one or many countries:

```ts
{
  scope: 'multi_country',
  countries: ['AR', 'UY'],
  capabilities: [
    { id: 'payment.provider_ar', execution: 'hosted', countries: ['AR'], /* ... */ },
    { id: 'payment.provider_uy', execution: 'hosted', countries: ['UY'], /* ... */ },
  ],
}
```

The catalog first filters the package by `manifest.countries`, then filters each capability by its optional `capability.countries` list.

Use one capability and connector when provider behavior and its Zod configuration are genuinely shared across countries. Use separate capability IDs and connector implementations when a provider differs by country. A multi-country package is a distribution boundary, not permission to hide country-specific behavior behind conditionals.

Country fiscal behavior remains separate from payment and delivery behavior. An Argentina package may declare IVA, ARCA, Mercado Pago, PedidosYa, and Rappi capabilities, but each capability is independently activated and configured.

## Fiscal Identity

The customer-facing fiscal identity is generic `{type, value}`. GSTIN is one possible `type`; CUIT is another. The country tax engine decides what to do with the identity it recognizes.

GST computation is in the India tax engine. The GST invoice / IRN authorization is a separate `fiscal.gst_invoice` capability and is not part of tax math. The two are independently declared, configured, and activated.

## Installation And Activation

Installation creates local state but does not activate every capability. Flo persists package installation, per-capability feature state, and safe connector-account metadata in SQLite.

- Tax and local fiscal capabilities can activate without an external account.
- Hosted payment, delivery, and fiscal capabilities require a connector account with authorization and broker verification.
- Hosted payment and delivery capabilities cannot be marked `verified` by the local POS. The broker reports the verification status. The route returns `connector_verification_hosted` so the merchant UI points at the broker, not the local API.
- Provider credentials and webhook secrets are never accepted by the local POS API.
- Connector configuration persists only safe summaries and opaque provider account references.

## Current Built-Ins

| Package | Local runtime (`in_process`) | Hosted capabilities |
| --- | --- | --- |
| Argentina (`country.ar`) | IVA tax engine | ARCA, Mercado Pago QR, PedidosYa, Rappi |
| India (`country.in`) | GST tax engine | GST invoice, UPI QR/intent, Swiggy, Zomato |
| Thailand (`country.th`) | VAT tax engine | none |
| Global default (`global.default`) | Product-rate tax engine | none |

Stage 1 provider files are configuration/status implementations. They do not call provider APIs from the POS.

## Future Boundaries

Provider-facing OAuth, credentials, public webhooks, retries, and API calls belong to an approved hosted connector or broker. A restaurant desktop is not a public webhook endpoint.

Future external packages may use a `utilityProcess` ABI, but they must retain the same manifest, Zod envelope, permission, per-capability `execution`, and Flo-owned capability contracts. No external loader or runtime download exists in Stage 1.

## References

- `docs/plugin-proposal.md` - contract decisions and implementation scope
- `docs/plugin-authoring.md` - required author workflow
- `docs/plugin-references.md` - Vendure, Medusa, and Pi research
- Vendure `PaymentMethodHandler` - narrow typed payment lifecycles
- Medusa `ModuleProvider` - explicit module/provider registration
- Pi extension examples - typed host APIs and lifecycle-bound safety checks
