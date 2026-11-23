import { describe, it, expect, afterEach } from 'vitest';
import { wt, setWorkerLocale } from '../base/worker-i18n.ts';

describe('worker-i18n', () => {
    afterEach(() => setWorkerLocale('pl'));

    it('defaults to Polish', () => {
        expect(wt('chatTitle')).toBe('Nowa wiadomość');
    });

    it('switches language and interpolates', () => {
        setWorkerLocale('en');
        expect(wt('contactOnlineBody', { callsign: 'ALFA' })).toBe('ALFA is now Online');
    });

    it('ignores unknown locales and keys', () => {
        setWorkerLocale('xx');
        expect(wt('missionFileBody', { file: 'a.kml' })).toBe('Plik a.kml');
        expect(wt('no.such.key')).toBe('no.such.key');
    });

    it('renders a missing value as empty text', () => {
        expect(wt('alertCreated', { callsign: undefined })).toBe('Alarm: ');
    });
});
