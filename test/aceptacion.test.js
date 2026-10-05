'use strict';

// Criterios de aceptación (sección 12 de la ficha).

const test = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, texto } = require('./ayuda');
const metricas = require('../src/metricas');
const datos = require('../src/datos');

const SEMANA = '2026-10-05'; // semana del reloj inicial (miércoles 7 oct 2026)

test('Autenticación: el vendedor ingresa y solo ve su información', async (t) => {
  const ctx = await iniciar();
  t.after(ctx.cerrar);
  const ana = await ctx.vendedor('Ana');
  const beto = await ctx.vendedor('Beto');
  await ctx.crearOportunidades(beto, 1, 'ClienteDeBeto');
  await ctx.crearOportunidades(ana, 1, 'ClienteDeAna');

  const raiz = await ana.get('/');
  assert.equal(raiz.location, '/mi-dashboard');
  const lista = await ana.get('/oportunidades');
  assert.equal(lista.status, 200);
  assert.match(lista.html, /Mis oportunidades/);
  assert.match(lista.html, /ClienteDeAna/);
  assert.doesNotMatch(lista.html, /ClienteDeBeto/);
  // Aunque pida el filtro de otro vendedor, sigue viendo solo lo suyo.
  const forzado = await ana.get(`/oportunidades?vendedor=${beto.id}`);
  assert.doesNotMatch(forzado.html, /ClienteDeBeto/);
  // Pantallas de administrador: denegadas.
  for (const ruta of ['/admin', '/vendedores', '/configuracion']) {
    assert.equal((await ana.get(ruta)).status, 403, ruta);
  }
});

test('Autenticación: credenciales inválidas, sin sesión y vendedor inactivo', async (t) => {
  const ctx = await iniciar();
  t.after(ctx.cerrar);
  const anonimo = ctx.cliente();
  assert.equal((await anonimo.get('/admin')).location, '/login');
  assert.equal((await anonimo.get('/oportunidades')).location, '/login');
  assert.equal((await anonimo.login('admin@test.com', 'mala')).status, 401);

  const ana = await ctx.vendedor('Ana');
  datos.cambiarActivoVendedor(ctx.db, ana.id, false);
  // La sesión abierta deja de valer y no puede volver a ingresar.
  assert.equal((await ana.get('/mi-dashboard')).location, '/login');
  assert.equal((await ana.login('ana@test.com', 'clave1234')).status, 401);
});

test('Creación de oportunidad: vendedor, fecha y estado Nueva automáticos', async (t) => {
  const ctx = await iniciar();
  t.after(ctx.cerrar);
  const ana = await ctx.vendedor('Ana');
  // Se intentan forzar campos que asigna el sistema: deben ignorarse.
  const r = await ana.post('/oportunidades/nueva', {
    cliente: 'Acme',
    necesidad: 'Cotizar 3 bombas',
    estado: 'Ganada',
    creado_en: '2020-01-01T00:00:00Z',
    vendedor_id: '999',
  });
  assert.equal(r.status, 303);
  const op = ctx.db.prepare('SELECT * FROM oportunidades').get();
  assert.equal(op.cliente, 'Acme');
  assert.equal(op.necesidad, 'Cotizar 3 bombas');
  assert.equal(op.vendedor_id, ana.id);
  assert.equal(op.estado, 'Nueva');
  assert.equal(op.creado_en, ctx.reloj.ahora.toISOString());
  assert.equal(op.semana, SEMANA);
  // Se incorpora de inmediato a los indicadores.
  const dash = texto((await ana.get('/mi-dashboard')).html);
  assert.match(dash, /1 \/ 5 oportunidades/);
  assert.match(dash, /20% de meta/);
});

