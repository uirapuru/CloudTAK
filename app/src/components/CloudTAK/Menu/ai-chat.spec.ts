import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import i18n from '../../../i18n.ts';
import { zonedToIso } from './journal.ts';
import {
    aiChatEnabled,
    botChatPath,
    defaultOrderForm,
    findBotContact,
    mapObjects,
    modelAction,
    modelChanging,
    orderProblem,
    orderUrl,
    thinRoute,
    toOrderRequest,
    type AiModel,
    type AiOrder,
    type LngLat,
} from '../../../base/ai-chat.ts';

const std = vi.fn();
const downloadUrl = vi.fn(async () => {});
const push = vi.fn(async () => {});
let contacts: Array<{ uid: string; callsign: string }> = [];
let features: unknown[] = [];
const filter = vi.fn(async () => new Set(features));

vi.mock('../../../std.ts', () => ({
    std: (...args: unknown[]) => std(...args),
    stdurl: (u: string) => new URL(u, 'http://localhost:8080'),
    downloadUrl: (...args: unknown[]) => downloadUrl(...(args as [])),
}));

vi.mock('../../../base/contact.ts', () => ({
    default: { list: async () => contacts },
}));

vi.mock('../../../stores/map.ts', () => ({
    useMapStore: () => ({ worker: { db: { filter } } }),
}));

// TablerDelete asks for confirmation; the stub deletes on the first click.
vi.mock('@tak-ps/vue-tabler', async (original) => ({
    ...await original<Record<string, unknown>>(),
    TablerDelete: {
        emits: ['delete'],
        template: '<button data-testid="ai-order-delete" @click="$emit(\'delete\')" />',
    },
}));

vi.mock('vue-router', async (original) => ({
    ...await original<Record<string, unknown>>(),
    useRouter: () => ({ push }),
}));

const MenuTemplate = defineComponent({
    name: 'MenuTemplate',
    props: { name: { type: String, default: '' }, loading: Boolean },
    setup(_props, { slots }) {
        return () => h('div', [slots.buttons?.(), slots.default?.()]);
    },
});

import MenuAiChat from './MenuAiChat.vue';

const ROUTE: LngLat[] = [[17.03, 51.1], [17.04, 51.11], [17.05, 51.12]];

function order(extra: Partial<AiOrder> = {}): AiOrder {
    return {
        id: 'a'.repeat(32), status: 'done', error: null,
        created: '2026-11-25T09:00:01Z', finished: '2026-11-25T09:03:00Z', owner: 'administrator',
        format: 'pdf', title: 'Natarcie na Kijewo', start: '2026-11-26T05:00:00Z',
        has_location: true, weather_ok: true, terrain_ok: true, ...extra,
    };
}

function feature(id: string, callsign: string, type: string, coordinates: unknown) {
    return { id, properties: { callsign, archived: true }, geometry: { type, coordinates } };
}

