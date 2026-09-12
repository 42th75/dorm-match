/* ══════════════════════════════════════════════════════════════
   기숙사 룸메이트 배정 엔진 (2인실)

   설문 → 비대칭 생활비용 → 선호 순위 → 배정 → 지표
   화면을 전혀 건드리지 않는다. Node 에서 그대로 불러 쓸 수 있다.

   세 가지 목표로 각각 배정해 보고 관리자가 고르게 한다.
     안정 우선   : 서로 바꾸고 싶어하는 쌍(차단 쌍)이 없는 배정 (Irving)
     공평 우선   : 가장 불운한 학생의 순위를 낮추는 배정
     총만족 우선 : 전체 생활비용 합을 낮추는 배정
   ══════════════════════════════════════════════════════════════ */

/* ── 설문 문항 정의 : CSV 열 찾기, 설문 안내, 비용 계산이 이 표 하나를 본다 ── */
const FIELDS = {
  id:    {label:"학번", keys:["학번","학번을","번호","id"]},
  name:  {label:"이름", keys:["이름","성명","name"]},
  sleep: {label:"취침 시각", keys:["잠드","취침","몇 시에 잠"], type:"bucket",
          buckets:[["22시 이전",21.5],["22",22.5],["23",23.5],["24",24.5],["01",25.5],["02시 이후",26.5]]},
  wake:  {label:"기상 시각", keys:["일어","기상"], type:"bucket",
          buckets:[["6시 이전",5.7],["6:00",6.25],["6:30",6.75],["7:00",7.25],["7:30",7.7]]},
  sens:  {label:"소리·불빛 민감도", keys:["설치","민감","작은 소리","깨"], type:"scale"},
  tidy:  {label:"정리 정돈", keys:["쌓여","정리","치운"], type:"scale"},
  temp:  {label:"실내 온도", keys:["온도","서늘","따뜻"], type:"scale"},
  prio:  {label:"가장 중요한 것", keys:["중요"], type:"choice",
          choices:[["취침",'sleep'],["시간",'sleep'],["조용",'quiet'],["정리",'tidy'],["온도",'temp'],["상관",'none']]},
  avoid: {label:"기피 학번", keys:["곤란","기피","같은 방이 되면"], type:"text"}
};
const SCALE_MAX = 5;

/* 기본 가중치. 합이 1 이 되도록 맞춘다. */
const BASE_W = {sleep:0.38, wake:0.22, tidy:0.26, temp:0.14};

function weightsFor(p){
  const w = Object.assign({}, BASE_W);
  if(p.prio === "sleep"){ w.sleep*=2; w.wake*=2; }
  else if(p.prio === "tidy") w.tidy*=2;
  else if(p.prio === "temp") w.temp*=2;
  const s = w.sleep+w.wake+w.tidy+w.temp;
  for(const k in w) w[k] /= s;
  return w;
}

/* ── 비대칭 생활비용 : a 입장에서 b 와 지내는 불편함 ──────────
   민감도는 내 쪽 값만 쓴다. 예민한 사람에게 생활 시간 차이는 크게 다가오고
   둔감한 사람에게는 같은 차이가 덜하다. 그래서 a→b 와 b→a 가 다르다.   */
function habitCost(a, b){
  const w = weightsFor(a);
  const z = (a.sens - 1)/(SCALE_MAX - 1);                  // 0 ~ 1
  const amp = (a.prio === "quiet") ? (0.5 + 1.0*z) : (0.5 + 0.7*z);
  let c = 0;
  c += w.sleep * Math.min(1, Math.abs(a.sleep - b.sleep)/2.5) * amp;
  c += w.wake  * Math.min(1, Math.abs(a.wake  - b.wake )/1.5) * amp;
  c += w.tidy  * Math.abs(a.tidy - b.tidy)/(SCALE_MAX-1);
  c += w.temp  * Math.abs(a.temp - b.temp)/(SCALE_MAX-1);
  return c;
}

