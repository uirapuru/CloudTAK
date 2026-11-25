import { Type } from '@sinclair/typebox';

/**
 * taklab: one-time notice about the event journal (GDPR, user decision 25 XI 2026).
 * Every account that logs in to CloudTAK on a server with the journal sees it once.
 * The acknowledgement is stored per account in profile_settings under KEY, so a
 * second browser does not show it again. Bump VERSION when the notice text changes
 * in a way participants must read again: every account then sees it once more.
 */
export const JOURNAL_NOTICE_VERSION = '2026-11-25';
export const JOURNAL_NOTICE_KEY = 'taklab::journal_notice';

export const JournalNoticeSchema = Type.Object({
    show: Type.Boolean({ description: 'Show the notice now' }),
    version: Type.String({ description: 'Version of the notice text to acknowledge' }),
});

export const JournalNoticeAckBody = Type.Object({
    version: Type.String({ maxLength: 32 }),
});

export type JournalNoticeAck = { version: string; at: string };

/** True when the stored value acknowledges the current notice version. */
export function acknowledged(stored: unknown, version = JOURNAL_NOTICE_VERSION): boolean {
    if (!stored || typeof stored !== 'object') return false;
    return (stored as Record<string, unknown>).version === version;
}

export function noticeState(stored: unknown, journalAvailable: boolean): { show: boolean; version: string } {
    return {
        show: journalAvailable && !acknowledged(stored),
        version: JOURNAL_NOTICE_VERSION,
    };
}

export function ackValue(now: Date = new Date()): JournalNoticeAck {
    return { version: JOURNAL_NOTICE_VERSION, at: now.toISOString() };
}
