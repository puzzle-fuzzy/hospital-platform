<script lang="ts" setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { BasicLayout, UserDropdown } from '@vben/layouts';
import { preferences } from '@vben/preferences';
import { useUserStore } from '@vben/stores';
import { useAuthStore } from '#/store';
const router = useRouter();
const userStore = useUserStore();
const authStore = useAuthStore();
const avatar = computed(
  () => userStore.userInfo?.avatar ?? preferences.app.defaultAvatar,
);
const menus = computed(() => [
  {
    handler: () => router.push('/hospital/account'),
    icon: 'lucide:user',
    text: '账号信息',
  },
]);
async function handleLogout() {
  await authStore.logout(false);
}
</script>
<template>
  <BasicLayout @clear-preferences-and-logout="handleLogout">
    <template #user-dropdown>
      <UserDropdown
        :avatar="avatar"
        :menus="menus"
        :text="userStore.userInfo?.realName"
        :description="userStore.userInfo?.desc"
        tag-text="2.0"
        @logout="handleLogout"
        @clear-preferences-and-logout="handleLogout"
      />
    </template>
  </BasicLayout>
</template>
