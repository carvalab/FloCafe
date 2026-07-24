# Reference systems for FloCafe plugin abstraction — survey and recommendation

Status: research. Companion to `plugin-architecture.md`. This document collects what other open-source and well-documented systems actually do for the same abstractions Flo needs, and recommends what to borrow.

This survey compares external systems and proposes abstractions for Flo. Three concrete borrows stand out:

1. **Saleor's transaction event stream + `transactionEventReport`** as the canonical model for asynchronous payment state from a hosted gateway. Flo's `ChargeResult` already mirrors it; the naming and reconciler logic are worth adopting verbatim.
2. **Kill Bill's `PaymentStates.xml` two-axis state machine** (operation × result) as the source for a tighter `Transaction` record than Flo currently plans. Cheap, no hosted dependency.
3. **Saleor App SDK permission manifest** as the model for the broker-side manifest Flo needs to identify a connector without leaking arbitrary URLs into the POS.

The rest of this doc is evidence and notes.

### Contract enforcement adopted by Flo

- **Vendure:** a plugin supplies `PaymentMethodHandler` instances with typed required lifecycle hooks; Flo mirrors this by making each runtime kind map to one Flo-owned connector contract.
- **Medusa:** a provider is explicitly registered through `ModuleProvider`, with a stable module and provider identity; Flo mirrors this with the separate manifest and runtime registries.
- **Pi coding-agent examples:** extensions receive the host's typed API, register only supported capabilities, and place safety checks at the lifecycle boundary. Flo mirrors this by parsing unknown runtime bundles before registration rather than trusting TypeScript casts or imported JavaScript.

Flo adds a stricter compile-time link than these references need for their dynamic loaders: `definePluginRuntimeBundle()` binds each runtime's literal capability ID and `PluginRuntimeKind` to a capability declared in that same manifest. Zod repeats the structural and method validation at bootstrap. This is the required authoring path for every new Flo plugin.

---

## 1. Payment provider / gateway interfaces

### 1.1 Saleor — Transaction events + App SDK

Saleor deprecated its legacy Python plugin system in favor of an App SDK with GraphQL webhooks. The relevant surface is split across three places:

- Transaction API: <https://docs.saleor.io/developer/payments/transactions>
- Transaction webhooks (synchronous): <https://docs.saleor.io/developer/extending/webhooks/synchronous-events/transaction>
- App SDK + manifest: <https://docs.saleor.io/developer/extending/apps/overview>

Concrete types Saleor App authors implement, from the docs:

- `TRANSACTION_INITIALIZE_SESSION` — synchronous request/response. App returns `{ pspReference, result, amount, time, externalUrl, message, actions, paymentMethodDetails }` where `result` is one of `CHARGE_SUCCESS | CHARGE_FAILURE | CHARGE_REQUEST | AUTHORIZATION_SUCCESS | AUTHORIZATION_FAILURE | AUTHORIZATION_REQUEST | AUTHORIZATION_ACTION_REQUIRED | CHARGE_ACTION_REQUIRED`.
- `TRANSACTION_PROCESS_SESSION` — same shape, called when the customer finishes an action like 3DS.
- `TRANSACTION_CHARGE_REQUESTED`, `TRANSACTION_CANCELATION_REQUESTED`, `TRANSACTION_REFUND_REQUESTED` — synchronous back-channel actions.
- `transactionEventReport` mutation — App pushes asynchronous events back: `{ id, type, pspReference, amount, availableActions, externalUrl, message, time }`.
- `TransactionEventTypeEnum`: `CHARGE_SUCCESS | CHARGE_FAILURE | CHARGE_REQUEST | AUTHORIZATION_SUCCESS | AUTHORIZATION_FAILURE | AUTHORIZATION_REQUEST | AUTHORIZATION_ACTION_REQUIRED | CHARGE_ACTION_REQUIRED | REFUND_SUCCESS | REFUND_FAILURE | REFUND_REQUEST | REFUND_REVERSED | CANCEL_SUCCESS | CANCEL_FAILURE | CANCEL_REQUEST | INFO`.
- `paymentMethodDetails`: `{ type: 'CARD' | 'OTHER'; name; brand?; firstDigits?; lastDigits?; expMonth?; expYear? }`.

Why this matters for Flo: the `pending | action_required | done | failed` quartet in Flo's existing `ChargeResult` (`registry/types.ts:26`) maps cleanly onto Saleor's `result` enum, and Saleor's `transactionEventReport` is exactly the call Flo needs on the broker side to reconcile a `transactionId` that arrived via webhook against an order that Flo acknowledged offline. Flo should treat Saleor's `TransactionEventTypeEnum` as the canonical vocabulary; renaming Flo's `pending/done/failed` to match avoids translator code later.

Sources:
- <https://docs.saleor.io/developer/extending/apps/building-payment-app>
- <https://docs.saleor.io/api-reference/payments/objects/transaction-event>
- <https://docs.saleor.io/api-reference/payments/objects/transaction>

### 1.2 Saleor — legacy payment gateway plugin (now deprecated but still used)

Class-based plugin with `process_payment`, `authorize`, `capture`, `refund`, `void`. `GatewayConfig` carries `gateway_name`, `auto_capture`, `supported_currencies`, `connection_params`, `store_customer`, `require_3d_secure`. Returns `GatewayResponse { is_success, action_required, kind, amount, currency, transaction_id, error, customer_id, card_info, raw_response, action_required_data, transaction_already_processed, psp_reference }`. Error codes normalized to `INCORRECT_NUMBER | INVALID_NUMBER | INCORRECT_CVV | INVALID_CVV | INCORRECT_ZIP | INCORRECT_ADDRESS | INVALID_EXPIRY_DATE | EXPIRED | DECLINED | PROCESSING_ERROR`.

