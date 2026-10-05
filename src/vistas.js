'use strict';

const { html, raw } = require('./html');
const { ESTADOS } = require('./db');
const { etiquetaSemana, sumarDias } = require('./semana');
const { LIMITES, PASSWORD_MIN } = require('./datos');

// ----------------------------------------------------------------- helpers

const AVISOS = {
  creada: 'Oportunidad creada. Ya cuenta en tus indicadores de la semana.',
  actualizada: 'Oportunidad actualizada.',
  'estado-actualizado': 'Estado actualizado y registrado en el historial.',
  'sin-cambios': 'No había cambios para guardar.',
  'vendedor-creado': 'Vendedor creado.',
  'vendedor-actualizado': 'Vendedor actualizado.',
  'vendedor-activado': 'Vendedor activado.',
  'vendedor-desactivado': 'Vendedor desactivado. Su histórico se conserva.',
  'meta-actualizada': 'Meta semanal actualizada.',
};

const fmtCache = new Map();
function fechaHora(iso, tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(
      tz,
      new Intl.DateTimeFormat('es', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    );
  }
  return fmtCache.get(tz).format(new Date(iso));
}

const claseEstado = (estado) =>
  ({ Nueva: 'nueva', 'En cotización': 'en-cotizacion', Cotizada: 'cotizada', Ganada: 'ganada', Perdida: 'perdida' })[
    estado
  ] || '';

const badgeEstado = (estado) => html`<span class="badge estado-${claseEstado(estado)}">${estado}</span>`;

const badgeCumple = (cumple) =>
  cumple ? html`<span class="badge ok">Cumple</span>` : html`<span class="badge bajo">Bajo meta</span>`;

function barra(pct) {
  const ancho = Math.min(100, Math.max(0, pct));
  return html`<div class="barra" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
    <div class="barra-relleno ${pct >= 100 ? 'ok' : 'bajo'}" style="width:${ancho}%"></div>
  </div>`;
}

function errorCampo(errores, campo) {
  return errores && errores[campo] ? html`<p class="error-campo" id="err-${campo}">${errores[campo]}</p>` : '';
}

function resumenErrores(errores) {
  if (!errores || !Object.keys(errores).length) return '';
  return html`<div class="alerta error" role="alert">
    <strong>No se pudo guardar. Revise la información:</strong>
    <ul>${Object.values(errores).map((e) => html`<li>${e}</li>`)}</ul>
  </div>`;
}

function aviso(codigo) {
  return codigo && AVISOS[codigo] ? html`<div class="alerta ok" role="status">${AVISOS[codigo]}</div>` : '';
}

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ------------------------------------------------------------------ layout

function layout({ titulo, usuario, seccion, cuerpo }) {
  const enlaces = !usuario
    ? []
    : usuario.rol === 'admin'
      ? [
          ['dashboard', '/admin', 'Dashboard general'],
          ['oportunidades', '/oportunidades', 'Oportunidades'],
          ['vendedores', '/vendedores', 'Vendedores'],
          ['configuracion', '/configuracion', 'Configuración'],
        ]
      : [
          ['dashboard', '/mi-dashboard', 'Mi dashboard'],
          ['oportunidades', '/oportunidades', 'Mis oportunidades'],
          ['nueva', '/oportunidades/nueva', '+ Nueva oportunidad'],
        ];
  return html`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${titulo} · Pulso Comercial</title>
  <link rel="stylesheet" href="/estilos.css">
</head>
<body>
  <header class="barra-superior">
    <a class="marca" href="/">Pulso Comercial</a>
    ${
      usuario
        ? html`<nav class="nav">
            ${enlaces.map(([id, href, texto]) => html`<a href="${href}" class="${id === seccion ? 'activo' : ''} ${id === 'nueva' ? 'nav-cta' : ''}">${texto}</a>`)}
          </nav>
          <div class="usuario">
            <span>${usuario.nombre} · ${usuario.rol === 'admin' ? 'Administrador' : 'Vendedor'}</span>
            <form method="post" action="/logout"><button class="enlace" type="submit">Salir</button></form>
          </div>`
        : ''
    }
  </header>
  <main class="contenido">
    ${cuerpo}
  </main>
</body>
</html>`;
}

