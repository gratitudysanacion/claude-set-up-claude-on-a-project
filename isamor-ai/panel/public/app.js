const $=id=>document.getElementById(id);let products=[];const fields=['id','nombre','referencia','categoria','presentacion','precio_normal','precio_oferta','promocion','vigencia_desde','vigencia_hasta','pagina_origen','estado','notas'];const money=n=>n==null||n===''?'—':new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(n));async function api(url,opts={}){const r=await fetch(url,{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Error en la solicitud');return d;}function showApp(){ $('login').classList.add('hidden');$('app').classList.remove('hidden');load();}async function load(){try{const d=await api('/api/products');products=d.productos||[];render();}catch(e){$('formMsg').textContent=e.message;}}function render(){const q=$('filter').value.toLowerCase();const list=products.filter(p=>[p.nombre,p.referencia,p.categoria].join(' ').toLowerCase().includes(q));$('count').textContent=products.length;$('rows').innerHTML=list.map(p=>`<tr><td>${esc(p.nombre)}<br><small>${esc(p.categoria||'')}</small></td><td>${esc(p.referencia)}</td><td>${money(p.precio_normal)}</td><td>${money(p.precio_oferta)}</td><td><span class="badge">${esc(p.estado||'pendiente_revision')}</span></td><td><button data-edit="${esc(p.id)}">Editar</button><button class="secondary" data-del="${esc(p.id)}">Eliminar</button></td></tr>`).join('')||'<tr><td colspan="6">No hay productos para mostrar.</td></tr>';document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(b.dataset.edit));document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>del(b.dataset.del));}function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}function edit(id){const p=products.find(x=>x.id===id);if(!p)return;fields.forEach(k=>$(k).value=p[k]??'');$('formTitle').textContent='Editar producto';$('formMsg').textContent='';window.scrollTo({top:0,behavior:'smooth'});}function clearForm(){fields.forEach(k=>$(k).value='');$('estado').value='pendiente_revision';$('formTitle').textContent='Agregar producto';$('formMsg').textContent='';} $('loginBtn').onclick=async()=>{try{await api('/api/login',{method:'POST',body:JSON.stringify({username:$('user').value,password:$('pass').value})});showApp();}catch(e){$('loginMsg').textContent=e.message;}};$('saveBtn').onclick=async()=>{const p={};fields.forEach(k=>p[k]=$(k).value);for(const k of ['precio_normal','precio_oferta'])p[k]=p[k]===''?null:Number(p[k]);try{await api('/api/products',{method:'POST',body:JSON.stringify(p)});$('formMsg').textContent='Producto guardado. El cambio quedó registrado en el historial.';clearForm();await load();}catch(e){$('formMsg').textContent=e.message;}};$('clearBtn').onclick=clearForm;$('refreshBtn').onclick=load;$('filter').oninput=render;$('logoutBtn').onclick=async()=>{await api('/api/logout',{method:'POST'});location.reload();};async function del(id){if(!confirm('¿Eliminar este producto? La acción quedará en el historial.'))return;try{await api('/api/products/'+encodeURIComponent(id),{method:'DELETE'});await load();}catch(e){alert(e.message);}}


// YANBAL_IMPORT_UI_V1
(function(){
  const previewBtn=document.getElementById('previewImportBtn');
  const confirmBtn=document.getElementById('confirmImportBtn');
  if(!previewBtn||!confirmBtn)return;
  let previewReady=false;

  previewBtn.onclick=async()=>{
    const msg=document.getElementById('importPreviewMsg');
    const result=document.getElementById('importPreviewResult');
    const area=document.getElementById('importConfirmArea');
    previewReady=false;
    area.classList.add('hidden');
    result.innerHTML='';
    msg.textContent='Consultando catálogo...';
    try{
      const d=await api('/api/import/preview');
      const counts=Object.entries(d.estados||{}).map(([k,v])=>`${k}: ${v}`).join(' · ');
      const table=(d.muestra||[]).map(p=>
        `<tr><td>${esc(p.nombre||'')}</td><td>${esc(p.referencia||'')}</td><td>${esc(p.categoria||'')}</td><td>${money(p.precio_normal)}</td><td>${money(p.precio_oferta)}</td><td>${esc(p.estado||'')}</td></tr>`
      ).join('');
      result.innerHTML=`<p><strong>Total:</strong> ${Number(d.total)||0}</p><p>${esc(counts)}</p><p>Muestra de los primeros 12 registros:</p><div class="tablewrap"><table><thead><tr><th>Producto</th><th>Código</th><th>Categoría</th><th>Precio normal</th><th>Oferta</th><th>Estado</th></tr></thead><tbody>${table}</tbody></table></div>`;
      if(d.total===437){
        previewReady=true;
        area.classList.remove('hidden');
        msg.textContent='Vista previa lista. Revisa los estados y la muestra antes de confirmar.';
      }else{
        msg.textContent='El total no es 437. No se habilitó la confirmación.';
      }
    }catch(e){msg.textContent=e.message||'No se pudo cargar la vista previa.';}
  };

  confirmBtn.onclick=async()=>{
    if(!previewReady)return;
    const input=document.getElementById('importConfirmText');
    if(input.value.trim()!=='IMPORTAR 437 PRODUCTOS'){
      document.getElementById('importPreviewMsg').textContent='El texto de confirmación no coincide. No se importó nada.';
      return;
    }
    if(!confirm('La importación reemplazará los productos actuales del panel. El historial se conservará y se creará un respaldo. ¿Deseas continuar?'))return;
    confirmBtn.disabled=true;
    document.getElementById('importPreviewMsg').textContent='Importando...';
    try{
      const d=await api('/api/import/confirm',{method:'POST',body:JSON.stringify({confirmText:input.value.trim()})});
      document.getElementById('importPreviewMsg').textContent=`Importación completada: ${d.importados} productos. Productos anteriores: ${d.anteriores}.`;
      document.getElementById('importConfirmArea').classList.add('hidden');
      previewReady=false;
      await load();
    }catch(e){
      document.getElementById('importPreviewMsg').textContent=e.message||'No se pudo completar la importación.';
    }finally{confirmBtn.disabled=false;}
  };
})();


// YANBAL_REVISION_VISUAL_V1
(function(){
  const button=document.getElementById('revisionCargarBtn');
  if(!button)return;

  let registros=[];

  const moneyRevision=v=>{
    if(v===null||v===undefined||v==='')return 'No informado';
    const n=Number(v);
    if(!Number.isFinite(n)||n===0)return 'No informado';
    return new Intl.NumberFormat('es-CO',{
      style:'currency',currency:'COP',maximumFractionDigits:0
    }).format(n);
  };

  function renderRevision(){
    const estado=document.getElementById('revisionEstado').value;
    const q=document.getElementById('revisionBuscar').value.trim().toLowerCase();
    const lista=registros.filter(p=>{
      const coincideEstado=estado==='Todos'||p.estado===estado;
      const texto=[p.nombre,p.referencia,p.categoria,p.origen,p.aviso_revision].join(' ').toLowerCase();
      return coincideEstado&&texto.includes(q);
    });

    document.getElementById('revisionMensaje').textContent=
      `Se muestran ${lista.length} registros de ${registros.length} cargados. Los precios en cero se muestran como “No informado”.`;

    const tabla=document.getElementById('revisionTabla');
    if(!lista.length){
      tabla.innerHTML='<p>No hay registros que coincidan con el filtro.</p>';
      return;
    }

    tabla.innerHTML=`<table>
      <thead><tr>
        <th>Producto</th><th>Código</th><th>Categoría</th>
        <th>Precio normal</th><th>Oferta</th><th>Origen</th>
        <th>Estado</th><th>Advertencia</th>
      </tr></thead>
      <tbody>${lista.map(p=>`<tr>
        <td>${esc(p.nombre||'')}</td>
        <td>${esc(p.referencia||'Sin código')}</td>
        <td>${esc(p.categoria||'')}</td>
        <td>${esc(moneyRevision(p.precio_normal))}</td>
        <td>${esc(moneyRevision(p.precio_oferta))}</td>
        <td>${esc(p.origen||'')}</td>
        <td><span class="badge">${esc(p.estado||'')}</span></td>
        <td>${esc(p.aviso_revision||'Sin advertencia registrada')}</td>
      </tr>`).join('')}</tbody></table>`;
  }

  button.onclick=async()=>{
    const msg=document.getElementById('revisionMensaje');
    msg.textContent='Cargando catálogo preparado...';
    document.getElementById('revisionTabla').innerHTML='';
    try{
      const d=await api('/api/import/preview?detalle=1');
      if(!Array.isArray(d.productos)){
        throw Error('El servidor no devolvió el detalle de los productos.');
      }
      registros=d.productos;
      renderRevision();
    }catch(e){
      msg.textContent=e.message||'No se pudo cargar el detalle.';
    }
  };

  document.getElementById('revisionEstado').onchange=renderRevision;
  document.getElementById('revisionBuscar').oninput=renderRevision;
})();
