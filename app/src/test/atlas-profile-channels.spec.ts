import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerMessageType } from '../utils/events.ts';
import type { WorkerMessage } from '../utils/events.ts';
import type Atlas from '../workers/atlas.ts';

const list = vi.fn();
vi.mock('../base/group.ts', () => ({ default: { list: (...args: unknown[]) => list(...args) } }));

const { default: AtlasProfile } = await import('../workers/atlas-profile.ts');

function fakeAtlas(): { atlas: Atlas; posted: WorkerMessage[] } {
    const posted: WorkerMessage[] = [];
    const atlas = { postMessage: vi.fn(async (msg: WorkerMessage) => { posted.push(msg); }) } as unknown as Atlas;
    return { atlas, posted };
}

// taklab: CloudTAK kept the channel state in IndexedDB and never asked the
// server again, so a channel disabled once stayed "No Channels Active" even
// after the server enabled it (administrator on snipy-poligon26, 23 XI 2026).
describe('AtlasProfile channels on map load', () => {
    beforeEach(() => list.mockReset());

    it('loads channels from the server on map load', async () => {
        list.mockImplementation(async (opts?: { sync?: boolean; active?: boolean }) => (
            opts?.active === undefined ? [{ name: '__ANON__', active: true }] : [{ name: '__ANON__', active: true }]
        ));
        const { atlas, posted } = fakeAtlas();
        const profile = new AtlasProfile(atlas);
        await profile.loadChannels({ sync: true });
        expect(list.mock.calls[0][0]).toEqual({ sync: true });
        expect(posted.map((m) => m.type)).toContain(WorkerMessageType.Channels_List);
    });

    it('falls back to the cached channels when the server cannot be reached', async () => {
        list.mockImplementation(async (opts?: { sync?: boolean }) => {
            if (opts?.sync) throw new Error('Failed to sync groups');
            return [{ name: '__ANON__', active: false }];
        });
        const { atlas, posted } = fakeAtlas();
        const profile = new AtlasProfile(atlas);
        const channels = await profile.loadChannels({ sync: true });
        expect(channels).toEqual([{ name: '__ANON__', active: false }]);
        expect(posted.map((m) => m.type)).toContain(WorkerMessageType.Channels_None);
    });

    it('init asks the server for channels', async () => {
        list.mockResolvedValue([]);
        const profile = new AtlasProfile(fakeAtlas().atlas);
        const spy = vi.spyOn(profile, 'loadChannels').mockResolvedValue([]);
        vi.spyOn(profile, 'load').mockResolvedValue(undefined as never);
        vi.spyOn(profile, 'loadServer').mockResolvedValue(undefined as never);
        vi.spyOn(profile, 'setupTimer').mockImplementation(() => undefined);
        await profile.init().catch(() => undefined);
        expect(spy).toHaveBeenCalledWith({ sync: true });
    });
});