// --------------------------------------------------------- componentes

/** Navegación por semana: anterior / selector / siguiente. `extras` se conserva en la URL. */
function selectorSemana({ accion, semana, semanas, semanaActual, extras = {} }) {
  const anterior = sumarDias(semana, -7);
  const siguiente = sumarDias(semana, 7);
  const opciones = semanas.includes(semana) ? semanas : [semana, ...semanas];
  return html`<form class="selector-semana" method="get" action="${accion}">
    ${Object.entries(extras).map(([k, v]) => (v ? html`<input type="hidden" name="${k}" value="${v}">` : ''))}
    <a class="boton secundario" href="${accion}${qs({ ...extras, semana: anterior })}" aria-label="Semana anterior">←</a>
    <label class="oculto" for="semana">Semana</label>
    <select id="semana" name="semana" onchange="this.form.submit()">
      ${opciones.map(
        (s) => html`<option value="${s}" ${s === semana ? 'selected' : ''}>${etiquetaSemana(s)}${s === semanaActual ? ' (actual)' : ''}</option>`
      )}
    </select>
    <noscript><button class="boton secundario" type="submit">Ver</button></noscript>
    ${
      siguiente <= semanaActual
        ? html`<a class="boton secundario" href="${accion}${qs({ ...extras, semana: siguiente })}" aria-label="Semana siguiente">→</a>`
        : html`<span class="boton secundario deshabilitado" aria-hidden="true">→</span>`
    }
    ${semana !== semanaActual ? html`<a class="enlace-suave" href="${accion}${qs(extras)}">Ir a la semana actual</a>` : ''}
  </form>`;
}

/** Gráfica de barras horizontales: oportunidades por vendedor con la línea de meta marcada. */
function graficaRanking(ranking, meta) {
  if (!ranking.length) return html`<p class="vacio">No hay vendedores para mostrar.</p>`;
  const ancho = 560;
  const izq = 140;
  const der = 40;
  const alto = 36;
  const arriba = 28;
  const maximo = Math.max(meta * 1.25, ...ranking.map((r) => r.creadas), 1);
  const escala = (v) => (v / maximo) * (ancho - izq - der);
  const altoTotal = arriba + ranking.length * alto + 10;
  const xMeta = izq + escala(meta);
  const recortar = (s) => (s.length > 17 ? s.slice(0, 16) + '…' : s);
  return html`<svg class="grafica" viewBox="0 0 ${ancho} ${altoTotal}" role="img"
      aria-label="Oportunidades creadas por vendedor frente a la meta de ${meta}">
    ${ranking.map((r, i) => {
      const y = arriba + i * alto;
      const w = escala(r.creadas);
      return html`<g>
        <text x="${izq - 8}" y="${y + alto / 2 + 4}" text-anchor="end" class="g-etiqueta">${recortar(r.nombre)}</text>
        <rect x="${izq}" y="${y + 5}" width="${Math.max(w, 2)}" height="${alto - 10}" rx="3" class="${r.cumple ? 'g-ok' : 'g-bajo'}"></rect>
        <text x="${izq + Math.max(w, 2) + 6}" y="${y + alto / 2 + 4}" class="g-valor">${r.creadas}</text>
      </g>`;
    })}
    <line x1="${xMeta}" x2="${xMeta}" y1="${arriba - 6}" y2="${altoTotal - 6}" class="g-meta"></line>
    <text x="${xMeta}" y="${arriba - 10}" text-anchor="middle" class="g-meta-texto">Meta ${meta}</text>
  </svg>
  <p class="leyenda"><span class="punto g-ok"></span> Cumple la meta <span class="punto g-bajo"></span> Bajo la meta <span class="linea-meta"></span> Meta semanal</p>`;
}

function tablaPipeline(semana, total) {
  return html`<div class="pipeline">
    ${semana.map(
      (p, i) => html`<div class="pipeline-paso estado-${claseEstado(p.estado)}">
        <span class="pipeline-estado">${p.estado}</span>
        <span class="pipeline-num">${p.cantidad}</span>
        <span class="pipeline-total">${total[i].cantidad} en total</span>
      </div>`
    )}
  </div>`;
}

