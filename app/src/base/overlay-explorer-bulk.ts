export type ExplorerMode = 'overlay' | 'live' | 'ion';
export type ExplorerRef = { mode: ExplorerMode; modeId: string };
type LoadedLike = { mode: string; mode_id?: string | null };

const key = (mode: string, modeId: string) => `${mode}\u0000${modeId}`;

/** Explorer items that are not loaded yet (each item once, order kept) */
export function selectToAdd(items: ExplorerRef[], loaded: LoadedLike[]): ExplorerRef[] {
    const have = new Set(loaded.filter((o) => o.mode_id).map((o) => key(o.mode, String(o.mode_id))));
    const out: ExplorerRef[] = [];
    for (const item of items) {
        const k = key(item.mode, item.modeId);
        if (have.has(k)) continue;
        have.add(k);
        out.push(item);
    }
    return out;
}

/**
 * Loaded overlays that come from one of the Explorer items. Anything else
 * (CoTs, Map Features, mission and file overlays) is never returned.
 */
export function selectToRemove<T extends LoadedLike>(items: ExplorerRef[], loaded: T[]): T[] {
    const wanted = new Set(items.map((i) => key(i.mode, i.modeId)));
    return loaded.filter((o) => !!o.mode_id && wanted.has(key(o.mode, String(o.mode_id))));
}

/** Whether a named Explorer item matches the search filter (case-insensitive, label or name) */
export function matchesFilter(item: { name: string; label: string }, filter: string): boolean {
    const term = filter.trim().toLowerCase();
    if (!term) return true;
    return item.label.toLowerCase().includes(term) || item.name.toLowerCase().includes(term);
}

/** "1 nakładkę", "3 nakładki", "5 nakładek" - Polish accusative plural */
export function overlayCountText(count: number): string {
    const tens = count % 100;
    const ones = count % 10;
    if (count === 1) return '1 nakładkę';
    if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return `${count} nakładki`;
    return `${count} nakładek`;
}
