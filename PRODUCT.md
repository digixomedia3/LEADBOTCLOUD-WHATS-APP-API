# Product

<!-- impeccable:product-schema 1 -->

Product truth for design work. Source: `docs/LEADBOTCLOUD_MASTER_SPEC.md` (Part A) and `AGENTS.md`. Facts marked *(inferred)* come from the spec and code, not from a confirmed interview; Deep or Abdullah should confirm or correct them.

## Platform

web

## Users

Owners and staff of Indian small businesses who are not technical, often on cheap Android phones and patchy data. They think "send an offer to my customers" and "who hasn't paid", not "templates, WABA, opt-in, webhooks". Wedge: subscription and renewal businesses (gyms, coaching and tuition, subscription resellers, ISPs and cable operators, clubs). Secondary: local shops, D2C brands, service businesses, agencies.

## Product Purpose

A WhatsApp Business Platform (Cloud API) marketing and customer-messaging panel. A business connects its own WhatsApp number, imports customers, sends approved messages to everyone who agreed, answers replies as a team in one inbox, automates replies, and runs renewals (expiry, reminders, payment link, marked renewed). Success: the visitor's existing contact list turns into replies, sales and renewals without risking their number or surprise bills.

## Positioning

"The WhatsApp panel that protects your number, shows every rupee before you spend it, and collects your renewals for you, with real human support on WhatsApp." Four pillars: number protection, honest money (cost preview, spend caps, no markup on Meta charges), renewal engine (no competitor offers it), radical simplicity with humans. Competitors: AiSensy, Interakt, WATI, Gallabox, DoubleTick, Zoko.

## Operating Context

Tech Provider model: each business connects its own WhatsApp Business account via Embedded Signup and pays Meta directly. LeadBotCloud earns a monthly plan fee (Free, Starter ₹499, Growth ₹1,299, Pro ₹2,999, ex-GST; limits in `PLAN_LIMITS`). Message cost uses Meta's India rate via `lib/cost`.

## Capabilities and Constraints

- Built and tested against fakes only; real Meta, Razorpay and email are not switched on. The panel runs in a clearly marked test mode until a number is connected. Razorpay payment links are not live.
- UI vocabulary follows spec A5.1 (no Meta jargon: "Template", "Campaign", "Customer allowed messages", quality shown as Safe / Careful / Stop sending).
- Light and dark mode; 360px first.

## Brand Commitments

- Name: LeadBotCloud, "a product of DigiXoMedia". WhatsApp-adjacent green; not affiliated with Meta (footer disclaimer).
- Support on WhatsApp: number comes from `SUPPORT_WHATSAPP` in the environment, never hard-coded.

## Evidence on Hand

- No real customers, testimonials, logos or results yet. Do not invent them.
- Sample businesses and names on the site are made up and labelled as samples. Stock photos from Pexels (`apps/web/public/people/CREDITS.md`).
- Every number on the marketing site comes from `lib/cost` (Meta rate) or the visitor's own input. No invented benchmarks (reply rates, ROI, delivery rates).

## Product Principles

1. Show, don't tell: the buyer should understand the product without reading.
2. Money before it's spent: cost is visible before every send.
3. Protect by default: people who did not agree or said stop are skipped and counted.
4. Honest limits: say what we cannot promise (Meta decisions, delivery, template approval).
5. Help from a human on WhatsApp.

## Accessibility & Inclusion

WCAG AA contrast, keyboard access on desktop, 44px tap targets, reduced-motion support. Hinglish-friendly plain English; Hindi later via `packages/shared/i18n`.
