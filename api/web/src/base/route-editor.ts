/**
 * Edytor trasy taklab na mapie MapLibre, na wzór planera mapa-turystyczna.pl.
 *
 * Rysuje linię trasy i wyłącznie punkty usera (A, 1, 2, …, B). Wierzchołki
 * routera nie mają uchwytów. Zasady (specyfikacja 2026-10-12-cloudtak-route-editing):
 * - przeciągnięcie punktu usera przelicza sąsiednie odcinki,
 * - przeciągnięcie odcinka wstawia w miejscu puszczenia nowy punkt pośredni
 *   (linia stoi w miejscu, całej trasy nie da się przesunąć),
 * - kliknięcie mapy: w trybie budowania dopisuje punkt na koniec,
 *   w trybie edycji wstawia go do najbliższego odcinka,
 * - kliknięcie przy linii stawia punkt na linii (na wierzchołku, gdy blisko),
 * - kliknięcie punktu usera otwiera menu z usunięciem.
 */
import type { Ref } from 'vue';
import { isEqual } from '@ver0/deep-equal';
import type { Feature } from '../types.ts';
import {
    readRoutePlan,
    nearestOnRoute,
    moveChange,
    insertChange,
    appendChange,
    removeChange,
    waypointLabel,
} from './route-plan.ts';
import type { LegChange, LngLat, RoutePlan, RouteLeg, RouteOptions } from './route-plan.ts';

export const EDITOR_SOURCE = 'taklab-route-edit';
const LAYER_LINE = 'taklab-route-edit-line';
const LAYER_POINTS = 'taklab-route-edit-points';
const LAYER_LABELS = 'taklab-route-edit-labels';

// Kliknięcie najdalej tyle pikseli od linii albo punktu trafia w linię albo punkt
export const HIT_TOLERANCE_PX = 12;
// Ruch krótszy niż tyle pikseli po wciśnięciu to kliknięcie, dłuższy to przeciąganie
export const DRAG_THRESHOLD_PX = 4;

const MAX_WAYPOINTS = 27;

type Point = { x: number; y: number };

type PointerEvent = {
    lngLat: { lng: number; lat: number };
    point: Point;
    preventDefault?: () => void;
};

/** Część API mapy MapLibre, z której korzysta edytor. */
export type EditorMap = {
    on(type: string, listener: (e: PointerEvent) => void): unknown;
    off(type: string, listener: (e: PointerEvent) => void): unknown;
    addSource(id: string, source: { type: 'geojson'; data: unknown }): unknown;
    getSource(id: string): unknown;
    addLayer(layer: Record<string, unknown>): unknown;
    getLayer(id: string): unknown;
    removeLayer(id: string): unknown;
    removeSource(id: string): unknown;
    project(lngLat: LngLat): Point;
    getCanvas(): { style: { cursor: string } };
    dragPan: { enable(): void; disable(): void };
};

export type RerouteBody = {
    travelMode: string;
    waypoints: LngLat[];
    coordinates: number[][];
    legs: RouteLeg[];
    first: number;
    count: number;
    added: -1 | 0 | 1;
    options?: RouteOptions;
};

/** POST /api/search/route/legs */
export type Reroute = (body: RerouteBody) => Promise<Feature>;
/** GET /api/search/route dla pierwszego odcinka w trybie budowania */
export type RouteFirstLeg = (travelMode: string, stops: LngLat[], options?: RouteOptions) => Promise<Feature>;

export type EditorState = {
    busy: Ref<boolean>;
    error: Ref<string>;
    waypoints: Ref<LngLat[]>;
    menu: Ref<null | { index: number; x: number; y: number }>;
    summary: Ref<string>;
};

type Press =
    | { kind: 'marker'; index: number; start: Point; dragging: boolean; position: LngLat }
    | { kind: 'line'; leg: number; position: LngLat; vertex: number; start: Point; dragging: boolean; ghost: LngLat | null }
    | { kind: 'map'; start: Point; moved: boolean };

