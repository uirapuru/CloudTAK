import type { FeatureCollection } from 'geojson';
import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import busSvg from '@tabler/icons/outline/bus.svg?raw';
import trainSvg from '@tabler/icons/outline/train.svg?raw';
import towerSvg from '@tabler/icons/outline/building-broadcast-tower.svg?raw';
import shelterSvg from '@tabler/icons/outline/home-shield.svg?raw';

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
    unchanged?: boolean;
};

const ICON_NAMES = ['bus', 'tram', 'tower', 'shelter'];
const ICON_SIZE = 32;
const ICON_SVGS: Record<string, string> = { bus: busSvg, tram: trainSvg, tower: towerSvg, shelter: shelterSvg };

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image(ICON_SIZE, ICON_SIZE);
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Live icon failed to load'));
        img.src = src;
    });
}

/** White Tabler icons rasterized once per map; MapLibre does not tint them (no SDF) */
export async function ensureLiveIcons(map: Pick<MapLibreMap, 'hasImage' | 'addImage'>): Promise<void> {
    for (const name of ICON_NAMES) {
        const id = `live-${name}`;
        if (map.hasImage(id)) continue;
        const svg = ICON_SVGS[name]
            .replace(/currentColor/g, '#ffffff')
            .replace(/(width|height)="24"/g, `$1="${ICON_SIZE}"`);
        const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
        const canvas = document.createElement('canvas');
        canvas.width = ICON_SIZE;
        canvas.height = ICON_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.drawImage(img, 0, 0, ICON_SIZE, ICON_SIZE);
        // The map may have been re-initialised while the image loaded
        if (map.hasImage(id)) continue;
        map.addImage(id, ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE));
    }
}

const ICON_KINDS = ['bus', 'tram', 'tower', 'shelter'];
// MapLibre reports Multi* as their single type in expressions; both spellings are matched to be safe
const LINE_TYPES = ['LineString', 'MultiLineString'];
const POLYGON_TYPES = ['Polygon', 'MultiPolygon'];

export function liveStyles(id: string): LayerSpecification[] {
    return [{
        id: `${id}-polygon-fill`,
        type: 'fill',
        source: id,
        filter: ['match', ['geometry-type'], POLYGON_TYPES, true, false],
        paint: {
            'fill-color': ['get', '_color'],
            'fill-opacity': ['coalesce', ['get', '_fill_opacity'], 0.1],
        },
    }, {
        id: `${id}-line`,
        type: 'line',
        source: id,
        filter: ['match', ['geometry-type'], LINE_TYPES, true, false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-color': ['get', '_color'],
            'line-width': ['coalesce', ['get', '_width'], 2],
        },
    }, {
        id: `${id}-polygon-line`,
        type: 'line',
        source: id,
        filter: ['match', ['geometry-type'], POLYGON_TYPES, true, false],
        paint: {
            'line-color': ['get', '_color'],
            'line-width': ['coalesce', ['get', '_width'], 2],
        },
    }, {
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
        id: `${id}-icon-circle`,
        type: 'circle',
        source: id,
        filter: ['in', ['get', '_icon'], ['literal', ICON_KINDS]],
        paint: {
            'circle-radius': 11,
            'circle-color': ['get', '_color'],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
        },
    }, {
        id: `${id}-icon`,
        type: 'symbol',
        source: id,
        filter: ['in', ['get', '_icon'], ['literal', ICON_KINDS]],
        layout: {
            'icon-image': ['concat', 'live-', ['get', '_icon']],
            'icon-size': 0.6,
            'icon-allow-overlap': true,
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
    private updated: string | null = null;

    /** Adds ?since=<updated of the last full response>; the ISO '+00:00' must go out as %2B */
    private requestUrl(): string {
        if (!this.updated) return this.opts.url;
        const sep = this.opts.url.includes('?') ? '&' : '?';
        return `${this.opts.url}${sep}${new URLSearchParams({ since: this.updated }).toString()}`;
    }

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
            const fc = await this.opts.fetch(this.requestUrl());
            if (generation !== this.generation || !this.running) return;
            if (fc.unchanged) return;
            this.updated = fc.updated || null;
            this.opts.onData(fc);
        } catch (err) {
            if (generation !== this.generation) return;
            if (this.opts.onError) this.opts.onError(err);
            else console.error('Live layer refresh failed', this.opts.url, err);
        }
    }
}
