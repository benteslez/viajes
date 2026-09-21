# Notas para trabajar en este repo

App PWA personal de viajes. **Vanilla, sin framework y sin build**: `index.html`
es la aplicación entera (HTML + CSS + JS, ~21.000 líneas). Funciona offline;
Supabase es una capa de sincronización **opcional**.

Escribe en **español**: comentarios, mensajes de commit, textos de la interfaz y
descripciones de PR.

## Lo primero

| Quiero… | Dónde |
|---|---|
| Cambiar la app | `index.html` — es el único archivo de producción |
| Pasar las pruebas | `cd tests && npm test` (ver `tests/README.md`) |
| Ver el esquema de datos | `schema*.sql` |
| Saber cómo se despliega | `README.md` (GitHub Pages) |

No hay compilación, ni bundler, ni `npm start`. Para probar a mano basta con
servir la carpeta: `python3 -m http.server 8000`. Con `file://` no funciona
(los service workers necesitan `http(s)`).

## Convenciones del código

### Construir DOM: `el(tag, props, children)`

No hay plantillas ni JSX. Todo se monta con este ayudante (línea ~4500):

```js
el('div', { class:'day-group', data:{ day:k }, style:{ gap:'8px' },
            onclick: () => …, text:'Hola' /* o html:'<b>…</b>' */ }, [ hijo, null ])
```

- `class`, `text`, `html`, `style` y `data` tienen trato especial; `on*` se
  registra como listener; el resto va a `setAttribute`.
- Los hijos `null` / `false` se ignoran: `cond ? el(…) : null` dentro del array
  es el patrón normal.

### Objetos grandes

`Router`, `STATE`, `DB`, `SYNC`, `Trips`, `TripDetail`, `Exporter`, `UI`… son
objetos literales en el ámbito global del `<script>`. `TripDetail` es el más
grande: el detalle de un viaje y todas sus pestañas.

### Fechas

- Una fecha de día es siempre un `'YYYY-MM-DD'` **local**.
- Usa `isoLocal(d)` y `todayIso()`, **nunca** `toISOString().slice(0,10)`: en
  España (UTC+1/+2) la medianoche local cae el día anterior en UTC y los días se
  desplazaban.
- `parseDate(iso)` añade `T00:00:00` para no caer en el mismo agujero.

### Base de datos

- IndexedDB vía `idb`. `DB.STORES` lista las tablas.
- **`DB.remove` es borrado suave**: pone `deleted_at`. Las listas filtran por
  ese campo y la papelera vive de él.
- `DB.put` escribe **y encola** para Supabase. `DB.db.put` escribe solo en
  local: se usa para las fotos, que son binarios y no se sincronizan.
- El store `media` (fotos y portadas) es **local y no entra en la copia en
  JSON**: un `Blob` se serializa a `{}` y al restaurar destruía la foto buena.
  Las fotos salen en ZIP desde el menú del viaje.

### Paradas virtuales

En el planning hay filas que **no** son registros: las noches de un hotel, el
check-out, la llegada de un vuelo, los días intermedios de un evento largo.
Llevan `_virtual: 'night' | 'checkout' | 'arrival' | 'span'` y son **copias**
del registro real, con el mismo `id`.

> Antes de escribir sobre una parada, si es `_virtual` vuelve a leer el registro
> de verdad: `await DB.get('planning_items', it.id)`. Escribir la copia pierde
> los datos que la copia no traía.

### La ficha también escribe

`openPlanningDetail` no es solo de lectura: las notas, el teléfono, el WhatsApp
y la dirección se escriben ahí y se guardan al salir del campo. Dos cosas que
hay que respetar si tocas eso:

- Los guardados van **en fila** (`colaGuardado`). Cada uno relee el registro
  entero; dos a la vez leían la misma versión y el segundo pisaba al primero.
- El teléfono y el WhatsApp viven en `metadata` pero **no** están declarados en
  `PLANNING_METADATA`, y `collect()` reconstruye `metadata` desde los campos del
  tipo. Por eso existe `CAMPOS_CONTACTO`: sin conservarlos a mano, guardar desde
  el editor los borraba. Si añades otro campo que solo pida la ficha, mételo ahí.

### Estilo de los comentarios

Los comentarios del código explican **por qué**, no qué. Suelen contar la
decisión y el problema que evitan:

```js
// Encoger a media pasada mueve el suelo bajo el dedo y el navegador suelta
// el anclaje: el día se quedaba a medio deslizar. Mientras dura el gesto
// solo se crece; el alto exacto se pone al asentarse.
```

Sigue ese tono. Un comentario que repite el código sobra.

## Pruebas

No hay tests unitarios: la app es una página sin módulos y casi todo lo que se
rompe —que algo se desborde, que el carrusel se quede a medio deslizar, que un
botón no se pueda tocar— **solo se ve pintado**. La suite abre Chromium de
verdad (Playwright) contra una copia de `index.html`.

```bash
cd tests && npm install && npx playwright install chromium
npm test                 # todo; sale con 1 si algo falla
node run.js carrusel     # un archivo
```

Antes de dar por bueno un cambio en `index.html`, pásala. Si el cambio toca algo
que no estaba cubierto, añade el caso: `tests/README.md` explica cómo.

Dos reglas de la suite: **comprobar con `ok()`, no imprimir** (un `console.log`
no falla nunca) y **fechas relativas a hoy** (`window.__dias`), porque con
fechas fijas la suite se pudre sola.

## Git

- Rama de trabajo, commit, push, PR y **squash-merge**. `main` no se toca
  directamente.
- Como los PR se mergean con squash, al empezar uno nuevo se parte de
  `origin/main`, no del commit anterior de la rama.
- Mensajes de commit en español: un título corto en una línea y, debajo, qué
  problema resolvía y por qué se hizo así. Explica la decisión, no el diff.

## Service worker

`service-worker.js` cachea el shell y las CDNs. `CACHE` (el sufijo `vNNN`) se
sube a mano para invalidar la caché.

Ojo con la intuición: **no hace falta subirlo en cada cambio de `index.html`**.
El handler de documentos es *network-first* y reescribe la copia cacheada en
cada navegación con red, así que el fallback offline nunca se queda viejo. El
sufijo solo importa si cambian las CDNs o los iconos declarados en `SHELL`.

## Cosas que no están y es a propósito

- **Las fotos del día no se sincronizan.** Son ~250 KB cada una y subirlas por
  PostgREST sería caro y frágil. Consecuencia asumida: una foto subida en el
  móvil no se ve en el portátil, y la guía tiene que verse bien sin ellas.
- **No hay botón de "sincronizar ahora".** La app sincroniza sola (al guardar,
  al volver a la pantalla, al recuperar la red); el indicador de la barra dice
  si queda algo pendiente.
- **No hay pantalla completa en el planning.** El planning *es* un día por
  pantalla: abrir otra vista igual encima no aportaba nada.
