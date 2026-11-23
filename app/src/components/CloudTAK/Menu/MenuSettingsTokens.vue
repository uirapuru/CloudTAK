<template>
    <MenuTemplate
        :name='t("panels.settingsTokens.title")'
        :loading='loading'
        :none='!tokens.items.length'
    >
        <template #buttons>
            <TablerIconButton
                :title='t("panels.settingsTokens.newToken")'
                @click='token={}'
            >
                <IconPlus
                    :size='32'
                    stroke='1'
                />
            </TablerIconButton>
            <TablerRefreshButton
                :loading='loading'
                @click='fetch'
            />
        </template>
        <template #default>
            <div class='col-12 d-flex flex-column gap-2 py-3'>
                <StandardItem
                    v-for='tok in tokens.items'
                    :key='tok.id'
                    @click='token = tok'
                >
                    <div class='d-flex align-items-center px-2 py-2'>
                        <IconRobot
                            :size='32'
                            stroke='1'
                        />
                        <div class='ms-2 flex-grow-1 fw-bold'>
                            {{ tok.name }}
                        </div>
                    </div>
                </StandardItem>
            </div>
        </template>
    </MenuTemplate>

    <TokenModal
        v-if='token'
        :token='token'
        @close='token = false'
        @refresh='fetch'
    />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n';
import MenuTemplate from '../util/MenuTemplate.vue';
import StandardItem from '../util/StandardItem.vue';
import { server } from '../../../std.ts';
import type { ProfileToken, ProfileTokenList } from '../../../types.ts';
import TokenModal from './Settings/TokenModal.vue';
import {
    TablerIconButton,
    TablerRefreshButton
} from '@tak-ps/vue-tabler';
import {
    IconPlus,
    IconRobot,
} from '@tabler/icons-vue';

const { t } = useI18n();
const loading = ref<boolean>(true);
const token = ref<ProfileToken | Record<string, never> | false>(false);
const tokens = ref<ProfileTokenList>({
    total: 0,
    items: []
});

onMounted(async () => {
    await fetch();
});

async function fetch(): Promise<void> {
    token.value = false;
    loading.value = true;
    const { data, error } = await server.GET('/api/profile/token', {
        params: { query: { limit: 100, page: 0, order: 'asc', sort: 'created', filter: '' } }
    });
    if (error) throw new Error(String(error));
    tokens.value = data;
    loading.value = false;
}
</script>
