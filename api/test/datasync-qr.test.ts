import test from 'node:test';
import assert from 'node:assert';
import { dataSyncQr } from '../stateless/lib/control/datasync-qr.js';

// Format read by the ATAK Data Sync plugin 5.0.1 (atakplugin.datasync.j0):
// split(","), feed uid from field 0 (host:port:proto) and field 2 (name).
test('dataSyncQr builds the ATAK Data Sync string from the public host and CoT port', () => {
    assert.equal(
        dataSyncQr('e.taklab.eu', 30002, 'pluton1-niebiescy'),
        'e.taklab.eu:30002:ssl,e.taklab.eu-ssl-pluton1-niebiescy,pluton1-niebiescy',
    );
    assert.equal(dataSyncQr('e.taklab.eu', 30002, 'Ćwiczenie 01'), 'e.taklab.eu:30002:ssl,e.taklab.eu-ssl-Ćwiczenie 01,Ćwiczenie 01');
});

test('dataSyncQr refuses names the plugin would split', () => {
    assert.throws(() => dataSyncQr('e.taklab.eu', 30002, 'a,b'), (err: { status: number }) => err.status === 409);
    assert.throws(() => dataSyncQr('e.taklab.eu', 30002, ''), (err: { status: number }) => err.status === 400);
});

test('dataSyncQrFromEnv needs host and CoT port', async () => {
    const { dataSyncQrFromEnv } = await import('../stateless/lib/control/datasync-qr.js');
    delete process.env.OTS_ACCOUNTS_HOST;
    process.env.OTS_ACCOUNTS_COT_PORT = '30002';
    assert.equal(dataSyncQrFromEnv('x'), null);
    process.env.OTS_ACCOUNTS_HOST = 'e.taklab.eu';
    delete process.env.OTS_ACCOUNTS_COT_PORT;
    assert.equal(dataSyncQrFromEnv('x'), null);
    process.env.OTS_ACCOUNTS_COT_PORT = '30002';
    assert.equal(dataSyncQrFromEnv('x'), 'e.taklab.eu:30002:ssl,e.taklab.eu-ssl-x,x');
});