function tablaOportunidades(filas, { tz, mostrarVendedor }) {
  if (!filas.length) return html`<p class="vacio">No hay oportunidades para mostrar.</p>`;
  return html`<div class="tabla-scroll"><table class="tabla">
    <thead><tr>
      <th>Fecha</th><th>Cliente</th><th>Necesidad</th>${mostrarVendedor ? html`<th>Vendedor</th>` : ''}<th>Estado</th><th></th>
    </tr></thead>
    <tbody>
      ${filas.map(
        (o) => html`<tr>
          <td class="nowrap">${fechaHora(o.creado_en, tz)}</td>
          <td>${o.cliente}</td>
          <td class="necesidad">${o.necesidad}</td>
          ${mostrarVendedor ? html`<td>${o.vendedor_nombre}</td>` : ''}
          <td>${badgeEstado(o.estado)}</td>
          <td><a href="/oportunidades/${o.id}">Ver</a></td>
        </tr>`
      )}
    </tbody>
  </table></div>`;
}

function tablaHistorico(historico, semanaActual, enlace) {
  return html`<div class="tabla-scroll"><table class="tabla">
    <thead><tr><th>Semana</th><th class="num">Creadas</th><th class="num">Meta</th><th class="num">Cumplimiento</th><th></th></tr></thead>
    <tbody>
      ${historico.map(
        (h) => html`<tr>
          <td><a href="${enlace(h.semana)}">${etiquetaSemana(h.semana)}</a>${h.semana === semanaActual ? ' (actual)' : ''}</td>
          <td class="num">${h.creadas}</td>
          <td class="num">${h.meta}</td>
          <td class="num">${h.porcentaje}%</td>
          <td>${badgeCumple(h.cumple)}</td>
        </tr>`
      )}
    </tbody>
  </table></div>`;
}

// ----------------------------------------------------------------- vistas

function vistaLogin({ error, email }) {
  return layout({
    titulo: 'Iniciar sesión',
    cuerpo: html`<section class="tarjeta login">
      <h1>Iniciar sesión</h1>
      <p class="sutil">¿Quién ha colocado más oportunidades y cómo avanza cada vendedor frente a la meta semanal?</p>
      ${error ? html`<div class="alerta error" role="alert">${error}</div>` : ''}
      <form method="post" action="/login" class="formulario">
        <label for="email">Correo</label>
        <input id="email" name="email" type="email" autocomplete="username" required value="${email || ''}" autofocus>
        <label for="password">Contraseña</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
        <button class="boton" type="submit">Ingresar</button>
      </form>
    </section>`,
  });
}

