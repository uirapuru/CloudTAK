import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import i18n from '../../../i18n.ts';
import { zonedToIso } from './journal.ts';
import {
    defaultForm,
    feedRange,
    formProblem,
    reportButtonVisible,
    reportEnabled,
    reportUrl,
    toRequest,
    type ReportJob,
} from '../../../base/report.ts';

const std = vi.fn();
const downloadUrl = vi.fn(async () => {});
const route = reactive<{ query: Record<string, string> }>({ query: {} });
let subscriptions: unknown[] = [];

vi.mock('../../../std.ts', () => ({
    std: (...args: unknown[]) => std(...args),
    stdurl: (u: string) => new URL(u, 'http://localhost:8080'),
    downloadUrl: (...args: unknown[]) => downloadUrl(...(args as [])),
}));

vi.mock('../../../database.ts', () => ({
    db: {
        subscription: {
            filter: (fn: (s: unknown) => boolean) => ({ toArray: async () => subscriptions.filter(fn) }),
        },
    },
}));

// TablerDelete asks for confirmation; the stub deletes on the first click.
vi.mock('@tak-ps/vue-tabler', async (original) => ({
    ...await original<Record<string, unknown>>(),
    TablerDelete: {
        emits: ['delete'],
        template: '<button data-testid="report-delete" @click="$emit(\'delete\')" />',
    },
}));

vi.mock('vue-router', async (original) => ({
    ...await original<Record<string, unknown>>(),
    useRoute: () => route,
}));

const MenuTemplate = defineComponent({
    name: 'MenuTemplate',
    props: { name: { type: String, default: '' }, loading: Boolean },
    setup(_props, { slots }) {
        return () => h('div', [slots.buttons?.(), slots.default?.()]);
    },
});

import MenuReport from './MenuReport.vue';

const CREATED = '2026-11-20T08:00:00.000Z';

function sub(name: string, extra: Record<string, unknown> = {}) {
    return { guid: name, subscribed: true, meta: { name, guid: name, createTime: CREATED, passwordProtected: false, ...extra } };
}

function job(extra: Partial<ReportJob> = {}): ReportJob {
    return {
        id: 'a'.repeat(32), scope: 'environment', mission: null,
        since: '2026-11-23T09:00:00Z', until: '2026-11-24T09:00:00Z',
        status: 'done', error: null, created: '2026-11-24T09:00:01Z', finished: '2026-11-24T09:01:00Z',
        owner: 'niebiescy2', ...extra,
    };
}

