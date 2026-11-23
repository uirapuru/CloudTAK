<template>
    <TablerInput
        v-model='model.name'
        :label='t("property.coreEntityAssignmentFields.name")'
        :placeholder='t("property.coreEntityAssignmentFields.namePlaceholder")'
        class='pb-2'
    />

    <TablerInput
        v-model='model.role'
        :label='t("property.coreEntityAssignmentFields.role")'
        placeholder='IC'
        class='pb-2'
    />

    <TablerInput
        v-model='model.uid'
        :label='t("property.coreEntityAssignmentFields.username")'
        :placeholder='t("property.coreEntityAssignmentFields.usernamePlaceholder")'
        class='pb-2'
    />

    <TablerInput
        v-model='model.remarks'
        :label='t("property.coreEntityAssignmentFields.remarks")'
        :placeholder='t("property.coreEntityAssignmentFields.optional")'
    />
</template>

<script setup lang='ts'>
import { TablerInput } from '@tak-ps/vue-tabler';
import type { CoreEntityAssignmentInput } from '../../../types.ts';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const model = defineModel<CoreEntityAssignmentInput>({ required: true });
</script>
