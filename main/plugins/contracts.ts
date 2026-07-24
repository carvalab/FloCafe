/**
 * Plugin contracts — re-exports the shared types and implements the
 * domain contracts (PaymentConnector, TaxEngine, FiscalDocumentProvider,
 * DeliveryConnector). The runtime implementations live in `main/plugins/<country>/`.
 * The `PluginRegistry` and `definePluginRuntimeBundle` helpers live in
 * `shared/plugin-api.ts` so the frontend can import them without
 * pulling in `better-sqlite3` or anything else Node-only.
 */

export {
  PluginRegistry,
  definePluginRuntimeBundle,
  isRuntimeCapabilityKind,
  RUNTIME_CAPABILITY_KINDS,
  validateManifest,
  type PluginRuntimeBundle,
  type FiscalIdentity,
  type Money,
  type CountryCode,
  type CurrencyCode,
  type ConnectorContext,
  type OperationResult,
  type PluginRequestEnvelope,
  type PluginResultEnvelope,
  type PaymentPrimitive,
  type PaymentCapability,
  type PaymentRequest,
  type PaymentReference,
  type PaymentConnector,
  type TaxLine,
  type TaxRequest,
  type TaxResult,
  type TaxEngine,
  type FiscalDocumentRequest,
  type FiscalDocumentResult,
  type FiscalDocumentProvider,
  type DeliveryOrder,
  type DeliveryEvent,
  type DeliveryCommand,
  type DeliveryConnector,
  type PluginEvent,
  type ConnectorCommand,
  type PluginRuntime,
  type ConnectorConfigHandler,
  type ConnectorConfigValidation,
} from './api-types';

export {
  validatePluginRequestEnvelope,
  validatePluginResultEnvelope,
  PluginRuntimeBundleSchema,
  PluginRequestEnvelopeSchema,
  PluginResultEnvelopeSchema,
} from './schemas';
