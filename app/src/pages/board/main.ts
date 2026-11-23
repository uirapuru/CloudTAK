import { createApp } from 'vue'
import i18n from '../../i18n.ts';
import * as VueRouter from 'vue-router'
import { createPinia } from 'pinia'
import { initServiceWorker } from '../../utils/service-worker.ts';
import { initGlobalErrorReporting, vueErrorHandler } from '../../lib/reporting/index.ts';

import App from '../../App.vue'

initServiceWorker();
initGlobalErrorReporting();

const router = VueRouter.createRouter({
    history: VueRouter.createWebHistory(),
    routes: [
        {
            path: '/board',
            name: 'home',
            component: () => import('../../components/EventBoard.vue'),
            children: []
        }
    ]
});

const app = createApp(App);
app.use(i18n);
const pinia = createPinia()
app.config.errorHandler = vueErrorHandler;
app.use(router);
app.use(pinia);
app.mount('#app');
