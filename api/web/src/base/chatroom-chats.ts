import { db } from '../database.ts';
import { server } from '../std.ts';
import type {
    ProfileChatList,
    APIProfileChat
} from '../types.ts'
import type { DBChatroomChat } from '../database.ts';
import { ChatStatus } from '../database.ts';
import type Atlas from '../workers/atlas.ts';
import type { Remote } from 'comlink';
import ContactManager from './contact.ts';
import type { MapSnapshot } from './taklab-map-snapshot.ts';

export default class ChatroomChats {
    chatroom: string;

    constructor(
        chatroom: string
    ) {
        this.chatroom = chatroom;
    }

    async refresh(): Promise<void> {
        const res = await server.GET('/api/profile/chatroom/{:chatroom}/chat', {
            params: {
                path: { ':chatroom': this.chatroom },
                query: { limit: 50, page: 0, order: 'desc', sort: 'created' }
            }
        });

        if (res.error) throw new Error(res.error.message);

        const list = res.data as ProfileChatList;

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
                    // Postgres timestamps are not ISO 8601 formatted - normalize
                    // so they sort consistently against locally created messages
                    created: new Date(c.created).toISOString(),
                    status: (c.status as ChatStatus | null) ?? undefined
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

        // Oldest to most recent - compare as dates as stored timestamps
        // may be a mix of ISO 8601 and Postgres formatted strings
        chats.sort((a, b) => {
            return new Date(a.created).getTime() - new Date(b.created).getTime();
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
     * Send a map snapshot to the recipient ahead of a chat message
     * The server relays it as a y-taklab-map CoT and does not store it
     */
    async sendMap(
        snapshot: MapSnapshot,
        worker: Remote<Atlas>,
        recipient: { uid: string, callsign: string }
    ): Promise<void> {
        const sent = await worker.conn.sendCOT({
            to_uid: recipient.uid,
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
            created: created,
            status: ChatStatus.Sending
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
