/**
 * Cesium ion 3D Tiles overlays rendered by deck.gl inside MapLibre.
 *
 * deck.gl and loaders.gl are loaded only by getTiles3D(), so users without
 * a 3D overlay never download them. Everything above getTiles3D() takes its
 * dependencies as arguments to stay testable without WebGL.
 */

export interface IonAttribution {
    text: string;
    image?: string;
}

export interface IonAccess {
    url: string;
    accessToken?: string;
    attributions: IonAttribution[];
}

export interface Tiles3DEntry {
    id: string;
    name: string;
    visible: boolean;
    opacity: number;
}

interface MapLike {
    addControl(control: unknown): unknown;
    removeControl(control: unknown): unknown;
    getLayer(id: string): unknown;
}

interface DeckOverlayLike {
    setProps(props: Record<string, unknown>): void;
    finalize(): void;
}

export interface DeckModules {
    MapboxOverlay: new (props: Record<string, unknown>) => DeckOverlayLike;
    Tile3DLayer: new (props: Record<string, unknown>) => unknown;
    Tiles3DLoader: unknown;
    Matrix4: new () => { translate(v: number[]): unknown };
}

export interface TilesetNode {
    boundingVolume?: { region?: number[]; sphere?: number[]; box?: number[] };
    children?: TilesetNode[];
}

interface State {
    entry: Tiles3DEntry;
    access: IonAccess;
    generation: number;
    timer: ReturnType<typeof setTimeout>;
    lastAuthRefresh: number | null;
}

export const REFRESH_MS = 50 * 60 * 1000;
export const AUTH_RETRY_GUARD_MS = 60 * 1000;

// Geoid height above the WGS84 ellipsoid over Poland (28-42 m). ion tiles sit at
// ellipsoidal heights, MapLibre terrain at orthometric ones.
export const GEOID_OFFSET_M = 34;

const EARTH_RADIUS_M = 6378137;

/**
 * loaders.gl turns a globe-wide `region` into a degenerate oriented box, so
 * tilesets such as Cesium OSM Buildings never select a tile. Swap those
 * volumes for a sphere around the Earth.
 */
export function fixGlobalRegions(node: TilesetNode): void {
    const region = node.boundingVolume?.region;
    if (region && (region[2] - region[0] > Math.PI / 2 || region[3] - region[1] > Math.PI / 2)) {
        node.boundingVolume = { sphere: [0, 0, 0, EARTH_RADIUS_M + Math.max(0, region[5])] };
    }

    for (const child of node.children ?? []) fixGlobalRegions(child);
}

/**
 * Fetch used by loaders.gl for every tileset request: adds ion auth headers
 * and repairs globe-wide bounding volumes in tileset JSON.
 */
