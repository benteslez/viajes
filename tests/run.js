/* Lanza toda la suite: construye la app de pruebas, levanta el servidor y pasa
 * cada archivo de casos/ en su propio proceso.
 *
 *   node run.js              → todo
 *   node run.js planning     → solo los archivos cuyo nombre contenga "planning"
 *
 * Sale con 1 si algo falla, para que valga en un hook o en CI.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { construir, servir, PUERTO } = require('./lib');

const CASOS = path.join(__dirname, 'casos');

function correr(archivo) {
  return new Promise((r) => {
    const hijo = spawn(process.execPath, [path.join(CASOS, archivo)], {
      stdio: 'inherit', env: { ...process.env, VIAJES_TEST_PORT: String(PUERTO) },
    });
    // Un caso colgado no puede bloquear la suite entera.
    const reloj = setTimeout(() => { hijo.kill('SIGKILL'); }, 5 * 60 * 1000);
    hijo.on('close', (code) => { clearTimeout(reloj); r(code === 0); });
  });
}

(async () => {
  const filtro = process.argv[2];
  const archivos = fs.readdirSync(CASOS).filter((f) => f.endsWith('.js'))
    .filter((f) => !filtro || f.includes(filtro)).sort();
  if (!archivos.length) { console.error('No hay casos que encajen con ' + filtro); process.exit(1); }

  console.log('Construyendo la app de pruebas…');
  const dir = construir();
  const srv = await servir(dir);
  console.log(`Sirviendo en http://localhost:${PUERTO}\n`);

  const fallos = [];
  for (const f of archivos) {
    console.log(`\n══ ${f} ${'═'.repeat(Math.max(0, 56 - f.length))}`);
    if (!(await correr(f))) fallos.push(f);
  }
  srv.close();

  console.log('\n' + '─'.repeat(60));
  if (fallos.length) {
    console.log(`${fallos.length} de ${archivos.length} con fallos: ${fallos.join(', ')}`);
    process.exit(1);
  }
  console.log(`${archivos.length} archivos, todo correcto.`);
})();
