# Voz en Casino Nocturno con LiveKit

Esta integración agrega voz en vivo a las salas online del casino. La voz no se graba y entra apagada por defecto.

## Qué quedó implementado en el casino

- Botón flotante **Voz de la sala** en las páginas de juego.
- El botón solo aparece cuando el jugador está dentro de una sala online.
- El navegador solo envía `roomId`.
- El servidor debe verificar la sesión y la membresía antes de entregar el token.
- Los espectadores pueden escuchar, pero no publicar micrófono.

Archivos principales:

```text
js/voice-chat.js
css/voice-chat.css
server/livekit/token-route.js
server/livekit/docker-compose.livekit.yml
server/livekit/livekit.yaml.example
server/livekit/.env.example
vendor/README.md
```

## Paso 1: instalar LiveKit en Ubuntu

En el servidor:

```bash
cd ~/OrbitServer/apps/casino-nocturno
git pull
bash server/livekit/install-on-orbitserver.sh
```

Ese instalador crea LiveKit, copia la ruta de tokens al backend y te pide `SUPABASE_SERVICE_ROLE_KEY` directamente en Ubuntu. No pegues esa clave en chats ni en GitHub.

Si prefieres hacerlo manualmente:

```bash
cd ~/OrbitServer
mkdir -p livekit
cp ~/OrbitServer/apps/casino-nocturno/server/livekit/livekit.yaml.example ~/OrbitServer/livekit/livekit.yaml
cp ~/OrbitServer/apps/casino-nocturno/server/livekit/docker-compose.livekit.yml ~/OrbitServer/livekit/docker-compose.yml
nano ~/OrbitServer/livekit/livekit.yaml
```

Cambia:

```yaml
keys:
  CHANGE_ME_LIVEKIT_API_KEY: CHANGE_ME_LIVEKIT_API_SECRET
```

por claves fuertes. Ejemplo:

```yaml
keys:
  casino_voice_key_2026: una_clave_larga_privada_de_64_caracteres_o_mas
```

Luego:

```bash
cd ~/OrbitServer/livekit
docker compose up -d
docker logs -f casino-livekit
```

Abre puertos:

```bash
sudo ufw allow 7880/tcp
sudo ufw allow 7881/tcp
sudo ufw allow 50000:50100/udp
```

## Paso 2: conectar la ruta de token en OrbitServer

Instala dependencias en el backend de OrbitServer:

```bash
cd ~/OrbitServer/backend
npm install livekit-server-sdk @supabase/supabase-js
```

Copia la ruta:

```bash
mkdir -p ~/OrbitServer/backend/livekit
cp ~/OrbitServer/apps/casino-nocturno/server/livekit/token-route.js ~/OrbitServer/backend/livekit/token-route.js
```

En el archivo principal de Express, agrega:

```js
const { createVoiceTokenRouter } = require('./livekit/token-route');
app.use('/api', createVoiceTokenRouter(express));
```

Variables necesarias en el backend:

```env
SUPABASE_URL=https://cmcbcrpccqbaajktffby.supabase.co
SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY_SOLO_EN_SERVIDOR
LIVEKIT_PUBLIC_URL=ws://10.0.0.209:7880
LIVEKIT_API_KEY=casino_voice_key_2026
LIVEKIT_API_SECRET=una_clave_larga_privada_de_64_caracteres_o_mas
```

Reinicia:

```bash
pm2 restart orbit-server --update-env
```

## Paso 3: instalar el cliente LiveKit local

El casino busca:

```text
vendor/livekit-client.umd.min.js
```

En una carpeta temporal del servidor:

```bash
mkdir -p ~/tmp-livekit-client
cd ~/tmp-livekit-client
npm init -y
npm install livekit-client
find node_modules/livekit-client -iname "*umd*.js" -o -iname "*min.js"
```

Copia el bundle encontrado a:

```bash
sudo cp RUTA_DEL_ARCHIVO_UMD /var/www/html/casino/vendor/livekit-client.umd.min.js
sudo chown www-data:www-data /var/www/html/casino/vendor/livekit-client.umd.min.js
```

Si usas el repo en `~/OrbitServer/apps/casino-nocturno`, también puedes copiarlo ahí y volver a publicar el casino.

## Paso 4: probar en red local

1. Abre el casino en dos dispositivos.
2. Crea una sala online.
3. Entra con otro perfil usando el código.
4. Presiona **Entrar a voz**.
5. El micrófono debe quedar apagado al entrar.
6. Activa el micrófono solo cuando quieras hablar.

## Producción

Para usarlo fuera de tu red local necesitas:

- HTTPS en el casino.
- LiveKit accesible como `wss://`.
- Reenvío de puertos TCP `7881` y UDP `50000-50100`.
- Más adelante, TURN si algunos usuarios no logran conectar audio.

No subas a GitHub:

- `SUPABASE_SERVICE_ROLE_KEY`
- `LIVEKIT_API_SECRET`
- archivos `.env` reales
