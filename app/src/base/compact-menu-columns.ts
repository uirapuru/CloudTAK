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
