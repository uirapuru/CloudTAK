import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AtlasConnection from '../workers/atlas-connection.ts';
import { OriginMode } from '../base/cot.ts';
import type Atlas from '../workers/atlas.ts';

// taklab: t-x-d-d ze strumienia usuwa obiekt z mapy lokalnie i niczego nie wysyła dalej

const ME = 'ANDROID-CloudTAK-me@example.com';

class FakeSocket {
    static instances: FakeSocket[] = [];
    readyState = 0;
    listeners = new Map<string, Array<(ev?: unknown) => void>>();
    sent: string[] = [];
    constructor(public url: string) { FakeSocket.instances.push(this); }
    addEventListener(type: string, fn: (ev?: unknown) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
    }
    emit(type: string, ev?: unknown) {
        for (const fn of this.listeners.get(type) ?? []) fn(ev);
    }
    open() { this.readyState = 1; this.emit('open'); }
    close() { this.readyState = 3; }
    send(data: string) { this.sent.push(data); }
}

type Stored = { id: string, origin: { mode: OriginMode }, properties: Record<string, unknown>, update: ReturnType<typeof vi.fn> };

function stored(id: string, mode: OriginMode = OriginMode.CONNECTION): Stored {
    return { id, origin: { mode }, properties: { type: 'u-d-f' }, update: vi.fn(async () => undefined) };
}

function fakeAtlas(features: Stored[]) {
    const map = new Map(features.map((f) => [f.id, f]));
    const remove = vi.fn(async () => undefined);
    const get = vi.fn(async (id: string) => map.get(id));
    const atlas = {
        token: 'token',
        db: { add: vi.fn(async () => undefined), get, remove, selfUid: () => ME },
        sync: { started: false, fullSync: vi.fn(async () => undefined) },
        postMessage: vi.fn(async () => undefined)
    } as unknown as Atlas;
    return { atlas, remove, get };
}

function deleteTask(uids: string[], forcedelete = true) {
    return {
        id: 'task-1',
        type: 'Feature',
        path: '/',
        properties: {
            id: 'task-1',
            type: 't-x-d-d',
            how: 'h-g-i-g-o',
            callsign: '',
            center: [0, 0, 0],
            ...(forcedelete ? { forcedelete: true } : {}),
            links: uids.map((uid) => ({ uid, relation: 'none', type: 'u-d-f' })),
        },
        geometry: { type: 'Point', coordinates: [0, 0, 0] }
    };
}

async function receive(features: Stored[], task: object) {
    const ctx = fakeAtlas(features);
    const conn = new AtlasConnection(ctx.atlas);
    const sendCOT = vi.spyOn(conn, 'sendCOT');
    conn.connect('me@example.com');
    const sock = FakeSocket.instances[0];
    sock.open();
    const error = vi.spyOn(console, 'error');

    sock.emit('message', { data: JSON.stringify({ type: 'task', connection: 'me@example.com', data: task }) });
    await vi.waitFor(() => expect(ctx.get).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));

    conn.destroy();
    return { ...ctx, sendCOT, sock, error };
}

describe('AtlasConnection: odbiór t-x-d-d', () => {
    beforeEach(() => {
        FakeSocket.instances = [];
        vi.stubGlobal('WebSocket', Object.assign(FakeSocket, { OPEN: 1 }));
        vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200 })));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('usuwa obiekt ze strumienia lokalnie, bez wysyłki i bez authored', async () => {
        const { remove, sendCOT, sock } = await receive([stored('poly-1')], deleteTask(['poly-1']));

        expect(remove).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledWith('poly-1');
        expect(sendCOT).not.toHaveBeenCalled();
        expect(sock.sent).toEqual([]);
    });

    it('nieznany uid: bez błędu i bez usuwania', async () => {
        const { remove, error, sendCOT } = await receive([], deleteTask(['nie-ma']));

        expect(remove).not.toHaveBeenCalled();
        expect(sendCOT).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });

    it('obiekt z misji zostaje', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { remove } = await receive([stored('m-1', OriginMode.MISSION)], deleteTask(['m-1']));

        expect(remove).not.toHaveBeenCalled();
    });

    it('własna pozycja zostaje', async () => {
        const { remove, get } = await receive([stored(ME), stored('poly-2')], deleteTask([ME, 'poly-2']));

        expect(get).not.toHaveBeenCalledWith(ME);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledWith('poly-2');
    });

    it('bez __forcedelete: obiekt tylko przeterminowany, nie usunięty', async () => {
        const feat = stored('poly-3');
        const { remove } = await receive([feat], deleteTask(['poly-3'], false));

        expect(remove).not.toHaveBeenCalled();
        expect(feat.update).toHaveBeenCalledTimes(1);
    });
});
