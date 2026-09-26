import { describe, expect, it } from 'vitest';
import { resolveDirectRecipient } from './direct-recipient.ts';

const ME = 'ANDROID-CloudTAK-kaszub';
const HAL = { uid: 'ANDROID-hal9000', callsign: 'Hal9000' };

function chat(sender_uid: string, sender: string) {
    return { sender_uid, sender };
}

describe('resolveDirectRecipient', () => {
    it('uses an explicit recipient', () => {
        expect(resolveDirectRecipient({ chatroom: 'Hal9000', selfUid: ME, recipient: HAL, chats: [] })).toEqual(HAL);
    });

    it('ignores an explicit recipient without a UID', () => {
        expect(resolveDirectRecipient({ chatroom: 'Hal9000', selfUid: ME, recipient: { uid: '', callsign: 'Hal9000' }, chats: [] })).toBeUndefined();
    });

    it('uses the only other participant of the room', () => {
        expect(resolveDirectRecipient({
            chatroom: 'Hal9000',
            selfUid: ME,
            chats: [chat(ME, 'kaszub'), chat(HAL.uid, 'Hal9000'), chat(HAL.uid, 'Hal9000')],
        })).toEqual(HAL);
    });

    it('refuses a room with several other participants', () => {
        expect(resolveDirectRecipient({
            chatroom: 'Hal9000',
            selfUid: ME,
            chats: [chat(HAL.uid, 'Hal9000'), chat('ANDROID-other', 'Other')],
            contact: HAL,
        })).toBeUndefined();
    });

    it.each(['All Chat Rooms', 'Cyan', 'Dark Blue', 'Yellow'])('refuses the group room %s', (chatroom) => {
        expect(resolveDirectRecipient({
            chatroom,
            selfUid: ME,
            chats: [chat(HAL.uid, 'Hal9000')],
            contact: HAL,
        })).toBeUndefined();
    });

    it('falls back to the contact with the room callsign', () => {
        expect(resolveDirectRecipient({ chatroom: 'Hal9000', selfUid: ME, chats: [chat(ME, 'kaszub')], contact: HAL })).toEqual(HAL);
    });

    it('refuses a room it cannot resolve to a UID', () => {
        expect(resolveDirectRecipient({ chatroom: 'Hal9000', selfUid: ME, chats: [chat(ME, 'kaszub')] })).toBeUndefined();
    });

    it('ignores messages without a sender UID', () => {
        expect(resolveDirectRecipient({
            chatroom: 'Hal9000',
            selfUid: ME,
            chats: [chat('', 'Hal9000'), chat(HAL.uid, 'Hal9000')],
        })).toEqual(HAL);
    });
});
