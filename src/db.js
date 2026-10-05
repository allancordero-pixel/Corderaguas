'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ESTADOS = ['Nueva', 'En cotización', 'Cotizada', 'Ganada', 'Perdida'];
const ESTADO_INICIAL = 'Nueva';
const META_INICIAL = 5;
// Semana desde la cual rige la meta inicial: cubre todo el histórico.
const SEMANA_ORIGEN = '0001-01-01';

const listaEstadosSql = ESTADOS.map((e) => `'${e}'`).join(', ');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY,
  nombre        TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  rol           TEXT    NOT NULL CHECK (rol IN ('admin', 'vendedor')),
  activo        INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  creado_en     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS vendedores (
  id           INTEGER PRIMARY KEY,
  usuario_id   INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE RESTRICT,
  nombre       TEXT    NOT NULL,
  activo       INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  creado_en    TEXT    NOT NULL,
  -- Lunes de la semana en que se dio de alta: no participa en semanas anteriores.
  semana_alta  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS oportunidades (
  id             INTEGER PRIMARY KEY,
  cliente        TEXT    NOT NULL CHECK (length(trim(cliente)) > 0),
  necesidad      TEXT    NOT NULL CHECK (length(trim(necesidad)) > 0),
  vendedor_id    INTEGER NOT NULL REFERENCES vendedores(id) ON DELETE RESTRICT,
  creado_en      TEXT    NOT NULL,
  -- Lunes de la semana de creación (zona horaria del negocio). Nunca cambia.
  semana         TEXT    NOT NULL,
  estado         TEXT    NOT NULL DEFAULT '${ESTADO_INICIAL}' CHECK (estado IN (${listaEstadosSql})),
  actualizado_en TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oport_semana_vendedor ON oportunidades (semana, vendedor_id);
CREATE INDEX IF NOT EXISTS idx_oport_vendedor ON oportunidades (vendedor_id);
CREATE INDEX IF NOT EXISTS idx_oport_estado ON oportunidades (estado);

-- Reglas 2 y 3: la fecha de creación, su semana y el vendedor responsable son inmutables.
CREATE TRIGGER IF NOT EXISTS oportunidades_inmutables
BEFORE UPDATE OF creado_en, semana, vendedor_id ON oportunidades
WHEN NEW.creado_en IS NOT OLD.creado_en
  OR NEW.semana IS NOT OLD.semana
  OR NEW.vendedor_id IS NOT OLD.vendedor_id
BEGIN
  SELECT RAISE(ABORT, 'La fecha de creación, la semana y el vendedor de una oportunidad no se pueden modificar');
END;

CREATE TRIGGER IF NOT EXISTS oportunidades_sin_borrado
BEFORE DELETE ON oportunidades
BEGIN
  SELECT RAISE(ABORT, 'Las oportunidades no se eliminan: forman parte del histórico');
END;

CREATE TABLE IF NOT EXISTS historial_estados (
  id              INTEGER PRIMARY KEY,
  oportunidad_id  INTEGER NOT NULL REFERENCES oportunidades(id) ON DELETE RESTRICT,
  estado_anterior TEXT    CHECK (estado_anterior IS NULL OR estado_anterior IN (${listaEstadosSql})),
  estado_nuevo    TEXT    NOT NULL CHECK (estado_nuevo IN (${listaEstadosSql})),
  cambiado_en     TEXT    NOT NULL,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_historial_oport ON historial_estados (oportunidad_id, id);

CREATE TRIGGER IF NOT EXISTS historial_inmutable_upd
BEFORE UPDATE ON historial_estados
BEGIN
  SELECT RAISE(ABORT, 'El historial de estados no se puede modificar');
END;
CREATE TRIGGER IF NOT EXISTS historial_inmutable_del
BEFORE DELETE ON historial_estados
BEGIN
  SELECT RAISE(ABORT, 'El historial de estados no se puede eliminar');
END;

-- Metas semanales. La meta de una semana es la última registrada con vigente_desde <= semana.
CREATE TABLE IF NOT EXISTS metas (
  id             INTEGER PRIMARY KEY,
  valor          INTEGER NOT NULL CHECK (valor > 0),
  vigente_desde  TEXT    NOT NULL,
  creado_en      TEXT    NOT NULL,
  usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sesiones (
  token_hash  TEXT    PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_en   TEXT    NOT NULL
);
`;

function abrirDb(ruta) {
  if (ruta !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(ruta)), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA foreign_keys = ON;');
  if (ruta !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(ESQUEMA);
  const hayMeta = db.prepare('SELECT COUNT(*) AS n FROM metas').get().n > 0;
  if (!hayMeta) {
    db.prepare('INSERT INTO metas (valor, vigente_desde, creado_en, usuario_id) VALUES (?, ?, ?, NULL)').run(
      META_INICIAL,
      SEMANA_ORIGEN,
      new Date().toISOString()
    );
  }
  return db;
}

/** Ejecuta fn dentro de una transacción. */
function transaccion(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { abrirDb, transaccion, ESTADOS, ESTADO_INICIAL, META_INICIAL, SEMANA_ORIGEN };
