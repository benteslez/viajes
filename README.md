# Viajes — App PWA personal

Aplicación web de planificación y gestión de viajes. Vanilla HTML/CSS/JS, sin framework, sin build.
Funciona **100% offline** en el móvil; **Supabase** se usa solo como capa opcional de sincronización
entre dispositivos. Diseñada para uso personal con 3 perfiles fijos (Rubén, Sergio, Invitado).

## Estructura

```
viajes/
├── index.html          ← la app entera (HTML + CSS + JS vanilla)
├── manifest.json       ← metadatos PWA
├── service-worker.js   ← cache de app shell y CDNs
├── schema.sql          ← tablas Supabase + RLS por perfil
├── icons/              ← iconos PWA
└── README.md
```

## Uso local sin Supabase

Solo necesitas servir los archivos desde un servidor estático cualquiera. Ejemplos:

```bash
# Python
python3 -m http.server 8000

# Node
npx serve .
```

Abre `http://localhost:8000` en el navegador. Elige perfil → la app funciona sin internet a partir
de ese momento. Los datos viven en **IndexedDB** del dispositivo.

> Aviso: `file://` no funciona porque los service workers requieren `http(s)`.

## Despliegue en GitHub Pages

1. Sube todo el contenido de `viajes/` a una rama (`main` o `gh-pages`) del repo en GitHub.
2. En **Settings → Pages** elige la rama y la carpeta raíz.
3. Espera a que se publique la URL.
4. Abre la URL desde el móvil → **Compartir → Añadir a inicio** para instalarla como PWA.

A partir del primer arranque online, el service worker cachea las CDNs (Leaflet, Supabase JS,
jsPDF, idb) y la app es usable sin red.

## Conectar Supabase (opcional)

La app funciona perfectamente sin Supabase. Si quieres sincronizar entre tu móvil y tu portátil:

