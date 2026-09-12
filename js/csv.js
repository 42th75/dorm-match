/* ══════════════════════════════════════════════════════════════
   구글 폼 CSV 읽기

   구글 폼은 첫 줄에 질문 문장을 그대로 쓴다. 질문을 조금 고쳐도
   프로그램이 망가지지 않도록, 열 제목에서 핵심 낱말을 찾아 항목을 맞춘다.
   ══════════════════════════════════════════════════════════════ */

/* 따옴표 안의 쉼표와 줄바꿈까지 처리하는 CSV 파서 */
function parseCSV(text){
  const rows = [];
  let row = [], cell = "", q = false;
  const s = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for(let i=0;i<s.length;i++){
    const c = s[i];
    if(q){
      if(c === '"'){
        if(s[i+1] === '"'){ cell += '"'; i++; }
        else q = false;
      } else cell += c;
    } else {
      if(c === '"') q = true;
      else if(c === ","){ row.push(cell); cell = ""; }
      else if(c === "\n"){ row.push(cell); rows.push(row); row = []; cell = ""; }
      else if(c === "\t"){ row.push(cell); cell = ""; }   // 시트에서 그냥 복사한 경우
      else cell += c;
    }
  }
  row.push(cell);
  if(row.length > 1 || row[0] !== "") rows.push(row);
  return rows.filter(r => r.some(v => String(v).trim() !== ""));
}

/* 열 제목을 보고 어떤 항목인지 맞힌다 */
function guessColumns(header){
  const map = {};
  const used = new Set();
  for(const key of Object.keys(FIELDS)){
    const kws = FIELDS[key].keys;
    let best = -1, bestScore = 0;
    header.forEach((h, i)=>{
      if(used.has(i)) return;
      const t = String(h).replace(/\s+/g, "");
      let sc = 0;
      kws.forEach(k=>{ if(t.includes(k.replace(/\s+/g,""))) sc += k.length; });
      if(sc > bestScore){ bestScore = sc; best = i; }
    });
    if(best >= 0){ map[key] = best; used.add(best); }
    else map[key] = -1;
  }
  return map;
}

/* 선형 배율(1~5) 값 뽑기 */
function toScale(v){
  const m = String(v).match(/\d+/);
  if(!m) return 3;
  return Math.max(1, Math.min(5, parseInt(m[0], 10)));
}
/* 객관식 보기를 숫자로 (문항 정의의 buckets 를 본다) */
function toBucket(v, buckets){
  const t = String(v).replace(/\s+/g, "");
  for(const [label, val] of buckets) if(t.includes(label.replace(/\s+/g,""))) return val;
  const m = t.match(/(\d{1,2})/);              // "23시" 처럼 숫자만 들어온 경우
  if(m){
    const h = parseInt(m[1],10);
    let bestV = buckets[0][1], bd = Infinity;
    for(const [,val] of buckets){ const d = Math.abs((h<12?h+24:h) - (val<12?val+24:val));
      if(d < bd){ bd = d; bestV = val; } }
    return bestV;
  }
  return buckets[Math.floor(buckets.length/2)][1];
}
function toPrio(v){
  const t = String(v).replace(/\s+/g,"");
  for(const [word, code] of FIELDS.prio.choices) if(t.includes(word)) return code;
  return "none";
}

/* CSV 전체 → 응답자 배열 + 문제 목록 */
function readSurvey(text, mapOverride){
  const rows = parseCSV(text);
  if(rows.length < 2) return {people:[], problems:["표에 자료가 없다. 제목 줄과 응답이 모두 있어야 한다."], header:[], map:{}};
  const header = rows[0];
  const map = Object.assign(guessColumns(header), mapOverride || {});
  const problems = [];
  for(const key of ["id","name","sleep","wake","sens","tidy","temp"])
    if(map[key] < 0) problems.push(`'${FIELDS[key].label}' 열을 찾지 못했다. 아래 표에서 직접 골라야 한다.`);

  const get = (r, key)=> map[key] >= 0 ? (r[map[key]] || "") : "";
  const people = [], seen = {};
  rows.slice(1).forEach((r, n)=>{
    const id = String(get(r,"id")).trim();
    const name = String(get(r,"name")).trim();
    if(!id && !name) return;
    if(!id){ problems.push(`${n+2}번째 줄: 학번이 비어 있다 (${name})`); return; }
    const p = {
      id, name: name || id,
      sleep: toBucket(get(r,"sleep"), FIELDS.sleep.buckets),
      wake:  toBucket(get(r,"wake"),  FIELDS.wake.buckets),
      sens:  toScale(get(r,"sens")),
      tidy:  toScale(get(r,"tidy")),
      temp:  toScale(get(r,"temp")),
      prio:  toPrio(get(r,"prio")),
      avoid: String(get(r,"avoid")).split(/[,\s/·]+/).map(s=>s.trim()).filter(s=>/^\d+$/.test(s))
    };
    if(seen[id] != null){ people[seen[id]] = p; }      // 같은 학번은 마지막 응답만 남긴다
    else { seen[id] = people.length; people.push(p); }
  });

  // 기피에 적힌 학번이 실제로 있는지 확인
  const ids = new Set(people.map(p=>p.id));
  people.forEach(p=>{
    const bad = (p.avoid||[]).filter(v=>!ids.has(v));
    if(bad.length) problems.push(`${p.name}(${p.id})의 기피 학번 ${bad.join(", ")}이 응답자 명단에 없다`);
    p.avoid = (p.avoid||[]).filter(v=>ids.has(v) && v !== p.id);
  });
  if(people.length && people.length % 2 === 1)
    problems.push(`응답이 ${people.length}명으로 홀수다. 2인실만 있어 한 명은 혼자 쓰는 방이 된다.`);
  return {people, problems, header, map};
}

/* 문항별 응답 분포 — 다들 같은 답을 고른 문항은 배정에 도움이 안 된다 */
function distribution(people){
  const out = [];
  const push = (label, buckets, values)=>{
    const cnt = {}; values.forEach(v=>cnt[v] = (cnt[v]||0)+1);
    const rows = buckets.map(b=>({label:b[0], n:cnt[b[1]]||0}));
    const total = values.length || 1;
    const top = Math.max(...rows.map(r=>r.n));
    out.push({label, rows, total, spread: 1 - top/total});   // 0 이면 전부 같은 답
  };
  push(FIELDS.sleep.label, FIELDS.sleep.buckets, people.map(p=>p.sleep));
  push(FIELDS.wake.label,  FIELDS.wake.buckets,  people.map(p=>p.wake));
  [["sens",FIELDS.sens.label],["tidy",FIELDS.tidy.label],["temp",FIELDS.temp.label]].forEach(([k,l])=>
    push(l, [1,2,3,4,5].map(v=>[String(v), v]), people.map(p=>p[k])));
  push(FIELDS.prio.label, [["생활 시간","sleep"],["조용함","quiet"],["정리","tidy"],["온도","temp"],["상관없음","none"]],
       people.map(p=>p.prio));
  return out;
}
