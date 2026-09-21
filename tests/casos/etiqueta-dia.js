/* La etiqueta del día ("Tulum") en la fila de resumen.
 *
 * Es lo más útil de esa línea y era lo que menos se veía: dentro de la tarjeta
 * del día, el `> *` que convierte la fila de chips en texto suelto le quitaba
 * fondo, borde y acolchado, y la dejaba en un azul claro sobre una cabecera que
 * también tira a azul. Aquí se mide el contraste de verdad, no se mira. */
const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir({ abrir: false });

  // Contraste WCAG del texto contra el primer fondo opaco que tenga detrás.
  const medir = () => p.evaluate(() => {
    // Chrome devuelve unas veces rgb(0-255) y otras color(srgb 0-1): se
    // normaliza pintando el color en un canvas y leyendo el píxel.
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const cx = cv.getContext('2d');
    const rgb = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
    const lum = (c) => { const [r, g, b] = rgb(c).map((v) => { v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const detras = (n) => { let e = n.parentElement;
      while (e) { const bg = getComputedStyle(e).backgroundColor;
        if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg; e = e.parentElement; }
      return 'rgb(255,255,255)'; };
    const ratio = (a, b) => { const l1 = Math.max(lum(a), lum(b)), l2 = Math.min(lum(a), lum(b));
      return +((l1 + 0.05) / (l2 + 0.05)).toFixed(2); };
    return [...document.querySelectorAll('.day-meta-pill')].filter((n) => n.checkVisibility()).map((n) => {
      const cs = getComputedStyle(n);
      return {
        txt: n.textContent,
        contraste: ratio(cs.color, cs.backgroundColor),
        // La pastilla también tiene que despegarse de lo que hay detrás: si su
        // fondo fuera el mismo de la cabecera, no sería una pastilla.
        contraDetras: ratio(cs.backgroundColor, detras(n)),
        fondo: cs.backgroundColor, color: cs.color,
        borde: parseFloat(cs.borderTopWidth), radio: parseFloat(cs.borderTopLeftRadius),
        padding: parseFloat(cs.paddingLeft), peso: +cs.fontWeight,
      };
    });
  });

  const pintar = async (tema) => {
    await p.evaluate(async (tema) => {
      document.documentElement.setAttribute('data-tema', tema);
      await DB.put('day_notes', { id:'dn1', trip_id:'trip-demo-1', profile:dataProfile(),
        date: window.__dias.hoy, title:'Tulum', color:null });
      await DB.put('day_notes', { id:'dn2', trip_id:'trip-demo-1', profile:dataProfile(),
        date: window.__dias.manana, title:'Playa del Carmen', color:'verde' });
      await Router.go('trip', { tripId:'trip-demo-1', tab:'planning' });
    }, tema);
    await sleep(p, 2500);
    await p.evaluate((d) => TripDetail._irADia(d), (await p.evaluate(() => window.__dias)).hoy);
    await sleep(p, 1500);
  };

  titulo('EN CLARO');
  await pintar('claro');
  let m = await medir();
  ok(m.length > 0, 'la etiqueta del día está en la fila de resumen', m.map((x) => x.txt));
  const tulum = m.find((x) => x.txt === 'Tulum');
  ok(tulum.padding > 6 && tulum.borde >= 1 && tulum.radio > 8,
    'y se dibuja como pastilla: acolchado, borde y esquinas redondas', tulum);
  ok(tulum.peso >= 700, 'con el peso de una etiqueta, no el del texto de al lado', tulum.peso);
  // 4,5:1 es el mínimo de WCAG AA para texto normal. Antes de esto la etiqueta
  // iba con `var(--accent)` sobre un fondo del MISMO accent.
  ok(tulum.contraste >= 4.5, 'el texto se lee sobre su fondo', `${tulum.contraste}:1`);
  ok(tulum.contraDetras >= 1.08, 'y la pastilla se despega de la cabecera del día',
    `${tulum.contraDetras}:1`);
  await p.screenshot({ path: captura('etiqueta-dia-claro.png') });

  titulo('EL COLOR ELEGIDO MANDA');
  // La regla de dentro de la tarjeta tiene más peso que `.color-verde`: si
  // declarara ahí las variables en vez de solo leerlas, todas las etiquetas
  // saldrían azules pusieras el color que pusieras.
  await p.evaluate((d) => TripDetail._irADia(d), (await p.evaluate(() => window.__dias)).manana);
  await sleep(p, 1500);
  const verde = (await medir()).find((x) => x.txt === 'Playa del Carmen');
  ok(verde, 'el día de mañana tiene su etiqueta');
  const [r, g, b] = verde.fondo.match(/[\d.]+/g).map(Number);
  ok(g > r && g > b, 'una etiqueta verde sale verde, no del color de la app', verde.fondo);
  ok(verde.contraste >= 4.5, 'y también se lee', `${verde.contraste}:1`);

  titulo('EN OSCURO');
  await pintar('oscuro');
  m = await medir();
  const tulumOsc = m.find((x) => x.txt === 'Tulum');
  // En oscuro el fondo tintado ya es oscuro: el texto tiene que ir CLARO. Si se
  // oscureciera como en el tema claro, sería negro sobre negro.
  ok(tulumOsc.contraste >= 4.5, 'el texto se lee también en oscuro', `${tulumOsc.contraste}:1`);
  const verdeOsc = m.find((x) => x.txt === 'Playa del Carmen');
  if (verdeOsc) ok(verdeOsc.contraste >= 4.5, 'y las de color, igual', `${verdeOsc.contraste}:1`);
  await p.screenshot({ path: captura('etiqueta-dia-oscuro.png') });

  titulo('Y CON EL TEMA DEL SISTEMA, LO MISMO');
  // `:root:not([data-tema])` es "no has elegido, manda el sistema". Las reglas
  // de oscuro van por duplicado y es fácil que se quede una sola.
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.evaluate(() => document.documentElement.removeAttribute('data-tema'));
  await sleep(p, 800);
  const auto = (await medir()).find((x) => x.txt === 'Tulum');
  ok(auto && auto.contraste >= 4.5,
    'sin tema elegido y con el sistema en oscuro, sigue leyéndose', auto && `${auto.contraste}:1`);

  titulo('Y EN LA TIRA DE DÍAS, AL PASAR POR ENCIMA');
  // En la pastilla de la tira no cabe (son 54 px), pero la tira es por donde se
  // navega: saber qué es cada día sin entrar en él es justo su trabajo.
  await p.emulateMedia({ colorScheme: 'light' });
  await pintar('claro');
  const tira = await p.evaluate(() => {
    const d = window.__dias;
    const c = (k) => { const n = document.querySelector(`.day-pill[data-day="${k}"]`);
      return n ? { title: n.getAttribute('title'), aria: n.getAttribute('aria-label') } : null; };
    return { hoy: c(d.hoy), manana: c(d.manana), sinEtiqueta: c(d.pasado) };
  });
  ok(/Tulum/.test(tira.hoy.title), 'la etiqueta sale en el tooltip del día', tira.hoy.title);
  ok(/\d/.test(tira.hoy.title) && /Tulum/.test(tira.hoy.title),
    'sin perder la fecha larga, que es lo que ponía antes', tira.hoy.title);
  ok(/Tulum/.test(tira.hoy.aria), 'y también para quien va con lector de pantalla', tira.hoy.aria);
  ok(/Playa del Carmen/.test(tira.manana.title), 'cada día con la suya', tira.manana.title);
  ok(tira.sinEtiqueta && !/·/.test(tira.sinEtiqueta.title.replace(/,/g, '')),
    'y un día sin etiqueta se queda como estaba', tira.sinEtiqueta.title);

  terminar(errs);
  await cerrar();
})();