1. Crea un proyecto gratuito en [supabase.com](https://supabase.com).
2. En el **SQL editor** pega y ejecuta `schema.sql`. Crea todas las tablas, triggers de
   `updated_at`, y políticas RLS basadas en una cabecera `x-app-profile`.
3. En `index.html`, busca el objeto `CFG` (cerca del principio del `<script>`) y rellena:

   ```js
   const CFG = {
     supabaseUrl: 'https://<tu-proyecto>.supabase.co',
     supabaseAnonKey: '<tu-anon-key>',
     externalPlannerUrl: '',  // (opcional) URL del HTML "Explorar opciones"
     appName: 'ViajesApp/1.0 (personal)',
   };
   ```

4. Publica y recarga la PWA en cada dispositivo. Verás el pill de la barra superior pasar a
   "Sincronizado".

### Modelo de aislamiento por perfil

No hay autenticación. El cliente envía `x-app-profile: rubén|sergio|invitado` en cada petición.
La función `app_profile()` y las políticas RLS filtran filas por esa cabecera. Como el frontend es
trusted (solo lo usas tú), basta con esto. **No publiques la app sin antes pensar si esta
asunción te sigue valiendo.**

## Comportamiento offline

- Toda lectura/escritura va primero a IndexedDB.
- Cada cambio queda en la cola `_pending`.
- Al recuperar red, la cola hace `upsert` a Supabase y luego un pull (`updated_at > last_sync`).
- Resolución de conflictos: **last-write-wins** por `updated_at`.

El pill arriba a la derecha refleja el estado:
- **Local** — sin Supabase configurado.
- **Sin conexión** — cambios encolados, se enviarán al volver la red.
- **Sincronizando…** — flush en curso.
- **Sincronizado** — al día.
- **Error sync** — revisa la consola.

## Tipo de cambio (FX)

Se usa `open.er-api.com` (sin clave) como API gratuita para tasas EUR→X. Se cachea 6 h en IndexedDB.
Si no hay conexión, la app usa la última tasa cacheada o la tasa manual que pongas al editar el gasto.

## Exportar / Importar

Desde el icono de perfil arriba a la derecha:
- **Exportar JSON** → backup completo del perfil activo.
- **Importar JSON** → restaura desde backup (sobrescribe IDs iguales).
- **PDF** desde la pantalla de un viaje → itinerario imprimible.

## "Explorar opciones" (planificador externo)

Si tienes un HTML aparte con tu listado de opciones futuras, pon su ruta en `CFG.externalPlannerUrl`.
Aparecerá un botón en la pantalla principal que lo abre en pestaña nueva.

## Pablo · armario del bebé (solo viaje "España")

El viaje cuyo `name` o `country` contenga **España** muestra una pestaña extra **"Pablo"**: el
armario del bebé, con inventario y un **plan de ropa con objetivo, estadísticas y progreso**. Es
**nativo**, no un iframe: usa el mismo sistema de datos, diseño, offline y **sincronización
Supabase** que el resto de la app.

- **Activación:** la pestaña solo aparece si `name`/`country` del viaje matchean `/espa[ñn]a/i`
  (ver `tabCandidates` en `index.html`). Se puede ocultar/reordenar desde *Editar viaje → Pestañas
  del menú*.
- **Dos vistas** (selector *Inventario / Plan* en `TripDetail.tabPablo`):
  - **Inventario:** lista de prendas, orden, exportar CSV. Añadir/editar con un **asistente a
    pantalla completa** (`openWardrobeFlow`): prenda → tipo → talla → confirmar en verde, con
    deslizamiento y botón de volver/descartar en cada paso.
  - **Plan:** aviso de talla vigente y próximo cambio, **barra de progreso global**, progreso
    **por talla** y **por prenda**, **gráfico de barras** del inventario por prenda, y acciones
    (comprar/editar/exportar).
- **Plan de ropa** (`TripDetail.WARDROBE_PLAN`): cubre **jun 2026 – jul 2027**. Pablo (nac.
  5-mar-2026) pasa por **3-6m** (jun–ago 2026, **verano en España** → manga corta/corto) →
  **6-9m** (sep–nov) → **9-12m** (dic–feb) → **12-18m** (mar–jul), estos ya en **Bogotá** (clima
  fresco todo el año, ~8–19 °C; predominio de manga larga + capas). ~159 prendas en total. Cada
  talla tiene fechas (`desde`/`hasta`) para calcular la talla actual y el próximo cambio.
  - **Etiqueta y filtro "☀️ Verano":** las líneas de ropa de verano (pelele/body/camiseta de manga
    corta, pantalón corto, gorro de sol…) llevan `verano:true` y se marcan con un badge. El botón
    *"Ver ropa de verano"* (y el toggle *"Solo verano"* en la lista) filtra para ver solo esas.
  - **Cobertura:** por línea `talla|prenda`, `covered = archivada ? need : min(have, need)`.
  - **Lista del plan** (`_wardrobeOpenChecklist`, toca el progreso): cada línea tiene **+/−** que
    ajustan el inventario real (`_wardrobeAdjust` crea/incrementa o decrementa/elimina en
    `wardrobe_items`; el `+` usa el primer `tipo` del catálogo). Una sola fuente de verdad: el
    contador, las barras y el gráfico se mueven a la vez.
  - **Editar plan** (`_wardrobeEditPlan`): ajusta las cantidades objetivo por talla/prenda.
  - **Comprar en España** (`_wardrobeOpenShopping`): lista solo lo que falta; el `+` registra lo
    comprado (suma al inventario) y la línea desaparece al completarse. También hay export CSV.
  - **Guardar talla** (archivar): cuando se le queda pequeña, márcala como guardada; deja de contar
    como pendiente (100 %) y se atenúa, para centrar el progreso en lo que viene.
- **Datos (sincronizados):** stores de IndexedDB que entran en la cola `_pending` → Supabase:
  - `wardrobe_items` — una fila por entrada (`trip_id`, `prenda`, `tipo`, `talla`, `qty`).
  - `wardrobe_catalog` — una fila por viaje (`id = trip_id`): opciones personalizadas
    (`prendas`, `tipos`, `tallas`), `prefs` (cantidades editadas del plan + tallas archivadas) y
    `checklist` (reservado/compatibilidad).
  Al ser per-trip, entran también en el **Exportar/Importar JSON** del perfil.
- **Sincroniza en todos los dispositivos** vía Supabase (last-write-wins por `updated_at`).
  ⚠️ Requiere el `schema.sql` actualizado (tablas `wardrobe_items`/`wardrobe_catalog` con las
  columnas `checklist` y `prefs`, y su RLS). Si ya tenías Supabase de antes, **vuelve a ejecutar
  `schema.sql` o `schema-wardrobe.sql`** (idempotentes; incluyen los `alter table … add column`).
- **Offline:** funciona sin red como el resto (los datos van primero a IndexedDB).

## Ubicaciones y geocodificación

Las coordenadas de cada parada salen de geocodificar su nombre con Nominatim. Buscar el nombre a
secas y quedarse con el primer resultado del mundo produce disparates: un "Obelisco" en Italia, un
"Piano Staircase" en Los Ángeles.

**`geocodeInContext(texto, ctx)`** acota la búsqueda:

1. Prueba `nombre, ciudad, país`, luego `nombre, país`, luego el nombre solo — siempre con un
   `viewbox` de ~75 km alrededor del centro de la ciudad del día y `bounded=1`.
2. Valida el resultado: si cae a más de 60 km de esa ciudad, se descarta.
3. Si nada encaja devuelve `null`. **Nunca escribe una coordenada sin validar**: mejor sin
   ubicación que en el país equivocado.

La ciudad de cada día la da `GeoCities.deduce()` (ver más abajo), que es también lo que usa el
visor compartido. Una sola implementación para los dos.

### Revisar ubicaciones

En el menú del viaje. Compara cada evento con la ciudad de su día, y los que se salgan más de
200 km los vuelve a buscar con contexto. Muestra el recuento antes de empezar, el progreso evento
a evento y un resumen con los que no ha podido verificar.

- Nominatim admite **una consulta por segundo**, así que el panel estima la duración y se puede
  cancelar cerrándolo.
- Un evento que no se pueda verificar **se queda como está**, salvo que se marque *Quitar la
  ubicación de los que no se puedan verificar*.

## Compartir un viaje en solo lectura

Desde la pantalla del viaje, *Compartir viaje* genera un **HTML autónomo** con ese viaje y nada
más: el receptor lo abre en cualquier navegador, sin app, sin cuenta y sin acceso al resto de tus
datos. El archivo no lleva la clave de Supabase.

**Cómo se ve** (`Exporter._viewerScript`):

- **Itinerario plegable.** Un `<details>` por día, cerrados de entrada, con un botón *Desplegar
  todo*. La cabecera de cada día lleva pastillas: 📍 lugar, 🏨 alojamiento de esa noche,
  ✈️ cada vuelo, 🚗 cada coche y el número de paradas.
- **De dónde sale la ciudad de cada día.** Los lugares casi nunca traen dirección, pero sí
  coordenadas, así que se deduce por votación (`resolverCiudades`):
  1. **Candidatas**: las ciudades de `trip.city`, las de `trip_legs`, las de las direcciones
     (`cityFromAddress`) y los destinos de los vuelos. Se descartan provincias y regiones.
  2. **Posición** de cada candidata: la *mediana* de los puntos que la nombran — con la media, un
     punto suelto lejano desplaza el centro.
  3. **Alias**: una candidata que no está en `trip.city` y cae a menos de 25 km de una que sí lo
     está se funde en ella (Ñuñoa → Santiago, San Carlos de Bariloche → Bariloche).
  4. **Votos por día**: dirección del evento +3, nombre de la ciudad en el título +3, destino del
     vuelo +3, alojamiento de esa noche +2 y cercanía a menos de 30 km +1. El radio es corto a
     propósito: con 60 km, Colonia del Sacramento votaba a Buenos Aires.
  5. Sin votos, se **hereda** la ciudad del día anterior (que es donde se dormía).
  6. Los días iniciales que quedan huérfanos se emparejan **en orden** con las ciudades de
     `trip.city` que no se han podido situar, y **solo si el número coincide exactamente**: una
     etiqueta equivocada es peor que ninguna.

  Medido contra un viaje real de 26 días sin títulos de día ni tramos, con solo 9 de 144 eventos
  con dirección: **26 de 26 días etiquetados correctamente**. El título del día, si lo hay y dice
  algo distinto de la ciudad, se muestra en una pastilla aparte.
- **Alojamiento de la noche**: `consultation_planned_d1 <= día < consultation_planned_d2`, así que
  el día del check-out ya no lo muestra.
- **Sin mapa.** Se quitó: las coordenadas guardadas venían mal geocodificadas y el mapa era ruido.
  El archivo tampoco publica ya `lat`/`lng`, y el enlace de cada parada se arma con el nombre del
  sitio, que acierta más que una coordenada equivocada. La ciudad de cada día se calcula **antes**
  de vaciar las coordenadas, porque son su señal principal.
- **Diseño**: barra superior que aparece al pasar la portada, portada con degradado de marca,
  cifras del viaje (días, ciudades, paradas, vuelos, alojamientos), número de día en un disco,
  pastillas sin borde e iconos de trazo. Claro y oscuro.

### Enlace en vez de archivo

El botón **Crear enlace** sube ese mismo HTML a un repo de GitHub y devuelve su URL de Pages
(`https://<usuario>.github.io/<repo>/compartir/<viaje>-<aleatorio>.html`). No hay backend: la
escritura la hace el navegador con la API de GitHub.

Configuración (*Ajustes del enlace*, guardada en `localStorage`, clave `viajes_share_gh`):
usuario, repo, rama, carpeta, URL base de Pages y un **token fine-grained** con acceso solo a ese
repo y permiso *Contents: Read and write*.

- El token vive **solo en ese dispositivo** y nunca entra en el HTML publicado (`hideTerms` y el
  token se excluyen del `OPTS` que se embebe).
- **Actualizar** reutiliza la misma ruta: la URL que ya mandaste no cambia.
- **Revocar** borra el archivo del repo; el enlace deja de funcionar.
- GitHub Pages tarda ~1 minuto en publicar el archivo nuevo.

> En un repo **público** la carpeta de enlaces la puede listar cualquiera: la URL no es un
> secreto, solo evita que se adivine. Para enlaces realmente privados hace falta un repo privado
> con Pages o un hosting aparte.

## Atajos de teclado

- `⌘+K` / `Ctrl+K` → búsqueda global (trips, paradas, gastos, reservas).
- `Esc` → cierra el modal activo.
- `←` / `→` dentro de las sub-pestañas del viaje → navega entre secciones.
- `Tab` dentro de un modal → cicla solo entre los controles del modal (focus trap).

## Accesibilidad

- Skip link "Saltar al contenido principal" (visible al enfocar con Tab).
- Modales con patrón Dialog completo: `aria-modal`, `aria-labelledby`, focus trap, restauración de foco.
- Sub-pestañas con patrón Tablist (`role="tablist"`, `aria-selected`, navegación con flechas).
- Chips de filtro con `aria-pressed`.
- SVGs decorativos con `aria-hidden` para no interferir con lectores de pantalla.
- Respeta `prefers-reduced-motion` (animaciones reducidas a 0.01 ms).
- Labels asociados programáticamente con sus inputs via `htmlFor`.

## Notas técnicas

- Sin build step. Edita `index.html` y recarga.
- El service worker tiene un único `CACHE` con versión (`viajes-shell-v79` actualmente). Sube el
  número cuando cambies recursos cacheados (CDNs nuevas, iconos) para forzar invalidación.
- Aplicación de tema **antes del primer paint** mediante script inline en `<head>` que lee
  `localStorage` — evita el flash de tema claro al cargar en modo oscuro.
- Tipografía: **Manrope** (única, vía Google Fonts) con números tabulares (`font-feature-settings:
  "tnum","ss01"`) para mantener importes y horas alineados sin necesidad de mono. Si pierdes
  conexión, el navegador usa system-ui como fallback.
- El mapa usa OSM tiles. Sin clave, sin rate limits problemáticos para uso personal.
- IndexedDB con manejadores `blocked`/`blocking`/`terminated` + timeout de 10 s para no quedarse
  colgado si otra pestaña bloquea un upgrade.

## Recuperación si algo va mal

Si la app se queda en una pantalla vacía o "Abriendo base de datos…":

1. Recarga forzada (`Cmd+Shift+R` o `Ctrl+Shift+R`).
2. Si persiste, **botón rojo "Reset total"** que aparece en el bloque de error — borra IndexedDB,
   caches y service worker, y recarga limpio. Si tienes datos importantes, **exporta JSON antes**.

## Roadmap

- [ ] Multi-destino completo (UI de gestión de `trip_legs`).
- [ ] Mapa de países visitados con SVG world map.
- [ ] Self-host de Manrope + librerías para offline puro desde el primer arranque.
- [ ] Notificaciones de cuenta atrás (caducidad pasaporte / inicio viaje) con `Notification API`.
- [ ] Fotos locales en cover (Blob en IndexedDB en lugar de URL externa).
- [ ] Calendario unificado mensual con todos los viajes.
