# Flo Plugin Authoring

Stage 1 plugins are first-party packages compiled into Flo. A country package owns its local tax and fiscal rules, declares provider capabilities, and exposes only the configuration needed by the merchant UI. No external package is downloaded or executed by the POS in this stage.

Tax, fiscal invoices, payments, and delivery are plugin capabilities. Core code owns their contracts and lifecycle only; country and provider implementations live in packages. The global default package is also a plugin, providing generic tax behavior until a dedicated country package is available.

## Quick Path

1. Run `npm run plugin:create -- --name "Country operations" --countries XX`.
2. Define a versioned manifest with country-scoped capabilities using Flo's `PluginManifest` type and `PluginCapabilityKind` options.
3. Keep tax calculation and fiscal authorization as separate capabilities.
4. Add connector configuration adapters without storing provider secrets in the POS.
5. Add local runtimes with `definePluginRuntimeBundle()` only when they implement a Flo-owned contract.
6. Add manifest, country-filtering, tax, and activation tests.
7. Open Settings -> Integrations and verify install, feature activation, and readiness gating.

## Package Layout

| Path | Responsibility |
| --- | --- |
| `main/plugins/<country>/manifest.ts` | Country package manifest. |
| `main/plugins/<country>/tax-engine.ts` | Country tax engine implementation. |
| `main/plugins/<country>/runtime.ts` | Typed in-process runtime bundle. |
| `main/plugins/<country>/index.ts` | Country package exports. |
| `main/plugins/<country>/<provider>.ts` | Country-specific connector implementation, Zod configuration schema, and safe status summary. |
| `main/plugins/registry.ts` | Manifest-only catalog registration. |
| `main/plugins/runtime-registry.ts` | Typed runtime bundle registration. |
| `main/plugins/catalog.ts` | Package and capability country filtering. |
| `main/plugins/routes.ts` | Merchant-facing install and activation API. |
| `tests/plugin-contracts.test.ts` | Manifest and runtime contract checks. |

## Manifest Rules

Every manifest must pass `validateManifest` before installation. The minimum shape is:

```ts
const manifest: PluginManifest = {
  manifestVersion: 1,
  id: 'country.xx',
  version: '1.0.0',
  publisher: { id: 'flo-verified', name: 'Flo' },
  displayName: { en: 'Country operations' },
  scope: 'country',
  countries: ['XX'],
  floApiVersion: '^1.0.0',
  execution: ['in_process'],
  capabilities: [{
    id: 'admin.xx_settings',
    kind: PluginCapabilityKind.Admin,
    execution: 'in_process',
    operations: ['configure'],
    displayName: { en: 'Country settings' },
  }],
  permissions: [],
  artifact: { digest: 'built-in', signature: 'built-in' },
};
```

Use `scope: 'country'` for one country and `scope: 'multi_country'` for a declared list. A global package must use an empty `countries` list. Capability-level `countries` can narrow a package capability further; the catalog filters those capabilities before installation or activation.

Capability IDs are stable API identifiers. Prefer `tax.<name>`, `fiscal.<authority>`, `payment.<provider>_<flow>`, and `delivery.<provider>`.

Permissions and capability operations are Flo literal unions. Write manifests with `satisfies PluginManifest`; a typo such as `payment.wrtie` or an invalid operation fails `npm run build`.

Use Flo's kind options rather than raw kind strings:

```ts
import { PluginCapabilityKind, PluginRuntimeKind, type PluginManifest } from '../api-types';
import { definePluginRuntimeBundle, type TaxEngine } from '../api-types';

const taxEngine: TaxEngine<'tax.example'> = {
  capabilityId: 'tax.example',
  calculate(request) { /* ... */ },
};

export const RUNTIME = definePluginRuntimeBundle({
  manifest,
  runtimes: [{ kind: PluginRuntimeKind.Tax, connector: taxEngine }],
});
```

`definePluginRuntimeBundle()` checks the manifest-to-runtime link at compile time: the runtime kind and literal `capabilityId` must match a capability in that manifest. Put each connector's Zod configuration schema beside its implementation in the country or multi-country package. At every plugin boundary, parse unknown input through that exported schema. At bootstrap, `PluginRuntimeBundleSchema` validates runtime bundles and `PluginRegistry.register()` repeats the manifest coverage check. A plugin never defines a Flo interface, kind, operation, permission, or hand-written structural validator of its own.

## Activation Model

Installation and activation are separate operations:

| State | Meaning |
| --- | --- |
| Installed | Package metadata and local state exist. No capability is enabled. |
| Configured | A provider account has safe, non-secret configuration. |
| Verified | The connector account is authorized and health-checked. |
| Active | The selected capability may be used by Flo. |
| Disabled | The package remains installed but the capability is off. |

