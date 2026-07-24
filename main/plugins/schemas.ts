/**
 * Backend aliases for the browser-safe shared plugin schemas.
 */

import {
  PluginRequestEnvelopeSchema,
  PluginResultEnvelopeSchema,
  PluginRuntimeBundleSchema,
} from './api-types';

export { PluginRequestEnvelopeSchema, PluginResultEnvelopeSchema, PluginRuntimeBundleSchema };

export function validatePluginRequestEnvelope(value: unknown): value is import('./api-types').PluginRequestEnvelope {
  return PluginRequestEnvelopeSchema.safeParse(value).success;
}

export function validatePluginResultEnvelope(value: unknown): value is import('./api-types').PluginResultEnvelope {
  return PluginResultEnvelopeSchema.safeParse(value).success;
}
