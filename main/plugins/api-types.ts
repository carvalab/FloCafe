/**
 * Backend plugin API surface.
 *
 * The shared module owns both the browser-safe contract types and their Zod
 * schemas. Backend-only runtime envelope helpers remain in `schemas.ts`.
 */

export * from '../../shared/plugin-api';
