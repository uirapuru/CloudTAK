import { fetch } from '@tak-ps/node-safeurl';
import Config from '../../../common/config.js';
import { Static, TSchema, Type } from '@sinclair/typebox';
import { Search } from '../interface-search.js';
import { Search_Type } from '../../../common/enums.js';
import { parseCategory } from './categories.js';
import { SearchConfig, FetchSuggest, FetchReverse, FetchForward } from './types.js';

export const OSM_PUBLIC_API = 'https://photon.komoot.io';

const PhotonFeature = Type.Object({
    type: Type.Literal('Feature'),
    properties: Type.Object({
        osm_type: Type.Optional(Type.String()),
        osm_id: Type.Optional(Type.Integer()),
        osm_key: Type.Optional(Type.String()),
        osm_value: Type.Optional(Type.String()),
        type: Type.Optional(Type.String()),
        name: Type.Optional(Type.String()),
        housenumber: Type.Optional(Type.String()),
        street: Type.Optional(Type.String()),
        locality: Type.Optional(Type.String()),
        district: Type.Optional(Type.String()),
        city: Type.Optional(Type.String()),
        county: Type.Optional(Type.String()),
        state: Type.Optional(Type.String()),
        postcode: Type.Optional(Type.String()),
        country: Type.Optional(Type.String()),
        countrycode: Type.Optional(Type.String()),
        extent: Type.Optional(Type.Array(Type.Number())),
    }),
    geometry: Type.Object({
        type: Type.Literal('Point'),
        coordinates: Type.Array(Type.Number(), { minItems: 2 }),
    }),
});

const PhotonCollection = Type.Object({
    type: Type.Literal('FeatureCollection'),
    features: Type.Array(PhotonFeature),
});

type Extent = Static<typeof FetchForward>['extent'];
type PhotonProperties = Static<typeof PhotonFeature>['properties'];

const NUM = '-?\\d+(?:\\.\\d+)?';
const MAGIC_KEY = new RegExp(`^[NWR]\\d+@(${NUM}),(${NUM})(?:@(${NUM}),(${NUM}),(${NUM}),(${NUM}))?(?:@([a-z]+))?$`);

const OSM_TYPES: Record<string, Search_Type> = {
    'amenity=hospital': Search_Type.HOSPITAL,
    'building=hospital': Search_Type.HOSPITAL,
    'healthcare=hospital': Search_Type.HOSPITAL,
    'amenity=police': Search_Type.POLICE,
    'leisure=park': Search_Type.PARK,
    'leisure=nature_reserve': Search_Type.PARK,
    'boundary=national_park': Search_Type.PARK,
    'boundary=protected_area': Search_Type.PARK,
    'natural=peak': Search_Type.PEAK,
    'natural=volcano': Search_Type.PEAK,
    'highway=trailhead': Search_Type.TRAILHEAD,
    'amenity=parking': Search_Type.PARKING,
    'amenity=parking_entrance': Search_Type.PARKING,
    'place=postcode': Search_Type.POSTAL,
    'boundary=postal_code': Search_Type.POSTAL,
};

export function searchType(props: PhotonProperties): Search_Type | undefined {
    if (props.type === 'street') return Search_Type.STREET;

    // Trailheads are frequently only tagged as the parking lot that serves them
    if (props.name && /\btrailhead\b/i.test(props.name)) return Search_Type.TRAILHEAD;

    const tagged = OSM_TYPES[`${props.osm_key}=${props.osm_value}`];
    if (tagged) return tagged;

    if (props.type && ['county', 'state', 'country'].includes(props.type)) return Search_Type.REGION;

    if (
        props.type && ['locality', 'district', 'city'].includes(props.type)
        && (props.osm_key === 'place' || props.osm_key === 'boundary')
    ) return Search_Type.LOCALITY;

    if (props.type === 'house' && !props.name) return Search_Type.ADDRESS;

    return props.name ? Search_Type.POI : undefined;
}

function longLabel(feature: Static<typeof PhotonFeature>): string {
    const props = feature.properties;

    const parts = [
        props.name,
        [props.housenumber, props.street].filter(Boolean).join(' '),
        props.city || props.county,
        [props.state, props.postcode].filter(Boolean).join(' '),
        props.country,
    ].filter(Boolean) as string[];

    const label = parts.filter((part, i) => parts.indexOf(part) === i).join(', ');

    return label || feature.geometry.coordinates.slice(0, 2).join(', ');
}

