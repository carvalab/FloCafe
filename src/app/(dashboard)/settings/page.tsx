'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth';
import { usePosSettingsStore, type PaperSize, type BillTemplate } from '@/store/pos-settings';
import { usePrinterStore, usePrinterStatusSync } from '@/hooks/usePrinter';
import { Settings, Building2, Globe, CreditCard, Monitor, Users, Gift, Printer, Share2, FileText, Lock, Smartphone, RefreshCw, Copy, Check, Wifi, Usb, Trash2, Plus, Star, TestTube2, ChefHat, QrCode, CheckCircle2, Database, Cloud, CloudOff, Zap } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { COUNTRIES } from '@/lib/countries';

const CLASSIC_PREVIEW = `  [STORE NAME]
  Table: T1
---------------
Item      Qty Rate Amt
---------------
Burger      1   99   99
  + Sauce
>> No onions
---------------
Subtotal       99
Tax             6
===============
TOTAL         105
Cash          105
---------------
GSTN: xxx  Bill#1
123 Main St`;

const COMPACT_PREVIEW = `  STORE NAME
-----------
Bill #1    12:30
-----------
Burger           99
  2 x 49.50
-----------
TOTAL            99
Cash             99
-----------
  Thank you!`;

const DETAILED_PREVIEW = `  [STORE NAME]
GSTIN: 22XXXXX
  TAX INVOICE
-----------
Bill#1   1 Jan 24
Cust: John
-----------
Item   Qty Rate Amt
Burger   1  99  99
-----------
Subtotal (excl.)  93
CGST @3%           3
SGST @3%           3
===============
TOTAL            99`;

interface TemplateCard {
  id: BillTemplate;
  name: string;
  description: string;
  preview: string;
}

