/* Prepara una copia de la app que se pueda servir sin internet ni Supabase.
 *
 * La app de verdad tira de CDNs y de unas credenciales de Supabase. Para las
 * pruebas eso sobra y además las hace frágiles: aquí se reescribe el HTML para
 * que cargue idb y Leaflet desde node_modules, se quitan las librerías que
 * ninguna prueba usa (Supabase, jsPDF) y se dejan las credenciales en blanco,
 * que es lo que activa el modo local puro (entrar sin sesión).
 *
 * Salida: tests/.tmp/app/  (ignorado por git)
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const TMP = path.join(__dirname, '.tmp');
const APP = path.join(TMP, 'app');
const VENDOR = path.join(APP, 'vendor');

// Copia un archivo de node_modules a vendor/. Si falta, se avisa y se sigue:
// solo las pruebas del mapa dependen de Leaflet.
function copiarDep(rel, destino) {
  const origen = path.join(__dirname, 'node_modules', rel);
  if (!fs.existsSync(origen)) {
    console.warn(`  aviso: falta ${rel} (¿npm install en tests/?)`);
    return false;
  }
  fs.copyFileSync(origen, path.join(VENDOR, destino));
  return true;
}

function construir() {
  fs.mkdirSync(VENDOR, { recursive: true });

  copiarDep('idb/build/umd.js', 'idb.js');
  copiarDep('leaflet/dist/leaflet.js', 'leaflet.js');
  copiarDep('leaflet/dist/leaflet.css', 'leaflet.css');

  let s = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

  // CDNs → copias locales
  s = s.replace('https://cdn.jsdelivr.net/npm/idb@8/build/umd.js', 'vendor/idb.js');
  s = s.replace('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'vendor/leaflet.js');
  s = s.replace('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'vendor/leaflet.css');

  // Librerías que ninguna prueba necesita: fuera, para no esperar a una red que
  // en la máquina de pruebas puede no existir.
  s = s.replace('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>', '');
  s = s.replace('<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"></script>', '');

  // Credenciales en blanco = modo local puro: se entra eligiendo perfil, sin login.
  s = s.replace(/(\n\s*supabaseUrl:\s*)'[^']*'/, "$1''");
  s = s.replace(/(\n\s*supabaseAnonKey:\s*)'[^']*'/, "$1''");
  if (/supabaseUrl:\s*'[^']/.test(s)) throw new Error('no se pudieron vaciar las credenciales de Supabase');

  fs.writeFileSync(path.join(APP, 'index.html'), s);
  return APP;
}

if (require.main === module) {
  const dir = construir();
  console.log('app de pruebas en ' + path.relative(RAIZ, dir));
}

module.exports = { construir, APP, TMP };
