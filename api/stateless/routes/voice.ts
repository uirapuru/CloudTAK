import { Type } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth from '../../common/auth.js';
import type ConfigStateless from '../config.js';
import { voiceControl } from '../lib/control/voice.js';

const Recording = Type.Object({
    id: Type.Integer(),
    channel: Type.String(),
    author: Type.String(),
    source: Type.String(),
    started_at: Type.String(),
    ended_at: Type.String(),
    started_ts: Type.Number(),
    duration_s: Type.Number(),
    transcript: Type.Union([Type.Null(), Type.String()]),
    transcript_status: Type.String(),
    transcript_attempts: Type.Integer(),
});

const Range = {
    channel: Type.Optional(Type.String({ maxLength: 128 })),
    since: Type.Optional(Type.Number({ description: 'Unix time (s) of the earliest recording start, inclusive' })),
    until: Type.Optional(Type.Number({ description: 'Unix time (s) of the latest recording start, inclusive' })),
};

export default async function router(schema: Schema, config: ConfigStateless) {
    await schema.get('/voice/status', {
        name: 'Voice Log Status',
        group: 'Voice',
        description: 'State of the taklab voice log: channels, current speaker; {enabled: false} when not installed',
        res: Type.Object({ enabled: Type.Boolean() }, { additionalProperties: true }),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            res.json(await voiceControl.status(user.email));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/voice/recordings', {
        name: 'List Voice Recordings',
        group: 'Voice',
        description: 'Voice log history, newest first',
        query: Type.Object({
            ...Range,
            before_id: Type.Optional(Type.Integer({ minimum: 1 })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
        }),
        res: Type.Object({ items: Type.Array(Recording) }),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            res.json(await voiceControl.recordings(user.email, req.query));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/voice/recordings/:id/audio', {
        name: 'Get Voice Recording Audio',
        group: 'Voice',
        description: 'Ogg/Opus audio of one recording; download=true asks the browser to save it',
        params: Type.Object({ id: Type.Integer({ minimum: 1 }) }),
        query: Type.Object({
            token: Type.Optional(Type.String()),
            download: Type.Optional(Type.Boolean()),
        }),
    }, async (req, res) => {
        try {
            // Token in the query: <audio src> and plain links cannot send headers.
            const user = await Auth.as_user(config, req, { token: true });
            await voiceControl.audio(user.email, req.params.id, res, Boolean(req.query.download));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/voice/export', {
        name: 'Export Voice Recordings',
        group: 'Voice',
        description: 'ZIP with the audio files, report.html and report.csv; no filters = the whole history',
        query: Type.Object({
            ...Range,
            ids: Type.Optional(Type.String({ pattern: '^[0-9]+(,[0-9]+)*$', maxLength: 8000 })),
            token: Type.Optional(Type.String()),
        }),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req, { token: true });
            await voiceControl.export(user.email, req.query, res);
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
