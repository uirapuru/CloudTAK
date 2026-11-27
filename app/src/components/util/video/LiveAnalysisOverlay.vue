<template>
    <div
        v-if='enabled && path'
        class='live-analysis'
        data-testid='live-analysis'
    >
        <div class='live-analysis-bar'>
            <button
                type='button'
                class='btn btn-sm live-analysis-toggle'
                :class='analysisId !== null ? "btn-danger" : "btn-dark"'
                :disabled='busy'
                :title='analysisId !== null ? t("videoAnalysis.liveStop") : t("videoAnalysis.liveStart")'
                data-testid='live-analysis-toggle'
                @click='toggle'
            >
                <IconFaceId
                    :size='16'
                    stroke='1.5'
                />
                <span
                    class='ms-1'
                    v-text='analysisId !== null ? t("videoAnalysis.liveOff") : t("videoAnalysis.liveOn")'
                />
            </button>
            <span
                v-if='analysisId !== null && state === "queued"'
                class='badge bg-yellow text-dark ms-1'
                v-text='t("videoAnalysis.liveQueued")'
            />
        </div>
        <div
            v-if='notice'
            class='live-analysis-notice alert py-1 px-2 mb-0'
            :class='notice.level === "warning" ? "alert-warning" : "alert-info"'
            role='status'
            v-text='notice.text'
        />
        <div
            v-if='error'
            class='live-analysis-notice alert alert-danger py-1 px-2 mb-0'
            role='alert'
            v-text='error'
        />

        <div
            class='live-analysis-layer'
            :style='layerStyle'
        >
            <div
                v-for='(face, i) in faces'
                :key='i'
                class='live-analysis-box'
                :class='`box-${face.state}`'
                :style='boxStyle(face)'
                data-testid='live-analysis-box'
            >
                <div class='live-analysis-label'>
                    <template v-if='face.state === "recognized"'>
                        <span v-text='t("videoAnalysis.recognized", { pct: face.confidence ?? 50 })' />
                        <span
                            v-if='face.label'
                            class='ms-1 opacity-75'
                            v-text='face.label'
                        />
                        <a
                            v-if='face.previous'
                            href='#'
                            class='d-block live-analysis-link'
                            data-testid='live-analysis-previous'
                            @click.prevent='opened = { face: face.label ?? "", previous: face.previous }'
                            v-text='t("videoAnalysis.previous")'
                        />
                    </template>
                    <span
                        v-else-if='face.state === "new"'
                        v-text='t("videoAnalysis.newPerson")'
                    />
                    <span
                        v-else
                        v-text='t("videoAnalysis.pending")'
                    />
                </div>
            </div>
        </div>

        <div
            v-if='opened'
            class='live-analysis-previous card'
            data-testid='live-analysis-previous-card'
        >
            <div class='card-body p-2'>
                <div class='d-flex align-items-start gap-2'>
                    <div
                        class='fw-semibold small flex-grow-1'
                        v-text='t("videoAnalysis.previousTitle", { label: opened.face })'
                    />
                    <button
                        type='button'
                        class='btn-close'
                        :aria-label='t("videoAnalysis.close")'
                        @click='opened = null'
                    />
                </div>
                <img
                    :src='sightingSrc(opened.previous.sighting_id, "frame", token)'
                    :alt='opened.face'
                    class='w-100 rounded mt-1'
                >
                <div
                    class='small text-muted mt-1'
                    v-text='t("videoAnalysis.previousWhere", { at: opened.previous.at.slice(0, 16), where: opened.previous.where })'
                />
                <a
                    v-if='opened.previous.analysis_id !== null'
                    href='#'
                    class='small'
                    @click.prevent='router.push(`/menu/video-analysis/${opened.previous.analysis_id}`)'
                    v-text='t("videoAnalysis.openAnalysis")'
                />
            </div>
        </div>
    </div>
</template>

<script setup lang='ts'>
/**
 * taklab: live video analysis switch and the boxes of recognised people over the
 * player. For the OTS administrator only (videoAnalysisEnabled); OTS decides.
 *
 * The worker sends person boxes of every analysed frame; the player asks for the
 * frame `latency()` seconds behind the newest one, so boxes match an HLS picture
 * that is a few seconds late. WebRTC passes 0.
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { IconFaceId } from '@tabler/icons-vue';
import { getRuntimeToken } from '../../../std.ts';
import {
    OVERLAY_POLL_MS,
    POLL_MS,
    type AnalysisNotice,
    type OverlayFace,
    contentRect,
    getAnalysis,
    getOverlay,
    liveAnalysisOf,
    sightingSrc,
    startAnalysis,
    stopAnalysis,
    videoAnalysisEnabled,
} from '../../../base/video-analysis.ts';

const props = defineProps<{
    path: string | null;
    video: HTMLVideoElement | undefined;
    latency: () => number;
}>();

const { t } = useI18n();
const router = useRouter();

const enabled = ref(false);
const analysisId = ref<number | null>(null);
const state = ref<string | null>(null);
const faces = ref<OverlayFace[]>([]);
const notice = ref<AnalysisNotice | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const token = ref<string | undefined>();
const opened = ref<{ face: string; previous: NonNullable<OverlayFace['previous']> } | null>(null);
const rect = ref({ left: 0, top: 0, width: 0, height: 0 });

let timer: ReturnType<typeof setInterval> | undefined;
let noticeTimer: ReturnType<typeof setInterval> | undefined;
let inFlight = false;
let resize: ResizeObserver | undefined;
/** Bumped whenever the analysis changes, so a late answer for another one is dropped. */
let run = 0;

