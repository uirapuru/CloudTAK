/** WebSocket of the taklab voice log (live listening and PTT on the map). */
export const VOICE_WS_PATH = '/api/voice/ws';

/** The CloudTAK connection socket accepts any path, so it has to skip this one. */
export function isVoiceUpgrade(url?: string): boolean {
    return (url || '').split('?')[0] === VOICE_WS_PATH;
}
