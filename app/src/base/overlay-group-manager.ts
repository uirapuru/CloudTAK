import { db } from '../database.ts';
import { server } from '../std.ts';
import OverlayManager from './overlay.ts';
import { sortGroups } from './overlay-groups.ts';
import type { ProfileOverlayGroup, ProfileOverlayGroup_Update } from '../types.ts';

/** Local copy of the groups so the menu keeps its grouping offline */
const KV_KEY = 'overlay-groups';

/**
 * User defined overlay groups - stored server side per user so they are the
 * same on every device, with a local copy in the key/value store.
 */
export default class OverlayGroupManager {
    /** Groups from the local copy, empty when none was stored yet */
    static async cached(): Promise<ProfileOverlayGroup[]> {
        try {
            const entry = await db.kv.get(KV_KEY);
            return entry ? sortGroups(JSON.parse(entry.value) as ProfileOverlayGroup[]) : [];
        } catch (err) {
            console.error('Failed to read cached overlay groups:', err);
            return [];
        }
    }

    /** Groups from the server, falling back to the local copy when offline */
    static async list(): Promise<ProfileOverlayGroup[]> {
        try {
            const res = await server.GET('/api/profile/overlay/group');
            if (res.error) throw new Error(res.error.message);
            if (!res.data) throw new Error('Failed to list overlay groups');

            const groups = sortGroups(res.data.items);
            await this.store(groups);
            return groups;
        } catch (err) {
            console.error('Failed to load overlay groups, using local copy:', err);
            return await this.cached();
        }
    }

    static async create(name: string): Promise<ProfileOverlayGroup> {
        const res = await server.POST('/api/profile/overlay/group', {
            body: { name }
        });

        if (res.error) throw new Error(res.error.message);
        if (!res.data) throw new Error('Failed to create overlay group');

        await this.store([...(await this.cached()), res.data]);
        return res.data;
    }

    static async update(id: number, body: ProfileOverlayGroup_Update): Promise<ProfileOverlayGroup> {
        const res = await server.PATCH('/api/profile/overlay/group/{:group}', {
            params: {
                path: { ':group': id }
            },
            body
        });

        if (res.error) throw new Error(res.error.message);
        if (!res.data) throw new Error('Failed to update overlay group');

        const updated = res.data;
        await this.store((await this.cached()).map((group) => group.id === id ? updated : group));
        return updated;
    }

    /** Delete a group - its overlays are kept and become ungrouped */
    static async delete(id: number): Promise<void> {
        const { error, response } = await server.DELETE('/api/profile/overlay/group/{:group}', {
            params: {
                path: { ':group': id }
            }
        });

        if (error && response.status !== 404) throw new Error(error.message);

        await this.store((await this.cached()).filter((group) => group.id !== id));

        // The server clears group_id (ON DELETE SET NULL) - mirror it locally
        for (const overlay of OverlayManager.loaded) {
            if (overlay.group_id === id) overlay.group_id = null;
        }

        await db.overlay.toCollection().modify((overlay) => {
            if (overlay.group_id === id) overlay.group_id = null;
        });
    }

    private static async store(groups: ProfileOverlayGroup[]): Promise<void> {
        try {
            await db.kv.put({ key: KV_KEY, value: JSON.stringify(sortGroups(groups)) });
        } catch (err) {
            console.error('Failed to cache overlay groups:', err);
        }
    }
}
