import { Type } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth from '../../common/auth.js';
import { authenticatedProfile } from '../../common/control/profile.js';
import type ConfigStateless from '../config.js';
import {
    JournalControl,
    JournalAccessSchema,
    JournalAccountsSchema,
    JournalEstimateSchema,
    JournalListSchema,
    PER_PAGE_MAX,
} from '../lib/control/journal.js';

// Filters of the OTS contract, the same for the list and both exports.
const Filters = {
    since: Type.Optional(Type.String({ maxLength: 64, description: 'Earliest entry, any date the browser parses; sent to OTS as ISO 8601 UTC' })),
    until: Type.Optional(Type.String({ maxLength: 64 })),
    account: Type.Optional(Type.String({ maxLength: 2000, description: 'OTS accounts, comma separated' })),
    kind: Type.Optional(Type.String({ pattern: '^[a-z_]+(,[a-z_]+)*$', maxLength: 400, description: 'Entry kinds, comma separated' })),
    q: Type.Optional(Type.String({ maxLength: 200, description: 'Text in title, body or callsign' })),
    positions: Type.Optional(Type.Boolean({ description: 'Include movement entries (default false)' })),
};

export default async function router(schema: Schema, config: ConfigStateless) {
    // taklab: OTS address with the Marti TLS proxy that passes the client certificate
    // (server.api, https://<env>-ots:8443); JOURNAL_OTS_URL overrides it for tests.
    const control = new JournalControl(() => process.env.JOURNAL_OTS_URL || config.server?.api || null);

    async function caller(req: Parameters<typeof Auth.as_user>[1]) {
        const user = await Auth.as_user(config, req);
        const profile = await authenticatedProfile(config, user.email);
        return profile.auth;
    }

    await schema.get('/journal/access', {
        name: 'Journal Access',
        group: 'Journal',
        description: 'Whether the caller may read the event journal (OTS administrator role)',
        res: JournalAccessSchema,
    }, async (req, res) => {
        try {
            res.json(await control.access(await caller(req)));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/journal', {
        name: 'List Journal',
        group: 'Journal',
        description: 'Event journal of the environment, oldest first (OTS administrators only)',
        query: Type.Object({
            ...Filters,
            page: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
            per_page: Type.Optional(Type.Integer({ minimum: 1, maximum: PER_PAGE_MAX })),
        }),
        res: JournalListSchema,
    }, async (req, res) => {
        try {
            res.json(await control.list(await caller(req), req.query));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/journal/accounts', {
        name: 'Journal Accounts',
        group: 'Journal',
        description: 'Accounts present in the journal with their callsigns, for the account filter',
        res: JournalAccountsSchema,
    }, async (req, res) => {
        try {
            res.json(await control.accounts(await caller(req)));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/journal/export/estimate', {
        name: 'Journal Export Estimate',
        group: 'Journal',
        description: 'Entries, files, bytes and missing files of an export with these filters',
        query: Type.Object(Filters),
        res: JournalEstimateSchema,
    }, async (req, res) => {
        try {
            res.json(await control.estimate(await caller(req), req.query));
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/journal/export.pdf', {
        name: 'Journal Export PDF',
        group: 'Journal',
        description: 'The journal as PDF (up to 20 000 entries; more = 413)',
        query: Type.Object({ ...Filters, token: Type.Optional(Type.String()) }),
        security: Auth.security({ token: true }),
    }, async (req, res) => {
        try {
            // Token in the query: a plain download link cannot send headers.
            await control.export(await caller(req), 'pdf', req.query, res);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/journal/export.zip', {
        name: 'Journal Export ZIP',
        group: 'Journal',
        description: 'ZIP with the journal (PDF, CSV, JSON), its files and GPX tracks, streamed from OTS',
        query: Type.Object({ ...Filters, token: Type.Optional(Type.String()) }),
        security: Auth.security({ token: true }),
    }, async (req, res) => {
        try {
            await control.export(await caller(req), 'zip', req.query, res);
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
