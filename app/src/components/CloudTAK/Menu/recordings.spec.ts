import { describe, it, expect } from 'vitest';
import {
    accountsOf,
    archiveQuery,
    keepSelected,
    displayName,
    formatDuration,
    formatSize,
    listQuery,
    recordingIdOf,
    videoRecordingIdOf,
    replaceRecording,
    startPosition,
    trackBounds,
    trackFeature,
    usagePercent,
    withoutRecording,
    type Recording,
} from './recordings.ts';
import { RecordingTrack, RECORDING_TRACK_LAYER, RECORDING_START_LAYER, RECORDING_TRACK_SOURCE } from '../../../base/recording-track.ts';

function rec(id: string, extra: Partial<Recording> = {}): Recording {
    return {
        id, kind: 'video', account: 'alfa', callsign: 'WOLF', uid: 'ANDROID-1', name: '',
        started_at: '2026-11-24T10:00:00Z', ended_at: null, duration_s: 61, lat: 51.1, lon: 17.0,
        size_bytes: 1024, has_text: false, can_manage: false,
        ...extra,
    };
}

describe('recordings menu helpers', () => {
    it('builds the list query only from set filters, dates in UTC', () => {
        expect(listQuery('all', '', '', '')).toEqual({});
        const q = listQuery('scan', ' alfa ', '2026-11-24T10:00', '', 2);
        expect(q.kind).toBe('scan');
        expect(q.account).toBe('alfa');
        expect(q.from).toBe(new Date('2026-11-24T10:00').toISOString());
        expect(q.to).toBeUndefined();
        expect(q.page).toBe('2');
        expect(listQuery('all', '', 'nie-data', '', 1)).toEqual({});
    });

    it('formats size and duration', () => {
        expect(formatSize(null)).toBe('');
        expect(formatSize(512)).toBe('512 B');
        expect(formatSize(45_000_000)).toBe('42,9 MB');
        expect(formatSize(45_000_000, 'en')).toBe('42.9 MB');
        expect(formatSize(13.2 * 1024 ** 3)).toBe('13,2 GB');
        expect(formatDuration(null)).toBe('');
        expect(formatDuration(61)).toBe('1:01');
        expect(formatDuration(3723)).toBe('1:02:03');
    });

    it('computes usage only for the administrator with a known limit', () => {
        expect(usagePercent(null)).toBeNull();
        expect(usagePercent({ admin: false, used_bytes: 1, limit_bytes: 2 })).toBeNull();
        expect(usagePercent({ admin: true, used_bytes: 1, limit_bytes: null })).toBeNull();
        expect(usagePercent({ admin: true, used_bytes: 45, limit_bytes: 50 })).toBe(90);
        expect(usagePercent({ admin: true, used_bytes: 60, limit_bytes: 50 })).toBe(100);
    });

    it('turns the [lat, lon, t] track into a [lon, lat] line', () => {
        expect(trackFeature({ id: '1', track: [[51, 17, 0]] })).toBeNull();
        const line = trackFeature({ id: '1', track: [[51, 17, 0], ['bad', 1, 2], [51.1, 17.2, 5]] });
        expect(line?.geometry.coordinates).toEqual([[17, 51], [17.2, 51.1]]);
        expect(line?.properties).toEqual({ recording: '1' });
        expect(trackBounds(line!)).toEqual([[17, 51], [17.2, 51.1]]);
    });

    it('flies to the start position, else the first track point', () => {
        expect(startPosition({ lat: 51.1, lon: 17 })).toEqual([17, 51.1]);
        expect(startPosition({ lat: null, lon: null, track: [[95, 1, 0], [52, 21, 0]] })).toEqual([21, 52]);
        expect(startPosition({ lat: null, lon: null })).toBeNull();
    });

    it('reads the recording id from both CoT variants and nothing else', () => {
        expect(recordingIdOf({ metadata: { taklab_recording: { id: '7', kind: 'video' } } })).toBe('7');
        expect(recordingIdOf({ metadata: { taklab_recording: { id: 7 } } })).toBe('7');
        expect(recordingIdOf({ links: [{ uid: 'rec:12', relation: 'r-u', type: 'taklab-recording' }] })).toBe('12');
        expect(recordingIdOf({ links: [{ uid: 'abc', type: 'taklab-recording' }] })).toBe('abc');
        expect(recordingIdOf({ links: [{ uid: 'rec:../x', type: 'taklab-recording' }] })).toBeNull();
        expect(recordingIdOf({ links: [{ uid: 'ANDROID-1', relation: 'p-p', type: 'a-f-G' }] })).toBeNull();
        expect(recordingIdOf({ metadata: { taklab_recording: { id: '1/2' } } })).toBeNull();
        expect(recordingIdOf(null)).toBeNull();
        expect(recordingIdOf({})).toBeNull();
    });

    it('videoRecordingIdOf: no map button for voice messages and scans (decision 25 XI 2026)', () => {
        expect(videoRecordingIdOf({ metadata: { taklab_recording: { id: '7', kind: 'video' } } })).toBe('7');
        expect(videoRecordingIdOf({ metadata: { taklab_recording: { id: '8', kind: 'voice' } } })).toBeNull();
        expect(videoRecordingIdOf({ metadata: { taklab_recording: { id: '9', kind: 'scan' } } })).toBeNull();
        expect(videoRecordingIdOf({ links: [{ uid: 'rec:12', relation: 'r-u', type: 'taklab-recording' }] })).toBe('12');
        expect(videoRecordingIdOf(null)).toBeNull();
    });

    it('keeps list order on rename and drops deleted rows', () => {
        const items = [rec('1'), rec('2'), rec('3')];
        expect(replaceRecording(items, rec('2', { name: 'Odprawa' })).map((r) => r.name)).toEqual(['', 'Odprawa', '']);
        expect(withoutRecording(items, '2').map((r) => r.id)).toEqual(['1', '3']);
        expect(accountsOf([rec('1', { account: 'zulu' }), rec('2'), rec('3', { account: '' })])).toEqual(['alfa', 'zulu']);
        expect(displayName(rec('1'), 'Wideo')).toBe('Wideo WOLF');
        expect(displayName(rec('1', { name: ' Patrol ' }), 'Wideo')).toBe('Patrol');
    });
});

