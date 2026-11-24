import { Type } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth from '../../common/auth.js';
import type ConfigStateless from '../config.js';
import {
    reportControl,
    ReportId,
    ReportCreateBody,
    ReportCreatedSchema,
    ReportDeletedSchema,
    ReportJobSchema,
    ReportListSchema,
} from '../lib/control/report.js';

export default async function router(schema: Schema, config: ConfigStateless) {
    // The account sent to the report service is always the OTS username of the
    // session (user.email, as in voice.ts), never anything the browser sends.
    async function account(req: Parameters<typeof Auth.as_user>[1]): Promise<string> {
        const user = await Auth.as_user(config, req);
        return user.email;
    }

    await schema.post('/report', {
        name: 'Create Mission Report',
        group: 'Report',
        description: 'Order a mission report (whole environment or one mission) for at most 7 days; built in the background',
        body: ReportCreateBody,
        res: ReportCreatedSchema,
    }, async (req, res) => {
        try {
            const user = await account(req);
            res.status(202).json(await reportControl.create(user, req.body));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/report', {
        name: 'List Mission Reports',
        group: 'Report',
        description: 'Reports of the caller, newest first (OTS administrator: every report of the environment)',
        res: ReportListSchema,
    }, async (req, res) => {
        try {
            res.json(await reportControl.list(await account(req)));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    // Before /report/:id, so "<id>.pdf" is never taken for an id.
    for (const ext of ['pdf', 'txt'] as const) {
        await schema.get(`/report/:id.${ext}`, {
            name: `Get Mission Report ${ext.toUpperCase()}`,
            group: 'Report',
            description: `The finished report as ${ext.toUpperCase()} (409 while it is not ready)`,
            params: Type.Object({ id: ReportId }),
            query: Type.Object({ token: Type.Optional(Type.String()) }),
            security: Auth.security({ token: true }),
        }, async (req, res) => {
            try {
                // Token in the query: a plain download link cannot send headers.
                await reportControl.download(await account(req), req.params.id, ext, res);
            } catch (err) {
                Err.respond(err, res);
            }
        });
    }

    await schema.get('/report/:id', {
        name: 'Get Mission Report',
        group: 'Report',
        description: 'State of one report: queued, running, done or failed with the reason',
        params: Type.Object({ id: ReportId }),
        res: ReportJobSchema,
    }, async (req, res) => {
        try {
            res.json(await reportControl.get(await account(req), req.params.id));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.delete('/report/:id', {
        name: 'Delete Mission Report',
        group: 'Report',
        description: 'Delete a report with its files, cancelling it when still queued or running (owner or OTS administrator)',
        params: Type.Object({ id: ReportId }),
        res: ReportDeletedSchema,
    }, async (req, res) => {
        try {
            res.json(await reportControl.delete(await account(req), req.params.id));
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
