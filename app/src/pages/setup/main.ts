import { createApp } from 'vue'
import i18n from '../../i18n.ts';
import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { initGlobalErrorReporting, vueErrorHandler } from '../../lib/reporting/index.ts';

import App from '../../components/Setup/App.vue'

initGlobalErrorReporting();

// Capgo rolls back the bundle on next launch if this is never called.
if (Capacitor.isNativePlatform()) {
    void CapacitorUpdater.notifyAppReady()
}

const app = createApp(App)
app.use(i18n);
app.config.errorHandler = vueErrorHandler;
app.mount('#app')
