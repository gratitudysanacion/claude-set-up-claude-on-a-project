'use strict';
// Panel inicial independiente. No desplegar en Internet sin HTTPS, contraseña fuerte y revisión de seguridad.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data', 'catalogo.json');
const PORT = Number(process.env.PORT || 3081);
const HOST = process.env.HOST || '127.0.0.1';
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASSWORD;
if (!PASS || PASS.length < 16) { console.error('Configura ADMIN_PASSWORD con al menos 16 caracteres.'); process.exit(1); }
const sessions = new Map();
// Seguridad de acceso: expiración de sesión y límite de intentos de login.
// Los valores por defecto son los de producción; las variables de entorno solo existen para poder probarlos.
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 8*60*60*1000;
const LOGIN_MAX_FAILS = Number(process.env.LOGIN_MAX_FAILS) || 5;
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS) || 10*60*1000;
const LOGIN_LOCK_MS = Number(process.env.LOGIN_LOCK_MS) || 15*60*1000;
const attempts = new Map();
const sha = v => crypto.createHash('sha256').update(String(v ?? '')).digest();
const USER_HASH = sha(USER), PASS_HASH = sha(PASS);
function credentialsOk(u,p){const a=crypto.timingSafeEqual(sha(u),USER_HASH);const b=crypto.timingSafeEqual(sha(p),PASS_HASH);return a&&b;}
function clientIp(req){const h=String(req.headers['x-real-ip']||'').trim();return h&&h.length<=45?h:req.socket.remoteAddress||'desconocida';}
function lockedFor(ip){const a=attempts.get(ip);return a&&a.lockedUntil>Date.now()?a.lockedUntil-Date.now():0;}
function registerFail(ip){const now=Date.now();const a=attempts.get(ip)||{fails:[],lockedUntil:0};a.fails=a.fails.filter(t=>now-t<LOGIN_WINDOW_MS);a.fails.push(now);if(a.fails.length>=LOGIN_MAX_FAILS){a.lockedUntil=now+LOGIN_LOCK_MS;a.fails=[];}attempts.set(ip,a);}
function sessionOf(req){const m=(req.headers.cookie||'').match(/(?:^|; )yanbal_session=([^;]+)/);return m?m[1]:null;}
setInterval(()=>{const now=Date.now();for(const [t,ts] of sessions)if(now-ts>SESSION_TTL_MS)sessions.delete(t);for(const [ip,a] of attempts)if(a.lockedUntil<now&&!a.fails.some(t=>now-t<LOGIN_WINDOW_MS))attempts.delete(ip);},10*60*1000).unref();
function readDb(){ return JSON.parse(fs.readFileSync(DATA,'utf8')); }
function writeDb(db){ const tmp=DATA+'.tmp'; fs.writeFileSync(tmp, JSON.stringify(db,null,2)); fs.renameSync(tmp,DATA); }
function send(res, status, data, type='application/json; charset=utf-8'){res.writeHead(status,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"});res.end(type.startsWith('application/json')?JSON.stringify(data):data);}
function body(req,max=2e6){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>max){reject(new Error('Cuerpo demasiado grande'));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'));}catch(e){reject(e);}});});}
function authed(req){const t=sessionOf(req);if(!t)return false;const ts=sessions.get(t);if(!ts)return false;if(Date.now()-ts>SESSION_TTL_MS){sessions.delete(t);return false;}return true;}
function auth(req,res){if(!authed(req)){send(res,401,{error:'Inicia sesión para continuar.'});return false;}return true;}
function clean(v,max=300){return String(v??'').trim().slice(0,max);}
function product(p){return {id:clean(p.id,80)||crypto.randomUUID(),nombre:clean(p.nombre,200),referencia:clean(p.referencia,80),categoria:clean(p.categoria,100),presentacion:clean(p.presentacion,160),precio_normal:p.precio_normal===''||p.precio_normal==null?null:Number(p.precio_normal),precio_oferta:p.precio_oferta===''||p.precio_oferta==null?null:Number(p.precio_oferta),promocion:clean(p.promocion,500),vigencia_desde:clean(p.vigencia_desde,10),vigencia_hasta:clean(p.vigencia_hasta,10),pagina_origen:clean(p.pagina_origen,30),estado:clean(p.estado,30)||'pendiente_revision',notas:clean(p.notas,1000),origen:clean(p.origen,100),aviso_revision:clean(p.aviso_revision,1000),estado_importacion:clean(p.estado_importacion,30),actualizado_en:new Date().toISOString()};}
const server=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&u.pathname==='/app.js'){
  const file=path.join(ROOT,'public','app.js');
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())
    return send(res,404,{error:'Archivo no encontrado.'});
  return send(res,200,fs.readFileSync(file,'utf8'),'application/javascript; charset=utf-8');
}
if(req.method==='GET'&&u.pathname==='/health')return send(res,200,{status:'ok',application:'Yanbal Catalog Admin Starter'});
 if(req.method==='GET'&&u.pathname==='/')return send(res,200,fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8'),'text/html; charset=utf-8');
 if(req.method==='POST'&&u.pathname==='/api/login'){const ip=clientIp(req);const wait=lockedFor(ip);if(wait){res.setHeader('Retry-After',String(Math.ceil(wait/1000)));return send(res,429,{error:'Demasiados intentos. Intenta de nuevo más tarde.'});}try{const b=await body(req,4096);if(!credentialsOk(b.username,b.password)){registerFail(ip);return send(res,401,{error:'Usuario o contraseña incorrectos.'});}attempts.delete(ip);const token=crypto.randomBytes(32).toString('hex');sessions.set(token,Date.now());res.setHeader('Set-Cookie',`yanbal_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS/1000)}`);return send(res,200,{ok:true});}catch(e){registerFail(ip);return send(res,400,{error:'Solicitud no válida.'});}}
 if(req.method==='POST'&&u.pathname==='/api/logout'){const t=sessionOf(req);if(t)sessions.delete(t);res.setHeader('Set-Cookie','yanbal_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{ok:true});}
 if(u.pathname.startsWith('/api/')&&!auth(req,res))return;
 if(req.method==='GET'&&u.pathname==='/api/products'){const db=readDb();return send(res,200,{productos:db.productos,historial:db.historial,version:db.version});}
 if(req.method==='POST'&&u.pathname==='/api/products'){try{const b=await body(req);const p=product(b);if(!p.nombre||!p.referencia)return send(res,400,{error:'Nombre y referencia son obligatorios.'});for(const k of ['precio_normal','precio_oferta'])if(p[k]!==null&&(!Number.isFinite(p[k])||p[k]<0))return send(res,400,{error:'Los precios deben ser números no negativos.'});const db=readDb();const i=db.productos.findIndex(x=>x.id===p.id);if(i>=0){db.historial.push({fecha:new Date().toISOString(),id:p.id,referencia:p.referencia,accion:'actualización',antes:db.productos[i],despues:p});db.productos[i]=p;}else{db.historial.push({fecha:new Date().toISOString(),id:p.id,referencia:p.referencia,accion:'creación',despues:p});db.productos.push(p);}writeDb(db);return send(res,200,{ok:true,producto:p});}catch(e){return send(res,400,{error:'No se pudo guardar el producto.'});}}
 if(req.method==='DELETE'&&u.pathname.startsWith('/api/products/')){const id=decodeURIComponent(u.pathname.split('/').pop());const db=readDb();const i=db.productos.findIndex(p=>p.id===id);if(i<0)return send(res,404,{error:'Producto no encontrado.'});const old=db.productos.splice(i,1)[0];db.historial.push({fecha:new Date().toISOString(),id,referencia:old.referencia,accion:'eliminación',antes:old});writeDb(db);return send(res,200,{ok:true});}
 if(req.method==='GET'&&u.pathname==='/api/export'){const db=readDb();const cols=['id','nombre','referencia','categoria','presentacion','precio_normal','precio_oferta','promocion','vigencia_desde','vigencia_hasta','pagina_origen','estado','notas'];const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const csv='\ufeff'+[cols.join(';'),...db.productos.map(p=>cols.map(c=>esc(p[c])).join(';'))].join('\r\n');return send(res,200,csv,'text/csv; charset=utf-8');}
 
  // YANBAL_IMPORT_PREVIEW_V1
  if(req.method==='GET'&&u.pathname==='/api/import/preview'){
    try{
      const prepared=JSON.parse(fs.readFileSync('/tmp/yanbal_catalogo_consolidado.json','utf8'));
      const productos=prepared.productos;
      const counts={};
      for(const p of productos) counts[p.estado]=(counts[p.estado]||0)+1;
      const detalle=u.searchParams.get('detalle')==='1';
      return send(res,200,{
        total:productos.length,
        estados:counts,
        muestra:productos.slice(0,12).map(p=>({
          nombre:p.nombre,
          referencia:p.referencia,
          categoria:p.categoria,
          precio_normal:p.precio_normal,
          precio_oferta:p.precio_oferta,
          estado:p.estado,
          origen:p.origen,
          aviso_revision:p.aviso_revision
        })),
        ...(detalle?{productos:productos}: {})
      });
    }catch(e){
      return send(res,500,{error:'No se pudo leer el catálogo preparado.'});
    }
  }

  if(req.method==='POST'&&u.pathname==='/api/import/confirm'){
    try{
      const b=await body(req);
      const prepared=JSON.parse(fs.readFileSync('/tmp/yanbal_catalogo_consolidado.json','utf8'));
      const productos=prepared.productos.map(p=>({...p,estado_importacion:p.estado,estado:'pendiente_revision'}));
      if(b.confirmText!=='IMPORTAR 437 PRODUCTOS')
        return send(res,400,{error:'Confirmación incorrecta. No se importó nada.'});
      if(productos.length!==437)
        return send(res,400,{error:'El número de productos cambió. No se importó nada.'});

      const allowed=new Set(['Valido','Doble','Sin precio','No informado']);
      const ids=new Set();
      for(const p of productos){
        if(!p || !p.id || ids.has(String(p.id)) || !allowed.has(p.estado_importacion))
          return send(res,400,{error:'El catálogo contiene registros inválidos o duplicados.'});
        ids.add(String(p.id));
        for(const k of ['precio_normal','precio_oferta']){
          if(p[k]!==null && p[k]!=='' && (!Number.isFinite(Number(p[k])) || Number(p[k])<0))
            return send(res,400,{error:'Se encontró un precio inválido.'});
        }
      }

      const db=readDb();
      const backupDir=path.join(ROOT,'data','backups');
      fs.mkdirSync(backupDir,{recursive:true});
      const backupFile=path.join(backupDir,'catalogo-antes-importacion-'+Date.now()+'.json');
      fs.copyFileSync(DATA,backupFile);
      JSON.parse(fs.readFileSync(backupFile,'utf8'));

      const antes=db.productos.length;
      db.productos=productos;
      db.historial.push({
        fecha:new Date().toISOString(),
        accion:'importación masiva',
        cantidad:productos.length,
        productos_anteriores:antes,
        respaldo:backupFile
      });
      writeDb(db);
      return send(res,200,{
        ok:true,
        importados:productos.length,
        anteriores:antes,
        historial:db.historial.length
      });
    }catch(e){
      console.error('Error en importación:',e.message);
      return send(res,500,{error:'No se pudo completar la importación. Revisa el catálogo y el respaldo.'});
    }
  }

  return send(res,404,{error:'Ruta no encontrada.'});
});
server.listen(PORT,HOST,()=>console.log(`Yanbal Catalog Admin escuchando en http://${HOST}:${PORT}`));
