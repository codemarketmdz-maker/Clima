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

## Licencias FIJAS (clave firmada, sin servidor) — recomendado
La licencia es una clave `TMDZ2.…` que lleva adentro el ID del equipo, el tipo (Pro/Básica) y la **fecha de vencimiento**, firmada con tu clave privada. La app la verifica con la clave pública. No se reinicia, no depende de Cloudflare ni de KV y solo sirve en el equipo de ese ID.

**Una sola vez**
1. Abrí `licencias/claves.html` → **Generar claves**. Guardá un respaldo privado de la clave 1 (SIGN_PRIVATE). Si ya tenías un par de claves, seguí usando el mismo.
2. Pegá la clave **pública** (valor 4) en `config.js` → `licPub` y subí el cambio a GitHub. (`licUrl` puede quedar vacío.)

**Por cada cliente**
1. El cliente abre la app → 🔑 → toca **Copiar ID** (o usa el botón de WhatsApp, que ya manda el ID) y te lo envía.
2. Abrís `admin.html` → pegás tu clave privada (la primera vez; podés dejarla recordada en tu celular) → pegás el ID → elegís tipo y plan → **Generar licencia**.
3. **Copiar mensaje completo** y se lo mandás por WhatsApp. El cliente pega la clave en 🔑 → **Activar**.
4. Renovar: generás otra para el mismo ID; el vencimiento se cuenta desde el actual (podés cambiar la fecha a mano).

**Límites a tener en cuenta**
- No se puede quitar una licencia antes de su fecha (no hay servidor que la revoque). Por eso conviene emitir mensual/semestral/anual con la fecha justa.
- El ID se guarda en localStorage, cookie e IndexedDB. Si el cliente borra TODOS los datos del sitio y del navegador, tendrá un ID nuevo y hay que generarle otra clave.
- La prueba gratis sigue siendo local (con copias de respaldo); para blindarla usá el servidor opcional de abajo.
- La lista "Licencias emitidas" de admin.html vive solo en tu celular: usá **Copiar respaldo** de vez en cuando.

## (Opcional) Prueba gratis antifraude — servidor en Cloudflare, gratis
(Solo para la prueba de 5 días y el proxy de datos: las licencias pagas ya no lo necesitan. Los pasos 6 de abajo —activar licencias desde el servidor— ya no hacen falta.)
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

## Servidor de datos (obligatorio para 📡 Radar y 📍 Estaciones)
El radar del SMN y las estaciones FePEDI no se pueden leer directo desde la página (los sitios no lo permiten) y los proxies públicos fallan casi siempre. Hace falta **un Worker propio** de Cloudflare, gratis, que además guarda los datos 30 s–5 min para no pedirles de más. Sin él, el botón 📡 dice "Falta configurar el servidor" y 📍 no muestra estaciones.
**Importante:** si tu página está en `https://clima.codemarketmdz.workers.dev`, ese Worker es el que sirve los archivos; el de datos tiene que ser **otro Worker, con otro nombre** (ej. `datos`).
1. En **dash.cloudflare.com** → **Workers & Pages** → **Create** → **Create Worker** → nombre `datos` → **Deploy**.
2. **Edit code** → seleccioná todo y borralo → pegá el contenido completo de **`licencias/worker-datos.js`** → **Deploy**. (No hace falta KV, secretos ni variables.)
3. Probá en el navegador (cambiá la dirección por la tuya): `https://datos.TU-CUENTA.workers.dev/health` debe decir `"ok":true` y `…/estaciones` debe mostrar una lista de estaciones.
4. En `config.js` poné esa dirección **completa, con https://**, en `proxy: 'https://datos.TU-CUENTA.workers.dev'` (sin barra al final), dejá `licUrl: ''` y volvé a publicar la página.
**Si algo no carga:** abrí **📡 Radar SMN → 🔧 Probar servidor** (o agregá `#diag` al final de la dirección de la página). Prueba `/health`, `/estaciones`, la lista del radar y una imagen, y explica en castellano qué falla. Podés copiar el resultado y mandarlo.
El Worker acepta pedidos desde `https://clima.codemarketmdz.workers.dev` y `https://codemarketmdz-maker.github.io`; para otra dirección usá la variable `ALLOWED_ORIGIN`. El token del radar lo obtiene el Worker solo (el SMN confirmó que el uso es público y que no tiene otro) y lo renueva cada hora; si el SMN te da uno propio, guardalo como Secreto `SMN_TOKEN`.

