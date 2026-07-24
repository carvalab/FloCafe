// Re-exports the shared plugin API types so the frontend can derive
// its UI types from the same source of truth as the backend. The
// canonical types live in `shared/plugin-api.ts` and contain no
// server runtime imports. The UI types in `./types.ts` remain the
// primary surface for components that need to add UI-only fields
// (label, description, requirementReason).

export type {
  // Manifest and runtime shapes
  PluginManifest,
  PluginCapability,
  PluginCapabilityConfiguration,
  PluginConfigField,
  PaymentMethodDescriptor,
  PluginCapabilityExecution,
  PluginExecution,
  PluginScope,
  PluginPermission,
  PluginPublisher,
  HostedTopology,

  // Catalog
  CatalogListing,
  CatalogEntry,
  Installation,
  InstallationFeature,
  InstallationStatus,
  FeatureActivationStatus,
  ConnectorAccount,
  ConnectorReadinessStatus,
  ConfigurationStatus,

  // Contracts
  FiscalIdentity,
  Money,
  CountryCode,
  CurrencyCode,
  ConnectorContext,
  OperationResult,
  PaymentCapability,
  PaymentRequest,
  PaymentReference,
  PaymentConnector,
  TaxLine,
  TaxRequest,
  TaxResult,
  TaxEngine,
  FiscalDocumentRequest,
  FiscalDocumentResult,
  FiscalDocumentProvider,
  DeliveryOrder,
  DeliveryEvent,
  DeliveryCommand,
  DeliveryConnector,
  PluginRequestEnvelope,
  PluginResultEnvelope,
  PluginEvent,
  ConnectorCommand,
  PluginRuntime,
  PluginRuntimeBundle,

  // Validation
  ManifestValidationError,
  ManifestValidationResult,
} from '@flo-plugin-api';

export {
  PLUGIN_PERMISSIONS,
  validateManifest,
  isRuntimeCapabilityKind,
  RUNTIME_CAPABILITY_KINDS,
  PluginCatalogResponseSchema,
  PluginInstallationsResponseSchema,
} from '@flo-plugin-api';
