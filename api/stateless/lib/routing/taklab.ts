import { fetch } from '@tak-ps/node-safeurl';
import Err from '@openaddresses/batch-error';
import { randomUUID } from 'node:crypto';
import { Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { Feature, CoTParser } from '@tak-ps/node-cot';
import Config from '../../../common/config.js';
import { RouteInterface } from '../interface-route.js';
import { RouteConfig } from './types.js';

type Mode = {
    id: string;
    name: string;
    profile?: 'car' | 'offroad' | 'foot' | 'hike';
    avoidMotorway?: boolean;
    terrain?: boolean;
    // Tryb widoczny tylko wtedy, gdy GraphHopper ma ten profil (GET /info)
    optionalProfile?: boolean;
};

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

type LegStats = Omit<RouteLeg, 'start' | 'end'>;
type LegSlice = { coordinates: number[][]; leg: LegStats };

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

const TERRAIN_MODE = 'foot_cross_country';

// Granice limitu nachylenia; 35° to limit usługi terenu bez opcji
export const MIN_SLOPE_DEG = 5;
export const MAX_SLOPE_DEG = 35;

const TERRAIN_NOTE = 'Trasa z OSM i DTED2 (siatka 30 m). Płotów, nieoznaczonych mokradeł i drobnych uskoków model nie widzi. Sprawdź trasę na mapie przed wyjściem.';

// Jak długo pamiętamy listę profili GraphHoppera
const PROFILES_TTL_MS = 60000;

// Domyślny tryb schematu zapytania /search/route w upstreamie (nazwa trybu AGOL)
const AGOL_DEFAULT_MODE = 'Driving Time';

export const DEFAULT_TIMEOUTS = { graphhopper: 30000, terrain: 60000, info: 3000, analyze: 15000 };

// Najwięcej pozycji w jednej linii analizy; resztę zastępuje „i N inne”
const ANALYSIS_ITEMS = 6;

const LAND_NAMES: Record<string, string> = {
    path: 'drogi i ścieżki',
    open: 'teren otwarty',
    forest: 'las',
    scrub: 'zarośla',
    built_up: 'zabudowa',
    wetland: 'bagna',
    stream: 'cieki',
    water: 'woda',
};

const OBSTACLE_NAMES: Record<string, string> = {
    stream: 'ciek',
    wetland: 'bagno',
    water_near: 'woda przy trasie',
    steep: 'stromo (ponad 25°)',
};

const DANGER_NAMES: Record<string, string> = {
    open: 'teren otwarty',
    road_crossing: 'przejście przez drogę',
    built_up: 'zabudowa',
    skyline: 'grzbiet, sylwetka na tle nieba',
};

// Miejsca, nie odcinki: podajemy kilometr początku
const POINT_KINDS = new Set(['stream', 'road_crossing', 'crossing']);

const COMPASS = ['płn.', 'płn.-wsch.', 'wsch.', 'płd.-wsch.', 'płd.', 'płd.-zach.', 'zach.', 'płn.-zach.'];

const ANALYSIS_NOTE = 'Założenia: osłona i przeszkody z OSM, wysokości z DTED2 (kratka 30 m), korony drzew przyjęte jako 15 m, obserwacja do 3 km. Model nie zna gęstości lasu, płotów, drobnych uskoków ani dróg podejścia przeciwnika.';

export const MODES: Mode[] = [
    { id: 'car', name: 'Samochód', profile: 'car' },
    { id: 'car_no_motorway', name: 'Samochód bez autostrad', profile: 'car', avoidMotorway: true },
    { id: 'offroad', name: 'Drogi gruntowe', profile: 'offroad' },
    { id: 'foot', name: 'Pieszo', profile: 'foot' },
    { id: 'hike', name: 'Szlaki', profile: 'hike', optionalProfile: true },
    { id: TERRAIN_MODE, name: 'Pieszo na przełaj', terrain: true },
];

const GraphHopperPath = Type.Object({
    distance: Type.Number(),
    time: Type.Number(),
    ascend: Type.Optional(Type.Number()),
    descend: Type.Optional(Type.Number()),
    points: Type.Object({
        type: Type.Literal('LineString'),
        coordinates: Type.Array(Type.Array(Type.Number())),
    }),
    instructions: Type.Optional(Type.Array(Type.Object({
        text: Type.String(),
        distance: Type.Number(),
        time: Type.Number(),
    }))),
});

const TerrainFeature = Type.Object({
    geometry: Type.Object({
        type: Type.Literal('LineString'),
        coordinates: Type.Array(Type.Array(Type.Number())),
    }),
    properties: Type.Object({
        distance_m: Type.Number(),
        duration_s: Type.Number(),
        ascent_m: Type.Number(),
        descent_m: Type.Number(),
        offpath_ratio: Type.Number(),
    }),
});

/**
 * Ciało odpowiedzi bywa dowolne (HTML z bramki, tablica `detail` z walidacji
 * FastAPI, błąd GraphHoppera bez `paths`), więc czytamy je bez zakładania schematu.
 */
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

/**
 * Douglas-Peucker w stopniach (lon/lat), bez rekursji. Pierwszy i ostatni punkt
 * zawsze zostają. Tolerancja rośnie dwukrotnie, aż wynik zmieści się w limicie.
 */
export function simplifyLine(coordinates: number[][], maxPoints: number = MAX_ROUTE_POINTS): number[][] {
    if (coordinates.length <= maxPoints || coordinates.length <= 2) return coordinates;

    const last = coordinates.length - 1;
    for (let tolerance = 0.0001; ; tolerance *= 2) {
        const keep = new Uint8Array(coordinates.length);
        keep[0] = 1;
        keep[last] = 1;

        const stack: Array<[number, number]> = [[0, last]];
        while (stack.length) {
            const [from, to] = stack.pop() as [number, number];
            const [ax, ay] = coordinates[from];
            const [bx, by] = coordinates[to];
            const dx = bx - ax;
            const dy = by - ay;
            const length = Math.hypot(dx, dy);

            let farthest = -1;
            let max = tolerance;
            for (let i = from + 1; i < to; i++) {
                const [px, py] = coordinates[i];
                const distance = length === 0
                    ? Math.hypot(px - ax, py - ay)
                    : Math.abs(dy * (px - ax) - dx * (py - ay)) / length;
                if (distance > max) {
                    max = distance;
                    farthest = i;
                }
            }

            if (farthest !== -1) {
                keep[farthest] = 1;
                stack.push([from, farthest], [farthest, to]);
            }
        }

        const result = coordinates.filter((_, i) => keep[i]);
        if (result.length <= maxPoints) return result;
    }
}

export function formatDistance(meters: number): string {
    if (meters >= 1000) return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
    return `${Math.round(meters)} m`;
}

export function formatDuration(seconds: number): string {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * Skleja odcinki w jedną linię. Każdy odcinek dostaje część limitu punktów
 * proporcjonalną do liczby swoich wierzchołków, najmniej 2, a jego końce zostają.
 * Pierwszy punkt odcinka równy ostatniemu poprzedniego staje się wspólnym wierzchołkiem.
 */
export function joinLegs(slices: LegSlice[], maxPoints: number = MAX_ROUTE_POINTS): { coordinates: number[][]; legs: RouteLeg[] } {
    const total = slices.reduce((sum, slice) => sum + slice.coordinates.length, 0);
    const spare = Math.max(0, maxPoints - 2 * slices.length);

    const coordinates: number[][] = [];
    const legs: RouteLeg[] = [];
    for (const slice of slices) {
        const budget = 2 + (total ? Math.floor(spare * slice.coordinates.length / total) : 0);
        const simplified = simplifyLine(slice.coordinates.map(c => [c[0], c[1]]), budget);

        const last = coordinates[coordinates.length - 1];
        const shared = last !== undefined && simplified.length > 0
            && last[0] === simplified[0][0] && last[1] === simplified[0][1];

        const start = shared ? coordinates.length - 1 : coordinates.length;
        coordinates.push(...(shared ? simplified.slice(1) : simplified));
        legs.push({ ...slice.leg, start, end: coordinates.length - 1 });
    }

    return { coordinates, legs };
}

/** Czy plan pasuje do linii o podanej liczbie wierzchołków. */
export function validPlan(plan: unknown, vertexCount: number): plan is RoutePlan {
    if (!plan || typeof plan !== 'object') return false;
    const p = plan as Partial<RoutePlan>;
    if (p.version !== 1 || typeof p.mode !== 'string' || !Array.isArray(p.waypoints) || !Array.isArray(p.legs)) return false;
    if (p.waypoints.length < 2 || p.legs.length !== p.waypoints.length - 1) return false;
    if (!p.waypoints.every(w => Array.isArray(w) && w.length >= 2 && w.every(n => typeof n === 'number' && Number.isFinite(n)))) return false;

    let previousEnd = -1;
    for (const leg of p.legs) {
        if (!leg || !Number.isInteger(leg.start) || !Number.isInteger(leg.end)) return false;
        if (leg.start > leg.end) return false;
        // pierwszy od zera, kolejne zaczynają się na końcu poprzedniego albo tuż za nim
        if (previousEnd === -1 ? leg.start !== 0 : (leg.start !== previousEnd && leg.start !== previousEnd + 1)) return false;
        previousEnd = leg.end;
    }

    return previousEnd === vertexCount - 1;
}

/** Opis trasy dla pola remarks: sumy, a przy kilku odcinkach bloki odcinków. */
export function composeRemarks(plan: RoutePlan): string {
    const terrain = plan.mode === TERRAIN_MODE;
    const legs = plan.legs;
    const distance = legs.reduce((sum, leg) => sum + leg.distance_m, 0);
    const duration = legs.reduce((sum, leg) => sum + leg.duration_s, 0);

    const lines = [
        `Tryb: ${plan.mode_name}`,
        `Długość: ${formatDistance(distance)}`,
        `${terrain ? 'Czas marszu' : 'Czas'}: ${formatDuration(duration)}`,
    ];

    if (legs.every(leg => leg.ascent_m !== undefined && leg.descent_m !== undefined)) {
        const ascent = legs.reduce((sum, leg) => sum + (leg.ascent_m ?? 0), 0);
        const descent = legs.reduce((sum, leg) => sum + (leg.descent_m ?? 0), 0);
        lines.push(`Podejścia: ${Math.round(ascent)} m, zejścia: ${Math.round(descent)} m`);
    }

    const options = describeOptions(plan.options);
    if (options) lines.push(`Opcje: ${options}`);

    if (plan.threats) {
        const parts: string[] = [];
        if (plan.threats.observers) parts.push(`${plan.threats.observers} ${plural(plan.threats.observers, 'posterunek', 'posterunki', 'posterunków')} przeciwnika`);
        if (plan.threats.closed_areas) parts.push(`${plan.threats.closed_areas} ${plural(plan.threats.closed_areas, 'strefa niebezpieczna', 'strefy niebezpieczne', 'stref niebezpiecznych')}`);
        lines.push(`Z mapy: ${parts.join(', ')}.`);
    }

    if (terrain && distance > 0) {
        const offpath = legs.reduce((sum, leg) => sum + (leg.offpath_ratio ?? 0) * leg.distance_m, 0) / distance;
        lines.push(`Poza drogami: ${Math.round(offpath * 100)}%`);
    }

    if (legs.length === 1) {
        const steps = legs[0].steps || [];
        if (steps.length) lines.push('', ...steps);
    } else {
        legs.forEach((leg, i) => {
            lines.push('', `Odcinek ${i + 1}: ${formatDistance(leg.distance_m)}, ${formatDuration(leg.duration_s)}`);
            lines.push(...(leg.steps || []));
        });
    }

    if (terrain) lines.push('', TERRAIN_NOTE);

    if (plan.analysis) lines.push('', composeAnalysis(plan.analysis));
    else if (plan.analysis_failed) lines.push('', 'Analiza terenu: niedostępna.');

    return lines.join('\n');
}

/**
 * Opcje znaczące dla usługi terenu: pomija wartości domyślne, a pusty wynik to undefined.
 * Limit nachylenia spoza 5–35° = 400.
 */
export function normalizeOptions(options?: RouteOptions): RouteOptions | undefined {
    if (!options) return undefined;
    const result: RouteOptions = {};
    if (options.avoid_wetland) result.avoid_wetland = true;
    if (options.avoid_streams) result.avoid_streams = true;
    if (options.avoid_observation) result.avoid_observation = true;
    if (options.max_slope_deg !== undefined) {
        const slope = options.max_slope_deg;
        if (!Number.isFinite(slope) || slope < MIN_SLOPE_DEG || slope > MAX_SLOPE_DEG) {
            throw new Err(400, null, `Limit nachylenia musi mieścić się w ${MIN_SLOPE_DEG}–${MAX_SLOPE_DEG}°.`);
        }
        if (slope < MAX_SLOPE_DEG) result.max_slope_deg = slope;
    }
    if (options.exposure !== undefined) {
        if (!EXPOSURES.includes(options.exposure)) throw new Err(400, null, 'Nieznany poziom ekspozycji.');
        if (options.exposure !== 'allow') result.exposure = options.exposure;
    }
    return Object.keys(result).length ? result : undefined;
}

function finitePoint(p: unknown): p is [number, number] {
    return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/** Zagrożenia z mapy: puste = undefined; za dużo obiektów albo zły wielokąt = 400. */
export function normalizeThreats(threats?: RouteThreats): RouteThreats | undefined {
    if (!threats) return undefined;
    const observers = threats.observers ?? [];
    const areas = threats.closed_areas ?? [];
    if (observers.length > MAX_THREATS || areas.length > MAX_THREATS) {
        throw new Err(400, null, `Najwyżej ${MAX_THREATS} posterunków i ${MAX_THREATS} terenów zamkniętych.`);
    }
    if (!observers.every(finitePoint)) throw new Err(400, null, 'Nieprawidłowa pozycja posterunku.');
    for (const ring of areas) {
        if (!Array.isArray(ring) || ring.length < 4 || ring.length > 1000 || !ring.every(finitePoint)) {
            throw new Err(400, null, 'Teren zamknięty musi być wielokątem z 4–1000 punktów.');
        }
    }
    const result: RouteThreats = {};
    if (observers.length) result.observers = observers.map(p => [p[0], p[1]] as [number, number]);
    if (areas.length) result.closed_areas = areas.map(ring => ring.map(p => [p[0], p[1]] as [number, number]));
    return Object.keys(result).length ? result : undefined;
}

/**
 * Opcje i zagrożenia jednego liczenia: opcje dla usługi terenu (tylko przełaj), opcje
 * do planu (przełaj plus ignore_danger_zones we wszystkich trybach) i zagrożenia bez
 * stref niebezpiecznych, gdy user ich nie omija.
 */
export function prepareRequest(mode: { terrain?: boolean }, options?: RouteOptions, threats?: RouteThreats): {
    terrainOptions?: RouteOptions;
    planOptions?: RouteOptions;
    threats?: RouteThreats;
} {
    const terrainOptions = mode.terrain ? normalizeOptions(options) : undefined;
    const ignore = options?.ignore_danger_zones === true;
    const planOptions = ignore ? { ...terrainOptions, ignore_danger_zones: true } : terrainOptions;

    let mapThreats = normalizeThreats(threats);
    if (ignore && mapThreats?.closed_areas) {
        const { closed_areas: _closed, ...rest } = mapThreats;
        void _closed;
        mapThreats = Object.keys(rest).length ? rest : undefined;
    }

    return { terrainOptions, planOptions, threats: mapThreats };
}

function plural(n: number, one: string, few: string, many: string): string {
    const tens = n % 100;
    const units = n % 10;
    if (n === 1) return one;
    if (units >= 2 && units <= 4 && (tens < 12 || tens > 14)) return few;
    return many;
}

function describeOptions(options?: RouteOptions): string {
    if (!options) return '';
    const parts: string[] = [];
    if (options.avoid_wetland) parts.push('omija bagna');
    if (options.avoid_streams) parts.push('omija strumienie i rowy');
    if (options.max_slope_deg !== undefined) parts.push(`nachylenie do ${options.max_slope_deg}°`);
    if (options.exposure === 'medium') parts.push('ogranicza teren odsłonięty');
    if (options.exposure === 'avoid') parts.push('unika terenu odsłoniętego');
    if (options.avoid_observation) parts.push('unika widoczności ze wzgórz');
    if (options.ignore_danger_zones) parts.push('nie omija stref niebezpiecznych');
    return parts.join(', ');
}

function km(meters: number): string {
    return (meters / 1000).toFixed(1).replace('.', ',');
}

function percent(ratio: number): string {
    return `${Math.round(ratio * 100)}%`;
}

function where(kind: string, span: Span): string {
    const from = km(span.from_m);
    const to = km(span.to_m);
    return POINT_KINDS.has(kind) || from === to ? `km ${from}` : `km ${from}–${to}`;
}

function list(items: string[]): string {
    const shown = items.slice(0, ANALYSIS_ITEMS);
    const rest = items.length - shown.length;
    return shown.join('; ') + (rest > 0 ? `; i ${rest} inne` : '') + '.';
}

/** Blok opisu trasy z analizą terenu: charakterystyka, ukrycie, nachylenie, przeszkody, strefy, teren kluczowy. */
export function composeAnalysis(a: RouteAnalysis): string {
    const land = Object.entries(a.land)
        .filter(([, ratio]) => Math.round(ratio * 100) > 0)
        .sort((x, y) => y[1] - x[1])
        .map(([name, ratio]) => `${LAND_NAMES[name] ?? name} ${percent(ratio)}`);
    if (land.length) land[0] = land[0][0].toUpperCase() + land[0].slice(1);

    const lines = [
        'Analiza terenu (OCOKA)',
        `Charakterystyka: ${km(a.length_m)} km, wysokość ${a.elevation_min_m}–${a.elevation_max_m} m n.p.m.${land.length ? ' ' + land.join(', ') + '.' : ''}`,
    ];

    const open = a.danger.filter(d => d.kind === 'open').sort((x, y) => (y.to_m - y.from_m) - (x.to_m - x.from_m))[0];
    lines.push(`Ukrycie: osłona lasu lub zarośli ${percent(a.cover.concealed)} trasy, teren odsłonięty ${percent(a.cover.exposed)}, drogi ${percent(a.cover.unknown)} (osłona zależy od otoczenia drogi).`
        + (open ? ` Najdłuższy odsłonięty odcinek: ${where('open', open)} (${formatDistance(open.to_m - open.from_m)}).` : ''));

    const b = a.slope.buckets;
    lines.push(`Nachylenie: największe ${Math.round(a.slope.max_deg)}°. Do 5°: ${percent(b['0-5'] ?? 0)}, 5–15°: ${percent(b['5-15'] ?? 0)}, 15–25°: ${percent(b['15-25'] ?? 0)}, ponad 25°: ${percent(b['25+'] ?? 0)}.`);

    lines.push(a.obstacles.length
        ? `Przeszkody: ${list(a.obstacles.map(o => `${OBSTACLE_NAMES[o.kind] ?? o.kind} ${where(o.kind, o)}`))}`
        : 'Przeszkody: brak w danych.');

    lines.push(a.danger.length
        ? `Strefy niebezpieczne: ${list(a.danger.map(d => `${DANGER_NAMES[d.kind] ?? d.kind} ${where(d.kind, d)}`))}`
        : 'Strefy niebezpieczne: brak w danych.');

    if (a.key_terrain.length) {
        lines.push('Teren kluczowy i obserwacja:');
        for (const k of a.key_terrain) {
            if (k.kind === 'crossing') {
                lines.push(`- przeprawa (most) ${where('crossing', k)}`);
                continue;
            }
            const direction = COMPASS[Math.round(k.bearing_deg / 45) % 8];
            const seen = k.visible_ratio > 0
                ? `widzi ${percent(k.visible_ratio)} trasy` + (k.visible.length ? ', ' + k.visible.slice(0, ANALYSIS_ITEMS).map(v => where('open', v)).join(', ') : '')
                : 'trasy nie widzi';
            lines.push(`- wzgórze ${k.elevation_m} m n.p.m. (${k.above_route_m} m nad trasą), ${km(k.distance_m)} km na ${direction} od km ${km(k.nearest_m)} (${k.lat.toFixed(5)}, ${k.lon.toFixed(5)}): ${seen}`);
        }
    }

    if (a.observed_ratio !== undefined && a.key_terrain.some(k => k.kind === 'height')) {
        lines.push(`Widoczność ze wzgórz łącznie: ${percent(a.observed_ratio)} trasy.`);
    }

    lines.push(ANALYSIS_NOTE);
    return lines.join('\n');
}

function graphHopperError(message: string | undefined): string {
    if (!message) return 'Nie udało się wyznaczyć trasy.';
    if (/Cannot find point|out of bounds/i.test(message)) return 'Punkt poza siecią dróg albo poza obszarem mapy.';
    if (/Connection between locations not found/i.test(message)) return 'Brak połączenia drogowego między punktami.';
    return `Nie udało się wyznaczyć trasy: ${message}`;
}

export default class TaklabRoute implements RouteInterface {
    _id: string;
    _name: string;
    _config: Config;

    graphhopper: string;
    terrain: string;
    timeouts: { graphhopper: number; terrain: number; info?: number; analyze?: number };

    private profilesCache?: { at: number; profiles: Set<string> | null };

    constructor(config: Config, graphhopper: string, terrain: string, timeouts: { graphhopper: number; terrain: number; info?: number; analyze?: number } = DEFAULT_TIMEOUTS) {
        this.timeouts = timeouts;
        this._id = 'taklab';
        this._name = 'taklab';
        this._config = config;
        this.graphhopper = graphhopper.replace(/\/+$/, '');
        this.terrain = terrain.replace(/\/+$/, '');
    }

    static async init(config: Config): Promise<TaklabRoute | null> {
        const settings = await config.models.Setting.typedMany({
            'taklab::routing::enabled': false,
            'taklab::routing::graphhopper_url': '',
            'taklab::routing::terrain_url': '',
        });

        if (!settings['taklab::routing::enabled'] || !settings['taklab::routing::graphhopper_url']) return null;

        // Bez polaczenia z uslugami: init nie moze pasc, gdy jedna z nich
        // chwilowo nie dziala, bo menedzer zdjalby wtedy caly dostawce.
        return new TaklabRoute(config, settings['taklab::routing::graphhopper_url'], settings['taklab::routing::terrain_url']);
    }

    /**
     * Profile GraphHoppera z GET /info, pamiętane 60 s. Błąd = null, czyli
     * tryby z optionalProfile są ukryte, a reszta działa.
     */
    async profiles(): Promise<Set<string> | null> {
        if (this.profilesCache && Date.now() - this.profilesCache.at < PROFILES_TTL_MS) {
            return this.profilesCache.profiles;
        }

        let profiles: Set<string> | null = null;
        try {
            const res = await fetch(new URL(this.graphhopper + '/info'), {
                method: 'GET',
                safeUrlAllow: [this.graphhopper],
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(this.timeouts.info ?? DEFAULT_TIMEOUTS.info),
            });
            const body = await readJson(res);
            const list = field(body, 'profiles');
            if (res.ok && Array.isArray(list)) {
                profiles = new Set(list.map(item => field(item, 'name')).filter((name): name is string => typeof name === 'string'));
            }
        } catch {
            profiles = null;
        }

        this.profilesCache = { at: Date.now(), profiles };
        return profiles;
    }

    async modes(): Promise<Mode[]> {
        const needsProfiles = MODES.some(mode => mode.optionalProfile);
        const profiles = needsProfiles ? await this.profiles() : null;

        return MODES.filter((mode) => {
            if (mode.terrain) return !!this.terrain;
            if (mode.optionalProfile) return !!profiles && !!mode.profile && profiles.has(mode.profile);
            return true;
        });
    }

    async config(): Promise<Static<typeof RouteConfig>> {
        return {
            id: this._id,
            name: this._name,
            modes: (await this.modes()).map(mode => ({ id: mode.id, name: mode.name })),
        };
    }

    async resolveMode(travelMode?: string): Promise<Mode> {
        // Schemat zapytania wstawia 'Driving Time' (domyślny tryb AGOL), gdy klient
        // nie poda trybu albo został przy trybie poprzedniego dostawcy; to znaczy: samochód.
        const modes = await this.modes();
        const requested = !travelMode || (travelMode === AGOL_DEFAULT_MODE && !modes.some(m => m.id === travelMode))
            ? 'car'
            : travelMode;
        const mode = modes.find(m => m.id === requested);
        if (!mode) throw new Err(400, null, 'Nieznany tryb trasy');
        return mode;
    }

    async route(
        stops: Array<[number, number]>,
        travelMode?: string,
        options?: RouteOptions,
        threats?: RouteThreats,
    ): Promise<Static<typeof Feature.FeatureCollection>> {
        if (stops.length < 2) throw new Err(400, null, 'Trasa wymaga co najmniej dwóch punktów.');
        if (stops.length - 2 > MAX_VIA_POINTS) throw new Err(400, null, `Najwyżej ${MAX_VIA_POINTS} punktów pośrednich.`);

        const mode = await this.resolveMode(travelMode);
        const { terrainOptions, planOptions, threats: mapThreats } = prepareRequest(mode, options, threats);
        const waypoints = stops.map(s => [s[0], s[1]] as [number, number]);
        const slices = await this.computeLegs(waypoints, mode, 0, terrainOptions, mapThreats);

        return await this.feature(mode, waypoints, slices, planOptions, mapThreats);
    }

    /**
     * Przelicza część istniejącej trasy: odcinki first..first+count-1 starego planu
     * zastępuje count+added nowymi, policzonymi między kolejnymi punktami z waypoints.
     */
    async reroute(input: RerouteInput): Promise<Static<typeof Feature.FeatureCollection>> {
        const { waypoints, coordinates, legs, first, count, added } = input;
        const mode = await this.resolveMode(input.travelMode);
        const { terrainOptions, planOptions, threats: mapThreats } = prepareRequest(mode, input.options, input.threats);

        const oldPlan = { version: 1, mode: mode.id, mode_name: mode.name, waypoints: Array.from({ length: legs.length + 1 }, () => [0, 0]), legs };
        if (!validPlan(oldPlan, coordinates.length)) throw new Err(400, null, 'Plan trasy nie pasuje do jej linii.');
        if (![-1, 0, 1].includes(added)) throw new Err(400, null, 'Nieprawidłowa zmiana trasy.');
        if (!Number.isInteger(first) || !Number.isInteger(count) || first < 0 || count < 0 || first + count > legs.length) {
            throw new Err(400, null, 'Nieprawidłowy zakres odcinków.');
        }
        const freshCount = count + added;
        if (freshCount < 0 || waypoints.length !== legs.length + 1 + added || waypoints.length < 2) {
            throw new Err(400, null, 'Liczba punktów nie pasuje do zmiany trasy.');
        }
        if (waypoints.length - 2 > MAX_VIA_POINTS) throw new Err(400, null, `Najwyżej ${MAX_VIA_POINTS} punktów pośrednich.`);

        const fresh = freshCount > 0
            ? await this.computeLegs(waypoints.slice(first, first + freshCount + 1), mode, first, terrainOptions, mapThreats)
            : [];

        const old: LegSlice[] = legs.map(leg => ({
            coordinates: coordinates.slice(leg.start, leg.end + 1),
            leg: legStats(leg),
        }));

        const slices = [...old.slice(0, first), ...fresh, ...old.slice(first + count)];

        return await this.feature(mode, waypoints.map(w => [w[0], w[1]] as [number, number]), slices, planOptions, mapThreats);
    }

    /** Liczy odcinki między kolejnymi punktami; offset służy tylko numeracji w komunikacie błędu. */
    async computeLegs(stops: Array<[number, number]>, mode: Mode, offset: number, options?: RouteOptions, threats?: RouteThreats): Promise<LegSlice[]> {
        const pairs = stops.slice(1).map((end, i) => [stops[i], end] as [[number, number], [number, number]]);
        const numbered = async (i: number, job: Promise<LegSlice>): Promise<LegSlice> => {
            try {
                return await job;
            } catch (err) {
                if (err instanceof Err && stops.length > 2) {
                    // null zamiast err: wtedy message = safe, czyli tekst z numerem odcinka
                    throw new Err(err.status, null, `Odcinek ${offset + i + 1}: ${err.safe}`);
                }
                throw err;
            }
        };

        if (mode.terrain) {
            // Usługa przełaju ma dwa miejsca na liczenie: odcinki idą po kolei
            const slices: LegSlice[] = [];
            for (const [i, [a, b]] of pairs.entries()) {
                slices.push(await numbered(i, this.terrainLeg(a, b, options, threats)));
            }
            return slices;
        }

        return await Promise.all(pairs.map(([a, b], i) => numbered(i, this.roadLeg(a, b, mode, threats))));
    }

    async feature(mode: Mode, waypoints: Array<[number, number]>, slices: LegSlice[], options?: RouteOptions, threats?: RouteThreats): Promise<Static<typeof Feature.FeatureCollection>> {
        const { coordinates, legs } = joinLegs(slices);
        const plan: RoutePlan = { version: 1, mode: mode.id, mode_name: mode.name, waypoints, legs };
        if (options) plan.options = options;
        if (threats) {
            // Posterunki zmieniają tylko trasę na przełaj; drogowa uwzględnia same tereny zamknięte
            const used = { observers: mode.terrain ? (threats.observers?.length ?? 0) : 0, closed_areas: threats.closed_areas?.length ?? 0 };
            if (used.observers || used.closed_areas) plan.threats = used;
        }

        if (this.terrain) {
            const analysis = await this.analyze(coordinates);
            if (analysis) plan.analysis = analysis;
            else plan.analysis_failed = true;
        }

        const norm = await CoTParser.normalize_geojson({
            id: String(randomUUID()),
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'LineString',
                coordinates,
            },
        });

        norm.properties.type = 'b-m-r';
        norm.properties.how = 'm-g';
        norm.properties.callsign = mode.name;
        norm.properties.archived = true;
        norm.properties.remarks = composeRemarks(plan);
        norm.properties.metadata = { taklab_route: plan };

        return { type: 'FeatureCollection', features: [norm] };
    }

    /** Ciało zapytania do GraphHoppera: profil, kary za autostrady i tereny zamknięte. */
    roadBody(a: [number, number], b: [number, number], mode: Mode, threats?: RouteThreats): Record<string, unknown> {
        const body: Record<string, unknown> = {
            profile: mode.profile,
            points: [a, b],
            way_point_max_distance: 20,
            points_encoded: false,
            instructions: true,
            locale: 'pl',
        };
        const priority: Array<{ if: string; multiply_by: string }> = [];
        if (mode.avoidMotorway) priority.push({ if: 'road_class == MOTORWAY', multiply_by: '0' });
        const areas = (threats?.closed_areas ?? []).map((ring, i) => {
            priority.push({ if: `in_closed${i}`, multiply_by: '0' });
            return { type: 'Feature', id: `closed${i}`, properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
        });
        if (priority.length) {
            body.custom_model = areas.length
                ? { priority, areas: { type: 'FeatureCollection', features: areas } }
                : { priority };
        }
        return body;
    }

    /** Zamienia ścieżkę GraphHoppera na odcinek trasy. */
    roadSlice(path: Static<typeof GraphHopperPath>): LegSlice {
        const steps = (path.instructions || [])
            .filter(step => step.distance > 0)
            .map((step, i) => `${i + 1}. ${step.text} (${formatDistance(step.distance)})`);

        const leg: LegStats = { distance_m: path.distance, duration_s: path.time / 1000 };
        if (path.ascend !== undefined && path.descend !== undefined) {
            leg.ascent_m = path.ascend;
            leg.descent_m = path.descend;
        }
        if (steps.length) leg.steps = steps;

        return { coordinates: path.points.coordinates, leg };
    }

    /** Pyta GraphHoppera; zwraca poprawne ścieżki albo rzuca 400 z jego komunikatem. */
    async roadPaths(body: Record<string, unknown>): Promise<Array<Static<typeof GraphHopperPath>>> {
        let res;
        try {
            res = await fetch(new URL(this.graphhopper + '/route'), {
                method: 'POST',
                safeUrlAllow: [this.graphhopper],
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(this.timeouts.graphhopper),
            });
        } catch (err) {
            throw new Err(400, err instanceof Error ? err : null, 'Usługa tras drogowych nie odpowiada.');
        }

        const reply = await readJson(res);
        const message = field(reply, 'message');
        const raw = field(reply, 'paths');
        const paths = res.ok && Array.isArray(raw) ? raw.filter((p): p is Static<typeof GraphHopperPath> => Value.Check(GraphHopperPath, p)) : [];
        if (!paths.length) throw new Err(400, null, graphHopperError(typeof message === 'string' ? message : undefined));
        return paths;
    }

    async roadLeg(a: [number, number], b: [number, number], mode: Mode, threats?: RouteThreats): Promise<LegSlice> {
        const res = await this.roadPaths(this.roadBody(a, b, mode, threats));
        return this.roadSlice(res[0]);
    }

    /** Analiza terenu wzdłuż linii; null, gdy usługa zawiodła (trasa powstaje i bez niej). */
    async analyze(coordinates: number[][]): Promise<RouteAnalysis | null> {
        try {
            const res = await fetch(new URL(this.terrain + '/analyze'), {
                method: 'POST',
                safeUrlAllow: [this.terrain],
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ coordinates: coordinates.map(c => [c[0], c[1]]) }),
                signal: AbortSignal.timeout(this.timeouts.analyze ?? DEFAULT_TIMEOUTS.analyze),
            });
            const body = await readJson(res);
            if (!res.ok || typeof field(body, 'length_m') !== 'number') return null;
            return body as RouteAnalysis;
        } catch {
            return null;
        }
    }

    /** Komunikat błędu usługi przełaju (detail.message) albo tekst domyślny. */
    terrainError(body: unknown): Err {
        const message = field(field(body, 'detail'), 'message');
        return new Err(400, null, typeof message === 'string' && message ? message : 'Nie udało się wyznaczyć trasy na przełaj.');
    }

    /** Zamienia Feature z usługi przełaju na odcinek trasy. */
    terrainSlice(feature: Static<typeof TerrainFeature>): LegSlice {
        const p = feature.properties;
        return {
            coordinates: feature.geometry.coordinates,
            leg: {
                distance_m: p.distance_m,
                duration_s: p.duration_s,
                ascent_m: p.ascent_m,
                descent_m: p.descent_m,
                offpath_ratio: p.offpath_ratio,
            },
        };
    }

    async terrainLeg(a: [number, number], b: [number, number], options?: RouteOptions, threats?: RouteThreats): Promise<LegSlice> {
        let res;
        try {
            res = await fetch(new URL(this.terrain + '/route'), {
                method: 'POST',
                safeUrlAllow: [this.terrain],
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ start: a, end: b, ...options, ...threats }),
                signal: AbortSignal.timeout(this.timeouts.terrain),
            });
        } catch (err) {
            throw new Err(400, err instanceof Error ? err : null, 'Usługa tras na przełaj nie odpowiada.');
        }

        const body = await readJson(res);
        if (!res.ok || !Value.Check(TerrainFeature, body)) throw this.terrainError(body);

        return this.terrainSlice(body);
    }

    /** Warianty na przełaj: usługa omija podane linie (istniejącą trasę) metodą kar. */
    async terrainVariants(start: [number, number], end: [number, number], coordinates: number[][], count: number, options?: RouteOptions, threats?: RouteThreats): Promise<LegSlice[]> {
        let res;
        try {
            res = await fetch(new URL(this.terrain + '/variants'), {
                method: 'POST',
                safeUrlAllow: [this.terrain],
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    start,
                    end,
                    ...options,
                    ...threats,
                    avoid_lines: [coordinates.map(c => [c[0], c[1]])],
                    count,
                }),
                signal: AbortSignal.timeout(this.timeouts.terrain),
            });
        } catch (err) {
            throw new Err(400, err instanceof Error ? err : null, 'Usługa tras na przełaj nie odpowiada.');
        }

        const body = await readJson(res);
        const features = field(body, 'features');
        if (!res.ok || !Array.isArray(features)) throw this.terrainError(body);

        return features
            .filter((f): f is Static<typeof TerrainFeature> => Value.Check(TerrainFeature, f))
            .map(f => this.terrainSlice(f));
    }

    /** Warianty drogowe: alternatywne ścieżki GraphHoppera, bez pierwszej (to trasa główna). */
    async roadVariants(start: [number, number], end: [number, number], mode: Mode, count: number, threats?: RouteThreats): Promise<LegSlice[]> {
        const body = {
            ...this.roadBody(start, end, mode, threats),
            'algorithm': 'alternative_route',
            'alternative_route.max_paths': count + 1,
        };
        const paths = await this.roadPaths(body);
        return paths.slice(1, count + 1).map(p => this.roadSlice(p));
    }

    /** Proponuje do dwóch tras zastępczych między początkiem a końcem trasy; zwraca je jak route(). */
    async variants(input: VariantsInput): Promise<Static<typeof Feature.FeatureCollection>> {
        const count = input.count ?? 2;
        if (!Number.isInteger(count) || count < 1 || count > 2) throw new Err(400, null, 'Liczba wariantów: 1 albo 2.');
        if (input.waypoints.length < 2) throw new Err(400, null, 'Trasa wymaga co najmniej dwóch punktów.');

        const mode = await this.resolveMode(input.travelMode);
        const { terrainOptions: options, planOptions, threats } = prepareRequest(mode, input.options, input.threats);
        const first = input.waypoints[0];
        const last = input.waypoints[input.waypoints.length - 1];
        const start: [number, number] = [first[0], first[1]];
        const end: [number, number] = [last[0], last[1]];

        const slices = mode.terrain
            ? await this.terrainVariants(start, end, input.coordinates, count, options, threats)
            : await this.roadVariants(start, end, mode, count, threats);

        const features: Static<typeof Feature.FeatureCollection>['features'] = [];
        for (const slice of slices) {
            features.push(...(await this.feature(mode, [start, end], [slice], planOptions, threats)).features);
        }

        return { type: 'FeatureCollection', features };
    }
}

function legStats(leg: RouteLeg): LegStats {
    const { start: _start, end: _end, ...stats } = leg;
    void _start;
    void _end;
    return stats;
}
