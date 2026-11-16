/* Ajustes comerciales de TiempoMDZ — editá este archivo y recompilá.
   waNumber : WhatsApp que recibe los pedidos de licencia (formato internacional, sin + ni espacios).
   mpLinks  : links de pago de Mercado Pago. Estructura: mpLinks.B.M (Básica mensual), .B.S (semestral), .B.A (anual) y lo mismo en .P para Pro.
              Si un plan no tiene link, solo se ofrece pedirlo por WhatsApp.
   licUrl / licPub : servidor de licencias (licencias/worker.js) y su clave pública. Con ellos la prueba y las licencias las decide el servidor.
   prices   : precio que se muestra en cada plan (texto libre, ej. "$2.500"). Vacío = no se muestra precio.
   limits   : qué incluye cada tipo de licencia. Los avisos OFICIALES del SMN se muestran siempre, en todos los planes.
              fincas       = cantidad máxima de fincas guardadas (además de "Mi ubicación")
              forecastDays = días del pronóstico extendido que se muestran
              frost / hail / approach = funciones exclusivas (true = incluida)
              Si el plan no incluye "hail", un granizo se avisa como "tormenta fuerte". */
window.CM_CFG = {
  brand: 'CodeMarket',
  proxy: '',   // opcional (sin usar por ahora): URL de un proxy propio; se usan las copias de GitHub Actions y proxies públicos de respaldo
  licUrl: 'https://tiempomdz-licencias.codemarketmdz.workers.dev/',   // URL del servidor de licencias (licencias/worker.js). Vacío = prueba local sin protección
  licPub: {"crv":"P-256","kty":"EC","x":"j7eoQqVl_32_ulYUSYXDxoqvAofmo2c8A40e99TjHTE","y":"uMog43ZYuX79RSq6NfocEywlZ07yYR4tP39VfmBhHWc"}, // clave pública (la imprime licencias/gen-keys.mjs)
  waNumber: '5492615117220',
  mpLinks: { B: { M: '', S: '', A: '' }, P: { M: '', S: '', A: '' } },
  prices: { B: { M: '', S: '', A: '' }, P: { M: '', S: '', A: '' } },
  trialDays: 5,
  limits: {
    basic: { fincas: 2, forecastDays: 5, frost: false, hail: false, approach: false },
    pro: { fincas: 20, forecastDays: 14, frost: true, hail: true, approach: true }
  }
};
