import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import type { Feature } from 'geojson';

const sources = new Map<string, unknown>();
const layers = new Map<string, Record<string, unknown>>();
const fakeMap = {
    addSource: (id: string, src: unknown) => { sources.set(id, src); },
    addLayer: (layer: Record<string, unknown>) => { layers.set(layer.id as string, layer); },
    getSource: (id: string) => sources.get(id),
    getLayer: (id: string) => layers.get(id),
    removeLayer: (id: string) => { layers.delete(id); },
    removeSource: (id: string) => { sources.delete(id); },
    flyTo: vi.fn(),
};
const mapStore = reactive<{ map: typeof fakeMap; viewedFeature?: Feature }>({ map: fakeMap, viewedFeature: undefined });
const fetchDetail = vi.fn();

vi.mock('../../../stores/map.ts', () => ({ useMapStore: () => mapStore }));
vi.mock('../../../std.ts', () => ({
    server: { GET: vi.fn(async () => ({ data: null })) },
    getRuntimeToken: async () => 'token',
    stdurl: (u: string) => new URL(u, 'http://localhost'),
}));
vi.mock('../util/featureCut.ts', () => ({
    getFeatureOverlay: () => null,
    cutOverlayFeature: vi.fn(),
}));
vi.mock('../../../base/live-detail.ts', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../../base/live-detail.ts')>();
    return {
        ...real,
        liveFeatureRef: (f?: Feature) => (f?.properties?._detail ? { layer: 'adsb', id: String(f.properties._id) } : null),
        fetchDetail: (...args: unknown[]) => fetchDetail(...args),
    };
});

import MenuFeatView from './MenuFeatView.vue';

function plane(id: string): Feature {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [17, 51] },
        properties: { _detail: true, _id: id, _label: id, 'Znak wywoławczy': 'LOT1' },
    };
}

const DETAIL = {
    properties: { Typ: 'A320', _hidden: 'x' },
    photo: { src: 'https://t.plnspttrs.net/1.jpg', link: 'https://www.planespotters.net/photo/1', credit: 'Zdjęcie: X / Planespotters.net' },
    route: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[17, 51], [21, 52]] },
        properties: { _color: '#ff0000', label: 'Trasa orientacyjna (z numeru lotu)' },
    },
};

const mounted: Array<{ unmount: () => void }> = [];

async function mountView() {
    const wrapper = mount(MenuFeatView, {
        global: {
            stubs: {
                MenuTemplate: { template: '<div><slot name="buttons" /><slot /></div>' },
                Coordinate: true,
                CopyField: true,
                TablerIconButton: true,
                TablerLoading: true,
            },
        },
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

describe('MenuFeatView live details', () => {
    beforeEach(() => {
        sources.clear();
        layers.clear();
        fetchDetail.mockReset();
        fetchDetail.mockResolvedValue(DETAIL);
        mapStore.viewedFeature = plane('abc');
    });

    afterEach(() => {
        for (const w of mounted.splice(0)) {
            try { w.unmount(); } catch { /* already unmounted */ }
        }
    });

    it('adds detail rows, the linked photo with credit and the route label', async () => {
        const wrapper = await mountView();
        expect(fetchDetail).toHaveBeenCalledWith('adsb', 'abc');
        const text = wrapper.text();
        expect(text).toContain('Znak wywoławczy');
        expect(text).toContain('A320');
        expect(text).not.toContain('_hidden');
        const link = wrapper.find('a.live-photo');
        expect(link.attributes('href')).toBe(DETAIL.photo.link);
        expect(link.attributes('rel')).toBe('noopener');
        expect(link.find('img').attributes('src')).toBe(DETAIL.photo.src);
        expect(text).toContain(DETAIL.photo.credit);
        expect(text).toContain('Trasa orientacyjna (z numeru lotu)');
    });

    it('toggles the route on the map', async () => {
        const wrapper = await mountView();
        const button = wrapper.find('button.live-route');
        expect(button.text()).toBe('Pokaż trasę');
        await button.trigger('click');
        expect(layers.has('live-route-line')).toBe(true);
        expect(sources.has('live-route')).toBe(true);
        expect(button.text()).toBe('Ukryj trasę');
        await button.trigger('click');
        expect(layers.size).toBe(0);
        expect(sources.size).toBe(0);
        expect(button.text()).toBe('Pokaż trasę');
    });

    it('removes the route when another feature is opened', async () => {
        const wrapper = await mountView();
        await wrapper.find('button.live-route').trigger('click');
        expect(layers.size).toBe(1);
        mapStore.viewedFeature = plane('def');
        await flushPromises();
        expect(layers.size).toBe(0);
        expect(sources.size).toBe(0);
        expect(fetchDetail).toHaveBeenLastCalledWith('adsb', 'def');
    });

    it('removes the route when the view closes', async () => {
        const wrapper = await mountView();
        await wrapper.find('button.live-route').trigger('click');
        expect(layers.size).toBe(1);
        wrapper.unmount();
        expect(layers.size).toBe(0);
        expect(sources.size).toBe(0);
    });

    it('does not fetch details for other features', async () => {
        mapStore.viewedFeature = { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'A' } };
        const wrapper = await mountView();
        expect(fetchDetail).not.toHaveBeenCalled();
        expect(wrapper.find('button.live-route').exists()).toBe(false);
    });

    it('does not render an unsafe photo link, but keeps a safe image', async () => {
        fetchDetail.mockResolvedValue({ ...DETAIL, photo: { ...DETAIL.photo, link: 'javascript:alert(1)' } });
        const wrapper = await mountView();
        expect(wrapper.find('a.live-photo').exists()).toBe(false);
        expect(wrapper.find('[href^="javascript"]').exists()).toBe(false);
        expect(wrapper.find('img.live-photo').attributes('src')).toBe(DETAIL.photo.src);
    });

    it('does not render a photo with an unsafe src', async () => {
        fetchDetail.mockResolvedValue({ ...DETAIL, photo: { ...DETAIL.photo, src: 'data:image/svg+xml,<svg/>' } });
        const wrapper = await mountView();
        expect(wrapper.find('.live-photo').exists()).toBe(false);
        expect(wrapper.text()).not.toContain(DETAIL.photo.credit);
    });

    it('ignores a late response for a previously opened feature', async () => {
        let resolveA: (v: unknown) => void = () => {};
        fetchDetail.mockImplementation((_layer: string, id: string) => {
            if (id === 'abc') return new Promise((resolve) => { resolveA = resolve; });
            return Promise.resolve({ properties: { Typ: 'B737' } });
        });
        const wrapper = await mountView();
        mapStore.viewedFeature = plane('def');
        await flushPromises();
        resolveA(DETAIL);
        await flushPromises();
        expect(wrapper.text()).toContain('B737');
        expect(wrapper.text()).not.toContain('A320');
        expect(wrapper.find('button.live-route').exists()).toBe(false);
    });

    it('unmounts without throwing before the map is initialised', async () => {
        const wrapper = await mountView();
        const saved = Object.getOwnPropertyDescriptor(mapStore, 'map');
        Object.defineProperty(mapStore, 'map', { configurable: true, get() { throw new Error('Map has not yet initialized'); } });
        try {
            expect(() => wrapper.unmount()).not.toThrow();
        } finally {
            if (saved) Object.defineProperty(mapStore, 'map', saved);
        }
    });

    it('shows an error when details fail', async () => {
        fetchDetail.mockRejectedValue(new Error('Status Code: 404'));
        const wrapper = await mountView();
        expect(wrapper.text()).toContain('Status Code: 404');
    });
});
