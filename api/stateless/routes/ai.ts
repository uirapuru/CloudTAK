import { Type } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth from '../../common/auth.js';
import type ConfigStateless from '../config.js';
import {
    aiControl,
    AiOrderId,
    AiModelSchema,
    AiModelActionSchema,
    AiOrderCreateBody,
    type AiOrderCreate,
    AiOrderCreatedSchema,
    AiOrderDeletedSchema,
    AiOrderSchema,
    AiOrderListSchema,
} from '../lib/control/ai.js';

export default async function router(schema: Schema, config: ConfigStateless) {
    // The account sent to the report service is always the OTS username of the
    // session (user.email, as in report.ts), never anything the browser sends.
    // Whether it is an OTS administrator decides the service (403 otherwise).
    async function account(req: Parameters<typeof Auth.as_user>[1]): Promise<string> {
        const user = await Auth.as_user(config, req);
        return user.email;
    }

    await schema.get('/ai/model', {
        name: 'Get AI Model State',
        group: 'AI',
        description: 'State of the shared AI model machine (OTS administrator only)',
        res: AiModelSchema,
    }, async (req, res) => {
        try {
            res.json(await aiControl.model(await account(req)));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/ai/model/start', {
        name: 'Start AI Model',
        group: 'AI',
        description: 'Switch the shared AI model machine on and keep it on until stopped (OTS administrator only)',
        res: AiModelActionSchema,
    }, async (req, res) => {
        try {
            res.json(await aiControl.start(await account(req)));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/ai/model/stop', {
        name: 'Stop AI Model',
        group: 'AI',
        description: 'Switch the shared AI model machine off now (OTS administrator only)',
        res: AiModelActionSchema,
    }, async (req, res) => {
        try {
            res.json(await aiControl.stop(await account(req)));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/ai/orders', {
        name: 'Create Combat Order',
        group: 'AI',
        description: 'Order a five-paragraph combat order (PDF or DOCX) built in the background (OTS administrator only). '
            + 'JSON without attachments, or multipart/form-data: the same JSON in the field "order" and up to 10 files '
            + '(20 MB each, 50 MB together) in "files"; photos, text, PDF, DOCX and ZIP are read into the order.',
        body: {
            'application/json': AiOrderCreateBody,
            // Streamed through to the report service, which validates the order and the files.
            'multipart/form-data': true,
        },
        res: AiOrderCreatedSchema,
    }, async (req, res) => {
        try {
            const user = await account(req);
            const multipart = String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data');
            const created = multipart
                ? await aiControl.createMultipart(user, req)
                : await aiControl.create(user, req.body as AiOrderCreate);
            res.status(202).json(created);
        } catch (err) {
            // The rest of a refused upload is never read: close the connection after the answer.
            if (err instanceof Err && err.status === 413) res.setHeader('Connection', 'close');
            Err.respond(err, res);
        }
    });

    await schema.get('/ai/orders', {
        name: 'List Combat Orders',
        group: 'AI',
        description: 'Combat orders of the environment, newest first (OTS administrator only)',
        res: AiOrderListSchema,
    }, async (req, res) => {
        try {
            res.json(await aiControl.list(await account(req)));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    // Before /ai/orders/:id, so "<id>.pdf" is never taken for an id.
    for (const ext of ['pdf', 'docx'] as const) {
        await schema.get(`/ai/orders/:id.${ext}`, {
            name: `Get Combat Order ${ext.toUpperCase()}`,
            group: 'AI',
            description: `The finished order as ${ext.toUpperCase()} (409 while it is not ready, 404 for the other format)`,
            params: Type.Object({ id: AiOrderId }),
            query: Type.Object({ token: Type.Optional(Type.String()) }),
            security: Auth.security({ token: true }),
        }, async (req, res) => {
            try {
                // Token in the query: a plain download link cannot send headers.
                await aiControl.download(await account(req), req.params.id, ext, res);
            } catch (err) {
                Err.respond(err, res);
            }
        });
    }

    await schema.get('/ai/orders/:id', {
        name: 'Get Combat Order',
        group: 'AI',
        description: 'State of one combat order: queued, running, done or failed with the reason',
        params: Type.Object({ id: AiOrderId }),
        res: AiOrderSchema,
    }, async (req, res) => {
        try {
            res.json(await aiControl.get(await account(req), req.params.id));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.delete('/ai/orders/:id', {
        name: 'Delete Combat Order',
        group: 'AI',
        description: 'Delete a combat order with its file (OTS administrator only)',
        params: Type.Object({ id: AiOrderId }),
        res: AiOrderDeletedSchema,
    }, async (req, res) => {
        try {
            res.json(await aiControl.delete(await account(req), req.params.id));
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
