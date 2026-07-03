// Service worker — cache de app shell para uso offline.
// Estrategia: cache-first para shell + CDN, network-first para tiles de mapa.
// El bump del CACHE invalida cualquier versión previa.

// Subir el sufijo cuando se quiere forzar la invalidación de la versión cacheada
// (ej. tras cambios en index.html o en las CDNs declaradas más abajo).
const CACHE = 'viajes-shell-v81';

// Caché SEPARADO para imágenes (portadas de viaje, miniaturas de tarjetas…).
// No lleva el sufijo del shell a propósito: así las imágenes ya descargadas
// sobreviven a cada actualización de la app y no hay que volver a bajarlas.
const IMG_CACHE = 'viajes-img-v1';
const IMG_MAX = 350;   // tope de imágenes cacheadas (se recortan las más antiguas)

const SHELL = [
  './',
  './index.html',
  './explorar.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
  // CDNs core — se cachean tras el primer fetch
  'https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/idb@8/build/umd.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        SHELL.map((url) =>
          cache.add(url).catch(() => {
            // No fallar la instalación si una CDN no responde — se reintenta en uso.
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE && k !== IMG_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

const isTile = (url) =>
  url.hostname.endsWith('tile.openstreetmap.org') ||
  url.hostname.includes('basemaps.cartocdn.com');

// Recorta el caché de imágenes a IMG_MAX entradas (FIFO: las claves más
// antiguas primero). El Cache API preserva el orden de inserción.
async function trimImageCache() {
  const cache = await caches.open(IMG_CACHE);
  const keys = await cache.keys();
  if (keys.length <= IMG_MAX) return;
  const excess = keys.length - IMG_MAX;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

// Imágenes → cache-first con revalidación en segundo plano (stale-while-revalidate).
// La primera vez se baja de la red y se guarda; a partir de ahí se sirve al
// instante desde caché (y offline). Se cachean respuestas OK y también las
// opacas (cross-origin sin CORS): se ven bien aunque no podamos leer su estado.
// Un fallo de red NO envenena la caché: simplemente no se guarda nada.
function handleImage(req) {
  return caches.open(IMG_CACHE).then((cache) =>
    cache.match(req).then((cached) => {
      const network = fetch(req)
        .then((resp) => {
          if (resp && (resp.ok || resp.type === 'opaque')) {
            cache.put(req, resp.clone()).then(trimImageCache).catch(() => {});
          }
          return resp;
        })
        .catch(() => cached);   // sin red: nos quedamos con lo cacheado (o nada)
      return cached || network;
    })
  );
}

const isApi = (url) =>
  url.hostname.includes('supabase.co') ||
  url.hostname.includes('nominatim.openstreetmap.org') ||
  url.hostname.includes('exchangerate.host');

// Documento HTML (index.html y "./") → network-first.
// Si hay red, siempre se sirve la versión más reciente; si no, fallback al cache.
// Así nunca quedas atrapado con una versión de index.html obsoleta.
const isHtml = (url, req) =>
  req.mode === 'navigate' ||
  url.pathname.endsWith('/') ||
  url.pathname.endsWith('/index.html');

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // APIs en vivo: solo red, no cachear (los datos pasan por IndexedDB).
  if (isApi(url)) return;

  // Imágenes (portadas de viaje, miniaturas…): cache-first con revalidación,
  // en un caché propio que persiste entre versiones. Así no se vuelven a
  // descargar en cada carga y quedan disponibles offline.
  // (Los tiles de mapa también son 'image' pero tienen su propia lógica abajo.)
  if (req.destination === 'image' && !isTile(url)) {
    event.respondWith(handleImage(req));
    return;
  }

  // Documento HTML → network-first
  if (isHtml(url, req)) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return resp;
        })
        .catch(() => caches.match(req).then(m => m || caches.match('./index.html')))
    );
    return;
  }

  // Tiles de mapa: red preferida, fallback cache.
  if (isTile(url)) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return resp;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Resto (CDNs, iconos, css): cache-first con relleno perezoso.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((resp) => {
          if (!resp || resp.status !== 200 || resp.type === 'opaqueredirect') return resp;
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return resp;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
