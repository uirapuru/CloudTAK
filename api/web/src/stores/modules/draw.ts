import router from '../../router.ts';
import { ref, reactive, shallowRef, shallowReactive } from 'vue';
import { Preferences } from '@capacitor/preferences';
import * as terraDraw from 'terra-draw';
import * as tilecover from '@mapbox/tile-cover';
import {
    TerraDrawMapLibreGLAdapter
} from 'terra-draw-maplibre-gl-adapter';
import { TerraRoute } from 'terra-route'
import {
    Routing,
    TerraDrawRouteSnapMode
} from 'terra-draw-route-snap-mode'

import { v4 as randomUUID } from 'uuid';
import * as mapgl from 'maplibre-gl'
import pointOnFeature from '@turf/point-on-feature';
import { coordEach } from '@turf/meta';
import { distance } from '@turf/distance';
import type { GeoJSONFeatureId } from 'maplibre-gl'
import type COT from '../../base/cot.ts';
import Filter from '../../base/filter.ts';
import { OriginMode } from '../../base/cot.ts';
import { createCircleEllipseShape } from '../../base/cot/ellipse.ts';
import { std, stdurl, server } from '../../std.ts';
import type { Feature, FeatureCollection } from '../../types.ts';
import type { paths } from '@cloudtak/api-types';
import OverlayManager from '../../base/overlay.ts';
import RouteEditor from '../../base/route-editor.ts';
import type { EditorState, Reroute, RouteFirstLeg } from '../../base/route-editor.ts';
import { readRoutePlan } from '../../base/route-plan.ts';
import type { LngLat, RouteOptions } from '../../base/route-plan.ts';
import { collectThreats } from '../../base/route-threats.ts';
import type { ThreatSource } from '../../base/route-threats.ts';

type AugmentedBasemapResponse = paths['/api/basemap']['get']['responses']['200']['content']['application/json']['items'][0];
import type { Polygon, Position, LineString, Feature as GeoJSONFeature, FeatureCollection as GeoJSONFeatureCollection } from 'geojson';
import type { useMapStore } from '../map.ts';

export enum DrawToolMode {
    STATIC = 'static',
    FREEHAND = 'freehand',
    SELECT = 'select',

    POINT = 'point',
    LINESTRING = 'linestring',
    SNAPPING = 'routesnap',
    POLYGON = 'polygon',
    RECTANGLE = 'angled-rectangle',
    CIRCLE = 'circle',
    SECTOR = 'sector',

    // Edytor trasy taklab (budowanie kliknięciami albo edycja trasy z planem)
    ROUTE = 'route',
}

/**
 * Flagi trybu select terra-draw. Trasy (b-m-r) nie da się chwycić i przenieść
 * w całości (wymaganie d specyfikacji edycji tras), zwykłej linii tak.
 */
export function selectFlags(lineDraggable: boolean) {
    return {
        polygon: {
            feature: {
                draggable: true,
                coordinates: {
                    snappable: true,
                    deletable: true,
                    midpoints: {
                        draggable: true
                    },
                    draggable: true,
                }
            }
        },
        linestring: {
            feature: {
                draggable: lineDraggable,
                coordinates: {
                    snappable: true,
                    deletable: true,
                    midpoints: {
                        draggable: true
                    },
                    draggable: true,
                }
            }
        },
        point: {
            feature: {
                draggable: true,
            }
        }
    };
}

export default class DrawTool {
    private draw: terraDraw.TerraDraw;

    // The DrawTool instance is stored with markRaw() in the map store, so any
    // state the UI renders must be individually reactive (refs/reactive objects)
    private _editing = shallowRef<COT | null>(null);

    private _mode = ref<DrawToolMode>(DrawToolMode.STATIC);

    // Bumped on every TerraDraw change event to drive reactivity for canFinish
    private _changeCount = ref(0);

    // Edytor trasy taklab; stan dla paska edycji i menu New Route
    private routeEditor: RouteEditor | null = null;
    private routeKind: 'build' | 'edit' | null = null;
    private routeCallsign = '';
    private _routeState: EditorState = {
        busy: ref(false),
        error: ref(''),
        waypoints: ref<LngLat[]>([]),
        menu: ref(null),
        summary: ref(''),
    };

    public get editing(): COT | null {
        return this._editing.value;
    }

    public set editing(cot: COT | null) {
        this._editing.value = cot;
    }

    public get mode(): DrawToolMode {
        return this._mode.value;
    }

