# Progress

Shared memory between sessions (and between Deep and Abdullah). Newest state first. Updated from git history and a real test run, not from memory. Procedures: `docs/agent/RESUME.md`, `docs/agent/HANDOVER.md`.

## Latest handover: 2026-11-25 IST · by Deep (Hermes) · branch feat/homepage-v3 · NOT merged, NOT deployed
### What was done this session
- Rebuilt the homepage around Deep's brief: highly visual, explains itself without reading, vivid colour, motion that carries meaning, interactive. Started from the buyer's questions (reach, cost, number safety, team replies, money back, setup, human help).
- New hero `components/marketing/hero-engine.tsx`: one sample campaign plays live in about 15 seconds. 96 dots (each a group of contacts) come in (sky), a rose sweep skips people with no permission, a cost card with the exact Meta cost (from `lib/cost`) waits for "Send" (a cursor presses it if the visitor does not), a green wave sends, violet reply bubbles rise from named people, gold sale tags drop. Visitor can pick Gym / Coaching / Salon / Online store, press send, pause, or jump to any step on the rail. Pauses off screen; reduced motion shows the finished state.
- Five stage colours used the same way across the page (list sky, checked rose, sent green, replies violet, sales gold) as `--st-*` tokens in `.lp`, plus `-ink` variants for text on light paper. Night-sky gradient hero; a five-colour band under the header is the legend.
- New "Everything you'd ask before buying" grid `buyer-answers.tsx`: 256 vs whole-list bars (limit from `PLAN_LIMITS`), cost receipt for 1,000 messages (`lib/cost`), Safe / Careful / Stop sending meter with the three pre-send checks, team inbox, renewal chain. Animates once on scroll.
- New renewal section `renewal-loop.tsx`: a ring (date saved, reminder, answer, renewed) with a token travelling round and the same sample customer in the centre; steps are clickable.
- How-it-works tabs and the business picker recoloured to the stage colours. Comparison, pricing and FAQ kept; FAQ gained "What can't you promise?".
- Removed: the "press send" dot calculator (`wake-stage.tsx`), the old phone hero (`hero-phone.tsx`), the safety pipeline section (its content now lives in the hero, the safety tile and the FAQ), the doodle texture, and their CSS.
- "Chat with us" / "Ask a person on WhatsApp" buttons use `SUPPORT_WHATSAPP` from the environment and only appear when it is set.
- Added `PRODUCT.md` (product facts for design work, from the spec; marked as inferred where not confirmed).
- Professional polish pass (Deep: "fonts need work, should look professionally built"): one family for the whole marketing page, **Geist** (with `latin-ext` so ₹ renders in the face; Onest and Schibsted lack ₹), replacing Bricolage Grotesque 800. Five type roles as classes in `.lp`: `t-display` (36/52/56px, 600), `t-h2` (30/40/44px, 600), `t-lead` (17–18px), body 16px, `t-cap` (13px); no 800 weights anywhere; tabular figures for numbers. New SVG logo mark (`marketing/logo.tsx`) instead of the letter L. Header now solid night colour in both themes. Buttons `lp-btn` + `lp-btn-primary|ghost|outline`: flat, 10px radius, no glow. FAQ is one bordered list with hairlines. Cool neutrals only (white / #eef1f6), no warm cream. Removed the five-colour header stripe and the unused `cost-calculator.tsx`.
### Current state of the app (what works end to end right now)
Unchanged apart from the homepage. Live site still shows the old homepage; `main` has the previous redesign (7274aad), this branch has the new one.
### How to run it locally (exact commands, any new env vars, migrations, seed data)
Same as below. To see the WhatsApp buttons locally, set `SUPPORT_WHATSAPP` in `.env` with quotes if it has spaces (`SUPPORT_WHATSAPP="+91 ..."`), otherwise `. ./.env` fails on that line. Build check: `NODE_ENV=production pnpm exec next build`; do not run it while `next dev` is running in the same folder (they share `.next`).
### How to test what changed (step-by-step, incl. phone/360px checks)
1. `pnpm --filter @lbc/web dev`, open http://localhost:3000/ at 1440px and 360px.
2. Hero: watch one loop (list, checked, cost card, send, replies, sales). Tap a business chip (restarts with its numbers), tap "Send" on the cost card, tap a step on the rail (pauses), pause/play button.
3. 360px: headline, buttons and the top of the demo are on the first screen; no sideways scroll; business chips scroll sideways.
4. Scroll: the questions grid animates once; the renewal ring advances and its steps are clickable.
5. Dark mode (moon icon) and reduced motion (finished state, no autoplay, no play button).
### Not finished / known bugs / failing tests
- Lint, typecheck, the 315 web tests and the production build pass (homepage 161 kB first load, was 159 kB). No automated test covers the homepage visuals.
- Checked in headless Chrome only (1440, 360, dark, reduced motion); not yet on a real phone or Safari.
- Homepage strings are still inline in the page, not in `packages/shared/i18n/en.json` (same as before this session).
- Copy to confirm: "Official WhatsApp Business Platform" in the hero trust line, the 256 broadcast limit and the Meta rate (carried over).
### Next steps (ordered, with the spec section to read for each)
1. Deep reviews the preview; on approval merge `feat/homepage-v3` into `main`.
2. Whoever has `lbc-deploy` deploys `main`, then checks `/version`, `/` and `/login`. Set `SUPPORT_WHATSAPP` on the server if the WhatsApp buttons should show.
3. Open Graph image, then real customer proof when it exists (spec A4.1).
### Decisions made + open questions (also update docs/open-questions.md)
- Decision: motion only where it explains a step, a number or a state; no decorative movement.
- Decision: hero replies and sales are named sample people, never rates or totals, so nothing reads as a benchmark.
- Open: is +91 82509 19483 (spec A1.1) the live support WhatsApp for the site buttons?
### Credentials/env changes the other developer needs (names only, never values)
None new. `SUPPORT_WHATSAPP` (already in `.env.example`) now also controls the homepage WhatsApp buttons.

## Module checklist (spec A8 build order; status from code and tests, nothing here is verified against real Meta/Razorpay/email)
- 1. Repo, tooling, design system, shell, auth, workspaces, super-admin: ✅ (admin panel with staff two-step sign-in built)
- 2. Schema + RLS + tests, `packages/meta`, error map, webhook receiver, queues: ✅
- 3. Connect WhatsApp (Embedded Signup) + inbound processing: 🟡 built against fakes; needs real Meta app
- 4. Customers/consent/segments, inbox, single-send queue: ✅ (against fakes)
- 5. Templates (studio, media headers, offers), bulk send (cost preview, spend caps, reports): ✅ (against fakes)
- 6. Auto-replies, dashboard, notifications, number-health guardrails, cost ledger: 🟡 verify against the spec list
- 7. Renewal engine: 🟡 Razorpay links tested against a fake only
- 8. LeadBotCloud billing (Razorpay, plans, limits, GST invoices, complimentary plans) + legal pages: 🟡 fake Razorpay; marketing website not confirmed
- 9. A/B tests, journeys, agent API + MCP, lead engine and connectors: ✅ built; lead scoring parked; AI writer, Hindi UI, chatbot builder, AI FAQ: ⬜ not confirmed
- 10. Hardening: 🟡 security work done; off-machine backups and a second VM are ⬜
(Rows marked "verify" or "not confirmed" were not checked line by line against the spec this session.)

## History
### Handover: 2026-11-25 IST · by Deep (Hermes) · merged to `main` at 7274aad (2026-11-25), NOT yet deployed
#### What was done this session
- Redesigned the public homepage (`apps/web/src/app/page.tsx`) after a critique scored the old one 5/10 against the brief: highly visual, visually explanatory, interactive, high-converting. No backend, schema or env changes.
- Hero: a playable WhatsApp conversation (visitor taps "Book a demo"/"Call me back", sees the reply, the typing dots and the answer) with sample cost and skipped chips. `components/marketing/hero-phone.tsx`.
- "Press send. See what wakes up.": four sliders drive a 200-dot picture of the visitor's list; pressing send lights the reachable dots and gold dots buy. Exact cost from `lib/cost` (Meta India rate); sales only from the visitor's own guesses. `wake-stage.tsx` (replaces `sleeping-calc.tsx`, deleted).
- How it works: four keyboard-accessible tabs with readable mock screens (upload with skipped rows, cost review, inbox, renewals). `how-tabs.tsx`.
- "Pick your business": six business types, one phone, what to send. `business-picker.tsx`. Safety shown as a four-step pipeline with sample numbers. Comparison and pricing redrawn; 10-question FAQ kept.
- Mobile: hamburger menu, sticky "Start free" bar (`site-chrome.tsx`), phone demo right under the headline. New display font (Bricolage Grotesque), WhatsApp-green palette, chat-doodle texture; styles under `.lp` in `globals.css`.
- Merged `docs/progress-handover` into this branch (PROGRESS format + README test note).
#### Current state of the app (what works end to end right now)
Unchanged apart from the homepage. Still built and tested against fakes only; nothing has run against real Meta, Razorpay or email. Live site (Abdullah's VM) still shows the OLD homepage. Code is on `main`; it needs `lbc-deploy` from the machine that has SSH access to the server (Deep's host cannot reach port 22).
#### How to run it locally (exact commands, any new env vars, migrations, seed data)
Same commands as the History entry below. No new env variables. Build check: `NODE_ENV=production pnpm exec next build` (a `.env` copied from `.env.example` sets `NODE_ENV=development`, which makes `next build` fail on the /404 page with "<Html> should not be imported").
#### How to test what changed
1. `pnpm --filter @lbc/web dev`, open http://localhost:3000/ at 1440px and at 360px.
2. Hero: tap "Book a demo" in the phone; the reply, typing dots and answer appear; untouched, it loops by itself. With reduced motion it shows the finished conversation.
3. Section 2: move sliders (cost and skipped counts change), press "Send to my list" (dots light up, sales count up), "Put them back to sleep" resets.
4. "How it works": click or use the arrow keys on the tabs; it auto-advances until you touch it.
5. 360px: header has a menu button and Start free on one line, no sideways scroll, sticky bar appears after the first screen and hides at the closing section. Dark mode via the moon icon.
#### Not finished / known bugs / failing tests
- Visual judgement only: no automated test covers the homepage (lint, typecheck and the 315 web tests pass; production build passes, homepage 159 kB first-load JS).
- No Open Graph share image yet. Stock photos still come from Pexels (see `public/people/CREDITS.md`); the sample business names are made up and labelled.
- Not yet checked on a real phone or in Safari. Mobile was checked in headless Chrome at 360px.
- Copy to confirm with Deep/Abdullah: the 256-list claim and the Meta rate are carried over from the old page and still need checking against Meta's own rate sheet.
#### Next steps (ordered, with the spec section to read for each)
1. Abdullah (or whoever has `lbc-deploy`) pulls `main` and deploys, then checks `/version` shows the new commit and that `/` and `/login` load. Roll back with `deploy.sh --rollback` if not. No migrations in this change.
2. Add an Open Graph image and replace stock photos with real customer proof when available.
3. Then the items from the previous handover (real Meta/Razorpay/SMTP, branch policy for `dev`).
#### Decisions made + open questions (also update docs/open-questions.md)
- Decision: calculator reframed as a "send" interaction; results only from the visitor's own inputs, no invented benchmarks.
- Decision: removed the stock-photo "who it is for" grid and the marquee; business types now live in the picker.
#### Credentials/env changes the other developer needs (names only, never values)
None.

### Handover: 2026-11-25 IST · by Deep (Hermes) · branch docs/progress-handover · based on main e187d87
#### What was done this session
- Read-only audit of GitHub; set up a second machine (Deep's Hermes host) from scratch and ran every suite. No app code changed.
- Rewrote this file into the handover format. No feature work yet.
#### Current state of the app (what works end to end right now)
- Same as the "Previous state" below: built and tested against fakes; live at https://34-134-248-202.sslip.io (58 migrations, latest `0056_complimentary_plans`). Nothing has run against real Meta, Razorpay or email.
- Branch facts: `main` (e187d87) is the real line of work and equals `feat/auth-contacts`. `dev` is STALE (stops at b749373, 12 Nov, 85 commits behind main). `wip/lead-scoring-parked` holds parked lead scoring. Do not branch from `dev`.
#### How to run it locally (exact commands, any new env vars, migrations, seed data)
Node 24 and pnpm 12.18 (see `package.json`). Then:
```
pnpm install --frozen-lockfile
docker compose -f infra/docker-compose.dev.yml up -d      # Postgres 5433, Redis 6380
cp .env.example .env   # fill BETTER_AUTH_SECRET, SIGNED_URL_SECRET, INTERNAL_API_SECRET (random), TOKEN_ENCRYPTION_KEY (32 bytes base64),
                       # and the three DATABASE_URL* passwords from infra/postgres/init-roles.sql
set -a; . ./.env; set +a                                    # tests and db:migrate read the shell environment, not .env
pnpm --filter @lbc/db db:migrate
pnpm --filter @lbc/web dev ; pnpm --filter @lbc/worker dev
```
No new env variables this session.
#### How to test what changed
Docs only. Verify with: `pnpm lint && pnpm typecheck` and the suites below.
#### Not finished / known bugs / failing tests
Run on 2026-11-25 against a fresh dev database (Node 24.22, pnpm 12.18). lint: 0 errors. typecheck: 0 errors on all 7 packages (the old `rls.test.ts:185` error is gone).
Tests: shared 321, db 144, meta 87, razorpay 17, connectors 35, web 315, worker 415, all pass when each package is run on its own.
- `pnpm test` through turbo drops the shell env (strict env mode) and fails ~149 web tests with "DATABASE_URL is required". Use `pnpm turbo run test --env-mode=loose` or run each package's tests directly.
- Suites share one dev database, so running everything in parallel is flaky. Seen once each, each passing alone on rerun: `web/test/super-admin-2.test.ts` (2 tests), `worker/test/retention.test.ts` ("each pass removes at most the batch size"). Same class of problem as the two worker tests already noted below.
- Deploy tooling (`lbc-deploy`, `~/.hermes/devrun/`) is NOT on Deep's machine; only the machine that ships to the live server has it.
#### Next steps (ordered, with the spec section to read for each)
1. Decide the branch policy: keep working from `main` with `feat/*` branches, and fast-forward or retire `dev`.
2. Connect the real services, which only the owners can unblock (spec Part B + `docs/RUNBOOK.md`): Meta app credentials and Embedded Signup config, Razorpay keys and webhook secret, SMTP (RUNBOOK "Turning email on"), company details in the live environment.
3. Then new work from `docs/GROWTH-PLAN.md` (P3 to P8) or send-time testing; read the matching phase and spec section A4 first.
#### Decisions made + open questions (also update docs/open-questions.md)
- Decision: both developers' Hermes sessions follow RESUME/HANDOVER; GitHub is the only channel between them.
- Open: Meta Advanced access? WABA billed in INR (needed before 31 Dec 2026)? Old panel still receiving webhooks? DigiXO number +91 85094 46805 is on another WhatsApp account. VM move to the paid Google account.
#### Credentials/env changes the other developer needs (names only, never values)
None.

### Previous state (commit 1f709f4, from the earlier PROGRESS.md; kept for detail)

Live at https://34-134-248-202.sslip.io (shipped with `lbc-deploy`; see `docs/RUNBOOK.md`). 58 migrations (latest `0056_complimentary_plans`).
Suites at last run (3 clean passes): shared 321, db 144, meta 87, worker 415, web 315. Typecheck has 0 errors across the workspace. Typecheck and lint clean except one old type error in `packages/db/test/rls.test.ts:185`.

**Nothing has run against real Meta, Razorpay or email.** Everything is built and tested against fakes. The DigiXO number is registered on another WhatsApp account and cannot be used until that is resolved.

#### What exists (see GROWTH-PLAN.md for the phase list)
- Lead engine, capture channels, OAuth connectors (Meta Lead Ads, Shopify, Google Sheets), template studio incl. media headers and offers, segments.
- Campaigns: cost preview, spend caps, quiet hours, send speed, test send, tracked links and retarget, A/B tests, and **A/B "test first on a small group, keep the rest back, send the chosen winner"** (`apps/worker/src/ab-release.ts`; re-checks consent, offer, spend cap and connection at release; exactly once).
- Journeys (wait, template, tag, only-if checks, assign) and a pipeline board. Lead scoring is parked in `git stash` ("not core").
- Inbox: real inbound handling, inbound and outbound media, 90-day file retention, contact erasure, workspace closure (30-day window, export).
- Billing: Razorpay checkout, GST invoices, webhooks (tested against a fake). **Complimentary plans**: staff give a plan for 1 to 365 days with a reason; one database rule `effective_plan()` (better of paid and gift) is used by billing, expiry (`apps/worker/src/grants.ts`) and staff actions.
- Agent API: keys and the MCP server can create A/B and "test first" campaigns and choose the winner (`send_winner`, `POST /api/v1/campaigns/{id}/winner`). The key must have created AND started the campaign, so the whole audience's cost is already inside its limits; see `docs/AI-AGENTS.md`.
- Email: invitations, closing and cancelled notices, password reset and password-changed all go through `lib/notify.ts` / `lib/mail.ts`. Built and tested against a real local SMTP port, but SWITCHED OFF in production (`MAIL_TRANSPORT=console`) until SMTP credentials are set; see RUNBOOK "Turning email on". The invite dialog says "We emailed them" only when a mail server accepted the message.
- Multi-tenant: row security on every tenant table, roles (owner, admin, agent, viewer, role-matrix test), plan limits, API keys and an MCP server for AI agents (`docs/AI-AGENTS.md`).
- Platform admin panel (staff only, 404 for everyone else): overview, needs-attention queue, workspaces, people search and sign-out, closures, revenue, audit log, announcements, staff list, notes. **Two-step sign-in is required for staff** (authenticator app, backup codes, lockout 5 tries then 15 min, trust-this-device disabled). **Read-only "view as customer"** (reason required, 30 minutes, database-enforced read-only, written to the customer's Activity log). Staff are added and recovered only from the server: `pnpm --filter @lbc/db admin:add | admin:remove | admin:reset-2fa <email>`.
- Rate limits shared through Redis (API keys, tracked links, sign-in) with in-process fallback; fair share of the send line between workspaces (`packages/shared/src/fair-share.ts`).

#### Needs the owner (cannot be done from here)
- Real Meta (app id and secret, webhook verify token, permanent token, Embedded Signup config), Razorpay keys and webhook secret, an email provider, Shopify and Google client ids.
- Company details in the live environment: `COMPANY_ADDRESS`, `COMPANY_GSTIN`, `SUPPORT_EMAIL`, `GRIEVANCE_OFFICER_NAME`; `REDIS_URL` on the live server if shared rate limits are wanted there.
- The DigiXO number +91 85094 46805 (registered on another WhatsApp account).
- The VM move to the paid Google account (new VM exists, no data copied).

#### Not built
Staff billing actions on a paying customer (cancel, refund, change subscription; needs real Razorpay), lead scoring (parked), send-time testing, off-machine backups, one VM only (web, worker, Postgres and backups share it).

#### Working notes that cost time to learn
- `lbc-deploy` runs every suite against the DEV database. Stop the dev worker first (`ss -ltnp | grep :4000`), or its timers race the tests. Two older worker tests (journey ordering, media fetch sharing) failed once under load and then passed in 18 reruns; if they fail again, look at those two specifically.
- `lbc-deploy` refuses uncommitted work, and `apps/web/tsconfig.tsbuildinfo` gets dirty after a build: `git checkout -- apps/web/tsconfig.tsbuildinfo` before deploying.
- Mutation-test security and money rules (break the code on purpose, confirm a test fails). Scripts live in `~/.hermes/devrun/mut*.py` (not in the repo). When a break survives, a test is missing; add it, do not delete the break.
- Do not `pkill -f` or `pgrep -f` a pattern that appears in your own command: it kills your own shell. Find the pid with `ss -ltnp` or `ps` and kill that.
- The browser tool cannot shrink its window; to check 360px, load the page in an in-page iframe sized to 360px and read its `scrollWidth`.
