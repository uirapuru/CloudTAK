<template>
    <FloatingPane
        :uid='uid'
        @close='emit("close")'
    >
        <template #header>
            <IconCamera
                :size='24'
                stroke='1'
                class='ms-2'
            />
            <div
                class='mx-2 text-sm text-truncate'
                v-text='t("tools.quickPic.title")'
            />
        </template>

        <TablerLoading
            v-if='stage === "capturing"'
            :desc='t("tools.quickPic.waiting")'
        />
        <TablerLoading
            v-else-if='stage === "uploading"'
            :desc='t("tools.quickPic.uploading")'
        />
        <TablerLoading
            v-else-if='stage === "saving"'
            :desc='t("tools.quickPic.creating")'
        />
        <template v-else>
            <TablerInlineAlert
                v-if='error'
                :title='t("tools.common.errorOccurred")'
                :description='error.message'
            />
            <p
                v-else
                class='text-secondary m-0'
            >
                {{ t('tools.quickPic.hint') }}
            </p>
        </template>

        <input
            ref='fileInput'
            type='file'
            accept='image/*'
            capture='environment'
            class='d-none'
            @change='stageFile($event)'
        >

        <template #footer>
            <TablerButton
                class='btn-primary w-100'
                :disabled='stage !== "idle"'
                @click='capture'
            >
                <IconCamera
                    :size='20'
                    stroke='1'
                />
                <span class='mx-2'>{{ t('tools.quickPic.take') }}</span>
            </TablerButton>
        </template>
    </FloatingPane>
</template>

<script setup lang='ts'>
import { ref, onMounted, useTemplateRef } from 'vue';
import { useRouter } from 'vue-router';
import { v4 as randomUUID } from 'uuid';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import type { LngLatLike } from 'maplibre-gl';
import { IconCamera } from '@tabler/icons-vue';
import {
    TablerButton,
    TablerLoading,
    TablerInlineAlert,
} from '@tak-ps/vue-tabler';
import FloatingPane from '../util/FloatingPane.vue';
import { std, stdurl } from '../../../std.ts';
import { isNativePlatform } from '../../../utils/capacitor.ts';
import { quickPicName, quickPicFeature } from '../../../utils/quick-pic.ts';
import { useMapStore } from '../../../stores/map.ts';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

type Stage = 'idle' | 'capturing' | 'uploading' | 'saving';

defineProps({
    uid: {
        type: String,
        required: true
    }
});

const emit = defineEmits<{
    (e: 'close'): void;
}>();

const router = useRouter();
const mapStore = useMapStore();

const stage = ref<Stage>('idle');
const error = ref<Error | undefined>();
const fileInput = useTemplateRef<HTMLInputElement>('fileInput');

onMounted(() => {
    void capture();
});

async function capture(): Promise<void> {
    error.value = undefined;

    if (!isNativePlatform()) {
        fileInput.value?.click();
        return;
    }

    stage.value = 'capturing';

    let file: File;
    try {
        const photo = await Camera.getPhoto({
            source: CameraSource.Camera,
            resultType: CameraResultType.Uri,
            quality: 80,
            width: 1600,
            correctOrientation: true,
            saveToGallery: false,
        });

        if (!photo.webPath) throw new Error(t('tools.quickPic.noImage'));

        const blob = await (await fetch(photo.webPath)).blob();
        file = new File([blob], `${quickPicName()}.${photo.format || 'jpeg'}`, {
            type: blob.type || 'image/jpeg'
        });
    } catch (err) {
        if (isCancel(err)) {
            emit('close');
        } else {
            fail(err);
        }
        return;
    }

    await submit(file);
}

function stageFile(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (!file) return;

    void submit(file);
}

async function submit(file: File): Promise<void> {
    try {
        stage.value = 'uploading';

        const url = stdurl('/api/attachment');
        if (mapStore.mission) url.searchParams.set('mission', mapStore.mission.meta.guid);

        const body = new FormData();
        body.append('file', file);

        const res = await std(url, { method: 'PUT', body, timeout: 120000 }) as { hash?: string };
        if (!res.hash) throw new Error(t('tools.quickPic.noHash'));

        stage.value = 'saving';

        const center = mapStore.map.getCenter();
        const gps = mapStore.gpsCoordinates;
        const coordinates: [number, number] = gps
            ? [gps.lng, gps.lat]
            : [center.lng, center.lat];

        const id = randomUUID();

        const feat = quickPicFeature({
            id,
            hash: res.hash,
            callsign: file.name.replace(/\.[^.]*$/, ''),
            coordinates,
            altitude: gps ? mapStore.gpsAltitude : null,
        });

        await mapStore.worker.db.add(feat, { authored: true });

        mapStore.map.flyTo({
            center: coordinates as LngLatLike,
            zoom: Math.max(mapStore.map.getZoom(), 14)
        });

        emit('close');

        await router.push(`/cot/${id}`);
    } catch (err) {
        fail(err);
    }
}

function isCancel(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /cancel/i.test(message);
}

function fail(err: unknown): void {
    stage.value = 'idle';
    error.value = err instanceof Error ? err : new Error(String(err));
}
</script>
