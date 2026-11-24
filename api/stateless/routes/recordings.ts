import { Type } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth from '../../common/auth.js';
import { authenticatedProfile } from '../../common/control/profile.js';
import type ConfigStateless from '../config.js';
import { RecordingsControl } from '../lib/control/recordings.js';

const Id = Type.String({ pattern: '^[A-Za-z0-9_-]{1,64}$' });

const Kind = Type.Union([Type.Literal('video'), Type.Literal('voice'), Type.Literal('scan')]);

// Every field listed: batch-schema drops properties the schema does not name.
const RecordingFields = {
    id: Type.String(),
    kind: Kind,
    account: Type.String(),
    callsign: Type.String(),
    uid: Type.String(),
    name: Type.String(),
    started_at: Type.String(),
    ended_at: Type.Union([Type.Null(), Type.String()]),
    duration_s: Type.Union([Type.Null(), Type.Number()]),
    lat: Type.Union([Type.Null(), Type.Number()]),
    lon: Type.Union([Type.Null(), Type.Number()]),
    size_bytes: Type.Union([Type.Null(), Type.Number()]),
    has_text: Type.Boolean(),
    can_manage: Type.Boolean(),
};

const Recording = Type.Object(RecordingFields);

const RecordingDetail = Type.Object({
    ...RecordingFields,
    track: Type.Array(Type.Array(Type.Union([Type.Number(), Type.String(), Type.Null()]))),
    text: Type.Union([Type.Null(), Type.String()]),
});

const Usage = Type.Object({
    admin: Type.Boolean(),
    used_bytes: Type.Union([Type.Null(), Type.Number()]),
    limit_bytes: Type.Union([Type.Null(), Type.Number()]),
});

export default async function router(schema: Schema, config: ConfigStateless) {
    // taklab: OTS address with the Marti TLS proxy that passes the client certificate
    // (server.api, https://<env>-ots:8443); RECORDINGS_OTS_URL overrides it for tests.
    const control = new RecordingsControl(() => process.env.RECORDINGS_OTS_URL || config.server?.api || null);

    async function caller(req: Parameters<typeof Auth.as_user>[1]) {
        const user = await Auth.as_user(config, req);
        const profile = await authenticatedProfile(config, user.email);
        return { username: user.email, auth: profile.auth };
    }

    await schema.get('/recordings/usage', {
        name: 'Recordings Usage',
        group: 'Recordings',
        description: 'Disk used by recordings and its limit; admin=false for accounts that are not OTS administrators',
        res: Usage,
    }, async (req, res) => {
        try {
            const { username, auth } = await caller(req);
            res.json(await control.usage(username, auth));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/recordings', {
        name: 'List Recordings',
        group: 'Recordings',
        description: 'Video, voice and scan recordings of the environment the caller may see (OTS group rules)',
        query: Type.Object({
            kind: Type.Optional(Kind),
            account: Type.Optional(Type.String({ maxLength: 128 })),
            from: Type.Optional(Type.String({ maxLength: 64, description: 'Earliest start, any date the browser parses; sent to OTS as ISO 8601 UTC' })),
            to: Type.Optional(Type.String({ maxLength: 64 })),
            page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
        }),
        res: Type.Object({
            enabled: Type.Boolean(),
            admin: Type.Boolean(),
            page: Type.Integer(),
            total_pages: Type.Union([Type.Null(), Type.Integer()]),
            items: Type.Array(Recording),
        }),
    }, async (req, res) => {
        try {
            const { username, auth } = await caller(req);
            res.json(await control.list(username, auth, req.query));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/recordings/:id', {
        name: 'Get Recording',
        group: 'Recordings',
        description: 'One recording with the operator track and, for scans, the recognised text',
        params: Type.Object({ id: Id }),
        res: RecordingDetail,
    }, async (req, res) => {
        try {
            const { username, auth } = await caller(req);
            res.json(await control.get(username, auth, req.params.id));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.patch('/recordings/:id', {
        name: 'Rename Recording',
        group: 'Recordings',
        description: 'Change the name of a recording (author or administrator; OTS decides)',
        params: Type.Object({ id: Id }),
        body: Type.Object({ name: Type.String({ minLength: 1, maxLength: 200 }) }),
        res: RecordingDetail,
    }, async (req, res) => {
        try {
            const { username, auth } = await caller(req);
            res.json(await control.rename(username, auth, req.params.id, req.body.name));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.delete('/recordings/:id', {
        name: 'Delete Recording',
        group: 'Recordings',
        description: 'Delete a recording with its file and map marker (author or administrator; OTS decides)',
        params: Type.Object({ id: Id }),
        res: Type.Object({ status: Type.Integer(), message: Type.String() }),
    }, async (req, res) => {
        try {
            const { auth } = await caller(req);
            await control.remove(auth, req.params.id);
            res.json({ status: 200, message: 'Nagranie usunięte' });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/recordings/:id/file', {
        name: 'Get Recording File',
        group: 'Recordings',
        description: 'The recording file (MP4, OGG/WAV, JPEG) with Range support; download=true asks the browser to save it',
        params: Type.Object({ id: Id }),
        query: Type.Object({
            token: Type.Optional(Type.String()),
            download: Type.Optional(Type.Boolean()),
        }),
        security: Auth.security({ token: true }),
    }, async (req, res) => {
        try {
            // Token in the query: <video src> and plain links cannot send headers.
            const { auth } = await caller(req);
            const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
            await control.file(auth, req.params.id, range, res, Boolean(req.query.download));
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
