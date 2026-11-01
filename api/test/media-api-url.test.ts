import test from 'node:test';
import assert from 'node:assert';
import { mediaApiUrl, mediaApiAllow } from '../stateless/lib/control/video-service.js';

test('mediaApiUrl - upstream: API on port 9997 of media::url', () => {
    const url = mediaApiUrl('/path', 'https://media.example.com', undefined);
    assert.equal(String(url), 'https://media.example.com:9997/path');
});

test('mediaApiUrl - MEDIA_API_URL: internal address keeps its own port', () => {
    const url = mediaApiUrl('/v3/config/global/get', 'https://env-media.example.com', 'http://env-cloudtak-media:9997');
    assert.equal(String(url), 'http://env-cloudtak-media:9997/v3/config/global/get');
});

test('mediaApiAllow - internal hostname is trusted next to media::url', () => {
    assert.deepEqual(mediaApiAllow('https://media.example.com', undefined), ['media.example.com']);
    assert.deepEqual(
        mediaApiAllow('https://env-media.example.com', 'http://env-cloudtak-media:9997'),
        ['env-media.example.com', 'env-cloudtak-media'],
    );
});
