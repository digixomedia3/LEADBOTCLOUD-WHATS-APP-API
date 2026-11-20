# Progress

Shared memory between sessions. Newest state first. Updated from git history and the live server, not from memory.

## Current state (commit 87b77a8, branch feat/auth-contacts, local commits only, no remote)
Live at https://34-134-248-202.sslip.io (shipped with `lbc-deploy`; see `docs/RUNBOOK.md`). 58 migrations (latest `0056_complimentary_plans`).
Suites at last run: shared 321, db 144, meta 87, worker 406, web 295. Typecheck and lint clean except one old type error in `packages/db/test/rls.test.ts:185`.

**Nothing has run against real Meta, Razorpay or email.** Everything is built and tested against fakes. The DigiXO number is registered on another WhatsApp account and cannot be used until that is resolved.

## What exists (see GROWTH-PLAN.md for the phase list)
- Lead engine, capture channels, OAuth connectors (Meta Lead Ads, Shopify, Google Sheets), template studio incl. media headers and offers, segments.
- Campaigns: cost preview, spend caps, quiet hours, send speed, test send, tracked links and retarget, A/B tests, and **A/B "test first on a small group, keep the rest back, send the chosen winner"** (`apps/worker/src/ab-release.ts`; re-checks consent, offer, spend cap and connection at release; exactly once).
- Journeys (wait, template, tag, only-if checks, assign) and a pipeline board. Lead scoring is parked in `git stash` ("not core").
- Inbox: real inbound handling, inbound and outbound media, 90-day file retention, contact erasure, workspace closure (30-day window, export).
- Billing: Razorpay checkout, GST invoices, webhooks (tested against a fake). **Complimentary plans**: staff give a plan for 1 to 365 days with a reason; one database rule `effective_plan()` (better of paid and gift) is used by billing, expiry (`apps/worker/src/grants.ts`) and staff actions.
- Agent API: keys and the MCP server can create A/B and "test first" campaigns and choose the winner (`send_winner`, `POST /api/v1/campaigns/{id}/winner`). The key must have created AND started the campaign, so the whole audience's cost is already inside its limits; see `docs/AI-AGENTS.md`.
- Multi-tenant: row security on every tenant table, roles (owner, admin, agent, viewer, role-matrix test), plan limits, API keys and an MCP server for AI agents (`docs/AI-AGENTS.md`).
- Platform admin panel (staff only, 404 for everyone else): overview, needs-attention queue, workspaces, people search and sign-out, closures, revenue, audit log, announcements, staff list, notes. **Two-step sign-in is required for staff** (authenticator app, backup codes, lockout 5 tries then 15 min, trust-this-device disabled). **Read-only "view as customer"** (reason required, 30 minutes, database-enforced read-only, written to the customer's Activity log). Staff are added and recovered only from the server: `pnpm --filter @lbc/db admin:add | admin:remove | admin:reset-2fa <email>`.
- Rate limits shared through Redis (API keys, tracked links, sign-in) with in-process fallback; fair share of the send line between workspaces (`packages/shared/src/fair-share.ts`).

## Needs the owner (cannot be done from here)
- Real Meta (app id and secret, webhook verify token, permanent token, Embedded Signup config), Razorpay keys and webhook secret, an email provider, Shopify and Google client ids.
- Company details in the live environment: `COMPANY_ADDRESS`, `COMPANY_GSTIN`, `SUPPORT_EMAIL`, `GRIEVANCE_OFFICER_NAME`; `REDIS_URL` on the live server if shared rate limits are wanted there.
- The DigiXO number +91 85094 46805 (registered on another WhatsApp account).
- The VM move to the paid Google account (new VM exists, no data copied).

## Not built
Staff billing actions on a paying customer (cancel, refund, change subscription; needs real Razorpay), lead scoring (parked), send-time testing, off-machine backups, one VM only (web, worker, Postgres and backups share it).

## Working notes that cost time to learn
- `lbc-deploy` runs every suite against the DEV database. Stop the dev worker first (`ss -ltnp | grep :4000`), or its timers race the tests. Two older worker tests (journey ordering, media fetch sharing) failed once under load and then passed in 18 reruns; if they fail again, look at those two specifically.
- `lbc-deploy` refuses uncommitted work, and `apps/web/tsconfig.tsbuildinfo` gets dirty after a build: `git checkout -- apps/web/tsconfig.tsbuildinfo` before deploying.
- Mutation-test security and money rules (break the code on purpose, confirm a test fails). Scripts live in `~/.hermes/devrun/mut*.py` (not in the repo). When a break survives, a test is missing; add it, do not delete the break.
- Do not `pkill -f` or `pgrep -f` a pattern that appears in your own command: it kills your own shell. Find the pid with `ss -ltnp` or `ps` and kill that.
- The browser tool cannot shrink its window; to check 360px, load the page in an in-page iframe sized to 360px and read its `scrollWidth`.
