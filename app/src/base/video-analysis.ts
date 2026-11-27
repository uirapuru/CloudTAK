/**
 * taklab: on-demand video analysis of the environment (OTS fork, routes
 * /api/taklab/vision, proxied by CloudTAK under /api/vision). For the OTS
 * administrator of an environment with video analysis only; OTS decides.
 */
import { std, stdurl } from '../std.ts';

export type AnalysisState = 'queued' | 'running' | 'done' | 'stopped' | 'error';

export type Analysis = {
    id: number;
    source: 'live' | 'recording';
    label: string;
    account: string | null;
    created_by: string;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    state: AnalysisState;
    percent: number | null;
    elapsed_s: number | null;
    persons: number;
    error: string | null;
};

export type LiveSource = {
    path: string;
    account: string | null;
    ready_time: string | null;
    analysis: number | null;
};

export type RecordingSource = {
    id: string;
    name: string;
    account: string | null;
    started_at: string;
    duration_s: number | null;
};

export type FaceMoment = { moment: string; at: string; sighting_id: number };

export type AnalysisFace = {
    id: number;
    label: string;
    count: number;
    thumb_url: string;
    moments: FaceMoment[];
};

export type AnalysisChoice =
    | { source: 'live'; path: string }
    | { source: 'recording'; recording_id: string };

/** How often an open analysis and the list with a running analysis refresh. */
export const POLL_MS = 4000;

export function isActive(a: Pick<Analysis, 'state'>): boolean {
    return a.state === 'queued' || a.state === 'running';
}

/** Progress after the state label: percent of the film or time on a live stream. */
export function progressDetail(a: Analysis): string | null {
    if (a.state !== 'running') return null;
    if (a.source === 'recording' && a.percent !== null) return `${Math.round(a.percent)}%`;
    if (a.source === 'live' && a.elapsed_s !== null) {
        const total = Math.max(0, Math.round(a.elapsed_s));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const pad = (n: number) => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    }
    return null;
}

/** Thumbnail address for <img>: the CloudTAK path plus the session token. */
export function thumbSrc(face: AnalysisFace, token: string | undefined): string {
    if (!face.thumb_url) return '';
    const url = stdurl(face.thumb_url);
    if (token) url.searchParams.set('token', token);
    return url.toString();
}

let enabledOnce: Promise<boolean> | null = null;

/** Any failure (feature off, not an administrator, older OTS) means "hide it"; asked once per page load. */
export function videoAnalysisEnabled(): Promise<boolean> {
    if (!enabledOnce) {
        enabledOnce = std('/api/vision/status')
            .then((s) => (s as { enabled?: unknown }).enabled === true)
            .catch(() => false);
    }
    return enabledOnce;
}

export async function listAnalyses(): Promise<Analysis[]> {
    const body = await std('/api/vision/analyses') as { analyses?: Analysis[] };
    return Array.isArray(body.analyses) ? body.analyses : [];
}

export async function getSources(): Promise<{ live: LiveSource[]; recordings: RecordingSource[] }> {
    const body = await std('/api/vision/sources') as { live?: LiveSource[]; recordings?: RecordingSource[] };
    return {
        live: Array.isArray(body.live) ? body.live : [],
        recordings: Array.isArray(body.recordings) ? body.recordings : [],
    };
}

export async function startAnalysis(choice: AnalysisChoice): Promise<Analysis> {
    return await std('/api/vision/analyses', { method: 'POST', body: choice }) as Analysis;
}

export async function getAnalysis(id: number): Promise<Analysis> {
    return await std(`/api/vision/analyses/${id}`) as Analysis;
}

export async function stopAnalysis(id: number): Promise<Analysis> {
    return await std(`/api/vision/analyses/${id}/stop`, { method: 'POST' }) as Analysis;
}

export async function getFaces(id: number): Promise<AnalysisFace[]> {
    const body = await std(`/api/vision/analyses/${id}/faces`) as { items?: AnalysisFace[] };
    return Array.isArray(body.items) ? body.items : [];
}