class FakeMap {
    sources = new Map<string, unknown>();
    layers = new Map<string, unknown>();
    addSource(id: string, src: unknown) {
        if (this.sources.has(id)) throw new Error(`source ${id} exists`);
        this.sources.set(id, src);
    }
    addLayer(layer: { id: string }) {
        if (this.layers.has(layer.id)) throw new Error(`layer ${layer.id} exists`);
        this.layers.set(layer.id, layer);
    }
    getSource(id: string) { return this.sources.get(id); }
    getLayer(id: string) { return this.layers.get(id); }
    removeLayer(id: string) { this.layers.delete(id); }
    removeSource(id: string) { this.sources.delete(id); }
}

describe('recording track layer', () => {
    it('shows one track at a time and hides cleanly', () => {
        const map = new FakeMap();
        const track = new RecordingTrack();
        const line = trackFeature({ id: '7', track: [[51, 17, 0], [51.1, 17.1, 1]] })!;
        const asMap = map as unknown as Parameters<RecordingTrack['show']>[0];

        track.show(asMap, line);
        track.show(asMap, { ...line, properties: { recording: '8' } });
        expect(track.shown).toBe('8');
        expect([...map.layers.keys()].sort()).toEqual([RECORDING_START_LAYER, RECORDING_TRACK_LAYER].sort());
        expect(map.sources.has(RECORDING_TRACK_SOURCE)).toBe(true);

        track.hide(asMap);
        track.hide(asMap);
        expect(map.layers.size).toBe(0);
        expect(map.sources.size).toBe(0);
        expect(track.shown).toBeNull();
    });
});

describe('archive download', () => {
    it('sends the chosen ids, or all with the screen filters but without the page', () => {
        expect(archiveQuery(['a', 'b'], { kind: 'video', page: '2' })).toEqual({ ids: 'a,b' });
        expect(archiveQuery([], {})).toEqual({ all: 'true' });
        expect(archiveQuery([], { kind: 'voice', account: 'alfa', from: '2026-11-24T09:00:00.000Z', page: '3' }))
            .toEqual({ all: 'true', kind: 'voice', account: 'alfa', from: '2026-11-24T09:00:00.000Z' });
    });

    it('drops selected ids that left the list', () => {
        expect(keepSelected(['a', 'b', 'c'], [rec('c'), rec('a')])).toEqual(['a', 'c']);
        expect(keepSelected(['a'], [])).toEqual([]);
    });
});