test('Campos obligatorios: no guarda sin cliente o necesidad e indica qué falta', async (t) => {
  const ctx = await iniciar();
  t.after(ctx.cerrar);
  const ana = await ctx.vendedor('Ana');
  const sinCliente = await ana.post('/oportunidades/nueva', { cliente: '   ', necesidad: 'Algo' });
  assert.equal(sinCliente.status, 422);
  assert.match(sinCliente.html, /El cliente es obligatorio/);
  assert.match(sinCliente.html, /value="Algo"|>Algo</); // conserva lo escrito
  const sinNecesidad = await ana.post('/oportunidades/nueva', { cliente: 'Acme', necesidad: '' });
  assert.equal(sinNecesidad.status, 422);
  assert.match(sinNecesidad.html, /La necesidad del cliente es obligatoria/);
  const nada = await ana.post('/oportunidades/nueva', {});
  assert.match(nada.html, /El cliente es obligatorio/);
  assert.match(nada.html, /La necesidad del cliente es obligatoria/);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM oportunidades').get().n, 0);
});

test('Meta cumplida: 5 oportunidades = 5 / 5 — 100%', async (t) => {
  const ctx = await iniciar();
  t.after(ctx.cerrar);
  const ana = await ctx.vendedor('Ana');
  await ctx.crearOportunidades(ana, 5);
  const p = metricas.progresoVendedor(ctx.db, ana.id, SEMANA);
  assert.deepEqual([p.creadas, p.meta, p.porcentaje, p.cumple], [5, 5, 100, true]);
  const dash = texto((await ana.get('/mi-dashboard')).html);
  assert.match(dash, /5 \/ 5 oportunidades/);
  assert.match(dash, /100% de meta/);
});

test('Meta superada: 7 oportunidades = 7 / 5 — 140%', async (t) => {
  const ctx = await iniciar();
  t.after(ctx.cerrar);
  const ana = await ctx.vendedor('Ana');
  await ctx.crearOportunidades(ana, 7);
  const dash = texto((await ana.get('/mi-dashboard')).html);
  assert.match(dash, /7 \/ 5 oportunidades/);
  assert.match(dash, /140% de meta/);
});

test('Ranking: A con 8 aparece antes que B con 5; indicadores del equipo', async (t) => {
  const ctx = await iniciar();
  t.after(ctx.cerrar);
  const b = await ctx.vendedor('Bea');
  const a = await ctx.vendedor('Alan');
  const c = await ctx.vendedor('Ceci');
  await ctx.crearOportunidades(b, 5);
  await ctx.crearOportunidades(a, 8);
  await ctx.crearOportunidades(c, 2);

  const r = metricas.resumenEquipo(ctx.db, SEMANA);
  assert.deepEqual(
    r.ranking.map((x) => [x.nombre, x.creadas, x.porcentaje]),
    [['Alan', 8, 160], ['Bea', 5, 100], ['Ceci', 2, 40]]
  );
  assert.equal(r.metaEquipo, 15); // 5 × 3 vendedores activos
  assert.equal(r.creadas, 15);
  assert.equal(r.porcentaje, 100);
  assert.deepEqual(r.lideres.map((l) => l.nombre), ['Alan']);
  assert.equal(r.cumplen, 2);

  const admin = await ctx.admin();
  const dash = (await admin.get('/admin')).html;
  const plano = texto(dash);
  assert.ok(plano.indexOf('Alan') < plano.indexOf('Bea'), 'Alan antes que Bea');
  assert.match(plano, /Oportunidades esta semana 15/);
  assert.match(plano, /Meta semanal del equipo 15 5 × 3 vendedores/);
  assert.match(plano, /% de cumplimiento 100%/);
  assert.match(plano, /Vendedor líder Alan 8 oportunidades/);
  assert.match(dash, /<svg class="grafica"/);
  assert.match(dash, /Meta 5/);
  // Pipeline: 15 nuevas.
  assert.deepEqual(metricas.pipeline(ctx.db, { semana: SEMANA }).map((p) => p.cantidad), [15, 0, 0, 0, 0]);
});

test('Meta del equipo: 4 vendedores × 5 = 20; los inactivos sin actividad no cuentan', async (t) => {
  const ctx = await iniciar();
  t.after(ctx.cerrar);
  for (const n of ['A', 'B', 'C', 'D']) await ctx.vendedor(n);
  assert.equal(metricas.resumenEquipo(ctx.db, SEMANA).metaEquipo, 20);
  const e = await ctx.vendedor('E');
  datos.cambiarActivoVendedor(ctx.db, e.id, false);
  assert.equal(metricas.resumenEquipo(ctx.db, SEMANA).metaEquipo, 20);
});

