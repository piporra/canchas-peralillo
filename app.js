/* Club de Tenis Peralillo · app de arriendo de canchas (Supabase) */
"use strict";

const COURTS=[{id:1,name:"Cancha 1",type:"Arcilla"},{id:2,name:"Cancha 2",type:"Arcilla"}];
const DEF_SEMANA=[[8,10],[10,12],[16,18],[18,20],[20,21]];
const DEF_FINDE=[[8,10],[10,12],[12,14],[14,16],[16,18]];
const MONTHS=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DAYS=["Dom.","Lun.","Mar.","Mié.","Jue.","Vie.","Sáb."];
const LABEL={confirmada:"Confirmada",anulada:"Anulada por el jugador",liberada:"Liberada por el club"};

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const hh=h=>String(h).padStart(2,"0")+":00";
const p2=n=>String(n).padStart(2,"0");
const key=d=>d.getFullYear()+"-"+p2(d.getMonth()+1)+"-"+p2(d.getDate());
const parse=k=>new Date(k+"T12:00:00");
const nice=k=>{const d=parse(k);return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].toLowerCase()}`};
const fmtAt=s=>{if(!s)return "";const d=new Date(s);return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0,3).toLowerCase()} ${p2(d.getHours())}:${p2(d.getMinutes())}`};
const errMsg=e=>(e&&(e.message||e.error_description))||"Ocurrió un error. Inténtalo de nuevo.";

const today=new Date();today.setHours(12,0,0,0);
const st={court:1,offset:0,date:key(today),hour:null,view:"book",adm:"ok",authMode:"login",
  uid:null,email:"",isAdmin:false,profile:null,
  club:{feriados:[],soloFinde:true,abreFindeDia:4,abreFeriadoDias:2,limiteDiario:1,diasAnticipacion:7},
  occupied:new Set(),who:new Map(),ladder:[],recent:[],alDia:new Set(),sinRes:[],resFree:null,cuotas:[],cuotaMes:null,socios:null,resTarget:null,mine:[],adminRes:[],draft:null,afterLogin:null};