    public set mode(mode: DrawToolMode) {
        this._mode.value = mode;
    }

    public route: {
        graph: Routing;
        finder: TerraRoute & {
            setNetwork: (network: GeoJSONFeatureCollection<LineString>) => void;
            expandNetwork: (network: GeoJSONFeatureCollection<LineString>) => void;
        };
        tiles: Map<string, GeoJSONFeatureCollection<LineString>>;
        zoom: number;
        layer: string;
        definitions: Map<string, AugmentedBasemapResponse>;
    };

    private mapStore: ReturnType<typeof useMapStore>;

    // Contains coordinates to allow snapping to
    public snapping: Set<[number, number]>;

    public point: {
        type: string,
    };

    public lasso: {
        loading: boolean;
        overlay: string;
    }

    private _snappingOptions = ref<string[]>(['No Snapping']);

    public get snappingOptions(): string[] {
        return this._snappingOptions.value;
    }

    public set snappingOptions(options: string[]) {
        this._snappingOptions.value = options;
    }

    public get snappingLayer(): string {
        return this.route.layer;
    }

    public set snappingLayer(layer: string) {
        if (this.route.layer !== layer) {
             this.route.tiles.clear();
             this.route.graph.setNetwork({ type: 'FeatureCollection', features: [] });
        }

        this.route.layer = layer;

        const def = this.route.definitions.get(layer);

        if (def) {
            this.route.zoom = def.maxzoom;
        }

        if (this.route.layer === 'No Snapping') {
            if (this.mode === DrawToolMode.SNAPPING) {
               this.start(DrawToolMode.LINESTRING);
            }
        } else {
            if (this.mode === DrawToolMode.LINESTRING) {
                this.start(DrawToolMode.SNAPPING);
            } else if (this.mode === DrawToolMode.SNAPPING) {
                this.start(DrawToolMode.SNAPPING);
            }
        }
    }

    public get canFinish(): boolean {
        // Access _changeCount to establish reactivity
        void this._changeCount.value;

        if (this.mode === DrawToolMode.SELECT) {
            return !!this.editing;
        }

        if (this.mode === DrawToolMode.ROUTE) {
            // waypoints jest odświeżane po każdej zmianie edytora
            void this._routeState.waypoints.value;
            return !this._routeState.busy.value && !!this.routeEditor && this.routeEditor.result() !== null;
        }

        const features = this.draw.getSnapshot();
        const drawn = features.find((f) =>
            f.properties.mode === this.mode
            && !f.properties.closingPoint
            && !f.properties.coordinatePoint
            && !f.properties.snappingPoint
            && !f.properties.midPoint
            && !f.properties.selectionPoint
        );

        if (!drawn) return false;

        if (this.mode === DrawToolMode.LINESTRING || this.mode === DrawToolMode.SNAPPING) {
            const coords = (drawn.geometry as LineString).coordinates;
            return coords.length >= 2;
        } else if (this.mode === DrawToolMode.POLYGON) {
            const coords = (drawn.geometry as Polygon).coordinates;
            // Polygon ring needs at least 4 positions (3 unique + closing)
            return coords.length > 0 && coords[0].length >= 4;
        }

        return true;
    }

