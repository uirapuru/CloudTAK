import { ref, computed, toRaw, markRaw } from 'vue';
import type { Component, Ref, ComputedRef } from "vue";
import {
    IconBug,
    IconMap,
    IconFiles,
    IconMapDown,
    IconUsers,
    IconVideo,
    IconPhoto,
    IconRoute,
    IconMapPin,
    IconMessage,
    IconNetwork,
    IconPackages,
    IconSettings,
    IconCloudPin,
    IconServerCog,
    IconBoxMultiple,
    IconAffiliate,
    IconHistory,
    IconMicrophone,
    IconQrcode,
    IconMovie,
    IconNotebook,
    IconReportAnalytics,
    IconRobot,
    IconBinoculars,
} from '@tabler/icons-vue';
import ProfileConfig from '../../base/profile.ts';
import { std } from '../../std.ts';
import ContactManager from '../../base/contact.ts';
import Chatroom from '../../base/chatroom.ts';
import type { Profile } from '../../types.ts';
import { isNativePlatform } from '../../utils/capacitor.ts';
import { reportEnabled } from '../../base/report.ts';
import { aiChatEnabled } from '../../base/ai-chat.ts';

export type MenuItemConfig = {
    key: string;
    label: string;
    route: string;
    routeExternal?: boolean;
    tooltip: string;
    description?: string;
    icon: Component;
    badge?: string;
    visibility?: string;
    requiresSystemAdmin?: boolean;
    /** taklab: only accounts allowed to see the voice log history (VOICE_HISTORY_USERS). */
    requiresVoiceHistory?: boolean;
    /** taklab: only OTS administrators (OTS account list with QR codes). */
    requiresOtsAdmin?: boolean;
    /** taklab: only accounts for which OTS /api/taklab/journal/access says admin. */
    requiresJournal?: boolean;
    /** taklab: only when the environment has the mission report (GET /api/report is not 404). */
    requiresReport?: boolean;
    /** taklab: only when GET /api/ai/model answers 200 (OTS administrator of an environment with AI). */
    requiresAiChat?: boolean;
    requiresAgencyAdmin?: boolean;
};

/**
 * Manage Pluggable Menu
 */
export default class MenuManager {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mapStore: any;
    filter: Ref<string>;
    preferredLayout: Ref<'list' | 'tiles'>;
    onlineContactsCount: Ref<number>;
    unreadChatsCount: Ref<number>;
    /** taklab: live video streams now, set by the live video store (badge on Videos) */
    liveVideoCount: Ref<number>;
    isSystemAdmin: Ref<boolean>;
    isAgencyAdmin: Ref<boolean>;
    canSeeVoiceHistory: Ref<boolean>;
    canSeeOtsAccounts: Ref<boolean>;
    canSeeJournal: Ref<boolean>;
    canSeeReport: Ref<boolean>;
    canSeeAiChat: Ref<boolean>;
    pluginMenuItems: Ref<MenuItemConfig[]>;
    preferenceOrder: Ref<Profile['menu_order']>;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(mapStore: any) {
        this.mapStore = mapStore;
        this.filter = ref('');
        this.onlineContactsCount = ref(0);
        this.unreadChatsCount = ref(0);
        this.liveVideoCount = ref(0);
        this.isSystemAdmin = ref(false);
        this.isAgencyAdmin = ref(false);
        this.canSeeVoiceHistory = ref(false);
        this.canSeeOtsAccounts = ref(false);
        this.canSeeJournal = ref(false);
        this.canSeeReport = ref(false);
        this.canSeeAiChat = ref(false);
        this.pluginMenuItems = ref([]);
        this.preferenceOrder = ref([]);

        const storedLayoutPref = typeof window !== 'undefined' ? localStorage.getItem('cloudtak-menu-layout') : null;
        this.preferredLayout = ref<'list' | 'tiles'>(storedLayoutPref === 'tiles' ? 'tiles' : 'list');
    }

