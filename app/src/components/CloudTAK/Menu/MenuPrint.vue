<template>
    <MenuTemplate :name='t("print.title")'>
        <template #default>
            <div class='row g-2 px-2 pt-2'>
                <div class='col-12 small text-muted px-3'>
                    {{ pinned ? t('print.hintPinned') : t('print.hint') }}
                </div>

                <div class='col-12'>
                    <TablerToggle
                        v-model='pinned'
                        :label='t("print.pin")'
                        data-testid='print-pin'
                    />
                </div>

                <div class='col-6'>
                    <TranslatedEnum
                        v-model='form.scale'
                        :label='t("print.scale")'
                        :options='scaleOptions'
                        data-testid='print-scale'
                    />
                </div>
                <div class='col-6'>
                    <TranslatedEnum
                        v-model='form.paper'
                        :label='t("print.paper")'
                        :options='paperOptions'
                        data-testid='print-paper'
                    />
                </div>
                <div class='col-6'>
                    <TranslatedEnum
                        v-model='form.orientation'
                        :label='t("print.orientation")'
                        :options='orientationOptions'
                        data-testid='print-orientation'
                    />
                </div>
                <div class='col-6'>
                    <TranslatedEnum
                        v-model='form.format'
                        :label='t("print.format")'
                        :options='formatOptions'
                        data-testid='print-format'
                    />
                </div>
                <div class='col-12'>
                    <TablerToggle
                        v-model='form.grid'
                        :label='t("print.grid")'
                        data-testid='print-grid'
                    />
                </div>
                <div class='col-12'>
                    <TablerInput
                        v-model='form.title'
                        :label='t("print.sheetTitle")'
                        :placeholder='defaultTitle'
                        :maxlength='60'
                        data-testid='print-title'
                    />
                </div>

                <div class='col-12 px-3 small'>
                    <div class='d-flex gap-1'>
                        <span class='text-muted'>{{ t('print.centre') }}:</span>
                        <span
                            class='font-monospace'
                            data-testid='print-centre'
                            v-text='defaultTitle'
                        />
                    </div>
                    <div class='d-flex gap-1'>
                        <span class='text-muted'>{{ t('print.extent') }}:</span>
                        <span v-text='extentText' />
                    </div>
                    <div class='d-flex align-items-center gap-1'>
                        <span class='text-muted'>{{ t('print.code') }}:</span>
                        <span
                            class='font-monospace'
                            data-testid='print-code'
                            v-text='code'
                        />
                        <TablerIconButton
                            :title='t("print.copyLink")'
                            data-testid='print-copy'
                            @click='copyLink'
                        >
                            <IconLink
                                :size='18'
                                stroke='1'
                            />
                        </TablerIconButton>
                        <span
                            v-if='copied'
                            class='text-green'
                            v-text='t("print.copied")'
                        />
                    </div>
                </div>

                <div
                    v-if='invalidCode'
                    class='col-12 small text-red px-3'
                    data-testid='print-invalid'
                    v-text='t("print.invalidCode", { code: invalidCode })'
                />
                <div
                    v-if='errorText'
                    class='col-12 small text-red px-3'
                    data-testid='print-error'
                    v-text='errorText'
                />

                <div class='col-12 pb-2'>
                    <button
                        class='btn btn-primary w-100'
                        :disabled='busy'
                        data-testid='print-run'
                        @click='print'
                    >
                        <IconPrinter
                            :size='20'
                            stroke='1'
                            class='me-2'
                        />
                        {{ busy ? t('print.rendering') : t('print.run') }}
                    </button>
                </div>
            </div>
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { IconLink, IconPrinter } from '@tabler/icons-vue';
import { TablerIconButton, TablerInput, TablerToggle } from '@tak-ps/vue-tabler';
import type { Map as MapLibreMap } from 'maplibre-gl';
import MenuTemplate from '../util/MenuTemplate.vue';
import TranslatedEnum from '../util/TranslatedEnum.vue';
import { useMapStore } from '../../../stores/map.ts';
import {
    DEFAULT_SCALE,
    PRINT_DPI,
    PRINT_SCALES,
    centreMgrs,
    decodeSheetCode,
    encodeSheetCode,
    formatScale,
    groundSize,
    sheetBounds,
    sheetFilename,
    type Orientation,
    type PaperSize,
    type PrintFormat,
    type PrintSheet,
} from '../../../base/print/sheet.ts';
import { renderSheetMap } from '../../../base/print/render.ts';
import { composePage, type PageLabels } from '../../../base/print/compose.ts';
import { hideSheetFrame, pageBlob, saveBlob, sheetFrameOnTop, showSheetFrame } from '../../../base/print/export.ts';

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const mapStore = useMapStore();

const form = ref({
    scale: String(DEFAULT_SCALE),
    paper: 'a4' as PaperSize,
    orientation: 'portrait' as Orientation,
    format: 'pdf' as PrintFormat,
    grid: true,
    title: '',
});
const centre = ref<{ lng: number; lat: number }>({ lng: 0, lat: 0 });
const pinned = ref(false);
const busy = ref(false);
const copied = ref(false);
const errorText = ref('');
const invalidCode = ref('');

let map: MapLibreMap | undefined;
let waitTimer: ReturnType<typeof setInterval> | undefined;

const sheet = computed<PrintSheet>(() => ({
    lng: centre.value.lng,
    lat: centre.value.lat,
    scale: Number(form.value.scale),
    orientation: form.value.orientation,
    paper: form.value.paper,
}));

