const CONFIG = { API_URL:'/api/apps-script' };
const state = {
  teacherId:'', teacherName:'', subjectId:'', subjectName:'', section:'',
  assignments:[], students:[], ranking:[], selectedStudent:null,
  selectedRewardType:'مشاركة', selectedPoints:1, loading:false
};
const el = Object.fromEntries([
  'teacherSelect','subjectSelect','sectionSelect','searchInput','refreshBtn','teacherName','subjectName',
  'studentCount','totalPoints','rewardEvents','topStudent','sectionTitle','visibleCount','studentsGrid','emptyState','rankingList',
  'modalBackdrop','closeModalBtn','modalAvatar','modalStudentName','modalStudentFullName','modalPoints','modalEvents',
  'rewardTypes','pointsChoices','noteInput','submitRewardBtn','undoRewardBtn','historyStatus','historyList','toast'
].map(id=>[id,document.getElementById(id)]));

document.addEventListener('DOMContentLoaded', init);

async function init(){ bindEvents(); await loadTeachers(); }

function bindEvents(){
  el.teacherSelect.addEventListener('change', async e=>{ await selectTeacher(e.target.value); });
  el.subjectSelect.addEventListener('change', async e=>{ await selectSubject(e.target.value); });
  el.sectionSelect.addEventListener('change', async e=>{ state.section=e.target.value; el.searchInput.value=''; await loadSection(); });
  el.searchInput.addEventListener('input', renderStudents);
  el.refreshBtn.addEventListener('click', ()=>{ if(state.section) loadSection(); });
  el.closeModalBtn.addEventListener('click', closeModal);
  el.modalBackdrop.addEventListener('click', e=>{ if(e.target===el.modalBackdrop) closeModal(); });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && !el.modalBackdrop.classList.contains('hidden')) closeModal(); });
  el.rewardTypes.addEventListener('click', e=>{ const b=e.target.closest('[data-reward]'); if(!b)return; state.selectedRewardType=b.dataset.reward; el.rewardTypes.querySelectorAll('[data-reward]').forEach(x=>x.classList.toggle('active',x===b)); });
  el.pointsChoices.addEventListener('click', e=>{ const b=e.target.closest('[data-points]'); if(!b)return; state.selectedPoints=Number(b.dataset.points); el.pointsChoices.querySelectorAll('[data-points]').forEach(x=>x.classList.toggle('active',x===b)); });
  el.submitRewardBtn.addEventListener('click', submitReward);
  el.undoRewardBtn.addEventListener('click', undoLastReward);
}

async function apiGet(params={}){
  const url=new URL(CONFIG.API_URL,window.location.origin);
  Object.entries(params).forEach(([k,v])=>{ if(v!==undefined&&v!==null&&v!=='') url.searchParams.set(k,v); });
  const r=await fetch(url,{headers:{Accept:'application/json'},cache:'no-store'});
  const d=await r.json().catch(()=>null);
  if(!r.ok||!d||d.success===false) throw new Error(d?.error||d?.message||'تعذر الاتصال بالخادم.');
  return d;
}
async function apiPost(payload){
  const r=await fetch(CONFIG.API_URL,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)});
  const d=await r.json().catch(()=>null);
  if(!r.ok||!d||d.success===false) throw new Error(d?.error||d?.message||'تعذر تنفيذ العملية.');
  return d;
}

async function loadTeachers(){
  setBoardEnabled(false);
  try{
    const d=await apiGet({action:'teachers'});
    const teachers=Array.isArray(d.teachers)?d.teachers:[];
    el.teacherSelect.innerHTML='<option value="">اختاري المعلمة</option>'+teachers.map(t=>`<option value="${escapeAttr(t.Teacher_ID)}">${escapeHtml(t.Teacher_Name)}</option>`).join('');
  }catch(e){ el.teacherSelect.innerHTML='<option value="">تعذر تحميل المعلمات</option>'; showToast(e.message,true); }
}

async function selectTeacher(teacherId){
  resetBoard(); state.teacherId=teacherId; state.teacherName=''; state.assignments=[];
  if(!teacherId){ el.teacherName.textContent='—'; return; }
  try{
    const d=await apiGet({action:'assignments',teacherId});
    state.teacherName=d.teacherName||''; state.assignments=Array.isArray(d.assignments)?d.assignments:[];
    el.teacherName.textContent=state.teacherName||'—';
    const subjects=[...new Map(state.assignments.map(a=>[a.subjectId,{id:a.subjectId,name:a.subjectName}])).values()];
    el.subjectSelect.innerHTML=subjects.map(s=>`<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`).join('');
    el.subjectSelect.disabled=!subjects.length;
    if(!subjects.length){ showToast('لا توجد مواد أو شعب مرتبطة بهذه المعلمة.',true); return; }
    await selectSubject(subjects[0].id);
  }catch(e){ showToast(e.message,true); }
}