test('Permisos: un vendedor no puede consultar ni modificar oportunidades de otro', async (t) => {
  const ctx = await iniciar();
  t.after(ctx.cerrar);
  const ana = await ctx.vendedor('Ana');
  const beto = await ctx.vendedor('Beto');
  await ctx.crearOportunidades(beto, 1, 'Privado');
  const id = ctx.db.prepare('SELECT id FROM oportunidades').get().id;

  assert.equal((await ana.get(`/oportunidades/${id}`)).status, 403);
  const intento = await ana.post(`/oportunidades/${id}`, { cliente: 'Hackeado', necesidad: 'x', estado: 'Perdida' });
  assert.equal(intento.status, 403);
  const op = ctx.db.prepare('SELECT * FROM oportunidades WHERE id = ?').get(id);
  assert.equal(op.cliente, 'Privado 1');
  assert.equal(op.estado, 'Nueva');
  // Beto sí puede.
  assert.equal((await beto.get(`/oportunidades/${id}`)).status, 200);
});

test('Administrador: consulta todos los vendedores y oportunidades', async (t) => {
  const ctx = await iniciar();
  t.after(ctx.cerrar);
  const ana = await ctx.vendedor('Ana');
  const beto = await ctx.vendedor('Beto');
  await ctx.crearOportunidades(ana, 1, 'DeAna');
  await ctx.crearOportunidades(beto, 1, 'DeBeto');
  const admin = await ctx.admin();
  assert.equal((await ctx.cliente().get('/')).location, '/login');
  assert.equal((await admin.get('/')).location, '/admin');
  const lista = await admin.get('/oportunidades');
  assert.match(lista.html, /Todas las oportunidades/);
  assert.match(lista.html, /DeAna 1/);
  assert.match(lista.html, /DeBeto 1/);
  const vend = texto((await admin.get('/vendedores')).html);
  assert.match(vend, /Ana/);
  assert.match(vend, /Beto/);
  const id = ctx.db.prepare('SELECT id FROM oportunidades WHERE vendedor_id = ?').get(ana.id).id;
  assert.equal((await admin.get(`/oportunidades/${id}`)).status, 200);
  // Filtro por vendedor.
  const filtrada = await admin.get(`/oportunidades?vendedor=${beto.id}`);
  assert.match(filtrada.html, /DeBeto 1/);
  assert.doesNotMatch(filtrada.html, /DeAna 1/);
});

test('Cambio de estado e historial: cada cambio guarda anterior, nuevo, fecha/hora y usuario', async (t) => {
  const ctx = await iniciar();
  t.after(ctx.cerrar);
  const ana = await ctx.vendedor('Ana');
  await ctx.crearOportunidades(ana, 1);
  const id = ctx.db.prepare('SELECT id FROM oportunidades').get().id;
  const base = { cliente: 'Cliente 1', necesidad: 'Necesidad 1' };

  const pasos = [
    ['En cotización', '2026-10-07T16:00:00Z'],
    ['Cotizada', '2026-10-08T16:00:00Z'],
    ['Ganada', '2026-10-09T16:00:00Z'],
  ];
  for (const [estado, fecha] of pasos) {
    ctx.reloj.ahora = new Date(fecha);
    const r = await ana.post(`/oportunidades/${id}`, { ...base, estado });
    assert.equal(r.status, 303);
    assert.equal(ctx.db.prepare('SELECT estado FROM oportunidades WHERE id = ?').get(id).estado, estado);
  }
  // Guardar sin cambiar el estado no agrega historial.
  await ana.post(`/oportunidades/${id}`, { ...base, cliente: 'Cliente renombrado', estado: 'Ganada' });

  const usuarioAna = ctx.db.prepare('SELECT usuario_id FROM vendedores WHERE id = ?').get(ana.id).usuario_id;
  const hist = datos.historialDe(ctx.db, id);
  assert.deepEqual(
    hist.map((h) => [h.estado_anterior, h.estado_nuevo, h.cambiado_en, h.usuario_id]),
    [
      [null, 'Nueva', '2026-10-07T15:00:00.000Z', usuarioAna],
      ['Nueva', 'En cotización', '2026-10-07T16:00:00.000Z', usuarioAna],
      ['En cotización', 'Cotizada', '2026-10-08T16:00:00.000Z', usuarioAna],
      ['Cotizada', 'Ganada', '2026-10-09T16:00:00.000Z', usuarioAna],
    ]
  );
  const detalle = await ana.get(`/oportunidades/${id}`);
  assert.match(detalle.html, /Historial de estados/);
  assert.match(detalle.html, /Cliente renombrado/);
  // Se puede marcar Perdida sin pasar por Cotizada.
  ctx.reloj.ahora = new Date('2026-10-09T17:00:00Z');
  await ctx.crearOportunidades(ana, 1, 'Otra');
  const id2 = ctx.db.prepare("SELECT id FROM oportunidades WHERE cliente = 'Otra 1'").get().id;
  assert.equal((await ana.post(`/oportunidades/${id2}`, { cliente: 'Otra 1', necesidad: 'N', estado: 'Perdida' })).status, 303);
  // Estado inválido: rechazado.
  const malo = await ana.post(`/oportunidades/${id2}`, { cliente: 'Otra 1', necesidad: 'N', estado: 'Inventado' });
  assert.equal(malo.status, 422);
});

