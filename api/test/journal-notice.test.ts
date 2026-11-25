import test from 'node:test';
import assert from 'node:assert';
import { JournalControl } from '../stateless/lib/control/journal.js';
import {
    JOURNAL_NOTICE_VERSION,
    ackValue,
    acknowledged,
    noticeState,
} from '../stateless/lib/control/journal-notice.js';
import type { OtsTransport } from '../stateless/lib/control/recordings.js';

const AUTH = { cert: 'CERT-operator', key: 'KEY-operator' };

function control(answer: () => Response | Promise<Response>, base = 'https://public-ots:8443/'): { control: JournalControl; urls: string[] } {
    const urls: string[] = [];
    const c = new JournalControl(() => base);
    const transport: OtsTransport = async (url) => {
        urls.push(url);
        return answer();
    };
    c.transport = transport;
    return { control: c, urls };
}

test('acknowledged: only an object with the current version counts', () => {
    assert.equal(acknowledged({ version: JOURNAL_NOTICE_VERSION, at: '2026-11-25T12:00:00.000Z' }), true);
    for (const value of [undefined, null, '', JOURNAL_NOTICE_VERSION, true, {}, { version: '2026-01-01' }, { version: 20261125 }]) {
        assert.equal(acknowledged(value), false, JSON.stringify(value));
    }
});

test('noticeState: shown once per account and only where the server keeps a journal', () => {
    assert.deepEqual(noticeState(undefined, true), { show: true, version: JOURNAL_NOTICE_VERSION });
    assert.deepEqual(noticeState(undefined, false), { show: false, version: JOURNAL_NOTICE_VERSION });
    assert.deepEqual(noticeState(ackValue(), true), { show: false, version: JOURNAL_NOTICE_VERSION });
    // A new notice version is shown again to accounts that read the old one.
    assert.deepEqual(noticeState({ version: '2026-01-01', at: 'x' }, true), { show: true, version: JOURNAL_NOTICE_VERSION });
});

test('ackValue stores the version and the time of reading', () => {
    assert.deepEqual(ackValue(new Date('2026-11-25T14:00:00Z')), { version: JOURNAL_NOTICE_VERSION, at: '2026-11-25T14:00:00.000Z' });
});

test('available: OTS /access answers every account, only 404 means no journal', async () => {
    for (const [status, expected] of [[200, true], [401, true], [403, true], [404, false]] as const) {
        const { control: c, urls } = control(() => new Response(status === 200 ? '{"admin":false}' : '', { status }));
        assert.equal(await c.available(AUTH), expected, `status ${status}`);
        assert.deepEqual(urls, ['https://public-ots:8443/api/taklab/journal/access']);
    }
});

test('available: OTS error or no OTS address is an error, not a silent "no journal"', async () => {
    await assert.rejects(control(() => new Response('', { status: 500 })).control.available(AUTH), (err: { status: number }) => err.status === 502);
    await assert.rejects(control(() => { throw new Error('ECONNREFUSED'); }).control.available(AUTH), (err: { status: number }) => err.status === 502);
    await assert.rejects(control(() => new Response(''), '').control.available(AUTH), (err: { status: number }) => err.status === 404);
});