function vistaDashboardAdmin({ usuario, resumen, semanas, semanaActual, pipelineSemana, pipelineTotal }) {
  const { semana } = resumen;
  const lideres = resumen.lideres;
  return layout({
    titulo: 'Dashboard general',
    usuario,
    seccion: 'dashboard',
    cuerpo: html`
      <div class="encabezado">
        <div>
          <h1>Dashboard general</h1>
          <p class="sutil">Semana del ${etiquetaSemana(semana)} · lunes a domingo</p>
        </div>
        ${selectorSemana({ accion: '/admin', semana, semanas, semanaActual })}
      </div>

      <section class="kpis">
        <div class="kpi"><span class="kpi-titulo">Oportunidades esta semana</span><span class="kpi-valor">${resumen.creadas}</span></div>
        <div class="kpi"><span class="kpi-titulo">Meta semanal del equipo</span><span class="kpi-valor">${resumen.metaEquipo}</span>
          <span class="kpi-nota">${resumen.meta} × ${resumen.vendedores} vendedor${resumen.vendedores === 1 ? '' : 'es'}</span></div>
        <div class="kpi"><span class="kpi-titulo">% de cumplimiento</span><span class="kpi-valor ${resumen.porcentaje >= 100 ? 'txt-ok' : 'txt-bajo'}">${resumen.porcentaje}%</span>
          ${barra(resumen.porcentaje)}</div>
        <div class="kpi"><span class="kpi-titulo">Vendedor líder</span>
          <span class="kpi-valor kpi-texto">${lideres.length ? lideres.map((l) => l.nombre).join(', ') : '—'}</span>
          <span class="kpi-nota">${lideres.length ? `${lideres[0].creadas} oportunidades${lideres.length > 1 ? ' (empate)' : ''}` : 'Sin oportunidades esta semana'}</span></div>
      </section>
      <p class="sutil">${resumen.cumplen} de ${resumen.vendedores} vendedores cumplen la meta de ${resumen.meta} oportunidades.</p>

      <div class="columnas anchas">
        <section class="tarjeta">
          <h2>Ranking semanal</h2>
          ${
            resumen.ranking.length
              ? html`<div class="tabla-scroll"><table class="tabla">
              <thead><tr><th>#</th><th>Vendedor</th><th class="num">Creadas</th><th class="num">Meta</th><th class="num">Cumpl.</th><th>Estado</th></tr></thead>
              <tbody>
                ${resumen.ranking.map(
                  (r) => html`<tr class="${r.posicion === 1 && r.creadas > 0 ? 'lider' : ''}">
                    <td>${r.posicion}</td>
                    <td><a href="/vendedores/${r.id}${qs({ semana })}">${r.nombre}</a>${r.activo ? '' : html` <span class="badge inactivo">Inactivo</span>`}</td>
                    <td class="num"><a href="/oportunidades${qs({ semana, vendedor: r.id })}">${r.creadas}</a></td>
                    <td class="num">${r.meta}</td>
                    <td class="num">${r.porcentaje}%</td>
                    <td class="nowrap">${badgeCumple(r.cumple)}${r.cumple ? '' : html`<br><span class="sutil">faltan ${r.faltan}</span>`}</td>
                  </tr>`
                )}
              </tbody>
            </table></div>`
              : html`<p class="vacio">Aún no hay vendedores. <a href="/vendedores/nuevo">Crear vendedor</a></p>`
          }
        </section>
        <section class="tarjeta">
          <h2>Oportunidades por vendedor</h2>
          ${graficaRanking(resumen.ranking, resumen.meta)}
        </section>
      </div>

      <section class="tarjeta">
        <h2>Pipeline</h2>
        <p class="sutil">Estado actual de las oportunidades creadas en la semana seleccionada (y total histórico).</p>
        ${tablaPipeline(pipelineSemana, pipelineTotal)}
        <p><a href="/oportunidades${qs({ semana })}">Ver oportunidades de esta semana →</a></p>
      </section>`,
  });
}

function vistaMiDashboard({ usuario, progreso, oportunidades, semanas, semanaActual, pipelineSemana, pipelineTotal, historico, tz, avisoCodigo }) {
  const { semana } = progreso;
  return layout({
    titulo: 'Mi dashboard',
    usuario,
    seccion: 'dashboard',
    cuerpo: html`
      ${aviso(avisoCodigo)}
      <div class="encabezado">
        <div>
          <h1>Mi dashboard</h1>
          <p class="sutil">Semana del ${etiquetaSemana(semana)} · lunes a domingo</p>
        </div>
        <a class="boton grande" href="/oportunidades/nueva">+ Nueva oportunidad</a>
      </div>

      <section class="tarjeta progreso">
        <h2>Mi progreso semanal</h2>
        <p class="progreso-cifra"><strong>${progreso.creadas} / ${progreso.meta}</strong> oportunidades</p>
        <p class="progreso-pct ${progreso.cumple ? 'txt-ok' : 'txt-bajo'}">${progreso.porcentaje}% de meta</p>
        ${barra(progreso.porcentaje)}
        <p class="sutil">${
          progreso.cumple
            ? progreso.creadas > progreso.meta
              ? `Meta superada por ${progreso.creadas - progreso.meta}.`
              : 'Meta cumplida.'
            : `Te falta${progreso.faltan === 1 ? '' : 'n'} ${progreso.faltan} para la meta.`
        }</p>
        ${selectorSemana({ accion: '/mi-dashboard', semana, semanas, semanaActual })}
      </section>

      <section class="tarjeta">
        <h2>Mis oportunidades de la semana</h2>
        ${tablaOportunidades(oportunidades, { tz, mostrarVendedor: false })}
      </section>

      <div class="columnas">
        <section class="tarjeta">
          <h2>Mi pipeline</h2>
          ${tablaPipeline(pipelineSemana, pipelineTotal)}
        </section>
        <section class="tarjeta">
          <h2>Mi histórico</h2>
          ${tablaHistorico(historico, semanaActual, (s) => `/mi-dashboard${qs({ semana: s })}`)}
        </section>
      </div>`,
  });
}

