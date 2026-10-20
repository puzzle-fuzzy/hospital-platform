import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    name: 'HospitalPayments',
    path: '/hospital/payments',
    redirect: '/hospital/payments/simple',
    meta: { title: '支付管理', icon: 'lucide:wallet-cards', order: 1 },
    children: [
      {
        name: 'HospitalPaymentSimple',
        path: '/hospital/payments/simple',
        component: () => import('#/views/hospital/payments/simple.vue'),
        meta: { title: '支付展示', icon: 'lucide:list', affixTab: true },
      },
      {
        name: 'HospitalPaymentRecords',
        path: '/hospital/payments/records',
        component: () => import('#/views/hospital/payments/records.vue'),
        meta: { title: '支付记录', icon: 'lucide:receipt-text' },
      },
      {
        name: 'HospitalPaymentDay',
        path: '/hospital/payments/day',
        component: () => import('#/views/hospital/payments/day.vue'),
        meta: { title: '支付调用链', icon: 'lucide:workflow' },
      },
      {
        name: 'HospitalPaymentSync',
        path: '/hospital/payments/sync',
        component: () => import('#/views/hospital/payments/sync.vue'),
        meta: { title: '同步任务', icon: 'lucide:refresh-cw' },
      },
      {
        name: 'HospitalPaymentLedger',
        path: '/hospital/payments/ledger',
        component: () => import('#/views/hospital/payments/ledger.vue'),
        meta: { title: '支付账本', icon: 'lucide:book-open', hideInMenu: true },
      },
    ],
  },
  {
    name: 'HospitalAccount',
    path: '/hospital/account',
    component: () => import('#/views/hospital/account.vue'),
    meta: { title: '账号信息', hideInMenu: true },
  },
];
export default routes;
