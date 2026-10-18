import { Static, Type } from '@sinclair/typebox';
import { BasemapProtocol, TileJSONActions } from '../lib/interface-basemap.js';
import { fromProtocol } from '../lib/factory-basemap.js';
import { basemapTileJSON, profileAssetTileJSON } from '../lib/tilejson.js';
import type ConfigStateless from '../config.js';
import ProfileOverlayControl, { DUPLICATE_CONSTRAINT } from '../../common/control/profile-overlay.js';
import Schema from '@openaddresses/batch-schema';
import { GenericListOrder } from '@openaddresses/batch-generic';
import Err from '@openaddresses/batch-error';
import Auth, { AuthUser } from '../../common/auth.js';
import { BasemapTerrain_Encoding } from '../../common/enums.js';
import { ProfileOverlay, ProfileOverlayGroup, ProfileOverlayFavorite } from '../../common/schema.js';
import { StandardResponse, ProfileOverlayResponse, ProfileOverlayGroupResponse, ProfileOverlayFavoriteResponse } from '../../common/types.js';
import ConnectionEvents, { ConnectionEventDataType, ConnectionEventAction } from '../lib/connection-events.js';
import { sql, and, eq, asc } from 'drizzle-orm';
import * as Default from '../lib/limits.js';
import { subscribeSharedMission } from '../lib/user/shared-mission.js';

// Upstream documents vary in shape: only `tiles` is required. Response validation strips unlisted keys.
const OverlayTileJSON = Type.Object({
    tilejson: Type.Optional(Type.String()),
    version: Type.Optional(Type.String()),
    scheme: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    attribution: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    format: Type.Optional(Type.String()),
    encoding: Type.Optional(Type.String()),
    tileSize: Type.Optional(Type.Number()),
    minzoom: Type.Optional(Type.Number()),
    maxzoom: Type.Optional(Type.Number()),
    tiles: Type.Array(Type.String()),
    bounds: Type.Optional(Type.Array(Type.Number())),
    center: Type.Optional(Type.Array(Type.Number())),
    vector_layers: Type.Optional(Type.Array(Type.Object({
        id: Type.String(),
        fields: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        minzoom: Type.Optional(Type.Number()),
        maxzoom: Type.Optional(Type.Number()),
        description: Type.Optional(Type.String()),
    }))),
});

const AugmentedProfileOverlayResponse = Type.Composite([
    ProfileOverlayResponse,
    Type.Object({
        actions: TileJSONActions,
        attribution: Type.String({ default: '', description: 'Attribution of the underlying basemap, empty if not applicable' }),
        encoding: Type.Optional(Type.Enum(BasemapTerrain_Encoding)),
        tilejson: Type.Union([Type.Null(), OverlayTileJSON], {
            description: `
                TileJSON for the overlay's tile source, derived from the underlying Basemap or hosted asset
                at request time - never persisted server-side. Tile URLs are token-free; clients append
                their own session token. Null for overlays without a tile source (missions) or when the
                document could not be resolved.
            `,
        }),
    }),
]);

type SerializableProfileOverlay = Omit<Static<typeof ProfileOverlayResponse>, 'opacity'> & {
    opacity: number | string;
};

function serializeOverlay(
    overlay: SerializableProfileOverlay,
    extras: {
        actions: Static<typeof TileJSONActions>;
        encoding?: BasemapTerrain_Encoding;
        attribution?: string;
        tilejson: Static<typeof OverlayTileJSON> | null;
    },
): Static<typeof AugmentedProfileOverlayResponse> {
    return {
        ...overlay,
        opacity: Number(overlay.opacity),
        actions: extras.actions,
        attribution: extras.attribution ?? '',
        tilejson: extras.tilejson,
        ...(extras.encoding ? { encoding: extras.encoding } : {}),
    } as Static<typeof AugmentedProfileOverlayResponse>;
}

// Null on failure so an unreachable upstream never drops the overlay from the list
async function resolveTileJSON(
    overlayId: number,
    resolve: () => Promise<Static<typeof OverlayTileJSON>>,
): Promise<Static<typeof OverlayTileJSON> | null> {
    try {
        return await resolve();
    } catch (err) {
        console.error(`Could not resolve TileJSON for overlay ${overlayId}`, err);
        return null;
    }
}

