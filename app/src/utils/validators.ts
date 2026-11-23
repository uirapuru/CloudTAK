/*
 * Validators in this file are used to Validate TablerInput fields
 * and as such should generally expect to recieve user entered strings
 */

import { t } from '../i18n.ts';

export interface Validator {
    (text: string): string;
}

export function validateJSON(text: string): string {
    if (!text) return '';

    try {
        JSON.parse(text);
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }

    return '';
}

export function validateTextNotEmpty(text: string): string {
    if (!text || !text.trim()) return t('messages.validators.notEmpty');
    return '';
}

export function validateURL(text: string, opts: {
    protocols?: string[];
}= {}): string {
    if (!text) return '';

    if (!opts.protocols) opts.protocols = ['http', 'https']

    if (!opts.protocols.some((p) => {
        return text.startsWith(p + '://')
    })) {
        return t('messages.validators.urlProtocol', { protocols: opts.protocols.map(p => `${p}://`).join(', ') });
    }

    try {
        new URL(text);
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }

    return '';
}

export function validateLatLng(text: string): string {
    const dd = text.split(',').map((d) => {
        return Number(d.trim())
    });

    const errors = [];
    if (dd.length !== 2) errors.push(t('messages.validators.latLngPair'));
    if (isNaN(dd[0])) errors.push(t('messages.validators.latNaN'));
    if (isNaN(dd[1])) errors.push(t('messages.validators.lngNaN'));

    if (dd[0] < -90) errors.push(t('messages.validators.latMin'));
    if (dd[0] > 90) errors.push(t('messages.validators.latMax'));

    if (dd[1] < -180) errors.push(t('messages.validators.lngMin'));
    if (dd[1] > 180) errors.push(t('messages.validators.lngMax'));

    return errors.length ? errors[0] : '';
}
