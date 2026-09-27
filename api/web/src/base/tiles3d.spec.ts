import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tiles3DManager, formatAttribution, fixGlobalRegions, tilesFetch, GEOID_OFFSET_M, REFRESH_MS, AUTH_RETRY_GUARD_MS, type IonAccess } from './tiles3d.ts';

type Props = Record<string, unknown>;

function setup(opts: { layers?: string[]; access?: (name: string, call: number) => IonAccess } = {}) {
    const existing = new Set(opts.layers ?? []);
    const map = {
        addControl: vi.fn(),
        removeControl: vi.fn(),
        getLayer: (id: string) => existing.has(id) ? { id } : undefined,
    };

    const overlays: Array<{ props: Props; setProps: (p: Props) => void; finalize: () => void }> = [];
    class MapboxOverlay {
        props: Props;
        constructor(props: Props) { this.props = props; overlays.push(this); }
        setProps(p: Props) { this.props = { ...this.props, ...p }; }
        finalize() {}
    }
    class Tile3DLayer {
        props: Props;
        constructor(props: Props) { this.props = props; }
    }
    const Tiles3DLoader = { name: 'fake-loader' };
    class Matrix4 {
        translation: number[] = [];
        translate(v: number[]) { this.translation = v; return this; }
    }

    let calls = 0;
    const fetchAccess = vi.fn(async (name: string): Promise<IonAccess> => {
        calls++;
        return opts.access ? opts.access(name, calls) : {
            url: `https://tiles/${name}/${calls}/tileset.json`,
            accessToken: `token-${calls}`,
            attributions: [{ text: `${name} credit` }],
        };
    });

    let now = 0;
    const onChange = vi.fn();
    const manager = new Tiles3DManager({
        map,
        deck: { MapboxOverlay, Tile3DLayer, Tiles3DLoader, Matrix4 },
        fetchAccess,
        beforeId: () => 'cot-layer',
        center: () => ({ lng: 0, lat: 0 }),
        now: () => now,
        onChange,
    });

    const layers = () => (overlays[0]?.props.layers ?? []) as Array<{ props: Props }>;

    return { manager, map, overlays, layers, fetchAccess, onChange, existing, setNow: (n: number) => { now = n; } };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('Tiles3DManager', () => {
    it('adds one interleaved overlay and one layer per entry', async () => {
        const t = setup({ layers: ['cot-layer'] });
        await t.manager.add({ id: '7', name: 'osm-buildings', visible: true, opacity: 0.8 });

        expect(t.map.addControl).toHaveBeenCalledTimes(1);
        expect(t.overlays[0].props.interleaved).toBe(true);
        expect(t.layers()).toHaveLength(1);

        const props = t.layers()[0].props;
        expect(props.id).toBe('tiles3d-7-0');
        expect(props.data).toBe('https://tiles/osm-buildings/1/tileset.json');
        expect(props.visible).toBe(true);
        expect(props.opacity).toBe(0.8);
        expect(props.beforeId).toBe('cot-layer');
        const loadOptions = props.loadOptions as { fetch: unknown; tileset: { modelMatrix: { translation: number[] } } };
        expect(typeof loadOptions.fetch).toBe('function');
        // lng 0, lat 0: local up is +X in ECEF
        expect(loadOptions.tileset.modelMatrix.translation[0]).toBeCloseTo(-GEOID_OFFSET_M);
        expect(loadOptions.tileset.modelMatrix.translation[1]).toBeCloseTo(0);
        expect(loadOptions.tileset.modelMatrix.translation[2]).toBeCloseTo(0);
        expect(t.onChange).toHaveBeenCalled();
    });

    it('passes the access token to the tile fetch', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x', { status: 200 }));
        const t = setup();
        await t.manager.add({ id: '7', name: 'osm-buildings', visible: true, opacity: 1 });

        const { fetch } = t.layers()[0].props.loadOptions as { fetch: (url: string, init?: RequestInit) => Promise<Response> };
        await fetch('https://tiles/a.b3dm');

        expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer token-1');
        fetchSpy.mockRestore();
    });

    it('sends no Authorization header when access has no token', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x', { status: 200 }));
        const t = setup({ access: () => ({ url: 'https://google/root.json?key=k', attributions: [] }) });
        await t.manager.add({ id: '8', name: 'google-photorealistic', visible: true, opacity: 1 });

        const { fetch } = t.layers()[0].props.loadOptions as { fetch: (url: string, init?: RequestInit) => Promise<Response> };
        await fetch('https://google/child.glb');

        expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).has('Authorization')).toBe(false);
        fetchSpy.mockRestore();
    });

    it('resolves beforeId lazily and only to an existing layer', async () => {
        const t = setup();
        await t.manager.add({ id: '7', name: 'osm-buildings', visible: true, opacity: 1 });
        expect(t.layers()[0].props.beforeId).toBeUndefined();

        t.existing.add('cot-layer');
        t.manager.render();
        expect(t.layers()[0].props.beforeId).toBe('cot-layer');
    });

    it('updates visibility and opacity without refetching', async () => {
        const t = setup();
        await t.manager.add({ id: '7', name: 'osm-buildings', visible: true, opacity: 1 });

        t.manager.setVisible('7', false);
        t.manager.setOpacity('7', 0.3);

        expect(t.layers()[0].props.visible).toBe(false);
        expect(t.layers()[0].props.opacity).toBe(0.3);
        expect(t.fetchAccess).toHaveBeenCalledTimes(1);
    });

    it('removes a layer and its refresh timer', async () => {
        const t = setup();
        await t.manager.add({ id: '7', name: 'osm-buildings', visible: true, opacity: 1 });
        t.manager.remove('7');

        expect(t.layers()).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(REFRESH_MS);
        expect(t.fetchAccess).toHaveBeenCalledTimes(1);
    });

    it('refreshes after 50 minutes with a new layer id', async () => {
        const t = setup();
        await t.manager.add({ id: '7', name: 'osm-buildings', visible: true, opacity: 1 });

        await vi.advanceTimersByTimeAsync(REFRESH_MS);

        expect(t.fetchAccess).toHaveBeenCalledTimes(2);
        expect(t.layers()[0].props.id).toBe('tiles3d-7-1');
        expect(t.fetchAccess).toHaveBeenCalledTimes(2);
    });

    it('refreshes once on a 401 tile error', async () => {
        const t = setup();
        await t.manager.add({ id: '7', name: 'osm-buildings', visible: true, opacity: 1 });
        const onTileError = t.layers()[0].props.onTileError as (...args: unknown[]) => void;

        onTileError({}, 'https://tiles/x.b3dm', 'Failed to fetch: 401 Unauthorized');
        onTileError({}, 'https://tiles/y.b3dm', 'Failed to fetch: 401 Unauthorized');
        // Only flush the immediate (0ms) retry timer scheduled by onTileError: the
        // manager also holds the far-future 50-minute refresh timer at this point,
        // and runOnlyPendingTimersAsync() ticks the fake clock all the way to the
        // furthest pending timer, firing that one too.
        await vi.advanceTimersByTimeAsync(0);
        expect(t.fetchAccess).toHaveBeenCalledTimes(2);

        t.setNow(AUTH_RETRY_GUARD_MS);
        const next = t.layers()[0].props.onTileError as (...args: unknown[]) => void;
        next({}, 'https://tiles/z.b3dm', 'Failed to fetch: 401 Unauthorized');
        await vi.advanceTimersByTimeAsync(0);
        expect(t.fetchAccess).toHaveBeenCalledTimes(3);
    });

    it('ignores tile errors other than 401', async () => {
        const t = setup();
        await t.manager.add({ id: '7', name: 'osm-buildings', visible: true, opacity: 1 });
        const onTileError = t.layers()[0].props.onTileError as (...args: unknown[]) => void;

        onTileError({}, 'https://tiles/x.b3dm', 'Failed to fetch: 500 Internal Server Error');
        await vi.advanceTimersByTimeAsync(0);
        expect(t.fetchAccess).toHaveBeenCalledTimes(1);
    });

    it('does not resurrect a layer removed during refresh', async () => {
        let release: () => void = () => {};
        const t = setup({
            access: (name, call) => ({ url: `https://tiles/${name}/${call}`, attributions: [] }),
        });
        await t.manager.add({ id: '7', name: 'osm-buildings', visible: true, opacity: 1 });

        t.fetchAccess.mockImplementationOnce(() => new Promise((resolve) => {
            release = () => resolve({ url: 'https://tiles/late', attributions: [] });
        }));
        const pending = t.manager.refresh('7');
        t.manager.remove('7');
        release();
        await pending;

        expect(t.layers()).toHaveLength(0);
    });

    it('lists attributions of visible layers without duplicates', async () => {
        const t = setup({
            access: (name) => ({ url: `https://tiles/${name}`, attributions: [{ text: 'Shared' }, { text: name }] }),
        });
        await t.manager.add({ id: '1', name: 'a', visible: true, opacity: 1 });
        await t.manager.add({ id: '2', name: 'b', visible: false, opacity: 1 });

        expect(t.manager.attributions()).toEqual([{ text: 'Shared' }, { text: 'a' }]);
    });

    it('reports whether any 3D layer is visible', async () => {
        const t = setup();
        expect(t.manager.hasVisible()).toBe(false);

        await t.manager.add({ id: '7', name: 'osm-buildings', visible: false, opacity: 1 });
        expect(t.manager.hasVisible()).toBe(false);

        t.manager.setVisible('7', true);
        expect(t.manager.hasVisible()).toBe(true);
    });

    it('destroy removes the overlay and stops timers', async () => {
        const t = setup();
        await t.manager.add({ id: '7', name: 'osm-buildings', visible: true, opacity: 1 });
        t.manager.destroy();

        expect(t.map.removeControl).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(REFRESH_MS);
        expect(t.fetchAccess).toHaveBeenCalledTimes(1);
    });
});