    constructor(mapStore: ReturnType<typeof useMapStore>) {
        this.mapStore = mapStore;

        this.mapStore.map.on('moveend', async () => {
            if (this.mode !== DrawToolMode.SNAPPING) return;

            await this.updateGraph({
                expand: true
            });
        });


        const toCustom = (event: terraDraw.TerraDrawMouseEvent): Position | undefined => {
            let closest: {
                dist: number
                coord: Position
            } | undefined = undefined;

            for (const coord of this.snapping.values()) {
                const dist = distance([event.lng, event.lat], coord);

                if (!closest || (dist < closest.dist)) {
                    closest = { dist, coord }
                }
            }

            if (closest) {
                // Base Threshold / Math.pow(decayFactor, zoomLevel)
                const threshold = 1000 / Math.pow(2, this.mapStore.map.getZoom());

                if (closest.dist < threshold) {
                    return closest.coord;
                }

                return;
            } else {
                return;
            }
        }

        const routeFinder = new TerraRoute();

        const finder = Object.assign(routeFinder, {
            setNetwork: (network: GeoJSONFeatureCollection<LineString>) => routeFinder.buildRouteGraph(network),
            expandNetwork: (network: GeoJSONFeatureCollection<LineString>) => routeFinder.expandRouteGraph(network)
        });

        const graph = new Routing({
            network: {
                type: 'FeatureCollection' as const,
                features: []
            },
            useCache: true,
            routeFinder: finder
        })

        this.route = shallowReactive({
            finder,
            graph,
            tiles: new Map(),
            zoom: 12,
            layer: 'No Snapping',
            definitions: new Map()
        });

        const routeSnapMode = new TerraDrawRouteSnapMode({
            straightLineFallback: {
                canSnapBackToNetwork: true
            },
            routing: this.route.graph,
            maxPoints: 9999,
            styles: {
                lineStringColor: () => {
                    // RED
                    return '#990000';
                },
                routePointColor: () => {
                    // RED
                    return '#990000';
                }
            }
        });

        // Touch input emits no pointer moves between taps, so a tap in a click-move
        // draw gives no preview and leaves Freehand stuck - only allow drag to draw
        const drawInteraction = window.matchMedia('(pointer: coarse)').matches
            ? 'click-drag'
            : 'click-move-or-drag';

        this.draw = new terraDraw.TerraDraw({
            adapter: new TerraDrawMapLibreGLAdapter({
                map: this.mapStore.map,
                // @ts-expect-error TS is complaining
                lib: mapgl
            }),
            idStrategy: {
                isValidId: (id: string | number): boolean => {
                    return typeof id === "string"
                },
                getId: (function () {
                    return function () {
                        return randomUUID()
                    };
                })()
            },
            modes: [
                new terraDraw.TerraDrawPointMode({
                    editable: true
                }),
                new terraDraw.TerraDrawLineStringMode({
                    editable: true,
                    showCoordinatePoints: true,
                    snapping: { toCustom }
                }),
                new terraDraw.TerraDrawPolygonMode({
                    editable: true,
                    showCoordinatePoints: true,
                    snapping: { toCustom }
                }),
                routeSnapMode,
                new terraDraw.TerraDrawAngledRectangleMode({
                    showCoordinatePoints: true
                }),
                new terraDraw.TerraDrawFreehandMode({
                    drawInteraction
                }),
                new terraDraw.TerraDrawSectorMode({
                    showCoordinatePoints: true
                }),
                new terraDraw.TerraDrawCircleMode({
                    drawInteraction
                }),
                new terraDraw.TerraDrawSelectMode({
                    flags: selectFlags(true)
                })
            ]
        });

        this.draw.on('finish', async (id, context) => {
            if (context.action === "draw") {
                if (this.mode === DrawToolMode.STATIC || this.editing) {
                    return;
                } else if (this.mode === DrawToolMode.FREEHAND) {
                    const feat = this.draw.getSnapshotFeature(id);
                    if (!feat) throw new Error('Could not find underlying marker');
                    this.removeFeature(id);
                    this.stop();

                    if (!this.lasso.overlay || this.lasso.overlay === "Map Features") {
                        const touching = await this.mapStore.worker.db.touching(feat.geometry as Polygon);

                        for (const cot of touching.values()) {
                            this.mapStore.selected.set(cot.id, cot);
                        }
                    } else {
                        const ov = OverlayManager.loadedByName(this.lasso.overlay);
                        if (!ov) throw new Error('Could not find overlay');

                        if (ov.mode === 'mission' && ov.mode_id) {
                            const touching = await this.mapStore.worker.db.touching(feat.geometry as Polygon, {
                                mission: ov.mode_id
                            });

                            for (const cot of touching.values()) {
                                this.mapStore.selected.set(cot.id, cot);
                            }

                            return;
                        }

                        this.lasso.loading = true;

                        try {
                            const url = stdurl(`/api/basemap/${ov.mode_id}/feature`);

                            const fc = await std(url, {
                                method: 'POST',
                                body: {
                                    polygon: feat.geometry
                                }
                            }) as FeatureCollection;

                            mapStore.toImport = fc.features.map((f) => {
                                const id = randomUUID();

                                return {
                                    id,
                                    type: 'Feature',
                                    path: '/',
                                    properties: {
                                       id,
                                       type: 'u-d-p',
                                       how: 'h-g-i-g-o',
                                       color: '#00FF00',
                                       archived: true,
                                       time: new Date().toISOString(),
                                       start: new Date().toISOString(),
                                       stale: new Date().toISOString(),
                                       center: pointOnFeature(f).geometry.coordinates,
                                       callsign: String(f.properties?.title || 'New Feature')
                                    },
                                    geometry: f.geometry
                                }
                            });

                            this.lasso.loading = false;
                        } catch (err) {
                            this.lasso.loading = false;
                            console.error(err);
                            throw new Error('Error fetching lasso features', { cause: err });
                        }
                    }
                } else {
                    const storeFeat = this.draw.getSnapshotFeature(id);
                    if (!storeFeat) throw new Error('Could not find underlying marker');

                    const now = new Date();
                    const feat: Feature = {
                        id: String(id),
                        type: 'Feature',
                        path: '/',
                        properties: {
                            id: String(id),
                            type: 'u-d-p',
                            how: 'h-g-i-g-o',
                            archived: true,
                            callsign: 'New Feature',
                            time: now.toISOString(),
                            start: now.toISOString(),
                            stale: new Date(now.getTime() + 3600).toISOString(),
                            center: [0,0]
                        },
                        geometry: JSON.parse(JSON.stringify(storeFeat.geometry))
                    };

                    if (
                        this.mode === DrawToolMode.POLYGON
                        || this.mode === DrawToolMode.RECTANGLE
                        || this.mode === DrawToolMode.SECTOR
                    ) {
                        feat.properties.type = 'u-d-f';
                    } else if (this.mode === DrawToolMode.LINESTRING || this.mode === DrawToolMode.SNAPPING) {
                        feat.properties.type = 'u-d-f';
                    } else if (this.mode === DrawToolMode.CIRCLE) {
                        feat.properties.type = 'u-d-c-c';

                        const radius = storeFeat.properties.radiusKilometers ? (Number(storeFeat.properties.radiusKilometers) * 1000) : 100;

                        feat.properties.shape = createCircleEllipseShape(radius);
                    } else if (this.mode === DrawToolMode.POINT) {
                        feat.properties.type = this.point.type
                        feat.properties["marker-opacity"] = 1;

                        if (this.point.type === 'u-d-p') {
                            feat.properties["marker-color"] = '#00FF00';
                        }
                    }

                    this.removeFeature(id);

                    await this.stop();

                    await this.mapStore.worker.db.add(feat, {
                        authored: true
                    });

                    await this.mapStore.refresh();

                    router.push(`/cot/${feat.properties.id}`);
                }
            }
        })

        // Deselect event is for editing existing features
        this.draw.on('deselect', async () => {
            if (!this.editing) return;

            const feat = this.draw.getSnapshotFeature(this.editing.id);

            if (!feat) throw new Error('Could not find underlying marker');

            delete feat.properties.center;

            const editing = this.editing;

            await this.stop();

            await this.mapStore.worker.db.add(feat as Feature, {
                authored: true
            });

            await this.mapStore.refresh();

            if (editing && editing.origin.mode === OriginMode.MISSION && editing.origin.mode_id) {
                await this.mapStore.loadMission(editing.origin.mode_id);
            } else {
                await this.mapStore.worker.db.unhide(editing.id);
                await this.mapStore.refresh();
            }
        });

        this.draw.on('change', () => {
            this._changeCount.value++;
        });

        this.mode = DrawToolMode.STATIC;
        this.snapping = new Set();
        this.editing = null;

        this.point = reactive({
            type: this.mapStore.defaultPointType
        })

        this.lasso = reactive({
            loading: false,
            overlay: 'Map Features'
        })
    }

