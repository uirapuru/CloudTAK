import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const std = vi.fn();
const areaFeatures = vi.fn();
const overlays: Array<Record<string, unknown>> = [];

vi.mock('../../../std.ts', () => ({
    std: (...args: unknown[]) => std(...args),
    stdurl: (u: string) => new URL(u, 'http://localhost'),
}));

vi.mock('../../../stores/map.ts', () => ({
    useMapStore: () => ({
        map: { getZoom: () => 12 },
        worker: { db: { areaFeatures: (...args: unknown[]) => areaFeatures(...args) } },
    }),
}));

vi.mock('../../../base/overlay.ts', () => ({
    default: {
        visible: (mode?: string) => overlays.filter((o) => o.visible && (mode === undefined || (o.mode === mode && o.mode_id))),
    },
}));

// TablerModal teleports to <body>; render it in place so wrapper.text() sees it
vi.mock('@tak-ps/vue-tabler', async (original) => ({
    ...await original<Record<string, unknown>>(),
    TablerModal: { template: '<div><slot /></div>' },
}));

import AreaPackageModal from './AreaPackageModal.vue';

const BOUNDS: [number, number, number, number] = [20.9, 52.1, 21.1, 52.3];

function previewLayer(extra: Record<string, unknown>) {
    return {
        source: 'basemap', available: true, format: 'png', host: 'tile.openstreetmap.de',
        minzoom: 0, maxzoom: 18, layer_minzoom: 0, layer_maxzoom: 18, tiles: 100, bytes: 1500000,
        ...extra,
    };
}

function point(id: string) {
    return {
        id,
        kind: 'marker',
        title: id,
        feature: { id, type: 'Feature', properties: { callsign: id }, geometry: { type: 'Point', coordinates: [21, 52.2] } },
    };
}

function route(id: string) {
    return {
        id,
        kind: 'route',
        title: id,
        feature: { id, type: 'Feature', properties: { callsign: id, type: 'b-m-r' }, geometry: { type: 'LineString', coordinates: [[21, 52.2], [21.05, 52.25]] } },
    };
}

function previewResponse(layers: Array<Record<string, unknown>>, limits = { tiles: 100000, bytes: 2147483648, features: 5000 }) {
    return {
        layers,
        tiles: layers.reduce((s, l) => s + Number(l.tiles), 0),
        bytes: layers.reduce((s, l) => s + Number(l.bytes), 0),
        limits,
    };
}

function mountModal(bounds: [number, number, number, number] = BOUNDS) {
    return mount(AreaPackageModal, {
        props: { bounds },
        global: {
            stubs: {
                ZoomRangeSlider: {
                    name: 'ZoomRangeSlider',
                    props: ['modelValue', 'min', 'max', 'disabled'],
                    emits: ['update:modelValue'],
                    template: '<div class="zoom-stub" />',
                },
            },
        },
    });
}

function calls(url: string) {
    return std.mock.calls.filter((c) => String(c[0]).endsWith(url));
}