describe('report helpers', () => {
    it('defaults to the whole environment and the last 24 hours', () => {
        const now = Date.parse('2026-11-24T12:00:00Z');
        expect(defaultForm(now)).toEqual({
            scope: 'environment', mission: '', password: '',
            since: '2026-11-23T13:00', until: '2026-11-24T13:00', basemap: 'osm',
        });
    });

    it('takes a feed range from its creation, or 24 hours without it', () => {
        const now = Date.parse('2026-11-24T12:00:00Z');
        expect(feedRange({ name: 'f', createTime: CREATED, passwordProtected: false }, now))
            .toEqual({ since: '2026-11-20T09:00', until: '2026-11-24T13:00' });
        expect(feedRange({ name: 'f', createTime: null, passwordProtected: false }, now).since).toBe('2026-11-23T13:00');
    });

    it('starts an old feed 7 days before now, not at its creation', () => {
        const now = Date.parse('2026-11-24T12:00:00Z');
        const range = feedRange({ name: 'f', createTime: '2026-10-01T08:00:00Z', passwordProtected: false }, now);
        expect(range).toEqual({ since: '2026-11-17T13:00', until: '2026-11-24T13:00' });
        expect(formProblem({ ...defaultForm(now), scope: 'mission', mission: 'f', ...range })).toBeNull();
    });

    it('offers the button in the feed view only for a subscribed feed with reports enabled', () => {
        expect(reportButtonVisible({ subscribed: true }, true)).toBe(true);
        expect(reportButtonVisible({ subscribed: false }, true)).toBe(false);
        expect(reportButtonVisible(undefined, true)).toBe(false);
        expect(reportButtonVisible({ subscribed: true }, false)).toBe(false);
    });

    it('refuses a missing feed, a reversed range and more than 7 days', () => {
        const base = defaultForm(Date.parse('2026-11-24T12:00:00Z'));
        expect(formProblem(base)).toBeNull();
        expect(formProblem({ ...base, scope: 'mission' })).toBe('report.problems.noFeed');
        expect(formProblem({ ...base, since: base.until, until: base.since })).toBe('report.problems.order');
        expect(formProblem({ ...base, since: '2026-11-10T10:00' })).toBe('report.problems.tooLong');
        expect(formProblem({ ...base, since: '' })).toBe('report.problems.noRange');
    });

    it('sends the password only for a protected feed and never for the environment', () => {
        const form = { ...defaultForm(), scope: 'mission' as const, mission: 'Alfa', password: 'tajne' };
        expect(toRequest(form, { name: 'Alfa', createTime: null, passwordProtected: true }).mission_password).toBe('tajne');
        expect(toRequest(form, { name: 'Alfa', createTime: null, passwordProtected: false }).mission_password).toBeUndefined();
        const env = toRequest({ ...form, scope: 'environment' }, undefined);
        expect(env.mission).toBeUndefined();
        expect(env.mission_password).toBeUndefined();
        expect(env.since).toBe(zonedToIso(form.since));
    });

    it('builds the download path without the token', () => {
        expect(reportUrl('ab'.repeat(16), 'pdf')).toBe(`/api/report/${'ab'.repeat(16)}.pdf`);
        expect(reportUrl('ab'.repeat(16), 'txt')).toBe(`/api/report/${'ab'.repeat(16)}.txt`);
    });

    it('is enabled unless CloudTAK answers 404 or there is no HTTP answer', async () => {
        std.mockResolvedValueOnce({ items: [] });
        expect(await reportEnabled()).toBe(true);
        std.mockRejectedValueOnce(Object.assign(new Error('Raport misji nie jest włączony'), { body: { status: 404 } }));
        expect(await reportEnabled()).toBe(false);
        std.mockRejectedValueOnce(Object.assign(new Error('Usługa raportów nie odpowiada'), { body: { status: 502 } }));
        expect(await reportEnabled()).toBe(true);
        std.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        expect(await reportEnabled()).toBe(false);
    });
});

