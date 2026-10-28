# WhatsApp Business template — `site_dependency_reminder`

Use this only when VTech moves from the free tap-to-send mode (`WHATSAPP_MODE=link`) to the paid Cloud API (`WHATSAPP_MODE=meta`).
The app code is already in place: `sendMetaTemplate()` in `lib/channels/whatsapp.ts`.

## 1. Template definition

| Field | Value |
|---|---|
| Name | `site_dependency_reminder` |
| Category | **Utility** |
| Language | English — code `en` |
| Header | None |
| Body variables | **Exactly one**: `{{1}}` = the item list |
| Footer | `VTech Technologies` |
| Buttons | None |

### Body (paste exactly)
```
Hello, this is a site dependency update from VTech Technologies.

The following items are still pending at our project site: {{1}}

Once these are addressed, VTech needs 2–4 working days to complete the automation work. Please reply here if any item is already done.
```

Why it is written this way:
- Meta rejects templates whose body **starts or ends with a variable**, and templates with too little fixed text around variables. Here `{{1}}` sits mid-body with fixed text on both sides.
- It is **utility**, not marketing: it is about an existing job the recipient is working on, it has no promotion, and it has no offers. Wording like "special", "offer" or "discount" gets a template re-categorised as marketing, which costs ~7.5× more in India.
- "Please reply here…" invites a reply. A reply opens a 24-hour customer-service window, so the PM can follow up with free-form messages.

### How the app fills `{{1}}`
`sendMetaTemplate(cfg, phone, text)` passes the WhatsApp text built by `buildAgencyReport` (`lib/report.ts`) as the single body parameter, after:
- newlines and tabs → ` | ` (Meta forbids newlines/tabs in parameters)
- 4+ spaces → 3 spaces
- truncation to 1,000 characters

So the recipient sees one line, for example:

```
*VTech – Demo – Shah Residence* | Site visit 21 Oct 2026: 3 pending curtain vendor items (Demo Drapes & Blinds). | 1. 12th Floor – Daughter Bathroom: Roller blind fabric installation pending. (since 21 Oct 2026, #1) | 2. 12th Floor – Parents Walk-in: Roller blind fabric installation pending. (since 21 Oct 2026, #1) | …
```

### Sample value for the submission form
Meta asks for a sample of every variable. Use:

```
Demo – Shah Residence, site visit 21 Oct 2026: 1. 12th Floor – Daughter Bathroom: Roller blind fabric installation pending (since 14 Oct 2026, reminder #2) | 2. 13th Floor – Bar Area: Roller blind fabric installation pending (since 14 Oct 2026, reminder #2)
```

