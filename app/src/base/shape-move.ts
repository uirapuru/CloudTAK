/**
 * Przesuwanie figury przytrzymaniem: po HOLD_MS bez ruchu (lewy przycisk myszy albo
 * jeden palec) na figurze, którą wolno edytować, figura jedzie za kursorem, a po
 * puszczeniu zapisuje się w nowym miejscu. Ruch o więcej niż MOVE_TOLERANCE_PX przed
 * upływem czasu oddaje gest zwykłemu przesuwaniu mapy. Escape przerywa bez zapisu.
 */

export const HOLD_MS = 1000;
export const MOVE_TOLERANCE_PX = 8;

const SOURCE = 'shape-move';
const FILL = 'shape-move-fill';
const LINE = 'shape-move-line';

export type MovableFeature = {
    id: string;
    type: 'Feature';
    properties: Record<string, unknown>;
    geometry: { type: string; coordinates: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

type MapEvent = {
    point: { x: number; y: number };
    lngLat: { lng: number; lat: number };
    originalEvent?: { touches?: ArrayLike<unknown>; button?: number; preventDefault?(): void };
    preventDefault?(): void;
};

type MoveMap = {
    on(type: string, fn: (e: MapEvent) => void): unknown;
    off(type: string, fn: (e: MapEvent) => void): unknown;
    dragPan: { enable(): void; disable(): void };
    getCanvas(): { style: { cursor: string } };
    getSource(id: string): { setData(data: unknown): void } | undefined;
    addSource(id: string, source: Record<string, unknown>): unknown;
    removeSource(id: string): unknown;
    getLayer(id: string): unknown;
    addLayer(layer: Record<string, unknown>): unknown;
    removeLayer(id: string): unknown;
};

export type ShapeMoverOptions = {
    /** Figura pod punktem, którą wolno przesunąć, albo null */
    pick(point: { x: number; y: number }): Promise<MovableFeature | null>;
    /** Zapis przesuniętej figury */
    commit(id: string, feature: MovableFeature): Promise<void>;
    /** Początek przesuwania (np. zamknięcie menu radialnego otwartego przytrzymaniem) */
    onStart?(): void;
    /** Czy przytrzymanie wolno w ogóle zacząć (np. tylko poza trybem rysowania) */
    enabled?(): boolean;
};

/** Przesunięcie wszystkich współrzędnych geometrii o dLng, dLat (stopnie). */
export function translateGeometry<G extends { type: string; coordinates: unknown }>(geometry: G, dLng: number, dLat: number): G {
    const shift = (c: unknown): unknown => {
        if (Array.isArray(c) && typeof c[0] === 'number') {
            const [lng, lat, ...rest] = c as number[];
            return [lng + dLng, lat + dLat, ...rest];
        }
        return Array.isArray(c) ? c.map(shift) : c;
    };
    return { ...geometry, coordinates: shift(geometry.coordinates) };
}

export default class ShapeMover {
    private map: MoveMap;
    private opts: ShapeMoverOptions;

    private timer: ReturnType<typeof setTimeout> | null = null;
    private down: { point: { x: number; y: number }; lngLat: { lng: number; lat: number } } | null = null;
    private picked: Promise<MovableFeature | null> | null = null;
    private moving: { feature: MovableFeature; moved: MovableFeature } | null = null;
    private swallowClick = false;
    private gesture = 0;

    private readonly onDown = (e: MapEvent) => this.handleDown(e);
    private readonly onMove = (e: MapEvent) => this.handleMove(e);
    private readonly onUp = () => { void this.handleUp(); };
    private readonly onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.cancel(); };

    constructor(map: MoveMap, opts: ShapeMoverOptions) {
        this.map = map;
        this.opts = opts;

        for (const type of ['mousedown', 'touchstart']) map.on(type, this.onDown);
        for (const type of ['mousemove', 'touchmove']) map.on(type, this.onMove);
        for (const type of ['mouseup', 'touchend', 'touchcancel']) map.on(type, this.onUp);
        document.addEventListener('keydown', this.onKey);
    }

    destroy(): void {
        this.cancel();
        for (const type of ['mousedown', 'touchstart']) this.map.off(type, this.onDown);
        for (const type of ['mousemove', 'touchmove']) this.map.off(type, this.onMove);
        for (const type of ['mouseup', 'touchend', 'touchcancel']) this.map.off(type, this.onUp);
        document.removeEventListener('keydown', this.onKey);
    }

    get active(): boolean {
        return this.moving !== null;
    }

    /** true raz, dla kliknięcia, które przeglądarka wysyła po upuszczeniu figury */
    consumeClick(): boolean {
        const swallow = this.swallowClick;
        this.swallowClick = false;
        return swallow;
    }

    private handleDown(e: MapEvent): void {
        this.clearPending();
        this.swallowClick = false;
        if (this.moving) return;
        if (this.opts.enabled && !this.opts.enabled()) return;
        const touches = e.originalEvent?.touches;
        if (touches && touches.length !== 1) return;
        if (e.originalEvent?.button !== undefined && e.originalEvent.button !== 0) return;

        const gesture = ++this.gesture;
        this.down = { point: { ...e.point }, lngLat: { ...e.lngLat } };
        this.picked = this.opts.pick(e.point).catch(() => null);
        this.timer = setTimeout(() => { void this.start(gesture); }, HOLD_MS);
    }

    private async start(gesture: number): Promise<void> {
        this.timer = null;
        const feature = await this.picked;
        if (gesture !== this.gesture || !this.down || !feature) return;

        this.moving = { feature, moved: structuredClone(feature) };
        this.map.dragPan.disable();
        this.map.getCanvas().style.cursor = 'move';
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(40);
        this.showPreview(feature);
        // Puszczenie poza mapą (np. nad panelem) też kończy przesuwanie
        document.addEventListener('mouseup', this.onUp);
        document.addEventListener('touchend', this.onUp);
        this.opts.onStart?.();
    }

    private handleMove(e: MapEvent): void {
        if (this.moving && this.down) {
            e.preventDefault?.();
            e.originalEvent?.preventDefault?.();
            const dLng = e.lngLat.lng - this.down.lngLat.lng;
            const dLat = e.lngLat.lat - this.down.lngLat.lat;
            this.moving.moved = {
                ...this.moving.feature,
                geometry: translateGeometry(this.moving.feature.geometry, dLng, dLat),
            };
            this.map.getSource(SOURCE)?.setData(this.moving.moved);
            return;
        }

        if (this.down && this.timer) {
            const dx = e.point.x - this.down.point.x;
            const dy = e.point.y - this.down.point.y;
            if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) this.clearPending();
        }
    }

    private async handleUp(): Promise<void> {
        const moving = this.moving;
        this.clearPending();
        if (!moving) return;

        this.swallowClick = true;
        this.finish();
        await this.opts.commit(moving.feature.id, moving.moved);
    }

    private cancel(): void {
        this.clearPending();
        if (this.moving) this.finish();
    }

    private clearPending(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.down = this.moving ? this.down : null;
        if (!this.moving) {
            this.picked = null;
            this.gesture++;
        }
    }

    private finish(): void {
        document.removeEventListener('mouseup', this.onUp);
        document.removeEventListener('touchend', this.onUp);
        this.moving = null;
        this.down = null;
        this.picked = null;
        this.gesture++;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
        this.hidePreview();
    }

    private showPreview(feature: MovableFeature): void {
        this.hidePreview();
        this.map.addSource(SOURCE, { type: 'geojson', data: feature });
        this.map.addLayer({ id: FILL, type: 'fill', source: SOURCE, paint: { 'fill-color': '#ffc107', 'fill-opacity': 0.25 } });
        this.map.addLayer({ id: LINE, type: 'line', source: SOURCE, paint: { 'line-color': '#ffc107', 'line-width': 2, 'line-dasharray': [2, 2] } });
    }

    private hidePreview(): void {
        for (const id of [LINE, FILL]) if (this.map.getLayer(id)) this.map.removeLayer(id);
        if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
    }
}
