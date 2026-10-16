import { fetch } from '@tak-ps/node-safeurl';
import Err from '@openaddresses/batch-error';
import { randomUUID } from 'node:crypto';
import { Static } from '@sinclair/typebox';
import { Feature, CoTParser } from '@tak-ps/node-cot';
import Config from '../../../common/config.js';
import { RouteInterface } from '../interface-route.js';
import { RouteConfig } from './types.js';

// Logika tras (GraphHopper, przełaj, plan, analiza) działa w usłudze taklab-nav-planner.
// Ten moduł to cienki klient HTTP oraz typy i limity współdzielone z endpointami i frontem.

/** Odcinek trasy między dwoma kolejnymi punktami usera; start i end to indeksy wierzchołków linii (włącznie). */
export type RouteLeg = {
    start: number;
    end: number;
    distance_m: number;
    duration_s: number;
    ascent_m?: number;
    descent_m?: number;
    offpath_ratio?: number;
    steps?: string[];
};

/** Opcje trasy na przełaj wybrane przez usera; brak pola = zachowanie domyślne usługi terenu. */
export type RouteOptions = {
    avoid_wetland?: boolean;
    avoid_streams?: boolean;
    max_slope_deg?: number;
    exposure?: Exposure;
    avoid_observation?: boolean;
    /** Wszystkie tryby: nie omijaj stref niebezpiecznych z mapy (domyślnie omijane). Do usługi terenu nie idzie. */
    ignore_danger_zones?: boolean;
};

/** Wejście warianty trasy: stan trasy z planu plus liczba propozycji (1–2, domyślnie 2). */
export type VariantsInput = {
    travelMode: string;
    waypoints: Array<[number, number]>;
    coordinates: number[][];
    options?: RouteOptions;
    threats?: RouteThreats;
    count?: number;
};

/** Zagrożenia narysowane na mapie: posterunki przeciwnika i tereny zamknięte (wielokąty lon/lat). */
export type RouteThreats = {
    observers?: Array<[number, number]>;
    closed_areas?: Array<Array<[number, number]>>;
};

export const MAX_THREATS = 50;

/** Ekspozycja na przełaju: 'allow' = bez kary za teren odsłonięty (domyślnie). */
export type Exposure = 'allow' | 'medium' | 'avoid';
export const EXPOSURES: Exposure[] = ['allow', 'medium', 'avoid'];

type Span = { from_m: number; to_m: number };

/** Analiza terenu wzdłuż trasy z usługi terenu (POST /analyze), układ OCOKA. */
export type RouteAnalysis = {
    length_m: number;
    elevation_min_m: number;
    elevation_max_m: number;
    ascent_m: number;
    descent_m: number;
    land: Record<string, number>;
    cover: { concealed: number; exposed: number; unknown: number };
    slope: { max_deg: number; buckets: Record<string, number> };
    obstacles: Array<Span & { kind: 'stream' | 'wetland' | 'water_near' | 'steep' }>;
    danger: Array<Span & { kind: 'open' | 'road_crossing' | 'built_up' | 'skyline' }>;
    key_terrain: Array<
        | (Span & { kind: 'crossing' })
        | {
            kind: 'height';
            lon: number;
            lat: number;
            elevation_m: number;
            above_route_m: number;
            nearest_m: number;
            distance_m: number;
            bearing_deg: number;
            visible_ratio: number;
            visible: Span[];
        }
    >;
    // Część trasy widoczna z choć jednego wzgórza
    observed_ratio?: number;
};

/** Plan trasy: punkty usera i granice odcinków, zapisywany w properties.metadata.taklab_route. */
export type RoutePlan = {
    version: 1;
    mode: string;
    mode_name: string;
    waypoints: Array<[number, number]>;
    legs: RouteLeg[];
    options?: RouteOptions;
    // Liczby użytych obiektów z mapy
    threats?: { observers: number; closed_areas: number };
    analysis?: RouteAnalysis;
    // Analizy nie udało się policzyć (usługa terenu jest, ale odpowiedziała błędem)
    analysis_failed?: boolean;
};

export type RerouteInput = {
    travelMode: string;
    waypoints: Array<[number, number]>;
    coordinates: number[][];
    legs: RouteLeg[];
    first: number;
    count: number;
    added: -1 | 0 | 1;
    options?: RouteOptions;
    threats?: RouteThreats;
};

