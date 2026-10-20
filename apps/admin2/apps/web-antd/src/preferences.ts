import { defineOverridesPreferences } from '@vben/preferences';

export const overridesPreferences = defineOverridesPreferences({
  app: {
    name: '高平市人民医院 · Admin 2.0',
    defaultHomePath: '/hospital/payments/simple',
    defaultAvatar: '/hospital-logo.svg',
    accessMode: 'frontend',
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
    enableRefreshToken: false,
  },
  logo: { source: '/hospital-logo.svg' },
  copyright: {
    companyName: '高平市人民医院',
    companySiteLink: '',
    date: '2026',
  },
  widget: { notification: false, lockScreen: false },
  shortcutKeys: { globalLockScreen: false },
});

export const preferencesExtension = undefined;
