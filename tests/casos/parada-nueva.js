/* La parada nueva: qué día propone, qué nombre se queda del enlace del mapa y
 * el trayecto en coche que sí cuenta en el día.
 *
 * Tres cosas que costaban trabajo a mano:
 *   · el diálogo abría siempre en el primer día del viaje, aunque estuvieras
 *     mirando el sexto;
 *   · el día de fin salía vacío, y casi todo empieza y acaba el mismo día;
 *   · pegar el enlace de Google dejaba "97751 Chichén Itzá, Yuc., México" de
 *     nombre y de título, cuando el sitio se llama "Chichén Itzá";
 *   · y un "Pescadero → Barichara" escrito a mano no era más que texto: el
 *     total de trayectos del día se lo saltaba. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir();

  // Abre el editor como lo abre el botón "+" del planning: sin decirle el día,
  // para que tenga que mirar cuál se está viendo.
  const abrirDesdeElFab = () => p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    await TripDetail.openPlanningEditor(t, null, { day: TripDetail._diaVisible || null });
  });
  const celda = (txt) => p.evaluate((txt) => {
    const c = [...document.querySelectorAll('.wz-cell')].find((x) => x.textContent.includes(txt));
    if (!c) return false; c.click(); return true;
  }, txt);
  const cerrarHoja = async () => { await p.evaluate(() => UI.closeSheet()); await sleep(p, 500); };

  titulo('EL DÍA QUE SE ESTÁ VIENDO, NO EL PRIMERO DEL VIAJE');
  const dias = await p.evaluate(() => window.__dias);
  await p.evaluate((d) => TripDetail._irADia(d), dias.pasado);
  await sleep(p, 1400);
  const visible = await p.evaluate(() => TripDetail._diaVisible);
  ok(visible === dias.pasado, 'el carrusel está en D+2, que no es el primer día del viaje',
    { visible, inicio: dias.inicio });

  await abrirDesdeElFab(); await sleep(p, 800);
  await celda('Lugar'); await sleep(p, 800);
  let propuesto = await p.evaluate(() => document.getElementById('f-day')?.value);
  ok(propuesto === dias.pasado, 'la parada nueva se propone en ese día', { propuesto, esperado: dias.pasado, inicio: dias.inicio });
  await p.screenshot({ path: captura('parada-nueva-dia.png') });
  await cerrarHoja();

  titulo('EL DÍA DE FIN, IGUAL AL DE INICIO');
  await abrirDesdeElFab(); await sleep(p, 800);
  await celda('Tren'); await sleep(p, 900);
  const rango = await p.evaluate(() => ({
    d1: document.getElementById('tr-d1')?.value,
    d2: document.getElementById('tr-d2')?.value,
  }));
  ok(rango.d1 === dias.pasado && rango.d2 === rango.d1,
    'un traslado nuevo empieza y acaba el mismo día, sin rellenar nada', rango);
  await cerrarHoja();

  titulo('DEL ENLACE DEL MAPA SE QUEDA EL NOMBRE, NO LA DIRECCIÓN ENTERA');
  const corto = await p.evaluate(() => ({
    chichen: nombreCorto('97751 Chichén Itzá, Yuc., México'),
    postal: nombreCorto('28013 Madrid'),
    sieteOnce: nombreCorto('7 Eleven'),
    coords: nombreCorto('20.6829, -88.5686'),
    vacio: nombreCorto(''),
    simple: nombreCorto('Capilla de San Antonio'),
  }));
  ok(corto.chichen === 'Chichén Itzá', 'quita el código postal y la provincia', corto.chichen);
  ok(corto.sieteOnce === '7 Eleven', 'pero no se come una cifra que es parte del nombre', corto.sieteOnce);
  ok(corto.coords === '20.6829, -88.5686', 'unas coordenadas se quedan como están', corto.coords);
  ok(corto.simple === 'Capilla de San Antonio' && corto.vacio === '', 'y lo que ya es corto no cambia', corto);

  // Y lo mismo por donde pasa de verdad: un enlace de Google pegado en "Dónde".
  await abrirDesdeElFab(); await sleep(p, 800);
  await celda('Lugar'); await sleep(p, 800);
  await p.evaluate(() => {
    const s = document.getElementById('f-search');
    s.value = 'https://www.google.com/maps/place/97751+Chichén+Itzá,+Yuc.,+México/@20.6829,-88.5686,17z/data=!3m1!4b1!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d20.6829!4d-88.5686';
    s.dispatchEvent(new Event('paste'));
    s.dispatchEvent(new Event('input'));
  });
  await sleep(p, 1600);
  const pegado = await p.evaluate(() => ({
    titulo: document.getElementById('f-title')?.value,
    sitio: document.getElementById('f-place')?.value,
    direccion: document.getElementById('f-address')?.value,
    manualAbierto: !!document.getElementById('place-manual')?.open,
    confirmado: document.querySelector('.place-selected .name')?.textContent || '',
  }));
  ok(pegado.titulo === 'Chichén Itzá', 'el título se queda con el nombre del sitio', pegado);
  ok(pegado.sitio === 'Chichén Itzá', 'y el nombre del sitio, también', pegado.sitio);
  ok(/Yuc/.test(pegado.direccion), 'lo que sobraba no se tira: se va a la dirección', pegado.direccion);
  ok(!pegado.manualAbierto, '"Escribirlo a mano" ya no se abre solo y empuja el formulario abajo');
  ok(/Chichén Itzá/.test(pegado.confirmado) && /Yuc/.test(pegado.confirmado),
    'la confirmación de arriba enseña nombre y dirección, que es para lo que se abría', pegado.confirmado);
  await p.screenshot({ path: captura('parada-nueva-enlace.png') });
  await cerrarHoja();

  titulo('EL TRAYECTO EN COCHE CUENTA EN EL TOTAL DEL DÍA');
  // El día de ayer tiene un "Pescadero → Barichara" (i3) escrito a mano y dos
  // paradas con coordenadas. Se mide el total del día antes y después de
  // pegarle los puntos al trayecto.
  const verAyer = async () => {
    await p.evaluate((d) => TripDetail._irADia(d), dias.ayer);
    await sleep(p, 1800);
    return p.evaluate((d) => {
      const g = [...document.querySelectorAll('.day-group')].find((x) => x.dataset.day === d);
      const s = g?.querySelector('.day-route-summary');
      const min = (txt) => {
        const h = /(\d+)\s*h/.exec(txt || ''), m = /(\d+)\s*min/.exec(txt || '');
        return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0);
      };
      return {
        texto: (s && s.style.display !== 'none') ? s.textContent : '',
        min: min(s && s.style.display !== 'none' ? s.textContent : ''),
        chips: g ? g.querySelectorAll('.leg-chip').length : 0,
      };
    }, dias.ayer);
  };
  const antes = await verAyer();

  // Pescadero → Barichara, los puntos de verdad (≈ 45 km de carretera).
  await p.evaluate(async () => {
    const x = await DB.get('planning_items', 'i3');
    x.metadata = Object.assign({}, x.metadata, {
      origen_lat: 6.7621, origen_lng: -73.1727,
      destino_lat: 6.6357, destino_lng: -73.2264,
    });
    await DB.put('planning_items', x);
    Router.render();
  });
  await sleep(p, 1200);
  const despues = await verAyer();
  ok(despues.chips === antes.chips + 1, 'el trayecto pinta su propio tramo', { antes: antes.chips, despues: despues.chips });
  ok(despues.min > antes.min, 'y su tiempo se suma al total de trayectos del día',
    { antes: antes.texto || '(sin ruta)', despues: despues.texto });
  ok(/🚗/.test(despues.texto), 'el resumen del día sigue siendo el de siempre', despues.texto);
  await p.screenshot({ path: captura('parada-nueva-trayecto.png') });

  titulo('Y LOS PUNTOS SOBREVIVEN A GUARDAR DESDE EL EDITOR');
  await p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    const x = await DB.get('planning_items', 'i3');
    await TripDetail.openPlanningEditor(t, x);
  });
  await sleep(p, 1000);
  const enEditor = await p.evaluate(() => ({
    aviso: document.querySelector('.tramo-aviso')?.textContent || '',
    puntos: [...document.querySelectorAll('.ruta-punto')].filter((x) => x.style.display !== 'none').length,
  }));
  ok(/🚗/.test(enEditor.aviso), 'el editor enseña el tiempo del trayecto calculado', enEditor.aviso);
  ok(enEditor.puntos === 2, 'con los dos extremos marcados', enEditor.puntos);
  await p.evaluate(() => [...document.querySelectorAll('#sheet-foot button')]
    .find((x) => /^Guardar$/.test(x.textContent.trim())).click());
  await sleep(p, 1400);
  const traGuardar = await p.evaluate(async () => {
    const x = await DB.get('planning_items', 'i3');
    return { lat: (x.metadata || {}).origen_lat, lng: (x.metadata || {}).destino_lng, origen: (x.metadata || {}).origen };
  });
  ok(traGuardar.lat != null && traGuardar.lng != null,
    'guardar la parada no borra las coordenadas del trayecto', traGuardar);

  terminar(errs);
  await cerrar();
})();