const TEMPLATE_CARDS: TemplateCard[] = [
  { id: 'classic', name: 'Classic', description: 'Rich layout with 4-column item table, addon details, and full totals. Best for dine-in.', preview: CLASSIC_PREVIEW },
  { id: 'compact', name: 'Compact', description: 'Minimal, fast layout. One line per item. Ideal for quick service and takeaway.', preview: COMPACT_PREVIEW },
  { id: 'detailed', name: 'Detailed (GST)', description: 'Full GST compliance with GSTIN header, TAX INVOICE label, and per-rate tax breakdown.', preview: DETAILED_PREVIEW },
];

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative w-11 h-6 rounded-full transition-colors ${value ? 'bg-brand' : 'bg-gray-300'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

export default function SettingsPage() {
  const { currentTenant, user, updateCurrentTenant } = useAuthStore();
  const posSettings = usePosSettingsStore();
  const { printMethod, setPrintMethod, refreshHardwarePrinter } = usePrinterStore();
  usePrinterStatusSync();
  const isAdmin = currentTenant?.role === 'admin' || currentTenant?.role === 'owner';

  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);
  const [loyaltyDays, setLoyaltyDays] = useState(365);
  const [savingLoyalty, setSavingLoyalty] = useState(false);

  // ── KDS pairing ──────────────────────────────────────────────────────────
  const [kdsInfo, setKdsInfo] = useState<{ mdns_url: string; ip_url: string; qr_url: string; qr_data_url: string | null } | null>(null);
  const [kdsInfoLoading, setKdsInfoLoading] = useState(false);

  const fetchKdsInfo = () => {
    setKdsInfoLoading(true);
    api.get('/kds-info').then((res) => {
      setKdsInfo(res.data);
    }).catch(() => {
      toast.error('Could not fetch KDS info');
    }).finally(() => setKdsInfoLoading(false));
  };

  // ── Updates ─────────────────────────────────────────────────────────────────
  type UpdateStatus = {
    status: 'checking' | 'available' | 'up-to-date' | 'downloading' | 'ready-to-install' | 'error' | 'dev-mode' | 'store';
    version?: string;
    percent?: number;
    error?: string;
  };

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      (window as any).electronAPI.onUpdateStatus((status: UpdateStatus) => {
        setUpdateStatus(status);
      });
      (window as any).electronAPI.getUpdateStatus().then((status: any) => {
        if (status) setUpdateStatus({ status: status.updateAvailable ? 'available' : 'up-to-date', version: status.version });
      });
    }
  }, []);

  const handleCheckUpdates = () => {
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      (window as any).electronAPI.checkForUpdates();
    }
  };

  // ── Printers ─────────────────────────────────────────────────────────────
  type HwPrinter = {
    id: string; name: string; connection_type: 'network' | 'usb' | 'webusb';
    ip_address?: string; port?: number; usb_device_path?: string;
    paper_width: string; is_default: number;
  };

  type PrinterForm = {
    name: string; connection_type: 'network' | 'usb' | 'webusb';
    ip_address: string; port: string; usb_device_path: string; paper_width: string;
  };

  const emptyPrinterForm: PrinterForm = {
    name: '', connection_type: 'network', ip_address: '', port: '9100',
    usb_device_path: '/dev/usb/lp0', paper_width: '80mm',
  };

  type DetectedPrinter = {
    name: string; make: string; model: string;
    connectionType: 'usb' | 'network' | 'bluetooth';
    deviceUri: string; status: 'idle' | 'printing' | 'offline';
    isDefault: boolean; ipAddress?: string; port?: number; paperWidth?: string;
  };

  const [hwPrinters, setHwPrinters] = useState<HwPrinter[]>([]);
  const [printerForm, setPrinterForm] = useState<PrinterForm>(emptyPrinterForm);
  const [showPrinterForm, setShowPrinterForm] = useState(false);
  const [editingPrinterId, setEditingPrinterId] = useState<string | null>(null);
  const [savingPrinter, setSavingPrinter] = useState(false);
  const [testingPrinterId, setTestingPrinterId] = useState<string | null>(null);
  const [detectedPrinters, setDetectedPrinters] = useState<DetectedPrinter[]>([]);
  const [detectingPrinters, setDetectingPrinters] = useState(false);
  const [addingDetectedName, setAddingDetectedName] = useState<string | null>(null);

  const fetchPrinters = () => {
    api.get('/printers').then((res) => setHwPrinters(res.data.printers || [])).catch(() => {});
  };

  const fetchDetectedPrinters = async () => {
    setDetectingPrinters(true);
    try {
      const res = await api.get('/printers/detect');
      setDetectedPrinters(res.data.printers || []);
    } catch {
      setDetectedPrinters([]);
    } finally {
      setDetectingPrinters(false);
    }
  };

  const quickAddDetected = async (p: DetectedPrinter) => {
    setAddingDetectedName(p.name);
    try {
      const payload: any = {
        name: p.name,
        connection_type: p.connectionType === 'network' ? 'network' : 'usb',
        paper_width: p.paperWidth || '80mm',
      };
      if (p.connectionType === 'network') {
        payload.ip_address = p.ipAddress || '';
        payload.port = p.port || 9100;
      }
      await api.post('/printers', payload);
      toast.success(`${p.name} added`);
      fetchPrinters();
      refreshHardwarePrinter();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to add printer');
    } finally {
      setAddingDetectedName(null);
    }
  };

  const openAddPrinter = () => {
    setPrinterForm(emptyPrinterForm);
    setEditingPrinterId(null);
    setShowPrinterForm(true);
  };

  const openEditPrinter = (p: HwPrinter) => {
    setPrinterForm({
      name: p.name, connection_type: p.connection_type,
      ip_address: p.ip_address || '', port: String(p.port || 9100),
      usb_device_path: p.usb_device_path || '/dev/usb/lp0',
      paper_width: p.paper_width || '80mm',
    });
    setEditingPrinterId(p.id);
    setShowPrinterForm(true);
  };

  const savePrinterHw = async () => {
    if (!printerForm.name) { toast.error('Printer name is required'); return; }
    setSavingPrinter(true);
    try {
      const payload = {
        name: printerForm.name,
        connection_type: printerForm.connection_type,
        ip_address: printerForm.connection_type === 'network' ? printerForm.ip_address : undefined,
        port: printerForm.connection_type === 'network' ? Number(printerForm.port) : undefined,
        usb_device_path: printerForm.connection_type === 'usb' ? printerForm.usb_device_path : undefined,
        paper_width: printerForm.paper_width,
      };
      if (editingPrinterId) {
        await api.put(`/printers/${editingPrinterId}`, payload);
        toast.success('Printer updated');
      } else {
        await api.post('/printers', payload);
        toast.success('Printer added');
      }
      fetchPrinters();
      refreshHardwarePrinter();
      setShowPrinterForm(false);
    } catch {
      toast.error('Failed to save printer');
    } finally {
      setSavingPrinter(false);
    }
  };

  const deletePrinterHw = async (id: string) => {
    if (!confirm('Delete this printer?')) return;
    try {
      await api.delete(`/printers/${id}`);
      toast.success('Printer deleted');
      fetchPrinters();
      refreshHardwarePrinter();
    } catch { toast.error('Failed to delete'); }
  };

  const setDefaultPrinter = async (id: string) => {
    try {
      await api.post(`/printers/${id}/set-default`);
      toast.success('Default printer set');
      fetchPrinters();
      refreshHardwarePrinter();
    } catch { toast.error('Failed'); }
  };

  const testPrinterHw = async (printer: HwPrinter) => {
    if (printer.connection_type === 'webusb') {
      toast('WebUSB: use the Connect button in the POS toolbar to test.');
      return;
    }
    setTestingPrinterId(printer.id);
    try {
      await api.post(`/printers/${printer.id}/test`);
      toast.success('Test print sent!');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Test print failed');
    } finally {
      setTestingPrinterId(null);
    }
  };

  // Mobile App Pairing
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingRotatedAt, setPairingRotatedAt] = useState<string | null>(null);
  const [rotatingCode, setRotatingCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Printing local state (buffered — saved only on explicit Save)
  type PrintingForm = {
    printerEnabled: boolean; printerPaperSize: PaperSize;
    printMethod: 'escpos' | 'browser';
    autoPrintKot: boolean; autoPrintBill: boolean;
    webPrintSize: PaperSize; whatsappShareEnabled: boolean;
    printerUseUnicode: boolean;
  };
  const initPrinting = (): PrintingForm => ({
    printerEnabled: posSettings.printerEnabled,
    printerPaperSize: posSettings.printerPaperSize,
    printMethod: printMethod as 'escpos' | 'browser',
    autoPrintKot: posSettings.autoPrintKot,
    autoPrintBill: posSettings.autoPrintBill,
    webPrintSize: posSettings.webPrintSize,
    whatsappShareEnabled: posSettings.whatsappShareEnabled,
    printerUseUnicode: posSettings.printerUseUnicode,
  });
  const [printingForm, setPrintingForm] = useState<PrintingForm>(initPrinting);
  const [savedPrinting, setSavedPrinting] = useState<PrintingForm>(initPrinting);
  const savePrinting = () => {
    posSettings.setPrinterEnabled(printingForm.printerEnabled);
    posSettings.setPrinterPaperSize(printingForm.printerPaperSize);
    setPrintMethod(printingForm.printMethod);
    posSettings.setAutoPrintKot(printingForm.autoPrintKot);
    posSettings.setAutoPrintBill(printingForm.autoPrintBill);
    posSettings.setWebPrintSize(printingForm.webPrintSize);
    posSettings.setWhatsappShareEnabled(printingForm.whatsappShareEnabled);
    posSettings.setPrinterUseUnicode(printingForm.printerUseUnicode);
    setSavedPrinting(printingForm);
    toast.success('Printing settings saved');
  };
  const resetPrinting = () => setPrintingForm(savedPrinting);

  // Bill template local state
  type BillTemplateForm = { billTemplate: BillTemplate; billFooterMessage: string };
  const initBillTemplate = (): BillTemplateForm => ({
    billTemplate: posSettings.billTemplate,
    billFooterMessage: posSettings.billFooterMessage,
  });
  const [billForm, setBillForm] = useState<BillTemplateForm>(initBillTemplate);
  const [savedBillForm, setSavedBillForm] = useState<BillTemplateForm>(initBillTemplate);
  const saveBillTemplate = () => {
    posSettings.setBillTemplate(billForm.billTemplate);
    posSettings.setBillFooterMessage(billForm.billFooterMessage);
    setSavedBillForm(billForm);
    toast.success('Bill template saved');
  };
  const resetBillTemplate = () => setBillForm(savedBillForm);

  // Store / business fields — local form state (saved only on explicit Save)
  type BusinessForm = {
    businessName: string; countryCode: string; timezone: string; currency: string;
    billingType: 'postpaid' | 'prepaid';
    gstin: string; businessAddress: string; businessPhone: string;
    billShowName: boolean; billShowAddress: boolean; billShowPhone: boolean; billShowGstn: boolean;
  };
  const [savedBusiness, setSavedBusiness] = useState<BusinessForm>({
    businessName: '', countryCode: '', timezone: '', currency: '', billingType: 'postpaid',
    gstin: '', businessAddress: '', businessPhone: '',
    billShowName: true, billShowAddress: true, billShowPhone: true, billShowGstn: false,
  });
  const [form, setForm] = useState<BusinessForm>(savedBusiness);
  const [savingBusiness, setSavingBusiness] = useState(false);

  const [cloudSettings, setCloudSettings] = useState({
    cloud_api_key: '',
    cloud_store_id: '',
    cloud_sync_enabled: false,
    cloud_orders_enabled: false,
    cloud_last_sync: null as string | null,
  });
  const [savingCloud, setSavingCloud] = useState(false);
  const [testingCloud, setTestingCloud] = useState(false);
  const [cloudTestResult, setCloudTestResult] = useState<'ok' | 'fail' | null>(null);

  const resetBusiness = () => setForm(savedBusiness);

  useEffect(() => {
    fetchPrinters();
    fetchDetectedPrinters();
    fetchKdsInfo();

    api.get('/settings/loyalty').then((res) => {
      setLoyaltyEnabled(!!res.data.loyalty_enabled);
      if (res.data.loyalty_expiry_days) setLoyaltyDays(Number(res.data.loyalty_expiry_days));
    }).catch(() => {});

    api.get('/mobile/pairing-code').then((res) => {
      setPairingCode(res.data.pairing_code);
      setPairingRotatedAt(res.data.rotated_at);
    }).catch(() => {});

    api.get('/settings/cloud').then((res) => {
      setCloudSettings({
        cloud_api_key: res.data.cloud_api_key || '',
        cloud_store_id: res.data.cloud_store_id || '',
        cloud_sync_enabled: !!res.data.cloud_sync_enabled,
        cloud_orders_enabled: !!res.data.cloud_orders_enabled,
        cloud_last_sync: res.data.cloud_last_sync || null,
      });
    }).catch(() => {});

    api.get('/settings/business').then((res) => {
      const d = res.data;
      const matchedCountry = COUNTRIES.find(c => c.currency === d.currency && c.timezone === d.timezone);
      const loaded: BusinessForm = {
        businessName: d.business_name || '',
        countryCode: matchedCountry?.code || '',
        timezone: d.timezone || '',
        currency: d.currency || '',
        billingType: d.billing_type === 'prepaid' ? 'prepaid' : 'postpaid',
        gstin: d.gstin || '',
        businessAddress: d.business_address || '',
        businessPhone: d.business_phone || '',
        billShowName: typeof d.bill_show_name === 'boolean' ? d.bill_show_name : true,
        billShowAddress: typeof d.bill_show_address === 'boolean' ? d.bill_show_address : true,
        billShowPhone: typeof d.bill_show_phone === 'boolean' ? d.bill_show_phone : true,
        billShowGstn: typeof d.bill_show_gstn === 'boolean' ? d.bill_show_gstn : false,
      };
      setSavedBusiness(loaded);
      setForm(loaded);
      // Sync to pos-settings store for bill printing
      posSettings.setBillShowName(loaded.billShowName);
      posSettings.setBillShowAddress(loaded.billShowAddress);
      posSettings.setBillShowPhone(loaded.billShowPhone);
      posSettings.setBillShowGstn(loaded.billShowGstn);
      if (d.gstin) posSettings.setBillGstin(d.gstin);
      if (d.business_address) posSettings.setBillAddress(d.business_address);
      if (d.business_phone) posSettings.setBillPhone(d.business_phone);
      posSettings.setBillingType(d.billing_type === 'prepaid' ? 'prepaid' : 'postpaid');
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveCloud = async () => {
    setSavingCloud(true);
    try {
      await api.put('/settings/cloud', cloudSettings);
      toast.success('Cloud sync settings saved');
      setCloudTestResult(null);
    } catch {
      toast.error('Failed to save cloud settings');
    } finally {
      setSavingCloud(false);
    }
  };

  const testCloudConnection = async () => {
    if (!cloudSettings.cloud_api_key) { toast.error('Enter an API key first'); return; }
    setTestingCloud(true);
    setCloudTestResult(null);
    try {
      const res = await fetch('https://soflo.codify.tech/api/sync/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': cloudSettings.cloud_api_key },
        body: JSON.stringify({ pos_version: 'test' }),
      });
      setCloudTestResult(res.ok ? 'ok' : 'fail');
    } catch {
      setCloudTestResult('fail');
    } finally {
      setTestingCloud(false);
    }
  };

  const saveLoyalty = async () => {
    setSavingLoyalty(true);
    try {
      await api.put('/settings/loyalty', {
        loyalty_enabled: loyaltyEnabled,
        loyalty_expiry_days: loyaltyDays,
      });
      toast.success('Loyalty settings saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSavingLoyalty(false);
    }
  };

  const saveBusinessInfo = async () => {
    setSavingBusiness(true);
    try {
      await api.put('/settings/business', {
        business_name: form.businessName,
        timezone: form.timezone,
        currency: form.currency,
        billing_type: form.billingType,
        gstin: form.gstin,
        business_address: form.businessAddress,
        business_phone: form.businessPhone,
        bill_show_name: form.billShowName,
        bill_show_address: form.billShowAddress,
        bill_show_phone: form.billShowPhone,
        bill_show_gstn: form.billShowGstn,
      });
      setSavedBusiness(form);
      posSettings.setBillGstin(form.gstin);
      posSettings.setBillAddress(form.businessAddress);
      posSettings.setBillPhone(form.businessPhone);
      posSettings.setBillShowName(form.billShowName);
      posSettings.setBillShowAddress(form.billShowAddress);
      posSettings.setBillShowPhone(form.billShowPhone);
      posSettings.setBillShowGstn(form.billShowGstn);
      posSettings.setBillingType(form.billingType);
      updateCurrentTenant({ currency: form.currency, timezone: form.timezone });
      toast.success('Store details saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSavingBusiness(false);
    }
  };

  const rotatePairingCode = async () => {
    setRotatingCode(true);
    try {
      const res = await api.post('/mobile/rotate-code');
      setPairingCode(res.data.pairing_code);
      setPairingRotatedAt(res.data.rotated_at);
      toast.success('New pairing code generated');
    } catch {
      toast.error('Failed to generate code');
    } finally {
      setRotatingCode(false);
    }
  };

  const copyPairingCode = () => {
    if (!pairingCode) return;
    navigator.clipboard.writeText(pairingCode).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    });
  };

  const paperSizeOptions: { value: PaperSize; label: string }[] = [
    { value: 'thermal58', label: '2.5" (58mm)' },
    { value: 'thermal80', label: '3.5" (80mm)' },
    { value: 'a4', label: 'A4 Paper' },
    { value: 'a5', label: 'A5 Paper' },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Settings size={28} className="text-brand" />
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="mb-6">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="printers">Printers</TabsTrigger>
          <TabsTrigger value="kds">KDS Pairing</TabsTrigger>
          <TabsTrigger value="printing">Print Options</TabsTrigger>
          <TabsTrigger value="bill-template">Bill Template</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="updates">Updates</TabsTrigger>
          <TabsTrigger value="cloud">Cloud Sync</TabsTrigger>
        </TabsList>

        {/* ================================================================
            TAB: General
        ================================================================ */}
        <TabsContent value="general">
          <div className="pb-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Store Details — editable for admin, readonly otherwise */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Building2 size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Store Details</h2>
                {!isAdmin && (
                  <span className="ml-auto flex items-center gap-1 text-xs text-gray-400">
                    <Lock size={12} /> Admin only
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Business Name</label>
                  {isAdmin ? (
                    <input type="text" value={form.businessName} onChange={(e) => setForm((p) => ({ ...p, businessName: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand" />
                  ) : (
                    <p className="font-medium text-gray-900">{form.businessName || currentTenant?.business_name}</p>
                  )}
                </div>
                {/* Country, Timezone, Currency in single line with individual headings */}
                <div className="md:col-span-2 space-y-2">
                  {/* Headings */}
                  <div className="grid grid-cols-3 gap-2">
                    <label className="text-sm text-gray-500">Country</label>
                    <label className="text-sm text-gray-500">Timezone</label>
                    <label className="text-sm text-gray-500">Currency</label>
                  </div>
                  
                  {/* Input fields */}
                  {isAdmin ? (
                    <div className="grid grid-cols-3 gap-2">
                      <select 
                        value={form.countryCode}
                        onChange={(e) => {
                          const country = COUNTRIES.find(c => c.code === e.target.value);
                          setForm((p) => ({
                            ...p,
                            countryCode: e.target.value,
                            currency: country?.currency || p.currency,
                            timezone: country?.timezone || p.timezone,
                          }));
                        }}
                        className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand bg-white"
                      >
                        <option value="">Select country...</option>
                        {COUNTRIES.map((c) => (
                          <option key={c.code} value={c.code}>{c.name}</option>
                        ))}
                      </select>
                      <input 
                        type="text" 
                        value={form.timezone} 
                        onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))}
                        placeholder="Timezone (auto-filled)"
                        className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand bg-gray-50" 
                        readOnly
                      />
                      <input 
                        type="text" 
                        value={form.currency} 
                        onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}
                        placeholder="Currency (auto-filled)"
                        className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand bg-gray-50" 
                        readOnly
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      <p className="font-medium text-gray-900">
                        {COUNTRIES.find(c => c.code === form.countryCode)?.name || '—'}
                      </p>
                      <p className="font-medium text-gray-900">
                        {form.timezone || '—'}
                      </p>
                      <p className="font-medium text-gray-900">
                        {form.currency || '—'}
                      </p>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Billing Type</label>
                  {isAdmin ? (
                    <select value={form.billingType}
                      onChange={(e) => setForm((p) => ({ ...p, billingType: e.target.value as 'postpaid' | 'prepaid' }))}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand bg-white">
                      <option value="postpaid">Postpaid – Pay at checkout (hold orders)</option>
                      <option value="prepaid">Prepaid – Pay first (no hold)</option>
                    </select>
                  ) : (
                    <p className="font-medium text-gray-900 capitalize">{form.billingType}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm text-gray-500 mb-1">GSTIN Number</label>
                  {isAdmin ? (
                    <input type="text" value={form.gstin} onChange={(e) => setForm((p) => ({ ...p, gstin: e.target.value.toUpperCase() }))}
                      placeholder="22AAAAA0000A1Z5"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand" />
                  ) : (
                    <p className="font-medium text-gray-900">{form.gstin || '—'}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Phone</label>
                  {isAdmin ? (
                    <input type="text" value={form.businessPhone} onChange={(e) => setForm((p) => ({ ...p, businessPhone: e.target.value }))}
                      placeholder="+91 9876543210"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand" />
                  ) : (
                    <p className="font-medium text-gray-900">{form.businessPhone || '—'}</p>
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm text-gray-500 mb-1">Address</label>
                  {isAdmin ? (
                    <textarea value={form.businessAddress} onChange={(e) => setForm((p) => ({ ...p, businessAddress: e.target.value }))}
                      rows={2} placeholder="123 Main Street, City, State - 123456"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand resize-none" />
                  ) : (
                    <p className="font-medium text-gray-900">{form.businessAddress || '—'}</p>
                  )}
                </div>
              </div>

              {/* Bill display toggles */}
              <div className="mt-5 pt-5 border-t border-gray-100">
                <p className="text-sm font-semibold text-gray-700 mb-3">Show on Invoice</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {([
                    { label: 'Business Name', key: 'billShowName' as const },
                    { label: 'Address', key: 'billShowAddress' as const },
                    { label: 'Phone Number', key: 'billShowPhone' as const },
                    { label: 'GSTIN Number', key: 'billShowGstn' as const },
                  ] as const).map((item) => (
                    <div key={item.key} className="flex items-center justify-between py-2">
                      <span className="text-sm text-gray-700">{item.label}</span>
                      <Toggle
                        value={form[item.key]}
                        onChange={isAdmin ? (v) => setForm((p) => ({ ...p, [item.key]: v })) : () => {}}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {isAdmin && (
                <div className="mt-4 flex gap-2">
                </div>
              )}
            </div>

            {/* Subscription */}
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <CreditCard size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Subscription</h2>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Plan</p>
                  <p className="font-medium text-gray-900 capitalize">{currentTenant?.plan}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                    currentTenant?.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {currentTenant?.status}
                  </span>
                </div>
              </div>
            </div>

            {/* POS Display */}
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Monitor size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">POS Display</h2>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Show Product Images</p>
                  <p className="text-sm text-gray-500">Display product images in the POS grid</p>
                </div>
                <Toggle value={posSettings.showProductImages} onChange={posSettings.setShowProductImages} />
              </div>
            </div>

            {/* POS Workflow */}
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Users size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">POS Workflow</h2>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">Customer Mandatory</p>
                    <p className="text-sm text-gray-500">Require customer selection before placing an order</p>
                  </div>
                  <Toggle value={posSettings.customerMandatory} onChange={posSettings.setCustomerMandatory} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-medium text-gray-900">Phone Number Digits</p>
                      <p className="text-sm text-gray-500">Required digit count for phone validation (e.g. 10 for India)</p>
                    </div>
                  </div>
                  <input type="number" min={7} max={15} value={posSettings.phoneDigits}
                    onChange={(e) => posSettings.setPhoneDigits(parseInt(e.target.value) || 10)}
                    className="w-20 px-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-brand" />
                </div>
              </div>
            </div>

            {/* Loyalty */}
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Gift size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Loyalty Program</h2>
              </div>
              <div className="space-y-5">
                {/* Enable toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">Enable Loyalty Program</p>
                    <p className="text-sm text-gray-500">Customers earn points on every purchase</p>
                  </div>
                  <button
                    onClick={() => setLoyaltyEnabled(!loyaltyEnabled)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      loyaltyEnabled ? 'bg-brand' : 'bg-gray-200'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      loyaltyEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>

                {loyaltyEnabled && (
                  <>
                    {/* Points expiry */}
                    <div>
                      <p className="font-medium text-gray-900">Points Expiry</p>
                      <p className="text-sm text-gray-500 mb-2">Number of days before earned points expire</p>
                      <div className="flex items-center gap-3">
                        <input type="number" min={1} max={3650} value={loyaltyDays}
                          onChange={(e) => setLoyaltyDays(parseInt(e.target.value) || 365)}
                          className="w-24 px-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-brand" />
                        <span className="text-sm text-gray-500">days</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

          </div>

            {/* Account */}
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Account</h2>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Name</p>
                  <p className="font-medium text-gray-900">{user?.name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Email</p>
                  <p className="font-medium text-gray-900">{user?.email}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Role</p>
                  <p className="font-medium text-gray-900 capitalize">{currentTenant?.role || '—'}</p>
                </div>
              </div>
            </div>

            {/* Mobile App */}
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Smartphone size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Mobile App</h2>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Connect the Flo mobile app to view reports and sales on your phone.
                Enter this code in the app to pair it with your account.
              </p>
              {pairingCode ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-center">
                      <span className="font-mono text-2xl font-bold tracking-[0.3em] text-gray-900">
                        {pairingCode}
                      </span>
                    </div>
                    <button
                      onClick={copyPairingCode}
                      className="p-2.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500"
                      title="Copy code"
                    >
                      {copiedCode ? <Check size={18} className="text-green-600" /> : <Copy size={18} />}
                    </button>
                  </div>
                  {pairingRotatedAt && (
                    <p className="text-xs text-gray-400">
                      Generated {new Date(pairingRotatedAt).toLocaleDateString()}
                    </p>
                  )}
                  <button
                    onClick={rotatePairingCode}
                    disabled={rotatingCode}
                    className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={rotatingCode ? 'animate-spin' : ''} />
                    {rotatingCode ? 'Generating...' : 'Generate new code'}
                  </button>
                  <p className="text-xs text-amber-600">
                    Generating a new code will disconnect all currently paired devices.
                  </p>
                </div>
              ) : (
                <button
                  onClick={rotatePairingCode}
                  disabled={rotatingCode}
                  className="px-5 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 disabled:opacity-50 font-medium"
                >
                  {rotatingCode ? 'Generating...' : 'Generate Pairing Code'}
                </button>
              )}
              {/* Save buttons - moved from sticky bottom */}
              {isAdmin && (
                <div className="mt-6 pt-6 border-t border-gray-200 flex items-center justify-end gap-3">
                  <button onClick={resetBusiness} disabled={savingBusiness || savingLoyalty}
                    className="px-5 py-2 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50">
                    Cancel
                  </button>
                  <button
                    onClick={async () => { await Promise.all([saveBusinessInfo(), saveLoyalty()]); }}
                    disabled={savingBusiness || savingLoyalty}
                    className="px-6 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 disabled:opacity-50 font-medium">
                    {(savingBusiness || savingLoyalty) ? 'Saving...' : 'Save All'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ================================================================
            TAB: Printers (hardware — IP / USB / WebUSB)
        ================================================================ */}
        <TabsContent value="printers">
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Printer size={20} className="text-gray-500" />
                  <h2 className="font-semibold text-gray-900">Hardware Printers</h2>
                </div>
                {!showPrinterForm && (
                  <div className="flex items-center gap-2">
                    <button onClick={fetchDetectedPrinters} disabled={detectingPrinters}
                      title="Refresh list of installed printers"
                      className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50">
                      <RefreshCw size={14} className={detectingPrinters ? 'animate-spin' : ''} /> Refresh
                    </button>
                    <button onClick={openAddPrinter}
                      className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 font-medium">
                      <Plus size={14} /> Add Manually
                    </button>
                  </div>
                )}
              </div>

              {/* Detected (OS-installed) printers — one-click add */}
              {!showPrinterForm && (
                <div className="mb-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Installed on this computer</h3>
                  {detectingPrinters && detectedPrinters.length === 0 ? (
                    <div className="py-6 text-center text-gray-400 text-sm">Scanning for installed printers…</div>
                  ) : detectedPrinters.length === 0 ? (
                    <div className="py-6 text-center text-gray-400 text-sm border border-dashed border-gray-200 rounded-lg">
                      No installed printers found. Install your printer via system settings, then click Refresh — or use Add Manually for a network printer.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {detectedPrinters.map((p) => {
                        const alreadyAdded = hwPrinters.some((h) => h.name.toLowerCase() === p.name.toLowerCase());
                        const isAdding = addingDetectedName === p.name;
                        const dotColor = p.status === 'idle' ? 'bg-green-500' : p.status === 'printing' ? 'bg-yellow-500' : 'bg-gray-300';
                        const statusLabel = p.status === 'idle' ? 'Online' : p.status === 'printing' ? 'Printing' : 'Offline';
                        return (
                          <div key={p.name} className="flex items-center gap-3 rounded-xl border border-gray-200 p-3">
                            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-gray-100 shrink-0">
                              {p.connectionType === 'network' ? <Wifi size={18} className="text-gray-500" /> : <Usb size={18} className="text-gray-500" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900 text-sm truncate">{p.name}</span>
                                <span className="flex items-center gap-1 text-[11px] text-gray-500">
                                  <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                                  {statusLabel}
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5 truncate">
                                {p.make !== 'Unknown' ? `${p.make} ${p.model}` : p.model}
                                {p.connectionType === 'network' && p.ipAddress ? ` · ${p.ipAddress}${p.port ? ':' + p.port : ''}` : ''}
                                {p.paperWidth ? ` · ${p.paperWidth}` : ''}
                              </p>
                            </div>
                            {alreadyAdded ? (
                              <span className="text-xs text-gray-400 px-3 py-1.5 flex items-center gap-1">
                                <CheckCircle2 size={14} className="text-green-500" /> Added
                              </span>
                            ) : (
                              <button onClick={() => quickAddDetected(p)} disabled={isAdding}
                                className="px-3 py-1.5 text-xs bg-brand text-white rounded-lg hover:opacity-90 disabled:opacity-50 font-medium flex items-center gap-1">
                                <Plus size={13} /> {isAdding ? 'Adding…' : 'Add'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Configured printer list */}
              {hwPrinters.length === 0 && !showPrinterForm && (
                <div className="py-6 text-center text-gray-400">
                  <p className="text-sm">No printers configured yet.</p>
                  <p className="text-xs mt-1">Click Add on an installed printer above, or use Add Manually.</p>
                </div>
              )}

              {hwPrinters.length > 0 && !showPrinterForm && (
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Configured printers</h3>
              )}
              <div className="space-y-3">
                {hwPrinters.map((p) => (
                  <div key={p.id} className={`flex items-center gap-3 rounded-xl border p-4 ${p.is_default ? 'border-brand bg-brand/5' : 'border-gray-200'}`}>
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-gray-100 shrink-0">
                      {p.connection_type === 'network' ? <Wifi size={18} className="text-gray-500" /> :
                       p.connection_type === 'webusb' ? <Usb size={18} className="text-blue-500" /> :
                       <Usb size={18} className="text-gray-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 text-sm">{p.name}</span>
                        {p.is_default === 1 && (
                          <span className="text-[10px] bg-brand/10 text-brand px-2 py-0.5 rounded-full font-medium">Default</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {p.connection_type === 'network' ? `${p.ip_address}:${p.port}` :
                         p.connection_type === 'usb' ? (p.usb_device_path || '/dev/usb/lp0') :
                         'Browser WebUSB'}
                        {' · '}{p.paper_width}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => testPrinterHw(p)} disabled={testingPrinterId === p.id}
                        title="Test print"
                        className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 disabled:opacity-40">
                        <TestTube2 size={15} />
                      </button>
                      {p.is_default !== 1 && (
                        <button onClick={() => setDefaultPrinter(p.id)} title="Set as default"
                          className="p-2 rounded-lg hover:bg-yellow-50 text-gray-400 hover:text-yellow-600">
                          <Star size={15} />
                        </button>
                      )}
                      <button onClick={() => openEditPrinter(p)} title="Edit"
                        className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700">
                        <Settings size={15} />
                      </button>
                      <button onClick={() => deletePrinterHw(p.id)} title="Delete"
                        className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add / Edit form */}
              {showPrinterForm && (
                <div className="mt-5 pt-5 border-t border-gray-100">
                  <h3 className="font-semibold text-gray-900 text-sm mb-4">
                    {editingPrinterId ? 'Edit Printer' : 'Add Printer'}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Printer Name *</label>
                      <input type="text" value={printerForm.name}
                        onChange={(e) => setPrinterForm((p) => ({ ...p, name: e.target.value }))}
                        placeholder="e.g. Kitchen Printer"
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Connection Type</label>
                      <select value={printerForm.connection_type}
                        onChange={(e) => setPrinterForm((p) => ({ ...p, connection_type: e.target.value as HwPrinter['connection_type'] }))}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand">
                        <option value="network">Network (IP/TCP)</option>
                        <option value="usb">USB (device path)</option>
                        <option value="webusb">WebUSB (browser)</option>
                      </select>
                    </div>

                    {printerForm.connection_type === 'network' && (<>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">IP Address *</label>
                        <input type="text" value={printerForm.ip_address}
                          onChange={(e) => setPrinterForm((p) => ({ ...p, ip_address: e.target.value }))}
                          placeholder="192.168.1.100"
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Port</label>
                        <input type="number" value={printerForm.port}
                          onChange={(e) => setPrinterForm((p) => ({ ...p, port: e.target.value }))}
                          placeholder="9100"
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand" />
                      </div>
                    </>)}

                    {printerForm.connection_type === 'usb' && (
                      <div className="md:col-span-2">
                        <label className="block text-xs text-gray-500 mb-1">USB Device Path</label>
                        <input type="text" value={printerForm.usb_device_path}
                          onChange={(e) => setPrinterForm((p) => ({ ...p, usb_device_path: e.target.value }))}
                          placeholder="/dev/usb/lp0"
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand" />
                        <p className="text-xs text-gray-400 mt-1">Linux: /dev/usb/lp0  · macOS: /dev/cu.usbserial-XXX</p>
                      </div>
                    )}

                    {printerForm.connection_type === 'webusb' && (
                      <div className="md:col-span-2 bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
                        WebUSB printers are connected directly from the browser via the toolbar Connect button.
                        Save this entry to remember the paper width preference.
                      </div>
                    )}

                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Paper Width</label>
                      <select value={printerForm.paper_width}
                        onChange={(e) => setPrinterForm((p) => ({ ...p, paper_width: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand">
                        <option value="58mm">58mm (2.5")</option>
                        <option value="80mm">80mm (3.1")</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <button onClick={savePrinterHw} disabled={savingPrinter}
                      className="px-5 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 disabled:opacity-50 font-medium">
                      {savingPrinter ? 'Saving...' : editingPrinterId ? 'Save Changes' : 'Add Printer'}
                    </button>
                    <button onClick={() => setShowPrinterForm(false)}
                      className="px-5 py-2 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 font-medium">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
              <strong>Tip:</strong> The default printer is used for auto-print KOT and bill. Set one printer as default, then configure auto-print in <em>Print Options</em>.
            </div>
          </div>
        </TabsContent>

        {/* ================================================================
            TAB: KDS Pairing
        ================================================================ */}
        <TabsContent value="kds">
          <div className="max-w-2xl space-y-6">
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <ChefHat size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Kitchen Display (KDS) Pairing</h2>
              </div>
              <p className="text-sm text-gray-500 mb-5">
                Open a browser on any tablet or monitor on the same WiFi and scan the QR code (or type the URL) to connect it as a Kitchen Display.
              </p>

              {kdsInfoLoading && (
                <div className="flex items-center justify-center py-10">
                  <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              {kdsInfo && !kdsInfoLoading && (
                <div className="flex flex-col sm:flex-row gap-6 items-start">
                  {/* QR code */}
                  <div className="shrink-0">
                    {kdsInfo.qr_data_url ? (
                      <img src={kdsInfo.qr_data_url} alt="KDS QR Code"
                        className="w-48 h-48 rounded-xl border border-gray-200" />
                    ) : (
                      <div className="w-48 h-48 rounded-xl border border-gray-200 flex items-center justify-center text-gray-400">
                        <QrCode size={48} />
                      </div>
                    )}
                  </div>

                  {/* URLs */}
                  <div className="flex-1 space-y-4">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Direct IP (recommended)</p>
                      <a href={kdsInfo.ip_url} target="_blank" rel="noopener noreferrer"
                        className="block font-mono text-sm text-brand break-all hover:underline">
                        {kdsInfo.ip_url}
                      </a>
                      <p className="text-xs text-gray-400 mt-1">Works on all devices. IP may change if the POS machine reconnects to WiFi.</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">mDNS (always-stable)</p>
                      <a href={kdsInfo.mdns_url} target="_blank" rel="noopener noreferrer"
                        className="block font-mono text-sm text-gray-700 break-all hover:underline">
                        {kdsInfo.mdns_url}
                      </a>
                      <p className="text-xs text-gray-400 mt-1">Resolves via Bonjour/mDNS. Works on iOS, macOS, and most Android (Chrome). May need mDNS enabled on router.</p>
                    </div>

                    <button onClick={fetchKdsInfo} disabled={kdsInfoLoading}
                      className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800">
                      <RefreshCw size={14} className={kdsInfoLoading ? 'animate-spin' : ''} />
                      Refresh URLs
                    </button>
                  </div>
                </div>
              )}

              {!kdsInfo && !kdsInfoLoading && (
                <button onClick={fetchKdsInfo}
                  className="px-4 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 font-medium">
                  Load KDS Info
                </button>
              )}
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
              <strong>How it works:</strong> Flo runs an embedded HTTP server on port 3001.
              The KDS page at <code className="bg-blue-100 px-1 rounded">/kds</code> connects via WebSocket for real-time order updates.
              No app install needed — just a modern browser on the same network.
            </div>
          </div>
        </TabsContent>

        {/* ================================================================
            TAB: Printing
        ================================================================ */}
        <TabsContent value="printing">
          <div className="pb-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Printer size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Printing</h2>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">Enable Printer</p>
                    <p className="text-sm text-gray-500">Connect to thermal printer via USB/Bluetooth</p>
                  </div>
                  <Toggle value={printingForm.printerEnabled} onChange={(v) => setPrintingForm((p) => ({ ...p, printerEnabled: v }))} />
                </div>
                <div>
                  <p className="font-medium text-gray-900 mb-2">Paper Size</p>
                  <select value={printingForm.printerPaperSize}
                    onChange={(e) => setPrintingForm((p) => ({ ...p, printerPaperSize: e.target.value as PaperSize }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand">
                    {paperSizeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="font-medium text-gray-900 mb-2">Print Method</p>
                  <select value={printingForm.printMethod}
                    onChange={(e) => setPrintingForm((p) => ({ ...p, printMethod: e.target.value as 'escpos' | 'browser' }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand">
                    <option value="escpos">ESCPOS (USB Thermal Printer)</option>
                    <option value="browser">Browser Print (any printer)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {printingForm.printMethod === 'escpos'
                      ? 'Direct USB printing via WebUSB — connect the printer from the POS toolbar'
                      : 'Opens the browser print dialog — works with any printer on this computer'}
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">Auto-print KOT</p>
                    <p className="text-sm text-gray-500">Print KOT when order is placed</p>
                  </div>
                  <Toggle value={printingForm.autoPrintKot} onChange={(v) => setPrintingForm((p) => ({ ...p, autoPrintKot: v }))} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">Auto-print Bill</p>
                    <p className="text-sm text-gray-500">Print bill when payment is completed</p>
                  </div>
                  <Toggle value={printingForm.autoPrintBill} onChange={(v) => setPrintingForm((p) => ({ ...p, autoPrintBill: v }))} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">Printer supports Unicode</p>
                    <p className="text-sm text-gray-500">
                      If ON, prints currency symbols (₹, €, £, ¥…) as-is. If OFF, replaces them with ASCII (Rs, EUR, GBP, Yen…) — safer default for most thermal printers.
                    </p>
                  </div>
                  <Toggle value={printingForm.printerUseUnicode} onChange={(v) => setPrintingForm((p) => ({ ...p, printerUseUnicode: v }))} />
                </div>
                <div>
                  <p className="font-medium text-gray-900 mb-2">Web Print Size (A4/A5)</p>
                  <select value={printingForm.webPrintSize}
                    onChange={(e) => setPrintingForm((p) => ({ ...p, webPrintSize: e.target.value as PaperSize }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand">
                    <option value="a4">A4 (Default)</option>
                    <option value="a5">A5</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Share2 size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">WhatsApp Sharing</h2>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Enable WhatsApp Share</p>
                  <p className="text-sm text-gray-500">Send bill details via WhatsApp after payment</p>
                </div>
                <Toggle value={printingForm.whatsappShareEnabled} onChange={(v) => setPrintingForm((p) => ({ ...p, whatsappShareEnabled: v }))} />
              </div>
            </div>
          </div>
          {/* Printing tab - Save buttons moved from sticky bottom */}
          <div className="mt-6 pt-6 border-t border-gray-200 flex items-center justify-end gap-3">
            <button onClick={resetPrinting} className="px-5 py-2 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 font-medium">Cancel</button>
            <button onClick={savePrinting} className="px-6 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 font-medium">Save</button>
          </div>
          </div>
        </TabsContent>

        {/* ================================================================
            TAB: Bill Template
        ================================================================ */}
        <TabsContent value="bill-template">
          <div className="pb-6">
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <FileText size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Choose Template</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {TEMPLATE_CARDS.map((card) => {
                  const isSelected = billForm.billTemplate === card.id;
                  return (
                    <button key={card.id} onClick={() => setBillForm((p) => ({ ...p, billTemplate: card.id }))}
                      className={`text-left rounded-xl border-2 p-4 transition-all ${
                        isSelected ? 'border-brand bg-brand/5' : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}>
                      <p className="font-semibold text-gray-900 mb-2">{card.name}</p>
                      <pre className="font-mono text-[9px] leading-tight text-gray-600 bg-gray-50 p-2 rounded overflow-hidden mb-3 whitespace-pre">
                        {card.preview}
                      </pre>
                      <p className="text-xs text-gray-500">{card.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Footer Message</h2>
              <div>
                <label htmlFor="footer-message" className="block text-sm font-medium text-gray-700 mb-1">Footer Message</label>
                <textarea id="footer-message" rows={2}
                  placeholder="e.g. Thank you for visiting!"
                  value={billForm.billFooterMessage}
                  onChange={(e) => setBillForm((p) => ({ ...p, billFooterMessage: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand resize-none" />
                <p className="text-xs text-gray-400 mt-1">Printed at the bottom of every bill</p>
              </div>
            </div>
          </div>
          {/* Bill Template tab - Save buttons moved from sticky bottom */}
          <div className="mt-6 pt-6 border-t border-gray-200 flex items-center justify-end gap-3">
            <button onClick={resetBillTemplate} className="px-5 py-2 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 font-medium">Cancel</button>
            <button onClick={saveBillTemplate} className="px-6 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 font-medium">Save</button>
          </div>
          </div>
        </TabsContent>

        {/* ================================================================
            TAB: Data (Import/Export/Backup)
        ================================================================ */}
        <TabsContent value="data">
          <div className="space-y-6">
            {/* Database Export */}
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <FileText size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Export Database</h2>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Export your entire database as a JSON file. This includes all products, orders, customers, and settings.
              </p>
              <button
                onClick={async () => {
                  try {
                    const response = await fetch('/api/db/export');
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `flo-export-${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                    toast.success('Database exported successfully');
                  } catch {
                    toast.error('Export failed');
                  }
                }}
                className="px-5 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 font-medium"
              >
                Export to JSON
              </button>
            </div>

            {/* Database Backup */}
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <FileText size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Create Backup</h2>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Create a complete backup of your SQLite database file.
              </p>
              <button
                onClick={async () => {
                  try {
                    const response = await api.get('/db/backup');
                    toast.success('Backup created successfully');
                  } catch {
                    toast.error('Backup failed');
                  }
                }}
                className="px-5 py-2 text-sm bg-gray-600 text-white rounded-lg hover:opacity-90 font-medium"
              >
                Create Backup
              </button>
            </div>

            {/* Database Import */}
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <FileText size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Import Database</h2>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Import data from a Flo Desktop export file. Choose to merge with existing data or replace all data.
              </p>
              <input
                type="file"
                accept=".json"
                id="import-file"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;

                  const reader = new FileReader();
                  reader.onload = async (event) => {
                    try {
                      const data = JSON.parse(event.target?.result as string);
                      if (!data.app || data.app !== 'FloDesktop') {
                        toast.error('Invalid Flo Desktop export file');
                        return;
                      }

                      const overwrite = confirm('Do you want to replace ALL existing data? Click Cancel to merge instead.');
                      
                      const response = await api.post('/db/import', { data, overwrite });
                      if (response.data.success) {
                        toast.success(response.data.message);
                      }
                    } catch {
                      toast.error('Import failed - invalid file format');
                    }
                  };
                  reader.readAsText(file);
                  e.target.value = '';
                }}
              />
              <div className="flex gap-2">
                <label
                  htmlFor="import-file"
                  className="px-5 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 cursor-pointer font-medium"
                >
                  Select File & Import
                </label>
              </div>
            </div>

            {/* Database Info */}
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Database size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Database Information</h2>
              </div>
              <button
                onClick={async () => {
                  try {
                    const response = await api.get('/db/tables');
                    const { tables } = response.data;
                    const info = tables.map((t: { name: string; rows: number }) => `${t.name}: ${t.rows} rows`).join('\n');
                    alert(`Database Tables:\n\n${info}`);
                  } catch {
                    toast.error('Failed to fetch table info');
                  }
                }}
                className="px-5 py-2 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 font-medium"
              >
                View Table Info
              </button>
            </div>
          </div>
        </TabsContent>

        {/* ================================================================
            TAB: Updates
        ================================================================ */}
        <TabsContent value="updates">
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-4">
              <RefreshCw size={20} className="text-gray-500" />
              <h2 className="font-semibold text-gray-900">Software Updates</h2>
            </div>
            <p className="text-sm text-gray-500 mb-6">
              {updateStatus?.status === 'store'
                ? 'This version is distributed via the App Store. Updates are managed by the store.'
                : 'Flo Desktop checks for updates automatically. You can also check manually below.'}
            </p>

            {updateStatus && updateStatus.status !== 'store' && (
              <div className={`p-4 rounded-lg mb-4 ${
                updateStatus.status === 'available' || updateStatus.status === 'ready-to-install'
                  ? 'bg-green-50 border border-green-200'
                  : updateStatus.status === 'error'
                  ? 'bg-red-50 border border-red-200'
                  : updateStatus.status === 'dev-mode'
                  ? 'bg-yellow-50 border border-yellow-200'
                  : 'bg-gray-50 border border-gray-200'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {updateStatus.status === 'checking' && <RefreshCw size={16} className="animate-spin text-brand" />}
                  {updateStatus.status === 'available' && <Check size={16} className="text-green-600" />}
                  {updateStatus.status === 'up-to-date' && <CheckCircle2 size={16} className="text-green-600" />}
                  {updateStatus.status === 'ready-to-install' && <CheckCircle2 size={16} className="text-green-600" />}
                  {updateStatus.status === 'downloading' && <RefreshCw size={16} className="animate-spin text-brand" />}
                  {updateStatus.status === 'error' && <span className="text-red-600">✕</span>}
                  {updateStatus.status === 'dev-mode' && <span className="text-yellow-600">⚠</span>}
                  <span className="font-medium capitalize">{updateStatus.status.replace(/-/g, ' ')}</span>
                </div>
                {updateStatus.version && (
                  <p className="text-sm text-gray-600">Version: {updateStatus.version}</p>
                )}
                {updateStatus.percent !== undefined && (
                  <div className="mt-2">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-brand h-2 rounded-full transition-all"
                        style={{ width: `${updateStatus.percent}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{updateStatus.percent.toFixed(1)}% downloaded</p>
                  </div>
                )}
                {updateStatus.error && (
                  <p className="text-sm text-red-600 mt-1">{updateStatus.error}</p>
                )}
                {updateStatus.status === 'up-to-date' && (
                  <p className="text-sm text-gray-600">You're running the latest version!</p>
                )}
                {updateStatus.status === 'dev-mode' && (
                  <p className="text-sm text-yellow-600">Update checking is disabled in development mode.</p>
                )}
              </div>
            )}

            {updateStatus?.status !== 'store' && (
              <button
                onClick={handleCheckUpdates}
                disabled={updateStatus?.status === 'checking' || updateStatus?.status === 'downloading'}
                className="px-4 py-2 bg-brand text-white rounded-lg hover:opacity-90 disabled:opacity-50 text-sm font-medium flex items-center gap-2"
              >
                <RefreshCw size={16} className={updateStatus?.status === 'checking' ? 'animate-spin' : ''} />
                {updateStatus?.status === 'checking' ? 'Checking...' : 'Check for Updates'}
              </button>
            )}
          </div>
        </TabsContent>
        {/* ================================================================
            TAB: Cloud Sync
        ================================================================ */}
        <TabsContent value="cloud">
          <div className="space-y-6">

            {/* FloAdmin — reporting sync */}
            <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
              <div className="flex items-center gap-2">
                <Cloud size={20} className="text-brand" />
                <div>
                  <h2 className="font-semibold text-gray-900">FloAdmin — Sales Reporting</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Push every paid bill to the cloud so the ReFlo mobile app can show live reports</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
                  <p className="text-xs text-gray-500 mb-2">Get this from <span className="font-mono">soflo.codify.tech</span> → register your store → copy the API key</p>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={cloudSettings.cloud_api_key}
                      onChange={(e) => setCloudSettings({ ...cloudSettings, cloud_api_key: e.target.value })}
                      placeholder="fac_live_xxxxxxxxxxxxxxxxxxxx"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand outline-none"
                    />
                    <button
                      onClick={testCloudConnection}
                      disabled={testingCloud}
                      className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50"
                    >
                      {testingCloud ? 'Testing…' : 'Test'}
                    </button>
                  </div>
                  {cloudTestResult === 'ok' && (
                    <p className="flex items-center gap-1 text-xs text-green-600 mt-1"><CheckCircle2 size={13} /> Connected to FloAdmin</p>
                  )}
                  {cloudTestResult === 'fail' && (
                    <p className="flex items-center gap-1 text-xs text-red-600 mt-1"><CloudOff size={13} /> Connection failed — check key and server</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Store ID <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input
                    type="text"
                    value={cloudSettings.cloud_store_id}
                    onChange={(e) => setCloudSettings({ ...cloudSettings, cloud_store_id: e.target.value })}
                    placeholder="Filled automatically after first sync"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand outline-none"
                  />
                </div>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cloudSettings.cloud_sync_enabled}
                    onChange={(e) => setCloudSettings({ ...cloudSettings, cloud_sync_enabled: e.target.checked })}
                    className="rounded border-gray-300 text-brand focus:ring-brand"
                  />
                  <span className="text-sm text-gray-700">Enable bill sync to FloAdmin</span>
                </label>

                {cloudSettings.cloud_last_sync && (
                  <p className="text-xs text-gray-400">Last sync: {new Date(cloudSettings.cloud_last_sync).toLocaleString()}</p>
                )}
              </div>
            </div>

            {/* OrderFlow — online orders */}
            <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Zap size={20} className="text-amber-500" />
                <div>
                  <h2 className="font-semibold text-gray-900">OrderFlow — Online Orders</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Receive orders from Zomato, Swiggy, and other platforms directly in this POS</p>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 text-xs text-amber-700 space-y-1">
                <p className="font-medium">How it works</p>
                <p>1. Register your store on <span className="font-mono">reportingserver.codify.tech</span></p>
                <p>2. Give Zomato/Swiggy your webhook URL (shown after registering)</p>
                <p>3. Enable online orders below — POS will poll every 5 seconds and show a notification for each new order</p>
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cloudSettings.cloud_orders_enabled}
                  onChange={(e) => setCloudSettings({ ...cloudSettings, cloud_orders_enabled: e.target.checked })}
                  className="rounded border-gray-300 text-brand focus:ring-brand"
                />
                <span className="text-sm text-gray-700">Enable online order polling from OrderFlow</span>
              </label>

              {cloudSettings.cloud_store_id && (
                <div className="bg-gray-50 rounded-lg px-4 py-3 text-xs space-y-1">
                  <p className="text-gray-500 font-medium">Your webhook URLs (give to platforms):</p>
                  <p className="font-mono text-gray-700">Zomato: reportingserver.codify.tech/webhooks/zomato/{cloudSettings.cloud_store_id}</p>
                  <p className="font-mono text-gray-700">Swiggy: reportingserver.codify.tech/webhooks/swiggy/{cloudSettings.cloud_store_id}</p>
                </div>
              )}
            </div>

            <button
              onClick={saveCloud}
              disabled={savingCloud}
              className="px-6 py-2.5 bg-brand text-white rounded-lg hover:opacity-90 disabled:opacity-50 text-sm font-medium"
            >
              {savingCloud ? 'Saving…' : 'Save Cloud Settings'}
            </button>
          </div>
        </TabsContent>

      </Tabs>
    </div>
  );
}
