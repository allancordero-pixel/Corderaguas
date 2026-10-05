'use strict';

// Carga datos de demostración: 4 vendedores y oportunidades en las últimas 4 semanas.
// Uso: npm run seed:demo   (usa DB_PATH y APP_TZ igual que el servidor)

const { abrirDb, ESTADOS } = require('../src/db');
const datos = require('../src/datos');

const RUTA_DB = process.env.DB_PATH || 'data/pulso.db';
const TZ = process.env.APP_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
const PASSWORD = 'demo1234';
const DIA = 24 * 60 * 60 * 1000;

const db = abrirDb(RUTA_DB);
if (db.prepare('SELECT COUNT(*) AS n FROM vendedores').get().n > 0) {
  console.log('La base ya tiene vendedores; no se cargan datos de demostración.');
  process.exit(0);
}
if (!datos.hayAdmin(db)) {
  datos.crearAdmin(db, { nombre: 'Administrador', email: 'admin@pulso.local', password: PASSWORD });
  console.log(`Administrador: admin@pulso.local / ${PASSWORD}`);
}

const ahora = Date.now();
const alta = new Date(ahora - 35 * DIA);
const clientes = ['Hotel Las Palmas', 'Constructora Delta', 'Finca El Roble', 'Condominio Vista Mar', 'Restaurante La Costa',
  'Colegio San José', 'Clínica Santa Ana', 'Agrícola del Norte', 'Supermercado Central', 'Parque Industrial Oeste'];
const necesidades = ['Sistema de bombeo para tanque elevado', 'Mantenimiento de pozo', 'Planta de tratamiento de agua',
  'Filtros para agua potable', 'Riego por goteo para 5 hectáreas', 'Equipo hidroneumático', 'Revisión de tuberías principales'];

// Oportunidades por semana (de la más antigua a la actual) para cada vendedor.
const plan = { 'Ana Rojas': [6, 5, 7, 3], 'Bruno Méndez': [4, 5, 3, 2], 'Carla Jiménez': [5, 8, 6, 4], 'Diego Vargas': [2, 3, 4, 1] };

let n = 0;
for (const [nombre, semanas] of Object.entries(plan)) {
  const email = nombre.split(' ')[0].toLowerCase() + '@pulso.local';
  const id = datos.crearVendedor(db, { nombre, email, password: PASSWORD }, { tz: TZ, ahora: alta });
  const vendedor = datos.vendedorPorId(db, id);
  console.log(`Vendedor: ${email} / ${PASSWORD}`);
  semanas.forEach((cantidad, i) => {
    const semanasAtras = semanas.length - 1 - i;
    for (let k = 0; k < cantidad; k++) {
      // Repartir dentro de la semana, sin pasar del momento actual.
      const fecha = new Date(Math.min(ahora - 60_000, ahora - semanasAtras * 7 * DIA - ((k * 13) % 72) * 3600_000));
      const opId = datos.crearOportunidad(
        db,
        { cliente: clientes[(n + k) % clientes.length], necesidad: necesidades[(n * 3 + k) % necesidades.length] },
        { vendedor, usuarioId: vendedor.usuario_id, tz: TZ, ahora: fecha }
      );
      // Avanzar algunas oportunidades en el pipeline.
      const avance = (n + k) % (semanasAtras + 2);
      const recorrido = (n + k) % 4 === 3 ? ['En cotización', 'Perdida'] : ESTADOS.slice(1, 1 + Math.min(avance, 3));
      recorrido.forEach((estado, j) => {
        const op = datos.oportunidadPorId(db, opId);
        datos.actualizarOportunidad(db, opId, { cliente: op.cliente, necesidad: op.necesidad, estado },
          { usuarioId: vendedor.usuario_id, ahora: new Date(Math.min(ahora, fecha.getTime() + (j + 1) * 3600_000)) });
      });
      n++;
    }
  });
}
console.log(`${n} oportunidades de demostración creadas en ${RUTA_DB}.`);
