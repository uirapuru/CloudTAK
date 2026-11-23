import { Type } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import qr from 'qr-image';
import Auth from '../../common/auth.js';
import type ConfigStateless from '../config.js';
import { otsAccountsControl, USERNAME_PATTERN } from '../lib/control/ots-accounts.js';
import { dataSyncQrFromEnv } from '../lib/control/datasync-qr.js';

const Status = Type.Object({
    enabled: Type.Boolean(),
    administrator: Type.Boolean(),
    atak: Type.Boolean(),
    icu: Type.Boolean(),
    reason: Type.Optional(Type.String()),
});

const Account = Type.Object({
    username: Type.String(),
    roles: Type.Array(Type.String()),
    active: Type.Boolean(),
});

export default async function router(schema: Schema, config: ConfigStateless) {
    await schema.get('/ots/accounts/status', {
        name: 'OTS Accounts Status',
        group: 'OtsAccounts',
        description: 'Whether the OTS account list is installed, whether the caller is an OTS administrator and which QR codes are available; always 200',
        res: Status,
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            try {
                res.json(await otsAccountsControl(config.server.webtak).status(user.email));
            } catch (err) {
                // The menu entry only hides; the reason is for diagnosis.
                res.json({
                    enabled: false,
                    administrator: false,
                    atak: false,
                    icu: false,
                    reason: err instanceof Err ? err.safe : 'Serwer OTS nie odpowiada',
                });
            }
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/ots/accounts', {
        name: 'List OTS Accounts',
        group: 'OtsAccounts',
        description: 'Accounts of the OTS server (name, roles, active); only for OTS administrators',
        res: Type.Object({ items: Type.Array(Account) }),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            res.json({ items: await otsAccountsControl(config.server.webtak).list(user.email) });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/ots/accounts/:username/qr', {
        name: 'OTS Account QR',
        group: 'OtsAccounts',
        description: 'ATAK enrollment or OpenTAK ICU QR code of an OTS account; only for OTS administrators',
        params: Type.Object({
            username: Type.String({ pattern: USERNAME_PATTERN }),
        }),
        query: Type.Object({
            type: Type.Union([Type.Literal('atak'), Type.Literal('icu')]),
        }),
        res: Type.Object({
            type: Type.Union([Type.Literal('atak'), Type.Literal('icu')]),
            uri: Type.String(),
            svg: Type.String(),
        }),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            const code = await otsAccountsControl(config.server.webtak).qr(user.email, req.params.username, req.query.type);
            // The URI carries the account's enrollment token.
            res.setHeader('Cache-Control', 'no-store');
            res.json({ ...code, svg: String(qr.imageSync(code.uri, { type: 'svg' })) });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/marti/datasync-qr', {
        name: 'Data Sync QR',
        group: 'MartiMissions',
        description: 'QR code that subscribes ATAK (Data Sync plugin) to a mission by name, built from the public host and CoT port of the environment',
        query: Type.Object({
            name: Type.String({ minLength: 1, maxLength: 512 }),
        }),
        res: Type.Object({
            uri: Type.String(),
            svg: Type.String(),
        }),
    }, async (req, res) => {
        try {
            await Auth.as_user(config, req);
            const uri = dataSyncQrFromEnv(req.query.name);
            if (!uri) throw new Err(409, null, 'Kod QR misji wymaga dostępu po nazwie serwera');
            res.json({ uri, svg: String(qr.imageSync(uri, { type: 'svg' })) });
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
