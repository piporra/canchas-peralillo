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
  occupied:new Set(),who:new Map(),mine:[],adminRes:[],draft:null,afterLogin:null};

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
  const {data,error}=st.uid?await sb.rpc("agenda",args):await sb.rpc("ocupados",args);if(error)return;
  st.occupied=new Set((data||[]).map(r=>`${r.fecha}|${r.cancha}|${r.hora}`));
  st.who=new Map((data||[]).filter(r=>"nombre" in r).map(r=>[`${r.fecha}|${r.cancha}|${r.hora}`,{nombre:r.nombre,mio:r.es_mio}]))}
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
    const lab=!t?"Disponible":w?(w.mio?"Tu reserva":`Reservada por ${esc(w.nombre)}`):st.occupied.has(`${st.date}|${st.court}|${h}`)?(st.uid?"Reservada":"Reservada · ingresa para ver por quién"):"No disponible";
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
function renderSummary(){
  $("sumList").innerHTML=`<dt>Cancha</dt><dd>${COURTS[st.court-1].name}</dd><dt>Fecha</dt><dd>${nice(st.date)}</dd><dt>Horario</dt><dd>${hh(st.hour)} – ${hh(endOf(st.date,st.hour))}</dd><dt>A nombre de</dt><dd>${esc(st.profile?.nombre)}</dd><dt>Costo</dt><dd>Sin costo para socios</dd>`;
}
function renderList(){
  if(!st.uid){$("list").innerHTML=`<div class="card empty">Ingresa con tu cuenta para ver tus reservas.<br><br><button class="cta" data-login="1">Ingresar</button></div>`;return}
  const items=st.mine;
  $("list").innerHTML=items.length?items.map(r=>{const d=parse(r.fecha);
    return `<div class="card res"><div class="when"><b>${d.getDate()}</b><small>${MONTHS[d.getMonth()].slice(0,3)}</small></div>
    <div class="info"><strong>${COURTS[r.cancha-1].name} · ${hh(r.hora)} – ${hh(r.fin)}</strong><small>${DAYS[d.getDay()]} · ${esc(r.id)}</small><div style="margin-top:4px"><span class="chip ${r.estado}">${LABEL[r.estado]}</span></div></div>
    ${r.estado==="confirmada"?`<button data-cancel="${esc(r.id)}">Anular</button>`:""}</div>`}).join("")
    :`<div class="card empty">Aún no tienes reservas.<br>Elige cancha y horario en <b>Reservar</b>.</div>`;
}
function renderProfile(){
  const logged=!!st.uid;$("pCard").hidden=!logged;$("pLogin").hidden=logged;
  if(logged){$("pName").textContent=st.profile?.nombre||"—";$("pPhone").textContent=st.profile?.telefono||"—";$("pEmail").textContent=st.email}
  $("pHours").innerHTML=SOLO()?`Sábados, domingos y feriados: ${fmtJ(jFin())}`:`Lunes a viernes: ${fmtJ(jSem())}<br>Sábados, domingos y feriados: ${fmtJ(jFin())}`;
  $("pRules").textContent=`Fines de semana: se reservan desde el ${DIA_NOMBRE[ABRE_DIA()]} · Feriados: desde ${ABRE_FER()} ${ABRE_FER()===1?"día":"días"} antes${LIM_DIA()?` · Máximo ${LIM_DIA()===1?"una cancha":LIM_DIA()+" canchas"} por socio al día`:""} · Sin costo para socios.`;
}
function admCard(r,mode){
  const p=r.perfiles||{};
  return `<div class="card adm-item"><div class="row"><div><strong>${COURTS[r.cancha-1].name} · ${nice(r.fecha)}</strong><div>${hh(r.hora)} – ${hh(r.fin)}</div></div><span class="chip ${r.estado}">${LABEL[r.estado]}</span></div>
  <div class="who">${esc(p.nombre||"Sin nombre")}${p.telefono?" · "+esc(p.telefono):""} · ${esc(r.id)}</div>
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
  if(LIM_DIA()&&myDayCount(st.date)>=LIM_DIA())return showErr("confirmErr",LIM_DIA()===1?"Ya tienes una cancha reservada ese día. Cada socio puede reservar una cancha por día.":`Ya tienes ${LIM_DIA()} canchas reservadas ese día, que es el máximo por socio.`);
  busy=true;$("cta").disabled=true;
  const {data,error}=await sb.rpc("reservar",{p_cancha:st.court,p_fecha:st.date,p_hora:st.hour});
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
$("admTabs").onclick=e=>{const b=e.target.closest("[data-a]");if(!b)return;st.adm=b.dataset.a;st.draft=null;renderAdmin()};
$("admBody").addEventListener("change",e=>{const d=st.draft;if(!d)return;const t=e.target;
  if(t.dataset.f){d[t.dataset.f]=Math.max(0,+t.value||0);if(t.dataset.f==="soloFinde")renderAdmin();return}
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