function vistaNuevaOportunidad({ usuario, valores = {}, errores = null }) {
  return layout({
    titulo: 'Nueva oportunidad',
    usuario,
    seccion: 'nueva',
    cuerpo: html`<section class="tarjeta formulario-tarjeta">
      <h1>Nueva oportunidad</h1>
      <p class="sutil">El vendedor, la fecha de creación y el estado <strong>Nueva</strong> se asignan automáticamente.</p>
      ${resumenErrores(errores)}
      <form method="post" action="/oportunidades/nueva" class="formulario" novalidate>
        <label for="cliente">Cliente <span class="req">*</span></label>
        <input id="cliente" name="cliente" maxlength="${LIMITES.cliente}" value="${valores.cliente || ''}"
          class="${errores && errores.cliente ? 'invalido' : ''}" ${errores && errores.cliente ? raw('aria-invalid="true" aria-describedby="err-cliente"') : ''}>
        ${errorCampo(errores, 'cliente')}
        <label for="necesidad">Necesidad del cliente <span class="req">*</span></label>
        <textarea id="necesidad" name="necesidad" rows="5" maxlength="${LIMITES.necesidad}"
          class="${errores && errores.necesidad ? 'invalido' : ''}" ${errores && errores.necesidad ? raw('aria-invalid="true" aria-describedby="err-necesidad"') : ''}>${valores.necesidad || ''}</textarea>
        ${errorCampo(errores, 'necesidad')}
        <div class="acciones">
          <button class="boton" type="submit">Guardar oportunidad</button>
          <a class="boton secundario" href="/mi-dashboard">Cancelar</a>
        </div>
      </form>
    </section>`,
  });
}

function vistaOportunidades({ usuario, filtros, resultado, vendedores, semanas, semanaActual, tz }) {
  const esAdmin = usuario.rol === 'admin';
  const titulo = esAdmin ? 'Todas las oportunidades' : 'Mis oportunidades';
  return layout({
    titulo,
    usuario,
    seccion: 'oportunidades',
    cuerpo: html`
      <div class="encabezado">
        <h1>${titulo}</h1>
        ${esAdmin ? '' : html`<a class="boton" href="/oportunidades/nueva">+ Nueva oportunidad</a>`}
      </div>
      <form class="filtros tarjeta" method="get" action="/oportunidades">
        <div class="filtro">
          <label for="f-semana">Semana</label>
          <select id="f-semana" name="semana">
            <option value="">Todas</option>
            ${semanas.map(
              (s) => html`<option value="${s}" ${s === filtros.semana ? 'selected' : ''}>${etiquetaSemana(s)}${s === semanaActual ? ' (actual)' : ''}</option>`
            )}
          </select>
        </div>
        ${
          esAdmin
            ? html`<div class="filtro">
            <label for="f-vendedor">Vendedor</label>
            <select id="f-vendedor" name="vendedor">
              <option value="">Todos</option>
              ${vendedores.map(
                (v) => html`<option value="${v.id}" ${v.id === filtros.vendedorId ? 'selected' : ''}>${v.nombre}${v.activo ? '' : ' (inactivo)'}</option>`
              )}
            </select>
          </div>`
            : ''
        }
        <div class="filtro">
          <label for="f-estado">Estado</label>
          <select id="f-estado" name="estado">
            <option value="">Todos</option>
            ${ESTADOS.map((e) => html`<option value="${e}" ${e === filtros.estado ? 'selected' : ''}>${e}</option>`)}
          </select>
        </div>
        <div class="filtro">
          <label for="f-q">Cliente o necesidad</label>
          <input id="f-q" name="q" value="${filtros.texto || ''}" placeholder="Buscar…">
        </div>
        <div class="filtro acciones">
          <button class="boton" type="submit">Filtrar</button>
          <a class="enlace-suave" href="/oportunidades">Limpiar</a>
        </div>
      </form>
      <section class="tarjeta">
        <p class="sutil">${resultado.total} oportunidad${resultado.total === 1 ? '' : 'es'}${
          resultado.total > resultado.limite ? ` · se muestran las ${resultado.limite} más recientes, use los filtros para acotar` : ''
        }</p>
        ${tablaOportunidades(resultado.filas, { tz, mostrarVendedor: esAdmin })}
      </section>`,
  });
}

