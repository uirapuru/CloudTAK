<template>
    <TablerModal size='lg'>
        <div class='modal-header'>
            <IconArrowUp
                size='24'
                stroke='1'
            />
            <span class='mx-2'>
                {{ t('shared.layerTaskUpdateModal.title', { from: update.from, to: update.to }) }}
            </span>
            <button
                type='button'
                class='btn-close'
                aria-label='Close'
                @click='emit("close")'
            />
        </div>
        <div
            class='modal-body overflow-auto'
            style='max-height: 60vh'
        >
            <TablerLoading
                v-if='loading'
                :desc='t("shared.layerTaskUpdateModal.loading")'
            />
            <TablerAlert
                v-else-if='error'
                :title='t("shared.layerTaskUpdateModal.error")'
                :err='error'
            />
            <template v-else>
                <div
                    v-if='!next'
                    class='alert alert-warning'
                >
                    {{ t('shared.layerTaskUpdateModal.noCapabilities') }}
                </div>
                <TablerNone
                    v-else-if='!rows.length'
                    :create='false'
                    :compact='true'
                    :label='t("shared.layerTaskUpdateModal.permissionsRequested")'
                />
                <table
                    v-else
                    class='table table-vcenter card-table'
                >
                    <thead>
                        <tr>
                            <th>{{ t('shared.layerTaskUpdateModal.permission') }}</th>
                            <th class='text-center'>
                                {{ t('shared.layerTaskUpdateModal.then', { version: update.from }) }}
                            </th>
                            <th class='text-center'>
                                {{ t('shared.layerTaskUpdateModal.now', { version: update.to }) }}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for='row in rows'
                            :key='row.resource'
                            :class='{ "bg-yellow-lt": row.changed }'
                        >
                            <td>
                                <code v-text='row.resource' />
                                <div
                                    v-if='row.description'
                                    class='small text-secondary'
                                    v-text='row.description'
                                />
                            </td>
                            <td class='text-center'>
                                <span
                                    v-if='row.then === "granted"'
                                    class='badge bg-green-lt'
                                >{{ t('shared.layerTaskUpdateModal.granted') }}</span>
                                <span
                                    v-else-if='row.then === "denied"'
                                    class='badge bg-secondary-lt'
                                >{{ t('shared.layerTaskUpdateModal.notGranted') }}</span>
                                <span
                                    v-else
                                    class='text-muted'
                                >—</span>
                            </td>
                            <td class='text-center'>
                                <span
                                    v-if='row.now === "removed"'
                                    class='badge bg-red-lt'
                                >{{ t('shared.layerTaskUpdateModal.removed') }}</span>
                                <span
                                    v-else-if='row.now === "required"'
                                    class='badge bg-green-lt'
                                >{{ t('shared.layerTaskUpdateModal.required') }}</span>
                                <TablerToggle
                                    v-else
                                    v-model='granted[row.resource]'
                                    :label='t("shared.layerTaskUpdateModal.grant")'
                                />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </template>
        </div>
        <div class='modal-footer'>
            <button
                class='btn'
                @click='emit("close")'
            >
                {{ t('common.cancel') }}
            </button>
            <div class='ms-auto'>
                <button
                    class='btn btn-primary'
                    :disabled='loading || !!error || saving'
                    @click='accept'
                >
                    <span
                        v-if='saving'
                        class='spinner-border spinner-border-sm me-2'
                        role='status'
                    />
                    {{ t('shared.layerTaskUpdateModal.accept') }}
                </button>
            </div>
        </div>
    </TablerModal>
</template>

<script setup lang='ts'>
import { useI18n } from 'vue-i18n';
import { ref, computed, onMounted } from 'vue';
import { server } from '../../std.ts';
import type { ETLLayer, ETLTaskCapabilities } from '../../types.ts';
import type { TaskUpdate } from './LayerTaskSelect.vue';
import { IconArrowUp } from '@tabler/icons-vue';
import {
    TablerModal,
    TablerLoading,
    TablerAlert,
    TablerToggle,
    TablerNone,
} from '@tak-ps/vue-tabler';

type Permission = ETLTaskCapabilities['permissions'][number];

interface PermissionRow {
    resource: string;
    description: string;
    then: 'granted' | 'denied' | 'absent';
    now: 'required' | 'optional' | 'removed';
    changed: boolean;
}

