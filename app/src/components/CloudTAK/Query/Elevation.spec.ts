import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const GET = vi.fn();
const queryTerrainElevation = vi.fn();
const getTerrain = vi.fn();

vi.mock('../../../std.ts', () => ({
    server: { GET: (...args: unknown[]) => GET(...args) }
}));

vi.mock('../../../stores/map.ts', () => ({
    useMapStore: () => ({ map: { queryTerrainElevation, getTerrain } })
}));

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import Elevation from './Elevation.vue';

const stubs = {
    TablerLoading: true,
    TablerAlert: true,
    IconMountain: true,
};

async function sentQuery() {
    mount(Elevation, { props: { longitude: 17, latitude: 51 }, global: { stubs } });
    await flushPromises();
    return GET.mock.calls[0][1].params.query;
}

describe('Elevation', () => {
    beforeEach(() => {
        GET.mockReset().mockResolvedValue({ data: { elevation: '100.00 m' }, error: undefined });
        queryTerrainElevation.mockReset();
        getTerrain.mockReset();
    });

    it('divides the queried height by the terrain exaggeration', async () => {
        queryTerrainElevation.mockReturnValue(150);
        getTerrain.mockReturnValue({ source: 'dem', exaggeration: 1.5 });
        expect(await sentQuery()).toEqual({ elevation: 100 });
    });

    it('sends the raw height without terrain', async () => {
        queryTerrainElevation.mockReturnValue(150);
        getTerrain.mockReturnValue(undefined);
        expect(await sentQuery()).toEqual({ elevation: 150 });
    });

    it('sends nothing when the map has no height', async () => {
        queryTerrainElevation.mockReturnValue(null);
        getTerrain.mockReturnValue({ source: 'dem', exaggeration: 1.5 });
        expect(await sentQuery()).toEqual({ elevation: undefined });
    });
});
