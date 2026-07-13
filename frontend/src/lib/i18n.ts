export type Language = 'en' | 'es';
import en from './i18n/en.json';
import es from './i18n/es.json';

const translations: Record<Language, Record<string, string>> = { en, es };

export function t(key: string, lang: Language, params?: Record<string, string | number>): string {
  let value = translations[lang]?.[key] ?? translations.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return value;
}

export function getBrowserLanguage(): Language {
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('es')) {
    return 'es';
  }
  return 'en';
}
