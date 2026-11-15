#!/bin/bash
# Nightly database dump, kept 14 days. Restore: gunzip -c FILE | docker exec -i lbc-postgres-1 psql -U postgres -d leadbotcloud
set -euo pipefail
D=/srv/lbc/backups; mkdir -p $D; F=$D/lbc-$(date -u +%Y%m%d-%H%M%S).sql.gz
docker exec lbc-postgres-1 pg_dump -U postgres -d leadbotcloud --no-owner --clean --if-exists | gzip -9 > "$F.tmp"
gunzip -t "$F.tmp" && mv "$F.tmp" "$F" && chmod 600 "$F"
find $D -name 'lbc-*.sql.gz' -mtime +14 -delete
echo "backup ok: $F ($(du -h "$F" | cut -f1))"
