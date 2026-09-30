import { describe, expect, it } from 'vitest';
import {
    moveInLayout,
    moveIndex,
    normalizeGroupName,
    partitionLayout,
    partitionOverlays,
    renumberGroups,
    restoreNode,
    sortGroups,
    stackOrder
} from './overlay-groups.ts';

type Item = { id: number; group_id: number | null };

const groups = [
    { id: 20, pos: 1, name: 'Rivers' },
    { id: 10, pos: 0, name: 'Roads' },
    { id: 30, pos: 1, name: 'Bridges' }
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
    const listOf = (current: typeof layout, id: number) => current.find((list) => list.ids.includes(id))?.key;

    it('builds the layout in menu order: the ungrouped list, then the groups in order', () => {
        expect(layout).toEqual([
            { key: null, ids: [1, 4] },
            { key: 10, ids: [3] },
            { key: 20, ids: [2, 5] },
            { key: 30, ids: [] }
        ]);
    });

    it('stacks in menu order: groups above the ungrouped overlays, later groups on top', () => {
        expect(stackOrder(layout)).toEqual([1, 4, 3, 2, 5]);
    });

    it('moves within a list', () => {
        const next = moveInLayout(layout, 5, 20, 0);
        expect(stackOrder(next)).toEqual([1, 4, 3, 5, 2]);
        expect(listOf(next, 5)).toBe(20);
        // input untouched
        expect(stackOrder(layout)).toEqual([1, 4, 3, 2, 5]);
    });

    it('moves into a group and into an empty group', () => {
        const intoGroup = moveInLayout(layout, 1, 20, 1);
        expect(intoGroup[0].ids).toEqual([4]);
        expect(intoGroup[2].ids).toEqual([2, 1, 5]);

        const intoEmpty = moveInLayout(layout, 3, 30, 5);
        expect(intoEmpty[1].ids).toEqual([]);
        expect(intoEmpty[3].ids).toEqual([3]);
        expect(stackOrder(intoEmpty)).toEqual([1, 4, 2, 5, 3]);
    });

    it('moves out of a group to the ungrouped list', () => {
        const next = moveInLayout(layout, 2, null, 0);
        expect(listOf(next, 2)).toBeNull();
        expect(stackOrder(next)).toEqual([2, 1, 4, 3, 5]);
    });

    it('rejects unknown overlays and lists', () => {
        expect(() => moveInLayout(layout, 42, null, 0)).toThrow();
        expect(() => moveInLayout(layout, 1, 42, 0)).toThrow();
    });

    it('draws the overlays of a group moved to the end of the menu above every other overlay', () => {
        const order = moveIndex(sortGroups(groups).map((g) => g.id), 0, 2);
        const reordered = order.map((id, pos) => ({ ...groups.find((g) => g.id === id)!, pos }));
        const moved = partitionLayout(partitionOverlays(items, reordered, (i) => i.group_id), (i) => i.id);

        expect(stackOrder(moved)).toEqual([1, 4, 2, 5, 3]);
    });
});

describe('moveIndex', () => {
    it('moves an element and clamps the target index', () => {
        expect(moveIndex([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
        expect(moveIndex([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
        expect(moveIndex([1, 2, 3], 0, 99)).toEqual([2, 3, 1]);
        expect(() => moveIndex([1], 3, 0)).toThrow();
    });
});

describe('renumberGroups', () => {
    it('renumbers groups 0..n in the given order and returns only the changes', () => {
        // 10 keeps 0 and 30 already has 1 - only 20 moves
        expect(renumberGroups(groups, [10, 30, 20])).toEqual([{ id: 20, pos: 2 }]);
        expect(renumberGroups(groups, [20, 10, 30])).toEqual([
            { id: 20, pos: 0 },
            { id: 10, pos: 1 },
            { id: 30, pos: 2 }
        ]);
    });

    it('repairs groups that share one pos', () => {
        const tied = [{ id: 1, pos: 5 }, { id: 2, pos: 5 }, { id: 3, pos: 5 }];
        expect(renumberGroups(tied, [3, 1, 2])).toEqual([
            { id: 3, pos: 0 },
            { id: 1, pos: 1 },
            { id: 2, pos: 2 }
        ]);
    });
});

describe('normalizeGroupName', () => {
    it('trims and enforces 1-64 characters', () => {
        expect(normalizeGroupName('  Roads  ')).toBe('Roads');
        expect(normalizeGroupName('   ')).toBeNull();
        expect(normalizeGroupName('x'.repeat(64))).toBe('x'.repeat(64));
        expect(normalizeGroupName('x'.repeat(65))).toBeNull();
    });
});

describe('restoreNode', () => {
    /** Mimic a Vue v-for fragment: empty text anchors around the rows */
    function list(ids: string[]): HTMLElement {
        const el = document.createElement('div');
        el.append(document.createTextNode(''));
        for (const id of ids) {
            const row = document.createElement('div');
            row.id = id;
            el.append(row);
        }
        el.append(document.createTextNode(''));
        return el;
    }

    function shape(el: HTMLElement): string[] {
        return Array.from(el.childNodes).map((node) => node.nodeType === 3 ? '|' : (node as HTMLElement).id);
    }

    it('puts the last row back before the end anchor after a drop in place or at the end', () => {
        const el = list(['a', 'b', 'c']);
        const item = el.querySelector('#c') as HTMLElement;
        const next = item.nextSibling;

        // Sortable appended the row at the very end, after the anchor
        el.appendChild(item);
        expect(shape(el)).toEqual(['|', 'a', 'b', '|', 'c']);

        restoreNode(item, el, next);
        expect(shape(el)).toEqual(['|', 'a', 'b', 'c', '|']);
    });

    it('puts a row moved to another list back into its own list', () => {
        const from = list(['a', 'b']);
        const to = list(['x']);
        const item = from.querySelector('#a') as HTMLElement;
        const next = item.nextSibling;

        to.insertBefore(item, to.querySelector('#x'));
        restoreNode(item, from, next);

        expect(shape(from)).toEqual(['|', 'a', 'b', '|']);
        expect(shape(to)).toEqual(['|', 'x', '|']);
    });

    it('appends when the recorded sibling left the list', () => {
        const el = list(['a']);
        const item = document.createElement('div');
        item.id = 'z';
        restoreNode(item, el, document.createTextNode(''));
        expect(shape(el)).toEqual(['|', 'a', '|', 'z']);
    });
});