describe('ai-chat helpers', () => {
    it('defaults to H hour now, PDF and the place from the text', () => {
        const now = Date.parse('2026-11-25T12:00:00Z');
        expect(defaultOrderForm(now)).toEqual({ text: '', title: '', start: '2026-11-25T13:00', format: 'pdf', location: '' });
    });

    it('refuses empty text, too long text or title and a missing H hour', () => {
        const base = { ...defaultOrderForm(), text: 'Dane.' };
        expect(orderProblem(base)).toBeNull();
        expect(orderProblem({ ...base, text: '   ' })).toBe('aiChat.problems.noText');
        expect(orderProblem({ ...base, text: 'x'.repeat(20_001) })).toBe('aiChat.problems.textTooLong');
        expect(orderProblem({ ...base, title: 'x'.repeat(121) })).toBe('aiChat.problems.titleTooLong');
        expect(orderProblem({ ...base, start: '' })).toBe('aiChat.problems.noStart');
    });

    it('offers routes and points of the map, sorted by name, without broken geometry', () => {
        const objects = mapObjects([
            feature('r1', 'Trasa Bravo', 'LineString', [[17.03, 51.1, 120], [17.05, 51.12]]),
            feature('p1', 'Alfa', 'Point', [17.0, 51.0, 100]),
            feature('p2', '', 'Point', [999, 51]),
            feature('r2', 'Krótka', 'LineString', [[17, 51]]),
            feature('s1', 'Strefa', 'Polygon', [[[17, 51], [17.1, 51], [17.1, 51.1], [17, 51]]]),
        ]);
        expect(objects).toEqual([
            { id: 'p1', name: 'Alfa', kind: 'point', coordinates: [[17.0, 51.0]] },
            { id: 'r1', name: 'Trasa Bravo', kind: 'route', coordinates: [[17.03, 51.1], [17.05, 51.12]] },
        ]);
    });

    it('sends a point, a route or neither, never both, and the H hour in UTC', () => {
        const objects = mapObjects([
            feature('r1', 'Trasa', 'LineString', ROUTE),
            feature('p1', 'Punkt', 'Point', [17.0, 51.0]),
        ]);
        const form = { ...defaultOrderForm(), text: '  Dane rozkazu.  ', title: '  ', start: '2026-11-26T06:00' };
        expect(toOrderRequest(form, objects)).toEqual({ text: 'Dane rozkazu.', format: 'pdf', start: '2026-11-26T05:00:00.000Z' });
        expect(toOrderRequest({ ...form, location: 'p1', title: 'Obrona', format: 'docx' }, objects))
            .toEqual({ text: 'Dane rozkazu.', format: 'docx', title: 'Obrona', start: '2026-11-26T05:00:00.000Z', location: [17.0, 51.0] });
        const withRoute = toOrderRequest({ ...form, location: 'r1' }, objects);
        expect(withRoute.route).toEqual(ROUTE);
        expect(withRoute.location).toBeUndefined();
        expect(toOrderRequest({ ...form, location: 'gone' }, objects).route).toBeUndefined();
    });

    it('thins a long route and keeps both ends', () => {
        const line: LngLat[] = Array.from({ length: 12_001 }, (_, i) => [17 + i / 1e5, 51]);
        const thin = thinRoute(line, 5_000);
        expect(thin).toHaveLength(5_000);
        expect(thin[0]).toEqual(line[0]);
        expect(thin.at(-1)).toEqual(line.at(-1));
        expect(thinRoute(ROUTE)).toBe(ROUTE);
    });

    it('finds the bot by its UID first, then by the callsign', () => {
        expect(findBotContact([{ uid: 'x', callsign: 'HAL9000' }, { uid: 'ai_buddy', callsign: 'Bot' }])).toEqual({ uid: 'ai_buddy', callsign: 'Bot' });
        expect(findBotContact([{ uid: 'x', callsign: 'hal9000' }])).toEqual({ uid: 'x', callsign: 'hal9000' });
        expect(findBotContact([{ uid: 'ANDROID-1', callsign: 'Alfa' }])).toBeUndefined();
        expect(botChatPath({ uid: 'ai_buddy', callsign: 'Hal9000' })).toBe('/menu/chats/new?callsign=Hal9000&uid=ai_buddy');
    });

    it('switches on a machine that is off, off one that is up, and waits while it stops', () => {
        const m = (state: string): AiModel => ({ state, pinned: false, reason: null });
        expect(modelAction(m('off'))).toBe('start');
        expect(modelAction(m('unavailable'))).toBe('start');
        expect(modelAction(m('ready'))).toBe('stop');
        expect(modelAction(m('starting'))).toBe('stop');
        expect(modelAction(m('stopping'))).toBeNull();
        expect(modelAction(undefined)).toBeNull();
        expect(modelChanging(m('starting'))).toBe(true);
        expect(modelChanging(m('ready'))).toBe(false);
    });

    it('builds the download path of the order format without the token', () => {
        expect(orderUrl('ab'.repeat(16), 'pdf')).toBe(`/api/ai/orders/${'ab'.repeat(16)}.pdf`);
        expect(orderUrl('ab'.repeat(16), 'docx')).toBe(`/api/ai/orders/${'ab'.repeat(16)}.docx`);
    });

    it('is enabled only when the model state answers 200', async () => {
        std.mockResolvedValueOnce({ state: 'off', pinned: false, reason: null });
        expect(await aiChatEnabled()).toBe(true);
        for (const status of [403, 404, 503, 502]) {
            std.mockRejectedValueOnce(Object.assign(new Error('x'), { body: { status } }));
            expect(await aiChatEnabled()).toBe(false);
        }
        std.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        expect(await aiChatEnabled()).toBe(false);
    });
});

