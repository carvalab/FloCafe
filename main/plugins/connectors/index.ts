/**
 * Connector placeholders for Stage 1.
 *
 * Network calls are intentionally absent. Stage 3 (broker foundation)
 * wires the hosted broker; until then these exports are pure config
 * validators and summarizers. The merchant-facing API can still
 * truthfully say "configuration incomplete" / "not yet verified" without
 * pretending a connector exists.
 *
 * Exports the connector config handler registry: the route dispatches
 * to a handler by `capability.provider`, never by a hard-coded provider
 * string. New providers add a handler here, not a branch in routes.ts.
 */

export {
  validateDeliveryPollingConfig,
  summarizeDeliveryPolling,
  deliveryPollingHandlers,
  allDeliveryProviders,
  type DeliveryPollingConfig,
  type DeliveryPollingProviderConfig,
  type DeliveryPollingValidation,
} from './delivery-polling';

export { mercadoPagoConnectorHandler } from '../ar/mercado-pago';
