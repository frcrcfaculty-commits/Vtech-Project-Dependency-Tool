// Server-side configuration. Read lazily so builds don't need secrets.

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const env = {
  supabaseUrl: () => req('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => req('NEXT_PUBLIC_SUPABASE_ANON_KEY'),

  emailMode: () => (process.env.EMAIL_MODE ?? 'compose_link') as 'compose_link' | 'gmail_api' | 'dryrun',
  googleServiceAccountJson: () => req('GOOGLE_SERVICE_ACCOUNT_JSON'),
  digestSender: () => req('DIGEST_SENDER_EMAIL'), // a real @vtechpl.com mailbox the service account may impersonate

  whatsappMode: () => (process.env.WHATSAPP_MODE ?? 'link') as 'link' | 'meta',
  meta: () => ({
    token: req('META_WA_TOKEN'),
    phoneNumberId: req('META_WA_PHONE_NUMBER_ID'),
    templateName: process.env.META_WA_TEMPLATE ?? 'site_dependency_reminder',
    templateLang: process.env.META_WA_TEMPLATE_LANG ?? 'en',
    apiVersion: process.env.META_WA_API_VERSION ?? 'v23.0',
  }),

  cronSecret: () => req('CRON_SECRET'),
};