function shortLabel(feature: Static<typeof PhotonFeature>): string {
    return feature.properties.name || longLabel(feature).split(', ')[0];
}

function extent(lon: number, lat: number, bounds?: number[]): Extent {
    const pad = 0.005;

    let [xmin, ymin, xmax, ymax] = [lon, lat, lon, lat];

    if (bounds && bounds.length === 4) {
        xmin = Math.min(bounds[0], bounds[2]);
        xmax = Math.max(bounds[0], bounds[2]);
        ymin = Math.min(bounds[1], bounds[3]);
        ymax = Math.max(bounds[1], bounds[3]);
    }

    if (xmax - xmin < pad) {
        xmin = lon - pad;
        xmax = lon + pad;
    }

    if (ymax - ymin < pad) {
        ymin = lat - pad;
        ymax = lat + pad;
    }

    return { xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 } };
}

// Photon has no lookup by ID so the key carries the location of the suggestion
function magicKey(feature: Static<typeof PhotonFeature>): string {
    const props = feature.properties;
    const [lon, lat] = feature.geometry.coordinates;

    const id = props.osm_type && props.osm_id !== undefined
        ? `${props.osm_type[0].toUpperCase()}${props.osm_id}`
        : 'N0';

    const parts = [id, `${lon},${lat}`];

    if (props.extent && props.extent.length === 4) parts.push(props.extent.join(','));

    const type = searchType(props);
    if (type) parts.push(type);

    return parts.join('@');
}

function forward(feature: Static<typeof PhotonFeature>): Static<typeof FetchForward> {
    const [lon, lat] = feature.geometry.coordinates;
    const label = longLabel(feature);
    const type = searchType(feature.properties);

    return {
        ...(type ? { type } : {}),
        address: label,
        location: {
            x: lon,
            y: lat,
        },
        score: 100,
        attributes: {
            LongLabel: label,
            ShortLabel: shortLabel(feature),
        },
        extent: extent(lon, lat, feature.properties.extent),
    };
}

export default class OSMSearch extends Search {
    api: string;
    userAgent: string;

    constructor(config: Config, api: string = OSM_PUBLIC_API) {
        super(config, 'osm', 'OpenStreetMap');

        this.api = api.replace(/\/+$/, '');
        this.userAgent = `CloudTAK (${config.API_URL})`;
    }

    static async init(config: Config): Promise<OSMSearch | null> {
        const settings = await config.models.Setting.typedMany({
            'osm::enabled': false,
            'osm::url': OSM_PUBLIC_API,
        });

        if (!settings['osm::enabled']) return null;

        return new OSMSearch(config, settings['osm::url'] || OSM_PUBLIC_API);
    }

    config(): Promise<Static<typeof SearchConfig>> {
        return Promise.resolve({
            id: this._id,
            name: this._name,
            reverse: {
                supported: true,
            },
            forward: {
                supported: true,
            },
        });
    }

    async fetch<T extends TSchema>(path: string, params: Record<string, string>, schema: T): Promise<Static<T>> {
        const url = new URL(this.api + path);
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }

        const res = await fetch(url, {
            safeUrlAllow: [this.api],
            headers: {
                'User-Agent': this.userAgent,
                'Accept': 'application/json',
            },
        });

        if (!res.ok) throw new Error(`Photon API failed: ${res.status}`);

