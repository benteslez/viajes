/* Lo que comparten todas las pruebas: servidor, navegador, semilla y el
 * marcador de OK/FALLA. Cada archivo de prueba se queda así en lo suyo. */
const fs = require('fs');
const path = require('path');
const http = require('http');

const { construir, APP } = require('./build');

const PUERTO = Number(process.env.VIAJES_TEST_PORT || 8778);
const BASE = `http://localhost:${PUERTO}/index.html`;

// Playwright: el de tests/node_modules y, si no, el que haya instalado el
// sistema (en algunos entornos viene ya puesto y no hace falta npm install).
// PLAYWRIGHT_MODULE fuerza una ruta concreta.
function playwright() {
  const candidatos = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright', 'playwright-core',
    // Instalaciones globales de npm más habituales.
    '/usr/lib/node_modules/playwright', '/usr/local/lib/node_modules/playwright',
    '/opt/node22/lib/node_modules/playwright',
  ].filter(Boolean);
  for (const c of candidatos) {
    try { return require(c); } catch (_) { /* siguiente */ }
  }
  throw new Error('Falta Playwright: entra en tests/ y ejecuta `npm install`.');
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.map': 'application/json',
};

// Servidor estático mínimo. No usamos `python3 -m http.server` para que la
// suite dependa solo de node.
function servir(dir) {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('no está'); return;
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => srv.listen(PUERTO, () => r(srv)));
}

const espera = (p, ms) => p.waitForTimeout(ms);

// Las capturas no deciden nada: se guardan para poder mirar con los ojos qué
// pasó cuando una comprobación falla.
const CAPTURAS = path.join(__dirname, '.tmp', 'capturas');
function captura(nombre) {
  fs.mkdirSync(CAPTURAS, { recursive: true });
  return path.join(CAPTURAS, nombre);
}

// Abre la app con un perfil ya elegido y el viaje de demo sembrado.
// devuelve { nav, ctx, page, errores, cerrar }
async function abrir(opts = {}) {
  const { chromium, devices } = playwright();
  const nav = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });
  const ctx = await nav.newContext({
    ...(opts.escritorio ? { viewport: { width: 1280, height: 900 } } : devices['iPhone 13']),
    hasTouch: !opts.escritorio, isMobile: !opts.escritorio,
    acceptDownloads: true,
    ...(opts.contexto || {}),
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push('PAGEERR: ' + e.message));
  await page.goto(BASE);
  await espera(page, 900);
  await page.tap('.profile-btn').catch(() => page.click('.profile-btn'));
  await espera(page, 900);
  if (opts.sembrar !== false) await sembrar(page, opts);
  return { nav, ctx, page, errores, cerrar: () => nav.close() };
}

// Inyecta seed.js y crea el viaje de demo. opts.abrir: 'planning' | 'resumen' | false
async function sembrar(page, opts = {}) {
  await page.evaluate(fs.readFileSync(path.join(__dirname, 'seed.js'), 'utf8'));
  const tab = opts.abrir === undefined ? 'planning' : opts.abrir;
  await page.evaluate(async (tab) => {
    const id = await window.__seed();
    if (tab) await Router.go('trip', { tripId: id, tab });
  }, tab);
  await espera(page, tab ? 2000 : 600);
}

// Marcador. Cuenta los fallos en un contador del proceso para que el runner
// pueda darles un código de salida.
let fallos = 0;
function ok(cond, titulo, detalle) {
  if (!cond) fallos++;
  const d = detalle === undefined ? '' : '  → ' + (typeof detalle === 'string' ? detalle : JSON.stringify(detalle));
  console.log((cond ? '  OK   · ' : '  FALLA · ') + titulo + d);
}
function titulo(txt) { console.log('— ' + txt + ' —'); }

// Cierra la prueba: enseña los errores de JS (que también cuentan como fallo) y
// sale con 1 si algo ha ido mal.
function terminar(errores) {
  if (errores && errores.length) { fallos += errores.length; console.log('  FALLA · errores de JS:', errores); }
  else console.log('  OK   · sin errores de JS');
  if (fallos) { console.log(`\n${fallos} fallo(s)`); process.exitCode = 1; }
}

module.exports = { construir, APP, BASE, PUERTO, servir, abrir, sembrar, espera, captura, ok, titulo, terminar, playwright };