const code = computed(() => {
    try {
        return encodeSheetCode(sheet.value);
    } catch {
        return '';
    }
});

const defaultTitle = computed(() => centreMgrs(sheet.value));

const extentText = computed(() => {
    const size = groundSize(sheet.value);
    const n = new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 });
    return `${n.format(size.width / 1000)} × ${n.format(size.height / 1000)} km`;
});

const scaleOptions = computed(() => PRINT_SCALES.map((value) => ({ value: String(value), label: formatScale(value) })));
const paperOptions = computed(() => [
    { value: 'a4', label: 'A4' },
    { value: 'a3', label: 'A3' },
]);
const orientationOptions = computed(() => [
    { value: 'portrait', label: t('print.portrait') },
    { value: 'landscape', label: t('print.landscape') },
]);
const formatOptions = computed(() => [
    { value: 'pdf', label: 'PDF' },
    { value: 'png', label: 'PNG' },
]);

function followCentre(): void {
    if (!map || pinned.value) return;
    const c = map.getCenter();
    centre.value = { lng: c.lng, lat: c.lat };
}

function redrawFrame(): void {
    if (!map) return;
    try {
        showSheetFrame(map, sheet.value);
    } catch (err) {
        console.warn('Print sheet frame', err);
    }
}

function onStyleData(): void {
    // A basemap change can rebuild the style and drop the frame.
    if (map && (!map.getLayer('taklab-print-sheet-line') || !sheetFrameOnTop(map))) redrawFrame();
}

function attach(target: MapLibreMap): void {
    map = target;

    const fromAddress = typeof route.query.s === 'string' ? route.query.s : '';
    if (fromAddress) {
        const decoded = decodeSheetCode(fromAddress);
        if (decoded) {
            form.value.scale = String(decoded.scale);
            form.value.orientation = decoded.orientation;
            form.value.paper = decoded.paper;
            centre.value = { lng: decoded.lng, lat: decoded.lat };
            pinned.value = true;
            map.jumpTo({ bearing: 0, pitch: 0 });
            // keep the frame clear of the menu panel on the right
            const right = window.innerWidth >= 768 ? Math.min(460, window.innerWidth * 0.4) : 40;
            map.fitBounds(sheetBounds(decoded), { padding: { top: 60, bottom: 60, left: 60, right }, animate: false });
        } else {
            invalidCode.value = fromAddress;
        }
    }

    followCentre();
    redrawFrame();
    map.on('move', followCentre);
    map.on('styledata', onStyleData);
}

onMounted(() => {
    const tryAttach = () => {
        if (!mapStore.isMapLoaded) return false;
        try {
            attach(mapStore.map);
            return true;
        } catch {
            return false;
        }
    };
    if (!tryAttach()) {
        waitTimer = setInterval(() => {
            if (tryAttach() && waitTimer) {
                clearInterval(waitTimer);
                waitTimer = undefined;
            }
        }, 250);
    }
});

onUnmounted(() => {
    if (waitTimer) clearInterval(waitTimer);
    if (!map) return;
    map.off('move', followCentre);
    map.off('styledata', onStyleData);
    hideSheetFrame(map);
});

watch(sheet, () => {
    redrawFrame();
    copied.value = false;
});

watch(pinned, (value) => {
    if (!value) followCentre();
});

/** Keep the sheet code in the address so the link can be shared as is. */
watch(code, (value) => {
    if (!value || route.query.s === value) return;
    void router.replace({ query: { ...route.query, s: value } });
});

function shareLink(): string {
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.set('s', code.value);
    return url.toString();
}

async function copyLink(): Promise<void> {
    try {
        await navigator.clipboard.writeText(shareLink());
        copied.value = true;
    } catch (err) {
        errorText.value = err instanceof Error ? err.message : String(err);
    }
}

function pageLabels(): PageLabels {
    return {
        centre: t('print.page.centre'),
        grid: (spacing) => t('print.page.grid', { spacing }),
        trueNorth: t('print.page.trueNorth'),
        gridNorth: t('print.page.gridNorth'),
        magneticNorth: t('print.page.magneticNorth'),
        declination: (value, date) => t('print.page.declination', { value, date }),
        convergence: (value) => t('print.page.convergence', { value }),
        gridMagnetic: (value) => t('print.page.gridMagnetic', { value }),
        printed: (when) => t('print.page.printed', { when }),
    };
}

async function print(): Promise<void> {
    if (!map || busy.value) return;
    busy.value = true;
    errorText.value = '';
    try {
        const current = { ...sheet.value };
        const rendered = await renderSheetMap(map, current, { dpi: PRINT_DPI });
        const page = composePage(rendered.canvas, rendered.frame, current, {
            title: form.value.title.trim() || centreMgrs(current),
            grid: form.value.grid,
            dpi: PRINT_DPI,
            locale: locale.value,
            labels: pageLabels(),
            attribution: rendered.attribution,
        });
        const blob = await pageBlob(page, current, form.value.format);
        saveBlob(blob, sheetFilename(current, form.value.format));
    } catch (err) {
        console.error('Print failed', err);
        const message = err instanceof Error ? err.message : String(err);
        errorText.value = message === 'timeout' ? t('print.timeout') : t('print.failed', { message });
    } finally {
        busy.value = false;
    }
}
</script>
