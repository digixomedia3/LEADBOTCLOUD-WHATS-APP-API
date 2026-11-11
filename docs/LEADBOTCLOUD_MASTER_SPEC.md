# LeadBotCloud: Master Build Specification

> **For:** the AI coding agent (Hermes, Claude Sonnet 5.5) and the two human builders.
> **What this is:** the complete context for building the LeadBotCloud web application end to end: what the product is, who it is for, every module and feature, the UX rules, the architecture, the engineering rules, and all of Meta's official requirements.
> **How to read it:**
> - **Part A** (this part): product, features, UX, architecture, engineering rules. It tells you *what* to build and *why*.
> - **Part B**: the Meta WhatsApp Integration Spec, compiled from ~70 official Meta developer pages (Nov 2026). It tells you *exactly how* to talk to Meta: endpoints, payloads, webhooks, error codes, data model, deadlines. **Part B is authoritative for anything Meta-related.**
> - **Part C**: market research: Meta policies in business terms, competitors, real customer complaints, differentiators. It tells you *why* features matter.
>
> **Hosting note:** Part A §A2 is authoritative for hosting and repo names (single Hostinger VPS with Docker; self-hosted Postgres, Better Auth, Socket.IO; no Supabase; `packages/meta`). Any leftover mention elsewhere of other hosts is superseded.
>
> **Prime directive:** build a complete, production-quality, multi-tenant SaaS, not a demo. When Part A and Part B disagree on a Meta detail, Part B wins. When anything Meta-related is missing or marked `[UNVERIFIED]`, do **not** guess. Log the raw payload, make the code tolerant, and flag it to the humans.

---

# A1. Product overview

## A1.1 What LeadBotCloud is
LeadBotCloud (leadbotcloud.com) is a **WhatsApp Business Platform (Cloud API) marketing and customer-messaging panel** for **non-technical Indian small businesses**. A business signs up, connects its WhatsApp number in a few clicks, imports its customers, and can then:
- chat with customers from a shared, WhatsApp-like inbox (team members included),
- send approved promotional and transactional messages to many customers at once,
- automate replies,
- run **subscription renewals on autopilot** (reminder → payment link → auto-marked renewed),
- see exactly what every message costs before sending,
- and stay safe from WhatsApp number restrictions and bans.

Operator: **DigiXoMedia** (India; Meta Business portfolio verified 28 Dec 2025). Support WhatsApp: +91 82509 19483.

## A1.2 Who it is for
**Primary users:** owners and staff of Indian SMBs who are not technical. They think in terms of "send offer to my customers" and "who hasn't paid", not "templates, WABA, opt-in, webhooks". Many use cheap Android phones, often on patchy mobile data. English is acceptable but plain; Hinglish/Hindi helps.

**Primary niche (our wedge): subscription and renewal businesses.** Digital product/subscription resellers (like DiGiXO Store, our first tenant), coaches and course sellers, gyms, tuition centres, ISPs/cable operators, SaaS resellers, clubs, and any business with recurring payments.

**Secondary:** general SMBs: local shops, D2C brands, service businesses, agencies.

## A1.3 Positioning and how we beat competitors
Competitors (AiSensy, Interakt, WATI, Gallabox, DoubleTick, Zoko, CodeCanyon scripts) have commoditised the basic features. Research (Part C) shows customers leave them over **support, billing surprises, onboarding pain, and confusing failures**, not missing features. "₹0 markup" is already common, so price alone doesn't win.

**Our one-line promise:** *"The WhatsApp panel that protects your number, shows every rupee before you spend it, and collects your renewals for you, with real human support on WhatsApp."*

The four pillars. Every feature must serve at least one:
1. **Number protection.** Checks before every send, frequency caps, automatic holds, quality monitoring with auto-pause, plain-language explanations of every failure.
2. **Honest money.** Cost preview before every send, spend caps, a clear ledger separating Meta's charges from ours, GST invoices, one-tap cancel, monthly plans with no lock-in.
3. **Renewal engine.** Expiry tracking, reminder sequences, per-customer payment links, auto-mark renewed on payment, confirmation message, recovered-revenue reporting. No competitor offers this.
4. **Radical simplicity + humans.** No Meta jargon anywhere, guided setup wizards, ready-made message formats, mobile-first WhatsApp-like UI, and a WhatsApp help button on every screen.

## A1.4 Business model (what the app must support)
- **Tech Provider model:** each tenant connects its own WhatsApp Business Account via **Embedded Signup** and **pays Meta directly** with its own card in Meta's WhatsApp Manager. LeadBotCloud never resells Meta messages and never holds tenant money for Meta.
- **LeadBotCloud revenue:** monthly SaaS subscription plans (via Razorpay), plus paid services (done-for-you setup) handled outside the app.
- **Plans** (configurable by the super-admin, never hard-coded):

| Plan | Price (ex-GST, monthly) | Limits / features |
|---|---|---|
| Free | ₹0 | 1 number, 1 user, 500 contacts, inbox, 2 bulk sends/month, auto-replies (3 rules) |
| Starter | ₹499 | 1 number, 2 users, 5,000 contacts, unlimited bulk sends, auto-replies, ready-made formats |
| Growth | ₹1,299 | 1 number, 5 users, 25,000 contacts, **renewal engine**, AI message writer, Google Sheets sync, number health centre |
| Pro | ₹2,999 | 3 numbers, 15 users, 100,000 contacts, everything + API access/webhooks, chatbot flows, priority support |

Yearly billing = 2 months free. 18% GST shown separately. Cancel anytime (access until period end).

---

# A2. Architecture

## A2.1 Hosting and services (fixed decisions, self-hosted, no Supabase)
Everything runs on **one Hostinger VPS** in production (Docker Compose), and on the developer's machine locally (Docker for Postgres + Redis, Cloudflare Tunnel for public HTTPS). **No Supabase, no Vercel, no other cloud.**

