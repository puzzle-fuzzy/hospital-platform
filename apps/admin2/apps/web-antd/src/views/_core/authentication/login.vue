<script lang="ts" setup>
import type { VbenFormSchema } from '@vben/common-ui';
import type { CaptchaState } from '#/hospital/types';
import { computed, markRaw, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { AuthenticationLogin, z } from '@vben/common-ui';
import { loadCaptcha } from '#/hospital/api';
import CaptchaField from '#/hospital/captcha-field.vue';
import { useAuthStore } from '#/store';

defineOptions({ name: 'Login' });
const authStore = useAuthStore();
const route = useRoute();
const initialMode =
  route.query.mode ?? new URLSearchParams(window.location.search).get('mode');
const defaultMode = initialMode === 'viewer' ? 'viewer' : 'operator';
const loginMode = ref<'operator' | 'viewer'>(defaultMode);
const captcha = ref<CaptchaState>({ enabled: true, key: '', image: '' });
const captchaLoading = ref(false);
const captchaError = ref('');
const loginForm = ref<InstanceType<typeof AuthenticationLogin>>();
let generation = 0;
const options = [
  { label: '运营账号', value: 'operator' },
  { label: '只读账号', value: 'viewer' },
];
async function refreshCaptcha() {
  if (loginMode.value !== 'operator') return;
  const request = ++generation;
  captcha.value = { enabled: true, key: '', image: '' };
  captchaLoading.value = true;
  captchaError.value = '';
  try {
    const result = await loadCaptcha();
    if (request === generation) {
      captcha.value = result;
      await loginForm.value?.getFormApi().setFieldValue('captcha', '');
    }
  } catch (error) {
    if (request === generation)
      captchaError.value =
        error instanceof Error ? error.message : '验证码加载失败';
  } finally {
    if (request === generation) captchaLoading.value = false;
  }
}
function changeMode(value: string | number) {
  loginMode.value = value === 'viewer' ? 'viewer' : 'operator';
  generation++;
  captchaLoading.value = false;
  captchaError.value = '';
  loginForm.value?.getFormApi().setFieldValue('password', '');
  loginForm.value?.getFormApi().setFieldValue('captcha', '');
  if (loginMode.value === 'operator') void refreshCaptcha();
}
const formSchema = computed((): VbenFormSchema[] => [
  {
    component: 'VbenSelect',
    componentProps: {
      options,
      placeholder: '请选择登录方式',
      disabled: authStore.loginLoading,
    },
    defaultValue: defaultMode,
    fieldName: 'loginMode',
    label: '登录方式',
    rules: z.enum(['operator', 'viewer']).default(defaultMode),
  },
  {
    component: 'VbenInput',
    componentProps: { placeholder: '请输入账号', autocomplete: 'username' },
    dependencies: {
      trigger(values) {
        const mode = values.loginMode;
        if (
          (mode === 'operator' || mode === 'viewer') &&
          mode !== loginMode.value
        ) {
          changeMode(mode);
        }
      },
      triggerFields: ['loginMode'],
    },
    fieldName: 'username',
    label: '账号',
    rules: z.string().trim().min(1, '请输入账号'),
  },
  {
    component: 'VbenInputPassword',
    componentProps: {
      placeholder: '请输入密码',
      autocomplete: 'current-password',
    },
    fieldName: 'password',
    label: '密码',
    rules: z.string().min(1, '请输入密码'),
  },
  ...(loginMode.value === 'operator' && captcha.value.enabled
    ? [
        {
          component: markRaw(CaptchaField),
          fieldName: 'captcha',
          label: '验证码',
          description: captchaError.value || undefined,
          componentProps: {
            image: captcha.value.image,
            loading: captchaLoading.value,
            onRefresh: refreshCaptcha,
          },
          rules: z.string().trim().min(1, '请输入图片验证码'),
        },
      ]
    : []),
]);
async function submit(values: Record<string, unknown>) {
  if (
    authStore.loginLoading ||
    (loginMode.value === 'operator' &&
      (captchaLoading.value || captchaError.value))
  )
    return;
  const result = await authStore.authLogin({
    ...values,
    loginMode: loginMode.value,
    captchaKey: captcha.value.key,
    captchaEnabled: captcha.value.enabled,
  });
  if (!result.userInfo && loginMode.value === 'operator')
    await refreshCaptcha();
}
onMounted(() => {
  if (loginMode.value === 'operator') void refreshCaptcha();
});
onBeforeUnmount(() => {
  generation++;
});
</script>
<template>
  <AuthenticationLogin
    ref="loginForm"
    :form-schema="formSchema"
    :loading="authStore.loginLoading"
    :show-forget-password="false"
    :show-code-login="false"
    :show-qrcode-login="false"
    :show-register="false"
    :show-third-party-login="false"
    @submit="submit"
  />
</template>
