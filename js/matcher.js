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
          buckets:[["24시 이전",23.7],["24:00",24.25],["00:30",24.75],["01:00",25.25],["01:30",25.75],["02시 이후",26.4]]},
  wake:  {label:"기상 시각", keys:["일어","기상"], type:"bucket",
          buckets:[["7시 이전",6.8],["7:00",7.17],["7:20",7.5],["7:40",7.83],["8시 이후",8.2]]},
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
  c += w.sleep * Math.min(1, Math.abs(a.sleep - b.sleep)/1.5) * amp;
  c += w.wake  * Math.min(1, Math.abs(a.wake  - b.wake )/0.8) * amp;
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

/* ── 지표 ──────────────────────────────────────────────────
   최종 방(잠금 쌍 포함)을 원래 학번 인덱스 기준 선호표로 훑는다.
   2인실만 있으므로 룸메는 한 명이다. 인원이 홀수라 혼자 쓰는 방이 생기면
   그 학생은 룸메가 없어 지표 계산에서 뺀다.                              */
const HARD = 0.18, VERY_HARD = 0.30;   // 개인 생활차이가 이보다 크면 꽤 / 많이 안 맞는다고 본다
function roomStats(rooms, P){
  const rankOf = P.rankOf, cost = P.cost, N = rankOf.length;
  let sumRank=0, worst=0, first=0, sumCost=0, maxCost=0, cnt=0, hard=0, vhard=0;
  const ranks=[];
  for(const room of rooms){
    for(const i of room){
      const others = room.filter(x=>x!==i);
      if(!others.length) continue;
      cnt++;
      let bestRank = Infinity, worstCost = 0;
      for(const j of others){
        const rr = (rankOf[i][j]!=null && rankOf[i][j] < 1e8) ? rankOf[i][j]+1 : null;
        if(rr!=null && rr < bestRank) bestRank = rr;
        if(cost[i][j] > worstCost) worstCost = cost[i][j];
      }
      const r = isFinite(bestRank) ? bestRank : N;   // 기피 등으로 순위가 없으면 최하위로 본다
      ranks.push(r); sumRank+=r; worst=Math.max(worst,r);
      if(r===1) first++;
      sumCost+=worstCost; maxCost=Math.max(maxCost,worstCost);
      if(worstCost > HARD) hard++;
      if(worstCost > VERY_HARD) vhard++;
    }
  }
  ranks.sort((a,b)=>a-b);
  return {
    blocking: 0,   // 호출한 쪽에서 채운다 (차단 쌍은 2인 안정성 지표라 따로 계산)
    avgRank: cnt?sumRank/cnt:0, medRank: ranks.length?ranks[Math.floor(ranks.length/2)]:0,
    worstRank: worst, top10Rate: cnt?ranks.filter(r=>r<=10).length/cnt:0,
    firstRate: cnt?first/cnt:0, avgCost: cnt?sumCost/cnt:0, maxCost, matched:cnt, hard, vhard
  };
}

/* ── 배정 ─────────────────────────────────────────────────────
   목표 : 전체 생활차이의 합을 줄이되, 가장 힘든 학생 한 명을 특히 강하게 보정한다.
          합만 줄이면 평균은 좋아도 한 명이 크게 참아야 하는 배정이 나온다.

          점수 = 전체 생활차이 합 + WORST_W × 인원 × (가장 큰 개인 생활차이)

   왜 안정 배정(Irving)을 최종안으로 쓰지 않는가
     차단 쌍(서로 지금 룸메보다 상대를 더 좋아하는 쌍)을 0으로 만드는 배정은
     반대로 한 학생을 아주 나쁜 상대와 묶는 일이 잦았다. 80명 24회 실측에서
     생활차이가 큰 학생이 안정 우선 7.8명 / 아주 큰 학생 2.7명이었던 반면,
     이 방식은 3.5명 / 0.0명이었다. 차단 쌍은 서로의 설문 응답을 알아야 성립하는
     이론적 지표라 실제 민원으로 이어지지 않는다. 그래서 실제 불편을 줄이는 쪽을 골랐다.
     다만 Irving 은 그대로 쓴다. 좋은 출발점을 주고, 안정 배정이 존재하는지도 알려 준다.
   ────────────────────────────────────────────────────────── */
const WORST_W = 1.5;

