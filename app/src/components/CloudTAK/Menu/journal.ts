/** Pure helpers of the Journal menu (taklab OTS event journal), kept apart for tests. */

export const JOURNAL_TIMEZONE = 'Europe/Warsaw';
export const PER_PAGE = 50;
export const PDF_MAX_ENTRIES = 20_000;

/** Kinds of the OTS contract in the order they are offered in the filter. */
export const JOURNAL_KINDS = [
    'chat', 'object_add', 'object_change', 'object_delete', 'position', 'disconnect',
    'video_share', 'file_upload', 'file_send', 'alert', 'casevac',
    'recording_video', 'recording_voice', 'recording_scan', 'recording_delete', 'journal_export',
] as const;
export type JournalKind = typeof JOURNAL_KINDS[number];

export type JournalRecipient = { callsign: string | null; uid: string | null; account: string | null };

export type JournalFile = {
    source: string;
    ref: string;
    filename: string;
    size: number | null;
    mime: string | null;
    available: boolean;
};

export type JournalEntry = {
    id: number;
    at: string;
    kind: string;
    account: string | null;
    callsign: string | null;
    device_uid: string | null;
    object_uid: string | null;
    object_type: string | null;
    title: string;
    text: string | null;
    private: boolean;
    recipients: JournalRecipient[];
    chatroom: string | null;
    lat: number | null;
    lon: number | null;
    mission: string | null;
    file: JournalFile | null;
};

export type JournalList = { items: JournalEntry[]; total: number; page: number; per_page: number };
export type JournalAccount = { account: string; callsigns: string[] };
export type JournalEstimate = { entries: number; files: number; bytes: number; missing: number };

export type JournalFilters = {
    /** datetime-local value read as Europe/Warsaw time. */
    since: string;
    until: string;
    account: string;
    kind: string;
    q: string;
    positions: boolean;
};

const parts = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
    let f = parts.get(timeZone);
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone, hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        parts.set(timeZone, f);
    }
    return f;
}

/** Offset of the zone at the instant ms (ms to add to UTC to get the wall clock). */
function offsetAt(ms: number, timeZone: string): number {
    const p: Record<string, number> = {};
    for (const part of formatter(timeZone).formatToParts(new Date(ms))) {
        if (part.type !== 'literal') p[part.type] = Number(part.value);
    }
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return wall - Math.floor(ms / 1000) * 1000;
}

/** "2026-11-24T10:00" as wall clock time in the zone, to an ISO UTC string; null when not a date. */
export function zonedToIso(local: string, timeZone = JOURNAL_TIMEZONE): string | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
    if (!m) return null;
    const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
    if (!Number.isFinite(naive)) return null;
    let utc = naive - offsetAt(naive, timeZone);
    // Second pass: the offset at the real instant differs near a DST change.
    const second = naive - offsetAt(utc, timeZone);
    if (second !== utc) utc = second;
    return new Date(utc).toISOString();
}

/** Instant to the datetime-local value of the zone ("2026-11-24T10:00"). */
export function isoToZoned(ms: number, timeZone = JOURNAL_TIMEZONE): string {
    return new Date(ms + offsetAt(ms, timeZone)).toISOString().slice(0, 16);
}

/** Default filter: the last 24 hours, journal movement hidden. */
export function defaultFilters(now = Date.now()): JournalFilters {
    return {
        since: isoToZoned(now - 24 * 3600_000),
        until: isoToZoned(now),
        account: '',
        kind: '',
        q: '',
        positions: false,
    };
}

/** Filters of the screen as query parameters of /api/journal and the exports. */
export function journalQuery(f: JournalFilters, page?: number, perPage?: number): Record<string, string> {
    const q: Record<string, string> = {};
    const since = f.since ? zonedToIso(f.since) : null;
    const until = f.until ? zonedToIso(f.until) : null;
    if (since) q.since = since;
    if (until) q.until = until;
    if (f.account.trim()) q.account = f.account.trim();
    if ((JOURNAL_KINDS as readonly string[]).includes(f.kind)) q.kind = f.kind;
    if (f.q.trim()) q.q = f.q.trim();
    q.positions = f.positions ? 'true' : 'false';
    if (page !== undefined) q.page = String(page);
    if (perPage !== undefined) q.per_page = String(perPage);
    return q;
}

export function totalPages(total: number, perPage: number): number {
    if (!Number.isFinite(total) || total <= 0 || perPage <= 0) return 1;
    return Math.ceil(total / perPage);
}

/** Time of an entry as the journal shows it: Europe/Warsaw, with seconds. */
export function formatWhen(iso: string, locale = 'pl'): string {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    return d.toLocaleString(locale === 'pl' ? 'pl-PL' : 'en-GB', {
        timeZone: JOURNAL_TIMEZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

/** "znak (konto)"; one of them alone when the other is missing or equal; null = server event. */
export function whoLabel(callsign: string | null, account: string | null): string | null {
    const c = (callsign || '').trim();
    const a = (account || '').trim();
    if (c && a && c !== a) return `${c} (${a})`;
    return c || a || null;
}

export function recipientsLabel(recipients: JournalRecipient[]): string {
    return recipients
        .map((r) => whoLabel(r.callsign, r.account) ?? r.uid ?? '')
        .filter(Boolean)
        .join(', ');
}

/** [lon, lat] for "Pokaż na mapie", null when the entry has no position. */
export function entryPosition(e: Pick<JournalEntry, 'lat' | 'lon'>): [number, number] | null {
    if (e.lat === null || e.lon === null) return null;
    if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon) || Math.abs(e.lat) > 90 || Math.abs(e.lon) > 180) return null;
    return [e.lon, e.lat];
}

/** Account filter options: "konto (znak, znak)". */
export function accountLabel(a: JournalAccount): string {
    const signs = a.callsigns.filter((c) => c && c !== a.account);
    return signs.length ? `${a.account} (${signs.join(', ')})` : a.account;
}

export function formatCoord(value: number): string {
    return value.toFixed(5);
}
