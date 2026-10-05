'use strict';

// Utilidades de prueba: levanta la app con BD en memoria y un reloj controlable.

const { abrirDb } = require('../src/db');
const { crearApp } = require('../src/app');
const datos = require('../src/datos');

const TZ = 'America/Costa_Rica'; // UTC-6, sin horario de verano

async function iniciar({ fecha = '2026-10-07T15:00:00Z' } = {}) {
  const db = abrirDb(':memory:');
  const reloj = { ahora: new Date(fecha) };
  const app = crearApp({ db, tz: TZ, ahora: () => new Date(reloj.ahora) });
  const servidor = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  datos.crearAdmin(db, { nombre: 'Admin', email: 'admin@test.com', password: 'admin12345' });

  function cliente() {
    let cookie = '';
    async function pedir(metodo, ruta, cuerpo) {
      const res = await fetch(base + ruta, {
        method: metodo,
        redirect: 'manual',
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(cuerpo ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: cuerpo ? new URLSearchParams(cuerpo).toString() : undefined,
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { status: res.status, location: res.headers.get('location'), html: await res.text() };
    }
    return {
      get: (ruta) => pedir('GET', ruta),
      post: (ruta, cuerpo = {}) => pedir('POST', ruta, cuerpo),
      async login(email, password) {
        this.credenciales = [email, password];
        return pedir('POST', '/login', { email, password });
      },
      /** Vuelve a iniciar sesión (p. ej. después de adelantar el reloj más allá de la expiración). */
      async reingresar() {
        return this.login(...this.credenciales);
      },
    };
  }

  async function admin() {
    const c = cliente();
    await c.login('admin@test.com', 'admin12345');
    return c;
  }

  /** Crea un vendedor (vía datos) y devuelve un cliente con sesión iniciada. */
  async function vendedor(nombre) {
    const email = `${nombre.toLowerCase()}@test.com`;
    const id = datos.crearVendedor(db, { nombre, email, password: 'clave1234' }, { tz: TZ, ahora: new Date('2020-01-01T12:00:00Z') });
    const c = cliente();
    await c.login(email, 'clave1234');
    c.id = id;
    return c;
  }

  async function crearOportunidades(c, n, prefijo = 'Cliente') {
    for (let i = 0; i < n; i++) {
      const r = await c.post('/oportunidades/nueva', { cliente: `${prefijo} ${i + 1}`, necesidad: `Necesidad ${i + 1}` });
      if (r.status !== 303 || !String(r.location).includes('ok=creada')) {
        throw new Error(`No se creó la oportunidad: ${r.status} ${r.location}`);
      }
    }
  }

  return {
    db,
    reloj,
    base,
    cliente,
    admin,
    vendedor,
    crearOportunidades,
    cerrar: () => new Promise((r) => servidor.close(r)),
  };
}

/** Texto plano de un fragmento HTML (para aserciones legibles). */
const texto = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

module.exports = { iniciar, texto, TZ };
