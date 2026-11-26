/**
 * taklab: live video streams published to the environment's OTS.
 *
 * Contract of GET /api/video/live (CloudTAK proxy of OTS /api/taklab/video/live).
 * Pure helpers only, so the store, the map layers and the player share one
 * definition of "this marker is the camera of that stream".
 */

export type LiveVideoTrack = {
    codec: string | null;
    width: number | null;
    height: number | null;
    profile: string | null;
    level: string | null;
    fps: number | null;
};

export type LiveAudioTrack = {
    codec: string | null;
    sample_rate: number | null;
    channels: number | null;
};

export type LiveVideoTech = {
    source: string | null;
    transport: string | null;
    readers: number | null;
    bytes_received: number | null;
    bitrate_kbps: number | null;
    packets_lost: number | null;
    jitter_ms: number | null;
    video: LiveVideoTrack | null;
    audio: LiveAudioTrack | null;
};

export type LiveVideoStream = {
    path: string;
    username: string;
    started_at: string | null;
    tech: LiveVideoTech | null;
};

export type LiveVideoList = {
    supported: boolean;
    generated_at?: string | null;
    streams: LiveVideoStream[];
};

export type LiveVideoDiff = {
    started: LiveVideoStream[];
    ended: LiveVideoStream[];
};

/** Paths that appeared and disappeared between two successful reads. */
export function diffStreams(previous: Iterable<LiveVideoStream>, next: Iterable<LiveVideoStream>): LiveVideoDiff {
    const before = new Map<string, LiveVideoStream>();
    for (const s of previous) before.set(s.path, s);
    const after = new Map<string, LiveVideoStream>();
    for (const s of next) after.set(s.path, s);

    const started: LiveVideoStream[] = [];
    for (const [path, s] of after) if (!before.has(path)) started.push(s);
    const ended: LiveVideoStream[] = [];
    for (const [path, s] of before) if (!after.has(path)) ended.push(s);
    return { started, ended };
}

/** Name shown for a stream: the OTS account, or the path when OTS knows no account. */
export function streamLabel(stream: Pick<LiveVideoStream, 'path' | 'username'>): string {
    return stream.username || stream.path;
}

function trimSlashes(text: string): string {
    return text.replace(/^\/+|\/+$/g, '');
}

/**
 * Does a stream URL point at this path? Accepts the forms CloudTAK meets:
 * rtsp://host:port/<path> from the plugin's <__video>, and the OTS HLS
 * bridge http://host:port/hls/<path>/index.m3u8 from /Marti/api/video.
 * Credentials and the query are ignored.
 */
