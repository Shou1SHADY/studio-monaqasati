// import { getRequestConfig } from 'next-intl/server';
// import { routing } from './routing';
// import arMessages from '../../messages/ar.json';
// import enMessages from '../../messages/en.json';

// const messages: Record<string, typeof arMessages> = {
//   ar: arMessages,
//   en: enMessages,
// };

// export default getRequestConfig(async ({ requestLocale }) => {
//   let locale = await requestLocale;

//   if (!locale || !routing.locales.includes(locale as any)) {
//     locale = routing.defaultLocale;
//   }

//   return {
//     locale,
//     messages: messages[locale as keyof typeof messages] || messages.ar
//   };
// });
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale;
  }

  const messages = (await import(`../../messages/${locale}.json`)).default;

  // ── debug: remove these 3 lines once the error is gone ──
  console.log('[i18n] locale:', locale);
  console.log('[i18n] Portal.Sidebar exists:', !!(messages as any)?.Portal?.Sidebar);
  console.log('[i18n] top-level keys:', Object.keys(messages || {}));
  // ────────────────────────────────────────────────────────

  return {
    locale,
    messages,
  };
});