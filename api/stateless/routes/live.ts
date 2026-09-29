import { Type } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth from '../../common/auth.js';
import type ConfigStateless from '../config.js';
import { liveControl } from '../lib/control/live.js';

export default async function router(schema: Schema, config: ConfigStateless) {
    await schema.get('/live', {
        name: 'List Live Layers',
        group: 'Live',
        description: 'List the live GeoJSON layers offered by the taklab live-feeds service',
        res: Type.Object({
            items: Type.Array(Type.Object({
                name: Type.String(),
                label: Type.String(),
                refresh: Type.Integer(),
                attribution: Type.String(),
                updated: Type.Union([Type.Null(), Type.String()]),
                stale: Type.Boolean(),
            })),
        }),
    }, async (req, res) => {
        try {
            await Auth.as_user(config, req);
            res.json(await liveControl.index());
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/live/:name', {
        name: 'Get Live Layer',
        group: 'Live',
        description: 'Get the current GeoJSON FeatureCollection of one live layer',
        params: Type.Object({
            name: Type.String(),
        }),
        query: Type.Object({
            since: Type.Optional(Type.String({ description: 'ISO time of the caller\'s copy; unchanged layers answer {"unchanged": true}' })),
        }),
    }, async (req, res) => {
        try {
            await Auth.as_user(config, req);
            const body = await liveControl.layer(req.params.name, req.query.since);
            res.type('application/json').send(body);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/live/:name/:id', {
        name: 'Get Live Feature',
        group: 'Live',
        description: 'Get the details of one object of a live layer',
        params: Type.Object({
            name: Type.String(),
            id: Type.String(),
        }),
    }, async (req, res) => {
        try {
            await Auth.as_user(config, req);
            const body = await liveControl.feature(req.params.name, req.params.id);
            res.type('application/json').send(body);
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