## Radar del SMN (botón 📡 Radar SMN)
Está en el panel de abajo a la izquierda (**Radar SMN**), junto a Buscar, Fincas y Avisos. Muestra las últimas 12 imágenes de radar (cada 10 min) con animación: Santa Rosa (Mendoza), Mosaico Centro, Mosaico Argentina y algunos radares vecinos.

**Radar sobre el mapa (Santa Rosa):** en la ventana del radar, botón **🗺 Ver sobre el mapa**. Reproyecta la imagen del SMN a coordenadas (calibrada con 12 ciudades, error típico de 1 a 3 km), descarta fondo, mapa, textos y leyenda, y deja solo los ecos. Abajo aparece una barra con animación, deslizador de cuadros, **opacidad** y filtro **desde cuántos dBZ** mostrar (≥ 15 dBZ por defecto; lluvia fuerte desde ~35, núcleos de granizo posible desde ~50–55). También se puede superponer el **Mosaico Centro** (calibrado con 12 ciudades, error menor a 1 km). Los demás radares y el Mosaico Argentina se ven solo en la ventana, porque faltan imágenes de ejemplo para calibrarlos (mandá una de cada uno y se agregan).
Si el servidor no logra el acceso, el botón avisa que pruebes de nuevo en unos minutos.

## Aviso de granizo y ecos fuertes por radar (⚙ Avisos → "Granizo y ecos fuertes del radar")
Cada 5 minutos la app lee los últimos 3 cuadros del radar del SMN (Santa Rosa, y el Mosaico Centro para lugares fuera de su alcance) y busca, para tu ubicación y cada finca, el eco fuerte más cercano: a qué distancia está, hacia dónde queda, si se acerca o se aleja y en cuánto tiempo llegaría. Un píxel suelto no cuenta (hace falta un núcleo de unos 2,5 km²), para evitar falsas alarmas por interferencias.
- **Desde qué intensidad avisar** (barra de 35 a 65 dBZ, **52 por defecto**): explica en lenguaje simple cada nivel — 35–44 lluvia fuerte, 45–49 tormenta fuerte, 50–51 granizo posible pero poco probable, **52–54 posible granizo (recomendado)**, 55–59 granizo probable, 60 o más granizo probable y grande. Del 50 en adelante el aviso es de tipo *granizo*; por debajo es de *tormenta fuerte*.
- **Avisar si el eco está a menos de** 10 / 25 / 40 / 60 km (25 por defecto). También avisa si el eco se acerca y llegaría en 45 minutos o menos.
- **Niveles de la alerta**: 3 = el eco está casi encima (≤ 10 km), 2 = dentro de tu distancia de aviso o llegando pronto, 1 = vigilancia (hasta el doble de tu distancia). Si el pronóstico también marca tormenta fuerte o granizo en ese lugar, el aviso sube un nivel y lo dice; si las estaciones registran una baja brusca de temperatura, también lo agrega.
- Debajo de la escala se ve el estado: hora del último cuadro leído y el eco más cercano a cada lugar.
- **El radar no ve el granizo en el suelo**: indica que es posible. Las alertas de granizo son Pro (en Básica se muestran como tormenta fuerte). Necesita el servidor de datos.