async function augmentOverlay(
    config: ConfigStateless,
    overlay: SerializableProfileOverlay,
    user: AuthUser,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    basemap?: any,
): Promise<Static<typeof AugmentedProfileOverlayResponse>> {
    if (overlay.mode === 'basemap' || overlay.mode === 'overlay') {
        if (!overlay.mode_id) throw new Err(500, null, 'Overlay missing mode_id');
        if (!basemap) basemap = await config.models.Basemap.from(parseInt(overlay.mode_id));

        return serializeOverlay(overlay, {
            actions: fromProtocol(basemap.protocol, basemap).actions(),
            encoding: basemap.type === 'raster-dem' ? basemap.encoding : undefined,
            attribution: basemap.attribution || '',
            tilejson: await resolveTileJSON(overlay.id, () => basemapTileJSON(config, basemap, { upstreamToken: user.token })),
        });
    }

    let tilejson: Static<typeof OverlayTileJSON> | null = null;
    if (overlay.mode === 'profile') {
        tilejson = await resolveTileJSON(overlay.id, () => profileAssetTileJSON(config, {
            email: user.email,
            owner: overlay.username,
            asset: ProfileOverlayControl.assetName(overlay),
        }));
    }

    return serializeOverlay(overlay, { actions: fromProtocol().actions(), tilejson });
}

const GROUP_NAME_MAX = 64;

/** Trimmed group name, or a 400 when it is empty or longer than GROUP_NAME_MAX */
function groupName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed.length || trimmed.length > GROUP_NAME_MAX) {
        throw new Err(400, null, `Group name must be 1-${GROUP_NAME_MAX} characters`);
    }
    return trimmed;
}

const FAVORITE_KEY_MAX = 256;
const FAVORITES_MAX = 1000;

/** `${mode}:${mode_id}` with both parts present, or a 400 */
function favoriteKey(key: string): string {
    if (key.length > FAVORITE_KEY_MAX || !/^[a-z0-9_-]+:.+$/.test(key)) {
        throw new Err(400, null, `Favorite key must be "<mode>:<mode_id>" of at most ${FAVORITE_KEY_MAX} characters`);
    }
    return key;
}