| Component | Technology | Production (Hostinger VPS) | Local dev |
|---|---|---|---|
| Web app (tenant panel + super-admin + marketing pages + API routes) | Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui | Docker container `web` behind Caddy: `leadbotcloud.com`, `app.leadbotcloud.com` | `pnpm dev`, exposed via Cloudflare Tunnel at `dev-app.leadbotcloud.com` |
| Worker (webhook receiver, queues, senders, schedulers, realtime gateway) | Node.js, TypeScript, Fastify, BullMQ, Socket.IO | Docker container `worker`: `hooks.leadbotcloud.com` (webhooks) + `rt.leadbotcloud.com` (websocket) | `pnpm dev`, tunnel at `dev-hooks.leadbotcloud.com` |
| Database | **PostgreSQL 16** + **Drizzle ORM** (schema + migrations via drizzle-kit) | Docker container `postgres` (volume, not exposed publicly) | Docker |
| Queue / cache / pub-sub | Redis 7 | Docker container `redis` (not exposed publicly) | Docker |
| Authentication | **Better Auth** (email+password, Google OAuth, phone OTP sent via our own WhatsApp authentication template; sessions in Postgres; optional TOTP 2FA) | inside `web` | same |
| File storage (uploads, inbound media cache, invoices) | Storage abstraction in `packages/shared/storage` with a **local-disk driver** (Docker volume, files served only via short-lived signed URLs) and an **S3-compatible driver** (Cloudflare R2) for later | local disk volume | local folder |
| Realtime (inbox updates, ticks, unread counts, presence) | **Socket.IO** server in the worker, authenticated with the user's session; events fanned out via Redis pub/sub; rooms per tenant/conversation | `worker` | same |
| Reverse proxy + HTTPS | **Caddy** (automatic Let's Encrypt certificates; Meta rejects self-signed) | Docker container `caddy` | Cloudflare Tunnel provides HTTPS |
| Backups | Nightly encrypted `pg_dump` + media archive → **off-server** (Cloudflare R2 or Hostinger backup storage), 14 daily + 8 weekly retained, monthly tested restore. **Never back up customer data to GitHub.** | cron container | n/a |
| Payments | Razorpay (our subscriptions; tenants' own Razorpay for renewal payment links) | | test mode |
| AI features | Anthropic Claude API (server side only) | | |
| Source control / code backup | GitHub private repo `leadbotcloud` (code only, never `.env` or data) | | |
| Errors / monitoring | Sentry (web + worker), uptime checks, alerts to operators' WhatsApp/Telegram | | |

**VPS sizing:** start with at least 2 vCPU / 8 GB RAM (e.g. Hostinger KVM 2), Ubuntu 24.04, Docker. Harden it: SSH keys only, firewall (only 80/443 + SSH), fail2ban, automatic security updates, Postgres/Redis bound to the internal Docker network only.

**Supabase replacements (where Part B or other sections say "Supabase", use these):** Supabase Postgres → self-hosted PostgreSQL + Drizzle · Supabase Auth → Better Auth · Supabase Storage → storage abstraction (local disk / R2) · Supabase Realtime → Socket.IO in the worker · RLS → **tenant isolation in two layers**: (1) every query goes through a tenant-scoped data-access layer that requires `tenantId`, and (2) Postgres Row-Level Security policies keyed on a per-transaction setting (`SET LOCAL app.tenant_id = ...`) as defence in depth. Tests must prove tenant A can never read or write tenant B's data. "Service-role key" → the worker's DB role that bypasses RLS; it is never available to browser code.

## A2.2 System diagram
```
 Browser / installed PWA (tenant users, super-admin)
     │ HTTPS                                   ▲ websocket (Socket.IO, session-authenticated)
     ▼                                         │
 ┌──────────────────────── Hostinger VPS (Docker Compose) ───────────────────────┐
 │ Caddy (HTTPS) ──► web (Next.js: UI, auth, server actions/API routes)          │
 │       │                 │ signed internal API (HMAC)                          │
 │       │                 ▼                                                      │
 │       └──────────► worker (Fastify + BullMQ + Socket.IO)                       │
 │                      - GET/POST /webhooks/meta     ◄── Meta webhooks           │
 │                      - POST /webhooks/razorpay     ◄── Razorpay webhooks       │
 │                      - queues: webhook-process, send, campaign, template-sync, │
 │                        renewal-scheduler, media, analytics-sync, notifications │
 │                      - Meta Graph API (pinned) via packages/meta ──► graph.facebook.com
 │                      - Razorpay API, Claude API                                │
 │   postgres (internal only)    redis (internal only)    storage volume          │
 │   backup cron ──► off-server backup storage                                    │
 └────────────────────────────────────────────────────────────────────────────────┘
```
The web app never calls Meta directly for sending. It writes intent to the DB and calls the worker's internal API (HMAC shared secret + tenant check) to enqueue work. Short, synchronous Meta calls a user waits on (submitting a template, Embedded Signup token exchange) go through the worker's internal API with a fast response. Long-running work never runs inside a web request.

## A2.3 Repository layout (pnpm workspaces + Turborepo)
```
leadbotcloud/
├─ apps/
│  ├─ web/          # Next.js: (marketing) routes, (app) tenant panel, (admin) super-admin, api routes, Better Auth
│  └─ worker/       # Fastify server + BullMQ workers + schedulers + Socket.IO realtime gateway
├─ packages/
│  ├─ meta/         # THE ONLY Meta Graph API client (typed, version-pinned)
│  ├─ db/           # Drizzle schema, migrations, RLS policies, tenant-scoped data-access layer, seed
│  ├─ shared/       # zod schemas, error-code map, pricing calc, phone utils, template linter,
│  │                # i18n strings (en, hi), ready-made template library, storage abstraction, fixtures
│  └─ ui/           # (optional) shared React components on top of shadcn
├─ infra/           # docker-compose.dev.yml (postgres+redis), docker-compose.prod.yml (caddy, web, worker,
│                   # postgres, redis, backup), Caddyfile, VPS hardening + deploy scripts, cloudflared config
├─ docs/            # this spec, runbook, backlog, open questions, meta-changes log
├─ AGENTS.md
└─ .env.example
```

## A2.4 Environment variables
```
APP_URL, MARKETING_URL, WORKER_URL, REALTIME_URL
DATABASE_URL (app role, RLS enforced), DATABASE_URL_WORKER (worker role), REDIS_URL
BETTER_AUTH_SECRET, BETTER_AUTH_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
STORAGE_DRIVER=local|s3, STORAGE_LOCAL_PATH, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, SIGNED_URL_SECRET
META_APP_ID, META_APP_SECRET, META_GRAPH_VERSION=v26.0, META_WEBHOOK_VERIFY_TOKEN,
META_ES_CONFIG_ID, META_ES_VERSION=v4, META_SYSTEM_USER_TOKEN (our own testing)
TOKEN_ENCRYPTION_KEY (32-byte base64), INTERNAL_API_SECRET
RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
ANTHROPIC_API_KEY, SENTRY_DSN_WEB, SENTRY_DSN_WORKER
BACKUP_TARGET, BACKUP_ENCRYPTION_KEY
COMPANY_LEGAL_NAME=DigiXoMedia, COMPANY_ADDRESS, COMPANY_GSTIN (optional), SUPPORT_WHATSAPP=+918250919483
```
Validate all env vars with zod at startup; fail fast.

---

# A3. Users, roles and tenancy

## A3.1 Actors
- **Super-admin (DigiXoMedia staff):** manages the whole platform.
- **Tenant Owner:** created at signup; full control of the workspace, billing, connection.
- **Tenant Admin:** everything except billing and deleting the workspace.
- **Tenant Agent:** chats (all or assigned only, per workspace setting), view contacts, use approved formats; cannot bulk-send, change settings, export data or see billing.
- **End customer:** the tenant's customer on WhatsApp (never logs in).

## A3.2 Tenancy rules
- One tenant = one workspace = one Meta business connection (Pro: up to 3 phone numbers).
- A user can belong to multiple workspaces (workspace switcher).
- Every tenant-owned row has `tenant_id`; Postgres RLS enforces isolation. The service-role key exists only in the worker and server-side code, never in browser bundles.
- Every sensitive action is written to `audit_log` (who, what, when, before/after).

---

# A4. Feature modules (complete product)

Each module lists what it must do. Meta mechanics are specified in Part B; section references are given as **[B§x]**.

## A4.1 Marketing website (leadbotcloud.com)
- Pages: Home (promise + 4 pillars + how it works + demo video slot + CTA), Features, Pricing (plans from DB config, GST note, "WhatsApp charges paid directly to Meta, no markup"), Renewals (niche landing page), Compare (vs typical panels: markup, lock-in, support, guardrails), FAQ, Contact (WhatsApp button), Blog (optional MDX).
- **Legal pages required by Meta and Razorpay [B§1.4]:** Privacy Policy, Terms of Service, Data Deletion instructions (URL configured in the Meta app), Refund & Cancellation Policy, Acceptable Use Policy (banned business categories). The footer must show **"LeadBotCloud, a product of DigiXoMedia"**, the registered address, the support email on our own domain, and the WhatsApp number. The legal name must match the Meta Business verification.
- SEO basics, Open Graph tags (valid `og:type`), fast (Lighthouse ≥ 90 on mobile), Hinglish-friendly copy.

## A4.2 Authentication and workspace
- Sign up / log in: email + password, Google, and **phone OTP** (Better Auth; OTP delivered via our own WhatsApp number using an authentication template).
- Signup collects: name, business name, business category (dropdown, incl. "Other"), phone, city, "how did you hear about us". **Category screening:** risky categories per Meta's Commerce Policy (see Part C/B) are flagged for super-admin review; prohibited categories are blocked with a polite message.
- Accept Terms + Acceptable Use Policy checkbox (stored with timestamp and version).
- Workspace switcher; invite team members by email/phone link; roles (A3.1); remove member; transfer ownership.
- Session security: 2FA optional for owners (TOTP), device/session list with "log out everywhere".

## A4.3 Onboarding (first-run experience)
- **Home checklist** until complete: ① Connect WhatsApp → ② Add customers → ③ Get a message format approved → ④ Send your first message → ⑤ (Growth+) Set up renewals. Each step: one sentence, a button, and a 60–90 s tutorial video slot (YouTube embed, URL configurable by the super-admin).
- Empty states on every page explain the next step in one line with one button.
- "Book a free setup call" button (opens WhatsApp chat with support, pre-filled with workspace name).

## A4.4 WhatsApp connection (Embedded Signup) [B§1, B§2]
- **Pre-flight screen** in plain words: what you need (a phone number that can receive an SMS/call; if it's on the WhatsApp app, choose "keep using the app" (coexistence) or move it fully; a Facebook account; a debit/credit card for WhatsApp charges billed by Meta; business name/display name rules).
- **Connect button** launches **Embedded Signup v4** (v5 behind a feature flag) via the Facebook JS SDK with our `config_id`, captures the session-info event and the auth `code` [B§2.2].
- Server: exchange code for the business token, encrypt and store it, persist all IDs using the **future-proof ID model** (business portfolio, messaging account = WABA, WhatsApp account ID when provided, phone number ID) [B§2.3, B§3, B§9.1]; subscribe our app to the WABA (`subscribed_apps`); register the number with a 6-digit PIN when required; fetch number details.
- **Coexistence option** (keep the WhatsApp Business app on the same number) with clear upfront warnings: 20 msg/s cap, broadcast lists read-only, groups don't sync, only 6 months of 1:1 history syncs, app labels/quick replies not available via API [B§2.5]. Ingest history/contact sync webhooks where available.
- **Switching from another provider** (Interakt/Wati/AiSensy) guide and supported path [B§2.6].
- **"Ready to send" gates** [B§2.4] shown as a checklist with green ticks: number connected and registered · display name approved · payment method added in Meta (manual confirmation + link, since there is no reliable API signal) · account billed in INR (required for India by 31 Dec 2026; non-INR accounts stop delivering from 1 Jan 2027) · webhooks receiving · at least one approved message format.
- **Connection page** afterwards: number, display name + status, quality (🟢 Safe / 🟡 Careful / 🔴 Stop sending), daily sending limit tier, throughput, business profile editor (about, description, address, email, websites, profile photo) [B§8.2], disconnect/reconnect, token health check.
- Pro plan: multiple phone numbers under the same connection; a number selector wherever sending happens.

## A4.5 Customers (contacts)
- List with search (name/phone), filters (tags, custom fields, consent status, opted-out, last message date, renewal status), sort, **select all matching filter** (no 100-row cap), bulk actions: add/remove tags, set custom field, delete, export CSV, add to a bulk send.
- Customer profile: name, phone (E.164), BSUID/username when present [B§9.2], tags, custom fields, notes, consent history, opt-out status, conversation link, subscriptions/renewals, message history summary.
- **Forgiving import** (CSV/XLSX): upload → auto-detect columns (name/phone/tags/custom fields; Hindi/English headers) → mapping screen → preview of the first rows with problems highlighted → dedupe (by normalised phone) → result report (imported/updated/skipped with reasons + downloadable error file). Phone normalisation: strip spaces/dashes, handle leading 0, 91, +91, 10-digit Indian numbers; reject invalid lengths.
- **Consent is mandatory** for import and manual add: "These customers agreed to receive WhatsApp messages from us" + consent source (Website form, In shop, WhatsApp chat, Order/invoice, Imported list (specify), Other) + date. Every consent change writes a `contact_consent_events` row (who/when/source/proof) [B: opt-in rules].
- **Opt-out:** STOP keywords (stop, unsubscribe, band karo, mat bhejo, configurable) and Meta's marketing opt-out (`user_preferences` webhook) set `opted_out_at`, add an event, and auto-reply a short confirmation (free-form, inside the 24h window). Opted-out contacts are excluded from all marketing sends, always, and shown with a badge. Re-subscribe only on the customer's own explicit message ("START").
- Custom fields manager (text, number, date, dropdown). Tags manager (rename/merge/colour).
- **Segments:** saved filters (tags, custom fields, consent, last-active, renewal status), with live count.
- Google Sheets sync (Growth+): connect a Google Sheet (OAuth) to import/update contacts on a schedule and write back renewal status.
- Data rights: export a contact's data; erase a contact (hard delete PII, keep anonymised message counts) [DPDP].

## A4.6 Chats (team inbox)
- **Mobile:** chat list → full-screen chat, exactly like WhatsApp: green outgoing bubbles, ticks (✓ sent, ✓✓ delivered, blue ✓✓ read), failed messages show a red "!" with the plain-language reason and a Retry/Use-a-format action.
- **Desktop:** 3 panes: chat list · conversation · customer panel (profile, tags, notes, consent, assigned agent, renewals, past bulk sends received).
- **24-hour window awareness** [B§4]: a banner showing "You can reply freely for 5h 12m" (counting down from the customer's last message), or, when closed, "This customer hasn't messaged in 24 hours. Send an approved message format," with a format picker (fill variables, preview, cost shown).
- Composer: text with WhatsApp formatting (*bold*, _italic_), emoji, attachments (image/video/document/audio within Meta limits [B§8.1]), **quick replies** (saved snippets, `/shortcut`, variables like {name}), interactive messages (reply buttons, lists, CTA URL) via a simple builder, location request, reactions. Typing indicator and mark-as-read when an agent opens a chat [B§4.2].
- Inbound: all message types rendered (text, media with lazy download + cache to our storage (local disk / R2) respecting Meta media retention [B§8.1], location, contacts, button/list replies, reactions, ad referral badge "Came from your Facebook/Instagram ad" with ad details [B§5]). Unsupported types shown gracefully.
- Assignment: assign/unassign, auto-assign (round-robin among online agents, optional), "Assigned to me" / "Unassigned" / "Unread" / "Resolved" filters, labels, mark resolved/reopen, internal notes (not sent).
- Realtime via Socket.IO (worker gateway): new messages, status updates, unread counts, assignment changes, "agent X is viewing" presence.
- Search messages across chats. Starred messages.
- Notifications: browser/PWA push for new chats assigned to me; sound toggle.
- Business hours setting (IST) used by away messages and SLA display.

## A4.7 Message formats (templates) [B§7]
- **List:** name, language, type in plain words (Marketing = promotional; Utility = order/account updates; Authentication = OTP), status (Approved / In review / Rejected + reason / Paused / Disabled), quality dot, last updated, usage count. Sync from Meta on connect, on demand, and daily; update in realtime via template webhooks (status, category change, quality) [B§5.5].
- **Builder:** name (auto-slug, Meta naming rules), language, type with a cost hint per type, header (none/text/image/video/document; upload sample), body with variables (positional or named per [B§7.2]) and required samples, footer, buttons (quick reply, URL with dynamic suffix, call, copy code, OTP for authentication), carousel and limited-time offer where supported. **Live phone preview.**
- **Pre-submit checker (lint)** [B§7.5]: catches common rejection causes (variable at start/end, adjacent variables, missing samples, variable-to-text ratio, length limits, URL shorteners, prohibited content hints, formatting issues), predicts the category, warns when promotional wording is marked Utility ("WhatsApp will likely make this Marketing, so it will cost ₹X per message"), and **warns that renewal/payment-due reminders are Marketing** (Meta: utility messages can't seek renewals). Show a **risk score** (Low/Medium/High) with fixes.
- **Rejection explainer:** turn Meta's `reason` + `rejection_info.recommendation` into plain steps [B§7.6]; one-click "Edit and resubmit" (respecting edit limits [B§7.1]).
- **Category change alerts:** when Meta reclassifies a format, notify with the new cost per message.
- **Ready-made library:** 30+ editable, Meta-friendly starters with correct categories and samples, grouped by use case: Offers & festivals (Diwali, Holi, Eid, Christmas, New Year, Independence Day sale…), Renewals (due in 7/3/0 days, overdue, renewed confirmation), Payments (payment received, invoice, due reminder), Orders (confirmed, shipped, delivered, COD confirmation), Appointments (booking confirmed, reminder), Engagement (welcome, feedback, back-in-stock, review request), Account (OTP).
- **AI message writer** (Growth+, Claude API): the user describes the goal in any language ("Diwali offer 20% off on all plans till Sunday"); AI drafts 2–3 options in the chosen language, with variables, correct category, and the lint/risk score applied. **AI never submits to Meta on its own; the human reviews and clicks Submit.**
- Delete and duplicate formats. Template analytics (sent/delivered/read/clicked) where Meta provides them [B§8.3].

## A4.8 Bulk send (campaigns)
A 4-step wizard: **① Pick message → ② Pick customers → ③ Check & cost → ④ Send or schedule.**
1. **Pick message:** approved formats only; fill variables with static text or customer fields (name, custom fields, renewal fields) with fallbacks; header media upload; live preview with a real customer's data.
2. **Pick customers:** segment, tags, CSV upload (auto-import with consent), all opted-in. Live count.
3. **Check & cost (the key screen):** the **pre-send check** [B§4.6], each line ✅/⚠️/⛔ with numbers and a one-line explanation:
   - opted-out customers removed (count),
   - customers without consent removed by default (count; owner can include only with an explicit consent confirmation),
   - customers on a WhatsApp 24-hour hold (error 131049 earlier) removed (count) [B§6],
   - customers who received a marketing message in the last 24 h (warn; option to skip them),
   - **daily sending limit headroom** vs audience (⛔ if over the limit; offer "split across days automatically"),
   - format status/quality (⛔ if paused/disabled; ⚠️ if quality is low),
   - number quality (⛔ if red),
   - **cost estimate:** "1,240 × ₹0.86 = ₹1,066 + 18% GST ₹192 = ₹1,258 (charged by Meta to your card)", using the current India rate table (super-admin-editable, in paise, by category; Meta changes rates quarterly) [B§8.3]; labelled as an estimate,
   - optional **spend cap** ("Stop sending if cost passes ₹___"),
   - smart send-time suggestion (avoid 9 pm–9 am; recommend the business's historically best hour, else 10–11 am / 6–8 pm).
4. **Send now or schedule** (IST date/time, optional "send in my customer's local time" not needed for India v1), final confirm dialog repeating count, cost, and the format.
- **Execution:** the campaign is expanded into recipients and enqueued in batches; the worker paces per number and per customer, routes marketing formats via the **Marketing Messages API** and others via `/messages` (decided at send time from the format's current category) [B§4.3], enforces the spend cap, honours Pause/Resume/Cancel between batches, and auto-pauses if number quality drops.
- **Report:** live counters (Queued, Sent, Delivered, Read, Replied, Clicked (URL button tracking via redirect where feasible), Failed, **Limited by WhatsApp** shown separately from failures), cost so far, failures grouped by plain-language reason with "what to do", recipient table with filters + CSV export, "Send again to people who didn't read" (creates a new draft, never auto-sends), A/B test (Pro: two formats split 50/50 on a sample, then winner to the rest).
- Recurring sends (e.g. every Monday) for Pro.

## A4.9 Automation
### Auto-replies (all plans; rule count per plan)
- Welcome message (first-ever message), away message (outside business hours), keyword rules (contains / exact / starts with; multiple keywords; English + Hinglish) → reply with text, media, interactive buttons/list, or assign to agent/add tag. Per-customer cooldown to prevent loops. Only free-form inside the customer-opened 24 h window. STOP/START handled by the opt-out system, never by rules.
- Rule tester ("Type a message to see which rule replies"). On/off toggles. Priority order (drag).
### Chatbot flows (Pro)
- Visual flow builder (React Flow): nodes = send message (text/media/buttons/list), ask question (save answer to custom field), condition (by answer/tag/field), add tag, assign agent, call webhook, wait, end. Triggers: keyword, ad referral, button payload, new customer. Clear "Talk to a human" escape in every flow. Flow analytics (drop-offs).
- **WhatsApp Flows** (Meta's native forms) for lead capture/booking where supported [B§feasibility notes]; optional.
### AI assistant for FAQs (Growth+, optional toggle)
- Business-scoped AI replies trained on the tenant's own FAQ entries/website text (stored per tenant), via Claude API. **Must comply with Meta's 2026 AI policy:** business-specific support/sales only, never a general-purpose assistant; always offer human handoff; never invent prices/policies (answer only from provided knowledge, otherwise hand off). Log every AI answer; the owner can review and correct.

## A4.10 Renewal engine (the differentiator; Growth+)
- **Plans/products:** name, price (paise), duration (days/months), reminder schedule.
- **Customer subscriptions:** contact, plan, start date, expiry date, status (Active / Due soon / Overdue / Renewed / Cancelled), amount, notes, external reference. Add manually, bulk import (CSV/XLSX/Sheets, same forgiving importer), or auto-create on a recorded payment.
- **Reminder sequences** per plan: default 7, 3 and 0 days before expiry and +2 days after, each mapped to a **Marketing** message format (renewal reminders are marketing under Meta rules, so show the cost) with variables (name, plan, expiry date, amount, payment link). A daily scheduler (10:00 IST, configurable) enqueues due reminders through the normal send pipeline, so all pre-send rules, holds, opt-outs and quality checks apply.
- **Payment links:** the tenant connects their **own Razorpay account** (API keys stored encrypted; Cashfree as a later option). For each reminder the worker creates a per-customer payment link (amount, customer, reference = subscription id) inserted into the URL button variable. UPI, cards and netbanking are all handled by Razorpay's hosted page.
- **Auto-renew on payment:** the tenant's Razorpay webhook (`payment_link.paid`) → verify signature → mark renewed, extend expiry by the plan duration, stop remaining reminders, log a renewal event, send a confirmation ("Payment received ✅ renewed till 12 Feb 2027"): free-form if the 24 h window is open, otherwise a **Utility** confirmation format. Optional: deliver credentials/notes stored on the subscription.
- **Fallbacks for unreachable customers** (131049 holds, failed, no reply): "Call list" view with tap-to-call/WhatsApp-app deep link; nudge copy that invites a reply (opens the free 24 h window).
- **Renewals dashboard:** tabs Due soon / Overdue / Renewed this month / Cancelled / All; actions: send reminder now, copy payment link, mark paid manually (cash/UPI direct), pause reminders, cancel. KPIs: renewals due this month, collected, **₹ recovered via LeadBotCloud**, renewal rate, reminder cost vs revenue recovered (ROI). The "₹ recovered" number is shown prominently on Home.

## A4.11 Home dashboard
Four primary cards: **This month's WhatsApp spend** (estimate + Meta-reported where available) · **Last bulk send result** (delivered %, read %, replies) · **Number health** (quality, limit, status, warnings) · **Pending chats** (unread/unassigned). Growth+: **Renewals** card (due this week, ₹ recovered this month). Below: onboarding checklist (until done), recent activity, alerts.

## A4.12 Number health centre (Growth+; basic version for all)
- Health score (0–100) built from: Meta quality rating, recent block/report signals Meta exposes, failure rates by error class, 131049 share, opt-out rate, template quality states, send frequency per contact. Trend chart, "what lowered it", and "what to do" in plain words.
- Guardrails (all plans): auto-pause marketing sends when quality turns red; frequency cap per contact (configurable, default max 2 marketing messages/week); automatic 24 h holds after 131049; warn on cold lists (import without recent conversation history); warn before sending to large audiences close to the limit.
- Limit tracking: current tier, usage in the rolling 24 h, upgrade eligibility explanation [Part B messaging limits].

## A4.13 Costs and billing
### WhatsApp (Meta) costs: per tenant, read-only intelligence
- Cost ledger built from status webhooks' pricing info and Meta's `pricing_analytics` [B§8.3]: per day, per category, per campaign. Clear statement: "Charged by Meta to your card. LeadBotCloud adds nothing."
- Monthly spend cap with alerts at 50/80/100%; optional hard stop for marketing.
- India specifics: INR billing check and the 31 Dec 2026 warning; GST note; service messages are free for the first 1,000 per number per month, then billed at the utility rate (since 1 Oct 2026) [Part B pricing].
### LeadBotCloud subscription (Razorpay Subscriptions)
- Billing page: current plan, usage vs limits, upgrade/downgrade (prorated), payment method, invoices (GST invoice PDF with DigiXoMedia details), **one-click cancel** (confirmation; access till period end), refund requests routed to super-admin.
- Limit enforcement: soft (friendly upgrade prompts), never break a running bulk send or renewal sequence mid-way.
- Webhooks: subscription activated/charged/halted/cancelled, payment failed → dunning emails/WhatsApp to owner.

## A4.14 Notifications centre
In-app bell + optional WhatsApp/email to the owner for: format approved/rejected/paused/re-categorised, quality drop, limit change, campaign finished/paused/auto-paused, connection/token problems, INR/payment-method reminders, renewal payments received, plan/billing events. Per-user preferences.

## A4.15 Settings
Business profile (WhatsApp profile fields + logo), business hours, team & roles, quick replies, tags & custom fields, opt-out keywords, frequency caps, spend caps, integrations (Razorpay for renewals, Google Sheets, webhooks/API keys for Pro), language (English / Hindi / Hinglish UI), notification preferences, data export/delete workspace, audit log viewer (owner/admin).

## A4.16 Integrations & developer API (Pro)
- REST API with per-tenant API keys (scoped, revocable): send message/format, create/update contact, list conversations, campaign status. Rate-limited.
- Outgoing webhooks (tenant-configured URL): message received, status updated, contact opted out, renewal paid. Signed (HMAC), retried with backoff.
- Native: Razorpay (renewals), Google Sheets. Later candidates: Shopify/WooCommerce (order updates, COD confirmation, abandoned cart), Zapier/Make, Pabbly.

## A4.17 Super-admin panel (DigiXoMedia only, `/admin`)
- Tenants: list, search, plan, status, signup category, risk flag, connection health, usage, last active; approve/flag/suspend; **impersonate (read-only by default, logged)**.
- Plans & pricing config (A1.4), feature flags per plan/tenant, Meta rate table (India, by category, effective dates), tutorial video URLs, ready-made template library management.
- System health: queue depths, failed jobs/DLQ with retry, webhook error rate, worker status, Meta API error trends, Sentry links.
- Billing overview: MRR, active subscriptions, failed payments, refunds.
- Broadcast announcements to tenants (in-app banner).
- Audit log across the platform.

## A4.18 PWA and mobile
- Mobile-first everything (360 px baseline). Installable PWA (manifest, icons, splash, offline fallback page), web push notifications for chats (Android; iOS 16.4+ when installed). Bottom navigation on mobile: **Home · Chats · Send · Customers · More**.
- Lightweight: code-split routes, image optimisation, skeleton loaders, works on slow 3G/4G, small JS bundles on chat screens.
- Later (not in this build): Play Store via TWA wrapper; native app.

## A4.19 Internationalisation
All UI strings from `packages/shared/i18n/{en,hi}.json` (keys, never inline). English default, Hindi toggle; Hinglish copy for key help texts and error messages. Dates in IST, DD MMM YYYY; currency ₹ with Indian digit grouping (1,00,000).

---

# A5. UX and design system

## A5.1 Principles
1. **Speak the customer's language, never Meta's.** Use this vocabulary everywhere in the UI:

| Meta term | UI says |
|---|---|
| Template | Message format |
| Broadcast / campaign | Bulk send / Send to customers |
| 24-hour customer service window | "Can reply free for Xh" / "Needs an approved message format" |
| Opt-in / consent | Customer allowed messages |
| Opt-out | Customer stopped messages |
| WABA, phone number ID | WhatsApp connection |
| Quality rating | 🟢 Safe · 🟡 Careful · 🔴 Stop sending |
| Messaging limit tier | Daily sending limit |
| Marketing / Utility / Authentication | Promotional / Updates / OTP (with the official word in small grey text) |
| Error 131049 | "WhatsApp limited offers to this customer today. We'll try again after 24 hours." |
| Webhook | (never shown to non-Pro users) |

2. **One main action per screen**, big touch targets (≥ 44 px), plain short sentences.
3. **Always say what happened and what to do next**, for every error, empty state and warning. Raw Meta codes only inside a collapsible "Technical details".
4. **Show money before it's spent.** Every action that costs money shows the estimated cost first.
5. **Protect by default.** Risky actions need explicit confirmation; safe defaults (exclude non-consented, skip recently messaged, cap frequency).
6. **Feels like WhatsApp** where users already have muscle memory (chat list, bubbles, ticks, attachment sheet).
7. **Fast and forgiving:** autosave drafts, undo for deletes (toast with Undo), never lose typed messages.

## A5.2 Visual design
- shadcn/ui components on Tailwind, CSS variables theme, **light and dark mode**.
- Brand: primary green `#16A34A` (WhatsApp-adjacent, not identical), dark slate text `#0F172A`, neutral greys, accent amber for warnings, red for blocks. Rounded-xl cards, soft shadows, generous spacing. Inter font (Noto Sans Devanagari for Hindi).
- Use the **Mobbin MCP** for references when designing each new screen (inbox, wizard steps, dashboards, settings); adapt to our theme, don't copy brands.
- Data viz: simple bars/lines, no clutter; numbers first, charts second.
- Accessibility: WCAG AA contrast, keyboard navigation on desktop, labelled inputs, focus states.

## A5.3 Key screens (must be excellent)
Home · Chats (mobile + desktop) · Bulk send wizard step 3 "Check & cost" · Message format builder with live preview + lint · Customer import mapping/preview · Connect WhatsApp wizard · Renewals dashboard · Number health · Billing.

---

# A6. Engineering rules (non-negotiable)

1. **Meta access only through `packages/meta`.** Version from `META_GRAPH_VERSION` (pin `v26.0`; v27.0 only after staging review) [B§0.2, B§9.3]. Typed requests/responses; typed `MetaError {code, subcode, message, fbtraceId, retryable}`. No retries inside the client (queues own retries).
2. **Webhooks [B§5]:** verify `X-Hub-Signature-256` against the raw body with the app secret → insert raw event into `webhook_events` with a dedupe key → enqueue `webhook-process` → return 200 immediately. Processing is idempotent, tolerant of duplicates and out-of-order delivery (never downgrade a status, e.g. read → delivered), and logs unknown event shapes without crashing. Multi-tenant routing by phone number ID / WABA ID [B§5.3].
3. **Sending [B§4]:** everything outbound goes through the `send` queue with an idempotency key; per-number token-bucket pacing (default throughput per Part B; coexistence numbers 20 msg/s), per-recipient pair-rate spacing, retries only for retryable errors with exponential backoff + jitter, a dead-letter queue, and **no blind re-send of marketing messages after ambiguous timeouts**. Marketing formats via `/marketing_messages`, others via `/messages`, decided at send time from the format's current category [B§4.3].
4. **Error mapping [B§6]:** one table in `packages/shared/errors` → `{retryable, action, userMessage_en, userMessage_hi, docsLink}`; special handling for 131049 (24 h hold), 131050 (user stopped marketing → opt-out), 131047 (window closed → suggest format), 130429/131056 (throttle), 132xxx (format problems → notify), 190 (token → connection alert), 131063/131064 and others per Part B.
5. **Multi-tenancy & security:** RLS on every tenant table with tests proving tenant A can't read/write tenant B; tokens and API keys encrypted at rest (AES-256-GCM, key from env); service-role key never in client bundles; rate limiting on public/API routes; zod validation at every boundary; CSRF protection for mutations; signed internal API between web and worker; Razorpay and Meta webhook signature checks; least-privilege roles enforced server-side (never trust the UI).
6. **Privacy (India DPDP Act + Meta terms):** LeadBotCloud is the **data processor**, each tenant the **data fiduciary**. Minimise PII in logs (mask phones `+91•••••1234`, never log tokens or message bodies at info level); configurable retention (default messages 24 months, webhook raw events 90 days, media per Meta retention); tenant data export and deletion; contact erasure; breach-ready audit logs; a DPA in the Terms.
7. **Money:** integer paise everywhere; GST computed separately; rates table with effective dates; every estimate labelled as an estimate.
8. **Phones:** E.164 storage; normalisation utility with tests; support contacts identified by **BSUID without a phone** where Meta provides them [B§9.2].
9. **Future-proof IDs [B§3, B§9.1]:** store business portfolio ID, messaging account ID (current WABA ID), WhatsApp account ID (nullable now), phone number ID; use `messaging_account_id` naming (Meta deadline 31 Dec 2026 to drop `paid_messaging_account_id`).
10. **Time:** store UTC, display IST; schedulers configured in IST.
11. **Observability:** Sentry in web + worker; structured JSON logs with request/job IDs and redaction; health endpoints; alerts (queue depth, DLQ growth, webhook failures, Meta error spikes) sent to the operators' WhatsApp/Telegram.
12. **Testing:** Vitest unit tests for all pure logic (phone utils, pricing, linter, error mapper, pacing, segment builder, renewal date maths); integration tests with recorded Meta webhook fixtures; RLS tests; a mock Meta server for load tests (10k-recipient campaign, no duplicates, pacing respected); failure drills (kill worker mid-campaign → resumes cleanly; Redis restart; Meta 5xx/130429). Real end-to-end checks against Meta's **test phone number**.
13. **Code quality:** TypeScript strict, ESLint + Prettier, no `any` without a comment, small focused modules, server-only code marked, migrations append-only, `.env*` never committed, CI runs lint + typecheck + tests on every PR.
14. **Deployment:** production runs on the Hostinger VPS via `infra/docker-compose.prod.yml` (deploy script pulls `main`, builds images, runs migrations, restarts with graceful shutdown that drains jobs); local dev uses Docker Postgres/Redis + Cloudflare Tunnel; separate dev and production databases and Meta webhook configs; nightly encrypted off-server backups with a tested restore; `docs/RUNBOOK.md` for deploy, rollback, secret rotation, stuck campaigns.
15. **Never invent Meta behaviour.** If Part B lacks something or marks it `[UNVERIFIED]`, implement defensively, log raw data, and list it in `docs/open-questions.md`.

---

# A7. Data model overview
The full table design is in **[B§3]**; implement it, extended with these product tables:
- **Core:** tenants, tenant_members, invitations, user_profiles, audit_log, notifications, notification_preferences, feature_flags, plans, tenant_subscriptions (LeadBotCloud billing), invoices.
- **Meta:** meta_connections, phone_numbers, business_profiles, templates, template_events, webhook_events, meta_rate_cards (by country/category/effective date).
- **Contacts:** contacts, contact_consent_events, tags, contact_tags, custom_field_definitions, segments, imports (+ import_rows errors).
- **Messaging:** conversations, messages, message_status_events, quick_replies, labels, notes, media_assets.
- **Campaigns:** campaigns, campaign_recipients, campaign_events, contact_marketing_holds (131049 holds/frequency).
- **Automation:** auto_reply_rules, flows, flow_nodes, flow_runs, ai_knowledge_entries, ai_reply_logs.
- **Renewals:** renewal_plans, customer_subscriptions, renewal_reminder_steps, renewal_events, payment_links, tenant_payment_gateways (encrypted keys).
- **Costs:** message_costs (per message, paise), cost_daily_rollups, spend_caps.
- **Developer:** api_keys (hashed), outgoing_webhooks, outgoing_webhook_deliveries.
- **Admin:** announcements, tutorial_links, template_library.
All tenant tables: `tenant_id`, `created_at`, `updated_at`, RLS, appropriate indexes [B§3.2–3.3].

---

# A8. Build order (dependencies, not a timeline)
Build in this dependency order so every layer is testable before the next:
1. Repo, tooling, CI, env validation, design system and app shell (mobile + desktop nav), auth and workspaces, super-admin skeleton.
2. Database schema + RLS + tests; `packages/meta` client; error map; webhook receiver + raw event store; worker + queues infrastructure.
3. Connect WhatsApp (Embedded Signup) + connection page + ready-to-send gates; inbound message processing → conversations.
4. Customers (import, consent, opt-out, segments) → Chats (inbox) → send queue for single messages.
5. Message formats (sync, builder, lint, library, webhooks) → Bulk send (wizard, pre-send check, cost, execution, reports).
6. Auto-replies → Home dashboard → notifications → number health guardrails → cost ledger.
7. Renewal engine (plans, subscriptions, reminders, Razorpay links, auto-renew, dashboard).
8. LeadBotCloud billing (Razorpay subscriptions, plans, limits, invoices) → marketing website + legal pages.
9. AI writer, Sheets sync, Hindi UI, chatbot flow builder, AI FAQ assistant, developer API/webhooks, A/B tests.
10. Hardening: security review, load and failure drills, monitoring and alerts, backups and runbook, accessibility and 360 px polish.
**First real tenant: DiGiXO Store**: it should be able to use each layer as soon as it works.

---

# A9. Definition of done (every feature)
- Works and looks right at 360 px and on desktop, in light and dark mode.
- No Meta jargon in the UI; all strings in i18n files.
- Tenant isolation verified (RLS test); role permissions enforced server-side.
- Every error and empty state is human-readable with a next step.
- Lint, typecheck, tests pass; new logic has tests; Meta interactions verified against the test number or recorded fixtures.
- Docs updated (schema, env, runbook, open questions).

# A10. How the agent should work
1. Read this whole document once. Before each piece of work, re-read the relevant Part A module and Part B sections.
2. Before coding, restate what you'll build, list files/migrations you'll touch, and flag doubts.
3. Work in focused branches/PRs with clear descriptions and **manual test steps**; keep `main` deployable.
4. Never commit secrets. Never call Meta outside `packages/meta`. Never put background work in the web app.
5. Keep `docs/open-questions.md` (unverified Meta details, product decisions needed) and `docs/backlog.md` (ideas outside this spec) up to date.
6. When you finish a module, demo-check it against its section in Part A, point by point.

---
---

# PART B — META WHATSAPP INTEGRATION SPEC (authoritative for all Meta details)

> Section references like [B§4.3] in Part A point here.

## (Part B title) LeadBotCloud — Meta WhatsApp Integration Spec

> Repo path: `docs/meta-integration-spec.md` · Owner: DigiXoMedia (India) · Compiled 2026-11-08
> Audience: LeadBotCloud developers and the AI coding agent (Claude Sonnet via Hermes).
> Status: **Draft v1.** Built from two research notes and one market report dated 2026-11-08. Nothing here has been tested against a live tenant yet.

**Tags (keep them when you copy text into code comments or tickets)**
- `[META]`: read on a Meta developer page in Nov 2026. Safe to build on.
- `[INFERRED]`: engineering judgement, legacy Meta behaviour, or a secondary source. Build it behind config.
- `[UNVERIFIED]`: no Meta page confirmed it. **Do not hard-code. Test in the sandbox or test tenant first** (§0.4).
- `[BSP]`: from a BSP or third-party page. Treat as directional.

**Rules for the coding agent**
1. Never invent a Graph field, enum value or error code that isn't in this doc. If you need one, add a `// TODO(UNVERIFIED)` and put it behind a feature flag.
2. Every Graph call goes through one client module (`packages/meta`). The version comes from config, and the `messaging_account_id` and WAAC fields come from the data model, never from literals.
3. Parse webhooks defensively. Unknown enum values, missing `wa_id` and missing `from` must not throw.

---

## 0. Summary

### 0.1 Key decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Meta Tech Provider, Embedded Signup (ES), no credit line.** Each tenant owns its business portfolio, Messaging account (ex-WABA) and Meta bill, and pays Meta by card. | Tech Providers can't share credit lines `[META]`. Isolates bans and messaging limits per portfolio (limits are per portfolio since 2025-10-07 `[META]`). |
| D2 | **One business token per tenant** (Business Integration System User token). Encrypted at rest. Every tenant call uses that tenant's token. | Tech Providers may use business tokens only `[META]`. |
| D3 | **Marketing templates go to `/marketing_messages` (MM API) with `product_policy: CLOUD_API_FALLBACK`** from day 1. Utility, auth and non-template messages go to `/messages`. | Cloud API marketing sunset (Oct 13 2027); `/messages` rejects marketing with 131063 when disabled `[META]`. |
| D4 | **Route on the template's *current* category**, which you refresh from `template_category_update`, never on the category the user picked. | Meta reclassifies UTILITY→MARKETING by default (since 2025-04-09) `[META]`. |
| D5 | **Renewal and expiry reminders are MARKETING.** Only post-payment confirmations ("payment received", "access details") are UTILITY. | Utility "cannot … seek renewals" `[META]`. |
| D6 | **Contacts keyed on `(tenant_id, bsuid)`, with phone optional.** IDs are future-proofed: `messaging_account_id`, nullable `waac_id`, `phone_number_id`. | BSUID/usernames roll out in 2026 `[META]`; account split 2027–2028 `[META]`. |
| D7 | **One webhook ingress for all tenants.** Route by `entry[].id` (Messaging account / WABA ID) and `metadata.phone_number_id`. No per-tenant override URLs at MVP. | Template and account webhooks can't be overridden anyway `[META]`. |
| D8 | **Webhook receiver = verify signature → durable raw insert → enqueue → 200.** All processing is async. | Meta target is median ≤250 ms, <1% >1 s `[META]`. |
| D9 | **Coexistence (keep WhatsApp Business app number) is offered as opt-in, with warnings** (20 mps, 24 h sync window, feature losses). | High demand from Indian SMBs. Hard limits `[META]`. |
| D10 | **No wallet for Meta usage at MVP.** The panel shows an *estimated* cost ledger. Razorpay bills only the LeadBotCloud subscription. | A Tech Provider can't resell Meta usage `[META]`. |

### 0.2 Pinned versions

| Item | Pin | Notes |
|---|---|---|
| Graph API | **`GRAPH_API_VERSION=v26.0` in production**; `v27.0` in staging | v27.0 released 2026-11-04 (Meta "Platform Versioning" uses it in examples; one changelog copy still showed v26.0) `[META]`+`[BSP]`. Its WhatsApp-specific changes haven't been reviewed `[UNVERIFIED]`. Bump prod to v27.0 once staging passes the §0.4 checklist. Never make an unversioned call. |
| Behaviour floor | ≥ **v24.0** semantics | In v24+ the status `conversation` object is omitted outside free entry point windows, and the messaging limit field is `max_daily_conversations_per_business` `[META]`. Code must assume v24+ behaviour. |
| Facebook JS SDK `FB.init` | `version: GRAPH_API_VERSION` (same env var) | Meta's ES sample uses `v27.0` `[META]`. |
| Embedded Signup | **v4 in production**; **v5 behind flag `ES_V5`** | v2/v3 turned off 2026-10-15 and now served as v4. v5 released 2026-10-20 and turns coexistence on by default `[META]`. The v5 opt-out JSON is `[UNVERIFIED]`. |
| Version lifetime | A version stays usable for 2 years after the *next* version is released `[META]` | v22 ends 2027-05-20; v23 ends 2027-10-08; v24 ends 2028-02-18; v25 ends 2028-07-29 `[META]`. Plan a version bump every 6–9 months. |

### 0.3 Hard deadlines

| Date | Change | Source tag | LeadBotCloud must-do | Owner area |
|---|---|---|---|---|
| **2026-12-31** | Eligible India accounts must move to **INR billing**. Non-INR accounts **stop delivering 2027-01-01**. | `[META]` pricing page (via report) | Onboarding INR check plus a banner for existing tenants. The API field for the account currency is `[UNVERIFIED]`, so use a manual checklist until it's confirmed. | Onboarding |
| **2026-12-31** | `paid_messaging_account_id` → **`messaging_account_id`**. The old name stays as a deprecated alias for now. | `[META]` account model | Use the `messaging_account_id` name everywhere (DB, client, logs). | Data model |
| **2027-04-13** | Messaging accounts **created on or after** this date can't send marketing via Cloud API `/messages`. | `[BSP]` PPC Land | New tenants must be MM API-onboarded before their first campaign, or campaigns fail (STRICT) or fall back. | Sending |
| **H1 2027** | Phase 2 account split: the new Graph version **requires `messaging_account_id`** when a number has more than one Messaging account. New WAAC endpoints, a `whatsapp_account` webhook topic, and ES returns the WAAC ID. | `[META]` | Capture `waac_id` from ES and webhooks as soon as it appears. Subscribe to the new topic. | Onboarding, webhooks |
| **2027-10-13** | **Marketing on Cloud API `/messages` sunsets.** | `[BSP]` PPC Land (report); 131063 behaviour `[META]` | All marketing already on `/marketing_messages` (D3). Remove the fallback path after this date. | Sending |
| **~May 2027** | DPDP Rules phase-in completes (notified 2025-11-14, 18 months). | `[BSP]` PIB doc (report) | Consent log, erasure and export, breach process, DPA template. | Compliance |
| **H1 2028** | Phase 3: every version requires `messaging_account_id` in multi-account setups. **Phone-number-ID paths and queries must use the WAAC ID.** | `[META]` | Path builder takes `phoneRef` and resolves it to `waac_id ?? phone_number_id` through config. | Meta client |
| Quarterly (Jan 1, Apr 1, Jul 1, Oct 1) | Meta rate-card changes, with ≥1 month's notice. | `[META]` (report) | Refresh the `rate_cards` table every quarter. | Billing |

### 0.4 "Verify in test account before hard-coding" checklist

Run these with the sandbox (App Dashboard → WhatsApp → Quickstart → Testing Integrations; valid 30 days, **can't send or receive** `[META]`) and with a real test tenant on a +1 555 test number or a spare Indian SIM. Tick each one and record the result in `docs/meta-verification-log.md`.

**Onboarding and accounts**
- [ ] Business token lifetime: `GET /debug_token?input_token=…` shows `expires_at: 0`, and you note which scopes and targets appear. `[UNVERIFIED/BSP]`
- [ ] How the 200-customers-per-week ES tier is granted now that Access Verification is retired. Read Meta's 2026-10-09 blog post itself. `[UNVERIFIED]`
- [ ] ES v5 `extras.features` shape, and the coexistence opt-out (`whatsapp_business_app_onboarding` `enabled:false`). `[UNVERIFIED]`
- [ ] Pre-fill `whatsAppBusinessAccount`: whether it takes the `ids` string or the `id` array. `[UNVERIFIED]`
- [ ] Some API signal that a payment method is attached (none documented). Otherwise detect it from a send test or error 131042. `[UNVERIFIED]`
- [ ] An API field for the INR billing currency on the Messaging account. `[UNVERIFIED]`
- [ ] Full enums: `whatsapp_business_manager_messaging_limit`, `throughput.level`, phone `status`, and any `health_status` field. `[UNVERIFIED]`
- [ ] Whether a tenant business token + the LeadBotCloud app ID works for Resumable Upload (`/{APP_ID}/uploads`). `[UNVERIFIED]`
- [ ] Whether `messaging_account_id` is accepted on `/messages` today (body or query), and in which form. Notes recommend sending it from day 1, but the exact placement isn't documented. `[UNVERIFIED]`
- [ ] India business verification docs: whether Udyam is accepted (Meta Help Centre). Decision time (~14 working days `[BSP]`). `[UNVERIFIED]`
- [ ] Display-name guidelines (Help Centre). `[UNVERIFIED]`
- [ ] Coexistence in India (`[BSP]` Chakra says supported). Code exchange `error_subcode 36008` from a bad redirect_uri. `[BSP]`

**Sending**
- [ ] `biz_opaque_callback_data` accepted as a **send** field, and its max length (seen only in the status echo). `[INFERRED]`
- [ ] Text body max of 4096 characters. `[INFERRED]`
- [ ] Image send shape (inferred from video and document). `[INFERRED]`
- [ ] Send-time parameter shapes: text/video/document headers, `currency`, `date_time`, `quick_reply` payload, flow, catalog and OTP buttons. `[INFERRED]`
- [ ] LTO `expiration_time_ms`: unix ms or a duration (the docs contradict themselves). `[UNVERIFIED]`
- [ ] Removing a reaction with `emoji: ""`. `[INFERRED]`
- [ ] Sticker 512×512 dimensions. `[UNVERIFIED]`
- [ ] Indian language codes (`hi`, `bn`, `gu`, `kn`, `ml`, `mr`, `pa`, `ta`, `te`, `ur`, `or`?). The supported-languages page failed to fetch. `[UNVERIFIED]`

**Webhooks**
- [ ] Webhook response timeout in seconds (Meta gives only latency targets). `[UNVERIFIED]`
- [ ] Raw-body HMAC requirement and unicode escaping. `[INFERRED]`
- [ ] Payloads for inbound `reaction`, `order`, full `system`, `nfm_reply` and `call_permission_reply`. `[UNVERIFIED]`
- [ ] `phone_number_quality_update` events beyond `ONBOARDING` and `THROUGHPUT_UPGRADE` (legacy UPGRADE/DOWNGRADE/FLAGGED/UNFLAGGED). `[UNVERIFIED]`
- [ ] `account_alerts`, `history`, `smb_app_state_sync` and `smb_message_echoes` payload shapes. `[UNVERIFIED]`
- [ ] CTWA free entry point window: Meta's pricing page now says "up to 7 days" (report), but older notes say 72 h. Read it from the status `conversation.expiration_timestamp`. Never hard-code it. `[UNVERIFIED]`
- [ ] India date for BSUIDs and usernames. `[UNVERIFIED]`

**Templates and analytics**
- [ ] Template Migration API endpoint, archive/unarchive API, and the OTP/FLOW/CATALOG button specs. `[UNVERIFIED]`
- [ ] Whether `rejected_reason` is a readable GET field on templates. `[UNVERIFIED]`
- [ ] Error 470 shows up only in legacy data; map it to 131047. HTTP status for 131060, 131062 and 131064. `[INFERRED]`
- [ ] Review the v27.0 WhatsApp changelog (the fetched copy's last entry was 2026-04-17). `[UNVERIFIED]`
- [ ] INR rate figures (₹0.8631 marketing, ₹0.1150 utility/auth, ex-GST) against Meta's CSV rate card. `[BSP]`

---

## 1. Meta prerequisites checklist

### 1.1 Business verification (DigiXoMedia, India)
- [ ] Meta Business portfolio for **DigiXoMedia** with legal name, address, phone, email and website that **exactly match** the documents `[META]`.
- [ ] Documents Meta accepts for India `[BSP]` (Wati list): business bank statement, business licence, certificate of incorporation, **GST registration certificate**, **PAN card**, **Shop & Establishment certificate**, **Udyog Aadhaar (UID)**, utility bill. Docs must be clear, in colour, complete, current and unmodified.
- [ ] **Udyam caveat:** Udyam (MSME) is *not* on the list. Udyog Aadhaar is its predecessor. BSPs report Udyam is accepted as a "business licence" `[UNVERIFIED]`. **Safest pair: GST certificate + utility bill or bank statement with the identical name and address.**
- [ ] Website on the **same domain as the business email** (e.g. `support@digixomedia.com`) `[BSP]`.
- [ ] Budget up to ~14 working days for the decision `[BSP/UNVERIFIED]`. Business Verification must be done **before** App Review `[META]`.

### 1.2 Meta app setup `[META]`
- [ ] App type **Business**, use case **"Connect on WhatsApp"**. Default permissions: `public_profile`, `whatsapp_business_management`, `whatsapp_business_messaging`.
- [ ] Skip `business_management` (needed only for credit-line sharing or programmatic portfolio access). Add `whatsapp_business_manage_events` only for MM API + Conversions API (it's auto-approved once Advanced messaging access exists).
- [ ] App icon (512–1024 px, <5 MB), **privacy policy URL**, **data deletion URL or callback**, app category.
- [ ] App Dashboard → Quickstart → **Become a Tech Provider**. Choose **Onboard without a partner**.
- [ ] Webhook callback URL and verify token (App Dashboard → WhatsApp → Configuration). Tick the fields in §5.1.
- [ ] FBL4B **configuration** (WhatsApp Embedded Signup variation). Pick products (MM API for WhatsApp; CTWA/CAPI optional) and record `config_id`.
- [ ] FBL4B client OAuth settings all set to **Yes**: Client OAuth login, Web OAuth login, Enforce HTTPS, Embedded Browser OAuth Login, Strict Mode for redirect URIs, Login with JS SDK. Add the prod host (app.leadbotcloud.com on Hostinger) and the dev tunnel host (dev-app.leadbotcloud.com) to **Allowed domains** and **Valid OAuth redirect URIs** `[META]`. Use fixed hostnames only (no random tunnel or preview URLs) `[INFERRED]`.
- [ ] Switch the app to **Live**. Some webhooks aren't sent in Dev mode `[META]`.
- [ ] Store `APP_ID`, `APP_SECRET`, `ES_CONFIG_ID`, `WEBHOOK_VERIFY_TOKEN` and `GRAPH_API_VERSION` in server-side env vars (worker VM + Hostinger web app; browser gets only `APP_ID` and `ES_CONFIG_ID`) `[INFERRED]`.

### 1.3 App Review `[META]`
| Permission | Written description | Screencast (one video per permission, screen recording only) |
|---|---|---|
| `whatsapp_business_messaging` | What messaging features tenants get and how they use them (campaigns, inbox replies) | LeadBotCloud UI sends a message → the recipient's WhatsApp shows it arriving |
| `whatsapp_business_management` | How you access onboarded tenants' assets (templates, numbers, profile, analytics) | LeadBotCloud UI creates a template (and ideally shows it in WhatsApp Manager) |
| `whatsapp_business_manage_events` | Only if MM API + CAPI | Auto-approved if Advanced `whatsapp_business_messaging` already exists |

- Request **Advanced access** for both core permissions. Without Advanced `whatsapp_business_management`, calls on tenant WABAs fail with **error 200**, and tenants can't grant it through ES.
- Drafts aren't reviewed. Don't request unused permissions. Have a working prototype. Turnaround is ~24 h. You can submit before ES is finished.
- **Access Verification** was retired around 2026-10-09 `[BSP/press]`. Still required: Business Verification, App Review, Platform Terms/Developer Policies, Data Use Checkup, Data Protection Assessment. Some dashboards may still show the AV step.
- ES capacity: **10 new customers per rolling 7 days** by default, then 200 after verification and review, then Meta Business Partner above that `[META]`. How the 200 tier is granted after AV's removal is `[UNVERIFIED]`. **Plan the launch cohort at ≤10 tenants per week until it's confirmed.**

### 1.4 Required public website pages (digixomedia.com / leadbotcloud domain)
| Page | Required by | Must contain |
|---|---|---|
| Privacy Policy | Meta app publish `[META]`; DPDP `[BSP]` | Data categories (contacts, messages, media), processor role (tenant = Data Fiduciary), Meta as sub-processor, retention, grievance officer contact |
| Data Deletion instructions / callback | Meta `[META]` | How a user or tenant requests deletion; URL or callback endpoint |
| Terms of Service | `[INFERRED]` (standard; Razorpay onboarding expects it) | Tenant responsibilities, Meta fees paid directly to Meta |
| Acceptable Use Policy | Commerce Policy risk (report) | Banned verticals (crypto, gambling, MLM, payday lending, adult, deceptive models, **resold or shared account credentials**), opt-in duty, consequences |
| Opt-in / messaging policy | Meta opt-in rules `[META]` (report) | Opt-in must name the business and state consent to receive its messages; opt-out always honoured |
| Refund & Cancellation, Pricing | Razorpay `[INFERRED]`; billing-complaint fixes (report) | One-tap in-app cancel, prorated refunds, GST invoices, "Meta charges billed by Meta" |
| Contact / About | Business verification match `[INFERRED]` | Legal name, registered address, phone, the same email domain |
| DPA (template) | DPDP `[BSP]` | Processor obligations, breach notice, 90-day request handling |

---

## 2. Tenant onboarding flow

### 2.1 Pre-flight (in LeadBotCloud, before Meta)
1. Signup (Better Auth) → create `tenants` row (`status=pending_meta`).
2. **AUP + vertical screening form**: business category, products, opt-in source. Hard-block banned verticals and send flagged ones to manual review (report).
3. Collect pre-fill data: legal name (≤100 characters; it also becomes the Messaging account name), email, website, address, `+91` phone, display name, category, description (≤512) `[META]`.
4. Show the **Meta checklist** screen: "You'll need a Facebook login, a phone number that **isn't** on WhatsApp (or choose 'Keep my WhatsApp Business app number'), and a debit or credit card for Meta's message fees."
5. Choose the path: **New API number** (standard) or **Keep my WhatsApp Business app number** (coexistence; show the §2.5 limits and require a checkbox).

### 2.2 Embedded Signup sequence `[META]` unless tagged

```
Browser (Next.js)                 API (server route / worker)             Meta Graph
-----------------                 -----------------------                ----------
1 create onboarding_session ----> INSERT onboarding_sessions(id, tenant_id, path, es_version)
2 FB.login(config_id, response_type:'code', override_default_response_type:true,
           extras:{setup:{...prefill}} [+ v4 coexist: featureType:'whatsapp_business_app_onboarding'])
3 window 'message' WA_EMBEDDED_SIGNUP {event,data} --POST /onboarding/:id/session-info--> store raw
4 FB.login callback → authResponse.code --POST /onboarding/:id/code (IMMEDIATELY; 30 s TTL)-->
5                                  GET /oauth/access_token?client_id&client_secret&code ------>
                                   <- {access_token: BUSINESS_TOKEN}
6                                  encrypt+store token; GET /debug_token (scopes, expiry)
7                                  POST /{WABA_ID}/subscribed_apps ----------------------------> {success:true}
8                                  GET /{WABA_ID}/phone_numbers?fields=... --------------------->
9  (standard only)                 POST /{PHONE_NUMBER_ID}/register {messaging_product,pin} ----> (≤14 days after ES)
9' (coexistence only)              GET /{PHONE_ID}?fields=is_on_biz_app,platform_type; POST smb_app_data x2 (≤24 h)
10                                 POST /{PHONE_NUMBER_ID}/whatsapp_business_profile (prefill)
11                                 GET /{WABA_ID}?fields=marketing_messages_lite_api_status[,disable_marketing_messages_on_cloud_api]
12 UI: "Add payment method in Meta" → business.facebook.com/wa/manage/home/ (tenant action)
13 UI: INR billing check (manual until §0.4 confirms a field)
14                                 seed Template Library utility templates (optional)
15                                 tenants.status = 'ready' when the §2.4 gates pass
```

**Step notes**
- **Step 2:** v4 `extras` holds only `setup` (prefill). Products are chosen in the FBL4B config, not in `extras`. There's no `sessionInfoVersion`. v5: `extras:{version:'v5', features:[…]}` `[UNVERIFIED shape]`.
- **Step 3:** check `event.origin.endsWith('facebook.com')`. Events: `FINISH`, `FINISH_ONLY_WABA`, `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`, `FINISH_GRANT_ONLY_API_ACCESS`, `CANCEL` (`data.current_step`), `ERROR` (`error_message`, `error_code`, `session_id`, `timestamp`). FINISH `data`: `phone_number_id`, `waba_id` (= **Messaging account ID**), `business_id`, plus optional `ad_account_ids`, `page_ids`, `dataset_ids`, `catalog_ids`, `instagram_account_ids` and `waba_ids` (multi). Persist all of it raw.
- **Step 3/4 race:** the session-info message and the code callback arrive independently. Correlate both through `onboarding_session_id` held in React state. The backend proceeds once both have arrived, or after 60 s with the code alone and then fetches IDs from the token `[INFERRED]`. The **code is returned only when the user clicks Finish**. Closing the popup on the last screen still counts as success.
- **Step 5:** server-side only. Never expose `APP_SECRET` to client code. A server-side route or the worker holding the secret does the exchange.
- **Step 6:** token lifetime has no documented expiry. It's reported as non-expiring `[UNVERIFIED]`. It's invalidated on app removal, access revocation or a system-user change. Run a daily `debug_token` cron and listen for `account_update` `PARTNER_REMOVED`.
- **Step 7:** errors 190/463 (token), 200/1349174 (no permission), 2 with `is_transient` (retry). Management limit: 200 req/h per app per WABA, rising to 5,000/h once a number is registered `[META]`.
- **Step 9:** generate a **random 6-digit PIN per number**, store it encrypted, and use it as the 2FA PIN. `/register` and `/deregister` are limited to **10 per number per 72 h**; error 133016 blocks for 72 h. The PIN is being phased out under the new account model, but `/register` still requires it `[META]`. `data_localization_region:"IN"` is optional and can only be changed by deregister + register. **Default: not set; tenant opt-in** `[INFERRED]`.
- **Step 11:** MM API is ready when the status is `ONBOARDED` (referenced in error 134102). Signals arrive as `account_update` `MM_LITE_TERMS_SIGNED` / `AD_ACCOUNT_LINKED`. Partner onboarding endpoint: `.../reference/business/whatsapp-business-partner-onboarding-to-mm-lite-api`; a duplicate invite returns 1752041 (no-op) `[META]`. The ES flow includes accepting the MM Lite terms.
- **Step 12:** business-initiated sends fail until a payment method exists. **Credit-line sharing isn't available to Tech Providers.** This is the expected #1 drop-off for micro-SMBs without an international-enabled card (report). Offer a "done-for-you" onboarding call.

### 2.3 What to store per onboarding
| Item | Table.column | Sensitivity |
|---|---|---|
| Raw session-info and ES errors | `onboarding_sessions.session_info jsonb`, `.es_error jsonb` | Low |
| `business_id` | `meta_business_portfolios.id` | Low |
| `waba_id` / Messaging account ID | `meta_accounts.messaging_account_id` | Low |
| Business token | `meta_accounts.business_token_enc` (AES-256-GCM, key from env `TOKEN_ENCRYPTION_KEY` on the VPS) `[INFERRED]` | **Secret** |
| Token scopes and expiry from `debug_token` | `meta_accounts.token_scopes jsonb`, `.token_checked_at` | Low |
| `phone_number_id`, display phone, verified name, `is_on_biz_app`, `platform_type` | `phone_numbers.*` | Low |
| 2FA PIN | `phone_numbers.pin_enc` | **Secret** |
| `waac_id` (when exposed in Phase 2) | `phone_numbers.waac_id` | Low |
| Coexistence sync `request_id`s | `phone_numbers.coex_sync jsonb` | Low |
| ES funnel step on cancel | `onboarding_sessions.cancel_step` | Analytics |

### 2.4 "Ready to send" gates (UI checklist; all must be green)
1. Token valid (`debug_token`) and `subscribed_apps` contains the app.
2. Phone `status` = `CONNECTED` `[META]`, `code_verification_status` = `VERIFIED`, `account_mode` = `LIVE`.
3. `name_status` ∈ {`APPROVED`, `AVAILABLE_WITHOUT_REVIEW`} (else error 131037).
4. Payment method confirmed: tenant self-attests plus a successful first template send `[UNVERIFIED API]`.
5. INR billing confirmed (manual until §0.4).
6. MM API `ONBOARDED`. If not, campaigns run with fallback, and the tenant is warned about the Apr 13 2027 rule for new accounts.

### 2.5 Coexistence (WhatsApp Business app number) `[META]` unless tagged
- v4: `extras.featureType:'whatsapp_business_app_onboarding'`. v5: on by default. Requires Business app **≥ 2.24.17**. The finish event is `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`.
- **Don't call `/register`.** Verify with `GET /{PHONE_ID}?fields=is_on_biz_app,platform_type` → `true` / `CLOUD_API`.
- Subscribe the extra fields `history`, `smb_app_state_sync`, `smb_message_echoes`.
- **Within 24 h**, call each once:
  - `POST /{PHONE_ID}/smb_app_data {"messaging_product":"whatsapp","sync_type":"smb_app_state_sync"}` → contacts.
  - Same call with `"sync_type":"history"` → up to 180 days in phases 0 (0–1 d), 1 (1–90 d), 2 (90–180 d), carrying `chunk_order` and `progress`. User declined → 2593109. Late request (>24 h) → 2593108. Limit exceeded → 2593107 (offboard and re-onboard).
- **Limits to show the tenant:** fixed **20 mps**; groups don't sync; disappearing messages, view-once and live location disabled; broadcast lists become read-only; no API calling, catalog/orders/status, labels, quick replies, away messages, business profile or channels; companion devices unlinked (Windows/WearOS unsupported); media history only for the 14 days after onboarding; first inbound message may come as 131060.
- Pricing: sends from the app stay free; API sends use Cloud API pricing.
- Offboarding: the user disconnects in the app. `/deregister` can't be used. Webhooks: `account_update` `PARTNER_REMOVED` (+`disconnection_info{reason,initiated_by}`), `ACCOUNT_OFFBOARDED`, `ACCOUNT_RECONNECTED`.
- Risk `[BSP]`: community reports of portfolio restrictions on coexistence portfolios. Watch `account_update` closely for these tenants.

### 2.6 Switching from another BSP (Interakt/Wati/AiSensy)
- Under the new account model, number migration isn't supported. The tenant **removes the old partner's app** from both its Messaging account and its WhatsApp account, then runs our ES and picks the existing portfolio, number and WAAC. A **new Messaging account** is created. Don't re-register `[META]`.
- Templates don't carry over. The Template Migration API copies only APPROVED + GREEN templates; it re-checks the category and resets quality to UNKNOWN. The endpoint is `[UNVERIFIED]`.

### 2.7 Phone number operations (post-onboarding) `[META]`
- Read: `GET /{WABA_ID}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,new_name_status,platform_type,throughput,status,last_onboarded_time,webhook_configuration,whatsapp_business_manager_messaging_limit,is_official_business_account,account_mode,is_on_biz_app`.
- Display name: `POST /{PNID} {"new_display_name":".."}`. The result arrives in `phone_number_name_update` (`decision`). **Re-register within 14 days** of approval. Max 10 changes per 30 days.
- Verify: `POST /{PNID}/request_code?code_method=SMS|VOICE&language=en_US` (136024 if already verified) → `POST /{PNID}/verify_code {"code":".."}`.
- 2FA: `POST /{PNID} {"pin":".."}`. It can't be disabled through the API.
- Number cap: 2 per portfolio, rising to 20 after verification or reaching the 2K tier (`business_capability_update`).
- OBA (blue tick): `POST /{PNID}/official_business_account {business_website_url, primary_country_of_operation, …}`. Status: `GET …?fields=oba_status,status_message`. Prerequisites `[UNVERIFIED]`. Later feature.

---

## 3. Data model (PostgreSQL, Drizzle)

Conventions: `uuid` PKs (`gen_random_uuid()`), `timestamptz` everywhere, Meta IDs stored as `text` (they exceed int64 in places and arrive as strings). Every tenant-owned table has `tenant_id uuid not null references tenants`. Enums are `text` + `CHECK`, or plain `text` for Meta enums, so a new Meta value never breaks inserts.

### 3.1 Tables

```sql
tenants(id, name, legal_name, gstin, status[pending_meta|onboarding|ready|suspended|offboarded],
        plan_id, razorpay_customer_id, razorpay_subscription_id, locale[en|hi|bn], timezone default 'Asia/Kolkata',
        aup_accepted_at, vertical, vertical_review_status, created_at)
tenant_members(tenant_id, user_id → auth.users, role[owner|admin|agent|viewer], PK(tenant_id,user_id))

onboarding_sessions(id, tenant_id, path[standard|coexistence], es_version, session_info jsonb, es_event,
        cancel_step, es_error jsonb, code_received_at, token_exchanged_at, completed_at)

meta_business_portfolios(id text PK /*business_id*/, tenant_id UNIQUE, name, verification_status, created_at)

meta_accounts(            -- one Messaging account (ex-WABA) per tenant at MVP
  id uuid PK, tenant_id, business_id → meta_business_portfolios,
  messaging_account_id text UNIQUE NOT NULL,   -- = WABA ID today; name per 2026-12-31 rename
  business_token_enc bytea, token_key_version int, token_scopes jsonb, token_status[valid|invalid|revoked], token_checked_at,
  subscribed_apps_ok bool, mm_api_status text /*marketing_messages_lite_api_status*/, mm_terms_signed_at, ad_account_linked bool,
  disable_marketing_on_cloud_api bool, billing_currency text /*UNVERIFIED source*/, inr_confirmed_at,
  payment_method_status[unknown|self_attested|confirmed|failing],
  template_limit int /*250|6000*/, insights_enabled bool, portfolio_messaging_limit text, max_phone_numbers int,
  health_state[ok|restricted|violation|disabled|scheduled_disable], restriction_info jsonb, ban_info jsonb,
  webhook_override_uri text, created_at, updated_at)

phone_numbers(            -- maps to future "WhatsApp account" (WAAC)
  id uuid PK, tenant_id, meta_account_id → meta_accounts,
  phone_number_id text UNIQUE NOT NULL, waac_id text UNIQUE NULL,  -- never assume waac_id = phone_number_id
  display_phone_number, verified_name, name_status, new_name_status, code_verification_status,
  status, platform_type, account_mode, is_on_biz_app bool, quality_rating, messaging_limit_tier,
  throughput_level text, send_rate_limit_mps int /*derived: 80→70, 1000→900, coex 20→16*/,
  pin_enc bytea, data_localization_region, oba_status, coex_sync jsonb,
  registered_at, register_attempts jsonb /*for 10/72h guard*/, last_synced_at)

contacts(
  id uuid PK, tenant_id,
  bsuid text NULL,                 -- user_id e.g. 'IN.xxxx'; portfolio-scoped
  parent_bsuid text NULL, previous_bsuids text[] default '{}',
  wa_id text NULL, phone_e164 text NULL, username text NULL, profile_name text,
  name, email, tags text[], attributes jsonb /*expiry_date, plan, etc.*/,
  marketing_opt_in bool default false, marketing_opt_out bool default false, opt_out_at, opt_out_source[user_preferences|stop_keyword|button|agent|import],
  reachability[ok|unreachable|unknown], unreachable_since, last_131026_at,
  freq_cap_hold_until timestamptz,   -- set +24h on 131049
  last_marketing_sent_at, last_inbound_at, erased_at, created_at, updated_at)
  -- unique: (tenant_id, bsuid) WHERE bsuid IS NOT NULL; (tenant_id, phone_e164) WHERE phone_e164 IS NOT NULL

contact_consent_events(   -- append-only; satisfies Meta opt-in + DPDP
  id, tenant_id, contact_id, action[opt_in|opt_out|resume|erase_request|export_request],
  category[marketing|utility|all], source[web_form|csv_import|whatsapp_button|keyword|ctwa|user_preferences|agent],
  notice_text text, notice_version, evidence jsonb /*ip, form url, file id, wamid*/, actor_user_id, occurred_at)

conversations(            -- one per (phone number, contact): inbox thread + window tracking
  id, tenant_id, phone_number_id → phone_numbers, contact_id,
  last_inbound_at, csw_expires_at /*last_inbound_at + 24h*/,
  fep_expires_at /*from statuses[].conversation.expiration_timestamp when present*/,
  ctwa_clid, referral jsonb, assigned_user_id, status[open|pending|closed], labels text[], unread_count,
  last_message_at, UNIQUE(phone_number_id, contact_id))

messages(
  id uuid PK, tenant_id, conversation_id, phone_number_id, contact_id, campaign_id NULL, campaign_recipient_id NULL,
  direction[in|out], wamid text UNIQUE NULL, client_ref text UNIQUE /*idempotency key*/,
  send_path[cloud_api|mm_api|mm_fallback], type, template_id NULL, payload jsonb, context_wamid,
  status[queued|sending|send_unknown|accepted|held|paused|sent|delivered|read|played|failed],
  status_rank smallint, error_code int, error_detail jsonb,
  pricing_category text, pricing_type text, billable bool, est_cost_paise int,
  sent_at, delivered_at, read_at, failed_at, created_at)

message_status_events(id, tenant_id, wamid, status, ts timestamptz, raw jsonb, webhook_event_id,
  UNIQUE(wamid, status))      -- dedupe key per Meta: (statuses[].id, status)

templates(
  id uuid PK, tenant_id, meta_account_id, meta_template_id text, name, language,
  category_requested, category_current, category_pending /*impending reclass*/, category_change_at,
  parameter_format[POSITIONAL|NAMED], components jsonb, status, reason, rejection_info jsonb,
  quality_score[GREEN|YELLOW|RED|UNKNOWN], paused_until, pause_count, library_template_name,
  edits_log jsonb /*1/24h, 10/30d guard*/, lint_report jsonb, ai_generated bool, created_at, updated_at,
  UNIQUE(meta_account_id, name, language))
template_events(id, tenant_id, template_id, field, event, payload jsonb, received_at)

media_assets(id, tenant_id, phone_number_id, storage_path /*storage abstraction: local disk or R2*/, mime, bytes, sha256,
  meta_media_id, meta_media_expires_at /*upload+29d*/, header_handle /*resumable upload h*/, direction[in|out], wamid)

campaigns(
  id, tenant_id, phone_number_id, template_id, name, segment_query jsonb, status[draft|scheduled|prechecking|running|paused|completed|cancelled],
  pause_reason, scheduled_at, started_at, completed_at, send_policy[mm_fallback|mm_strict|cloud_api],
  precheck_report jsonb, est_cost_paise bigint, spend_cap_paise bigint, counts jsonb /*queued,sent,delivered,read,failed,capped,skipped*/,
  created_by)

campaign_recipients(
  id, tenant_id, campaign_id, contact_id, render_params jsonb,
  state[pending|skipped|queued|sent|delivered|read|failed|capped|retry_wait],
  skip_reason[opt_out|no_opt_in|freq_hold|unreachable|duplicate|limit|invalid_number],
  attempt int, next_attempt_at, message_id, last_error_code, UNIQUE(campaign_id, contact_id))

webhook_events(           -- raw, append-only; Meta keeps no history
  id bigserial, received_at, signature_ok bool, body jsonb, body_sha256 text,
  waba_id text, phone_number_id text, field text, tenant_id NULL,
  dedupe_key text, processed_at, process_error text, attempts int)
  -- dedupe_key per change item: messages → 'm:'||messages[].id ; statuses → 's:'||id||':'||status ;
  --   template fields → field||':'||message_template_id||':'||event||':'||entry.time ; others → field||':'||body_sha256

rate_cards(id, country 'IN', category, currency 'INR', rate_paise_x100 int, effective_from date, source_url)
cost_ledger(id, tenant_id, phone_number_id, campaign_id NULL, message_id NULL,
  kind[estimate|webhook_actual|analytics_trueup|platform_fee], category, pricing_type, units int,
  amount_paise bigint, gst_paise bigint, period_date date, created_at)
meta_pricing_daily(tenant_id, phone_number_id, date, pricing_category, pricing_type, volume, cost, currency,
  PK(tenant_id, phone_number_id, date, pricing_category, pricing_type))   -- nightly pricing_analytics pull

audit_log(id bigserial, tenant_id NULL, actor_user_id NULL, actor_type[user|system|meta_webhook|agent],
  action, entity, entity_id, before jsonb, after jsonb, ip, created_at)
```

### 3.2 Key indexes
- `messages(wamid)` unique; `messages(client_ref)` unique; `messages(conversation_id, created_at desc)`; `messages(campaign_id, status)`.
- `contacts(tenant_id, bsuid)` partial unique; `contacts(tenant_id, phone_e164)` partial unique; `contacts USING gin(tags)`; `contacts(tenant_id, freq_cap_hold_until)`.
- `conversations(tenant_id, last_message_at desc)`; `conversations(phone_number_id, contact_id)` unique.
- `campaign_recipients(campaign_id, state)`; `campaign_recipients(next_attempt_at) WHERE state='retry_wait'`.
- `webhook_events(dedupe_key)` unique (insert `ON CONFLICT DO NOTHING`); `webhook_events(processed_at) WHERE processed_at IS NULL`. Partition monthly by `received_at` once volume grows `[INFERRED]`.
- `message_status_events(wamid, status)` unique.
- `templates(meta_account_id, meta_template_id)`; `phone_numbers(phone_number_id)` unique; `meta_accounts(messaging_account_id)` unique (webhook routing lookups; cache in Redis).

### 3.3 Row-level security
- Enable RLS **and `FORCE ROW LEVEL SECURITY`** on **every** tenant table. Policy: `tenant_id = current_setting('app.tenant_id', true)::uuid` (no Supabase `auth.uid()`; there is no Supabase). The data-access layer verifies membership in `tenant_members` server-side, then runs every tenant query inside a transaction that does `SET LOCAL app.tenant_id = ...` first (SET LOCAL only works inside a transaction). Role checks (`agent` can't edit templates or campaigns, `viewer` is read-only) are enforced server-side in the DAL; optional extra `FOR INSERT/UPDATE` policies may key on `current_setting('app.role', true)`.
- **DB roles:** `app` role (used by `DATABASE_URL`) is NOT the table owner and NOT a superuser (owners/superusers bypass RLS). Migrations run as a separate owner role. The worker / super-admin role (`DATABASE_URL_WORKER`) has `BYPASSRLS` and is never reachable from browser code; every super-admin read/write is written to `audit_log`.
- **Isolation tests run as the `app` role**, never as the owner/migration role (otherwise they pass falsely).
- Global (non-tenant) tables, e.g. Better Auth `user`/`session`/`account`/`verification`, are documented as global and never hold tenant data.
- `meta_accounts.business_token_enc` and `phone_numbers.pin_enc`: **never selectable by `authenticated`**. Put them in a separate `meta_secrets` table with no policies (service role only) or expose a view without them `[INFERRED]`.
- `webhook_events`, `rate_cards` and `audit_log` (write) are worker-role only (the `BYPASSRLS` DB role; "service-role" in this spec always means that role). The workers use `DATABASE_URL_WORKER`. Frontend reads go through RLS.
- `audit_log`: insert-only (no UPDATE/DELETE grants). Log token use, template submits, campaign start/pause, exports, erasures and member changes.
- DPDP erasure: anonymise the `contacts` PII columns, set `erased_at`, keep aggregate counts, and delete Storage media. Raw `webhook_events` that contain PII are purged at a retention cutoff (e.g. 90 days) `[INFERRED]`.

---

## 4. Sending

### 4.1 Base conventions `[META]`
- `POST https://graph.facebook.com/{GRAPH_API_VERSION}/{phone-number-id}/messages`, `Authorization: Bearer <tenant business token>`.
- Envelope: `{messaging_product:"whatsapp", recipient_type:"individual", to:"+91…" | recipient:"IN.xxxx", type, context?:{message_id}, biz_opaque_callback_data?, <type>:{…}}`. If both `to` and `recipient` are sent, `to` wins.
- Always use **E.164 with `+91`**. If the country code is missing, Meta prepends the *business* number's code. The CSV importer normalises `98xxxxxxxx`, `098…` and `+91 98…` → `+9198…`.
- Response: `{contacts:[{input, wa_id | user_id}], messages:[{id:"wamid…", message_status?:"accepted"|"held_for_quality_assessment"|"paused"}]}`. A 200 means **accepted only**; delivery comes through webhooks.
- TTL: 30 days by default, 10 min for auth templates. Delivery order isn't guaranteed; for strict sequences, wait for `delivered` first.
- Hosted `link` media is cached 10 min by Meta, so add a cache-buster query string. Prefer an uploaded `id`.
- `biz_opaque_callback_data`: set it to `msg:<messages.id>` so status webhooks can join even before the wamid is persisted. Accepted as a send field `[INFERRED]`; see §0.4.

### 4.2 Payloads by type (abbreviated)
| Type | Payload | Limits / notes |
|---|---|---|
| text | `text:{body, preview_url?}` | 4096 characters `[INFERRED]` |
| image | `image:{id|link, caption?}` | caption 1024; shape `[INFERRED]` |
| video | `video:{id, caption?}` | H.264 + AAC, one audio stream, `faststart` `[META]` |
| document | `document:{id, filename, caption?}` | caption 1024 `[META]` |
| audio | `audio:{id, voice?:true}` | voice: OGG/OPUS mono; play icon only if ≤512 KB `[META]` |
| sticker | `sticker:{id}` | webp; static 100 KB, animated 500 KB |
| reaction | `reaction:{message_id, emoji}` | target is a user msg ≤30 days old; only a `sent` status comes back; failure → 131009 |
| interactive button | `interactive:{type:"button", header?, body:{text≤1024}, footer?{≤60}, action:{buttons:[{type:"reply",reply:{id≤256,title≤20}}]≤3}}` | `[META]` |
| interactive list | `interactive:{type:"list", header?{text≤60}, body{≤4096}, action:{button≤20, sections[1–10]{title≤24, rows[{id≤200,title≤24,description≤72}]}}}` | ≤10 rows **in total** `[META]` |
| cta_url | `interactive:{type:"cta_url", header?, body, action:{name:"cta_url", parameters:{display_text≤20, url}}}` | `[META]` |
| location_request | `interactive:{type:"location_request_message", body, action:{name:"send_location"}}` | reply = `location` msg with `context.id` |
| template | `template:{name, language:{code}, components:[…]}` | see below |
| mark read | `{messaging_product, status:"read", message_id}` → `{success:true}` | ≤30 days; marks earlier messages read too |
| typing | the mark-read body + `typing_indicator:{type:"text"}` | dismissed on reply or after 25 s; send it only if a reply follows |

Template components at send time `[META]` unless tagged:
```json
{"type":"header","parameters":[{"type":"image","image":{"id":".."}}]}
{"type":"header","parameters":[{"type":"location","location":{"latitude":..,"longitude":..,"name":"..","address":".."}}]}
{"type":"body","parameters":[{"type":"text","parameter_name":"first_name","text":"Asha"}]}   // NAMED; omit parameter_name for POSITIONAL in {{n}} order
{"type":"button","sub_type":"url","index":"0","parameters":[{"type":"text","text":"abc%20123"}]}   // percent-encode
{"type":"button","sub_type":"copy_code","index":1,"parameters":[{"type":"coupon_code","coupon_code":"DIWALI50"}]}
{"type":"button","sub_type":"quick_reply","index":"2","parameters":[{"type":"payload","payload":"STOP:c_456"}]}   // [INFERRED]
// [INFERRED]: text/video/document header params; currency{fallback_value,code,amount_1000}; date_time{fallback_value}; flow action{flow_token}
```

### 4.3 Marketing Messages API routing `[META]`
- `POST /{phone-number-id}/marketing_messages`. Same syntax as `/messages`, plus `product_policy` (`CLOUD_API_FALLBACK` default | `STRICT`) and `message_activity_sharing` (bool, per-message override).
- **Marketing templates only.** Other types return 131055 or 134100. It's send-only; inbound still arrives through Cloud API webhooks.
- Status webhooks: MM API sends carry `pricing.category="marketing_lite"`; a fallback carries `marketing`. Record `send_path` from this.
- BSUID recipients work, but `bid_spec` + BSUID → 131062, and there's no delivery optimisation for BSUID sends.
- `disable_marketing_messages_on_cloud_api` (on `/{WABA_ID}`): when `true`, `/messages` rejects marketing with 131063 (affects only fully onboarded accounts).

**Router (`chooseEndpoint`)**
```
if msg.type == 'template' and template.category_current == 'MARKETING':
    endpoint = /marketing_messages
    product_policy = campaign.send_policy == 'mm_strict' ? 'STRICT' : 'CLOUD_API_FALLBACK'
    if now >= 2027-10-13: product_policy = 'STRICT'                 // config flag, not literal
else:
    endpoint = /messages
on 131063 from /messages  -> re-route to /marketing_messages (template was reclassified) and resync template
on 131055/134100 from MM  -> re-route to /messages (template no longer marketing) and resync template
on 134101                  -> retry after 10 min (ad sync)
```

### 4.4 Rate limits the queue must respect `[META]`
| Limit | Value | Scope | Signal |
|---|---|---|---|
| Throughput | 80 mps default (inbound + outbound together); auto 1,000 mps; **coexistence fixed 20 mps** | per phone number | 130429; read `GET /{PNID}?fields=throughput` |
| Upgrade blip | ≤1 min unusable during the 80→1000 upgrade | per number | 131057 |
| Pair rate | ~1 msg / 6 s per business number → user; bursts up to 45 in 6 s borrow quota | per (number, recipient) | 131056, retry after 4^X s |
| Messaging limit | unique users **outside the CSW** per moving 24 h: 250 → 2K → 10K → 100K → unlimited | **per portfolio** (shared by all numbers) | `whatsapp_business_manager_messaging_limit`; `business_capability_update` |
| Per-user marketing cap | dynamic, unpublished, across all businesses | per end user | 131049 (not charged) |
| Spam limit | low quality | per number | 131048 |
| Management API | 200/h per app per WABA (5,000/h active) | per WABA | 80007, 4 |
| Template creation | 100/h per WABA | per WABA | — |

### 4.5 Queue design (Node.js workers + Redis/BullMQ on the VPS) `[INFERRED]` design on `[META]` limits
**Queues**
- `wa:send:{phone_number_id}`: one BullMQ queue per tenant number. The queue `limiter` is `{max: send_rate_limit_mps, duration: 1000}`, where `send_rate_limit_mps` = 90% of throughput (70 / 900 / 16 for coexistence). Workers are created dynamically when a number becomes `ready`. At MVP scale (dozens of numbers) this is simpler than a shared limiter. Above a few hundred numbers, switch to one shared queue + a Redis Lua token bucket per number (or BullMQ Pro groups).
- `wa:campaign-expand`: turns a campaign into recipient jobs in chunks of 1,000 (precheck → `campaign_recipients` rows → enqueue).
- `wa:webhook`: processes `webhook_events` ids (§5).
- `wa:sync`: template, phone and profile syncs; nightly analytics; daily `debug_token`. Throttled to stay under 200/h per WABA.
- `wa:dlq`: terminal failures needing a human (unknown codes, repeated 131000, payload bugs).

**Send job** `{message_id, tenant_id, phone_number_id, campaign_recipient_id?, attempt}`, with `jobId = message_id` (BullMQ dedupes on jobId).
1. Load `messages` row. If `wamid` is not null or `status ∉ {queued, retry_wait}` → **ack and skip** (idempotency).
2. **Pair guard:** Redis key `pair:{pnid}:{recipient}` holds `next_allowed_ms`. If it's in the future → `moveToDelayed(next_allowed_ms)`. After a send, set it to `now + 6000`. Campaigns rarely hit this; bots and inbox automations can.
3. **Live re-check** (cheap, from cache): tenant not suspended; number `CONNECTED`; template not PAUSED/DISABLED; contact not opted out (marketing); `freq_cap_hold_until < now`; and for non-templates, `csw_expires_at > now`.
4. Set `status='sending'` → POST → on 200 store `wamid`, `message_status`, `send_path` (provisional; corrected by `pricing.category`) → `status='accepted'|'held'|'paused'`.
5. On a Graph error → classify with `errorPolicy(code)` (§6) → `retry` (delayed job with backoff), `reroute`, `hold_contact`, `pause_campaign`, `pause_tenant`, or `fail` (terminal; update recipient and DLQ if it's an unknown code).
6. **Network timeout or 5xx with no body** (the message may have been accepted): set `send_unknown` and wait up to 10 min for a status webhook carrying `biz_opaque_callback_data=msg:<id>`. If none arrives, retry once. Never blindly re-send marketing, because duplicates hurt quality.

**Backoff by error class**
| Class | Codes | Delay |
|---|---|---|
| throughput | 130429, 4, 80007 | 1 s × 2^attempt + jitter, max 60 s; also cut that number's limiter by 20% for 60 s |
| pair | 131056 | 4^attempt s (1, 4, 16, 64, 256), then fail |
| maintenance | 131057, 2494100, 133004 | 30 s, 60 s, 120 s |
| transient | 1 (once), 2, 131000, 131016, Graph `is_transient:true` | 5 s × 3^attempt, max 5 attempts → DLQ |
| freq cap | 131049 | no job retry; set `contacts.freq_cap_hold_until = now+24h`; recipient → `capped`; optional "retry capped" action ≥24 h later (manual or campaign setting) |
| MM ad sync | 134101 | 10 min, max 3 |
| template paused | 132015 | pause the campaign; resume on APPROVED/UNPAUSE webhook |
| limit 131064 | 131064 | pause tenant marketing; auto-resume probe every 6 h `[INFERRED]` |

### 4.6 Campaign pipeline
1. **Draft:** template (APPROVED only), segment, schedule, `send_policy`, spend cap.
2. **Precheck (`wa:campaign-expand` stage 1)** writes `campaigns.precheck_report` and blocks or warns before the "Send" button is enabled:
   | Check | Rule | Severity |
   |---|---|---|
   | Template status | `status='APPROVED'` and not paused; quality ≠ RED | block |
   | Template category | show `category_current` (price). If a `category_pending` reclass is due before the send time → warn | warn |
   | Opt-in | marketing: require `marketing_opt_in` and no `marketing_opt_out`; utility: require opt-in (any) | exclude + count |
   | 131049 guard | exclude `freq_cap_hold_until > now`. Warn when >30% of the audience got marketing in the last 24–72 h (`last_marketing_sent_at`) | exclude / warn |
   | Unreachable | exclude `reachability='unreachable'` within the last 7 days `[INFERRED]` | exclude |
   | Messaging limit | count recipients **without** an open CSW; compare to the portfolio tier minus users already reached in the last 24 h (Redis HyperLogLog `uniq:{portfolio}:{hour}` over 24 buckets `[INFERRED]`). If over → offer split scheduling | block or split |
   | Number health | `quality_rating` ≠ RED; `meta_accounts.health_state='ok'`; no 131048 in the last 24 h | block |
   | Tenant readiness | §2.4 gates; MM API status (warn if not ONBOARDED) | block / warn |
   | Duplicates | dedupe on contact id and phone | exclude |
   | Cost preview | `billable_count × rate_cards[category] (+18% GST)`, e.g. "₹0.8631 × 1,240 = ₹1,070.24 + GST ₹192.64". State that some messages may be **capped by Meta (not charged)**. Rates are `[BSP]` until Meta's CSV is checked | display |
   | Spend cap | `est_cost ≤ spend_cap` | block |
   | Window | for non-template campaigns (not allowed outside the CSW) → block; MVP campaigns are template-only | block |
3. **Expand:** insert `campaign_recipients` (+ skipped rows with `skip_reason`), create `messages` rows (`client_ref = campaign_recipient.id`), enqueue in chunks.
4. **Run:** workers send. Counters update from status webhooks (Redis counters + periodic flush to `campaigns.counts`).
5. **Auto-pause triggers:** template `PAUSED`/`DISABLED`/`FLAGGED` or quality RED; `account_update` `ACCOUNT_RESTRICTION`/`DISABLED_UPDATE`; 131048; 131042 (payment); 368; 131064; token invalid (190/0). Resume needs a webhook back to normal or a manual resume after a recheck.
6. **Complete:** when all recipients are terminal (or 24 h after the last send for status settling). Report: sent, delivered, read, failed by plain reason, **capped by Meta**, skipped by reason, est vs actual cost.
7. **Fallbacks for capped/undelivered (renewal use case):** export a call list; a "nudge reply" utility follow-up isn't allowed for promotions, so use SMS or a manual list. The in-CSW free-form message goes only after the customer replies.

### 4.7 Renewal / expiry engine (DiGiXO-style tenants)
- `contacts.attributes.expiry_date` + plan. Scheduler creates marketing reminders at T-7, T-3 and T-0 (configurable) as **MARKETING** templates with a Razorpay/Cashfree payment link in a URL button.
- Payment webhook (tenant's gateway → LeadBotCloud endpoint) → mark renewed → cancel pending reminders → send a **UTILITY** "payment received / access details" template (or a free-form message if the CSW is open).
- Respect the 131049 hold and opt-outs. Show the reminder cost (~₹1.02 incl. GST each `[BSP]`) in the sequence editor.

---

## 5. Webhooks

### 5.1 Subscriptions
- App-level fields (App Dashboard): `messages`, `message_template_status_update`, `template_category_update`, `message_template_quality_update`, `message_template_components_update`, `phone_number_quality_update`, `phone_number_name_update`, `account_update`, `account_review_update`, `account_alerts`, `business_capability_update`, `user_preferences`, plus `smb_message_echoes`, `smb_app_state_sync`, `history` for coexistence `[META]` list.
- Per tenant: `POST /{WABA_ID}/subscribed_apps` (§2.2 step 7). Verify with `GET` (`data[].whatsapp_business_api_data`), re-check daily in the token cron.
- Phase 2 (H1 2027): add the `whatsapp_account` topic when it ships `[META]`.

### 5.2 Receiver (Node.js worker on the VPS behind Caddy, HTTPS with a CA-signed certificate; self-signed is rejected) `[META]`
```
GET  /webhooks/meta   → if hub.mode=='subscribe' && hub.verify_token==ENV → 200 text(hub.challenge) else 403
POST /webhooks/meta   (express.raw({type:'application/json', limit:'4mb'}))
  1. sig = header 'X-Hub-Signature-256' ('sha256=<hex>'); expected = HMAC_SHA256(APP_SECRET, rawBody)
     timingSafeEqual → on mismatch: 401, log, store signature_ok=false (no processing)
  2. body = JSON.parse(rawBody)
  3. for entry in body.entry, for change in entry.changes, explode items (messages[], statuses[], or whole value)
       INSERT webhook_events(... dedupe_key ...) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id
  4. enqueue ids to wa:webhook (BullMQ); 5. return 200 — target p50 ≤250 ms, p99 <1 s
  If Postgres is down: XADD to Redis stream 'wh:spool' and return 200; drain later. If both are down: return 500 (Meta retries for 7 days).
```
- Hash the **raw bytes** before parsing; Meta escapes unicode, so re-serialised JSON won't match `[INFERRED]`.
- Payloads up to 3 MB, ≤1,000 updates per POST, and batching isn't guaranteed. Loop over `entry[]` → `changes[]` → `messages[]`/`statuses[]` `[META]`.
- Retries: start immediately, back off, and continue for **7 days**, then the event is dropped. There's no history API, so persist first `[META]`.
- Prefer **mTLS** (configured per app) over IP allowlists; Meta IPs change `[META]`.
- Capacity: plan for **3× outbound rate (statuses) + 1× inbound** `[META]`.
- Run the receiver as a stateless process separate from the send workers (PM2 cluster or two systemd units) so send backlogs can't slow down acks `[INFERRED]`.

### 5.3 Multi-tenant routing
1. `entry[].id` = WABA / Messaging account ID → `meta_accounts.messaging_account_id` → `tenant_id` (Redis cache, 10 min TTL).
2. For `messages`: also check that `value.metadata.phone_number_id` belongs to that tenant. On a mismatch → quarantine (`process_error='routing_mismatch'`).
3. Unknown WABA (e.g. a tenant mid-onboarding, or an offboarded one) → keep the row unprocessed with `tenant_id=null` and re-route after onboarding completes. Purge after 30 days.
4. Template and account webhooks always reach the app default URL (not overridable), so route them by `entry.id` only.

### 5.4 Processing rules
- **Idempotent handlers.** The dedupe key blocks exact replays; handlers must also be safe to run twice (upserts, monotonic updates).
- **Ordering:** not guaranteed. Status rank `accepted 0 < sent 1 < delivered 2 < read 3 < played 4`. `failed` is terminal and overrides lower ranks. Never downgrade (`UPDATE … WHERE status_rank < $new`). `read` without `delivered` → set `delivered_at = read_at` when it's null.
- **Status before wamid:** if `statuses[].id` isn't found, try `biz_opaque_callback_data` (`msg:<uuid>`). If that fails too, re-enqueue with a delay (5 s, 30 s, 2 min) up to 5 times, then mark it orphaned.
- Timestamps are **Unix-seconds strings** → `to_timestamp(int)`.
- Never assume `wa_id`/`from` exist; use `user_id`/`from_user_id` (BSUID).

### 5.5 Handler per event
| Field / item | Key payload fields | Update |
|---|---|---|
| `messages` → `messages[]` (inbound) | `from`, `from_user_id`, `id`, `timestamp`, `type`, `context{from,id}`, `contacts[].profile{name,username}`, `contacts[].wa_id`, `user_id` | Upsert contact (match order: bsuid → wa_id/phone; merge if both match different rows) → upsert conversation (`last_inbound_at`, `csw_expires_at=ts+24h`, unread++) → insert `messages(direction=in)` → media: `GET /{media-id}` (or the `url` field, rolling out since 2025-11-12) → download within 5 min of URL issue → our storage (inbound IDs last 7 days) → realtime push to inbox |
| inbound `text` | `text.body` | STOP keyword detection (`STOP`, `UNSUBSCRIBE`, `band karo` `[INFERRED]` list, configurable) → opt-out + consent event + auto-confirm reply (free-form; CSW is open) |
| inbound `button` | `button{payload,text}`, `context.id` | Map `context.id` → campaign; payload `STOP:*` → opt-out; others → automation triggers |
| inbound `interactive` | `button_reply{id,title}` / `list_reply{id,title,description}`; `nfm_reply` `[UNVERIFIED]` | Automation / bot routing |
| inbound `referral` (CTWA) | `source_id`, `source_type`, `ctwa_clid` (absent for Status ads), `headline`, `welcome_message` | Store on conversation; tag the contact source `ctwa`; FEP window from statuses |
| inbound `contacts` | `origin: contact_request` → phone shared via `REQUEST_CONTACT_INFO` | Attach the phone to the BSUID contact |
| inbound `location` | lat/long/name/address | Store; resolve the `location_request` context |
| inbound `system` | `user_changed_number` / `user_changed_user_id` with `user_id`, `previous_user_id` | Push the old BSUID to `previous_bsuids`, set the new one, audit |
| inbound `unsupported` | `unsupported.type`, `errors[131051]`; 131060 on first coexistence message | Show "Message type not supported (e.g. edit/poll)" in inbox |
| `messages` → `statuses[]` | `id`, `status`, `timestamp`, `recipient_id`, `recipient_user_id`, `biz_opaque_callback_data`, `conversation{id,expiration_timestamp,origin}` (v24+: only inside FEP), `pricing{pricing_model:PMP,type,category,subtype}`, `errors[]` | Insert `message_status_events` (dedupe) → monotonic `messages` update → `campaign_recipients.state` → pricing: write on **first** occurrence (sent *or* delivered/read, never both): `pricing_category`, `pricing_type`, `billable = (type=='regular')` (don't use deprecated `billable`), `cost_ledger(kind=webhook_actual)` using the rate card; `category=='marketing_lite'` → `send_path=mm_api` else if marketing → `mm_fallback`/`cloud_api` → `conversation.expiration_timestamp` → `conversations.fep_expires_at` → `failed` → `errorPolicy(errors[0].code)` (131049 hold, 131050 opt-out, 131026 unreachable…) |
| `messages` → `value.errors[]` | system/app-level errors | Log, alert ops, attach to tenant health |
| `message_template_status_update` | `event`, `message_template_id`, `name`, `language`, `reason`, `message_template_category`, `other_info{title}`, `rejection_info{reason,recommendation}`, `disable_info` | Update `templates.status/reason/rejection_info`; PAUSED → `paused_until` (3 h first, 6 h second), pause campaigns; DISABLED → mark terminal and suggest a new template; APPROVED/REINSTATED/UNPAUSE → resume paused campaigns; REJECTED → plain-language explanation (§7.6) + notify |
| `template_category_update` | **Impending:** `new_category` (= CURRENT), `correct_category`, `category_update_timestamp` · **Completed:** `previous_category`, `new_category` | Branch on field presence (`previous_category` present → completed). Impending → `category_pending`, `category_change_at`, warn about price change and endpoint routing. Completed → `category_current=new_category`, clear pending, re-price scheduled campaigns |
| `message_template_quality_update` | `previous_quality_score`, `new_quality_score`, `message_template_id` | Update `quality_score`; RED → auto-pause campaigns using it `[INFERRED]` |
| `message_template_components_update` | payload `[UNVERIFIED]` | Trigger template resync `GET /{TEMPLATE_ID}` |
| `phone_number_quality_update` | `display_phone_number`, `event` (ONBOARDING, THROUGHPUT_UPGRADE, others `[UNVERIFIED]`), `max_daily_conversations_per_business` | Update `messaging_limit_tier`; THROUGHPUT_UPGRADE → re-read `throughput`, raise the limiter; unknown event → resync the phone via GET |
| `phone_number_name_update` | `decision` APPROVED/REJECTED | Update `name_status`; APPROVED → prompt re-register within 14 days (auto-call `/register` with the stored PIN) |
| `account_update` | `event` + `waba_info`, `restriction_info[]`, `violation_info`, `ban_info{waba_ban_state,waba_ban_date}`, `disconnection_info`, `country`, `volume_tier_info` | PARTNER_ADDED/PARTNER_APP_INSTALLED → provisioned. PARTNER_APP_UNINSTALLED/PARTNER_REMOVED → token revoked, tenant `offboarded`, stop queues. ACCOUNT_RESTRICTION/ACCOUNT_VIOLATION/DISABLED_UPDATE → `health_state`, pause all campaigns, alert. MM_LITE_TERMS_SIGNED/AD_ACCOUNT_LINKED → refresh `mm_api_status`. ACCOUNT_OFFBOARDED/RECONNECTED (coexistence). BUSINESS_PRIMARY_LOCATION_COUNTRY_UPDATE → store. ACCOUNT_DELETED → offboard |
| `business_capability_update` | `max_daily_conversations_per_business` (tier string **or** integer), `max_phone_numbers_per_business`/`_per_waba` | Update `portfolio_messaging_limit`, `max_phone_numbers`. Parse both forms |
| `user_preferences` | `user_preferences[]{wa_id?, user_id, category:"marketing_messages", value: stop|resume, timestamp}` | stop → `marketing_opt_out=true` + consent event (source `user_preferences`); resume → clear the opt-out flag **only** if a prior opt-in exists. Key on `user_id` |
| `account_alerts` | e.g. `INCREASED_CAPABILITIES_ELIGIBILITY_*`; payload `[UNVERIFIED]` | Store + surface in the health panel |
| `account_review_update` | `[UNVERIFIED]` | Store + notify |
| `smb_message_echoes` / `smb_app_state_sync` / `history` | `[UNVERIFIED]` shapes; history has phases, `chunk_order`, `progress` | Coexistence: insert app-sent messages as outbound (`send_path=biz_app`), contact sync, history import job |

---

## 6. Error handling

`errorPolicy(code, error_data)` lives in `packages/meta (errors in packages/shared/errors)`. Branch on `code` (and `error_data.details`), **not** the title or HTTP status `[META]`. Errors arrive synchronously (`{error:{message,type,code,error_subcode,fbtrace_id,is_transient,error_data}}`) or in `statuses[].errors[]`. Unknown code → DLQ + generic message.

Retry: **R** retry with backoff · **R-d** retry after a stated delay · **N** don't retry · **N-u** never auto-retry for this user. ★ = top 10 with Hinglish.

| Code | Meaning | Retry | System action | SMB message (English) |
|---|---|---|---|---|
| 0 / 190 ★ | Token expired or invalid | N | `token_status=invalid`, pause all, ask to reconnect | "Your WhatsApp connection expired. Tap Reconnect to continue." |
| 3 / 10 / 200–299 / 131005 | Permission missing or not eligible | N | Re-run ES with scopes; alert ops | "We don't have permission for this action. Please reconnect WhatsApp." |
| 368 ★ | Account restricted or disabled for policy | N | `health_state=restricted`, stop all sends, show the appeal guide | "Meta has restricted your WhatsApp account for a policy issue. Sending is paused." |
| 130497 | Can't message users in this country | N | Block the country for the tenant | "Meta doesn't allow messages to this country from your account." |
| 131031 | Account locked | N | Pause; support ticket | "Your WhatsApp account is locked by Meta. Contact support." |
| 4 / 80007 | App or WABA API rate limit | R | Backoff; throttle sync jobs | (hidden) "Busy, retrying automatically." |
| 130429 | Throughput exceeded | R | Requeue; reduce the limiter | (hidden) |
| 131048 ★ | Spam rate limit (low quality) | N until recovery | Pause campaigns 24 h; show quality tips | "Too many people blocked or reported recent messages. Sending is paused to protect your number." |
| 131056 | Pair rate limit | R-d 4^X s | Delay this recipient only | (hidden) |
| 133016 | Register/deregister attempts exceeded | R-d 72 h | Block register actions | "Too many setup attempts. Try again in 3 days." |
| 1 | Invalid request or server error | R once | Then DLQ | "Something went wrong. We're retrying." |
| 2 / 131016 / 131000 | Temporary or unknown error | R | Backoff, max 5 → DLQ | "WhatsApp is temporarily unavailable. We'll retry." |
| 33 | Business number deleted | N | Disable the number | "This WhatsApp number was removed from your account." |
| 100 / 131008 / 131009 | Bad or missing parameter | N | DLQ (bug) | "This message couldn't be sent because of a setup error. Our team is notified." |
| 130472 | User is in a Meta experiment | N | Skip | "Meta didn't deliver this to the customer (Meta test group). Not charged." `[INFERRED charge]` |
| 131021 | Sender = recipient | N | Skip | "You can't message your own business number." |
| 131026 ★ | Undeliverable (not on WhatsApp, old app, terms not accepted) | N (re-check after days) | `reachability=unreachable` | "This customer can't receive WhatsApp messages right now." |
| 131037 | No approved display name | N | Block sends, link to display-name flow | "Your business name isn't approved yet." |
| 131042 ★ | Payment/billing problem | N | Pause all billable sends; payment banner | "Meta couldn't charge your card. Update your payment method in Meta to continue." |
| 131045 | Number not registered | N | Auto `/register` with the stored PIN | "Your number setup is incomplete. Fixing…" |
| 131047 ★ | Outside the 24 h window | N (switch type) | Suggest a template | "It's been over 24 hours since this customer messaged. Use an approved template." |
| 131049 ★ | Meta per-user marketing limit | R-d ≥24 h | Contact hold 24 h; state `capped` | "Meta limited marketing messages to this customer today. Not charged. Try after 24 hours." |
| 131050 ★ | User stopped marketing | N-u | Opt-out + suppress | "This customer turned off your promotional messages." |
| 131051 | Unsupported message type | N | Fix | "This message type isn't supported." |
| 131052 | Couldn't download the user's media | N | Ask the user to resend | "Couldn't load the customer's file. Ask them to send it again." |
| 131053 | Media upload failed (MIME/size) | N | Validate before upload | "This file type or size isn't allowed." |
| 131055 / 134100 | Non-marketing on MM API | N (reroute) | Reroute to `/messages`, resync the template | (hidden) |
| 131057 | Maintenance (throughput upgrade) | R | 30–120 s backoff | (hidden) |
| 131060 | First coexistence message unavailable | n/a | Info row | "A message from this customer couldn't be shown." |
| 131062 | BSUID recipient not supported | N | Resend to the phone if known | "This message needs the customer's phone number." |
| 131063 | Marketing disabled on Cloud API | N (reroute) | Route via MM API | (hidden) |
| 131064 | Limit exceeded (template category violations) | R-d auto-lift | Pause tenant marketing; show category guidance | "Meta temporarily limited your messages because templates were in the wrong category." |
| 132000 / 132005 / 132012 / 132018 | Template parameter mismatch | N | Block campaign; show the field | "The message details don't match the template. Check the variables." |
| 132001 ★ | Template missing or not approved in this language | N | Resync templates | "This template isn't approved in this language yet." |
| 132007 | Template violates policy | N | Edit | "This template breaks WhatsApp rules. Please edit it." |
| 132015 | Template paused (low quality) | N until unpaused | Pause campaign; auto-resume | "This template is paused by Meta for low quality. It resumes automatically." |
| 132016 | Template disabled | N | Suggest a new template | "This template was disabled by Meta. Create a new one." |
| 132068 / 132069 | Flow blocked or throttled | N / R-d | Fix the Flow | "This form can't be sent right now." |
| 2388019 | Template limit reached | N | Suggest deleting unused templates | "You've reached Meta's template limit. Delete unused ones." |
| 2388024 (with 100) | Duplicate name + language | N | Rename | "A template with this name already exists." |
| 134101 | MM API ad sync pending | R-d 10 min | Retry | (hidden) |
| 134102 | MM API ad sync failed or ineligible | N | Check MM status; fallback | "Marketing setup isn't finished on Meta." |
| 1752041 | MM onboarding duplicate | n/a | No-op | — |
| 133000/133005/133006/133008/133009/133010/133015 | Registration and PIN issues | per code (133008/9/15 R-d) | Registration wizard | "Number setup needs attention." |
| 2593107/2593108/2593109 | Coexistence sync limit / late / declined | N | Offboard and re-onboard, or skip history | "Chat history import didn't complete." |
| 470 | Legacy re-engagement | → treat as 131047 `[INFERRED]` | — | — |

**Hinglish (top 10, for UI toggle `hi-Latn`)** `[INFERRED copy]`
| Code | Hinglish |
|---|---|
| 190 | "Aapka WhatsApp connection expire ho gaya. Reconnect dabaiye." |
| 368 | "Meta ne policy issue ki wajah se aapka account restrict kiya hai. Sending ruk gayi hai." |
| 131048 | "Bahut logon ne recent messages block/report kiye. Number bachane ke liye sending ruki hai." |
| 131026 | "Ye customer abhi WhatsApp message receive nahi kar sakta." |
| 131042 | "Meta aapka card charge nahi kar paya. Meta mein payment method update kariye." |
| 131047 | "Customer ke last message ko 24 ghante se zyada ho gaye. Approved template bhejiye." |
| 131049 | "Meta ne aaj is customer ke marketing messages limit kiye. Charge nahi laga. 24 ghante baad try kariye." |
| 131050 | "Is customer ne aapke promotional messages band kar diye hain." |
| 132001 | "Ye template is language mein abhi approved nahi hai." |
| 132015 | "Low quality ki wajah se Meta ne ye template pause kiya hai. Apne aap resume hoga." |

---

## 7. Templates

### 7.1 Create / manage API `[META]`
- **Create:** `POST /{WABA_ID}/message_templates {name, language, category, parameter_format?: POSITIONAL|NAMED, components[]}` → `{id, status: PENDING|APPROVED|REJECTED, category}`. **Store the returned `category`** as `category_current`; it may differ from the request.
- **List:** `GET /{WABA_ID}/message_templates?fields=name,status,category,language,components,quality_score&status=APPROVED&limit=100` (cursor paging). Quality: `GET /{TEMPLATE_ID}?fields=quality_score` → `{score, date}`. `rejected_reason` as a GET field is `[UNVERIFIED]`; rely on the webhook.
- **Edit:** `POST /{TEMPLATE_ID}` (components, category, TTL). Only APPROVED, REJECTED or PAUSED templates. The category of an approved template can't change. **Approved: 1 edit per 24 h, 10 per 30 days** (enforce through `edits_log`). An edit replaces all components and re-reviews.
- **Delete:** `DELETE /{WABA_ID}/message_templates?name=X` (all languages) | `?hsm_id=ID&name=X` | `?hsm_ids=[…]` (≤100, all-or-nothing). The name can't be reused for **30 days**. DISABLED templates can't be deleted. Undelivered messages go to PENDING_DELETION for 30 days.
- **Unpause:** `POST /{TEMPLATE_ID}/unpause` (needed for pacing pauses).
- **Auto-archive** after 12 months inactive, deleted 28 days later unless unarchived (API `[UNVERIFIED]`). Warn at month 11.
- **Limits:** 250 templates per WABA if unverified; 6,000 if verified with an approved display name. 100 creations per hour. Name `^[a-z0-9_]+$` ≤512. Duplicate name + language → 100/2388024.
- **Sync job:** every 6 h + on webhook, `GET` list → upsert `templates` (status, category, quality).

### 7.2 Components `[META]`
```json
{"type":"HEADER","format":"TEXT","text":"Hi {{1}}","example":{"header_text":["Asha"]}}          // ≤60, 1 var
{"type":"HEADER","format":"IMAGE|VIDEO|DOCUMENT","example":{"header_handle":["4::aW..."]}}      // handle via Resumable Upload (§8.1); LOCATION also allowed; GIF for MM API
{"type":"BODY","text":"Order {{1}} ships {{2}}","example":{"body_text":[["#123","today"]]}}     // ≤1024; NAMED: {{first_name}} + example.body_text_named_params[{param_name,example}]
{"type":"FOOTER","text":"Reply STOP to opt out"}                                                 // ≤60
{"type":"BUTTONS","buttons":[{"type":"QUICK_REPLY","text":"Stop promos"},
  {"type":"URL","text":"Pay now","url":"https://rzp.io/l/{{1}}","example":["abc123"]},
  {"type":"PHONE_NUMBER","text":"Call us","phone_number":"919xxxxxxxxx"},
  {"type":"COPY_CODE","example":"DIWALI50"},{"type":"VOICE_CALL","text":"Call"}]}
```
- Buttons: ≤10 in total; quick replies grouped together; ≤2 URL (≤2000 characters, one suffix var); 1 phone (≤20); 1 copy-code (≤15); labels ≤25. With 4+ buttons, or quick replies mixed with other types, the template doesn't render on desktop. With >3 buttons, only 2 show plus "See all options".
- Other types: OTP (auth), FLOW, CATALOG, MPM (≤30 products / 10 sections), SPM. Detailed specs `[UNVERIFIED]`.
- **Carousel** (marketing): top-level body + `{"type":"carousel","cards":[…]}` with 2–10 cards; each card has an image/video header, an optional body ≤160 (all cards or none), and ≤2 buttons in the same order on every card. The card count is fixed after approval.
- **Limited-time offer** (marketing): image/video header, no footer, body ≤600, `limited_time_offer{text≤16, has_expiration}`, copy_code + URL (URL index 1). Send-time `expiration_time_ms` `[UNVERIFIED semantics]`. Not supported on web or desktop.
- **Template Library:** `GET /message_template_library?search=&topic=&usecase=&industry=&language=`. Create with `{name, category:"UTILITY", language, library_template_name, library_template_button_inputs:[…]}`. It's effectively pre-approved, and the wording is fixed. Use it for one-click utility templates during onboarding.

### 7.3 Categories and reclassification `[META]`
- `MARKETING`, `UTILITY`, `AUTHENTICATION`. Meta checks the category at review; since 2025-04-09 a misfiled UTILITY template is **approved as MARKETING**.
- Approved templates get recategorised on the 1st of the next month, with 24 h notice through `template_category_update`. Businesses with warnings (since 2025-04-16) get **no notice**. A misclassified AUTHENTICATION template is REJECTED.
- Repeat mislabelling escalates: warning → rate limits (131064) → **portfolio restriction up to 30 days** (report).
- Utility must be non-promotional and either user-specific/requested or essential. Utility **can't upsell, cross-sell, include offers or seek renewals**.
- Appeals: WhatsApp Manager / Business Support Home within 60 days.
- **Renewal reminders = MARKETING** (D5). Utility-eligible examples: "Payment of ₹{{1}} received", "Your subscription is active until {{1}}" (no renewal CTA), "Your access details". Price impact: marketing ₹0.8631 vs utility ₹0.1150 ex-GST `[BSP]`. From 2026-10-01, utility inside the CSW is billed too `[META]`.

### 7.4 Status and quality
- Lifecycle events (§5.5): PENDING → APPROVED / REJECTED; later PAUSED, FLAGGED, DISABLED, IN_APPEAL, REINSTATED, ARCHIVED, UNARCHIVED, LIMIT_EXCEEDED, LOCKED, PENDING_DELETION, DELETED.
- Quality: UNKNOWN (new) → GREEN/YELLOW/RED, based on blocks, reports and read rates. RED → pause **3 h** (first), **6 h** (second), **disabled** (third). Sends to a paused template are rejected (not billed, not counted). Template pacing can hold part of a large send (`held_for_quality_assessment` / `paused` in the send response).
- UI: a quality badge on every template, and a "risky to send" warning when YELLOW.

### 7.5 Template builder, AI writer guardrails (pre-submit lint) `[INFERRED]` from Meta limits + BSP rejection patterns
Hard checks (block submit):
1. Name regex, ≤512; unique per language; not deleted in the last 30 days.
2. Length limits (header 60, body 1024 / LTO 600 / card 160, footer 60, button labels 25, URL 2000).
3. Variables: sequential `{{1..n}}` for POSITIONAL, `[a-z_]` names for NAMED; every variable has a sample; header ≤1 variable.
4. **No trailing blank lines** or leading/trailing whitespace; no double blank lines (common rejection cause `[BSP]`).
5. Body doesn't **start or end with a variable**, and has no adjacent variables (`{{1}}{{2}}`); the ratio of fixed text to variables is sensible (common rejection pattern `[BSP]`; exact rule `[UNVERIFIED]`).
6. Samples match the variable meaning (no "test", "xyz") and contain no real PII.
7. Button rules (counts, grouping, URL suffix variable only at the end).
8. Authentication: OTP button required, no URLs, media or emojis.
9. Near-duplicate check against the tenant's existing templates (normalised Levenshtein / embedding similarity > 0.9 → block) `[BSP]` rejection pattern.

Soft checks (warn + score):
- **Category hint:** a classifier flags promotional signals in a UTILITY draft (offer, discount, %, sale, renew, expire soon, upgrade, limited, "buy", coupon, festival greetings). Suggest MARKETING and show the price difference.
- **Policy screen:** banned verticals, shared or resold account wording ("shared login", "group buy"), guaranteed-income claims, adult/gambling/crypto. Block or route to manual review (Commerce Policy risk).
- Marketing templates should include an opt-out quick reply ("Stop promos") with payload `STOP:*` `[INFERRED best practice]`.
- **AI writer output** must pass the same lint, return `{category_suggestion, approval_risk: low|med|high, reasons[]}`, and never auto-submit. A human clicks Submit. Store `ai_generated=true` for audit.

### 7.6 Rejection explanations (from `reason` + `rejection_info.recommendation`)
| `reason` | Plain explanation shown |
|---|---|
| INVALID_FORMAT | "Formatting problem: check variables, blank lines and samples." + show Meta's `recommendation` verbatim |
| INCORRECT_CATEGORY | "Meta thinks this is a different type of message (usually Marketing). Change the category or remove promotional words." |
| PROMOTIONAL | "This reads like a promotion, so it must be a Marketing template." |
| TAG_CONTENT_MISMATCH | "The content doesn't match the chosen category or tag." |
| ABUSIVE_CONTENT | "Meta found content that breaks its rules. Remove offensive or threatening words." |
| SCAM | "Meta flagged this as possibly misleading. Remove exaggerated claims and unclear links." |
| NONE / null | "Rejected without a specific reason. Try simplifying the text or appeal in WhatsApp Manager." |
| CATEGORY_NOT_AVAILABLE (deprecated) | treat as INCORRECT_CATEGORY |

---

## 8. Media, business profile, analytics and cost

### 8.1 Media `[META]`
| Op | Call | Notes |
|---|---|---|
| Upload | `POST /{PNID}/media` multipart `file`, `type`, `messaging_product=whatsapp` → `{id}` | Upload campaign creative once per number; cache `meta_media_id`, expiring at 29 days |
| Get URL | `GET /{media-id}?phone_number_id=` → `{url, mime_type, sha256, file_size, id}` | `phone_number_id` enforces ownership |
| Download | `GET <url>` with Bearer | URL valid **5 min**; 404 → new URL → then refresh the token |
| Delete | `DELETE /{media-id}?phone_number_id=` | `{success:true}` |
| Resumable upload (template header handle, profile photo) | `POST /{APP_ID}/uploads?file_name&file_length&file_type` → `{id:"upload:…"}` → `POST /upload:<id>` (`Authorization: OAuth <token>`, `file_offset:0`, binary) → `{h}`; resume with `GET /upload:<id>` | Types pdf, jpeg, jpg, png, mp4. Tenant token + our app ID `[UNVERIFIED]` |

Retention: uploaded IDs 30 days; inbound IDs **7 days**, so download inbound media immediately to our storage (path `inbound/{tenant_id}/…`, access only via tenant-checked signed URLs).
Limits: audio 16 MB (aac, amr, mpeg, mp4, ogg-opus mono); document 100 MB (txt, pdf, doc(x), xls(x), ppt(x)); image 5 MB (jpeg, png 8-bit RGB/RGBA); sticker webp 100 KB static / 500 KB animated; video 16 MB (mp4, 3gpp H.264 + AAC). Validate client-side and server-side before upload (avoids 131053).

### 8.2 Business profile `[META]`
- `GET /{PNID}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`
- `POST /{PNID}/whatsapp_business_profile {messaging_product, about(1–139), address(≤256), description(≤512), email(≤128), websites[≤2, ≤256 each], vertical, profile_picture_handle}`
- `vertical` enum: `"", ALCOHOL, APPAREL, AUTO, BEAUTY, EDU, ENTERTAIN, EVENT_PLAN, FINANCE, GOVT, GROCERY, HEALTH, HOTEL, NONPROFIT, ONLINE_GAMBLING, OTC_DRUGS, OTHER, PHYSICAL_GAMBLING, PROF_SERVICES, RESTAURANT, RETAIL, TRAVEL`. Hide the gambling and alcohol options in the UI (AUP).
- **Not supported for coexistence numbers** through the API. Hide the editor when `is_on_biz_app`.

### 8.3 Analytics and cost `[META]` (all on `GET /{WABA_ID}`)
| Edge | Query | Use |
|---|---|---|
| `pricing_analytics` | `?fields=pricing_analytics.start(<unix>).end(<unix>).granularity(DAILY).dimensions(PRICING_CATEGORY,PRICING_TYPE,COUNTRY,PHONE).country_codes(IN)` | **Source of truth for cost.** Metrics COST, VOLUME. Types REGULAR, FREE_CUSTOMER_SERVICE, FREE_ENTRY_POINT. Categories incl. MARKETING_LITE. Granularity HALF_HOUR/DAILY/MONTHLY |
| `analytics` | granularity HALF_HOUR/DAY/MONTH; `product_types` 0 template, 2 non-template, 100 inbound | sent/delivered trends |
| `template_analytics` | `GET /{WABA_ID}/template_analytics?start&end&granularity=daily&metric_types=[SENT,DELIVERED,READ,CLICKED,COST]&template_ids=[≤10]` | Campaign ROI; requires a one-time **irreversible** `POST /{WABA_ID}?is_enabled_for_insights=true`; 90-day lookback; read/click counted for 7 days from send |
| `conversation_analytics` | legacy | Only for data before Jul 2025; skip |
| `template_group_analytics`, `call_analytics`, `group_analytics` | — | Later |

- Lookback: 1 year (since 2025-12-01). `COST` is returned because tenants pay Meta directly.
- **Cost ledger, 3 layers:**
  1. `estimate`: written at precheck/enqueue = rate card × category.
  2. `webhook_actual`: written on the first `pricing` object; billable when `pricing.type == 'regular'`. From 2026-10-01: utility in the CSW is `regular`; service is free up to the free tier (1,000 per number per month per the report `[BSP]`), then billable.
  3. `analytics_trueup`: nightly job (02:00 IST) pulls `pricing_analytics` DAILY for D-1 and D-2 into `meta_pricing_daily`. The dashboard shows Meta's COST when present, else the estimate, labelled **"Estimated, Meta bills you directly."**
- Ledger separation: Meta cost (estimated or actual) vs LeadBotCloud platform fee (Razorpay invoices with GST). Never mix them in one total without labels.
- `rate_cards`: quarterly refresh job + manual admin form. Meta changes rates only on Jan 1 / Apr 1 / Jul 1 / Oct 1.

---

## 9. Upcoming changes and migration plan

### 9.1 Account model split `[META]`
| Phase | Timing | Meta change | LeadBotCloud work |
|---|---|---|---|
| 1 (GA) | from 2026-09-23; all businesses by mid-Oct 2026 | Numbers move into **WhatsApp accounts (WAAC)**; WABA → **Messaging account** (same ID); `messaging_account_id` optional; 2FA PIN deprecated for eligible numbers; WAAC IDs not exposed | Name columns `messaging_account_id`; add nullable `waac_id`; keep the PIN flow; rename any `paid_messaging_account_id` use by **2026-12-31** |
| 2 | H1 2027, new Graph version | New Messages API version **requires `messaging_account_id`** when a number has >1 Messaging account; WAAC and Messaging account endpoints; `whatsapp_account` webhook topic; separate permissions; WAAC ID returned with the phone ID; ES returns the WAAC ID | Capture the WAAC ID from ES and the phone GET; subscribe to the new topic; request the new permissions in App Review (new screencasts may be needed `[INFERRED]`); always pass `messaging_account_id` |
| 3 | H1 2028 | Every version requires `messaging_account_id` in multi-account setups; **phone-ID paths and queries must use the WAAC ID** | Flip `PATH_ID_MODE=waac` in packages/meta; backfill all `waac_id`; block numbers with a null `waac_id` |

- Unchanged: `/messages`, `/{WABA_ID}/message_templates`, MM API; webhooks still subscribed with the Messaging account ID.
- A number can be shared with several partners without migrating. Templates don't carry over between Messaging accounts.
- **Meta client abstraction:** `phonePath(phone) => config.PATH_ID_MODE === 'waac' ? phone.waac_id : phone.phone_number_id`; `withMessagingAccount(body, account)`. Unit tests cover both modes.

### 9.2 BSUIDs and usernames `[META]`
- Timeline: BSUIDs in webhooks from April 2026; username reservation from 2026-06-29; sending to BSUIDs from July 2026; usernames roll out through 2026 by country; **India date `[UNVERIFIED]`**.
- Format `CC.<≤128 alnum>` (e.g. `IN.…` presumably), **portfolio-scoped**, so the same person has a different BSUID per tenant. It changes when the user changes their number. Parent BSUIDs (`US.ENT.…`) are opt-in and not needed.
- When the phone number is still included: if the business exchanged messages or calls with that number in the last 30 days (per business number), or the user is in the Meta-hosted contact book.
- Migration checklist: (1) BSUID as primary identity (done in §3); (2) never assume `wa_id`/`from`; (3) handle `user_changed_number` / `user_changed_user_id` and keep `previous_user_id`; (4) never send auth templates to a BSUID (131062); (5) test with the App Dashboard webhook test tool.
- Get the phone back: a `REQUEST_CONTACT_INFO` button (utility or marketing template, or interactive) → `contacts` message with `origin:"contact_request"`. Contact book: `GET`/`DELETE /{PNID}/contact_book?bsuid=…` (presence only).
- Usernames: `contacts[].profile.username` (3–35 characters, `[a-zA-Z0-9._]`, ≥1 letter). Show it in the inbox when the phone is absent. Business username reservation via the Username API (147005 → `force_transfer`) is a later feature.
- CSV import stays phone-based. A BSUID gets attached on the first inbound message or status.

### 9.3 Graph versions
- Policy: bump every 6–9 months; staging runs `N+1` for ≥2 weeks with the full webhook replay suite (`webhook_events` fixtures) before prod.
- Watch: `pricing.billable` removal (don't use it); `conversation` object semantics (v24+); deprecated `messaging_limit_tier`, `current_limit`/`old_limit`, `max_daily_conversation_per_phone` (removal scheduled Feb 2026, so never read them).
- Changelogs to watch weekly (cron + human): WhatsApp changelog, MM API changelog, Graph versions page (§11).

### 9.4 Other dated changes to track
- 2026-10-01 pricing changes (utility in the CSW billable; service free tier) are **already live**. The ledger logic must reflect them.
- INR billing (2026-12-31) and the MM-only marketing rules (2027-04-13, 2027-10-13): §0.3.
- Meta AI-provider terms (2026-01-15): business-specific bots only; no general-purpose assistant features (report).

---

## 10. Feature → API mapping (MVP)

| MVP feature | Meta APIs / webhooks | LeadBotCloud tables / jobs | Notes |
|---|---|---|---|
| Connect WhatsApp (ES) | FB JS SDK `FB.login`, `/oauth/access_token`, `/debug_token`, `/{WABA}/subscribed_apps`, `/{WABA}/phone_numbers`, `/{PNID}/register` | `onboarding_sessions`, `meta_accounts`, `phone_numbers` | v4; ≤10 tenants per week initially |
| Keep existing number (coexistence) | ES `featureType`, `/{PNID}?fields=is_on_biz_app,platform_type`, `/{PNID}/smb_app_data`; `history`, `smb_*` webhooks | `phone_numbers.coex_sync` | 20 mps, 24 h sync |
| Readiness checklist | `/{PNID}?fields=status,name_status,code_verification_status,account_mode`, `/{WABA}?fields=marketing_messages_lite_api_status` | `tenants.status` | Payment and INR checks are manual `[UNVERIFIED]` |
| Business profile editor | `/{PNID}/whatsapp_business_profile`, Resumable Upload | `media_assets` | Not for coexistence |
| Display name change | `POST /{PNID} new_display_name`; `phone_number_name_update` | `phone_numbers.name_status` | Re-register within 14 days |
| Contacts import + consent | — (local) | `contacts`, `contact_consent_events` | +91 normalisation, dedupe |
| Opt-out handling | `user_preferences` webhook, inbound `button`/`text` | `contacts.marketing_opt_out` | Prevents 131050 |
| Template builder + lint + AI writer | `POST/GET/DELETE /{WABA}/message_templates`, `POST /{TEMPLATE_ID}`, `/unpause`, `/message_template_library` | `templates`, `template_events` | Shows the returned category |
| Template status, quality, category | `message_template_status_update`, `message_template_quality_update`, `template_category_update` | `templates`, campaign auto-pause | Not overridable webhooks |
| Broadcast campaigns | `/{PNID}/marketing_messages` (marketing), `/{PNID}/messages` (utility), `/{PNID}/media` | `campaigns`, `campaign_recipients`, `messages`, BullMQ `wa:send:*` | Precheck + pacer |
| Delivery reports | `messages` → `statuses[]` | `message_status_events`, `messages`, `campaigns.counts` | "Capped by Meta" shown separately |
| Cost preview + ledger | status `pricing`, `pricing_analytics`, `template_analytics` | `rate_cards`, `cost_ledger`, `meta_pricing_daily` | Labelled estimate |
| Shared inbox + 24 h timer | inbound `messages`, `/{PNID}/messages` (text, media, interactive), mark read, typing | `conversations`, `messages`, Socket.IO realtime | Free-form only inside the CSW |
| Quick replies, labels, assignment | — (local) | `conversations.labels`, `assigned_user_id` | |
| Number health panel | `/{PNID}?fields=quality_rating,whatsapp_business_manager_messaging_limit,throughput`; `phone_number_quality_update`, `business_capability_update`, `account_update`, `account_alerts` | `phone_numbers`, `meta_accounts.health_state` | Home-screen card |
| Plain-language errors | Graph errors + `statuses[].errors[]` | `errorPolicy`, i18n strings | EN + Hinglish |
| Renewal / expiry engine | Marketing template via MM API; utility template for confirmations | `contacts.attributes`, scheduler, Razorpay/Cashfree webhook (tenant gateway) | Reminders are marketing |
| CTWA lead capture (basic) | inbound `referral`, status `conversation.expiration_timestamp` | `conversations.ctwa_clid`, `fep_expires_at` | Attribution via CAPI later |
| Tenant offboarding | `account_update` PARTNER_REMOVED/UNINSTALLED, `DELETE /{WABA}/subscribed_apps` | `tenants.status`, token wipe, `audit_log` | DPDP export/erase |
| LeadBotCloud subscription billing | — (Razorpay Subscriptions, not Meta) | `tenants.razorpay_*` | One-tap cancel, GST invoice |
| Later: Flows, Payments (Razorpay/PayU `order_details`), OBA, calling, groups | `/{WABA}/flows`, `interactive.order_details`, `/official_business_account` | — | Feasible `[META]`; post-MVP |

---

## 11. Sources

**Meta: messaging, webhooks, errors**
- Send messages: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
- Message API reference: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api
- Message types: …/whatsapp/messages/document-messages · video-messages · audio-messages · sticker-messages · interactive-reply-buttons-messages · interactive-list-messages · interactive-cta-url-messages · location-request-messages · reaction-messages · mark-message-as-read · typing-indicators (prefix https://developers.facebook.com/documentation/business-messaging/whatsapp/)
- Marketing Messages API: https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/send-marketing-messages (+ /overview, /get-started, /onboarding, /changelog)
- Webhooks overview: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview
- Create webhook endpoint: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint
- Webhook overrides: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override/
- Subscribed apps: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/subscribed-apps-api
- Messages webhook reference: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages (+ /status)
- Template status webhook: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/message_template_status_update/
- Error codes: https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
- Throughput: https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput
- About the platform (rate limits): https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform
- Messaging limits: https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits · https://developers.facebook.com/documentation/business-messaging/whatsapp/upcoming-messaging-limits-changes/
- Media: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media (+ reference/media/media-api, media-upload-api, media-download-api)
- BSUIDs: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids
- WhatsApp changelog: https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog/
- Graph versions: https://developers.facebook.com/docs/graph-api/changelog/versions · https://developers.facebook.com/docs/apps/versions

**Meta: onboarding, accounts, templates, analytics**
- App use case: https://developers.facebook.com/documentation/development/create-an-app/whatsapp-use-case
- Tech Providers: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- Solution providers overview: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview/
- App Review: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review
- Permissions: https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions
- Access tokens: https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens
- Access verification (stale): https://developers.facebook.com/documentation/development/release/access-verification
- AV retirement blog (not fetched): https://developers.facebook.com/blog/post/2026/10/09/retiring-access-verification-for-tech-provider-apps/
- ES overview / implementation / versions / v4 preview / TP onboarding / pre-fill / coexistence: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview · /implementation/ · /versions/ · /version-4-public-preview/ · /onboarding-customers-as-a-tech-provider · /pre-filled-data · /onboarding-business-app-users/
- Phone numbers: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers/ · https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/manage-phone-numbers.md · https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/whatsapp-business-account-phone-number-api
- Registration: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration/
- 2FA: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/two-step-verification.md
- Display names: https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names
- OBA: https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/whatsapp-business-account-official-business-account-status-api
- Migration: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/support/migrating-phone-numbers-among-solution-partners-via-embedded-signup · https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/support/migrating-wabas-among-solutions-via-embedded-signup
- Templates: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview · /components · /template-management.md · /template-categorization · /template-pausing · /template-quality · /template-library · /marketing-templates/media-card-carousel-templates · /marketing-templates/limited-time-offer-templates/ · /marketing-templates/custom-marketing-templates/ · /marketing-templates/coupon-templates · /supported-languages/ (failed fetch)
- Business profile: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/business-profiles
- Resumable upload: https://developers.facebook.com/docs/graph-api/guides/upload
- Analytics: https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics
- Account model: https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/
- Pricing: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md · https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages/
- Opt-in: https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in
- Flows: https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowsapi
- Payments India: https://developers.facebook.com/documentation/business-messaging/whatsapp/payments/payments-in/overview · …/payments-in/pg

**Secondary / BSP (directional only)**
- India verification docs (Wati): https://support.wati.io/en/articles/11463208-meta-business-verification-required-documents-by-country
- AV retirement: https://singhamandeep.com/?p=3959 · https://socialmediatoday.com/news/meta-removes-access-verification-for-developers/832678
- Coexistence: https://chakrahq.com/help/chat/faqs/coexistence-faqs · https://chakrahq.com/article/whatsapp-coexistence-business-app-register-cloud-api/
- Coexistence code-exchange thread: https://developers.facebook.com/community/threads/1844034886762935/
- Cloud API marketing sunset dates: https://ppc.land/whatsapp-cloud-api-loses-marketing-messages-on-october-13-2027/
- INR rates: https://dev.to/xreach51/whatsapp-business-api-pricing-in-india-2026-every-layer-of-the-bill-12i7
- 131049 frequency capping: https://www.ycloud.com/blog/what-is-meta-frequency-capping · https://dev.to/duochatio/whatsapp-error-131049-explained-1n6e
- Rate limits in practice: https://dev.to/wapgrowai_org/whatsapp-cloud-api-rate-limits-in-practice-throughput-pair-rate-messaging-limits-and-error-codes-1i7k
- Template rejection causes: https://360dialog.com/blog/?p=764 · pacing: https://360dialog.com/blog/guide-whatsapp-user-messaging-limits
- DPDP Rules (PIB): https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf
- Meta AI-provider terms: https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform
- Commerce Policy mirror: https://docs.bot.space/whatsapp-commerce-policy-34
- Queue architecture reference: https://m.aisensy.com/blog/engineering/how-aisensy-handles-200m-api-requests-everyday/


---
---

# PART C — MARKET, POLICY & CUSTOMER RESEARCH (why features matter)

## (Part C title) Win Indian SMBs by protecting numbers and wallets

The best WhatsApp Cloud API panel for non-technical Indian SMBs won't win on features. Every incumbent already ships broadcast, a shared inbox, basic bots and Shopify. It wins by fixing what customers actually leave over: absent support, billing dark patterns, painful Meta onboarding, and unexplained failures (template rejections, error 131049, bans). The technical base is now largely set by Meta's 2026–2028 changes. LeadBotCloud should launch as a **Meta Tech Provider using Embedded Signup**, with **each tenant in its own business portfolio**, and send marketing through the **Marketing Messages API from day one**, because Cloud API marketing sends sunset on **Oct 13, 2027**. Two findings matter most for DiGiXO's own use case. First, **renewal reminders can't be utility templates**: Meta's rules bar utility messages from seeking renewals, so each one is billed as marketing at about ₹1.02 including GST, and some will be blocked by Meta's per-user cap. Second, **reselling shared or unauthorised accounts is a real ban risk** under Meta's Commerce Policy. The upper hand comes from four things: number-health guardrails, a cost preview and honest ledger before every send, a renewal/expiry engine with UPI payment links, and WhatsApp-native human support. "0% markup" on its own is already table stakes. Several figures below come from vendor-written sources and are flagged.

## Meta's 2027 platform rewrite dictates the architecture

Pick the partner model first, because it decides billing, onboarding and liability. Meta offers two partner routes. **Solution Partners (BSPs)** can extend credit lines and invoice clients for Meta usage, but becoming one is a "lengthy process." **Tech Providers** get Direct Support but no credit lines. Their clients add their own payment method, Meta bills them directly, and the partner bills separately for its software ([Meta: Solution providers](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview/)). The Tech Provider path starts with a Meta app using the WhatsApp use case and business verification. App Review then needs **two screen-recorded videos**: a message sent from your app and received in WhatsApp, and a template being created in your app. You also need Advanced access to both `whatsapp_business_messaging` and `whatsapp_business_management`; without the second, calls on client accounts return error 200. Finally, you may use **business tokens only**, obtained per client through Embedded Signup ([Meta: Get started for Tech Providers](https://developers.secure.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers/)). One hurdle is gone: Meta **removed Access Verification for Tech Provider apps around Oct 9, 2026**, though Business Verification and App Review remain ([Social Media Today](https://socialmediatoday.com/news/meta-removes-access-verification-for-developers/832678)).

**Highest-leverage design decision: one tenant, one portfolio.** Since **Oct 7, 2025**, messaging limits apply per business portfolio rather than per number. New portfolios start at 250 unique users per 24h, then scale through 2,000 / 10,000 / 100,000 / unlimited. Upgrades arrive within 6 hours when quality is Medium or High and at least half the current limit was used over 7 days ([Meta: Messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/upcoming-messaging-limits-changes/)). Enforcement for template misuse escalates up to a **30-day portfolio-wide restriction** ([Meta: Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization.md)). Put tenants in a shared portfolio and one spammer can sink everyone. Embedded Signup makes each tenant own its portfolio, WABA and Meta bill, which also keeps LeadBotCloud out of Meta's credit risk.

The roadmap is dense, and a panel that ignores it breaks on known dates:

| Deadline | What changes | Panel must-do |
|---|---|---|
| Dec 31, 2026 | Eligible India accounts must move to INR billing. **Non-INR accounts stop delivering on Jan 1, 2027** ([Meta: Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md)) | Guided INR migration check at onboarding |
| Dec 31, 2026 | `paid_messaging_account_id` gives way to `messaging_account_id` ([Meta: Account model](https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/)) | Store Messaging account ID and WhatsApp account (WAAC) ID separately |
| Apr 13, 2027 | Messaging accounts created on or after this date **can't send marketing via the Cloud API** ([PPC Land](https://ppc.land/whatsapp-cloud-api-loses-marketing-messages-on-october-13-2027/)) | Build marketing sends on `/marketing_messages` now |
| Oct 13, 2027 | Marketing on Cloud API `/messages` sunsets. Error 131063 when disabled ([PPC Land](https://ppc.land/whatsapp-cloud-api-loses-marketing-messages-on-october-13-2027/)) | Route each send by its *current* category, using the `template_category_update` webhook |
| H1 2027 / H1 2028 | New Graph version and WAAC IDs, then WAAC IDs mandatory in phone paths ([Meta: Account model](https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/)) | Version-abstracted API client |
| 2026 rollout | Business-scoped user IDs and usernames, so webhooks may arrive without a phone number ([Clickatell](https://clickatell.com/blog/what-whatsapps-bsuid-means-for-your-business/)) | Key contacts on (tenant, BSUID), with the phone as optional |

Compliance must-dos beyond the tech. **Opt-in is mandatory**: it must name the business and state that the person agrees to receive its messages. The business carries legal responsibility, and every opt-out must be honoured ([Meta: Getting opt-in](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in)). Since the **DPDP Rules were notified on Nov 14, 2025**, with an 18-month phase-in to about May 2027, each tenant is the Data Fiduciary and the panel is its Data Processor. That means itemised consent notices, 90-day handling of access and erasure requests, breach notices, and penalties of up to **₹250 crore** for weak security ([PIB](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)). One consent log, storing timestamp, source, the notice text shown and categories, satisfies both regimes. Meta's terms also bar "AI Providers" whose core product is a general-purpose assistant, for all users from **Jan 15, 2026**. Business-specific support, sales and booking bots remain allowed ([TechCrunch](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform)). The Commerce Policy bans crypto, gambling, MLM, payday lending, adult content and "fraudulent, misleading, deceptive" models. Enforcement can bar a business from all WhatsApp products ([bot.space mirror of Commerce Policy](https://docs.bot.space/whatsapp-commerce-policy-34); secondary, as the official page couldn't be fetched). Digital subscriptions aren't on the list. Shared or credential-resold logins that break the upstream vendor's terms could plausibly count as "deceptive," and that applies to DiGiXO itself and to any LeadBotCloud tenant. The panel needs an acceptable-use policy and vertical screening at signup.

**Unverified:** the full Business Messaging Policy text, display-name and Official Business Account (blue tick) criteria, coexistence limits from official docs, and the exact verification threshold to exceed 250. Check these at business.whatsapp.com/policy before launch.

## Renewal reminders are billed as marketing, not utility

Meta's categorisation rules hit subscription resellers hardest. Utility messages "cannot upsell, cross-sell, include offers or **seek renewals**." Since **Apr 9, 2025**, Meta approves a misfiled utility template as marketing instead of rejecting it, and it can reclassify approved templates later. Repeat mislabelling escalates from a warning to rate limits and then portfolio restriction ([Meta: Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization.md)). This contradicts a common vendor-blog idea, repeated in some of this research, that renewal reminders can ride cheap utility rates. They can't. Only the post-payment messages qualify as utility: "payment received," "subscription activated," "here are your login details."

Pricing has been per delivered message since **Jul 1, 2025**. India is billed in INR. Reported rates on the Jul 2026 card are **marketing ₹0.8631** (up from ₹0.7846 on Jan 1, 2026) and **utility and authentication ₹0.1150**, plus 18% GST. That puts marketing at about ₹1.02 ([DEV Community](https://dev.to/xreach51/whatsapp-business-api-pricing-in-india-2026-every-layer-of-the-bill-12i7); secondary, since Meta publishes the INR figures only in its CSV rate card). Two changes on **Oct 1, 2026** made older blog advice obsolete. **Service messages are charged again** after 1,000 free per phone number per month, and **utility messages inside the 24h window are now charged** too. Without a payment method on file, messages beyond the free tier don't deliver ([Meta: Non-template pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages/)). Click-to-WhatsApp ads open a free entry-point window, which Meta's page now says "may remain open for up to 7 days." Many vendors still quote 72 hours ([Meta: Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md)). Meta changes rates only on Jan 1, Apr 1, Jul 1 or Oct 1, with at least a month's notice, so the panel's rate table needs a quarterly refresh job.

Delivery isn't guaranteed either. Meta applies a dynamic, unpublished **per-user marketing cap across all businesses**, tested first in India. Blocked messages return **error 131049** and aren't charged ([YCloud](https://www.ycloud.com/blog/what-is-meta-frequency-capping)). One vendor estimates 20–25% of Indian marketing messages are affected ([DEV - duochat](https://dev.to/duochatio/whatsapp-error-131049-explained-1n6e)). **Unverified, from a vendor.** In practice, a renewal campaign to 1,000 customers costs about ₹1,020 plus the panel fee and may silently miss a fifth of them. The panel's job is to show that clearly and route the missed customers to a fallback, such as an in-window message after the customer replies, SMS, or a call list.

A billing constraint shapes packaging. **A Tech Provider can't resell Meta usage through its own wallet.** Tenants pay Meta by card. The prepaid INR wallet that AiSensy and others run requires Solution Partner status or a Multi-Partner arrangement that shares a BSP's credit line ([Meta: Solution providers](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview/)). Many Indian SMB owners don't have an international-enabled card, so this matters in practice. The realistic path is to launch as a Tech Provider with "pay Meta directly, we show you every rupee," then add an Indian BSP partnership for UPI-topped wallets once demand is proven.

## Customers churn over support and billing, not missing features

Hand-tallied negative reviews (Interakt Shopify 1-star, AiSensy Trustpilot, WATI and Gallabox Capterra; indicative, not statistically representative) show a consistent ranking: **support > billing/cancellation > onboarding > bugs > weak chatbots > templates**. In about 13 of 20 Interakt 1-star texts, the complaint was a support bot saying no one was available, issues taking a week, or cancellation requests ignored while charges continued for two months ([Appnavigator - Interakt](https://appnavigator.io/app/interakt-marketing/reviews/?rating=1)). AiSensy's Trustpilot is split almost evenly: **50% 5-star and 46% 1-star across 58 reviews**. One customer recovered a $150+ payment only through a bank chargeback, and another never got the Relationship Manager promised with a prepaid plan ([Trustpilot - AiSensy](https://www.trustpilot.com/review/aisensy.com?page=2)). WATI cancellation required an email at least two days ahead, with no in-app option, and its billing ledger didn't show the last payment ([Capterra WATI](https://www.capterra.com/p/204314/WATI/reviews?page=2)). Support isn't uniformly bad: AiSensy's positive reviews praise fast, named staff. The pattern is **inconsistency**, which a small, founder-led operation can beat.

Onboarding is the third wall. Interakt users said setup "needed a developer." AiSensy used temporary numbers that Meta rejected and then blamed the customer. Buyers of a CodeCanyon SaaS script couldn't find the webhook verify token ([CodeCanyon](https://codecanyon.net/comments/31843382)). Bans are rare in reviews but severe in forums. One developer's portfolio was banned after about 10 `hello_world` test messages, with no explanation ([Reddit snapshot](https://reddit.sentinel-team.org/posts/1qntzfp/snapshots/2026-01-27T08%3A01%3A28.555239Z)).

Many "panel" complaints are really Meta rules the panel never explained: category reclassification, 131049, the 24h window, pacing. Template rejections commonly come from trailing blank lines, variable placement, sample mismatches and near-duplicates ([360dialog](https://360dialog.com/blog/?p=764)). These are cheap to catch before submission. Daily friction is mundane and cheap to fix: selecting more than 100 contacts at once, limited campaign filters, crashing Google Sheets sync, reminders that don't fire, and images that must be saved locally before sending ([Capterra WATI](https://www.capterra.com/p/204314/WATI/reviews?page=2)). The warmest praise goes to outcome automations with visible ROI, such as COD confirmation and abandoned-cart recovery. Generic "AI chatbot" claims draw backlash when the bot turns out to be canned responses ([Appnavigator - AiSensy](https://appnavigator.io/app/aisensy-whatsapp-marketing/reviews/)).

## Incumbents converge on ₹1,500 plans with a 20–30% message markup

Indian panels cluster in three bands: entry at about ₹1,000–3,000/mo, mid at ₹3,000–7,000, and team or enterprise at ₹15,000+ or USD pricing. The hidden cost is the message markup. The median published entry fee is **₹1,500/mo** ([RichAutomate](https://richautomate.in/research/state-of-whatsapp-business-api-pricing-india-2026); vendor-authored).

| Vendor | Entry price (ex-GST) | Marketing msg (vs ₹0.8631 base) | Notable lock-ins / gaps |
|---|---|---|---|
| AiSensy | Free plan; Basic ₹1,500/mo, Pro ₹3,200 ([Kraya](https://kraya-blog-platform.vercel.app/aisensy-alternatives)) | ₹1.09, about +26% ([AiSensy](https://aisensy.com/pricing)) | Bot builder +₹2,500/mo, AI +₹1,350/mo, extra agent ₹750/mo |
| Interakt (Jio Haptik) | ₹3,499/quarter, no monthly plan ([Codingclave](https://codingclave.com/blog/interakt-pricing-india-2026)) | about ₹0.97–1.04 (sources conflict) | Branching bots only on Advanced; email-only support |
| WATI | Growth ₹2,999/mo ([Codingclave](https://codingclave.com/blog/wati-pricing-india-2026)) | ₹1.04–1.12, +20–30% | No webhooks on Growth; 7-day trial, no refunds |
| Gallabox | ₹2,999/mo billed quarterly ([Kraya](https://kraya-blog-platform.vercel.app/aisensy-alternatives)); conflicting reports of ₹999 | ₹0.9926 on its own rate card ([Gallabox](https://docs.gallabox.com/pricing-and-billing/whatsapp-pricing/rate-card.md)) | Weak analytics; WhatsApp-only |
| DoubleTick | $170/mo annual ([PulseSignal](https://getpulsesignal.com/pricing/doubletick)); conflicting INR figures | Not confirmed | Flows, Calls, Pay, green tick are "contact sales" |
| Zoko / WhatsBoost / RichAutomate | $35–60/mo; ₹799–1,999; ₹0 fee | 0–12% markup ([RichAutomate](https://richautomate.in/research/state-of-whatsapp-business-api-pricing-india-2026)) | Price-led challengers |

Competitor-written comparison pages supplied most of these numbers, and Gallabox and DoubleTick figures conflict across sources. Treat them as directional. The strategic read holds anyway. The market is splitting into subscription-plus-markup incumbents and near-0% challengers, so **transparent pass-through is now expected, not a differentiator**. Features sit behind paywalls: branching bots, extra agents, webhooks, AI and calling. Self-hosted CodeCanyon scripts (WhatsCRM about 1.2K sales at $69, WhatsJet $85 with a $49 Embedded Signup add-on) show how cheap the commodity core is ([CodeCanyon](https://codecanyon.net/search/whatsapp%20cloud%20api%20saas)). They also show the trap: stale updates, support complaints, and still needing your own Tech Provider approval. They're useful as a reference, but risky as a foundation given the 2027 API changes. The research found **no vendor positioned for renewal or subscription businesses** (resellers, ISPs, gyms, coaching), and none listing a Hindi UI on its pricing page. Neither gap has been checked for demand.

## The upper hand: guardrails, honest money, renewals, humans

**The highest-leverage differentiator is a number-health guardrail.** Before each send, it checks audience size against the portfolio's current limit, the template's quality state, the share of contacts already messaged in the last 24–72 hours, and opt-in coverage. It also auto-holds contacts that hit 131049 for 24 hours, since early retries can extend the hold. It respects the per-user pair rate of about one message every 6 seconds. And it translates every error code into plain Hindi or English, where competitors expose raw Meta codes ([DEV Community](https://dev.to/wapgrowai_org/whatsapp-cloud-api-rate-limits-in-practice-throughput-pair-rate-messaging-limits-and-error-codes-1i7k)). Meta's pacing holds back part of large campaigns and pauses templates on negative early signals, and recovery "isn't instant" ([360dialog](https://360dialog.com/blog/guide-whatsapp-user-messaging-limits)). So protecting the number protects the customer's business, and owners will pay for that.

**Second: honest money.** Show "₹0.86 × 1,240 = ₹1,067 + GST" before every campaign, a monthly spend cap, and a ledger that separates Meta cost from platform fee. Add one-tap in-app cancel, prorated refunds, a GST invoice on every payment, and monthly INR plans with no quarterly lock-in. Each item maps directly to the most-cited billing complaints.

**Third: the renewal/expiry engine**, DiGiXO's home-turf advantage. It covers expiry fields, a marketing reminder sequence (for example 7, 3 and 0 days out), and a UPI payment link from Razorpay or Cashfree. A payment webhook marks the customer renewed, and a utility template delivers the credentials. Using a gateway link avoids Meta's in-chat payments, which require a verified merchant and a 1K+ messaging tier and are "not publicly available yet" ([Meta: Payment Links](https://developers.secure.facebook.com/docs/whatsapp/cloud-api/payments-api/payments-in/payment-links)). The loop mirrors Khatabook's reminder-plus-WhatsApp design, which grew by word of mouth on radical simplicity ([Ameya substack](https://ameya.substack.com/p/how-khatabook-became-the-premier)).

**Fourth: humans on WhatsApp**: done-for-you Embedded Signup on a call, support on your own WhatsApp number, and 60–90-second Hindi/English walkthroughs.

UX should be language-first in the owner's words: "Send offer," "Customer list," "Message cost," never "WABA" or "session." Design for cheap Android phones on patchy data. Meesho translated about 33,000 words per language, chose everyday words over formal ones, and saw **Hindi reach 20% adoption** after a year ([Meesho](https://meesho.io/blog/meesho-adds-8-new-vernacular-languages-to-its-platform)). So default to English/Hinglish with a one-tap Hindi or Bengali toggle. Make the mobile inbox look like WhatsApp. Keep a four-card home screen: spend this month, last campaign result, number health, pending chats. Coexistence lets shopkeepers keep their existing number and app, but it syncs only six months of 1:1 chats. Groups don't sync, broadcast lists become read-only, and labels and quick replies aren't supported via the API ([ChakraHQ](https://chakrahq.com/article/whatsapp-coexistence-business-app-register-cloud-api/)). It's also capped at 20 messages per second versus 80 for standard numbers ([DEV Community](https://dev.to/wapgrowai_org/whatsapp-cloud-api-rate-limits-in-practice-throughput-pair-rate-messaging-limits-and-error-codes-1i7k)). Offer it, with those warnings shown upfront.

For pricing, a workable opening is **₹0–499/mo starter, ₹999–1,499 growth, with Meta at cost** and the flow builder, a basic FAQ bot and Sheets bundled rather than sold as add-ons. Margin comes from paid done-for-you setup and vertical packs (renewal pack, Shopify/COD pack), which is where Indian resellers already earn: setup at ₹15k–75k per client and retainers at ₹10k–40k/mo ([Ominiflow](https://ominiflow.com/blog/whatsapp-api-reseller-program-india); vendor-authored). **Unverified:** SMB willingness to pay, and whether wallet or subscription converts better. Test both with DiGiXO's own community before locking prices.

The reliability backbone is invisible but decisive. It needs async queues, a shared per-number token-bucket pacer (in Redis or Postgres), retries driven by error code with backoff, wamid-based idempotency, dead-letter queues, a stateless webhook that verifies the signature, returns 200 and enqueues, and tenant-level rate limits. AiSensy describes this pattern running at **200M+ requests/day** ([AiSensy engineering](https://m.aisensy.com/blog/engineering/how-aisensy-handles-200m-api-requests-everyday/)).

### Prioritized feature list for the development plan

| Tier | Feature | Why |
|---|---|---|
| **Must-have (launch)** | Tech Provider app + Embedded Signup, one portfolio per tenant | Meta requirement; isolates bans and limits |
| Must-have | Marketing via MM API, category-aware routing, `template_category_update` + `account_update` webhooks | Oct 2027 sunset; reclassification |
| Must-have | `messaging_account_id` / WAAC / BSUID-ready data model | Dec 2026–2028 account split |
| Must-have | Consent log, per-category opt-out, STOP handling, suppression at send | Meta opt-in + DPDP |
| Must-have | Template builder with pre-submit lint (formatting, variables, category hints) | Top support-ticket source |
| Must-have | Broadcast with queue, pacer, retries, and statuses that separate "Meta frequency-capped" from failures | Reliability; 131049 clarity |
| Must-have | Shared inbox (WhatsApp-like on mobile), 24h-window timer, quick replies, labels, multi-agent | Daily use |
| Must-have | Forgiving CSV/Excel import (+91 normalisation, dedupe, optional fields), unlimited bulk select, saved segments | Cited daily pain |
| Must-have | Per-tenant cost ledger from `pricing_analytics`, INR-migration check, GST invoices, in-app cancel | Billing complaints; Jan 2027 cutoff |
| Must-have | AUP + vertical screening at signup, DPA template, encryption, access logs, erasure/export | Commerce Policy, DPDP |
| **Differentiator** | Number-health guardrail + pre-send risk check + plain-language error explainer | Biggest open gap |
| Differentiator | Cost preview + spend cap per campaign | Trust; anti "hidden charges" |
| Differentiator | Renewal/expiry engine + gateway UPI links + auto-renew + utility delivery message | No competitor serves this niche |
| Differentiator | AI template writer *with* approval-risk score and category suggestion | AI writer alone is table stakes |
| Differentiator | Hinglish-first UI with Hindi/Bengali toggle; PWA tuned for low-end Android | Underused (unverified demand) |
| Differentiator | WhatsApp-native support + done-for-you onboarding call | Beats inconsistent incumbent support |
| Differentiator | Coexistence onboarding with clear warnings | Keep existing number |
| **Later** | Business-scoped FAQ/AI agent with forced human handoff | Allowed, but weak bots draw backlash |
| Later | Drag-and-drop flow builder, WhatsApp Flows, Shopify/WooCommerce COD + cart packs | Valuable, but not the wedge |
| Later | BSP partnership for UPI-topped INR wallet / credit line | Needs Solution Partner tie-up |
| Later | CTWA ad attribution, Instagram/RCS inbox, calling, native WhatsApp Pay, white-label for agencies | Gated, costly or crowded |

### Key risks

The biggest risk is **policy exposure from DiGiXO's own category**. If LeadBotCloud's showcase tenant, or its early adopters, resell shared logins, one ban could hit the business's own sending ability. Keep DiGiXO's messaging to genuine, authorised products, and screen tenants. Second, **renewal economics**: marketing-rate reminders at about ₹1.02, plus 131049 losses, mean the panel needs fallbacks such as SMS, a call list, or nudging customers to reply so they can be reached inside the service window. Third, **platform churn**: four dated Meta migrations within 18 months will break a script-based or under-maintained build, so keep the Meta layer isolated and versioned. Fourth, **payment friction**: Tech Provider tenants must hold a card Meta accepts, which many micro-SMBs lack. Watch this as a likely onboarding drop-off until a BSP wallet exists. Fifth, **price compression** from ₹0-fee challengers means the wedge must be guardrails, renewals and service, not price. Finally, **unverified inputs**: the INR rate figures, the 131049 impact share, competitor prices, and the official policy text all need checking against primary Meta pages before pricing is set.

## Conclusion

The WhatsApp panel market has commoditised the features and left the operating risk with the customer. Meta's shift to per-portfolio limits, aggressive recategorisation, unpublished per-user caps and paid service messages has turned "can I send?" and "what will it cost?" into the real product questions, and no incumbent answers them well. For LeadBotCloud, the opportunity is to sell **confidence**: a number that doesn't get banned, a bill with no surprises, and renewals that collect themselves.

Two things work in the founder's favour. The Oct 2027 Marketing Messages API cutover forces every incumbent through a migration a new build avoids. And the Dec 31, 2026 INR deadline creates a switching window for unhappy SMBs right now. Dogfooding on DiGiXO's own renewal workflow is the fastest way to test the differentiators. It also exposes the policy risk of the reseller category, so treat that as a design input, not an afterthought.