## Estaciones del campo (FePEDI · ISCAMEN · COVIAR)
Capa **📍 Estaciones** (en la fila de capas del panel de abajo a la izquierda, junto a Temp. y Alertas; la primera vez el mapa se acerca solo a donde están las estaciones): 56 estaciones, cada una con su temperatura actual en el mapa; al tocarla muestra humedad, punto de rocío y mín./máx. del día. Los datos vienen de `fepedi.evolus.com.ar/estaciones/data.json` (EVOLUS IoT) y se actualizan cada minuto.
**Cruce con las alertas** (usa estaciones online a menos de 30 km de tu ubicación o de cada finca, con lectura de menos de 90 min):
- **Helada registrada**: si una estación cercana ya está en el umbral de helada (el de ⚙ Avisos, 2 °C por defecto) → alerta de nivel alto con la estación y la hora de la lectura.
- **Helada anticipada** (de noche): estima la mínima del amanecer con la temperatura, el punto de rocío y el enfriamiento medido en la última hora (el enfriamiento se frena al acercarse al punto de rocío). Avisa "Riesgo" si la estimación llega al umbral y "Vigilancia" si queda a menos de 1,5 °C. No considera nubes ni viento: es una estimación, no una medición. El enfriamiento se calcula con el historial que la página va guardando mientras está abierta (últimas 3 h).
- **Viento y nubes**: la estimación nocturna también mira el pronóstico del modelo hasta el amanecer. Con cielo despejado y viento calmo toma la peor de las dos estimaciones (máximo enfriamiento); con viento (≥ 15 km/h de promedio) o cielo cubierto (≥ 70 % de nubes) manda el modelo, porque el aire mezclado frena el enfriamiento. Cada alerta indica si la temperatura **está bajando o subiendo** (°C/h) y las condiciones de la noche.
- **Ajustes (⚙ Avisos)**: *Riesgo de helada desde* (0 a 6 °C; el valor por defecto ahora es **3 °C**, y quien tenía 2 °C pasa a 3 °C una sola vez), *Cruzar helada y tormentas con estaciones cercanas* (Sí/No) y *Radio de las estaciones* (10 a 80 km). El umbral elegido vale para el modelo y para las estaciones.
- **Tormenta**: si 2 o más estaciones bajan 4 °C o más en 45 min, se agrega esa observación a las alertas de tormenta del lugar.
**Granizo:** estas estaciones no miden granizo, lluvia ni viento, así que no pueden confirmarlo. El granizo se sigue evaluando con modelo, satélite y radar.
**Cobertura:** las estaciones están en el sur de Mendoza (Valle de Uco y San Rafael, aprox. entre 32,7° y 35° S). Los lugares fuera de ese radio no reciben el cruce.
Necesita el servidor de datos de arriba. Un cartel sobre el mapa dice cuántas estaciones cargaron o por qué no.

## Datos en vivo con el Worker (SMN, INPRES, METAR) y disparador de Actions
El mismo Worker de licencias ahora tiene la ruta `/p`: lee SMN, INPRES, METAR y Contingencias desde el servidor de Cloudflare más cercano y las entrega a la página (descomprime los ZIP del SMN). La página la usa sola porque ya tiene `licUrl`. Para activarlo solo hay que **volver a pegar `licencias/worker.js` en el Worker y tocar Implementar**.

**Disparador confiable de Actions** (arregla los rayos con 3 horas de atraso y las copias de datos): el "cron" de GitHub se atrasa horas en repositorios chicos. El Worker puede llamar a GitHub cada 5 minutos:
1. GitHub → Settings (de tu cuenta) → Developer settings → Personal access tokens → Fine-grained → Generate: acceso a los repos `Clima` y `tiempomdz-rayos`, permiso **Actions: Read and write**. Copiá el token.
2. Cloudflare → Worker → Configuración → Variables y secretos: Secreto `GH_TOKEN` = el token. Texto `DISPATCH` =
   `[{"repo":"codemarketmdz-maker/tiempomdz-rayos","workflow":"rayos.yml","ref":"main"},{"repo":"codemarketmdz-maker/Clima","workflow":"datos.yml","ref":"main"}]`
   (poné el nombre real del archivo del workflow de rayos y la rama que usa).
3. Worker → Configuración → Disparadores → Agregar → Cron → `*/5 * * * *`.
4. Los workflows deben tener `on: workflow_dispatch:` (datos.yml ya lo tiene; agregalo al de rayos).