export function tilesFetch(headers: Record<string, string>): (url: string, init?: RequestInit) => Promise<Response> {
    return async (url, init = {}) => {
        const merged = new Headers(init.headers);
        for (const [k, v] of Object.entries(headers)) merged.set(k, v);

        const res = await fetch(url, { ...init, headers: merged });
        if (!res.ok || !/\.json(\?|$)/.test(url)) return res;

        const json = await res.json() as { root?: TilesetNode };
        if (json.root) fixGlobalRegions(json.root);

        const fixed = new Response(JSON.stringify(json), { status: res.status, headers: { 'Content-Type': 'application/json' } });
        // loaders.gl resolves relative child URIs against response.url
        Object.defineProperty(fixed, 'url', { value: res.url || url });
        return fixed;
    };
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function formatAttribution(a: IonAttribution): string {
    const img = a.image
        ? `<img src="${escapeHtml(a.image)}" alt="" style="height:1em;vertical-align:middle">`
        : '';
    return [img, escapeHtml(a.text)].filter(Boolean).join(' ');
}

export class Tiles3DManager {
    readonly map: MapLike;
    private deck: DeckModules;
    private fetchAccess: (name: string) => Promise<IonAccess>;
    private beforeId: () => string | undefined;
    private center: () => { lng: number; lat: number };
    private now: () => number;
    private onChange: () => void;
    private overlay: DeckOverlayLike | null = null;
    private states = new Map<string, State>();

    constructor(deps: {
        map: MapLike;
        deck: DeckModules;
        fetchAccess: (name: string) => Promise<IonAccess>;
        beforeId: () => string | undefined;
        center: () => { lng: number; lat: number };
        now?: () => number;
        onChange?: () => void;
    }) {
        this.map = deps.map;
        this.deck = deps.deck;
        this.fetchAccess = deps.fetchAccess;
        this.beforeId = deps.beforeId;
        this.center = deps.center;
        this.now = deps.now ?? Date.now;
        this.onChange = deps.onChange ?? (() => {});
    }

    async add(entry: Tiles3DEntry): Promise<void> {
        const access = await this.fetchAccess(entry.name);

        this.remove(entry.id);
        this.states.set(entry.id, {
            entry: { ...entry },
            access,
            generation: 0,
            timer: this.schedule(entry.id),
            lastAuthRefresh: null,
        });

        this.render();
    }

    remove(id: string): void {
        const state = this.states.get(id);
        if (!state) return;

        clearTimeout(state.timer);
        this.states.delete(id);
        this.render();
    }

    setVisible(id: string, visible: boolean): void {
        const state = this.states.get(id);
        if (!state) return;
        state.entry.visible = visible;
        this.render();
    }

    setOpacity(id: string, opacity: number): void {
        const state = this.states.get(id);
        if (!state) return;
        state.entry.opacity = opacity;
        this.render();
    }

    async refresh(id: string): Promise<void> {
        const before = this.states.get(id);
        if (!before) return;

        const access = await this.fetchAccess(before.entry.name);

        // The overlay may have been removed or re-added while we waited
        const state = this.states.get(id);
        if (state !== before) return;

        clearTimeout(state.timer);
        state.access = access;
        state.generation++;
        state.timer = this.schedule(id);
        this.render();
    }

    hasVisible(): boolean {
        for (const state of this.states.values()) {
            if (state.entry.visible) return true;
        }
        return false;
    }

    attributions(): IonAttribution[] {
        const seen = new Set<string>();
        const out: IonAttribution[] = [];

        for (const state of this.states.values()) {
            if (!state.entry.visible) continue;
            for (const a of state.access.attributions) {
                const key = `${a.text}\u0000${a.image ?? ''}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(a);
            }
        }

        return out;
    }

    render(): void {
        if (!this.overlay) {
            if (!this.states.size) return;
            this.overlay = new this.deck.MapboxOverlay({ interleaved: true, layers: [] });
            this.map.addControl(this.overlay);
        }

        const candidate = this.beforeId();
        const beforeId = candidate && this.map.getLayer(candidate) ? candidate : undefined;

        this.overlay.setProps({
            layers: Array.from(this.states.values()).map((state) => this.layer(state, beforeId)),
        });

        this.onChange();
    }

    destroy(): void {
        for (const state of this.states.values()) clearTimeout(state.timer);
        this.states.clear();

        if (this.overlay) {
            this.map.removeControl(this.overlay);
            this.overlay.finalize();
            this.overlay = null;
        }
    }

    private layer(state: State, beforeId: string | undefined): unknown {
        const id = state.entry.id;

        return new this.deck.Tile3DLayer({
            id: `tiles3d-${id}-${state.generation}`,
            data: state.access.url,
            loader: this.deck.Tiles3DLoader,
            visible: state.entry.visible,
            opacity: state.entry.opacity,
            beforeId,
            loadOptions: {
                fetch: tilesFetch(state.access.accessToken ? { Authorization: `Bearer ${state.access.accessToken}` } : {}),
                tileset: { modelMatrix: this.verticalShift() },
            },
            onTileError: (...args: unknown[]) => this.onTileError(id, args),
        });
    }

    // Lower the tileset by the geoid height along the local up vector at the map center
    private verticalShift(): unknown {
        const { lng, lat } = this.center();
        const lon = lng * Math.PI / 180;
        const phi = lat * Math.PI / 180;
        const up = [Math.cos(phi) * Math.cos(lon), Math.cos(phi) * Math.sin(lon), Math.sin(phi)];
        return new this.deck.Matrix4().translate(up.map((u) => -u * GEOID_OFFSET_M));
    }

    private schedule(id: string): ReturnType<typeof setTimeout> {
        return setTimeout(() => {
            this.refresh(id).catch((err) => console.error(`Failed to refresh 3D Tiles access for overlay ${id}`, err));
        }, REFRESH_MS);
    }

    private onTileError(id: string, args: unknown[]): void {
        const message = args.map((a) => a instanceof Error ? a.message : String(a)).join(' ');
        if (!/\b401\b/.test(message)) return;

        const state = this.states.get(id);
        if (!state) return;

        const now = this.now();
        if (state.lastAuthRefresh !== null && now - state.lastAuthRefresh < AUTH_RETRY_GUARD_MS) return;
        state.lastAuthRefresh = now;

        setTimeout(() => {
            this.refresh(id).catch((err) => console.error(`Failed to refresh 3D Tiles access for overlay ${id}`, err));
        }, 0);
    }
}

let manager: Tiles3DManager | null = null;
let pending: Promise<Tiles3DManager> | null = null;

export function peekTiles3D(): Tiles3DManager | null {
    return manager;
}

export async function getTiles3D(): Promise<Tiles3DManager> {
    if (pending) return await pending;

    pending = (async () => {
        const [{ MapboxOverlay }, { Tile3DLayer }, { Tiles3DLoader }, { Matrix4 }, { useMapStore }, { std }, { default: OverlayManager }] = await Promise.all([
            import('@deck.gl/mapbox'),
            import('@deck.gl/geo-layers'),
            import('@loaders.gl/3d-tiles'),
            import('@math.gl/core'),
            import('../stores/map.ts'),
            import('../std.ts'),
            import('./overlay.ts'),
        ]);

        const mapStore = useMapStore();

        // The map store can replace its MapLibre instance; never draw into a stale one
        if (manager && manager.map === (mapStore.map as unknown)) return manager;
        if (manager) manager.destroy();

        manager = new Tiles3DManager({
            map: mapStore.map as unknown as MapLike,
            deck: {
                MapboxOverlay: MapboxOverlay as unknown as DeckModules['MapboxOverlay'],
                Tile3DLayer: Tile3DLayer as unknown as DeckModules['Tile3DLayer'],
                Tiles3DLoader,
                Matrix4,
            },
            fetchAccess: async (name) => await std(`/api/ion/${encodeURIComponent(name)}/endpoint`) as IonAccess,
            beforeId: () => {
                const cot = OverlayManager.loadedFrom(-1);
                return cot && cot.styles.length ? String(cot.styles[0].id) : undefined;
            },
            center: () => mapStore.map.getCenter(),
            onChange: () => {
                mapStore.updateAttribution().catch((err: unknown) => console.error('Failed to update attribution', err));
            },
        });

        return manager;
    })();

    try {
        return await pending;
    } finally {
        // A failed chunk load must not block later attempts
        pending = null;
    }
}
