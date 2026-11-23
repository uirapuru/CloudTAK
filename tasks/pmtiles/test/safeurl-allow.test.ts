import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeUrl } from '@tak-ps/node-safeurl';
import { safeUrlAllow } from '../lib/basemap/protocol.js';

test('safeUrlAllow: empty without SAFEURL_ALLOW', () => {
    assert.deepEqual(safeUrlAllow(undefined), []);
    assert.deepEqual(safeUrlAllow(''), []);
});

test('safeUrlAllow: keeps exact origins only', () => {
    assert.deepEqual(
        safeUrlAllow(' http://taklab-tiles.taklab-system.svc:3000 , taklab-tiles, http://a.svc:3000/path, ftp://x:21, https://b.svc/'),
        ['http://taklab-tiles.taklab-system.svc:3000', 'https://b.svc/'],
    );
});

test('safeUrlAllow: allowed origin passes, other ports and hosts stay blocked', async () => {
    const allow = safeUrlAllow('http://10.43.0.10:3000');
    assert.equal((await isSafeUrl('http://10.43.0.10:3000/polska50k/12/1/1', { allow })).safe, true);
    assert.equal((await isSafeUrl('http://10.43.0.10:8080/', { allow })).safe, false);
    assert.equal((await isSafeUrl('http://10.43.0.11:3000/', { allow })).safe, false);
    assert.equal((await isSafeUrl('http://169.254.169.254/latest/meta-data', { allow })).safe, false);
});
