#!/bin/bash
# Deploys what is in /srv/lbc/inbox/src.tgz (or a git ref) as a new release, and rolls back by itself if the health check fails.
# Usage: sudo deploy.sh [tarball]     Rollback by hand: sudo deploy.sh --rollback
set -euo pipefail
APP=/srv/lbc/app; REL=/srv/lbc/releases; TS=$(date -u +%Y%m%d-%H%M%S)
health() { for i in $(seq 1 30); do curl -fsS -m 3 http://127.0.0.1:3000/login -o /dev/null && curl -fsS -m 3 http://127.0.0.1:4000/healthz -o /dev/null && return 0; sleep 2; done; return 1; }
if [ "${1:-}" = "--rollback" ]; then P=$(ls -1dt $REL/*/ | sed -n 2p); [ -n "$P" ] || { echo "no previous release"; exit 1; }
  echo "rolling back to $P"; systemctl stop lbc-web lbc-worker; rsync -a --delete --exclude node_modules --exclude .next "$P/" $APP/; chown -R lbc:lbc $APP
  systemctl start lbc-worker lbc-web; health && echo "rollback healthy" && exit 0 || { echo "rollback UNHEALTHY"; exit 1; }; fi
SRC=${1:-/srv/lbc/inbox/src.tgz}; [ -f "$SRC" ] || { echo "missing $SRC"; exit 1; }
BAD='(^/|(^|/)\.\.(/|$)|(^|/)\.env($|\.[A-Za-z]))'
if tar tzf "$SRC" | grep -E "$BAD" | grep -vq '\.env\.example$'; then echo "refusing: archive has unsafe paths or an .env file"; exit 1; fi
/srv/lbc/infra/backup.sh                                   # always take a database backup first
mkdir -p $REL/$TS && tar xzf "$SRC" -C $REL/$TS && chown -R lbc:lbc $REL/$TS
systemctl stop lbc-web lbc-worker
rsync -a --delete --exclude node_modules --exclude .next --exclude storage-data $REL/$TS/ $APP/ && chown -R lbc:lbc $APP
sudo -u lbc bash -c "cd $APP && set -a && . /etc/lbc/app.env && set +a && pnpm install --frozen-lockfile --prefer-offline >/dev/null && pnpm --filter @lbc/db db:migrate && cd apps/web && pnpm exec next build" 
systemctl start lbc-worker lbc-web
if health; then echo "deploy $TS healthy"; ls -1dt $REL/*/ | tail -n +6 | xargs -r rm -rf; else echo "deploy $TS UNHEALTHY, rolling back"; "$0" --rollback; exit 1; fi
