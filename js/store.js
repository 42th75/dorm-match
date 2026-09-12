/* ─────────────────────────────────────────────────────────────
   자료 보관

   서버가 없다. 그래서 두 가지를 완전히 나눠 둔다.

   1) 설문 원본 (기피 학번 포함)
      관리자 브라우저에만 저장한다. 절대 저장소에 올라가지 않는다.
   2) 배정 결과 (data/result.json)
      방 목록과 짧은 근거만 담는다. 기피 정보와 원본 응답은 들어가지 않는다.
      이 파일만 커밋해서 모두에게 공개한다.
   ───────────────────────────────────────────────────────────── */
const Store = (()=>{
  const SURVEY_KEY = "dorm.survey.v1";     // 관리자 전용, 공개되지 않음
  const SESS_KEY   = "dorm.admin";
  let published = null;
  let survey = {people:[], raw:"", map:null, locked:[], updatedAt:""};

  const now = ()=> new Date().toISOString();

  async function fetchPublished(){
    try{
      const r = await fetch("data/result.json?t="+Date.now(), {cache:"no-store"});
      if(!r.ok) return null;
      const d = await r.json();
      return (d && Array.isArray(d.rooms)) ? d : null;
    }catch(e){ return null; }
  }
  function loadSurvey(){
    try{ const s = localStorage.getItem(SURVEY_KEY);
         if(s){ const d = JSON.parse(s); if(d && Array.isArray(d.people)) survey = d; } }catch(e){}
  }
  function saveSurvey(){
    try{ localStorage.setItem(SURVEY_KEY, JSON.stringify(survey)); }catch(e){}
  }

  return {
    get published(){ return published; },
    get survey(){ return survey; },
    get isAdmin(){ try{ return sessionStorage.getItem(SESS_KEY)==="1"; }catch(e){ return false; } },
    login(pw){ if(pw !== CONFIG.adminPassword) return false;
               try{ sessionStorage.setItem(SESS_KEY,"1"); }catch(e){} return true; },
    logout(){ try{ sessionStorage.removeItem(SESS_KEY); }catch(e){} },

    async init(){
      published = await fetchPublished();
      loadSurvey();
      return this;
    },
    setSurvey(people, raw, map){
      survey.people = people; survey.raw = raw; survey.map = map; survey.updatedAt = now();
      saveSurvey();
    },
    setLocked(list){ survey.locked = list; saveSurvey(); },
    clearSurvey(){ survey = {people:[], raw:"", map:null, locked:[], updatedAt:""};
                   try{ localStorage.removeItem(SURVEY_KEY); }catch(e){} },

    /* 공개용 결과 파일을 만든다. 기피와 원본 응답은 넣지 않는다. */
    buildResult(rooms, people, stats, P){
      const out = {
        version: (published && published.version || 0) + 1,
        updatedAt: now(),
        title: CONFIG.title, subtitle: CONFIG.subtitle,
        stats: {
          rooms: rooms.length, students: rooms.reduce((s,r)=>s+r.length,0),
          avgRank: +stats.avgRank.toFixed(2), worstRank: stats.worstRank,
          top10Rate: +(stats.top10Rate*100).toFixed(1), hard: stats.hard
        },
        rooms: rooms.map((r,k)=>({
          no: k+1,
          members: r.map(i=>({id: people[i].id, name: people[i].name})),
          reasons: r.map(i=>{
            const others = r.filter(x=>x!==i);
            if(!others.length)   // 인원이 홀수라 혼자 쓰는 방
              return {id: people[i].id, lines: ["인원이 홀수라 아직 룸메이트가 정해지지 않았다 (혼자 쓰는 방)"]};
            const j = others[0];
            const rank = (P.rankOf[i] && P.rankOf[i][j]!=null && P.rankOf[i][j]<1e8)
                       ? P.rankOf[i][j]+1 : null;
            return {id: people[i].id,
                    lines: explain(people[i], people[j], rank || "-", people.length-1)};
          })
        }))
      };
      return out;
    },
    download(obj, filename){
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(obj,null,1)],{type:"application/json"}));
      a.download = filename; a.click();
    }
  };
})();
