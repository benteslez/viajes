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
check-out, la llegada de un vuelo, los días de un coche de alquiler, los días
intermedios de un evento largo. Llevan
`_virtual: 'night' | 'checkout' | 'arrival' | 'rental' | 'return' | 'span'` y
son **copias** del registro real, con el mismo `id`. Las genera
`TripDetail._expandHotels`, que a pesar del nombre expande todos los tipos que
duran varios días.

> Antes de escribir sobre una parada, si es `_virtual` vuelve a leer el registro
> de verdad: `await DB.get('planning_items', it.id)`. Escribir la copia pierde
> los datos que la copia no traía.

### La ficha también escribe

`openPlanningDetail` no es solo de lectura: las notas, el teléfono, el WhatsApp
y la dirección se escriben ahí y se guardan al salir del campo. Tres cosas que
hay que respetar si tocas eso:

- Los guardados van **en fila** (`colaGuardado`). Cada uno relee el registro
  entero; dos a la vez leían la misma versión y el segundo pisaba al primero.
- El teléfono, el WhatsApp y la nota con formato viven en `metadata` pero **no**
  están declarados en `PLANNING_METADATA`, y `collect()` reconstruye `metadata`
  desde los campos del tipo. Por eso existe `CAMPOS_FICHA`: sin conservarlos a
  mano, guardar desde el editor los borraba. Si añades otro campo que solo pida
  la ficha, mételo ahí. `CAMPOS_TRAMO` (`origen_lat`, `origen_lng`,
  `destino_lat`, `destino_lng`) es lo mismo para las coordenadas que deja un
  enlace del mapa pegado en Origen/Destino de un trayecto por carretera: son las
  que hacen que el trayecto cuente en el total de trayectos del día
  (`tramoCoche`), así que perderlas es perder el cálculo.
- El orden de los bloques lo decide `ordenFicha()` y se guarda en `Prefs`, no en
  el registro: es cómo quiere ver la app quien mira, no un dato del viaje.

### La nota, en dos formatos

`notes` es **texto plano** y no puede dejar de serlo: lo leen el buscador, el
PDF, la guía, el subtítulo de la tarjeta y el `.ics`, y ninguno pinta HTML. El
formato (negrita, cursiva, subrayado, enlaces) va aparte, en
`metadata.notes_html`, y **todo** lo que entra o sale de ahí pasa por
`notaSanear()` — una lista blanca cerrada— porque puede venir de un pegado o de
otro dispositivo. `notaTexto(html)` deriva el plano.

Si se reescribe la nota desde un sitio que solo maneja texto (el editor, la hoja
de nota rápida), el HTML se tira: quedarse con un formato que ya no dice lo
mismo es peor que perder la negrita.

### Preferencias de interfaz: `Prefs`, no `localStorage`

`localStorage` vale para lo que es del aparato (el tema, el último perfil). Cómo
quieres ver la app no lo es: eso va a `Prefs`, una fila por perfil en el store
`ui_prefs` que viaja por la misma cola que el resto y aparece en el otro
dispositivo. La tabla remota la crea `schema-ui-prefs.sql`; sin ejecutarlo todo
sigue funcionando en local.

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