function vistaDetalle({ usuario, op, historial, puedeEditar, valores, errores, avisoCodigo, tz }) {
  const v = valores || op;
  return layout({
    titulo: `Oportunidad · ${op.cliente}`,
    usuario,
    seccion: 'oportunidades',
    cuerpo: html`
      ${aviso(avisoCodigo)}
      <p><a href="/oportunidades">← Volver a ${usuario.rol === 'admin' ? 'todas las oportunidades' : 'mis oportunidades'}</a></p>
      <div class="columnas">
        <section class="tarjeta">
          <h1>${op.cliente}</h1>
          <dl class="ficha">
            <dt>Cliente</dt><dd>${op.cliente}</dd>
            <dt>Necesidad</dt><dd class="necesidad">${op.necesidad}</dd>
            <dt>Vendedor</dt><dd>${op.vendedor_nombre}</dd>
            <dt>Fecha de creación</dt><dd>${fechaHora(op.creado_en, tz)} <span class="sutil">· cuenta en la semana del ${etiquetaSemana(op.semana)}</span></dd>
            <dt>Estado actual</dt><dd>${badgeEstado(op.estado)}</dd>
            <dt>Última actualización</dt><dd>${fechaHora(op.actualizado_en, tz)}</dd>
          </dl>
        </section>
        ${
          puedeEditar
            ? html`<section class="tarjeta">
            <h2>Editar oportunidad</h2>
            ${resumenErrores(errores)}
            <form method="post" action="/oportunidades/${op.id}" class="formulario" novalidate>
              <label for="cliente">Cliente <span class="req">*</span></label>
              <input id="cliente" name="cliente" maxlength="${LIMITES.cliente}" value="${v.cliente}" class="${errores && errores.cliente ? 'invalido' : ''}">
              ${errorCampo(errores, 'cliente')}
              <label for="necesidad">Necesidad del cliente <span class="req">*</span></label>
              <textarea id="necesidad" name="necesidad" rows="5" maxlength="${LIMITES.necesidad}" class="${errores && errores.necesidad ? 'invalido' : ''}">${v.necesidad}</textarea>
              ${errorCampo(errores, 'necesidad')}
              <label for="estado">Estado</label>
              <select id="estado" name="estado">
                ${ESTADOS.map((e) => html`<option value="${e}" ${e === v.estado ? 'selected' : ''}>${e}</option>`)}
              </select>
              ${errorCampo(errores, 'estado')}
              <p class="sutil">Flujo: Nueva → En cotización → Cotizada → Ganada / Perdida. No es obligatorio pasar por todos los estados.</p>
              <div class="acciones"><button class="boton" type="submit">Guardar cambios</button></div>
            </form>
          </section>`
            : ''
        }
      </div>
      <section class="tarjeta">
        <h2>Historial de estados</h2>
        <div class="tabla-scroll"><table class="tabla">
          <thead><tr><th>Fecha y hora</th><th>Estado anterior</th><th>Nuevo estado</th><th>Usuario</th></tr></thead>
          <tbody>
            ${historial.map(
              (h) => html`<tr>
                <td class="nowrap">${fechaHora(h.cambiado_en, tz)}</td>
                <td>${h.estado_anterior ? badgeEstado(h.estado_anterior) : html`<span class="sutil">— (creación)</span>`}</td>
                <td>${badgeEstado(h.estado_nuevo)}</td>
                <td>${h.usuario_nombre}</td>
              </tr>`
            )}
          </tbody>
        </table></div>
      </section>`,
  });
}

