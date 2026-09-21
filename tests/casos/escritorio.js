/* La app en una pantalla de escritorio.
 *
 * Las tarjetas del planning están dibujadas para el ancho de un móvil: el
 * contenido va centrado con su propio ancho máximo y NO crece con la tarjeta.
 * Estiradas a los 1100 px de `main` salía una plancha de color con cuatro datos
 * flotando en medio. Aquí se mide que el día se quede en una columna. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir({ escritorio: true });

  const medir = async (ancho) => {
    await p.setViewportSize({ width: ancho, height: 1000 });
    await sleep(p, 1200);
    // Al cambiar el ancho, las páginas del carrusel cambian de medida y el
    // scroll se queda entre dos días. Se recoloca antes de medir: lo que se
    // comprueba aquí es el ancho de la columna, no el carrusel.
    await p.evaluate(() => {
      const pg = document.querySelector('.plan-pager');
      if (pg && pg.clientWidth) pg.scrollLeft = Math.round(pg.scrollLeft / pg.clientWidth) * pg.clientWidth;
    });
    await sleep(p, 500);
    return p.evaluate(() => {
      const caja = (n) => { if (!n) return null; const b = n.getBoundingClientRect();
        return { w: Math.round(b.width), centro: Math.round(b.left + b.width / 2) }; };
      const r = (s) => caja(document.querySelector(s));
      // El carrusel tiene una página por día y las de los otros días están fuera
      // de la pantalla: hay que medir la que se ve, no la primera del DOM.
      const vista = [...document.querySelectorAll('.plan-page')].find((n) => {
        const b = n.getBoundingClientRect();
        return b.left < window.innerWidth - 8 && b.right > 8;
      }) || document;
      return { vp: window.innerWidth, main: r('main'), pager: r('.plan-pager'),
               dia: caja(vista.querySelector('.day-group')),
               billete: caja(vista.querySelector('.li-ticket')) };
    });
  };

  titulo('EN 1920 EL DÍA NO SE ESTIRA');
  let m = await medir(1920);
  ok(m.dia && m.dia.w <= 640, 'el día se queda en una columna de móvil grande', `${m.dia && m.dia.w} px`);
  ok(m.billete && m.billete.w <= 620, 'y el billete con él', `${m.billete && m.billete.w} px`);
  ok(Math.abs(m.pager.centro - m.vp / 2) < 4, 'centrada en la pantalla, no pegada a un lado',
    `centro ${m.pager.centro} de ${m.vp}`);
  ok(m.main.w > m.dia.w, 'pero las pestañas del viaje siguen a lo ancho', `main ${m.main.w} · día ${m.dia.w}`);
  await p.screenshot({ path: captura('escritorio-1920.png') });

  titulo('Y EN 1280 TAMPOCO');
  m = await medir(1280);
  ok(m.dia.w <= 640, 'mismo ancho de columna', `${m.dia.w} px`);
  ok(Math.abs(m.pager.centro - m.vp / 2) < 4, 'y también centrada', `centro ${m.pager.centro} de ${m.vp}`);
  await p.screenshot({ path: captura('escritorio-1280.png') });

  titulo('NADA DE ESTO TOCA AL MÓVIL');
  m = await medir(390);
  ok(m.dia.w > 340, 'en el móvil el día sigue ocupando la pantalla entera', `${m.dia.w} de 390`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)),
    'y sin scroll lateral');

  titulo('LA TIRA DE DÍAS SE QUEDA A LO ANCHO');
  // Su línea de abajo separa la cabecera del viaje del plan; las pastillas ya
  // van centradas por su cuenta.
  await p.setViewportSize({ width: 1440, height: 1000 }); await sleep(p, 1200);
  const tira = await p.evaluate(() => {
    const n = document.querySelector('.day-strip'); if (!n) return null;
    const b = n.getBoundingClientRect(); const d = document.querySelector('.day-group').getBoundingClientRect();
    return { tira: Math.round(b.width), dia: Math.round(d.width) };
  });

  ok(tira && tira.tira > tira.dia, 'la tira es más ancha que la columna del día', tira);

  terminar(errs);
  await cerrar();
})();
