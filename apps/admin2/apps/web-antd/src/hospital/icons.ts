import { addCollection } from '@vben/icons';

/**
 * Offline application icon data, extracted from the existing locked
 * @iconify/json 2.2.476 dependency. Keep the original names, SVG bodies and
 * dimensions used by hospital routes and the unmodified Vben components.
 * Lucide Vue components already bundle their own SVG and need no registration.
 * No API loader or CDN is required for this complete set of application icons.
 * lucide: ISC; https://github.com/lucide-icons/lucide/blob/main/LICENSE
 * ep: MIT; https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json
 * mdi: Apache-2.0; https://github.com/Templarian/MaterialDesign/blob/master/LICENSE
 * fluent-mdl2: MIT; https://github.com/microsoft/fluentui/blob/master/packages/react-icons-mdl2/LICENSE
 * ant-design: MIT; https://github.com/ant-design/ant-design-icons/blob/master/LICENSE
 */
const collections: Parameters<typeof addCollection>[0][] = [
  {
    prefix: 'lucide',
    width: 24,
    height: 24,
    icons: {
      'wallet-cards': {
        body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2M3 11h3c.8 0 1.6.3 2.1.9l1.1.9c1.6 1.6 4.1 1.6 5.7 0l1.1-.9c.5-.5 1.3-.9 2.1-.9H21"/></g>',
      },
      list: {
        body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13"/>',
      },
      'receipt-text': {
        body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16H8m6-8H8m8 4H8M4 3a1 1 0 0 1 1-1a1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1a1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2a1 1 0 0 1-1-1z"/>',
      },
      workflow: {
        body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/></g>',
      },
      'refresh-cw': {
        body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 12a9 9 0 0 1 9-9a9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5m5 4a9 9 0 0 1-9 9a9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></g>',
      },
      'book-open': {
        body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 7v14m-9-3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4a4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3a3 3 0 0 0-3-3z"/>',
      },
      terminal: {
        body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19h8M4 17l6-6l-6-6"/>',
      },
      user: {
        body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></g>',
      },
    },
  },
  {
    prefix: 'ep',
    width: 1024,
    height: 1024,
    icons: {
      fold: {
        body: '<path fill="currentColor" d="M896 192H128v128h768zm0 256H384v128h512zm0 256H128v128h768zM320 384L128 512l192 128z"/>',
      },
      expand: {
        body: '<path fill="currentColor" d="M128 192h768v128H128zm0 256h512v128H128zm0 256h768v128H128zm576-352l192 160l-192 128z"/>',
      },
    },
  },
  {
    prefix: 'mdi',
    width: 24,
    height: 24,
    icons: {
      'home-outline': {
        body: '<path fill="currentColor" d="m12 5.69l5 4.5V18h-2v-6H9v6H7v-7.81zM12 3L2 12h3v8h6v-6h2v6h6v-8h3"/>',
      },
      'keyboard-esc': {
        body: '<path fill="currentColor" d="M1 7h6v2H3v2h4v2H3v2h4v2H1zm10 0h4v2h-4v2h2a2 2 0 0 1 2 2v2c0 1.11-.89 2-2 2H9v-2h4v-2h-2a2 2 0 0 1-2-2V9c0-1.1.9-2 2-2m8 0h2a2 2 0 0 1 2 2v1h-2V9h-2v6h2v-1h2v1c0 1.11-.89 2-2 2h-2a2 2 0 0 1-2-2V9c0-1.1.9-2 2-2"/>',
      },
    },
  },
  {
    prefix: 'fluent-mdl2',
    width: 2048,
    height: 2048,
    icons: {
      'world-clock': {
        body: '<path fill="currentColor" d="M896 768H512V256h128v384h256zm1152 640q0 87-22 168t-64 152t-100 130t-128 101t-152 66t-168 23q-134 0-251-49t-205-136t-139-204t-51-251q0-132 50-248t138-204t203-137t249-51q132 0 248 50t204 138t137 203t51 249m-640 512q21 0 37-15t29-40t21-53t15-58t9-53t5-37h-230q1 13 5 37t10 52t15 58t21 54t27 39t36 16m125-384q3-64 3-128q0-63-3-128h-250q-3 65-3 128q0 64 3 128zm-637-128q0 32 4 64t12 64h243q-6-128 0-256H912q-8 32-12 64t-4 64m512-512q-19 0-34 15t-27 40t-21 54t-15 58t-11 53t-5 36h225q-1-11-5-34t-11-52t-16-59t-21-54t-27-41t-32-16m253 384q3 64 3 128t-2 128h242q8-32 12-64t4-64t-4-64t-12-64zm190-128q-43-75-108-131t-145-89q20 53 32 108t20 112zm-637-218q-78 32-142 88t-107 130h200q7-56 18-110t31-108m-249 730q42 73 105 129t142 88q-20-52-30-107t-17-110zm643 215q77-32 139-87t104-128h-198q-5 55-15 109t-30 106M640 0q88 0 170 23t153 64t129 100t100 130t65 153t23 170h-128q0-106-40-199t-110-162t-163-110t-199-41t-199 40t-162 110t-110 163t-41 199t40 199t110 162t163 110t199 41v128q-88 0-170-23t-153-64t-129-100T88 963T23 810T0 640q0-132 50-248t138-204T391 51T640 0"/>',
      },
    },
  },
  {
    prefix: 'ant-design',
    width: 1024,
    height: 1024,
    icons: {
      'upload-outlined': {
        body: '<path fill="currentColor" d="M400 317.7h73.9V656c0 4.4 3.6 8 8 8h60c4.4 0 8-3.6 8-8V317.7H624c6.7 0 10.4-7.7 6.3-12.9L518.3 163a8 8 0 0 0-12.6 0l-112 141.7c-4.1 5.3-.4 13 6.3 13M878 626h-60c-4.4 0-8 3.6-8 8v154H214V634c0-4.4-3.6-8-8-8h-60c-4.4 0-8 3.6-8 8v198c0 17.7 14.3 32 32 32h684c17.7 0 32-14.3 32-32V634c0-4.4-3.6-8-8-8"/>',
      },
    },
  },
];

export const offlineIconNames = collections.flatMap((collection) =>
  Object.keys(collection.icons).map((name) => `${collection.prefix}:${name}`),
);

for (const collection of collections) addCollection(collection);
