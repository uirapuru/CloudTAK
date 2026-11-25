import { Type, type TSchema, type Static } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth from '../../common/auth.js';
import { authenticatedProfile } from '../../common/control/profile.js';
import type ConfigStateless from '../config.js';
import { liveVideoControl } from '../lib/control/live-video.js';

/*
 * Nullable fields as one schema with a type list: batch-schema validates with
 * coerceTypes and removeAdditional, and inside anyOf AJV would coerce 0 or
 * false to the null branch and strip properties of a failed object branch.
 */
const NullableString = Type.Unsafe<string | null>({ type: ['string', 'null'] });
const NullableNumber = Type.Unsafe<number | null>({ type: ['number', 'null'] });

function nullableObject<T extends TSchema>(schema: T) {
    return Type.Unsafe<Static<T> | null>({ ...schema, type: ['object', 'null'] });
}

const VideoTrack = Type.Object({
    codec: NullableString,
    width: NullableNumber,
    height: NullableNumber,
    profile: NullableString,
    level: NullableString,
    fps: NullableNumber,
});

const AudioTrack = Type.Object({
    codec: NullableString,
    sample_rate: NullableNumber,
    channels: NullableNumber,
});

const Tech = Type.Object({
    source: NullableString,
    transport: NullableString,
    readers: NullableNumber,
    bytes_received: NullableNumber,
    bitrate_kbps: NullableNumber,
    packets_lost: NullableNumber,
    jitter_ms: NullableNumber,
    video: nullableObject(VideoTrack),
    audio: nullableObject(AudioTrack),
});

const Stream = Type.Object({
    path: Type.String(),
    username: Type.String(),
    started_at: NullableString,
    tech: nullableObject(Tech),
});

export default async function router(schema: Schema, config: ConfigStateless) {
    // taklab: OTS address with the Marti TLS proxy that passes the client certificate
    // (server.api, https://<env>-ots:8443), as for recordings; LIVE_VIDEO_OTS_URL overrides it for tests.
    liveVideoControl.baseUrl = () => process.env.LIVE_VIDEO_OTS_URL || config.server?.api || null;

    await schema.get('/video/live', {
        name: 'Live Video Streams',
        group: 'VideoLive',
        description: 'Streams being published to the OTS of this environment right now, with MediaMTX technical data; supported=false when OTS has no such list',
        security: Auth.security({}),
        res: Type.Object({
            supported: Type.Boolean(),
            generated_at: Type.Optional(NullableString),
            streams: Type.Array(Stream),
        }),
    }, async (req, res) => {
        try {
            const user = await Auth.as_user(config, req);
            const profile = await authenticatedProfile(config, user.email);
            res.json(await liveVideoControl.list(profile.auth));
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
