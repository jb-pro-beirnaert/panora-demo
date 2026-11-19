import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['fr', 'en'],
  defaultLocale: 'fr',
  // The chosen language is remembered in the NEXT_LOCALE cookie.
  localePrefix: 'always',
});

export type AppLocale = (typeof routing.locales)[number];
