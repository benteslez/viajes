/* Correr las horas de un día, y la hora real frente a la planeada.
 *
 * Lo importante del primero es que NO toca nada hasta pulsar Aplicar: la lista
 * es una vista previa, y los vuelos y alojamientos salen desmarcados porque sus
 * horas las pone otro. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir();

  const horas = async () => p.evaluate(async () => {
    const d = window.__dias.manana;
    const its = await DB.listByTrip('planning_items', 'trip-demo-1');
    return Object.fromEntries(its.filter((x) => !x.deleted_at && (x.day_date === d || x.consultation_planned_d1 === d))
      .map((x) => [x.id, { t: x.time || null, f: x.end_time || null, t1: x.consultation_planned_t1 || null, t2: x.consultation_planned_t2 || null }]));
  });
  const abrirCorrer = async () => {
    await p.evaluate(async () => {
      const t = await DB.get('trips', 'trip-demo-1');
      await TripDetail.openCorrerDia(t, window.__dias.manana);
    });
    await sleep(p, 800);
  };
  const filas = () => p.evaluate(() => [...document.querySelectorAll('.cd-fila')].map((f) => ({
    tit: f.querySelector('.cd-tit').textContent,
    marcada: f.querySelector('input').checked,
    de: f.querySelector('.cd-hora s').textContent,
    a: f.querySelector('.cd-hora b').textContent,
  })));

  titulo('LA HOJA ES UNA VISTA PREVIA');
  const antes = await horas();
  await abrirCorrer();
  let f = await filas();
  ok(f.length >= 5, 'lista las paradas del día con hora', `${f.length} paradas`);
  ok(f.every((x, i, a) => i === 0 || a[i - 1].de <= x.de), 'ordenadas por hora', f.map((x) => x.de).join(' '));
  ok(f.every((x) => !x.marcada || x.a !== x.de), 'y cada una enseña su hora nueva al lado de la vieja', f[0]);
  ok(JSON.stringify(await horas()) === JSON.stringify(antes),
    'abrir la hoja no ha tocado NADA en la base');
  await p.screenshot({ path: captura('correr-dia.png') });

  titulo('LOS VUELOS Y HOTELES NO SE MUEVEN SOLOS');
  const ajena = await p.evaluate(() => {
    const f = [...document.querySelectorAll('.cd-fila')];
    return f.map((x) => ({ tit: x.querySelector('.cd-tit').textContent, marcada: x.querySelector('input').checked }));
  });
  ok(ajena.length > 0, 'hay paradas en la lista');
  const aviso = await p.evaluate(() => document.querySelector('.cd .field-hint')?.textContent || '');
  ok(/vuelos y alojamientos/i.test(aviso) || !ajena.some((x) => /Vuelo|Hotel/i.test(x.tit)),
    'y si los hay, se avisa de por qué salen sin marcar', aviso || '(no hay ninguno este día)');

  titulo('LOS MINUTOS CAMBIAN LA VISTA PREVIA');
  await p.evaluate(() => [...document.querySelectorAll('.cd-chip')].find((x) => x.textContent === '+60').click());
  await sleep(p, 400);
  f = await filas();
  const primera = f.find((x) => x.marcada);
  const mas = (h, n) => { const [a, b] = h.split(':').map(Number); const t = a * 60 + b + n;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  ok(primera && primera.a === mas(primera.de, 60), '+60 suma una hora', `${primera.de} → ${primera.a}`);
  await p.evaluate(() => [...document.querySelectorAll('.cd-chip')].find((x) => x.textContent === '−15').click());
  await sleep(p, 400);
  f = await filas();
  const p2 = f.find((x) => x.marcada);
  ok(p2 && p2.a === mas(p2.de, -15), 'y −15 resta un cuarto', `${p2.de} → ${p2.a}`);

  titulo('DESMARCAR UNA PARADA LA DEJA QUIETA');
  await p.evaluate(() => document.querySelector('.cd-fila input').click());
  await sleep(p, 400);
  f = await filas();
  ok(!f[0].marcada, 'la primera queda sin marcar');
  const idPrimera = await p.evaluate(async () => {
    const its = await DB.listByTrip('planning_items', 'trip-demo-1');
    const t = document.querySelector('.cd-fila .cd-tit').textContent;
    return (its.find((x) => (x.title || '') === t) || {}).id;
  });

  titulo('APLICAR');
  await p.evaluate(() => [...document.querySelectorAll('#sheet-foot button')].find((x) => /Aplicar/.test(x.textContent)).click());
  await sleep(p, 2000);
  const despues = await horas();
  const movidas = Object.keys(antes).filter((id) => JSON.stringify(antes[id]) !== JSON.stringify(despues[id]));
  ok(movidas.length > 0, 'se han movido paradas', `${movidas.length} de ${Object.keys(antes).length}`);
  ok(!movidas.includes(idPrimera), 'pero no la que se desmarcó', idPrimera);
  const unaMovida = movidas[0];
  ok(despues[unaMovida].t === mas(antes[unaMovida].t, -15) || despues[unaMovida].t1 === mas(antes[unaMovida].t1, -15),
    'y las que sí, van 15 min antes', `${antes[unaMovida].t || antes[unaMovida].t1} → ${despues[unaMovida].t || despues[unaMovida].t1}`);
  const conFin = movidas.find((id) => antes[id].f);
  if (conFin) ok(despues[conFin].f === mas(antes[conFin].f, -15),
    'la hora de fin se mueve con la de inicio', `${antes[conFin].f} → ${despues[conFin].f}`);

  titulo('NO SE CRUZA LA MEDIANOCHE');
  await p.evaluate(async () => {
    const x = await DB.get('planning_items', 'i9'); x.time = '23:30'; x.end_time = null;
    await DB.put('planning_items', x);
  });
  await abrirCorrer();
  await p.evaluate(() => { const n = document.querySelector('.cd-num'); n.value = '120'; n.dispatchEvent(new Event('input')); });
  await sleep(p, 400);
  const tarde = (await filas()).find((x) => x.de === '23:30');
  ok(tarde && tarde.a === '23:59', 'una parada de las 23:30 +120 se queda en 23:59', tarde && tarde.a);
  ok(/23:59/.test(await p.evaluate(() => document.querySelector('.cd .field-hint')?.textContent || '')),
    'y se dice por qué', 'avisa');
  await p.evaluate(() => UI.closeSheet()); await sleep(p, 600);

  titulo('UN DÍA SIN HORAS LO DICE');
  const avisos = [];
  await p.exposeFunction('__toast', (m) => avisos.push(m));
  await p.evaluate(() => { const o = UI.toast; UI.toast = (m) => { window.__toast(m); return o(m); }; });
  await p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    await TripDetail.openCorrerDia(t, window.__dias.inicio);   // día vacío
  });
  await sleep(p, 700);
  ok(avisos.some((m) => /no tiene nada con hora/i.test(m)), 'avisa en vez de abrir una hoja vacía', avisos);

  titulo('HORA REAL FRENTE A LA PLANEADA');
  // Una parada planeada a las 12:00 y marcada como vista a las 13:40 del mismo día.
  const info = await p.evaluate(async () => {
    const x = await DB.get('planning_items', 'i1');
    const d = parseDate(x.day_date); d.setHours(13, 40, 0, 0);
    x.time = '12:00'; x.visited = true; x.visited_at = d.toISOString();
    await DB.put('planning_items', x);
    const t = await DB.get('trips', 'trip-demo-1');
    TripDetail.openPlanningDetail(t, await DB.get('planning_items', 'i1'));
    return { dia: x.day_date };
  });
  await sleep(p, 1400);
  const fila = await p.evaluate(() => [...document.querySelectorAll('.detailview .dv-row')]
    .map((r) => [r.querySelector('.dv-l')?.textContent, r.querySelector('.dv-v')?.textContent])
    .find(([l]) => /Hecho/.test(l || '')));
  ok(fila && /13:40/.test(fila[1]), 'la ficha enseña a qué hora se marcó', fila);
  ok(fila && /\+1 h 40|\+100/.test(fila[1]), 'y cuánto se desvió de lo planeado', fila && fila[1]);
  await p.screenshot({ path: captura('hora-real.png') });
  await p.evaluate(() => document.querySelector('.detailview')?.remove()); await sleep(p, 400);

  titulo('MARCARLA OTRO DÍA NO CUENTA COMO RETRASO');
  await p.evaluate(async () => {
    const x = await DB.get('planning_items', 'i1');
    const d = parseDate(x.day_date); d.setDate(d.getDate() + 3); d.setHours(10, 0, 0, 0);
    x.visited_at = d.toISOString(); await DB.put('planning_items', x);
    const t = await DB.get('trips', 'trip-demo-1');
    TripDetail.openPlanningDetail(t, await DB.get('planning_items', 'i1'));
  });
  await sleep(p, 1400);
  ok(!(await p.evaluate(() => [...document.querySelectorAll('.detailview .dv-l')].some((l) => /Hecho/.test(l.textContent)))),
    'marcar tres días después no se enseña como "+70 h", no se enseña');

  terminar(errs);
  await cerrar();
})();
