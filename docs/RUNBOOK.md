# Production runbook (single VM)

**Where:** Google Cloud VM `lbc-panel` (us-central1-a), Debian 13, e2-standard-2. Public address is the reserved IP `lbc-ip`.
**Layout:** Caddy (80/443, automatic HTTPS) in front of the web app (:3000) and the worker (:4000). Postgres 16 and Redis 7 run in Docker, bound to localhost only.

| Thing | Where |
|---|---|
| App code (current release) | `/srv/lbc/app` (owned by user `lbc`) |
| Past releases (last 5) | `/srv/lbc/releases/<timestamp>` |
| Settings and secrets | `/etc/lbc/*.env` (root only, app.env readable by `lbc`) |
| Database files | `/srv/lbc/data/pg` |
| Nightly backups (14 days) | `/srv/lbc/backups` |
| Web server log | `/var/log/caddy/lbc.log` |
| Service logs | `journalctl -u lbc-web -u lbc-worker` |

## Update
1. Change and test on the development machine (`pnpm lint && pnpm typecheck && pnpm test`).
2. Commit. Build the archive from the commit: `git archive --format=tar.gz -o /tmp/src.tgz HEAD`
3. Copy it to the server inbox and run the deploy script as the `deploy` user:
   `scp /tmp/src.tgz deploy@HOST:/var/lib/lbc-inbox/src.tgz && ssh deploy@HOST 'sudo /srv/lbc/infra/deploy.sh'`
   The script takes a database backup, unpacks a new release, installs, **applies new migrations**, builds, restarts, checks health,
   and **rolls the code back by itself if the health check fails**.
4. Open `https://HOST/login` and check it still loads.

Rollback by hand: `ssh deploy@HOST 'sudo /srv/lbc/infra/deploy.sh --rollback'`.
**Important:** a rollback restores the code, not the database. Migrations only ever add, so older code keeps working with a newer database.
If a migration itself is bad, restore from `/srv/lbc/backups` (the command is at the top of `backup.sh`).

## Who can do what on the server
- `lbc-deploy` (on the Hermes VM) logs in as the `deploy` account with a key. That account may run only: `deploy.sh` (no arguments), `deploy.sh --rollback`,
  `backup.sh` (no arguments), `docker ps` and `systemctl status` for the three services. It cannot read `/etc/lbc`, and SSH to the server is only open to
  the Hermes VM and Google's IAP range.
- Deploying means shipping code that runs on the server with the app's settings, so whoever can deploy can in effect read the app's secrets by writing code.
  That is the price of letting Hermes update the site by itself. Keep Hermes's own access tight and review what it ships.

## Rules
- Never put `.env` files or tokens in the archive (`deploy.sh` refuses any archive containing one).
- Never edit files in `/srv/lbc/app` by hand: the next deploy overwrites them. Change the repository and deploy.
- Meta, Razorpay and Shopify secrets go in `/etc/lbc/app.env` (names are in `.env.example`), then `sudo systemctl restart lbc-web lbc-worker`.
- The server has no Google Cloud credentials on purpose. Do not add any.

## Not set up yet
- Real mail sending (`MAIL_TRANSPORT=console`: password-reset links appear in the web log).
- A custom domain: until then the address is `<ip-with-dashes>.sslip.io`, which has a real certificate. When a domain is added, change `APP_URL`,
  `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, `WORKER_PUBLIC_URL` and the Caddyfile together, and do it before any template using a tracked link is approved
  (the address is fixed into the template by Meta).
- Off-machine backups. Backups live on the same disk as the database.
