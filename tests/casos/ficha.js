const { abrir, espera: sleep, captura, ok, titulo, terminar } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir();
  const c = await p.context().newCDPSession(p);
  const pt=(x,y)=>[{x,y,radiusX:5,radiusY:5,force:1}];
  const arrastrar = async (x,y,dx,dy,pasos=14) => {
    await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:pt(x,y)});
    for(let s=1;s<=pasos;s++){ await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:pt(Math.round(x+dx*s/pasos),Math.round(y+dy*s/pasos))}); await sleep(p,16); }
    await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await sleep(p,900);
  };
  console.log('— FICHA DEL EVENTO —');
  await p.evaluate(()=>{ const pg=document.querySelector('.plan-pager');
    const pag=[...pg.querySelectorAll('.plan-page')].find(x=>x.querySelector('.timeline-item:not(.virtual)'));
    TripDetail._irADia(pag.dataset.day,{animar:false}); });
  await sleep(p,1000);
  await p.evaluate(()=>{ const it=document.querySelector('.plan-page[data-day="'+TripDetail._diaVisible+'"] .timeline-item');
    (it.querySelector('.li-main')||it).click(); });
  await sleep(p,1000);
  const f = await p.evaluate(()=>{
    const d=document.querySelector('.detailview'); if(!d) return null;
    const r=d.getBoundingClientRect();
    return { pantallaCompleta: Math.round(r.width)>=innerWidth-1 && Math.round(r.height)>=innerHeight-1,
             editar: !!d.querySelector('.dv-edit'), titulo:(d.querySelector('.dv-title')||{}).textContent,
             bloques:[...d.querySelectorAll('.dv-bloque, .dv-campo, .dv-row')].length, listo:d.classList.contains('dv-listo') };
  });
  ok(f && f.pantallaCompleta, '8a) la ficha ocupa toda la pantalla', f&&JSON.stringify({t:f.titulo,b:f.bloques}));
  ok(f && f.editar, '8b) botón de editar en la ficha');
  ok(f && f.listo, '9) la animación de entrada termina (dv-listo)');
  await p.screenshot({path:captura('z1-ficha.png')});
  // cerrar deslizando hacia abajo
  await arrastrar(195, 300, 0, 260, 16);
  ok(await p.evaluate(()=>!document.querySelector('.detailview')), '12) se cierra deslizando hacia abajo');
  ok(await p.evaluate(()=>!!document.querySelector('.plan-pager')), '12b) vuelve al planning donde estaba',
     await p.evaluate(()=>TripDetail._diaVisible));
  // cambio de tipo desde la ficha
  console.log('— CAMBIO DE TIPO —');
  await p.evaluate(()=>{ const it=document.querySelector('.plan-page[data-day="'+TripDetail._diaVisible+'"] .timeline-item:not(.virtual)');
    (it.querySelector('.li-main')||it).click(); });
  await sleep(p,1000);
  const idAntes = await p.evaluate(()=>{ const d=document.querySelector('.detailview'); return d && d.dataset.id; });
  await p.evaluate(()=>document.querySelector('.detailview .dv-edit').click()); await sleep(p,900);
  await p.evaluate(()=>{const t=[...document.querySelectorAll('.wz-tab')].find(b=>/Tipo/.test(b.textContent)); t&&t.click();});
  await sleep(p,400);
  await p.evaluate(()=>{const c=[...document.querySelectorAll('.wz-cell')].find(x=>/Actividad/.test(x.textContent)); c&&c.click();});
  await sleep(p,400);
  await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^Guardar/.test(x.textContent.trim())); b&&b.click();});
  await sleep(p,1600);
  const tras = await p.evaluate(()=>{
    const filas=[...document.querySelectorAll('.plan-page[data-day="'+TripDetail._diaVisible+'"] .timeline-item')];
    return { actividad: filas.some(f=>f.classList.contains('type-actividad')), n:filas.length, hoja:!!document.querySelector('#sheet.show') };
  });
  ok(tras.actividad, '5-6) el cambio de tipo se ve al momento en el planning', JSON.stringify(tras));
  terminar(errs);
  await cerrar();
})();
