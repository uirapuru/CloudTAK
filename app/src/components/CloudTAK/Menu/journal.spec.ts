import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import i18n from '../../../i18n.ts';
import {
    accountLabel,
    defaultFilters,
    entryPosition,
    formatWhen,
    isoToZoned,
    journalQuery,
    recipientsLabel,
    totalPages,
    whoLabel,
    zonedToIso,
    type JournalEntry,
} from './journal.ts';

const std = vi.fn();
const downloadUrl = vi.fn(async () => {});
const flyTo = vi.fn();

vi.mock('../../../std.ts', () => ({
    std: (...args: unknown[]) => std(...args),
    stdurl: (u: string) => new URL(u, 'http://localhost:8080'),
    downloadUrl: (...args: unknown[]) => downloadUrl(...(args as [])),
}));

vi.mock('../../../stores/map.ts', () => ({
    useMapStore: () => ({ map: { flyTo, getZoom: () => 10 } }),
}));

vi.mock('@tak-ps/vue-tabler', async (original) => ({
    ...await original<Record<string, unknown>>(),
    TablerModal: { template: '<div class="modal-stub"><slot /></div>' },
}));

const MenuTemplate = defineComponent({
    name: 'MenuTemplate',
    props: { name: { type: String, default: '' }, loading: Boolean },
    setup(_props, { slots }) {
        return () => h('div', [slots.buttons?.(), slots.default?.()]);
    },
});

import MenuJournal from './MenuJournal.vue';

function entry(extra: Partial<JournalEntry> = {}): JournalEntry {
    return {
        id: 1, at: '2026-11-24T17:01:02.123Z', kind: 'chat',
        account: 'niebiescy2', callsign: 'ALFA-1', device_uid: 'ANDROID-1',
        object_uid: null, object_type: 'b-t-f', title: 'Wiadomość prywatna do BRAVO-2',
        text: 'Pierwsza linia\nDruga linia', private: true,
        recipients: [{ callsign: 'BRAVO-2', uid: 'ANDROID-2', account: 'czerwoni1' }],
        chatroom: 'BRAVO-2', lat: 52.1, lon: 21.0, mission: null, file: null,
        ...extra,
    };
}

describe('journal helpers', () => {
    it('reads datetime-local as Europe/Warsaw time in winter and summer', () => {
        expect(zonedToIso('2026-11-24T10:00')).toBe('2026-11-24T09:00:00.000Z');
        expect(zonedToIso('2026-07-01T10:00')).toBe('2026-07-01T08:00:00.000Z');
        expect(zonedToIso('2026-10-25T01:30')).toBe('2026-10-24T23:30:00.000Z');
        expect(zonedToIso('wczoraj')).toBeNull();
        expect(isoToZoned(Date.parse('2026-11-24T09:00:00Z'))).toBe('2026-11-24T10:00');
        expect(isoToZoned(Date.parse('2026-07-01T08:00:00Z'))).toBe('2026-07-01T10:00');
    });

    it('defaults to the last 24 hours without movement', () => {
        const now = Date.parse('2026-11-24T12:00:00Z');
        const f = defaultFilters(now);
        expect(f).toEqual({ since: '2026-11-23T13:00', until: '2026-11-24T13:00', account: '', kind: '', q: '', positions: false });
        expect(journalQuery(f, 2, 50)).toEqual({
            since: '2026-11-23T12:00:00.000Z', until: '2026-11-24T12:00:00.000Z', positions: 'false', page: '2', per_page: '50',
        });
    });

    it('sends only set filters and known kinds', () => {
        const q = journalQuery({ since: '', until: '', account: ' alfa ', kind: 'chat', q: ' rozkaz ', positions: true });
        expect(q).toEqual({ account: 'alfa', kind: 'chat', q: 'rozkaz', positions: 'true' });
        expect(journalQuery({ since: 'x', until: '', account: '', kind: 'bogus', q: '', positions: false })).toEqual({ positions: 'false' });
    });

    it('formats time in Europe/Warsaw, people as "znak (konto)" and positions', () => {
        expect(formatWhen('2026-11-24T17:01:02.123Z')).toBe('24.11.2026, 18:01:02');
        expect(formatWhen('nie-data')).toBe('nie-data');
        expect(whoLabel('ALFA-1', 'niebiescy2')).toBe('ALFA-1 (niebiescy2)');
        expect(whoLabel('alfa', 'alfa')).toBe('alfa');
        expect(whoLabel(null, 'alfa')).toBe('alfa');
        expect(whoLabel(null, null)).toBeNull();
        expect(recipientsLabel([{ callsign: 'BRAVO-2', uid: 'U2', account: 'czerwoni1' }, { callsign: null, uid: 'U3', account: null }])).toBe('BRAVO-2 (czerwoni1), U3');
        expect(entryPosition({ lat: 52.1, lon: 21 })).toEqual([21, 52.1]);
        expect(entryPosition({ lat: null, lon: 21 })).toBeNull();
        expect(entryPosition({ lat: 95, lon: 21 })).toBeNull();
        expect(totalPages(0, 50)).toBe(1);
        expect(totalPages(101, 50)).toBe(3);
        expect(accountLabel({ account: 'niebiescy2', callsigns: ['ALFA-1', 'niebiescy2'] })).toBe('niebiescy2 (ALFA-1)');
        expect(accountLabel({ account: 'alfa', callsigns: [] })).toBe('alfa');
    });
});

