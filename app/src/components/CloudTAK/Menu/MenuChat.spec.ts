import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

const HAL = { uid: 'ANDROID-hal9000', callsign: 'Hal9000' };

const route = reactive<{ params: Record<string, string>, query: Record<string, string> }>({ params: {}, query: {} });
const calls: string[] = [];
const chats = {
    list: vi.fn(async () => []),
    refresh: vi.fn(async () => {}),
    markRead: vi.fn(async () => {}),
    directRecipient: vi.fn(),
    sendMap: vi.fn(),
    send: vi.fn(async () => { calls.push('send'); }),
};

vi.mock('vue-router', () => ({
    useRoute: () => route,
    useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../../../database.ts', () => ({
    ChatStatus: { Sending: 'sending', Sent: 'sent', Pending: 'pending', Failed: 'failed', Delivered: 'delivered', Read: 'read' },
    liveQuery: () => ({ subscribe: ({ next }: { next: (v: unknown[]) => void }) => { next([]); return { unsubscribe() {} }; } }),
}));
vi.mock('../../../stores/app.ts', () => ({
    useAppStore: () => ({}),
}));
vi.mock('../../../base/overlay.ts', () => ({
    default: { loaded: [] },
}));
vi.mock('../../../base/chatroom.ts', () => ({
    default: class {
        name: string;
        chats = chats;
        constructor(name: string) { this.name = name; }
        static async load() {}
    },
}));
vi.mock('../../../stores/map.ts', () => ({
    useMapStore: () => ({ worker: {}, map: {}, gpsCoordinates: null }),
}));
vi.mock('../../../base/profile.ts', () => ({
    default: { get: async (key: string) => ({ value: key === 'username' ? 'kaszub' : 'kaszub' }) },
}));
vi.mock('../../../base/taklab-map-collect.ts', () => ({
    collectMapSnapshot: vi.fn(async () => ({ v: 1 })),
}));

import MenuChat from './MenuChat.vue';
import GenericChat from '../util/GenericChat.vue';

async function mountChat() {
    const wrapper = mount(MenuChat, {
        global: {
            stubs: {
                MenuTemplate: { template: '<div><slot name="buttons" /><slot /></div>' },
                GenericChat: true,
                TablerIconButton: true,
                TablerRefreshButton: true,
                IconListCheck: true,
            },
        },
    });
    await flushPromises();
    return wrapper;
}

describe('MenuChat attach map', () => {
    beforeEach(() => {
        calls.length = 0;
        route.params = { chatroom: 'Hal9000' };
        route.query = {};
        chats.directRecipient.mockReset();
        chats.sendMap.mockReset();
        chats.send.mockClear();
    });

    it('offers the map in a one-to-one chat', async () => {
        chats.directRecipient.mockResolvedValue(HAL);

        const wrapper = await mountChat();

        expect(wrapper.findComponent(GenericChat).props('canAttachMap')).toBe(true);
    });

    it('does not offer the map in a group or ambiguous room', async () => {
        route.params = { chatroom: 'All Chat Rooms' };
        chats.directRecipient.mockResolvedValue(undefined);

        const wrapper = await mountChat();

        expect(wrapper.findComponent(GenericChat).props('canAttachMap')).toBe(false);
    });

    it('passes the recipient chosen from a contact', async () => {
        route.params = { chatroom: 'new' };
        route.query = { uid: HAL.uid, callsign: HAL.callsign };
        chats.directRecipient.mockImplementation(async (_sender, recipient) => recipient);

        const wrapper = await mountChat();

        expect(chats.directRecipient).toHaveBeenCalledWith(expect.objectContaining({ uid: 'ANDROID-CloudTAK-kaszub' }), HAL);
        expect(wrapper.findComponent(GenericChat).props('canAttachMap')).toBe(true);
    });

    it('sends the map before the message', async () => {
        chats.directRecipient.mockResolvedValue(HAL);
        chats.sendMap.mockImplementation(async () => { calls.push('map'); });

        const wrapper = await mountChat();
        wrapper.findComponent(GenericChat).vm.$emit('send', 'co widzę na mapie?', true);
        await flushPromises();

        expect(calls).toEqual(['map', 'send']);
        expect(wrapper.findComponent(GenericChat).props('attachError')).toBe('');
    });

    it('still sends the message when the map cannot be attached', async () => {
        chats.directRecipient.mockResolvedValue(HAL);
        chats.sendMap.mockRejectedValue(new Error('Error sending Map - No single recipient in this chat'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const wrapper = await mountChat();
        wrapper.findComponent(GenericChat).vm.$emit('send', 'co widzę na mapie?', true);
        await flushPromises();

        expect(calls).toEqual(['send']);
        expect(wrapper.findComponent(GenericChat).props('attachError')).toBe('Nie udało się dołączyć mapy');
    });

    it('does not send the map when not attached', async () => {
        chats.directRecipient.mockResolvedValue(HAL);

        const wrapper = await mountChat();
        wrapper.findComponent(GenericChat).vm.$emit('send', 'cześć', false);
        await flushPromises();

        expect(chats.sendMap).not.toHaveBeenCalled();
        expect(calls).toEqual(['send']);
    });
});