    async init() {
        const isSystemAdmin = await ProfileConfig.get('system_admin');
        this.isSystemAdmin.value = isSystemAdmin?.value ?? false;

        const isAgencyAdmin = await ProfileConfig.get('agency_admin');
        this.isAgencyAdmin.value = (isAgencyAdmin?.value && isAgencyAdmin.value.length > 0) || false;

        // taklab: the Voice menu (history) is for the environment administrator only.
        std('/api/voice/status').then((status) => {
            const s = status as { enabled?: boolean; history?: boolean };
            this.canSeeVoiceHistory.value = Boolean(s.enabled && s.history);
        }).catch(() => {
            this.canSeeVoiceHistory.value = false;
        });

        // taklab: "Konta serwera" only for accounts with the OTS administrator role.
        std('/api/ots/accounts/status').then((status) => {
            const s = status as { enabled?: boolean; administrator?: boolean };
            this.canSeeOtsAccounts.value = Boolean(s.enabled && s.administrator);
        }).catch(() => {
            this.canSeeOtsAccounts.value = false;
        });

        // taklab: "Dziennik" only when OTS says the account holds the administrator role.
        std('/api/journal/access').then((access) => {
            this.canSeeJournal.value = (access as { admin?: unknown }).admin === true;
        }).catch(() => {
            this.canSeeJournal.value = false;
        });

        // taklab: "Raport misji" for every account when the environment has the report service.
        reportEnabled().then((enabled) => {
            this.canSeeReport.value = enabled;
        });

        // taklab: "Chat AI" only when the report service says 200 (403 = not an OTS administrator).
        aiChatEnabled().then((enabled) => {
            this.canSeeAiChat.value = enabled;
        });

        try {
            const menuOrder = await ProfileConfig.get('menu_order');
            if (menuOrder && menuOrder.value) {
                this.preferenceOrder.value = menuOrder.value;
            }
        } catch (e) {
            console.error('Failed to load menu order', e);
        }

        ContactManager.liveCount().subscribe((count) => {
            this.onlineContactsCount.value = count;
        });

        Chatroom.liveUnreadCount().subscribe((count) => {
            this.unreadChatsCount.value = count;
        });
    }