Source: <https://docs.saleor.io/developer/extending/plugins/payment-gateways>.

For Flo: useful as a taxonomy for the normalized error codes Flo's payment provider returns could carry, and as a precedent that `supported_currencies` and `connection_params` belong on the provider manifest.

### 1.3 Medusa — `AbstractPaymentProvider`

File: <https://github.com/medusajs/medusa/blob/develop/packages/modules/payment/src/services/payment-provider.ts> — concrete type at <https://github.com/medusajs/medusa/blob/v2.13.6/www/apps/resources/references/types/interfaces/types.IPaymentProvider/page.mdx>.

Interface (TypeScript):

```ts
interface IPaymentProvider {
  identifier: string
  initiatePayment(data, context): Promise<InitiatePaymentOutput>
  updatePayment(data, context): Promise<UpdatePaymentOutput>
  deletePayment(data): Promise<DeletePaymentOutput>
  authorizePayment(data, context): Promise<AuthorizePaymentOutput>
  capturePayment(data): Promise<CapturePaymentOutput>
  cancelPayment(data): Promise<CancelPaymentOutput>
  refundPayment(data, context): Promise<RefundPaymentOutput>
  retrievePayment(data): Promise<RetrievePaymentOutput>
  getPaymentStatus(data): Promise<GetPaymentStatusOutput>
  savePaymentMethod?(data, context): Promise<SavePaymentMethodOutput>
  listPaymentMethods?(data): Promise<ListPaymentMethodsOutput>
  deletePaymentMethod?(data): Promise<DeleteAccountHolderOutput>
  retrieveAccountHolder?(data): Promise<RetrieveAccountHolderOutput>
  createAccountHolder?(data, context): Promise<CreateAccountHolderOutput>
  getWebhookActionAndData(data): Promise<WebhookActionResult>
  validateOptions?(options): Promise<void>
}
```

Discovery is done via Awilix DI: providers are registered as `pp_${identifier}_${id}`. The payment module owns the lifecycle (`session → authorize → capture → settle → refund`), and the provider is a stateless strategy that maps domain operations to gateway calls.

`getWebhookActionAndData` is the part Flo most wants to copy: a single normalized entrypoint that returns a `WebhookActionResult` describing what the core should do with the gateway's event (authorize, capture, refund, etc.). This is exactly what Flo's `webhooks.ts` dispatch does, but Medusa unifies it on the payment module rather than scattering through delivery vs. payment routes. Manual provider (`medusa-payment-manual`) demonstrates a `provider = nothing` placeholder pattern: <https://medusajs.com/integrations/medusajs-payment/>.

For Flo: the abstract method names are the standard. Flo's `charge()` should stay but Flo should consider splitting it from `capture`/`authorize` once a provider genuinely needs the two-step shape. Today no provider does, so don't pre-split.

### 1.4 Vendure — `PaymentMethodHandler` + `PaymentProcess`

Docs: <https://docs.vendure.io/guides/core-concepts/payment/>. Reference: <https://docs.vendure.io/core/reference/typescript-api/payment/payment-method-handler/>.

Class-based config:

```ts
new PaymentMethodHandler({
  code: 'my-payment-method',
  description: [...],
  args: { apiKey: { type: 'string' } },
  createPayment: (ctx, order, amount, args, metadata) => { ... }
  settlePayment:  (ctx, order, payment, args) => { ... }
  cancelPayment:  (ctx, order, payment, args) => { ... }
});
```

Two important extras Vendure offers that Flo doesn't yet:

- **Eligibility checker**: `PaymentMethodEligibilityChecker` decides whether a payment method is available for a given order (currency, amount, customer country). Flo's `paymentProvidersFor(country)` does the country half; adding eligibility to per-product or per-amount rules is a future extension.
- **Configurable state machine**: `PaymentProcess<MyState>` lets a plugin redefine payment states and transitions. Vendure's example adds a `Validating` state between `Created` and `Settled`. Flo doesn't need this now; it's the right hook to copy if ARCA forces a `validating` state before `issued`.

For Flo: borrow the eligibility-checker abstraction as the next step after country scoping, and the `PaymentProcess` extension as the future hook for multi-step provider flows.

### 1.5 Kill Bill — `PaymentPluginApi`

File: <https://github.com/killbill/killbill-plugin-api/blob/master/payment/src/main/java/org/killbill/billing/payment/plugin/api/PaymentPluginApi.java>.

Java interface (`UUID` heavy, query-string `Iterable<PluginProperty>` for opaque gateway data):

```java
authorizePayment(kbAccountId, kbPaymentId, kbTransactionId, kbPaymentMethodId, amount, currency, properties, context)
capturePayment(...)
purchasePayment(...)
voidPayment(...)
creditPayment(...)
refundPayment(...)
getPaymentInfo(kbAccountId, kbPaymentId, properties, context)
searchPayments(searchKey, offset, limit, properties, context)
addPaymentMethod(kbAccountId, kbPaymentMethodId, paymentMethodProps, setDefault, properties, context)
deletePaymentMethod(...)
getPaymentMethodDetail(...)
setDefaultPaymentMethod(...)
getPaymentMethods(kbAccountId, refreshFromGateway, properties, context)
searchPaymentMethods(searchKey, offset, limit, properties, context)
resetPaymentMethods(...)
buildFormDescriptor(kbAccountId, customFields, properties, context)  // Hosted Payment Page
processNotification(notification, properties, context)                 // webhook dispatcher
```

