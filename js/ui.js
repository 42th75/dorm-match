/* ══════════════ 화면 ══════════════ */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

let SOLVE = null;        // 마지막 계산 결과

/* ── 권한 ── */
function applyRole(){
  const a = Store.isAdmin;
  $$("[data-admin]").forEach(el=>el.classList.toggle("hidden", !a));
  $("#roleTag").textContent = a ? "관리자" : "학생";
  $("#roleTag").classList.toggle("admin", a);
  $("#authBtn").textContent = a ? "로그아웃" : "관리자 로그인";
  if(!a && ["survey","run"].includes(cur())) go("me");
}
const cur = ()=> ($$(".tab.on")[0]||{id:"tab-me"}).id.replace("tab-","");
const ADMIN_TABS = ["survey","run"];
function go(name){
  if(ADMIN_TABS.includes(name) && !Store.isAdmin) name = "me";
  $$("nav button").forEach(b=>b.setAttribute("aria-current", b.dataset.tab===name?"page":"false"));
  $$(".tab").forEach(s=>s.classList.toggle("on", s.id==="tab-"+name));
  window.scrollTo(0,0);
}
$$("nav button").forEach(b=>b.onclick=()=>go(b.dataset.tab));

/* ── 공개된 결과 ── */
const pubData = ()=> Store.published;

function renderBanner(){
  const b = $("#banner"); b.innerHTML = "";
  const add = (html, cls)=>{ const d=document.createElement("div");
    d.className="banner"+(cls?" "+cls:""); d.innerHTML=html; b.appendChild(d); };
  if(Store.isAdmin && Store.survey.people.length)
    add(`불러온 응답 <b>${Store.survey.people.length}명</b>. 이 자료는 이 브라우저에만 있고 저장소에 올라가지 않는다.`);
}

function renderPublic(){
  const d = pubData();
  if(!d){ $("#roomGrid").innerHTML = `<p class="muted">아직 배정 결과가 공개되지 않았다.</p>`; $("#pubStats").innerHTML=""; return; }
  const s = d.stats || {};
  $("#pubStats").innerHTML = `
    <div><span>방</span><b>${s.rooms||d.rooms.length}</b></div>
    <div><span>학생</span><b>${s.students||""}</b></div>
    <div><span>10순위 안에 배정</span><b>${s.top10Rate!=null?s.top10Rate+"%":"—"}</b></div>`;
  $("#roomGrid").innerHTML = d.rooms.map(r=>`
    <div class="room"><div class="rno">${r.no}번 방</div>
      ${r.members.map(m=>`<div class="m">${esc(m.name)}<span>${esc(m.id)}</span></div>`).join("")}
    </div>`).join("");
}

function lookup(){
  const id = $("#myId").value.trim();
  const box = $("#myResult");
  const d = pubData();
  if(!id){ box.innerHTML = `<p class="err">학번을 입력한다.</p>`; return; }
  if(!d){ box.innerHTML = `<p class="muted">아직 배정 결과가 공개되지 않았다. 발표된 뒤에 다시 확인한다.</p>`; return; }
  const room = d.rooms.find(r=>r.members.some(m=>String(m.id)===id));
  if(!room){ box.innerHTML = `<p class="err">${esc(id)} 학번을 결과에서 찾지 못했다. 학번을 다시 확인하거나 담당 선생님께 문의한다.</p>`; return; }
  const me = room.members.find(m=>String(m.id)===id);
  const others = room.members.filter(m=>String(m.id)!==id);
  const rz = (room.reasons||[]).find(x=>String(x.id)===id);
  box.innerHTML = `<div class="result">
    <div class="rno">${room.no}번 방</div>
    <div class="pair"><b>${esc(me.name)}</b><span class="arrow">·</span>
      ${others.map(o=>`<b>${esc(o.name)}</b>`).join('<span class="arrow">·</span>')}</div>
    ${rz && rz.lines ? `<div class="muted" style="margin-bottom:6px">이렇게 정해진 이유</div>
      <ul>${rz.lines.map(l=>`<li>${esc(l)}</li>`).join("")}</ul>` : ""}
  </div>`;
}
$("#lookup").onclick = lookup;
$("#myId").addEventListener("keydown", e=>{ if(e.key==="Enter") lookup(); });