    async populateSnappingLayers(): Promise<void> {
        const { data } = await server.GET('/api/basemap', {
            params: {
                query: {
                    limit: 100,
                    page: 0,
                    order: 'asc',
                    sort: 'name',
                    filter: '',
                    snapping: true,
                    hidden: 'all',
                    overlay: true
                }
            }
        });

        this.route.definitions.clear();

        if (data && data.items.length) {
            for (const item of data.items) {
                item.minzoom = item.minzoom ? Number(item.minzoom) : 0;
                item.maxzoom = item.maxzoom ? Number(item.maxzoom) : 22;
                this.route.definitions.set(item.name, item);
            }

            this.snappingOptions = ['No Snapping'].concat(data.items.map((b) => b.name));
            this.mapStore.hasSnapping = true;
        } else {
            this.snappingOptions = ['No Snapping'];
            this.mapStore.hasSnapping = false;
        }
    }

    async updateGraph(
        opts: {
            expand?: boolean
        } = {}
    ): Promise<void> {
        let newFeatures: GeoJSONFeature<LineString>[] = [];

        const bounds = this.mapStore.map.getBounds();
        const geom: Polygon = {
            type: 'Polygon',
            coordinates: [[
                bounds.getNorthWest().toArray(),
                bounds.getNorthEast().toArray(),
                bounds.getSouthEast().toArray(),
                bounds.getSouthWest().toArray(),
                bounds.getNorthWest().toArray()
            ]]
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tiles = tilecover.tiles(geom as any, {
            min_zoom: this.route.zoom,
            max_zoom: this.route.zoom
        });

        const load: Promise<GeoJSONFeatureCollection<LineString>>[] = [];

        for (const tile of tiles) {
            const tileId = tile.join('/');
            if (this.route.tiles.has(tileId)) continue;

            const p = (async () => {
                 const [x, y, z] = tile;

                 const def = this.route.definitions.get(this.route.layer);
                 if (!def || !def.url) throw new Error('No definition found for layer');

                 let finalUrl = def.url
                     .replace('{z}', String(z))
                     .replace('{x}', String(x))
                     .replace('{y}', String(y));

                 // Remove extension (e.g. .pbf, .mvt) and append /features
                 finalUrl = finalUrl.replace(/\.[a-z0-9]+$/i, '') + '/features';

                 const url = new URL(finalUrl);
                 const { value: token } = await Preferences.get({ key: 'token' });
                 if (token) url.searchParams.set('token', token);
                 url.searchParams.set('type', 'LineString');
                 url.searchParams.set('multi', 'false');

                 try {
                     const fc = await std(url) as GeoJSONFeatureCollection<LineString>;
                     this.route.tiles.set(tileId, fc);
                     return fc;
                 } catch (err) {
                     console.error(err);
                     return { type: 'FeatureCollection', features: [] } as GeoJSONFeatureCollection<LineString>;
                 }
            })();

            load.push(p);
        }

        if (load.length) {
            const results = await Promise.all(load);
            newFeatures = results.flatMap(fc => fc.features);
        }

        if (newFeatures.length) {
            const newNetwork = {
                type: 'FeatureCollection',
                features: newFeatures
            } as GeoJSONFeatureCollection<LineString>;

            if (opts?.expand) {
                this.route.graph.expandRouteNetwork(newNetwork);
            } else {
                this.route.graph.setNetwork(newNetwork);
            }
        } else if (!opts?.expand) {
            // Initial load but no tiles found? Or all tiles already cached?
            // If all cached, and !expand, we should setNetwork to all cached (to be safe/consistent)
             const allFeatures = Array.from(this.route.tiles.values()).flatMap(fc => fc.features);
             this.route.graph.setNetwork({
                 type: 'FeatureCollection',
                 features: allFeatures
             } as GeoJSONFeatureCollection<LineString>);
        }

        const source = this.mapStore.map.getSource('snapping-graph-source') as mapgl.GeoJSONSource;

        const allFeatures = Array.from(this.route.tiles.values()).flatMap(fc => fc.features);
        const network = {
            type: 'FeatureCollection',
            features: allFeatures
        } as GeoJSONFeatureCollection<LineString>;

        if (source) {
            source.setData(network);
        } else {
            this.mapStore.map.addSource('snapping-graph-source', {
                type: 'geojson',
                data: network
            });
            this.mapStore.map.addLayer({
                id: 'snapping-graph-layer',
                type: 'line',
                source: 'snapping-graph-source',
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': '#5fb7ce',
                    'line-width': 2,
                    'line-dasharray': [2, 2],
                    'line-opacity': 0.8
                }
            });
        }
    }

