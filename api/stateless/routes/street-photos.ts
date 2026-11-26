import { Type } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth from '../../common/auth.js';
import type ConfigStateless from '../config.js';
import { streetPhotosControl, MAX_RADIUS_M } from '../lib/control/street-photos.js';

const Id = Type.String({ pattern: '^[A-Za-z0-9-]{1,64}$' });

// Nullable fields as a type list: batch-schema coerces types inside anyOf.
const NullableString = Type.Unsafe<string | null>({ type: ['string', 'null'] });
const NullableNumber = Type.Unsafe<number | null>({ type: ['number', 'null'] });

const Photo = Type.Object({
    id: Type.String(),
    collection: Type.String(),
    lon: Type.Number(),
    lat: Type.Number(),
    azimuth: NullableNumber,
    panorama: Type.Boolean(),
    fov: NullableNumber,
    taken_at: NullableString,
    author: NullableString,
    license: NullableString,
    provider: Type.String(),
});

export default async function router(schema: Schema, config: ConfigStateless) {
    await schema.get('/street-photos', {
        name: 'Street Photos Near',
        group: 'StreetPhotos',
        description: 'taklab: street-level photos (Panoramax) within radius metres of a point; enabled=false when switched off',
        security: Auth.security({}),
        query: Type.Object({
            lon: Type.Number({ minimum: -180, maximum: 180 }),
            lat: Type.Number({ minimum: -90, maximum: 90 }),
            radius: Type.Optional(Type.Number({ minimum: 10, maximum: MAX_RADIUS_M })),
        }),
        res: Type.Object({
            enabled: Type.Boolean(),
            provider: NullableString,
            attribution: NullableString,
            truncated: Type.Boolean(),
            photos: Type.Array(Photo),
        }),
    }, async (req, res) => {
        try {
            await Auth.as_user(config, req);
            res.json(await streetPhotosControl.search(req.query.lon, req.query.lat, req.query.radius));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/street-photos/:collection/:id/:size', {
        name: 'Street Photo Image',
        group: 'StreetPhotos',
        description: 'taklab: one street-level photo, streamed by the server (token in the query for <img src>)',
        params: Type.Object({
            collection: Id,
            id: Id,
            size: Type.Union([Type.Literal('thumb'), Type.Literal('sd'), Type.Literal('hd')]),
        }),
        query: Type.Object({
            token: Type.Optional(Type.String()),
        }),
        security: Auth.security({ token: true }),
    }, async (req, res) => {
        try {
            await Auth.as_user(config, req);
            await streetPhotosControl.image(req.params.collection, req.params.id, req.params.size, res);
        } catch (err) {
            if (!res.headersSent) Err.respond(err, res);
            else res.destroy();
        }
    });
}