export function urlMatchesPath(url: string | null | undefined, path: string): boolean {
    if (!url || !path) return false;
    const want = trimSlashes(path);
    if (!want) return false;

    let pathname: string;
    try {
        pathname = new URL(url).pathname;
    } catch {
        pathname = url.split(/[?#]/)[0];
    }
    pathname = decodeURIComponent(trimSlashes(pathname));

    if (pathname === want || pathname.endsWith(`/${want}`)) return true;

    // HLS bridge: /hls/<path>/<playlist>.m3u8 or /<path>/index.m3u8
    const withoutPlaylist = pathname.replace(/\/[^/]+\.m3u8$/, '');
    if (withoutPlaylist !== pathname) {
        const bare = withoutPlaylist.replace(/^hls\//, '');
        return bare === want || withoutPlaylist.endsWith(`/${want}`);
    }
    return false;
}

type MarkerProperties = {
    video?: { url?: unknown } | null;
    metadata?: unknown;
};

/** Path from <__taklab_video path>, copied by the CloudTAK server to metadata.taklab_video. */
export function taklabVideoPath(properties: MarkerProperties | null | undefined): string | null {
    const meta = properties?.metadata as { taklab_video?: { path?: unknown } } | undefined;
    const path = meta && typeof meta === 'object' ? meta.taklab_video?.path : undefined;
    return typeof path === 'string' && path.trim() ? trimSlashes(path.trim()) : null;
}

/** Is this map marker the camera of the stream on this path? */
export function markerMatchesStream(properties: MarkerProperties | null | undefined, path: string): boolean {
    if (!properties) return false;
    const own = taklabVideoPath(properties);
    if (own) return own === trimSlashes(path);
    const url = properties.video && typeof properties.video.url === 'string' ? properties.video.url : null;
    return urlMatchesPath(url, path);
}

/** The live stream whose camera this marker is, if any. */
export function streamOfMarker<S extends Pick<LiveVideoStream, 'path'>>(
    properties: MarkerProperties | null | undefined,
    streams: Iterable<S>,
): S | null {
    for (const s of streams) if (markerMatchesStream(properties, s.path)) return s;
    return null;
}

/** The live stream a player URL plays, if any. */
export function streamOfUrl<S extends Pick<LiveVideoStream, 'path'>>(url: string | null | undefined, streams: Iterable<S>): S | null {
    for (const s of streams) if (urlMatchesPath(url, s.path)) return s;
    return null;
}

/** Seconds since the stream started, or null when OTS gave no usable start. */
export function streamAge(stream: Pick<LiveVideoStream, 'started_at'>, now: number = Date.now()): number | null {
    if (!stream.started_at) return null;
    const start = new Date(stream.started_at).getTime();
    if (!Number.isFinite(start)) return null;
    return Math.max(0, Math.floor((now - start) / 1000));
}

export function formatDuration(seconds: number | null): string {
    if (seconds === null || !Number.isFinite(seconds)) return '';
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** 2100.5 → "2,1 Mb/s" (pl) / "2.1 Mb/s" (en); 850 → "850 kb/s". */
export function formatBitrate(kbps: number | null | undefined, locale = 'pl'): string {
    if (kbps === null || kbps === undefined || !Number.isFinite(kbps)) return '';
    if (kbps >= 1000) {
        return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(kbps / 1000)} Mb/s`;
    }
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(kbps)} kb/s`;
}

export function formatResolution(width: number | null | undefined, height: number | null | undefined): string {
    if (!width || !height) return '';
    return `${width}×${height}`;
}

/** Resolution of the stream as the sender publishes it. */
export function streamResolution(stream: LiveVideoStream): string {
    const v = stream.tech?.video;
    return v ? formatResolution(v.width, v.height) : '';
}

export type ClientStats = {
    width: number | null;
    height: number | null;
    /** hls.js bandwidth estimate, kb/s */
    download_kbps: number | null;
    /** level bitrate announced in the playlist, kb/s */
    level_kbps: number | null;
    /** seconds behind the live edge */
    latency_s: number | null;
    /** seconds buffered ahead of the playhead */
    buffer_s: number | null;
    dropped_frames: number | null;
    total_frames: number | null;
};

type HlsLike = {
    currentLevel?: number;
    levels?: Array<{ width?: number; height?: number; bitrate?: number }>;
    bandwidthEstimate?: number;
    latency?: number;
    liveSyncPosition?: number | null;
};

type VideoLike = {
    videoWidth?: number;
    videoHeight?: number;
    currentTime: number;
    buffered?: { length: number; end(i: number): number };
    getVideoPlaybackQuality?: () => { droppedVideoFrames: number; totalVideoFrames: number };
};

function finite(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Player-side numbers for the technical panel, from hls.js (when used) and the media element. */
export function clientStats(hls: HlsLike | null | undefined, video: VideoLike | null | undefined): ClientStats {
    const level = hls && hls.levels && typeof hls.currentLevel === 'number' && hls.currentLevel >= 0
        ? hls.levels[hls.currentLevel]
        : undefined;

    const width = finite(level?.width) || finite(video?.videoWidth) || null;
    const height = finite(level?.height) || finite(video?.videoHeight) || null;

    const estimate = finite(hls?.bandwidthEstimate);
    const bitrate = finite(level?.bitrate);

    let latency = finite(hls?.latency);
    if (latency === null && video && finite(hls?.liveSyncPosition) !== null) {
        latency = Math.max(0, (hls!.liveSyncPosition as number) - video.currentTime);
    }

    let buffer: number | null = null;
    if (video?.buffered && video.buffered.length > 0) {
        buffer = Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime);
    }

    let dropped: number | null = null;
    let total: number | null = null;
    if (video && typeof video.getVideoPlaybackQuality === 'function') {
        const q = video.getVideoPlaybackQuality();
        dropped = finite(q.droppedVideoFrames);
        total = finite(q.totalVideoFrames);
    }

    return {
        width,
        height,
        download_kbps: estimate !== null && estimate > 0 ? estimate / 1000 : null,
        level_kbps: bitrate !== null && bitrate > 0 ? bitrate / 1000 : null,
        latency_s: latency,
        buffer_s: buffer,
        dropped_frames: dropped,
        total_frames: total,
    };
}

/** What the Videos menu knows about one stream from /Marti/api/video. */
export type ConnectionLike = {
    alias?: string | null;
    feeds?: Array<{ url?: string | null }> | null;
};

/**
 * Path of the OTS stream behind a /Marti/api/video entry: OTS puts the path
 * in the alias and in the HLS bridge URL /hls/<path>/index.m3u8.
 */
export function connectionPath(connection: ConnectionLike): string | null {
    const alias = typeof connection.alias === 'string' ? trimSlashes(connection.alias.trim()) : '';
    if (alias) return alias;
    const url = connection.feeds?.[0]?.url;
    if (!url) return null;
    let pathname: string;
    try {
        pathname = new URL(url).pathname;
    } catch {
        pathname = url.split(/[?#]/)[0];
    }
    const match = /\/hls\/(.+?)\/index\.m3u8$/.exec(pathname);
    return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Is this /Marti/api/video entry a stream that is not being published now?
 * OTS lists every stream it ever saw and marks all of them active, so only
 * the live list of /api/video/live can tell. Without that list (not loaded
 * yet, or an OTS without the route) the answer is false: the menu keeps the
 * upstream behaviour and opens the player.
 */
export function isConnectionOffline(
    connection: ConnectionLike,
    live: { loaded: boolean; supported: boolean; streams: Iterable<Pick<LiveVideoStream, 'path'>> },
): boolean {
    if (!live.loaded || !live.supported) return false;
    const path = connectionPath(connection);
    const url = connection.feeds?.[0]?.url ?? null;
    for (const s of live.streams) {
        if (path !== null && trimSlashes(s.path) === path) return false;
        if (urlMatchesPath(url, s.path)) return false;
    }
    return true;
}