test('El administrador consulta pero no modifica oportunidades', async (t) => {
  const ctx = await iniciar();
  t.after(ctx.cerrar);
  const ana = await ctx.vendedor('Ana');
  await ctx.crearOportunidades(ana, 1);
  const id = ctx.db.prepare('SELECT id FROM oportunidades').get().id;
  const admin = await ctx.admin();
  const r = await admin.post(`/oportunidades/${id}`, { cliente: 'X', necesidad: 'Y', estado: 'Ganada' });
  assert.equal(r.status, 403);
  assert.equal((await admin.get('/oportunidades/nueva')).status, 403);
});

test('Integridad de fecha: cambiar estado en otra semana no cambia su semana de conteo', async (t) => {
  const ctx = await iniciar({ fecha: '2026-09-30T15:00:00Z' }); // semana del 28 sep
  t.after(ctx.cerrar);
  const ana = await ctx.vendedor('Ana');
  await ctx.crearOportunidades(ana, 2);
  const id = ctx.db.prepare('SELECT id FROM oportunidades').get().id;

  ctx.reloj.ahora = new Date('2026-10-07T15:00:00Z'); // semana del 5 oct
  await ana.reingresar();
  await ana.post(`/oportunidades/${id}`, { cliente: 'Cliente 1', necesidad: 'Necesidad 1', estado: 'Cotizada' });
  const op = ctx.db.prepare('SELECT * FROM oportunidades WHERE id = ?').get(id);
  assert.equal(op.semana, '2026-09-28');
  assert.equal(op.creado_en, '2026-09-30T15:00:00.000Z');
  assert.equal(metricas.progresoVendedor(ctx.db, ana.id, '2026-09-28').creadas, 2);
  assert.equal(metricas.progresoVendedor(ctx.db, ana.id, '2026-10-05').creadas, 0);
  // Ni siquiera directamente en la base de datos se puede alterar la fecha.
  assert.throws(() => ctx.db.prepare('UPDATE oportunidades SET creado_en = ? WHERE id = ?').run('2026-10-07', id), /no se pueden modificar/);
  assert.throws(() => ctx.db.prepare('UPDATE oportunidades SET semana = ? WHERE id = ?').run('2026-10-05', id), /no se pueden modificar/);
});

test('Nueva semana: el indicador vuelve a cero sin borrar datos anteriores', async (t) => {
  const ctx = await iniciar({ fecha: '2026-10-11T23:00:00Z' }); // domingo 11 oct, 17:00 en Costa Rica
  t.after(ctx.cerrar);
  const ana = await ctx.vendedor('Ana');
  await ctx.crearOportunidades(ana, 4);
  assert.match(texto((await ana.get('/mi-dashboard')).html), /4 \/ 5 oportunidades/);

  ctx.reloj.ahora = new Date('2026-10-12T06:30:00Z'); // lunes 12 oct, 00:30 en Costa Rica
  const dash = texto((await ana.get('/mi-dashboard')).html);
  assert.match(dash, /0 \/ 5 oportunidades/);
  assert.match(dash, /0% de meta/);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM oportunidades').get().n, 4);
  // El histórico del vendedor muestra la semana anterior.
  assert.match(dash, /Mi histórico.*5 oct – 11 oct 2026 4 5 80%/);
  // Las oportunidades no se pueden borrar.
  assert.throws(() => ctx.db.prepare('DELETE FROM oportunidades').run(), /histórico/);
});