export interface UpdateTarget {
    id: number;
    connection: number | null;
    permissions?: string[];
}

const { t } = useI18n();

const props = withDefaults(defineProps<{
    layer: UpdateTarget;
    update: TaskUpdate;
    auto?: boolean;
}>(), {
    auto: false,
});

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'updated', layer: ETLLayer): void;
}>();

const loading = ref(true);
const saving = ref(false);
const error = ref<Error>();
const prev = ref<ETLTaskCapabilities | null>(null);
const next = ref<ETLTaskCapabilities | null>(null);
const granted = ref<Record<string, boolean>>({});
const current = ref<string[]>([]);

const rows = computed<PermissionRow[]>(() => {
    if (!next.value) return [];

    const currentSet = new Set(current.value);
    const prevPerms = new Map<string, Permission>((prev.value?.permissions || []).map((p) => [p.resource, p]));
    const nextPerms = new Map<string, Permission>(next.value.permissions.map((p) => [p.resource, p]));

    const resources = new Set<string>([...prevPerms.keys(), ...currentSet, ...nextPerms.keys()]);

    return Array.from(resources).sort().map((resource) => {
        const before = prevPerms.get(resource);
        const after = nextPerms.get(resource);

        const then: PermissionRow['then'] = currentSet.has(resource) ? 'granted' : (before ? 'denied' : 'absent');
        const now: PermissionRow['now'] = !after ? 'removed' : (after.required ? 'required' : 'optional');

        return {
            resource,
            description: after?.description || before?.description || '',
            then,
            now,
            changed: now === 'removed' || (now === 'required' && then !== 'granted') || (then === 'absent'),
        };
    });
});

onMounted(async () => {
    try {
        [current.value, prev.value, next.value] = await Promise.all([
            props.layer.permissions ? props.layer.permissions : fetchPermissions(),
            fetchCapabilities(props.update.from),
            fetchCapabilities(props.update.to)
        ]);

        if (next.value) {
            const currentSet = new Set(current.value);
            for (const permission of next.value.permissions) {
                granted.value[permission.resource] = permission.required || currentSet.has(permission.resource);
            }
        }
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
        loading.value = false;
        return;
    }

    loading.value = false;

    // Bulk updates skip the prompt when there is nothing for the user to decide
    if (props.auto && !requirementsChanged()) await accept();
});

/**
 * Permission requirements changed if the new manifest introduces a resource the Layer
 * doesn't already grant, or drops one it does
 */
function requirementsChanged(): boolean {
    if (!next.value) return false;

    const currentSet = new Set(current.value);
    const nextSet = new Set(next.value.permissions.map((p) => p.resource));

    for (const resource of nextSet) {
        if (!currentSet.has(resource)) return true;
    }

    for (const resource of currentSet) {
        if (!nextSet.has(resource)) return true;
    }

    return false;
}

async function fetchPermissions(): Promise<string[]> {
    const res = await server.GET('/api/connection/{:connectionid}/layer/{:layerid}', {
        params: {
            query: { alarms: false, download: false },
            path: {
                ':connectionid': props.layer.connection ?? 0,
                ':layerid': props.layer.id
            }
        }
    });

    if (res.error) throw new Error(res.error.message);

    return res.data.permissions;
}

async function fetchCapabilities(version: string): Promise<ETLTaskCapabilities | null> {
    const res = await server.GET('/api/integration/raw/{:prefix}/version/{:version}', {
        params: {
            path: {
                ':prefix': props.update.prefix,
                ':version': version
            }
        }
    });

    if (res.error) throw new Error(res.error.message);

    return res.data.capabilities;
}

function permissions(): string[] {
    if (!next.value) return current.value;

    return next.value.permissions
        .map((p) => p.resource)
        .filter((resource) => granted.value[resource]);
}

async function accept() {
    saving.value = true;
    error.value = undefined;

    try {
        const res = await server.PATCH('/api/connection/{:connectionid}/layer/{:layerid}', {
            params: {
                query: { alarms: true },
                path: {
                    ':connectionid': props.layer.connection ?? 0,
                    ':layerid': props.layer.id
                }
            },
            body: {
                task: `${props.update.prefix}-v${props.update.to}`,
                permissions: permissions()
            }
        });

        if (res.error) throw new Error(res.error.message);

        emit('updated', res.data as ETLLayer);
    } catch (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
        saving.value = false;
    }
}
</script>
