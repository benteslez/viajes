/* Adjuntar la confirmación a una parada.
 *
 * Heredan las dos reglas de las fotos: son locales y no caben en la copia en
 * JSON. Por eso lo que más importa aquí es que SÍ entren en el ZIP y que la
 * copia en JSON los siga dejando en paz. */
const fs = require('fs');
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir();

  // Un PDF y una imagen de mentira, con los bytes justos para que cuelen.
  await p.evaluate(() => {
    window.__pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, ...new Array(500).fill(65)])],
      'confirmacion.pdf', { type: 'application/pdf' });
    window.__img = async () => {
      const cv = document.createElement('canvas'); cv.width = 800; cv.height = 600;
      const c = cv.getContext('2d'); c.fillStyle = '#0ea5e9'; c.fillRect(0, 0, 800, 600);
      const b = await new Promise((r) => cv.toBlob(r, 'image/png'));
      return new File([b], 'captura.png', { type: 'image/png' });
    };
  });

  titulo('EL ÍNDICE NUEVO EXISTE');
  const idx = await p.evaluate(async () => {
    const tx = DB.db.transaction('media');
    return [...tx.objectStore('media').indexNames];
  });
  ok(idx.includes('by_item'), 'el store media tiene el índice by_item', idx);

  titulo('ADJUNTAR');
  const r = await p.evaluate(async () => {
    const id1 = await Adjuntos.add('trip-demo-1', 'vuelo-demo', window.__pdf());
    const id2 = await Adjuntos.add('trip-demo-1', 'vuelo-demo', await window.__img());
    const lista = await Adjuntos.list('vuelo-demo');
    const fila = await DB.db.get('media', id1);
    return {
      n: lista.length,
      nombres: lista.map((a) => a.nombre),
      exts: lista.map((a) => Adjuntos.extension(a)),
      pdfIntacto: fila.mime === 'application/pdf' && fila.blob.size > 400,
      imgComprimida: (await DB.db.get('media', id2)).mime === 'image/jpeg',
      cuelga: fila.planning_item_id,
    };
  });
  ok(r.n === 2, 'se guardan los dos', r.nombres);
  ok(r.exts.includes('pdf') && r.exts.includes('png'), 'con su extensión reconocida', r.exts);
  ok(r.pdfIntacto, 'el PDF se guarda tal cual, sin tocarlo');
  ok(r.imgComprimida, 'y la imagen se comprime como una foto');
  ok(r.cuelga === 'vuelo-demo', 'y cuelgan de la parada', r.cuelga);

  titulo('NO SE MEZCLAN CON LAS FOTOS DEL DÍA');
  const mezcla = await p.evaluate(async () => {
    const jpeg = await new Promise((r) => { const cv = document.createElement('canvas');
      cv.width = 40; cv.height = 40; cv.toBlob(r, 'image/jpeg'); });
    await DB.db.put('media', { id: 'foto-x', profile: STATE.profile, trip_id: 'trip-demo-1',
      day_date: window.__dias.hoy, blob: jpeg, mime: 'image/jpeg', created_at: nowIso() });
    return {
      fotos: (await DayPhotos.todasDelViaje('trip-demo-1')).length,
      adjuntos: (await Adjuntos.delViaje('trip-demo-1')).length,
      fotosDelDia: (await DayPhotos.list('trip-demo-1', window.__dias.hoy)).length,
    };
  });
  ok(mezcla.fotos === 1 && mezcla.adjuntos === 2,
    'las fotos van por su lado y los adjuntos por el suyo', mezcla);
  ok(mezcla.fotosDelDia === 1, 'y un adjunto no aparece como foto del día', mezcla.fotosDelDia);

  titulo('UN ARCHIVO ENORME SE RECHAZA');
  const grande = await p.evaluate(async () => {
    const f = new File([new Uint8Array(Adjuntos.MAX_MB * 1024 * 1024 + 10)], 'enorme.pdf', { type: 'application/pdf' });
    try { await Adjuntos.add('trip-demo-1', 'vuelo-demo', f); return 'lo aceptó'; }
    catch (e) { return String(e.message); }
  });
  ok(/grande/.test(grande), `pasar de ${await p.evaluate(() => Adjuntos.MAX_MB)} MB falla con un motivo`, grande);
  ok(await p.evaluate(async () => (await Adjuntos.list('vuelo-demo')).length) === 2, 'y no se guarda');

  titulo('LA COPIA EN JSON LOS SIGUE DEJANDO EN PAZ');
  const copia = await p.evaluate(async () => {
    const d = await DB.exportProfile(STATE.profile);
    const texto = JSON.stringify(d);
    await DB.importProfile(JSON.parse(texto));
    const lista = await Adjuntos.list('vuelo-demo');
    return { tieneMedia: 'media' in d, kb: Math.round(texto.length / 1024),
             siguen: lista.length, bytes: lista.map((a) => a.blob.size) };
  });
  ok(!copia.tieneMedia, 'no entran en la copia');
  ok(copia.siguen === 2 && copia.bytes.every((b) => b > 100),
    'y restaurarla no los destruye', copia);

  titulo('EL ZIP LLEVA FOTOS Y ADJUNTOS');
  const dl = p.waitForEvent('download', { timeout: 20000 });
  await p.evaluate(async () => { const t = await DB.get('trips', 'trip-demo-1'); await Exporter.fotosZip(t); });
  const ruta = captura('viaje.zip');
  await (await dl).saveAs(ruta);
  const bytes = fs.readFileSync(ruta);
  const texto = bytes.toString('latin1');
  ok(/^viaje_/.test((await dl).suggestedFilename()), 'con nombre de viaje', (await dl).suggestedFilename());
  ok(texto.includes('/Fotos/'), 'las fotos, en su carpeta');
  ok(texto.includes('/Adjuntos/'), 'y los adjuntos, en la suya');
  ok(/Adjuntos\/[^/]*Vuelo[^/]*\//.test(texto),
    'ordenados por parada, con su nombre: el billete se encuentra por el vuelo',
    (texto.match(/Adjuntos\/[^\x00-\x1f]{0,60}/) || [''])[0]);
  ok(texto.includes('confirmacion.pdf'), 'y el archivo conserva su nombre');
  const fin = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  ok(bytes.readUInt16LE(fin + 10) === 3, 'tres archivos dentro (1 foto + 2 adjuntos)',
    String(bytes.readUInt16LE(fin + 10)));

  titulo('DOS ADJUNTOS CON EL MISMO NOMBRE NO ROMPEN EL ZIP');
  await p.evaluate(async () => { await Adjuntos.add('trip-demo-1', 'vuelo-demo', window.__pdf()); });
  const dl2 = p.waitForEvent('download', { timeout: 20000 });
  await p.evaluate(async () => { const t = await DB.get('trips', 'trip-demo-1'); await Exporter.fotosZip(t); });
  const ruta2 = captura('viaje2.zip');
  await (await dl2).saveAs(ruta2);
  const b2 = fs.readFileSync(ruta2);
  const t2 = b2.toString('latin1');
  // Cada nombre sale DOS veces en el archivo: en su cabecera local y en el
  // directorio central del final. Así que primero se quitan los repetidos.
  const nombres = [...new Set([...t2.matchAll(/Adjuntos\/[^\x00-\x1f]*?\.pdf/g)].map((m) => m[0]))];
  ok(nombres.length === 2, 'los dos PDF están', nombres);
  ok(nombres.some((n) => /\/confirmacion\.pdf$/.test(n)) && nombres.some((n) => /\/2-confirmacion\.pdf$/.test(n)),
    'y el segundo se renombra en vez de pisar al primero', nombres);

  titulo('EN EL EDITOR');
  await p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    const x = await DB.get('planning_items', 'vuelo-demo');
    await TripDetail.openPlanningEditor(t, x);
  });
  await sleep(p, 1400);
  const ed = await p.evaluate(() => {
    const d = [...document.querySelectorAll('.wz-sec')].find((x) => /Reserva/.test(x.querySelector('.wz-sec-t').textContent));
    if (d) d.open = true;
    const b = document.getElementById('adj-block');
    return { dentroDeReserva: !!(b && b.closest('.wz-sec')),
             filas: b ? b.querySelectorAll('.adj-fila').length : 0,
             nombres: b ? [...b.querySelectorAll('.adj-nombre')].map((x) => x.textContent) : [],
             boton: b ? !!b.querySelector('.adj-add button') : false };
  });
  ok(ed.dentroDeReserva, 'los adjuntos viven en "Reserva y gasto", que es donde va una confirmación');
  ok(ed.filas === 3, 'se listan los que hay', `${ed.filas}: ${ed.nombres.join(', ')}`);
  ok(ed.boton, 'con su botón de añadir');
  await p.screenshot({ path: captura('adjuntos.png') });
  await p.evaluate(() => UI.closeSheet()); await sleep(p, 600);

  titulo('EN UNA PARADA NUEVA SE PIDE GUARDAR ANTES');
  await p.evaluate(async () => {
    const t = await DB.get('trips', 'trip-demo-1');
    await TripDetail.openPlanningEditor(t, null, { day: window.__dias.hoy });
  });
  await sleep(p, 900);
  await p.evaluate(() => [...document.querySelectorAll('.wz-cell')].find((x) => /Actividad/.test(x.textContent)).click());
  await sleep(p, 900);
  const nueva = await p.evaluate(() => {
    const d = [...document.querySelectorAll('.wz-sec')].find((x) => /Reserva/.test(x.querySelector('.wz-sec-t').textContent));
    if (d) d.open = true;
    const b = document.getElementById('adj-block');
    return { texto: b?.querySelector('.field-hint')?.textContent, boton: !!b?.querySelector('.adj-add') };
  });
  ok(!nueva.boton && /Guarda la parada/.test(nueva.texto || ''),
    'no se puede adjuntar todavía, y se dice por qué', nueva.texto);

  terminar(errs);
  await cerrar();
})();