function solve(people, opts){
  opts = opts || {};
  const rnd = opts.rnd || Math.random;
  const locked = opts.locked || [];
  const all = people, N = all.length;

  // 미리 정해 둔 쌍과 홀수 인원을 빼고 계산한다
  const byId = {}; all.forEach((p,i)=>byId[String(p.id)] = i);
  const fixed = [], usedIdx = new Set();
  for(const [x,y] of locked){
    const i = byId[String(x).trim()], j = byId[String(y).trim()];
    if(i==null || j==null || i===j || usedIdx.has(i) || usedIdx.has(j)) continue;
    fixed.push([i,j]); usedIdx.add(i); usedIdx.add(j);
  }
  let poolIdx = [...Array(N).keys()].filter(i=>!usedIdx.has(i));
  let leftover = -1;
  if(poolIdx.length % 2 === 1){ leftover = poolIdx[poolIdx.length-1]; poolIdx = poolIdx.slice(0,-1); }

  const sub = poolIdx.map(i=>all[i]);
  const P = buildPreferences(sub);
  const n = sub.length;
  if(n < 2) return {ok:false, reason:"계산할 학생이 너무 적다"};

  const totalCost = m => { let s=0; for(let i=0;i<n;i++) if(m[i]>=0) s+=P.cost[i][m[i]]; return s; };
  const worstCost = m => { let w=0; for(let i=0;i<n;i++) if(m[i]>=0) w=Math.max(w,P.cost[i][m[i]]); return w; };

  // 출발점 여럿에서 국소 탐색을 돌린다. Irving 의 답도 출발점으로 넣는다.
  const irv = irving(P.prefs, P.rankOf);
  const starts = [greedyMatch(n, P.cost, P.banned)];
  if(irv.ok) starts.push(irv.match);
  for(let t=0;t<4;t++) starts.push(randomMatch(n, P.banned, rnd));

  const match = localSearch(n, P.cost, P.banned, P.rankOf,
                            m => totalCost(m) + WORST_W * n * worstCost(m), starts);
  if(!match) return {ok:false, reason:"조건을 모두 지키는 배정을 찾지 못했다"};

  // 전체 학생을 원래 번호 그대로 담은 선호표. 잠금 쌍까지 포함해
  // 근거와 지표를 낼 때 이 표 하나만 본다. (계산용 P 는 풀 인덱스라 섞이면 안 된다)
  const Pall = buildPreferences(all);

  // 원래 번호로 되돌려 방을 만든다
  const rooms = [], done = new Uint8Array(n);
  for(let i=0;i<n;i++){
    if(done[i] || match[i]<0) continue;
    done[i] = done[match[i]] = 1;
    rooms.push([poolIdx[i], poolIdx[match[i]]]);
  }
  fixed.forEach(f=>rooms.unshift(f.slice()));
  // 2인실만 있으므로 3인실을 만들지 않는다. 인원이 홀수여서 남는 한 명은
  // 혼자 쓰는 방으로 두고, 관리자가 인원을 맞추거나 미리 정해 둘 방으로 조정한다.
  if(leftover >= 0) rooms.push([leftover]);

  // 최종 방 기준 지표(잠금 쌍 포함, 혼자 쓰는 방은 룸메가 없어 제외).
  // 차단 쌍만 2인 안정성 지표라 따로 센다.
  const stats = roomStats(rooms, Pall);
  stats.blocking = blockingPairs(match, P.rankOf).length;

  return {ok:true, rooms, P: Pall, all, poolIdx, match,
          stableExists: irv.ok, stableNote: irv.ok ? "" : irv.reason,
          fixedCount: fixed.length, hasLeftover: leftover >= 0, stats};
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
  if(Math.abs(a.sleep-b.sleep) <= 0.5) near.push("잠드는 시간");
  if(Math.abs(a.wake -b.wake ) <= 0.34) near.push("일어나는 시간");
  if(Math.abs(a.tidy -b.tidy ) <= 1)   near.push("정리 습관");
  if(Math.abs(a.temp -b.temp ) <= 1)   near.push("선호 온도");
  if(near.length){ const t = near.join(", "); out.push(t + josa(t,"이","가") + " 비슷하다"); }
  // 근거 문구는 두 사람이 '서로 비슷하다'는 쌍 정보만 담는다. 민감도·우선항목처럼
  // 개인이 혼자 적은 응답은, 문구가 나타나는 것만으로도 값이 드러나므로 넣지 않는다.
  if(near.length >= 3) out.push("여러 생활 습관이 고루 잘 맞는 편이다");
  if(!out.length) out.push("남은 조합 중에서 생활 차이가 가장 작았다");
  out.push(`전체 ${total}명 가운데 ${rank}번째로 잘 맞는 상대다`);
  return out;
}
