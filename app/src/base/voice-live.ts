/**
 * Live listening and push-to-talk of the taklab voice log on the map.
 *
 * One WebSocket per tab (/api/voice/ws, relayed by the CloudTAK server to the
 * voice service of the environment). Down: JSON events and PCM 16 kHz of the
 * selected channel, played at once. Up: JSON control and, while the button is
 * held and the service granted the floor, microphone PCM 48 kHz.
 *
 * The microphone is opened on every press and closed on release, so the
 * browser shows its recording indicator only while the user transmits.
 */
import { reactive } from 'vue';
import { stdurl, getRuntimeToken } from '../std.ts';
import {
    FrameCutter,
    LISTEN_RATE,
    MAX_HOLD_MS,
    SEND_RATE,
    int16ToFloat32,
    nextPlayTime,
    resample,
} from './voice-audio.ts';

const CHANNEL_KEY = 'taklab.voice.channel';
const LISTEN_KEY = 'taklab.voice.listening';
const RETRY_MAX_MS = 30_000;

type ServerMessage =
    | { type: 'hello'; name: string; ptt: boolean; channels: string[] }
    | { type: 'floor'; speaking: Record<string, string> }
    | { type: 'granted'; channel: string }
    | { type: 'denied'; channel: string; speaking: string }
    | { type: 'stopped'; reason: string }
    | { type: 'error'; message: string };

export default class VoiceLive {
    state = reactive({
        connected: false,
        ptt: false,
        name: '',
        channels: [] as string[],
        channel: null as string | null,
        speaking: {} as Record<string, string>,
        requesting: false,
        transmitting: false,
        listening: localStorage.getItem(LISTEN_KEY) !== 'false',
        audioLocked: true,
        error: '',
    });

    private ws?: WebSocket;
    private ctx?: AudioContext;
    private playUntil = 0;
    private mic?: MediaStream;
    private source?: MediaStreamAudioSourceNode;
    private processor?: ScriptProcessorNode;
    private cutter = new FrameCutter();
    private holdTimer?: ReturnType<typeof setTimeout>;
    private retryMs = 1000;
    private closed = false;
    private pressed = false;
    private granted = false;

    async start(): Promise<void> {
        this.closed = false;
        document.addEventListener('pointerdown', this.unlock, true);
        document.addEventListener('keydown', this.unlock, true);
        await this.connect();
    }

    close(): void {
        this.closed = true;
        document.removeEventListener('pointerdown', this.unlock, true);
        document.removeEventListener('keydown', this.unlock, true);
        this.stopTransmit(false);
        this.ws?.close();
        this.ctx?.close().catch(() => undefined);
        this.ctx = undefined;
    }

    // --- connection ----------------------------------------------------------

    private async connect(): Promise<void> {
        if (this.closed) return;
        const url = stdurl('/api/voice/ws');
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        const token = await getRuntimeToken();
        if (token) url.searchParams.set('token', token);

        const ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        this.ws = ws;

        ws.onopen = () => {
            this.retryMs = 1000;
            this.state.connected = true;
            this.state.error = '';
        };
        ws.onmessage = (ev) => {
            if (ev.data instanceof ArrayBuffer) {
                this.play(ev.data);
            } else {
                try {
                    this.onMessage(JSON.parse(String(ev.data)) as ServerMessage);
                } catch {
                    // A malformed event must not stop listening.
                }
            }
        };
        ws.onclose = () => {
            this.state.connected = false;
            this.stopTransmit(false);
            if (this.closed) return;
            setTimeout(() => { this.connect().catch(() => undefined); }, this.retryMs);
            this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
        };
    }

    private send(msg: object | ArrayBuffer): void {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        this.ws.send(msg instanceof ArrayBuffer ? msg : JSON.stringify(msg));
    }

    private onMessage(msg: ServerMessage): void {
        switch (msg.type) {
            case 'hello': {
                this.state.name = msg.name;
                this.state.ptt = msg.ptt;
                this.state.channels = msg.channels;
                const stored = localStorage.getItem(CHANNEL_KEY);
                const pick = stored && msg.channels.includes(stored)
                    ? stored
                    : msg.channels.find((c) => c.toLowerCase() !== 'echo') || msg.channels[0] || null;
                this.setChannel(pick);
                break;
            }
            case 'floor': {
                this.state.speaking = msg.speaking;
                const speaker = this.state.channel ? msg.speaking[this.state.channel] : undefined;
                // Lost a simultaneous press: the server muted us, so stop at once.
                if (this.state.transmitting && speaker && speaker !== this.state.name) this.stopTransmit(true);
                break;
            }
            case 'granted':
                this.granted = true;
                this.state.requesting = false;
                if (!this.pressed) {
                    this.send({ type: 'stop' });
                    this.granted = false;
                } else {
                    this.beginTransmit();
                }
                break;
            case 'denied':
                this.state.requesting = false;
                this.state.speaking = { ...this.state.speaking, [msg.channel]: msg.speaking };
                this.releaseMic();
                break;
            case 'stopped':
                this.stopTransmit(false);
                break;
            case 'error':
                this.state.requesting = false;
                this.state.error = msg.message;
                this.releaseMic();
                break;
        }
    }

