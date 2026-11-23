<template>
    <div
        class='text-secondary small'
        v-text='t("taklab.routeActorNote.text", { label })'
    />
</template>

<script setup lang='ts'>
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ContactManager from '../../../base/contact.ts';

const { t } = useI18n();

const props = defineProps<{
    actor: { uid: string; on_behalf: string; log: string };
}>();

// Do czasu odczytu kontaktu (albo gdy go nie ma) pokazujemy samo uid
const label = ref(props.actor.on_behalf);

watch(() => props.actor.on_behalf, async (uid) => {
    label.value = uid;
    try {
        const contact = await ContactManager.from(uid);
        if (contact && props.actor.on_behalf === uid) label.value = contact.callsign || uid;
    } catch {
        // brak magazynu kontaktów: zostaje uid
    }
}, { immediate: true });
</script>