Tax and local fiscal capabilities can activate without a connector account. Hosted payment, delivery, fiscal, and tax capabilities require an account with `authStatus: 'authorized'` and `readiness: 'verified'`. The API enforces this even if a client bypasses the UI.

### Built-in tax provisioning

Flo provisions tax packages automatically so moving country rules out of core is transparent to merchants. At startup, an existing store receives the built-in package for its saved country; first-run setup provisions the same package after the owner selects a country. The selection is `country.<iso>` when present, otherwise the global default package. An explicitly disabled or uninstalled package is never re-enabled automatically.

The global default package has generic product-rate tax math only. Do not add a country exception there: create a dedicated country package instead. For example, Thailand's fixed 7% VAT belongs in `country.th`.

For `hosted` payment and delivery capabilities, the local POS cannot mark the connector `verified` — the broker reports the status. The activation gate surfaces `connector_verification_hosted` so the merchant UI points at the broker, not the local API. Don't add a route or worker that flips a hosted connector to `verified`; the broker owns that lifecycle.

## Per-Capability Execution

Each capability declares `execution: 'in_process' | 'hosted'`. The manifest-level `execution` array is a coarse-grained hint; the per-capability field is the source of truth.

- `in_process`: the package owns a typed runtime (a `TaxEngine<'tax.iva'>` for example). The runtime registry only carries runtimes for these. The `PluginRegistry.register()` call refuses a bundle that declares an `in_process` capability without a runtime.
- `hosted`: the Stage 3 broker satisfies the capability. The package only declares it. The registry refuses a bundle that attaches a runtime to a `hosted` capability.

Tax is the only kind with `in_process` capabilities in Stage 1. Payment, fiscal authorization, and delivery all live in the hosted broker. The activation-aware tax dispatcher in `main/services/tax.ts` looks up the engine for the active country package and falls back to the core calculation when nothing is installed or activated.

## Connector Configuration Handlers

Each provider module exports a `ConnectorConfigHandler` (validate + summarize). The route dispatches to the handler by `capability.provider` and never branches on a hard-coded provider name. Adding a new provider is one new file in the country or multi-country package that exports a handler; the route and the registry do not change.

The single import path for providers is `main/plugins/connector-handlers.ts` (`getConnectorHandler(provider)`). The route's connector endpoint looks the handler up and calls `validate` then `summarize`. An unknown provider is rejected with `No connector handler registered for provider "${provider}"` — the route never silently stores a raw config it doesn't understand.

## Fiscal Identity

The customer-facing fiscal identity is generic `{type, value}`. GSTIN is one possible `type`; CUIT is another. The country tax engine decides what to do with the identity it recognizes. GST computation is in the India tax engine; the GST invoice / IRN authorization is a separate `fiscal.gst_invoice` capability and is not part of tax math. The two are independently declared, configured, and activated.

## Connector Boundaries

- Never send access tokens, passwords, client secrets, or provider credentials to the POS API.
- Store only safe configuration summaries and opaque provider account references locally.
- Keep `storeId`, `installationId`, `capabilityId`, and provider identity on every connector account.
- Use the hosted connector or broker for real Mercado Pago, delivery, fiscal authorization, polling, and webhooks.
- The POS must not expose an inbound provider webhook route.

Stage 1 connector files are configuration/status adapters only. They do not make provider network calls.

## Testing Checklist

- [ ] Manifest accepts the supported Flo API range.
- [ ] Manifest rejects invalid scope, country, duplicate capability, and incompatible API data.
- [ ] Runtime uses `definePluginRuntimeBundle()` and Flo `PluginRuntimeKind` options.
- [ ] Runtime `capabilityId` and kind match a declared manifest capability at compile time and registration.
- [ ] Runtime rejects an unknown kind or a connector missing the methods for that kind.
- [ ] Package appears only for supported store countries.
- [ ] Capability-level country restrictions are respected.
- [ ] Tax behavior preserves existing country regression tests.
- [ ] Installation does not activate hosted capabilities automatically.
- [ ] Local tax/fiscal features activate without an external account.
- [ ] Payment/delivery activation fails without an authorized, verified connector account.
- [ ] Provider secrets are rejected at the POS boundary.
- [ ] Disabling one feature does not disable unrelated features.

## Current Examples

- Argentina: `main/plugins/ar/` with IVA, ARCA, Mercado Pago QR, and PedidosYa capabilities.
- India: `main/plugins/in/` with GST, GST invoicing, UPI, Swiggy, and Zomato capabilities.
- Thailand: `main/plugins/th/` with the fixed 7% VAT tax engine.
- Default: `main/plugins/global/` with generic product-rate tax calculation for countries without a country package.

The canonical contract and security decisions remain in `docs/plugin-proposal.md`. Update that proposal before changing the wire contract or activation rules.
