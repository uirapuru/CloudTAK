import { describe, expect, it } from 'vitest';
import { matchesFilter, overlayCountText, selectToAdd, selectToRemove, type ExplorerRef } from './overlay-explorer-bulk.ts';

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

describe('matchesFilter', () => {
    const item = { name: 'adsb', label: 'Samoloty ADS-B' };
    it('matches label or name, ignoring case and surrounding spaces', () => {
        expect(matchesFilter(item, '')).toBe(true);
        expect(matchesFilter(item, '  samoloty ')).toBe(true);
        expect(matchesFilter(item, 'ADSB')).toBe(true);
        expect(matchesFilter(item, 'tramwaj')).toBe(false);
    });
});

describe('overlayCountText', () => {
    it('uses the right Polish form', () => {
        expect(overlayCountText(1)).toBe('1 nakładkę');
        expect(overlayCountText(3)).toBe('3 nakładki');
        expect(overlayCountText(5)).toBe('5 nakładek');
        expect(overlayCountText(12)).toBe('12 nakładek');
        expect(overlayCountText(22)).toBe('22 nakładki');
        expect(overlayCountText(0)).toBe('0 nakładek');
    });
});
