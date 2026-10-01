import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    kv: new Map<string, string>(),
    server: {
        GET: vi.fn(),
        PUT: vi.fn(),
        DELETE: vi.fn(),
    },
}));

vi.mock('../database.ts', () => ({
    db: {
        kv: {
            get: async (key: string) => state.kv.has(key) ? { key, value: state.kv.get(key) } : undefined,
            put: async ({ key, value }: { key: string; value: string }) => { state.kv.set(key, value); },
        },
    },
}));
vi.mock('../std.ts', () => ({ server: state.server }));

import OverlayFavoriteManager, { favoriteKeys } from './overlay-favorite-manager.ts';

describe('OverlayFavoriteManager', () => {
    beforeEach(() => {
        state.kv.clear();
        vi.clearAllMocks();
        favoriteKeys.value = new Set();
    });

    it('loads the server list and keeps a local copy', async () => {
        state.server.GET.mockResolvedValue({ data: { total: 1, items: [{ key: 'live:adsb', created: '' }] } });

        await OverlayFavoriteManager.load();

        expect([...favoriteKeys.value]).toEqual(['live:adsb']);
        expect(JSON.parse(state.kv.get('overlay-favorites') as string)).toEqual(['live:adsb']);
    });

    it('falls back to the local copy when offline', async () => {
        state.kv.set('overlay-favorites', JSON.stringify(['overlay:1']));
        state.server.GET.mockRejectedValue(new TypeError('Failed to fetch'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await OverlayFavoriteManager.load();

        expect([...favoriteKeys.value]).toEqual(['overlay:1']);
    });

    it('stars and unstars through the API', async () => {
        state.server.PUT.mockResolvedValue({ data: { key: 'ion:g3d', created: '' } });
        state.server.DELETE.mockResolvedValue({ data: { status: 200 }, response: { status: 200 } });

        await OverlayFavoriteManager.toggle('ion:g3d');
        expect(OverlayFavoriteManager.has('ion:g3d')).toBe(true);
        expect(state.server.PUT).toHaveBeenCalledWith('/api/profile/overlay/favorite', { body: { key: 'ion:g3d' } });

        await OverlayFavoriteManager.toggle('ion:g3d');
        expect(OverlayFavoriteManager.has('ion:g3d')).toBe(false);
        expect(state.server.DELETE).toHaveBeenCalledWith('/api/profile/overlay/favorite', { params: { query: { key: 'ion:g3d' } } });
    });

    it('undoes the star when the server refuses', async () => {
        state.server.PUT.mockResolvedValue({ error: { message: 'nope' } });

        await expect(OverlayFavoriteManager.toggle('live:adsb')).rejects.toThrow('nope');

        expect(OverlayFavoriteManager.has('live:adsb')).toBe(false);
        expect(JSON.parse(state.kv.get('overlay-favorites') as string)).toEqual([]);
    });
});
