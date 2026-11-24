# LeadBotCloud

**A multi-tenant WhatsApp Cloud API marketing and inbox platform for small Indian businesses.**
Lead capture, template studio, campaigns with cost preview and spend caps, journeys, a shared team inbox, GST billing, and an API for AI agents. Built to be simple on a cheap Android phone and safe for the customer's WhatsApp number.

> **Status: feature-complete in a sandbox, not yet proven against real services.**
> Everything below is built and tested against fakes of Meta, Razorpay, Shopify, Google and SMTP. **Not one real WhatsApp message has been sent, no real payment has been taken, and no real email has been delivered.** Read [What is and is not verified](#what-is-and-is-not-verified) before relying on any of it.

Operator: DigiXoMedia (India). Meta model: **Tech Provider + Embedded Signup**. Each customer ("workspace") owns its own WhatsApp Business Account and pays Meta directly. LeadBotCloud charges only its own subscription.

---

## Contents

1. [What it does](#what-it-does)
2. [What is and is not verified](#what-is-and-is-not-verified)
3. [Architecture](#architecture)
4. [Repository layout](#repository-layout)
5. [Quick start (local development)](#quick-start-local-development)
6. [Configuration reference](#configuration-reference)
7. [Database, tenancy and row-level security](#database-tenancy-and-row-level-security)
8. [The web app](#the-web-app)
9. [The worker](#the-worker)
10. [Sending messages: the rules that protect a customer's number](#sending-messages-the-rules-that-protect-a-customers-number)
11. [Campaigns, A/B tests and journeys](#campaigns-ab-tests-and-journeys)
12. [Lead capture and connectors](#lead-capture-and-connectors)
13. [Billing](#billing)
14. [Roles, platform staff and the admin panel](#roles-platform-staff-and-the-admin-panel)
15. [API and MCP server for AI agents](#api-and-mcp-server-for-ai-agents)
16. [Privacy, retention and workspace closure](#privacy-retention-and-workspace-closure)
17. [Email](#email)
18. [Testing](#testing)
19. [Deployment and operations](#deployment-and-operations)
20. [Security notes](#security-notes)
21. [What is not built](#what-is-not-built)
22. [Documentation map](#documentation-map)
23. [Contributing and working rules](#contributing-and-working-rules)

---

## What it does

**For a business owner and their team**

| Area | What you get |
|---|---|
| **Leads** | A lead inbox, hosted forms with QR codes, an embeddable website button, CSV and pasted-number import, IndiaMART and JustDial feeds, and a generic signed webhook. Duplicates are merged and consent is recorded. A lead is **not** treated as marketing consent. |
| **Connections** | OAuth connectors for Meta Lead Ads, Shopify and Google Sheets, with encrypted tokens, PKCE and a status page. |
| **Templates** | A builder with a live WhatsApp-style preview, a linter for Meta's rules, 17 starter templates, picture/video/PDF headers, limited-time offers and copy-code buttons. |
| **Campaigns** | Saved audience segments, a cost preview before every send, per-day spend caps, quiet hours, send speed, test sends, tracked links with click reports, retargeting, and A/B tests including "test on a small group, hold the rest, send the winner". A report page shows the funnel and exports CSV. |
| **Journeys** | Drip sequences started by a new lead, a tag or manually: wait, send a template, add a tag, check a condition (replied, clicked, tag), assign to a teammate. They stop on reply, opt-out or unreachable numbers. |
| **Chats** | A shared team inbox with real inbound handling, photos, voice, documents, locations and contacts both ways, quick replies, keyword auto-replies and STOP handling. |
| **Pipeline** | A board of leads by stage with value. |
| **Renewals** | Expiry reminders with a payment link, auto-marked paid. |
| **Analytics** | Delivery, read and reply rates, cost and sends per hour. |
| **Team** | Owner, admin, agent and viewer roles, invitations, seat limits per plan. |
| **Settings** | Business profile, quiet hours, team, WhatsApp number, plan and billing, API keys for AI assistants, two-step sign-in, data export and workspace closure. |

**For the platform operator (staff only, `/admin`)**: overview, a ranked "needs attention" queue, workspace search and detail, people search with sign-out, closures, revenue, audit log, announcements, staff list, private notes, **read-only "view as customer"**, and **complimentary plans**. Staff must use two-step sign-in.

---

## What is and is not verified

Be honest about this before you connect real money or a real number.

| Thing | State |
|---|---|
| Application logic, database rules, row-level security, role checks | Built and tested (suites below, zero type errors, zero lint warnings). |
| Sending, webhooks, templates, media, receipts | Tested against a **fake Meta server**. Never run against real Meta. |
| Razorpay checkout, invoices, webhooks | Tested against a **fake Razorpay**. No real payment has been taken. |
| Shopify, Google Sheets, Meta Lead Ads connectors | Tested against fake providers. |
| Email | Built and tested against a real local SMTP port. **Switched off** in production (`MAIL_TRANSPORT=console`); no provider is connected. |
| A real WhatsApp number | **None connected.** The DigiXO number was verified but is registered on another WhatsApp account and could not be migrated. |
| Real traffic, load, many tenants | Never run. Fair-share sending is unit-tested only. |

Nothing here should be called production-ready until a real template has been approved by Meta and delivered to a real phone. See [What is not built](#what-is-not-built) and `docs/PROGRESS.md`.

---

## Architecture

```
                    Internet
                       |
                 Caddy (80/443, automatic HTTPS)
                  /                  \
        apps/web  :3000          apps/worker :4000
   Next.js (App Router)           Fastify + BullMQ
   UI, server actions,            webhooks (Meta, Razorpay, Shopify),
   REST /api/v1, MCP /api/mcp     lead ingest, send queue, schedulers,
        |                         journeys, media, retention, closure
        |  app role (RLS ON)            |  worker role (BYPASSRLS)
        +------------- PostgreSQL 16 ---+
        |                               |
        +----------- Redis 7 -----------+   BullMQ queues, shared rate limits,
                                            fair-share send slots
```

- **Web** never sends WhatsApp messages and never runs long jobs. It writes a queued message and returns.
- **Worker** owns everything slow or external: it verifies webhooks, stores the raw event, enqueues, and returns 200 immediately. Business logic runs after.
- **Every outbound message** goes through the BullMQ send queue with an idempotency key, so a timeout can never double-send a marketing message.
- **Only `packages/meta` calls the Meta Graph API.** The version comes from `META_GRAPH_VERSION` (default `v26.0`).
- Postgres row-level security is the second tenant wall (the first is the tenant-scoped data layer).

Stack: pnpm workspaces and Turborepo, Node 24, TypeScript, Next.js, Tailwind, Better Auth, Drizzle ORM, PostgreSQL 16, Redis 7, BullMQ, Fastify, Vitest, Razorpay.

---

## Repository layout

```
leadbotcloud/
├─ apps/
│  ├─ web/        Next.js app: marketing page, auth, the tenant panel, /admin, REST + MCP API
│  └─ worker/     Fastify webhook receiver, BullMQ workers, schedulers
├─ packages/
│  ├─ db/         Drizzle schema, 58 migrations, RLS policies, tenant-scoped data layer, staff CLI
│  ├─ meta/       The only Meta Graph API client (typed, version-pinned)
│  ├─ shared/     zod schemas, plans, phone utils, template linter, segments, send windows, fair share, errors, i18n
│  └─ connectors/ OAuth core (PKCE, encrypted tokens) + Meta Lead Ads, Shopify, Google Sheets
├─ docs/          Master spec, growth plan, UI plan, runbook, progress, AI-agents guide, open questions
├─ infra/         Dev docker-compose, production compose, Caddy template, deploy/backup scripts, systemd units
├─ AGENTS.md      Rules for the AI coding agent that works on this repo
└─ .env.example   Names of every setting (no values)
```

Notable files: `apps/worker/src/send.ts` (the send path), `apps/worker/src/campaigns.ts` (launch), `apps/worker/src/ab-release.ts` (A/B winner release), `apps/worker/src/journeys.ts`, `apps/worker/src/timers.ts` (every background timer), `packages/shared/src/template-lint.ts`, `packages/shared/src/fair-share.ts`, `apps/web/src/lib/core/campaigns.ts` (shared by the panel and the API so rules cannot drift).

---

## Quick start (local development)

**Requirements:** Node.js 24 (`>=24 <25`), pnpm (version pinned in `package.json`; `corepack enable`), Docker, Git.

```bash
git clone https://github.com/digixomedia3/LEADBOTCLOUD-WHATS-APP-API.git
cd LEADBOTCLOUD-WHATS-APP-API        # the folder is called "leadbotcloud" in the docs
pnpm install

# 1. Postgres 16 (localhost:5433) and Redis 7 (localhost:6380), bound to localhost only
docker compose -f infra/docker-compose.dev.yml up -d

# 2. Settings
cp .env.example .env
#   Fill in the empty values. At minimum generate:
#     BETTER_AUTH_SECRET, SIGNED_URL_SECRET, INTERNAL_API_SECRET   (long random strings)
#     TOKEN_ENCRYPTION_KEY                                          (32 bytes, base64)
#   The three DATABASE_URL* values need the dev passwords from infra/postgres/init-roles.sql.

# 3. Create tables, policies and roles (runs as the database owner)
pnpm --filter @lbc/db db:migrate

# 4. Run the web app (3000) and the worker (4000) in two terminals
pnpm --filter @lbc/web dev
pnpm --filter @lbc/worker dev
```

Open http://localhost:3000, create an account, and you have an owner workspace.

**Meta, Razorpay, Shopify and Google are not needed to run it locally.** Without credentials the connect screens explain what is missing. The test suites use fakes.

**Public HTTPS for webhooks:** Meta, Razorpay and Shopify must reach the worker over HTTPS. For development use a Cloudflare tunnel to `localhost:4000` and set `WORKER_PUBLIC_URL`. See `docs/SETUP.md`.

**Running without real Meta:** the worker accepts an optional `META_GRAPH_BASE_URL`, so you can point it at a fake Graph server. While no real number is connected, Chats shows a dashed "Test mode" notice with buttons to simulate an incoming message; those buttons disappear once a real number is connected.

---

## Configuration reference

Every setting is a name in `.env.example`. **Never commit `.env`.** Secrets live in `/etc/lbc/app.env` on the server.

| Group | Names | Notes |
|---|---|---|
| Core | `NODE_ENV`, `APP_URL`, `MARKETING_URL`, `WORKER_URL`, `REALTIME_URL` | `APP_URL` is also the trusted origin for sign-in. |
| Database | `DATABASE_URL` (app, RLS on), `DATABASE_URL_WORKER` (worker, bypasses RLS), `DATABASE_URL_MIGRATE` (owner) | Three separate roles on purpose. |
| Redis | `REDIS_URL` | Queues, shared rate limits, fair-share slots. Without it rate limits fall back to per-process. |
| Auth | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_AUTH_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TRUSTED_ORIGINS` | |
| Files | `STORAGE_DRIVER` (`local`), `STORAGE_LOCAL_PATH`, `SIGNED_URL_SECRET` | R2-compatible storage is a planned driver, not built. |
| Meta | `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION`, `META_WEBHOOK_VERIFY_TOKEN`, `META_ES_CONFIG_ID`, `META_ES_VERSION`, `META_SYSTEM_USER_TOKEN` | Needed before any real send. |
| Encryption | `TOKEN_ENCRYPTION_KEY` | AES-GCM key for tenant tokens at rest. |
| Email | `MAIL_TRANSPORT` (`console` or `smtp`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | See [Email](#email). |
| Company | `COMPANY_LEGAL_NAME`, `COMPANY_ADDRESS`, `COMPANY_GSTIN`, `SUPPORT_EMAIL`, `SUPPORT_WHATSAPP`, `GRIEVANCE_OFFICER_NAME`, `GRIEVANCE_OFFICER_EMAIL` | Shown on legal pages and invoices. Missing values are reported, never invented. Must match the Meta Business verification. |
| Billing | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Use test-mode keys until you go live. |
| Worker | `WORKER_PUBLIC_URL`, `WORKER_INTERNAL_URL`, `TRUST_PROXY`, `INTERNAL_API_SECRET`, optional `META_GRAPH_BASE_URL`, `SHEETS_SYNC_MS` | `INTERNAL_API_SECRET` signs web-to-worker calls (lead import); the same value in both apps. |
| Retention | `FILE_RETENTION_DAYS` | Default 90, minimum 7. A non-numeric value falls back to 90. |

`packages/shared/src/env.ts` validates the environment with zod at startup, so a bad value fails fast with a readable message.

---

## Database, tenancy and row-level security

- **58 migrations** in `packages/db/drizzle/` (`0000_init_core` through `0056_complimentary_plans`). Applied migrations are never edited; changes are new migrations.
- **Every tenant-owned table has `tenant_id`.** All queries go through the tenant-scoped data layer, and Postgres RLS keyed on `SET LOCAL app.tenant_id` is the second wall. Each new table has an isolation test (`packages/db/test/rls.test.ts`).
- **Three database roles** (`infra/postgres/init-roles.sql`, development passwords only):
  - `owner`: runs migrations and owns tables. RLS does not apply to owners, so the app never uses it.
  - `app`: used by the web app. Not a superuser, `NOBYPASSRLS`.
  - `worker`: used by the worker. `BYPASSRLS`, never reachable from browser code.
- **Staff access** is by `platform_admins` rows and `SECURITY DEFINER` functions (`admin_*`) that check staff status and two-step sign-in inside the database and write an audit record.
- **Read-only "view as customer"** is enforced in the database layer: while a staff view is active, every write statement is refused, not just hidden in the UI.

```bash
pnpm --filter @lbc/db db:migrate            # apply migrations
pnpm --filter @lbc/db db:generate           # generate a migration from schema changes (drizzle-kit)
pnpm --filter @lbc/db admin:add you@x.com   # make an existing user platform staff
pnpm --filter @lbc/db admin:remove you@x.com
pnpm --filter @lbc/db admin:reset-2fa you@x.com   # recovery: clears 2FA, signs them out everywhere, audit-logged
```

---

## The web app

`apps/web` is Next.js (App Router) with Better Auth. Main areas under `src/app/(app)/`: `dashboard`, `get-started`, `leads`, `pipeline`, `campaigns` (and `campaigns/[id]` report), `contacts`, `chats`, `templates`, `template-library`, `automation`, `journeys`, `renewals`, `analytics`, `connections`, `quick-replies`, `consent`, `activity`, `help`, `settings`. Public: `/` (marketing), `/f/[slug]` (hosted forms), `/r/[code]` (tracked-link redirect), `/invite/[token]`, `/invoices`, and the legal pages (terms, privacy, acceptable use, messaging policy, refunds, data deletion).

Design rules (from `AGENTS.md`): mobile first at 360px, no Meta jargon in the UI ("Template" and "Campaigns", never "message format" or "broadcast"), light mode by default with a manual dark toggle, one main action per screen, every error says what happened and what to do next, strings centralised for later Hindi.

The Contacts, Chats and Settings screens have been swept at 360px and 390px; a layout test guards the two patterns that previously caused sideways scroll.

---

## The worker

`apps/worker` runs one Fastify server, BullMQ workers and timers.

**HTTP endpoints**

| Method and path | Purpose |
|---|---|
| `GET /healthz` | Health check. |
| `GET/POST /webhooks/meta` | Meta verification handshake and signed events (`X-Hub-Signature-256`). Stored raw with a dedupe key, then queued. |
| `POST /webhooks/razorpay` | Signed subscription events. Idempotent, with stale-event and duplicate-payment guards. |
| `POST /webhooks/shopify` | Signed Shopify events. |
| `POST /leads/:id`, `POST /forms/:slug` | Public lead ingest with per-source HMAC and CORS. |
| `POST /internal/leads/import` | HMAC-signed CSV import from the web app. |

**Background timers** (all through `every()` in `src/timers.ts`: failures are logged and never stop the process, and a slow run is never started twice): outbox sweeper (5 s), campaign launcher and due A/B winner releases (15 s), template submit and sync (20 s), connector events (20 s), Google Sheets sync (`SHEETS_SYNC_MS`), journeys (10 s), inbound media download (10 s), complimentary-plan expiry (60 s), retention (hourly), workspace closure (15 min).

---

## Sending messages: the rules that protect a customer's number

1. **Every send goes through the queue.** The web app never calls Meta.
2. **Consent is enforced at send time.** Opted-out contacts are always skipped; promotions also skip people with no permission record. STOP replies opt out automatically.
3. **Cost preview and spend caps.** Every campaign shows the estimated cost in paise (incl. GST) before it starts. A daily cap and, for API keys, a per-send limit apply under a lock.
4. **Quiet hours** (default 21:00 to 09:00 IST, promotional only) hold messages and release them later. Test sends and chat replies are never held.
5. **Send speed** defaults to 60 per minute (maximum 6000) and is spaced evenly.
6. **Fair share:** one workspace's big campaign cannot starve others. Chat replies are never held; the campaign lane is limited per workspace when others are active.
7. **Idempotency:** each message has a key; a marketing message is never blindly re-sent after a timeout.
8. **Template category routing:** marketing templates use `/marketing_messages`, utility and authentication use `/messages`, chosen from the template's current category in the database.
9. **Errors are translated.** Meta error codes map to `{ retryable, action, userMessage_en }`; the UI shows plain words and puts codes behind a "details" toggle.
10. **Offers that ended are never sent.** Countdown offers cannot be repeated.

---

## Campaigns, A/B tests and journeys

- **Segments** are one of six rule shapes (tag, source, lead status, last activity, clicked, read/replied in campaign X) compiled to SQL, with consent always winning over a segment.
- **Tracked links:** per-person `/r/<code>` redirects, https only, no shorteners, localhost or password URLs. Bots and previews are redirected but not counted. Abuse limits apply per address.
- **Retarget** (did not read, did not reply, replied, clicked, did not click, not delivered) re-checks consent at send time.
- **A/B tests** split deterministically by a hash of contact and campaign. Winner is judged with a pooled-proportion z-test, 95% interval, and at least 50 delivered per version. Only comparable templates (same category, offer and button type) can be tested. **"Test first, then send the winner to the rest"** holds the rest, re-checks opt-outs, unreachable numbers, template approval, connection, spend cap and ended offers when you release, and refuses with a stated reason.
- **Journeys** support triggers (manual, new lead, tag added), steps (wait, send template, add tag, gate on replied/clicked/tag/opted-out, assign round-robin or to a person), a daily enrolment cap, and stop on reply, opt-out or unreachable. A unique index prevents duplicate enrolment.

---

## Lead capture and connectors

- `lead_sources`, `leads` and `lead_events` with one signed public ingest endpoint per source, field mapping, phone normalisation to E.164, dedupe, UTM capture and consent modes.
- Hosted forms at `/f/[slug]`, QR codes (decoded and verified in tests), a website button snippet, CSV import (BOM, semicolons, Hindi headers, quoted line breaks, plan limit enforced before insert, malformed emails listed), and pasted-number import.
- Connectors (`packages/connectors`): OAuth with PKCE and encrypted tokens, plus Meta Lead Ads, Shopify and Google Sheets. Each needs a registered app under the operator's account and its own review (Meta needs `leads_retrieval`, `pages_manage_metadata`, `ads_management`). LinkedIn lead gen needs partner approval and is off.

---

## Billing

- **Razorpay Subscriptions** for LeadBotCloud's own plans (Free, Starter, Growth, Pro). Upgrade now; downgrade and cancel at period end.
- **GST invoices** with financial-year numbering and SAC 998439. Amounts are integer paise; GST is shown separately.
- **Webhook safety:** signature verification, idempotent events, stale-event guard, duplicate-payment guard.
- **Complimentary plans:** staff can gift a plan for 1 to 365 days with a written reason. One database function, `effective_plan()`, returns the better of the paid plan and any live gift, and is the only way a plan is read. A worker job ends expired gifts. Gifts are refused for workspaces with a paid subscription, and a payment event never erases a live gift.
- **Not built:** staff cancel, refund or change of a paying customer's subscription from the panel (needs real Razorpay).

---

## Roles, platform staff and the admin panel

**Workspace roles:** `owner`, `admin`, `agent`, `viewer`. A role-matrix test runs 30 server actions as each role and checks refusal below the minimum, allowance at or above it, and that nothing is written on refusal.

**Platform staff** are rows in `platform_admins`, added only from the server CLI. Non-staff get a 404 on every `/admin` route. Staff must enable an authenticator app; without it the panel stays closed with an explanation.

**Panel screens:** overview, needs-attention (ranked by severity), workspaces (search, detail, suspend/reactivate with a reason, flags, notes, send-error breakdown), people search and sign-out, closure queue, revenue (MRR, unpriced subscriptions flagged), audit log, announcements, staff list. Every staff action writes to the customer's own Activity log with the reason.

**View as customer:** a read-only 30-minute window with a written reason, a banner on every page, and a visible entry in the customer's Activity log. The database refuses every write while it is active.

---

## API and MCP server for AI agents

Settings, then **AI assistants**, creates a key (shown once; only a SHA-256 fingerprint is stored). Full guide: `docs/AI-AGENTS.md`.

- **REST** under `/api/v1`: `me`, `contacts`, `groups`, `templates`, `campaigns` (create, report, send, cancel), `campaigns/{id}/winner`.
- **MCP** at `/api/mcp` (Streamable HTTP, stateless: every request carries the key).
- **Permissions:** `contacts:read`, `contacts:write`, `templates:read`, `campaigns:read`, `campaigns:write` (create and cancel, never sends), `campaigns:send` (costs money). New keys get everything except send.
- **Money limits the assistant cannot argue around:** a per-send limit (default ₹500 incl. GST) and at most 3x that in any 24 hours. A key can only start campaigns it created. Starting happens once. A/B winner release only works on a campaign the same key created and started, so its cost is already inside the limits.
- **Consent is never implied:** adding a contact requires `agreedToMessages: true` and a source, stored with the contact and in the audit log.
- Rate limits: 120 calls per minute per key; 20 wrong keys per minute per address, then blocked for a minute. Requests carrying another site's `Origin` are refused.

---

## Privacy, retention and workspace closure

- **Retention:** customer and team files are removed after `FILE_RETENTION_DAYS` (default 90); orphan template uploads and failed downloads are cleaned hourly. The message stays, with a "removed to save space" notice.
- **Contact erasure:** deleting a contact blanks their number on campaign recipients and replaces stored webhook payloads with `{erased, kind}` via a database trigger. A test scans every text, JSON and array column for the number.
- **Workspace closure:** the owner types the workspace name to start a **30-day window** (a paid plan must be cancelled first). The owner can cancel any time; staff can cancel with a reason. After 30 days the worker erases every tenant table and the connection. It keeps the workspace row (name and GST details), invoices, the subscription record and the audit log, so the closure itself stays on record. Workspaces with a platform-staff member are skipped.
- **Data export:** owners can download contacts, chats, messages, leads, templates, campaigns, quick replies, journeys and invoices (no secrets). Capped at 50k contacts and 200k messages; file contents are not included.

The legal pages are a **draft, not legal advice**; have a lawyer check them, especially liability, the refund terms and the DPDP wording.

---

## Email

Built: password reset and "password changed", team invitations, workspace closing and closing-cancelled notices (`apps/web/src/lib/notify.ts`, `mail.ts`). Names typed by users are flattened to one line before they reach a header or body, so they cannot inject headers.

**It is switched off by default** (`MAIL_TRANSPORT=console` prints mail to the server log). The invite dialog says "We emailed them" only when a mail server actually accepted the message; otherwise it shows the link to share. To turn it on: set `MAIL_TRANSPORT=smtp` with `SMTP_HOST`, `SMTP_PORT` (465 uses SSL from the start; 587 should work through STARTTLS but is untested), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, add the provider's SPF and DKIM records, and test with a second address. See `docs/RUNBOOK.md`, "Turning email on".

---

## Testing

```bash
pnpm lint          # zero warnings enforced
pnpm typecheck     # 0 errors across the workspace
pnpm test          # all suites
```

Most suites need the dev Postgres and Redis running, because tests use **real Postgres with real RLS**, not mocks. The last full run, repeated three times clean:

| Package | Tests |
|---|---|
| `@lbc/shared` | 321 |
| `@lbc/db` | 144 |
| `@lbc/meta` | 87 |
| `@lbc/worker` | 415 |
| `@lbc/web` | 315 |

Practices that matter here:

- **Stop the dev worker before running suites.** Its timers race the tests. Find it with `ss -ltnp | grep :4000`.
- **Mutation testing** of security and money rules: break the code on purpose and confirm a test fails. When a break survives, a test is missing, so add one. Do not delete the break.
- A **role-matrix test**, **RLS isolation tests** per table, a **layout-rules test** for phone widths, and **real SMTP** and **real child-process** tests where mocks would hide failures.
- Do not `pkill -f` a pattern that appears in your own command: it kills your own shell.

---

## Deployment and operations

Production target: **one VM** running Caddy (automatic HTTPS), the web app (:3000), the worker (:4000), Postgres 16 and Redis 7 (Docker, localhost only), a nightly backup job and systemd units (`infra/prod/`).

Update flow (`docs/RUNBOOK.md`): test, commit, build an archive from the commit with `git archive`, upload it, and run `deploy.sh` as the restricted `deploy` user. The script takes a database backup, unpacks a new release, installs, **applies new migrations**, builds, restarts, checks health, and **rolls the code back by itself if the health check fails**. A rollback restores code, not the database; migrations only add, so older code keeps working.

- **Backups:** nightly at 00:30 UTC, 14 days kept, plus one before every deploy. A restore was tested into a scratch database and compared table by table. They are **on the same disk**; off-machine backups are not built.
- **Monitoring:** a script-only check every 10 minutes calls `/healthz` and `/login`, checks the data download still redirects, and checks the newest backup is under 30 hours old.
- **Rules:** never put `.env` files in an archive (`deploy.sh` refuses any archive containing one); never edit files on the server by hand; secrets go in `/etc/lbc/app.env`; the server holds no cloud credentials on purpose.

---

## Security notes

- Passwords: salted hashes via Better Auth. Two-step sign-in (TOTP plus single-use backup codes, lockout after repeated wrong codes, trust-device off) is **required for platform staff**.
- Tenant access tokens are encrypted at rest (AES-GCM). Nothing logs tokens, full phone numbers or message bodies at info level.
- Inbound files are served with a strict sandboxing policy, no sniffing, and only safe types inline; the Meta token is only ever sent to Meta hosts.
- Rate limits are shared through Redis (API keys, tracked links, sign-in) with an in-process fallback.
- **Development database passwords are committed** in `.env.example`, `infra/postgres/init-roles.sql` and test fallbacks. They are for local development only. **Rotate them and never reuse them in production.**
- The repository is intended to stay **private**: documentation and deploy scripts name the live server's address.

To report a security problem, contact the operator privately. Do not open a public issue.

---

## What is not built

- Real-world proof against Meta, Razorpay and an email provider (see the top of this file).
- Staff cancel, refund and change of a paying customer's subscription.
- Send-time testing for A/B tests.
- Lead scoring (parked: not core).
- Off-machine backups; a second VM; R2/S3 file storage.
- Carousel templates and WhatsApp Flows (marked unverified in the spec until checked against current Meta documentation).
- Hindi UI (strings are centralised for it, but only English exists).

---

## Documentation map

| File | What it is |
|---|---|
| `docs/LEADBOTCLOUD_MASTER_SPEC.md` | The complete build spec. Part A: product. Part B: Meta integration (authoritative for every Meta field, endpoint and error code). |
| `docs/GROWTH-PLAN.md` | The phased plan and the honest constraints per connector. |
| `docs/UI-PLAN.md` | Product and design plan. |
| `docs/RUNBOOK.md` | Production runbook: layout, update, rollback, backups, staff, turning email on. |
| `docs/PROGRESS.md` | Shared memory between work sessions. Current state, what exists, working notes. |
| `docs/AI-AGENTS.md` | Keys, permissions, MCP and REST for AI assistants. |
| `docs/SETUP.md` | One-time developer machine setup. |
| `docs/open-questions.md` | Unverified Meta details and decisions needed from the owners. |
| `docs/backlog.md` | Ideas outside the current scope. Do not build from it without approval. |
| `AGENTS.md` | Engineering rules for the AI coding agent. |

---

## Contributing and working rules

These come from `AGENTS.md`; the short version:

- **Never invent Meta API fields, endpoints or error codes.** If the spec marks something unverified, stop and say so; log the unknown payload instead of guessing.
- One task, one branch (`feat/<name>`), small steps. Run `pnpm lint && pnpm typecheck && pnpm test` before calling anything done.
- Write an isolation test for every new tenant table. Never edit an applied migration.
- Never commit `.env*` files, keys or tokens. New settings go into `.env.example` (names only).
- Test every screen at 360px and on desktop. No Meta jargon in the UI.
- Update `docs/PROGRESS.md` at the end of a session.

---

<sub>LeadBotCloud is a product of DigiXoMedia. All rights reserved unless a licence file says otherwise. There is currently no open-source licence.</sub>
