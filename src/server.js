'use strict';

const crypto = require('node:crypto');
const { abrirDb } = require('./db');
const { crearApp } = require('./app');
const datos = require('./datos');

const PUERTO = Number(process.env.PORT) || 3000;
const RUTA_DB = process.env.DB_PATH || 'data/pulso.db';
const TZ = process.env.APP_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

const db = abrirDb(RUTA_DB);

// Primer arranque: crear el administrador.
if (!datos.hayAdmin(db)) {
  const email = process.env.ADMIN_EMAIL || 'admin@pulso.local';
  const generada = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  datos.crearAdmin(db, { nombre: process.env.ADMIN_NOMBRE || 'Administrador', email, password });
  console.log(`Administrador creado: ${email}`);
  if (generada) console.log(`Contraseña generada (guárdela, no se volverá a mostrar): ${password}`);
}

const app = crearApp({ db, tz: TZ, cookieSegura: process.env.COOKIE_SECURE === '1' });
app.listen(PUERTO, () => {
  console.log(`Pulso Comercial escuchando en http://localhost:${PUERTO} (zona horaria: ${TZ}, base de datos: ${RUTA_DB})`);
});