    async removeNetwork(): Promise<void> {
        this.route.tiles.clear();
        this.route.graph.setNetwork({
            type: 'FeatureCollection',
            features: []
        });

        if (this.mapStore.map.getLayer('snapping-graph-layer')) {
            this.mapStore.map.removeLayer('snapping-graph-layer');
        }

        if (this.mapStore.map.getSource('snapping-graph-source')) {
            this.mapStore.map.removeSource('snapping-graph-source');
        }
    }


    async start(mode: DrawToolMode): Promise<void> {
        if (mode !== DrawToolMode.SNAPPING) {
            await this.removeNetwork();
        }

        this.point.type = this.mapStore.defaultPointType;

        if (mode === DrawToolMode.LINESTRING && this.route.layer !== 'No Snapping') {
            this.route.layer = 'No Snapping';
            this.route.tiles.clear();
            this.route.graph.setNetwork({ type: 'FeatureCollection', features: [] });
        }

        this.mode = mode;

        if (mode === DrawToolMode.SNAPPING) {
            await this.updateGraph();

            this.draw.start();

            this.draw.updateModeOptions(DrawToolMode.SNAPPING, {
                routing: this.route.graph,
            });

            this.draw.setMode(mode)
        } else {
            this.draw.start();
            this.draw.setMode(mode)

            this.snapping = await this.mapStore.worker.db.snapping(
                this.mapStore.map.getBounds().toArray()
            );
        }
    }

