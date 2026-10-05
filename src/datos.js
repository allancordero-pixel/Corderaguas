'use strict';

// Acceso a datos y reglas de negocio. Las rutas solo llaman a estas funciones.

const { transaccion, ESTADOS, ESTADO_INICIAL } = require('./db');
const { semanaDe } = require('./semana');
const { hashPassword } = require('./seguridad');

const LIMITES = { cliente: 200, necesidad: 2000, nombre: 120, email: 200 };
const PASSWORD_MIN = 8;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class ErrorValidacion extends Error {
  constructor(errores) {
    super('Datos inválidos');
    this.errores = errores;
  }
}

const limpiar = (v) => (typeof v === 'string' ? v.trim() : '');

// ---------------------------------------------------------------- usuarios

function usuarioPorId(db, id) {
  return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id) || null;
}

function usuarioPorEmail(db, email) {
  return db.prepare('SELECT * FROM usuarios WHERE email = ?').get(limpiar(email)) || null;
}

function crearAdmin(db, { nombre, email, password }, ahora = new Date()) {
  return Number(
    db
      .prepare(
        "INSERT INTO usuarios (nombre, email, password_hash, rol, activo, creado_en) VALUES (?, ?, ?, 'admin', 1, ?)"
      )
      .run(nombre, email, hashPassword(password), ahora.toISOString()).lastInsertRowid
  );
}

function hayAdmin(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin'").get().n > 0;
}

// -------------------------------------------------------------- vendedores

