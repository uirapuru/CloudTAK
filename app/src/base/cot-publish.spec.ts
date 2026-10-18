import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const std = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('../std.ts', () => ({
    std,
    server: {},
    stdurl: (url: string) => new URL(url, 'http://localhost'),
    getRuntimeToken: async () => null,
    downloadUrl: vi.fn(),
}));

import { db } from '../database.ts';
import COT, { OriginMode } from './cot.ts';
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

beforeEach(async () => {
    await db.config.put({ key: 'token', value: 'token' });
    std.mockClear();
});

describe('COT.save: publikacja przez submit', () => {
    it('bez opcji zapisuje jak dotąd', async () => {
        await cot().save();
        expect(std).toHaveBeenCalledWith('/api/profile/feature', expect.objectContaining({ method: 'PUT' }));
    });

    it('z submit dokleja ?submit=true', async () => {
        await cot().save({ submit: true });
        expect(std).toHaveBeenCalledWith('/api/profile/feature?submit=true', expect.objectContaining({ method: 'PUT' }));
    });

    it('submit: false to zwykły zapis', async () => {
        await cot().save({ submit: false });
        expect(std).toHaveBeenCalledWith('/api/profile/feature', expect.objectContaining({ method: 'PUT' }));
    });
});
