# imports/

Viajes ya montados en el **mismo formato que produce «Exportar JSON»** de la app
(`DB.exportProfile`). Se cargan desde **Ajustes → Importar JSON**.

## Cómo importar

1. Descarga el `.json` a tu dispositivo.
2. Abre la app con el perfil **Rubén** (las filas llevan `profile: "ruben"`).
3. **Ajustes → Importar JSON** → elige el archivo → confirma.
4. Si hay sesión de Supabase, `DB.importProfile` encola las filas y se suben solas.

Los `id` son UUID **deterministas** (v5 sobre una semilla fija): reimportar el
mismo archivo **sobrescribe** las filas en vez de duplicar el viaje.

## Si el viaje no aparece en los demás dispositivos

`SYNC.pullAll()` baja solo lo cambiado: `.gt('updated_at', since)`, con `since` =
último sync de ESE dispositivo. Y el trigger `trg_touch_*` de Supabase sella
`updated_at` en el servidor, pero durante mucho tiempo fue `before update` a
secas: en el INSERT se respetaba el valor del cliente. Un archivo con un
`updated_at` viejo entraba en la base y **ningún otro dispositivo lo pedía jamás**.

- **Arreglado en el esquema**: el trigger es ahora `before insert or update`.
  Hay que volver a ejecutar ese bloque de `schema.sql` en Supabase para que
  aplique; si no, sigue el comportamiento antiguo.
- **Mientras tanto**, los `.json` de esta carpeta llevan en `updated_at` la fecha
  de **generación del archivo**, no la del viaje. La fecha real del viaje va en
  `start_date`/`end_date` y en `created_at`.
- **Si ya importaste y no se ve** en otro dispositivo: los datos están en
  Supabase, lo que falla es que no se piden. En ese dispositivo, toca el pill de
  sincronización de la barra superior → **«Pull completo»**. Borra el
  `last_sync_*` y trae todo desde cero.

## Archivos

| Archivo | Viaje | Fechas | Contenido |
|---|---|---|---|
| `brasil-2025-2026.json` | Brasil | 20/12/2025 → 12/01/2026 (24 días) | 1 viaje, 8 tramos, 195 eventos, 24 títulos de día, 1 país visitado |

### `brasil-2025-2026.json`

- **Estado**: viaje **pasado** — `in_preparation: false` y `end_date` anterior a hoy,
  que es lo que hace que `tripStatus()` devuelva `'pas'`. No hay ningún campo
  «pasado» que fijar a mano.
- **Multi-destino**: `is_multi_destino: true`, con un `trip_legs` por ciudad
  (São Paulo, Florianópolis, Salvador, Porto de Galinhas, Río de Janeiro, Paraty,
  Ilha Grande y vuelta a Río).
- **Reservas**: `status: "confirmado"` en `vuelo`/`hotel`/`transporte`/`coche`.
  Sin estado, `itemStatus()` los pintaría de naranja «por iniciar», que en un
  viaje ya hecho no tiene sentido. `actividad` se queda sin estado (su
  comportamiento por defecto en la app).
- **Sin geocodificar**: `lat`/`lng`/`place_name` van a `null`. Para el mapa,
  usa la revisión de ubicaciones del propio viaje.
- **Sin horas**: el itinerario de origen no las traía, así que `time` es `null`
  y el orden dentro de cada día lo da `order_index`.
- **Título de día**: un `day_notes` por cada uno de los 24 días con la ciudad
  («Florianópolis», «Río de Janeiro»…). Es la pastilla de la cabecera del día en
  el planning, y sigue visible con el día plegado. La ciudad es **donde se duerme**
  esa noche, que es lo que deja un solo nombre también en los días de traslado;
  los días 16 y 24 no tienen alojamiento y toman la ciudad donde transcurren.
  Cada destino lleva su color de `DAY_COLORS` para que la pastilla localice de un
  vistazo; se deja fuera `rojo`, que en esta app lee como alarma.

#### Correspondencia categoría → tipo de evento

El itinerario de origen usaba categorías propias; los tipos válidos son los de
`TYPES_PLANNING` (y el `check` de `planning_items.type` en `schema.sql`).

| Categoría origen | Tipo en la app | Nota |
|---|---|---|
| `transporte` + `modo: vuelo` | `vuelo` | `metadata`: aerolínea/origen/destino sacados del propio título |
| `transporte` + `modo: alquiler_coche` | `coche` | |
| `transporte` (resto) | `transporte` | `metadata.modo`: uber→`taxi`, transfer/buggy→`coche`, taxi_boat/lancha→`barco`, tren→`tren`, bus→`bus`, teleférico→sin modo (no existe en la app) |
| `alojamiento` | `hotel` | `metadata.nombre` cuando el título nombra el alojamiento |
| `comida` | `comida` | |
| `playa` | `playa` | |
| `cultura`, `mirador`, `naturaleza` | `lugar` | La app no tiene estos tres tipos |
| `actividad`, `evento` | `actividad` | |
