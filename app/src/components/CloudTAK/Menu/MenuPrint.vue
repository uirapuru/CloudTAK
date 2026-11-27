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
                <div class='col-6'>
                    <TranslatedEnum
                        v-model='form.columns'
                        :label='t("print.columns")'
                        :options='sideOptions'
                        data-testid='print-columns'
                    />
                </div>
                <div class='col-6'>
                    <TranslatedEnum
                        v-model='form.rows'
                        :label='t("print.rows")'
                        :options='sideOptions'
                        data-testid='print-rows'
                    />
                </div>
                <div class='col-12'>
                    <TranslatedEnum
                        v-model='form.background'
                        :label='t("print.background")'
                        :options='backgroundOptions'
                        data-testid='print-background'
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
                    v-if='tooMany'
                    class='col-12 small text-red px-3'
                    data-testid='print-too-many'
                    v-text='t("print.tooMany", { max: MAX_SHEETS })'
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
                        :disabled='busy || tooMany'
                        data-testid='print-run'
                        @click='print'
                    >
                        <IconPrinter
                            :size='20'
                            stroke='1'
                            class='me-2'
                        />
                        {{ busyText || runText }}
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
import OverlayManager from '../../../base/overlay.ts';
import {
    DEFAULT_SCALE,
    MAX_SHEETS,
    MAX_SHEETS_PER_SIDE,
    PRINT_DPI,
    PRINT_SCALES,
    centreMgrs,
    decodeSheetCode,
    encodeSheetCode,
    formatScale,
    groundSize,
    planBounds,
    planSheets,
    validBlock,
    type Orientation,
    type PaperSize,
    type PrintFormat,
    type PrintPlan,
} from '../../../base/print/sheet.ts';
import { renderSheetMap } from '../../../base/print/render.ts';
import { composePage, type PageLabels } from '../../../base/print/compose.ts';
import { hideSheetFrame, pdfBlob, pngBlob, saveBlob, sheetFrameOnTop, showSheetFrame } from '../../../base/print/export.ts';

type Background = 'map' | 'white';

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const mapStore = useMapStore();

const form = ref({
    scale: String(DEFAULT_SCALE),
    paper: 'a4' as PaperSize,
    orientation: 'portrait' as Orientation,
    format: 'pdf' as PrintFormat,
    columns: '1',
    rows: '1',
    background: 'map' as Background,
    grid: true,
    title: '',
});
const centre = ref<{ lng: number; lat: number }>({ lng: 0, lat: 0 });
const pinned = ref(false);
const busyText = ref('');
const copied = ref(false);
const errorText = ref('');
const invalidCode = ref('');

const busy = computed(() => Boolean(busyText.value));

let map: MapLibreMap | undefined;
let waitTimer: ReturnType<typeof setInterval> | undefined;

const plan = computed<PrintPlan>(() => ({
    lng: centre.value.lng,
    lat: centre.value.lat,
    scale: Number(form.value.scale),
    orientation: form.value.orientation,
    paper: form.value.paper,
    columns: Number(form.value.columns),
    rows: Number(form.value.rows),
}));

const sheetCount = computed(() => plan.value.columns * plan.value.rows);
const tooMany = computed(() => !validBlock(plan.value.columns, plan.value.rows));

const code = computed(() => {
    try {
        return encodeSheetCode(plan.value);
    } catch {
        return '';
    }
});

const defaultTitle = computed(() => centreMgrs(plan.value));

const extentText = computed(() => {
    const size = groundSize(plan.value);
    const n = new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 });
    return `${n.format(size.width * plan.value.columns / 1000)} × ${n.format(size.height * plan.value.rows / 1000)} km`;
});

const runText = computed(() => sheetCount.value > 1
    ? t('print.runMany', { count: sheetCount.value })
    : t('print.run'));

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
const sideOptions = computed(() => Array.from({ length: MAX_SHEETS_PER_SIDE }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
})));
const backgroundOptions = computed(() => [
    { value: 'map', label: t('print.backgroundMap') },
    { value: 'white', label: t('print.backgroundWhite') },
]);

function followCentre(): void {
    if (!map || pinned.value) return;
    const c = map.getCenter();
    centre.value = { lng: c.lng, lat: c.lat };
}

function redrawFrame(): void {
    if (!map || tooMany.value) return;
    try {
        showSheetFrame(map, plan.value);
    } catch (err) {
        console.warn('Print sheet frame', err);
    }
}

function onStyleData(): void {
    // A basemap change can rebuild the style, drop the frame or slot layers above it.
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
            form.value.columns = String(decoded.columns);
            form.value.rows = String(decoded.rows);
            centre.value = { lng: decoded.lng, lat: decoded.lat };
            pinned.value = true;
            map.jumpTo({ bearing: 0, pitch: 0 });
            // keep the frame clear of the menu panel on the right
            const right = window.innerWidth >= 768 ? Math.min(460, window.innerWidth * 0.4) : 40;
            map.fitBounds(planBounds(decoded), { padding: { top: 60, bottom: 60, left: 60, right }, animate: false });
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

watch(plan, () => {
    if (tooMany.value && map) hideSheetFrame(map);
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
        sheet: (index, total) => t('print.page.sheet', { index, total }),
    };
}

/** Map layers of the basemap overlays, left out for a white background. */
function basemapLayers(): string[] {
    return OverlayManager.loaded
        .filter((overlay) => overlay.mode === 'basemap')
        .flatMap((overlay) => overlay.styles.map((layer) => layer.id));
}

async function print(): Promise<void> {
    if (!map || busy.value || tooMany.value) return;
    errorText.value = '';
    const current = { ...plan.value };
    const sheets = planSheets(current);
    const format = form.value.format;
    const hideLayers = form.value.background === 'white' ? basemapLayers() : undefined;
    const baseTitle = form.value.title.trim();

    try {
        const pages: HTMLCanvasElement[] = [];
        for (const sheet of sheets) {
            busyText.value = sheets.length > 1
                ? t('print.renderingSheet', { index: sheet.index, total: sheets.length })
                : t('print.rendering');
            const rendered = await renderSheetMap(map, sheet, { dpi: PRINT_DPI, hideLayers });
            const page = composePage(rendered.canvas, rendered.frame, sheet, {
                title: baseTitle || centreMgrs(sheets.length > 1 ? current : sheet),
                grid: form.value.grid,
                dpi: PRINT_DPI,
                locale: locale.value,
                labels: pageLabels(),
                attribution: rendered.attribution,
                block: { index: sheet.index, columns: current.columns, rows: current.rows },
            });
            if (format === 'png') {
                const suffix = sheets.length > 1 ? `-${sheet.index}` : '';
                saveBlob(await pngBlob(page), `mapa-${code.value}${suffix}.png`);
            } else {
                pages.push(page);
            }
        }
        if (format === 'pdf') {
            busyText.value = t('print.saving');
            saveBlob(await pdfBlob(pages, current, `mapa-${code.value}`), `mapa-${code.value}.pdf`);
        }
    } catch (err) {
        console.error('Print failed', err);
        const message = err instanceof Error ? err.message : String(err);
        errorText.value = message === 'timeout' ? t('print.timeout') : t('print.failed', { message });
    } finally {
        busyText.value = '';
    }
}
</script>
