import { describe, expect, it } from 'vitest';
import {
    flattenLayout,
    listOf,
    moveInLayout,
    normalizeGroupName,
    partitionLayout,
    partitionOverlays,
    sortGroups
} from './overlay-groups.ts';

type Item = { id: number; group_id: number | null };

const groups = [
    { id: 20, pos: 1, name: 'Rzeki' },
    { id: 10, pos: 0, name: 'Drogi' },
    { id: 30, pos: 1, name: 'Mosty' }
];

const items: Item[] = [
    { id: 1, group_id: null },
    { id: 2, group_id: 20 },
    { id: 3, group_id: 10 },
    { id: 4, group_id: 99 },
    { id: 5, group_id: 20 }
];

describe('sortGroups', () => {
    it('orders by pos, then id, without mutating the input', () => {
        const input = [...groups];
        expect(sortGroups(input).map((g) => g.id)).toEqual([10, 20, 30]);
        expect(input.map((g) => g.id)).toEqual([20, 10, 30]);
    });
});

describe('partitionOverlays', () => {
    it('splits overlays per group keeping their order and treats unknown groups as ungrouped', () => {
        const partition = partitionOverlays(items, groups, (i) => i.group_id);

        expect(partition.ungrouped.map((i) => i.id)).toEqual([1, 4]);
        expect(partition.groups.map(({ group, items }) => [group.id, items.map((i) => i.id)])).toEqual([
            [10, [3]],
            [20, [2, 5]],
            [30, []]
        ]);
    });

    it('treats undefined as ungrouped', () => {
        const partition = partitionOverlays([{ id: 1 }], [], () => undefined);
        expect(partition.ungrouped).toEqual([{ id: 1 }]);
        expect(partition.groups).toEqual([]);
    });
});

describe('layout moves', () => {
    const layout = partitionLayout(partitionOverlays(items, groups, (i) => i.group_id), (i) => i.id);

    it('builds the layout ungrouped first, then groups in order', () => {
        expect(layout).toEqual([
            { key: null, ids: [1, 4] },
            { key: 10, ids: [3] },
            { key: 20, ids: [2, 5] },
            { key: 30, ids: [] }
        ]);
        expect(flattenLayout(layout)).toEqual([1, 4, 3, 2, 5]);
    });

    it('moves within a list', () => {
        const next = moveInLayout(layout, 5, 20, 0);
        expect(flattenLayout(next)).toEqual([1, 4, 3, 5, 2]);
        expect(listOf(next, 5)).toBe(20);
        // input untouched
        expect(flattenLayout(layout)).toEqual([1, 4, 3, 2, 5]);
    });

    it('moves into a group and into an empty group', () => {
        const intoGroup = moveInLayout(layout, 1, 20, 1);
        expect(intoGroup[0].ids).toEqual([4]);
        expect(intoGroup[2].ids).toEqual([2, 1, 5]);

        const intoEmpty = moveInLayout(layout, 3, 30, 5);
        expect(intoEmpty[1].ids).toEqual([]);
        expect(intoEmpty[3].ids).toEqual([3]);
        expect(flattenLayout(intoEmpty)).toEqual([1, 4, 2, 5, 3]);
    });

    it('moves out of a group to the ungrouped list', () => {
        const next = moveInLayout(layout, 2, null, 0);
        expect(listOf(next, 2)).toBeNull();
        expect(flattenLayout(next)).toEqual([2, 1, 4, 3, 5]);
    });

    it('rejects unknown overlays and lists', () => {
        expect(() => moveInLayout(layout, 42, null, 0)).toThrow();
        expect(() => moveInLayout(layout, 1, 42, 0)).toThrow();
        expect(listOf(layout, 42)).toBeUndefined();
    });
});

describe('normalizeGroupName', () => {
    it('trims and enforces 1-64 characters', () => {
        expect(normalizeGroupName('  Drogi  ')).toBe('Drogi');
        expect(normalizeGroupName('   ')).toBeNull();
        expect(normalizeGroupName('x'.repeat(64))).toBe('x'.repeat(64));
        expect(normalizeGroupName('x'.repeat(65))).toBeNull();
    });
});
