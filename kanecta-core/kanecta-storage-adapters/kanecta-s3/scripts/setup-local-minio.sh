#!/bin/bash
# Installs and configures a native (non-Docker) MinIO server for Kanecta dev use:
#   - downloads the minio + mc binaries to /usr/local/bin
#   - creates a dedicated system user and data directory
#   - installs a systemd service (auto-starts on boot)
#   - runs on non-standard ports (45900 API / 45901 console) to stay well away
#     from MinIO's defaults (9000/9001) and other local services
#   - creates the "kanecta" bucket and a kanecta access key/secret
#
# Run with sudo:
#   sudo bash setup-local-minio.sh

set -euo pipefail

API_PORT=45900
CONSOLE_PORT=45901
DATA_DIR=/var/lib/minio/data
ROOT_USER=kanecta
ROOT_PASSWORD=kanecta-minio-secret
BUCKET=kanecta

if [[ $EUID -ne 0 ]]; then
  echo "Run this script with sudo: sudo bash $0" >&2
  exit 1
fi

echo "→ creating minio-user system account"
id -u minio-user &>/dev/null || useradd -r -s /sbin/nologin minio-user

echo "→ creating data directory ${DATA_DIR}"
mkdir -p "$DATA_DIR"
chown -R minio-user:minio-user /var/lib/minio

echo "→ downloading minio server binary"
curl -fsSL -o /usr/local/bin/minio https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x /usr/local/bin/minio

echo "→ downloading mc client binary"
curl -fsSL -o /usr/local/bin/mc https://dl.min.io/client/mc/release/linux-amd64/mc
chmod +x /usr/local/bin/mc

echo "→ writing /etc/default/minio"
cat > /etc/default/minio <<EOF
MINIO_ROOT_USER=${ROOT_USER}
MINIO_ROOT_PASSWORD=${ROOT_PASSWORD}
MINIO_VOLUMES="${DATA_DIR}"
MINIO_OPTS="--address :${API_PORT} --console-address :${CONSOLE_PORT}"
EOF

echo "→ writing systemd unit"
cat > /etc/systemd/system/minio.service <<'EOF'
[Unit]
Description=MinIO (Kanecta local dev)
After=network-online.target
Wants=network-online.target

[Service]
User=minio-user
Group=minio-user
EnvironmentFile=/etc/default/minio
ExecStart=/usr/local/bin/minio server $MINIO_OPTS $MINIO_VOLUMES
Restart=always
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

echo "→ enabling and starting minio"
systemctl daemon-reload
systemctl enable --now minio
sleep 3

echo "→ configuring mc alias and creating bucket"
export MC_CONFIG_DIR=/tmp/kanecta-mc-config
/usr/local/bin/mc alias set kanecta-local "http://localhost:${API_PORT}" "$ROOT_USER" "$ROOT_PASSWORD" >/dev/null
/usr/local/bin/mc mb --ignore-existing "kanecta-local/${BUCKET}"
rm -rf "$MC_CONFIG_DIR"

echo
echo "✓ done. MinIO is running:"
echo "  API:        http://localhost:${API_PORT}"
echo "  Console:    http://localhost:${CONSOLE_PORT}"
echo "  Access key: ${ROOT_USER}"
echo "  Secret key: ${ROOT_PASSWORD}"
echo "  Bucket:     ${BUCKET}"
echo
systemctl status minio --no-pager -l | head -10
