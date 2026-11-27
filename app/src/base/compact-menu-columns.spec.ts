import { describe, expect, it } from 'vitest';
import {
    compactMenuColumns,
    compactMenuWidth,
    isBenignResizeObserverError,
    settleCompactColumns,
} from './compact-menu-columns.ts';

const base = { itemHeight: 48, viewportWidth: 1920 };

describe('compactMenuColumns', () => {
    it('keeps one column when every icon fits', () => {
        expect(compactMenuColumns({ ...base, itemCount: 18, availableHeight: 900 })).toBe(1);
        expect(compactMenuColumns({ ...base, itemCount: 18, availableHeight: 18 * 48 })).toBe(1);
    });

    it('adds a second column once icons overflow the height', () => {
        expect(compactMenuColumns({ ...base, itemCount: 19, availableHeight: 18 * 48 })).toBe(2);
        expect(compactMenuColumns({ ...base, itemCount: 22, availableHeight: 600 })).toBe(2);
    });

    it('adds a third column on short windows', () => {
        expect(compactMenuColumns({ ...base, itemCount: 22, availableHeight: 400 })).toBe(3);
    });

    it('never exceeds three columns', () => {
        expect(compactMenuColumns({ ...base, itemCount: 28, availableHeight: 100 })).toBe(3);
        expect(compactMenuColumns({ ...base, itemCount: 28, availableHeight: 10 })).toBe(3);
    });

    it('honours a custom maximum', () => {
        expect(compactMenuColumns({ ...base, itemCount: 28, availableHeight: 100, maxColumns: 2 })).toBe(2);
    });

    it('stays at one column on narrow viewports', () => {
        expect(compactMenuColumns({ ...base, viewportWidth: 767, itemCount: 28, availableHeight: 200 })).toBe(1);
    });

    it('stays at one column before the layout is measured', () => {
        expect(compactMenuColumns({ ...base, itemCount: 28, availableHeight: 0 })).toBe(1);
        expect(compactMenuColumns({ ...base, itemCount: 28, availableHeight: 400, itemHeight: 0 })).toBe(1);
        expect(compactMenuColumns({ ...base, itemCount: 0, availableHeight: 400 })).toBe(1);
    });
});

describe('compactMenuWidth', () => {
    it('is sixty pixels per column', () => {
        expect(compactMenuWidth(1)).toBe(60);
        expect(compactMenuWidth(3)).toBe(180);
        expect(compactMenuWidth(0)).toBe(60);
    });
});

describe('settleCompactColumns', () => {
    it('grows and remembers the layout it grew for', () => {
        expect(settleCompactColumns({ current: 2, next: 3, layoutKey: '1280x680:18', grownFor: '' }))
            .toEqual({ columns: 3, grownFor: '1280x680:18' });
    });

    // Fewer columns make the footer text wrap, which shrinks the icon area and
    // asks for more columns again: the 2 <-> 3 flicker from 27 XI 2026.
    it('does not shrink when only its own width change moved the layout', () => {
        expect(settleCompactColumns({ current: 3, next: 2, layoutKey: '1280x680:18', grownFor: '1280x680:18' }))
            .toEqual({ columns: 3, grownFor: '1280x680:18' });
    });

    it('shrinks after the window or the item count changes', () => {
        expect(settleCompactColumns({ current: 3, next: 2, layoutKey: '1280x900:18', grownFor: '1280x680:18' }))
            .toEqual({ columns: 2, grownFor: '1280x680:18' });
        expect(settleCompactColumns({ current: 3, next: 1, layoutKey: '1280x680:12', grownFor: '1280x680:18' }))
            .toEqual({ columns: 1, grownFor: '1280x680:18' });
    });

    it('keeps the value when nothing changes', () => {
        expect(settleCompactColumns({ current: 2, next: 2, layoutKey: 'a', grownFor: 'b' }))
            .toEqual({ columns: 2, grownFor: 'b' });
    });
});

describe('isBenignResizeObserverError', () => {
    it('matches both browser wordings', () => {
        expect(isBenignResizeObserverError('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
        expect(isBenignResizeObserverError('ResizeObserver loop limit exceeded')).toBe(true);
    });

    it('ignores other errors', () => {
        expect(isBenignResizeObserverError('TypeError: x is undefined')).toBe(false);
        expect(isBenignResizeObserverError(undefined)).toBe(false);
    });
});
