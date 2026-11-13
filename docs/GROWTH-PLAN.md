# LeadBotCloud growth plan: lead capture, connections, templates, campaigns

Written after reading AiSensy's feature set (broadcast, templates, click-to-WhatsApp ads, Lead Form Ads, forms, click tracking, retargeting, scheduler, carousel, Shopify/Woo abandoned cart, CRM push) and Meta's docs (template fundamentals, lead retrieval webhooks/bulk read, per-user marketing limits, template archival).
Rule for every phase: nothing ships without tests against real Postgres, a fake of the outside service, and a browser check. Anything that needs the owner's platform credentials is built and tested against a fake, and listed as "needs your keys".

## What exists
Contacts with consent history, groups, import; text-only templates with buttons; campaigns (group audience, schedule, repeat, spend cap); auto-replies; renewals; team inbox; Meta Embedded Signup; Razorpay billing; legal pages.

## Gaps against AiSensy/Meta
1. Lead capture: none. No lead inbox, no forms, no ad-lead connectors, no CTWA attribution.
2. Templates: no media header (image/video/document), no named variables, no carousel, no limited-time offer, no coupon-code button, no authentication/OTP template, no live preview, no starter library, no per-template performance.
3. Campaigns: no saved segments, no click tracking/short links, no retarget (read/clicked/not replied), no A/B, no quiet hours, no campaign report page.
4. Journeys: no drip sequences or lead-triggered journeys, no lead pipeline.
5. Connections: no hub; no OAuth connectors.

## Phases (build in this order)
**P1 Lead engine (foundation). DONE.** `lead_sources`, `leads`, `lead_events`; one public signed ingest endpoint per source (URL + secret, HMAC); field mapping to contact; phone normalisation and dedupe; UTM and source capture; consent decided per source (only a form with an explicit WhatsApp-consent field creates `allowed`; otherwise `unknown`: reply-only, no marketing); lead inbox page with filters, status, owner, notes; auto-tag, auto-assign (round robin), optional instant welcome reply (template only if consent, else nothing).
**P2 Capture channels. DONE except Google Forms/Typeform/Calendly-specific recipes (they work through the generic webhook).** Hosted form builder + embeddable snippet + QR; website JS widget (floating WhatsApp button with UTM/click-id capture); click-to-WhatsApp ad attribution from the inbound `referral` object (ad id, headline, source url, ctwa_clid); CSV/XLSX import with mapping; generic webhook (Zapier, Make, n8n, Google Forms via Apps Script, Typeform, Tally, Calendly, Wix/Webflow form posts); IndiaMART / JustDial / 99acres push-URL format.
**P3 OAuth connectors.** Framework: encrypted token store, refresh, state/PKCE, per-tenant connection status. Then: Meta Lead Ads (Facebook Login, page subscribe to `leadgen`, fetch lead by id, backfill by bulk read), Shopify (OAuth, customers/orders/abandoned checkouts webhooks), WooCommerce (REST key + webhooks), Google Sheets (import and write-back), HubSpot and Zoho CRM (push leads/contacts), Google Ads lead form (webhook key), LinkedIn Lead Gen (partner-gated, behind a flag), TikTok Instant Form (webhook).
**P4 Template studio.** Live WhatsApp-style preview; named/positional variables with examples; media headers via Resumable Upload; carousel; limited-time offer; coupon-code; authentication/OTP; multi-language variants; vertical starter library; category/quality warnings; edit and resubmit; archival awareness; per-template send/read/click stats.
**P5 Campaign v2.** Saved segments (tag, source, lead status, last activity, clicked/read/replied in campaign X); short links with click tracking per contact; retarget in two clicks; A/B on template or send time; quiet hours and timezone; throttle; test send; campaign report page (funnel: sent, delivered, read, clicked, replied, converted) and CSV export.
**P6 Journeys.** Drip sequences and lead-triggered journeys (wait, template, condition on reply/click, tag, assign, stop on reply); lead scoring; pipeline board (new, contacted, qualified, won, lost) with value; abandoned-cart journey template.
**P7 Panel UI pass.** New dashboard (leads today, source mix, campaign funnel, cost), connections hub, command palette, empty states with next steps, dark mode, mobile pass, shared table/filter components.
**P8 Real inbox + API.** Remove the simulate buttons, real inbound handling; outbound webhooks and API keys (Pro); admin panel.

## Honest constraints
- Meta Lead Ads, Shopify, HubSpot, Zoho, Google, LinkedIn, TikTok each need an app registered under DigiXoMedia with its own review (Meta needs `leads_retrieval`, `pages_manage_metadata`, `ads_management` approved). I build and test against fakes; going live needs your app credentials and reviews.
- LinkedIn lead gen needs Marketing Developer Platform partner approval; flagged off by default.
- A lead is not marketing consent. This is enforced in code and tests.
- Template features marked UNVERIFIED in the spec (carousel, LTO, flows) get checked against current Meta docs before coding, not from memory.