describe('MenuAiChat', () => {
    let model: () => unknown;
    let list: () => unknown;
    let start: () => unknown;

    beforeEach(() => {
        vi.useRealTimers();
        i18n.global.locale.value = 'pl';
        std.mockReset();
        downloadUrl.mockClear();
        push.mockClear();
        filter.mockClear();
        contacts = [{ uid: 'ANDROID-1', callsign: 'Alfa' }, { uid: 'ai_buddy', callsign: 'Hal9000' }];
        features = [
            feature('r1', 'Trasa natarcia', 'LineString', ROUTE),
            feature('p1', 'Kijewo', 'Point', [17.0, 51.0]),
        ];
        model = () => ({ state: 'ready', pinned: true, reason: null });
        list = () => ({ items: [] });
        start = () => ({ result: 'started', reason: null });
        std.mockImplementation(async (url: unknown, opts?: { method?: string }) => {
            const u = new URL(String(url), 'http://localhost:8080');
            const method = opts?.method || 'GET';
            if (u.pathname === '/api/ai/model' && method === 'GET') return model();
            if (u.pathname === '/api/ai/model/start' && method === 'POST') return start();
            if (u.pathname === '/api/ai/model/stop' && method === 'POST') return { result: 'stopping' };
            if (u.pathname === '/api/ai/orders' && method === 'GET') return list();
            if (u.pathname === '/api/ai/orders' && method === 'POST') return { id: 'b'.repeat(32), status: 'queued' };
            if (u.pathname.startsWith('/api/ai/orders/') && method === 'DELETE') return { deleted: true };
            throw new Error(`unexpected ${method} ${u.pathname}`);
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        i18n.global.locale.value = 'en';
    });

    function mountMenu() {
        return mount(MenuAiChat, { global: { stubs: { MenuTemplate } } });
    }

    function calls(method: string, path: string): number {
        return std.mock.calls.filter((c) => c[0] === path && ((c[1] as { method?: string } | undefined)?.method || 'GET') === method).length;
    }

    function posted(): Record<string, unknown> {
        const call = std.mock.calls.find((c) => c[0] === '/api/ai/orders' && (c[1] as { method?: string } | undefined)?.method === 'POST');
        return (call?.[1] as { body: Record<string, unknown> }).body;
    }

    it('shows a ready, pinned model with "Wyłącz" and the shared machine note', async () => {
        const wrapper = mountMenu();
        await flushPromises();
        expect(wrapper.find('[data-testid="ai-model-state"]').text()).toBe('gotowy');
        expect(wrapper.find('[data-testid="ai-model-pinned"]').text()).toBe('(zapięty)');
        expect(wrapper.find('[data-testid="ai-model-toggle"]').text()).toBe('Wyłącz');
        expect(wrapper.text()).toContain('Maszyna modelu jest wspólna dla wszystkich środowisk');

        await wrapper.find('[data-testid="ai-model-toggle"]').trigger('click');
        await flushPromises();
        expect(calls('POST', '/api/ai/model/stop')).toBe(1);
        expect(calls('GET', '/api/ai/model')).toBe(2);
    });

    it('switches the model on and shows a refusal of the pool', async () => {
        model = () => ({ state: 'off', pinned: false, reason: null });
        start = () => ({ result: 'refused', reason: 'Miesięczny pułap kosztów jest wyczerpany.' });
        const wrapper = mountMenu();
        await flushPromises();
        expect(wrapper.find('[data-testid="ai-model-state"]').text()).toBe('wyłączony');
        expect(wrapper.find('[data-testid="ai-model-toggle"]').text()).toBe('Włącz');
        await wrapper.find('[data-testid="ai-model-toggle"]').trigger('click');
        await flushPromises();
        expect(calls('POST', '/api/ai/model/start')).toBe(1);
        expect(wrapper.find('[data-testid="ai-model-refused"]').text())
            .toBe('Nie udało się włączyć modelu: Miesięczny pułap kosztów jest wyczerpany.');
    });

    it('polls the model every 5 s only while it is starting or stopping', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        model = () => ({ state: 'starting', pinned: true, reason: null });
        const wrapper = mountMenu();
        await flushPromises();
        expect(calls('GET', '/api/ai/model')).toBe(1);
        expect(wrapper.find('[data-testid="ai-model-state"]').text()).toBe('uruchamia się');

        await vi.advanceTimersByTimeAsync(5_000);
        expect(calls('GET', '/api/ai/model')).toBe(2);

        model = () => ({ state: 'ready', pinned: true, reason: null });
        await vi.advanceTimersByTimeAsync(5_000);
        expect(calls('GET', '/api/ai/model')).toBe(3);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(calls('GET', '/api/ai/model')).toBe(3);
        // Nothing queued: the order list is not polled either.
        expect(calls('GET', '/api/ai/orders')).toBe(1);

        model = () => ({ state: 'stopping', pinned: false, reason: null });
        await wrapper.find('[title="Odśwież"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-testid="ai-model-toggle"]').exists()).toBe(false);
        wrapper.unmount();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(calls('GET', '/api/ai/model')).toBe(4);
    });

    it('opens the existing chat with Hal9000', async () => {
        const wrapper = mountMenu();
        await flushPromises();
        const button = wrapper.find('[data-testid="ai-bot-chat"]');
        expect(button.text()).toContain('Rozmowa z Hal9000');
        expect(button.attributes('disabled')).toBeUndefined();
        await button.trigger('click');
        expect(push).toHaveBeenCalledWith('/menu/chats/new?callsign=Hal9000&uid=ai_buddy');
    });

    it('disables the chat shortcut without the bot contact', async () => {
        contacts = [{ uid: 'ANDROID-1', callsign: 'Alfa' }];
        const wrapper = mountMenu();
        await flushPromises();
        expect(wrapper.find('[data-testid="ai-bot-chat"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('[data-testid="ai-bot-missing"]').exists()).toBe(true);
        await wrapper.find('[data-testid="ai-bot-chat"]').trigger('click');
        expect(push).not.toHaveBeenCalled();
    });

    it('offers user objects of the map as the place and orders with a route', async () => {
        const wrapper = mountMenu();
        await flushPromises();
        expect(filter).toHaveBeenCalledWith(expect.stringContaining('properties.archived'), { mission: true });
        expect(wrapper.findAll('[data-testid="ai-order-location"] option').map((o) => o.text()))
            .toEqual(['Brak – z tekstu', 'Punkt: Kijewo', 'Trasa: Trasa natarcia']);

        expect(wrapper.find('[data-testid="ai-order-create"]').attributes('disabled')).toBeDefined();
        await wrapper.find('[data-testid="ai-order-text"] textarea').setValue('Przeciwnik: pluton w Kijewie.');
        await wrapper.find('[data-testid="ai-order-location"] select').setValue('r1');
        await wrapper.find('[data-testid="ai-order-format"] select').setValue('docx');
        await wrapper.find('[data-testid="ai-order-title"] input').setValue('Natarcie na Kijewo');
        await wrapper.find('[data-testid="ai-order-start"] input').setValue('2026-11-26T06:00');
        await wrapper.find('[data-testid="ai-order-create"]').trigger('click');
        await flushPromises();

        expect(posted()).toEqual({
            text: 'Przeciwnik: pluton w Kijewie.',
            format: 'docx',
            title: 'Natarcie na Kijewo',
            start: zonedToIso('2026-11-26T06:00'),
            route: ROUTE,
        });
        expect(wrapper.text()).toContain('Rozkaz jest w kolejce');
        // The form is empty again, the format stays.
        expect((wrapper.find('[data-testid="ai-order-text"] textarea').element as HTMLTextAreaElement).value).toBe('');
        expect((wrapper.find('[data-testid="ai-order-format"] select').element as HTMLSelectElement).value).toBe('docx');
    });

    it('orders with the place from the text by default and H hour now', async () => {
        const wrapper = mountMenu();
        await flushPromises();
        await wrapper.find('[data-testid="ai-order-text"] textarea').setValue('Obrona rejonu Ślęży.');
        await wrapper.find('[data-testid="ai-order-create"]').trigger('click');
        await flushPromises();
        const body = posted();
        expect(body.location).toBeUndefined();
        expect(body.route).toBeUndefined();
        expect(body.title).toBeUndefined();
        expect(body.format).toBe('pdf');
        expect(Math.abs(Date.parse(String(body.start)) - Date.now())).toBeLessThan(120_000);
    });

    it('shows the thread: request, status, reason, missing weather and downloads only finished orders', async () => {
        list = () => ({
            items: [
                order({ format: 'docx', weather_ok: false }),
                order({ id: 'c'.repeat(32), status: 'failed', error: 'Model nie wstał w ciągu 4 minut.', finished: null, title: null, has_location: false }),
                order({ id: 'd'.repeat(32), status: 'running', finished: null, weather_ok: null, terrain_ok: null }),
            ],
        });
        const wrapper = mountMenu();
        await flushPromises();

        const rows = wrapper.findAll('[data-order]');
        expect(rows).toHaveLength(3);
        expect(rows[0].text()).toContain('Natarcie na Kijewo');
        expect(rows[0].text()).toContain('DOCX · godzina H 26.11.2026, 06:00:00 · z położeniem');
        expect(rows[0].find('[data-testid="ai-order-status"]').text()).toBe('Gotowy');
        expect(rows[0].text()).toContain('Prognoza pogody niedostępna.');
        expect(rows[0].text()).not.toContain('Analiza terenu niedostępna.');
        expect(rows[1].text()).toContain('Rozkaz bez tytułu');
        expect(rows[1].text()).toContain('położenie z tekstu');
        expect(rows[1].find('[data-testid="ai-order-error"]').text()).toBe('Model nie wstał w ciągu 4 minut.');
        expect(rows[2].find('[data-testid="ai-order-status"]').text()).toBe('Tworzy się…');
        expect(rows[1].find('[data-testid="ai-order-download"]').exists()).toBe(false);
        expect(rows[2].find('[data-testid="ai-order-download"]').exists()).toBe(false);

        await rows[0].find('[data-testid="ai-order-download"]').trigger('click');
        expect(downloadUrl).toHaveBeenCalledWith(`/api/ai/orders/${'a'.repeat(32)}.docx`, { token: true });
        wrapper.unmount();
    });

    it('polls the orders every 5 s only while one is queued or running and the menu is open', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        model = () => ({ state: 'ready', pinned: false, reason: null });
        list = () => ({ items: [order({ status: 'queued', finished: null })] });
        const wrapper = mountMenu();
        await flushPromises();
        expect(calls('GET', '/api/ai/orders')).toBe(1);

        await vi.advanceTimersByTimeAsync(5_000);
        expect(calls('GET', '/api/ai/orders')).toBe(2);

        list = () => ({ items: [order()] });
        await vi.advanceTimersByTimeAsync(5_000);
        expect(calls('GET', '/api/ai/orders')).toBe(3);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(calls('GET', '/api/ai/orders')).toBe(3);

        list = () => ({ items: [order({ status: 'running', finished: null })] });
        await wrapper.find('[title="Odśwież"]').trigger('click');
        await flushPromises();
        expect(calls('GET', '/api/ai/orders')).toBe(4);
        wrapper.unmount();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(calls('GET', '/api/ai/orders')).toBe(4);
        // The model is ready: never polled.
        expect(calls('GET', '/api/ai/model')).toBe(2);
    });

    it('shows the refusal of the service', async () => {
        std.mockImplementation(async (url: unknown, opts?: { method?: string }) => {
            if (url === '/api/ai/orders' && opts?.method === 'POST') throw new Error('Masz już 2 rozkazy w kolejce.');
            if (url === '/api/ai/orders') return list();
            return model();
        });
        const wrapper = mountMenu();
        await flushPromises();
        await wrapper.find('[data-testid="ai-order-text"] textarea').setValue('Dane.');
        await wrapper.find('[data-testid="ai-order-create"]').trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain('Masz już 2 rozkazy w kolejce.');
    });

    it('deletes an order and reloads the thread', async () => {
        list = () => ({ items: [order()] });
        const wrapper = mountMenu();
        await flushPromises();
        await wrapper.find('[data-testid="ai-order-delete"]').trigger('click');
        await flushPromises();
        expect(calls('DELETE', `/api/ai/orders/${'a'.repeat(32)}`)).toBe(1);
        expect(calls('GET', '/api/ai/orders')).toBe(2);
    });

    it('speaks English when the interface is English', async () => {
        i18n.global.locale.value = 'en';
        const wrapper = mountMenu();
        await flushPromises();
        expect(wrapper.find('[data-testid="ai-model-toggle"]').text()).toBe('Turn off');
        expect(wrapper.find('[data-testid="ai-bot-chat"]').text()).toContain('Chat with Hal9000');
    });
});