/* ── 선호 순위 : 생활비용이 낮은 순. 기피 쌍은 후보에서 제외 ── */
function buildPreferences(people){
  const n = people.length;
  const byId = {}; people.forEach((p,i)=>{ byId[String(p.id)] = i; });
  const banned = Array.from({length:n},()=>new Set());
  people.forEach((p,i)=>(p.avoid||[]).forEach(v=>{
    const j = byId[String(v).trim()];
    if(j!=null && j!==i){ banned[i].add(j); banned[j].add(i); }   // 한쪽만 적어도 양쪽 제외
  }));

  const cost = Array.from({length:n},()=>new Float64Array(n));
  for(let i=0;i<n;i++) for(let j=0;j<n;j++) if(i!==j) cost[i][j] = habitCost(people[i], people[j]);

  const prefs = [], rankOf = [];
  for(let i=0;i<n;i++){
    const list = [];
    for(let j=0;j<n;j++) if(j!==i && !banned[i].has(j)) list.push(j);
    list.sort((x,y)=>cost[i][x]-cost[i][y]);
    prefs.push(list);
    const r = new Int32Array(n).fill(1e9);
    list.forEach((j,k)=>r[j]=k);
    rankOf.push(r);
  }
  return {prefs, rankOf, cost, banned, byId};
}

/* ── Irving 안정 룸메이트 알고리즘 ──────────────────────────── */
function irving(prefs, rankOf){
  const n = prefs.length;
  const list = prefs.map(l=>l.slice());
  const remove = (i,j)=>{ const k=list[i].indexOf(j); if(k>=0) list[i].splice(k,1); };
  const removeBoth = (i,j)=>{ remove(i,j); remove(j,i); };

  /* 1단계 : 제안 */
  const holder = new Int32Array(n).fill(-1);
  const next   = new Int32Array(n).fill(0);
  const free   = []; for(let i=0;i<n;i++) free.push(i);
  while(free.length){
    const x = free.pop();
    if(next[x] >= list[x].length) return {ok:false, reason:"제안할 상대가 떨어진 학생이 있다"};
    const y = list[x][next[x]], cur = holder[y];
    if(cur === -1) holder[y] = x;
    else if(rankOf[y][x] < rankOf[y][cur]){ holder[y]=x; next[cur]++; free.push(cur); }
    else { next[x]++; free.push(x); }
  }
  /* 1단계 축소 : y 가 x 를 붙들고 있으면 y 는 x 보다 못한 상대를 모두 지운다 */
  for(let y=0;y<n;y++){
    const x = holder[y];
    list[y].filter(z => rankOf[y][z] > rankOf[y][x]).forEach(z => removeBoth(y,z));
  }
  for(let i=0;i<n;i++) if(!list[i].length) return {ok:false, reason:"선택지가 없어진 학생이 있다"};

  /* 2단계 : 회전 제거 */
  let guard = 0;
  for(;;){
    if(++guard > 4*n*n + 80) return {ok:false, reason:"회전 제거가 끝나지 않았다"};
    let start = -1;
    for(let i=0;i<n;i++) if(list[i].length>1){ start=i; break; }
    if(start === -1) break;

    const seq = [], seenAt = new Map();
    let a = start;
    for(;;){
      if(seenAt.has(a)) break;
      seenAt.set(a, seq.length);
      const b = list[a][1];
      if(b === undefined) return {ok:false, reason:"회전을 만들 수 없다"};
      seq.push([a,b]);
      a = list[b][list[b].length-1];
    }
    for(const [ai, bi] of seq.slice(seenAt.get(a)))
      list[bi].filter(z => rankOf[bi][z] > rankOf[bi][ai]).forEach(z => removeBoth(bi, z));
    for(let i=0;i<n;i++) if(!list[i].length) return {ok:false, reason:"선택지가 없어진 학생이 있다"};
  }

  const match = new Int32Array(n).fill(-1);
  for(let i=0;i<n;i++) match[i] = list[i][0];
  for(let i=0;i<n;i++) if(match[match[i]] !== i) return {ok:false, reason:"짝이 어긋났다"};
  return {ok:true, match};
}