test('Histórico: el administrador consulta una semana anterior con sus indicadores', async (t) => {
  const ctx = await iniciar({ fecha: '2026-09-23T15:00:00Z' }); // semana del 21 sep
  t.after(ctx.cerrar);
  const ana = await ctx.vendedor('Ana');
  const beto = await ctx.vendedor('Beto');
  await ctx.crearOportunidades(ana, 6, 'Sep');
  await ctx.crearOportunidades(beto, 2, 'Sep');
  ctx.reloj.ahora = new Date('2026-10-07T15:00:00Z');
  await beto.reingresar(); // la sesión de 7 días expiró
  await ctx.crearOportunidades(beto, 1, 'Oct');

  const admin = await ctx.admin();
  const actual = texto((await admin.get('/admin')).html);
  assert.match(actual, /Oportunidades esta semana 1/);
  assert.match(actual, /Vendedor líder Beto/);

  const pasada = texto((await admin.get('/admin?semana=2026-09-21')).html);
  assert.match(pasada, /Oportunidades esta semana 8/);
  assert.match(pasada, /Meta semanal del equipo 10/);
  assert.match(pasada, /% de cumplimiento 80%/);
  assert.match(pasada, /Vendedor líder Ana 6 oportunidades/);

  const lista = await admin.get('/oportunidades?semana=2026-09-21');
  assert.match(lista.html, /8 oportunidades/);
  assert.doesNotMatch(lista.html, /Oct 1/);
  // Filtro por estado.
  const nuevas = await admin.get('/oportunidades?estado=Ganada');
  assert.match(nuevas.html, /0 oportunidades/);
  // Semanas inválidas o futuras vuelven a la actual.
  assert.match(texto((await admin.get('/admin?semana=2030-01-07')).html), /Oportunidades esta semana 1/);
  assert.match(texto((await admin.get('/admin?semana=xx')).html), /Oportunidades esta semana 1/);
});

test('Persistencia: cerrar sesión y volver a ingresar conserva la información', async (t) => {
  const ctx = await iniciar();
  t.after(ctx.cerrar);
  const ana = await ctx.vendedor('Ana');
  await ctx.crearOportunidades(ana, 3);
  assert.equal((await ana.post('/logout')).location, '/login');
  assert.equal((await ana.get('/mi-dashboard')).location, '/login');
  await ana.login('ana@test.com', 'clave1234');
  assert.match(texto((await ana.get('/mi-dashboard')).html), /3 \/ 5 oportunidades/);
});

test('Persistencia: los datos sobreviven a reiniciar la aplicación (archivo SQLite)', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { abrirDb } = require('../src/db');
  const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-')), 'p.db');
  let db = abrirDb(ruta);
  const vid = datos.crearVendedor(db, { nombre: 'Ana', email: 'ana@x.com', password: 'clave1234' }, { tz: 'UTC' });
  const v = datos.vendedorPorId(db, vid);
  datos.crearOportunidad(db, { cliente: 'Acme', necesidad: 'X' }, { vendedor: v, usuarioId: v.usuario_id, tz: 'UTC' });
  datos.cambiarMeta(db, '7', { usuarioId: v.usuario_id, tz: 'UTC' });
  db.close();
  db = abrirDb(ruta);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM oportunidades').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM metas').get().n, 2); // no re-siembra la meta inicial
  db.close();
});

