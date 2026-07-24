/**
 * Connector handler registry — the route layer's lookup table.
 *
 * Each plugin package may contribute handlers for its providers. The
 * route asks `getConnectorHandler(provider)` and calls the resulting
 * handler's `validate`/`summarize`. The route never branches on a
 * provider string and never knows what shape a provider's config takes.
 *
 * ponytail: this is the only place a provider name is allowed to appear
 * in the route layer. New providers add a row here, not an `if` in
 * routes.ts.
 */

import { mercadoPagoConnectorHandler } from './ar/mercado-pago';
import { deliveryPollingHandlers } from './connectors/delivery-polling';
import type { ConnectorConfigHandler } from './api-types';

const handlers: Record<string, ConnectorConfigHandler> = {
  [mercadoPagoConnectorHandler.provider]: mercadoPagoConnectorHandler,
  ...deliveryPollingHandlers,
};

export function getConnectorHandler(provider: string): ConnectorConfigHandler | undefined {
  return handlers[provider];
}

export function listConnectorHandlers(): ConnectorConfigHandler[] {
  return Object.values(handlers);
}

export function hasConnectorHandler(provider: string): boolean {
  return Object.prototype.hasOwnProperty.call(handlers, provider);
}