const layerStyle = computed(() => ({
    left: `${rect.value.left}px`,
    top: `${rect.value.top}px`,
    width: `${rect.value.width}px`,
    height: `${rect.value.height}px`,
}));

function boxStyle(face: OverlayFace): Record<string, string> {
    const [x1, y1, x2, y2] = face.box;
    return {
        left: `${x1 * 100}%`,
        top: `${y1 * 100}%`,
        width: `${(x2 - x1) * 100}%`,
        height: `${(y2 - y1) * 100}%`,
    };
}

function measure(): void {
    const v = props.video;
    if (!v) return;
    rect.value = contentRect(
        { width: v.clientWidth, height: v.clientHeight },
        { width: v.videoWidth, height: v.videoHeight },
    );
}

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function stopPolling(): void {
    if (timer !== undefined) clearInterval(timer);
    if (noticeTimer !== undefined) clearInterval(noticeTimer);
    timer = noticeTimer = undefined;
    faces.value = [];
}

async function poll(mine: number): Promise<void> {
    const id = analysisId.value;
    if (id === null || inFlight) return;
    inFlight = true;
    try {
        const o = await getOverlay(id, props.latency());
        if (mine !== run) return;
        state.value = o.state;
        faces.value = o.running ? o.faces : [];
        error.value = null;
        if (o.state !== 'queued' && o.state !== 'running') {
            // stopped elsewhere, 30 minutes passed or the stream ended
            analysisId.value = null;
            notice.value = null;
            stopPolling();
        }
    } catch (err) {
        if (mine === run) error.value = message(err);
    } finally {
        inFlight = false;
    }
}

async function refreshNotice(mine: number): Promise<void> {
    const id = analysisId.value;
    if (id === null) return;
    try {
        const a = await getAnalysis(id);
        if (mine === run) notice.value = a.notice ?? null;
    } catch {
        // the overlay poll reports errors
    }
}

function follow(id: number | null): void {
    stopPolling();
    const mine = ++run;
    analysisId.value = id;
    notice.value = null;
    opened.value = null;
    if (id === null) return;
    timer = setInterval(() => poll(mine), OVERLAY_POLL_MS);
    noticeTimer = setInterval(() => refreshNotice(mine), POLL_MS);
    void poll(mine);
    void refreshNotice(mine);
}

async function toggle(): Promise<void> {
    if (!props.path) return;
    busy.value = true;
    error.value = null;
    try {
        if (analysisId.value !== null) {
            await stopAnalysis(analysisId.value);
            follow(null);
        } else {
            const a = await startAnalysis({ source: 'live', path: props.path });
            follow(a.id);
        }
    } catch (err) {
        error.value = message(err);
    } finally {
        busy.value = false;
    }
}

async function attach(): Promise<void> {
    follow(null);
    if (!enabled.value || !props.path) return;
    try {
        follow(await liveAnalysisOf(props.path));
    } catch {
        follow(null);
    }
}

onMounted(async () => {
    enabled.value = await videoAnalysisEnabled();
    if (!enabled.value) return;
    token.value = await getRuntimeToken();
    await attach();
});

watch(() => props.path, () => void attach());

watch(() => props.video, (v, old) => {
    resize?.disconnect();
    old?.removeEventListener('loadedmetadata', measure);
    old?.removeEventListener('resize', measure);
    if (!v) return;
    v.addEventListener('loadedmetadata', measure);
    v.addEventListener('resize', measure);
    resize = new ResizeObserver(measure);
    resize.observe(v);
    measure();
}, { immediate: true });

onUnmounted(() => {
    run++;
    stopPolling();
    resize?.disconnect();
    props.video?.removeEventListener('loadedmetadata', measure);
    props.video?.removeEventListener('resize', measure);
});
</script>

<style scoped>
.live-analysis {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 5;
}

.live-analysis-bar {
    position: absolute;
    top: 8px;
    left: 8px;
    display: flex;
    align-items: center;
    pointer-events: auto;
    z-index: 2;
}

.live-analysis-toggle {
    opacity: 0.9;
}

.live-analysis-notice {
    position: absolute;
    top: 44px;
    left: 8px;
    right: 8px;
    font-size: 12px;
    pointer-events: auto;
    z-index: 2;
}

.live-analysis-layer {
    position: absolute;
}

.live-analysis-box {
    position: absolute;
    border: 2px solid #f59f00;
    border-radius: 2px;
}

.live-analysis-box.box-recognized {
    border-color: #d63939;
}

.live-analysis-box.box-pending {
    border-color: rgba(255, 255, 255, 0.7);
    border-style: dashed;
}

.live-analysis-label {
    position: absolute;
    left: -2px;
    bottom: 100%;
    margin-bottom: 2px;
    padding: 1px 6px;
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    font-size: 12px;
    line-height: 1.4;
    white-space: nowrap;
    border-radius: 3px;
    pointer-events: auto;
}

.live-analysis-link {
    color: #8fd3ff;
    text-decoration: underline;
}

.live-analysis-previous {
    position: absolute;
    right: 8px;
    bottom: 8px;
    width: min(280px, 60%);
    pointer-events: auto;
    z-index: 3;
}
</style>
