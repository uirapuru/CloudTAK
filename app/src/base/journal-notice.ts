/**
 * taklab: one-time notice about the event journal (GDPR, user decision 25 XI 2026).
 * The server decides whether to show it (per account, only where OTS keeps a
 * journal); the browser shows it and sends the acknowledgement back.
 */
import { std } from '../std.ts';

export type JournalNoticeState = { show: boolean; version: string };

/** Any failure means "do not show now": the server asks again at the next login. */
export async function journalNoticeState(): Promise<JournalNoticeState | null> {
    try {
        const state = await std('/api/journal/notice') as Partial<JournalNoticeState> | null;
        if (!state || state.show !== true || typeof state.version !== 'string') return null;
        return { show: true, version: state.version };
    } catch {
        return null;
    }
}

export async function acknowledgeJournalNotice(version: string): Promise<void> {
    await std('/api/journal/notice', { method: 'PUT', body: { version } });
}
