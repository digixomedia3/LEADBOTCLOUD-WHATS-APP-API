---
name: lbc-live-ops
description: "Use when changing or deploying LeadBotCloud on its live server."
---

# LeadBotCloud live operations

LeadBotCloud (WhatsApp marketing panel) runs on its own Google Cloud VM, `lbc-panel`. You change the code here in `~/leadbotcloud`
and ship it with `lbc-deploy`. The user watches the live site and reviews your reports.

## Where things are
- Live site: https://34-134-248-202.sslip.io (valid certificate, reserved IP 34.134.248.202). Server internal address: 10.128.0.8.
- Code (your working copy): `~/leadbotcloud`, branch `feat/auth-contacts`. The server only ever receives a git archive of a **commit**.
- Server layout, update steps and recovery: `~/leadbotcloud/docs/RUNBOOK.md`. Read it before the first deploy of a session.
- Product rules and engineering rules: `~/leadbotcloud/AGENTS.md`. Growth plan: `docs/GROWTH-PLAN.md`.

## The loop (one small change at a time)
1. State the change in 2 to 4 lines. If it is bigger than about 400 lines, split it and say the split first.
2. Change the code. Add or update tests. Test the new behaviour for real, in the dev stack or a browser, not only with unit tests.
3. `git add` and `git commit` (local commits only).
4. `lbc-deploy`. It refuses uncommitted work, runs typecheck, lint and all tests, takes a database backup on the server, applies new
   migrations, builds, restarts, checks health, and rolls the code back by itself if the site is unhealthy.
5. Open the live page you changed and confirm it works. Then report: what changed, what you verified live, what is left, any risk.

`lbc-deploy --status` shows server health without changing anything. `lbc-deploy --rollback` restores the previous code.

## Hard rules
- **Never write, push or create anything on GitHub, ever** (the digixomedia account). Commits stay local.
- **No Google Cloud actions.** This VM and the panel VM have no cloud credentials on purpose. Never run `gcloud`, never add credentials, never create or
  delete VMs, disks or firewall rules. If infrastructure must change, tell the user and wait.
- **Never put secrets in the repository or in a deploy archive.** Server secrets live in `/etc/lbc/*.env` on the server; you cannot read them and should not need to.
- **Migrations only add.** Never edit an applied migration. Never write a migration that drops or rewrites customer data without asking first.
- **Ask first** before: changing Meta, Razorpay or Shopify settings, DNS or the public address (a tracked-link template fixes the address inside Meta), sending any real WhatsApp message, deleting data.
- A rollback restores code, not data. Say so if a migration is involved.
- Do not edit files on the server. The next deploy overwrites them. Change the repository and deploy.
- The WhatsApp number +91 85094 46805 is not registered with Meta yet, so nothing sends for real. Do not claim anything works against real Meta until it has.

## When something breaks
- Site down or unhealthy right after a deploy: the script rolls back by itself. Run `lbc-deploy --status` and tell the user what failed.
- You cannot read server logs directly. Ask the user, or reproduce locally. Do not look for another way in.
