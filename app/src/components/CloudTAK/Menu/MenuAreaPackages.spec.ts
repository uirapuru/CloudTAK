import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

const std = vi.fn();
const downloadOfflineTiles = vi.fn(async () => {});
const removeOfflineTiles = vi.fn(async () => {});
const createLoaded = vi.fn<(body: Record<string, unknown>) => Promise<object>>(async () => ({}));
const drawStart = vi.fn();
const loaded: Array<{ url?: string }> = [];

vi.mock('../../../std.ts', () => ({
    std: (...args: unknown[]) => std(...args),
    stdurl: (u: string) => new URL(u, 'http://localhost:8080'),
}));

vi.mock('../../../stores/modules/offline-tiles.ts', () => ({
    downloadOfflineTiles: (...args: unknown[]) => downloadOfflineTiles(...(args as [])),
    removeOfflineTiles: (...args: unknown[]) => removeOfflineTiles(...(args as [])),
}));

vi.mock('../../../base/overlay.ts', () => ({
    default: {
        get loaded() { return loaded; },
        createLoaded: (body: Record<string, unknown>) => createLoaded(body),
    },
}));

vi.mock('../../../stores/map.ts', () => ({
    useMapStore: () => ({ draw: { start: drawStart } }),
}));

vi.mock('@tak-ps/vue-tabler', async (original) => ({
    ...await original<Record<string, unknown>>(),
    TablerModal: { template: '<div><slot /></div>' },
}));

const MenuTemplate = defineComponent({
    name: 'MenuTemplate',
    props: { name: { type: String, default: '' } },
    setup(_props, { slots }) {
        return () => h('div', [slots.buttons?.(), slots.default?.()]);
    },
});

import MenuAreaPackages from './MenuAreaPackages.vue';

function pkg(extra: Record<string, unknown> = {}) {
    return {
        id: 'pkg-1',
        name: 'Wyjście 23 XI',
        token: 'tok',
        status: 'Success',
        error: null,
        progress: 100,
        size: 52000000,
        assets: ['asset-1', 'asset-2'],
        layers: [],
        created: '2026-11-24T10:00:00Z',
        updated: '2026-11-24T10:00:00Z',
        ...extra,
    };
}

const QR = {
    url: 'https://public-mapa.taklab.eu/api/public/area-package/tok.zip',
    uri: 'tak://com.atakmap.app/import?url=https%3A%2F%2Fpublic-mapa.taklab.eu%2Fapi%2Fpublic%2Farea-package%2Ftok.zip&filename=Wyj%C5%9Bcie%2023%20XI.zip',
    svg: '<svg></svg>',
};

function mountMenu() {
    return mount(MenuAreaPackages, {
        global: {
            stubs: {
                MenuTemplate,
                AreaPackageModal: {
                    name: 'AreaPackageModal',
                    props: ['bounds'],
                    emits: ['close', 'created'],
                    template: '<div class="modal-stub" />',
                },
            },
        },
    });
}

function respond(list: () => unknown[]) {
    std.mockImplementation(async (url: string, opts?: { method?: string }) => {
        const u = String(url);
        if (u.endsWith('/qr')) return QR;
        if (u.includes('/api/profile/asset')) {
            return { total: 2, items: [{ id: 'asset-1', name: 'a.pmtiles', artifacts: [{ ext: '.pmtiles', size: 10 }] }, { id: 'asset-2', name: 'b.pmtiles', artifacts: [{ ext: '.pmtiles', size: 10 }] }, { id: 'other', name: 'c', artifacts: [] }] };
        }
        if (opts?.method === 'DELETE') return { status: 200 };
        return { total: list().length, items: list() };
    });
}

