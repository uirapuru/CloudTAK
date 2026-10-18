process.env.SigningSecret = 'coe-wildland-fire';
import test from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Flight from './flight.js';
import { DataPackage } from '@tak-ps/node-cot';
import stream2buffer from '../stateless/lib/stream.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const flight = new Flight();

flight.init({ takserver: true });
flight.takeoff();
flight.user();

const GUID = 'c2a3d0f1-7b1e-4b0a-9c1d-1f2e3a4b5c6e';
const NAME = 'Mapa public';
const PACKAGE_PATH = `/Marti/api/missions/${encodeURIComponent(NAME)}/contents/missionpackage`;
const time = '2026-08-11T00:00:00.000Z';
const coords = [[17.03, 51.11, 0], [17.05, 51.1, 0], [17.07, 51.09, 0]];
const plan = {
    version: 1, mode: 'foot', mode_name: 'Pieszo',
    waypoints: [[17.03, 51.11], [17.07, 51.09]],
    legs: [{ start: 0, end: 2, distance_m: 3000, duration_s: 2000 }],
};

function route(id: string, metadata: Record<string, unknown>) {
    return {
        id, type: 'Feature',
        properties: { type: 'b-m-r', how: 'm-g', callsign: 'Trasa', time, start: time, stale: time, metadata },
        geometry: { type: 'LineString', coordinates: coords },
    };
}

/** Zbiera XML CoT z wysłanej paczki misji */
function mockMission(uids: string[]) {
    const cots: string[] = [];

    flight.tak.mockMarti.push(async (request: IncomingMessage, response: ServerResponse) => {
        if (!request.method || !request.url) return false;
        const url = new URL(request.url, 'http://localhost');

        if (request.method === 'GET' && url.pathname === `/Marti/api/missions/guid/${GUID}`) {
            response.setHeader('Content-Type', 'application/json');
            response.write(JSON.stringify({
                version: '3', type: 'com.bbn.marti.sync.model.Mission',
                data: [{
                    name: NAME, guid: GUID, description: '', chatRoom: '', baseLayer: '', bbox: '', path: '',
                    classification: '', tool: 'public', keywords: [], creatorUid: 'ANDROID-CloudTAK-admin@example.com',
                    createTime: '2024-01-01T00:00:00Z', externalData: [], feeds: [], mapLayers: [], inviteOnly: false,
                    expiration: -1, uids: cots.length ? uids.map(uid => ({ data: uid, timestamp: '2024-01-01T00:00:00Z' })) : [],
                    contents: [], passwordProtected: false,
                }],
            }));
            response.end();
            return true;
        } else if (request.method === 'PUT' && url.pathname === PACKAGE_PATH) {
            const packagePath = path.resolve(os.tmpdir(), randomUUID() + '.zip');
            await fsp.writeFile(packagePath, await stream2buffer(request));
            const dp = await DataPackage.parse(packagePath);
            for (const c of dp.contents) {
                cots.push((await dp.getFileBuffer(c._attributes.zipEntry)).toString());
            }
            await dp.destroy();
            await fsp.rm(packagePath, { force: true });

            response.setHeader('Content-Type', 'application/json');
            response.write(JSON.stringify({ version: '3', type: 'MissionChange', data: [] }));
            response.end();
            return true;
        }
        return false;
    });

    return cots;
}

async function submit(features: object[]) {
    return await flight.fetch(`/api/marti/missions/${GUID}/cot`, {
        method: 'PUT', auth: { bearer: flight.token.admin },
        headers: { missionauthorization: 'test-mission-token' },
        body: { features },
    }, true);
}

test('PUT: mission cot - trasa z planem niesie __taklab_route', async () => {
    const cots = mockMission(['r-1']);
    try {
        await submit([route('r-1', { taklab_route: plan })]);
        assert.strictEqual(cots.length, 1);
        assert.match(cots[0], /<__taklab_route /);
    } finally {
        flight.tak.reset();
    }
});

test('PUT: mission cot - trasa bez planu i znacznik nie dostają __taklab_route', async () => {
    const cots = mockMission(['r-2', 'm-1']);
    try {
        await submit([
            route('r-2', {}),
            {
                id: 'm-1', type: 'Feature',
                properties: { type: 'a-f-G', how: 'm-g', callsign: 'Z', time, start: time, stale: time, metadata: { taklab_route: plan } },
                geometry: { type: 'Point', coordinates: [17.03, 51.11, 0] },
            },
        ]);
        assert.strictEqual(cots.length, 2);
        assert.ok(cots.every(c => !/__taklab_route/.test(c)));
    } finally {
        flight.tak.reset();
    }
});

flight.landing();
