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

4. En **Authentication → Users → Add user**, crea una cuenta por persona (marca
   *Auto Confirm User*). Anota los correos.

5. En el **SQL editor**, ejecuta `schema-auth.sql`. Al final del archivo, descomenta los
   dos `insert` y pon los correos del paso 4: es lo que asocia cada cuenta con su perfil
   (`ruben`, `sergio`).

6. Publica y recarga la PWA en cada dispositivo. Te pedirá correo y contraseña una vez;
   después la sesión se guarda y el pill de la barra superior pasa a "Sincronizado".

### Modelo de aislamiento por perfil

Cada perfil es una cuenta de **Supabase Auth**. La sesión se guarda en el dispositivo, y
el servidor deduce el perfil de la tabla `app_users` a partir del JWT — que lo firma él y
no se puede falsificar desde el navegador. `app_profile()` y las políticas RLS filtran
las filas con eso. Sin sesión, `app_profile()` devuelve `NULL` y no se ve nada.

- `ruben` es el dueño y el administrador: reparte permisos y ve todo lo suyo.
- El resto entra por **concesiones explícitas** (`schema-perms.sql`): una fila en
  `trip_shares` por cada par (viaje, persona), con `can_edit` y una lista de categorías
  tapadas. Sergio incluido — su antiguo "lo lee todo" se migró a concesiones de solo lectura.
- Las cuentas invitadas llevan `profile = 'invitado'` en `app_users`. **No tiene nada que ver
  con el `invitado` que se eliminó**: aquel era el valor por defecto cuando no llegaba
  cabecera, o sea todo internet; este es una cuenta real con contraseña que solo ve lo que
  esté en `trip_shares`.
- Para enseñar un viaje a alguien sin cuenta, sigue estando el enlace HTML
  (*Compartir viaje*): sale ya redactado y no da acceso a la base.

> **Por qué cambió.** El modelo original no tenía autenticación: el cliente mandaba una
> cabecera `x-app-profile: ruben|sergio|invitado` y la RLS se fiaba de ella. Con la app
> en local eso se sostiene. Publicada en GitHub Pages, no: la `anonKey` está en el HTML
> a la vista y la cabecera la escribe quien quiera, así que **cualquiera podía leerlo
> todo** con `curl -H "x-app-profile: ruben"`. Quitar `invitado` no lo arreglaba — la
> rama `owner = app_profile()` seguía abierta. Un secreto que viaja en el HTML público
> no es un secreto.

Sin `supabaseUrl` configurada la app es puramente local: no hay servidor ni datos ajenos
que proteger, así que la pantalla de entrada sigue siendo el selector de perfil de
siempre, sin contraseña.

### Permisos por viaje

`schema-perms.sql`. La tabla `trip_shares` es la única fuente de verdad: la pantalla de
administrador de la app la edita, y la RLS la hace cumplir.

| Columna | Qué hace |
|---|---|
| `can_edit` | `false` = solo lectura. `true` = puede modificar el viaje y sus hijas |
| `ocultar` | Categorías que esa persona NO ve: `dinero`, `reservas`, `diario`, `maleta` |

Tres funciones `security definer` concentran el criterio, y todas las políticas de las tablas
hijas delegan en ellas: `app_can_read_trip()`, `app_can_edit_trip()` y `app_trip_hides()`. Son
definer para que consultar `trip_shares` desde dentro de una política no sea recursivo.

Borrar un viaje sigue siendo solo del dueño: que te dejen editarlo no te da derecho a
borrárselo.

**La app también tiene que conocer las concesiones, no solo el servidor.** Es un fallo que ya
se cometió una vez: la RLS aplicaba `can_edit` correctamente, pero `canEdit()` en `index.html`
era una constante por perfil (`sergio` → siempre lector), así que dar permiso de edición desde
Administración no cambiaba nada visible — la base lo permitía y la interfaz no ofrecía un solo
botón para usarlo.

El módulo `GRANTS` lo arregla: descarga las filas de `trip_shares` del usuario con sesión al
entrar y en cada `pullAll()`, las cachea en `localStorage` y expone `puedeEditar(tripId)`.

```js
canEdit(tripId)   // sin argumento y dentro de un viaje, se refiere a ESE viaje
```

