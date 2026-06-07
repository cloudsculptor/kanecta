#!/bin/bash
# Configures the natively-installed PostgreSQL 18 cluster for Kanecta dev use:
#   - moves it to port 45432 (well away from the default 5432, which dev
#     environments often have occupied by Docker containers)
#   - creates the kanecta role/database
#   - enables the pgvector extension
#
# Run with sudo:
#   sudo bash setup-local-postgres.sh

set -euo pipefail

PORT=45432
CLUSTER_CONF=/etc/postgresql/18/main/postgresql.conf

if [[ $EUID -ne 0 ]]; then
  echo "Run this script with sudo: sudo bash $0" >&2
  exit 1
fi

echo "→ setting port = ${PORT} in ${CLUSTER_CONF}"
sed -i "s/^#\?port = .*/port = ${PORT}/" "$CLUSTER_CONF"
grep -n "^port" "$CLUSTER_CONF"

echo "→ restarting postgresql@18-main"
systemctl restart postgresql@18-main
sleep 2

echo "→ creating kanecta role (if not exists)"
sudo -u postgres psql -p "$PORT" -tc "SELECT 1 FROM pg_roles WHERE rolname='kanecta'" | grep -q 1 \
  || sudo -u postgres psql -p "$PORT" -c "CREATE ROLE kanecta LOGIN PASSWORD 'kanecta';"

echo "→ creating kanecta database (if not exists)"
sudo -u postgres psql -p "$PORT" -tc "SELECT 1 FROM pg_database WHERE datname='kanecta'" | grep -q 1 \
  || sudo -u postgres psql -p "$PORT" -c "CREATE DATABASE kanecta OWNER kanecta;"

echo "→ enabling pgvector extension in kanecta database"
sudo -u postgres psql -p "$PORT" -d kanecta -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo
echo "✓ done. Connection string:"
echo "  postgres://kanecta:kanecta@localhost:${PORT}/kanecta"
echo
pg_lsclusters
