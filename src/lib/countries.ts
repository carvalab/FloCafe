export interface Country {
  code: string;
  name: string;
  currency: string;
  currencyCode: string;
  timezone: string;
}

export const COUNTRIES: Country[] = [
  { code: 'IN', name: 'India', currency: 'INR', currencyCode: '₹', timezone: 'Asia/Kolkata' },
  { code: 'US', name: 'United States', currency: 'USD', currencyCode: '$', timezone: 'America/New_York' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', currencyCode: '£', timezone: 'Europe/London' },
  { code: 'EU', name: 'European Union', currency: 'EUR', currencyCode: '€', timezone: 'Europe/Paris' },
  { code: 'TH', name: 'Thailand', currency: 'THB', currencyCode: '฿', timezone: 'Asia/Bangkok' },
  { code: 'SG', name: 'Singapore', currency: 'SGD', currencyCode: 'S$', timezone: 'Asia/Singapore' },
  { code: 'MY', name: 'Malaysia', currency: 'MYR', currencyCode: 'RM', timezone: 'Asia/Kuala_Lumpur' },
  { code: 'ID', name: 'Indonesia', currency: 'IDR', currencyCode: 'Rp', timezone: 'Asia/Jakarta' },
  { code: 'PH', name: 'Philippines', currency: 'PHP', currencyCode: '₱', timezone: 'Asia/Manila' },
  { code: 'VN', name: 'Vietnam', currency: 'VND', currencyCode: '₫', timezone: 'Asia/Ho_Chi_Minh' },
  { code: 'AU', name: 'Australia', currency: 'AUD', currencyCode: 'A$', timezone: 'Australia/Sydney' },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', currencyCode: 'NZ$', timezone: 'Pacific/Auckland' },
  { code: 'AE', name: 'UAE', currency: 'AED', currencyCode: 'د.إ', timezone: 'Asia/Dubai' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', currencyCode: '﷼', timezone: 'Asia/Riyadh' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', currencyCode: 'R', timezone: 'Africa/Johannesburg' },
  { code: 'KE', name: 'Kenya', currency: 'KES', currencyCode: 'KSh', timezone: 'Africa/Nairobi' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', currencyCode: '₦', timezone: 'Africa/Lagos' },
  { code: 'BR', name: 'Brazil', currency: 'BRL', currencyCode: 'R$', timezone: 'America/Sao_Paulo' },
  { code: 'MX', name: 'Mexico', currency: 'MXN', currencyCode: 'MX$', timezone: 'America/Mexico_City' },
  { code: 'CA', name: 'Canada', currency: 'CAD', currencyCode: 'C$', timezone: 'America/Toronto' },
  { code: 'JP', name: 'Japan', currency: 'JPY', currencyCode: '¥', timezone: 'Asia/Tokyo' },
  { code: 'KR', name: 'South Korea', currency: 'KRW', currencyCode: '₩', timezone: 'Asia/Seoul' },
  { code: 'CN', name: 'China', currency: 'CNY', currencyCode: '¥', timezone: 'Asia/Shanghai' },
  { code: 'HK', name: 'Hong Kong', currency: 'HKD', currencyCode: 'HK$', timezone: 'Asia/Hong_Kong' },
  { code: 'TW', name: 'Taiwan', currency: 'TWD', currencyCode: 'NT$', timezone: 'Asia/Taipei' },
  { code: 'PK', name: 'Pakistan', currency: 'PKR', currencyCode: '₨', timezone: 'Asia/Karachi' },
  { code: 'BD', name: 'Bangladesh', currency: 'BDT', currencyCode: '৳', timezone: 'Asia/Dhaka' },
  { code: 'LK', name: 'Sri Lanka', currency: 'LKR', currencyCode: 'Rs', timezone: 'Asia/Colombo' },
  { code: 'NP', name: 'Nepal', currency: 'NPR', currencyCode: '₨', timezone: 'Asia/Kathmandu' },
  { code: 'EG', name: 'Egypt', currency: 'EGP', currencyCode: 'E£', timezone: 'Africa/Cairo' },
  { code: 'IL', name: 'Israel', currency: 'ILS', currencyCode: '₪', timezone: 'Asia/Jerusalem' },
  { code: 'TR', name: 'Turkey', currency: 'TRY', currencyCode: '₺', timezone: 'Europe/Istanbul' },
];

export function getCountryByCode(code: string): Country | undefined {
  return COUNTRIES.find(c => c.code === code);
}

export function getCurrencySymbol(currency: string): string {
  return COUNTRIES.find(c => c.currency === currency)?.currencyCode ?? currency;
}

export function formatCurrency(amount: number, currencyCode: string): string {
  return `${currencyCode} ${amount.toFixed(2)}`;
}
