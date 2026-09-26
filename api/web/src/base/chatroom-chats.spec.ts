import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Remote } from 'comlink';
import type Atlas from '../workers/atlas.ts';
import type { MapSnapshot } from './taklab-map-snapshot.ts';

const getByCallsign = vi.fn();

vi.mock('../database.ts', () => ({ db: {} }));
vi.mock('../std.ts', () => ({ std: vi.fn(), stdurl: vi.fn() }));
vi.mock('./contact.ts', () => ({ default: { getByCallsign: (callsign: string) => getByCallsign(callsign) } }));

import ChatroomChats from './chatroom-chats.ts';

const ME = { uid: 'ANDROID-CloudTAK-kaszub', callsign: 'kaszub' };
const HAL = { uid: 'ANDROID-hal9000', callsign: 'Hal9000' };
const SNAPSHOT = { v: 1 } as unknown as MapSnapshot;

function worker(sendCOT = vi.fn().mockResolvedValue(true)) {
    return { worker: { conn: { sendCOT } } as unknown as Remote<Atlas>, sendCOT };
}

function room(name: string, chats: Array<{ sender_uid: string; sender: string }>) {
    const chatroom = new ChatroomChats(name);
    vi.spyOn(chatroom, 'list').mockResolvedValue(chats.map((chat, i) => ({
        id: String(i),
        chatroom: name,
        message: 'x',
        created: '2026-09-26T16:40:00Z',
        ...chat,
    })));
    return chatroom;
}

describe('ChatroomChats.sendMap', () => {
    beforeEach(() => {
        getByCallsign.mockReset();
    });

    it('sends the snapshot to the explicit recipient', async () => {
        const { worker: w, sendCOT } = worker();

        await room('Hal9000', []).sendMap(SNAPSHOT, w, ME, HAL);

        expect(sendCOT).toHaveBeenCalledWith({ to_uid: HAL.uid, snapshot: SNAPSHOT }, 'taklab_map');
    });

    it('sends the snapshot to the only other participant', async () => {
        const { worker: w, sendCOT } = worker();

        await room('Hal9000', [{ sender_uid: HAL.uid, sender: HAL.callsign }]).sendMap(SNAPSHOT, w, ME);

        expect(sendCOT).toHaveBeenCalledWith({ to_uid: HAL.uid, snapshot: SNAPSHOT }, 'taklab_map');
    });

    it('refuses a group room', async () => {
        const { worker: w, sendCOT } = worker();
        getByCallsign.mockResolvedValue(HAL);

        await expect(room('All Chat Rooms', [{ sender_uid: HAL.uid, sender: HAL.callsign }]).sendMap(SNAPSHOT, w, ME))
            .rejects.toThrow(/recipient/);
        expect(sendCOT).not.toHaveBeenCalled();
    });

    it('refuses a room with several participants', async () => {
        const { worker: w, sendCOT } = worker();

        await expect(room('Hal9000', [
            { sender_uid: HAL.uid, sender: HAL.callsign },
            { sender_uid: 'ANDROID-other', sender: 'Other' },
        ]).sendMap(SNAPSHOT, w, ME)).rejects.toThrow(/recipient/);
        expect(sendCOT).not.toHaveBeenCalled();
    });

    it('refuses a room without a known recipient UID', async () => {
        const { worker: w, sendCOT } = worker();
        getByCallsign.mockResolvedValue(undefined);

        await expect(room('Hal9000', [{ sender_uid: ME.uid, sender: ME.callsign }]).sendMap(SNAPSHOT, w, ME))
            .rejects.toThrow(/recipient/);
        expect(sendCOT).not.toHaveBeenCalled();
    });

    it('fails when the connection is closed', async () => {
        const { worker: w } = worker(vi.fn().mockResolvedValue(false));

        await expect(room('Hal9000', []).sendMap(SNAPSHOT, w, ME, HAL)).rejects.toThrow(/Not connected/);
    });
});