function vistaVendedores({ usuario, vendedores, semanaActual, avisoCodigo }) {
  return layout({
    titulo: 'Vendedores',
    usuario,
    seccion: 'vendedores',
    cuerpo: html`
      ${aviso(avisoCodigo)}
      <div class="encabezado">
        <h1>Vendedores</h1>
        <a class="boton" href="/vendedores/nuevo">+ Crear vendedor</a>
      </div>
      <section class="tarjeta">
        ${
          vendedores.length
            ? html`<div class="tabla-scroll"><table class="tabla">
          <thead><tr><th>Nombre</th><th>Correo</th><th>Estado</th><th class="num">Esta semana</th><th class="num">Total</th><th></th></tr></thead>
          <tbody>
            ${vendedores.map(
              (v) => html`<tr class="${v.activo ? '' : 'fila-inactiva'}">
                <td><a href="/vendedores/${v.id}">${v.nombre}</a></td>
                <td>${v.email}</td>
                <td>${v.activo ? html`<span class="badge ok">Activo</span>` : html`<span class="badge inactivo">Inactivo</span>`}</td>
                <td class="num">${v.semana_actual}</td>
                <td class="num">${v.total}</td>
                <td class="acciones-fila">
                  <a href="/vendedores/${v.id}">Ver / editar</a>
                  <form method="post" action="/vendedores/${v.id}/activo">
                    <input type="hidden" name="activo" value="${v.activo ? '0' : '1'}">
                    <button class="enlace" type="submit">${v.activo ? 'Desactivar' : 'Activar'}</button>
                  </form>
                </td>
              </tr>`
            )}
          </tbody>
        </table></div>`
            : html`<p class="vacio">Aún no hay vendedores.</p>`
        }
        <p class="sutil">Los vendedores no se eliminan: al desactivarlos dejan de poder ingresar y de contar en la meta del equipo, pero su histórico se conserva. Semana actual: ${etiquetaSemana(semanaActual)}.</p>
      </section>`,
  });
}

function formVendedor({ accion, valores, errores, nuevo }) {
  return html`${resumenErrores(errores)}
    <form method="post" action="${accion}" class="formulario" novalidate>
      <label for="nombre">Nombre <span class="req">*</span></label>
      <input id="nombre" name="nombre" maxlength="${LIMITES.nombre}" value="${valores.nombre || ''}" class="${errores && errores.nombre ? 'invalido' : ''}">
      ${errorCampo(errores, 'nombre')}
      <label for="email">Correo (usuario de acceso) <span class="req">*</span></label>
      <input id="email" name="email" type="email" maxlength="${LIMITES.email}" value="${valores.email || ''}" class="${errores && errores.email ? 'invalido' : ''}" autocomplete="off">
      ${errorCampo(errores, 'email')}
      <label for="password">${nuevo ? html`Contraseña <span class="req">*</span>` : 'Nueva contraseña (dejar vacío para no cambiarla)'}</label>
      <input id="password" name="password" type="password" minlength="${PASSWORD_MIN}" autocomplete="new-password" class="${errores && errores.password ? 'invalido' : ''}">
      ${errorCampo(errores, 'password')}
      <p class="sutil">Mínimo ${PASSWORD_MIN} caracteres.</p>
      <div class="acciones">
        <button class="boton" type="submit">${nuevo ? 'Crear vendedor' : 'Guardar cambios'}</button>
        <a class="boton secundario" href="/vendedores">Cancelar</a>
      </div>
    </form>`;
}

function vistaNuevoVendedor({ usuario, valores = {}, errores = null }) {
  return layout({
    titulo: 'Crear vendedor',
    usuario,
    seccion: 'vendedores',
    cuerpo: html`<section class="tarjeta formulario-tarjeta">
      <h1>Crear vendedor</h1>
      ${formVendedor({ accion: '/vendedores', valores, errores, nuevo: true })}
    </section>`,
  });
}

