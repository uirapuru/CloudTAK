/** Pure helpers of the Recordings menu (taklab OTS recording register), kept apart for tests. */
import type { Feature, LineString } from 'geojson';

export type RecordingKind = 'video' | 'voice' | 'scan';
export type KindFilter = 'all' | RecordingKind;

export const KIND_FILTERS: KindFilter[] = ['all', 'video', 'voice', 'scan'];

export type Recording = {
    id: string;
    kind: RecordingKind;
    account: string;
    callsign: string;
    uid: string;
    name: string;
    started_at: string;
    ended_at: string | null;
    duration_s: number | null;
    lat: number | null;
    lon: number | null;
    size_bytes: number | null;
    has_text: boolean;
    can_manage: boolean;
};

/** [lat, lon, time] as OTS stores it. */
export type TrackPoint = Array<number | string | null>;

export type RecordingDetail = Recording & {
    track: TrackPoint[];
    text: string | null;
};

export type RecordingList = {
    enabled: boolean;
    admin: boolean;
    page: number;
    total_pages: number | null;
    items: Recording[];
};

export type RecordingUsage = {
    admin: boolean;
    used_bytes: number | null;
    limit_bytes: number | null;
};

/** Filters of the screen as query parameters of /api/recordings. */
export function listQuery(kind: KindFilter, account: string, from: string, to: string, page = 1): Record<string, string> {
    const q: Record<string, string> = {};
    if (kind !== 'all') q.kind = kind;
    if (account.trim()) q.account = account.trim();
    // datetime-local has no zone: the browser reads it as local time, the API gets UTC.
    for (const [key, value] of [['from', from], ['to', to]] as const) {
        if (!value) continue;
        const ms = new Date(value).getTime();
        if (Number.isFinite(ms)) q[key] = new Date(ms).toISOString();
    }
    if (page > 1) q.page = String(page);
    return q;
}

/** Most recordings OTS puts in one archive when they are chosen one by one. */
export const MAX_ARCHIVE_IDS = 100;

/**
 * Query of /api/recordings/archive: the chosen ids, or (no ids) all recordings
 * matching the screen filters. The page number is not a filter.
 */
export function archiveQuery(ids: string[], filters: Record<string, string>): Record<string, string> {
    if (ids.length) return { ids: ids.join(',') };
    const q: Record<string, string> = { all: 'true' };
    for (const key of ['kind', 'account', 'from', 'to']) if (filters[key]) q[key] = filters[key];
    return q;
}

/** Selection after the list changed: ids no longer on the list drop out. */
export function keepSelected(selected: string[], items: Recording[]): string[] {
    const present = new Set(items.map((r) => r.id));
    return selected.filter((id) => present.has(id));
}

function decimal(value: number, digits: number, locale: string): string {
    const text = value.toFixed(digits);
    return locale === 'pl' ? text.replace('.', ',') : text;
}

export function formatSize(bytes: number | null, locale = 'pl'): string {
    if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${unit === 0 ? String(value) : decimal(value, value >= 100 ? 0 : 1, locale)} ${units[unit]}`;
}

export function formatDuration(seconds: number | null): string {
    if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '';
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "12,3 GB z 50 GB" data: percent rounded, null when the limit is unknown. */
export function usagePercent(usage: RecordingUsage | null): number | null {
    if (!usage || !usage.admin || usage.used_bytes === null || !usage.limit_bytes) return null;
    return Math.min(100, Math.round((usage.used_bytes / usage.limit_bytes) * 100));
}

function point(p: TrackPoint): [number, number] | null {
    const lat = Number(p[0]);
    const lon = Number(p[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return [lon, lat];
}

/** Track as a GeoJSON line [lon, lat]; null when fewer than two usable points. */
export function trackFeature(rec: Pick<RecordingDetail, 'id' | 'track'>): Feature<LineString> | null {
    const coords = (rec.track || []).map(point).filter((p): p is [number, number] => p !== null);
    if (coords.length < 2) return null;
    return {
        type: 'Feature',
        id: `recording-${rec.id}`,
        properties: { recording: rec.id },
        geometry: { type: 'LineString', coordinates: coords },
    };
}

/** [[west, south], [east, north]] of the track, for fitBounds. */
export function trackBounds(line: Feature<LineString>): [[number, number], [number, number]] {
    let [w, s, e, n] = [180, 90, -180, -90];
    for (const [lon, lat] of line.geometry.coordinates) {
        w = Math.min(w, lon);
        e = Math.max(e, lon);
        s = Math.min(s, lat);
        n = Math.max(n, lat);
    }
    return [[w, s], [e, n]];
}

/** Where "Pokaż na mapie" flies: the start position, else the first track point. */
export function startPosition(rec: Pick<RecordingDetail, 'lat' | 'lon'> & { track?: TrackPoint[] }): [number, number] | null {
    if (rec.lat !== null && rec.lon !== null && Math.abs(rec.lat) <= 90 && Math.abs(rec.lon) <= 180) {
        return [rec.lon, rec.lat];
    }
    for (const p of rec.track || []) {
        const lonlat = point(p);
        if (lonlat) return lonlat;
    }
    return null;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

type CotLink = { uid?: unknown; type?: unknown; relation?: unknown };

/**
 * Recording id carried by a map marker from the OTS register, read in both
 * agreed forms: metadata.taklab_recording.id (from <__taklab_recording id>,
 * copied by the CloudTAK server) or <link uid="rec:<id>" type="taklab-recording">.
 */
export function recordingIdOf(properties: { metadata?: unknown; links?: unknown } | null | undefined): string | null {
    if (!properties) return null;

    const meta = properties.metadata as { taklab_recording?: { id?: unknown } } | undefined;
    const fromMeta = meta && typeof meta === 'object' ? meta.taklab_recording?.id : undefined;
    if ((typeof fromMeta === 'string' || typeof fromMeta === 'number') && ID.test(String(fromMeta))) return String(fromMeta);

    if (Array.isArray(properties.links)) {
        for (const link of properties.links as CotLink[]) {
            if (!link || typeof link.uid !== 'string') continue;
            const prefixed = link.uid.startsWith('rec:');
            if (link.type !== 'taklab-recording' && !prefixed) continue;
            const id = prefixed ? link.uid.slice(4) : link.uid;
            if (ID.test(id)) return id;
        }
    }
    return null;
}

/** A renamed row replaces the old one; everything else keeps its place. */
export function replaceRecording(items: Recording[], rec: Recording): Recording[] {
    return items.map((r) => (r.id === rec.id ? { ...r, ...rec } : r));
}

export function withoutRecording(items: Recording[], id: string): Recording[] {
    return items.filter((r) => r.id !== id);
}

/** Accounts seen in the list, for the account filter. */
export function accountsOf(items: Recording[]): string[] {
    return [...new Set(items.map((r) => r.account).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** Name shown in the row: the given name, else kind and callsign. */
export function displayName(rec: Recording, kindLabel: string): string {
    return rec.name.trim() || `${kindLabel} ${rec.callsign || rec.account}`.trim();
}
