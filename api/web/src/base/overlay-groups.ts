/**
 * Pure helpers for user defined Overlay Groups - kept free of the map store
 * and the database so they can be unit tested in isolation.
 *
 * The Overlays menu lists the map stack bottom first (basemap on top of the
 * menu, "Map Features" at the end). Ordinary overlays are shown as the
 * ungrouped list followed by the groups (lowest `pos` first), so every group
 * is drawn above the ungrouped overlays and above the groups listed before
 * it. A layout (`OverlayLayoutList[]`) is kept in that menu order, and
 * `stackOrder()` turns it into the map stack order, bottom first.
 */

export type OverlayGroupLike = {
    id: number;
    pos: number;
};

/** Key of a sortable list in the menu - null is the list of ungrouped overlays */
export type OverlayListKey = number | null;

export type OverlayLayoutList = {
    key: OverlayListKey;
    ids: number[];
};

export type OverlayPartition<T, G> = {
    ungrouped: T[];
    groups: Array<{ group: G; items: T[] }>;
};

/** Groups ordered by `pos`, ties broken by id (creation order) */
export function sortGroups<G extends OverlayGroupLike>(groups: G[]): G[] {
    return [...groups].sort((a, b) => a.pos - b.pos || a.id - b.id);
}

/**
 * Split overlays into the ungrouped list and one list per group, keeping the
 * given overlay order inside every list. An overlay pointing at a group that
 * is not known (deleted, or created on another device and not loaded yet) is
 * treated as ungrouped. Every group is returned, including empty ones.
 */
export function partitionOverlays<T, G extends OverlayGroupLike>(
    items: T[],
    groups: G[],
    groupOf: (item: T) => number | null | undefined
): OverlayPartition<T, G> {
    const sorted = sortGroups(groups);
    const byId = new Map<number, T[]>(sorted.map((group) => [group.id, []]));
    const ungrouped: T[] = [];

    for (const item of items) {
        const groupId = groupOf(item);
        const list = groupId === null || groupId === undefined ? undefined : byId.get(groupId);
        if (list) list.push(item);
        else ungrouped.push(item);
    }

    return {
        ungrouped,
        groups: sorted.map((group) => ({ group, items: byId.get(group.id) ?? [] }))
    };
}

/** Sortable layout (ids per list) of a partition in menu order - the ungrouped list, then the groups in order */
export function partitionLayout<T, G extends OverlayGroupLike>(
    partition: OverlayPartition<T, G>,
    idOf: (item: T) => number
): OverlayLayoutList[] {
    return [
        { key: null, ids: partition.ungrouped.map(idOf) },
        ...partition.groups.map(({ group, items }) => ({ key: group.id, ids: items.map(idOf) }))
    ];
}

/**
 * Move an overlay to `index` of the list `to` (the index is clamped to the
 * list). Returns a new layout; the input is left untouched. Throws when the
 * overlay or the target list is not part of the layout.
 */
export function moveInLayout(
    layout: OverlayLayoutList[],
    id: number,
    to: OverlayListKey,
    index: number
): OverlayLayoutList[] {
    if (!layout.some((list) => list.ids.includes(id))) throw new Error(`Overlay ${id} is not in the layout`);
    if (!layout.some((list) => list.key === to)) throw new Error(`List ${String(to)} is not in the layout`);

    const next = layout.map((list) => ({ key: list.key, ids: list.ids.filter((current) => current !== id) }));
    const target = next.find((list) => list.key === to) as OverlayLayoutList;
    const at = Math.max(0, Math.min(index, target.ids.length));
    target.ids.splice(at, 0, id);

    return next;
}

/** Map stack order (bottom first) of a layout - the menu order */
export function stackOrder(layout: OverlayLayoutList[]): number[] {
    return layout.flatMap((list) => list.ids);
}

/**
 * Move the id at `from` to `to` (both indexes of `ids`, `to` clamped to the
 * list). Returns a new array; the input is left untouched.
 */
export function moveIndex<T>(ids: T[], from: number, to: number): T[] {
    if (from < 0 || from >= ids.length) throw new Error(`Index ${from} is not in the list`);
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
    return next;
}

/**
 * Positions for groups shown in `orderedIds` order (menu order): they are
 * renumbered 0, 1, 2... Only the groups whose `pos` changes are returned, so
 * a state where several groups share one `pos` is repaired by the next drop.
 */
export function renumberGroups<G extends OverlayGroupLike>(groups: G[], orderedIds: number[]): Array<{ id: number; pos: number }> {
    const byId = new Map(groups.map((group) => [group.id, group]));
    const changes: Array<{ id: number; pos: number }> = [];

    orderedIds.forEach((id, pos) => {
        const group = byId.get(id);
        if (group && group.pos !== pos) changes.push({ id, pos });
    });

    return changes;
}

/** Longest group name the server accepts */
export const GROUP_NAME_MAX = 64;

/** Trimmed group name, or null when it is empty or longer than the server allows */
export function normalizeGroupName(name: string): string | null {
    const trimmed = name.trim();
    if (!trimmed.length || trimmed.length > GROUP_NAME_MAX) return null;
    return trimmed;
}

/**
 * Put a node Sortable moved back where it was. `next` is the node's
 * nextSibling recorded when the drag started - a node, not an element index,
 * so Vue's (empty text) fragment anchors keep their place around the rows.
 */
export function restoreNode(node: Node, parent: Node, next: Node | null): void {
    parent.insertBefore(node, next && next.parentNode === parent ? next : null);
}
