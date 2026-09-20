const { abrir, espera: sleep, captura, ok, titulo, terminar, BASE } = require('../lib');

(async () => {
  const { page: p, errores: errs, cerrar } = await abrir({ abrir: false });
  // Compartido: así salen también los botones que solo existen en ese caso.
  await p.evaluate(async()=>{ const t=await DB.get('trips','trip-demo-1'); t.is_shared=true;
    await DB.put('trips',t); await Router.go('trips'); });
  await sleep(p,1400);
  const PROHIBIDO = /borrar|elimin|papelera|vaciar|purgar|restaurar|descartar|salir|cerrar sesión|perfil|explorar|compartir|exportar|importar|pdf|descargar/i;
  const pulsarTodo = async (nombre) => {
    const n = await p.evaluate(()=>document.querySelectorAll('#view-root button').length);
    let pulsados = 0;
    for (let i=0;i<n;i++) {
      const info = await p.evaluate((i)=>{
        const bs=[...document.querySelectorAll('#view-root button')];
        const b=bs[i]; if(!b) return null;
        const et=(b.title||b.getAttribute('aria-label')||b.textContent||'').trim().slice(0,40);
        return { et, visible: !!b.offsetParent };
      }, i);
      if (!info || !info.visible || PROHIBIDO.test(info.et)) continue;
      await p.evaluate((i)=>{ const b=[...document.querySelectorAll('#view-root button')][i]; b&&b.click(); }, i).catch(()=>{});
      pulsados++;
      await sleep(p,450);
      // cerrar lo que se haya abierto y volver a la pestaña
      await p.evaluate(()=>{ try{UI.closeSheet();}catch(_){}
        document.querySelectorAll('.detailview,.flashview,.calview,.wrf-overlay').forEach(x=>x.remove()); });
      await sleep(p,250);
      const vivo = await p.evaluate(()=>typeof STATE!=='undefined').catch(()=>false);
      if (!vivo) {   // algún botón se llevó la página fuera: volver
        await p.goto(BASE); await sleep(p,900);
        await p.evaluate(()=>{ try{ localStorage.setItem('viajes_profile','rafa'); }catch(_){} }).catch(()=>{});
        await p.reload(); await sleep(p,900);
        return;
      }
    }
    console.log('· ' + nombre + ': ' + pulsados + ' botones pulsados' + (errs.length? '  ⚠ ' + errs.length + ' errores' : ''));
  };
  await pulsarTodo('listado de viajes');
  for (const tb of ['resumen','planning','presu','maleta','reservas','destino','diario','estadisticas','pendientes','gastos','mapa']) {
    await p.evaluate(async(x)=>{ STATE.currentTab=x; await Router.go('trip',{tripId:'trip-demo-1',tab:x}); }, tb);
    await sleep(p,1300);
    const antes = errs.length;
    await pulsarTodo('pestaña ' + tb);
    if (errs.length > antes) console.log('    ⚠ nuevos: ' + errs.slice(antes).join(' | ').slice(0,300));
  }
  terminar(errs);
  await cerrar();
})();