export default class RouteEditor {
    private map: EditorMap;
    private mode: 'build' | 'edit';
    private travelMode: string;
    private routeOptions: RouteOptions | undefined;
    private reroute: Reroute;
    private first: RouteFirstLeg;
    private state: EditorState;

    // Obiekt edytowanej trasy (edycja) albo wynik pierwszego odcinka (budowanie)
    private feature: Feature | null;
    private plan: RoutePlan | null;
    private waypoints: LngLat[];
    private press: Press | null = null;

    private readonly onDown = (e: PointerEvent) => this.down(e);
    private readonly onMove = (e: PointerEvent) => this.move(e);
    private readonly onUp = (e: PointerEvent) => { void this.up(e); };

    constructor(map: EditorMap, opts: {
        mode: 'build' | 'edit';
        travelMode: string;
        options?: RouteOptions;
        feature?: Feature;
        waypoints?: LngLat[];
        reroute: Reroute;
        first: RouteFirstLeg;
        state: EditorState;
    }) {
        this.map = map;
        this.mode = opts.mode;
        this.travelMode = opts.travelMode;
        this.routeOptions = opts.options;
        this.reroute = opts.reroute;
        this.first = opts.first;
        this.state = opts.state;

        this.feature = opts.feature ? structuredClone(opts.feature) : null;
        this.plan = this.feature ? readRoutePlan(this.feature) : null;
        if (opts.mode === 'edit' && !this.plan) throw new Error('Route has no valid taklab route plan');

        this.waypoints = this.plan
            ? this.plan.waypoints.map((w) => [w[0], w[1]] as LngLat)
            : (opts.waypoints ?? []).map((w) => [w[0], w[1]] as LngLat);
        if (this.plan) {
            this.travelMode = this.plan.mode;
            this.routeOptions = this.plan.options;
        }
    }

    start(): void {
        this.map.addSource(EDITOR_SOURCE, { type: 'geojson', data: this.collection() });
        this.map.addLayer({
            id: LAYER_LINE,
            type: 'line',
            source: EDITOR_SOURCE,
            filter: ['==', ['geometry-type'], 'LineString'],
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#1E90FF', 'line-width': 5, 'line-opacity': 0.85 },
        });
        this.map.addLayer({
            id: LAYER_POINTS,
            type: 'circle',
            source: EDITOR_SOURCE,
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
                'circle-radius': ['case', ['==', ['get', 'role'], 'ghost'], 6, 10],
                'circle-color': ['match', ['get', 'role'], 'via', '#868E96', 'ghost', '#FFFFFF', '#F59F00'],
                'circle-stroke-color': ['match', ['get', 'role'], 'ghost', '#868E96', '#FFFFFF'],
                'circle-stroke-width': 2,
            },
        });
        this.map.addLayer({
            id: LAYER_LABELS,
            type: 'symbol',
            source: EDITOR_SOURCE,
            filter: ['==', ['geometry-type'], 'Point'],
            layout: {
                'text-field': ['get', 'label'],
                'text-font': ['Open Sans Bold'],
                'text-size': 12,
                'text-allow-overlap': true,
                'text-ignore-placement': true,
            },
            paint: { 'text-color': '#FFFFFF' },
        });

