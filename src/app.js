'use strict';

const path = require('node:path');
const express = require('express');

const datos = require('./datos');
const metricas = require('./metricas');
const vistas = require('./vistas');
const seg = require('./seguridad');
const { ESTADOS } = require('./db');
const { semanaDe, esLunes, semanasEntre } = require('./semana');

const COOKIE = 'pulso_sesion';

/**
 * @param {object} opciones
 * @param {import('node:sqlite').DatabaseSync} opciones.db
 * @param {string} opciones.tz   Zona horaria del negocio (define lunes-domingo).
 * @param {() => Date} [opciones.ahora]  Reloj inyectable (pruebas).
 * @param {boolean} [opciones.cookieSegura]
 */
function crearApp({ db, tz, ahora = () => new Date(), cookieSegura = false }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  const semanaActual = () => semanaDe(ahora(), tz);

  /** Semana pedida por query (?semana=lunes) o la actual. No se permiten semanas futuras. */
  function semanaPedida(req) {
    const s = typeof req.query.semana === 'string' ? req.query.semana : '';
    const actual = semanaActual();
    return esLunes(s) && s <= actual ? s : actual;
  }

  function semanasDisponibles(vendedorId = null) {
    const actual = semanaActual();
    return semanasEntre(datos.primeraSemana(db, vendedorId) || actual, actual);
  }

  const enviar = (res, contenido, status = 200) => res.status(status).type('html').send(String(contenido));

  function error(req, res, codigo) {
    const textos = {
      403: ['Acceso denegado', 'No tiene permiso para consultar o modificar esta información.'],
      404: ['No encontrado', 'La página o el registro solicitado no existe.'],
      500: ['Error inesperado', 'Ocurrió un error. Intente nuevamente.'],
    };
    const [titulo, mensaje] = textos[codigo];
    return enviar(res, vistas.vistaError({ usuario: req.usuario, codigo, titulo, mensaje }), codigo);
  }

  const idParam = (v) => (/^\d+$/.test(String(v)) ? Number(v) : null);
  const avisoDe = (req) => (typeof req.query.ok === 'string' ? req.query.ok : null);

  // ------------------------------------------------------------ sesión

  app.use((req, res, next) => {
    req.usuario = null;
    const token = seg.leerCookies(req.headers.cookie)[COOKIE];
    const sesion = seg.leerSesion(db, token, ahora());
    if (sesion) {
      const usuario = datos.usuarioPorId(db, sesion.usuario_id);
      if (usuario && usuario.activo) {
        if (usuario.rol === 'vendedor') {
          const vendedor = datos.vendedorPorUsuario(db, usuario.id);
          if (vendedor && vendedor.activo) {
            req.usuario = usuario;
            req.vendedor = vendedor;
          }
        } else {
          req.usuario = usuario;
        }
      }
    }
    req.token = token;
    next();
  });

  const requiereSesion = (req, res, next) => (req.usuario ? next() : res.redirect(303, '/login'));
  const requiereRol = (rol) => (req, res, next) => {
    if (!req.usuario) return res.redirect(303, '/login');
    if (req.usuario.rol !== rol) return error(req, res, 403);
    next();
  };
  const soloAdmin = requiereRol('admin');
  const soloVendedor = requiereRol('vendedor');

  // ---------------------------------------------------------- acceso

  app.get('/', (req, res) => {
    if (!req.usuario) return res.redirect(303, '/login');
    res.redirect(303, req.usuario.rol === 'admin' ? '/admin' : '/mi-dashboard');
  });

  app.get('/login', (req, res) => {
    if (req.usuario) return res.redirect(303, '/');
    enviar(res, vistas.vistaLogin({}));
  });

  app.post('/login', (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const usuario = email ? datos.usuarioPorEmail(db, email) : null;
    let valido = usuario && usuario.activo && seg.verificarPassword(password, usuario.password_hash);
    if (valido && usuario.rol === 'vendedor') {
      const vendedor = datos.vendedorPorUsuario(db, usuario.id);
      valido = Boolean(vendedor && vendedor.activo);
    }
    if (!valido) {
      return enviar(res, vistas.vistaLogin({ error: 'Correo o contraseña incorrectos, o usuario inactivo.', email }), 401);
    }
    const { token, expira } = seg.crearSesion(db, usuario.id, ahora());
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: cookieSegura, expires: expira, path: '/' });
    res.redirect(303, usuario.rol === 'admin' ? '/admin' : '/mi-dashboard');
  });

  app.post('/logout', (req, res) => {
    seg.cerrarSesion(db, req.token);
    res.clearCookie(COOKIE, { path: '/' });
    res.redirect(303, '/login');
  });

  // ------------------------------------------------------- dashboards

  app.get('/admin', soloAdmin, (req, res) => {
    const semana = semanaPedida(req);
    enviar(
      res,
      vistas.vistaDashboardAdmin({
        usuario: req.usuario,
        resumen: metricas.resumenEquipo(db, semana),
        semanas: semanasDisponibles(),
        semanaActual: semanaActual(),
        pipelineSemana: metricas.pipeline(db, { semana }),
        pipelineTotal: metricas.pipeline(db),
      })
    );
  });

  app.get('/mi-dashboard', soloVendedor, (req, res) => {
    const semana = semanaPedida(req);
    const v = req.vendedor;
    enviar(
      res,
      vistas.vistaMiDashboard({
        usuario: req.usuario,
        progreso: metricas.progresoVendedor(db, v.id, semana),
        oportunidades: datos.listarOportunidades(db, { semana, vendedorId: v.id }).filas,
        semanas: semanasDisponibles(v.id),
        semanaActual: semanaActual(),
        pipelineSemana: metricas.pipeline(db, { semana, vendedorId: v.id }),
        pipelineTotal: metricas.pipeline(db, { vendedorId: v.id }),
        historico: metricas.historicoVendedor(db, v, semanaActual()),
        tz,
        avisoCodigo: avisoDe(req),
      })
    );
  });

  // ---------------------------------------------------- oportunidades

  app.get('/oportunidades/nueva', soloVendedor, (req, res) => {
    enviar(res, vistas.vistaNuevaOportunidad({ usuario: req.usuario }));
  });

  app.post('/oportunidades/nueva', soloVendedor, (req, res) => {
    try {
      datos.crearOportunidad(
        db,
        { cliente: req.body.cliente, necesidad: req.body.necesidad },
        { vendedor: req.vendedor, usuarioId: req.usuario.id, tz, ahora: ahora() }
      );
      res.redirect(303, '/mi-dashboard?ok=creada');
    } catch (e) {
      if (!(e instanceof datos.ErrorValidacion)) throw e;
      enviar(res, vistas.vistaNuevaOportunidad({ usuario: req.usuario, valores: req.body, errores: e.errores }), 422);
    }
  });

  app.get('/oportunidades', requiereSesion, (req, res) => {
    const esAdmin = req.usuario.rol === 'admin';
    const q = req.query;
    const filtros = {
      semana: typeof q.semana === 'string' && esLunes(q.semana) ? q.semana : null,
      estado: ESTADOS.includes(q.estado) ? q.estado : null,
      texto: typeof q.q === 'string' ? q.q.trim().slice(0, 100) : '',
      // Un vendedor solo ve lo suyo, sin importar lo que pida en la URL.
      vendedorId: esAdmin ? idParam(q.vendedor) : req.vendedor.id,
    };
    enviar(
      res,
      vistas.vistaOportunidades({
        usuario: req.usuario,
        filtros,
        resultado: datos.listarOportunidades(db, filtros),
        vendedores: esAdmin ? datos.listarVendedores(db) : [],
        semanas: semanasDisponibles(esAdmin ? null : req.vendedor.id),
        semanaActual: semanaActual(),
        tz,
      })
    );
  });

  /** Carga la oportunidad y verifica permisos: admin consulta todo; vendedor solo lo suyo. */
  function cargarOportunidad(req, res, next) {
    const id = idParam(req.params.id);
    const op = id && datos.oportunidadPorId(db, id);
    if (!op) return error(req, res, 404);
    if (req.usuario.rol === 'vendedor' && op.vendedor_id !== req.vendedor.id) return error(req, res, 403);
    req.oportunidad = op;
    next();
  }

  const puedeEditar = (req) => req.usuario.rol === 'vendedor' && req.oportunidad.vendedor_id === req.vendedor.id;

  app.get('/oportunidades/:id', requiereSesion, cargarOportunidad, (req, res) => {
    const op = req.oportunidad;
    enviar(
      res,
      vistas.vistaDetalle({
        usuario: req.usuario,
        op,
        historial: datos.historialDe(db, op.id),
        puedeEditar: puedeEditar(req),
        avisoCodigo: avisoDe(req),
        tz,
      })
    );
  });

  app.post('/oportunidades/:id', requiereSesion, cargarOportunidad, (req, res) => {
    const op = req.oportunidad;
    if (!puedeEditar(req)) return error(req, res, 403);
    try {
      const r = datos.actualizarOportunidad(
        db,
        op.id,
        { cliente: req.body.cliente, necesidad: req.body.necesidad, estado: req.body.estado },
        { usuarioId: req.usuario.id, ahora: ahora() }
      );
      const ok = !r.cambios ? 'sin-cambios' : r.cambioEstado ? 'estado-actualizado' : 'actualizada';
      res.redirect(303, `/oportunidades/${op.id}?ok=${ok}`);
    } catch (e) {
      if (!(e instanceof datos.ErrorValidacion)) throw e;
      enviar(
        res,
        vistas.vistaDetalle({
          usuario: req.usuario,
          op,
          historial: datos.historialDe(db, op.id),
          puedeEditar: true,
          valores: { cliente: req.body.cliente || '', necesidad: req.body.necesidad || '', estado: req.body.estado },
          errores: e.errores,
          tz,
        }),
        422
      );
    }
  });

  // ------------------------------------------------------- vendedores

  app.get('/vendedores', soloAdmin, (req, res) => {
    const actual = semanaActual();
    const conteos = new Map(
      db
        .prepare(
          `SELECT vendedor_id, COUNT(*) AS total, SUM(CASE WHEN semana = ? THEN 1 ELSE 0 END) AS semana_actual
           FROM oportunidades GROUP BY vendedor_id`
        )
        .all(actual)
        .map((f) => [f.vendedor_id, f])
    );
    const vendedores = datos.listarVendedores(db).map((v) => ({
      ...v,
      total: conteos.get(v.id)?.total || 0,
      semana_actual: conteos.get(v.id)?.semana_actual || 0,
    }));
    enviar(res, vistas.vistaVendedores({ usuario: req.usuario, vendedores, semanaActual: actual, avisoCodigo: avisoDe(req) }));
  });

  app.get('/vendedores/nuevo', soloAdmin, (req, res) => {
    enviar(res, vistas.vistaNuevoVendedor({ usuario: req.usuario }));
  });

  app.post('/vendedores', soloAdmin, (req, res) => {
    try {
      datos.crearVendedor(db, req.body, { tz, ahora: ahora() });
      res.redirect(303, '/vendedores?ok=vendedor-creado');
    } catch (e) {
      if (!(e instanceof datos.ErrorValidacion)) throw e;
      enviar(res, vistas.vistaNuevoVendedor({ usuario: req.usuario, valores: req.body, errores: e.errores }), 422);
    }
  });

  function renderVendedor(req, res, vendedor, { valores, errores, status = 200 } = {}) {
    const semana = semanaPedida(req);
    enviar(
      res,
      vistas.vistaVendedor({
        usuario: req.usuario,
        vendedor,
        valores: valores || { nombre: vendedor.nombre, email: vendedor.email },
        errores,
        historico: metricas.historicoVendedor(db, vendedor, semanaActual()),
        semanaActual: semanaActual(),
        semana,
        pipelineSemana: metricas.pipeline(db, { semana, vendedorId: vendedor.id }),
        pipelineTotal: metricas.pipeline(db, { vendedorId: vendedor.id }),
        avisoCodigo: avisoDe(req),
      }),
      status
    );
  }

  app.get('/vendedores/:id', soloAdmin, (req, res) => {
    const v = idParam(req.params.id) && datos.vendedorPorId(db, idParam(req.params.id));
    if (!v) return error(req, res, 404);
    renderVendedor(req, res, v);
  });

  app.post('/vendedores/:id', soloAdmin, (req, res) => {
    const id = idParam(req.params.id);
    const v = id && datos.vendedorPorId(db, id);
    if (!v) return error(req, res, 404);
    try {
      datos.editarVendedor(db, id, req.body);
      res.redirect(303, `/vendedores/${id}?ok=vendedor-actualizado`);
    } catch (e) {
      if (!(e instanceof datos.ErrorValidacion)) throw e;
      renderVendedor(req, res, v, { valores: req.body, errores: e.errores, status: 422 });
    }
  });

  app.post('/vendedores/:id/activo', soloAdmin, (req, res) => {
    const id = idParam(req.params.id);
    const activo = req.body.activo === '1';
    const v = id && datos.cambiarActivoVendedor(db, id, activo);
    if (!v) return error(req, res, 404);
    const destino = String(req.get('referer') || '').includes(`/vendedores/${id}`) ? `/vendedores/${id}` : '/vendedores';
    res.redirect(303, `${destino}?ok=${activo ? 'vendedor-activado' : 'vendedor-desactivado'}`);
  });

  // ---------------------------------------------------- configuración

  function renderConfiguracion(req, res, { errores, valor, status = 200 } = {}) {
    enviar(
      res,
      vistas.vistaConfiguracion({
        usuario: req.usuario,
        metaActual: datos.metaDeSemana(db, semanaActual()),
        historial: datos.historialMetas(db),
        errores,
        valor,
        semanaActual: semanaActual(),
        avisoCodigo: avisoDe(req),
        tz,
      }),
      status
    );
  }

  app.get('/configuracion', soloAdmin, (req, res) => renderConfiguracion(req, res));

  app.post('/configuracion', soloAdmin, (req, res) => {
    try {
      datos.cambiarMeta(db, req.body.meta, { usuarioId: req.usuario.id, tz, ahora: ahora() });
      res.redirect(303, '/configuracion?ok=meta-actualizada');
    } catch (e) {
      if (!(e instanceof datos.ErrorValidacion)) throw e;
      renderConfiguracion(req, res, { errores: e.errores, valor: req.body.meta, status: 422 });
    }
  });

  // ----------------------------------------------------------- errores

  app.use((req, res) => error(req, res, 404));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    error(req, res, 500);
  });

  return app;
}

module.exports = { crearApp };