function vistaVendedor({ usuario, vendedor, valores, errores, historico, semanaActual, semana, pipelineSemana, pipelineTotal, avisoCodigo }) {
  return layout({
    titulo: vendedor.nombre,
    usuario,
    seccion: 'vendedores',
    cuerpo: html`
      ${aviso(avisoCodigo)}
      <p><a href="/vendedores">← Volver a vendedores</a></p>
      <div class="encabezado">
        <h1>${vendedor.nombre} ${vendedor.activo ? html`<span class="badge ok">Activo</span>` : html`<span class="badge inactivo">Inactivo</span>`}</h1>
        <form method="post" action="/vendedores/${vendedor.id}/activo">
          <input type="hidden" name="activo" value="${vendedor.activo ? '0' : '1'}">
          <button class="boton secundario" type="submit">${vendedor.activo ? 'Desactivar vendedor' : 'Activar vendedor'}</button>
        </form>
      </div>
      <div class="columnas">
        <section class="tarjeta">
          <h2>Desempeño semanal</h2>
          ${
            historico.length
              ? tablaHistorico(historico, semanaActual, (s) => `/oportunidades${qs({ semana: s, vendedor: vendedor.id })}`)
              : html`<p class="vacio">Sin semanas registradas.</p>`
          }
          <h3>Pipeline · semana del ${etiquetaSemana(semana)}</h3>
          ${tablaPipeline(pipelineSemana, pipelineTotal)}
          <p><a href="/oportunidades${qs({ vendedor: vendedor.id })}">Ver todas sus oportunidades →</a></p>
        </section>
        <section class="tarjeta">
          <h2>Editar vendedor</h2>
          ${formVendedor({ accion: `/vendedores/${vendedor.id}`, valores, errores, nuevo: false })}
        </section>
      </div>`,
  });
}

function vistaConfiguracion({ usuario, metaActual, historial, errores, valor, semanaActual, avisoCodigo, tz }) {
  return layout({
    titulo: 'Configuración',
    usuario,
    seccion: 'configuracion',
    cuerpo: html`
      ${aviso(avisoCodigo)}
      <h1>Configuración</h1>
      <div class="columnas">
        <section class="tarjeta">
          <h2>Meta semanal de oportunidades</h2>
          <p>Meta vigente: <strong>${metaActual}</strong> oportunidades por vendedor por semana.</p>
          ${resumenErrores(errores)}
          <form method="post" action="/configuracion" class="formulario" novalidate>
            <label for="meta">Nueva meta semanal por vendedor</label>
            <input id="meta" name="meta" type="number" min="1" max="1000" step="1" value="${valor ?? metaActual}" class="${errores ? 'invalido' : ''}">
            ${errorCampo(errores, 'meta')}
            <p class="sutil">La nueva meta se aplica desde la semana actual (${etiquetaSemana(semanaActual)}) en adelante.
              Las semanas anteriores conservan la meta con la que fueron medidas.</p>
            <div class="acciones"><button class="boton" type="submit">Guardar meta</button></div>
          </form>
        </section>
        <section class="tarjeta">
          <h2>Historial de cambios de meta</h2>
          <div class="tabla-scroll"><table class="tabla">
            <thead><tr><th class="num">Meta</th><th>Vigente desde</th><th>Registrada</th><th>Por</th></tr></thead>
            <tbody>
              ${historial.map(
                (m) => html`<tr>
                  <td class="num">${m.valor}</td>
                  <td>${m.vigente_desde < '1000' ? 'Inicio' : `Semana del ${etiquetaSemana(m.vigente_desde)}`}</td>
                  <td class="nowrap">${fechaHora(m.creado_en, tz)}</td>
                  <td>${m.usuario_nombre || 'Sistema (valor inicial)'}</td>
                </tr>`
              )}
            </tbody>
          </table></div>
        </section>
      </div>`,
  });
}

function vistaError({ usuario, codigo, titulo, mensaje }) {
  return layout({
    titulo,
    usuario,
    cuerpo: html`<section class="tarjeta">
      <h1>${titulo}</h1>
      <p>${mensaje}</p>
      <p><a class="boton secundario" href="/">Volver al inicio</a></p>
      <p class="sutil">Código ${codigo}</p>
    </section>`,
  });
}

module.exports = {
  vistaLogin,
  vistaDashboardAdmin,
  vistaMiDashboard,
  vistaNuevaOportunidad,
  vistaOportunidades,
  vistaDetalle,
  vistaVendedores,
  vistaNuevoVendedor,
  vistaVendedor,
  vistaConfiguracion,
  vistaError,
};
