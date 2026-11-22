/* Ajustes comerciales de TiempoMDZ — editá este archivo y recompilá.
   waNumber : WhatsApp que recibe los pedidos de licencia (formato internacional, sin + ni espacios).
   mpLinks  : links de pago de Mercado Pago. Estructura: mpLinks.B.M (Básica mensual), .B.S (semestral), .B.A (anual) y lo mismo en .P para Pro.
              Si un plan no tiene link, solo se ofrece pedirlo por WhatsApp.
   licPub   : clave PÚBLICA (la imprime licencias/claves.html). OBLIGATORIA para las licencias fijas: la app verifica con ella las claves TMDZ2.… que generás en admin.html.
   licUrl   : OPCIONAL. Servidor de Cloudflare (licencias/worker.js) solo para la prueba gratis antifraude y el proxy de datos. Las licencias pagas ya NO dependen de él.
   prices   : precio que se muestra en cada plan (texto libre, ej. "$2.500"). Vacío = no se muestra precio.
   limits   : qué incluye cada tipo de licencia. Los avisos OFICIALES del SMN se muestran siempre, en todos los planes.
              fincas       = cantidad máxima de fincas guardadas (además de "Mi ubicación")
              forecastDays = días del pronóstico extendido que se muestran
              frost / hail / approach = funciones exclusivas (true = incluida)
              Si el plan no incluye "hail", un granizo se avisa como "tormenta fuerte". */
window.CM_CFG = {
  brand: 'CodeMarket',
  proxy: 'https://code.codemarketmdz.workers.dev',   // URL del Worker de Cloudflare (licencias/worker.js). Necesaria para el botón 📡 Radar y mejora los datos en vivo. Con licUrl vacío no activa el servidor de licencias.
  licUrl: '',   // URL del servidor de licencias (licencias/worker.js). Vacío = prueba local sin protección
  licPub: {"crv":"P-256","d":"JSW0Mact2uuuTtYJEDE6YB3LhOFDrz7QYl9Y1kscMMY","kty":"EC","x":"0pqPEKG5pzNzVQW3kDJIEQQ5mx6cPTija2XKRsCQVIQ","y":"_YMt8pJjr_LdLvncUko940ZTNhmo8A4MQkwR_76Xn5Q"}, // clave pública (la imprime licencias/claves.html)
  waNumber: '5492615117220',
  mpLinks: { B: { M: '', S: '', A: '' }, P: { M: '', S: '', A: '' } },
  prices: { B: { M: '', S: '', A: '' }, P: { M: '', S: '', A: '' } },
  trialDays: 5,
  limits: {
    basic: { fincas: 2, forecastDays: 5, frost: false, hail: false, approach: false },
    pro: { fincas: 20, forecastDays: 14, frost: true, hail: true, approach: true }
  }
};