Plus the canonical state machine: <https://github.com/killbill/killbill/blob/master/payment/src/main/resources/org/killbill/billing/payment/PaymentStates.xml>. Each operation (`AUTHORIZE`, `CAPTURE`, `PURCHASE`, `REFUND`, `CREDIT`, `VOID`, `CHARGEBACK`) has its own five-state machine: `*_INIT → {SUCCESS | PENDING | FAILED | ERRORED}`. Results come back from the plugin as `PROCESSED | PENDING | ERROR | CANCELED | UNDEFINED`. Transactions stay in `PENDING`/`UNKNOWN` until the Janitor polls `getPaymentInfo` or the provider calls back; the Janitor runs on `5m,1h,1d,1d,1d,1d,1d` for unknown and `1h,1d` for pending by default.

The hosted-payment-page flow as Kill Bill models it is also reusable — `buildFormDescriptor` returns either form fields (`Sum`, `cmd`, `hosted_button_id`) or a redirect URL. Flo's QR provider returns `pending` with a payload that the cashier renders, which is the same idea.

Sources: <https://docs.killbill.io/latest/userguide_payment.html>, <https://docs.killbill.io/latest/payment_plugin.html>.

For Flo: borrow the `getPaymentInfo` + Janitor pattern as the local reconciler for `pending` transactions when the webhook never arrives. Flo doesn't need a Janitor at restaurant scale today, but the abstract pattern (poll the provider when a payment is stuck) is worth documenting in the connector contract.

### 1.6 Stripe — PaymentIntent + Connect account onboarding

Docs: <https://docs.stripe.com/api/payment_intents> (object: <https://docs.stripe.com/api/payment_intents/object>), PaymentMethod object: <https://docs.stripe.com/api/payment_methods/object>.

Webhook registration is per-account: <https://docs.stripe.com/webhooks>. Connect allows a platform to listen on behalf of multiple connected accounts by setting `event_destinations` scope to "Connected accounts"; the webhook payload includes an `account` field identifying which connected account fired it. Stripe event destinations are persisted server-side and may point at AWS EventBridge or Azure Event Grid rather than a vendor's HTTPS endpoint.

PaymentIntent lifecycle (cleanest abstraction in the industry):

```
requires_payment_method
  → requires_confirmation
  → requires_action (3DS, bank auth, etc.)
  → processing
  → succeeded | requires_payment_method (failed)
```

For Flo: nothing to copy in shape — Stripe's domain is richer than Flo's needs — but Stripe's "events as durable objects with idempotency keys" is the right answer when Flo's broker eventually needs replay.

### 1.7 Stripe Apps — manifest + signed remote functions

Docs: <https://docs.stripe.com/extensions/how-extensions-work>, <https://docs.stripe.com/stripe-apps/reference/app-manifest>, <https://docs.stripe.com/stripe-apps/build-backend>.

Manifest fields:

```yaml
id: com.example.app
version: 1.2.3
name: Example App
icon: ./example_icon_32.png
permissions:
  - permission: event_read
    purpose: Read webhook event data
  - permission: payment_intent_read
  - permission: setup_intent_read
stripe_version: 2024-06-20
```

Three implementation types at an extension point: Script (managed runtime), Remote Function (signed HTTP on your infra), UI Extension (React in Dashboard). Permissions are declared per resource (`subscription_read`, `webhook_write`, etc.).

For Flo: this is the precedent for the **broker-side manifest**. Flo should store the same metadata on its own side:

```yaml
id: flo.ar.mercadopago.qr
version: 1.0.0
countries: [AR]
capabilities: [payment.qr, payment.status]
auth: relay-hmac
events:
  - mp.payment.created
  - mp.payment.approved
  - mp.payment.refunded
```

The existing `main/integrations/registry/types.ts` `IntegrationBundle` and `PaymentProvider` types are a coarser version of this. The Stripe pattern adds per-event subscription lists and per-capability permission flags. Most relevant for Flo's hosted delivery broker; less relevant for the local projection.

### 1.8 Shopify POS UI extensions + payments apps

Docs: <https://shopify.dev/docs/apps/build/pos>, <https://shopify.dev/docs/apps/build/payments>.

Shopify POS extensions are not gateway adapters — they are React/Polaris targets inside the Shopify POS UI (`pos.home.tile.render`, `pos.product-details.block.render`, etc.) with reactive target APIs and component web components. Payments apps are a separate, gated tier: only approved Shopify Partners can build them, and they require OAuth, an installation URL, a configuration page on the partner side, a `markReady` call, and merchant activation. Supported operations: `Charge`, `Refund`, `Authorize`, `Capture`, `Void`. Offsite, alternative-payment, credit-card, custom credit-card, and redeemable variants exist.

For Flo: not a direct precedent for local plugin shape, but the **approval-and-onboarding flow** and the **`markReady` activation flag** mirror what Flo's broker needs to do before a connector becomes callable from the POS. Shopify stores connection config on the partner's side, exposes it back via API, and only flips on the merchant side after a readiness call. Flo should plan for the same shape when onboarding a new delivery provider.

### 1.9 WooCommerce — `WC_Payment_Gateway` abstract class

Docs: <https://developer.woocommerce.com/docs/features/payments/payment-gateway-api>.

```php
abstract class WC_Payment_Gateway {
  public $id;
  public $icon;
  public $has_fields;             // direct integration that renders on checkout
  public $method_title;          // admin-facing
  public $method_description;    // admin-facing
  public $title;                 // checkout-facing
  public $description;
  public $form_fields;           // settings page

  init_form_fields();
  init_settings();               // load $form_fields into the option store

  // Required in subclass:
  function process_payment($order_id) {
    // return ['result' => 'success'|'failure', 'redirect' => $this->get_return_url($order)]
  }

  // Optional direct-gateway:
  function payment_fields();
  function validate_fields();
}
```

