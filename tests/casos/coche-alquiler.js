/* Un coche de alquiler dura días, como un hotel.
 *
 * Y sin embargo solo aparecía el día de recogerlo: los días siguientes no
 * sabías que lo tenías, y el de devolverlo no salía en ninguna parte. Se expande
 * igual que un alojamiento —mismo mecanismo de filas virtuales— en una fila
 * discreta "Coche alquilado" los días de en medio y una "Devolución" con su
 * hora el último. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir({ abrir: false });

  titulo('SE EXPANDE COMO UN ALOJAMIENTO');
  const exp = await p.evaluate(async () => {
    await DB.put('planning_items', {
      id:'coche-demo', trip_id:'trip-demo-1', profile:dataProfile(), type:'coche',
      title:'Coche Yucatán', status:'confirmado', order_index:0,
      day_date: window.__dias.inicio,
      consultation_planned_d1: window.__dias.inicio, consultation_planned_t1:'10:00',
      consultation_planned_d2: window.__dias.fin,    consultation_planned_t2:'18:30',
      metadata:{ compania:'Hertz', modelo:'Toyota Aygo', matricula:'1234 ABC',
                 lugar_recogida:'Aeropuerto MID', lugar_devolucion:'Aeropuerto CUN' },
    });
    const raw = (await DB.listByTrip('planning_items', 'trip-demo-1')).filter((x) => !x.deleted_at);
    return TripDetail._expandHotels(raw).filter((x) => x.id === 'coche-demo')
      .map((x) => ({ d: x.day_date, v: x._virtual || 'real', t: x.time || null }));
  });
  const d = await p.evaluate(() => window.__dias);
  ok(exp.length === 9, 'del día de recogida al de devolución hay nueve filas', `${exp.length}`);
  ok(exp[0].v === 'real' && exp[0].d === d.inicio,
    'la primera es el registro de verdad, el que se edita', exp[0]);
  ok(exp[exp.length - 1].v === 'return' && exp[exp.length - 1].d === d.fin,
    'y la última, la devolución, el día que toca', exp[exp.length - 1]);
  ok(exp[exp.length - 1].t === '18:30', 'con su hora', exp[exp.length - 1].t);
  ok(exp.slice(1, -1).every((x) => x.v === 'rental' && !x.t),
    'las de en medio son "coche alquilado" y no llevan hora', exp.slice(1, -1).map((x) => x.v));
  // Un solo día (recogida y devolución el mismo) no genera nada: no hay "en medio".
  const unDia = await p.evaluate(async () => {
    const x = await DB.get('planning_items', 'coche-demo');
    const copia = { ...x, id:'coche-1dia', consultation_planned_d2: x.consultation_planned_d1 };
    return TripDetail._expandHotels([copia]).length;
  });
  ok(unDia === 1, 'recoger y devolver el mismo día se queda en una sola fila', `${unDia}`);

  titulo('EL DÍA DE EN MEDIO');
  await p.evaluate(() => Router.go('trip', { tripId:'trip-demo-1', tab:'planning' }));
  await sleep(p, 2500);
  const filasDe = async (dia) => {
    await p.evaluate((x) => TripDetail._irADia(x), dia);
    await sleep(p, 1500);
    return p.evaluate((x) => {
      const pag = document.querySelector(`.plan-page[data-day="${x}"]`);
      const caja = (n) => Math.round(n.getBoundingClientRect().height);
      return [...pag.querySelectorAll('.timeline-item')].map((n, i) => ({
        i,
        tit: (n.querySelector('.li-title-text, .dr-t')?.textContent) || null,
        kick: n.querySelector('.mk-t')?.textContent || null,
        sub: (n.querySelector('.li-sub, .li-subrow, .dr-s')?.textContent || '').trim(),
        hora: n.querySelector('.li-time-a')?.textContent || null,
        emoji: (n.querySelector('.item-emoji, .li-out span, .dr-ic')?.textContent || '').trim(),
        virtual: n.classList.contains('virtual'),
        banda: n.classList.contains('li-drive'),
        alto: caja(n),
        arrastrable: n.getAttribute('draggable'),
      }));
    }, dia);
  };
  let filas = await filasDe(d.hoy);
  const coche = filas.find((f) => f.tit === 'Coche alquilado');
  ok(!!coche, 'sale la fila del coche', filas.map((f) => f.tit));
  ok(coche.emoji === '🚗', 'con el icono del coche al lado', coche.emoji);
  ok(/Día 4 de 9/.test(coche.sub), 'y diciendo por qué día del alquiler va', coche.sub);
  ok(/Coche Yucatán/.test(coche.sub), 'y de qué coche habla', coche.sub);
  ok(coche.virtual && coche.arrastrable === 'false',
    'es una fila derivada: ni se arrastra ni se toca (las fechas las pone el registro)', coche);
  await p.screenshot({ path: captura('coche-medio.png') });

  titulo('ES UNA BANDA, NO UNA PARADA');
  // Hermana de la franja del hotel al pie del día, pero arriba y en una sola
  // línea: no es algo que hacer, solo el recordatorio de que hoy tienes coche.
  ok(coche.banda, 'se dibuja como banda (.li-drive), no como tarjeta', coche.banda);
  ok(coche.i === 0, 'la primera del día, pegada a la cabecera', `posición ${coche.i}`);
  const otras = filas.filter((f) => !f.banda).map((f) => f.alto);
  ok(coche.alto < 45 && otras.every((h) => h > coche.alto),
    'y más fina que cualquier parada de verdad', { banda: coche.alto, resto: otras });
  const unaLinea = await p.evaluate(() => {
    const b = document.querySelector('.li-drive');
    const t = b.querySelector('.dr-t').getBoundingClientRect();
    const sb = b.querySelector('.dr-s').getBoundingClientRect();
    return Math.abs(t.bottom - sb.bottom) < 2;
  });
  ok(unaLinea, 'el título y el detalle van en la misma línea', String(unaLinea));

  titulo('NO REPITE LOS DATOS DEL COCHE');
  // El repaso de metadata del tipo (compañía, modelo, matrícula) es para la fila
  // de verdad; en las copias sobraba y dejaba un subtítulo kilométrico.
  ok(!/Hertz|Toyota|1234/.test(coche.sub), 'la compañía y la matrícula no van aquí', coche.sub);

  titulo('EL DÍA DE LA DEVOLUCIÓN');
  filas = await filasDe(d.fin);
  const dev = filas.find((f) => f.kick === 'Devolución');
  ok(!!dev, 'sale la devolución, con su rótulo', filas.map((f) => f.kick));
  ok(dev.tit === 'Coche Yucatán', 'titulada con el coche, como el check-out con el hotel', dev.tit);
  ok(/18:30/.test(dev.sub), 'con la hora de devolver', dev.sub);
  ok(/Aeropuerto CUN/.test(dev.sub) && /Hertz/.test(dev.sub),
    'y dónde y a quién se devuelve', dev.sub);
  await p.screenshot({ path: captura('coche-devolucion.png') });

  titulo('EDITAR DESDE UNA COPIA TOCA EL REGISTRO DE VERDAD');
  // Una fila virtual es una COPIA con el mismo id: el editor tiene que volver a
  // las fechas del alquiler, no quedarse con el día de la copia.
  await p.evaluate(async () => {
    const raw = (await DB.listByTrip('planning_items', 'trip-demo-1')).filter((x) => !x.deleted_at);
    const copia = TripDetail._expandHotels(raw).find((x) => x._virtual === 'rental');
    const t = await DB.get('trips', 'trip-demo-1');
    await TripDetail.openPlanningEditor(t, copia);
  });
  await sleep(p, 1500);
  const ed = await p.evaluate(() => ({
    d1: document.getElementById('tr-d1')?.value, t1: document.getElementById('tr-t1')?.value,
    d2: document.getElementById('tr-d2')?.value, t2: document.getElementById('tr-t2')?.value,
  }));
  ok(ed.d1 === d.inicio && ed.d2 === d.fin,
    'el editor abre con las fechas del alquiler, no con el día de la copia', ed);
  ok(ed.t1 === '10:00' && ed.t2 === '18:30', 'y con sus horas', ed);
  await p.evaluate(() => UI.closeSheet()); await sleep(p, 600);

  titulo('HORA DE RECOGIDA Y DE DEVOLUCIÓN');
  // Un alquiler no se recoge "el martes": se recoge el martes A LAS 10:30, y la
  // hora de devolverlo es justo el dato que hace falta el último día.
  await p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    await TripDetail.openPlanningEditor(t, null, { day: window.__dias.inicio });
  });
  await sleep(p, 900);
  await p.evaluate(() => [...document.querySelectorAll('.wz-cell')].find((x) => /Otro transporte/.test(x.textContent)).click());
  await sleep(p, 700);
  await p.evaluate(() => [...document.querySelectorAll('.wz-cell')].find((x) => /Coche de alquiler/.test(x.textContent)).click());
  await sleep(p, 1200);
  const campos = await p.evaluate(() => {
    const vis = (n) => !!(n && n.checkVisibility());
    return {
      titulo: document.querySelector('#dates-block .grupo-tit')?.textContent,
      subLbl: [...document.querySelectorAll('#dates-block .sub-lbl')].map((x) => x.textContent),
      t1: vis(document.getElementById('tr-t1')), t2: vis(document.getElementById('tr-t2')),
      tipoT1: document.getElementById('tr-t1')?.type,
    };
  });
  ok(campos.t1 && campos.t2 && campos.tipoT1 === 'time',
    'el editor pide las dos horas', campos);
  ok(JSON.stringify(campos.subLbl) === '["Recogida","Hora","Devolución","Hora"]',
    'cada una al lado de su fecha', campos.subLbl);
  ok(campos.titulo === 'Alquiler', 'bajo su propia cabecera', campos.titulo);

  titulo('EL SITIO Y LA FECHA NO SE LLAMAN IGUAL');
  // El par de arriba son los LUGARES y el de abajo las FECHAS. Con "Recogida" en
  // los dos, una encima de otra, no se sabía cuál era cuál.
  const etiquetas = await p.evaluate(() => {
    const f = document.querySelector('.wz-step.on');
    return [...f.querySelectorAll('#ruta-block label')].map((l) => ({
      txt: l.textContent, lineas: Math.round(l.getBoundingClientRect().height / 18) }));
  });
  ok(etiquetas.map((e) => e.txt).join(' → ') === 'Lugar de recogida → Lugar de devolución',
    'los de arriba dicen que son el sitio', etiquetas.map((e) => e.txt));
  ok(etiquetas.every((e) => e.lineas === 1), 'y caben en una línea', etiquetas);

  titulo('SE GUARDAN Y VUELVEN');
  await p.evaluate((d) => {
    const set = (id, v) => { const n = document.getElementById(id); n.value = v; n.dispatchEvent(new Event('change')); };
    set('tr-d1', d.inicio); set('tr-t1', '10:30');
    set('tr-d2', d.fin);    set('tr-t2', '18:45');
    const tit = document.getElementById('f-title'); tit.value = 'Coche Mérida'; tit.dispatchEvent(new Event('change'));
  }, d);
  await p.evaluate(() => [...document.querySelectorAll('#sheet-foot button')].find((b) => /Guardar/.test(b.textContent)).click());
  await sleep(p, 1200);
  await p.evaluate(() => document.getElementById('ew-discard')?.click());
  await sleep(p, 2200);
  const nuevo = await p.evaluate(async () => {
    const all = (await DB.listByTrip('planning_items', 'trip-demo-1'))
      .filter((x) => !x.deleted_at && x.title === 'Coche Mérida');
    const x = all[0];
    return x && { id: x.id, t1: x.consultation_planned_t1, t2: x.consultation_planned_t2, time: x.time };
  });
  ok(nuevo && nuevo.t1 === '10:30' && nuevo.t2 === '18:45', 'las dos horas se guardan', nuevo);
  ok(nuevo.time === '10:30', 'y la de recogida es la hora de la parada, la que ordena el día', nuevo.time);

  titulo('LA FICHA LO CUENTA CON SUS PALABRAS');
  await p.evaluate(async (id) => {
    const t = await DB.get('trips', 'trip-demo-1');
    TripDetail.openPlanningDetail(t, await DB.get('planning_items', id));
  }, nuevo.id);
  await sleep(p, 1400);
  const ficha = await p.evaluate(() => {
    const b = [...document.querySelectorAll('.dv-block')].find((x) => x.dataset.bloque === 'cuando');
    return [...b.querySelectorAll('.dv-row')].map((r) =>
      [r.querySelector('.dv-l')?.textContent, r.querySelector('.dv-v')?.textContent]);
  });
  const dic = Object.fromEntries(ficha);
  // Un coche ni sale ni llega: se recoge y se devuelve.
  ok(dic['Recogida'] && /10:30/.test(dic['Recogida']), 'la recogida, con su hora', ficha);
  ok(dic['Devolución'] && /18:45/.test(dic['Devolución']), 'la devolución, con la suya', ficha);
  ok(!dic['Salida'] && !dic['Llegada'], 'y ni "Salida" ni "Llegada", que son de un vuelo', Object.keys(dic));
  ok(dic['Días'] === '9', 'y cuántos días es, contando los dos extremos', dic['Días']);
  await p.screenshot({ path: captura('coche-ficha.png') });
  await p.evaluate(() => document.querySelector('.detailview .flash-close')?.click());
  await sleep(p, 800);

  titulo('Y EL RESUMEN TAMBIÉN');
  // Sin esto el coche no tenía resumen: las horas no llegaban ni a la pastilla
  // del resumen ni al globo del mapa del día.
  const res = await p.evaluate(async (id) => {
    const x = await DB.get('planning_items', id);
    const uno = TripDetail._reservationSummary(x);
    const dev = TripDetail._reservationSummary({ ...x, _virtual:'return' });
    return { uno, dev };
  }, nuevo.id);
  ok(res.uno && res.uno.label === 'Coche de alquiler' && /10:30/.test(res.uno.sub),
    'el día de recogerlo enseña la hora de recogida', res.uno);
  ok(res.dev && res.dev.label === 'Devolución del coche' && /18:45/.test(res.dev.sub),
    'y el de devolverlo, la de devolución, no la de hace ocho días', res.dev);

  titulo('LAS COPIAS NO CUENTAN COMO PARADA');
  const cuenta = await p.evaluate((dia) => {
    const pag = document.querySelector(`.plan-page[data-day="${dia}"]`);
    return pag?.querySelector('.day-meta-row, .day-head')?.textContent || '';
  }, d.hoy);
  ok(!/2 paradas/.test(cuenta), 'el día no se apunta el coche como una parada más', cuenta.trim().slice(0, 60));

  terminar(errs);
  await cerrar();
})();
