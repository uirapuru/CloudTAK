import { describe, expect, it, vi } from 'vitest';
import { setAllVisible, visibilityState } from './overlay-visibility.ts';

describe('visibilityState', () => {
    it('classifies all, some and none', () => {
        expect(visibilityState([{ visible: true }, { visible: true }])).toBe('all');
        expect(visibilityState([{ visible: true }, { visible: false }])).toBe('some');
        expect(visibilityState([{ visible: false }])).toBe('none');
        expect(visibilityState([])).toBe('none');
    });
});

describe('setAllVisible', () => {
    it('updates only items in another state, via the given function', async () => {
        const items = [{ id: 1, visible: true }, { id: 2, visible: false }, { id: 3, visible: false }];
        const update = vi.fn(async () => {});
        await setAllVisible(items, true, update);
        expect(update).toHaveBeenCalledTimes(2);
        expect(update).toHaveBeenCalledWith(items[1], { visible: true });
        expect(update).toHaveBeenCalledWith(items[2], { visible: true });
    });
    it('hides everything', async () => {
        const items = [{ visible: true }, { visible: true }];
        const update = vi.fn(async () => {});
        await setAllVisible(items, false, update);
        expect(update).toHaveBeenCalledTimes(2);
    });
});