function validarVendedor(db, entrada, { idUsuarioActual = null, passwordObligatorio }) {
  const datos = {
    nombre: limpiar(entrada.nombre),
    email: limpiar(entrada.email).toLowerCase(),
    password: typeof entrada.password === 'string' ? entrada.password : '',
  };
  const errores = {};
  if (!datos.nombre) errores.nombre = 'El nombre es obligatorio.';
  else if (datos.nombre.length > LIMITES.nombre) errores.nombre = `Máximo ${LIMITES.nombre} caracteres.`;
  if (!datos.email) errores.email = 'El correo es obligatorio.';
  else if (!RE_EMAIL.test(datos.email) || datos.email.length > LIMITES.email) errores.email = 'Correo no válido.';
  else {
    const existente = usuarioPorEmail(db, datos.email);
    if (existente && existente.id !== idUsuarioActual) errores.email = 'Ya existe un usuario con ese correo.';
  }
  if (passwordObligatorio || datos.password) {
    if (datos.password.length < PASSWORD_MIN)
      errores.password = `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
  }
  if (Object.keys(errores).length) throw new ErrorValidacion(errores);
  return datos;
}

function crearVendedor(db, entrada, { tz, ahora = new Date() }) {
  const datos = validarVendedor(db, entrada, { passwordObligatorio: true });
  return transaccion(db, () => {
    const usuarioId = Number(
      db
        .prepare(
          "INSERT INTO usuarios (nombre, email, password_hash, rol, activo, creado_en) VALUES (?, ?, ?, 'vendedor', 1, ?)"
        )
        .run(datos.nombre, datos.email, hashPassword(datos.password), ahora.toISOString()).lastInsertRowid
    );
    return Number(
      db
        .prepare('INSERT INTO vendedores (usuario_id, nombre, activo, creado_en, semana_alta) VALUES (?, ?, 1, ?, ?)')
        .run(usuarioId, datos.nombre, ahora.toISOString(), semanaDe(ahora, tz)).lastInsertRowid
    );
  });
}

function editarVendedor(db, vendedorId, entrada) {
  const v = vendedorPorId(db, vendedorId);
  if (!v) return null;
  const datos = validarVendedor(db, entrada, { idUsuarioActual: v.usuario_id, passwordObligatorio: false });
  transaccion(db, () => {
    db.prepare('UPDATE vendedores SET nombre = ? WHERE id = ?').run(datos.nombre, v.id);
    db.prepare('UPDATE usuarios SET nombre = ?, email = ? WHERE id = ?').run(datos.nombre, datos.email, v.usuario_id);
    if (datos.password) {
      db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hashPassword(datos.password), v.usuario_id);
      db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(v.usuario_id);
    }
  });
  return vendedorPorId(db, vendedorId);
}

/** Activa o desactiva al vendedor y a su usuario. Nunca se elimina: conserva el histórico. */
function cambiarActivoVendedor(db, vendedorId, activo) {
  const v = vendedorPorId(db, vendedorId);
  if (!v) return null;
  const valor = activo ? 1 : 0;
  transaccion(db, () => {
    db.prepare('UPDATE vendedores SET activo = ? WHERE id = ?').run(valor, v.id);
    db.prepare('UPDATE usuarios SET activo = ? WHERE id = ?').run(valor, v.usuario_id);
    if (!valor) db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(v.usuario_id);
  });
  return vendedorPorId(db, vendedorId);
}

const SELECT_VENDEDOR = `
  SELECT v.id, v.usuario_id, v.nombre, v.activo, v.creado_en, v.semana_alta, u.email
  FROM vendedores v JOIN usuarios u ON u.id = v.usuario_id`;

function vendedorPorId(db, id) {
  return db.prepare(`${SELECT_VENDEDOR} WHERE v.id = ?`).get(id) || null;
}

function vendedorPorUsuario(db, usuarioId) {
  return db.prepare(`${SELECT_VENDEDOR} WHERE v.usuario_id = ?`).get(usuarioId) || null;
}

function listarVendedores(db) {
  return db.prepare(`${SELECT_VENDEDOR} ORDER BY v.activo DESC, v.nombre COLLATE NOCASE`).all();
}

// ----------------------------------------------------------- oportunidades

function validarOportunidad(entrada, { conEstado }) {
  const datos = { cliente: limpiar(entrada.cliente), necesidad: limpiar(entrada.necesidad) };
  const errores = {};
  if (!datos.cliente) errores.cliente = 'El cliente es obligatorio.';
  else if (datos.cliente.length > LIMITES.cliente) errores.cliente = `Máximo ${LIMITES.cliente} caracteres.`;
  if (!datos.necesidad) errores.necesidad = 'La necesidad del cliente es obligatoria.';
  else if (datos.necesidad.length > LIMITES.necesidad)
    errores.necesidad = `Máximo ${LIMITES.necesidad} caracteres.`;
  if (conEstado) {
    datos.estado = limpiar(entrada.estado);
    if (!ESTADOS.includes(datos.estado)) errores.estado = 'Seleccione un estado válido.';
  }
  if (Object.keys(errores).length) throw new ErrorValidacion(errores);
  return datos;
}

/**
 * Crea una oportunidad. Vendedor, fecha, semana y estado inicial los asigna el sistema
 * (reglas 2, 3 y 4); cualquier valor enviado para esos campos se ignora.
 */
function crearOportunidad(db, entrada, { vendedor, usuarioId, tz, ahora = new Date() }) {
  const datos = validarOportunidad(entrada, { conEstado: false });
  const fecha = ahora.toISOString();
  const semana = semanaDe(ahora, tz);
  return transaccion(db, () => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO oportunidades (cliente, necesidad, vendedor_id, creado_en, semana, estado, actualizado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(datos.cliente, datos.necesidad, vendedor.id, fecha, semana, ESTADO_INICIAL, fecha).lastInsertRowid
    );
    db.prepare(
      'INSERT INTO historial_estados (oportunidad_id, estado_anterior, estado_nuevo, cambiado_en, usuario_id) VALUES (?, NULL, ?, ?, ?)'
    ).run(id, ESTADO_INICIAL, fecha, usuarioId);
    return id;
  });
}

/** Actualiza cliente, necesidad y estado. Si el estado cambia, lo registra en el historial. */
function actualizarOportunidad(db, id, entrada, { usuarioId, ahora = new Date() }) {
  const datos = validarOportunidad(entrada, { conEstado: true });
  return transaccion(db, () => {
    const actual = db.prepare('SELECT * FROM oportunidades WHERE id = ?').get(id);
    if (!actual) return null;
    const cambioEstado = actual.estado !== datos.estado;
    const huboCambios = cambioEstado || actual.cliente !== datos.cliente || actual.necesidad !== datos.necesidad;
    if (!huboCambios) return { cambios: false, cambioEstado: false };
    const fecha = ahora.toISOString();
    db.prepare(
      'UPDATE oportunidades SET cliente = ?, necesidad = ?, estado = ?, actualizado_en = ? WHERE id = ?'
    ).run(datos.cliente, datos.necesidad, datos.estado, fecha, id);
    if (cambioEstado) {
      db.prepare(
        'INSERT INTO historial_estados (oportunidad_id, estado_anterior, estado_nuevo, cambiado_en, usuario_id) VALUES (?, ?, ?, ?, ?)'
      ).run(id, actual.estado, datos.estado, fecha, usuarioId);
    }
    return { cambios: true, cambioEstado };
  });
}

const SELECT_OPORTUNIDAD = `
  SELECT o.*, v.nombre AS vendedor_nombre, v.usuario_id AS vendedor_usuario_id
  FROM oportunidades o JOIN vendedores v ON v.id = o.vendedor_id`;

function oportunidadPorId(db, id) {
  return db.prepare(`${SELECT_OPORTUNIDAD} WHERE o.id = ?`).get(id) || null;
}

function historialDe(db, oportunidadId) {
  return db
    .prepare(
      `SELECT h.*, u.nombre AS usuario_nombre
       FROM historial_estados h JOIN usuarios u ON u.id = h.usuario_id
       WHERE h.oportunidad_id = ? ORDER BY h.id`
    )
    .all(oportunidadId);
}

const LIMITE_LISTADO = 500;

/** Filtros: semana (lunes), vendedorId, estado, texto. */
function listarOportunidades(db, filtros = {}) {
  const where = [];
  const params = [];
  if (filtros.semana) {
    where.push('o.semana = ?');
    params.push(filtros.semana);
  }
  if (filtros.vendedorId) {
    where.push('o.vendedor_id = ?');
    params.push(filtros.vendedorId);
  }
  if (filtros.estado) {
    where.push('o.estado = ?');
    params.push(filtros.estado);
  }
  if (filtros.texto) {
    where.push("(o.cliente LIKE ? ESCAPE '\\' OR o.necesidad LIKE ? ESCAPE '\\')");
    const patron = `%${filtros.texto.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    params.push(patron, patron);
  }
  const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM oportunidades o ${sqlWhere}`).get(...params).n;
  const filas = db
    .prepare(`${SELECT_OPORTUNIDAD} ${sqlWhere} ORDER BY o.creado_en DESC, o.id DESC LIMIT ${LIMITE_LISTADO}`)
    .all(...params);
  return { filas, total, limite: LIMITE_LISTADO };
}

/** Semana más antigua con datos (o null). */
function primeraSemana(db, vendedorId = null) {
  const fila = vendedorId
    ? db.prepare('SELECT MIN(semana) AS s FROM oportunidades WHERE vendedor_id = ?').get(vendedorId)
    : db.prepare('SELECT MIN(semana) AS s FROM oportunidades').get();
  return fila.s || null;
}

// ------------------------------------------------------------------- metas

/** Meta vigente para una semana: la última registrada con vigencia desde esa semana o antes. */
function metaDeSemana(db, semana) {
  const fila = db
    .prepare('SELECT valor FROM metas WHERE vigente_desde <= ? ORDER BY vigente_desde DESC, id DESC LIMIT 1')
    .get(semana);
  if (fila) return fila.valor;
  return db.prepare('SELECT valor FROM metas ORDER BY vigente_desde ASC, id ASC LIMIT 1').get().valor;
}

/** Cambia la meta a partir de la semana actual. Las semanas anteriores conservan su meta. */
function cambiarMeta(db, valorEntrada, { usuarioId, tz, ahora = new Date() }) {
  const texto = limpiar(String(valorEntrada ?? ''));
  const valor = Number(texto);
  if (!/^\d+$/.test(texto) || !Number.isInteger(valor) || valor < 1 || valor > 1000) {
    throw new ErrorValidacion({ meta: 'La meta debe ser un número entero entre 1 y 1000.' });
  }
  db.prepare('INSERT INTO metas (valor, vigente_desde, creado_en, usuario_id) VALUES (?, ?, ?, ?)').run(
    valor,
    semanaDe(ahora, tz),
    ahora.toISOString(),
    usuarioId
  );
  return valor;
}

function historialMetas(db) {
  return db
    .prepare(
      `SELECT m.*, u.nombre AS usuario_nombre FROM metas m LEFT JOIN usuarios u ON u.id = m.usuario_id
       ORDER BY m.id DESC`
    )
    .all();
}

module.exports = {
  ErrorValidacion,
  LIMITES,
  PASSWORD_MIN,
  usuarioPorId,
  usuarioPorEmail,
  crearAdmin,
  hayAdmin,
  crearVendedor,
  editarVendedor,
  cambiarActivoVendedor,
  vendedorPorId,
  vendedorPorUsuario,
  listarVendedores,
  crearOportunidad,
  actualizarOportunidad,
  oportunidadPorId,
  historialDe,
  listarOportunidades,
  primeraSemana,
  metaDeSemana,
  cambiarMeta,
  historialMetas,
};
