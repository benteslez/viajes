/* El editor de una parada: dos pasos al crear, uno solo al editar, y lo raro
 * plegado. Lo que más importa aquí es que plegar NO pierda datos: los campos
 * siguen en el DOM dentro de un <details> cerrado y `collect()` los lee igual. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir();

  const abrirNueva = () => p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    await TripDetail.openPlanningEditor(t, null, { day: window.__dias.hoy });
  });
  const abrirExistente = (id) => p.evaluate(async (id) => {
    const t = await DB.get('trips', 'trip-demo-1');
    const x = await DB.get('planning_items', id);
    await TripDetail.openPlanningEditor(t, x);
  }, id);
  const celda = (txt) => p.evaluate((txt) => {
    const c = [...document.querySelectorAll('.wz-cell')].find((x) => x.textContent.includes(txt));
    if (!c) return false; c.click(); return true;
  }, txt);
  const estado = () => p.evaluate(() => {
    const paso = document.querySelector('.wz-step.on');
    const b = document.querySelector('#sheet-body');
    return {
      paso: paso?.dataset.step,
      pasos: document.querySelectorAll('.wz-bar i').length,
      pestanas: document.querySelectorAll('.wz-tab').length,
      chip: document.querySelector('.wz-chip b')?.textContent,
      tipo: document.getElementById('f-type')?.value,
      modo: null,
      pantallas: +(b.scrollHeight / b.clientHeight).toFixed(2),
      secciones: [...paso.querySelectorAll('.wz-sec')].map((d) => ({
        t: d.querySelector('.wz-sec-t').textContent, sub: d.querySelector('.wz-sec-s')?.textContent, abierta: d.open })),
      pie: [...document.querySelectorAll('#sheet-foot button')].filter((x) => x.offsetParent).map((x) => x.textContent.trim()),
    };
  });
  // Guardar una parada NUEVA sin importe abre el aviso de "no has puesto gasto"
  // con tres botones; aquí se descarta para seguir.
  const guardar = async () => {
    await p.evaluate(() => [...document.querySelectorAll('#sheet-foot button')]
      .find((x) => /^Guardar$/.test(x.textContent.trim())).click());
    await sleep(p, 900);
    const avisando = await p.evaluate(() => {
      const w = document.getElementById('f-expense-warn');
      return !!(w && w.style.display === 'block' && w.getBoundingClientRect().height > 0);
    });
    if (avisando) { await p.evaluate(() => document.getElementById('ew-discard').click()); }
    await sleep(p, 1400);
    return avisando;
  };

  titulo('CREAR: DOS PASOS');
  await abrirNueva(); await sleep(p, 900);
  let e = await estado();
  ok(e.paso === 'tipo', 'se abre eligiendo qué es', e.paso);
  ok(e.pasos === 2, 'el asistente tiene dos pasos, no seis', String(e.pasos));
  const celdas = await p.evaluate(() => [...document.querySelectorAll('.wz-cell')].map((x) => x.textContent));
  ok(celdas.some((x) => /Vuelo/.test(x)) && celdas.some((x) => /Tren/.test(x)) && celdas.some((x) => /Coche/.test(x)),
    'los medios de transporte están en la primera rejilla', celdas.length + ' celdas');
  await p.screenshot({ path: captura('ed-paso1.png') });

  await celda('Lugar'); await sleep(p, 900);
  e = await estado();
  ok(e.paso === 'form', 'un toque en el tipo lleva ya al formulario', e.paso);
  ok(e.chip === 'Lugar', 'y la pastilla de arriba dice qué se está creando', e.chip);
  ok(e.pantallas < 2.5, 'un lugar cabe en poco más de una pantalla', `${e.pantallas} pantallas`);
  ok(e.secciones.length === 2 && e.secciones.every((x) => !x.abierta),
    'con "Reserva y gasto" y "Más" plegados', e.secciones.map((x) => x.t).join(', '));
  await p.screenshot({ path: captura('ed-paso2.png') });

  titulo('LO PLEGADO NO SE PIERDE AL GUARDAR');
  // Se escribe DENTRO de las secciones cerradas: no se abren en ningún momento.
  await p.evaluate(() => {
    const set = (id, v) => { const n = document.getElementById(id); n.value = v; n.dispatchEvent(new Event('change')); };
    set('f-title', 'Parada de prueba');
    set('f-notes', 'una nota escondida');
    set('f-concept', 'Entradas');
    set('f-amount', '12.5');
  });
  const cerradasAlGuardar = await p.evaluate(() =>
    [...document.querySelectorAll('.wz-step.on .wz-sec')].every((d) => !d.open));
  ok(cerradasAlGuardar, 'las secciones siguen cerradas mientras se escribe en ellas');
  await guardar();
  const guardado = await p.evaluate(async () => {
    const its = await DB.listByTrip('planning_items', 'trip-demo-1');
    const x = its.find((i) => i.title === 'Parada de prueba' && !i.deleted_at);
    if (!x) return null;
    const bs = await DB.listByTrip('budget_items', 'trip-demo-1');
    const b = bs.find((y) => y.planning_item_id === x.id && !y.deleted_at);
    return { id: x.id, tipo: x.type, dia: x.day_date, notas: x.notes, gasto: b ? { c: b.concept, a: b.amount } : null };
  });
  ok(guardado, 'la parada se guarda', guardado && guardado.id);
  ok(guardado && guardado.notas === 'una nota escondida',
    'la nota escrita en la sección plegada se guarda', guardado && guardado.notas);
  ok(guardado && guardado.gasto && guardado.gasto.a === 12.5,
    'y el gasto escrito en la otra también', guardado && guardado.gasto);

  titulo('LOS MEDIOS, EN UN TOQUE');
  for (const [txt, tipoEsp, modoEsp] of [['Vuelo', 'vuelo', null], ['Tren', 'transporte', 'tren'], ['Coche', 'transporte', 'coche']]) {
    await abrirNueva(); await sleep(p, 800);
    await celda(txt); await sleep(p, 800);
    const r = await p.evaluate(() => ({
      tipo: document.getElementById('f-type').value,
      paso: document.querySelector('.wz-step.on')?.dataset.step,
      chip: document.querySelector('.wz-chip b')?.textContent,
    }));
    ok(r.tipo === tipoEsp && r.paso === 'form' && r.chip === txt,
      `"${txt}" deja el tipo listo sin pasar por otra pantalla`, `${r.tipo} · pastilla "${r.chip}"`);
    // Y el medio tiene que llegar a la base, no solo a la pastilla.
    await p.evaluate((n) => { const x = document.getElementById('f-title'); x.value = n; x.dispatchEvent(new Event('change')); }, `Medio ${txt}`);
    await guardar();
    const enBase = await p.evaluate(async (n) => {
      const its = await DB.listByTrip('planning_items', 'trip-demo-1');
      const x = its.find((i) => i.title === n && !i.deleted_at);
      return x ? { tipo: x.type, modo: (x.metadata || {}).modo || null } : null;
    }, `Medio ${txt}`);
    ok(enBase && enBase.tipo === tipoEsp && enBase.modo === modoEsp,
      `   …y se guarda como ${tipoEsp}${modoEsp ? '/' + modoEsp : ''}`, enBase);
  }

  titulo('EL AVISO DE GASTO SE VE AUNQUE CUELGUE DE UN PLIEGUE');
  await abrirNueva(); await sleep(p, 800);
  await celda('Actividad'); await sleep(p, 800);
  await p.evaluate(() => { const n = document.getElementById('f-title'); n.value = 'Sin gasto'; n.dispatchEvent(new Event('change')); });
  await p.evaluate(() => [...document.querySelectorAll('#sheet-foot button')]
    .find((x) => /^Guardar$/.test(x.textContent.trim())).click());
  await sleep(p, 900);
  const aviso = await p.evaluate(() => {
    const w = document.getElementById('f-expense-warn');
    return { alto: Math.round(w.getBoundingClientRect().height), seccion: !!w.closest('details')?.open };
  });
  ok(aviso.alto > 0 && aviso.seccion,
    'guardar sin gasto abre "Reserva y gasto" y enseña el aviso', aviso);
  await p.evaluate(() => document.getElementById('ew-discard').click());
  await sleep(p, 1400);

  titulo('LOS MEDIOS RAROS, DETRÁS DE "OTRO TRANSPORTE"');
  await abrirNueva(); await sleep(p, 800);
  ok(await celda('Otro transporte'), 'existe la celda "Otro transporte"');
  await sleep(p, 500);
  const segunda = await p.evaluate(() => [...document.querySelectorAll('.wz-cell')].map((x) => x.textContent));
  ok(segunda.some((x) => /Autobús/.test(x)) && segunda.some((x) => /Ferry/.test(x)) && segunda.some((x) => /alquiler/.test(x)),
    'que lleva a autobús, ferry, taxi… y al coche de alquiler', segunda.length + ' celdas');
  ok(segunda.some((x) => /Volver/.test(x)), 'con un "Volver" para salir de ahí');
  await celda('Coche de alquiler'); await sleep(p, 900);
  ok(await p.evaluate(() => document.getElementById('f-type').value) === 'coche',
    '"Coche de alquiler" es su propio tipo, sin casillas que marcar');
  await p.evaluate(() => UI.closeSheet()); await sleep(p, 400);

  titulo('EDITAR: NI PASOS NI PESTAÑAS');
  await abrirExistente('vuelo-demo'); await sleep(p, 1000);
  e = await estado();
  ok(e.paso === 'form', 'se abre directamente en el formulario', e.paso);
  ok(e.pestanas === 0, 'sin pestañas que recorrer', String(e.pestanas));
  ok(e.chip === 'Vuelo', 'la pastilla dice qué es', e.chip);
  const vuelo = await p.evaluate(() => ({
    aerolinea: document.getElementById('meta-aerolinea')?.value,
    salida: document.getElementById('tr-d1')?.value,
    visible: !!document.getElementById('meta-aerolinea')?.offsetParent,
  }));
  ok(vuelo.visible && vuelo.aerolinea === 'Avianca',
    'y lo primero que se ve son los datos del vuelo, no nueve iconos', vuelo);
  // El editor anterior (un coche de alquiler) todavía se está cerrando cuando
  // se abre este: si se preguntara por el id a todo el documento, ganaría su
  // <select> y aquí saldría marcada la casilla del coche.
  const casillaCoche = await p.evaluate(() => {
    const n = document.querySelector('.wz-step.on .wz-check');
    return { hay: !!n, visible: !!(n && n.checkVisibility()) };
  });
  ok(!casillaCoche.visible, 'y ni rastro de la casilla del coche de alquiler', casillaCoche);
  await p.screenshot({ path: captura('ed-editar.png') });

  titulo('EL SUBTÍTULO CUENTA LO QUE HAY DENTRO');
  ok(/Confirmado/.test(e.secciones[0].sub || ''),
    'el estado se lee sin abrir "Reserva y gasto"', e.secciones[0].sub);

  titulo('EDITAR Y GUARDAR NO PIERDE NADA');
  const antes = await p.evaluate(async () => {
    const x = await DB.get('planning_items', 'vuelo-demo');
    return { meta: JSON.stringify(x.metadata), estado: x.status, d1: x.consultation_planned_d1, t2: x.consultation_planned_t2 };
  });
  await p.evaluate(() => { const n = document.getElementById('f-title'); n.value = 'Vuelo BOG - MAD (editado)'; n.dispatchEvent(new Event('change')); });
  await guardar();
  const despues = await p.evaluate(async () => {
    const x = await DB.get('planning_items', 'vuelo-demo');
    return { titulo: x.title, meta: JSON.stringify(x.metadata), estado: x.status, d1: x.consultation_planned_d1, t2: x.consultation_planned_t2 };
  });
  ok(despues.titulo === 'Vuelo BOG - MAD (editado)', 'el cambio se guarda', despues.titulo);
  ok(despues.meta === antes.meta, 'los datos del vuelo siguen intactos', despues.meta.slice(0, 60));
  ok(despues.estado === antes.estado && despues.d1 === antes.d1 && despues.t2 === antes.t2,
    'el estado y las fechas, también', `${despues.estado} · ${despues.d1} → ${despues.t2}`);

  titulo('LO QUE YA TIENE CONTENIDO SE ABRE SOLO');
  await abrirExistente('i9'); await sleep(p, 1000);   // cena con personas
  const conGente = await p.evaluate(() => [...document.querySelectorAll('.wz-step.on .wz-sec')]
    .map((d) => ({ t: d.querySelector('.wz-sec-t').textContent, abierta: d.open, sub: d.querySelector('.wz-sec-s')?.textContent })));
  const mas = conGente.find((x) => x.t === 'Más');
  ok(mas && mas.abierta, '"Más" se abre solo si la parada ya lleva personas o nota', mas);
  ok(mas && /Rubén|Noelia/.test(mas.sub || ''), 'y el subtítulo dice con quién', mas && mas.sub);
  await p.evaluate(() => UI.closeSheet()); await sleep(p, 400);

  titulo('EL DÍA DE FIN, PLEGADO');
  await abrirNueva(); await sleep(p, 800);
  await celda('Comida'); await sleep(p, 800);
  const fin = await p.evaluate(() => {
    const d = document.querySelector('#dates-block details.wz-mini');
    const n = document.getElementById('f-end-day');
    // Ojo con cómo se pregunta: dentro de un <details> cerrado, Chrome deja
    // `offsetParent` sin nular y getBoundingClientRect() devuelve el alto de
    // siempre. La respuesta buena la da checkVisibility(), que sí tiene en
    // cuenta el content-visibility con el que el navegador pliega el bloque.
    return { hay: !!d, abierta: d ? d.open : null,
             finVisible: !!(n && n.checkVisibility()) };
  });
  ok(fin.hay && !fin.abierta && !fin.finVisible,
    'una parada nueva no pide día ni hora de fin hasta que se piden', fin);

  terminar(errs);
  await cerrar();
})();
