# Pulso Comercial

Aplicación web para seguir la actividad comercial del equipo de ventas: cuántas oportunidades crea cada
vendedor, a qué clientes atiende, qué necesitan y cómo avanza cada uno frente a la meta semanal.

> ¿Quién ha colocado más oportunidades y cómo avanza cada vendedor frente a la meta semanal?

## Requisitos

- Node.js **22.13 o superior** (usa el módulo integrado `node:sqlite`; no requiere un servidor de base de datos).

## Puesta en marcha

```bash
npm install
ADMIN_EMAIL=admin@miempresa.com ADMIN_PASSWORD='una-clave-segura' APP_TZ=America/Costa_Rica npm start
# → http://localhost:3000
```

En el primer arranque se crea el administrador. Si no se define `ADMIN_PASSWORD`, se genera una contraseña
aleatoria y se muestra una sola vez en la consola.

Datos de demostración (4 vendedores y oportunidades en las últimas semanas; contraseña `demo1234`):

```bash
npm run seed:demo   # solo actúa si la base no tiene vendedores
```

### Variables de entorno

| Variable | Valor por defecto | Uso |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP |
| `DB_PATH` | `data/pulso.db` | Archivo SQLite (persistencia) |
| `APP_TZ` | zona horaria del servidor | Zona horaria del negocio: define cuándo empieza el lunes. **Configúrela** (p. ej. `America/Costa_Rica`), los servidores suelen estar en UTC |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NOMBRE` | `admin@pulso.local` / aleatoria / `Administrador` | Administrador inicial |
| `COOKIE_SECURE` | — | `1` para marcar la cookie de sesión como `Secure` (detrás de HTTPS) |

## Pruebas

```bash
npm test
```

`test/aceptacion.test.js` cubre uno por uno los criterios de aceptación de la ficha (sección 12): autenticación,
creación, campos obligatorios, 5/5 = 100 %, 7/5 = 140 %, ranking, permisos, administrador, cambio de estado,
historial, integridad de fecha, nueva semana, histórico, persistencia y cambio de meta. Las pruebas usan un reloj
controlable para simular el paso de las semanas.

## Estructura

```
src/
  server.js     arranque, creación del administrador inicial
  app.js        rutas, sesión y permisos por rol
  datos.js      acceso a datos y reglas de negocio (validaciones, historial, metas)
  metricas.js   cálculos: cumplimiento, meta del equipo, ranking, pipeline
  semana.js     semana lunes–domingo en la zona horaria del negocio
  db.js         esquema SQLite, restricciones y triggers
  seguridad.js  contraseñas (scrypt) y sesiones
  vistas.js     pantallas (HTML generado en servidor, todo escapado)
public/estilos.css
scripts/seed-demo.js
test/
```

## Modelo de datos

- **usuarios**: nombre, correo (acceso), contraseña con hash scrypt, rol (`admin`/`vendedor`), activo.
- **vendedores**: usuario asociado, nombre, activo, semana de alta.
- **oportunidades**: cliente, necesidad, vendedor, fecha de creación, `semana` (lunes de la semana de creación),
  estado, última actualización.
- **historial_estados**: oportunidad, estado anterior, nuevo estado, fecha/hora, usuario. La creación se registra
  como `— → Nueva`.
- **metas**: valor y semana desde la que rige; se conserva el historial de cambios.
- **sesiones**: token (hash) y expiración (7 días).

## Cómo se aplican las reglas de negocio

| Regla | Implementación |
|---|---|
| Semana lunes–domingo | `semana.js`, calculada en `APP_TZ` |
| Una oportunidad cuenta en la semana en que se creó | Se guarda `semana` al crearla; un trigger impide modificar `creado_en`, `semana` y `vendedor_id` |
| Fecha, vendedor y estado inicial automáticos | El servidor los asigna e ignora cualquier valor enviado |
| Estados y flujo | Nueva, En cotización, Cotizada, Ganada, Perdida. Se permite cualquier cambio (no es obligatorio recorrer todos) |
| Historial automático | Cada cambio de estado se inserta en la misma transacción; triggers impiden editar o borrar el historial |
| Vendedor solo ve/modifica lo suyo | Verificado en servidor; otro vendedor recibe **403 Acceso denegado** |
| Administrador consulta todo | Puede ver todas las oportunidades, pero no las modifica (regla 6) |
| Nueva semana desde cero, sin borrar | Los indicadores se calculan por `semana`; las oportunidades no se pueden borrar (trigger) |
| Vendedores no se eliminan | Solo se activan/desactivan; las claves foráneas impiden borrar si hay histórico |
| Meta configurable | Pantalla Configuración. **La nueva meta rige desde la semana actual**; las semanas anteriores conservan la meta con la que fueron medidas |

### Cálculos

- Cumplimiento individual = creadas en la semana / meta × 100 (redondeado; puede superar 100 %).
- Meta del equipo = meta × vendedores de la semana. Cuentan los vendedores activos dados de alta en o antes de
  esa semana, más los ya desactivados que hayan creado oportunidades en ella (para que el histórico no cambie).
- Cumplimiento del equipo = oportunidades del equipo / meta del equipo × 100.
- Ranking: de mayor a menor cantidad de oportunidades; empate por nombre. Si hay empate en el primer lugar se
  muestran todos los líderes.

## Fuera del MVP

Cotizaciones, montos, facturación, inventarios, integraciones (WhatsApp, correo), agenda, tareas, adjuntos, IA y
pronósticos no están incluidos, según la ficha.
