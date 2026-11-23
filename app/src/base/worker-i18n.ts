/**
 * Minimal, Vue-free translation for code running inside the Atlas web worker
 * (notifications are created there). The worker has no localStorage, so the
 * main thread tells it the current locale (WorkerMessageType.Locale_Change).
 */
import en from '../locales/en/notifications.json';
import pl from '../locales/pl/notifications.json';

type Messages = Record<string, string>;

const dictionaries: Record<string, Messages> = { en, pl };

let locale = 'pl';

export function setWorkerLocale(value: string): void {
    if (dictionaries[value]) locale = value;
}

export function wt(key: string, params: Record<string, string | number | undefined> = {}): string {
    const template = dictionaries[locale]?.[key] ?? dictionaries.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
        return name in params ? String(params[name] ?? '') : match;
    });
}