/* ── 차단 쌍 : 서로 지금 짝보다 상대를 더 좋아하는 쌍 ────────── */
function blockingPairs(match, rankOf){
  const n = rankOf.length, out = [];
  for(let i=0;i<n;i++) for(let j=i+1;j<n;j++){
    if(match[i]===j) continue;
    const ri = match[i]===-1?1e9:rankOf[i][match[i]], rj = match[j]===-1?1e9:rankOf[j][match[j]];
    if(rankOf[i][j] < ri && rankOf[j][i] < rj) out.push([i,j]);
  }
  return out;
}

/* ── 기본 배정들 ─────────────────────────────────────────── */
const pairsToMatch = (n, pairs)=>{
  const m = new Int32Array(n).fill(-1);
  pairs.forEach(([a,b])=>{ m[a]=b; m[b]=a; });
  return m;
};
function greedyMatch(n, cost, banned){
  const cand = [];
  for(let i=0;i<n;i++) for(let j=i+1;j<n;j++) if(!banned[i].has(j)) cand.push([cost[i][j]+cost[j][i], i, j]);
  cand.sort((a,b)=>a[0]-b[0]);
  const used = new Uint8Array(n), pairs = [];
  for(const [,i,j] of cand) if(!used[i] && !used[j]){ used[i]=used[j]=1; pairs.push([i,j]); }
  return pairs.length*2 === n ? pairsToMatch(n, pairs) : null;
}
function randomMatch(n, banned, rnd){
  for(let t=0;t<500;t++){
    const o = [...Array(n).keys()];
    for(let i=n-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [o[i],o[j]]=[o[j],o[i]]; }
    const pairs=[]; let ok=true;
    for(let i=0;i+1<n;i+=2){ if(banned[o[i]].has(o[i+1])){ ok=false; break; } pairs.push([o[i],o[i+1]]); }
    if(ok) return pairsToMatch(n, pairs);
  }
  return null;
}

/* ── 목표를 바꿔 가며 도는 2-교환 국소 탐색 ───────────────── */
function localSearch(n, cost, banned, rankOf, objective, starts){
  let best = null, bestV = Infinity;
  for(const s0 of starts){
    if(!s0) continue;
    const m = Int32Array.from(s0);
    let cur = objective(m);
    for(let pass=0; pass<120; pass++){
      let moved = false;
      for(let a=0;a<n;a++) for(let c=a+1;c<n;c++){
        const b=m[a], d=m[c];
        if(b===c||a===d||b===-1||d===-1) continue;
        if(banned[a].has(c)||banned[b].has(d)) continue;
        m[a]=c;m[c]=a;m[b]=d;m[d]=b;
        const v = objective(m);
        if(v < cur - 1e-12){ cur = v; moved = true; }
        else { m[a]=b;m[b]=a;m[c]=d;m[d]=c; }
      }
      if(!moved) break;
    }
    if(cur < bestV){ bestV = cur; best = Int32Array.from(m); }
  }
  return best;
}

/* ── 지표 ────────────────────────────────────────────────── */
function metrics(match, rankOf, cost){
  const n = rankOf.length;
  let sumRank=0, worst=0, first=0, sumCost=0, maxCost=0, cnt=0;
  const ranks=[];
  for(let i=0;i<n;i++){
    if(match[i]===-1) continue;
    cnt++;
    const r = rankOf[i][match[i]]+1;
    ranks.push(r); sumRank+=r; worst=Math.max(worst,r);
    if(r===1) first++;
    const c = cost[i][match[i]];
    sumCost+=c; maxCost=Math.max(maxCost,c);
  }
  ranks.sort((a,b)=>a-b);
  return {
    blocking: blockingPairs(match, rankOf).length,
    avgRank: cnt?sumRank/cnt:0, medRank: ranks.length?ranks[Math.floor(ranks.length/2)]:0,
    worstRank: worst, top10Rate: cnt?ranks.filter(r=>r<=10).length/cnt:0,
    firstRate: cnt?first/cnt:0, avgCost: cnt?sumCost/cnt:0, maxCost, matched:cnt
  };
}

