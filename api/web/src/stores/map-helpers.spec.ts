import { describe, expect, it } from 'vitest';
import { firstStyledLayerId } from './map.ts';

/**
 * getOverlayBeforeId() and MenuOverlays.vue's saveOrder() both need the id of
 * the first MapLibre style/layer among the overlays, but a `3dtiles` overlay
 * has `styles: []` (it is drawn by deck.gl, not MapLibre layers). Reading
 * `overlays[1].styles[0]` blindly breaks as soon as a 3D overlay sits at that
 * index. firstStyledLayerId() is the shared, pure selection logic both call
 * sites use instead: this proves it directly, without instantiating the full
 * Pinia store.
 */
describe('firstStyledLayerId', () => {
    it('returns the first style id of the first overlay from `from` onward', () => {
        const overlays = [
            { styles: [{ id: 'basemap-layer' }] },
            { styles: [{ id: 'a' }, { id: 'b' }] },
            { styles: [{ id: 'c' }] },
        ];

        expect(firstStyledLayerId(overlays)).toBe('a');
    });

    it('skips a style-less (e.g. 3dtiles) overlay and returns the next styled one', () => {
        const overlays = [
            { styles: [{ id: 'basemap-layer' }] },
            { styles: [] }, // 3dtiles overlay: no MapLibre layers
            { styles: [{ id: 'c' }] },
        ];

        expect(firstStyledLayerId(overlays)).toBe('c');
    });

    it('returns undefined when no overlay from `from` onward has styles', () => {
        const overlays = [
            { styles: [{ id: 'basemap-layer' }] },
            { styles: [] },
            { styles: [] },
        ];

        expect(firstStyledLayerId(overlays)).toBeUndefined();
    });

    it('returns undefined when there is no overlay at or after `from`', () => {
        expect(firstStyledLayerId([{ styles: [{ id: 'only' }] }])).toBeUndefined();
        expect(firstStyledLayerId([])).toBeUndefined();
    });

    it('honours a custom `from` index, as saveOrder() needs for its anchor search', () => {
        const overlays = [
            { styles: [{ id: 'a' }] },
            { styles: [{ id: 'b' }] },
            { styles: [] },
            { styles: [{ id: 'd' }] },
        ];

        // saveOrder() searches starting at newIndex + 1, which may be > 1
        expect(firstStyledLayerId(overlays, 2)).toBe('d');
        expect(firstStyledLayerId(overlays, 0)).toBe('a');
    });

    it('coerces numeric ids to strings, like MapLibre layer ids', () => {
        const overlays = [
            { styles: [] },
            { styles: [{ id: 42 }] },
        ];

        expect(firstStyledLayerId(overlays)).toBe('42');
    });
});