/* ---------- reglas del club ---------- */
const toPairs=a=>(a||[]).map(x=>Array.isArray(x)?x:[x.ini,x.fin]);
function holidayName(k){const f=(st.club.feriados||[]).find(x=>x.fecha===k);return f?f.nombre:null}
function especial(k){const d=parse(k).getDay();return d===0||d===6||!!holidayName(k)}
function jSem(){const j=toPairs(st.club.jornadaSemana);return j.length?j:DEF_SEMANA}
function jFin(){const j=toPairs(st.club.jornadaFinde);return j.length?j:DEF_FINDE}
function blocksFor(k){return especial(k)?jFin():jSem()}
function endOf(k,h){const b=blocksFor(k).find(x=>x[0]===h);return b?b[1]:h+2}
const DIAS=()=>st.club.diasAnticipacion??7;
const ABRE_DIA=()=>st.club.abreFindeDia??4;      // 1=lunes … 5=viernes
const ABRE_FER=()=>st.club.abreFeriadoDias??2;
const LIM_DIA=()=>st.club.limiteDiario??1;
const SOLO=()=>!!st.club.soloFinde;
const DIA_NOMBRE=["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
const HORIZONTE=10;
function addDays(k,n){const d=parse(k);d.setDate(d.getDate()+n);return key(d)}
function apertura(k){
  const g=parse(k).getDay(),ops=[];
  if(g===6||g===0){const iso=g===0?7:6;ops.push(addDays(k,-(iso-ABRE_DIA())))}
  if(holidayName(k))ops.push(addDays(k,-ABRE_FER()));
  if(!ops.length)ops.push(addDays(k,-(DIAS()-1)));
  return ops.sort()[0];
}
function bookable(k){const t=key(today);return k>=t&&apertura(k)<=t&&(!SOLO()||especial(k))}
function firstBookable(){for(let i=0;i<HORIZONTE;i++){const k=addDays(key(today),i);if(bookable(k))return {k,i}}return null}
function nextOpen(){let best=null;for(let i=0;i<14;i++){const k=addDays(key(today),i);if(SOLO()&&!especial(k))continue;const ap=apertura(k);if(ap>key(today)&&(!best||ap<best.ap))best={k,ap}}return best}
function isTaken(k,c,h){if(k===key(today)&&h<=new Date().getHours())return true;return st.occupied.has(`${k}|${c}|${h}`)}
function played(r){const t=key(today);return r.fecha<t||(r.fecha===t&&r.hora<=new Date().getHours())}
function resultOf(id){return st.recent.find(m=>m.reserva_id===id)}
function setsTxt(sets,flip){return (sets||[]).map(([a,b])=>flip?`${b}-${a}`:`${a}-${b}`).join(" · ")}
const placed=()=>st.ladder.filter(x=>x.clasificado!==false);
function challengeInfo(){
  const me=st.ladder.find(x=>x.id===st.uid);
  if(!me)return "Apareces en la escalerilla al crear tu cuenta.";
  if(me.clasificado===false||me.pj<2)return `Te ${2-me.pj===1?"queda 1 partido":"quedan 2 partidos"} de libre elección: puedes desafiar a cualquier socio.`;
  if(me.puesto===1)return "Estás en el puesto 1. Te pueden desafiar los 5 puestos de abajo.";
  const t=placed().filter(x=>x.puesto<me.puesto&&x.puesto>=me.puesto-5).map(x=>`${x.puesto}. ${x.nombre}`);
  return `Puedes desafiar a: ${t.join(", ")}.`;
}
function myDayCount(k){return st.mine.filter(r=>r.estado==="confirmada"&&r.fecha===k).length}
function fmtJ(a){return a.map(([x,y])=>`${x}–${y}`).join(", ")+" h"}

/* ---------- conexión ---------- */
const CFG=window.CTP_CONFIG||{};
const configured=CFG.url&&CFG.anonKey&&!/TU-PROYECTO|TU-CLAVE/.test(CFG.url+CFG.anonKey);
const sb=configured?supabase.createClient(CFG.url,CFG.anonKey):null;
if(!configured)$("cfgErr").hidden=false;

async function loadConfig(){if(!sb)return;const {data}=await sb.from("config").select("datos").eq("id",1).maybeSingle();if(data&&data.datos)st.club={...st.club,...data.datos}}
async function loadOccupied(){if(!sb)return;const end=new Date(today);end.setDate(end.getDate()+14);
  const args={desde:key(today),hasta:key(end)};
  let {data,error}=st.uid?await sb.rpc("agenda_v2",args):await sb.rpc("ocupados",args);
  if(error&&st.uid)({data,error}=await sb.rpc("agenda",args));if(error)return;
  st.occupied=new Set((data||[]).map(r=>`${r.fecha}|${r.cancha}|${r.hora}`));
  st.who=new Map((data||[]).filter(r=>"nombre" in r).map(r=>[`${r.fecha}|${r.cancha}|${r.hora}`,{nombre:r.nombre,mio:r.es_mio,rival:r.rival,esc:r.escalerilla}]))}
async function loadMine(){st.mine=[];if(!sb||!st.uid)return;
  const {data}=await sb.from("reservas").select("*").eq("user_id",st.uid).gte("fecha",addDays(key(today),-45)).order("fecha").order("hora");st.mine=data||[]}
async function loadAdmin(){st.adminRes=[];st.sinRes=[];if(!sb||!st.isAdmin)return;
  sb.rpc("partidos_sin_reserva").then(({data})=>{st.sinRes=data||[];if(st.view==="admin"&&st.adm==="res")renderAdmin()});
  const {data}=await sb.from("reservas").select("*, perfiles(nombre,telefono)").gte("fecha",addDays(key(today),-45)).order("fecha").order("hora");st.adminRes=data||[]}
async function loadLadder(){st.ladder=[];st.recent=[];if(!sb||!st.uid)return;
  let [l,rc,ad]=await Promise.all([sb.rpc("ranking_v2"),sb.rpc("partidos_recientes",{p_limite:200}),sb.rpc("al_dia")]);
  if(l.error)l=await sb.rpc("ranking");  // si la base aún no tiene la regla nueva
  st.ladder=l.data||[];st.recent=rc.data||[];st.alDia=new Set((ad.data||[]).map(x=>x.id))}
function mesActual(){return key(today).slice(0,8)+"01"}
function mesNombre(m){const d=parse(m);return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`}
async function loadCuotas(){if(!st.isAdmin)return;st.cuotaMes=st.cuotaMes||mesActual();
  const {data,error}=await sb.rpc("cuotas_mes",{p_mes:st.cuotaMes});st.cuotas=error?[]:(data||[])}
async function refresh(){if(st.uid&&sb)await ensureSocios();await Promise.all([loadOccupied(),loadMine(),loadAdmin(),loadLadder()]);renderAll()}

async function onSession(session){
  st.uid=session?.user?.id||null;st.email=session?.user?.email||"";st.profile=null;st.isAdmin=false;
  if(st.uid){
    const [{data:p},{data:adm}]=await Promise.all([sb.from("perfiles").select("*").eq("id",st.uid).maybeSingle(),sb.rpc("es_admin")]);
    st.profile=p||null;st.isAdmin=!!adm;
  }
  $("navAdmin").hidden=!st.isAdmin;
  await refresh();
  if(st.uid&&!st.profile){openSetup(true);return}
  if(st.uid&&st.view==="auth"){const next=st.afterLogin;st.afterLogin=null;go(next||"book")}
  if(!st.uid&&["list","admin","result"].includes(st.view))go("book");
}

/* ---------- render ---------- */
function renderCourts(){$("courts").innerHTML=COURTS.map(c=>`<button class="court" aria-pressed="${st.court===c.id}" data-c="${c.id}"><b>${c.name}</b><small>${c.type}</small></button>`).join("")}
function renderDates(){
  const days=[];for(let i=0;i<5;i++){const d=new Date(today);d.setDate(today.getDate()+st.offset+i);days.push(d)}
  const m0=MONTHS[days[0].getMonth()],m1=MONTHS[days[4].getMonth()];
  $("month").textContent=m0===m1?m0:m0+" – "+m1;
  $("strip").innerHTML=days.map(d=>{const k=key(d),ok=bookable(k);
    const why=ok?"":(SOLO()&&!especial(k))?"Solo sábados, domingos y feriados":apertura(k)>key(today)?`Se abre el ${nice(apertura(k))}`:"No disponible";
    return `<button class="day" data-d="${k}" ${ok?"":`disabled title="${why}"`} aria-pressed="${k===st.date}"><b>${d.getDate()}</b><small>${DAYS[d.getDay()]}</small>${especial(k)?'<span class="free" title="Sábado, domingo o feriado"></span>':'<span class="nofree"></span>'}</button>`}).join("");
  $("prev").disabled=st.offset===0;$("next").disabled=st.offset+5>=HORIZONTE;
  const hol=holidayName(st.date);
  if(bookable(st.date))$("dayInfo").innerHTML=`<b>${esc(hol?"Feriado: "+hol:especial(st.date)?"Fin de semana":"Día hábil")}</b> · ${nice(st.date)} · sin costo para socios`;
  else{const no=nextOpen();$("dayInfo").innerHTML=no?`<b>Las reservas para el ${nice(no.k)} se abren el ${nice(no.ap)}.</b>`:"<b>No hay días disponibles por ahora.</b>"}
  $("winInfo").textContent=`Los fines de semana se reservan desde el ${DIA_NOMBRE[ABRE_DIA()]} y los feriados desde ${ABRE_FER()} ${ABRE_FER()===1?"día":"días"} antes.${LIM_DIA()?` Cada socio puede reservar ${LIM_DIA()===1?"una cancha":LIM_DIA()+" canchas"} por día.`:""}`;
}
function renderSlots(){
  if(!bookable(st.date)){$("slots").innerHTML="";return}
  $("slots").innerHTML=blocksFor(st.date).map(([h,e])=>{const t=isTaken(st.date,st.court,h);
    const w=st.who.get(`${st.date}|${st.court}|${h}`);
    const tag=w&&w.esc===true?" · Escalerilla":w&&w.esc===false?" · Amistoso":"";
    const lab=!t?"Disponible":w?(w.mio?`Tu reserva${w.rival?" vs "+esc(w.rival):""}${tag}`:w.rival?`${esc(w.nombre)} vs ${esc(w.rival)}${tag}`:`Reservada por ${esc(w.nombre)}${tag}`):st.occupied.has(`${st.date}|${st.court}|${h}`)?(st.uid?"Reservada":"Reservada · ingresa para ver por quién"):"No disponible";
    return `<button class="slot${w?" who":""}${w&&w.mio?" mine":""}" data-h="${h}" ${t?"disabled":""} aria-pressed="${st.hour===h}">${hh(h)} – ${hh(e)}<small>${lab}</small></button>`}).join("");
}
function renderCta(){
  const bar=$("ctaBar"),b=$("cta"),i=$("ctaInfo");
  if(st.view==="book"){bar.hidden=false;b.textContent="Siguiente";b.disabled=st.hour===null||!sb;
    i.textContent=st.hour===null?"Elige un horario disponible":`${COURTS[st.court-1].name} · ${nice(st.date)} · ${hh(st.hour)} – ${hh(endOf(st.date,st.hour))}`}
  else if(st.view==="confirm"){bar.hidden=false;b.disabled=false;b.textContent="Confirmar reserva";i.textContent="Revisa los datos antes de confirmar"}
  else if(st.view==="done"){bar.hidden=false;b.disabled=false;b.textContent="Hacer otra reserva";i.textContent=""}
  else bar.hidden=true;
}
function socioName(id){const s=(st.socios||[]).find(x=>x.id===id);return s?s.nombre:""}
function rivalTxt(r){return r.rival_id?socioName(r.rival_id):r.rival_nombre||""}
function tipoTxt(r){return r.escalerilla===true?"Escalerilla":r.escalerilla===false?"Amistoso":"Sin definir"}
function matchFields(px,cur,ownerId){
  const esc0=cur?cur.escalerilla:null,riv=cur?cur.rival_id:null,ext=cur&&!cur.rival_id?cur.rival_nombre:"";
  const opts=(st.socios||[]).filter(s=>s.id!==ownerId).map(s=>`<option value="${s.id}" ${riv===s.id?"selected":""}>${esc(s.nombre)}</option>`).join("");
  return `<div class="mf" data-px="${px}">
    <div style="font-size:13px;font-weight:700;margin-bottom:6px">¿Es partido de la escalerilla? <span style="color:var(--orange)">*</span></div>
    <div class="auth-tabs" id="${px}Tipo"><button type="button" data-tipo="1" aria-pressed="${esc0===true}">Sí, escalerilla</button><button type="button" data-tipo="0" aria-pressed="${esc0===false}">No, amistoso</button></div>
    <label for="${px}Rival" style="margin-top:12px">¿Con quién juegas?<select id="${px}Rival" class="selfull">
      <option value="">${"Elige un socio"}</option>${opts}
      <option value="__ext" ${ext?"selected":""}>Jugador externo o sin cuenta…</option>
      <option value="__none">Aún no sé</option></select></label>
    <input id="${px}Ext" placeholder="Nombre del jugador" style="margin-top:8px;width:100%" value="${esc(ext||"")}" ${ext?"":"hidden"}>
    <p class="note" id="${px}Hint" style="margin-top:6px"></p></div>`;
}
function mfSync(px){
  const sel=$(px+"Rival"),ext=$(px+"Ext"),hint=$(px+"Hint"),tipo=document.querySelector(`#${px}Tipo [aria-pressed="true"]`);
  ext.hidden=sel.value!=="__ext";
  const isEsc=tipo?tipo.dataset.tipo==="1":null;
  hint.textContent=isEsc===true?"Elige al socio de la lista. Si es socio pero aún no tiene cuenta, elige «Jugador externo o sin cuenta» y escribe su nombre.":
    isEsc===false?"Los amistosos no cuentan para la escalerilla.":"";
}
function mfRead(px,booking){
  const tipo=document.querySelector(`#${px}Tipo [aria-pressed="true"]`),v=$(px+"Rival").value,ext=$(px+"Ext").value.trim();
  if(!tipo)return {err:"Indica si es partido de la escalerilla."};
  const e=tipo.dataset.tipo==="1";
  if(v==="__ext"&&ext.length<2)return {err:"Escribe el nombre del jugador."};
  const rival=v&&!v.startsWith("__")?v:null,nombre=v==="__ext"?ext:null;
  if(e&&!rival&&!nombre)return {err:"Para un partido de escalerilla indica con quién juegas."};
  return {e,rival,nombre};
}
document.addEventListener("click",ev=>{const b=ev.target.closest(".mf [data-tipo]");if(!b)return;const box=b.closest(".mf");
  box.querySelectorAll("[data-tipo]").forEach(x=>x.setAttribute("aria-pressed",x===b));mfSync(box.dataset.px)});
document.addEventListener("change",ev=>{const s=ev.target.closest(".mf select");if(!s)return;const px=s.closest(".mf").dataset.px;mfSync(px)});
async function ensureSocios(){if(!st.socios){const {data}=await sb.rpc("socios");st.socios=data||[]}}
async function openEdit(id,admin){
  await ensureSocios();
  const r=(admin?st.adminRes:st.mine).find(x=>x.id===id);if(!r)return;
  st.editTarget=r;st.editAdmin=!!admin;$("editErr").hidden=true;
  $("editInfo").innerHTML=`<b>${nice(r.fecha)}</b> · ${COURTS[r.cancha-1].name} · ${hh(r.hora)} – ${hh(r.fin)}${admin?`<div class="note" style="margin-top:6px">Reservó <b>${esc((r.perfiles||{}).nombre||"")}</b>.</div>`:""}`;
  $("editFields").innerHTML=matchFields("ed",r,r.user_id);mfSync("ed");go("edit");
}
function renderSummary(){
  $("sumList").innerHTML=`<dt>Cancha</dt><dd>${COURTS[st.court-1].name}</dd><dt>Fecha</dt><dd>${nice(st.date)}</dd><dt>Horario</dt><dd>${hh(st.hour)} – ${hh(endOf(st.date,st.hour))}</dd><dt>A nombre de</dt><dd>${esc(st.profile?.nombre)}</dd><dt>Costo</dt><dd>Sin costo para socios</dd>`;
  if(!$("cfFields").dataset.ready){$("cfFields").innerHTML=matchFields("cf",null,st.uid);$("cfFields").dataset.ready=1;mfSync("cf")}
}
function renderList(){
  if(!st.uid){$("list").innerHTML=`<div class="card empty">Ingresa con tu cuenta para ver tus reservas.<br><br><button class="cta" data-login="1">Ingresar</button></div>`;return}
  const card=(r,extra)=>{const d=parse(r.fecha);return `<div class="card"><div class="res"><div class="when"><b>${d.getDate()}</b><small>${MONTHS[d.getMonth()].slice(0,3)}</small></div>
    <div class="info"><strong>${COURTS[r.cancha-1].name} · ${hh(r.hora)} – ${hh(r.fin)}</strong><small>${DAYS[d.getDay()]} · ${esc(r.id)}</small><small style="display:block">${rivalTxt(r)?"vs "+esc(rivalTxt(r))+" · ":""}${tipoTxt(r)}</small>${extra.chip?`<div style="margin-top:4px"><span class="chip ${r.estado}">${LABEL[r.estado]}</span></div>`:""}</div>
    ${extra.side||""}</div>${extra.below||""}</div>`};
  const next=st.mine.filter(r=>!played(r));
  const past=st.mine.filter(r=>played(r)&&r.estado==="confirmada").sort((a,b)=>(b.fecha+p2(b.hora)).localeCompare(a.fecha+p2(a.hora)));
  let html='<div class="subhead">Próximas</div>';
  html+=next.length?next.map(r=>card(r,{chip:true,side:r.estado==="confirmada"?`<button data-cancel="${esc(r.id)}">Anular</button>`:"",below:r.estado==="confirmada"?`<button class="link" data-edit="${esc(r.id)}" style="font-size:13px;margin-top:8px">Editar rival o tipo de partido</button>`:""})).join("")
    :`<div class="card empty">No tienes reservas próximas.<br>Elige cancha y horario en <b>Reservar</b>.</div>`;
  if(past.length){
    html+='<div class="subhead">Jugadas</div>';
    html+=past.map(r=>{const m=resultOf(r.id);
      if(r.escalerilla===false)return card(r,{below:`<div class="result"><span>Amistoso: no cuenta para la escalerilla</span><button class="link" data-edit="${esc(r.id)}" style="font-size:12px">Cambiar</button></div>`});
      if(!m)return card(r,{below:`<button class="btn-sm" data-result="${esc(r.id)}">Anotar resultado</button>`});
      const won=m.ganador_id===st.uid;
      return card(r,{below:`<div class="result"><span>vs <b>${esc(m.rival)}</b><br><span class="score">${setsTxt(m.sets)}</span></span><span style="display:flex;flex-direction:column;align-items:flex-end;gap:4px"><span class="pill ${won?"w":"l"}">${won?"Ganaste":"Perdiste"}</span><button class="link" data-result="${esc(r.id)}" style="font-size:12px">Editar</button></span></div>`})}).join("");
  }
  $("list").innerHTML=html;
}
function renderLadder(){
  const el=$("ladder");
  if(!st.uid){$("ladderNote").textContent="";el.innerHTML=`<div class="card empty">Ingresa con tu cuenta para ver la escalerilla.<br><br><button class="cta" data-login="1">Ingresar</button></div>`;return}
  $("ladderNote").textContent="1 punto por partido ganado. Tus 2 primeros partidos son de clasificación: al completarlos entras a la escalerilla según tus puntos. Desde el 3.º, si le ganas a alguien de más arriba, tomas su puesto y los demás bajan uno. Del 1 al 8 clasifican a la Copa Oro y del 9 al 16 a la Copa Plata.";
  const sg=d=>d>0?"+"+d:String(d);
  const row=(x,n,zone)=>`<tr class="${zone?(n<=8?"oro":n<=16?"plata":""):""}${x.id===st.uid?" me":""}"><td><span class="pos">${n}</span></td><td>${esc(x.nombre)}${x.id===st.uid?" (tú)":""}<br>${st.alDia.has(x.id)?'<span class="cuota ok">Cuota al día</span>':st.isAdmin?'<span class="cuota no">Cuota pendiente</span>':""}</td><td>${x.pj}</td><td>${x.pg}</td><td>${x.pp}</td><td class="dif">${x.pj?sg(x.dif):"-"}</td></tr>`;
  const head='<thead><tr><th>#</th><th>Nombre</th><th>PJ</th><th>PG</th><th>PP</th><th>Dif</th></tr></thead>';
  const P=placed(),Q=st.ladder.filter(x=>x.clasificado===false);
  const recent=st.recent.slice(0,10).map(m=>{const jw=m.ganador_id===m.jugador_id;const w=jw?m.jugador:m.rival,l=jw?m.rival:m.jugador;
    return `<div class="match"><span><b>${esc(w)}</b> ganó a ${esc(l)}<em>${nice(m.fecha)} · ${COURTS[m.cancha-1].name}</em></span><span class="score">${setsTxt(m.sets,!jw)}</span>${st.isAdmin&&m.reserva_id?`<button class="del" data-delres="${esc(m.reserva_id)}">Quitar</button>`:""}</div>`}).join("");
  el.innerHTML=`<div class="card" style="font-size:13px"><b>Desafíos</b><br>${esc(challengeInfo())}</div>
    <div class="subhead">Escalerilla</div>
    <div class="card" style="padding:6px 8px">${P.length?`<table class="ladder">${head}<tbody>${P.map((x,i)=>row(x,i+1,true)).join("")}</tbody></table>`:'<p class="note" style="padding:10px">Todavía nadie completa sus 2 partidos de clasificación. El primero en hacerlo abre la escalerilla.</p>'}</div>
    ${P.length?'<p class="note"><span class="pos-key oro"></span>Copa Oro (1–8) · <span class="pos-key plata"></span>Copa Plata (9–16)</p>':""}
    ${Q.length?`<div class="subhead">En clasificación</div><p class="note" style="margin-top:-4px">Aún no completan sus 2 primeros partidos. Se ordenan por puntos.</p>
    <div class="card" style="padding:6px 8px"><table class="ladder">${head}<tbody>${Q.map((x,i)=>row(x,i+1,false)).join("")}</tbody></table></div>`:""}
    <div class="subhead">Últimos partidos</div>
    <div class="card" style="padding:4px 12px">${recent||'<p class="note" style="padding:8px 0">Todavía no hay resultados anotados.</p>'}</div>`;
}
async function openResult(id,admin){
  const r=(admin?st.adminRes:st.mine).find(x=>x.id===id);if(!r)return;
  st.resTarget=r;st.resFree=null;st.resAdmin=!!admin;$("resErr").hidden=true;$("resRival").disabled=false;
  if(!st.socios){const {data}=await sb.rpc("socios");st.socios=data||[]}
  const m=resultOf(id),owner=admin?((r.perfiles||{}).nombre||"Quien reservó"):"Tú";
  $("resOwnerName").textContent=owner;
  $("resBack").textContent=admin?"‹ Volver a resultados":"‹ Volver a mis reservas";
  $("resInfo").innerHTML=`<b>${nice(r.fecha)}</b> · ${COURTS[r.cancha-1].name} · ${hh(r.hora)} – ${hh(r.fin)}`+(admin?`<div class="note" style="margin-top:6px">Reservó <b>${esc(owner)}</b>. Anota el marcador desde su lado.</div>`:`<div class="note" style="margin-top:6px">${esc(challengeInfo())}</div>`);
  $("resRivalLabel").firstChild.textContent=admin?`¿Contra quién jugó ${owner}?`:"¿Contra quién jugaste?";
  $("resRival").innerHTML=`<option value="">Elige un socio</option>`+st.socios.filter(s=>s.id!==r.user_id).map(s=>`<option value="${s.id}" ${(m?m.rival_id:r.rival_id)===s.id?"selected":""}>${esc(s.nombre)}</option>`).join("");
  const sets=m?m.sets:[];
  [["s1a","s1b"],["s2a","s2b"],["s3a","s3b"]].forEach(([x,y],i)=>{$(x).value=sets[i]?sets[i][0]:"";$(y).value=sets[i]?sets[i][1]:""});
  $("resDelete").hidden=!m;delete $("resDelete").dataset.armed;$("resDelete").textContent="Borrar este resultado";
  go("result");renderVerdict();
}
async function openFree(id){
  const m=st.sinRes.find(x=>x.id===id);if(!m)return;
  st.resFree=m;st.resTarget=null;st.resAdmin=true;$("resErr").hidden=true;
  $("resOwnerName").textContent=m.jugador;
  $("resBack").textContent="‹ Volver a resultados";
  $("resInfo").innerHTML=`<b>${nice(m.fecha)}</b> · ${COURTS[m.cancha-1].name} · ${hh(m.hora)}<div class="note" style="margin-top:6px">Partido sin reserva. Anota el marcador desde el lado de <b>${esc(m.jugador)}</b>.</div>`;
  $("resRivalLabel").firstChild.textContent="Rival";
  $("resRival").innerHTML=`<option value="${m.rival_id}" selected>${esc(m.rival)}</option>`;$("resRival").disabled=true;
  const sets=m.sets||[];
  [["s1a","s1b"],["s2a","s2b"],["s3a","s3b"]].forEach(([x,y],i)=>{$(x).value=sets[i]?sets[i][0]:"";$(y).value=sets[i]?sets[i][1]:""});
  $("resDelete").hidden=false;delete $("resDelete").dataset.armed;$("resDelete").textContent="Borrar este partido";
  go("result");renderVerdict();
}
async function openNewMatch(){
  if(!st.socios){const {data}=await sb.rpc("socios");st.socios=data||[]}
  const opts=`<option value="">Elige un socio</option>`+st.socios.map(s=>`<option value="${s.id}">${esc(s.nombre)}</option>`).join("");
  $("nmA").innerHTML=opts;$("nmB").innerHTML=opts;
  $("nmDate").value=key(new Date());
  $("nmHour").innerHTML=Array.from({length:17},(_,i)=>i+6).map(h=>`<option value="${h}" ${h===new Date().getHours()?"selected":""}>${hh(h)}</option>`).join("");
  $("nmErr").hidden=true;go("match");
}
function readSets(){
  const v=id=>{const s=$(id).value.trim();return s===""?null:Number(s)};
  const sets=[[v("s1a"),v("s1b")],[v("s2a"),v("s2b")],[v("s3a"),v("s3b")]].filter(s=>s[0]!==null||s[1]!==null);
  if(!sets.length)return {err:"Anota el marcador de al menos un set."};
  let a=0,c=0;
  for(const [x,y] of sets){
    if(x===null||y===null||!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0)return {err:"Completa los dos lados de cada set con números."};
    if(x===y)return {err:"Un set no puede terminar empatado."};
    x>y?a++:c++;
  }
  if(a===c)return {err:"Quedan empatados en sets. Anota el set que definió el partido."};
  return {sets,win:a>c,a,c};
}
function renderVerdict(){
  const sel=$("resRival"),name=sel.value?sel.options[sel.selectedIndex].text:"Rival";
  $("resRivalName").textContent=name;
  const r=readSets(),v=$("resVerdict");
  if(r.err){v.className="verdict bad";v.innerHTML=`<b>Revisa el marcador</b>${esc(r.err)}`}
  else if(st.resAdmin){const o=$("resOwnerName").textContent;v.className="verdict";const w=r.win?o:name,l=r.win?name:o;v.innerHTML=`<b>Ganó ${esc(w)} ${Math.max(r.a,r.c)} sets a ${Math.min(r.a,r.c)}</b>${esc(w)} suma 1 punto. Si estaba más abajo que ${esc(l)}, toma su puesto.`}
  else{v.className="verdict";v.innerHTML=r.win?`<b>Ganaste ${r.a} sets a ${r.c}</b>Sumas 1 punto${sel.value?`. Si ${esc(name)} está más arriba en la escalerilla, tomas su puesto.`:"."}`:`<b>Perdiste ${r.a} sets a ${r.c}</b>${sel.value?`${esc(name)} suma 1 punto.`:"El rival suma 1 punto."}`}
}
function renderProfile(){
  const logged=!!st.uid;$("pCard").hidden=!logged;$("pLogin").hidden=logged;
  if(logged){const ok=st.alDia.has(st.uid);$("pCuota").innerHTML=`${ok?`<span class="cuota ok">Al día</span> <span style="color:var(--muted);font-weight:600">${MONTHS[today.getMonth()]} · $5.000 mensual</span>`:`<span style="color:var(--muted);font-weight:600">Sin registrar este mes · puedes reservar igual</span>`}`;
    $("pName").textContent=st.profile?.nombre||"—";$("pPhone").textContent=st.profile?.telefono||"—";$("pEmail").textContent=st.email}
  $("pHours").innerHTML=SOLO()?`Sábados, domingos y feriados: ${fmtJ(jFin())}`:`Lunes a viernes: ${fmtJ(jSem())}<br>Sábados, domingos y feriados: ${fmtJ(jFin())}`;
  $("pRules").textContent=`Fines de semana: se reservan desde el ${DIA_NOMBRE[ABRE_DIA()]} · Feriados: desde ${ABRE_FER()} ${ABRE_FER()===1?"día":"días"} antes${LIM_DIA()?` · Máximo ${LIM_DIA()===1?"una cancha":LIM_DIA()+" canchas"} por socio al día`:""} · Sin costo para socios.`;
}
function admCard(r,mode){
  const p=r.perfiles||{};
  return `<div class="card adm-item"><div class="row"><div><strong>${COURTS[r.cancha-1].name} · ${nice(r.fecha)}</strong><div>${hh(r.hora)} – ${hh(r.fin)}</div></div><span class="chip ${r.estado}">${LABEL[r.estado]}</span></div>
  <div class="who">${esc(p.nombre||"Sin nombre")}${rivalTxt(r)?" vs "+esc(rivalTxt(r)):""} · ${tipoTxt(r)}${p.telefono?" · "+esc(p.telefono):""} · ${esc(r.id)}</div>
  ${r.estado!=="confirmada"?`<div class="who">${r.estado==="anulada"?"Anulada":"Liberada"} el ${fmtAt(r.cambio_estado)} · la cancha quedó libre</div>`:""}
  ${mode==="release"?`<div class="adm-actions"><button class="btn-no" data-admedit="${esc(r.id)}" style="background:var(--green-soft);color:var(--green)">Editar partido</button><button class="btn-no" data-rel="${esc(r.id)}">Liberar cancha</button></div>`:""}</div>`;
}
function renderAdmin(){
  document.querySelectorAll("#admTabs button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.a===st.adm));
  const anul=st.adminRes.filter(r=>r.fecha>=key(today)&&r.estado!=="confirmada").length;$("anulBadge").hidden=!anul;$("anulBadge").textContent=anul;
  const body=$("admBody"),now=key(today);
  if(st.adm==="ok"||st.adm==="anul"){
    const list=st.adminRes.filter(r=>r.fecha>=now&&(st.adm==="ok"?r.estado==="confirmada":r.estado!=="confirmada"));
    const intro=st.adm==="anul"?'<p class="note">Reservas próximas que el jugador anuló o que el club liberó. Esas canchas ya están disponibles.</p>':"";
    body.innerHTML=intro+(list.length?list.map(r=>admCard(r,st.adm==="ok"?"release":"")).join("")
      :`<div class="card empty">${st.adm==="ok"?"No hay reservas próximas.":"No hay canchas anuladas ni liberadas."}</div>`);
  }else if(st.adm==="cuo"){
    const m=st.cuotaMes||mesActual(),n=st.cuotas.filter(x=>x.pagado).length;
    body.innerHTML=`<div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <button class="arrow" data-cmes="-1" aria-label="Mes anterior"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 6l-6 6 6 6"/></svg></button>
        <div style="text-align:center"><b style="font-family:var(--display);font-size:20px;text-transform:uppercase;color:var(--green)">${mesNombre(m)}</b><div class="note">${n} de ${st.cuotas.length} socios al día · $5.000</div></div>
        <button class="arrow" data-cmes="1" aria-label="Mes siguiente"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg></button></div>
      <div class="card" style="padding:4px 12px">${st.cuotas.length?st.cuotas.map(x=>`<div class="match"><span><b>${esc(x.nombre)}</b><em>${x.pagado?`Pagó · registrado el ${fmtAt(x.pagado_el)}`:esc(x.telefono||"")}</em></span>
        <button class="pay ${x.pagado?"on":""}" data-pay="${x.id}" data-v="${x.pagado?0:1}">${x.pagado?"Pagó ✓":"Marcar pago"}</button></div>`).join(""):'<p class="note" style="padding:8px 0">Cargando…</p>'}</div>
      <p class="note">Toca «Marcar pago» cuando el socio pague la cuota del mes. Si te equivocas, toca de nuevo para quitarlo.</p>`;
  }else if(st.adm==="res"){
    const list=st.adminRes.filter(r=>r.estado==="confirmada"&&r.escalerilla!==false&&played(r)).sort((a,b)=>(b.fecha+p2(b.hora)).localeCompare(a.fecha+p2(a.hora)));
    const pend=list.filter(r=>!resultOf(r.id)).length;
    const free=st.sinRes.map(m=>{const done=!!m.ganador_id,jw=m.ganador_id===m.jugador_id;
      return `<div class="card adm-item"><div class="row"><div><strong>${esc(m.jugador)} vs ${esc(m.rival)}</strong><div>${nice(m.fecha)} · ${hh(m.hora)} · ${COURTS[m.cancha-1].name}</div></div>${done?'<span class="pill w">Anotado</span>':'<span class="chip pendiente">Sin resultado</span>'}</div>
        ${done?`<div class="result"><span><b>${esc(jw?m.jugador:m.rival)}</b> ganó a ${esc(jw?m.rival:m.jugador)}<br><span class="score">${setsTxt(m.sets,!jw)}</span></span></div>`:""}
        <button class="btn-sm" data-free="${m.id}">${done?"Editar resultado":"Anotar resultado"}</button></div>`}).join("");
    body.innerHTML=`<div class="sec-title" style="margin-top:2px"><h4>Partidos sin reserva</h4></div>
      <button class="btn-sm" id="newMatch" style="margin-top:0">+ Partido sin reserva</button>
      ${free||'<p class="note">Registra aquí partidos que se jugaron sin reservar por la app. Eliges los jugadores, el día y la hora, y anotas el resultado cuando terminen.</p>'}
      <div class="sec-title" style="margin-top:8px"><h4>Partidos con reserva</h4></div>
      <p class="note">Partidos jugados en los últimos 45 días. Si los socios no anotan el resultado, puedes anotarlo tú. ${pend?`Faltan ${pend}.`:"No falta ninguno."}</p>`+
      (list.length?list.map(r=>{const m=resultOf(r.id),p=r.perfiles||{};
        const txt=m?`<div class="result"><span><b>${esc(m.ganador_id===m.jugador_id?m.jugador:m.rival)}</b> ganó a ${esc(m.ganador_id===m.jugador_id?m.rival:m.jugador)}<br><span class="score">${setsTxt(m.sets,m.ganador_id!==m.jugador_id)}</span></span><span class="pill w">Anotado</span></div>`:"";
        return `<div class="card adm-item"><div class="row"><div><strong>${COURTS[r.cancha-1].name} · ${nice(r.fecha)}</strong><div>${hh(r.hora)} – ${hh(r.fin)} · reservó ${esc(p.nombre||"")}</div></div>${m?"":'<span class="chip pendiente">Sin resultado</span>'}</div>${txt}
        <button class="btn-sm" data-admres="${esc(r.id)}">${m?"Editar resultado":"Anotar resultado"}</button></div>`}).join("")
      :`<div class="card empty">No hay partidos jugados en los últimos 45 días.</div>`);
  }else if(st.adm==="fer"){
    const fer=[...(st.club.feriados||[])].sort((a,b)=>a.fecha.localeCompare(b.fecha)).filter(f=>f.fecha>=now);
    body.innerHTML=`<div class="card"><div class="sec-title"><h4>Feriados</h4><span>Horario de fin de semana</span></div>
      <div style="margin-top:8px">${fer.length?fer.map(f=>`<div class="hol"><span><b>${nice(f.fecha)}</b> ${parse(f.fecha).getFullYear()} · ${esc(f.nombre)}</span><button data-delfer="${f.fecha}">Quitar</button></div>`).join(""):'<p class="note">No hay feriados cargados.</p>'}</div></div>
      <div class="card"><form class="inline-form" id="ferForm"><input id="ferDate" type="date" aria-label="Fecha"><input id="ferName" placeholder="Nombre del feriado" aria-label="Nombre"><button>Agregar</button></form><p class="err" id="ferErr" hidden></p></div>`;
  }else{
    if(!st.draft)st.draft={soloFinde:SOLO()?1:0,abreFindeDia:ABRE_DIA(),abreFeriadoDias:ABRE_FER(),limiteDiario:LIM_DIA(),diasAnticipacion:DIAS(),
      jornadaSemana:jSem().map(x=>[...x]),jornadaFinde:jFin().map(x=>[...x])};
    const d=st.draft;
    const hsel=(id,v,min,max)=>`<select data-k="${id}">${Array.from({length:max-min+1},(_,i)=>min+i).map(h=>`<option value="${h}" ${h===v?"selected":""}>${hh(h)}</option>`).join("")}</select>`;
    const jEditor=(name,label,arr)=>`<div class="card"><div class="sec-title"><h4>${label}</h4><span>${arr.length} bloques</span></div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">${arr.map(([a,z],i)=>`<div class="jrow">${hsel(name+"."+i+".0",a,6,23)}<span>a</span>${hsel(name+"."+i+".1",z,7,24)}<button type="button" data-jdel="${name}.${i}">Quitar</button></div>`).join("")}</div>
      <button type="button" class="jadd" data-jadd="${name}">+ Agregar bloque</button></div>`;
    const opt=(arr,v,lab)=>arr.map(n=>`<option value="${n}" ${n===v?"selected":""}>${lab(n)}</option>`).join("");
    body.innerHTML=`<div class="card"><div class="sec-title"><h4>Reglas de reserva</h4></div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
      <label for="dSolo">Días que se reservan por la app<select id="dSolo" data-f="soloFinde" class="selfull"><option value="1" ${d.soloFinde?"selected":""}>Solo sábados, domingos y feriados</option><option value="0" ${d.soloFinde?"":"selected"}>Todos los días</option></select></label>
      <label for="dAbre">El fin de semana se puede reservar desde el<select id="dAbre" data-f="abreFindeDia" class="selfull">${opt([1,2,3,4,5],d.abreFindeDia,n=>DIA_NOMBRE[n])}</select></label>
      <label for="dFer">Los feriados se pueden reservar desde<select id="dFer" data-f="abreFeriadoDias" class="selfull">${opt([1,2,3,4,5,6,7],d.abreFeriadoDias,n=>n+(n===1?" día antes":" días antes"))}</select></label>
      <label for="dLimD">Canchas por socio al día<select id="dLimD" data-f="limiteDiario" class="selfull">${opt([1,2,3,0],d.limiteDiario,n=>n===0?"Sin límite":String(n))}</select></label>
      ${d.soloFinde?"":`<label for="dAnt">Días hábiles: anticipación máxima<select id="dAnt" data-f="diasAnticipacion" class="selfull">${opt([2,3,5,7,10,14],d.diasAnticipacion,n=>n+" días")}</select></label>`}
      <p class="note">Las reservas anuladas o liberadas no cuentan para el límite.</p></div></div>
      ${jEditor("jornadaSemana","Jornada lunes a viernes",d.jornadaSemana)}
      ${jEditor("jornadaFinde","Jornada fin de semana y feriados",d.jornadaFinde)}
      <p class="err" id="jErr" hidden></p>
      <div style="display:flex;gap:8px"><button type="button" class="btn-line" id="jReset" style="flex:1">Descartar</button><button type="button" class="cta" id="jSave" style="flex:2">Guardar cambios</button></div>
      <p class="note">Los cambios aplican a las reservas nuevas. Las reservas ya hechas se mantienen.</p>`;
  }
}
function renderAll(){
  if(st.view==="book"){renderCourts();renderDates();renderSlots()}
  if(st.view==="confirm")renderSummary();
  if(st.view==="list")renderList();
  if(st.view==="ladder")renderLadder();
  if(st.view==="admin"&&!(st.adm==="tar"&&st.draft))renderAdmin();
  if(st.view==="profile")renderProfile();
  renderCta();
}
function go(v){
  st.view=v;
  for(const id of ["book","auth","setup","recover","confirm","done","list","result","edit","match","ladder","admin","profile"])$("v-"+id).hidden=id!==v;
  const tab=v==="edit"?(st.editAdmin?"admin":"list"):v==="match"?"admin":v==="result"?(st.resAdmin?"admin":"list"):["list","ladder","profile","admin"].includes(v)?v:"book";
  document.querySelectorAll("#nav button").forEach(b=>{if(b.dataset.tab===tab)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
  renderAll();window.scrollTo(0,0);
}
function toast(t){const e=$("toast");e.textContent=t;e.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>e.hidden=true,2600)}
function showErr(id,t){$(id).textContent=t;$(id).hidden=false}
function openLogin(next){st.afterLogin=next||null;setAuthMode("login");go("auth")}
function openSetup(first){$("setupTitle").textContent=first?"Completa tus datos":"Editar datos";
  $("s-name").value=st.profile?.nombre||"";$("s-phone").value=st.profile?.telefono||"";$("setupErr").hidden=true;go("setup")}
function setAuthMode(m){st.authMode=m;
  document.querySelectorAll("#authTabs button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.m===m));
  $("signupFields").hidden=m!=="signup";$("forgot").hidden=m!=="login";
  $("authBtn").textContent=m==="signup"?"Crear cuenta":"Ingresar";
  $("a-pass").autocomplete=m==="signup"?"new-password":"current-password";
  $("authErr").hidden=true;$("authOk").hidden=true}

/* ---------- eventos: reservar ---------- */
$("courts").onclick=e=>{const b=e.target.closest("[data-c]");if(!b)return;st.court=+b.dataset.c;st.hour=null;renderAll()};
$("strip").onclick=e=>{const b=e.target.closest("[data-d]");if(!b||b.disabled)return;st.date=b.dataset.d;st.hour=null;renderAll()};
$("prev").onclick=()=>{st.offset=Math.max(0,st.offset-5);renderDates()};
$("next").onclick=()=>{st.offset+=5;renderDates()};
$("slots").onclick=e=>{const b=e.target.closest("[data-h]");if(!b||b.disabled)return;st.hour=+b.dataset.h;renderSlots();renderCta()};
$("back").onclick=()=>go("book");
document.querySelectorAll("#nav button").forEach(b=>b.onclick=()=>{
  if((b.dataset.tab==="list"||b.dataset.tab==="ladder")&&!st.uid){go(b.dataset.tab);return}
  go(b.dataset.tab);if(b.dataset.tab!=="book")refresh()});
$("ladder").addEventListener("click",async e=>{
  if(e.target.closest("[data-login]"))return openLogin("ladder");
  const d=e.target.closest("[data-delres]");if(!d)return;
  if(!d.dataset.armed){d.dataset.armed=1;d.textContent="¿Quitar?";d.style.color="var(--orange)";return}
  const {error}=await sb.rpc("borrar_resultado",{p_reserva:d.dataset.delres});
  if(error)return toast(errMsg(error));toast("Resultado quitado");refresh()});
const resDone=async msg=>{toast(msg);await refresh();if(st.resAdmin){st.adm="res";go("admin")}else go("list")};
$("resBack").onclick=()=>{if(st.resAdmin){st.adm="res";go("admin")}else go("list")};
$("resRival").onchange=renderVerdict;
document.querySelectorAll("#v-result .sets input").forEach(i=>i.addEventListener("input",renderVerdict));
$("resForm").onsubmit=async e=>{e.preventDefault();
  const r=readSets();if(r.err)return showErr("resErr",r.err);
  if(!$("resRival").value)return showErr("resErr","Elige al socio contra quien jugaste.");
  $("resSave").disabled=true;
  const {error}=st.resFree?await sb.rpc("resultado_partido",{p_id:st.resFree.id,p_sets:r.sets})
    :await sb.rpc("registrar_resultado",{p_reserva:st.resTarget.id,p_rival:$("resRival").value,p_sets:r.sets});
  $("resSave").disabled=false;
  if(error)return showErr("resErr",errMsg(error));
  resDone("Resultado guardado")};
$("resDelete").onclick=async()=>{const b=$("resDelete");
  if(!b.dataset.armed){b.dataset.armed=1;b.textContent="¿Seguro? Toca otra vez para borrar";return}
  const {error}=st.resFree?await sb.rpc("borrar_partido",{p_id:st.resFree.id}):await sb.rpc("borrar_resultado",{p_reserva:st.resTarget.id});
  if(error)return showErr("resErr",errMsg(error));
  resDone(st.resFree?"Partido borrado":"Resultado borrado")};
$("editBack").onclick=()=>{if(st.editAdmin){st.adm="ok";go("admin")}else go("list")};
$("editForm").onsubmit=async e=>{e.preventDefault();
  const mf=mfRead("ed",false);if(mf.err)return showErr("editErr",mf.err);
  $("editSave").disabled=true;
  const {error}=await sb.rpc("editar_partido_reserva",{p_reserva:st.editTarget.id,p_escalerilla:mf.e,p_rival:mf.rival,p_rival_nombre:mf.nombre});
  $("editSave").disabled=false;if(error)return showErr("editErr",errMsg(error));
  toast("Partido actualizado");await refresh();if(st.editAdmin){st.adm="ok";go("admin")}else go("list")};
$("nmBack").onclick=()=>{st.adm="res";go("admin")};
$("nmForm").onsubmit=async e=>{e.preventDefault();
  const a=$("nmA").value,b=$("nmB").value,f=$("nmDate").value,h=+$("nmHour").value,c=+$("nmCourt").value;
  if(!a||!b)return showErr("nmErr","Elige a los dos jugadores.");
  if(a===b)return showErr("nmErr","Elige dos jugadores distintos.");
  if(!f)return showErr("nmErr","Indica el día del partido.");
  $("nmSave").disabled=true;
  const {error}=await sb.rpc("crear_partido",{p_jugador:a,p_rival:b,p_fecha:f,p_hora:h,p_cancha:c});
  $("nmSave").disabled=false;
  if(error)return showErr("nmErr",errMsg(error));
  toast("Partido creado. Anota el resultado cuando termine.");st.resAdmin=true;await refresh();st.adm="res";go("admin")};
$("list").addEventListener("click",async e=>{
  if(e.target.closest("[data-login]"))return openLogin("list");
  const rs=e.target.closest("[data-result]");if(rs)return openResult(rs.dataset.result,false);
  const ed=e.target.closest("[data-edit]");if(ed)return openEdit(ed.dataset.edit,false);
  const b=e.target.closest("[data-cancel]");if(!b)return;
  if(!b.dataset.armed){b.dataset.armed=1;b.textContent="¿Seguro?";b.style.color="var(--orange)";b.style.borderColor="var(--orange)";return}
  b.disabled=true;const {error}=await sb.rpc("anular",{p_id:b.dataset.cancel});
  if(error){b.disabled=false;toast(errMsg(error));return}
  toast("Reserva anulada. La cancha quedó libre.");refresh()});

let busy=false;
$("cta").onclick=async()=>{
  if(st.view==="book"&&st.hour!==null){
    if(!st.uid)return openLogin("confirm");
    if(!st.profile)return openSetup(true);
    $("confirmErr").hidden=true;await ensureSocios();delete $("cfFields").dataset.ready;return go("confirm");
  }
  if(st.view==="done"){st.hour=null;return go("book")}
  if(st.view!=="confirm"||busy)return;
  if(isTaken(st.date,st.court,st.hour))return showErr("confirmErr","Ese horario se acaba de ocupar. Vuelve y elige otro.");
  if(LIM_DIA()&&myDayCount(st.date)>=LIM_DIA())return showErr("confirmErr",LIM_DIA()===1?"Ya tienes una cancha reservada ese día. Cada socio puede reservar una cancha por día.":`Ya tienes ${LIM_DIA()} canchas reservadas ese día, que es el máximo por socio.`);
  const mf=mfRead("cf",true);if(mf.err)return showErr("confirmErr",mf.err);
  busy=true;$("cta").disabled=true;
  const {data,error}=await sb.rpc("reservar",{p_cancha:st.court,p_fecha:st.date,p_hora:st.hour,p_escalerilla:mf.e,p_rival:mf.rival,p_rival_nombre:mf.nombre});
  busy=false;
  if(error){showErr("confirmErr",errMsg(error));renderCta();loadOccupied().then(()=>{});return}
  const r=Array.isArray(data)?data[0]:data;
  $("doneText").textContent=`${COURTS[st.court-1].name}, ${nice(st.date)} de ${hh(r.hora)} a ${hh(r.fin)}`;
  $("doneCode").textContent=r.id;go("done");refresh();
};

/* ---------- eventos: cuenta ---------- */
$("authTabs").onclick=e=>{const b=e.target.closest("[data-m]");if(b)setAuthMode(b.dataset.m)};
$("authForm").onsubmit=async e=>{e.preventDefault();if(!sb)return;
  $("authErr").hidden=true;$("authOk").hidden=true;
  const email=$("a-email").value.trim(),password=$("a-pass").value;
  if(!/^\S+@\S+\.\S+$/.test(email))return showErr("authErr","Escribe un correo válido.");
  if(password.length<6)return showErr("authErr","La contraseña debe tener al menos 6 caracteres.");
  $("authBtn").disabled=true;
  try{
    if(st.authMode==="login"){
      const {error}=await sb.auth.signInWithPassword({email,password});
      if(error)showErr("authErr",/invalid/i.test(error.message)?"Correo o contraseña incorrectos.":/confirm/i.test(error.message)?"Debes confirmar tu correo antes de ingresar.":errMsg(error));
    }else{
      const nombre=$("a-name").value.trim(),telefono=$("a-phone").value.trim(),socio=true;
      if(nombre.length<2)return showErr("authErr","Escribe tu nombre y apellido.");
      if(telefono.replace(/\D/g,"").length<8)return showErr("authErr","Escribe un teléfono válido.");
      st.pendingProfile={nombre,telefono,socio};
      const {data,error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}});
      if(error){showErr("authErr",/registered/i.test(error.message)?"Ese correo ya tiene una cuenta. Usa Ingresar.":errMsg(error));return}
      if(!data.session){$("authOk").textContent="Te enviamos un correo para confirmar tu cuenta. Ábrelo y luego ingresa.";$("authOk").hidden=false}
    }
  }finally{$("authBtn").disabled=false}
};
$("forgot").onclick=async()=>{const email=$("a-email").value.trim();
  if(!/^\S+@\S+\.\S+$/.test(email))return showErr("authErr","Escribe tu correo arriba y vuelve a tocar «¿Olvidaste tu contraseña?».");
  const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
  if(error)return showErr("authErr",errMsg(error));
  $("authOk").textContent="Te enviamos un correo con un enlace para crear una nueva contraseña.";$("authOk").hidden=false};
$("recoverForm").onsubmit=async e=>{e.preventDefault();const password=$("r-pass").value;
  if(password.length<6)return showErr("recoverErr","La contraseña debe tener al menos 6 caracteres.");
  const {error}=await sb.auth.updateUser({password});if(error)return showErr("recoverErr",errMsg(error));
  toast("Contraseña actualizada");go("book")};
$("setupForm").onsubmit=async e=>{e.preventDefault();
  const nombre=$("s-name").value.trim(),telefono=$("s-phone").value.trim(),socio=true;
  if(nombre.length<2)return showErr("setupErr","Escribe tu nombre y apellido.");
  if(telefono.replace(/\D/g,"").length<8)return showErr("setupErr","Escribe un teléfono válido.");
  const {data,error}=await sb.from("perfiles").upsert({id:st.uid,nombre,telefono,socio}).select().single();
  if(error)return showErr("setupErr",errMsg(error));
  st.profile=data;toast("Datos guardados");
  const next=st.afterLogin;st.afterLogin=null;go(next==="confirm"&&st.hour!==null?"confirm":"profile")};
$("editProfile").onclick=()=>openSetup(false);
$("logout").onclick=async()=>{await sb.auth.signOut();toast("Sesión cerrada");go("book")};
$("goLogin").onclick=()=>openLogin("profile");

/* ---------- eventos: administración ---------- */
$("admTabs").onclick=async e=>{const b=e.target.closest("[data-a]");if(!b)return;st.adm=b.dataset.a;st.draft=null;renderAdmin();if(st.adm==="cuo"){await loadCuotas();renderAdmin()}};
$("admBody").addEventListener("change",e=>{const d=st.draft;if(!d)return;const t=e.target;
  if(t.dataset.f){d[t.dataset.f]=Math.max(0,+t.value||0);if(t.dataset.f==="soloFinde")renderAdmin();return}
  if(t.dataset.k){const [n,i,j]=t.dataset.k.split(".");d[n][+i][+j]=+t.value}});
$("admBody").addEventListener("click",async e=>{
  const t=e.target;
  const cm=t.closest("[data-cmes]");if(cm){const d=parse(st.cuotaMes||mesActual());d.setMonth(d.getMonth()+Number(cm.dataset.cmes));st.cuotaMes=key(d).slice(0,8)+"01";st.cuotas=[];renderAdmin();await loadCuotas();return renderAdmin()}
  const py=t.closest("[data-pay]");if(py){py.disabled=true;const {error}=await sb.rpc("marcar_cuota",{p_perfil:py.dataset.pay,p_mes:st.cuotaMes||mesActual(),p_pagado:py.dataset.v==="1"});
    if(error){py.disabled=false;return toast(errMsg(error))}toast(py.dataset.v==="1"?"Pago registrado":"Pago quitado");await Promise.all([loadCuotas(),loadLadder()]);return renderAdmin()}
  if(t.closest("#newMatch"))return openNewMatch();
  const ae=t.closest("[data-admedit]");if(ae)return openEdit(ae.dataset.admedit,true);
  const fr=t.closest("[data-free]");if(fr)return openFree(fr.dataset.free);
  const ar=t.closest("[data-admres]");if(ar){if(!st.recent.length)await loadLadder();return openResult(ar.dataset.admres,true)}
  const rel=t.closest("[data-rel]");
  if(rel){if(!rel.dataset.armed){rel.dataset.armed=1;rel.textContent="¿Liberar esta cancha? Toca para confirmar";rel.style.background="var(--orange)";rel.style.color="#fff";return}
    rel.disabled=true;const {error}=await sb.rpc("liberar",{p_id:rel.dataset.rel});
    if(error){rel.disabled=false;toast(errMsg(error));return}toast("Cancha liberada");refresh();return}
  const f=t.closest("[data-delfer]");
  if(f){await saveClub({feriados:(st.club.feriados||[]).filter(x=>x.fecha!==f.dataset.delfer)},"Feriado quitado");return}
  const d=st.draft;if(!d)return;
  if(t.dataset.jdel){const [n,i]=t.dataset.jdel.split(".");d[n].splice(+i,1);renderAdmin()}
  else if(t.dataset.jadd){const a=d[t.dataset.jadd];const last=a.length?a[a.length-1][1]:8;a.push([Math.min(last,22),Math.min(last+2,24)]);renderAdmin()}
  else if(t.id==="jReset"){st.draft=null;renderAdmin()}
  else if(t.id==="jSave"){
    const chk=(arr,label)=>{if(!arr.length)return `${label}: agrega al menos un bloque.`;const s=[...arr].sort((x,y)=>x[0]-y[0]);
      for(let i=0;i<s.length;i++){if(s[i][1]<=s[i][0])return `${label}: el bloque de las ${hh(s[i][0])} debe terminar después de empezar.`;
        if(i&&s[i][0]<s[i-1][1])return `${label}: los bloques de las ${hh(s[i-1][0])} y las ${hh(s[i][0])} se superponen.`}return ""};
    const err=chk(d.jornadaSemana,"Lunes a viernes")||chk(d.jornadaFinde,"Fin de semana");
    if(err)return showErr("jErr",err);
    const ob=a=>[...a].sort((x,y)=>x[0]-y[0]).map(([ini,fin])=>({ini,fin}));
    const ok=await saveClub({soloFinde:!!d.soloFinde,abreFindeDia:d.abreFindeDia,abreFeriadoDias:d.abreFeriadoDias,limiteDiario:d.limiteDiario,diasAnticipacion:d.diasAnticipacion,jornadaSemana:ob(d.jornadaSemana),jornadaFinde:ob(d.jornadaFinde)},"Cambios guardados");
    if(ok){st.draft=null;renderAdmin()}
  }
});
$("admBody").addEventListener("submit",async e=>{e.preventDefault();
  if(e.target.id!=="ferForm")return;const fecha=$("ferDate").value,nombre=$("ferName").value.trim();
  if(!fecha||!nombre)return showErr("ferErr","Indica la fecha y el nombre del feriado.");
  await saveClub({feriados:[...(st.club.feriados||[]).filter(x=>x.fecha!==fecha),{fecha,nombre}]},"Feriado agregado")});
async function saveClub(patch,msg){
  const next={...st.club,...patch};
  const {data,error}=await sb.from("config").update({datos:next,actualizado:new Date().toISOString()}).eq("id",1).select("datos");
  if(error||!data||!data.length){toast(error?errMsg(error):"No tienes permiso para cambiar la configuración.");return false}
  st.club={...st.club,...data[0].datos};toast(msg);renderAll();if(st.view==="admin")renderAdmin();return true}

/* ---------- inicio ---------- */
(async()=>{
  go("book");
  if(!sb)return;
  await loadConfig();
  {const f=firstBookable();if(f&&!bookable(st.date)){st.date=f.k;st.offset=Math.floor(f.i/5)*5}}
  sb.auth.onAuthStateChange((event,session)=>{
    setTimeout(async()=>{
      if(event==="PASSWORD_RECOVERY"){go("recover");return}
      if(event==="SIGNED_IN"&&st.pendingProfile&&session){
        const p={id:session.user.id,...st.pendingProfile};st.pendingProfile=null;
        await sb.from("perfiles").upsert(p);
      }
      if(event==="INITIAL_SESSION"||event==="SIGNED_IN"||event==="SIGNED_OUT"||event==="USER_UPDATED")await onSession(session);
    },0);
  });
  renderAll();
  setInterval(()=>{if(document.visibilityState==="visible")loadOccupied().then(renderAll)},30000);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refresh()});
})();

if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