describe('MenuJournal', () => {
    let list: () => unknown;
    let estimate: () => unknown;

    beforeEach(() => {
        i18n.global.locale.value = 'pl';
        std.mockReset();
        downloadUrl.mockClear();
        flyTo.mockClear();
        list = () => ({ items: [], total: 0, page: 1, per_page: 50 });
        estimate = () => ({ entries: 120, files: 3, bytes: 3 * 1024 ** 3, missing: 1 });
        std.mockImplementation(async (url: unknown) => {
            const u = new URL(String(url), 'http://localhost:8080');
            if (u.pathname === '/api/journal/accounts') return { accounts: [{ account: 'niebiescy2', callsigns: ['ALFA-1'] }] };
            if (u.pathname === '/api/journal/export/estimate') return estimate();
            if (u.pathname === '/api/journal') return list();
            throw new Error(`unexpected ${u.pathname}`);
        });
    });

    afterEach(() => {
        i18n.global.locale.value = 'en';
    });

    function mountMenu() {
        return mount(MenuJournal, { global: { stubs: { MenuTemplate } } });
    }

    function calls(path: string): URL[] {
        return std.mock.calls
            .map((c) => new URL(String(c[0]), 'http://localhost:8080'))
            .filter((u) => u.pathname === path);
    }

    it('asks for the last 24 hours without movement, oldest first from OTS', async () => {
        const wrapper = mountMenu();
        await flushPromises();
        const first = calls('/api/journal')[0];
        expect(first.searchParams.get('positions')).toBe('false');
        expect(first.searchParams.get('page')).toBe('1');
        const since = Date.parse(first.searchParams.get('since') || '');
        const until = Date.parse(first.searchParams.get('until') || '');
        expect(until - since).toBeGreaterThanOrEqual(24 * 3600_000 - 60_000);
        expect(until - since).toBeLessThanOrEqual(24 * 3600_000 + 60_000);
        expect(wrapper.text()).toContain('Brak wpisów w tym zakresie');
        expect(wrapper.text()).toContain('niebiescy2 (ALFA-1)');
        expect(wrapper.text()).toContain('Udostępnienie wideo');
    });

    it('shows time, "znak (konto)", full chat text, private marker with recipients, file and map button', async () => {
        list = () => ({
            items: [
                entry(),
                entry({
                    id: 2, kind: 'file_upload', private: false, recipients: [], chatroom: null, text: null,
                    title: 'Paczka danych', lat: null, lon: null,
                    file: { source: 'data_package', ref: 'h1', filename: 'zdjecie.jpg', size: 2048, mime: 'image/jpeg', available: false },
                }),
                entry({ id: 3, kind: 'disconnect', account: null, callsign: null, private: false, recipients: [], chatroom: null, title: 'Rozłączenie', text: null, lat: null, lon: null }),
            ],
            total: 3, page: 1, per_page: 50,
        });
        const wrapper = mountMenu();
        await flushPromises();

        const rows = wrapper.findAll('[data-entry]');
        expect(rows).toHaveLength(3);
        const chat = rows[0];
        expect(chat.text()).toContain('24.11.2026, 18:01:02');
        expect(chat.text()).toContain('ALFA-1 (niebiescy2)');
        expect(chat.text()).toContain('Wiadomość prywatna do BRAVO-2');
        expect(chat.find('.journal-text').text()).toBe('Pierwsza linia\nDruga linia');
        expect(chat.find('[data-testid="journal-private"]').text()).toBe('Prywatna');
        expect(chat.text()).toContain('Do: BRAVO-2 (czerwoni1)');

        expect(rows[1].text()).toContain('zdjecie.jpg');
        expect(rows[1].text()).toContain('2,0 KB');
        expect(rows[1].text()).toContain('niedostępny');
        expect(rows[1].find('[data-testid="journal-private"]').exists()).toBe(false);
        expect(rows[2].text()).toContain('serwer');

        expect(chat.find('[title="Pokaż na mapie"]').exists()).toBe(true);
        expect(rows[1].find('[title="Pokaż na mapie"]').exists()).toBe(false);
        await chat.find('[title="Pokaż na mapie"]').trigger('click');
        expect(flyTo).toHaveBeenCalledWith({ center: [21, 52.1], zoom: 15 });
    });

    it('pages through the journal', async () => {
        list = () => ({ items: [entry()], total: 120, page: 1, per_page: 50 });
        const wrapper = mountMenu();
        await flushPromises();
        expect(wrapper.text()).toContain('Strona 1 z 3');
        list = () => ({ items: [entry({ id: 51 })], total: 120, page: 2, per_page: 50 });
        await wrapper.find('[title="Następna strona"]').trigger('click');
        await flushPromises();
        expect(calls('/api/journal').at(-1)?.searchParams.get('page')).toBe('2');
        expect(wrapper.text()).toContain('Strona 2 z 3');
    });

    it('shows the estimate before the ZIP and downloads only after confirmation, with the token', async () => {
        const wrapper = mountMenu();
        await flushPromises();
        await wrapper.find('[data-testid="journal-export-zip"]').trigger('click');
        await flushPromises();
        const box = wrapper.find('[data-testid="journal-zip-estimate"]');
        expect(box.text()).toContain('Wpisów: 120');
        expect(box.text()).toContain('Plików: 3, łącznie 3,0 GB');
        expect(box.text()).toContain('nie ma już na serwerze: 1');
        expect(downloadUrl).not.toHaveBeenCalled();

        await wrapper.find('[data-testid="journal-zip-confirm"]').trigger('click');
        await flushPromises();
        expect(downloadUrl).toHaveBeenCalledTimes(1);
        const [target, opts] = downloadUrl.mock.calls[0] as unknown as [URL, { token: boolean }];
        expect(target.pathname).toBe('/api/journal/export.zip');
        expect(target.searchParams.get('positions')).toBe('false');
        expect(target.searchParams.get('page')).toBeNull();
        expect(opts).toEqual({ token: true });
        expect(wrapper.find('[data-testid="journal-zip-estimate"]').exists()).toBe(false);
    });

    it('downloads the PDF with the filters, but refuses a filter over the PDF limit', async () => {
        const wrapper = mountMenu();
        await flushPromises();
        await wrapper.find('[data-testid="journal-export-pdf"]').trigger('click');
        await flushPromises();
        const [target] = downloadUrl.mock.calls[0] as unknown as [URL];
        expect(target.pathname).toBe('/api/journal/export.pdf');
        expect(target.searchParams.get('since')).not.toBeNull();

        estimate = () => ({ entries: 25_000, files: 0, bytes: 0, missing: 0 });
        await wrapper.find('[data-testid="journal-export-pdf"]').trigger('click');
        await flushPromises();
        expect(downloadUrl).toHaveBeenCalledTimes(1);
        expect(wrapper.text()).toContain('25000 wpisów');
    });

    it('shows the OTS refusal instead of the list', async () => {
        list = () => { throw new Error('Dziennik jest dostępny tylko dla administratora serwera'); };
        const wrapper = mountMenu();
        await flushPromises();
        expect(wrapper.text()).toContain('tylko dla administratora');
        expect(wrapper.findAll('[data-entry]')).toHaveLength(0);
    });
});
