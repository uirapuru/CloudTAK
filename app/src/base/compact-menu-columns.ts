// Width of one column of the compact (icon-only) main menu, in pixels.
export const COMPACT_MENU_COLUMN_WIDTH = 60;

// The compact menu never grows wider than this many columns; past it the
// icons scroll as before.
export const COMPACT_MENU_MAX_COLUMNS = 3;

// Below this viewport width (Bootstrap `md`) the compact menu keeps a single
// column so it does not eat a narrow screen.
export const COMPACT_MENU_MIN_VIEWPORT_WIDTH = 768;

export interface CompactMenuColumnsInput {
    itemCount: number;
    availableHeight: number;
    itemHeight: number;
    viewportWidth: number;
    maxColumns?: number;
}

/**
 * Number of icon columns for the compact main menu: one while every icon fits
 * in the available height, then as many as needed to avoid scrolling, capped
 * at `maxColumns`. Narrow viewports and unmeasured layouts stay at one column.
 */
export function compactMenuColumns(input: CompactMenuColumnsInput): number {
    const maxColumns = Math.max(1, Math.floor(input.maxColumns ?? COMPACT_MENU_MAX_COLUMNS));

    if (input.viewportWidth < COMPACT_MENU_MIN_VIEWPORT_WIDTH) return 1;
    if (!(input.itemCount > 0) || !(input.itemHeight > 0) || !(input.availableHeight > 0)) return 1;

    const rowsThatFit = Math.max(1, Math.floor(input.availableHeight / input.itemHeight));
    const needed = Math.ceil(input.itemCount / rowsThatFit);

    return Math.min(maxColumns, Math.max(1, needed));
}

export function compactMenuWidth(columns: number): number {
    return COMPACT_MENU_COLUMN_WIDTH * Math.max(1, columns);
}

export interface SettleCompactColumnsInput {
    current: number;
    next: number;
    // Identifies what the column count depends on from outside the menu:
    // window size and number of visible items.
    layoutKey: string;
    // `layoutKey` at the moment the menu last grew.
    grownFor: string;
}

/**
 * Applies a newly measured column count without flicker. Fewer columns make
 * the footer text wrap, which shrinks the icon area and asks for more columns
 * again, so the menu shrinks only after the window or the item count changed
 * since it last grew.
 */
export function settleCompactColumns(input: SettleCompactColumnsInput): { columns: number; grownFor: string } {
    if (input.next > input.current) return { columns: input.next, grownFor: input.layoutKey };
    if (input.next < input.current && input.layoutKey === input.grownFor) {
        return { columns: input.current, grownFor: input.grownFor };
    }
    return { columns: input.next, grownFor: input.grownFor };
}

/**
 * Browsers report a ResizeObserver callback that changed layout again as an
 * error event. It is harmless (the notifications arrive next frame) and must
 * not reach the error dialog.
 */
export function isBenignResizeObserverError(message: string | undefined): boolean {
    return typeof message === 'string' && message.startsWith('ResizeObserver loop');
}
