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
    profile?: 'car' | 'offroad' | 'foot';
    avoidMotorway?: boolean;
    terrain?: boolean;
};

// Górna granica liczby wierzchołków trasy: ATAK robi z każdego punkt kontrolny
export const MAX_ROUTE_POINTS = 1000;

// Domyślny tryb schematu zapytania /search/route w upstreamie (nazwa trybu AGOL)
const AGOL_DEFAULT_MODE = 'Driving Time';

export const DEFAULT_TIMEOUTS = { graphhopper: 30000, terrain: 60000 };

export const MODES: Mode[] = [
    { id: 'car', name: 'Samochód', profile: 'car' },
    { id: 'car_no_motorway', name: 'Samochód bez autostrad', profile: 'car', avoidMotorway: true },
    { id: 'offroad', name: 'Drogi gruntowe', profile: 'offroad' },
    { id: 'foot', name: 'Pieszo', profile: 'foot' },
    { id: 'foot_cross_country', name: 'Pieszo na przełaj', terrain: true },
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
    timeouts: { graphhopper: number; terrain: number };

    constructor(config: Config, graphhopper: string, terrain: string, timeouts = DEFAULT_TIMEOUTS) {
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

    modes(): Mode[] {
        return MODES.filter(mode => !mode.terrain || this.terrain);
    }

    config(): Promise<Static<typeof RouteConfig>> {
        return Promise.resolve({
            id: this._id,
            name: this._name,
            modes: this.modes().map(mode => ({ id: mode.id, name: mode.name })),
        });
    }

    async route(
        stops: Array<[number, number]>,
        travelMode?: string,
    ): Promise<Static<typeof Feature.FeatureCollection>> {
        // Schemat zapytania wstawia 'Driving Time' (domyślny tryb AGOL), gdy klient
        // nie poda trybu albo został przy trybie poprzedniego dostawcy; to znaczy: samochód.
        const modes = this.modes();
        const requested = !travelMode || (travelMode === AGOL_DEFAULT_MODE && !modes.some(m => m.id === travelMode))
            ? 'car'
            : travelMode;
        const mode = modes.find(m => m.id === requested);
        if (!mode) throw new Err(400, null, 'Nieznany tryb trasy');

        const { coordinates, remarks } = mode.terrain
            ? await this.terrainRoute(stops)
            : await this.roadRoute(stops, mode);

        const norm = await CoTParser.normalize_geojson({
            id: String(randomUUID()),
            type: 'Feature',
            properties: { metadata: { provider: 'taklab', mode: mode.id } },
            geometry: {
                type: 'LineString',
                coordinates: coordinates.map(c => [c[0], c[1]]),
            },
        });

        norm.properties.type = 'b-m-r';
        norm.properties.how = 'm-g';
        norm.properties.callsign = mode.name;
        norm.properties.archived = true;
        norm.properties.remarks = `Tryb: ${mode.name}\n${remarks}`;

        return { type: 'FeatureCollection', features: [norm] };
    }

    async roadRoute(stops: Array<[number, number]>, mode: Mode): Promise<{ coordinates: number[][]; remarks: string }> {
        const body: Record<string, unknown> = {
            profile: mode.profile,
            points: stops,
            way_point_max_distance: 20,
            points_encoded: false,
            instructions: true,
            locale: 'pl',
        };
        if (mode.avoidMotorway) {
            body.custom_model = { priority: [{ if: 'road_class == MOTORWAY', multiply_by: '0' }] };
        }

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
        const paths = field(reply, 'paths');
        const path = res.ok && Array.isArray(paths) && Value.Check(GraphHopperPath, paths[0]) ? paths[0] as Static<typeof GraphHopperPath> : undefined;
        if (!path) throw new Err(400, null, graphHopperError(typeof message === 'string' ? message : undefined));

        const lines = [
            `Długość: ${formatDistance(path.distance)}`,
            `Czas: ${formatDuration(path.time / 1000)}`,
        ];
        if (path.ascend !== undefined && path.descend !== undefined) {
            lines.push(`Podejścia: ${Math.round(path.ascend)} m, zejścia: ${Math.round(path.descend)} m`);
        }
        const steps = (path.instructions || [])
            .filter(step => step.distance > 0)
            .map((step, i) => `${i + 1}. ${step.text} (${formatDistance(step.distance)})`);
        if (steps.length) lines.push('', ...steps);

        return { coordinates: simplifyLine(path.points.coordinates), remarks: lines.join('\n') };
    }

    async terrainRoute(stops: Array<[number, number]>): Promise<{ coordinates: number[][]; remarks: string }> {
        if (stops.length !== 2) throw new Err(400, null, 'Przełaj wyznacza trasę tylko między dwoma punktami.');

        let res;
        try {
            res = await fetch(new URL(this.terrain + '/route'), {
                method: 'POST',
                safeUrlAllow: [this.terrain],
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ start: stops[0], end: stops[1] }),
                signal: AbortSignal.timeout(this.timeouts.terrain),
            });
        } catch (err) {
            throw new Err(400, err instanceof Error ? err : null, 'Usługa tras na przełaj nie odpowiada.');
        }

        const body = await readJson(res);
        if (!res.ok || !Value.Check(TerrainFeature, body)) {
            const detail = field(body, 'detail');
            const message = field(detail, 'message');
            throw new Err(400, null, typeof message === 'string' && message ? message : 'Nie udało się wyznaczyć trasy na przełaj.');
        }

        const parsed = body;
        const p = parsed.properties;
        const remarks = [
            `Długość: ${formatDistance(p.distance_m)}`,
            `Czas marszu: ${formatDuration(p.duration_s)}`,
            `Podejścia: ${Math.round(p.ascent_m)} m, zejścia: ${Math.round(p.descent_m)} m`,
            `Poza drogami: ${Math.round(p.offpath_ratio * 100)}%`,
            '',
            'Trasa z OSM i DTED2 (siatka 30 m). Płotów, nieoznaczonych mokradeł i drobnych uskoków model nie widzi. Sprawdź trasę na mapie przed wyjściem.',
        ].join('\n');

        return { coordinates: simplifyLine(parsed.geometry.coordinates), remarks };
    }
}
