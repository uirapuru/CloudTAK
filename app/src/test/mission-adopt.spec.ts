import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const std = vi.hoisted(() => vi.fn(async () => ({})));
const sub = vi.hoisted(() => ({
    feature: { update: vi.fn(async () => undefined) },
}));
const from = vi.hoisted(() => vi.fn());

vi.mock('../std.ts', () => ({
    std,
    server: {},
    stdurl: (url: string) => new URL(url, 'http://localhost'),
    getRuntimeToken: async () => null,
    downloadUrl: vi.fn(),
}));

vi.mock('../base/subscription.ts', () => ({ default: { from } }));

import { db } from '../database.ts';
import AtlasDatabase, { SUBSCRIPTION_PENDING_TTL_MS } from '../workers/atlas-database.ts';
import COT, { OriginMode } from '../base/cot.ts';
import type Atlas from '../workers/atlas.ts';
import type { Feature } from '../types.ts';
import { WorkerMessageType } from '../utils/events.ts';

// taklab: obiekt odebrany z grupy, który serwer dopisał do misji wspólnej,
// przechodzi do magazynu misji - jeden obiekt na mapie, edycje idą do misji

const GUID = '4b8f6d2e-1c3a-4e5f-9a7b-0d1e2f3a4b5c';

function marker(id: string, creator?: string): Feature {
    return {
        id,
        type: 'Feature',
        path: '/',
        properties: {
            id,
            type: 'a-h-G',
            how: 'h-g-i-g-o',
            callsign: id,
            time: '2026-10-16T00:00:00Z',
            start: '2026-10-16T00:00:00Z',
            stale: '2099-10-17T00:00:00Z',
            center: [21, 52, 0],
            ...(creator ? { creator: { uid: creator, type: 'a-f-G', callsign: creator, time: '2026-10-16T00:00:00Z' } } : {}),
        },
        geometry: { type: 'Point', coordinates: [21, 52, 0] },
    } as unknown as Feature;
}

function addContent(uid: string): Feature {
    return {
        id: 'task-1',
        type: 'Feature',
        path: '/',
        properties: {
            id: 'task-1',
            type: 't-x-m-c',
            how: 'h-g-i-g-o',
            callsign: 'UNKNOWN',
            center: [0, 0, 0],
            mission: {
                type: 'CHANGE',
                tool: 'public',
                name: 'Mapa test',
                guid: GUID,
                authorUid: 'other',
                missionChanges: [{
                    contentUid: uid,
                    creatorUid: 'other',
                    isFederatedChange: false,
                    missionName: 'Mapa test',
                    timestamp: '2026-10-16T00:00:00Z',
                    type: 'ADD_CONTENT',
                }],
            },
        },
        geometry: { type: 'Point', coordinates: [0, 0, 0] },
    } as unknown as Feature;
}

function database(): { atlas: AtlasDatabase, postMessage: ReturnType<typeof vi.fn> } {
    const postMessage = vi.fn();
    const atlas = new AtlasDatabase({
        postMessage,
        token: 'token',
        profile: {
            creator: async () => ({ uid: 'me', type: 'a-f-G', callsign: 'Ja', time: '2026-10-16T00:00:00Z' }),
            uid: () => 'me',
        },
    } as unknown as Atlas);

    return { atlas, postMessage };
}

beforeEach(async () => {
    await db.feature.clear();
    await db.subscription_changes.clear();
    await db.config.put({ key: 'token', value: 'token' });
    std.mockClear();
    sub.feature.update.mockClear();
    from.mockReset();
    from.mockResolvedValue(sub);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('AtlasDatabase: ADD_CONTENT dla obiektu z warstwy połączenia', () => {
    it('cudzy obiekt przechodzi do magazynu misji i znika z warstwy połączenia', async () => {
        const { atlas, postMessage } = database();
        await atlas.add(marker('enemy-1', 'other'));
        expect(atlas.cots.has('enemy-1')).toBe(true);

        await atlas.subChange(addContent('enemy-1'));

        expect(from).toHaveBeenCalledWith(GUID, { subscribed: true });
        expect(sub.feature.update).toHaveBeenCalledTimes(1);
        const moved = (sub.feature.update.mock.calls[0] as unknown[])[1] as COT;
        expect(moved.id).toBe('enemy-1');
        expect(moved.origin).toEqual({ mode: OriginMode.MISSION, mode_id: GUID });

        expect(atlas.cots.has('enemy-1')).toBe(false);
        expect(atlas.subscriptionPending.size).toBe(0);
        expect(postMessage).toHaveBeenCalledWith({ type: WorkerMessageType.Mission_Change_Feature, body: { guid: GUID } });

        const diff = await atlas.diff();
        expect(diff.remove).toContain(COT.vectorId('enemy-1'));
        expect(diff.add).toEqual([]);
    });

    it('własny obiekt zostaje w warstwie połączenia', async () => {
        const { atlas } = database();
        await atlas.add(marker('mine-1', 'me'));

        await atlas.subChange(addContent('mine-1'));

        expect(sub.feature.update).not.toHaveBeenCalled();
        expect(atlas.cots.has('mine-1')).toBe(true);
    });

    it('misja niewczytana: obiekt zostaje w warstwie połączenia', async () => {
        from.mockResolvedValue(undefined);
        const { atlas } = database();
        await atlas.add(marker('enemy-2', 'other'));

        await atlas.subChange(addContent('enemy-2'));

        expect(atlas.cots.has('enemy-2')).toBe(true);
    });

    it('wpis ADD_CONTENT bez CoT znika po czasie', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));

        const { atlas } = database();
        await atlas.subChange(addContent('never-arrives'));
        expect(atlas.subscriptionPending.has('never-arrives')).toBe(true);

        vi.setSystemTime(new Date(Date.now() + SUBSCRIPTION_PENDING_TTL_MS - 1));
        await atlas.subChange(addContent('other-uid'));
        expect(atlas.subscriptionPending.has('never-arrives')).toBe(true);

        vi.setSystemTime(new Date(Date.now() + 2));
        await atlas.subChange(addContent('third-uid'));
        expect(atlas.subscriptionPending.has('never-arrives')).toBe(false);
        expect(atlas.subscriptionPending.has('third-uid')).toBe(true);
    });
});
