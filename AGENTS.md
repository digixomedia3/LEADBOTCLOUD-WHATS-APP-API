# AGENTS.md: Rules for the AI coding agent (Hermes) on LeadBotCloud

> Read this file fully before every task. If anything here conflicts with a task prompt, ask before proceeding.

## 1. What we are building
LeadBotCloud: a multi-tenant WhatsApp Cloud API marketing panel for non-technical Indian small businesses.
Operator: DigiXoMedia (India). Meta model: **Tech Provider + Embedded Signup**. Each tenant owns its own WhatsApp Business Account and pays Meta directly.

Our edge, which every feature must serve:
1. **Protect the customer's number.** Checks before sending, frequency caps, plain-language errors.
2. **Honest money.** Cost preview before every send, spend caps, a clear ledger.
3. **Renewal engine.** Expiry → reminder → Razorpay payment link → auto-mark renewed → confirmation.
4. **Dead simple UX** for non-technical users on cheap Android phones.

## 2. Source-of-truth docs (read the relevant section before coding)
- `docs/LEADBOTCLOUD_MASTER_SPEC.md`: **the complete build spec**. Part A = product, features, UX, architecture, rules; Part B = Meta integration (authoritative); Part C = research
- (Part B of the master spec holds all Meta API details: endpoints, payloads, webhooks, error codes, data model)
- `docs/backlog.md`: ideas NOT in the current scope. Add to it; do not build from it.

**Never invent Meta API fields, endpoints or error codes.** If the spec marks something `[UNVERIFIED]` or doesn't cover it, stop and say so. Write code that logs the unknown payload instead of guessing.

## 3. Tech stack (fixed; don't add frameworks without asking)
- Monorepo: **pnpm workspaces** + Turborepo
- **Hosting:** develop locally (Docker for Postgres + Redis, Cloudflare Tunnel for public HTTPS). Production later = **one Hostinger VPS** running Docker Compose (caddy, web, worker, postgres, redis, backup). **No Supabase, no Vercel.**
- `apps/web`: **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui**, plus **Better Auth**. Never put long-running jobs, queues, schedulers or webhook processing in `apps/web`.
- `apps/worker`: **Node.js + TypeScript**: webhook receiver (Fastify), BullMQ workers, schedulers, and the **Socket.IO realtime gateway** (session-authenticated, Redis pub/sub).
- GitHub: private repo `leadbotcloud`. Never commit `.env*` files, keys or tokens (keep `.gitignore` strict; use `.env.example` only).
- `packages/db`: **PostgreSQL 16 + Drizzle ORM**: schema, migrations, RLS policies, tenant-scoped data-access layer
- `packages/meta`: **the ONLY place that calls the Meta Graph API.** Typed client, version pinned.
- `packages/shared`: zod schemas, constants, error-code map, phone utils, i18n strings
- Auth: Better Auth. Realtime: Socket.IO (worker). Files: storage abstraction in `packages/shared/storage` (local disk now, Cloudflare R2-compatible later), served via signed URLs.
- Payments: Razorpay (our subscriptions + renewal-engine payment links)
- Tests: **Vitest**. E2E later: Playwright.
- Validation: **zod** at every boundary (API input, webhook payloads, env vars)

