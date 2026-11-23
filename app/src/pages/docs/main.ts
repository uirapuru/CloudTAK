import { createApp } from 'vue'
import i18n from '../../i18n.ts';
import { createHead } from '@unhead/vue/client';
import { initServiceWorker } from '../../utils/service-worker.ts';
import { initGlobalErrorReporting, vueErrorHandler } from '../../lib/reporting/index.ts';

import App from './App.vue';

initServiceWorker();
initGlobalErrorReporting();

const app = createApp(App);
app.use(i18n);
app.config.errorHandler = vueErrorHandler;
app.use(createHead());
app.mount('#app');
