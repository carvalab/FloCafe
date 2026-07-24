import { PluginCapabilityKind, PluginPermission, type PluginManifest } from '../api-types';

export const IN_MANIFEST = {
  manifestVersion: 1,
  id: 'country.in',
  version: '1.0.0',
  publisher: { id: 'flo-verified', name: 'Flo' },
  displayName: { en: 'India operations' },
  scope: 'country',
  countries: ['IN'],
  floApiVersion: '>=1.0.0 <2.0.0',
  execution: ['in_process', 'hosted'],
  capabilities: [
    // The only in-process capability: the local India GST tax engine.
    // The fiscal invoice provider (GSTN/IRN) is a separate capability
    // and stays `hosted` — fiscal authorization is not tax math.
    { id: 'tax.gst', kind: PluginCapabilityKind.Tax, execution: 'in_process', provider: 'india_gst', operations: ['calculate'], displayName: { en: 'GST calculation', es: 'Cálculo de GST' }, description: { en: 'Calculate CGST, SGST, and IGST using the India tax package.', es: 'Calcula CGST, SGST e IGST usando el paquete fiscal de India.' } },
    { id: 'fiscal.gst_invoice', kind: PluginCapabilityKind.Fiscal, execution: 'hosted', provider: 'gstn', operations: ['issue', 'retry', 'cancel'], displayName: { en: 'GST invoicing', es: 'Facturación GST' }, description: { en: 'Prepare the India GST invoice workflow for a hosted connector.', es: 'Prepara el flujo de facturación GST de India para un conector alojado.' } },
    { id: 'payment.upi_qr', kind: PluginCapabilityKind.Payment, execution: 'hosted', primitive: 'qr', provider: 'upi', operations: ['initialize', 'status', 'refund'], displayName: { en: 'UPI QR', es: 'QR UPI' }, description: { en: 'Configure UPI QR payments for this store.', es: 'Configura pagos QR UPI para esta tienda.' } },
    { id: 'payment.upi_intent', kind: PluginCapabilityKind.Payment, execution: 'hosted', primitive: 'qr', provider: 'upi', operations: ['initialize', 'status', 'refund'], displayName: { en: 'UPI intent', es: 'Intent UPI' }, description: { en: 'Configure UPI intent payments for this store.', es: 'Configura pagos intent UPI para esta tienda.' } },
    { id: 'delivery.swiggy', kind: PluginCapabilityKind.Delivery, execution: 'hosted', provider: 'swiggy', operations: ['receive_order', 'accept', 'deny', 'ready', 'cancel'], displayName: { en: 'Swiggy', es: 'Swiggy' }, description: { en: 'Configure order polling and lifecycle commands for Swiggy.', es: 'Configura la consulta de pedidos y comandos de ciclo de vida para Swiggy.' }, configuration: { provider: 'swiggy', fields: [{ name: 'intervalSeconds', kind: 'number', required: true, min: 15, max: 3600, step: 1, label: { en: 'Polling interval', es: 'Intervalo de consulta' }, suffix: { en: 'seconds', es: 'segundos' } }] } },
    { id: 'delivery.zomato', kind: PluginCapabilityKind.Delivery, execution: 'hosted', provider: 'zomato', operations: ['receive_order', 'accept', 'deny', 'ready', 'cancel'], displayName: { en: 'Zomato', es: 'Zomato' }, description: { en: 'Configure order polling and lifecycle commands for Zomato.', es: 'Configura la consulta de pedidos y comandos de ciclo de vida para Zomato.' }, configuration: { provider: 'zomato', fields: [{ name: 'intervalSeconds', kind: 'number', required: true, min: 15, max: 3600, step: 1, label: { en: 'Polling interval', es: 'Intervalo de consulta' }, suffix: { en: 'seconds', es: 'segundos' } }] } },
  ],
  permissions: [
    PluginPermission.SettingsRead,
    PluginPermission.SettingsWrite,
    PluginPermission.PaymentWrite,
    PluginPermission.FiscalWrite,
    PluginPermission.DeliveryEvents,
    PluginPermission.BrokerConnect,
  ],
  connectorIds: ['gstn', 'upi', 'swiggy', 'zomato'],
  hosted: { allowedOutboundHosts: ['api.razorpay.com', 'api.cashfree.com'], healthEndpoint: '/health' },
  artifact: { digest: 'sha256:stage1-in-inrepo-no-remote-artifact', signature: 'stage1-in-repo' },
} satisfies PluginManifest;
