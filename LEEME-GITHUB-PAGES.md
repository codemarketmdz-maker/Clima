# TiempoMDZ · versión web (base: app Android 1.31)

## Publicar
1. Subí TODO el contenido de esta carpeta a la raíz del repositorio (incluida la carpeta oculta `.github`).
2. Settings → Pages → Deploy from a branch → `main` / `(root)`.
3. Settings → Actions → General → Workflow permissions → **Read and write permissions**.
4. Actions → "Copiar datos oficiales" → **Run workflow** (la primera vez). Revisá el log: cada fuente dice OK o FALLÓ.

## Cómo llegan SMN, INPRES y aeropuertos a la web
La app Android los baja con su propio proxy nativo. En GitHub Pages el navegador los bloquea (CORS), así que:
- `.github/workflows/datos.yml` + `scripts/fetch-data.mjs` descargan cada ~10 min: METAR (aviationweather + NOAA), INPRES (xml y tabla), SMN (avisos CAP, estado del tiempo y pronóstico 5 días, ya descomprimidos), Contingencias Mendoza.
- Se guardan en `data/` y `proxy.js` las lee desde el mismo sitio. Si una copia tiene más de 3 h se ignora y se prueban proxies públicos (los datos en ZIP del SMN solo salen de la copia).
- Si el SMN o el INPRES bloquean los servidores de GitHub (están fuera de Argentina), el log dice FALLÓ para esa fuente.

## Diferencias con la app Android
- Sin vigilancia en segundo plano ni notificaciones: los avisos se muestran con la página abierta y visible.
- Licencia: ver la sección siguiente. Sin voz ni modo ruta (se quitaron).
- Botón SOS oculto en PC (mouse y pantalla ≥ 900 px).

## Licencias seguras (anti-fraude) — servidor en Cloudflare, gratis
Sin esto (`licUrl` vacío en config.js) la prueba es solo local y borrar los datos del sitio la reinicia.
**Qué hace el servidor:** reconoce a un mismo equipo por (1) ID de instalación, (2) huella del dispositivo y (3) IP + huella básica, así que borrar datos, modo incógnito u otro navegador del mismo equipo no reinician la prueba. La respuesta va firmada (ECDSA): la página verifica la firma con la clave pública y calcula el tiempo con la hora del servidor, no la del celular. La IP la lee el servidor y se guarda solo un hash con sal.
**Qué NO puede impedir:** alguien técnico que edite el código de la página; que cambie de dispositivo, de red y de navegador a la vez; o dos teléfonos idénticos en la misma red (el panel permite reiniciar esa prueba).

Pasos (≈10 min, todo desde el navegador):
1. Abrí `licencias/claves.html` en tu sitio (o desde el celular) → **Generar claves** y guardá los 4 valores.
2. Cloudflare → Workers & Pages → Create → Worker "tiempomdz-licencias" → Edit code → pegá `licencias/worker.js` → Deploy.
3. Storage & Databases → KV → Create namespace `LIC`. En el Worker: Settings → Bindings → Add → KV namespace → variable `LIC`.
4. Worker → Settings → Variables and Secrets: Secrets `SIGN_PRIVATE`, `ADMIN_KEY`, `IP_SALT` (valores 1, 2, 3) y Variable `ALLOWED_ORIGIN` = `https://TU-USUARIO.github.io`.
5. En `config.js` poné `licUrl` (la URL del Worker) y `licPub` (valor 4). Subí el cambio.
6. Cuando un cliente te mande su ID por WhatsApp y pague: abrí `admin.html` → clave ADMIN_KEY + URL del Worker → pegá el ID → elegí tipo y plan → **Activar licencia**. Renovar suma días.
