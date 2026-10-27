# laboratorio.ia en el teléfono (Termux)

Avanzado: corre laboratorio.ia y FreeLLMAPI dentro de Debian en Termux, sin nube. Para la mayoría es más fácil
**desplegar laboratorio.ia en Cloudflare** (ver el README principal) y usar la app con esa dirección.

## Instalación

1. Instala [Termux](https://f-droid.org/packages/com.termux/) desde F-Droid y abre:
   ```bash
   pkg install proot-distro && proot-distro install debian && proot-distro login debian
   ```
2. Dentro de Debian:
   ```bash
   apt update && apt install -y nodejs npm git curl
   git clone https://github.com/ReserchLab/lab-ia /root/projects/cardon-lab
   # FreeLLMAPI (el enrutador de modelos): https://github.com/tashfeenahmed/freellmapi
   git clone --depth 1 https://github.com/tashfeenahmed/freellmapi /root/freellmapi
   cd /root/freellmapi && npm ci && npm run build -w server && npm run build -w client
   printf "ENCRYPTION_KEY=%s\nPORT=31415\nHOST=127.0.0.1\nNODE_ENV=production\nNODE_OPTIONS=--dns-result-order=ipv4first\n" "$(openssl rand -hex 32)" > .env
   install -m 755 /root/projects/cardon-lab/termux/ia /root/projects/cardon-lab/termux/lab-servidor /usr/local/bin/
   mkdir -p /usr/local/lib/ia && cp /root/projects/cardon-lab/termux/proveedores.mjs /usr/local/lib/ia/
   exit
   ```
3. De vuelta en Termux:
   ```bash
   RAIZ=$(ls -d $PREFIX/var/lib/proot-distro/containers/debian/rootfs $PREFIX/var/lib/proot-distro/installed-rootfs/debian 2>/dev/null | head -1)
   install -m 755 "$RAIZ/root/projects/cardon-lab/termux/lab" $PREFIX/bin/lab
   echo 'allow-external-apps=true' >> ~/.termux/termux.properties && termux-reload-settings
   lab
   ```
   `lab` enciende FreeLLMAPI y laboratorio.ia, y muestra las direcciones y el PIN. Abre la app laboratorio.ia.

`ia` (dentro de Debian) es un menú para Claude Code / Codex con FreeLLMAPI, proveedores y claves.
