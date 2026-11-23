<template>
    <TablerModal>
        <div class='modal-status bg-blue' />
        <button
            type='button'
            class='btn-close'
            aria-label='Zamknij'
            @click='emit("close")'
        />
        <div class='modal-header text-body'>
            <div
                class='modal-title'
                v-text='`Kod QR misji: ${props.name}`'
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
                    alt='Kod QR misji'
                    :src='`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`'
                >
                <div class='text-secondary small'>
                    Zeskanuj w ATAK: Data Sync, przycisk dodawania, „Skanuj kod QR”.
                    Telefon musi być już połączony z tym serwerem.
                </div>
            </template>
        </div>
    </TablerModal>
</template>

<script setup lang='ts'>
// taklab: QR code that subscribes ATAK (Data Sync plugin) to a mission.
import { ref, onMounted } from 'vue';
import { TablerAlert, TablerLoading, TablerModal } from '@tak-ps/vue-tabler';
import { std, stdurl } from '../../../../std.ts';

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
