# TiempoMDZ — versión web para GitHub Pages

## Publicar
1. Creá un repositorio nuevo en GitHub.
2. Subí todo el contenido de esta carpeta a la raíz del repositorio (`index.html` debe quedar en la raíz).
3. En GitHub: **Settings → Pages → Deploy from a branch**.
4. Elegí `main` y `/ (root)`, guardá y esperá la URL publicada.
5. Abrí la URL con HTTPS desde el celular.

## Funcionamiento de las alertas (decisión de diseño)
- Las alertas y el análisis meteorológico funcionan únicamente mientras la página está abierta y visible en pantalla.
- Al pasar a otra pestaña o apagar/bloquear la pantalla, se detienen las consultas periódicas, la animación del radar y la lectura por voz. Al volver a la página se realiza una actualización.
- No se solicitan permisos de notificación del navegador o del teléfono.
- No se registran Service Workers, Push, Background Sync ni Periodic Background Sync. No hay notificaciones ni vigilancia en segundo plano.
- El sonido, la vibración y la voz (si el usuario los activa) solo se ejecutan durante la sesión visible. El navegador o el sistema operativo pueden limitar funciones si la página deja de estar visible.

## Qué conserva esta versión
- Interfaz web y módulos JavaScript/CSS incluidos en el ZIP.
- Mapa Leaflet, capas meteorológicas, ubicaciones, fincas y controles existentes.
- Detección y cruce de datos implementados en `detect.js`.
- Pronóstico comparativo en `forecast.js` (ECMWF, GFS, ICON, GEM y MET Noruega cuando entregan datos).
- Alertas visibles dentro de la página, evidencia/fuentes, historial local y configuración guardada en el navegador.
- Datos de radar RainViewer, observaciones METAR, sismos USGS y datos meteorológicos Open-Meteo/MET Noruega, según disponibilidad y CORS.

## Diferencias frente a la APK Android
GitHub Pages es alojamiento estático: no ejecuta el servicio Android ni el proxy nativo `OfficialProxy.kt`. Algunos feeds oficiales (SMN CAP, Contingencias e INPRES) pueden no permitir lectura automática por CORS. Si una fuente no responde, debe mostrarse como no disponible y nunca interpretarse como ausencia de riesgo. Para recuperar todas esas consultas oficiales podría añadirse un backend/proxy propio en una etapa posterior.

## Fuentes y cómo se cruzan
- **Open-Meteo:** condiciones actuales, variables horarias, inestabilidad y modelos meteorológicos ECMWF, GFS, ICON y GEM. Son modelos distintos, pero comparten proveedor/API; no se cuentan como cuatro proveedores independientes.
- **MET Noruega:** pronóstico independiente, utilizado como contraste cuando hay datos completos.
- **RainViewer:** cuadros de radar; la ausencia de eco no demuestra por sí sola ausencia de lluvia ni falta de cobertura.
- **GOES / NASA GIBS:** observación satelital y temperatura de topes nubosos; evidencia observada, no pronóstico de superficie.
- **Aviation Weather Center (METAR):** observaciones reales de aeropuertos; no representan exactamente cada barrio.
- **USGS:** catálogo sísmico. En Argentina, la referencia oficial local es INPRES; la consulta automática directa puede estar limitada por CORS.
- **SMN y organismos provinciales:** avisos oficiales; su lectura automática desde GitHub Pages puede fallar por CORS. Los enlaces oficiales permanecen disponibles en la sección de fuentes.

## Uso responsable
Los avisos automáticos son estimaciones y detecciones basadas en datos disponibles; no sustituyen alertas oficiales ni instrucciones de Defensa Civil. Si una fuente falla, se interpreta como **sin datos**, no como “sin riesgo”.


## Edición profesional y licencias
- Se quitó completamente el módulo **Modo conductor/transporte** y su archivo JavaScript.
- Se conserva el acceso **Licencia** en el encabezado y en Ajustes.
- La interfaz informa un período de evaluación de **5 días** y presenta planes **mensual (30 días), semestral (6 meses) y anual (12 meses)** con solicitud por WhatsApp y links de pago configurables en `config.js`.
- La prueba se registra localmente en el navegador. **No es un mecanismo antifraude**: borrar los datos del navegador puede reiniciarla. Para licencias comerciales reales, bloqueo al vencer, activación de claves firmadas y administración de clientes se necesita un backend seguro (por ejemplo Cloudflare Worker + base de datos). No publicar claves privadas ni secretos en GitHub Pages.
- El producto está orientado a meteorólogos y entidades: los paneles deben identificar variable, valor/unidad, ubicación, hora de observación/emisión, período válido, fuente/proveedor, modelo, hora de actualización, disponibilidad/calidad y coincidencias o discrepancias. Los modelos de un mismo proveedor deben distinguirse de proveedores independientes. Los datos ausentes se muestran como **sin datos**, nunca como ausencia de riesgo.
- GitHub Pages por sí solo no puede garantizar la validación segura de licencias ni la disponibilidad de feeds oficiales que bloqueen CORS.


## Fuentes oficiales en GitHub Pages (SMN, INPRES, METAR)
- `proxy.js` intercepta `fetch` solo para smn.gob.ar, inpres.gob.ar, aviationweather.gov y mendoza.gov.ar, y los pide por un proxy con CORS.
- **Recomendado:** publicar `worker.js` en Cloudflare Workers (gratis) y poner su URL en `config.js` → `proxy`. Las instrucciones están al inicio de `worker.js`.
- Sin Worker se usan proxies públicos de respaldo (allorigins, codetabs, corsproxy): sirven para probar, pero pueden fallar o limitar pedidos.
- El botón SOS se oculta en PC (mouse + pantalla ≥ 900 px); en celular y tablet se mantiene.
- Subir también `proxy.js` y `worker.js` a la raíz del repositorio.

## Copias automáticas con GitHub Actions (SMN, INPRES, METAR, Contingencias)
- `.github/workflows/datos.yml` corre cada ~10 min, ejecuta `scripts/fetch-data.mjs` y guarda copias en `data/` (solo hace commit si algo cambió).
- `proxy.js` lee esas copias primero (mismo sitio, sin CORS). Si tienen más de 3 h o no existen, usa el proxy propio / públicos.
- Activar: Settings → Actions → General → Workflow permissions → **Read and write permissions**. Luego Actions → "Copiar datos oficiales" → **Run workflow** (la primera vez, para no esperar).
- Si el SMN o el INPRES bloquean los servidores de GitHub, el log del workflow lo dice ("FALLÓ …") y conviene sumar el Worker de `worker.js`.