        return await res.typed(schema);
    }

    async reverse(lon: number, lat: number): Promise<Static<typeof FetchReverse>> {
        const body = await this.fetch('/reverse', {
            lon: String(lon),
            lat: String(lat),
            limit: '1',
        }, PhotonCollection);

        if (!body.features.length) throw new Error('Photon API Error: Unable to geocode');

        const feature = body.features[0];
        const type = searchType(feature.properties);

        return {
            ...(type ? { type } : {}),
            LongLabel: longLabel(feature),
            ShortLabel: shortLabel(feature),
            Addr_type: feature.properties.type || feature.properties.osm_value || 'unknown',
        };
    }

    // Photon szuka po nazwie, wiec kategorie ("apteka bielany") rozbijamy na
    // znacznik OSM i miejsce: najpierw geokodujemy miejsce, potem /reverse
    private async categorySearch(
        query: string,
        limit: number,
        location?: [number, number],
    ): Promise<Array<Static<typeof PhotonFeature>>> {
        // Blad kategorii nie moze zabic zwyklych wynikow
        try {
            return await this.lookupCategory(query, limit, location);
        } catch (err) {
            console.error('OSM category search failed:', err instanceof Error ? err.message : err);
            return [];
        }
    }

    private async lookupCategory(
        query: string,
        limit: number,
        location?: [number, number],
    ): Promise<Array<Static<typeof PhotonFeature>>> {
        const match = parseCategory(query);
        if (!match) return [];

        let center = location;

        if (match.place) {
            const params: Record<string, string> = { q: match.place, limit: '1' };
            if (location) {
                params.lon = String(location[0]);
                params.lat = String(location[1]);
            }
            const place = await this.fetch('/api', params, PhotonCollection);
            if (!place.features.length) return [];
            const [lon, lat] = place.features[0].geometry.coordinates;
            center = [lon, lat];
        }

        if (!center) return [];

        // Kilka znacznikow to powtorzony klucz, wiec URL budujemy recznie
        const url = new URL(this.api + '/reverse');
        url.searchParams.set('lon', String(center[0]));
        url.searchParams.set('lat', String(center[1]));
        url.searchParams.set('radius', '3');
        url.searchParams.set('limit', String(limit));
        for (const tag of match.tags) url.searchParams.append('osm_tag', tag);

        const res = await fetch(url, {
            safeUrlAllow: [this.api],
            headers: {
                'User-Agent': this.userAgent,
                'Accept': 'application/json',
            },
        });
        if (!res.ok) throw new Error(`Photon API failed: ${res.status}`);
        const body = await res.typed(PhotonCollection);

        return body.features.map(feature => feature.properties.name
            ? feature
            : { ...feature, properties: { ...feature.properties, name: match.label } });
    }

    // Kategoria zajmuje co najwyzej polowe limitu, zwykle wyniki wypelniaja
    // reszte, a wolne miejsca dostaja nadwyzki kategorii. Bez duplikatow.
    private merge(
        categorised: Array<Static<typeof PhotonFeature>>,
        plain: Array<Static<typeof PhotonFeature>>,
        limit?: number,
    ): Array<Static<typeof PhotonFeature>> {
        const seen = new Set<string>();
        const unique = (features: Array<Static<typeof PhotonFeature>>) => features.filter((feature) => {
            const key = magicKey(feature);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        const category = unique(categorised);
        const rest = unique(plain);

        if (!limit) return [...category, ...rest];

        const kept = Math.ceil(limit / 2);

        return [...category.slice(0, kept), ...rest, ...category.slice(kept)].slice(0, limit);
    }

    async forward(query: string, magicKey: string, limit?: number): Promise<Array<Static<typeof FetchForward>>> {
        const key = magicKey.match(MAGIC_KEY);

        if (key) {
            const [lon, lat, ...bounds] = key.slice(1, 7).filter(part => part !== undefined).map(Number);
            const type = Object.values(Search_Type).find(value => value === key[7]);

            if (Math.abs(lon) <= 180 && Math.abs(lat) <= 90) {
                const label = query.trim() || `${lat}, ${lon}`;

                return [{
                    ...(type ? { type } : {}),
                    address: label,
                    location: {
                        x: lon,
                        y: lat,
                    },
                    score: 100,
                    attributes: {
                        LongLabel: label,
                        ShortLabel: label.split(', ')[0],
                    },
                    extent: extent(lon, lat, bounds),
                }];
            }
        }

        if (!query.trim()) return [];

        const params: Record<string, string> = { q: query };
        if (limit) params.limit = String(limit);

        const categorised = await this.categorySearch(query, limit || 10);
        const body = await this.fetch('/api', params, PhotonCollection);

        return this.merge(categorised, body.features, limit).map(forward);
    }

    async suggest(query: string, limit?: number, location?: [number, number]): Promise<Array<Static<typeof FetchSuggest>>> {
        if (!query.trim()) return [];

        const params: Record<string, string> = { q: query };
        if (limit) params.limit = String(limit);
        if (location) {
            const [lon, lat] = location;
            params.lon = String(lon);
            params.lat = String(lat);
        }

        const categorised = await this.categorySearch(query, limit || 10, location);
        const body = await this.fetch('/api', params, PhotonCollection);

        return this.merge(categorised, body.features, limit).map((feature) => {
            const type = searchType(feature.properties);

            return {
                ...(type ? { type } : {}),
                text: longLabel(feature),
                magicKey: magicKey(feature),
                isCollection: false,
            };
        });
    }
}