    async finish(): Promise<void> {
        if (this.mode === DrawToolMode.ROUTE) {
            await this.finishRoute();
            return;
        }

        if (this.mode === DrawToolMode.SELECT && this.editing) {
            // For editing mode, deselectFeature triggers the 'deselect' handler which saves
            this.draw.deselectFeature(this.editing.id);
        } else if (
            this.mode === DrawToolMode.LINESTRING
            || this.mode === DrawToolMode.POLYGON
            || this.mode === DrawToolMode.SNAPPING
        ) {
            // These modes respond to Enter key to finish drawing
            const canvas = this.mapStore.map.getCanvas();
            canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        } else {
            // For modes that auto-complete (point, circle, rectangle, sector, freehand),
            // look for a completed feature in the snapshot and process it
            const features = this.draw.getSnapshot();
            const drawn = features.find((f) =>
                f.properties.mode === this.mode
                && !f.properties.closingPoint
                && !f.properties.coordinatePoint
                && !f.properties.snappingPoint
                && !f.properties.midPoint
                && !f.properties.selectionPoint
            );

            if (drawn) {
                const now = new Date();
                const feat: Feature = {
                    id: String(drawn.id),
                    type: 'Feature',
                    path: '/',
                    properties: {
                        id: String(drawn.id),
                        type: 'u-d-p',
                        how: 'h-g-i-g-o',
                        archived: true,
                        callsign: 'New Feature',
                        time: now.toISOString(),
                        start: now.toISOString(),
                        stale: new Date(now.getTime() + 3600).toISOString(),
                        center: [0, 0]
                    },
                    geometry: JSON.parse(JSON.stringify(drawn.geometry))
                };

                if (this.mode === DrawToolMode.RECTANGLE || this.mode === DrawToolMode.SECTOR) {
                    feat.properties.type = 'u-d-f';
                } else if (this.mode === DrawToolMode.CIRCLE) {
                    feat.properties.type = 'u-d-c-c';
                    const radius = drawn.properties.radiusKilometers ? (Number(drawn.properties.radiusKilometers) * 1000) : 100;
                    feat.properties.shape = createCircleEllipseShape(radius);
                } else if (this.mode === DrawToolMode.POINT) {
                    feat.properties.type = this.point.type;
                    feat.properties["marker-opacity"] = 1;
                    feat.properties["marker-color"] = this.point.type === 'u-d-p' ? '#00FF00' : '#FFFFFF';
                }

                this.removeFeature(drawn.id as string);
                await this.stop();
                await this.mapStore.worker.db.add(feat, { authored: true });
                await this.mapStore.refresh();
                router.push(`/cot/${feat.properties.id}`);
            } else {
                await this.stop();
            }
        }
    }

    async stop(refresh = true): Promise<void> {
        const previous = this.mode;
        this.mode = DrawToolMode.STATIC;

        this.stopRouteEditor();

        await this.removeNetwork();

        // Reset cursor to default BEFORE stopping draw operations
        this.mapStore.map.getCanvas().style.cursor = '';

        // Edytor trasy nie uruchamia terra-draw
        if (previous !== DrawToolMode.ROUTE) this.draw.stop();
        this.snapping.clear()

        if (!this.editing) return;

        await Filter.delete({ external: `hidden-${this.editing.id}` });

        if (refresh) {
            if (this.editing && this.editing.origin.mode === OriginMode.MISSION && this.editing.origin.mode_id) {
                await this.mapStore.loadMission(this.editing.origin.mode_id);
                this.editing = null;
            } else {
                await this.mapStore.worker.db.unhide(this.editing.id);
                this.editing = null;

                await this.mapStore.refresh();
            }
        }
    }