/* ── 응답 불러오기 ── */
let LAST = null;   // {people, problems, header, map}
function readCsvNow(mapOverride){
  const text = $("#csv").value;
  if(!text.trim()){ $("#csvMsg").innerHTML = `<p class="err">먼저 응답을 붙여넣는다.</p>`; return; }
  const r = readSurvey(text, mapOverride);
  LAST = r;
  if(!r.people.length){
    $("#csvMsg").innerHTML = `<p class="err">응답을 하나도 읽지 못했다. 제목 줄이 포함됐는지 확인한다.</p>`;
    return;
  }
  Store.setSurvey(r.people, text, r.map);
  const probs = r.problems.length
    ? `<div class="banner alert" style="margin-top:12px"><div>확인할 것이 있다.
        <ul style="margin:6px 0 0">${r.problems.map(p=>`<li>${esc(p)}</li>`).join("")}</ul></div></div>` : "";
  $("#csvMsg").innerHTML = `<div class="banner" style="margin-top:12px">
      <b>${r.people.length}명</b>의 응답을 읽었다. 기피를 적은 학생 ${r.people.filter(p=>p.avoid.length).length}명.</div>${probs}`;
  renderMap(r); renderDist(r.people); renderBanner();
  $("#mapSect").classList.remove("hidden");
  $("#distSect").classList.remove("hidden");
}
function renderMap(r){
  const keys = Object.keys(FIELDS);
  $("#mapTable").innerHTML = `<thead><tr><th>항목</th><th>연결된 열</th><th>첫 응답 예시</th></tr></thead><tbody>`
    + keys.map(k=>{
        const sel = `<select data-k="${k}"><option value="-1">(없음)</option>` +
          r.header.map((h,i)=>`<option value="${i}" ${r.map[k]===i?"selected":""}>${esc(String(h).slice(0,42))}</option>`).join("") +
          `</select>`;
        const smp = r.map[k]>=0 && r.people[0] ? esc(String(r.people[0][k]!=null?r.people[0][k]:"")) : "";
        const bad = r.map[k]<0 && k!=="avoid" && k!=="prio";
        return `<tr><td>${FIELDS[k].label}${bad?' <span class="err">←</span>':""}</td><td>${sel}</td><td class="muted">${smp}</td></tr>`;
      }).join("") + `</tbody>`;
}
function renderDist(people){
  const ds = distribution(people);
  $("#dist").innerHTML = ds.map(d=>{
    const max = Math.max(...d.rows.map(r=>r.n),1);
    const flat = d.spread < 0.35;
    return `<div style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:4px">${esc(d.label)}
        ${flat?'<span class="warn" style="font-size:12.5px;font-weight:400">· 답이 한쪽에 몰려 변별력이 낮다</span>':""}</div>
      <table class="dist"><tbody>${d.rows.map(r=>`<tr>
        <td class="lab">${esc(r.label)}</td>
        <td><div class="bar"><i style="width:${Math.round(r.n/max*100)}%"></i></div></td>
        <td class="r num" style="width:56px">${r.n}명</td></tr>`).join("")}</tbody></table></div>`;
  }).join("");
}
$("#readCsv").onclick = ()=>readCsvNow(null);
$("#remap").onclick = ()=>{
  const ov = {};
  $$("#mapTable select").forEach(s=>ov[s.dataset.k] = +s.value);
  readCsvNow(ov);
};
$("#clearCsv").onclick = ()=>{
  if(!confirm("불러온 응답을 지운다.")) return;
  Store.clearSurvey(); $("#csv").value=""; $("#csvMsg").innerHTML="";
  $("#mapSect").classList.add("hidden"); $("#distSect").classList.add("hidden");
  SOLVE=null; $("#runOut").innerHTML=""; $("#pubSect").classList.add("hidden"); renderBanner();
};

/* ── 배정 실행 ── */
$("#doRun").onclick = ()=>{
  const people = Store.survey.people;
  if(people.length < 4){ $("#runInfo").innerHTML = `<span class="err">응답이 너무 적다. 먼저 응답을 불러온다.</span>`; return; }
  $("#runInfo").textContent = "계산 중…";
  setTimeout(()=>{
    const t = Date.now();
    SOLVE = solve(people);
    if(!SOLVE.ok){ $("#runInfo").innerHTML = `<span class="err">${esc(SOLVE.reason)}</span>`; return; }
    $("#runInfo").textContent = `${people.length}명 · ${Date.now()-t}ms`;
    renderRun();
    $("#ghToken").value = Store.ghToken || "";   // 저장된 토큰이 있으면 미리 채운다
    $("#pubSect").classList.remove("hidden");
  }, 20);
};