/* ── 세 가지 목표로 각각 배정한다 ───────────────────────── */
const MODES = [
  {key:"stable",  label:"안정 우선",   desc:"서로 바꾸고 싶어하는 쌍이 생기지 않게 한다"},
  {key:"fair",    label:"공평 우선",   desc:"가장 불운한 학생의 순위를 끌어올린다"},
  {key:"total",   label:"총만족 우선", desc:"전체 생활비용의 합을 가장 낮춘다"}
];

function solveAll(people, opts){
  opts = opts || {};
  const rnd = opts.rnd || Math.random;
  const locked = opts.locked || [];          // [[학번, 학번], ...] 관리자가 미리 붙인 쌍
  const all = people;
  const N = all.length;

  // 고정 쌍과 홀수 인원을 빼고 나머지로 계산한다
  const byId = {}; all.forEach((p,i)=>byId[String(p.id)]=i);
  const fixed = [], usedIdx = new Set();
  for(const [x,y] of locked){
    const i = byId[String(x).trim()], j = byId[String(y).trim()];
    if(i==null || j==null || i===j || usedIdx.has(i) || usedIdx.has(j)) continue;
    fixed.push([i,j]); usedIdx.add(i); usedIdx.add(j);
  }
  let poolIdx = [...Array(N).keys()].filter(i=>!usedIdx.has(i));
  let leftover = -1;
  if(poolIdx.length % 2 === 1){
    leftover = poolIdx[poolIdx.length-1];     // 나중에 비용이 가장 적게 느는 방에 합류
    poolIdx = poolIdx.slice(0,-1);
  }

  const sub = poolIdx.map(i=>all[i]);
  const P = buildPreferences(sub);
  const n = sub.length;
  const gr = greedyMatch(n, P.cost, P.banned);
  const rs = [gr]; for(let t=0;t<5;t++) rs.push(randomMatch(n, P.banned, rnd));

  const costOf = m => { let s=0; for(let i=0;i<n;i++) if(m[i]>=0) s+=P.cost[i][m[i]]; return s; };
  const worstOf = m => { let w=0; for(let i=0;i<n;i++) if(m[i]>=0) w=Math.max(w,P.rankOf[i][m[i]]); return w; };

  const out = {};
  // 안정 우선
  const irv = irving(P.prefs, P.rankOf);
  if(irv.ok) out.stable = {match:irv.match, exact:true, note:"안정 배정을 찾았다"};
  else {
    const m = localSearch(n,P.cost,P.banned,P.rankOf,
      mm=>blockingPairs(mm,P.rankOf).length*1000 + costOf(mm), rs);
    out.stable = {match:m, exact:false, note:"안정 배정이 존재하지 않아 차단 쌍을 최소화했다: "+irv.reason};
  }
  // 공평 우선 : 최악 순위를 먼저 줄이고, 같으면 총비용으로 가른다
  out.fair = {match: localSearch(n,P.cost,P.banned,P.rankOf,
      mm=>worstOf(mm)*1000 + costOf(mm), rs.concat([out.stable.match])), exact:false};
  // 총만족 우선
  out.total = {match: localSearch(n,P.cost,P.banned,P.rankOf, costOf, rs), exact:false};
  // 비교용
  out.random = {match: randomMatch(n, P.banned, rnd), exact:false};

  const pack = key => {
    const m = out[key].match;
    if(!m) return null;
    const rooms = [], done = new Uint8Array(n);
    for(let i=0;i<n;i++){
      if(done[i] || m[i]<0) continue;
      done[i]=done[m[i]]=1;
      rooms.push([poolIdx[i], poolIdx[m[i]]]);
    }
    fixed.forEach(f=>rooms.unshift(f.slice()));
    if(leftover >= 0){
      const Pall = buildPreferences(all);
      let best=0, bv=Infinity;
      rooms.forEach((r,k)=>{
        if(r.some(x=>Pall.banned[leftover].has(x))) return;
        const v = r.reduce((s,x)=>s+Pall.cost[leftover][x]+Pall.cost[x][leftover],0);
        if(v<bv){ bv=v; best=k; }
      });
      rooms[best] = rooms[best].concat(leftover);
    }
    return {rooms, stats: metrics(m, P.rankOf, P.cost),
            exact: out[key].exact, note: out[key].note || ""};
  };

  return {P, poolIdx, all, fixedCount: fixed.length, leftover,
          results: {stable:pack("stable"), fair:pack("fair"), total:pack("total"), random:pack("random")}};
}

