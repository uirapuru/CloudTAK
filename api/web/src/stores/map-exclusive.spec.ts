import { describe, expect, it } from 'vitest';
import { exclusive } from './map.ts';

/**
 * addTerrain() awaits Config.list(...) then std(...) before addSource('-2', ...).
 * Profile overlays initialize concurrently (Promise.allSettled), so without
 * serialization two callers can both pass the `getSource('-2')` guard and both
 * reach addSource, and the second throws "Source already exists". exclusive()
 * is the primitive addTerrain uses to prevent that: this proves its
 * concurrency guarantee directly, without needing to instantiate the full
 * Pinia store (which would require mocking Worker/BroadcastChannel/Config/std
 * unrelated to this race).
 */
describe('exclusive', () => {
    it('runs fn only once for calls that overlap while it is in flight', async () => {
        const box: { pending: Promise<void> | null } = { pending: null };
        let starts = 0;
        let resolveFn: (() => void) | undefined;
        const fn = () => new Promise<void>((resolve) => {
            starts++;
            resolveFn = resolve;
        });

        const p1 = exclusive(box, fn);
        const p2 = exclusive(box, fn);
        const p3 = exclusive(box, fn);

        // All concurrent callers share the exact same in-flight promise
        expect(p1).toBe(p2);
        expect(p2).toBe(p3);
        expect(starts).toBe(1);

        resolveFn!();
        await Promise.all([p1, p2, p3]);

        expect(starts).toBe(1);
    });

    it('clears the box after resolving so a later call runs again', async () => {
        const box: { pending: Promise<void> | null } = { pending: null };
        let starts = 0;
        const fn = async () => { starts++; };

        await exclusive(box, fn);
        expect(box.pending).toBeNull();

        await exclusive(box, fn);
        expect(starts).toBe(2);
    });

    it('clears the box even when fn rejects, and propagates the rejection', async () => {
        const box: { pending: Promise<void> | null } = { pending: null };
        const fn = async () => { throw new Error('boom'); };

        await expect(exclusive(box, fn)).rejects.toThrow('boom');
        expect(box.pending).toBeNull();
    });

    it('a caller that arrives after fn rejected starts its own run', async () => {
        const box: { pending: Promise<void> | null } = { pending: null };
        let starts = 0;
        const failing = async () => { starts++; throw new Error('boom'); };
        const succeeding = async () => { starts++; };

        await expect(exclusive(box, failing)).rejects.toThrow('boom');
        await exclusive(box, succeeding);

        expect(starts).toBe(2);
    });
});