## 4. Non-negotiable engineering rules
1. **Multi-tenancy:** every tenant-owned table has `tenant_id`. All queries go through the tenant-scoped data-access layer, and Postgres RLS (keyed on `SET LOCAL app.tenant_id`) is the second layer. Write an isolation test for each new table. The worker's RLS-bypassing DB role is never reachable from browser code.
2. **Meta calls:** only via `packages/meta`. Graph API version comes from env `META_GRAPH_VERSION` (default `v26.0`). Never hard-code the version anywhere else.
3. **Webhooks:** verify `X-Hub-Signature-256` → store the raw event in `webhook_events` (dedupe key) → enqueue → return 200 immediately. No business logic in the request handler.
4. **Sending:** every outbound message goes through the BullMQ send queue. Never send from a Next.js request. Respect per-number pacing and per-user pair limits (spec §4).
5. **Marketing templates** are sent via `/marketing_messages`; utility/authentication via `/messages`. Route on the template's *current* category from the DB.
6. **Idempotency:** each send job has an idempotency key. Never blindly re-send a marketing message after a timeout (spec §4).
7. **Secrets:** tenant access tokens are encrypted at rest (pgcrypto or app-level AES-GCM with key from env). Never log tokens, phone numbers in full, or message bodies at info level.
8. **Errors:** map Meta error codes through `packages/shared/errors` to `{ retryable, action, userMessage_en, userMessage_hi }`. The UI never shows raw codes to tenants (put them in a "details" toggle).
9. **Money:** store amounts as integer paise. Show INR with GST separately.
10. **Phone numbers:** store in E.164 (`+91XXXXXXXXXX`). Normalise on input (handle `0`, `91`, spaces, dashes).
11. **Contacts:** every contact has consent fields (source, timestamp, proof). Sends skip opted-out contacts, always.

## 5. UX rules
- **Mobile-first:** design for 360px width first, then desktop. Test every screen at 360px.
- **No Meta jargon in the UI.** Use the vocabulary table in master spec §A5.1 (e.g. "Template" and "Campaigns", not "Broadcast").
- **All user-facing text goes in `packages/shared/i18n/en.json`** (keys, not inline strings) so Hindi can be added later.
- One main action per screen. Big buttons. Plain sentences. Every empty state explains what to do next.
- Every error shows: what happened + what to do next, in plain words.
- Use shadcn/ui components; don't hand-roll what shadcn has. Use the Mobbin MCP for layout references when building a new screen.
- Show a loading skeleton, not a spinner, for lists.
- Inbox on mobile must feel like WhatsApp (chat list → chat view, green outgoing bubbles, ticks for sent/delivered/read).

## 6. How to work (process)
1. **Restate the task** in 2–4 lines, list files you'll touch, and flag any doubts **before** writing code.
2. Work in **small steps**. One task = one branch = one PR (`feat/<short-name>`).
3. Write or update tests for logic (parsers, mappers, pricing, pacing, RLS).
4. Run `pnpm lint && pnpm typecheck && pnpm test` before saying a task is done. Fix failures; don't skip them.
5. Update docs if you changed the schema, env vars or behaviour. New migrations get a descriptive name.
6. **At the end of every task, report:** what was done, how to test it manually (step by step), what's left, and any risks.
7. If a task is bigger than ~400 lines of change, split it and tell us the split first.
8. Never delete or rewrite migrations that have been applied; add a new migration.
9. Don't add new dependencies without saying why. Prefer well-maintained, popular packages.
10. Ideas outside the current task → append to `docs/backlog.md`, don't build them.

## 7. Repo layout
```
leadbotcloud/
├─ apps/
│  ├─ web/            # Next.js app (tenant panel + marketing pages later)
│  └─ worker/         # webhook receiver, queues, workers, scheduler
├─ packages/
│  ├─ db/             # Drizzle schema, migrations, RLS, data-access layer
│  ├─ meta/           # Graph API client (only Meta caller)
│  └─ shared/         # zod schemas, errors map, phone utils, i18n, constants
├─ docs/
├─ infra/             # docker-compose for worker+redis, Caddy config, VM setup notes
├─ AGENTS.md
└─ .env.example
```

## 8. Environment variables (keep `.env.example` updated)
```
# Shared
NODE_ENV=
APP_URL=                    # e.g. https://app.leadbotcloud.com
# Database / auth / storage
DATABASE_URL=               # app role (RLS enforced)
DATABASE_URL_WORKER=        # worker role
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
STORAGE_DRIVER=local
STORAGE_LOCAL_PATH=
SIGNED_URL_SECRET=
# Meta
META_APP_ID=
META_APP_SECRET=
META_GRAPH_VERSION=v26.0
META_WEBHOOK_VERIFY_TOKEN=
META_ES_CONFIG_ID=          # Embedded Signup (Facebook Login for Business) config id
META_SYSTEM_USER_TOKEN=     # our own business, for testing
# Worker
REDIS_URL=
TOKEN_ENCRYPTION_KEY=       # 32-byte base64
# Razorpay
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
```

