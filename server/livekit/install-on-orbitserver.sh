#!/usr/bin/env bash
set -euo pipefail

ROOT="${ORBIT_ROOT:-$HOME/OrbitServer}"
CASINO_REPO="${CASINO_REPO:-$ROOT/apps/casino-nocturno}"
BACKEND_DIR="${BACKEND_DIR:-$ROOT/backend}"
LIVEKIT_DIR="${LIVEKIT_DIR:-$ROOT/livekit}"
PUBLIC_HOST="${PUBLIC_HOST:-$(hostname -I 2>/dev/null | awk '{print $1}')}"

if [ ! -d "$CASINO_REPO" ]; then
  echo "No encuentro el repo del casino en: $CASINO_REPO"
  echo "Ejecuta primero: git clone https://github.com/orbitgrupo/casino-nocturno.git $CASINO_REPO"
  exit 1
fi

if [ ! -d "$BACKEND_DIR" ]; then
  echo "No encuentro el backend en: $BACKEND_DIR"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker no está instalado o no está en PATH."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose no está disponible."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js no está instalado."
  exit 1
fi

mkdir -p "$LIVEKIT_DIR" "$BACKEND_DIR/livekit" "$CASINO_REPO/vendor"

LIVEKIT_API_KEY="${LIVEKIT_API_KEY:-casino_voice_$(openssl rand -hex 6)}"
LIVEKIT_API_SECRET="${LIVEKIT_API_SECRET:-$(openssl rand -hex 32)}"
LIVEKIT_PUBLIC_URL="${LIVEKIT_PUBLIC_URL:-ws://${PUBLIC_HOST}:7880}"
SUPABASE_URL="${SUPABASE_URL:-https://cmcbcrpccqbaajktffby.supabase.co}"

echo
echo "Configuración de voz para Casino Nocturno"
echo "LiveKit URL pública propuesta: $LIVEKIT_PUBLIC_URL"
echo

if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  read -r -s -p "Pega SUPABASE_SERVICE_ROLE_KEY (no se mostrará): " SUPABASE_SERVICE_ROLE_KEY
  echo
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "SUPABASE_SERVICE_ROLE_KEY es obligatorio."
  exit 1
fi

cat > "$LIVEKIT_DIR/livekit.yaml" <<YAML
port: 7880

rtc:
  tcp_port: 7881
  use_external_ip: false
  port_range_start: 50000
  port_range_end: 50100

room:
  auto_create: true
  empty_timeout: 300
  departure_timeout: 20

keys:
  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}
YAML

cp "$CASINO_REPO/server/livekit/docker-compose.livekit.yml" "$LIVEKIT_DIR/docker-compose.yml"
cp "$CASINO_REPO/server/livekit/token-route.js" "$BACKEND_DIR/livekit/token-route.js"

cat > "$BACKEND_DIR/livekit/.env.livekit" <<ENV
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
LIVEKIT_PUBLIC_URL=${LIVEKIT_PUBLIC_URL}
LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
ENV
chmod 600 "$BACKEND_DIR/livekit/.env.livekit"

cd "$BACKEND_DIR"
npm install livekit-server-sdk @supabase/supabase-js

ENTRY=""
for file in server.js app.js index.js src/server.js src/app.js; do
  if [ -f "$BACKEND_DIR/$file" ]; then
    ENTRY="$BACKEND_DIR/$file"
    break
  fi
done

if [ -z "$ENTRY" ]; then
  ENTRY="$(grep -RIl "express()" "$BACKEND_DIR" --include='*.js' | head -n 1 || true)"
fi

if [ -z "$ENTRY" ]; then
  echo
  echo "LiveKit quedó instalado, pero no encontré el archivo principal de Express."
  echo "Agrega manualmente en tu backend:"
  echo "const { createVoiceTokenRouter } = require('./livekit/token-route');"
  echo "app.use('/api', createVoiceTokenRouter(express));"
else
  cp "$ENTRY" "$ENTRY.before-livekit-$(date +%Y%m%d%H%M%S).bak"
  if ! grep -q "createVoiceTokenRouter" "$ENTRY"; then
    python3 - "$ENTRY" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text()
require_line = "const { createVoiceTokenRouter } = require('./livekit/token-route');\n"
if require_line not in text:
    lines = text.splitlines(True)
    insert_at = 0
    for i, line in enumerate(lines):
        if line.startswith("const ") or line.startswith("let ") or line.startswith("var ") or line.startswith("require("):
            insert_at = i + 1
    lines.insert(insert_at, require_line)
    text = ''.join(lines)
mount_line = "app.use('/api', createVoiceTokenRouter(express));\n"
if mount_line not in text:
    marker = "app.listen"
    idx = text.find(marker)
    if idx >= 0:
        text = text[:idx] + mount_line + text[idx:]
    else:
        text += "\n" + mount_line
path.write_text(text)
PY
    echo "Ruta de voz agregada a: $ENTRY"
  else
    echo "La ruta de voz ya estaba conectada en: $ENTRY"
  fi
fi

cd "$LIVEKIT_DIR"
docker compose up -d

if command -v sudo >/dev/null 2>&1; then
  sudo ufw allow 7880/tcp || true
  sudo ufw allow 7881/tcp || true
  sudo ufw allow 50000:50100/udp || true
else
  ufw allow 7880/tcp || true
  ufw allow 7881/tcp || true
  ufw allow 50000:50100/udp || true
fi

if [ -d /var/www/html/casino ]; then
  if [ ! -f /var/www/html/casino/vendor/livekit-client.umd.min.js ]; then
    echo
    echo "Falta el cliente del navegador:"
    echo "/var/www/html/casino/vendor/livekit-client.umd.min.js"
    echo
    echo "Instálalo con:"
    echo "mkdir -p ~/tmp-livekit-client && cd ~/tmp-livekit-client"
    echo "npm init -y"
    echo "npm install livekit-client"
    echo "find node_modules/livekit-client -iname '*umd*.js' -o -iname '*min.js'"
    echo "sudo cp RUTA_ENCONTRADA /var/www/html/casino/vendor/livekit-client.umd.min.js"
  fi
fi

if command -v pm2 >/dev/null 2>&1; then
  pm2 restart orbit-server --update-env || true
fi

echo
echo "LiveKit instalado."
echo "API key: $LIVEKIT_API_KEY"
echo "URL pública: $LIVEKIT_PUBLIC_URL"
echo
echo "Prueba:"
echo "curl -I http://127.0.0.1:7880"
echo "curl -i -X POST http://127.0.0.1:3000/api/livekit/token"