Settings: `$this->form_fields = ['enabled' => ['type' => 'checkbox', 'default' => 'yes'], ...]`. Callbacks: `?wc-api=WC_Gateway_Paypal` route, hooked via `add_action('woocommerce_api_'.$this->id, ...)`. Offline (cheque), form-based (PayPal Standard), iFrame (SagePay Form), and Direct (PayPal Pro, Authorize.net AIM) variants all sit on the same class.

For Flo: Woo's separation of admin-facing (`method_title`, `method_description`) vs. checkout-facing (`title`, `description`) is a useful distinction Flo's `label: { en, es }` doesn't make yet, and would help for ARCA / Mercado Pago where the merchant-facing description ("requires CUIT") differs from the customer-facing label.

### 1.10 Sylius — payment method model + gateway config

Interface: <https://github.com/Sylius/Sylius/blob/2.3/src/Sylius/Component/Payment/Model/PaymentMethodInterface.php>.

```php
interface PaymentMethodInterface extends
    CodeAwareInterface,      // 'stripe', 'cash_on_delivery'
    ResourceInterface,
    TimestampableInterface,
    ToggleableInterface,     // enabled/disabled
    TranslatableInterface
```

Gateway factories are Symfony services implementing `PaymentGatewayFactoryInterface`; the gateway configuration object carries the connection params for that specific merchant's account.

Source: <https://docs.sylius.com/latest/en/customization/payment.html> (currently redirects; mirror at <https://old-docs.sylius.com/en/customization/payment>).

For Flo: the `Toggleable` flag is the missing piece — Flo currently checks `paymentProvidersFor(country)` but doesn't expose a per-merchant enable/disable switch. Adding `enabled: boolean` to `PaymentProvider` settings would let a merchant disable a connector without uninstalling.

### 1.11 Odoo — terminal/provider modules, fiscal localization

Docs: <https://www.odoo.com/documentation/18.0/applications/finance/accounting/taxes.html>, <https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/payment_methods.html>.

POS `payment.method` records declare:

- `journal_id` — the accounting journal
- `company_id` — owning company
- `use_payment_terminal` — flag to integrate a connected terminal (Adyen, Ingenico, Mercado Pago, Pine Labs, Razorpay, SIX, Stripe, Tyro, Viva.com, Worldline)
- For India: `payment_provider = razorpay`, QR code payments module available

Terminal integration uses the IoT box (<https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/configuration/pos_iot.html>), which is its own host separate from the POS. Local HTTPS with self-signed cert on the LAN. Receipts/invoices are unified with the accounting module, which handles the fiscal/electronic invoice side.

Per-country fiscal localizations live as modules: <https://github.com/odoo/odoo/tree/18.0/addons/l10n_ar>, <https://github.com/odoo/odoo/tree/18.0/addons/l10n_in>, etc. Each module adds:

- country-specific tax structures (Argentina: `IVA`, perceptions, IIBB; India: GST with CGST/SGST/IGST split)
- invoice numbering sequences
- electronic invoice document types (`FACTURA_A/B/C`)
- withholding rules

For Flo: Odoo's terminal integration via IoT box is the same architectural split Flo wants — device-side terminal code in a separate host, POS talking to it. The `l10n_*` modules are the precedent for "fiscal localization = a self-contained module that adds taxes + invoice documents + withholding". Flo's `ar_arca.plugin.ts` + `ar_iva.plugin.ts` + `in_gst.plugin.ts` map directly to Odoo's `l10n_ar` and `l10n_in` modules. Worth naming them `l10n_ar`/`l10n_in` for future inventory clarity.

---

## 2. Tax/fiscal engine patterns

### 2.1 Odoo fiscal localizations

Already covered above. India localization in Odoo: <https://github.com/odoo/odoo/tree/18.0/addons/l10n_in>. Handles CGST/SGST/IGST split, HSN codes, GST return computation, e-invoicing via ClearTax/IRIS. The module structure — `__manifest__.py` declaring `depends`, `data` (XML for tax records, HSN master), and view templates — is what Flo's tax plugins should mimic in shape, not in tooling.

### 2.2 ERPNext — India compliance

ERPNext is India-first; the country package model is similar to Odoo's `l10n_*`.

- India regional docs: <https://docs.frappe.io/erpnext/user/manual/en/regional/india>
- Tax template engine: <https://github.com/frappe/erpnext/tree/develop/erpnext/regional/india>
- GST compute uses `GSTSettings`, `HSN Code` doctype, `GSTIN` validation, and state-code tables. ITC reconciliation and GSTR-1/3B return templates ship with the package.
- E-invoicing (`e_invoice` API integration) is opt-in via the GSP credentials screen; the implementation delegates the IRP signing to ClearTax or the government's sandbox.

For Flo: ERPNext's `HSN Code` doctype is the cleanest country-specific implementation of "tax rate per product category". Flo's `in_gst.plugin.ts` already reads `product.hsn_code`; the precedent confirms that path. The e-invoice GSP delegation pattern (ClearTax/IRIS/Masters India) is exactly what Flo's plugin comment already says — "extract to a separate InvoiceProvider like `in_irn.plugin.ts`".

### 2.3 Kill Bill — Aviate Tax

<https://docs.killbill.io/latest/aviate-tax.html>. Aviate Tax is a premium Kill Bill module that wraps Avalara for US sales tax and provides pluggable country-specific tax calculators. The plugin model is the same PaymentPluginApi shape: plug in a custom `TaxCalculator` and the core calls it.

For Flo: less applicable since Flo doesn't need a subscription billing engine, but the principle — "core has a `TaxCalculator` extension point; country plugins register a calculator; the same plugin handles withholding and reverse charge" — applies.

### 2.4 Saleor — tax events

<https://docs.saleor.io/developer/extending/webhooks/synchronous-events/tax>. Saleor exposes synchronous tax webhooks (`ORDER_CALCULATE_TAXES`, `CHECKOUT_CALCULATE_TAXES`, `SHIPPING_LIST_TAXES_FOR_CHECKOUT`, etc.) so an App can return a calculated tax payload back to the core. Tax type modes: `inclusive | exclusive | no_tax`.