> **Note for Claude (outside Hermes' paths):** the full WhatsApp text from `buildAgencyReport` can be up to `WHATSAPP_MAX = 3800` characters. In `meta` mode the 1,000-character cut drops the end of the list, and today the agency gets no "…and N more" marker. Suggest `sendMetaTemplate` cut at the last ` | ` before ~950 characters and append `| …full list by email`. The template body's own fixed text is ~300 characters, so the rendered message stays within Meta's 1,024-character body limit only if the parameter is kept to about 700 characters. Treat **~700** as the safe parameter cap and test it during template review.

## 2. Submission steps (Meta Business Manager / WhatsApp Manager)

Prerequisites (one-time, VTech):
1. A **Meta Business portfolio** for VTech Technologies at business.facebook.com. Verify the business (GST certificate or incorporation document) under *Security Centre → Business verification*. Unverified portfolios have low messaging limits.
2. A **phone number not currently registered on the WhatsApp app** (or migrate the existing one). It receives an OTP.
3. *WhatsApp Manager → Phone numbers → Add phone number*. Set the display name to **VTech Technologies**. The display name is reviewed and must match the business name.
4. *Business settings → Payment methods*: add a card or the INR payment method. India-billed accounts must be on **INR billing** (mandatory from 1 Jan 2027).
5. Create a **System user** (Business settings → Users → System users), assign the WhatsApp account with *Manage* permission, and generate a **permanent token** with `whatsapp_business_messaging` and `whatsapp_business_management`. This is `META_WA_TOKEN`.
6. Copy the **Phone number ID** (WhatsApp Manager → Phone numbers → the number → ID). This is `META_WA_PHONE_NUMBER_ID`.

Template:
1. *WhatsApp Manager → Account tools → Message templates → Create template*.
2. Category **Utility** → type **Default** (custom).
3. Name `site_dependency_reminder`, language **English (`en`)**. Pick "English", not "English (US)" (`en_US`), because the app sends `en`.
4. Body: paste the body above. Add the variable as **Number** type so it shows as `{{1}}`.
5. Footer: `VTech Technologies`.
6. Fill the sample for `{{1}}` with the value above, then **Submit**.
7. Review usually finishes in minutes to 24 h. If Meta changes the category to Marketing, edit the wording (remove anything promotional) and resubmit, or appeal from the template page.

App configuration (Vercel → Project → Settings → Environment Variables, Production):
```
WHATSAPP_MODE=meta
META_WA_TOKEN=<system-user permanent token>
META_WA_PHONE_NUMBER_ID=<phone number id>
META_WA_TEMPLATE=site_dependency_reminder
META_WA_TEMPLATE_LANG=en
META_WA_API_VERSION=v23.0
```
Redeploy. Test first with a VTech staff number as the only contact on a `TEST –` project.

## 3. Price (India), checked 28 Oct 2026

Meta charges **per delivered template message**, based on the template category and the **recipient's** country code. GST at 18% applies on top. A Business Solution Provider (BSP), if VTech uses one instead of the direct Cloud API, adds its own fee.

| Category | Rate per delivered message (India) | USD equivalent on Meta's USD card | Applies to us? |
|---|---|---|---|
| **Utility** (this template) | **₹0.115** | $0.0014 | Yes |
| Authentication | ₹0.115 | $0.0014 | No |
| Marketing | ₹0.8631 | $0.0118 | Only if Meta re-categorises the template |
| Service (free-form replies inside the 24 h window) | Free for the first 1,000 per number per month, then ₹0.115 (from 1 Oct 2026) | — | When the PM chats with an agency after it replies |

From **1 Oct 2026**, utility templates sent inside an open 24-hour window are no longer free. Every reminder is billed at the utility rate.
Utility has **volume tiers** in India: discounts step down 6% per tier, to 30% off at very high monthly volume. That is irrelevant at VTech's scale.

**What it would cost VTech.** Assume 10 active sites, ~6 agencies each, 2 visits/week, and reminders to 1–2 contacts per agency: ≈ 10 × 6 × 2 × 1.5 × 4.3 ≈ **775 messages/month**.
That gives 775 × ₹0.115 ≈ **₹89/month**, plus 18% GST ≈ **₹105/month**. This is with direct Cloud API. A BSP typically adds a platform fee or monthly plan, which costs more than the messages.
**Conclusion:** the message cost is negligible. The real costs are the one-time setup (business verification, a dedicated number) and choosing direct Cloud API over a BSP.

### Sources (accessed 28 Oct 2026)
- Meta for Developers — *Pricing on the WhatsApp Business Platform* (per-message model, categories, volume tiers, INR billing localisation, Oct 2026 changes): https://developers.facebook.com/docs/whatsapp/pricing
- WhatsApp Business — *Platform pricing* (official interactive rate card by market and currency): https://business.whatsapp.com/products/platform-pricing
- Business Standard, 1 Oct 2026 — *WhatsApp Business pricing changes from today: What Indian firms should know* (India utility ₹0.115, marketing ₹0.8631, 1,000 free service messages): https://www.business-standard.com/world-news/whatsapp-business-pricing-changes-from-today-what-indian-firms-should-know-126100100165_1.html
- Courier — *WhatsApp Business Platform pricing, explained* (India $0.0014 utility / $0.0118 marketing; India tier steps of 6% to 30%): https://www.courier.com/guides/whatsapp-pricing
- MyOperator — *WhatsApp Business API pricing in India 2026* (18% GST treatment; marketing ₹0.7846 → ₹0.8631): https://myoperator.com/blog/whatsapp-business-api-pricing-india-2026

Re-check before going live. Meta can change rates on the 1st of any quarter (1 Jan, 1 Apr, 1 Jul, 1 Oct) with one month's notice. The INR rate card PDF is on the first link, under *Rates → INR*.