    get baseMenuItems(): MenuItemConfig[] {
        return [
            {
                key: 'features',
                label: 'Features',
                route: '/menu/features',
                tooltip: 'Features',
                description: 'Saved features, events, and devices',
                icon: IconMapPin,
            },
            {
                key: 'overlays',
                label: 'Overlays',
                route: '/menu/overlays',
                tooltip: 'Overlays',
                description: 'Toggle and configure data overlays',
                icon: IconBoxMultiple,
            },
            {
                key: 'contacts',
                label: 'Contacts',
                route: '/menu/contacts',
                tooltip: 'Contacts',
                description: 'Manage and search for contacts',
                icon: IconUsers,
            },
            {
                key: 'basemaps',
                label: 'BaseMaps',
                route: '/menu/basemaps',
                tooltip: 'Basemaps',
                description: 'Switch between available basemaps',
                icon: IconMap,
            },
            {
                key: 'missions',
                label: 'Data Sync',
                route: '/menu/missions',
                tooltip: 'Data Sync',
                description: 'Real-Time Datasets',
                icon: IconCloudPin,
            },
            {
                key: 'packages',
                label: 'Data Package',
                route: '/menu/packages',
                tooltip: 'Data Packages',
                description: 'Create and share Data Packages',
                icon: IconPackages,
            },
            {
                key: 'channels',
                label: 'Channels',
                route: '/menu/channels',
                tooltip: 'Channels',
                description: 'Join and manage Data Channels',
                icon: IconAffiliate,
            },
            {
                key: 'videos',
                label: 'Videos',
                route: '/menu/videos',
                tooltip: 'Videos',
                description: 'Access live and recorded video feeds',
                icon: IconVideo,
            },
            {
                key: 'chats',
                label: 'Chats',
                route: '/menu/chats',
                tooltip: 'Chats',
                description: 'Open chat threads and history',
                icon: IconMessage,
            },
            {
                // taklab: rejestr głosu (historia, odsłuch, transkrypcje, raport)
                key: 'voice',
                label: 'Głos',
                route: '/menu/voice',
                tooltip: 'Głos',
                description: 'Historia rozmów głosowych z transkrypcją',
                icon: IconMicrophone,
                requiresVoiceHistory: true,
            },
            {
                // taklab: raport z przebiegu ćwiczenia (środowisko albo feed), PDF i TXT
                key: 'report',
                label: 'Raport misji',
                route: '/menu/report',
                tooltip: 'Raport misji',
                description: 'Raport z przebiegu ćwiczenia w PDF i TXT',
                icon: IconReportAnalytics,
                requiresReport: true,
            },
            {
                // taklab: przełącznik modelu AI, rozkaz bojowy i skrót do rozmowy z Hal9000 (administrator OTS)
                key: 'ai_chat',
                label: 'Chat AI',
                route: '/menu/ai-chat',
                tooltip: 'Chat AI',
                description: 'Model AI, rozkaz bojowy i rozmowa z Hal9000',
                icon: IconRobot,
                requiresAiChat: true,
            },
            {
                // taklab: nagrania wideo z serwera OTS z pozycją operatora (decyzja 25 XI 2026:
                // głosówki i skany zostają w panelu OTS i w dzienniku)
                key: 'recordings',
                label: 'Nagrania wideo',
                route: '/menu/recordings',
                tooltip: 'Nagrania wideo',
                description: 'Wideo zapisane na serwerze',
                icon: IconMovie,
                // Decision 24 XI 2026: recordings are for the OTS administrator only.
                requiresOtsAdmin: true,
            },
            {
                // taklab: dziennik zdarzeń środowiska z OTS (tylko administrator), eksport PDF i ZIP
                key: 'journal',
                label: 'Dziennik',
                route: '/menu/journal',
                tooltip: 'Dziennik',
                description: 'Dziennik zdarzeń serwera z eksportem PDF i ZIP',
                icon: IconNotebook,
                requiresJournal: true,
            },
            {
                // taklab: konta serwera OTS z kodami QR ATAK i OpenTAK ICU
                key: 'ots-accounts',
                label: 'Konta serwera',
                route: '/menu/ots-accounts',
                tooltip: 'Konta serwera',
                description: 'Konta serwera OTS z kodami QR dla ATAK i OpenTAK ICU',
                icon: IconQrcode,
                requiresOtsAdmin: true,
            },
            {
                // taklab: obserwator ze stożkiem na mapie i zdjęcie z ziemi (Panoramax) w panelu
                key: 'street-photos',
                label: 'Widok z ziemi',
                route: '/menu/street-photos',
                tooltip: 'Widok z ziemi',
                description: 'Zdjęcia z poziomu ulicy w kierunku stożka obserwacji',
                icon: IconBinoculars,
            },
            {
                key: 'routes',
                label: 'Routes',
                route: '/menu/routes',
                tooltip: 'Routes',
                description: 'Plan and manage route overlays',
                icon: IconRoute,
            },
            {
                key: 'files',
                label: 'Files',
                route: '/menu/files',
                tooltip: 'Files',
                description: 'Browse your uploaded and offline files',
                icon: IconFiles,
            },
            {
                key: 'area-packages',
                label: 'Area packages',
                route: '/menu/area-packages',
                tooltip: 'Area packages',
                description: 'Maps and objects of an area for offline use and ATAK',
                icon: IconMapDown,
            },
            {
                key: 'iconsets',
                label: 'Iconsets',
                route: '/menu/iconsets',
                tooltip: 'Iconsets',
                description: 'Customize Icons',
                icon: IconPhoto,
            },
            {
                key: 'connections',
                label: 'Connections',
                route: '/menu/connections',
                tooltip: 'Connections (Admin)',
                description: 'Manage Integrations',
                icon: IconNetwork,
                badge: 'A',
                requiresAgencyAdmin: true,
            },
            {
                key: 'debugger',
                label: 'COT Debugger',
                route: '/menu/debugger',
                tooltip: 'Debugger (Admin)',
                description: 'Inspect and debug COT traffic',
                icon: IconBug,
                badge: 'A',
                requiresSystemAdmin: true,
            },
            {
                key: 'server',
                label: 'Admin',
                route: '/admin',
                routeExternal: true,
                tooltip: 'Admin',
                description: 'Manage CloudTAK administration and server settings.',
                icon: IconServerCog,
                badge: 'A',
                requiresSystemAdmin: true,
            },
            {
                key: 'history',
                label: 'History',
                route: '/menu/history',
                tooltip: 'History',
                description: 'Breadcrumb trails and track history',
                icon: IconHistory,
            },
            {
                key: 'settings',
                label: 'Settings',
                route: '/menu/settings',
                tooltip: 'Display Settings',
                description: 'Adjust personal display preferences.',
                icon: IconSettings,
            },
        ];
    }