        for (const [type, fn] of this.listeners()) this.map.on(type, fn);
        this.publish();
    }

    destroy(): void {
        for (const [type, fn] of this.listeners()) this.map.off(type, fn);
        this.map.dragPan.enable();
        this.press = null;

        for (const layer of [LAYER_LABELS, LAYER_POINTS, LAYER_LINE]) {
            if (this.map.getLayer(layer)) this.map.removeLayer(layer);
        }
        if (this.map.getSource(EDITOR_SOURCE)) this.map.removeSource(EDITOR_SOURCE);
    }

    /** Trasa po edycji albo null, gdy trasy jeszcze nie ma (budowanie, mniej niż dwa punkty). */
    result(): Feature | null {
        return this.feature && this.plan ? structuredClone(this.feature) : null;
    }

    get travel(): string {
        return this.travelMode;
    }

    /**
     * Zmiana trybu trasy. Gotowa trasa jest liczona od nowa przez wszystkie punkty usera;
     * przy błędzie zostaje poprzedni tryb i trasa. Zwraca false, gdy trybu nie zmieniono.
     */
    async setTravelMode(travelMode: string): Promise<boolean> {
        if (travelMode === this.travelMode && !this.state.busy.value) return true;
        return await this.recompute(travelMode, this.routeOptions);
    }

    get options(): RouteOptions | undefined {
        return this.routeOptions;
    }

    /** Zmiana opcji przełaju; działa jak zmiana trybu (cała trasa od nowa, przy błędzie bez zmian). */
    async setOptions(options: RouteOptions | undefined): Promise<boolean> {
        if (isEqual(options ?? {}, this.routeOptions ?? {}) && !this.state.busy.value) return true;
        return await this.recompute(this.travelMode, options);
    }

    private async recompute(travelMode: string, options: RouteOptions | undefined): Promise<boolean> {
        if (this.state.busy.value) return false;

        if (!this.plan) {
            this.travelMode = travelMode;
            this.routeOptions = options;
            return true;
        }

        const stops = this.waypoints.map((w) => [w[0], w[1]] as LngLat);
        let changed = false;
        await this.run(async () => {
            this.accept(await this.first(travelMode, stops, options));
            this.travelMode = travelMode;
            this.routeOptions = options;
            changed = true;
        });
        return changed;
    }

    async removeWaypoint(index: number): Promise<void> {
        if (this.state.busy.value) return;
        this.state.menu.value = null;

        if (!this.plan) {
            // Budowanie przed policzeniem trasy: same punkty
            this.waypoints.splice(index, 1);
            this.render();
            this.publish();
            return;
        }

        const change = removeChange(this.plan, index);
        if (!change) {
            if (this.mode === 'build') {
                // Zostaje jeden punkt: trasy nie ma
                this.waypoints.splice(index, 1);
                this.feature = null;
                this.plan = null;
                this.render();
                this.publish();
                return;
            }
            this.state.error.value = 'Trasa musi mieć co najmniej dwa punkty.';
            return;
        }

        await this.apply(change);
    }

    private listeners(): Array<[string, (e: PointerEvent) => void]> {
        return [
            ['mousedown', this.onDown],
            ['touchstart', this.onDown],
            ['mousemove', this.onMove],
            ['touchmove', this.onMove],
            ['mouseup', this.onUp],
            ['touchend', this.onUp],
        ];
    }

    private down(e: PointerEvent): void {
        if (this.state.busy.value) return;

        const start = e.point;
        const marker = this.markerAt(start);
        if (marker !== null) {
            this.press = { kind: 'marker', index: marker, start, dragging: false, position: this.waypoints[marker] };
            this.holdMap(e);
            return;
        }

        const line = this.lineAt([e.lngLat.lng, e.lngLat.lat], start);
        if (line) {
            this.press = { kind: 'line', ...line, start, dragging: false, ghost: null };
            this.holdMap(e);
            return;
        }

        this.press = { kind: 'map', start, moved: false };
    }

    private move(e: PointerEvent): void {
        const press = this.press;
        if (!press) return;

        const moved = Math.hypot(e.point.x - press.start.x, e.point.y - press.start.y) >= DRAG_THRESHOLD_PX;

        if (press.kind === 'map') {
            if (moved) press.moved = true;
            return;
        }

        if (!press.dragging && !moved) return;
        press.dragging = true;

        const at: LngLat = [e.lngLat.lng, e.lngLat.lat];
        if (press.kind === 'marker') {
            press.position = at;
            this.render({ moving: { index: press.index, position: at } });
        } else {
            // Linia trasy stoi w miejscu; pod kursorem jedzie podgląd nowego punktu
            press.ghost = at;
            this.render({ ghost: at });
        }
    }

    private async up(e: PointerEvent): Promise<void> {
        const press = this.press;
        this.press = null;
        this.map.dragPan.enable();
        if (!press || this.state.busy.value) return;

        const at: LngLat = [e.lngLat.lng, e.lngLat.lat];
        const moved = Math.hypot(e.point.x - press.start.x, e.point.y - press.start.y) >= DRAG_THRESHOLD_PX;

        if (press.kind === 'marker') {
            if (press.dragging || moved) {
                await this.moveWaypoint(press.index, at);
            } else {
                this.state.menu.value = { index: press.index, x: e.point.x, y: e.point.y };
            }
            return;
        }

        this.state.menu.value = null;

        if (press.kind === 'line') {
            if (press.dragging || moved) {
                // Przeciągnięty odcinek: nowy punkt pośredni między jego końcami
                if (this.plan) await this.apply(insertChange(this.plan, press.leg, at));
                return;
            }
            await this.addPoint(press.position, press.leg);
            return;
        }

        if (press.moved || moved) return; // przesuwanie mapy
        await this.addPoint(at, null);
    }

    /** Kliknięcie mapy albo linii: budowanie dopisuje na koniec, edycja wstawia w najbliższy odcinek. */
    private async addPoint(position: LngLat, leg: number | null): Promise<void> {
        if (this.waypoints.length >= MAX_WAYPOINTS) {
            this.state.error.value = 'Najwyżej 25 punktów pośrednich.';
            return;
        }

        if (this.mode === 'build') {
            if (!this.plan) {
                this.waypoints.push(position);
                this.render();
                this.publish();
                if (this.waypoints.length === 2) await this.firstLeg();
                return;
            }
            await this.apply(appendChange(this.plan, position));
            return;
        }

        if (!this.plan || !this.feature) return;
        const target = leg ?? nearestOnRoute(this.plan, this.coordinates(), position).leg;
        await this.apply(insertChange(this.plan, target, position));
    }

    private async moveWaypoint(index: number, position: LngLat): Promise<void> {
        if (!this.plan) {
            // Budowanie z jednym punktem: tylko przesunięcie markera
            this.waypoints[index] = position;
            this.render();
            this.publish();
            return;
        }
        await this.apply(moveChange(this.plan, index, position));
    }

    private async firstLeg(): Promise<void> {
        const stops = this.waypoints.map((w) => [w[0], w[1]] as LngLat);
        await this.run(async () => {
            const feature = await this.first(this.travelMode, stops, this.routeOptions);
            this.accept(feature);
        });
    }

    private async apply(change: LegChange): Promise<void> {
        if (!this.plan) return;
        const plan = this.plan;
        const body: RerouteBody = {
            travelMode: this.travelMode,
            waypoints: change.waypoints,
            coordinates: this.coordinates(),
            legs: plan.legs,
            first: change.first,
            count: change.count,
            added: change.added,
            options: this.routeOptions,
        };

        // Podgląd zmiany punktów do czasu odpowiedzi
        this.waypoints = change.waypoints.map((w) => [w[0], w[1]] as LngLat);
        this.render();

        await this.run(async () => {
            this.accept(await this.reroute(body));
        }, () => {
            this.waypoints = plan.waypoints.map((w) => [w[0], w[1]] as LngLat);
        });
    }

    private async run(job: () => Promise<void>, rollback?: () => void): Promise<void> {
        this.state.busy.value = true;
        this.state.error.value = '';
        try {
            await job();
        } catch (err) {
            if (rollback) rollback();
            this.state.error.value = err instanceof Error ? err.message : String(err);
        } finally {
            this.state.busy.value = false;
            this.render();
            this.publish();
        }
    }

    /** Przyjmuje trasę z API: geometria, opis i plan; id, nazwa i reszta właściwości zostają. */
    private accept(fresh: Feature): void {
        const plan = readRoutePlan(fresh);
        if (!plan) throw new Error('Usługa tras zwróciła trasę bez planu.');

        if (this.feature) {
            this.feature = {
                ...this.feature,
                geometry: structuredClone(fresh.geometry),
                properties: {
                    ...this.feature.properties,
                    remarks: fresh.properties.remarks,
                    metadata: { ...(this.feature.properties.metadata ?? {}), taklab_route: plan },
                },
            } as Feature;
        } else {
            this.feature = structuredClone(fresh);
        }

        this.plan = plan;
        this.waypoints = plan.waypoints.map((w) => [w[0], w[1]] as LngLat);
    }

    private coordinates(): number[][] {
        const geometry = this.feature?.geometry as { coordinates?: number[][] } | undefined;
        return (geometry?.coordinates ?? []).map((c) => [c[0], c[1]]);
    }

    private holdMap(e: PointerEvent): void {
        this.map.dragPan.disable();
        if (e.preventDefault) e.preventDefault();
    }

    private markerAt(at: Point): number | null {
        let best: { index: number; distance: number } | null = null;
        this.waypoints.forEach((w, index) => {
            const p = this.map.project(w);
            const distance = Math.hypot(p.x - at.x, p.y - at.y);
            if (distance <= HIT_TOLERANCE_PX && (!best || distance < best.distance)) best = { index, distance };
        });
        return best ? (best as { index: number }).index : null;
    }

    private lineAt(lngLat: LngLat, at: Point): { leg: number; position: LngLat; vertex: number } | null {
        if (!this.plan) return null;
        const coordinates = this.coordinates();
        const hit = nearestOnRoute(this.plan, coordinates, lngLat);

        const projected = this.map.project(hit.position);
        if (Math.hypot(projected.x - at.x, projected.y - at.y) > HIT_TOLERANCE_PX) return null;

        const vertex = coordinates[hit.vertex];
        const vp = this.map.project([vertex[0], vertex[1]]);
        const onVertex = Math.hypot(vp.x - at.x, vp.y - at.y) <= HIT_TOLERANCE_PX;

        return {
            leg: hit.leg,
            vertex: hit.vertex,
            position: onVertex ? [vertex[0], vertex[1]] : hit.position,
        };
    }

    private collection(preview: { moving?: { index: number; position: LngLat }; ghost?: LngLat } = {}) {
        const features: Array<Record<string, unknown>> = [];
        const coordinates = this.coordinates();
        if (this.plan && coordinates.length >= 2) {
            features.push({ type: 'Feature', properties: { role: 'line' }, geometry: { type: 'LineString', coordinates } });
        }

        this.waypoints.forEach((w, index) => {
            const position = preview.moving && preview.moving.index === index ? preview.moving.position : w;
            const count = this.waypoints.length;
            const role = index === 0 ? 'start' : (index === count - 1 ? 'end' : 'via');
            features.push({
                type: 'Feature',
                properties: { role, index, label: waypointLabel(index, count) },
                geometry: { type: 'Point', coordinates: [position[0], position[1]] },
            });
        });

        if (preview.ghost) {
            features.push({ type: 'Feature', properties: { role: 'ghost', label: '+' }, geometry: { type: 'Point', coordinates: preview.ghost } });
        }

        return { type: 'FeatureCollection', features };
    }

    private render(preview: { moving?: { index: number; position: LngLat }; ghost?: LngLat } = {}): void {
        const source = this.map.getSource(EDITOR_SOURCE) as { setData(data: unknown): void } | undefined;
        if (source) source.setData(this.collection(preview));
    }

    private publish(): void {
        this.state.waypoints.value = this.waypoints.map((w) => [w[0], w[1]] as LngLat);

        if (!this.plan) {
            this.state.summary.value = `Punkty: ${this.waypoints.length}`;
            return;
        }

        const distance = this.plan.legs.reduce((sum, leg) => sum + leg.distance_m, 0);
        const duration = this.plan.legs.reduce((sum, leg) => sum + leg.duration_s, 0);
        this.state.summary.value = `Punkty: ${this.waypoints.length} · ${formatDistance(distance)} · ${formatDuration(duration)}`;
    }
}

function formatDistance(meters: number): string {
    if (meters >= 1000) return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
    return `${Math.round(meters)} m`;
}

function formatDuration(seconds: number): string {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
