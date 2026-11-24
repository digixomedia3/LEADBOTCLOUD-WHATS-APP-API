# Progress

Shared memory between sessions (and between Deep and Abdullah). Newest state first. Updated from git history and a real test run, not from memory. Procedures: `docs/agent/RESUME.md`, `docs/agent/HANDOVER.md`.

## Latest handover: 2026-11-25 IST · by Deep (Hermes) · branch docs/progress-handover · based on main e187d87
### What was done this session
- Read-only audit of GitHub; set up a second machine (Deep's Hermes host) from scratch and ran every suite. No app code changed.
- Rewrote this file into the handover format. No feature work yet.
### Current state of the app (what works end to end right now)
- Same as the "Previous state" below: built and tested against fakes; live at https://34-134-248-202.sslip.io (58 migrations, latest `0056_complimentary_plans`). Nothing has run against real Meta, Razorpay or email.
- Branch facts: `main` (e187d87) is the real line of work and equals `feat/auth-contacts`. `dev` is STALE (stops at b749373, 12 Nov, 85 commits behind main). `wip/lead-scoring-parked` holds parked lead scoring. Do not branch from `dev`.
### How to run it locally (exact commands, any new env vars, migrations, seed data)
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
### How to test what changed
Docs only. Verify with: `pnpm lint && pnpm typecheck` and the suites below.
### Not finished / known bugs / failing tests
Run on 2026-11-25 against a fresh dev database (Node 24.22, pnpm 12.18). lint: 0 errors. typecheck: 0 errors on all 7 packages (the old `rls.test.ts:185` error is gone).
Tests: shared 321, db 144, meta 87, razorpay 17, connectors 35, web 315, worker 415, all pass when each package is run on its own.
- `pnpm test` through turbo drops the shell env (strict env mode) and fails ~149 web tests with "DATABASE_URL is required". Use `pnpm turbo run test --env-mode=loose` or run each package's tests directly.
- Suites share one dev database, so running everything in parallel is flaky. Seen once each, each passing alone on rerun: `web/test/super-admin-2.test.ts` (2 tests), `worker/test/retention.test.ts` ("each pass removes at most the batch size"). Same class of problem as the two worker tests already noted below.
- Deploy tooling (`lbc-deploy`, `~/.hermes/devrun/`) is NOT on Deep's machine; only the machine that ships to the live server has it.
### Next steps (ordered, with the spec section to read for each)
1. Decide the branch policy: keep working from `main` with `feat/*` branches, and fast-forward or retire `dev`.
2. Connect the real services, which only the owners can unblock (spec Part B + `docs/RUNBOOK.md`): Meta app credentials and Embedded Signup config, Razorpay keys and webhook secret, SMTP (RUNBOOK "Turning email on"), company details in the live environment.
3. Then new work from `docs/GROWTH-PLAN.md` (P3 to P8) or send-time testing; read the matching phase and spec section A4 first.
### Decisions made + open questions (also update docs/open-questions.md)
- Decision: both developers' Hermes sessions follow RESUME/HANDOVER; GitHub is the only channel between them.
- Open: Meta Advanced access? WABA billed in INR (needed before 31 Dec 2026)? Old panel still receiving webhooks? DigiXO number +91 85094 46805 is on another WhatsApp account. VM move to the paid Google account.
### Credentials/env changes the other developer needs (names only, never values)
None.

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