function renderRun(){
  const s = SOLVE.stats, all = SOLVE.all;
  const notes = [];
  if(SOLVE.hasLeftover) notes.push(`인원이 홀수라 한 명은 혼자 쓰는 방이 되었다. 응답 인원을 짝수로 맞춰 다시 계산한다.`);
  $("#runOut").innerHTML = `
    <div class="kpis" style="margin-bottom:14px">
      <div><span>방</span><b>${SOLVE.rooms.length}</b></div>
      <div><span>평균 순위</span><b>${s.avgRank.toFixed(1)}</b></div>
      <div><span>10순위 안</span><b>${(s.top10Rate*100).toFixed(0)}%</b></div>
      <div><span>생활차이 큰 학생</span><b class="${s.hard>s.matched*0.1?"warn":"good"}">${s.hard}명</b></div>
      <div><span>아주 큰 학생</span><b class="${s.vhard?"bad":"good"}">${s.vhard}명</b></div>
    </div>
    ${notes.length?`<p class="note">${notes.join(" ")}</p>`:""}
    <p class="note">'평균 순위 ${s.avgRank.toFixed(1)}'은 학생들이 평균적으로 자기와
      ${Math.round(s.avgRank)}번째로 잘 맞는 상대와 같은 방이 됐다는 뜻이다.
      '생활차이 큰 학생'은 생활 시간이나 습관이 꽤 어긋난 학생 수이고, 이 수를 줄이는 것이
      배정의 목표다. 참고로 이번 응답에서는 서로 방을 바꾸고 싶어할 수 있는 쌍이
      ${s.blocking}개 있다.</p>
    <h3 style="margin-top:22px">배정 미리보기</h3>
    <div class="rooms">${SOLVE.rooms.map((room,k)=>`
      <div class="room"><div class="rno">${k+1}번 방</div>
        ${room.map(i=>`<div class="m">${esc(all[i].name)}<span>${esc(all[i].id)}</span></div>`).join("")}
      </div>`).join("")}</div>`;
}

$("#publish").onclick = async ()=>{
  if(!SOLVE || !SOLVE.ok) return;
  const tok = $("#ghToken").value.trim();
  if(tok) Store.setGhToken(tok);            // 입력한 토큰을 이 브라우저에 저장
  const obj = Store.buildResult(SOLVE.rooms, SOLVE.all, SOLVE.stats, SOLVE.P);
  const btn = $("#publish"), label = btn.textContent;
  btn.disabled = true; btn.textContent = "올리는 중…"; $("#pubMsg").innerHTML = "";
  try{
    await Store.publish(obj);
    $("#pubMsg").innerHTML = `<div class="banner" style="margin-top:12px">
      깃허브에 <b>공개(v${obj.version})</b> 했다. 1~2분 뒤 학생들이 자기 학번으로 결과를 볼 수 있다.</div>`;
  }catch(e){
    $("#pubMsg").innerHTML = `<div class="banner alert" style="margin-top:12px"><div>
      올리지 못했다: ${esc(e.message)}<br>
      토큰이 맞는지, 이 저장소에 쓰기 권한이 있는지 확인한다. 급하면 아래 <b>파일로 내려받기</b> 로도 할 수 있다.
      </div></div>`;
  }finally{ btn.disabled = false; btn.textContent = label; }
};
$("#publishFile").onclick = ()=>{
  if(!SOLVE || !SOLVE.ok) return;
  const obj = Store.buildResult(SOLVE.rooms, SOLVE.all, SOLVE.stats, SOLVE.P);
  Store.download(obj, "result.json");
  $("#pubMsg").innerHTML = `<div class="banner" style="margin-top:12px">
    <b>result.json</b> 을 내려받았다. 저장소의 <code>data/result.json</code> 을 이 파일로 바꾸고 커밋하면 공개된다.</div>`;
};

/* ── 로그인 ── */
const dlg = $("#loginDlg");
$("#authBtn").onclick = ()=>{
  if(Store.isAdmin){ Store.logout(); applyRole(); renderBanner(); return; }
  $("#pw").value=""; $("#pwErr").classList.add("hidden");
  dlg.showModal ? dlg.showModal() : dlg.setAttribute("open","");
  $("#pw").focus();
};
const closeDlg = ()=> dlg.close ? dlg.close() : dlg.removeAttribute("open");
$("#pwCancel").onclick = closeDlg;
$("#pwOk").onclick = ()=>{
  if(!Store.login($("#pw").value)){ $("#pwErr").classList.remove("hidden"); return; }
  closeDlg(); applyRole(); renderBanner();
  if(Store.survey.raw){ $("#csv").value = Store.survey.raw; readCsvNow(Store.survey.map); }
};
$("#pw").addEventListener("keydown", e=>{ if(e.key==="Enter") $("#pwOk").click(); });

/* ── 시작 ── */
(async function start(){
  document.title = CONFIG.title;
  $("#siteTitle").textContent = CONFIG.title;
  $("#siteSub").textContent = CONFIG.subtitle || "";
  await Store.init();
  applyRole(); renderBanner(); renderPublic();
  if(Store.isAdmin && Store.survey.raw){ $("#csv").value = Store.survey.raw; }
})();
