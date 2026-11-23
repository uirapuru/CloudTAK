/** Pure helpers of the Voice menu (taklab voice log), kept apart for tests. */

export const ALL_CHANNELS = 'Wszystkie kanały';

export type VoiceRecording = {
    id: number;
    channel: string;
    author: string;
    source: string;
    started_at: string;
    ended_at: string;
    started_ts: number;
    duration_s: number;
    transcript: string | null;
    transcript_status: string;
    transcript_attempts: number;
};

export type VoiceStatus = {
    enabled: boolean;
    channels?: Array<{ name: string; users?: string[]; speaking?: string | null }>;
};

/** Filters of the screen as query parameters of /api/voice/recordings and /api/voice/export. */
export function rangeQuery(channel: string, from: string, to: string): Record<string, string | number> {
    const q: Record<string, string | number> = {};
    if (channel && channel !== ALL_CHANNELS) q.channel = channel;
    const since = toUnix(from);
    const until = toUnix(to);
    if (since !== undefined) q.since = since;
    if (until !== undefined) q.until = until;
    return q;
}

/** datetime-local value (local time, no zone) to Unix seconds. */
export function toUnix(value: string): number | undefined {
    if (!value) return undefined;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

/**
 * Put the newest page on top of what the screen already shows: new recordings
 * come first, known ones are replaced (a transcript may have arrived), older
 * pages loaded with "Starsze nagrania" stay.
 */
export function mergeNewest(current: VoiceRecording[], page: VoiceRecording[]): VoiceRecording[] {
    const fresh = new Map(page.map((r) => [r.id, r]));
    const rest = current.filter((r) => !fresh.has(r.id));
    return [...page, ...rest].sort((a, b) => b.started_ts - a.started_ts || b.id - a.id);
}

export function transcriptState(rec: VoiceRecording): string {
    switch (rec.transcript_status) {
        case 'pending': return 'Transkrypcja w kolejce…';
        case 'failed': return 'Transkrypcja nieudana';
        case 'disabled': return 'Transkrypcja wyłączona';
        case 'done': return 'Bez słów do przepisania';
        default: return rec.transcript_status;
    }
}

export function speakingNow(status: VoiceStatus): Array<{ channel: string; user: string }> {
    return (status.channels || [])
        .filter((c) => c.speaking)
        .map((c) => ({ channel: c.name, user: c.speaking as string }));
}
