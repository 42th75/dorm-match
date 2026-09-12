/* ══════════════ 화면 ══════════════ */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

let SOLVE = null;        // 마지막 계산 결과
let PICK  = "stable";    // 고른 방식
let DEMO  = null;        // 예시 결과 (공개 파일이 없을 때)

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
const pubData = ()=> Store.published || DEMO;

function renderBanner(){
  const b = $("#banner"); b.innerHTML = "";
  const add = (html, cls)=>{ const d=document.createElement("div");
    d.className="banner"+(cls?" "+cls:""); d.innerHTML=html; b.appendChild(d); };
  if(!Store.published && DEMO)
    add(`아직 결과가 공개되지 않았다. 지금 보이는 것은 <b>예시</b>다.`, "alert");
  if(Store.isAdmin && Store.survey.people.length)
    add(`불러온 응답 <b>${Store.survey.people.length}명</b>. 이 자료는 이 브라우저에만 있고 저장소에 올라가지 않는다.`);
}

function renderPublic(){
  const d = pubData();
  if(!d){ $("#roomGrid").innerHTML = `<p class="muted">아직 공개된 결과가 없다.</p>`; $("#pubStats").innerHTML=""; return; }
  const s = d.stats || {};
  $("#pubStats").innerHTML = `
    <div><span>방</span><b>${s.rooms||d.rooms.length}</b></div>
    <div><span>학생</span><b>${s.students||""}</b></div>
    <div><span>10순위 안에 배정</span><b>${s.top10Rate!=null?s.top10Rate+"%":"—"}</b></div>
    <div><span>서로 바꾸고 싶은 쌍</span><b class="${s.blocking?"warn":"good"}">${s.blocking!=null?s.blocking:"—"}</b></div>`;
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
  if(!d){ box.innerHTML = `<p class="muted">아직 공개된 결과가 없다.</p>`; return; }
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
$("#sampleCsv").onclick = ()=>{
  const ppl = makeSample(80, 777);
  const head = ["타임스탬프","학번","이름","평일에 보통 몇 시에 잠드나요?","평일에 보통 몇 시에 일어나나요?",
    "옆에서 나는 작은 소리나 불빛 때문에 잠을 설치나요?","책상이나 바닥에 물건이 며칠씩 쌓여 있는 편인가요?",
    "잘 때 방 온도는 어느 쪽이 좋나요?","룸메이트를 정할 때 가장 중요한 것 하나를 고른다면?",
    "같은 방이 되면 곤란한 학생이 있나요? (학번)"];
  const sb=v=>({21.5:"22시 이전",22.5:"22–23시",23.5:"23–24시",24.5:"24–01시",25.5:"01–02시",26.5:"02시 이후"})[v];
  const wb=v=>({5.7:"6시 이전",6.25:"6:00–6:30",6.75:"6:30–7:00",7.25:"7:00–7:30",7.7:"7:30 이후"})[v];
  const pb=v=>({sleep:"취침·기상 시간",quiet:"방의 조용함",tidy:"정리 정돈",temp:"방 온도",none:"크게 상관없다"})[v];
  const rows = ppl.map(p=>["2026/02/10 9:00",p.id,p.name,sb(p.sleep),wb(p.wake),p.sens,p.tidy,p.temp,pb(p.prio),(p.avoid||[]).join(" ")]);
  $("#csv").value = [head,...rows].map(r=>r.map(c=>{
    const t=String(c); return /[",\n]/.test(t) ? '"'+t.replace(/"/g,'""')+'"' : t; }).join(",")).join("\n");
  readCsvNow(null);
};
$("#clearCsv").onclick = ()=>{
  if(!confirm("불러온 응답을 지운다.")) return;
  Store.clearSurvey(); $("#csv").value=""; $("#csvMsg").innerHTML="";
  $("#mapSect").classList.add("hidden"); $("#distSect").classList.add("hidden");
  SOLVE=null; $("#modeBox").innerHTML=""; $("#pubSect").classList.add("hidden"); renderBanner();
};

/* ── 배정 실행 ── */
function parseLocked(){
  return $("#locked").value.split(/\n+/).map(l=>l.trim()).filter(Boolean)
    .map(l=>l.split(/[\s,]+/).filter(Boolean)).filter(a=>a.length>=2).map(a=>[a[0],a[1]]);
}
$("#doRun").onclick = ()=>{
  const people = Store.survey.people;
  if(people.length < 4){ $("#runInfo").innerHTML = `<span class="err">응답이 너무 적다. 먼저 응답을 불러온다.</span>`; return; }
  const locked = parseLocked();
  Store.setLocked(locked);
  $("#runInfo").textContent = "계산 중…";
  setTimeout(()=>{
    const t = Date.now();
    SOLVE = solveAll(people, {locked});
    $("#runInfo").textContent = `${people.length}명 · ${Date.now()-t}ms`;
    renderModes();
    $("#pubSect").classList.remove("hidden");
  }, 20);
};

function renderModes(){
  const R = SOLVE.results;
  const st = R.stable;
  const head = st.exact
    ? `<div class="banner"><b>안정 배정을 찾았다.</b> 서로 방을 바꾸고 싶어하는 쌍이 하나도 없다.</div>`
    : `<div class="banner alert"><div><b>안정 배정이 존재하지 않는다.</b>
        ${esc(st.note)} 대신 그런 쌍이 가장 적은 배정을 찾았다. 이건 프로그램의 한계가 아니라
        이 문제 자체의 성질이다. 자세한 내용은 '배정 방식' 탭에 있다.</div></div>`;
  const card = (key, label, desc)=>{
    const r = R[key]; if(!r) return "";
    const s = r.stats;
    return `<button class="mode" data-m="${key}" aria-pressed="${PICK===key}">
      <h4>${label}</h4><p>${desc}</p>
      <dl>
        <dt>바꾸고 싶은 쌍</dt><dd class="${s.blocking?"warn":"good"}">${s.blocking}</dd>
        <dt>평균 순위</dt><dd>${s.avgRank.toFixed(1)}</dd>
        <dt>가장 불운한 학생</dt><dd class="${s.worstRank>30?"warn":""}">${s.worstRank}위</dd>
        <dt>10순위 안</dt><dd>${(s.top10Rate*100).toFixed(0)}%</dd>
      </dl></button>`;
  };
  $("#modeBox").innerHTML = head + `<div class="modes">` +
    MODES.map(m=>card(m.key, m.label, m.desc)).join("") + `</div>
    <p class="note">'평균 순위 3.8'은 학생들이 평균적으로 자기와 가장 잘 맞는 3~4번째 상대와 같은 방이 됐다는 뜻이다.
    '가장 불운한 학생'이 크면 전체 평균이 좋아도 누군가 한 명은 많이 참아야 한다는 뜻이니 같이 본다.</p>
    <div id="picked"></div>`;
  $$(".mode").forEach(b=>b.onclick=()=>{ PICK = b.dataset.m; Store.setMode(PICK); renderModes(); });
  renderPicked();
}
function renderPicked(){
  const r = SOLVE.results[PICK]; if(!r) return;
  const all = SOLVE.all;
  $("#picked").innerHTML = `<h3 style="margin-top:22px">배정 미리보기</h3>
    <div class="rooms">${r.rooms.map((room,k)=>`
      <div class="room"><div class="rno">${k+1}번 방</div>
        ${room.map(i=>`<div class="m">${esc(all[i].name)}<span>${esc(all[i].id)}</span></div>`).join("")}
      </div>`).join("")}</div>`;
}

$("#publish").onclick = ()=>{
  if(!SOLVE){ return; }
  const r = SOLVE.results[PICK];
  const obj = Store.buildResult(r.rooms, SOLVE.all, r.stats, PICK, SOLVE.P);
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
  if(Store.survey.locked && Store.survey.locked.length)
    $("#locked").value = Store.survey.locked.map(p=>p.join(" ")).join("\n");
};
$("#pw").addEventListener("keydown", e=>{ if(e.key==="Enter") $("#pwOk").click(); });

/* ── 시작 ── */
(async function start(){
  document.title = CONFIG.title;
  $("#siteTitle").textContent = CONFIG.title;
  $("#siteSub").textContent = CONFIG.subtitle || "";
  $("#howDoc").innerHTML = HOW_DOC;
  await Store.init();
  if(!Store.published && CONFIG.demoWhenEmpty){
    const ppl = makeSample(40, 321);
    const s = solveAll(ppl, {});
    const r = s.results.stable;
    DEMO = Store.buildResult(r.rooms, s.all, r.stats, "stable", s.P);
    DEMO.demo = true;
  }
  applyRole(); renderBanner(); renderPublic();
  if(Store.isAdmin && Store.survey.raw){ $("#csv").value = Store.survey.raw; }
})();
