/**
 * Plugin system — public surface.
 *
 * Stage 1 in-repo only. Re-exports the registry, catalog, install
 * operations, the route handler, and the connector-handler registry.
 * Catalog and runtime registries load country manifests and
 * implementations through separate entry points.
 */

export * from './api-types';
export { validateManifest } from './manifest';
export * from './schemas';
export { getAllPackages, getPackageById, registerPackage } from './registry';
export {
  getCatalog,
  getCatalogEntry,
  getStoreCountry,
  isListingAvailableForCountry,
} from './catalog';
export {
  installPackage,
  uninstallPackage,
  setInstallationStatus,
  setFeatureStatus,
  upsertConnectorAccount,
  getInstallation,
  listFeatures,
  listConnectorAccounts,
  listInstallations,
  findInstallationByPackageId,
} from './installations';
export { pluginRoutes } from './routes';
export { getConnectorHandler, listConnectorHandlers, hasConnectorHandler } from './connector-handlers';