    async edit(cot: COT) {
        if (cot.is_route && readRoutePlan(cot.as_feature({ clone: true }))) {
            await this.editRoute(cot);
            return;
        }

        this.editing = cot;

        // start() uruchamia terra-draw dopiero po await; bez czekania updateModeOptions
        // trafia w wyłączony TerraDraw („Terra Draw is not enabled”)
        await this.start(DrawToolMode.SELECT);

        // Trasy nie da się przenieść w całości; zwykłą linię tak
        this.draw.updateModeOptions(DrawToolMode.SELECT, { flags: selectFlags(!cot.is_route) });

        try {
            const feat = cot.as_feature({ clone: true });
            if (feat.geometry.type === 'Polygon') {
                feat.properties.mode = 'polygon';
            } else if (feat.geometry.type === 'LineString') {
                feat.properties.mode = 'linestring';
            } else if (feat.geometry.type === 'Point') {
                feat.properties.mode = 'point';
            }

            coordEach(feat, (coord) => {
                if (coord.length > 2) {
                    coord.splice(2, coord.length - 2);
                }

                // Ensure precision is within bounds
                for (let i = 0; i < coord.length; i++) {
                    coord[i] = Math.round(coord[i] * Math.pow(10, 9)) / Math.pow(10, 9);
                }
            });

            await Filter.create(
                cot.properties.callsign + ' Hidden',
                `hidden-${cot.id}`,
                'AtlasDatabase',
                true,
                `id = "${cot.id}"`
           )

            if (cot.origin.mode === OriginMode.MISSION && cot.origin.mode_id) {
                await this.mapStore.loadMission(cot.origin.mode_id);
            } else {
                await this.mapStore.worker.db.hide(cot.id);
                await this.mapStore.refresh();
            }

            const errorStatus = this.draw.addFeatures([feat as terraDraw.GeoJSONStoreFeatures]).filter((status) => {
                return !status.valid;
            });

            if (errorStatus.length) {
                throw new Error('Error editing this feature: ' + errorStatus[0].reason)
            }

            this.draw.selectFeature(cot.id);
        } catch (err) {
            await this.stop();

            throw err;
        }
    }

    /**
     * Budowanie trasy kliknięciami (menu New Route, start wskazany na mapie):
     * kolejne kliknięcia mapy dopisują punkty na koniec trasy.
     */
    async buildRoute(opts: { travelMode: string; options?: RouteOptions; start: LngLat; callsign?: string }): Promise<void> {
        if (this.mode !== DrawToolMode.STATIC) await this.stop();

        this.routeKind = 'build';
        this.routeCallsign = opts.callsign ?? '';
        this.startRouteEditor({ mode: 'build', travelMode: opts.travelMode, options: opts.options, waypoints: [opts.start] });
    }

    // Stan edytora trasy dla paska edycji; pola Ref są prywatne jak _mode i _editing,
    // bo DrawTool siedzi w sklepie Pinia, który odpakowuje publiczne Ref-y w typie
    public get routeBusy(): boolean {
        return this._routeState.busy.value;
    }

    public get routeError(): string {
        return this._routeState.error.value;
    }

    public get routeSummary(): string {
        return this._routeState.summary.value;
    }

    public get routeWaypoints(): LngLat[] {
        return this._routeState.waypoints.value;
    }

    public get routeWaypointCount(): number {
        return this._routeState.waypoints.value.length;
    }

    public get routeMenu(): null | { index: number; x: number; y: number } {
        return this._routeState.menu.value;
    }

    public set routeMenu(menu: null | { index: number; x: number; y: number }) {
        this._routeState.menu.value = menu;
    }

    /** 'build', 'edit' albo null, gdy edytor trasy jest zamknięty. */
    get routeEditorKind(): 'build' | 'edit' | null {
        return this.routeKind;
    }

    /** Nazwa trasy zapisywanej z trybu budowania (menu ustawia ją z pól startu i celu). */
    setRouteCallsign(callsign: string): void {
        this.routeCallsign = callsign;
    }

    /** Tryb trasy w otwartym edytorze (id trybu dostawcy taklab), pusty bez edytora. */
    public get routeTravelMode(): string {
        return this.routeEditor?.travel ?? '';
    }

    /** Opcje przełaju w otwartym edytorze (z planu trasy albo ustawione w trakcie). */
    public get routeOptions(): RouteOptions | undefined {
        return this.routeEditor?.options;
    }

    /** Zmiana trybu trasy w otwartym edytorze; false, gdy trybu nie zmieniono. */
    async setRouteTravelMode(travelMode: string): Promise<boolean> {
        if (!this.routeEditor) return false;
        return await this.routeEditor.setTravelMode(travelMode);
    }

