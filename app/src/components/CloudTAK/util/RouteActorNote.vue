<template>
    <div class='text-secondary small'>
        Zmieniona przez ai-buddy na prośbę {{ label }}
    </div>
</template>

<script setup lang='ts'>
import { ref, watch } from 'vue';
import ContactManager from '../../../base/contact.ts';

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