Ese comportamiento implícito es lo que hace que el centenar de llamadas repartidas por la app
pasen a ser por viaje sin tocarlas una a una. Fuera de un viaje —la lista, el perfil— manda el
perfil: que te dejen editar el viaje de otro no te convierte en alguien que crea viajes nuevos.

Es un espejo del servidor, no una barrera: quien se salte la interfaz choca igualmente con la
RLS. Si la descarga de `trip_shares` falla, se conserva lo que hubiera en caché — dejar a un
editor sin permisos por un fallo de red sería peor que el retraso.

**Quitar el acceso tiene que borrar la copia local.** Es la otra cara de local-first: la RLS
impide volver a traer el viaje, pero el que ya se descargó sigue en el IndexedDB de esa
persona. `SYNC.purgarSinAcceso()` lo borra del dispositivo en la siguiente sincronización, con
sus tablas hijas.

Tres cautelas, cada una por un motivo distinto:

| Cautela | Por qué |
|---|---|
| Solo se purga si `GRANTS.refrescar()` devolvió `true` | Purgar contra la caché podría borrar un viaje que acaban de conceder |
| Borrado directo con `DB.db.delete()`, nunca `DB.remove()` | `DB.remove()` marca `deleted_at` y encola el borrado: sería borrarle el viaje **al dueño** por quitarle el acceso a otro |
| Si falta localmente algún viaje concedido, la pasada de `pullAll()` se hace completa | Un viaje viejo recién concedido tiene un `updated_at` anterior al último sync y el filtro incremental no lo traería nunca |

`DB.listByProfile()` aplica además el filtro de visibilidad en la propia consulta, y no en cada
pantalla: hay siete sitios que listan viajes y bastaba olvidarse de uno.

### Perfiles y cuentas

`PROFILES` tiene que contener **todos** los perfiles que puede devolver `app_users`, hoy
`ruben`, `sergio` e `invitado` (el que se asigna a cualquier alta desde Administración). Un
perfil que no esté en la lista deja sin respuesta a todo lo que se decide con
`PROFILES.find(...)`: si es lector, qué viajes ve, qué inicial se pinta.

`dataProfile()` decide de qué cajón se leen los datos. Cualquier cuenta que no sea la dueña lee
del cajón del dueño; **qué** ve de ese cajón lo decide `GRANTS`. Antes decía literalmente
`me === 'sergio'`, así que una cuenta nueva buscaba viajes de un dueño sin viajes y la pantalla
salía vacía por mucho permiso que se le diera.

`canSeeMoney()` / `canSeeLinks()` / `canSeeDocs()` son restos del invitado sin credencial y hoy
devuelven siempre `true`: ocultar es tarea del servidor, por viaje y por persona. Si volvieran a
mirar el perfil, una cuenta nueva no vería un precio jamás y el interruptor «Dinero» de
Administración no cambiaría nada.

> **Las categorías ocultan tablas enteras, no texto libre.** Ocultar `reservas` quita
> localizadores, documentos e importes de la tabla `bookings`, pero un
> `N.º de confirmación: 4648869009` escrito a mano en las notas de una parada **se sigue
> viendo**. Postgres filtra filas y columnas; no tacha trozos de un párrafo. Esto vale para
> gente de confianza con matices, no para alguien de quien no te fíes. Cerrar eso pide la
> redacción del texto libre —que la app ya sabe hacer en JavaScript, en
> `Exporter._buildShareHtml`— volcada a una tabla aparte que sea la única que lean los
> invitados.

### Pantalla de administración

*Mi perfil → Personas y permisos*, visible solo con el perfil `ruben`. Es la interfaz de
`trip_shares`: **edita las reglas, no las aplica**. Si algún día la pantalla y la base
discrepan, manda la base y la pantalla está mal.

