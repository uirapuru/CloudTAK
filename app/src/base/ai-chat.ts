/**
 * taklab "Chat AI": client of /api/ai (CloudTAK proxy to the report service of
 * the environment) and the pure helpers of the menu: the switch of the shared
 * AI model machine, combat orders and the shortcut to the chat with the bot.
 */
import { std } from '../std.ts';
import { isoToZoned, zonedToIso } from '../components/CloudTAK/Menu/journal.ts';

export type AiModelStateName = 'off' | 'starting' | 'ready' | 'stopping' | 'unavailable';
export type AiOrderFormat = 'pdf' | 'docx';

export const AI_ORDER_FORMATS: AiOrderFormat[] = ['pdf', 'docx'];
export const AI_POLL_MS = 5_000;
export const AI_TEXT_MAX = 20_000;
export const AI_TITLE_MAX = 120;
/** CloudTAK refuses longer routes; longer ones are thinned before sending. */
export const AI_ROUTE_MAX_POINTS = 5_000;

/**
 * Attachments: the same limits as CloudTAK API and the report service
 * (taklab.report.orders.attachments), checked here first so nothing too big
 * is ever uploaded.
 */
export const AI_ATTACHMENTS_MAX_FILES = 10;
export const AI_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const AI_ATTACHMENTS_MAX_BYTES = 50 * 1024 * 1024;
/** The upload goes at the speed of the uplink: 50 MB over a slow LTE link takes minutes. */
export const AI_UPLOAD_TIMEOUT_MS = 10 * 60_000;

/** Account (and UID) and default callsign of the ai-buddy bot (chart: aiBuddy.konto, aiBuddy.nazwa). */
export const BOT_UID = 'ai_buddy';
export const BOT_CALLSIGN = 'Hal9000';

export type AiModel = {
    state: string;
    pinned: boolean;
    reason: string | null;
};

export type AiModelAction = {
    result?: string;
    reason?: string | null;
};

export type AiOrder = {
    id: string;
    status: string;
    error: string | null;
    created: string;
    finished: string | null;
    owner: string;
    format: string;
    title: string | null;
    start: string | null;
    has_location: boolean;
    weather_ok: boolean | null;
    terrain_ok: boolean | null;
    /** While running: attachments, images, model or document. */
    phase?: string | null;
    /** Number of files attached to the order. */
    attachments?: number;
};

/** A file picked in the menu, with a key for the list. */
export type AiAttachment = { key: string; file: File };

export type LngLat = [number, number];

export type AiOrderRequest = {
    text: string;
    format: AiOrderFormat;
    title?: string;
    start?: string;
    location?: LngLat;
    route?: LngLat[];
};

export type AiOrderCreated = { id: string; status: string };

/** A map object offered as the place of the order. */
export type AiMapObject = {
    id: string;
    name: string;
    kind: 'route' | 'point';
    coordinates: LngLat[];
};

/** Form of the menu; start is a datetime-local value in Europe/Warsaw time; location '' = from the text. */
export type AiOrderForm = {
    text: string;
    title: string;
    start: string;
    format: AiOrderFormat;
    location: string;
};

export type BotContact = { uid: string; callsign: string };

export async function getModel(): Promise<AiModel> {
    return await std('/api/ai/model') as AiModel;
}

export async function startModel(): Promise<AiModelAction> {
    return await std('/api/ai/model/start', { method: 'POST' }) as AiModelAction;
}

export async function stopModel(): Promise<AiModelAction> {
    return await std('/api/ai/model/stop', { method: 'POST' }) as AiModelAction;
}

/**
 * Without files: the JSON body. With files: multipart/form-data, the same JSON
 * in the field "order" and every file in "files".
 */
export async function createOrder(req: AiOrderRequest, files: File[] = []): Promise<AiOrderCreated> {
    if (!files.length) return await std('/api/ai/orders', { method: 'POST', body: req }) as AiOrderCreated;
    const form = new FormData();
    form.append('order', JSON.stringify(req));
    for (const file of files) form.append('files', file, file.name);
    return await std('/api/ai/orders', { method: 'POST', body: form, timeout: AI_UPLOAD_TIMEOUT_MS }) as AiOrderCreated;
}

/** Why these files cannot be sent (a locale key), or null. */
export function attachmentsProblem(files: File[]): string | null {
    if (files.length > AI_ATTACHMENTS_MAX_FILES) return 'aiChat.problems.tooManyFiles';
    if (files.some(f => f.size > AI_ATTACHMENT_MAX_BYTES)) return 'aiChat.problems.fileTooLarge';
    if (files.reduce((sum, f) => sum + f.size, 0) > AI_ATTACHMENTS_MAX_BYTES) return 'aiChat.problems.filesTooLarge';
    return null;
}

let attachmentSeq = 0;

/** Picked files added to the list, in order, each with its own key. */
export function addAttachments(list: AiAttachment[], picked: Iterable<File>): AiAttachment[] {
    return [...list, ...Array.from(picked, file => ({ key: `f${++attachmentSeq}`, file }))];
}

