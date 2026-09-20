const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir();
  // Dos paradas propias: una actividad (pastilla de hora) y una comida (disco).
  const dia = await p.evaluate(async()=>{
    const d = window.__dias.manana;
    for (const it of [
      { id:'act-1', type:'actividad', title:'Teleférico', time:'10:00', order_index:0 },
      { id:'com-1', type:'comida',    title:'Almuerzo',   time:'14:00', order_index:1 },
    ]) await DB.put('planning_items', { ...it, trip_id:'trip-demo-1', profile:STATE.profile, day_date:d });
    await Router.render();
    return d;
  });
  await sleep(p,1200);
  await p.evaluate((d)=>TripDetail._irADia(d,{animar:false}), dia); await sleep(p,1200);
  console.log('— APAGAR ACTIVIDAD Y RESTAURANTE (req. 11) —');
  const r = await p.evaluate(async(d)=>{
    const pag=document.querySelector(`.plan-page[data-day="${d}"]`);
    const salida={};
    const pill=pag.querySelector('.timeline-item[data-id="act-1"] .li-time.li-mark, .timeline-item[data-id="act-1"] .li-time');
    if (pill) { const antes=getComputedStyle(pill).backgroundColor;
      pill.click(); await new Promise(r=>setTimeout(r,600));
      const card=pag.querySelector('.timeline-item[data-id="act-1"]');
      salida.actividad={ marcable:pill.classList.contains('li-mark'), visto:card.classList.contains('visited'),
        antes, ahora:getComputedStyle(pag.querySelector('.timeline-item[data-id="act-1"] .li-time')).backgroundColor,
        tituloOpac:getComputedStyle(card.querySelector('.li-title')).opacity, filtro:getComputedStyle(card).filter };
    }
    const disco=pag.querySelector('.timeline-item[data-id="com-1"] .li-meal');
    if (disco) { disco.click(); await new Promise(r=>setTimeout(r,600));
      const card=pag.querySelector('.timeline-item[data-id="com-1"]');
      salida.comida={ marcable:disco.classList.contains('li-mark'), visto:card.classList.contains('visited') };
    }
    return salida;
  }, dia);
  ok(r.actividad && r.actividad.visto && r.actividad.antes!==r.actividad.ahora,
     '11b) la pastilla de la hora apaga su morado al marcarla', JSON.stringify(r.actividad));
  ok(r.comida && r.comida.visto, '11c) el restaurante se marca desde su disco', JSON.stringify(r.comida));
  await p.screenshot({path:captura('z2-apagados.png')});
  console.log('— RESUMEN Y PESTAÑAS —');
  await p.evaluate(()=>TripDetail.irAPestana('resumen',-1)); await sleep(p,1400);
  const res = await p.evaluate(()=>({
    hero:!!document.querySelector('.res-hero .res-badge'),
    filas:[...document.querySelectorAll('.res-fila')].map(f=>f.querySelector('.res-fila-lbl').textContent),
    rejillaVieja:!!document.querySelector('#tab-panel .metric-grid'),
    scroll:Math.round((document.scrollingElement||{}).scrollTop) }));
  ok(res.hero && res.filas.length>=3 && !res.rejillaVieja, '20a) resumen con cuadradito y panel de filas', JSON.stringify(res));
  ok(res.scroll===0, '20b) al cambiar de pestaña se empieza por arriba', String(res.scroll));
  const c = await p.context().newCDPSession(p);
  const pt=(x,y)=>[{x,y,radiusX:5,radiusY:5,force:1}];
  const swipe = async (x,y,dx) => { await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:pt(x,y)});
    for(let s=1;s<=12;s++){ await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:pt(Math.round(x+dx*s/12),y)}); await sleep(p,14); }
    await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await sleep(p,1200); };
  await swipe(195,480,-230);
  ok(await p.evaluate(()=>STATE.currentTab==='planning'), '20c) deslizar cambia de pestaña');
  const antesDia = await p.evaluate(()=>TripDetail._diaVisible);
  await swipe(195,560,-230);
  const trasDia = await p.evaluate(()=>({tab:STATE.currentTab, dia:TripDetail._diaVisible}));
  ok(trasDia.tab==='planning' && trasDia.dia!==antesDia, '20d) sobre el carrusel manda el día, no la pestaña', antesDia+' → '+JSON.stringify(trasDia));
  terminar(errs);
  await cerrar();
})();
