import { createApp } from 'vue'
import i18n from './i18n.ts';
import * as VueRouter from 'vue-router'
import { createPinia } from 'pinia'

import App from './App.vue'

const router = VueRouter.createRouter({
    history: VueRouter.createWebHistory(),
    routes: [
        {
            path: '/admin',
            name: 'admin',
            component: () => import('./components/ServerAdmin.vue'),
            children: []
        }
    ]
});

const app = createApp(App);
app.use(i18n);
const pinia = createPinia()
app.use(router);
app.use(pinia);
app.mount('#app');
