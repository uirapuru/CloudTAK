import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { std, server } = vi.hoisted(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const std = vi.fn(async (..._args: unknown[]) => ({}));
    // v14: Profile Features go through FeatureOutbox and server.PUT/DELETE;
    // the calls are mirrored into std so the assertions read the same URLs
    type Opts = { params?: { path?: Record<string, string>, query?: { submit?: boolean } }, body?: unknown };
    const url = (path: string, opts?: Opts) => {
        const id = opts?.params?.path?.[':id'];
        return (id ? path.replace('{:id}', id) : path) + (opts?.params?.query?.submit ? '?submit=true' : '');
    };
    const server = {
        PUT: vi.fn(async (path: string, opts?: Opts) => { await std(url(path, opts), { method: 'PUT', body: opts?.body }); return { data: {} }; }),
        DELETE: vi.fn(async (path: string, opts?: Opts) => { await std(url(path, opts), { method: 'DELETE' }); return { data: {} }; }),
    };
    return { std, server };
});

vi.mock('../std.ts', () => ({
    std,
    server,
    stdurl: (url: string) => new URL(url, 'http://localhost'),
    getRuntimeToken: async () => null,
    downloadUrl: vi.fn(),
}));

import { db } from '../database.ts';
import FeatureOutbox from '../base/feature-outbox.ts';
import AtlasDatabase from '../workers/atlas-database.ts';
import type Atlas from '../workers/atlas.ts';
import type { Feature } from '../types.ts';
import { WorkerMessageType } from '../utils/events.ts';

const coordinates = [[21, 52], [21.1, 52.1]];
const moved = [[21, 52], [21.2, 52.2]];
const plan = {
    version: 1,
    mode: 'foot',
    mode_name: 'Pieszo',
    waypoints: [[21, 52], [21.1, 52.1]],
    legs: [{ start: 0, end: 1, distance_m: 1, duration_s: 1 }],
};
const movedPlan = { ...plan, waypoints: moved };

function route(opts: { geometry?: number[][], metadata?: Record<string, unknown> } = {}): Feature {
    return {
        id: 'route-1',
        type: 'Feature',
        path: '/',
        properties: {
            id: 'route-1',
            type: 'b-m-r',
            callsign: 'Trasa',
            archived: true,
            time: '2026-10-16T00:00:00Z',
            start: '2026-10-16T00:00:00Z',
            stale: '2026-10-17T00:00:00Z',
            metadata: opts.metadata ?? { taklab_route: plan },
        },
        geometry: { type: 'LineString', coordinates: opts.geometry ?? coordinates },
    } as unknown as Feature;
}

function marker(): Feature {
    return {
        id: 'marker-1',
        type: 'Feature',
        path: '/',
        properties: {
            id: 'marker-1',
            type: 'u-d-p',
            callsign: 'Punkt',
            archived: true,
            time: '2026-10-16T00:00:00Z',
            start: '2026-10-16T00:00:00Z',
            stale: '2026-10-17T00:00:00Z',
        },
        geometry: { type: 'Point', coordinates: [21, 52] },
    } as unknown as Feature;
}

function database(): AtlasDatabase {
    return new AtlasDatabase({
        postMessage: vi.fn(),
        token: 'token',
        profile: {
            creator: async () => ({ uid: 'me', type: 'a-f-G', callsign: 'Ja', time: '2026-10-16T00:00:00Z' }),
            uid: () => 'me',
        },
    } as unknown as Atlas);
}

type Call = [string, { method?: string }];
const calls = () => std.mock.calls as unknown as Call[];
const puts = () => calls().filter(([, o]) => o?.method === 'PUT').map(([url]) => url);
const deletes = () => calls().filter(([, o]) => o?.method === 'DELETE').map(([url]) => url);

beforeEach(async () => {
    await db.feature.clear();
    await db.config.put({ key: 'token', value: 'token' });
    std.mockClear();
    FeatureOutbox.pending.clear();
    FeatureOutbox.submits.clear();
    FeatureOutbox.cancelRetry();
});

