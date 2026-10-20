<script lang="ts" setup>
import { computed } from 'vue';
import { AuthPageLayout } from '@vben/layouts';
import { preferences } from '@vben/preferences';
const appName = computed(() => preferences.app.name);
const logo = computed(() => preferences.logo.source);
</script>
<template>
  <AuthPageLayout
    :app-name="appName"
    :logo="logo"
    :logo-dark="logo"
    page-title="高平市人民医院"
    page-description="支付管理与运行日志 · Admin 2.0"
  />
</template>