describe('fixGlobalRegions', () => {
    it('replaces globe-wide regions with a sphere and keeps local ones', () => {
        const tileset = {
            root: {
                boundingVolume: { region: [-Math.PI, -1.47, Math.PI, 1.45, -394, 5967] },
                children: [
                    { boundingVolume: { region: [-Math.PI, -1.47, 0, 1.45, -165, 5915] } },
                    { boundingVolume: { region: [0.36, 0.91, 0.37, 0.92, 80, 300] } },
                ],
            },
        };

        fixGlobalRegions(tileset.root);

        expect(tileset.root.boundingVolume).toEqual({ sphere: [0, 0, 0, 6378137 + 5967] });
        expect(tileset.root.children[0].boundingVolume).toEqual({ sphere: [0, 0, 0, 6378137 + 5915] });
        expect(tileset.root.children[1].boundingVolume).toEqual({ region: [0.36, 0.91, 0.37, 0.92, 80, 300] });
    });
});

describe('tilesFetch', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('rewrites tileset JSON and keeps the response URL', async () => {
        const body = { root: { boundingVolume: { region: [-Math.PI, -1.4, Math.PI, 1.4, 0, 100] } } };
        const upstream = new Response(JSON.stringify(body), { status: 200 });
        Object.defineProperty(upstream, 'url', { value: 'https://assets/96188/tileset.json?v=1' });
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(upstream);

        const res = await tilesFetch({})('https://assets/96188/tileset.json?v=1');

        expect(res.url).toBe('https://assets/96188/tileset.json?v=1');
        expect((await res.json()).root.boundingVolume).toEqual({ sphere: [0, 0, 0, 6378137 + 100] });
    });

    it('passes binary tiles through untouched', async () => {
        const upstream = new Response('glb-bytes', { status: 200 });
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(upstream);

        const res = await tilesFetch({})('https://assets/96188/1/2/3.b3dm');

        expect(res).toBe(upstream);
    });

    it('passes failed responses through untouched', async () => {
        const upstream = new Response('nope', { status: 404 });
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(upstream);

        const res = await tilesFetch({})('https://assets/96188/tileset.json');

        expect(res).toBe(upstream);
    });
});

describe('formatAttribution', () => {
    it('escapes text', () => {
        expect(formatAttribution({ text: '<script>alert(1)</script> & "x"' }))
            .toBe('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;');
    });

    it('renders an image before the text', () => {
        expect(formatAttribution({ text: 'Google', image: 'https://assets.ion.cesium.com/g.png' }))
            .toBe('<img src="https://assets.ion.cesium.com/g.png" alt="" style="height:1em;vertical-align:middle"> Google');
    });

    it('escapes quotes in the image URL', () => {
        expect(formatAttribution({ text: '', image: 'https://a.cesium.com/x.png" onerror="alert(1)' }))
            .toBe('<img src="https://a.cesium.com/x.png&quot; onerror=&quot;alert(1)" alt="" style="height:1em;vertical-align:middle">');
    });
});