describe('MenuAreaPackages', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        loaded.length = 0;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('the ATAK QR code stays hidden until its icon is clicked', async () => {
        respond(() => [pkg()]);

        const wrapper = mountMenu();
        await flushPromises();

        expect(std.mock.calls.some((c) => String(c[0]).endsWith('/api/profile/area-package/pkg-1/qr'))).toBe(true);
        expect(wrapper.find('[data-test="qr"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="link"]').exists()).toBe(false);

        await wrapper.find('[data-test="qr-toggle"]').trigger('click');
        expect(wrapper.find('[data-test="qr"]').attributes('data-uri')).toBe(QR.uri);
        expect(QR.uri.startsWith('tak://com.atakmap.app/import?url=https%3A%2F%2F')).toBe(true);
        expect(wrapper.find('[data-test="link"]').attributes('href')).toBe(QR.url);

        await wrapper.find('[data-test="qr-toggle"]').trigger('click');
        expect(wrapper.find('[data-test="qr"]').exists()).toBe(false);
    });

    it('the download icon is a link that saves the package zip to disk', async () => {
        respond(() => [pkg()]);

        const wrapper = mountMenu();
        await flushPromises();

        const download = wrapper.find('[data-test="download"]');
        expect(download.element.tagName).toBe('A');
        expect(download.attributes('href')).toBe(QR.url);
        expect(download.attributes('download')).toBeDefined();
    });

    it('the offline button is there without opening the QR code', async () => {
        respond(() => [pkg()]);

        const wrapper = mountMenu();
        await flushPromises();

        expect(wrapper.find('[data-test="offline"]').exists()).toBe(true);
    });

    it('a failed package shows its error', async () => {
        respond(() => [pkg({ status: 'Fail', error: 'OSM: brak dostępu albo brak danych' })]);

        const wrapper = mountMenu();
        await flushPromises();

        expect(wrapper.text()).toContain('OSM: brak dostępu albo brak danych');
        expect(wrapper.find('[data-test="qr"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="qr-toggle"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="download"]').exists()).toBe(false);
    });

    it('delete asks first, then removes the package and its offline tiles', async () => {
        respond(() => [pkg()]);

        const wrapper = mountMenu();
        await flushPromises();

        await wrapper.find('[data-test="delete"]').trigger('click');
        expect(std.mock.calls.some((c) => (c[1] as { method?: string })?.method === 'DELETE')).toBe(false);

        await wrapper.find('[data-test="delete-confirm"]').trigger('click');
        await flushPromises();

        const del = std.mock.calls.find((c) => (c[1] as { method?: string })?.method === 'DELETE');
        expect(String(del?.[0])).toMatch(/\/api\/profile\/area-package\/pkg-1$/);
        expect(removeOfflineTiles).toHaveBeenCalledWith('asset-1');
        expect(removeOfflineTiles).toHaveBeenCalledWith('asset-2');
    });

    it('a package created in this session saves itself offline once it is ready', async () => {
        let status = 'Running';
        respond(() => [pkg({ status, progress: status === 'Running' ? 40 : 100 })]);

        const wrapper = mountMenu();
        await flushPromises();

        await wrapper.find('[data-test="new"]').trigger('click');
        expect(drawStart).toHaveBeenCalled();
        const [, opts] = drawStart.mock.calls[0] as [string, { capture: (g: unknown) => void }];
        opts.capture({ type: 'Polygon', coordinates: [[[21, 52], [21.1, 52], [21.1, 52.2], [21, 52.2], [21, 52]]] });
        await flushPromises();

        const modal = wrapper.findComponent({ name: 'AreaPackageModal' });
        expect(modal.props('bounds')).toEqual([21, 52, 21.1, 52.2]);
        modal.vm.$emit('created', pkg({ status: 'Pending' }));
        await flushPromises();

        expect(downloadOfflineTiles).not.toHaveBeenCalled();

        status = 'Success';
        vi.advanceTimersByTime(3000);
        await flushPromises();

        expect(downloadOfflineTiles).toHaveBeenCalledTimes(2);
        expect(createLoaded).toHaveBeenCalledTimes(2);
        expect(createLoaded.mock.calls[0][0]).toMatchObject({ mode: 'profile', type: 'raster' });

        vi.advanceTimersByTime(3000);
        await flushPromises();
        expect(downloadOfflineTiles).toHaveBeenCalledTimes(2);
    });

    it('a package from an earlier session is not saved offline by itself', async () => {
        let status = 'Running';
        respond(() => [pkg({ status })]);

        mountMenu();
        await flushPromises();

        status = 'Success';
        vi.advanceTimersByTime(3000);
        await flushPromises();

        expect(downloadOfflineTiles).not.toHaveBeenCalled();
    });

    it('the offline button saves every layer of the package', async () => {
        respond(() => [pkg()]);

        const wrapper = mountMenu();
        await flushPromises();

        await wrapper.find('[data-test="offline"]').trigger('click');
        await flushPromises();

        expect(downloadOfflineTiles).toHaveBeenCalledTimes(2);
    });
});
