/**
 * taklab mission report: client of /api/report (CloudTAK proxy to the report
 * service of the environment) and the pure helpers of the "Raport misji" menu.
 */
import { std } from '../std.ts';
import { db } from '../database.ts';
import { isoToZoned, zonedToIso } from '../components/CloudTAK/Menu/journal.ts';

export type ReportScope = 'environment' | 'mission';
export type ReportStatus = 'queued' | 'running' | 'done' | 'failed';
export type ReportFormat = 'pdf' | 'txt';
export type ReportBasemap = 'osm' | 'polska50k';

export const REPORT_BASEMAPS: ReportBasemap[] = ['osm', 'polska50k'];
export const REPORT_MAX_DAYS = 7;
export const REPORT_POLL_MS = 5_000;

export type ReportJob = {
    id: string;
    scope: string;
    mission: string | null;
    since: string;
    until: string;
    status: string;
    error: string | null;
    created: string;
    finished: string | null;
    owner: string;
};

export type ReportRequest = {
    scope: ReportScope;
    mission?: string;
    mission_password?: string;
    since: string;
    until: string;
    basemap?: ReportBasemap;
};

export type ReportCreated = { id: string; status: string };

/** A subscribed feed (Data Sync) offered in the scope list. */
export type ReportFeed = {
    name: string;
    createTime: string | null;
    passwordProtected: boolean;
};

/** Form of the menu; since and until are datetime-local values in Europe/Warsaw time. */
export type ReportForm = {
    scope: ReportScope;
    mission: string;
    password: string;
    since: string;
    until: string;
    basemap: ReportBasemap;
};

export async function createReport(req: ReportRequest): Promise<ReportCreated> {
    return await std('/api/report', { method: 'POST', body: req }) as ReportCreated;
}

export async function listReports(): Promise<ReportJob[]> {
    return (await std('/api/report') as { items: ReportJob[] }).items;
}

/** Path of the finished file; download it with downloadUrl(..., { token: true }). */
export function reportUrl(id: string, fmt: ReportFormat): string {
    return `/api/report/${encodeURIComponent(id)}.${fmt}`;
}

export async function deleteReport(id: string): Promise<void> {
    await std(`/api/report/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Whether the environment has the mission report: CloudTAK answers 404 when
 * REPORT_URL is not set. Any other HTTP error (service down) still means the
 * feature exists; a failure without an HTTP answer hides the menu.
 */
export async function reportEnabled(): Promise<boolean> {
    try {
        await std('/api/report');
        return true;
    } catch (err) {
        const status = (err as { body?: { status?: unknown } }).body?.status;
        return typeof status === 'number' && status !== 404 && status !== 401 && status !== 403;
    }
}

/** Feeds the user is subscribed to, by name. */
export async function subscribedFeeds(): Promise<ReportFeed[]> {
    const subs = await db.subscription.filter((sub) => sub.subscribed === true).toArray();
    return subs
        .map((sub) => ({
            name: sub.meta.name,
            createTime: sub.meta.createTime || null,
            passwordProtected: Boolean(sub.meta.passwordProtected),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** Default form: the whole environment, the last 24 hours, OSM. */
export function defaultForm(now = Date.now()): ReportForm {
    return {
        scope: 'environment',
        mission: '',
        password: '',
        since: isoToZoned(now - 24 * 3600_000),
        until: isoToZoned(now),
        basemap: 'osm',
    };
}

/**
 * Range of a feed: from its creation to now, at most the last 7 days (the
 * last 24 hours when the creation time is unknown).
 */
export function feedRange(feed: ReportFeed | undefined, now = Date.now()): { since: string; until: string } {
    const created = feed?.createTime ? Date.parse(feed.createTime) : NaN;
    const earliest = now - REPORT_MAX_DAYS * 24 * 3600_000;
    const start = Number.isFinite(created) && created < now ? Math.max(created, earliest) : now - 24 * 3600_000;
    return { since: isoToZoned(start), until: isoToZoned(now) };
}

/** Why the form cannot be sent (a locale key), or null. */
export function formProblem(form: ReportForm): string | null {
    if (form.scope === 'mission' && !form.mission) return 'report.problems.noFeed';
    const since = zonedToIso(form.since);
    const until = zonedToIso(form.until);
    if (!since || !until) return 'report.problems.noRange';
    const span = Date.parse(until) - Date.parse(since);
    if (span <= 0) return 'report.problems.order';
    if (span > REPORT_MAX_DAYS * 24 * 3600_000) return 'report.problems.tooLong';
    return null;
}

/** Body of POST /api/report; the password goes only for a protected feed. */
export function toRequest(form: ReportForm, feed: ReportFeed | undefined): ReportRequest {
    const req: ReportRequest = {
        scope: form.scope,
        since: zonedToIso(form.since) as string,
        until: zonedToIso(form.until) as string,
        basemap: form.basemap,
    };
    if (form.scope === 'mission') {
        req.mission = form.mission;
        if (feed?.passwordProtected && form.password) req.mission_password = form.password;
    }
    return req;
}

/** The feed view offers "Raport misji" only for a subscribed feed of an environment with reports. */
export function reportButtonVisible(subscription: { subscribed: boolean } | undefined, enabled: boolean): boolean {
    return enabled && subscription?.subscribed === true;
}

export function isPending(job: ReportJob): boolean {
    return job.status === 'queued' || job.status === 'running';
}