    // --- listening -----------------------------------------------------------

    setChannel(channel: string | null): void {
        if (this.state.transmitting) this.stopTransmit(true);
        this.state.channel = channel;
        if (channel) localStorage.setItem(CHANNEL_KEY, channel);
        this.send({ type: 'listen', channel: this.state.listening ? channel : null });
    }

    setListening(on: boolean): void {
        this.state.listening = on;
        localStorage.setItem(LISTEN_KEY, String(on));
        this.send({ type: 'listen', channel: on ? this.state.channel : null });
    }

    private audio(): AudioContext {
        if (!this.ctx) this.ctx = new AudioContext();
        return this.ctx;
    }

    /** Browsers start audio only after a user gesture; any click or key unlocks it. */
    unlock = (): void => {
        const ctx = this.audio();
        if (ctx.state === 'running') {
            this.state.audioLocked = false;
            return;
        }
        ctx.resume().then(() => {
            this.state.audioLocked = ctx.state !== 'running';
        }).catch(() => undefined);
    };

    private play(data: ArrayBuffer): void {
        if (!this.state.listening || this.state.transmitting) return;
        const ctx = this.audio();
        if (ctx.state !== 'running') {
            this.state.audioLocked = true;
            return;
        }
        const samples = int16ToFloat32(data);
        if (!samples.length) return;
        const buffer = ctx.createBuffer(1, samples.length, LISTEN_RATE);
        buffer.copyToChannel(samples, 0);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        const at = nextPlayTime(ctx.currentTime, this.playUntil);
        src.start(at);
        this.playUntil = at + buffer.duration;
    }

    // --- push to talk --------------------------------------------------------

    async press(): Promise<void> {
        if (!this.state.connected || !this.state.ptt || !this.state.channel) return;
        if (this.state.requesting || this.state.transmitting) return;
        const speaker = this.state.speaking[this.state.channel];
        if (speaker && speaker !== this.state.name) return;

        this.pressed = true;
        this.granted = false;
        this.state.requesting = true;
        this.state.error = '';
        this.unlock();
        // Ask the service and the browser at the same time: both take a moment.
        this.send({ type: 'start', channel: this.state.channel });
        try {
            this.mic = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
        } catch {
            this.state.error = 'Brak dostępu do mikrofonu. Zezwól na mikrofon w ustawieniach przeglądarki.';
            this.state.requesting = false;
            this.pressed = false;
            this.send({ type: 'stop' });
            return;
        }
        if (!this.pressed) {
            this.releaseMic();
            return;
        }
        if (this.granted) this.beginTransmit();
    }

    release(): void {
        this.pressed = false;
        if (this.state.transmitting) {
            this.stopTransmit(true);
        } else if (this.state.requesting) {
            this.state.requesting = false;
            this.send({ type: 'stop' });
            this.releaseMic();
        }
    }

    private beginTransmit(): void {
        if (!this.mic || !this.granted || this.state.transmitting) return;
        const ctx = this.audio();
        // ScriptProcessorNode, not AudioWorklet: no module file to serve and
        // no extra CSP rule; the cost (main thread) is fine for one mono input.
        this.source = ctx.createMediaStreamSource(this.mic);
        this.processor = ctx.createScriptProcessor(2048, 1, 1);
        this.processor.onaudioprocess = (ev) => {
            if (!this.state.transmitting) return;
            const input = ev.inputBuffer.getChannelData(0);
            for (const frame of this.cutter.push(resample(input, ctx.sampleRate, SEND_RATE))) {
                this.send(frame.buffer as ArrayBuffer);
            }
        };
        this.source.connect(this.processor);
        // Chrome fires onaudioprocess only for a connected node; it outputs silence.
        this.processor.connect(ctx.destination);
        this.state.transmitting = true;
        this.holdTimer = setTimeout(() => this.release(), MAX_HOLD_MS);
    }

    private stopTransmit(notify: boolean): void {
        if (this.holdTimer) clearTimeout(this.holdTimer);
        this.holdTimer = undefined;
        this.processor?.disconnect();
        this.source?.disconnect();
        this.processor = undefined;
        this.source = undefined;
        this.cutter.reset();
        this.releaseMic();
        if (notify && (this.state.transmitting || this.state.requesting)) this.send({ type: 'stop' });
        this.state.transmitting = false;
        this.state.requesting = false;
        this.granted = false;
    }

    private releaseMic(): void {
        for (const track of this.mic?.getTracks() || []) track.stop();
        this.mic = undefined;
    }
}
