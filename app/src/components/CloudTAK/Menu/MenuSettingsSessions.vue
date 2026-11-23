<template>
    <MenuTemplate
        :name='t("panels.settingsSessions.title")'
        :loading='loading'
    >
        <template #default>
            <LoginSessionsList
                v-if='username'
                :username='username'
            />
        </template>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import MenuTemplate from '../util/MenuTemplate.vue';
import LoginSessionsList from '../../util/LoginSessionsList.vue';
import { server } from '../../../std.ts';

const { t } = useI18n();
const loading = ref<boolean>(true);
const username = ref<string>('');

onMounted(async () => {
    const res = await server.GET('/api/login');
    if (res.error) throw new Error(res.error.message);
    username.value = res.data.email;
    loading.value = false;
});
</script>
