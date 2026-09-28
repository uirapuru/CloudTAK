import type { FeatureCollection } from 'geojson';
import type { LayerSpecification } from 'maplibre-gl';

/**
 * Live overlays (mode 'live'): GeoJSON served by the taklab live-feeds pod
 * through /api/live/:name and refreshed on an interval. Features describe
 * their own look with underscore fields (_color, _label, _icon, _rotation);
 * every other property is shown to the user on click.
 */

export const LIVE_PLANE_IMAGE = 'live-plane';

export type LiveCollection = FeatureCollection & {
    attribution?: string;
    updated?: string | null;
    stale?: boolean;
};

export function liveStyles(id: string): LayerSpecification[] {
    return [{
        id: `${id}-circle`,
        type: 'circle',
        source: id,
        filter: ['==', ['get', '_icon'], 'circle'],
        paint: {
            'circle-radius': 6,
            'circle-color': ['get', '_color'],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
        },
    }, {
        id: `${id}-plane`,
        type: 'symbol',
        source: id,
        filter: ['==', ['get', '_icon'], 'plane'],
        layout: {
            'icon-image': LIVE_PLANE_IMAGE,
            'icon-size': 0.75,
            'icon-rotate': ['get', '_rotation'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
        },
        paint: {
            'icon-color': ['get', '_color'],
            'icon-halo-color': '#000000',
            'icon-halo-width': 1,
        },
    }, {
        id: `${id}-label`,
        type: 'symbol',
        source: id,
        filter: ['!=', ['get', '_label'], ''],
        layout: {
            'text-field': ['get', '_label'],
            'text-font': ['Open Sans Bold'],
            'text-size': 11,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
        },
        paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#000000',
            'text-halo-width': 1.5,
        },
    }] as LayerSpecification[];
}

export function visibleProperties(props: Record<string, unknown> | null | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props || {})) {
        if (!key.startsWith('_')) out[key] = value;
    }
    return out;
}

/** Title for live features, which carry no name/callsign: _label, else the first visible text value (e.g. an address) */
export function liveFeatureTitle(props: Record<string, unknown> | null | undefined): string {
    const label = props?._label;
    if (typeof label === 'string' && label.trim()) return label;
    for (const value of Object.values(visibleProperties(props))) {
        if (typeof value === 'string' && value.trim()) return value;
    }
    return '';
}

/** Arrow pointing north: tip at the top, notch at the bottom centre */
export function planeIcon(size: number): { width: number; height: number; data: Uint8Array } {
    const data = new Uint8Array(size * size * 4);
    const cx = (size - 1) / 2;
    const top = size * 0.08;
    const bottom = size * 0.92;
    const notch = size * 0.7;
    const halfWidth = size * 0.42;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (y < top || y > bottom) continue;
            const t = (y - top) / (bottom - top);
            const dx = Math.abs(x - cx);
            if (dx > halfWidth * t) continue;
            // Cut the notch: below it the arrow keeps only the outer part
            const notchY = notch + (bottom - notch) * (dx / halfWidth);
            if (y > notchY) continue;
            const i = (y * size + x) * 4;
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = 255;
        }
    }

    return { width: size, height: size, data };
}

export class LivePoller {
    running = false;
    private timer: ReturnType<typeof setInterval> | null = null;
    private generation = 0;

    constructor(private opts: {
        url: string;
        intervalMs: number;
        fetch: (url: string) => Promise<LiveCollection>;
        onData: (fc: LiveCollection) => void;
        onError?: (err: unknown) => void;
    }) {}

    start(): void {
        if (this.running) return;
        this.running = true;
        this.generation++;
        void this.tick();
        this.timer = setInterval(() => { void this.tick(); }, this.opts.intervalMs);
    }

    stop(): void {
        this.running = false;
        this.generation++;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    async tick(): Promise<void> {
        const generation = this.generation;
        try {
            const fc = await this.opts.fetch(this.opts.url);
            if (generation !== this.generation || !this.running) return;
            this.opts.onData(fc);
        } catch (err) {
            if (generation !== this.generation) return;
            if (this.opts.onError) this.opts.onError(err);
            else console.error('Live layer refresh failed', this.opts.url, err);
        }
    }
}
