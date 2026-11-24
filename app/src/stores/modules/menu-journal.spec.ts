import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';

const std = vi.fn();

vi.mock('../../std.ts', () => ({ std: (...args: unknown[]) => std(...args) }));
vi.mock('../../utils/capacitor.ts', () => ({ isNativePlatform: () => false }));
vi.mock('../../base/profile.ts', () => ({ default: { get: vi.fn(async () => undefined) } }));
vi.mock('../../base/contact.ts', () => ({ default: { liveCount: () => ({ subscribe: () => undefined }) } }));
vi.mock('../../base/chatroom.ts', () => ({ default: { liveUnreadCount: () => ({ subscribe: () => undefined }) } }));

import MenuManager from './menu.ts';

function answer(journal: () => unknown) {
    std.mockImplementation(async (url: string) => {
        if (url === '/api/journal/access') return journal();
        return {};
    });
}

describe('MenuManager: Dziennik', () => {
    beforeEach(() => {
        std.mockReset();
    });

    it('is hidden until OTS says admin: true', async () => {
        answer(() => ({ admin: true }));
        const menu = new MenuManager({});
        expect(menu.items.value.map((i) => i.key)).not.toContain('journal');
        await menu.init();
        await flushPromises();
        expect(std).toHaveBeenCalledWith('/api/journal/access');
        const item = menu.items.value.find((i) => i.key === 'journal');
        expect(item?.route).toBe('/menu/journal');
    });

    for (const [name, journal] of [
        ['admin: false', () => ({ admin: false })],
        ['a truthy non-boolean', () => ({ admin: 'yes' })],
        ['an error', () => { throw new Error('403'); }],
    ] as const) {
        it(`stays hidden for ${name}`, async () => {
            answer(journal);
            const menu = new MenuManager({});
            await menu.init();
            await flushPromises();
            expect(menu.items.value.map((i) => i.key)).not.toContain('journal');
        });
    }
});
