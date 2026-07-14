export interface Country {
  code: string;
  name: string;
  currency: string;
  currencyCode: string;
  timezone: string;
  /** Defaults to '+1'. */
  dialCode?: string;
  /** Defaults to 'en-US'. */
  locale?: string;
  /** Defaults to 'en'. */
  defaultLanguage?: string;
  /** Defaults to 'Tax ID'. */
  taxIdLabel?: string;
  /** Defaults to 'Tax'. */
  taxName?: string;
  /** Defaults to 'Receipt'. */
  documentTitle?: string;
}

export const DEFAULT_COUNTRY_PROFILE = {
  dialCode: '+1',
  locale: 'en-US',
  defaultLanguage: 'en',
  taxIdLabel: 'Tax ID',
  taxName: 'Tax',
  documentTitle: 'Receipt',
} as const;

const RAW_COUNTRIES: Country[] = [
  { code: 'IN', name: 'India', currency: 'INR', currencyCode: '₹', timezone: 'Asia/Kolkata', dialCode: '+91', locale: 'en-IN', defaultLanguage: 'en', taxIdLabel: 'GSTIN', taxName: 'GST', documentTitle: 'Tax Invoice' },
  { code: 'AR', name: 'Argentina', currency: 'ARS', currencyCode: 'AR$', timezone: 'America/Argentina/Buenos_Aires', dialCode: '+54', locale: 'es-AR', defaultLanguage: 'es', taxIdLabel: 'CUIT', taxName: 'IVA', documentTitle: 'Comprobante' },
  { code: 'US', name: 'United States', currency: 'USD', currencyCode: '$', timezone: 'America/New_York', dialCode: '+1', locale: 'en-US', defaultLanguage: 'en', taxIdLabel: 'EIN', taxName: 'Sales Tax', documentTitle: 'Invoice' },
  { code: 'CA', name: 'Canada', currency: 'CAD', currencyCode: 'C$', timezone: 'America/Toronto', dialCode: '+1', locale: 'en-CA', defaultLanguage: 'en', taxIdLabel: 'BN', taxName: 'GST/HST' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', currencyCode: '£', timezone: 'Europe/London', dialCode: '+44', locale: 'en-GB', defaultLanguage: 'en', taxIdLabel: 'VAT', taxName: 'VAT' },
  { code: 'EU', name: 'European Union', currency: 'EUR', currencyCode: '€', timezone: 'Europe/Paris', dialCode: '+33', locale: 'fr-FR', defaultLanguage: 'fr', taxIdLabel: 'VAT', taxName: 'VAT' },
  { code: 'TH', name: 'Thailand', currency: 'THB', currencyCode: '฿', timezone: 'Asia/Bangkok', dialCode: '+66', locale: 'th-TH', defaultLanguage: 'th', taxIdLabel: 'Tax ID', taxName: 'VAT' },
  { code: 'SG', name: 'Singapore', currency: 'SGD', currencyCode: 'S$', timezone: 'Asia/Singapore', dialCode: '+65', locale: 'en-SG', defaultLanguage: 'en', taxIdLabel: 'UEN', taxName: 'GST' },
  { code: 'MY', name: 'Malaysia', currency: 'MYR', currencyCode: 'RM', timezone: 'Asia/Kuala_Lumpur', dialCode: '+60', locale: 'ms-MY', defaultLanguage: 'en', taxName: 'SST' },
  { code: 'ID', name: 'Indonesia', currency: 'IDR', currencyCode: 'Rp', timezone: 'Asia/Jakarta', dialCode: '+62', locale: 'id-ID', defaultLanguage: 'id', taxIdLabel: 'NPWP', taxName: 'VAT' },
  { code: 'PH', name: 'Philippines', currency: 'PHP', currencyCode: '₱', timezone: 'Asia/Manila', dialCode: '+63', locale: 'en-PH', defaultLanguage: 'en', taxIdLabel: 'TIN', taxName: 'VAT' },
  { code: 'VN', name: 'Vietnam', currency: 'VND', currencyCode: '₫', timezone: 'Asia/Ho_Chi_Minh', dialCode: '+84', locale: 'vi-VN', defaultLanguage: 'vi', taxIdLabel: 'MST', taxName: 'VAT' },
  { code: 'AU', name: 'Australia', currency: 'AUD', currencyCode: 'A$', timezone: 'Australia/Sydney', dialCode: '+61', locale: 'en-AU', defaultLanguage: 'en', taxIdLabel: 'ABN', taxName: 'GST', documentTitle: 'Tax Invoice' },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', currencyCode: 'NZ$', timezone: 'Pacific/Auckland', dialCode: '+64', locale: 'en-NZ', defaultLanguage: 'en', taxIdLabel: 'IRD', taxName: 'GST', documentTitle: 'Tax Invoice' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', currencyCode: 'د.إ', timezone: 'Asia/Dubai', dialCode: '+971', locale: 'ar-AE', defaultLanguage: 'ar', taxIdLabel: 'TRN', taxName: 'VAT', documentTitle: 'Tax Invoice' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', currencyCode: '﷼', timezone: 'Asia/Riyadh', dialCode: '+966', locale: 'ar-SA', defaultLanguage: 'ar', taxIdLabel: 'VAT', taxName: 'VAT', documentTitle: 'Tax Invoice' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', currencyCode: 'R', timezone: 'Africa/Johannesburg', dialCode: '+27', locale: 'en-ZA', defaultLanguage: 'en', taxIdLabel: 'VAT', taxName: 'VAT' },
  { code: 'KE', name: 'Kenya', currency: 'KES', currencyCode: 'KSh', timezone: 'Africa/Nairobi', dialCode: '+254', locale: 'en-KE', defaultLanguage: 'en', taxIdLabel: 'PIN', taxName: 'VAT' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', currencyCode: '₦', timezone: 'Africa/Lagos', dialCode: '+234', locale: 'en-NG', defaultLanguage: 'en', taxIdLabel: 'TIN', taxName: 'VAT' },
  { code: 'BR', name: 'Brazil', currency: 'BRL', currencyCode: 'R$', timezone: 'America/Sao_Paulo', dialCode: '+55', locale: 'pt-BR', defaultLanguage: 'pt', taxIdLabel: 'CNPJ', taxName: 'ICMS', documentTitle: 'Nota Fiscal' },
  { code: 'MX', name: 'Mexico', currency: 'MXN', currencyCode: 'MX$', timezone: 'America/Mexico_City', dialCode: '+52', locale: 'es-MX', defaultLanguage: 'es', taxIdLabel: 'RFC', taxName: 'IVA', documentTitle: 'Factura' },
  { code: 'CL', name: 'Chile', currency: 'CLP', currencyCode: 'CLP$', timezone: 'America/Santiago', dialCode: '+56', locale: 'es-CL', defaultLanguage: 'es', taxIdLabel: 'RUT', taxName: 'IVA', documentTitle: 'Boleta' },
  { code: 'UY', name: 'Uruguay', currency: 'UYU', currencyCode: 'UYU$', timezone: 'America/Montevideo', dialCode: '+598', locale: 'es-UY', defaultLanguage: 'es', taxIdLabel: 'RUT', taxName: 'IVA', documentTitle: 'Comprobante' },
  { code: 'PY', name: 'Paraguay', currency: 'PYG', currencyCode: '₲', timezone: 'America/Asuncion', dialCode: '+595', locale: 'es-PY', defaultLanguage: 'es', taxIdLabel: 'RUC', taxName: 'IVA', documentTitle: 'Comprobante' },
  { code: 'JP', name: 'Japan', currency: 'JPY', currencyCode: '¥', timezone: 'Asia/Tokyo', dialCode: '+81', locale: 'ja-JP', defaultLanguage: 'ja', taxIdLabel: '', taxName: 'VAT' },
  { code: 'KR', name: 'South Korea', currency: 'KRW', currencyCode: '₩', timezone: 'Asia/Seoul', dialCode: '+82', locale: 'ko-KR', defaultLanguage: 'ko', taxIdLabel: 'BRN', taxName: 'VAT' },
  { code: 'CN', name: 'China', currency: 'CNY', currencyCode: '¥', timezone: 'Asia/Shanghai', dialCode: '+86', locale: 'zh-CN', defaultLanguage: 'zh', taxIdLabel: 'USCC', taxName: 'VAT' },
  { code: 'HK', name: 'Hong Kong', currency: 'HKD', currencyCode: 'HK$', timezone: 'Asia/Hong_Kong', dialCode: '+852', locale: 'zh-HK', defaultLanguage: 'zh' },
  { code: 'TW', name: 'Taiwan', currency: 'TWD', currencyCode: 'NT$', timezone: 'Asia/Taipei', dialCode: '+886', locale: 'zh-TW', defaultLanguage: 'zh', taxIdLabel: 'UBN', taxName: 'VAT' },
  { code: 'PK', name: 'Pakistan', currency: 'PKR', currencyCode: 'Rs', timezone: 'Asia/Karachi', dialCode: '+92', locale: 'en-PK', defaultLanguage: 'en', taxIdLabel: 'NTN', taxName: 'GST' },
  { code: 'BD', name: 'Bangladesh', currency: 'BDT', currencyCode: '৳', timezone: 'Asia/Dhaka', dialCode: '+880', locale: 'bn-BD', defaultLanguage: 'en', taxIdLabel: 'TIN', taxName: 'VAT' },
  { code: 'LK', name: 'Sri Lanka', currency: 'LKR', currencyCode: 'Rs', timezone: 'Asia/Colombo', dialCode: '+94', locale: 'en-LK', defaultLanguage: 'en', taxIdLabel: 'TIN', taxName: 'VAT' },
  { code: 'NP', name: 'Nepal', currency: 'NPR', currencyCode: 'Rs', timezone: 'Asia/Kathmandu', dialCode: '+977', locale: 'ne-NP', defaultLanguage: 'en', taxIdLabel: 'TIN', taxName: 'VAT' },
  { code: 'EG', name: 'Egypt', currency: 'EGP', currencyCode: 'E£', timezone: 'Africa/Cairo', dialCode: '+20', locale: 'ar-EG', defaultLanguage: 'ar', taxIdLabel: 'TIN', taxName: 'VAT', documentTitle: 'Tax Invoice' },
  { code: 'IL', name: 'Israel', currency: 'ILS', currencyCode: '₪', timezone: 'Asia/Jerusalem', dialCode: '+972', locale: 'he-IL', defaultLanguage: 'en', taxIdLabel: '', taxName: 'VAT' },
  { code: 'TR', name: 'Turkey', currency: 'TRY', currencyCode: '₺', timezone: 'Europe/Istanbul', dialCode: '+90', locale: 'tr-TR', defaultLanguage: 'en', taxIdLabel: 'VKN', taxName: 'KDV' },
];

export const COUNTRIES: Country[] = RAW_COUNTRIES.sort((a, b) => {
  if (a.code === 'IN') return -1;
  if (b.code === 'IN') return 1;
  if (a.code === 'AR') return -1;
  if (b.code === 'AR') return 1;
  return a.name.localeCompare(b.name);
});

export function getCountryByCode(code: string): Country | undefined {
  return COUNTRIES.find(c => c.code === code);
}

export function getCurrencySymbol(currency: string): string {
  return COUNTRIES.find(c => c.currency === currency)?.currencyCode ?? currency;
}

export function formatCurrency(amount: number, currencyCode: string): string {
  return `${currencyCode} ${amount.toFixed(2)}`;
}
