import OverlayManager from './overlay.ts';
import OverlayGroupManager from './overlay-group-manager.ts';
import { categoryGroupOrder, staleNames } from './overlay-categories.ts';
import type { OverlayCatalog } from './overlay-categories.ts';
import {
    moveInLayout,
    partitionLayout,
    partitionOverlays,
    renumberGroups,
    sortGroups,
    stackOrder
} from './overlay-groups.ts';
import type { OverlayLayoutList } from './overlay-groups.ts';
import type { ProfileOverlayGroup } from '../types.ts';

export type CategoryMove = { id: number; category: string };

/**
 * Puts overlays into the groups named after their category ("predefined
 * groups" of the Overlays menu). A missing category group is created and
 * placed among the other category groups in the category order. The groups
 * stay ordinary user groups - they can be renamed, dragged and deleted.
 */
export default class CategoryPlacer {
    /** Groups created by this placer, by name */
    readonly created: string[] = [];

    private constructor(
        private groups: ProfileOverlayGroup[],
        /** Category names from the catalog that are not on the fixed list */
        private extra: string[]
    ) {}

    static async load(extra: string[] = []): Promise<CategoryPlacer> {
        return new CategoryPlacer(await OverlayGroupManager.list(), extra);
    }

    /** The group named after the category, created when missing */
    async groupFor(category: string): Promise<ProfileOverlayGroup> {
        const existing = sortGroups(this.groups).find((group) => group.name === category);
        if (existing) return existing;

        const group = await OverlayGroupManager.create(category);
        this.groups = [...this.groups, group];
        this.created.push(category);

        const changes = renumberGroups(this.groups, categoryGroupOrder(this.groups, group, this.extra));
        const posOf = new Map(changes.map((change) => [change.id, change.pos]));
        this.groups = this.groups.map((current) => posOf.has(current.id) ? { ...current, pos: posOf.get(current.id) as number } : current);

        // Only the relative place of the new (empty) group changes, so the map stack stays as it is
        await Promise.all(changes.map((change) => OverlayGroupManager.update(change.id, { pos: change.pos })));

        return this.groups.find((current) => current.id === group.id) as ProfileOverlayGroup;
    }

    /**
     * Move overlays into their category groups. `at: 'top'` puts each one on
     * top of its group (a new overlay), `'bottom'` below the overlays already
     * in it, keeping the order of the moved ones.
     */
    async place(moves: CategoryMove[], at: 'top' | 'bottom'): Promise<void> {
        if (!moves.length) return;

        const targets = new Map<number, number>();
        for (const move of moves) {
            targets.set(move.id, (await this.groupFor(move.category)).id);
        }

        let layout = this.layout();
        for (const move of moves) {
            if (!layout.some((list) => list.ids.includes(move.id))) continue;
            layout = moveInLayout(layout, move.id, targets.get(move.id) as number, at === 'top' ? 0 : Number.MAX_SAFE_INTEGER);
        }

        await OverlayManager.regroupLoaded(stackOrder(layout), targets);
    }

    /** Menu layout of the ordinary loaded overlays (top of the map stack first) */
    private layout(): OverlayLayoutList[] {
        const items = OverlayManager.loaded.filter((overlay) => !OverlayManager.isPinned(overlay)).reverse();
        return partitionLayout(partitionOverlays(items, this.groups, (overlay) => overlay.group_id), (overlay) => overlay.id);
    }
}

/** Renames already tried in this session (`id` NUL `name`) - each difference is sent once */
const renamed = new Set<string>();

/**
 * Give loaded catalog overlays (tile overlays, live layers, 3D buildings)
 * the name the catalog has now - labels change (e.g. a "[WROCLAW] " prefix)
 * while profiles keep the name from when the overlay was added. Quiet: a
 * failed save is logged, and the same rename is not tried again until
 * reload. Returns how many overlays were renamed.
 */
export async function syncCatalogNames(catalog: OverlayCatalog): Promise<number> {
    const loaded = OverlayManager.loaded.filter((overlay) => !OverlayManager.isPinned(overlay));
    let count = 0;

    for (const { id, name } of staleNames(loaded, catalog)) {
        const key = `${id}\u0000${name}`;
        if (renamed.has(key)) continue;
        renamed.add(key);

        const overlay = OverlayManager.loadedFrom(id);
        if (!overlay) continue;

        overlay.name = name;
        try {
            await overlay.save();
            count += 1;
        } catch (err) {
            console.error('Failed to rename overlay to its catalog name', id, err);
        }
    }

    return count;
}
