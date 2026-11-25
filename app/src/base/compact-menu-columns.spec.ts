import { describe, expect, it } from 'vitest';
import { compactMenuColumns, compactMenuWidth } from './compact-menu-columns.ts';

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
