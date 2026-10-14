import { shallowRef } from 'vue';
import { db } from '../database.ts';
import { server } from '../std.ts';

/** Local copy of the favorites so the stars survive an offline start */
const KV_KEY = 'overlay-favorites';

/**
 * Starred overlays as `${mode}:${mode_id}` keys - shared by the Overlay
 * Explorer and the Overlays menu. Replaced (never mutated) on every change.
 */
export const favoriteKeys = shallowRef<ReadonlySet<string>>(new Set());

/**
 * Favorite overlays - stored server side per user so they are the same on
 * every device, with a local copy in the key/value store.
 */
export default class OverlayFavoriteManager {
    /** Favorites from the local copy, empty when none was stored yet */
    static async cached(): Promise<string[]> {
        try {
            const entry = await db.kv.get(KV_KEY);
            return entry ? JSON.parse(entry.value) as string[] : [];
        } catch (err) {
            console.error('Failed to read cached overlay favorites:', err);
            return [];
        }
    }

    /** Show the local copy at once, then the server list (the local copy stays when offline) */
    static async load(): Promise<ReadonlySet<string>> {
        favoriteKeys.value = new Set(await this.cached());

        try {
            const res = await server.GET('/api/profile/overlay/favorite');
            if (res.error) throw new Error(res.error.message);
            if (!res.data) throw new Error('Failed to list overlay favorites');

            await this.set(res.data.items.map((item) => item.key));
        } catch (err) {
            console.error('Failed to load overlay favorites, using local copy:', err);
        }

        return favoriteKeys.value;
    }

    static has(key: string | null): boolean {
        return key !== null && favoriteKeys.value.has(key);
    }

    /** Star or unstar - shown at once, undone when the server refuses */
    static async toggle(key: string): Promise<void> {
        const before = [...favoriteKeys.value];
        const starred = favoriteKeys.value.has(key);

        await this.set(starred ? before.filter((current) => current !== key) : [...before, key]);

        try {
            if (starred) {
                const { error, response } = await server.DELETE('/api/profile/overlay/favorite', {
                    params: { query: { key } }
                });
                if (error && response.status !== 404) throw new Error(error.message);
            } else {
                const { error } = await server.PUT('/api/profile/overlay/favorite', {
                    body: { key }
                });
                if (error) throw new Error(error.message);
            }
        } catch (err) {
            await this.set(before);
            throw err;
        }
    }

    private static async set(keys: string[]): Promise<void> {
        favoriteKeys.value = new Set(keys);

        try {
            await db.kv.put({ key: KV_KEY, value: JSON.stringify(keys) });
        } catch (err) {
            console.error('Failed to cache overlay favorites:', err);
        }
    }
}
