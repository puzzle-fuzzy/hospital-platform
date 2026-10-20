import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '#': fileURLToPath(new URL('../../../../', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: [
      'apps/web-antd/src/views/hospital/payments/composables/use-payment-refund.test.ts',
    ],
  },
});
