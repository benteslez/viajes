/* El planning es un carrusel: un día por pantalla, se pasa deslizando. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir();

  const estado = () => p.evaluate(() => {
    const pg = document.querySelector('.plan-pager');
    if (!pg) return { sinCarrusel: true, texto: document.body.innerText.slice(0, 150) };
    const ps = [...pg.querySelectorAll('.plan-page')].filter((x) => x.offsetParent);
    const i = Math.round(pg.scrollLeft / (pg.clientWidth || 1));
    const tira = document.querySelector('.day-strip');
    const sc = document.scrollingElement;
    return {
      paginas: ps.length, indice: i, dia: ps[i] && ps[i].dataset.day,
      diaVisible: TripDetail._diaVisible,
      pastillaActiva: document.querySelector('.day-pill.active')?.dataset.day,
      tiraTop: tira ? Math.round(tira.getBoundingClientRect().top) : null,
      anchoPagina: Math.round(ps[0].getBoundingClientRect().width),
      anchoVentana: window.innerWidth,
      desbordaDoc: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollY: Math.round(sc.scrollTop),
    };
  });

  const c = await p.context().newCDPSession(p);
  const pt = (x, y) => [{ x, y, radiusX: 5, radiusY: 5, force: 1 }];
  const deslizar = async (dx) => {
    const y = 520, x = 195;
    await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x, y) });
    for (let s = 1; s <= 12; s++) {
      await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(Math.round(x + dx * s / 12), y) });
      await sleep(p, 14);
    }
    await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(p, 1400);
  };

  titulo('AL ENTRAR');
  const e1 = await estado();
  const hoy = await p.evaluate(() => window.__dias.hoy);
  ok(!e1.sinCarrusel, 'el planning pinta el carrusel', e1);
  ok(e1.paginas >= 8, 'están todos los días del viaje', String(e1.paginas));
  ok(e1.dia === hoy && e1.diaVisible === hoy, 'se abre en el día de hoy', `${e1.dia} (hoy ${hoy})`);
  ok(e1.pastillaActiva === hoy, 'la pastilla de hoy sale marcada', e1.pastillaActiva);
  ok(Math.abs(e1.anchoPagina - e1.anchoVentana) <= 1, 'cada página ocupa la pantalla entera',
    `${e1.anchoPagina} vs ${e1.anchoVentana}`);
  ok(!e1.desbordaDoc, 'la página no se desborda a lo ancho');

  titulo('DESLIZAR');
  await deslizar(-230);
  const e2 = await estado();
  ok(e2.indice === e1.indice + 1, 'deslizar a la izquierda pasa al día siguiente', `${e1.dia} → ${e2.dia}`);
  ok(e2.pastillaActiva === e2.dia, 'la tira sigue al carrusel', e2.pastillaActiva);
  ok(e2.tiraTop !== null && e2.tiraTop < e1.tiraTop + 1, 'la tira se sube al borde de arriba',
    `${e1.tiraTop} → ${e2.tiraTop}`);

  await deslizar(230);
  const e3 = await estado();
  ok(e3.indice === e1.indice, 'deslizar a la derecha vuelve al día anterior', `${e2.dia} → ${e3.dia}`);

  titulo('SALTAR DE UN DÍA LEJANO A OTRO');
  const dias = await p.evaluate(() => [...document.querySelectorAll('.day-pill')].map((x) => x.dataset.day));
  const lejos = dias[dias.length - 1];
  await p.evaluate((k) => document.querySelector(`.day-pill[data-day="${k}"]`).click(), lejos);
  await sleep(p, 1500);
  const e4 = await estado();
  ok(e4.dia === lejos, 'tocar una pastilla lejana lleva a ese día', `${lejos} → ${e4.dia}`);
  ok(e4.pastillaActiva === lejos, 'y la pastilla se queda marcada ahí', e4.pastillaActiva);

  titulo('TECLADO');
  await p.keyboard.press('ArrowLeft');
  await sleep(p, 1200);
  const e5 = await estado();
  ok(e5.dia !== lejos, 'la flecha izquierda retrocede un día', `${lejos} → ${e5.dia}`);

  await p.screenshot({ path: captura('carrusel.png') });
  terminar(errs);
  await cerrar();
})();
