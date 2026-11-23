import { describe, it, expect } from 'vitest';
import { ALL_CHANNELS, mergeNewest, rangeQuery, speakingNow, toUnix, transcriptState, type VoiceRecording } from './voice.ts';

function rec(id: number, ts: number, extra: Partial<VoiceRecording> = {}): VoiceRecording {
    return {
        id, channel: 'A', author: 'ALFA', source: 'mumble', started_at: '', ended_at: '',
        started_ts: ts, duration_s: 1, transcript: null, transcript_status: 'pending', transcript_attempts: 0,
        ...extra,
    };
}

describe('voice menu helpers', () => {
    it('builds the range query only from set filters', () => {
        expect(rangeQuery(ALL_CHANNELS, '', '')).toEqual({});
        const q = rangeQuery('Pluton 1', '2026-11-23T10:00', '');
        expect(q.channel).toBe('Pluton 1');
        expect(q.since).toBe(toUnix('2026-11-23T10:00'));
        expect(q.until).toBeUndefined();
    });

    it('ignores invalid dates', () => {
        expect(toUnix('nonsense')).toBeUndefined();
    });

    it('merges a fresh page on top and replaces known recordings', () => {
        const current = [rec(2, 20), rec(1, 10)];
        const page = [rec(3, 30), rec(2, 20, { transcript_status: 'done', transcript: 'Tu Alfa' })];
        const merged = mergeNewest(current, page);
        expect(merged.map((r) => r.id)).toEqual([3, 2, 1]);
        expect(merged[1].transcript).toBe('Tu Alfa');
    });

    it('describes transcript states in Polish', () => {
        expect(transcriptState(rec(1, 1))).toBe('Transkrypcja w kolejce…');
        expect(transcriptState(rec(1, 1, { transcript_status: 'disabled' }))).toBe('Transkrypcja wyłączona');
    });

    it('lists current speakers', () => {
        expect(speakingNow({ enabled: true, channels: [{ name: 'A', speaking: 'ALFA' }, { name: 'B', speaking: null }] }))
            .toEqual([{ channel: 'A', user: 'ALFA' }]);
    });
});