test('Cambio de meta: aplica desde la semana actual; semanas anteriores conservan la suya', async (t) => {
  const ctx = await iniciar({ fecha: '2026-09-30T15:00:00Z' });
  t.after(ctx.cerrar);
  const ana = await ctx.vendedor('Ana');
  await ctx.crearOportunidades(ana, 5);
  ctx.reloj.ahora = new Date('2026-10-07T15:00:00Z');
  await ana.reingresar(); // la sesión de 7 días expiró
  await ctx.crearOportunidades(ana, 5);

  const admin = await ctx.admin();
  assert.match(texto((await admin.get('/configuracion')).html), /Meta vigente: 5/);
  const malo = await admin.post('/configuracion', { meta: '0' });
  assert.equal(malo.status, 422);
  assert.match(malo.html, /entero entre 1 y 1000/);
  assert.equal((await admin.post('/configuracion', { meta: '4.5' })).status, 422);
  assert.equal((await admin.post('/configuracion', { meta: '8' })).status, 303);

  assert.match(texto((await admin.get('/configuracion')).html), /Meta vigente: 8/);
  const actual = metricas.progresoVendedor(ctx.db, ana.id, '2026-10-05');
  assert.deepEqual([actual.meta, actual.creadas, actual.porcentaje], [8, 5, 63]);
  const anterior = metricas.progresoVendedor(ctx.db, ana.id, '2026-09-28');
  assert.deepEqual([anterior.meta, anterior.porcentaje], [5, 100]);
  assert.match(texto((await ana.get('/mi-dashboard')).html), /5 \/ 8 oportunidades/);
  assert.equal(metricas.resumenEquipo(ctx.db, '2026-10-05').metaEquipo, 8);
  // El vendedor no puede cambiar la meta.
  assert.equal((await ana.post('/configuracion', { meta: '1' })).status, 403);
});

test('Vendedores: crear, editar, desactivar y activar sin perder histórico', async (t) => {
  const ctx = await iniciar();
  t.after(ctx.cerrar);
  const admin = await ctx.admin();
  const r = await admin.post('/vendedores', { nombre: 'Dani', email: 'dani@test.com', password: 'clave1234' });
  assert.equal(r.status, 303);
  const dup = await admin.post('/vendedores', { nombre: 'Otro', email: 'DANI@test.com', password: 'clave1234' });
  assert.equal(dup.status, 422);
  assert.match(dup.html, /Ya existe un usuario con ese correo/);
  assert.equal((await admin.post('/vendedores', { nombre: '', email: 'x@test.com', password: '123' })).status, 422);

  const id = ctx.db.prepare("SELECT id FROM vendedores WHERE nombre = 'Dani'").get().id;
  const dani = ctx.cliente();
  assert.equal((await dani.login('dani@test.com', 'clave1234')).location, '/mi-dashboard');
  await ctx.crearOportunidades(dani, 2);

  assert.equal((await admin.post(`/vendedores/${id}`, { nombre: 'Daniela', email: 'dani@test.com', password: '' })).status, 303);
  assert.equal(datos.vendedorPorId(ctx.db, id).nombre, 'Daniela');

  assert.equal((await admin.post(`/vendedores/${id}/activo`, { activo: '0' })).status, 303);
  assert.equal((await dani.get('/mi-dashboard')).location, '/login');
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM oportunidades WHERE vendedor_id = ?').get(id).n, 2);
  // Inactivo con oportunidades en la semana: sigue apareciendo en el ranking de esa semana.
  assert.match(texto((await admin.get('/admin')).html), /Daniela Inactivo/);
  assert.throws(() => ctx.db.prepare('DELETE FROM vendedores WHERE id = ?').run(id), /FOREIGN KEY/);

  assert.equal((await admin.post(`/vendedores/${id}/activo`, { activo: '1' })).status, 303);
  assert.equal((await dani.login('dani@test.com', 'clave1234')).location, '/mi-dashboard');
  assert.equal((await admin.get(`/vendedores/${id}`)).status, 200);
});

test('Las entradas se escapan al mostrarse (sin inyección de HTML)', async (t) => {
  const ctx = await iniciar();
  t.after(ctx.cerrar);
  const ana = await ctx.vendedor('Ana');
  await ana.post('/oportunidades/nueva', { cliente: '<script>alert(1)</script>', necesidad: '"><img src=x>' });
  const html = (await ana.get('/oportunidades')).html;
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;script&gt;/);
});
