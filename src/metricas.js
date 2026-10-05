'use strict';

// Cálculos de la sección 5 de la ficha: cumplimiento individual, meta y cumplimiento del equipo,
// ranking y pipeline.

const { ESTADOS } = require('./db');
const { metaDeSemana } = require('./datos');
const { sumarDias } = require('./semana');

/** Cumplimiento (%) = creadas / meta × 100. Puede superar 100. */
function porcentaje(creadas, meta) {
  if (!meta) return 0;
  return Math.round((creadas / meta) * 100);
}

/**
 * Ranking de una semana. Participan los vendedores dados de alta en o antes de esa semana
 * que estén activos, más los inactivos que hayan creado oportunidades en ella.
 * Orden: más oportunidades primero; empate por nombre.
 */
function rankingSemana(db, semana) {
  const meta = metaDeSemana(db, semana);
  const filas = db
    .prepare(
      `SELECT v.id, v.nombre, v.activo, COUNT(o.id) AS creadas
       FROM vendedores v
       LEFT JOIN oportunidades o ON o.vendedor_id = v.id AND o.semana = ?
       WHERE v.semana_alta <= ?
       GROUP BY v.id
       HAVING v.activo = 1 OR COUNT(o.id) > 0
       ORDER BY creadas DESC, v.nombre COLLATE NOCASE ASC`
    )
    .all(semana, semana);
  return filas.map((f, i) => ({
    posicion: i + 1,
    id: f.id,
    nombre: f.nombre,
    activo: f.activo === 1,
    creadas: f.creadas,
    meta,
    porcentaje: porcentaje(f.creadas, meta),
    cumple: f.creadas >= meta,
    faltan: Math.max(0, meta - f.creadas),
  }));
}

/** Indicadores del equipo para el dashboard general. */
function resumenEquipo(db, semana) {
  const ranking = rankingSemana(db, semana);
  const meta = metaDeSemana(db, semana);
  const vendedores = ranking.length;
  const metaEquipo = meta * vendedores;
  const creadas = ranking.reduce((s, r) => s + r.creadas, 0);
  const max = ranking.length ? ranking[0].creadas : 0;
  const lideres = max > 0 ? ranking.filter((r) => r.creadas === max) : [];
  return {
    semana,
    meta,
    vendedores,
    metaEquipo,
    creadas,
    porcentaje: porcentaje(creadas, metaEquipo),
    lideres,
    cumplen: ranking.filter((r) => r.cumple).length,
    ranking,
  };
}

/** Progreso de un vendedor en una semana. */
function progresoVendedor(db, vendedorId, semana) {
  const meta = metaDeSemana(db, semana);
  const creadas = db
    .prepare('SELECT COUNT(*) AS n FROM oportunidades WHERE vendedor_id = ? AND semana = ?')
    .get(vendedorId, semana).n;
  return { semana, meta, creadas, porcentaje: porcentaje(creadas, meta), cumple: creadas >= meta, faltan: Math.max(0, meta - creadas) };
}

/** Progreso semanal de un vendedor en las últimas `n` semanas hasta `hasta` (incluida). */
function historicoVendedor(db, vendedor, hasta, n = 12) {
  const lista = [];
  let s = hasta;
  for (let i = 0; i < n && s >= vendedor.semana_alta; i++) {
    lista.push(progresoVendedor(db, vendedor.id, s));
    s = sumarDias(s, -7);
  }
  return lista;
}

/** Cantidad de oportunidades por estado. Filtros opcionales: semana y vendedorId. */
function pipeline(db, { semana = null, vendedorId = null } = {}) {
  const where = [];
  const params = [];
  if (semana) {
    where.push('semana = ?');
    params.push(semana);
  }
  if (vendedorId) {
    where.push('vendedor_id = ?');
    params.push(vendedorId);
  }
  const filas = db
    .prepare(
      `SELECT estado, COUNT(*) AS n FROM oportunidades ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY estado`
    )
    .all(...params);
  const conteo = Object.fromEntries(ESTADOS.map((e) => [e, 0]));
  for (const f of filas) conteo[f.estado] = f.n;
  return ESTADOS.map((estado) => ({ estado, cantidad: conteo[estado] }));
}

module.exports = { porcentaje, rankingSemana, resumenEquipo, progresoVendedor, historicoVendedor, pipeline };
