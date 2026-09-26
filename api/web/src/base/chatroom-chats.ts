import { db } from '../database.ts';
import { std, stdurl } from '../std.ts';
import type {
    ProfileChatList,
    APIProfileChat
} from '../types.ts'
import type { DBChatroomChat } from '../database.ts';
import type Atlas from '../workers/atlas.ts';
import type { Remote } from 'comlink';
import ContactManager from './contact.ts';
import type { MapSnapshot } from './taklab-map-snapshot.ts';
import { resolveDirectRecipient } from './direct-recipient.ts';

export default class ChatroomChats {
    chatroom: string;

    constructor(
        chatroom: string
    ) {
        this.chatroom = chatroom;
    }

    async refresh(): Promise<void> {
        const url = stdurl(`/api/profile/chatroom/${encodeURIComponent(this.chatroom)}/chat`);
        url.searchParams.append('limit', '50');

        const list = await std(url) as ProfileChatList;

        await db.transaction('rw', db.chatroom_chats, async () => {
            await db.chatroom_chats
                .where('chatroom')
                .equals(this.chatroom)
                .delete();

            for (const chat of list.items) {
                const c = chat as APIProfileChat;
                await db.chatroom_chats.put({
                    id: c.message_id,
                    chatroom: this.chatroom,
                    sender: c.sender_callsign,
                    sender_uid: c.sender_uid,
                    message: c.message,
                    created: c.created
                });
            }
        });

        const activeItem = list.items[list.items.length - 1];
        if (activeItem) {
            await db.chatroom.update(this.chatroom, {
                updated: (activeItem as APIProfileChat).created
            });
        }
    }

    async list(
        opts?: {
            refresh?: boolean,
        }
    ): Promise<Array<DBChatroomChat>> {
        if (opts?.refresh) {
            await this.refresh();
        }

        const chats = await db.chatroom_chats
            .where("chatroom")
            .equals(this.chatroom)
            .toArray();

        chats.sort((a, b) => {
            return a.created.localeCompare(b.created);
        });

        return chats;
    }

    async markRead(): Promise<void> {
        await db.chatroom.update(this.chatroom, { unread: 0 });
    }

    /**
     * Resolve who a message in this chatroom is addressed to
     *
     * @param sender - The local user
     * @param recipient - Known recipient, returned as is
     */
    async recipient(
        sender: { uid: string, callsign: string },
        recipient?: { uid: string, callsign: string }
    ): Promise<{ uid: string, callsign: string }> {
        if (recipient) return recipient;

        const chats = await this.list();
        const single = chats.find((chat) => {
            return chat.sender_uid !== sender.uid
        });

        if (single) {
            return {
                uid: single.sender_uid,
                callsign: single.sender
            }
        }

        const contact = await ContactManager.getByCallsign(this.chatroom);
        if (contact) {
            return {
                uid: contact.uid,
                callsign: contact.callsign
            }
        }

        return {
            uid: this.chatroom,
            callsign: this.chatroom
        }
    }

    /**
     * The single recipient of a one-to-one chatroom, or undefined for group
     * rooms and rooms whose recipient UID is unknown or ambiguous
     *
     * @param sender - The local user
     * @param recipient - Recipient chosen explicitly (e.g. from a contact)
     */
    async directRecipient(
        sender: { uid: string, callsign: string },
        recipient?: { uid: string, callsign: string }
    ): Promise<{ uid: string, callsign: string } | undefined> {
        if (recipient) {
            return resolveDirectRecipient({ chatroom: this.chatroom, selfUid: sender.uid, recipient, chats: [] });
        }

        return resolveDirectRecipient({
            chatroom: this.chatroom,
            selfUid: sender.uid,
            chats: await this.list(),
            contact: await ContactManager.getByCallsign(this.chatroom),
        });
    }

    /**
     * Send a map snapshot ahead of a chat message - only in a one-to-one chatroom
     * The server relays it as a y-taklab-map CoT and does not store it
     *
     * @param sender - The local user
     * @param recipient - Recipient chosen explicitly (e.g. from a contact)
     */
    async sendMap(
        snapshot: MapSnapshot,
        worker: Remote<Atlas>,
        sender: { uid: string, callsign: string },
        recipient?: { uid: string, callsign: string }
    ): Promise<void> {
        const direct = await this.directRecipient(sender, recipient);

        if (!direct) throw new Error('Error sending Map - No single recipient in this chat');

        const sent = await worker.conn.sendCOT({
            to_uid: direct.uid,
            snapshot
        }, 'taklab_map');

        if (!sent) throw new Error('Error sending Map - Not connected');
    }

    async send(
        message: string,
        sender: { uid: string, callsign: string },
        worker: Remote<Atlas>,
        recipient?: { uid: string, callsign: string }
    ): Promise<void> {
        const id = crypto.randomUUID();
        const created = new Date().toISOString();

        await db.chatroom.update(this.chatroom, {
            updated: created
        });

        await db.chatroom_chats.put({
            id: id,
            chatroom: this.chatroom,
            sender: sender.callsign,
            sender_uid: sender.uid,
            message: message,
            created: created
        });

        recipient = await this.recipient(sender, recipient);

        const location = (await worker.profile?.location)?.coordinates || [0, 0];

        await worker.conn.sendCOT({
            chatroom: this.chatroom,
            from: {
                uid: sender.uid,
                callsign: sender.callsign
            },
            to: recipient,
            message: message,
            messageId: id,
            time: created,
            location
        }, 'chat');
    }
}