describe('AtlasDatabase: publikacja trasy z planem tylko przy zmianie usera', () => {
    it('nowa trasa od usera: jeden PUT z submit, bez zwykłego PUT', async () => {
        const atlas = database();
        await atlas.add(route(), { authored: true });
        await FeatureOutbox.push();
        expect(puts()).toEqual(['/api/profile/feature?submit=true']);
    });

    it('zmiana geometrii istniejącej trasy przez usera: jeden PUT z submit', async () => {
        const atlas = database();
        await atlas.add(route(), { authored: true });
        await FeatureOutbox.push();
        std.mockClear();

        await atlas.add(route({ geometry: moved, metadata: { taklab_route: movedPlan } }), { authored: true });
        await FeatureOutbox.push();
        expect(puts()).toEqual(['/api/profile/feature?submit=true']);
    });

    it('echo z serwera (bez authored) zapisuje jak dotąd, bez submit', async () => {
        const atlas = database();
        await atlas.add(route(), { authored: true });
        await FeatureOutbox.push();
        std.mockClear();

        await atlas.add(route({ geometry: moved, metadata: { taklab_route: movedPlan } }));
        await FeatureOutbox.push();
        await vi.waitFor(() => expect(puts().length).toBeGreaterThan(0));
        await FeatureOutbox.push();
        expect(puts().every((url) => url === '/api/profile/feature')).toBe(true);
    });

    it('marker od usera: PUT bez submit', async () => {
        const atlas = database();
        await atlas.add(marker(), { authored: true });
        await FeatureOutbox.push();
        expect(puts()).toEqual(['/api/profile/feature']);
    });

    it('trasa bez planu od usera: PUT bez submit', async () => {
        const atlas = database();
        await atlas.add(route({ metadata: {} }), { authored: true });
        await FeatureOutbox.push();
        expect(puts()).toEqual(['/api/profile/feature']);
    });

    it('usunięcie trasy przez usera: DELETE z submit; usunięcie z serwera bez submit', async () => {
        const authored = database();
        await authored.add(route(), { authored: true });
        await FeatureOutbox.push();
        std.mockClear();
        await authored.remove('route-1', { authored: true });
        await FeatureOutbox.push();
        expect(deletes()).toEqual(['/api/profile/feature/route-1?submit=true']);

        const echo = database();
        await echo.add(route(), { authored: true });
        await FeatureOutbox.push();
        std.mockClear();
        await echo.remove('route-1');
        await FeatureOutbox.push();
        expect(deletes()).toEqual(['/api/profile/feature/route-1']);
    });

    it('usunięcie cudzej trasy (od ai_buddy) przez usera: DELETE bez submit', async () => {
        const atlas = database();
        const foreign = route();
        (foreign.properties as Record<string, unknown>).creator = { uid: 'ai_buddy', type: 'a-f-G', callsign: 'Bot', time: '2026-10-16T00:00:00Z' };
        await atlas.add(foreign);
        await FeatureOutbox.push();
        std.mockClear();
        await atlas.remove('route-1', { authored: true });
        await FeatureOutbox.push();
        expect(deletes()).toEqual(['/api/profile/feature/route-1']);
    });

    it('nieudany zapis nowej trasy od usera nie przerywa dodania', async () => {
        const postMessage = vi.fn();
        const atlas = database();
        (atlas as unknown as { atlas: { postMessage: typeof postMessage } }).atlas.postMessage = postMessage;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        std.mockRejectedValueOnce(new Error('offline'));

        const created = await atlas.add(route(), { authored: true });

        expect(created && created.id).toBe('route-1');
        expect(await atlas.get('route-1')).toBeTruthy();
        expect(postMessage).toHaveBeenCalledWith({ type: WorkerMessageType.Feature_Archived_Added });
        warn.mockRestore();
    });

    it('nieudany zapis zmiany trasy od usera nie przerywa dodania', async () => {
        const atlas = database();
        await atlas.add(route(), { authored: true });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        std.mockRejectedValueOnce(new Error('offline'));

        const updated = await atlas.add(route({ geometry: moved, metadata: { taklab_route: movedPlan } }), { authored: true });

        expect(updated && updated.id).toBe('route-1');
        expect(updated && updated.geometry).toEqual({ type: 'LineString', coordinates: moved });
        // v14: the outbox keeps the change and retries it later
        await FeatureOutbox.push();
        expect((await db.feature.get('route-1'))?.synced).toBe(false);
        warn.mockRestore();
    });

    it('echo trasy bez planu po trasie z planem: plan znika', async () => {
        const atlas = database();
        const created = await atlas.add(route(), { authored: true });
        // the echo only replaces a change the server already confirmed
        await FeatureOutbox.push();

        await atlas.add(route({ metadata: {} }), { skipSave: true });
        expect(created && (created.properties.metadata as Record<string, unknown>).taklab_route).toBeUndefined();
    });

    it('edycja trasy bota przez usera usuwa taklab_actor (nowa i istniejąca); echo go zachowuje', async () => {
        const actor = { uid: 'ai_buddy', on_behalf: 'ANDROID-1', log: 'a1' };
        const withActor = (g?: number[][]) => route({ geometry: g, metadata: { taklab_route: g ? movedPlan : plan, taklab_actor: actor } });
        const body = () => {
            const put = calls().filter(([, o]) => o?.method === 'PUT').at(-1)![1] as { body?: unknown };
            return JSON.stringify(put.body);
        };

        const echo = database();
        const kept = await echo.add(withActor());
        expect((kept as { properties: { metadata: Record<string, unknown> } }).properties.metadata.taklab_actor).toEqual(actor);

        await db.feature.clear();
        await FeatureOutbox.push();
        std.mockClear();
        const atlas = database();
        const created = await atlas.add(withActor(), { authored: true });
        const meta = (created as { properties: { metadata: Record<string, unknown> } }).properties.metadata;
        expect('taklab_actor' in meta).toBe(false);
        expect('taklab_route' in meta).toBe(true);
        await FeatureOutbox.push();
        expect(body()).not.toContain('taklab_actor');

        await FeatureOutbox.push();
        std.mockClear();
        const updated = await atlas.add(withActor(moved), { authored: true });
        expect('taklab_actor' in (updated as { properties: { metadata: Record<string, unknown> } }).properties.metadata).toBe(false);
        await FeatureOutbox.push();
        expect(body()).not.toContain('taklab_actor');
        const stored = await db.feature.get('route-1');
        expect(JSON.stringify(stored)).not.toContain('taklab_actor');
    });
});
