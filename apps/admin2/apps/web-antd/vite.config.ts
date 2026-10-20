import { defineConfig } from '@vben/vite-config';

export default defineConfig(async () => ({
  application: {},
  vite: {
    server: {
      host: '127.0.0.1',
      proxy: {
        '/api': {
          target: 'https://test-hp-admin.meiyi.pro',
          changeOrigin: true,
          secure: true,
        },
      },
    },
  },
}));
