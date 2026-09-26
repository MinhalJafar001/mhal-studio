// @ts-check
import { defineConfig, envField } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://mhalstudio.com',

  // Static by default: every public page is prerendered at build time.
  // Routes that need a server (the /dashboard area) opt out with `export const prerender = false`.
  output: 'static',
  adapter: vercel(),

  // Dashboard login secrets, read at runtime. Optional so a missing value can't break the
  // public site's build; the dashboard stays locked until both are set (see src/lib/auth.ts).
  env: {
    schema: {
      ADMIN_PASSWORD: envField.string({ context: 'server', access: 'secret', optional: true }),
      SESSION_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Postgres connection string, set automatically by Vercel's Neon integration
      DATABASE_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Shared key the Google Sheet script sends to /api/leads/import
      SHEET_SYNC_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      // New-lead email alerts via Resend. Alerts are skipped (lead still saved) if these aren't set.
      RESEND_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      ALERT_EMAIL_TO: envField.string({ context: 'server', access: 'secret', optional: true }),
      ALERT_EMAIL_FROM: envField.string({ context: 'server', access: 'secret', optional: true, default: 'Mhal Studio <alerts@mhalstudio.com>' }),
      // Sender for emails written to leads from the dashboard; replies go to this address
      OUTREACH_FROM: envField.string({ context: 'server', access: 'secret', optional: true, default: 'Mhal Studio <connect@mhalstudio.com>' }),
    },
  },

  vite: {
    plugins: [tailwindcss()],
  },

  // Keep the private admin area out of the sitemap
  integrations: [sitemap({ filter: (page) => !page.includes('/dashboard') && !page.includes('/contact/thanks') })],
});