For Flo: Saleor proves that synchronous-request tax calculation is a real pattern at scale. Flo's `TaxEngine.compute(req)` is synchronous too; the relevant point is that the Saleor doc frames tax calculation as a "give the app 30 seconds to respond" service, not a local function. If Flo's hosted broker also wants to expose a tax provider for jurisdictions Flo doesn't first-party, mirroring Saleor's synchronous-webhook shape would let third parties add their own tax engine without forking Flo.

---

## 3. Delivery/order platform connectors

### 3.1 Odoo — Delivery carriers and Amazon/Shopee connectors

Docs: <https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/shipping_receiving/setup_configuration.html>. Listing: <https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/shipping_receiving/third_party_shipper.html>.

Active delivery carriers in Odoo 18: Bpost, DHL, EasyPost, Envia.com, FedEx, Sendcloud, Shiprocket, Starship, UPS, USPS, Zebra. Each ships as a separate module that implements `delivery.carrier`. Carrier selection is per company; it persists with the sales order; tracking numbers are written back into the picking module.

Connector shapes: `bpost_rest`, `dhl_rest`, `easypost_rest`, etc. Each one wraps a REST API, has its own settings, and exposes a `delivery.carrier` record. Default fallback `fixed_price` carrier for local deliveries and `no_carrier` for in-store pickup.

For Flo: Odoo's "per-carrier module + per-carrier settings + `delivery.carrier` model" matches Flo's intent. The specific precedent is that each carrier is treated as data (`delivery.carrier` rows with config) rather than as code in a registry. Flo's current `deliveryAdapters` are code-only; an alternative design would have `delivery_carriers` rows with `plugin_id` references and per-merchant credential rows. Probably overkill at Flo's size, but worth knowing the pattern.

Amazon Connector and Shopee Connector for online ordering: <https://www.odoo.com/documentation/18.0/applications/sales/sales/amazon_connector/features.html>, <https://www.odoo.com/documentation/18.0/applications/sales/shopee_connector.html>. These handle the same "third party sends orders, we send status back" loop as Uber Eats / PedidosYa. The Odoo connectors poll (no public webhook), which is a less robust design than Flo's intended broker-relay; document the polling fallback in the broker requirements.

### 3.2 ERPNext — Delivery and integration broker

ERPNext uses a `Delivery Trip`, `Delivery Note`, and `Customer` flow with per-transporter integration. Their marketplace pattern runs through Frappe's `hooks.py` and `doctype_<name>_events.py` model — Decoupled event listeners via `frappe.async` and `frappe.publish_realtime` for websocket-style delivery. Integrations are node modules under `apps/<x>/<x>/integrations/`.

For Flo: less directly relevant. The principle to copy is that webhook→state mapping is a separate concern from payment and tax integration, and should live in its own module.

### 3.3 Shopify POS as a delivery/proxy model

Shopify POS UI extensions sit at the POS surface; data flows between the extension and Shopify POS via the Admin API and the POS websocket. The closest analog in Shopify's docs is the "order routing" feature where order data crosses from one app to another via Order Routing API. The relay pattern is essentially "POST to a partner URL with HMAC, receive the next-state callback over the same URL". Shopify doesn't have a hosted broker out of the box but the extension model is similar in spirit.

For Flo: nothing new — Shopify is closed infrastructure; the lesson is what NOT to copy (no per-app arbitrary URL handling, broker should retain auth/identity).

### 3.4 Vendor-specific delivery platform docs

- Uber Eats: <https://developer.uber.com/docs/eats/guides/webhooks> and <https://developer.uber.com/docs/eats/guides/order_integration> — synchronous `accept/deny` within a strict SLA window, plus `ready_for_pickup`, `courier_confirmed`, `delivery_failed`. HMAC-SHA256 over raw body using a per-store client secret.
- PedidosYa: <https://developer.pedidosya.com/api-specifications> — webhooks are signed with per-store shared HMAC; acknowledge fast and act asynchronously; merchant exposes ready/dispatched/cancel states.
- Zomato POS: <https://www.zomato.com/developer/integration/> — POS integration model with order webhook + order-state pushback.

For Flo: the exploratory delivery sketches point toward this shape, but they are not production contracts. The important borrow is the formal SLA timer capture in the broker (Uber and PedidosYa impose short acknowledgement windows).

---

## 4. Country-scoped capabilities

The closest precedent across the studied systems is Odoo's `l10n_*` modules. Each one is a country-scoped bundle that:

- ships tax records and tax computation hooks
- ships invoice/document templates
- ships withholding, transfer pricing, and e-invoice modules where applicable
- depends on `account`, `product`, `partner` core modules — the contracts those modules expose are the "global core capabilities"
- declares its dependencies in `__manifest__.py` so the OS can install the country-specific add-on only when the company's fiscal country matches

Saleor takes a different route: tax hooks are App-managed via webhooks; countries aren't a first-class concept but `Channel.currencyCode` plus store country drives the calculation. Country-specific tax compliance is delegated to whoever operates the App.

Kill Bill: no country concept baked in; multi-currency and tax happen at the tenant and account level; regional rules are plug-in concerns.

Medusa: regions are first-class records (`Region`), each with countries and currency; store settings attach to the region. Payment providers and tax providers are registered per region via the Admin API. The `medusa-config.ts` is global; per-region enablement is a runtime concern.

The right model for Flo is closest to Odoo's `l10n_*` because country matters for both tax and invoice and POS data (phone format, dial code, locale, tax id label, currency). Flo already has a country registry at `main/countries.ts` and country-scoped plugins (`countries: string[]` with `'*'` wildcard). This is fine; the only additions worth borrowing from Odoo are:

1. A "bundle" that groups IVA + ARCA + Mercado Pago + PedidosYa as one install (Flo already has `IntegrationBundle` in `registry/types.ts:132`).
2. A `__manifest__.py`-style declaration that lists which settings schemas and which core capabilities the bundle adds.

Flo applies this model to tax selection: startup and first-run setup activate the matching built-in `country.<iso>` tax package, falling back to a global generic package only when no country package exists. Country exceptions stay in country packages; the global fallback never carries country-specific rules.

The same boundary applies to tax, fiscal invoices, payments, and delivery: these are package capabilities rather than core country/provider branches. A default package remains a normal plugin, so dedicated country packages can replace capabilities without expanding Flo core.

## 5. Hosted webhook/broker patterns

### 5.1 Saleor App + subscription webhook

<https://docs.saleor.io/developer/extending/webhooks/overview>, <https://docs.saleor.io/developer/extending/webhooks/subscription-webhook-payloads>.

Saleor sends a webhook for each subscribed event. The payload includes the event metadata plus the GraphQL query result. Apps return a synchronous response when the webhook type is `synchronous` (`*_REQUEST`, `*_SESSION`, etc.) or `2xx` when the type is `asynchronous` (delivery, customer updated).

Flo's broker should adopt the same distinction:

- **Synchronous extension-point webhooks** for the local core asking the broker a question ("please resolve this transaction").
- **Asynchronous events** for the broker delivering normalized provider events to the core.

Saleor's signature scheme (per-app HMAC with the dashboard-stored secret) is a sound model. Flo's `__relay__` shared-secret idea should grow per-merchant secrets.

### 5.2 Stripe Connect event destinations

<https://docs.stripe.com/webhooks>, <https://docs.stripe.com/api/webhook_endpoints>.

A Stripe platform can register up to 16 webhook endpoints per account, each scoped to a list of events. Event destinations may forward to AWS EventBridge or Azure Event Grid instead of an HTTPS endpoint — durable delivery via the cloud's queue, not Flo's.

For Flo: the alternative-destinations concept is useful when describing "what do we run in front of Flo when the broker sees traffic". A queued event bus plus a worker that fans out to merchants is one path; a Slack/PagerDuty-style alert destination is another. Don't write the alert path yet.

### 5.3 Slack Socket Mode

<https://docs.slack.dev/apis/events-api/using-socket-mode>. The precedent Flo's discovery doc already cites: an authorized outbound WebSocket from the desktop serves the broker, with no inbound listener. Reuse the Socket Mode framing in the broker design.

### 5.4 hook-relay (open-source reference)

<https://github.com/itkq/hook-relay> is the minimum-viable relay: an HTTP server that receives webhooks and forwards them over WebSocket to subscribers, with HMAC-signed reconnect. Useful as a starting point — but lacks durable storage, per-merchant routing, idempotency, and retries. The Flo broker must add all four.

### 5.5 Odoo webhook-like patterns

Odoo uses long polling plus Server-Sent Events on its live chat module. Webhooks for delivery carriers go through the IoT box or directly from the carrier to Odoo's ingest endpoint. Marketplace apps register webhook URLs in their `__manifest__.py`. Less useful as a precedent than Saleor/Stripe.

## 6. POS-specific references

These are the closest open-source POS projects in shape to Flo.

- **Odoo POS** (`addons/point_of_sale/`, ~130k LoC JavaScript + Python): richest precedent for country-scoped POS tax logic, payment terminal integration, IoT-box intermediary, fiscal localization, restaurant features (split bills, course management). Already referenced above.
- **Flo's restaurant feature** (`frontend/src/app/restaurant/*`) overlaps Odoo POS's restaurant module but at a tighter scope.
- **Chromispos / Unicenta**: legacy Java POS that did country tax plugins through an extension model; mostly dead upstream but documents the pattern of "tax is an extension, the POS core never knows about specific countries". Worth a quick code skim only if you want historical grounding.
- **uniCenta oPOS** and **Floreant POS**: similar Java POS projects; Floreant has a fork in the wild that supports India GST with split tax lines, worth grepping for `SGST` and `CGST` if India hits edge cases.
- **Stripe Terminal SDK** (`https://stripe.com/docs/terminal`): not open source but the SDK model for terminal integration is what Odoo's IoT box and Mercado Pago's Point imitate. Flo's `qr.plugin.ts` is closest in shape to a Terminal app that produces a code the user scans.

## 7. Comparison summary

