import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const std = vi.hoisted(() => vi.fn(async () => ({})));
const sub = vi.hoisted(() => ({
    feature: {
        update: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
    },
}));
const from = vi.hoisted(() => vi.fn(async () => sub));

vi.mock('../std.ts', () => ({
    std,
    server: {},
    stdurl: (url: string) => new URL(url, 'http://localhost'),
    getRuntimeToken: async () => null,
    downloadUrl: vi.fn(),
}));

vi.mock('../base/subscription.ts', () => ({ default: { from } }));

import { db } from '../database.ts';
import AtlasDatabase from '../workers/atlas-database.ts';
import type Atlas from '../workers/atlas.ts';
import type { Feature } from '../types.ts';
import { forceDeleteFeature, isOwnFeature } from '../base/delete-for-all.ts';

// taklab: obiekt utworzony przez usera kasuje się u wszystkich (t-x-d-d), cudzy tylko lokalnie

const ME = 'ANDROID-CloudTAK-me@example.com';
const GUID = '4b8f6d2e-1c3a-4e5f-9a7b-0d1e2f3a4b5c';

function polygon(id: string, opts: { creator?: string, archived?: boolean } = {}): Feature {
    return {
        id,
        type: 'Feature',
        path: '/',
        properties: {
            id,
            type: 'u-d-f',
            how: 'h-e',
            callsign: id,
            archived: opts.archived ?? true,
            time: '2026-10-30T00:00:00Z',
            start: '2026-10-30T00:00:00Z',
            stale: '2099-10-30T00:00:00Z',
            center: [21, 52, 0],
            ...(opts.creator ? { creator: { uid: opts.creator, type: 'a-f-G-E-V-C', callsign: 'X', time: '2026-10-30T00:00:00Z' } } : {}),
        },
        geometry: { type: 'Polygon', coordinates: [[[21, 52], [21.1, 52], [21.1, 52.1], [21, 52]]] },
    } as unknown as Feature;
}

function database() {
    const sendCOT = vi.fn((data: object) => { void data; return true; });
    const atlas = new AtlasDatabase({
        postMessage: vi.fn(),
        token: 'token',
        conn: { sendCOT },
        profile: {
            creator: async () => ({ uid: ME, type: 'a-f-G-E-V-C', callsign: 'Ja', time: '2026-10-30T00:00:00Z' }),
            uid: () => ME,
        },
    } as unknown as Atlas);
    return { atlas, sendCOT };
}

type Call = [string, { method?: string }];
const deletes = () => (std.mock.calls as unknown as Call[]).filter(([, o]) => o?.method === 'DELETE').map(([url]) => url);

beforeEach(async () => {
    await db.feature.clear();
    await db.config.put({ key: 'token', value: 'token' });
    std.mockClear();
    sub.feature.update.mockClear();
    sub.feature.delete.mockClear();
    await db.subscription.clear();
    await db.subscription_feature.clear();
});

describe('Usuwanie obiektu u wszystkich', () => {
    it('własny zapisany obiekt: DELETE z submit, serwer wysyła t-x-d-d', async () => {
        const { atlas, sendCOT } = database();
        await atlas.add(polygon('own-1'), { authored: true });
        std.mockClear();

        await atlas.remove('own-1', { authored: true });

        expect(deletes()).toEqual(['/api/profile/feature/own-1?submit=true']);
        expect(sendCOT).not.toHaveBeenCalled();
    });

    it('własny niezapisany obiekt: t-x-d-d prosto na strumień', async () => {
        const { atlas, sendCOT } = database();
        await atlas.add(polygon('own-2', { creator: ME, archived: false }));
        std.mockClear();

        await atlas.remove('own-2', { authored: true });

        expect(deletes()).toEqual([]);
        expect(sendCOT).toHaveBeenCalledTimes(1);
        const sent = sendCOT.mock.calls[0][0] as Feature;
        expect(sent.properties.type).toBe('t-x-d-d');
        expect(sent.properties.how).toBe('h-g-i-g-o');
        expect(sent.properties.forcedelete).toBe(true);
        expect(sent.properties.links).toEqual([{ uid: 'own-2', relation: 'none', type: 'u-d-f' }]);
        expect(sent.id).not.toBe('own-2');
    });

    it('cudzy obiekt: tylko lokalnie, bez t-x-d-d', async () => {
        const { atlas, sendCOT } = database();
        await atlas.add(polygon('other-1', { creator: 'ANDROID-someone-else' }));
        await atlas.add(polygon('other-2', { creator: 'ANDROID-someone-else', archived: false }));
        await atlas.add(polygon('other-3'));
        std.mockClear();

        await atlas.remove('other-1', { authored: true });
        await atlas.remove('other-2', { authored: true });
        await atlas.remove('other-3', { authored: true });

        expect(deletes()).toEqual(['/api/profile/feature/other-1', '/api/profile/feature/other-3']);
        expect(sendCOT).not.toHaveBeenCalled();
    });

    it('własny obiekt usunięty przez kod (bez authored) albo ze skipNetwork: bez t-x-d-d', async () => {
        const { atlas, sendCOT } = database();
        await atlas.add(polygon('own-3'), { authored: true });
        await atlas.add(polygon('own-4', { creator: ME, archived: false }));
        await atlas.add(polygon('own-5'), { authored: true });
        std.mockClear();

        await atlas.remove('own-3');
        await atlas.remove('own-4');
        await atlas.remove('own-5', { authored: true, skipNetwork: true });

        expect(deletes()).toEqual(['/api/profile/feature/own-3']);
        expect(sendCOT).not.toHaveBeenCalled();
    });

    it('obiekt z misji: bez zmian, usuwa API misji', async () => {
        const { atlas, sendCOT } = database();
        const feat = polygon('mission-1', { creator: ME });
        await db.subscription.put({ guid: GUID, name: 'Misja', subscribed: true, dirty: false } as never);
        await db.subscription_feature.put({
            id: 'mission-1', path: '/', mission: GUID,
            properties: feat.properties, geometry: feat.geometry,
            synced: true, deleted: false, attempts: 0,
        });
        std.mockClear();

        await atlas.remove('mission-1', { authored: true, mission: true });

        expect(sub.feature.delete).toHaveBeenCalledTimes(1);
        expect(deletes()).toEqual([]);
        expect(sendCOT).not.toHaveBeenCalled();
    });
});

describe('delete-for-all: pomocnicze', () => {
    it('isOwnFeature: twórca = bieżący uid, nie własna pozycja', () => {
        expect(isOwnFeature({ id: 'a', properties: { creator: { uid: ME } } }, ME)).toBe(true);
        expect(isOwnFeature({ id: 'a', properties: { creator: { uid: 'x' } } }, ME)).toBe(false);
        expect(isOwnFeature({ id: 'a', properties: {} }, ME)).toBe(false);
        expect(isOwnFeature({ id: ME, properties: { creator: { uid: ME } } }, ME)).toBe(false);
        expect(isOwnFeature({ id: 'a', properties: { creator: { uid: ME } } }, undefined)).toBe(false);
    });

    it('forceDeleteFeature: typ obiektu w link, brak typu daje none', () => {
        const feat = forceDeleteFeature('uid-1', undefined, new Date('2026-10-30T00:00:00Z'));
        expect(feat.properties.links).toEqual([{ uid: 'uid-1', relation: 'none', type: 'none' }]);
        expect(feat.properties.stale).toBe('2026-10-30T00:00:20.000Z');
    });
});
