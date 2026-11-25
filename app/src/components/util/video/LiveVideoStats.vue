<template>
    <div class='live-video-stats'>
        <button
            type='button'
            class='live-video-stats-toggle btn btn-sm w-100 d-flex align-items-center gap-2'
            :aria-expanded='open'
            :title='open ? t("liveVideo.stats.hide") : t("liveVideo.stats.show")'
            @click='open = !open'
        >
            <IconChevronDown
                v-if='open'
                :size='16'
            />
            <IconChevronRight
                v-else
                :size='16'
            />
            <span v-text='t("liveVideo.stats.title")' />
            <span
                v-if='!open && summary'
                class='ms-auto text-secondary text-truncate'
                v-text='summary'
            />
        </button>

        <div
            v-if='open'
            class='live-video-stats-body row g-0 px-2 pb-2'
        >
            <div class='col-12 col-sm-6 pe-sm-2'>
                <div
                    class='live-video-stats-head'
                    v-text='t("liveVideo.stats.server")'
                />
                <template v-if='serverRows.length'>
                    <div
                        v-for='row in serverRows'
                        :key='row.key'
                        class='live-video-stats-row d-flex'
                        :data-key='row.key'
                    >
                        <span
                            class='text-secondary'
                            v-text='row.label'
                        />
                        <span
                            class='ms-auto text-end'
                            v-text='row.value'
                        />
                    </div>
                </template>
                <div
                    v-else
                    class='text-secondary'
                    v-text='t("liveVideo.stats.noServer")'
                />
            </div>
            <div class='col-12 col-sm-6 ps-sm-2'>
                <div
                    class='live-video-stats-head'
                    v-text='t("liveVideo.stats.client")'
                />
                <div
                    v-for='row in clientRows'
                    :key='row.key'
                    class='live-video-stats-row d-flex'
                    :data-key='row.key'
                >
                    <span
                        class='text-secondary'
                        v-text='row.label'
                    />
                    <span
                        class='ms-auto text-end'
                        v-text='row.value'
                    />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang='ts'>
/**
 * taklab: technical data under the live player - the sender as MediaMTX sees
 * it (from the live stream list) and this player (hls.js and the element).
 */
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-vue';
import {
    formatBitrate,
    formatDuration,
    formatResolution,
    streamAge,
    type ClientStats,
    type LiveVideoStream,
} from '../../../base/live-video.ts';

const props = defineProps<{
    stream: LiveVideoStream | null;
    client: ClientStats | null;
}>();

const { t, locale } = useI18n();

const open = ref(false);
const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
    tick = setInterval(() => { now.value = Date.now(); }, 1000);
});

onUnmounted(() => {
    if (tick) clearInterval(tick);
});

type Row = { key: string; label: string; value: string };

function decimal(value: number, digits = 1): string {
    return new Intl.NumberFormat(locale.value, { maximumFractionDigits: digits }).format(value);
}

function rows(list: Array<[string, string, string | null | undefined | false]>): Row[] {
    return list
        .filter((r): r is [string, string, string] => typeof r[2] === 'string' && r[2] !== '')
        .map(([key, label, value]) => ({ key, label, value }));
}

const serverRows = computed<Row[]>(() => {
    const s = props.stream;
    if (!s) return [];
    const tech = s.tech;
    const v = tech?.video;
    const a = tech?.audio;
    const codec = v?.codec ? [v.codec, v.profile, v.level].filter(Boolean).join(' ') : null;
    const audio = a?.codec
        ? [a.codec, a.sample_rate ? `${decimal(a.sample_rate / 1000)} kHz` : null, a.channels ? `${a.channels} ch` : null].filter(Boolean).join(', ')
        : null;

    return rows([
        ['codec', t('liveVideo.stats.codec'), codec],
        ['resolution', t('liveVideo.stats.resolution'), v ? formatResolution(v.width, v.height) : null],
        ['fps', t('liveVideo.stats.fps'), typeof v?.fps === 'number' ? decimal(v.fps) : null],
        ['bitrate', t('liveVideo.stats.bitrate'), formatBitrate(tech?.bitrate_kbps, locale.value)],
        ['transport', t('liveVideo.stats.transport'), tech?.transport],
        ['packetsLost', t('liveVideo.stats.packetsLost'), typeof tech?.packets_lost === 'number' ? decimal(tech.packets_lost, 0) : null],
        ['jitter', t('liveVideo.stats.jitter'), typeof tech?.jitter_ms === 'number' ? t('liveVideo.stats.ms', { value: decimal(tech.jitter_ms) }) : null],
        ['readers', t('liveVideo.stats.readers'), typeof tech?.readers === 'number' ? String(tech.readers) : null],
        ['duration', t('liveVideo.stats.duration'), formatDuration(streamAge(s, now.value))],
        ['audio', t('liveVideo.stats.audio'), audio],
    ]);
});

const clientRows = computed<Row[]>(() => {
    const c = props.client;
    if (!c) return [];
    return rows([
        ['levelResolution', t('liveVideo.stats.levelResolution'), formatResolution(c.width, c.height)],
        ['download', t('liveVideo.stats.download'), formatBitrate(c.download_kbps, locale.value)],
        ['levelBitrate', t('liveVideo.stats.levelBitrate'), formatBitrate(c.level_kbps, locale.value)],
        ['latency', t('liveVideo.stats.latency'), c.latency_s !== null ? t('liveVideo.stats.seconds', { value: decimal(c.latency_s) }) : null],
        ['buffer', t('liveVideo.stats.buffer'), c.buffer_s !== null ? t('liveVideo.stats.seconds', { value: decimal(c.buffer_s) }) : null],
        ['dropped', t('liveVideo.stats.dropped'), c.dropped_frames !== null && c.total_frames !== null
            ? t('liveVideo.stats.frames', { dropped: decimal(c.dropped_frames, 0), total: decimal(c.total_frames, 0) })
            : null],
    ]);
});

const summary = computed(() => {
    const parts: string[] = [];
    const v = props.stream?.tech?.video;
    const resolution = v ? formatResolution(v.width, v.height) : formatResolution(props.client?.width, props.client?.height);
    if (resolution) parts.push(resolution);
    const bitrate = formatBitrate(props.stream?.tech?.bitrate_kbps ?? props.client?.download_kbps, locale.value);
    if (bitrate) parts.push(bitrate);
    if (props.client && props.client.latency_s !== null) parts.push(t('liveVideo.stats.seconds', { value: decimal(props.client.latency_s) }));
    return parts.join(' · ');
});
</script>

<style scoped>
.live-video-stats {
    font-size: 0.75rem;
    background-color: rgba(0, 0, 0, 0.55);
    color: #fff;
}

.live-video-stats-toggle {
    color: inherit;
    border-radius: 0;
    padding: 2px 8px;
    font-size: 0.75rem;
}

.live-video-stats-body {
    max-height: 40vh;
    overflow-y: auto;
}

.live-video-stats-head {
    font-weight: 600;
    margin-top: 4px;
    margin-bottom: 2px;
}

.live-video-stats-row {
    gap: 8px;
    line-height: 1.35;
}

.live-video-stats .text-secondary {
    color: rgba(255, 255, 255, 0.65) !important;
}
</style>
