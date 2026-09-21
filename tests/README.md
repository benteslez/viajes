# Suite de regresión

Pruebas de la app **contra un navegador de verdad** (Chromium, vía Playwright).
No hay tests unitarios: la app es una sola página sin módulos, y casi todo lo
que se puede romper —que una tarjeta se desborde, que el carrusel se quede a
medio deslizar, que un botón no se pueda tocar— solo se ve pintado.

## Poner en marcha

```bash
cd tests
npm install                 # playwright + idb + leaflet
npx playwright install chromium
npm test
```

`npm test` construye la app de pruebas, levanta un servidor y pasa todos los
casos. Sale con **1** si algo falla, así que vale tal cual para un hook o CI.

Un solo archivo, o los que contengan un texto:

```bash
node run.js carrusel
node run.js fotos
```

Variables útiles:

| Variable | Para qué |
|---|---|
| `PLAYWRIGHT_CHROMIUM` | Ruta a un Chromium ya instalado, en vez del de Playwright |
| `PLAYWRIGHT_MODULE` | Ruta a un Playwright ya instalado |
| `VIAJES_TEST_PORT` | Puerto del servidor de pruebas (8778 por defecto) |

## Qué hay

```
tests/
├── build.js     ← copia index.html reescrito: CDNs locales, sin Supabase
├── lib.js       ← servidor, navegador, semilla y el marcador OK/FALLA
├── seed.js      ← el viaje de demo (se inyecta en la página)
├── run.js       ← lanza todos los casos y devuelve el código de salida
└── casos/
    ├── adjuntos.js          adjuntar la confirmación a una parada; el ZIP
    ├── barrido.js           pulsa TODOS los botones de todas las pestañas
    ├── calendario.js        exportar el viaje a .ics
    ├── carrusel.js          un día por pantalla, deslizar, saltar, teclado
    ├── carrusel-perezoso.js los días de al lado no se pintan hasta que hacen falta
    ├── coche-alquiler.js    "Coche alquilado" los días de en medio y la devolución
    ├── correr-dia.js        correr las horas de un día y la hora real vs. planeada
    ├── dias-pasados.js      días pasados apagados pero accesibles; abrir en hoy
    ├── editor-parada.js     el asistente de dos pasos y el orden del formulario
    ├── escritorio.js        en pantalla ancha el día se queda en una columna
    ├── fechas-viaje.js      tira de días y el editor de fechas ("Sin fecha")
    ├── ficha.js             la ficha de una parada: abrir, cerrar, cambiar tipo
    ├── ficha-contacto.js    notas, teléfono, WhatsApp y dirección desde la ficha
    ├── ficha-orden.js       mover de sitio los bloques de la ficha, sincronizado
    ├── fotos-copia.js       la copia en JSON y el ZIP de fotos
    ├── gasto-rapido.js      apuntar un gasto en dos toques y el conversor
    ├── llego.js             cuánto queda hasta la próxima parada, con GPS
    ├── mapa-offline.js      guardar las teselas del mapa para verlo sin datos
    ├── marcar-visto.js      marcar paradas y el resumen con pestañas deslizables
    ├── menu-parada.js       el menú único (••• y pulsación larga)
    ├── nota-formato.js      negrita, cursiva, subrayado y enlaces en la nota
    ├── proximo.js           el cartel "Próximo", solo a tres días del viaje
    └── tarjetas.js          billete, llave del hotel y postal de playa
```

## Cómo se escribe un caso

```js
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir();   // perfil elegido + viaje sembrado
  titulo('LO QUE SE COMPRUEBA');
  ok(condicion, 'lo que debería pasar', detalleParaCuandoFalle);
  await p.screenshot({ path: captura('algo.png') });
  terminar(errs);            // los errores de JS también cuentan como fallo
  await cerrar();
})();
```

`abrir()` deja la app con un perfil elegido y el viaje de demo creado, ya en el
planning. `abrir({ abrir: 'resumen' })` entra por otra pestaña y
`abrir({ abrir: false })` se queda en el listado de viajes.
`abrir({ escritorio: true })` cambia el móvil por una ventana de 1280×900, y
`abrir({ contexto: { permissions, geolocation } })` pasa opciones al contexto de
Playwright (el permiso de ubicación, por ejemplo).

Dos reglas que conviene no saltarse:

1. **Comprobar, no imprimir.** Un `console.log` no falla nunca. Si algo importa,
   va en un `ok()`.
2. **Fechas relativas.** `seed.js` reparte los días alrededor de hoy y los
   publica en `window.__dias` (`ayer`, `hoy`, `manana`, `pasado`…). Con fechas
   fijas la suite se pudre sola: el viaje "en curso" pasa a "terminado" y la
   mitad de las comprobaciones empiezan a fallar sin que nadie toque nada.

Las capturas van a `tests/.tmp/capturas/` y no deciden nada: están para poder
mirar con los ojos qué pasó cuando algo falla.