describe('MenuReport', () => {
    let list: () => unknown;

    beforeEach(() => {
        vi.useRealTimers();
        i18n.global.locale.value = 'pl';
        std.mockReset();
        downloadUrl.mockClear();
        route.query = {};
        subscriptions = [sub('Alfa'), sub('Bravo', { passwordProtected: true }), { ...sub('Stary'), subscribed: false }];
        list = () => ({ items: [] });
        std.mockImplementation(async (url: unknown, opts?: { method?: string }) => {
            const u = new URL(String(url), 'http://localhost:8080');
            if (u.pathname === '/api/report' && !opts?.method) return list();
            if (u.pathname === '/api/report' && opts?.method === 'POST') return { id: 'b'.repeat(32), status: 'queued' };
            if (u.pathname.startsWith('/api/report/') && opts?.method === 'DELETE') return { deleted: true };
            throw new Error(`unexpected ${opts?.method || 'GET'} ${u.pathname}`);
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        i18n.global.locale.value = 'en';
    });

    function mountMenu() {
        return mount(MenuReport, { global: { stubs: { MenuTemplate } } });
    }

    function posted(): Record<string, unknown> {
        const call = std.mock.calls.find((c) => (c[1] as { method?: string } | undefined)?.method === 'POST');
        return (call?.[1] as { body: Record<string, unknown> }).body;
    }

    it('orders the whole environment for the last 24 hours by default', async () => {
        const wrapper = mountMenu();
        await flushPromises();
        expect(wrapper.find('[data-testid="report-password"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('Nie ma jeszcze raportów');
        await wrapper.find('[data-testid="report-create"]').trigger('click');
        await flushPromises();
        const body = posted();
        expect(body.scope).toBe('environment');
        expect(body.mission).toBeUndefined();
        expect(body.basemap).toBe('osm');
        const span = Date.parse(String(body.until)) - Date.parse(String(body.since));
        expect(span).toBeGreaterThanOrEqual(24 * 3600_000 - 60_000);
        expect(span).toBeLessThanOrEqual(24 * 3600_000 + 60_000);
        expect(wrapper.text()).toContain('Raport jest w kolejce');
    });

    it('takes the feed from the address: scope feed, start at the feed creation', async () => {
        vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-11-24T12:00:00Z') });
        route.query = { mission: 'Alfa' };
        const wrapper = mountMenu();
        await flushPromises();
        const select = wrapper.find('[data-testid="report-feed"] select');
        expect((select.element as HTMLSelectElement).value).toBe('Alfa');
        expect(wrapper.findAll('[data-testid="report-feed"] option').map((o) => o.text())).toEqual(['Alfa', 'Bravo']);
        const since = wrapper.find('[data-testid="report-since"] input').element as HTMLInputElement;
        expect(zonedToIso(since.value)).toBe(CREATED);
    });

    it('shows the password field only for a protected feed and does not keep the password', async () => {
        // Four days after the feed was created: its whole range fits in 7 days.
        vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-11-24T12:00:00Z') });
        route.query = { mission: 'Alfa' };
        const wrapper = mountMenu();
        await flushPromises();
        expect(wrapper.find('[data-testid="report-password"]').exists()).toBe(false);

        await wrapper.find('[data-testid="report-feed"] select').setValue('Bravo');
        await flushPromises();
        const field = wrapper.find('[data-testid="report-password"] input');
        expect(field.exists()).toBe(true);
        expect(field.attributes('type')).toBe('password');
        await field.setValue('tajne');
        await wrapper.find('[data-testid="report-create"]').trigger('click');
        await flushPromises();
        expect(posted()).toMatchObject({ scope: 'mission', mission: 'Bravo', mission_password: 'tajne' });
        expect((wrapper.find('[data-testid="report-password"] input').element as HTMLInputElement).value).toBe('');
        expect(JSON.stringify(localStorage)).not.toContain('tajne');
    });

    it('does not preselect a feed from the address that is not subscribed', async () => {
        route.query = { mission: 'Stary' };
        const wrapper = mountMenu();
        await flushPromises();
        expect(wrapper.find('[data-testid="report-unknown-feed"]').text())
            .toBe('Feed „Stary” nie jest na liście subskrybowanych. Zasubskrybuj go, żeby zamówić raport.');
        expect(wrapper.findAll('[data-testid="report-feed"] option').map((o) => o.text())).toEqual(['Wybierz feed', 'Alfa', 'Bravo']);
        expect((wrapper.find('[data-testid="report-feed"] select').element as HTMLSelectElement).value).toBe('');
        expect(wrapper.find('[data-testid="report-create"]').attributes('disabled')).toBeDefined();
        await wrapper.find('[data-testid="report-create"]').trigger('click');
        await flushPromises();
        expect(std.mock.calls.some((c) => (c[1] as { method?: string } | undefined)?.method === 'POST')).toBe(false);

        // Choosing a subscribed feed clears the message and allows the order.
        await wrapper.find('[data-testid="report-feed"] select').setValue('Alfa');
        await flushPromises();
        expect(wrapper.find('[data-testid="report-unknown-feed"]').exists()).toBe(false);
    });

    it('blocks a range over 7 days with a message', async () => {
        route.query = { mission: 'Alfa' };
        const wrapper = mountMenu();
        await flushPromises();
        await wrapper.find('[data-testid="report-since"] input').setValue('2026-01-01T00:00');
        expect(wrapper.find('[data-testid="report-problem"]').text()).toContain('dłuższy niż 7 dni');
        expect(wrapper.find('[data-testid="report-create"]').attributes('disabled')).toBeDefined();
    });

    it('shows the status, the reason of a failure and downloads only finished reports with the token', async () => {
        list = () => ({
            items: [
                job(),
                job({ id: 'c'.repeat(32), scope: 'mission', mission: 'Alfa', status: 'failed', error: 'Złe hasło feedu.', finished: null }),
                job({ id: 'd'.repeat(32), status: 'running', finished: null }),
            ],
        });
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const wrapper = mountMenu();
        await flushPromises();
        expect(wrapper.text()).toContain('Raporty');
        expect(wrapper.text()).not.toContain('Twoje raporty');

        const rows = wrapper.findAll('[data-job]');
        expect(rows).toHaveLength(3);
        expect(rows[0].find('[data-testid="report-status"]').text()).toBe('Gotowy');
        expect(rows[0].text()).toContain('Całe środowisko');
        expect(rows[0].text()).toContain('23.11.2026, 10:00:00 – 24.11.2026, 10:00:00');
        expect(rows[0].text()).toContain('Zamówił: niebiescy2');
        expect(rows[1].text()).toContain('Feed: Alfa');
        expect(rows[1].find('[data-testid="report-error"]').text()).toBe('Złe hasło feedu.');
        expect(rows[2].find('[data-testid="report-status"]').text()).toBe('W przygotowaniu');
        expect(rows[0].find('[data-testid="report-pdf"]').exists()).toBe(true);
        expect(rows[1].find('[data-testid="report-pdf"]').exists()).toBe(false);
        expect(rows[2].find('[data-testid="report-txt"]').exists()).toBe(false);

        await rows[0].find('[data-testid="report-pdf"]').trigger('click');
        await rows[0].find('[data-testid="report-txt"]').trigger('click');
        expect(downloadUrl).toHaveBeenNthCalledWith(1, `/api/report/${'a'.repeat(32)}.pdf`, { token: true });
        expect(downloadUrl).toHaveBeenNthCalledWith(2, `/api/report/${'a'.repeat(32)}.txt`, { token: true });
        wrapper.unmount();
    });

    it('polls every 5 s only while a report is queued or running and the menu is open', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        list = () => ({ items: [job({ status: 'queued', finished: null })] });
        const wrapper = mountMenu();
        await flushPromises();
        const count = () => std.mock.calls.filter((c) => !(c[1] as { method?: string } | undefined)?.method).length;
        expect(count()).toBe(1);

        await vi.advanceTimersByTimeAsync(5_000);
        expect(count()).toBe(2);

        list = () => ({ items: [job()] });
        await vi.advanceTimersByTimeAsync(5_000);
        expect(count()).toBe(3);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(count()).toBe(3);

        list = () => ({ items: [job({ status: 'running', finished: null })] });
        await wrapper.find('[title="Odśwież"]').trigger('click');
        await flushPromises();
        expect(count()).toBe(4);
        wrapper.unmount();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(count()).toBe(4);
    });

    it('shows the refusal of the service', async () => {
        list = () => { throw new Error('Masz już 3 raporty w kolejce. Poczekaj, aż któryś się skończy.'); };
        const wrapper = mountMenu();
        await flushPromises();
        expect(wrapper.text()).toContain('Masz już 3 raporty w kolejce');
    });

    it('deletes a report and reloads the list', async () => {
        list = () => ({ items: [job()] });
        const wrapper = mountMenu();
        await flushPromises();
        const before = std.mock.calls.length;
        await wrapper.find('[data-testid="report-delete"]').trigger('click');
        await flushPromises();
        expect(std.mock.calls.at(-1)?.[0]).toBe('/api/report');
        expect(std.mock.calls.length).toBe(before + 2);
        expect(std.mock.calls.some((c) => c[0] === `/api/report/${'a'.repeat(32)}` && (c[1] as { method?: string }).method === 'DELETE')).toBe(true);
    });
});
