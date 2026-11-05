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
const clp=n=>n===0?"Gratis":"$"+Number(n).toLocaleString("es-CL");
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
  club:{feriados:[],precioSemana:16000,precioFinde:16000,mananaHasta:12,diasAnticipacion:7,limiteFinde:2},
  occupied:new Set(),mine:[],adminRes:[],draft:null,afterLogin:null};

/* ---------- reglas del club ---------- */
const toPairs=a=>(a||[]).map(x=>Array.isArray(x)?x:[x.ini,x.fin]);
function holidayName(k){const f=(st.club.feriados||[]).find(x=>x.fecha===k);return f?f.nombre:null}
function especial(k){const d=parse(k).getDay();return d===0||d===6||!!holidayName(k)}
function jSem(){const j=toPairs(st.club.jornadaSemana);return j.length?j:DEF_SEMANA}
function jFin(){const j=toPairs(st.club.jornadaFinde);return j.length?j:DEF_FINDE}
function blocksFor(k){return especial(k)?jFin():jSem()}
function endOf(k,h){const b=blocksFor(k).find(x=>x[0]===h);return b?b[1]:h+2}
const MH=()=>st.club.mananaHasta??12;
const DIAS=()=>st.club.diasAnticipacion??7;
const LIM=()=>st.club.limiteFinde??2;
function inWindow(k){const d=Math.round((parse(k)-today)/864e5);return d>=0&&d<DIAS()}
const SOLO=()=>!!st.club.soloFinde;
function bookable(k){return inWindow(k)&&(!SOLO()||especial(k))}
function firstBookable(){for(let i=0;i<DIAS();i++){const d=new Date(today);d.setDate(today.getDate()+i);if(bookable(key(d)))return {k:key(d),i}}return null}
function weekKey(k){const d=parse(k);d.setDate(d.getDate()-(d.getDay()+6)%7);return key(d)}
function morningFree(k,h){return endOf(k,h)<=MH()}
function priceFor(k,member,h){if(morningFree(k,h))return 0;if(especial(k))return member?0:(st.club.precioFinde??16000);return st.club.precioSemana??16000}
function isTaken(k,c,h){if(k===key(today)&&h<=new Date().getHours())return true;return st.occupied.has(`${k}|${c}|${h}`)}
function myWeekendCount(k){const w=weekKey(k);return st.mine.filter(r=>r.estado==="confirmada"&&especial(r.fecha)&&weekKey(r.fecha)===w).length}
function fmtJ(a){return a.map(([x,y])=>`${x}–${y}`).join(", ")+" h"}

/* ---------- conexión ---------- */
const CFG=window.CTP_CONFIG||{};
const configured=CFG.url&&CFG.anonKey&&!/TU-PROYECTO|TU-CLAVE/.test(CFG.url+CFG.anonKey);
const sb=configured?supabase.createClient(CFG.url,CFG.anonKey):null;
if(!configured)$("cfgErr").hidden=false;

async function loadConfig(){if(!sb)return;const {data}=await sb.from("config").select("datos").eq("id",1).maybeSingle();if(data&&data.datos)st.club={...st.club,...data.datos}}
async function loadOccupied(){if(!sb)return;const end=new Date(today);end.setDate(end.getDate()+Math.max(DIAS(),st.offset+5));
  const {data,error}=await sb.rpc("ocupados",{desde:key(today),hasta:key(end)});if(error)return;
  st.occupied=new Set((data||[]).map(r=>`${r.fecha}|${r.cancha}|${r.hora}`))}
async function loadMine(){st.mine=[];if(!sb||!st.uid)return;
  const {data}=await sb.from("reservas").select("*").eq("user_id",st.uid).gte("fecha",key(today)).order("fecha").order("hora");st.mine=data||[]}
async function loadAdmin(){st.adminRes=[];if(!sb||!st.isAdmin)return;
  const {data}=await sb.from("reservas").select("*, perfiles(nombre,telefono)").gte("fecha",key(today)).order("fecha").order("hora");st.adminRes=data||[]}
async function refresh(){await Promise.all([loadOccupied(),loadMine(),loadAdmin()]);renderAll()}

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
  if(!st.uid&&(st.view==="list"||st.view==="admin"))go("book");
}