| Concern | Flo today | Saleor | Medusa | Vendure | Kill Bill | Stripe Apps | WooCommerce | Odoo | Shopify POS | Recommendation |
|---|---|---|---|---|---|---|---|---|---|---|
| Payment provider interface | `PaymentProvider` | `IPaymentProvider`/`App SDK` | `IPaymentProvider` (Awilix DI) | `PaymentMethodHandler` (config object) | `PaymentPluginApi` (Java methods) | Extension points + Script/Remote | `WC_Payment_Gateway` (abstract class) | `payment.method` + terminal modules | Payments App (gated, OAuth) | Flo's shape matches Vendure and Saleor's class-based shape; consider Medusa's `getWebhookActionAndData` |
| Two-step flow (authorize→capture) | Implicit (`pending|done|failed`) | First-class | First-class (`authorizePayment`/`capturePayment`) | First-class | First-class (state machine XML) | N/A | `process_payment`/`capture` flow | Per terminal module | Via `Authorize`+`Capture` ops | Don't pre-split; copy Saleor + Kill Bill state vocab when needed |
| Async provider callbacks | `handleWebhook` on provider | `transactionEventReport` mutation (push) | `getWebhookActionAndData` (poll) | `PaymentMethodHandler` + `Webhook` events | `processNotification` + Janitor poll | Webhook subscription + signed remote function | `wc-api` callback | Per-terminal | Subscription webhook | Saleor `transactionEventReport` is the cleanest broker→core model |
| Country scoping | `countries: string[]` + `'*'` | Per-channel | Per-region | Per-tenant | Per-tenant | N/A | Per-store | `l10n_*` modules | Per-market/country | Flo's shape is fine; borrow Odoo's `l10n_*` module manifest |
| Eligibility check | Country only | Currency + amount (in webhook filters) | Per-region enablement | `PaymentMethodEligibilityChecker` | Per-tenant | N/A | Settings page filter | Per company | Per channel | Add `eligibility_checker` to PaymentProvider when needed |
| Tax engine | `TaxEngine.compute(req)` | Sync webhook + saleor-tax plugin | `TaxProvider` (Stripe Tax-like) | Tax calculator strategy | Aviate Tax (premium) | Tax app | Per-tax-class rows | `l10n_*` tax records | Sync to external | Flo's shape is consistent; Saleor's webhook shape is the move if tax ever moves to hosted |
| Fiscal invoice provider | `InvoiceProvider.issue(req)` | Saleor Apps + doc types | N/A | Per-region | Aviate + per-country | Invoice object | N/A | `l10n_*` invoice modules | Order/invoice surfaces | Odoo is the richest precedent for invoice format, document types, and per-country; copy `l10n_<iso>` naming |
| Delivery adapter | `DeliveryAdapter.parseIncomingOrder`/accept/deny/ready/dispatched | N/A (channel-app model) | `FulfillmentProvider` | `ShippingMethodHandler` | N/A | Shipper App | `shipping_method` plugin | `delivery.carrier` record per carrier | Shipper app | Flo's shape is consistent; Odoo's polling fallback is the safety net behind the broker |
| Hosted webhook ingress (URL per partner) | No POS webhook; broker-owned or approved hosted connector | Per app subscription | N/A | N/A | N/A | Per-app endpoint + event destinations | Per-gateway `wc-api` URL | Per-app webhook | Per-app public URL | Broker owns URLs; per-merchant HMAC + per-connector route is the right shape |
| Settings persistence | `plugin:<id>:<key>` in `settings` table | GraphQL rows in app's table | `ProviderOptions` in DB | `args` typed config | Plugin props (query strings) | App manifest + APL | `update_option` | `ir.config_parameter` | App settings in partner DB | Flo's flat namespacing is fine; rename to `l10n_*`-style bundles when there are 3+ countries |
| Synchronous IPC for extension requests | Not implemented | Synchronous webhooks | Awilix DI | Services + DI | Plugin Java interface (sync) | Scripts on Stripe runtime | WP action/filter | Longpolling/IoT box | Realtime target APIs | Saleor synchronous webhooks are the closest analog for the broker↔core link |
| Manifest | Implicit in TS types | `stripe-app.yaml`/App manifest | `medusa-config.ts` + `ModuleProvider` | `paymentOptions.paymentMethodHandlers` array | OSGi-style plugin metadata | Stripe app manifest | Plugin header + class registration | `__manifest__.py` | TOML config | Borrow Stripe app manifest shape verbatim; TS-port it |

## 8. Recommendation — what Flo should borrow, in priority order

P0 — copies that fit the existing scaffold with no new infrastructure:

1. **Adopt Saleor's `TransactionEventTypeEnum` vocabulary** for the `ChargeResult.status` field. Rename `pending | action_required | done | failed` to `CHARGE_REQUEST | CHARGE_ACTION_REQUIRED | CHARGE_SUCCESS | CHARGE_FAILURE` when flowing through the broker. Keeps Flo coherent with the largest existing transaction-system peer and removes translator code if Flo ever interoperates with Saleor as the back office.

2. **Borrow Kill Bill's `getPaymentInfo` contract** as the reconciler hook for any payment stuck in `pending` longer than the broker SLA. Flo doesn't need a Janitor daemon in v1; defining the method is enough to prevent stuck payments from being a permanent state. Document it on `PaymentProvider`.

3. **Add `pspReference` and `idempotencyKey` to every transaction record** Flo already passes to providers. Saleor, Kill Bill, Stripe, and Medusa all insist on this. Flo's `ChargeRequest.idempotencyKey` already exists; ensure it is the only `billId`→`txn` key and is opaque to providers.

4. **Mirror Stripe App manifest fields** at the broker level. Broker config currently identity-less; add `id`, `version`, `countries`, `capabilities`, `auth: relay-hmac|hmac-sha256|...`, `events: [...]`, `permissions: [...]`. This is a manifest, not a code change.

P1 — additions when the first country hits ARCA + 3DS-styled flows:

5. **Split `charge()` into `initiate|authorize|capture|void|refund|credit|voidCredit|getInfo`** only when a real provider requires it. Do not pre-split — Vendure's `PaymentMethodHandler` shows it's easy to add when one provider needs it.

6. **Add an `eligibility_checker` to `PaymentProvider`** when leaving country-only scoping. Adapted from Vendure's `PaymentMethodEligibilityChecker`. Lets `in_gst` decline HSN-not-found lines, etc.

7. **Adopt Odoo's `l10n_<iso>` naming** for the country bundles. Rename `ar_arca.plugin` + `ar_iva.plugin` to a `l10n_ar` directory containing both, with a single entry point. Same for `l10n_in` (gst + irn + esugam when esugam arrives).

P2 — when the broker lands:

8. **Saleor synchronous-webhook shape for the broker↔core link.** The desktop maintains one WebSocket; the broker uses synchronous extension-point callbacks only when the local core asks a question. Asynchronous provider events are queued and re-emitted as normal events.