export default async function router(schema: Schema, config: ConfigStateless) {
    const overlayControl = new ProfileOverlayControl(config);

    // Registered before /profile/overlay/:overlay so "group" is never parsed as an overlay id
    await schema.get('/profile/overlay/group', {
        name: 'List Overlay Groups',
        group: 'ProfileOverlayGroup',
        description: 'Return the user defined groups of Profile Overlays, ordered by position',
        res: Type.Object({
            total: Type.Integer(),
            items: Type.Array(ProfileOverlayGroupResponse),
        }),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);

            const list = await config.models.ProfileOverlayGroup.list({
                limit: Infinity,
                sort: 'pos',
                order: GenericListOrder.ASC,
                where: eq(ProfileOverlayGroup.username, user.email),
            });

            res.json({
                total: list.total,
                items: list.items.sort((a, b) => a.pos - b.pos || a.id - b.id),
            });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/profile/overlay/group', {
        name: 'Create Overlay Group',
        group: 'ProfileOverlayGroup',
        description: 'Create a user defined group of Profile Overlays',
        body: Type.Object({
            name: Type.String(),
            pos: Type.Optional(Type.Integer()),
            collapsed: Type.Optional(Type.Boolean()),
        }),
        res: ProfileOverlayGroupResponse,
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);

            // A new group goes to the top of the Overlays menu (and of the map
            // stack): one below the lowest position in use
            let pos = req.body.pos;
            if (pos === undefined) {
                const [min] = await config.pg.select({
                    pos: sql<number | null>`min(${ProfileOverlayGroup.pos})`,
                }).from(ProfileOverlayGroup).where(eq(ProfileOverlayGroup.username, user.email));

                pos = min && min.pos !== null ? Number(min.pos) - 1 : 0;
            }

            const group = await config.models.ProfileOverlayGroup.generate({
                username: user.email,
                name: groupName(req.body.name),
                pos,
                collapsed: req.body.collapsed ?? false,
            });

            res.json(group);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.patch('/profile/overlay/group/:group', {
        name: 'Update Overlay Group',
        group: 'ProfileOverlayGroup',
        description: 'Rename, reorder or collapse a user defined group of Profile Overlays',
        params: Type.Object({
            group: Type.Integer(),
        }),
        body: Type.Object({
            name: Type.Optional(Type.String()),
            pos: Type.Optional(Type.Integer()),
            collapsed: Type.Optional(Type.Boolean()),
        }),
        res: ProfileOverlayGroupResponse,
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);

            const own = sql`id = ${req.params.group} AND username = ${user.email}`;
            await config.models.ProfileOverlayGroup.from(own);

            const group = await config.models.ProfileOverlayGroup.commit(own, {
                name: req.body.name !== undefined ? groupName(req.body.name) : undefined,
                pos: req.body.pos,
                collapsed: req.body.collapsed,
                updated: sql`Now()`,
            });

            res.json(group);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.delete('/profile/overlay/group/:group', {
        name: 'Delete Overlay Group',
        group: 'ProfileOverlayGroup',
        description: 'Delete a user defined group - its overlays are kept and become ungrouped',
        params: Type.Object({
            group: Type.Integer(),
        }),
        res: StandardResponse,
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);

            const own = sql`id = ${req.params.group} AND username = ${user.email}`;
            await config.models.ProfileOverlayGroup.from(own);

            // group_id is ON DELETE SET NULL - member overlays stay and become ungrouped
            await config.models.ProfileOverlayGroup.delete(own);

            res.json({
                status: 200,
                message: 'Overlay Group Removed',
            });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/profile/overlay/favorite', {
        name: 'List Overlay Favorites',
        group: 'ProfileOverlayFavorite',
        description: 'Return the overlays the user starred, as `<mode>:<mode_id>` keys, oldest first',
        res: Type.Object({
            total: Type.Integer(),
            items: Type.Array(Type.Object({
                key: Type.String(),
                created: Type.String(),
            })),
        }),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);

            const items = await config.pg.select({
                key: ProfileOverlayFavorite.key,
                created: ProfileOverlayFavorite.created,
            })
                .from(ProfileOverlayFavorite)
                .where(eq(ProfileOverlayFavorite.username, user.email))
                .orderBy(asc(ProfileOverlayFavorite.created), asc(ProfileOverlayFavorite.key));

            res.json({ total: items.length, items });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.put('/profile/overlay/favorite', {
        name: 'Add Overlay Favorite',
        group: 'ProfileOverlayFavorite',
        description: 'Star an overlay - adding a key that is already starred changes nothing',
        body: Type.Object({
            key: Type.String({ description: '`<mode>:<mode_id>`, e.g. "overlay:12" or "live:adsb"' }),
        }),
        res: Type.Omit(ProfileOverlayFavoriteResponse, ['username']),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            const key = favoriteKey(req.body.key);

            const own = and(eq(ProfileOverlayFavorite.username, user.email), eq(ProfileOverlayFavorite.key, key));

            const [existing] = await config.pg.select().from(ProfileOverlayFavorite).where(own);
            if (!existing) {
                const count = await config.models.ProfileOverlayFavorite.count({
                    where: eq(ProfileOverlayFavorite.username, user.email),
                });
                if (count >= FAVORITES_MAX) throw new Err(400, null, `At most ${FAVORITES_MAX} favorites are allowed`);

                await config.pg.insert(ProfileOverlayFavorite)
                    .values({ username: user.email, key })
                    .onConflictDoNothing();
            }

            const [favorite] = await config.pg.select({
                key: ProfileOverlayFavorite.key,
                created: ProfileOverlayFavorite.created,
            }).from(ProfileOverlayFavorite).where(own);

            res.json(favorite);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.delete('/profile/overlay/favorite', {
        name: 'Delete Overlay Favorite',
        group: 'ProfileOverlayFavorite',
        description: 'Unstar an overlay - a key that is not starred is not an error',
        query: Type.Object({
            key: Type.String(),
        }),
        res: StandardResponse,
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);

            await config.pg.delete(ProfileOverlayFavorite).where(and(
                eq(ProfileOverlayFavorite.username, user.email),
                eq(ProfileOverlayFavorite.key, req.query.key),
            ));

            res.json({
                status: 200,
                message: 'Overlay Favorite Removed',
            });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/profile/overlay', {
        name: 'Get Overlays',
        group: 'ProfileOverlays',
        description: `
            Return a list of Profile Overlay's that are curently active.

            Each item is checked to ensure it is still present and if not the overlay is removed from the list
            before being returned.
        `,
        query: Type.Object({
            limit: Default.Limit,
            page: Default.Page,
            order: Default.Order,
            sort: Type.String({
                default: 'pos',
                enum: Object.keys(ProfileOverlay),
            }),
        }),
        res: Type.Object({
            total: Type.Integer(),
            removed: Type.Array(ProfileOverlayResponse),
            available: Type.Object({
                terrain: Type.Boolean(),
                snapping: Type.Boolean(),
            }),
            items: Type.Array(AugmentedProfileOverlayResponse),
        }),

    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);

            await overlayControl.ensureDefaultTerrain(user.email);

            // taklab: ponowienie zapisu na misję wspólną - przy pierwszym logowaniu OTS mógł
            // jeszcze nie znać urządzenia (400 Invalid UID), przy ładowaniu mapy połączenie już jest
            await subscribeSharedMission(config, user.email, { exclude: user.session });

            const [overlays, terrain, snapping] = await Promise.all([
                config.models.ProfileOverlay.list({
                    limit: req.query.limit,
                    page: req.query.page,
                    order: req.query.order,
                    sort: req.query.sort,
                    where: sql`
                        username = ${user.email}
                    `,
                }),
                config.models.Basemap.count({
                    where: sql`
                        USERNAME IS NULL
                        AND type = 'raster-dem'
                    `,
                }),
                config.models.Basemap.count({
                    where: sql`
                        USERNAME IS NULL
                        AND type = 'vector'
                        AND id IN (
                            SELECT basemap
                            FROM basemaps_vector
                            WHERE snapping_enabled = true
                        )
                    `,
                }),
            ]);

            const available = {
                terrain: terrain > 0,
                snapping: snapping > 0,
            };

            const pruned = await overlayControl.prune(user.email, overlays.items);

            const items = await Promise.all(pruned.kept.map(({ overlay, basemap }) => augmentOverlay(config, overlay, user, basemap)));
            const removed = pruned.removed.map(overlay => ({ ...overlay, opacity: Number(overlay.opacity) }));
            const total = overlays.total - removed.length;

            res.json({ removed, total, items, available });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/profile/overlay/:overlay', {
        name: 'Get Overlay',
        group: 'ProfileOverlay',
        description: 'Get Profile Overlay',
        params: Type.Object({
            overlay: Type.Integer(),
        }),
        res: AugmentedProfileOverlayResponse,
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);

            const overlay = await overlayControl.from(user.email, req.params.overlay);

            res.json(await augmentOverlay(config, overlay, user));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.patch('/profile/overlay/:overlay', {
        name: 'Update Overlay',
        group: 'ProfileOverlay',
        description: 'Update Profile Overlay',
        params: Type.Object({
            overlay: Type.Integer(),
        }),
        body: Type.Object({
            pos: Type.Optional(Type.Integer()),
            name: Type.Optional(Type.String()),
            active: Type.Optional(Type.Boolean()),
            frequency: Type.Optional(Type.Union([Type.Null(), Type.Number()])),
            iconset: Type.Optional(Type.Union([Type.Null(), Type.String()])),
            type: Type.Optional(Type.String()),
            opacity: Type.Optional(Type.Number()),
            visible: Type.Optional(Type.Boolean()),
            url: Type.Optional(Type.String()),
            mode_id: Type.Optional(Type.String()),
            styles: Type.Optional(Type.Array(Type.Unknown())),
            group_id: Type.Optional(Type.Union([Type.Null(), Type.Integer()], {
                description: 'User defined Overlay Group the overlay belongs to, null to ungroup',
            })),
        }),
        res: AugmentedProfileOverlayResponse,
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);

            if (req.body.group_id !== undefined && req.body.group_id !== null) {
                const owned = await config.models.ProfileOverlayGroup.count({
                    where: and(eq(ProfileOverlayGroup.id, req.body.group_id), eq(ProfileOverlayGroup.username, user.email)),
                });

                if (!owned) throw new Err(400, null, 'Overlay Group does not exist');
            }

            if (req.body.styles && req.body.styles.length) {
                const type = req.body.type || (await overlayControl.from(user.email, req.params.overlay)).type;
                BasemapProtocol.isValidStyle(type, req.body.styles);
            }

            const overlay = await overlayControl.patch(user.email, req.params.overlay, req.body);

            const serialized = await augmentOverlay(config, overlay, user);

            // Include the serialized overlay so receiving clients can apply
            // it directly instead of re-listing overlays (which is slow due
            // to per-overlay existence checks)
            ConnectionEvents.user(config, user, ConnectionEventDataType.OVERLAY, ConnectionEventAction.UPDATE, overlay.id, serialized);

            res.json(serialized);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/profile/overlay', {
        name: 'Create Overlay',
        group: 'ProfileOverlay',
        description: `
            Create Profile Overlay

            Overlays are unique per user & URL. If an overlay with the given URL already exists
            the request is treated as a patch: the supplied fields are applied to the existing
            overlay and it is returned. The mode of an existing overlay cannot be changed.
        `,
        body: Type.Object({
            name: Type.String(),
            active: Type.Optional(Type.Boolean()),
            pos: Type.Optional(Type.Integer()),
            type: Type.Optional(Type.String()),
            opacity: Type.Optional(Type.Number()),
            frequency: Type.Optional(Type.Union([Type.Null(), Type.Number()])),
            iconset: Type.Optional(Type.Union([Type.Null(), Type.String()])),
            visible: Type.Optional(Type.Boolean()),
            mode: Type.String(),
            mode_id: Type.Optional(Type.String()),
            styles: Type.Optional(Type.Array(Type.Unknown())),
            token: Type.Optional(Type.String()),
            url: Type.String(),
        }),
        res: AugmentedProfileOverlayResponse,
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);

            if (req.body.styles && req.body.styles.length) {
                const existing = await overlayControl.byUrl(user.email, ProfileOverlayControl.normalizeUrl(req.body.mode, req.body.url));
                BasemapProtocol.isValidStyle(req.body.type || existing?.type || 'raster', req.body.styles);
            }

            const { overlay, created } = await overlayControl.upsert(user.email, req.body);

            const serialized = await augmentOverlay(config, overlay, user);

            // Include the serialized overlay so receiving clients can apply
            // it directly instead of re-listing overlays (which is slow due
            // to per-overlay existence checks)
            ConnectionEvents.user(
                config,
                user,
                ConnectionEventDataType.OVERLAY,
                created ? ConnectionEventAction.CREATE : ConnectionEventAction.UPDATE,
                overlay.id,
                serialized,
            );

            res.json(serialized);
        } catch (err) {
            if (String(err).includes(DUPLICATE_CONSTRAINT)) {
                Err.respond(new Err(400, err instanceof Error ? err : new Error(String(err)), 'Overlay appears to exist - cannot add duplicate'), res);
            } else {
                Err.respond(err, res);
            }
        }
    });

    await schema.delete('/profile/overlay', {
        name: 'delete Overlay',
        group: 'ProfileOverlay',
        description: 'Create Profile Overlay',
        query: Type.Object({
            id: Type.String(),
        }),
        res: StandardResponse,
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);

            const overlay = await overlayControl.delete(user.email, parseInt(String(req.query.id)));

            ConnectionEvents.user(config, user, ConnectionEventDataType.OVERLAY, ConnectionEventAction.DELETE, overlay.id);

            res.json({
                status: 200,
                message: 'Overlay Removed',
            });
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
