# RESUME procedure (run when the human says "resume")

We're starting a new work session. The previous session may have been run by the other developer.

1. Run `git fetch --all` and `git status`. If I have uncommitted local changes, stop and tell me before doing anything else.
2. Check out `dev` and `git pull`. If the latest handover in `docs/PROGRESS.md` names a feature branch that is still open, check that branch out and pull it.
3. Read `AGENTS.md`, then the **Latest handover** section of `docs/PROGRESS.md`, then `docs/open-questions.md`.
4. Make sure the local environment works: install dependencies (`pnpm install`), start Docker services (`infra/docker-compose.dev.yml`), run pending migrations, check `.env` has every variable in `.env.example` (list any missing by name only).
5. Run lint, typecheck and tests, and report the results.
6. Give me a briefing in at most 10 lines: what the app can do now, what was done last session, known bugs, and the proposed next task (with the spec section to read).
7. Wait for my go-ahead before writing code. When I agree, re-read the relevant spec sections and present a plan first.
