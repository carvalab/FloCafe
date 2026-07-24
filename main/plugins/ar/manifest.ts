import { PluginCapabilityKind, PluginPermission, type PluginManifest } from '../api-types';

export const AR_MANIFEST = {
  manifestVersion: 1,
  id: 'country.ar',
  version: '1.0.0',
  publisher: { id: 'flo-verified', name: 'Flo' },
  displayName: { en: 'Argentina operations', es: 'Operaciones de Argentina' },
  scope: 'country',
  countries: ['AR'],
  floApiVersion: '>=1.0.0 <2.0.0',
  execution: ['in_process', 'hosted'],
  capabilities: [
    // The only in-process capability: the local AR IVA tax engine that
    // runs synchronously inside the order/bill transaction. Everything
    // else is declared as `hosted` because provider API calls, OAuth,
    // and webhook verification live in the Stage 3 broker.
    { id: 'tax.iva', kind: PluginCapabilityKind.Tax, execution: 'in_process', provider: 'ar_iva', operations: ['calculate'], displayName: { en: 'IVA calculation', es: 'Cálculo de IVA' }, description: { en: 'Calculate Argentine IVA lines using the country tax package.', es: 'Calcula líneas de IVA argentino usando el paquete fiscal del país.' } },
    { id: 'fiscal.arca', kind: PluginCapabilityKind.Fiscal, execution: 'hosted', provider: 'arca', operations: ['issue', 'retry', 'cancel'], displayName: { en: 'ARCA electronic invoicing', es: 'Facturación electrónica ARCA' }, description: { en: 'Prepare the ARCA fiscal document workflow for a hosted connector.', es: 'Prepara el flujo de documentos fiscales ARCA para un conector alojado.' } },
    { id: 'payment.mercado_pago_qr', kind: PluginCapabilityKind.Payment, execution: 'hosted', primitive: 'qr', provider: 'mercado_pago', operations: ['initialize', 'status', 'refund'], displayName: { en: 'Mercado Pago QR', es: 'QR de Mercado Pago' }, description: { en: 'Configure Mercado Pago QR payments for this store.', es: 'Configura pagos QR de Mercado Pago para esta tienda.' }, configuration: { provider: 'mercado_pago', fields: [
      { name: 'storeId', kind: 'text', required: true, label: { en: 'Store ID', es: 'ID de tienda' } },
      { name: 'externalPosId', kind: 'text', required: true, label: { en: 'Point of sale ID', es: 'ID del punto de venta' } },
      { name: 'qrMode', kind: 'select', required: true, label: { en: 'QR mode', es: 'Modo QR' }, options: [
        { value: 'dynamic', label: { en: 'Dynamic', es: 'Dinámico' } },
        { value: 'static', label: { en: 'Static', es: 'Estático' } },
        { value: 'hybrid', label: { en: 'Hybrid', es: 'Híbrido' } },
      ] },
    ] } },
    { id: 'delivery.pedidosya', kind: PluginCapabilityKind.Delivery, execution: 'hosted', provider: 'pedidosya', operations: ['receive_order', 'accept', 'deny', 'ready', 'cancel'], displayName: { en: 'PedidosYa', es: 'PedidosYa' }, description: { en: 'Configure order polling and lifecycle commands for PedidosYa.', es: 'Configura la consulta de pedidos y comandos de ciclo de vida para PedidosYa.' }, configuration: { provider: 'pedidosya', fields: [{ name: 'intervalSeconds', kind: 'number', required: true, min: 15, max: 3600, step: 1, label: { en: 'Polling interval', es: 'Intervalo de consulta' }, suffix: { en: 'seconds', es: 'segundos' } }] } },
    { id: 'delivery.rappi', kind: PluginCapabilityKind.Delivery, execution: 'hosted', provider: 'rappi', operations: ['receive_order', 'accept', 'deny', 'ready', 'cancel'], displayName: { en: 'Rappi', es: 'Rappi' }, description: { en: 'Configure order polling and lifecycle commands for Rappi.', es: 'Configura la consulta de pedidos y comandos de ciclo de vida para Rappi.' }, configuration: { provider: 'rappi', fields: [{ name: 'intervalSeconds', kind: 'number', required: true, min: 15, max: 3600, step: 1, label: { en: 'Polling interval', es: 'Intervalo de consulta' }, suffix: { en: 'seconds', es: 'segundos' } }] } },
  ],
  permissions: [
    PluginPermission.SettingsRead,
    PluginPermission.SettingsWrite,
    PluginPermission.PaymentWrite,
    PluginPermission.FiscalWrite,
    PluginPermission.DeliveryEvents,
    PluginPermission.BrokerConnect,
  ],
  connectorIds: ['arca', 'mercado_pago', 'pedidosya', 'rappi'],
  hosted: { allowedOutboundHosts: ['api.mercadopago.com', 'api.pedidosya.example'], healthEndpoint: '/health' },
  artifact: { digest: 'sha256:stage1-ar-inrepo-no-remote-artifact', signature: 'stage1-in-repo' },
} satisfies PluginManifest;
