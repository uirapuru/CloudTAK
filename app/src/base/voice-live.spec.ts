import { describe, it, expect, vi, afterEach } from 'vitest';
import VoiceLive, { ALL_CHANNELS, NOTE_MS } from './voice-live.ts';

describe('VoiceLive notes and listening', () => {
    afterEach(() => vi.useRealTimers());

    it('notes a new speaker with the channel, then keeps it for a while after they stop', () => {
        vi.useFakeTimers();
        const v = new VoiceLive();
        v.state.name = 'HQ-CloudTAK';
        v.updateNotes({}, { 'Pluton 1': 'Alfa 1 (pluton1)' });
        expect(v.state.notes).toHaveLength(1);
        expect(v.state.notes[0]).toMatchObject({ speaker: 'Alfa 1 (pluton1)', channel: 'Pluton 1', live: true });
        v.updateNotes({ 'Pluton 1': 'Alfa 1 (pluton1)' }, {});
        expect(v.state.notes[0].live).toBe(false);
        vi.advanceTimersByTime(NOTE_MS + 1);
        expect(v.state.notes).toHaveLength(0);
    });

    it('does not note my own transmission', () => {
        const v = new VoiceLive();
        v.state.name = 'HQ-CloudTAK';
        v.updateNotes({}, { Dowodzenie: 'HQ-CloudTAK' });
        expect(v.state.notes).toHaveLength(0);
    });

    it('listens to all channels, also after picking a channel for PTT', () => {
        const v = new VoiceLive();
        const sent: unknown[] = [];
        (v as unknown as { send: (m: unknown) => void }).send = (m) => sent.push(m);
        v.state.listening = true;
        v.setChannel('Pluton 2');
        expect(sent).toContainEqual({ type: 'listen', channel: ALL_CHANNELS });
        v.setListening(false);
        expect(sent).toContainEqual({ type: 'listen', channel: null });
    });
});
