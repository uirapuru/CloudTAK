<template>
    <div class='page page-center'>
        <div class='container-tight py-4'>
            <div class='empty'>
                <div class='empty-header'>
                    404
                </div>
                <p class='empty-title'>
                    {{ t('login.lostUser.title') }}
                </p>
                <p class='empty-subtitle text-muted'>
                    {{ t('login.lostUser.subtitle') }}
                </p>
                <div class='empty-action'>
                    <a
                        class='cursor-pointer btn btn-primary'
                        @click='router.push("/")'
                    >
                        {{ t('login.lostUser.home') }}
                    </a>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const router = useRouter();
</script>
