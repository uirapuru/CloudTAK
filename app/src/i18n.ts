import { createI18n, type I18nOptions } from 'vue-i18n';

// Messages live in one JSON file per area: locales/<locale>/<area>.json.
// The file name becomes the top-level key, e.g. settings.json -> t('settings.…').
type Messages = Record<string, unknown>;

function load(files: Record<string, { default: Messages }>): Messages {
    const messages: Messages = {};
    for (const [path, mod] of Object.entries(files)) {
        const area = path.split('/').pop()!.replace(/\.json$/, '');
        messages[area] = mod.default;
    }
    return messages;
}

const en = load(import.meta.glob<{ default: Messages }>('./locales/en/*.json', { eager: true }));
const pl = load(import.meta.glob<{ default: Messages }>('./locales/pl/*.json', { eager: true }));

export const LOCALES = [
    { value: 'pl', label: 'Polski' },
    { value: 'en', label: 'English' },
] as const;

export type Locale = typeof LOCALES[number]['value'];

export const DEFAULT_LOCALE: Locale = 'pl';
export const LOCALE_STORAGE_KEY = 'cloudtak-locale';

function isLocale(value: unknown): value is Locale {
    return LOCALES.some((l) => l.value === value);
}

export function storedLocale(): Locale {
    try {
        const value = localStorage.getItem(LOCALE_STORAGE_KEY);
        if (isLocale(value)) return value;
    } catch {
        // localStorage unavailable (private mode, worker) - fall back to default
    }
    return DEFAULT_LOCALE;
}

const messages = { pl, en } as I18nOptions['messages'];

const i18n = createI18n<false, I18nOptions>({
    legacy: false,
    globalInjection: true,
    locale: storedLocale(),
    fallbackLocale: 'en',
    messages,
});

export function setLocale(locale: Locale): void {
    i18n.global.locale.value = locale;
    document.documentElement.setAttribute('lang', locale);
    try {
        localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
        // ignore - the choice simply does not persist
    }
}

export function currentLocale(): Locale {
    return i18n.global.locale.value as Locale;
}

/** Translate outside of components (stores, base modules, notifications). */
export const t = i18n.global.t;

export default i18n;
