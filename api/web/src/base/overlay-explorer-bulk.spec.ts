import { describe, expect, it } from 'vitest';
import { selectToAdd, selectToRemove, type ExplorerRef } from './overlay-explorer-bulk.ts';

const ITEMS: ExplorerRef[] = [
    { mode: 'overlay', modeId: '1' },
    { mode: 'live', modeId: 'adsb' },
    { mode: 'ion', modeId: 'wro' },
    { mode: 'live', modeId: 'adsb' },
];

describe('selectToAdd', () => {
    it('skips loaded ones and duplicates', () => {
        const loaded = [{ mode: 'overlay', mode_id: '1' }, { mode: 'cots', mode_id: null }];
        expect(selectToAdd(ITEMS, loaded)).toEqual([
            { mode: 'live', modeId: 'adsb' },
            { mode: 'ion', modeId: 'wro' },
        ]);
    });
    it('matches mode as well as id', () => {
        expect(selectToAdd([{ mode: 'live', modeId: '1' }], [{ mode: 'overlay', mode_id: '1' }])).toHaveLength(1);
    });
});

describe('selectToRemove', () => {
    it('returns only overlays from Explorer items', () => {
        const a = { mode: 'overlay', mode_id: '1' };
        const b = { mode: 'live', mode_id: 'adsb' };
        const cots = { mode: 'cots', mode_id: null };
        const mission = { mode: 'mission', mode_id: 'guid' };
        const other = { mode: 'overlay', mode_id: '99' };
        const file = { mode: 'overlay', mode_id: undefined };
        expect(selectToRemove(ITEMS, [a, cots, b, mission, other, file])).toEqual([a, b]);
    });
});