/* ---------- render ---------- */
function renderCourts(){$("courts").innerHTML=COURTS.map(c=>`<button class="court" aria-pressed="${st.court===c.id}" data-c="${c.id}"><b>${c.name}</b><small>${c.type}</small></button>`).join("")}
function renderDates(){
  const days=[];for(let i=0;i<5;i++){const d=new Date(today);d.setDate(today.getDate()+st.offset+i);days.push(d)}
  const m0=MONTHS[days[0].getMonth()],m1=MONTHS[days[4].getMonth()];
  $("month").textContent=m0===m1?m0:m0+" – "+m1;
  $("strip").innerHTML=days.map(d=>{const k=key(d);return `<button class="day" data-d="${k}" ${bookable(k)?"":`disabled title="${inWindow(k)?"Solo sábados, domingos y feriados":"Aún no se abre"}"`} aria-pressed="${k===st.date}"><b>${d.getDate()}</b><small>${DAYS[d.getDay()]}</small>${especial(k)?'<span class="free" title="Gratis para socios"></span>':'<span class="nofree"></span>'}</button>`}).join("");
  $("prev").disabled=st.offset===0;$("next").disabled=st.offset+5>=DIAS();
  const hol=holidayName(st.date),tarde=`desde las ${hh(MH())}`;
  if(SOLO()&&!especial(st.date)){$("dayInfo").innerHTML=`<b>No hay días disponibles</b> en los próximos ${DIAS()} días.`}
  else $("dayInfo").innerHTML=`<b>Mañanas gratis para todos</b> hasta las ${hh(MH())}<br>`+(especial(st.date)
    ?`<b>${esc(hol?"Feriado: "+hol:"Fin de semana")}</b> · ${tarde}: socios gratis · no socios ${clp(st.club.precioFinde??16000)}`
    :`<b>Día hábil</b> · ${tarde}: ${clp(st.club.precioSemana??16000)} para todos`);
  $("winInfo").textContent=SOLO()?`Por la app se reservan solo sábados, domingos y feriados, con hasta ${DIAS()} días de anticipación${LIM()?`. Máximo ${LIM()} ${LIM()===1?"reserva":"reservas"} por persona en la semana`:""}.`:`Puedes reservar con hasta ${DIAS()} días de anticipación. De lunes a viernes puedes jugar todos los días${LIM()?`; sábados, domingos y feriados, máximo ${LIM()} ${LIM()===1?"reserva":"reservas"} por persona en la semana`:""}.`;
}
function renderSlots(){
  if(!bookable(st.date)){$("slots").innerHTML="";return}
  $("slots").innerHTML=blocksFor(st.date).map(([h,e])=>{const t=isTaken(st.date,st.court,h);
    return `<button class="slot" data-h="${h}" ${t?"disabled":""} aria-pressed="${st.hour===h}">${hh(h)} – ${hh(e)}<small>${t?"No disponible":morningFree(st.date,h)?"Disponible · gratis":"Disponible"}</small></button>`}).join("");
}
function renderCta(){
  const bar=$("ctaBar"),b=$("cta"),i=$("ctaInfo");
  if(st.view==="book"){bar.hidden=false;b.textContent="Siguiente";b.disabled=st.hour===null||!sb;
    i.textContent=st.hour===null?"Elige un horario disponible":`${COURTS[st.court-1].name} · ${nice(st.date)} · ${hh(st.hour)} – ${hh(endOf(st.date,st.hour))}`}
  else if(st.view==="confirm"){bar.hidden=false;b.disabled=false;b.textContent="Confirmar reserva";i.textContent="Revisa los datos antes de confirmar"}
  else if(st.view==="done"){bar.hidden=false;b.disabled=false;b.textContent="Hacer otra reserva";i.textContent=""}
  else bar.hidden=true;
}
function renderSummary(){
  const member=!!st.profile?.socio,price=priceFor(st.date,member,st.hour);
  const tipo=morningFree(st.date,st.hour)?"Mañana · gratis para todos":especial(st.date)?(member?"Socio · fin de semana o feriado":"No socio · fin de semana o feriado"):"Tarde de semana · tarifa única";
  $("sumList").innerHTML=`<dt>Cancha</dt><dd>${COURTS[st.court-1].name}</dd><dt>Fecha</dt><dd>${nice(st.date)}</dd><dt>Horario</dt><dd>${hh(st.hour)} – ${hh(endOf(st.date,st.hour))}</dd><dt>A nombre de</dt><dd>${esc(st.profile?.nombre)}</dd><dt>Tarifa</dt><dd>${tipo}</dd>`;
  $("sumTotal").textContent=clp(price);
}
function renderList(){
  if(!st.uid){$("list").innerHTML=`<div class="card empty">Ingresa con tu cuenta para ver tus reservas.<br><br><button class="cta" data-login="1">Ingresar</button></div>`;return}
  const items=st.mine;
  $("list").innerHTML=items.length?items.map(r=>{const d=parse(r.fecha);
    return `<div class="card res"><div class="when"><b>${d.getDate()}</b><small>${MONTHS[d.getMonth()].slice(0,3)}</small></div>
    <div class="info"><strong>${COURTS[r.cancha-1].name} · ${hh(r.hora)} – ${hh(r.fin)}</strong><small>${DAYS[d.getDay()]} · ${clp(r.precio)} · ${esc(r.id)}</small><div style="margin-top:4px"><span class="chip ${r.estado}">${LABEL[r.estado]}</span></div></div>
    ${r.estado==="confirmada"?`<button data-cancel="${esc(r.id)}">Anular</button>`:""}</div>`}).join("")
    :`<div class="card empty">Aún no tienes reservas.<br>Elige cancha y horario en <b>Reservar</b>.</div>`;
}
function renderProfile(){
  const logged=!!st.uid;$("pCard").hidden=!logged;$("pLogin").hidden=logged;
  if(logged){$("pName").textContent=st.profile?.nombre||"—";$("pPhone").textContent=st.profile?.telefono||"—";$("pEmail").textContent=st.email;$("pType").textContent=st.profile?(st.profile.socio?"Socio":"No socio"):"—"}
  $("pHours").innerHTML=SOLO()?`Sábados, domingos y feriados: ${fmtJ(jFin())}`:`Lunes a viernes: ${fmtJ(jSem())}<br>Sábados, domingos y feriados: ${fmtJ(jFin())}`;
  $("pRules").textContent=`Hasta ${DIAS()} días de anticipación · días hábiles sin límite${LIM()?` · sábados, domingos y feriados: máximo ${LIM()} por persona en la semana`:""}.`;
  $("pRates").textContent=SOLO()?`Mañanas (hasta las ${hh(MH())}): gratis para todos · Tardes: socios gratis, no socios ${clp(st.club.precioFinde??16000)}`:`Mañanas (hasta las ${hh(MH())}): gratis para todos · Tardes de semana: ${clp(st.club.precioSemana??16000)} para todos · Tardes de fin de semana y feriados: socios gratis, no socios ${clp(st.club.precioFinde??16000)}`;
}
function admCard(r,mode){
  const p=r.perfiles||{};
  return `<div class="card adm-item"><div class="row"><div><strong>${COURTS[r.cancha-1].name} · ${nice(r.fecha)}</strong><div>${hh(r.hora)} – ${hh(r.fin)} · ${clp(r.precio)}</div></div><span class="chip ${r.estado}">${LABEL[r.estado]}</span></div>
  <div class="who">${esc(p.nombre||"Sin nombre")}${p.telefono?" · "+esc(p.telefono):""} · ${r.socio?"Socio":"No socio"} · ${esc(r.id)}</div>
  ${r.estado!=="confirmada"?`<div class="who">${r.estado==="anulada"?"Anulada":"Liberada"} el ${fmtAt(r.cambio_estado)} · la cancha quedó libre</div>`:""}
  ${mode==="release"?`<div class="adm-actions"><button class="btn-no" data-rel="${esc(r.id)}">Liberar cancha</button></div>`:""}</div>`;
}
function renderAdmin(){
  document.querySelectorAll("#admTabs button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.a===st.adm));
  const anul=st.adminRes.filter(r=>r.estado!=="confirmada").length;$("anulBadge").hidden=!anul;$("anulBadge").textContent=anul;
  const body=$("admBody"),now=key(today);
  if(st.adm==="ok"||st.adm==="anul"){
    const list=st.adminRes.filter(r=>st.adm==="ok"?r.estado==="confirmada":r.estado!=="confirmada");
    const intro=st.adm==="anul"?'<p class="note">Reservas próximas que el jugador anuló o que el club liberó. Esas canchas ya están disponibles.</p>':"";
    body.innerHTML=intro+(list.length?list.map(r=>admCard(r,st.adm==="ok"?"release":"")).join("")
      :`<div class="card empty">${st.adm==="ok"?"No hay reservas próximas.":"No hay canchas anuladas ni liberadas."}</div>`);
  }else if(st.adm==="fer"){
    const fer=[...(st.club.feriados||[])].sort((a,b)=>a.fecha.localeCompare(b.fecha)).filter(f=>f.fecha>=now);
    body.innerHTML=`<div class="card"><div class="sec-title"><h4>Feriados</h4><span>Horario de fin de semana</span></div>
      <div style="margin-top:8px">${fer.length?fer.map(f=>`<div class="hol"><span><b>${nice(f.fecha)}</b> ${parse(f.fecha).getFullYear()} · ${esc(f.nombre)}</span><button data-delfer="${f.fecha}">Quitar</button></div>`).join(""):'<p class="note">No hay feriados cargados.</p>'}</div></div>
      <div class="card"><form class="inline-form" id="ferForm"><input id="ferDate" type="date" aria-label="Fecha"><input id="ferName" placeholder="Nombre del feriado" aria-label="Nombre"><button>Agregar</button></form><p class="err" id="ferErr" hidden></p></div>`;
  }else{
    if(!st.draft)st.draft={soloFinde:SOLO()?1:0,diasAnticipacion:DIAS(),limiteFinde:LIM(),precioSemana:st.club.precioSemana??16000,precioFinde:st.club.precioFinde??16000,mananaHasta:MH(),
      jornadaSemana:jSem().map(x=>[...x]),jornadaFinde:jFin().map(x=>[...x])};
    const d=st.draft;
    const hsel=(id,v,min,max)=>`<select data-k="${id}">${Array.from({length:max-min+1},(_,i)=>min+i).map(h=>`<option value="${h}" ${h===v?"selected":""}>${hh(h)}</option>`).join("")}</select>`;
    const jEditor=(name,label,arr)=>`<div class="card"><div class="sec-title"><h4>${label}</h4><span>${arr.length} bloques</span></div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">${arr.map(([a,z],i)=>`<div class="jrow">${hsel(name+"."+i+".0",a,6,23)}<span>a</span>${hsel(name+"."+i+".1",z,7,24)}<button type="button" data-jdel="${name}.${i}">Quitar</button></div>`).join("")}</div>
      <button type="button" class="jadd" data-jadd="${name}">+ Agregar bloque</button></div>`;
    body.innerHTML=`<div class="card"><div class="sec-title"><h4>Precios por bloque</h4><span>CLP</span></div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
      <label for="dSem">Tardes de lunes a viernes (todos)<input id="dSem" data-f="precioSemana" type="number" min="0" step="500" value="${d.precioSemana}"></label>
      <label for="dFin">Tardes de fin de semana y feriados (no socios)<input id="dFin" data-f="precioFinde" type="number" min="0" step="500" value="${d.precioFinde}"></label>
      <label for="dMan">Mañana gratis para todos hasta las<select id="dMan" data-f="mananaHasta" class="selfull">${[8,9,10,11,12,13,14].map(h=>`<option value="${h}" ${h===d.mananaHasta?"selected":""}>${h===8?"Sin mañana gratis":hh(h)}</option>`).join("")}</select></label>
      <p class="note">Los socios no pagan las tardes de fin de semana y feriados.</p></div></div>
      <div class="card"><div class="sec-title"><h4>Reglas de reserva</h4></div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
      <label for="dAnt">Anticipación máxima<select id="dAnt" data-f="diasAnticipacion" class="selfull">${[2,3,5,7,10,14].map(n=>`<option value="${n}" ${n===d.diasAnticipacion?"selected":""}>${n} días</option>`).join("")}</select></label>
      <label for="dSolo">Días que se reservan por la app<select id="dSolo" data-f="soloFinde" class="selfull"><option value="1" ${d.soloFinde?"selected":""}>Solo sábados, domingos y feriados</option><option value="0" ${d.soloFinde?"":"selected"}>Todos los días</option></select></label>
      <label for="dLim">Máximo de reservas por persona en sábados, domingos y feriados (por semana)<select id="dLim" data-f="limiteFinde" class="selfull">${[0,1,2,3,4].map(n=>`<option value="${n}" ${n===d.limiteFinde?"selected":""}>${n===0?"Sin límite":n}</option>`).join("")}</select></label>
      <p class="note">Los días hábiles no tienen límite. Las reservas anuladas o liberadas no cuentan.</p></div></div>
      ${jEditor("jornadaSemana","Jornada lunes a viernes",d.jornadaSemana)}
      ${jEditor("jornadaFinde","Jornada fin de semana y feriados",d.jornadaFinde)}
      <p class="err" id="jErr" hidden></p>
      <div style="display:flex;gap:8px"><button type="button" class="btn-line" id="jReset" style="flex:1">Descartar</button><button type="button" class="cta" id="jSave" style="flex:2">Guardar cambios</button></div>
      <p class="note">Los cambios aplican a las reservas nuevas. Las reservas ya hechas mantienen su horario y precio.</p>`;
  }
}
function renderAll(){
  if(st.view==="book"){renderCourts();renderDates();renderSlots()}
  if(st.view==="confirm")renderSummary();
  if(st.view==="list")renderList();
  if(st.view==="admin"&&!(st.adm==="tar"&&st.draft))renderAdmin();
  if(st.view==="profile")renderProfile();
  renderCta();
}
function go(v){
  st.view=v;
  for(const id of ["book","auth","setup","recover","confirm","done","list","admin","profile"])$("v-"+id).hidden=id!==v;
  const tab=["list","profile","admin"].includes(v)?v:"book";
  document.querySelectorAll("#nav button").forEach(b=>{if(b.dataset.tab===tab)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
  renderAll();window.scrollTo(0,0);
}
function toast(t){const e=$("toast");e.textContent=t;e.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>e.hidden=true,2600)}
function showErr(id,t){$(id).textContent=t;$(id).hidden=false}
function openLogin(next){st.afterLogin=next||null;setAuthMode("login");go("auth")}
function openSetup(first){$("setupTitle").textContent=first?"Completa tus datos":"Editar datos";
  $("s-name").value=st.profile?.nombre||"";$("s-phone").value=st.profile?.telefono||"";$("s-member").checked=!!st.profile?.socio;$("setupErr").hidden=true;go("setup")}
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
  if((b.dataset.tab==="list")&&!st.uid){go("list");return}
  go(b.dataset.tab);if(b.dataset.tab!=="book")refresh()});
