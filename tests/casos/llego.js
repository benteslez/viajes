/* "¿Llego?" — cuánto queda hasta la próxima parada desde donde estás.
 *
 * La app ya sabía estimar un tramo entre dos puntos; lo que le faltaba era el
 * primero de los dos. La ubicación se simula con el permiso y la posición que
 * da el propio navegador de pruebas. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir({
    abrir: false,
    contexto: { permissions: ['geolocation'], geolocation: { latitude: 6.60, longitude: -73.20 } },
  });

  // Una próxima parada con coordenadas y hora, dentro de un rato.
  const poner = async (minutos, lat, lng) => p.evaluate(async ([m, la, ln]) => {
    for (const x of await DB.listByTrip('planning_items', 'trip-demo-1')) {
      if (!x.deleted_at) { x.deleted_at = nowIso(); await DB.put('planning_items', x); }
    }
    const d = new Date(Date.now() + m * 60000);
    const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    await DB.put('planning_items', {
      id: 'prox-1', trip_id: 'trip-demo-1', profile: dataProfile(), type: 'lugar',
      title: 'Mirador', day_date: todayIso(), time: hh, lat: la, lng: ln,
      place_name: 'Mirador', metadata: {}, order_index: 0,
    });
    const t = await DB.get('trips', 'trip-demo-1');
    t.start_date = todayIso(); t.in_preparation = false; await DB.put('trips', t);
    await Router.go('trip', { tripId: 'trip-demo-1', tab: 'resumen' });
  }, [minutos, lat, lng]);

  const barra = () => p.evaluate(() => {
    const n = document.querySelector('.llego');
    return n ? { hay: true, clase: n.className, b: n.querySelector('b')?.textContent,
                 sub: [...n.querySelectorAll('.llego-txt span')].map((x) => x.textContent).join(' | '),
                 boton: n.querySelector('button')?.textContent.trim() } : { hay: false };
  });
  const preguntar = async () => {
    await p.evaluate(() => document.querySelector('.llego button').click());
    for (let i = 0; i < 40; i++) {
      await sleep(p, 250);
      const b = await p.evaluate(() => document.querySelector('.llego b')?.textContent);
      if (b) return;
    }
  };

  titulo('LA BARRA APARECE BAJO EL PRÓXIMO EVENTO');
  await poner(60, 6.61, -73.21);          // ~1,5 km, dentro de una hora
  await sleep(p, 2200);
  let b = await barra();
  ok(b.hay, 'está');
  ok(/Cuánto te queda/.test(b.sub || ''), 'sin haber pedido la ubicación todavía', b.sub);
  ok(b.boton === '¿Llego?', 'con el botón para pedirla', b.boton);
  // La barra de "Próximo" solo se pinta cuando la tarjeta del evento NO está ya
  // resaltada en el plan del día, que estando de viaje es lo raro. "¿Llego?"
  // tiene que salir en los dos casos.
  const orden = await p.evaluate(() => {
    const ne = document.getElementById('next-event-bar');
    const ll = document.querySelector('.llego');
    if (!ll) return 'sin barra';
    if (!ne) return 'sale aunque no haya barra de Próximo';
    return (ne.compareDocumentPosition(ll) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'debajo de la barra' : 'encima';
  });
  ok(orden !== 'sin barra' && orden !== 'encima', 'y en su sitio', orden);
  await p.screenshot({ path: captura('llego-antes.png') });

  titulo('HOLGADO');
  await preguntar();
  b = await barra();
  ok(/Holgado/.test(b.b || ''), 'a 1,5 km y con una hora, sobra tiempo', b.b);
  ok(/bien/.test(b.clase), 'y se pinta en verde', b.clase);
  ok(/km|m ·/.test(b.sub || '') && /~\d+ min/.test(b.sub || ''),
    'diciendo la distancia y el tiempo del tramo', b.sub);
  ok(/quedan/.test(b.sub || ''), 'y cuánto queda para la hora', b.sub);
  ok(b.boton === 'Actualizar', 'el botón pasa a "Actualizar"', b.boton);
  await p.screenshot({ path: captura('llego-bien.png') });

  titulo('JUSTO');
  await poner(20, 6.68, -73.28);          // ~11 km, en veinte minutos
  await sleep(p, 2200);
  await preguntar();
  b = await barra();
  ok(/Justo|Vas/.test(b.b || ''), 'a 11 km y con veinte minutos, ya no sobra', b.b);
  ok(/justo|mal/.test(b.clase), 'y se avisa con color', b.clase);

  titulo('VAS TARDE');
  await poner(2, 6.75, -73.35);           // lejos, en dos minutos
  await sleep(p, 2200);
  await preguntar();
  b = await barra();
  ok(/Vas .* tarde/.test(b.b || ''), 'lo dice sin rodeos', b.b);
  ok(/mal/.test(b.clase), 'en rojo', b.clase);
  await p.screenshot({ path: captura('llego-mal.png') });

  titulo('SIN HORA, SOLO LA DISTANCIA');
  await p.evaluate(async () => {
    const x = await DB.get('planning_items', 'prox-1'); x.time = null; await DB.put('planning_items', x);
    await Router.render();
  });
  await sleep(p, 2000);
  const sinHora = await p.evaluate(() => !!document.querySelector('.llego'));
  if (sinHora) {
    await preguntar();
    b = await barra();
    ok(/^A \d/.test(b.b || ''), 'sin hora no hay veredicto, solo la distancia', b.b);
    ok(!/quedan/.test(b.sub || ''), 'y no se inventa un "quedan"', b.sub);
  } else {
    ok(true, 'sin hora no hay "próximo evento" y la barra tampoco sale', '(no aplica)');
  }

  titulo('SIN COORDENADAS NO SE OFRECE');
  await poner(60, null, null);
  await sleep(p, 2200);
  ok(!(await barra()).hay, 'una parada sin coordenadas no tiene a dónde medir');

  titulo('SIN PERMISO LO DICE');
  // Quitar el permiso del contexto no basta: `maximumAge: 60000` deja reusar
  // una posición de hace menos de un minuto, que es lo que queremos que haga.
  // Así que se provoca el fallo en la propia API.
  await poner(60, 6.61, -73.21);
  await sleep(p, 2200);
  await p.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (_ok, err) => err({ code: 1, message: 'denied' });
  });
  await p.evaluate(() => document.querySelector('.llego button').click());
  await sleep(p, 1200);
  let err = await p.evaluate(() => [...document.querySelectorAll('.llego-txt span')].map((x) => x.textContent).join(' '));
  ok(/permiso/i.test(err), 'se explica el permiso denegado en vez de quedarse callada', err);

  await p.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (_ok, e) => e({ code: 3, message: 'timeout' });
  });
  await p.evaluate(() => document.querySelector('.llego button').click());
  await sleep(p, 1200);
  err = await p.evaluate(() => [...document.querySelectorAll('.llego-txt span')].map((x) => x.textContent).join(' '));
  ok(/no se ha podido/i.test(err), 'y cualquier otro fallo, también', err);

  titulo('NADA SALE DEL DISPOSITIVO');
  const fuera = await p.evaluate(() => (window.__enviados || []).length);
  ok(fuera === 0, 'la ubicación no se guarda ni se manda a ningún sitio', String(fuera));

  terminar(errs);
  await cerrar();
})();