async function selectSubject(subjectId){
  state.subjectId=subjectId;
  const matching=state.assignments.filter(a=>a.subjectId===subjectId);
  state.subjectName=matching[0]?.subjectName||'';
  el.subjectName.textContent=state.subjectName||'—';
  const sections=[...new Set(matching.map(a=>a.section))].sort(sectionSort);
  el.sectionSelect.innerHTML=sections.map(s=>`<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
  el.sectionSelect.disabled=!sections.length;
  state.section=sections[0]||'';
  if(state.section){ el.sectionSelect.value=state.section; setBoardEnabled(true); await loadSection(); }
  else { setBoardEnabled(false); resetBoardData(); }
}

function setBoardEnabled(on){ el.searchInput.disabled=!on; el.refreshBtn.disabled=!on; }
function resetBoard(){ state.subjectId='';state.subjectName='';state.section=''; el.subjectSelect.innerHTML='<option value="">—</option>';el.subjectSelect.disabled=true;el.sectionSelect.innerHTML='<option value="">—</option>';el.sectionSelect.disabled=true;el.subjectName.textContent='اختاري المعلمة لعرض المادة';resetBoardData();setBoardEnabled(false); }
function resetBoardData(){ state.students=[];state.ranking=[];updateStats({});renderStudents();renderRanking();el.sectionTitle.textContent='اختاري الشعبة'; }

async function loadSection(){
  if(state.loading||!state.teacherId||!state.subjectId||!state.section) return;
  state.loading=true; setLoading(true); el.sectionTitle.textContent=`تاسع ${state.section.split('/')[1]}`;
  try{
    const [s,d]=await Promise.all([
      apiGet({action:'students',section:state.section}),
      apiGet({action:'dashboard',section:state.section,teacherId:state.teacherId,subjectId:state.subjectId})
    ]);
    state.students=Array.isArray(s.students)?s.students:[]; state.ranking=Array.isArray(d.ranking)?d.ranking:[];
    updateStats(d); renderStudents(); renderRanking();
  }catch(e){ state.students=[];state.ranking=[];updateStats({});renderStudents();renderRanking();showToast(e.message,true); }
  finally{ state.loading=false; setLoading(false); }
}

function updateStats(d){ el.studentCount.textContent=Number.isFinite(Number(d.studentCount))?Number(d.studentCount):state.students.length;el.totalPoints.textContent=Number(d.totalPoints||0);el.rewardEvents.textContent=Number(d.rewardEvents||0);el.topStudent.textContent=d.topStudent&&Number(d.topStudent.totalPoints)>0?`${d.topStudent.shortName} · ${d.topStudent.totalPoints}`:'—'; }
function getSummary(id){ return state.ranking.find(x=>x.studentId===id)||{totalPoints:0,rewardEvents:0}; }
function renderStudents(){ const q=normalize(el.searchInput.value);const rows=state.students.filter(s=>!q||normalize(`${s.shortName} ${s.fullName}`).includes(q));el.visibleCount.textContent=`${rows.length} طالبة`;el.emptyState.classList.toggle('hidden',rows.length!==0);if(!rows.length){el.studentsGrid.innerHTML='';return;}el.studentsGrid.innerHTML=rows.map(s=>{const m=getSummary(s.studentId);const letter=escapeHtml((s.shortName||s.fullName||'ط').trim().charAt(0));return `<button class="student-card" type="button" data-id="${escapeAttr(s.studentId)}"><div class="student-top"><span class="avatar">${letter}</span><span class="student-name">${escapeHtml(s.shortName||s.fullName)}</span></div><div class="student-meta"><span class="mini"><small>النقاط</small><strong>${Number(m.totalPoints||0)}</strong></span><span class="mini"><small>مرات التعزيز</small><strong>${Number(m.rewardEvents||0)}</strong></span></div></button>`;}).join('');el.studentsGrid.querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>{const s=state.students.find(x=>x.studentId===b.dataset.id);if(s)openStudentModal(s);})); }
function renderRanking(){const rows=[...state.ranking].filter(x=>Number(x.totalPoints)>0).slice(0,10);if(!rows.length){el.rankingList.innerHTML='<div class="empty">لا توجد نقاط بعد. سيظهر الترتيب بعد أول تعزيز.</div>';return;}el.rankingList.innerHTML=rows.map((s,i)=>`<div class="rank"><span class="rank-num">${i+1}</span><span class="rank-name" title="${escapeAttr(s.fullName||s.shortName)}">${escapeHtml(s.shortName||s.fullName)}</span><span class="rank-points">${Number(s.totalPoints||0)} نقطة</span></div>`).join('');}
async function openStudentModal(student){state.selectedStudent=student;state.selectedRewardType='مشاركة';state.selectedPoints=1;resetChoices();el.noteInput.value='';const m=getSummary(student.studentId);el.modalAvatar.textContent=(student.shortName||student.fullName||'ط').trim().charAt(0);el.modalStudentName.textContent=student.shortName||student.fullName;el.modalStudentFullName.textContent=student.fullName||student.shortName;el.modalPoints.textContent=Number(m.totalPoints||0);el.modalEvents.textContent=Number(m.rewardEvents||0);el.modalBackdrop.classList.remove('hidden');el.modalBackdrop.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';await loadHistory();}
function closeModal(){state.selectedStudent=null;el.modalBackdrop.classList.add('hidden');el.modalBackdrop.setAttribute('aria-hidden','true');document.body.style.overflow='';}
function resetChoices(){el.rewardTypes.querySelectorAll('[data-reward]').forEach(b=>b.classList.toggle('active',b.dataset.reward==='مشاركة'));el.pointsChoices.querySelectorAll('[data-points]').forEach(b=>b.classList.toggle('active',b.dataset.points==='1'));}
async function submitReward(){if(!state.selectedStudent)return;setModalBusy(true);try{const d=await apiPost({action:'addReward',studentId:state.selectedStudent.studentId,teacherId:state.teacherId,subjectId:state.subjectId,rewardType:state.selectedRewardType,points:state.selectedPoints,note:el.noteInput.value.trim()});showToast(`تم تسجيل ${d.pointsAdded} نقطة لـ ${state.selectedStudent.shortName}.`);el.noteInput.value='';await refreshAfterReward();}catch(e){showToast(e.message,true);}finally{setModalBusy(false);}}
async function undoLastReward(){if(!state.selectedStudent)return;if(!confirm(`هل تريدين التراجع عن آخر تعزيز للطالبة ${state.selectedStudent.shortName}؟`))return;setModalBusy(true);try{await apiPost({action:'undoLastReward',studentId:state.selectedStudent.studentId,teacherId:state.teacherId,subjectId:state.subjectId});showToast('تم التراجع عن آخر تعزيز.');await refreshAfterReward();}catch(e){showToast(e.message,true);}finally{setModalBusy(false);}}
async function refreshAfterReward(){const id=state.selectedStudent?.studentId;const [s,d]=await Promise.all([apiGet({action:'students',section:state.section}),apiGet({action:'dashboard',section:state.section,teacherId:state.teacherId,subjectId:state.subjectId})]);state.students=Array.isArray(s.students)?s.students:[];state.ranking=Array.isArray(d.ranking)?d.ranking:[];updateStats(d);renderStudents();renderRanking();if(id){state.selectedStudent=state.students.find(x=>x.studentId===id)||state.selectedStudent;const m=getSummary(id);el.modalPoints.textContent=Number(m.totalPoints||0);el.modalEvents.textContent=Number(m.rewardEvents||0);await loadHistory();}}
async function loadHistory(){if(!state.selectedStudent)return;el.historyStatus.textContent='جارٍ التحميل...';el.historyList.innerHTML='';try{const d=await apiGet({action:'history',studentId:state.selectedStudent.studentId,teacherId:state.teacherId,subjectId:state.subjectId});const rows=Array.isArray(d.history)?[...d.history].reverse().slice(0,6):[];el.historyStatus.textContent=`${Number(d.rewardEvents||0)} سجل`;if(!rows.length){el.historyList.innerHTML='<small>لا توجد تعزيزات مسجلة لهذه الطالبة بعد.</small>';return;}el.historyList.innerHTML=rows.map(x=>`<div class="history-item"><span class="history-type">${escapeHtml(x.Reward_Type||'تعزيز')}</span><span class="history-info"><strong>${escapeHtml(x.Note||'بدون ملاحظة')}</strong><small>${escapeHtml(formatDate(x.Date,x.Time))}</small></span><span class="history-points">+${Number(x.Points||0)}</span></div>`).join('');}catch(e){el.historyStatus.textContent='تعذر التحميل';el.historyList.innerHTML=`<small>${escapeHtml(e.message)}</small>`;}}
function setLoading(on){el.refreshBtn.disabled=on||!state.section;if(on){el.studentsGrid.innerHTML=Array.from({length:9},()=>'<div class="skeleton"></div>').join('');el.rankingList.innerHTML=Array.from({length:5},()=>'<div class="skeleton" style="min-height:50px"></div>').join('');}}
function setModalBusy(on){el.submitRewardBtn.disabled=on;el.undoRewardBtn.disabled=on;el.submitRewardBtn.textContent=on?'جارٍ الحفظ...':'✦ تسجيل التعزيز';}
let toastTimer;function showToast(msg,error=false){clearTimeout(toastTimer);el.toast.textContent=msg;el.toast.classList.toggle('error',error);el.toast.classList.remove('hidden');toastTimer=setTimeout(()=>el.toast.classList.add('hidden'),3200);}
function sectionSort(a,b){return Number(String(a).split('/')[1])-Number(String(b).split('/')[1]);}
function normalize(v){return String(v||'').trim().toLowerCase().replace(/[إأآا]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه');}
function formatDate(d,t){const ds=String(d||'').slice(0,10),ts=String(t||'').slice(0,8);return [ds,ts].filter(Boolean).join(' · ')||'—';}
function escapeHtml(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
function escapeAttr(v){return escapeHtml(v);}
