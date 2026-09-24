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

  titulo('EL DÍA SALE DEL CARRUSEL, NO DE `_diaVisible`');
  // Al entrar al viaje desde fuera, `_diaVisible` se pone a null a propósito, y
  // se rellena cuando el deslizamiento se asienta. En ese hueco la parada nueva
  // se iba al primer día del viaje aunque estuvieras mirando el quinto.
  const sinMarca = await p.evaluate(async () => {
    TripDetail._diaVisible = null;
    const k = TripDetail._diaActual();
    const t = await DB.get('trips', 'trip-demo-1');
    await TripDetail.openPlanningEditor(t, null, { day: TripDetail._diaActual() });
    return { carrusel: k, propuesto: document.getElementById('f-day')?.value };
  });
  await sleep(p, 900);
  const sinMarcaDia = await p.evaluate(() => document.getElementById('f-day')?.value);
  ok(sinMarca.carrusel === dias.pasado,
    'sin `_diaVisible`, el carrusel sigue sabiendo qué día se ve', sinMarca);
  ok(sinMarcaDia === dias.pasado && sinMarcaDia !== dias.inicio,
    'y la parada nueva cae ahí, no en el primer día del viaje',
    { propuesto: sinMarcaDia, inicio: dias.inicio });
  await cerrarHoja();

  titulo('LA HORA QUE SE PROPONE: 15 MIN DESPUÉS DE LO ÚLTIMO');
  // D+1 acaba con la cena de 19:30 a 21:00.
  await p.evaluate((d) => TripDetail._irADia(d), dias.manana);
  await sleep(p, 1600);
  await abrirDesdeElFab(); await sleep(p, 800);
  await celda('Lugar'); await sleep(p, 900);
  const sug = await p.evaluate(() => ({
    dia: document.getElementById('f-day')?.value,
    hora: document.getElementById('f-time')?.value,
    aviso: [...document.querySelectorAll('#dates-block .field-hint')].map((x) => x.textContent).join(' '),
  }));
  ok(sug.hora === '21:15',
    'la última del día acaba a las 21:00, así que propone las 21:15', sug);
  ok(/15 min después/.test(sug.aviso), 'y dice de dónde sale esa hora', sug.aviso);
  await cerrarHoja();

  // Un día vacío no tiene nada después de lo cual ponerse.
  const vacio = await p.evaluate(async (d) => {
    const t = await DB.get('trips', 'trip-demo-1');
    await TripDetail.openPlanningEditor(t, null, { day: d });
    return document.getElementById('f-time')?.value;
  }, dias.antesDeAyer);
  await sleep(p, 900);
  ok(await p.evaluate(() => document.getElementById('f-time')?.value) === '',
    'en un día vacío no se inventa ninguna hora', JSON.stringify(vacio));
  await cerrarHoja();

  titulo('DÓNDE, TÍTULO Y LUEGO CUÁNDO');
  await abrirDesdeElFab(); await sleep(p, 800);
  await celda('Lugar'); await sleep(p, 900);
  const orden = await p.evaluate(() => {
    const paso = document.querySelector('.wz-step.on');
    const y = (n) => Math.round(n.getBoundingClientRect().top);
    const vis = [...paso.children].filter((n) => n.offsetParent && n.getBoundingClientRect().height > 0);
    return {
      bloques: vis.map((n) => n.id || n.className.split(' ')[0]),
      donde: y(document.getElementById('place-block')),
      titulo: y(document.getElementById('title-row')),
      cuando: y(document.getElementById('dates-block')),
      // La duración y el modo de llegada bajan a "Más": se tocan una vez de
      // cada veinte y ocupaban media pantalla del camino corto. Se pregunta con
      // `checkVisibility()`, que es lo único que responde bien dentro de un
      // <details> cerrado: ni `offsetParent` ni el alto del rectángulo lo hacen.
      duracion: (() => {
        const d = document.getElementById('f-duration');
        const sec = d && d.closest('.wz-sec');
        return { seVe: !!d && d.checkVisibility(),
                 seccion: sec?.querySelector('.wz-sec-t')?.textContent, abierta: !!sec?.open };
      })(),
    };
  });
  ok(orden.donde < orden.titulo && orden.titulo < orden.cuando,
    'el orden es dónde → título → fecha y hora', orden);
  ok(orden.duracion.seccion === 'Más' && !orden.duracion.abierta && !orden.duracion.seVe,
    'y la duración de la visita baja a "Más", plegada, sin ocupar el camino corto', orden.duracion);

  titulo('LA CABECERA, ARRIBA DEL TODO');
  const cab = await p.evaluate(() => {
    const h = document.querySelector('.sheet-header').getBoundingClientRect();
    const s = document.querySelector('.sheet').getBoundingClientRect();
    const b = document.querySelector('.sheet-body').getBoundingClientRect();
    return { desdeArriba: Math.round(h.top - s.top), encimaDelCuerpo: Math.round(b.top - h.bottom) };
  });
  ok(cab.desdeArriba < 30 && cab.encimaDelCuerpo >= 0,
    'la cabecera va pegada arriba y el cuerpo empieza debajo, no detrás', cab);
  await cerrarHoja();

  titulo('EL DÍA DE FIN, IGUAL AL DE INICIO');
  await abrirDesdeElFab(); await sleep(p, 800);
  await celda('Tren'); await sleep(p, 900);
  const rango = await p.evaluate(() => ({
    d1: document.getElementById('tr-d1')?.value,
    d2: document.getElementById('tr-d2')?.value,
  }));
  ok(/^\d{4}-\d{2}-\d{2}$/.test(rango.d1) && rango.d2 === rango.d1,
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

  titulo('EL ENLACE SE PEGA DESDE EL PROPIO CAMPO, Y SE VE QUE SE PUEDE');
  await abrirDesdeElFab(); await sleep(p, 800);
  await celda('Coche'); await sleep(p, 1000);
  const enSeco = await p.evaluate(() => {
    const bs = [...document.querySelectorAll('.ruta-punto')];
    return {
      botones: bs.length,
      visibles: bs.filter((b) => b.offsetParent && b.getBoundingClientRect().width > 0).length,
      texto: bs.map((b) => b.textContent.trim()),
      icono: bs.every((b) => !!b.querySelector('svg')),
      aviso: document.querySelector('.tramo-aviso')?.textContent || '',
      etiquetas: [...document.querySelectorAll('#ruta-block label')].map((x) => x.textContent),
    };
  });
  ok(enSeco.botones === 2 && enSeco.visibles === 2,
    'origen y destino llevan su botón de enlace A LA VISTA, sin punto todavía', enSeco);
  ok(enSeco.texto.join('/') === 'enlace/enlace' && enSeco.icono,
    'con el icono del mapa y la palabra, no un emoji escondido', enSeco.texto);
  ok(/Google Maps/.test(enSeco.aviso), 'y debajo dice para qué sirve', enSeco.aviso);
  ok(enSeco.etiquetas.join('/') === 'Origen/Destino',
    'el botón no se cuela en el nombre del campo', enSeco.etiquetas);

  // Pegar de verdad en los dos extremos: Mérida → Chichén Itzá.
  const pegarEn = (campo, url) => p.evaluate(([c, u]) => {
    const i = document.getElementById('meta-' + c);
    i.value = u;
    i.dispatchEvent(new Event('paste'));
  }, [campo, url]);
  await pegarEn('origen', 'https://www.google.com/maps/place/Mérida,+Yuc.,+México/@20.9674,-89.5926,13z/data=!4m2!3m1!1s0x0:0x0!8m2!3d20.9674!4d-89.5926');
  await sleep(p, 900);
  await pegarEn('destino', 'https://www.google.com/maps/place/97751+Chichén+Itzá,+Yuc.,+México/@20.6829,-88.5686,17z/data=!4m2!3m1!1s0x0:0x0!8m2!3d20.6829!4d-88.5686');
  await sleep(p, 1400);
  const pegados = await p.evaluate(() => ({
    campos: ['origen', 'destino'].map((c) => document.getElementById('meta-' + c).value),
    puestos: [...document.querySelectorAll('.ruta-punto.puesto')].length,
    texto: [...document.querySelectorAll('.ruta-punto')].map((b) => b.textContent.trim()),
    aviso: document.querySelector('.tramo-aviso')?.textContent || '',
    pruebas: [...document.querySelectorAll('.ruta-prueba')]
      .filter((x) => x.offsetParent)
      .map((x) => ({ coords: x.querySelector('.rp-coords').textContent, ver: x.querySelector('.rp-ver').href })),
  }));
  ok(pegados.campos[0] === 'Mérida' && pegados.campos[1] === 'Chichén Itzá',
    'en el campo queda el nombre del sitio, no la URL de Google', pegados.campos);
  ok(pegados.puestos === 2 && pegados.texto.join('/') === 'ubicado/ubicado',
    'los dos botones dicen que ya tienen ubicación', pegados);
  ok(/🚗/.test(pegados.aviso) && /cuenta en el total del día/.test(pegados.aviso),
    'y sale el tiempo del trayecto, diciendo que cuenta en el día', pegados.aviso);
  // "Ubicado" a secas no dice a dónde: el enlace pegado en el campo equivocado
  // se veía igual de verde que el correcto.
  ok(pegados.pruebas.length === 2
    && pegados.pruebas[0].coords === '20.9674, -89.5926'
    && pegados.pruebas[1].coords === '20.6829, -88.5686',
    'cada extremo enseña las coordenadas a las que ha ido a parar', pegados.pruebas);
  ok(pegados.pruebas.every((x) => /google\.com\/maps/.test(x.ver)),
    'con su enlace para abrirlo y comprobarlo', pegados.pruebas.map((x) => x.ver));
  // La flecha va entre los dos campos. Con la línea de coordenadas debajo se
  // iba a la altura de las coordenadas, que no separa nada.
  const flecha = await p.evaluate(() => {
    const c = (n) => { const b = n.getBoundingClientRect(); return b.top + b.height / 2; };
    const f = document.querySelector('.ruta-flecha');
    const ins = [...document.querySelectorAll('#ruta-block input')];
    return { desvio: Math.round(c(f) - (c(ins[0]) + c(ins[1])) / 2) };
  });
  ok(Math.abs(flecha.desvio) <= 8, 'y la flecha sigue entre los dos campos',
    flecha.desvio + ' px de desvío');
  await p.screenshot({ path: captura('parada-nueva-coche.png') });

  // El mismo botón quita el punto: es lo único que puede deshacerlo.
  await p.evaluate(() => document.querySelectorAll('.ruta-punto')[1].click());
  await sleep(p, 500);
  const quitado = await p.evaluate(() => ({
    puestos: [...document.querySelectorAll('.ruta-punto.puesto')].length,
    aviso: document.querySelector('.tramo-aviso')?.textContent || '',
    campo: document.getElementById('meta-destino').value,
  }));
  ok(quitado.puestos === 1 && /Falta el otro extremo/.test(quitado.aviso),
    'pulsarlo otra vez quita esa ubicación y lo dice', quitado);
  ok(quitado.campo === 'Chichén Itzá', 'pero el nombre escrito se queda', quitado.campo);
  ok(await p.evaluate(() => [...document.querySelectorAll('.ruta-prueba')].filter((x) => x.offsetParent).length) === 1,
    'y su línea de coordenadas se va con él');
  await cerrarHoja();

  titulo('EL HORARIO, UNA LÍNEA POR DATO');
  await abrirDesdeElFab(); await sleep(p, 800);
  await celda('Coche'); await sleep(p, 1000);
  const horario = await p.evaluate(() => {
    const filas = [...document.querySelectorAll('.fecha-hora')];
    const y = (n) => { const b = n.getBoundingClientRect(); return Math.round(b.top + b.height / 2); };
    const r = filas[0];
    return {
      filas: filas.length,
      etiquetas: filas.map((f) => f.querySelector('.sub-lbl').textContent),
      // Los tres centrados a la misma altura: una línea, no tres. Se compara el
      // centro y no el borde de arriba, que la etiqueta es más baja que el input
      // y va centrada dentro de la fila.
      enLinea: r ? [...r.querySelectorAll('.sub-lbl, input[type=date], input[type=time]')]
        .map(y).every((v, _, a) => Math.abs(v - a[0]) <= 2) : false,
      borrarVisible: [...document.querySelectorAll('.time-clear')].filter((b) => b.offsetParent).length,
      alto: r ? Math.round(r.getBoundingClientRect().height) : 0,
    };
  });
  ok(horario.filas === 2 && horario.etiquetas.join('/') === 'Salida/Llegada',
    'dos filas y dos etiquetas: se acabó el "Hora" repetido sin decir de qué', horario.etiquetas);
  ok(horario.enLinea && horario.alto < 60,
    'etiqueta, fecha y hora en la misma línea', horario.alto + ' px de alto');
  ok(horario.borrarVisible === 0,
    'y sin horas puestas, ningún botón de borrar la hora ocupando sitio', horario.borrarVisible);
  await p.evaluate(() => {
    const t = document.getElementById('tr-t1');
    t.value = '09:30'; t.dispatchEvent(new Event('input'));
  });
  await sleep(p, 400);
  ok(await p.evaluate(() => [...document.querySelectorAll('.time-clear')].filter((b) => b.offsetParent).length) === 1,
    'aparece en cuanto hay una hora que borrar');
  await cerrarHoja();

  titulo('EL RESUMEN DEL DÍA SE COLOCA AUNQUE LA LISTA TARDE EN COLGARSE');
  // `_dayListEl` devuelve la lista y quien llama la cuelga DESPUÉS. Aquí se
  // retrasa ese enganche a propósito: con el carrusel montando páginas y el hilo
  // ocupado —justo al volver de guardar— pasa de verdad, y el total del día se
  // quedaba sin aparecer hasta recargar la página.
  const tarde = await p.evaluate(async (d) => {
    const t = await DB.get('trips', 'trip-demo-1');
    const its = (await DB.listByTrip('planning_items', 'trip-demo-1'))
      .filter((x) => x.day_date === d && !x.deleted_at);
    // Un contenedor con la misma forma que una página del carrusel.
    const pag = el('div', { class:'plan-page', data:{ day:d } }, [
      el('div', { class:'day-group', data:{ day:d } }, [
        el('div', { class:'day-head' }, [ el('div', { class:'day-meta-row' }) ]),
      ]),
    ]);
    const lista = TripDetail._dayListEl(t, d, its, { todayStr: todayIso(), renderToken: {} });
    const g = pag.querySelector('.day-group');
    document.body.appendChild(pag);
    const leer = () => {
      const s = pag.querySelector('.day-route-summary');
      return { hay: !!s, enMeta: !!s?.closest('.day-meta-row'), txt: s?.textContent || '' };
    };
    const antes = leer();
    // 20 fotogramas después: mucho más de lo que esperaba el código viejo.
    await new Promise((res) => {
      let n = 0;
      const tic = () => (++n < 20 ? requestAnimationFrame(tic) : res());
      requestAnimationFrame(tic);
    });
    g.appendChild(lista);
    await new Promise((res) => setTimeout(res, 600));
    const despues = leer();
    pag.remove();
    return { antes, despues };
  }, dias.ayer);
  ok(!tarde.antes.hay, 'antes de colgarla no hay resumen, como debe ser', tarde.antes);
  ok(tarde.despues.hay && tarde.despues.enMeta,
    'al colgarla, el resumen aparece en la fila del día sin recargar nada', tarde.despues);
  ok(/🚗/.test(tarde.despues.txt) && /min/.test(tarde.despues.txt),
    'y con el tiempo de trayectos ya calculado', tarde.despues.txt);

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

  titulo('EL AVISO DE "PUEDE ESTAR CERRADO" NO SE CONFUNDE CON EL DEL GASTO');
  // Los dos son un ⚠️. Estando en la misma fila del subtítulo, no había manera
  // de saber cuál de los dos te hablaba. El del horario se va a la hora, que es
  // justo de lo que avisa.
  await p.evaluate(async (d) => {
    // OSM de mentira: cerrado siempre, para no depender de Overpass.
    window.fetchOpeningHours = async () => 'Mo-Su 09:00-10:00';
    window.ohIsOpen = () => false;
    const its = (await DB.listByTrip('planning_items', 'trip-demo-1'))
      .filter((x) => x.day_date === d && x.time && !x.deleted_at);
    const x = its[0];
    x.lat = 6.6357; x.lng = -73.2264; x.expense_reminder = true;   // los dos avisos a la vez
    await DB.put('planning_items', x);
    await Router.render();
    return x.id;
  }, dias.manana);
  await p.evaluate((d) => TripDetail._irADia(d), dias.manana);
  await sleep(p, 2000);
  // El repaso de horarios corre al pintar; el día se acaba de montar, así que se
  // le pide otra vez sobre lo que hay ahora en pantalla.
  await p.evaluate(async (d) => {
    const its = await DB.listByTrip('planning_items', 'trip-demo-1');
    const byId = {}; its.forEach((x) => { byId[x.id] = x; });
    const g = [...document.querySelectorAll('.day-group')].find((x) => x.dataset.day === d);
    await TripDetail._checkVisibleOpeningHours(g.closest('.plan-page') || document, byId);
  }, dias.manana);
  await sleep(p, 1200);
  const avisos = await p.evaluate(() => {
    const w = document.querySelector('.oh-warn');
    if (!w) return null;
    const card = w.closest('.timeline-item');
    const gasto = card.querySelector('.expense-warn-flag, .tk-warn');
    const r = (n) => n.getBoundingClientRect();
    return {
      enLaHora: !!w.closest('.li-time'),
      enElSubtitulo: !!w.closest('.li-subrow'),
      hayGasto: !!gasto,
      gastoEnLaHora: gasto ? !!gasto.closest('.li-time') : null,
      separados: gasto ? Math.round(Math.abs(r(w).left - r(gasto).left)) : null,
    };
  });
  ok(avisos, 'el aviso de horario aparece', JSON.stringify(avisos));
  ok(avisos.enLaHora && !avisos.enElSubtitulo,
    'y va pegado a la hora, no en la fila del subtítulo', avisos);
  ok(avisos.hayGasto && !avisos.gastoEnLaHora && avisos.separados > 40,
    'mientras el del gasto se queda donde estaba, bien lejos del otro', avisos);
  await p.screenshot({ path: captura('parada-nueva-avisos.png') });

  terminar(errs);
  await cerrar();
})();
