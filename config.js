/* Ajustes comerciales de TiempoMDZ — editá este archivo y recompilá.
   waNumber : WhatsApp que recibe los pedidos de licencia (formato internacional, sin + ni espacios).
   mpLinks  : links de pago de Mercado Pago de cada plan (opcional). Si un plan no tiene link, solo se ofrece pedirlo por WhatsApp.
   proxy    : URL de tu Cloudflare Worker (ver worker.js). Habilita SMN, INPRES y METAR de forma estable en GitHub Pages. Vacío = solo proxies públicos de respaldo.
   prices   : precio que se muestra en cada plan (texto libre, ej. "$4.500"). Vacío = no se muestra precio. */
window.CM_CFG = {
  brand: 'CodeMarket',
  proxy: '',
  waNumber: '5492615117220',
  mpLinks: { M: '', S: '', A: '' },
  prices: { M: '', S: '', A: '' }
};