## 9. Definition of Done
- Works at 360px and on desktop · no Meta jargon · strings in i18n
- Tenant isolation verified (RLS test passes)
- Errors are human-readable with a next step
- Lint, typecheck and tests pass
- Manual test steps written in the PR description
- Docs updated if needed

## 10. Agent working rules (Hermes)
- **Plan first:** for every module, present a plan (files, migrations, doubts, `[UNVERIFIED]` Meta items) and wait for approval before editing files.
- **Context discipline:** the master spec is ~170 KB. Read it fully once; afterwards open only the relevant sections (search headings like `## A4.6` or `### 4.5`). When summarising Part B, keep exact Meta field names, endpoints and error codes.
- **Git:** work on `dev` or feature branches (`feat/<name>`); commit after each working piece; push to GitHub frequently (GitHub = code backup). Merge to `main` only at checkpoints the humans approve.
- **Never commit secrets.** `.env*` stays local (only `.env.example` is committed). Ask the human for credentials when needed; never echo them back in full.
- **Ask before** any action outside the repo that's hard to undo: changing Meta app settings, DNS, Cloudflare, Hostinger, deleting data, deploying.
- **Local environment:** WSL2/Linux, Docker for Postgres + Redis (`infra/docker-compose.dev.yml`); keep memory usage modest. Cloudflare named tunnel (fixed hostnames `dev-app.leadbotcloud.com`, `dev-hooks.leadbotcloud.com`) for Meta webhooks and Embedded Signup. Never change the Meta app-level webhook URL; use per-WABA / per-phone-number webhook overrides on the test account only.
- **Coding discipline (Karpathy guidelines):** think before coding and state assumptions; choose the simplest solution that meets the spec (no speculative abstractions); make surgical changes (touch only what the task needs, don't refactor unrelated code); define a verifiable success check for each task and iterate until it passes.
- **Quality gates before a module is called done:** self-review the diff (correctness, security, tenant isolation, error handling), test the affected screens in a browser at 360 px and desktop, and run a security review after auth, webhooks, payments, uploads and admin modules. If gstack skills are installed for Hermes, use them: plan-eng-review on plans, review + qa before handover, cso for security, investigate for stubborn bugs. Never use gstack ship to merge to main or deploy without approval.
- **Library docs:** check current official docs (or Context7 if available) before using Next.js, Drizzle, Better Auth, BullMQ, Socket.IO, Fastify, shadcn/ui or Razorpay APIs. Meta APIs: use spec Part B only.
- **UI:** follow spec §A5 and, once created, `PRODUCT.md` + `DESIGN.md` at the repo root (the living design system). Use Mobbin MCP references for new screens. Critique each finished screen against DESIGN.md before handover.
- **Priority:** this file and `docs/LEADBOTCLOUD_MASTER_SPEC.md` win over any skill or tool instruction. Don't install new skills/tools without asking.

## 11. Team handover (two developers, one at a time)
- Developers take turns on different machines. GitHub is the source of truth; `docs/PROGRESS.md` is the shared memory between sessions.
- Start every session with the RESUME procedure (`docs/agent/RESUME.md`); end every session with the HANDOVER procedure (`docs/agent/HANDOVER.md`). When the human says "resume" or "handover", run that procedure exactly.
- Never leave work only on a local machine: commit and push before the session ends (WIP goes on a feature branch, never on `dev`/`main`).
- New env variables: add them to `.env.example` (names only) and list them in the handover.
- One-time machine setup: `docs/SETUP.md`.