/** Size as shown next to a file: B, kB or MB with a Polish decimal comma in pl. */
export function formatSize(bytes: number, locale = 'pl'): string {
    const number = (value: number, digits: number) => value.toLocaleString(locale, { maximumFractionDigits: digits });
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${number(bytes / 1024, 0)} kB`;
    return `${number(bytes / (1024 * 1024), 1)} MB`;
}

export async function listOrders(): Promise<AiOrder[]> {
    return (await std('/api/ai/orders') as { items: AiOrder[] }).items;
}

export async function deleteOrder(id: string): Promise<void> {
    await std(`/api/ai/orders/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Path of the finished file; download it with downloadUrl(..., { token: true }). */
export function orderUrl(id: string, fmt: string): string {
    return `/api/ai/orders/${encodeURIComponent(id)}.${fmt === 'docx' ? 'docx' : 'pdf'}`;
}

/**
 * Whether this account gets the "Chat AI" menu: only when GET /api/ai/model
 * answers 200. 403 (not an OTS administrator), 404 (no report service), 503
 * (no AI in the environment) and a failure without an answer hide it.
 */
export async function aiChatEnabled(): Promise<boolean> {
    try {
        await getModel();
        return true;
    } catch {
        return false;
    }
}

export function isPending(order: AiOrder): boolean {
    return order.status === 'queued' || order.status === 'running';
}

/** The model state is changing: poll it. */
export function modelChanging(model: AiModel | undefined): boolean {
    return model?.state === 'starting' || model?.state === 'stopping';
}

/** "Włącz" for a machine that is off (or unknown), "Wyłącz" for one that is up or starting; nothing while stopping. */
export function modelAction(model: AiModel | undefined): 'start' | 'stop' | null {
    if (!model) return null;
    if (model.state === 'ready' || model.state === 'starting') return 'stop';
    if (model.state === 'stopping') return null;
    return 'start';
}

/** Default form: H hour now, PDF, place from the text. */
export function defaultOrderForm(now = Date.now()): AiOrderForm {
    return { text: '', title: '', start: isoToZoned(now), format: 'pdf', location: '' };
}

/** Why the form cannot be sent (a locale key), or null. */
export function orderProblem(form: AiOrderForm): string | null {
    const text = form.text.trim();
    if (!text) return 'aiChat.problems.noText';
    if (text.length > AI_TEXT_MAX) return 'aiChat.problems.textTooLong';
    if (form.title.trim().length > AI_TITLE_MAX) return 'aiChat.problems.titleTooLong';
    if (!zonedToIso(form.start)) return 'aiChat.problems.noStart';
    return null;
}

function lngLat(value: unknown): LngLat | null {
    if (!Array.isArray(value) || value.length < 2) return null;
    const lon = Number(value[0]);
    const lat = Number(value[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
    return [lon, lat];
}

type FeatureLike = {
    id: string;
    properties?: { callsign?: unknown };
    geometry?: { type?: unknown; coordinates?: unknown };
};

/** Routes (LineString) and points of the map as places of the order, by name. */
export function mapObjects(features: Iterable<FeatureLike>): AiMapObject[] {
    const out: AiMapObject[] = [];
    for (const f of features) {
        const type = f.geometry?.type;
        const coords = f.geometry?.coordinates;
        const name = String(f.properties?.callsign || '').trim() || f.id;
        if (type === 'Point') {
            const p = lngLat(coords);
            if (p) out.push({ id: f.id, name, kind: 'point', coordinates: [p] });
        } else if (type === 'LineString' && Array.isArray(coords)) {
            const line = coords.map(lngLat).filter((p): p is LngLat => p !== null);
            if (line.length >= 2) out.push({ id: f.id, name, kind: 'route', coordinates: line });
        }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** At most max points, evenly spread, the first and the last always kept. */
export function thinRoute(line: LngLat[], max = AI_ROUTE_MAX_POINTS): LngLat[] {
    if (line.length <= max) return line;
    const out: LngLat[] = [];
    for (let i = 0; i < max; i++) {
        out.push(line[Math.round(i * (line.length - 1) / (max - 1))]);
    }
    return out;
}

/** Body of POST /api/ai/orders: either a point or a route, or neither (place from the text). */
export function toOrderRequest(form: AiOrderForm, objects: AiMapObject[]): AiOrderRequest {
    const req: AiOrderRequest = {
        text: form.text.trim(),
        format: form.format,
        start: zonedToIso(form.start) as string,
    };
    const title = form.title.trim();
    if (title) req.title = title;
    const chosen = objects.find((o) => o.id === form.location);
    if (chosen?.kind === 'point') req.location = chosen.coordinates[0];
    if (chosen?.kind === 'route') req.route = thinRoute(chosen.coordinates);
    return req;
}

/** The ai-buddy contact: by its UID first, by the default callsign otherwise. */
export function findBotContact(contacts: BotContact[]): BotContact | undefined {
    return contacts.find((c) => c.uid === BOT_UID)
        || contacts.find((c) => (c.callsign || '').toLowerCase() === BOT_CALLSIGN.toLowerCase());
}

/** The chat with a contact, as CloudTAK opens it from the contact list. */
export function botChatPath(contact: BotContact): string {
    return `/menu/chats/new?callsign=${encodeURIComponent(contact.callsign)}&uid=${encodeURIComponent(contact.uid)}`;
}
