<script lang="ts" setup>
import { computed } from 'vue';
import { LanguageToggle, ThemeToggle } from '@vben/layouts';
import { preferences, usePreferences } from '@vben/preferences';

const appName = computed(() =>
  preferences.app.name.replace(' · Admin 2.0', ''),
);
const logo = computed(() => preferences.logo.source);
const { isDark } = usePreferences();
</script>

<template>
  <main class="hospital-auth" :class="{ 'hospital-auth--dark': isDark }">
    <div class="hospital-auth__background" aria-hidden="true"></div>
    <div class="hospital-auth__tools">
      <ThemeToggle />
      <LanguageToggle />
    </div>
    <div class="hospital-auth__container">
      <header class="hospital-auth__brand">
        <img :src="logo" alt="" width="42" height="42" />
        <span>{{ appName }}</span>
      </header>
      <section class="hospital-auth__intro" aria-label="医院管理后台">
        <img
          class="hospital-auth__illustration"
          src="/auth-classic/login-box-bg.svg"
          alt=""
          width="350"
          height="240"
        />
        <h2>高平市人民医院管理后台</h2>
        <p>支付记录、医保结算与运行日志</p>
      </section>
      <section
        class="hospital-auth__panel"
        aria-labelledby="hospital-login-title"
      >
        <RouterView v-slot="{ Component, route }">
          <Transition appear mode="out-in" name="fade">
            <KeepAlive :include="['Login']">
              <component
                :is="Component"
                :key="route.fullPath"
                class="hospital-auth__form"
              />
            </KeepAlive>
          </Transition>
        </RouterView>
      </section>
    </div>
  </main>
</template>

<style scoped>
.hospital-auth {
  position: relative;
  display: flex;
  min-height: 100vh;
  min-height: 100svh;
  width: 100%;
  overflow-x: hidden;
  background: #fff;
  color: #151515;
}
.hospital-auth__background {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: url('/auth-classic/login-bg.svg');
  background-position: right center;
  background-repeat: no-repeat;
  background-size: auto 100%;
  transform: translateX(-48%);
}
.hospital-auth__container {
  position: relative;
  display: flex;
  width: 100%;
  max-width: 1536px;
  min-height: 100vh;
  min-height: 100svh;
  margin: 0 auto;
  padding: 0 64px;
}
.hospital-auth__tools {
  position: absolute;
  top: 14px;
  right: 16px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 4px;
}
.hospital-auth__brand {
  position: absolute;
  top: 28px;
  left: 64px;
  display: flex;
  align-items: center;
  gap: 12px;
  color: #fff;
  font-size: 24px;
  font-weight: 600;
}
.hospital-auth__intro {
  display: flex;
  width: 50%;
  flex: 0 0 50%;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  padding: 72px 24px 48px 0;
  color: #fff;
}
.hospital-auth__illustration {
  width: 350px;
  max-width: 100%;
  height: auto;
  object-fit: contain;
  margin-top: -64px;
  margin-bottom: 56px;
}
.hospital-auth__intro h2 {
  margin: 0 0 14px;
  color: inherit;
  font-size: 28px;
  font-weight: 600;
  line-height: 1.4;
}
.hospital-auth__intro p {
  margin: 0;
  color: inherit;
  font-size: 16px;
  line-height: 1.6;
}
.hospital-auth__panel {
  display: flex;
  width: 50%;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  padding: 100px 0 100px 88px;
}
.hospital-auth__form {
  width: 100%;
  max-width: 420px;
}
.hospital-auth--dark {
  background: #293146;
  color: #f2f4f7;
}
.hospital-auth--dark .hospital-auth__background {
  background-image: url('/auth-classic/login-bg-dark.svg');
}
@media (min-width: 1024px) and (max-width: 1399px) {
  .hospital-auth__container {
    padding-right: 48px;
    padding-left: 48px;
  }
  .hospital-auth__brand {
    left: 48px;
  }
  .hospital-auth__panel {
    padding-left: 48px;
  }
  .hospital-auth__intro h2 {
    font-size: 24px;
  }
}
@media (max-width: 1023px) {
  .hospital-auth__background,
  .hospital-auth__intro {
    display: none;
  }
  .hospital-auth__container {
    padding: 0 24px;
  }
  .hospital-auth__brand {
    top: 24px;
    left: 24px;
    max-width: calc(100% - 120px);
    color: inherit;
    font-size: 18px;
  }
  .hospital-auth__brand img {
    width: 34px;
    height: 34px;
  }
  .hospital-auth__panel {
    width: 100%;
    align-items: center;
    padding: 120px 0 64px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .hospital-auth__form {
    animation: none !important;
    transition: none !important;
  }
}
</style>
