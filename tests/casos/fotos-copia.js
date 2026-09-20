/* Las fotos viven solo en IndexedDB. La copia en JSON no puede llevárselas
 * (un Blob no sobrevive a JSON.stringify) y, sobre todo, restaurarla no puede
 * destruir las que el dispositivo todavía tiene. Salen en ZIP. */
const fs = require('fs');
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir();

  titulo('PREPARAR');
  const sembradas = await p.evaluate(async () => {
    const jpeg = async (color, w, h) => {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const c = cv.getContext('2d'); c.fillStyle = color; c.fillRect(0, 0, w, h);
      c.fillStyle = '#fff'; c.font = '40px sans-serif'; c.fillText('foto', 20, 60);
      return await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
    };
    const a = await jpeg('#0ea5e9', 400, 300), b = await jpeg('#f97316', 320, 240);
    await DB.db.put('media', { id:'f1', profile:STATE.profile, trip_id:'trip-demo-1',
      day_date: window.__dias.hoy, order_index:0, blob:a, mime:'image/jpeg', created_at:nowIso() });
    await DB.db.put('media', { id:'f2', profile:STATE.profile, trip_id:'trip-demo-1',
      day_date: window.__dias.manana, order_index:0, blob:b, mime:'image/jpeg', created_at:nowIso() });
    // Y una portada, que se guarda SIN trip_id.
    const t = await DB.get('trips', 'trip-demo-1');
    t.cover_blob_id = await DB.saveMedia(a, 'image/jpeg'); await DB.put('trips', t);
    return { f1: a.size, f2: b.size };
  });
  ok(sembradas.f1 > 0 && sembradas.f2 > 0, 'hay dos fotos de verdad en la base', sembradas);

  titulo('LA COPIA EN JSON');
  const exp = await p.evaluate(async () => {
    const d = await DB.exportProfile(STATE.profile);
    return { tieneMedia: 'media' in d, marca: d._meta.sin_fotos,
             kb: Math.round(JSON.stringify(d).length / 1024),
             viajes: (d.trips || []).length, paradas: (d.planning_items || []).length };
  });
  ok(exp.tieneMedia === false, 'la copia no incluye el store de fotos');
  ok(exp.marca === true, 'y lo dice en su cabecera (_meta.sin_fotos)');
  ok(exp.viajes > 0 && exp.paradas > 0, 'pero sí lleva los datos del viaje', exp);
  ok(exp.kb < 500, 'la copia se mantiene pequeña', `${exp.kb} KB`);

  titulo('RESTAURAR NO DESTRUYE NADA');
  const tras = await p.evaluate(async () => {
    const d = JSON.parse(JSON.stringify(await DB.exportProfile(STATE.profile)));
    // Además, simulamos una copia ANTIGUA: esas sí traían media con el blob roto.
    d.media = [{ id:'f1', profile:STATE.profile, trip_id:'trip-demo-1',
      day_date: window.__dias.hoy, blob: {}, mime:'image/jpeg' }];
    await DB.importProfile(d);
    const f = await DB.db.get('media', 'f1');
    let url = null, err = null;
    try { url = URL.createObjectURL(f.blob); } catch (e) { err = String(e); }
    return { esBlob: f.blob instanceof Blob, bytes: f.blob instanceof Blob ? f.blob.size : null, url: url ? 'ok' : err };
  });
  ok(tras.esBlob && tras.bytes === sembradas.f1,
    'tras restaurar (incluso una copia vieja con el blob roto) la foto sigue entera', tras);
  ok(tras.url === 'ok', 'y se puede volver a pintar');

  titulo('UNA FILA ROTA NO TUMBA LA VISTA');
  const roto = await p.evaluate(async () => {
    await DB.db.put('media', { id:'roto', profile:STATE.profile, blob:{}, mime:'image/jpeg', created_at:nowIso() });
    return await MediaCache.urlFor('roto');
  });
  ok(roto === null, 'MediaCache.urlFor devuelve null en vez de lanzar', String(roto));

  titulo('EL ZIP');
  const descarga = p.waitForEvent('download', { timeout: 20000 });
  await p.evaluate(async () => { const t = await DB.get('trips', 'trip-demo-1'); await Exporter.fotosZip(t); });
  const d = await descarga;
  const ruta = captura('fotos.zip');
  await d.saveAs(ruta);
  const bytes = fs.statSync(ruta).size;
  ok(/^fotos_.*\.zip$/.test(d.suggestedFilename()), 'se descarga con nombre de viaje y fecha', d.suggestedFilename());
  ok(bytes > sembradas.f1 + sembradas.f2, 'y pesa lo que pesan las fotos', `${bytes} bytes`);

  // Cabeceras del ZIP: firma local, directorio central y cierre.
  const buf = fs.readFileSync(ruta);
  ok(buf.readUInt32LE(0) === 0x04034b50, 'empieza por la firma de un ZIP');
  const fin = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  ok(fin > 0, 'tiene el cierre del directorio central');
  ok(buf.readUInt16LE(fin + 10) === 2, 'con las dos fotos dentro', String(buf.readUInt16LE(fin + 10)));
  ok(buf.includes(Buffer.from('Colombia/')), 'ordenadas en carpetas por viaje y día');

  titulo('ALMACENAMIENTO');
  const api = await p.evaluate(() => !!(navigator.storage && navigator.storage.persist));
  ok(api, 'la API de almacenamiento persistente existe en este navegador');

  terminar(errs);
  await cerrar();
})();