9. **Per-merchant HMAC + per-connector route prefix** at the broker. The URL includes the merchant id (`/integrations/<connector>/<merchantId>`); the POS is never the provider-facing endpoint.

10. **Durable event store with replay** behind the broker. Saleor's idempotency-key dedup and Stripe's event-id dedup both apply. Don't pick a queue before knowing whether the broker is going to be a Spring/Java service (Kill Bill-shaped) or a Node service (Flo-shaped).

## 9. References, collected

Saleor:
- Transaction API — <https://docs.saleor.io/developer/payments/transactions>
- Transaction webhooks — <https://docs.saleor.io/developer/extending/webhooks/synchronous-events/transaction>
- App SDK overview — <https://docs.saleor.io/developer/extending/apps/overview>
- Payment App tutorial — <https://docs.saleor.io/developer/extending/apps/building-payment-app>
- Legacy gateway plugin (deprecated) — <https://docs.saleor.io/developer/extending/plugins/payment-gateways>
- Tax webhooks — <https://docs.saleor.io/developer/extending/webhooks/synchronous-events/tax>
- `TransactionEvent` object — <https://docs.saleor.io/api-reference/payments/objects/transaction-event>

Medusa:
- `IPaymentProvider` interface — <https://github.com/medusajs/medusa/blob/v2.13.6/www/apps/resources/references/types/interfaces/types.IPaymentProvider/page.mdx>
- `PaymentProviderService` — <https://github.com/medusajs/medusa/blob/develop/packages/modules/payment/src/services/payment-provider.ts>
- `medusa-payment-manual` (placeholder reference) — <https://medusajs.com/integrations/medusajs-payment/>
- Module provider docs — <https://docs.medusajs.com/resources/references/payment/provider>

Vendure:
- Payment guide — <https://docs.vendure.io/guides/core-concepts/payment/>
- `PaymentMethodHandler` reference — <https://docs.vendure.io/core/reference/typescript-api/payment/payment-method-handler/>
- Community plugins index — <https://github.com/vendurehq/community-plugins>

Kill Bill:
- Payment guide — <https://docs.killbill.io/latest/userguide_payment.html>
- Payment plugin contract (Java) — <https://github.com/killbill/killbill-plugin-api/blob/master/payment/src/main/java/org/killbill/billing/payment/plugin/api/PaymentPluginApi.java>
- Payment state machine (XML) — <https://github.com/killbill/killbill/blob/master/payment/src/main/resources/org/killbill/billing/payment/PaymentStates.xml>
- AvaTax plugin — <https://docs.killbill.io/latest/avatax-plugin.html>
- Aviate Tax — <https://docs.killbill.io/latest/aviate-tax.html>

Stripe:
- PaymentIntents — <https://docs.stripe.com/api/payment_intents>
- PaymentMethods — <https://docs.stripe.com/api/payment_methods>
- Webhooks — <https://docs.stripe.com/webhooks>
- Apps manifest — <https://docs.stripe.com/stripe-apps/reference/app-manifest>
- How extensions work — <https://docs.stripe.com/extensions/how-extensions-work>
- App backend — <https://docs.stripe.com/stripe-apps/build-backend>
- Events list — <https://docs.stripe.com/stripe-apps/events>

WooCommerce:
- Payment gateway API — <https://developer.woocommerce.com/docs/features/payments/payment-gateway-api>
- Source: <https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/includes/abstracts/abstract-wc-payment-gateway.php>

Odoo:
- Taxes — <https://www.odoo.com/documentation/18.0/applications/finance/accounting/taxes.html>
- POS payment methods — <https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/payment_methods.html>
- POS payment terminals — <https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/payment_methods/terminals.html>
- POS IoT — <https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/configuration/pos_iot.html>
- Argentina localization — <https://github.com/odoo/odoo/tree/18.0/addons/l10n_ar>
- India localization — <https://github.com/odoo/odoo/tree/18.0/addons/l10n_in>
- Delivery carriers — <https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/shipping_receiving/setup_configuration.html>
- Amazon Connector — <https://www.odoo.com/documentation/18.0/applications/sales/sales/amazon_connector/features.html>

ERPNext/Frappe:
- India regional — <https://docs.frappe.io/erpnext/user/manual/en/regional/india>
- Source — <https://github.com/frappe/erpnext/tree/develop/erpnext/regional/india>

Sylius:
- `PaymentMethodInterface` — <https://github.com/Sylius/Sylius/blob/2.3/src/Sylius/Component/Payment/Model/PaymentMethodInterface.php>
- Payment customization — <https://docs.sylius.com/latest/en/customization/payment.html>

Shopify POS:
- POS UI extensions — <https://shopify.dev/docs/apps/build/pos>
- Payments extensions — <https://shopify.dev/docs/apps/build/payments>

Reference brokers / open-source relays:
- `hook-relay` — <https://github.com/itkq/hook-relay> (minimum-viable relay; not production-ready)
- Slack Socket Mode — <https://docs.slack.dev/apis/events-api/using-socket-mode> (outbound WebSocket framing)

Internal Flo references:
- Plugin contracts — `main/integrations/registry/types.ts`
- Plugin loader — `main/integrations/registry/loader.ts`
- Settings persistence — `main/integrations/registry/store.ts`
- Universal webhook receiver — `main/routes/webhooks.ts`
- Existing plugins: `main/integrations/payments/{cash,credit,debit,transfer,qr}.plugin.ts`, `main/integrations/tax/{in_gst,ar_iva,ar_arca}.plugin.ts`, `main/integrations/delivery/{manual,pedidosya,ubereats}.plugin.ts`
- Outbound cloud transport — `main/services/cloud-sync.ts` (reusable transport, not a plugin runtime)
- Plugin architecture discovery — `docs/plugin-architecture.md`