// Górna granica liczby wierzchołków trasy: ATAK robi z każdego punkt kontrolny
export const MAX_ROUTE_POINTS = 1000;

// Najwięcej punktów pośrednich na trasę (bez startu i celu)
export const MAX_VIA_POINTS = 25;

// Granice limitu nachylenia; 35° to limit usługi terenu bez opcji
export const MIN_SLOPE_DEG = 5;
export const MAX_SLOPE_DEG = 35;

/** Odpowiedź planera bywa dowolna (HTML z bramki, błąd bez schematu), więc czytamy ją bez zakładania kształtu. */
async function readJson(res: { text(): Promise<string> }): Promise<unknown> {
    try {
        return JSON.parse(await res.text());
    } catch {
        return undefined;
    }
}

function field(body: unknown, key: string): unknown {
    return body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined;
}

export const DEFAULT_TIMEOUTS = { planner: 90000, modes: 3000 };

export default class TaklabRoute implements RouteInterface {
    _id = 'taklab';
    _name = 'taklab';
    _config: Config;
    planner: string;
    timeouts: { planner: number; modes: number };

    constructor(config: Config, planner: string, timeouts = DEFAULT_TIMEOUTS) {
        this._config = config;
        this.planner = planner.replace(/\/+$/, '');
        this.timeouts = timeouts;
    }

    static async init(config: Config): Promise<TaklabRoute | null> {
        const settings = await config.models.Setting.typedMany({
            'taklab::routing::enabled': false,
            'taklab::routing::planner_url': '',
        });

        if (!settings['taklab::routing::enabled'] || !settings['taklab::routing::planner_url']) return null;

        return new TaklabRoute(config, settings['taklab::routing::planner_url']);
    }

    async config(): Promise<Static<typeof RouteConfig>> {
        try {
            const res = await fetch(new URL(this.planner + '/modes'), {
                method: 'GET',
                safeUrlAllow: [this.planner],
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(this.timeouts.modes),
            });
            const body = await readJson(res);
            if (res.ok && body && typeof body === 'object' && Array.isArray((body as { modes?: unknown }).modes)) {
                return body as Static<typeof RouteConfig>;
            }
        } catch {
            // planer chwilowo niedostępny: brak trybów zamiast błędu menedżera
        }

        return { id: this._id, name: this._name, modes: [] };
    }

    async route(
        stops: Array<[number, number]>,
        travelMode?: string,
        options?: RouteOptions,
        threats?: RouteThreats,
    ): Promise<Static<typeof Feature.FeatureCollection>> {
        // Planer wymaga trybu; dawny kod bez trybu jechał samochodem. Brak opcji i zagrożeń: klucz pomijany (JSON.stringify), nigdy null.
        return await this.call('/plan', { waypoints: stops, travelMode: travelMode ?? 'car', options, threats });
    }

    async reroute(input: RerouteInput): Promise<Static<typeof Feature.FeatureCollection>> {
        return await this.call('/legs', input);
    }

    async variants(input: VariantsInput): Promise<Static<typeof Feature.FeatureCollection>> {
        return await this.call('/variants', input);
    }

    private async call(path: string, body: unknown): Promise<Static<typeof Feature.FeatureCollection>> {
        let res;
        try {
            res = await fetch(new URL(this.planner + path), {
                method: 'POST',
                safeUrlAllow: [this.planner],
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(this.timeouts.planner),
            });
        } catch (err) {
            throw new Err(400, err instanceof Error ? err : null, 'Usługa planowania tras nie odpowiada.');
        }

        const reply = await readJson(res);

        if (!res.ok) {
            const message = field(reply, 'message');
            throw new Err(400, null, typeof message === 'string' && message ? message : 'Nie udało się wyznaczyć trasy.');
        }

        const features = field(reply, 'features');
        if (!Array.isArray(features)) throw new Err(400, null, 'Nie udało się wyznaczyć trasy.');

        const out: Static<typeof Feature.FeatureCollection>['features'] = [];
        for (const f of features as Array<{ geometry: { type: 'LineString'; coordinates: number[][] }; properties: Record<string, unknown> }>) {
            const norm = await CoTParser.normalize_geojson({ id: String(randomUUID()), type: 'Feature', properties: {}, geometry: f.geometry });
            Object.assign(norm.properties, f.properties);
            out.push(norm);
        }

        return { type: 'FeatureCollection', features: out };
    }
}
