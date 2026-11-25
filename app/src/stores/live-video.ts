/*
 * taklab: LiveVideoStore - streams being published to the environment's OTS
 *
 * Asks /api/video/live every 5 s while the tab is visible (30 s in the
 * background), says when a stream starts or ends, and keeps the map markers
 * that are cameras (CoT with <sensor> or a video link) for the badge list,
 * the 3D frustum layer and the "live" ring.
 */

import { defineStore } from 'pinia';
import { std } from '../std.ts';
import { t } from '../i18n.ts';
import TAKNotification, { NotificationType } from '../base/notification.ts';
import { useFloatStore, VideoStoreType } from './float.ts';
import { useMapStore } from './map.ts';
import {
    diffStreams,
    streamLabel,
    streamOfMarker,
    markerMatchesStream,
    urlMatchesPath,
    type LiveVideoList,
    type LiveVideoStream,
} from '../base/live-video.ts';
import type { Feature, VideoConnectionList } from '../types.ts';

export const POLL_VISIBLE_MS = 5_000;
export const POLL_HIDDEN_MS = 30_000;
/** OTS without the live route: ask again rarely, it may be upgraded meanwhile. */
export const POLL_UNSUPPORTED_MS = 5 * 60_000;
export const MARKER_SCAN_MS = 2_000;
export const START_TOAST_MS = 10_000;
export const END_TOAST_MS = 4_000;

/** Menu route the notification entry opens: the Videos menu lists live streams on top. */
export const LIVE_VIDEO_ROUTE = '/menu/videos';

export type LiveVideoToast = {
    id: number;
    kind: 'start' | 'end';
    path: string;
    label: string;
};

/** Map marker that is (or may be) a camera: what the frustum, ring and list need. */
export type CameraMarker = {
    id: string;
    callsign: string;
    coordinates: [number, number];
    sensor: NonNullable<Feature['properties']['sensor']> | null;
    video: { url?: string } | null;
    metadata: unknown;
};

/** jsonata filter over the worker's CoT store: markers that carry a sensor or a video link. */
export const CAMERA_FILTER = '$exists(properties.sensor) or $exists(properties.video.url) or $exists(properties.metadata.taklab_video)';

let pollTimer: ReturnType<typeof setTimeout> | undefined;
let scanTimer: ReturnType<typeof setInterval> | undefined;
let nextToastId = 1;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

function hidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export const useLiveVideoStore = defineStore('liveVideo', {
    state: (): {
        running: boolean;
        /** true after the first successful answer: only later changes are announced */
        loaded: boolean;
        supported: boolean;
        streams: LiveVideoStream[];
        error: string | null;
        updated: number | null;
        toasts: LiveVideoToast[];
        cameras: CameraMarker[];
        /** List of streams opened from the map badge */
        listOpen: boolean;
    } => ({
        running: false,
        loaded: false,
        supported: true,
        streams: [],
        error: null,
        updated: null,
        toasts: [],
        cameras: [],
        listOpen: false,
    }),
    getters: {
        count(state): number {
            return state.streams.length;
        },
        /** Camera marker of each live path (only markers that match a stream). */
        liveCameras(state): Map<string, CameraMarker> {
            const out = new Map<string, CameraMarker>();
            for (const s of state.streams) {
                const camera = state.cameras.find((c) => markerMatchesStream(c, s.path));
                if (camera) out.set(s.path, camera);
            }
            return out;
        },
    },
    actions: {
        start(): void {
            if (this.running) return;
            this.running = true;
            if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
            void this.poll();
            scanTimer = setInterval(() => { void this.scanMarkers(); }, MARKER_SCAN_MS);
            void this.scanMarkers();
        },
        stop(): void {
            this.running = false;
            if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
            if (pollTimer) clearTimeout(pollTimer);
            if (scanTimer) clearInterval(scanTimer);
            pollTimer = undefined;
            scanTimer = undefined;
            for (const timer of toastTimers.values()) clearTimeout(timer);
            toastTimers.clear();
            this.$reset();
        },
        onVisibility(): void {
            // Back in front: refresh now instead of waiting out the background interval
            if (this.running && !hidden()) {
                void this.poll();
            }
        },
        schedule(): void {
            if (pollTimer) clearTimeout(pollTimer);
            if (!this.running) return;
            const delay = !this.supported ? POLL_UNSUPPORTED_MS : (hidden() ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
            pollTimer = setTimeout(() => { void this.poll(); }, delay);
        },
        async poll(): Promise<void> {
            try {
                const list = await std('/api/video/live') as LiveVideoList;
                this.apply(list);
                this.error = null;
            } catch (err) {
                // Keep the last list: a hiccup must not announce every stream as ended
                this.error = err instanceof Error ? err.message : String(err);
            } finally {
                this.schedule();
            }
        },
        /** Take one successful answer: announce changes, then replace the list. */
        apply(list: LiveVideoList): void {
            this.supported = list.supported !== false;
            const next = Array.isArray(list.streams) ? list.streams : [];

            if (this.loaded) {
                const { started, ended } = diffStreams(this.streams, next);
                for (const s of started) this.announceStart(s);
                for (const s of ended) this.announceEnd(s);
            }

            this.streams = next;
            this.loaded = true;
            this.updated = Date.now();
        },
        announceStart(stream: LiveVideoStream): void {
            const label = streamLabel(stream);
            this.pushToast({ kind: 'start', path: stream.path, label }, START_TOAST_MS);

            TAKNotification.create(
                NotificationType.Video,
                t('liveVideo.notification.title', { user: label }),
                t('liveVideo.notification.body', { user: label }),
                LIVE_VIDEO_ROUTE,
                false,
            ).catch((err: unknown) => console.error('Failed to save the live video notification', err));
        },
        announceEnd(stream: LiveVideoStream): void {
            // The start toast of a stream that ended already is stale
            for (const toast of this.toasts.filter((x) => x.kind === 'start' && x.path === stream.path)) {
                this.dismissToast(toast.id);
            }
            this.pushToast({ kind: 'end', path: stream.path, label: streamLabel(stream) }, END_TOAST_MS);
        },
        pushToast(toast: Omit<LiveVideoToast, 'id'>, timeout: number): void {
            const id = nextToastId++;
            this.toasts.push({ id, ...toast });
            toastTimers.set(id, setTimeout(() => this.dismissToast(id), timeout));
        },
        dismissToast(id: number): void {
            const timer = toastTimers.get(id);
            if (timer) clearTimeout(timer);
            toastTimers.delete(id);
            this.toasts = this.toasts.filter((x) => x.id !== id);
        },
        stream(path: string): LiveVideoStream | null {
            return this.streams.find((s) => s.path === path) ?? null;
        },
        /** Live stream behind a player URL (HLS bridge or RTSP), for the technical panel. */
        streamForUrl(url: string | null | undefined): LiveVideoStream | null {
            if (!url) return null;
            return this.streams.find((s) => urlMatchesPath(url, s.path)) ?? null;
        },
        /** Is this marker the camera of a live stream? */
        isLiveMarker(properties: { video?: { url?: unknown } | null; metadata?: unknown }): boolean {
            return streamOfMarker(properties, this.streams) !== null;
        },
        async scanMarkers(): Promise<void> {
            if (!this.running || hidden()) return;
            try {
                const mapStore = useMapStore();
                if (!mapStore.isMapLoaded) return;
                // Connection CoTs only: reading every subscribed mission from IndexedDB every 2 s costs too much
                const found = await mapStore.worker.db.filter(CAMERA_FILTER);
                const cameras: CameraMarker[] = [];
                for (const cot of found) {
                    const geometry = cot.geometry;
                    if (!geometry || geometry.type !== 'Point') continue;
                    const [lng, lat] = geometry.coordinates;
                    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
                    const p = cot.properties;
                    cameras.push({
                        id: cot.id,
                        callsign: p.callsign || '',
                        coordinates: [lng, lat],
                        sensor: p.sensor ?? null,
                        video: p.video ? { url: p.video.url } : null,
                        metadata: p.metadata ?? null,
                    });
                }
                this.cameras = cameras;
            } catch (err) {
                console.warn('Live video: camera scan failed', err);
            }
        },
        /**
         * Open the player for a stream. The OTS HLS bridge from /Marti/api/video
         * is the way CloudTAK plays OTS streams; the camera marker's own URL
         * is the fallback.
         */
        async watch(path: string): Promise<boolean> {
            const floatStore = useFloatStore();
            const stream = this.stream(path);
            const name = stream ? streamLabel(stream) : path;

            try {
                const list = await std('/api/marti/video') as VideoConnectionList;
                for (const connection of list.videoConnections || []) {
                    const feed = (connection.feeds || []).find((f) => urlMatchesPath(f.url, path));
                    if (!feed) continue;
                    floatStore.addVideo(`live-${path}`, connection.alias || name, { type: VideoStoreType.CONNECTION, url: feed.url, livePath: path });
                    return true;
                }
            } catch (err) {
                console.warn('Live video: OTS stream list failed', err);
            }

            const camera = this.liveCameras.get(path);
            if (camera && camera.video?.url) {
                floatStore.addVideo(`live-${path}`, name, { type: VideoStoreType.COT, url: camera.video.url, livePath: path });
                return true;
            }

            return false;
        },
        /** Centre the map on the camera of a stream; false when it has no marker. */
        showOnMap(path: string): string | null {
            const camera = this.liveCameras.get(path);
            if (!camera) return null;
            const mapStore = useMapStore();
            mapStore.map.flyTo({ center: camera.coordinates, zoom: Math.max(mapStore.map.getZoom(), 16) });
            return camera.id;
        },
    },
});
