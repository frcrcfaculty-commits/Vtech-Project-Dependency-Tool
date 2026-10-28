// WhatsApp delivery. Two modes (env WHATSAPP_MODE):
//   link (default) — returns wa.me links; the PM taps each, WhatsApp opens pre-filled, PM hits send, then confirms in-app.
//   meta           — WhatsApp Business Cloud API. Needs an approved utility template. Not live until VTech decides on cost.

/** Normalise an Indian/intl phone to digits with country code, e.g. "98765 43210" → "919876543210". */
export function normalizePhone(raw: string, defaultCountry = '91'): string | null {
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length === 10) return defaultCountry + digits;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

export function waLink(phone: string, text: string): string | null {
  const p = normalizePhone(phone);
  return p ? `https://wa.me/${p}?text=${encodeURIComponent(text)}` : null;
}

export interface MetaConfig {
  token: string;
  phoneNumberId: string;
  templateName: string;      // approved utility template with ONE body variable {{1}}
  templateLang: string;      // e.g. "en"
  apiVersion: string;        // e.g. "v23.0"
}

/**
 * Sends via Meta Cloud API as a template message (required outside the 24h customer-service window).
 * Template body variables cannot contain newlines/tabs or >4 consecutive spaces, so the list is flattened.
 */
export async function sendMetaTemplate(cfg: MetaConfig, phone: string, text: string): Promise<string> {
  const to = normalizePhone(phone);
  if (!to) throw new Error(`invalid phone: ${phone}`);
  const param = text.replace(/[\n\t]+/g, ' | ').replace(/ {4,}/g, '   ').slice(0, 1000);
  const res = await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: cfg.templateName,
        language: { code: cfg.templateLang },
        components: [{ type: 'body', parameters: [{ type: 'text', text: param }] }],
      },
    }),
  });
  const json = (await res.json()) as { messages?: { id: string }[]; error?: { message: string } };
  if (!res.ok || !json.messages?.[0]?.id) throw new Error(json.error?.message ?? `Meta API ${res.status}`);
  return json.messages[0].id;
}
