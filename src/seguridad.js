'use strict';

const crypto = require('node:crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const DURACION_SESION_MS = 7 * 24 * 60 * 60 * 1000;

function hashPassword(password) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, sal, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, sal.toString('base64'), hash.toString('base64')].join('$');
}

function verificarPassword(password, almacenado) {
  const partes = String(almacenado || '').split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, N, r, p, salB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64, 'base64');
  const calculado = crypto.scryptSync(String(password), Buffer.from(salB64, 'base64'), esperado.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(esperado, calculado);
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function crearSesion(db, usuarioId, ahora) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expira = new Date(ahora.getTime() + DURACION_SESION_MS);
  db.prepare('DELETE FROM sesiones WHERE expira_en < ?').run(ahora.toISOString());
  db.prepare('INSERT INTO sesiones (token_hash, usuario_id, expira_en) VALUES (?, ?, ?)').run(
    hashToken(token),
    usuarioId,
    expira.toISOString()
  );
  return { token, expira };
}

function leerSesion(db, token, ahora) {
  if (!token) return null;
  return (
    db
      .prepare('SELECT usuario_id FROM sesiones WHERE token_hash = ? AND expira_en > ?')
      .get(hashToken(token), ahora.toISOString()) || null
  );
}

function cerrarSesion(db, token) {
  if (token) db.prepare('DELETE FROM sesiones WHERE token_hash = ?').run(hashToken(token));
}

function cerrarSesionesDeUsuario(db, usuarioId) {
  db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(usuarioId);
}

function leerCookies(header) {
  const cookies = {};
  for (const parte of String(header || '').split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const k = parte.slice(0, i).trim();
    if (!k) continue;
    try {
      cookies[k] = decodeURIComponent(parte.slice(i + 1).trim());
    } catch {
      cookies[k] = parte.slice(i + 1).trim();
    }
  }
  return cookies;
}

module.exports = {
  hashPassword,
  verificarPassword,
  crearSesion,
  leerSesion,
  cerrarSesion,
  cerrarSesionesDeUsuario,
  leerCookies,
};