    get items(): ComputedRef<MenuItemConfig[]> {
        return computed(() => {
            const native = isNativePlatform();

            let combined = [...this.baseMenuItems, ...this.pluginMenuItems.value].filter((item) => {
                if (item.routeExternal && native) return false;
                if (item.requiresSystemAdmin && !this.isSystemAdmin.value) return false;
                if (item.requiresVoiceHistory && !this.canSeeVoiceHistory.value) return false;
                if (item.requiresOtsAdmin && !this.canSeeOtsAccounts.value) return false;
                if (item.requiresJournal && !this.canSeeJournal.value) return false;
                if (item.requiresReport && !this.canSeeReport.value) return false;
                if (item.requiresAiChat && !this.canSeeAiChat.value) return false;
                if (item.requiresAgencyAdmin && !(this.isAgencyAdmin.value || this.isSystemAdmin.value)) return false;
                return true;
            });

            if (this.preferenceOrder.value.length > 0) {
                const ordered: MenuItemConfig[] = [];
                const map = new Map(combined.map(i => [i.key, i]));

                for (const pref of this.preferenceOrder.value) {
                    if (map.has(pref.key)) {
                        ordered.push({ ...map.get(pref.key)!, visibility: pref.visibility ?? 'full' });
                        map.delete(pref.key);
                    }
                }

                for (const item of map.values()) {
                    ordered.push({ ...item, visibility: 'full' });
                }
                combined = ordered;
            } else {
                combined = combined.map(item => ({ ...item, visibility: 'full' }));
            }

            return combined.map((item) => {
                if (item.key === 'chats' && this.unreadChatsCount?.value > 0) {
                    return {
                        ...item,
                        badge: this.unreadChatsCount.value > 99 ? '99+' : String(this.unreadChatsCount.value)
                    }
                }
                if (item.key === 'videos' && this.liveVideoCount?.value > 0) {
                    return {
                        ...item,
                        badge: this.liveVideoCount.value > 99 ? '99+' : String(this.liveVideoCount.value)
                    }
                }
                if (item.key === 'contacts' && this.onlineContactsCount?.value > 0) {
                    return {
                        ...item,
                        badge: this.onlineContactsCount.value > 99 ? '99+' : String(this.onlineContactsCount.value)
                    }
                }
                return item;
            });
        });
    }

    get filteredItems(): ComputedRef<MenuItemConfig[]> {
        return computed(() => {
            const term = this.filter.value.trim().toLowerCase();
            if (!term) return this.items.value;

            return this.items.value.filter((item) => {
                const label = item.label.toLowerCase();
                const tooltip = item.tooltip.toLowerCase();
                const description = item.description?.toLowerCase() ?? '';

                return (
                    label.includes(term)
                    || tooltip.includes(term)
                    || description.includes(term)
                );
            });
        });
    }

    setLayout(mode: 'list' | 'tiles') {
        this.preferredLayout.value = mode;

        if (typeof window !== 'undefined') {
            localStorage.setItem('cloudtak-menu-layout', mode);
        }
    }

    addMenuItem(item: MenuItemConfig) {
        this.pluginMenuItems.value.push({
            ...item,
            icon: markRaw(item.icon)
        });
    }

    removeMenuItem(key: string) {
        this.pluginMenuItems.value = this.pluginMenuItems.value.filter(i => i.key !== key);
    }

    async setOrder(keys: string[]) {
        const orderMap = new Map(this.preferenceOrder.value.map(p => [p.key, p]));
        const newOrder = keys.map(k => {
            const existing = orderMap.get(k);
            return existing ? { ...toRaw(existing) } : { key: k, visibility: 'full' as const };
        });

        this.preferenceOrder.value = newOrder;
        const config = new ProfileConfig('menu_order', newOrder);
        await config.commit(newOrder);
    }

    async setVisibility(key: string, visible: "full" | "partial" | "hidden") {
        const index = this.preferenceOrder.value.findIndex(p => p.key === key);
        if (index !== -1) {
            this.preferenceOrder.value[index].visibility = visible;
        } else {
            // Need to reconstruct the full order to save it properly
            // We can iterate the current items (which are ordered as per UI) and update the target key
            const currentItems = this.items.value;
            this.preferenceOrder.value = currentItems.map(item => ({
                key: item.key,
                visibility: (item.key === key ? visible : (item.visibility || 'full')) as "full" | "partial" | "hidden"
            }));
        }

        const rawOrder = this.preferenceOrder.value.map(p => toRaw(p));
        const config = new ProfileConfig('menu_order', rawOrder);
        await config.commit(rawOrder);
    }
}
