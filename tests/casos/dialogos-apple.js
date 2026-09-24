/* Los cuadros de diálogo, al estilo de Apple.
 *
 * Se veían flojos y desordenados: campos sueltos sobre blanco, etiquetas
 * pequeñas y grises, todo con el mismo peso, y un sí/no abriendo la hoja
 * entera con el título "Confirmar". Ahora el diálogo usa el lenguaje de iOS
 * —fondo agrupado, tarjetas metidas hacia dentro, controles de 44 px— y
 * confirmar es una alerta del sistema.
 *
 * Lo que más se comprueba aquí es lo que no se ve en una captura: que el tema
 * del diálogo SIGA al de la app. Escribiendo esto, `:root:not([data-tema])` sin
 * su `@media` dejó el diálogo en negro sobre una app en claro. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir();

  const abrirParada = async (tipo) => {
    await p.evaluate(async () => {
      const t = await DB.get('trips', 'trip-demo-1');
      await TripDetail.openPlanningEditor(t, null, { day: window.__dias.hoy });
    });
    await sleep(p, 900);
    await p.evaluate((x) => [...document.querySelectorAll('.wz-cell')]
      .find((c) => c.textContent.includes(x)).click(), tipo);
    await sleep(p, 1100);
  };
  // Color de fondo real, normalizado por lienzo: Chrome devuelve unas veces
  // rgb() y otras color(srgb …), y compararlos como texto no vale.
  const luz = (sel) => p.evaluate((s) => {
    const c = getComputedStyle(document.querySelector(s)).backgroundColor;
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const x = cv.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 1, 1);
    x.fillStyle = c; x.fillRect(0, 0, 1, 1);
    const [r, g, b] = x.getImageData(0, 0, 1, 1).data;
    return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  }, sel);

  titulo('EL DIÁLOGO SIGUE AL TEMA DE LA APP');
  await p.evaluate(() => { document.documentElement.dataset.tema = 'claro'; });
  await abrirParada('Coche');
  const claro = { app: await luz('body'), hoja: await luz('.sheet'), tarjeta: await luz('#ruta-block') };
  ok(claro.hoja > 128, 'con la app en claro, la hoja es clara', claro);
  ok(claro.tarjeta > claro.hoja, 'y las tarjetas destacan sobre el fondo agrupado', claro);
  await p.screenshot({ path: captura('dialogos-apple-claro.png') });

  await p.evaluate(() => { document.documentElement.dataset.tema = 'oscuro'; });
  await sleep(p, 400);
  const oscuro = { hoja: await luz('.sheet'), tarjeta: await luz('#ruta-block') };
  ok(oscuro.hoja < 60, 'con la app en oscuro, la hoja es oscura', oscuro);
  ok(oscuro.tarjeta > oscuro.hoja, 'y las tarjetas siguen destacando', oscuro);
  await p.evaluate(() => { document.documentElement.dataset.tema = 'claro'; });
  await sleep(p, 300);

  titulo('FORMULARIO AGRUPADO, COMO EN AJUSTES');
  const forma = await p.evaluate(() => {
    const alto = (s) => { const n = document.querySelector(s); return n ? Math.round(n.getBoundingClientRect().height) : 0; };
    const tit = document.querySelector('#dates-block > .grupo-tit');
    const grupo = document.querySelector('#dates-block > .ios-grupo');
    return {
      // La cabecera de sección va ENCIMA de la tarjeta, no dentro.
      tituloFuera: !!(tit && grupo && !grupo.contains(tit) && tit.getBoundingClientRect().bottom <= grupo.getBoundingClientRect().top + 1),
      mayusculas: tit ? getComputedStyle(tit).textTransform : '',
      cuerpoTitulo: tit ? getComputedStyle(tit).fontSize : '',
      fecha: alto('#tr-d1'), texto: alto('#meta-origen'),
      cuerpoInput: getComputedStyle(document.querySelector('#meta-origen')).fontSize,
      radioTarjeta: getComputedStyle(document.querySelector('#ruta-block')).borderTopLeftRadius,
      // Centrado de verdad: se mide dónde cae el texto, no qué dice la regla.
      // La × ocupa 30 px a la derecha, así que sin compensarla a la izquierda el
      // título queda descentrado aunque tenga `text-align:center`.
      centrado: (() => {
        const h = document.querySelector('.sheet-header').getBoundingClientRect();
        const rango = document.createRange();
        rango.selectNodeContents(document.querySelector('.sheet-title'));
        const t = rango.getBoundingClientRect();
        return Math.round((t.left + t.right) / 2 - (h.left + h.right) / 2);
      })(),
    };
  });
  ok(forma.tituloFuera, 'la cabecera de sección va encima de la tarjeta, no dentro');
  ok(forma.mayusculas === 'uppercase' && forma.cuerpoTitulo === '13px',
    'en mayúsculas y a 13 px, como las de Ajustes', forma);
  ok(forma.fecha >= 44 && forma.texto >= 44,
    'los controles miden 44 px, que es lo que se puede tocar con el dedo', forma);
  ok(forma.cuerpoInput === '17px', 'y el dato se escribe a 17 px, no a 14', forma.cuerpoInput);
  ok(parseInt(forma.radioTarjeta, 10) === 10, 'las tarjetas van redondeadas a 10', forma.radioTarjeta);
  ok(Math.abs(forma.centrado) <= 4, 'el título de la hoja va centrado de verdad',
    forma.centrado + ' px fuera del centro');
  await p.evaluate(() => UI.closeSheet()); await sleep(p, 500);

  titulo('CONFIRMAR ES UNA ALERTA, NO LA HOJA ENTERA');
  await p.evaluate(() => { window.__r = UI.confirm('¿Borrar esta parada?\n\nIrá a la papelera; podrás recuperarla desde "Editar viaje".'); });
  await sleep(p, 600);
  const al = await p.evaluate(() => {
    const a = document.querySelector('.ios-alert');
    if (!a) return null;
    const bs = [...a.querySelectorAll('button')];
    return {
      ancho: Math.round(a.getBoundingClientRect().width),
      titulo: a.querySelector('.ios-alert-tit')?.textContent,
      mensaje: a.querySelector('.ios-alert-msg')?.textContent,
      botones: bs.map((b) => b.textContent),
      roja: bs.some((b) => b.classList.contains('destructiva')),
      hojaAbierta: !!document.querySelector('#sheet.show'),
    };
  });
  ok(al && al.ancho === 270, 'mide 270 pt, como la del sistema', al && al.ancho);
  ok(al.titulo === '¿Borrar esta parada?' && /papelera/.test(al.mensaje),
    'la primera línea es el título y el resto el cuerpo', al);
  ok(al.botones.join('/') === 'Cancelar/Sí, borrar', 'Cancelar a la izquierda y la acción a la derecha', al.botones);
  ok(al.roja, 'y la acción destructiva, en rojo');
  ok(!al.hojaAbierta, 'no abre la hoja: se puede confirmar desde un diálogo sin cerrarlo');
  await p.screenshot({ path: captura('dialogos-apple-alerta.png') });

  titulo('Y RESPONDE');
  await p.evaluate(() => [...document.querySelectorAll('.ios-alert-btns button')]
    .find((b) => /Cancelar/.test(b.textContent)).click());
  await sleep(p, 500);
  ok(await p.evaluate(() => window.__r) === false, 'Cancelar devuelve false');
  ok(await p.evaluate(() => !document.querySelector('.ios-alert')), 'y la alerta se va');

  await p.evaluate(() => { window.__r2 = UI.confirm('¿Seguro?', 'Sí'); });
  await sleep(p, 500);
  await p.evaluate(() => [...document.querySelectorAll('.ios-alert-btns button')]
    .find((b) => b.textContent === 'Sí').click());
  await sleep(p, 500);
  ok(await p.evaluate(() => window.__r2) === true, 'y la acción devuelve true');

  await p.evaluate(() => { window.__r3 = UI.confirm('¿Seguro?', 'Sí'); });
  await sleep(p, 500);
  await p.keyboard.press('Escape');
  await sleep(p, 500);
  ok(await p.evaluate(() => window.__r3) === false, 'Escape equivale a Cancelar');
  ok(await p.evaluate(() => !document.querySelector('.ios-alert')), 'y también la cierra');

  terminar(errs);
  await cerrar();
})();
