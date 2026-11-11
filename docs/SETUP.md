# Developer setup (one time per machine)

## 1. Install
- Node.js LTS (the version in `.nvmrc`), pnpm (`corepack enable`; version pinned in `package.json` `packageManager`)
- Docker Desktop (running, WSL2 backend)
- Keep the repo inside the WSL2 filesystem (e.g. `~/leadbotcloud`), not under `/mnt/c/...` (much faster, fewer permission/line-ending issues)
- Git + GitHub CLI: `gh auth login` (joint GitHub account)
- Hermes agent (with the joint Claude auth, Sonnet 5.5)
- cloudflared (only on the machine that runs the Cloudflare named tunnel for Meta webhooks / Embedded Signup; there is no staging server yet)

## 2. Get the code
```
gh repo clone <joint-account>/leadbotcloud
cd leadbotcloud
pnpm install
```

## 3. Environment
- Copy `.env.example` to `.env` and fill in the values. Get them **privately** from the other developer (never via GitHub).
- Start services: `docker compose -f infra/docker-compose.dev.yml up -d`
- Run migrations and seed: see "How to run it locally" in the latest handover in `docs/PROGRESS.md`.

## 4. Start working
- Open Hermes in the repo folder and say: "resume" (it follows docs/agent/RESUME.md).
- Finish every session by saying: "handover" (docs/agent/HANDOVER.md).

## Rules
- Only one developer works at a time. Always "resume" first and "handover" last.
- Never commit `.env` files or customer data.
- Don't change Meta app settings or DNS without agreeing first.