describe('AreaPackageModal', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        std.mockReset();
        areaFeatures.mockReset();
        overlays.length = 0;
        overlays.push(
            { id: 1, name: 'OSM', mode: 'basemap', mode_id: '7', visible: true, type: 'raster' },
            { id: 2, name: 'Google Satelita', mode: 'overlay', mode_id: '9', visible: true, type: 'raster' },
            { id: 3, name: 'Hidden', mode: 'basemap', mode_id: '11', visible: false, type: 'raster' },
        );
        areaFeatures.mockResolvedValue([point('PO-1'), point('PO-2'), route('Trasa')]);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('previews the visible layers and shows Google as unavailable', async () => {
        std.mockImplementation(async (url: string) => {
            if (String(url).endsWith('/preview')) {
                return previewResponse([
                    previewLayer({ id: 7, name: 'OSM' }),
                    previewLayer({ id: 9, name: 'Google Satelita', available: false, reason: 'google', tiles: 0, bytes: 0 }),
                ]);
            }
        });

        const wrapper = mountModal();
        await flushPromises();

        const [, opts] = calls('/api/profile/area-package/preview')[0];
        expect(opts.method).toBe('POST');
        expect(opts.body.bounds).toEqual(BOUNDS);
        expect(opts.body.layers).toEqual([{ source: 'basemap', id: 7 }, { source: 'basemap', id: 9 }]);

        expect(wrapper.text()).toContain('Google');
        expect(wrapper.find('[data-test="layer-9"] input[type="checkbox"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="layer-7"] input[type="checkbox"]').exists()).toBe(true);
        expect(wrapper.text()).toContain('Not available offline');
    });

    it('defaults the zoom range around the map zoom', async () => {
        std.mockImplementation(async () => previewResponse([previewLayer({ id: 7, name: 'OSM' })]));

        const wrapper = mountModal();
        await flushPromises();

        const slider = wrapper.findComponent({ name: 'ZoomRangeSlider' });
        expect(slider.props('modelValue')).toEqual([10, 16]);
        expect(slider.props('min')).toBe(0);
        expect(slider.props('max')).toBe(18);
    });

    it('a zoom change previews again after 300 ms with the new range', async () => {
        std.mockImplementation(async () => previewResponse([previewLayer({ id: 7, name: 'OSM' })]));

        const wrapper = mountModal();
        await flushPromises();
        expect(calls('/preview')).toHaveLength(1);

        wrapper.findComponent({ name: 'ZoomRangeSlider' }).vm.$emit('update:modelValue', [12, 14]);
        await flushPromises();
        expect(calls('/preview')).toHaveLength(1);

        vi.advanceTimersByTime(300);
        await flushPromises();

        const [, opts] = calls('/preview')[1];
        expect(opts.body.layers).toEqual([{ source: 'basemap', id: 7, minzoom: 12, maxzoom: 14 }, { source: 'basemap', id: 9 }]);
    });

    it('unticking the markers group saves only the routes', async () => {
        std.mockImplementation(async (url: string) => {
            if (String(url).endsWith('/preview')) return previewResponse([previewLayer({ id: 7, name: 'OSM' })]);
            return { id: 'pkg-1', status: 'Pending' };
        });

        const wrapper = mountModal();
        await flushPromises();

        await wrapper.find('[data-test="group-marker"]').setValue(false);
        await wrapper.find('[data-test="save"]').trigger('click');
        await flushPromises();

        const [, opts] = calls('/api/profile/area-package')[0];
        expect(opts.method).toBe('POST');
        expect(opts.body.features.map((f: { id: string }) => f.id)).toEqual(['Trasa']);
        expect(opts.body.layers).toEqual([{ source: 'basemap', id: 7, minzoom: 10, maxzoom: 16 }]);
        expect(opts.body.bounds).toEqual(BOUNDS);
        expect(opts.body.name).toMatch(/^Area package /);
        expect(wrapper.emitted('created')?.[0]).toEqual([{ id: 'pkg-1', status: 'Pending' }]);
    });

    it('over the tile limit the save button is disabled', async () => {
        std.mockImplementation(async () => previewResponse(
            [previewLayer({ id: 7, name: 'OSM', tiles: 200000, bytes: 3000000000 })],
            { tiles: 100000, bytes: 2147483648, features: 5000 },
        ));

        const wrapper = mountModal();
        await flushPromises();

        expect(wrapper.find('[data-test="save"]').attributes('disabled')).toBeDefined();
        expect(wrapper.text()).toContain('limit');
    });

    it('with no objects in the area one layer is enough', async () => {
        areaFeatures.mockResolvedValue([]);
        std.mockImplementation(async (url: string) => {
            if (String(url).endsWith('/preview')) return previewResponse([previewLayer({ id: 7, name: 'OSM' })]);
            return { id: 'pkg-2', status: 'Pending' };
        });

        const wrapper = mountModal();
        await flushPromises();

        await wrapper.find('[data-test="save"]').trigger('click');
        await flushPromises();

        const [, opts] = calls('/api/profile/area-package')[0];
        expect(opts.body.features).toEqual([]);
    });

    it('nothing selected disables saving', async () => {
        areaFeatures.mockResolvedValue([]);
        std.mockImplementation(async () => previewResponse([previewLayer({ id: 7, name: 'OSM' })]));

        const wrapper = mountModal();
        await flushPromises();

        await wrapper.find('[data-test="layer-7"] input[type="checkbox"]').setValue(false);
        expect(wrapper.find('[data-test="save"]').attributes('disabled')).toBeDefined();
    });
    it('passes the worker a bounds copy that survives structured clone', async () => {
        std.mockResolvedValue(previewResponse([previewLayer({ id: 7, name: 'OSM' })]));
        // the menu keeps bounds in a ref, so the modal receives a reactive proxy
        mountModal(ref<[number, number, number, number]>([...BOUNDS]).value);
        await flushPromises();

        const [bounds] = areaFeatures.mock.calls[0];
        expect(() => structuredClone(bounds)).not.toThrow();
        expect(bounds).toEqual(BOUNDS);
    });
});
