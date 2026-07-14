export type Language = 'en' | 'es';
import en from './i18n/en.json';
import es from './i18n/es.json';

const translations: Record<Language, Record<string, string>> = { en, es };

const PLURAL_RE = /\{(\w+),\s*plural,\s*((?:\s*(?:zero|one|two|few|many|other)\s*\{[^}]*\})+)\s*\}/g;

function formatIcuPlural(template: string, params: Record<string, string | number>, lang: Language): string {
  return template.replace(PLURAL_RE, (_match, name: string, cases: string) => {
    const raw = Number(params[name] ?? 0);
    const locale = lang === 'es' ? 'es-AR' : 'en';
    const pr = new Intl.PluralRules(locale).select(raw);
    const ordered = ['zero', 'one', 'two', 'few', 'many', 'other'];
    const seen: Record<string, string> = {};
    const caseRe = /(zero|one|two|few|many|other)\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = caseRe.exec(cases)) !== null) seen[m[1]] = m[2];
    let body = seen[pr];
    if (body === undefined) {
      const fallbackIdx = ordered.indexOf(pr) + 1;
      for (let i = fallbackIdx; i < ordered.length; i++) {
        if (seen[ordered[i]] !== undefined) { body = seen[ordered[i]]; break; }
      }
      if (body === undefined) body = seen.other ?? '';
    }
    return body.replace(/#/g, String(raw));
  });
}

export function t(key: string, lang: Language, params?: Record<string, string | number>): string {
  let value = translations[lang]?.[key] ?? translations.en[key] ?? key;
  if (params) {
    value = formatIcuPlural(value, params, lang);
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
