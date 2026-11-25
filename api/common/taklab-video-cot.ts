import type CoT from '@tak-ps/node-cot';

/**
 * Camera markers sent by the TakLab ATAK plugin while it publishes video:
 *
 *   <__video url="rtsp://<host>:<port>/<path>"/>
 *   <__taklab_video path="<path>"/>
 *
 * node-cot turns <__video> into properties.video but drops the custom
 * element, so its path is copied to properties.metadata.taklab_video here.
 * The browser matches it against the live stream list.
 */
export const LIVE_VIDEO_ELEMENT = '__taklab_video';

const PATH = /^[A-Za-z0-9._~/-]{1,128}$/;

export type LiveVideoRef = { path: string };

export function readLiveVideoRef(cot: CoT): LiveVideoRef | null {
    const detail = cot.raw.event.detail as Record<string, unknown> | undefined;
    let element = detail?.[LIVE_VIDEO_ELEMENT] as { _attributes?: Record<string, unknown> } | Array<{ _attributes?: Record<string, unknown> }> | undefined;
    if (Array.isArray(element)) element = element[0];
    const attrs = element?._attributes;
    if (!attrs || typeof attrs.path !== 'string') return null;

    const path = attrs.path.trim().replace(/^\/+|\/+$/g, '');
    if (!PATH.test(path) || path.includes('..')) return null;
    return { path };
}

export function applyLiveVideoRef(
    cot: CoT,
    feat: { properties: Record<string, unknown> },
): void {
    const ref = readLiveVideoRef(cot);
    if (!ref) return;
    const existing = feat.properties.metadata as Record<string, unknown> | undefined;
    feat.properties.metadata = { ...(existing && typeof existing === 'object' ? existing : {}), taklab_video: ref };
}