$("list").addEventListener("click",async e=>{
  if(e.target.closest("[data-login]"))return openLogin("list");
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
    $("confirmErr").hidden=true;return go("confirm");
  }
  if(st.view==="done"){st.hour=null;return go("book")}
  if(st.view!=="confirm"||busy)return;
  if(isTaken(st.date,st.court,st.hour))return showErr("confirmErr","Ese horario se acaba de ocupar. Vuelve y elige otro.");
  if(LIM()&&especial(st.date)&&myWeekendCount(st.date)>=LIM())return showErr("confirmErr",`Ya tienes ${LIM()} ${LIM()===1?"reserva":"reservas"} en fin de semana o feriado esa semana, que es el máximo por persona. Anula una para pedir otra.`);
  busy=true;$("cta").disabled=true;
  const {data,error}=await sb.rpc("reservar",{p_cancha:st.court,p_fecha:st.date,p_hora:st.hour});
  busy=false;
  if(error){showErr("confirmErr",errMsg(error));renderCta();loadOccupied().then(()=>{});return}
  const r=Array.isArray(data)?data[0]:data;
  $("doneText").textContent=`${COURTS[st.court-1].name}, ${nice(st.date)} de ${hh(r.hora)} a ${hh(r.fin)} · ${clp(r.precio)}`;
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
      const nombre=$("a-name").value.trim(),telefono=$("a-phone").value.trim(),socio=$("a-member").checked;
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
  const nombre=$("s-name").value.trim(),telefono=$("s-phone").value.trim(),socio=$("s-member").checked;
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
$("admTabs").onclick=e=>{const b=e.target.closest("[data-a]");if(!b)return;st.adm=b.dataset.a;st.draft=null;renderAdmin()};
$("admBody").addEventListener("change",e=>{const d=st.draft;if(!d)return;const t=e.target;
  if(t.dataset.f){d[t.dataset.f]=Math.max(0,+t.value||0);return}
  if(t.dataset.k){const [n,i,j]=t.dataset.k.split(".");d[n][+i][+j]=+t.value}});
$("admBody").addEventListener("click",async e=>{
  const t=e.target;
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
    const ok=await saveClub({soloFinde:!!d.soloFinde,diasAnticipacion:d.diasAnticipacion,limiteFinde:d.limiteFinde,precioSemana:d.precioSemana,precioFinde:d.precioFinde,mananaHasta:d.mananaHasta,jornadaSemana:ob(d.jornadaSemana),jornadaFinde:ob(d.jornadaFinde)},"Cambios guardados");
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