    /** Zmiana opcji przełaju w otwartym edytorze; false, gdy opcji nie zmieniono. */
    async setRouteOptions(options: RouteOptions | undefined): Promise<boolean> {
        if (!this.routeEditor) return false;
        return await this.routeEditor.setOptions(options);
    }

    /** Usunięcie punktu usera z otwartego edytora trasy. */
    async removeRouteWaypoint(index: number): Promise<void> {
        if (this.routeEditor) await this.routeEditor.removeWaypoint(index);
    }

    private async editRoute(cot: COT): Promise<void> {
        if (this.mode !== DrawToolMode.STATIC) await this.stop();

        this.editing = cot;
        this.routeKind = 'edit';

        await Filter.create(
            cot.properties.callsign + ' Hidden',
            `hidden-${cot.id}`,
            'AtlasDatabase',
            true,
            `id = "${cot.id}"`
        );

        if (cot.origin.mode === OriginMode.MISSION && cot.origin.mode_id) {
            await this.mapStore.loadMission(cot.origin.mode_id);
        } else {
            await this.mapStore.worker.db.hide(cot.id);
            await this.mapStore.refresh();
        }

        try {
            this.startRouteEditor({ mode: 'edit', travelMode: '', feature: cot.as_feature({ clone: true }) as Feature });
        } catch (err) {
            await this.stop();
            throw err;
        }
    }

    private startRouteEditor(opts: { mode: 'build' | 'edit'; travelMode: string; options?: RouteOptions; waypoints?: LngLat[]; feature?: Feature }): void {
        this._routeState.busy.value = false;
        this._routeState.error.value = '';
        this._routeState.menu.value = null;

        const threatsFor = async (points: LngLat[]) => await collectThreats(
            this.mapStore.worker.db as unknown as ThreatSource, points,
        );

        const reroute: Reroute = async (body) => {
            const fc = await std('/api/search/route/legs', {
                method: 'POST',
                body: { provider: 'taklab', ...body, threats: await threatsFor(body.waypoints) },
            }) as FeatureCollection;
            if (!fc.features.length) throw new Error('Usługa tras nie zwróciła trasy.');
            return fc.features[0];
        };

        const first: RouteFirstLeg = async (travelMode, stops, options) => {
            const fc = await std('/api/search/route/plan', {
                method: 'POST',
                body: {
                    provider: 'taklab',
                    callsign: this.routeCallsign || 'Trasa',
                    travelMode,
                    waypoints: stops,
                    options,
                    threats: await threatsFor(stops),
                },
            }) as FeatureCollection;
            if (!fc.features.length) throw new Error('Usługa tras nie zwróciła trasy.');
            return fc.features[0];
        };

        this.routeEditor = new RouteEditor(this.mapStore.map as unknown as ConstructorParameters<typeof RouteEditor>[0], {
            mode: opts.mode,
            travelMode: opts.travelMode,
            options: opts.options,
            feature: opts.feature,
            waypoints: opts.waypoints,
            reroute,
            first,
            state: this._routeState,
        });

        this.mode = DrawToolMode.ROUTE;
        this.routeEditor.start();
    }

    private stopRouteEditor(): void {
        if (!this.routeEditor) return;
        this.routeEditor.destroy();
        this.routeEditor = null;
        this.routeKind = null;
        this._routeState.menu.value = null;
        this._routeState.waypoints.value = [];
    }

    private async finishRoute(): Promise<void> {
        if (!this.routeEditor) return;
        const result = this.routeEditor.result();
        if (!result) return;

        const kind = this.routeKind;
        const editing = this.editing;

        if (kind === 'edit') {
            delete (result.properties as Record<string, unknown>).center;
            // stop() przywraca widoczność edytowanej trasy
            await this.stop();
            await this.mapStore.worker.db.add(result, { authored: true });
            await this.mapStore.refresh();
            if (editing && editing.origin.mode === OriginMode.MISSION && editing.origin.mode_id) {
                await this.mapStore.loadMission(editing.origin.mode_id);
            }
            return;
        }

        if (this.routeCallsign) result.properties.callsign = this.routeCallsign;
        await this.stop();

        const cot = await this.mapStore.worker.db.add(result, { authored: true });
        await this.mapStore.refresh();
        if (cot) {
            cot.flyTo();
            router.push(`/cot/${cot.id}`);
        }
    }

    getFeature(id: GeoJSONFeatureId) {
        return this.draw.getSnapshotFeature(id);
    }

    removeFeature(id: GeoJSONFeatureId): void {
        return this.draw.removeFeatures([id]);
    }
}
