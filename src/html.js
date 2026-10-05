'use strict';

// Plantillas HTML mínimas: toda interpolación se escapa salvo que se marque con raw().

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

const raw = (s) => new Raw(String(s));

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(esc).join('');
  return String(v).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function html(strings, ...valores) {
  let out = strings[0];
  for (let i = 0; i < valores.length; i++) out += esc(valores[i]) + strings[i + 1];
  return new Raw(out);
}

module.exports = { html, raw, esc, Raw };
