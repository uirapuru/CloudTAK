import type CoT from '@tak-ps/node-cot';

/**
 * Recording markers published by the taklab OTS register. The recording id
 * travels in the CoT in one of two forms (both read, the link is proposed):
 *
 *   <link uid="rec:<id>" relation="r-u" type="taklab-recording"/>
 *   <__taklab_recording id="<id>" kind="video|voice|scan"/>
 *
 * node-cot keeps <link> in properties.links on its own; the custom element is
 * dropped, so it is copied to properties.metadata.taklab_recording here.
 */
export const RECORDING_ELEMENT = '__taklab_recording';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const KINDS = ['video', 'voice', 'scan'];

export type RecordingRef = { id: string; kind?: string };

export function readRecordingRef(cot: CoT): RecordingRef | null {
    const detail = cot.raw.event.detail as Record<string, unknown> | undefined;
    let element = detail?.[RECORDING_ELEMENT] as { _attributes?: Record<string, unknown> } | Array<{ _attributes?: Record<string, unknown> }> | undefined;
    if (Array.isArray(element)) element = element[0];
    const attrs = element?._attributes;
    if (!attrs) return null;

    const id = typeof attrs.id === 'string' || typeof attrs.id === 'number' ? String(attrs.id) : '';
    if (!ID.test(id)) return null;
    const kind = typeof attrs.kind === 'string' && KINDS.includes(attrs.kind) ? attrs.kind : undefined;
    return kind ? { id, kind } : { id };
}

export function applyRecordingRef(
    cot: CoT,
    feat: { properties: Record<string, unknown> },
): void {
    const ref = readRecordingRef(cot);
    if (!ref) return;
    const existing = feat.properties.metadata as Record<string, unknown> | undefined;
    feat.properties.metadata = { ...(existing && typeof existing === 'object' ? existing : {}), taklab_recording: ref };
}