/* 받침 유무에 따라 조사를 고른다 */
function josa(word, withB, without){
  const c = String(word).charCodeAt(String(word).length-1);
  if(!(c >= 0xAC00 && c <= 0xD7A3)) return without;
  return ((c - 0xAC00) % 28) ? withB : without;
}

/* ── 배정 근거 (기피 정보는 절대 넣지 않는다) ─────────────── */
function explain(a, b, rank, total){
  const out = [];
  const near = [];
  if(Math.abs(a.sleep-b.sleep) <= 0.6) near.push("잠드는 시간");
  if(Math.abs(a.wake -b.wake ) <= 0.4) near.push("일어나는 시간");
  if(Math.abs(a.tidy -b.tidy ) <= 1)   near.push("정리 습관");
  if(Math.abs(a.temp -b.temp ) <= 1)   near.push("선호 온도");
  if(near.length){ const t = near.join(", "); out.push(t + josa(t,"이","가") + " 비슷하다"); }
  if(a.sens >= 4 && Math.abs(a.sleep-b.sleep) <= 0.6)
    out.push("잠귀가 밝은 편인데 생활 시간이 거의 같다");
  if(a.prio === "sleep" && Math.abs(a.sleep-b.sleep) <= 1)
    out.push("가장 중요하다고 답한 생활 시간이 잘 맞는다");
  if(a.prio === "tidy" && Math.abs(a.tidy-b.tidy) <= 1)
    out.push("가장 중요하다고 답한 정리 습관이 잘 맞는다");
  if(a.prio === "temp" && Math.abs(a.temp-b.temp) <= 1)
    out.push("가장 중요하다고 답한 온도 취향이 잘 맞는다");
  if(!out.length) out.push("남은 조합 중에서 생활 차이가 가장 작았다");
  out.push(`전체 ${total}명 가운데 ${rank}번째로 잘 맞는 상대다`);
  return out;
}

/* ── 예시 응답 ───────────────────────────────────────────── */
function makeSample(n, seedIn){
  let seed = seedIn || 20260912;
  const rnd = ()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
  const nrm = ()=>{ let s=0; for(let i=0;i<6;i++) s+=rnd(); return (s-3)/Math.sqrt(0.5); };
  const SUR = "김이박최정강조윤장임한오서신권황안송전홍".split("");
  const GIV = "민서 지우 하준 예윤 도현 시아 은채 수빈 태윤 라온 소율 준혁 가온 세림 다원 유찬 나경 지호 서윤 하율".split(" ");
  const prios = ["sleep","sleep","quiet","tidy","temp","none"];
  const people = [], used = new Set();
  for(let i=0;i<n;i++){
    let nm; do{ nm = SUR[Math.floor(rnd()*SUR.length)] + GIV[Math.floor(rnd()*GIV.length)]; }while(used.has(nm));
    used.add(nm);
    const owl = nrm();
    const cl = (v)=>Math.max(1,Math.min(5,Math.round(v)));
    people.push({
      id: String(2400 + i + 1),
      name: nm,
      sleep: [21.5,22.5,23.5,24.5,25.5,26.5][Math.max(0,Math.min(5,Math.round(2.4+owl*1.1)))],
      wake:  [5.7,6.25,6.75,7.25,7.7][Math.max(0,Math.min(4,Math.round(2+owl*0.8+nrm()*0.5)))],
      sens:  cl(3+nrm()*1.2), tidy: cl(3+nrm()*1.2), temp: cl(3+nrm()*1.1),
      prio:  prios[Math.floor(rnd()*prios.length)],
      avoid: []
    });
  }
  // 기피는 드물게 (학폭·다툼 같은 경우) — 전체의 3% 정도
  const k = Math.max(1, Math.round(n*0.03));
  for(let t=0;t<k;t++){
    const i = Math.floor(rnd()*n); let j = Math.floor(rnd()*n);
    if(i!==j) people[i].avoid = [people[j].id];
  }
  return people;
}
