<template>
    <TablerModal>
        <div class='modal-status bg-blue' />
        <button
            type='button'
            class='btn-close'
            :aria-label='t("common.close")'
            @click='emit("close")'
        />
        <div class='modal-header text-body'>
            <div
                class='modal-title'
                v-text='t("taklab.dataSyncQr.title", { name: props.name })'
            />
        </div>
        <div class='modal-body'>
            <TablerLoading v-if='!qr && !error' />
            <TablerAlert
                v-else-if='error'
                :err='error'
            />
            <template v-else-if='qr'>
                <img
                    class='datasync-qr d-block mx-auto mb-3'
                    :alt='t("taklab.dataSyncQr.alt")'
                    :src='`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`'
                >
                <div
                    class='text-secondary small'
                    v-text='t("taklab.dataSyncQr.hint")'
                />
            </template>
        </div>
    </TablerModal>
</template>

<script setup lang='ts'>
// taklab: QR code that subscribes ATAK (Data Sync plugin) to a mission.
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { TablerAlert, TablerLoading, TablerModal } from '@tak-ps/vue-tabler';
import { std, stdurl } from '../../../../std.ts';

const { t } = useI18n();

const props = defineProps<{ name: string }>();
const emit = defineEmits<{ close: [] }>();

const qr = ref<{ uri: string; svg: string } | undefined>();
const error = ref<Error | undefined>();

onMounted(async () => {
    try {
        const url = stdurl('/api/marti/datasync-qr');
        url.searchParams.set('name', props.name);
        qr.value = await std(url) as { uri: string; svg: string };
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    }
});
</script>

<style scoped>
.datasync-qr {
    width: 100%;
    max-width: 280px;
    background: #fff;
    padding: 8px;
}
</style>
