import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const std = vi.fn();
vi.mock('../../../std.ts', () => ({ std: (...args: unknown[]) => std(...args) }));

const map = {
    sources: new Map<string, unknown>(),
    layers: new Set<string>(),
    addSource(id: string, spec: unknown) { this.sources.set(id, spec); },
    getSource(id: string) { return this.sources.get(id); },
    removeSource(id: string) { this.sources.delete(id); },
    addLayer(layer: { id: string }) { this.layers.add(layer.id); },
    getLayer(id: string) { return this.layers.has(id) ? { id } : undefined; },
    removeLayer(id: string) { this.layers.delete(id); },
};
const add = vi.fn(async () => ({ id: 'x' }));
vi.mock('../../../stores/map.ts', () => ({
    useMapStore: () => ({ map, worker: { db: { filter: async () => [], add } } }),
}));

import RouteVariants from './RouteVariants.vue';

const plan = (waypoints: number[][]) => ({
    version: 1, mode: 'foot_cross_country', mode_name: 'Pieszo na przełaj', waypoints,
    legs: [{ start: 0, end: 1, distance_m: 5000, duration_s: 3600 }],
    analysis: { cover: { concealed: 0.2, exposed: 0.5, unknown: 0.3 }, observed_ratio: 0.4, danger: [{ kind: 'road_crossing', from_m: 1, to_m: 2 }] },
});
const route = (waypoints: number[][]) => ({
    id: 'r1', type: 'Feature', path: '/',
    properties: { callsign: 'Patrol', type: 'b-m-r', metadata: { taklab_route: plan(waypoints) } },
    geometry: { type: 'LineString', coordinates: [[21, 52], [21.05, 52.05]] },
});
const variant = (concealed: number) => ({
    type: 'Feature', properties: { callsign: 'x', metadata: { taklab_route: { ...plan([[21, 52], [21.05, 52.05]]), analysis: { ...plan([]).analysis, cover: { concealed, exposed: 0.1, unknown: 0.2 } } } } },
    geometry: { type: 'LineString', coordinates: [[21, 52], [21.02, 52.04], [21.05, 52.05]] },
});

function mountIt(waypoints = [[21, 52], [21.05, 52.05]]) {
    return mount(RouteVariants, {
        props: { feature: route(waypoints) as never },
        global: { stubs: { Modal: { template: '<div><slot /></div>' } } },
    });
}

describe('RouteVariants', () => {
    beforeEach(() => {
        std.mockReset(); add.mockClear(); map.sources.clear(); map.layers.clear();
    });

    it('pyta o warianty, pokazuje tabelę i podgląd, dodaje wybrany na mapę', async () => {
        std.mockResolvedValue({ type: 'FeatureCollection', features: [variant(0.7), variant(0.6)] });
        const wrapper = mountIt();
        await flushPromises();
        const body = std.mock.calls[0][1].body;
        expect(std.mock.calls[0][0]).toBe('/api/search/route/variants');
        expect(body).toMatchObject({ travelMode: 'foot_cross_country', count: 2, waypoints: [[21, 52], [21.05, 52.05]] });
        expect(wrapper.findAll('tbody tr')).toHaveLength(3);
        expect(wrapper.text()).toContain('70%');
        expect(map.layers.has('route-variants-preview-line')).toBe(true);

        await wrapper.findAll('button.add-variant')[0].trigger('click');
        await flushPromises();
        expect(add).toHaveBeenCalledWith(expect.objectContaining({ properties: expect.objectContaining({ callsign: 'Patrol – wariant B' }) }), { authored: true });

        wrapper.unmount();
        expect(map.layers.size).toBe(0);
        expect(map.sources.size).toBe(0);
    });

    it('bez wariantów mówi to wprost', async () => {
        std.mockResolvedValue({ type: 'FeatureCollection', features: [] });
        const wrapper = mountIt();
        await flushPromises();
        expect(wrapper.text()).toContain('Nie ma wariantów wyraźnie innych niż trasa.');
    });

    it('przy punktach pośrednich ostrzega, że warianty je pomijają', async () => {
        std.mockResolvedValue({ type: 'FeatureCollection', features: [] });
        const wrapper = mountIt([[21, 52], [21.02, 52.02], [21.05, 52.05]]);
        await flushPromises();
        expect(wrapper.text()).toContain('pomijają punkty pośrednie');
    });

    it('błąd usługi pokazuje komunikat', async () => {
        std.mockRejectedValue(new Error('Usługa tras na przełaj nie odpowiada.'));
        const wrapper = mountIt();
        await flushPromises();
        expect(wrapper.text()).toContain('Usługa tras na przełaj nie odpowiada.');
    });
});
