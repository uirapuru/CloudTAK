import { Type } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth from '../../common/auth.js';
import { authenticatedProfile } from '../../common/control/profile.js';
import type ConfigStateless from '../config.js';
import { VisionControl, choiceBody } from '../lib/control/vision.js';

const Num = Type.String({ pattern: '^[0-9]{1,9}$' });

const State = Type.Union([
    Type.Literal('queued'), Type.Literal('running'), Type.Literal('done'), Type.Literal('stopped'), Type.Literal('error'),
]);

const NullString = Type.Union([Type.Null(), Type.String()]);
const NullNumber = Type.Union([Type.Null(), Type.Number()]);

// Every field listed: batch-schema drops properties the schema does not name.
const Analysis = Type.Object({
    id: Type.Integer(),
    source: Type.Union([Type.Literal('live'), Type.Literal('recording')]),
    label: Type.String(),
    account: NullString,
    created_by: Type.String(),
    created_at: Type.String(),
    started_at: NullString,
    finished_at: NullString,
    state: State,
    percent: NullNumber,
    elapsed_s: NullNumber,
    persons: Type.Integer(),
    error: NullString,
});

const Notice = Type.Union([Type.Null(), Type.Object({
    level: Type.Union([Type.Literal('warning'), Type.Literal('info')]),
    text: Type.String(),
})]);

const AnalysisWithNotice = Type.Object({ ...Analysis.properties, notice: Notice });

export default async function router(schema: Schema, config: ConfigStateless) {
    // taklab: same OTS address as the recordings proxy (marti-tls with the client certificate).
    const control = new VisionControl(() => process.env.RECORDINGS_OTS_URL || config.server?.api || null);

    async function auth(req: Parameters<typeof Auth.as_user>[1]) {
        const user = await Auth.as_user(config, req);
        return (await authenticatedProfile(config, user.email)).auth;
    }

    await schema.get('/vision/status', {
        name: 'Video Analysis Status',
        group: 'Vision',
        description: 'enabled=true only for an OTS administrator of an environment with video analysis',
        res: Type.Object({ enabled: Type.Boolean() }),
    }, async (req, res) => {
        try {
            res.json(await control.status(await auth(req)));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/vision/sources', {
        name: 'Video Analysis Sources',
        group: 'Vision',
        description: 'Live streams and ready video recordings that can be analysed; OTS administrators only',
        res: Type.Object({
            live: Type.Array(Type.Object({
                path: Type.String(),
                account: NullString,
                ready_time: NullString,
                analysis: Type.Union([Type.Null(), Type.Integer()]),
            })),
            recordings: Type.Array(Type.Object({
                id: Type.String(),
                name: Type.String(),
                account: NullString,
                started_at: Type.String(),
                duration_s: NullNumber,
            })),
        }),
    }, async (req, res) => {
        try {
            res.json(await control.sources(await auth(req)));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/vision/analyses', {
        name: 'List Video Analyses',
        group: 'Vision',
        description: 'On-demand analyses of the environment, newest first; OTS administrators only',
        res: Type.Object({ analyses: Type.Array(Analysis), notice: Notice }),
    }, async (req, res) => {
        try {
            res.json(await control.list(await auth(req)));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/vision/analyses', {
        name: 'Start Video Analysis',
        group: 'Vision',
        description: 'Analyse one live stream (until stopped, at most 30 minutes) or one ready video recording',
        body: Type.Object({
            source: Type.Union([Type.Literal('live'), Type.Literal('recording')]),
            path: Type.Optional(Type.String({ maxLength: 256 })),
            recording_id: Type.Optional(Type.String({ maxLength: 64 })),
        }),
        res: Analysis,
    }, async (req, res) => {
        try {
            const choice = choiceBody(req.body);
            res.json(await control.start(await auth(req), choice));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/vision/analyses/:id', {
        name: 'Get Video Analysis',
        group: 'Vision',
        params: Type.Object({ id: Num }),
        res: AnalysisWithNotice,
    }, async (req, res) => {
        try {
            res.json(await control.get(await auth(req), req.params.id));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/vision/analyses/:id/stop', {
        name: 'Stop Video Analysis',
        group: 'Vision',
        params: Type.Object({ id: Num }),
        res: Analysis,
    }, async (req, res) => {
        try {
            res.json(await control.stop(await auth(req), req.params.id));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/vision/analyses/:id/faces', {
        name: 'Video Analysis Faces',
        group: 'Vision',
        description: 'One entry per person recognised in this analysis, with its count and moments',
        params: Type.Object({ id: Num }),
        res: Type.Object({
            items: Type.Array(Type.Object({
                id: Type.Integer(),
                label: Type.String(),
                count: Type.Integer(),
                thumb_url: Type.String(),
                moments: Type.Array(Type.Object({
                    moment: Type.String(),
                    at: Type.String(),
                    sighting_id: Type.Integer(),
                })),
            })),
        }),
    }, async (req, res) => {
        try {
            res.json({ items: await control.faces(await auth(req), req.params.id) });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/vision/analyses/:id/persons/:person/thumb.jpg', {
        name: 'Video Analysis Face Thumbnail',
        group: 'Vision',
        params: Type.Object({ id: Num, person: Num }),
        query: Type.Object({ token: Type.Optional(Type.String()) }),
        security: Auth.security({ token: true }),
    }, async (req, res) => {
        try {
            // Token in the query: <img src> cannot send headers.
            await control.thumb(await auth(req), req.params.id, req.params.person, res);
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
