/**
 * Decide whether a chatroom is a one-to-one conversation with a single,
 * known recipient UID - used before sending anything meant for one person
 * only, such as a map snapshot
 */

export type ChatParticipant = { uid: string, callsign: string };

// Rooms that TAK clients use for group messages: everyone, and each team colour
export const GROUP_CHATROOMS = new Set([
    'All Chat Rooms',
    'Yellow', 'Cyan', 'Green', 'Red', 'Purple', 'Orange', 'Blue',
    'Magenta', 'White', 'Maroon', 'Dark Blue', 'Teal', 'Dark Green', 'Brown'
]);

/**
 * @param opts.chatroom - Name of the chatroom
 * @param opts.selfUid - UID of the local user
 * @param opts.recipient - Recipient chosen explicitly (e.g. from a contact)
 * @param opts.chats - Messages of the room
 * @param opts.contact - Contact whose callsign equals the room name, if any
 *
 * @returns The single recipient, or undefined when there is none or more than one
 */
export function resolveDirectRecipient(opts: {
    chatroom: string;
    selfUid: string;
    recipient?: ChatParticipant;
    chats: Array<{ sender_uid?: string, sender?: string }>;
    contact?: ChatParticipant;
}): ChatParticipant | undefined {
    if (opts.recipient) {
        return opts.recipient.uid ? opts.recipient : undefined;
    }

    if (GROUP_CHATROOMS.has(opts.chatroom)) return;

    const others: Map<string, string> = new Map();
    for (const chat of opts.chats) {
        if (!chat.sender_uid || chat.sender_uid === opts.selfUid) continue;
        others.set(chat.sender_uid, chat.sender || chat.sender_uid);
    }

    if (others.size > 1) return;

    for (const [uid, callsign] of others) {
        return { uid, callsign };
    }

    if (opts.contact && opts.contact.uid) {
        return { uid: opts.contact.uid, callsign: opts.contact.callsign };
    }

    return;
}
