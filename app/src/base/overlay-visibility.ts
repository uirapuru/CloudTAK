export type VisibilityState = 'all' | 'some' | 'none';

/** Whether all, some or none of the items are visible (an empty list counts as none) */
export function visibilityState(items: Array<{ visible: boolean }>): VisibilityState {
    const shown = items.filter((i) => i.visible).length;
    if (shown === 0) return 'none';
    return shown === items.length ? 'all' : 'some';
}

/**
 * Sets visibility on every item through the given (per-overlay) update
 * function; items already in the wanted state are skipped.
 */
export async function setAllVisible<T extends { visible: boolean }>(
    items: T[],
    visible: boolean,
    update: (item: T, body: { visible: boolean }) => Promise<void>
): Promise<void> {
    await Promise.all(items.filter((i) => i.visible !== visible).map((i) => update(i, { visible })));
}
