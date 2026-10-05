'use strict';

// Utilidades de semana comercial: lunes a domingo, en la zona horaria del negocio.
// Una semana se identifica por la fecha (YYYY-MM-DD) de su lunes.

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const formateadores = new Map();
function formateadorFecha(tz) {
  if (!formateadores.has(tz)) {
    formateadores.set(
      tz,
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    );
  }
  return formateadores.get(tz);
}

/** Fecha calendario (YYYY-MM-DD) de un instante en la zona horaria indicada. */
function fechaLocal(instante, tz) {
  return formateadorFecha(tz).format(instante);
}

function aUTC(fecha) {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

function deUTC(date) {
  return date.toISOString().slice(0, 10);
}

function esFechaValida(fecha) {
  if (typeof fecha !== 'string' || !RE_FECHA.test(fecha)) return false;
  const d = aUTC(fecha);
  return !Number.isNaN(d.getTime()) && deUTC(d) === fecha;
}

function sumarDias(fecha, dias) {
  const d = aUTC(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return deUTC(d);
}

/** Lunes de la semana que contiene la fecha dada. */
function lunesDe(fecha) {
  const dia = aUTC(fecha).getUTCDay(); // 0 = domingo
  return sumarDias(fecha, -((dia + 6) % 7));
}

/** Semana (lunes) a la que pertenece un instante en la zona horaria del negocio. */
function semanaDe(instante, tz) {
  return lunesDe(fechaLocal(instante, tz));
}

function esLunes(fecha) {
  return esFechaValida(fecha) && aUTC(fecha).getUTCDay() === 1;
}

const fmtCorto = new Intl.DateTimeFormat('es', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const fmtLargo = new Intl.DateTimeFormat('es', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

/** "6 oct – 12 oct 2026" */
function etiquetaSemana(lunes) {
  return `${fmtCorto.format(aUTC(lunes))} – ${fmtLargo.format(aUTC(sumarDias(lunes, 6)))}`;
}

/** Lista de lunes desde `desde` hasta `hasta` (inclusive), del más reciente al más antiguo. */
function semanasEntre(desde, hasta, maximo = 260) {
  const lista = [];
  let s = lunesDe(hasta);
  const inicio = lunesDe(desde);
  while (s >= inicio && lista.length < maximo) {
    lista.push(s);
    s = sumarDias(s, -7);
  }
  return lista;
}

module.exports = {
  fechaLocal,
  esFechaValida,
  sumarDias,
  lunesDe,
  semanaDe,
  esLunes,
  etiquetaSemana,
  semanasEntre,
};
