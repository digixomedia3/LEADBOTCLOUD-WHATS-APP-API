#!/bin/bash
# Deploys what is in /srv/lbc/inbox/src.tgz (or a git ref) as a new release, and rolls back by itself if the health check fails.
# Usage: sudo deploy.sh [tarball]     Rollback by hand: sudo deploy.sh --rollback
set -euo pipefail
APP=/srv/lbc/app; REL=/srv/lbc/releases; TS=$(date -u +%Y%m%d-%H%M%S)
health() { for i in $(seq 1 30); do curl -fsS -m 3 http://127.0.0.1:3000/login -o /dev/null && curl -fsS -m 3 http://127.0.0.1:4000/healthz -o /dev/null && return 0; sleep 2; done; return 1; }
if [ "${1:-}" = "--rollback" ]; then P=""; for d in $(ls -1dt $REL/*/ | sed -n '2,$p'); do [ -f "$d/package.json" ] && [ -d "$d/apps/web" ] && { P=$d; break; }; done; [ -n "$P" ] || { echo "no complete previous release"; exit 1; }
  echo "rolling back to $P"; systemctl stop lbc-web lbc-worker; rsync -a --delete --exclude node_modules --exclude .next "$P/" $APP/; chown -R lbc:lbc $APP
  systemctl start lbc-worker lbc-web; health && echo "rollback healthy" && exit 0 || { echo "rollback UNHEALTHY"; exit 1; }; fi
[ "$#" -eq 0 ] || { echo "usage: deploy.sh   (no arguments; the archive is always /srv/lbc/inbox/src.tgz)  or  deploy.sh --rollback"; exit 2; }
SRC=/srv/lbc/inbox/src.tgz; [ -f "$SRC" ] || { echo "missing $SRC"; exit 1; }
tar tzf "$SRC" >/tmp/lbc-archive.list 2>/dev/null || { echo "refusing: $SRC is not a valid gzip tar archive"; exit 1; }
for must in package.json pnpm-lock.yaml apps/web/package.json apps/worker/package.json packages/db/package.json; do
  grep -qx "$must" /tmp/lbc-archive.list || { echo "refusing: archive has no $must, so it is not a LeadBotCloud source tree"; exit 1; }
done
BAD='(^/|(^|/)\.\.(/|$)|(^|/)\.env($|\.[A-Za-z]))'
if tar tzf "$SRC" | grep -E "$BAD" | grep -vq '\.env\.example$'; then echo "refusing: archive has unsafe paths or an .env file"; exit 1; fi
/srv/lbc/infra/backup.sh                                   # always take a database backup first
mkdir -p $REL/$TS && tar xzf "$SRC" -C $REL/$TS && chown -R lbc:lbc $REL/$TS
[ -f $REL/$TS/package.json ] && [ -d $REL/$TS/apps/web ] && [ -d $REL/$TS/packages/db/drizzle ] || { echo "refusing: unpacked release is incomplete; nothing was changed"; rm -rf $REL/$TS; exit 1; }
trap 'rc=$?; if [ $rc -ne 0 ]; then echo "deploy failed (exit $rc): bringing the site back"; if [ -n "$(ls -1dt $REL/*/ 2>/dev/null | sed -n 2p)" ]; then "$0" --rollback || true; else systemctl start lbc-worker lbc-web || true; fi; fi' EXIT
systemctl stop lbc-web lbc-worker
rsync -a --delete --exclude node_modules --exclude .next --exclude storage-data $REL/$TS/ $APP/ && chown -R lbc:lbc $APP
sudo -u lbc bash -c "cd $APP && set -a && . /etc/lbc/app.env && set +a && pnpm install --frozen-lockfile --prefer-offline >/dev/null && pnpm --filter @lbc/db db:migrate && cd apps/web && pnpm exec next build" 
systemctl start lbc-worker lbc-web
if health; then trap - EXIT; echo "deploy $TS healthy"; ls -1dt $REL/*/ | tail -n +6 | xargs -r rm -rf; else trap - EXIT; echo "deploy $TS UNHEALTHY, rolling back"; "$0" --rollback; exit 1; fi
