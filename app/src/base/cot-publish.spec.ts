import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const server = vi.hoisted(() => ({
    GET: vi.fn(),
    PUT: vi.fn(async () => ({ data: {} })),
    DELETE: vi.fn(async () => ({ data: {} })),
}));

vi.mock('../std.ts', () => ({
    std: vi.fn(),
    server,
    stdurl: (url: string) => new URL(url, 'http://localhost'),
    getRuntimeToken: async () => null,
    downloadUrl: vi.fn(),
}));

import { db } from '../database.ts';
import COT, { OriginMode } from './cot.ts';
import FeatureOutbox from './feature-outbox.ts';
import type { Feature } from '../types.ts';

function cot(): COT {
    return new COT({
        id: 'route-1',
        type: 'Feature',
        path: '/',
        properties: { id: 'route-1', type: 'b-m-r', archived: true },
        geometry: { type: 'LineString', coordinates: [[21, 52], [21.1, 52.1]] },
    } as unknown as Feature, { mode: OriginMode.CONNECTION }, { skipSave: true });
}

function submitted(): Array<boolean> {
    return server.PUT.mock.calls.map((call) => (call as unknown as [string, { params: { query: { submit: boolean } } }])[1].params.query.submit);
}

beforeEach(async () => {
    await db.feature.clear();
    FeatureOutbox.pending.clear();
    FeatureOutbox.submits.clear();
    FeatureOutbox.cancelRetry();
    server.PUT.mockClear();
});

describe('COT.save: publikacja przez submit', () => {
    it('bez opcji zapisuje jak dotąd', async () => {
        await cot().save();
        await FeatureOutbox.push();
        expect(submitted()).toEqual([false]);
    });

    it('z submit wysyła submit=true', async () => {
        await cot().save({ submit: true });
        await FeatureOutbox.push();
        expect(submitted()).toEqual([true]);
    });

    it('submit: false to zwykły zapis', async () => {
        await cot().save({ submit: false });
        await FeatureOutbox.push();
        expect(submitted()).toEqual([false]);
    });

    it('flaga submit przetrwa przepisanie wiersza przez FeatureOutbox.row', async () => {
        server.PUT.mockResolvedValueOnce({ error: { message: 'offline' } } as never);
        await cot().save({ submit: true });
        await FeatureOutbox.push();

        await db.feature.put(FeatureOutbox.row(cot().as_feature({ clone: true })));
        await FeatureOutbox.push();
        expect(submitted()).toEqual([true, true]);
    });
});
