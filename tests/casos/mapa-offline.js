/* Guardar las teselas del mapa para verlo sin datos.
 *
 * El servidor de teselas no está disponible desde las pruebas, así que se
 * sustituye `fetch` para las URLs de tesela por una respuesta de mentira. Eso
 * deja comprobar lo que importa: qué teselas se piden, que no se repiten, que
 * acaban en SU caché, el progreso, el parar y el borrar. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir({ abrir: false });

  // fetch de mentira para las teselas, contando las peticiones.
  await p.evaluate(() => {
    window.__pedidas = [];
    const real = window.fetch;
    window.fetch = (u, o) => {
      const url = String(u && u.url ? u.url : u);
      if (/tile\.openstreetmap\.org/.test(url)) {
        window.__pedidas.push(url);
        return Promise.resolve(new Response(new Blob([new Uint8Array(64)], { type: 'image/png' }),
          { status: 200, headers: { 'Content-Type': 'image/png' } }));
      }
      return real(u, o);
    };
  });

  titulo('QUÉ TESELAS HACEN FALTA');
  const cuentas = await p.evaluate(() => {
    const una = MapaOffline.teselas([{ lat: 6.6, lng: -73.2 }]);
    // Dos paradas en la misma plaza comparten casi todas sus teselas.
    const juntas = MapaOffline.teselas([{ lat: 6.6, lng: -73.2 }, { lat: 6.6005, lng: -73.2005 }]);
    const lejos = MapaOffline.teselas([{ lat: 6.6, lng: -73.2 }, { lat: 4.6, lng: -74.1 }]);
    const mala = MapaOffline.teselas([{ lat: null, lng: -73.2 }, { lat: 6.6, lng: -73.2 }]);
    return { una: una.size, juntas: juntas.size, lejos: lejos.size, mala: mala.size,
             zooms: [...new Set([...una].map((k) => +k.split('/')[0]))].sort((a, b) => a - b) };
  });
  ok(cuentas.una > 20 && cuentas.una < 200, 'una parada son unas decenas de teselas', `${cuentas.una}`);
  ok(cuentas.juntas < cuentas.una * 1.6,
    'dos paradas pegadas casi no suman: las teselas se comparten', `${cuentas.una} → ${cuentas.juntas}`);
  ok(cuentas.lejos > cuentas.una * 1.8,
    'dos paradas lejos sí suman', `${cuentas.una} → ${cuentas.lejos}`);
  ok(cuentas.mala === cuentas.una, 'una parada sin coordenadas se ignora, no rompe', `${cuentas.mala}`);
  ok(JSON.stringify(cuentas.zooms) === '[13,14,15,16]', 'y se cubre del barrio a la calle', cuentas.zooms);

  titulo('LA ESTIMACIÓN DE TAMAÑO');
  const mb = await p.evaluate(() => +MapaOffline.mb(MapaOffline.teselas([{ lat: 6.6, lng: -73.2 }]).size).toFixed(2));
  ok(mb > 0.3 && mb < 4, 'una parada ronda el mega', `${mb} MB`);

  titulo('DESCARGAR');
  const r1 = await p.evaluate(async () => {
    await MapaOffline.borrar();
    window.__pedidas = [];
    const claves = [...MapaOffline.teselas([{ lat: 6.6, lng: -73.2 }])];
    const avances = [];
    const r = await MapaOffline.descargar(claves, (h, t) => avances.push([h, t]));
    return { r, pedidas: window.__pedidas.length, avances: avances.length,
             ultimo: avances[avances.length - 1], guardadas: await MapaOffline.guardadas() };
  });
  ok(r1.r.hechas === r1.r.total && !r1.r.fallos, 'se bajan todas', r1.r);
  ok(r1.pedidas === r1.r.total, 'una petición por tesela, ni una de más', `${r1.pedidas} peticiones`);
  ok(r1.guardadas === r1.r.total, 'y todas acaban en la caché de teselas', `${r1.guardadas} guardadas`);
  ok(r1.avances > 3 && r1.ultimo[0] === r1.ultimo[1], 'con progreso hasta el final', r1.ultimo);

  titulo('LO YA GUARDADO NO SE VUELVE A PEDIR');
  const r2 = await p.evaluate(async () => {
    const claves = MapaOffline.teselas([{ lat: 6.6, lng: -73.2 }]);
    const faltan = await MapaOffline.pendientes(claves);
    return { total: claves.size, faltan: faltan.length };
  });
  ok(r2.faltan === 0, 'tras bajarlas, no falta ninguna', `${r2.faltan} de ${r2.total}`);
  const r3 = await p.evaluate(async () => {
    const claves = MapaOffline.teselas([{ lat: 6.6, lng: -73.2 }, { lat: 6.61, lng: -73.21 }]);
    return { total: claves.size, faltan: (await MapaOffline.pendientes(claves)).length };
  });
  ok(r3.faltan > 0 && r3.faltan < r3.total,
    'añadir una parada nueva solo pide lo que falta', `${r3.faltan} de ${r3.total}`);

  titulo('LA CACHÉ DE TESELAS ES SUYA');
  const caches_ = await p.evaluate(async () => (await caches.keys()).filter((k) => /viajes/.test(k)));
  ok(caches_.includes('viajes-tiles-v1'), 'las teselas tienen su propia caché', caches_);
  ok(!caches_.some((k) => /shell/.test(k) && k !== 'viajes-shell-v122'), 'separada del shell', caches_);

  titulo('PARAR A MEDIAS');
  const r4 = await p.evaluate(async () => {
    await MapaOffline.borrar();
    const claves = [...MapaOffline.teselas([{ lat: 40.4, lng: -3.7 }])];
    let parado = false;
    const pr = MapaOffline.descargar(claves, (h) => { if (h >= 6 && !parado) { parado = true; MapaOffline.parar(); } });
    const r = await pr;
    return { r, total: claves.length };
  });
  ok(r4.r.abortado, 'se puede parar', r4.r);
  ok(r4.r.hechas < r4.total, 'y no se bajan todas', `${r4.r.hechas} de ${r4.total}`);
  ok(await p.evaluate(() => MapaOffline.guardadas()) === r4.r.hechas,
    'lo bajado hasta ahí se queda guardado');

  titulo('BORRAR');
  await p.evaluate(() => MapaOffline.borrar());
  ok(await p.evaluate(() => MapaOffline.guardadas()) === 0, 'la caché se vacía');

  titulo('UNA TESELA QUE FALLA NO TUMBA LA DESCARGA');
  const r5 = await p.evaluate(async () => {
    await MapaOffline.borrar();
    const real = window.fetch;
    let n = 0;
    window.fetch = (u, o) => {
      const url = String(u && u.url ? u.url : u);
      if (/tile\.openstreetmap\.org/.test(url)) {
        n++;
        if (n % 5 === 0) return Promise.reject(new Error('sin red'));
        return Promise.resolve(new Response(new Blob([new Uint8Array(64)]), { status: 200 }));
      }
      return real(u, o);
    };
    const claves = [...MapaOffline.teselas([{ lat: 41.4, lng: 2.17 }])].slice(0, 20);
    const r = await MapaOffline.descargar(claves, () => {});
    return { r, guardadas: await MapaOffline.guardadas() };
  });
  ok(r5.r.fallos > 0 && r5.r.hechas === r5.r.total,
    'las que fallan se cuentan y el resto sigue', r5.r);
  ok(r5.guardadas === r5.r.total - r5.r.fallos, 'y solo se guardan las buenas', r5.guardadas);

  titulo('LA BARRA EN LA PESTAÑA MAPA');
  await p.evaluate(async () => {
    // Devolver el fetch bueno: el de la prueba anterior fallaba una de cada cinco.
    const real = window.fetch;
    window.fetch = (u, o) => {
      const url = String(u && u.url ? u.url : u);
      if (/tile\.openstreetmap\.org/.test(url)) {
        return Promise.resolve(new Response(new Blob([new Uint8Array(64)]), { status: 200 }));
      }
      return real(u, o);
    };
    await MapaOffline.borrar();
    // Un par de paradas con coordenadas para que el mapa tenga qué guardar.
    const d = window.__dias.manana;
    await DB.put('planning_items', { id: 'geo-1', trip_id: 'trip-demo-1', profile: dataProfile(),
      type: 'lugar', title: 'Con coords', day_date: d, lat: 6.6, lng: -73.2, metadata: {}, order_index: 0 });
    await Router.go('trip', { tripId: 'trip-demo-1', tab: 'mapa' });
  });
  await sleep(p, 2500);
  const barra = await p.evaluate(() => {
    const n = document.querySelector('.mo');
    return n ? { hay: true, titulo: n.querySelector('.mo-txt b')?.textContent,
                 sub: n.querySelector('.mo-txt span')?.textContent,
                 botones: [...n.querySelectorAll('button')].map((b) => b.textContent) } : { hay: false };
  });
  ok(barra.hay, 'la barra aparece bajo el mapa');
  ok(/Guardar el mapa/.test(barra.titulo || ''), 'ofrece guardarlo', barra.titulo);
  ok(/teselas ≈ \d+ MB/.test(barra.sub || '') && /única parada/.test(barra.sub || ''),
    'diciendo cuánto ocupa antes de bajar nada', barra.sub);
  await p.screenshot({ path: captura('mapa-offline.png') });

  const tras = await p.evaluate(async () => {
    document.querySelector('.mo-btns button').click();
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const t = document.querySelector('.mo-txt b')?.textContent || '';
      if (/Mapa guardado/.test(t)) return { t, guardadas: await MapaOffline.guardadas() };
    }
    return { t: document.querySelector('.mo-txt b')?.textContent, guardadas: await MapaOffline.guardadas() };
  });
  ok(/Mapa guardado/.test(tras.t || ''), 'y tras pulsar, lo dice', tras.t);
  ok(tras.guardadas > 20, 'con las teselas ya en la caché', `${tras.guardadas}`);

  terminar(errs);
  await cerrar();
})();