- **Listado**: cada persona con su correo, su resumen (*"2 viajes · 1 editable · oculta:
  dinero"*) y su última entrada. Una cuenta sin fila en `app_users` sale marcada en rojo,
  porque no puede entrar.
- **Detalle**: un control segmentado por viaje — *Sin acceso · Leer · Editar* — y, cuando hay
  acceso, las pastillas de categoría. **Marcada = tapada**, por eso van en rojo: es una
  restricción, no una opción activada.
- **Atajos**: *Dar lectura a todos* y *Quitar todo*. Con veinte viajes, ir uno a uno es la
  diferencia entre usar la pantalla y no usarla. El primero respeta los permisos que ya
  hubieras puesto a mano.
- Los cambios se guardan al tocarlos, sin botón de Guardar.
- La lista de personas se cachea (`AdminView.cargado`): cada toque repinta la vista, y sin
  caché cada repintado volvía a llamar a la Edge Function.

### Datos personales (no son de ningún viaje)

`schema-personales.sql`. Documentos de viaje, plantillas de maleta y países visitados son del
**perfil**, no del viaje, así que no caben en `trip_shares`. Van en
`app_users.ocultar_personales` y funcionan **al revés** que las categorías de viaje: se ven por
defecto y se tapan una a una desde la pantalla de administración.

Lo decide `app_ve_personal(owner, cat)`: lo tuyo siempre; lo del dueño salvo que se lo hayas
tapado a esa persona; entre invitados, nada. Escribir sigue siendo solo del dueño — que veas mi
pasaporte no te deja cambiarlo.

En la app, las tres listas se leen con `dataProfile()` y no con `STATE.profile`: un lector no
tiene documentos propios, y lo que le interesa son los de quien organiza el viaje.

### Altas y bajas de cuentas

`supabase/functions/admin-usuarios/index.ts`. Crear o borrar una cuenta de Supabase Auth exige
la clave `service_role`, que se salta toda la RLS y **no puede vivir en `index.html`**, que es
público. Por eso hay una Edge Function: la clave se queda en el servidor y la app pide las cosas
por HTTP.

| Acción | Dónde se hace |
|---|---|
| Quitar el acceso (borrar de `trip_shares` / `app_users`) | En la app, con la anonKey. No necesita la función |
| Crear cuenta, borrarla, cambiarle la contraseña | Edge Function |

Acciones: `list`, `create`, `delete`, `password`. **Comprueba en el servidor que quien llama es
el perfil `ruben`** — que el botón esté escondido en la app no protege nada, cualquiera puede
llamar a la URL a mano.

Instalación: *Edge Functions → Deploy a new function*, nombre `admin-usuarios`, pegar el archivo.
`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` las inyecta Supabase sola. Hay que **apagar
*Verify JWT*** en los ajustes de la función: la comprobación interna es más estricta, porque
además de una sesión válida exige que sea la del administrador.

> **La llamada NO manda cabecera `apikey`.** La pasarela de Functions rechaza la clave legada
> (formato JWT) en proyectos con el esquema nuevo de claves, con
> `The apikey header matched no key configured for auth mode(s): "publishable", "secret"` — y eso
> aunque la API REST siga aceptando esa misma clave sin rechistar. Con *Verify JWT* apagado no
> hace falta ninguna. Si tu proyecto sí la exige, pon la *Publishable key* en
> `CFG.supabasePublishableKey` y se manda.

### Sincronización

**Es automática y no hay que pulsar nada.** Se dispara al guardar (cola + envío a 1,5 s), al
volver el foco o la visibilidad, al recuperar la conexión, cada 20 s con la app abierta, y cada
30 s para la cola.

El **indicador de la barra** es el único control: dice `Sincronizado`, `N sin subir`,
`Sin conexión` o `Error`, y al tocarlo abre el detalle con la cola, el último error y las
herramientas de reparación (*Reintentar*, *Pull completo*, *Push completo*).

Decir "Sincronizado" con cosas en cola es mentir, y era la razón de fondo por la que no daba
confianza. Ahora el contador (`SYNC.pendientes`) se lleva en memoria —contar la cola en cada
encolado sería recorrerla entera cientos de veces al importar— y se recalcula al vaciarla.
Un fallo lanza un aviso visible; antes se quedaba en un `console.warn`.

**Importar un JSON encola**, así que un viaje traído de un archivo llega solo al resto de
dispositivos. Ese era el único agujero real, y el motivo de que existiera un botón *Subir este
viaje a la nube* por viaje. Ese botón y *Sincronizar ahora* se han quitado: repetían lo que ya
pasa solo y hacían dudar de si había que pulsarlos.

### Quién tocó qué

> `AUTH.uid` se rellena en `AUTH.session()`, no solo en `fetchProfile()`. El arranque usa
> `cachedProfile() || fetchProfile()`, así que en cuanto había caché —o sea, en todos los
> arranques menos el primero— `fetchProfile()` no llegaba a ejecutarse, `uid` se quedaba a
> `null` y `_ultimaEdicion()`, que empieza con `if (!mio) return null`, no pintaba nunca la
> línea de autoría.

`schema-autoria.sql`. Cada tabla lleva `updated_by`, que **sella un trigger con `auth.uid()`**,
no el cliente: si lo mandara la app, cualquiera podría firmar una fila con el uuid de otro.

La ficha del viaje muestra *"Última edición de Sergio · hace 2 h"* cuando el último en tocar
algo **no fuiste tú**. Se mira el viaje y sus hijas, porque `trips.updated_by` solo cambia al
editar la cabecera y lo que se toca de verdad son las paradas y las reservas. Si el último
fuiste tú no se enseña nada: una línea que siempre está deja de leerse.

`app_users.nombre` traduce uuid → nombre visible, y su política se amplía a cualquiera con
sesión: sin eso no se puede pintar un nombre. Se expone quién existe y cómo se llama, a gente
que tú has invitado; los correos siguen sin salir de `auth.users`.

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

## Exportar PDF — guía de viaje

*Detalle del viaje → menú «…» → Exportar PDF*. No es un volcado de datos con estilo: es un
folleto. Portada con foto a sangre, índice con números de página, y todo lo que hay del viaje —
resumen y tramos, itinerario día a día, reservas, presupuesto, gastos compartidos, direcciones,
ficha del destino, maleta y diario. Las secciones vacías no aparecen y el índice se genera de
las que sí.

Tres decisiones sostienen el aspecto. Conviene no deshacerlas sin pensarlo:

1. **Foto a sangre en portada.** Es lo que separa un documento de una propuesta de viaje. Sale
   de `cover_blob_id` (IndexedDB) o de `cover_photo_url`. Sin foto hay una portada de color que
   aguanta el tipo, pero con foto cambia todo.
2. **Dos familias.** Times para lo que se lee de lejos —título, secciones, días— y Helvetica
   para lo que se lee de cerca. El contraste serifa / palo seco no cuesta un byte: las dos van
   en las fuentes base de PDF.
3. **Itinerario en línea de tiempo.** Hora a la izquierda, filete vertical, contenido a la
   derecha. Las tarjetas con borde eran una interfaz de app metida en un papel.

La paleta es cálida (verde profundo + terracota) a propósito, y no la azul de la app: el azul de
interfaz devuelve el documento al terreno corporativo.

Se dibuja con las primitivas de jsPDF, **no** con una captura de pantalla. El texto sigue siendo
texto: se busca y se copia, y el archivo pesa unas decenas de KB más la foto (~65 KB con foto,
~20 KB sin ella) en vez de varios MB.

### Cosas a respetar si se toca

| Detalle | Por qué |
|---|---|
| **Se maqueta dos veces** (`_maquetar`) | La primera pasada averigua en qué página cae cada sección; la segunda escribe esos números en el índice. Los datos y la foto se preparan una sola vez, así que la segunda es solo dibujo |
| **Versalitas con `setCharSpace`**, nunca inyectando espacios | Con espacios entre letras el papel se ve igual, pero el texto extraído salía como `\x00U \t\x00R \t…`: copiar un titular daba un churro y ninguna búsqueda encontraba nada |
| **El degradado se acumula hacia el pie**, no en franjas | jsPDF no tiene degradados. Con franjas sueltas se veían las costuras sobre la foto; con rectángulos que van desde su altura hasta el final, la opacidad suma sin saltos |
| **El alto de cada bloque se calcula antes de dibujarlo** (`pdfEventoAlto`) | Medir después obligaría a repintar o a partir el bloque entre dos hojas |
| **Los bloques de texto libre tienen tope** (notas 8 líneas, nota del día 10) | Un bloque más alto que una página no lo salva ningún salto de página |
| **El texto largo va por `parrafo()`, no por `txt()`** | `txt()` pinta todas las líneas donde le digas; una entrada de diario de dos folios se saldría por debajo del papel |
| **`PDF_ETIQUETAS` fija a mano los ids ambiguos** | El mismo `localizador` es «Localizador» en un vuelo y «Referencia» en un transporte; en una reserva no hay tipo del que deducirlo, y sin fijarlo ganaba la última etiqueta recorrida |
| **El dedupe título/dato es por igualdad exacta** | Con «uno contiene al otro», un seguro titulado «IATI» se comía su propio «Póliza: IATI-99231» |

### Limitaciones, que vienen del formato

- **Solo cp1252 (latín occidental).** Las fuentes base de PDF no llevan más. `pdfTexto()` traduce
  lo traducible (`→` → `>`, `−` → `-`) y descarta el resto: un topónimo en kanji sale sin los
  kanji. Embeber una fuente CJK son megabytes en un archivo que ya pesa 900 KB.
- **Una foto externa (`cover_photo_url`) puede no cargarse** si el servidor no da CORS. Falla en
  silencio y queda la portada de color: una guía sin imagen se sigue leyendo.

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

## Nota rápida de una parada

Cada evento del planning tiene un botón de **nota** (icono de nota) junto a "visto" y "editar".
Los tres solo aparecen con un perfil que pueda editar: con `sergio` o `invitado`, `canEdit()` es
`false` y la fila de acciones queda vacía. El archivo compartido es otra cosa distinta — HTML
estático, sin IndexedDB, sin formularios y sin red — así que ahí no hay nada que proteger.
Abre solo un campo de texto y guarda directo, sin pasar por el editor completo del evento — que es
lo que se quería el 90 % de las veces. El botón se resalta cuando la parada ya tiene nota, y
aparece un **Borrar** cuando hay algo que borrar. La nota se ve en la app y, debajo del nombre del
sitio, en el viaje compartido.

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
- **Quitar ubicación (N)** borra de golpe las coordenadas de los que no encajan, sin consultar
  nada. Es la salida rápida cuando una coordenada disparatada mete un trayecto de miles de km y
  dispara el aviso de *quizá no dé tiempo*. No borra la parada, solo su posición.
- El centro de una ciudad sale de los puntos que la **nombran**. Si ninguna dirección del viaje
  menciona esa ciudad, se usa como respaldo la **mediana de los puntos de ese mismo día** (con
  tres o más), para que ningún día se quede sin revisar.

### Buscar duplicados

En el menú del viaje. Agrupa **paradas** por tipo + día + nombre, y **reservas** por tipo +
identificador + fecha.

- Las copias **idénticas** (misma hora y misma nota) vienen marcadas para borrar; las que difieren
  en algo se listan sin marcar, para revisarlas a mano.
- Se conserva siempre la copia con más información, y una parada con un **gasto vinculado** nunca
  se propone para borrar (borrarla se llevaría el gasto por delante).
- El borrado es blando: todo va a la **Papelera** del viaje y se puede recuperar.
- Los duplicados aparecen sobre todo al **importar dos archivos con el mismo contenido y distinto
  id**: `importProfile` escribe por id, así que dos ids distintos son dos filas.

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
  4. **Votos por día**: dirección del evento +3, nombre de la ciudad en el título +3, vuelo +3,
     alojamiento de esa noche +2 y cercanía a menos de 30 km +1. El radio es corto a propósito:
     con 60 km, Colonia del Sacramento votaba a Buenos Aires. El vuelo vota por su **destino** solo
     si aterriza antes de las 18:00; si llega de noche vota por el **origen**, porque el día se ha
     vivido allí (el día de las cataratas de Brasil, con vuelo a las 20:20, salía como "Buenos
     Aires", y el último día del viaje como "Bogotá").
  5. Sin votos, se **hereda** la ciudad del día anterior (que es donde se dormía).
  6. Los días iniciales que quedan huérfanos se emparejan **en orden** con las ciudades de
     `trip.city` que no se han podido situar, y **solo si el número coincide exactamente**: una
     etiqueta equivocada es peor que ninguna.

  Medido contra un viaje real de 26 días sin títulos de día ni tramos, con solo 9 de 144 eventos
  con dirección: **26 de 26 días etiquetados correctamente**. El título del día, si lo hay y dice
  algo distinto de la ciudad, se muestra en una pastilla aparte.
- **Alojamiento de la noche**: `consultation_planned_d1 <= día < consultation_planned_d2`, así que
  el día del check-out ya no lo muestra.
- **Sin mapa y sin enlaces a Google Maps.** Las coordenadas guardadas venían mal geocodificadas,
  así que el mapa era ruido y el enlace de cada parada mandaba al sitio equivocado más veces de las
  que acertaba. El archivo tampoco publica ya `lat`/`lng`. La ciudad de cada día se calcula
  **antes** de vaciar las coordenadas, porque son su señal principal. El interruptor de enlaces
  ahora solo afecta a las URLs escritas dentro de las notas, y así lo dice su etiqueta.
- **Tipografía**: la pila empieza por la fuente del sistema (`-apple-system`), así que en iPhone y
  Mac se ve **San Francisco**; **Inter** cubre Android y Windows. Escala al gusto de iOS: cuerpo de
  16 px, títulos con tracking negativo y pesos intermedios (590/640) en vez de 700/800. Los números
  tabulares se piden solo donde hay cifras — en texto corrido desalinean el espaciado.
  *(La app sigue con Manrope: sus tokens `--font-ui` son independientes.)*
- **Diseño**: barra superior que aparece al pasar la portada, portada con degradado de marca,
  cifras del viaje (días, ciudades, paradas, vuelos, alojamientos), número de día en un disco,
  pastillas sin borde e iconos de trazo. Claro y oscuro.
- **Notas largas recortadas**: las notas (las del día y las de cada parada) se cortan a dos líneas
  con un *Ver más*. El botón solo aparece si el texto se corta de verdad, y eso se mide **al abrir
  el día**: dentro de un `<details>` cerrado todo mide 0 y saldría el botón hasta en una nota de
  tres palabras. Si cabe entera, se le quita el recorte y no se ofrece nada.
- **Movimiento**: al abrir un día, sus entradas aparecen escalonadas de derecha a izquierda
  (42 ms entre una y otra, cortado a los 12 elementos: con 20 paradas, esperar al último sería lo
  contrario de ágil). Los bloques de día aparecen al alcanzarlos en el scroll, una sola vez, y la
  portada y las cifras entran al cargar. Con `prefers-reduced-motion: reduce` se anulan **duración
  y retardo** — solo la duración no basta: con el escalonado, el último elemento seguía tardando
  medio segundo en verse.

**Qué se publica y qué no** (`Exporter._buildShareHtml`). Interruptores: precios, localizadores y
documentos, enlaces externos y notas.

1. Campos estructurados: `bookings.structured_data` y `planning_items.metadata` — se borran las
   claves de `DOC_FIELDS` / `MONEY_FIELDS`, más `consultation_price` y `consultation_url`.
2. Texto libre (`trip.notes`, `day_notes.text`, `planning_items.notes`): se tacha **la línea
   entera** que contenga un localizador, un "Reserva bajo…" o un importe, sustituyéndola por
   `[dato omitido]`. El resto de la nota se conserva.
   El patrón del titular (`TITULAR_RE`) va **sin la bandera `i`** y exige dos palabras
   capitalizadas seguidas: con `i`, `[A-Z]` casa también con minúsculas y degeneraba en "para" +
   dos palabras cualesquiera, tachando frases normales ("para llegar", "para comer viendo las
   cataratas").
3. Campo *Ocultar además*: términos literales del usuario (nombre completo, teléfono, matrícula),
   sustituidos en todo el archivo, incluidos títulos y direcciones. **No** se embeben en `OPTS`:
   escribirlos ahí sería la fuga que se quería evitar.

> El tachado por patrones **no es una garantía**: cubre los formatos habituales, no texto libre
> arbitrario. Para datos delicados, usa *Ocultar además* y revisa el HTML antes de mandarlo.

### Versión para compartir

Paso previo a publicar: *Compartir viaje → **Versión para compartir***. Es una capa de cambios que
se aplica **solo al generar el HTML**; los datos del viaje no se tocan.

- Título y nota propios para el enlace, por parada, y nota propia por día.
- **Ciudad del día**: la pastilla del visor se puede reescribir por día. Vacío = la deducida por
  `GeoCities`; «-» = ningún pastilla en ese día.
- **Quitar** paradas del enlace (icono de ojo). Es reversible y no borra nada del viaje.
- **Añadir** paradas que existan solo en el enlace (`+ Añadir parada`): nombre, hora opcional y
  nota. La papelera las elimina de la versión compartida. Nunca llegan a `planning_items`.
- La cuenta de paradas de cada día refleja lo que verá quien abra el enlace (quitadas fuera,
  añadidas dentro).
- Se listan **todos los días del viaje**, incluso los vacíos, para poder añadir en cualquiera.
- Vaciar un campo devuelve el texto original del viaje. *Restablecer* descarta la capa entera.
- El botón muestra cuántos cambios hay.

Vive en `trip.settings.share_draft` (`{ items: { <id>: { title?, notes?, hidden? } },
days: { <iso>: { text?, city? } }, added: { <iso>: [ { id, title, notes?, time? } ] } }`), así que
sincroniza por Supabase y viaja en el export.

Las filas de cada día se montan **al abrir ese día**: con 24 días y 144 paradas, construir todos
los campos de golpe deja la pantalla pesada en el móvil.

### Enlace en vez de archivo

El botón **Crear enlace** sube ese mismo HTML a un repo de GitHub y devuelve su URL de Pages
(`https://<usuario>.github.io/<repo>/compartir/<viaje>-<aleatorio>.html`). No hay backend: la
escritura la hace el navegador con la API de GitHub.

> **Supabase Storage no vale para esto, y está comprobado.** Se intentó mover la publicación allí
> para no depender de un token que caduca. Storage **reescribe a propósito** el `content-type` de
> `text/html` a `text/plain` como medida antiabuso, así que el navegador enseña el código fuente
> en vez de la página (y, sin charset en la cabecera, con los acentos rotos de propina). Las Edge
> Functions hacen lo mismo. Solo se puede servir HTML en **plan Pro con dominio propio**.
> Ver [supabase/discussions#39110](https://github.com/orgs/supabase/discussions/39110) y
> [supabase/storage#186](https://github.com/supabase/storage/issues/186). No volver a intentarlo
> sin comprobar antes que esa política ha cambiado.
>
> Queda el rastro en el código: `settings.share.store` vale `'gh'` para todos los enlaces, y
> `'sb'` para los que se llegaron a publicar en el bucket. Esos se detectan, avisan de que están
> rotos y, al actualizarlos, se rehacen en GitHub borrando el objeto muerto.

Configuración (*Ajustes del enlace*, guardada en `localStorage`, clave `viajes_share_gh`):
usuario, repo, rama, carpeta, URL base de Pages y un **token fine-grained** con acceso solo a ese
repo y permiso *Contents: Read and write*. Los fine-grained caducan: dale el plazo más largo que
te deje GitHub (un año) o tendrás que renovarlo justo el día que quieras compartir algo.

- El token vive **solo en ese dispositivo** y nunca entra en el HTML publicado (`hideTerms` y el
  token se excluyen del `OPTS` que se embebe).
- **Qué enlace tiene cada viaje se guarda en el propio viaje** (`settings.share`), no solo en
  `localStorage`: si no, el dispositivo donde se creó ofrecía *Actualizar* y cualquier otro
  *Crear*, y al crear se publicaba una segunda copia con otra dirección. Al ir en `settings`
  sincroniza por Supabase y viaja en el export. `localStorage` queda de respaldo para los enlaces
  anteriores a este cambio.
- **Ya tengo un enlace**: si este dispositivo no lo conoce y no hay sincronización, se pega su URL
  y queda registrado, conservando la ruta. Se rechaza cualquier URL que no cuelgue de la base de
  Pages configurada.
- **Actualizar** reutiliza la misma ruta: la URL que ya mandaste no cambia. La excepción son los
  enlaces marcados `'sb'`, que se rehacen en GitHub con URL nueva porque la suya no renderiza.
- **Revocar** borra el archivo (del repo, o del bucket si era de los `'sb'`); el enlace deja de
  funcionar.
- GitHub Pages tarda ~1 minuto en publicar el archivo nuevo.

> **La URL no es un secreto.** En un repo público la carpeta de enlaces la puede listar
> cualquiera. Lo que protege el contenido es que el HTML se genera ya redactado: los precios,
> localizadores y términos ocultos no llegan a escribirse en el archivo.

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
