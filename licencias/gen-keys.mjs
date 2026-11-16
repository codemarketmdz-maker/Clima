// Genera las claves del servidor de licencias. Uso:  node licencias/gen-keys.mjs
import { webcrypto as c } from 'node:crypto';
const { publicKey, privateKey } = await c.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const hex = n => [...c.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const pub = await c.subtle.exportKey('jwk', publicKey), prv = await c.subtle.exportKey('jwk', privateKey);
delete pub.key_ops; delete pub.ext; delete prv.key_ops; delete prv.ext;
console.log('=== 1) SECRET  SIGN_PRIVATE  (pegala en Cloudflare como Secret; NO la subas a GitHub) ===\n' + JSON.stringify(prv));
console.log('\n=== 2) SECRET  ADMIN_KEY  (tu contraseña para admin.html) ===\n' + hex(24));
console.log('\n=== 3) SECRET  IP_SALT ===\n' + hex(16));
console.log('\n=== 4) config.js → licPub  (clave PÚBLICA, esta sí va en GitHub) ===\n' + JSON.stringify(pub));
