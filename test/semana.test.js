'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lunesDe, semanaDe, sumarDias, esLunes, semanasEntre } = require('../src/semana');
const { porcentaje } = require('../src/metricas');

test('la semana va de lunes a domingo', () => {
  assert.equal(lunesDe('2026-10-05'), '2026-10-05'); // lunes
  assert.equal(lunesDe('2026-10-07'), '2026-10-05'); // miércoles
  assert.equal(lunesDe('2026-10-11'), '2026-10-05'); // domingo
  assert.equal(lunesDe('2026-10-12'), '2026-10-12'); // lunes siguiente
  assert.equal(lunesDe('2027-01-01'), '2026-12-28'); // cruza de año
});

test('la semana se calcula en la zona horaria del negocio', () => {
  // Domingo 11 oct 23:30 en Costa Rica = lunes 12 oct 05:30 UTC.
  const instante = new Date('2026-10-12T05:30:00Z');
  assert.equal(semanaDe(instante, 'America/Costa_Rica'), '2026-10-05');
  assert.equal(semanaDe(instante, 'UTC'), '2026-10-12');
});

test('utilidades de fecha', () => {
  assert.equal(sumarDias('2026-10-05', -7), '2026-09-28');
  assert.ok(esLunes('2026-10-05'));
  assert.ok(!esLunes('2026-10-06'));
  assert.ok(!esLunes('2026-02-30'));
  assert.ok(!esLunes('basura'));
  assert.deepEqual(semanasEntre('2026-09-24', '2026-10-07'), ['2026-10-05', '2026-09-28', '2026-09-21']);
});

test('cumplimiento = creadas / meta × 100 y puede superar 100', () => {
  assert.equal(porcentaje(3, 5), 60);
  assert.equal(porcentaje(5, 5), 100);
  assert.equal(porcentaje(7, 5), 140);
  assert.equal(porcentaje(0, 5), 0);
  assert.equal(porcentaje(3, 0), 0);
});
