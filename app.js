const CONFIG = {
  API_URL: '/api/apps-script',
  CACHE_VERSION: 'v9',
  RETRIES: 1
};

const state = {
  teacherId: '',
  teacherName: '',
  subjectId: '',
  subjectName: '',
  section: '',
  allAssignments: [],
  students: [],
  ranking: [],
  dashboard: null,
  selectedStudent: null,
  selectedRewardType: 'مشاركة',
  selectedPoints: 1,
  loading: false
};

const ids = [
  'teacherSelect','subjectSelect','sectionSelect','searchInput','refreshBtn',
  'studentCount','totalPoints','rewardEvents','topStudent','sectionTitle','visibleCount',
  'studentsGrid','emptyState','rankingList','modalBackdrop','closeModalBtn','modalAvatar',
  'modalStudentName','modalStudentFullName','modalPoints','modalEvents','rewardTypes',
  'pointsChoices','noteInput','submitRewardBtn','undoRewardBtn','historyStatus',
  'historyList','toast','connectionStatus'
];

const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

async function init() {
  try {
    bindEvents();

    // Show locally cached teacher data immediately if available.
    const cachedBootstrap = readCache('bootstrap');
    if (cachedBootstrap) {
      applyBootstrap(cachedBootstrap, false);
    }

    await loadBootstrap();
  } catch (error) {
    console.error('Initialization error:', error);
    setConnectionStatus('تعذر الاتصال بالخادم الآن. يمكنكِ إعادة المحاولة بعد قليل.', 'error');
    showToast(error?.message || 'تعذر تشغيل الواجهة.', true);
  }
}

function bindEvents() {
  if (!el.teacherSelect || !el.subjectSelect || !el.sectionSelect) {
    throw new Error('تعذر العثور على قوائم المعلمة أو المادة أو الشعبة في الصفحة.');
  }

  el.teacherSelect.addEventListener('change', async e => {
    await selectTeacher(e.target.value);
  });

  el.subjectSelect.addEventListener('change', async e => {
    await selectSubject(e.target.value);
  });

  el.sectionSelect.addEventListener('change', async e => {
    state.section = e.target.value;
    if (el.searchInput) el.searchInput.value = '';
    savePreferences();
    await loadSection();
  });

  el.searchInput?.addEventListener('input', renderStudents);

  el.refreshBtn?.addEventListener('click', async () => {
    if (!state.teacherId) {
      await loadBootstrap();
      return;
    }
    if (state.section) await loadSection({ force: true });
  });

  el.closeModalBtn?.addEventListener('click', closeModal);

  el.modalBackdrop?.addEventListener('click', e => {
    if (e.target === el.modalBackdrop) closeModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && el.modalBackdrop && !el.modalBackdrop.classList.contains('hidden')) {
      closeModal();
    }
  });

  el.rewardTypes?.addEventListener('click', e => {
    const button = e.target.closest('[data-reward]');
    if (!button) return;
    state.selectedRewardType = button.dataset.reward;
    el.rewardTypes.querySelectorAll('[data-reward]')
      .forEach(x => x.classList.toggle('active', x === button));
  });

  el.pointsChoices?.addEventListener('click', e => {
    const button = e.target.closest('[data-points]');
    if (!button) return;
    state.selectedPoints = Number(button.dataset.points);
    el.pointsChoices.querySelectorAll('[data-points]')
      .forEach(x => x.classList.toggle('active', x === button));
  });

  el.submitRewardBtn?.addEventListener('click', submitReward);
  el.undoRewardBtn?.addEventListener('click', undoLastReward);
}

async function apiGet(params = {}, retries = CONFIG.RETRIES) {
  const url = new URL(CONFIG.API_URL, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  return requestJson(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  }, retries);
}

async function apiPost(payload, retries = 0) {
  return requestJson(CONFIG.API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  }, retries);
}

async function requestJson(url, options, retries) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();

      let data = null;
      try { data = JSON.parse(text); } catch {}

      if (!response.ok || !data || data.success === false) {
        const message = data?.error || data?.message ||
          (response.status === 504 ? 'انتهت مهلة الاتصال بالخادم.' : 'تعذر الاتصال بالخادم.');

        const error = new Error(message);
        error.status = response.status;
        throw error;
      }

      return data;
    } catch (error) {
      lastError = error;
      const retryable = !error.status || [502, 503, 504].includes(error.status);

      if (attempt >= retries || !retryable) break;
      await sleep(900 * (attempt + 1));
    }
  }

  throw lastError || new Error('تعذر الاتصال بالخادم.');
}

async function loadBootstrap() {
  if (!el.teacherSelect) return;

  const hadCachedData = state.allAssignments.length > 0;
  if (!hadCachedData) {
    el.teacherSelect.disabled = true;
    el.teacherSelect.innerHTML = '<option value="">جارٍ تحميل المعلمات...</option>';
  }

  setConnectionStatus('جارٍ مزامنة بيانات المعلمات...', '');

  try {
    let data;
    try {
      data = await apiGet({ action: 'bootstrap' }, 1);
    } catch (bootstrapError) {
      // Compatibility fallback if an older Apps Script deployment is still active.
      const teachersData = await apiGet({ action: 'teachers' }, 1);
      data = {
        success: true,
        teachers: teachersData.teachers || [],
        assignments: []
      };
    }

    writeCache('bootstrap', data);
    applyBootstrap(data, true);
    setConnectionStatus('', '');
  } catch (error) {
    const cached = readCache('bootstrap');

    if (cached) {
      applyBootstrap(cached, false);
      setConnectionStatus('تعذر تحديث بيانات المعلمات؛ يتم عرض آخر بيانات محفوظة.', 'warn');
    } else {
      el.teacherSelect.innerHTML = '<option value="">تعذر تحميل المعلمات — اضغطي تحديث</option>';
      el.teacherSelect.disabled = false;
      setConnectionStatus('تعذر الاتصال الآن. اضغطي «تحديث» لإعادة المحاولة.', 'error');
    }

    console.error(error);
    showToast(error.message, true);
  }
}

function applyBootstrap(data, restoreSelection) {
  const teachers = Array.isArray(data.teachers) ? data.teachers : [];
  state.allAssignments = Array.isArray(data.assignments) ? data.assignments : [];

  if (!teachers.length) return;

  el.teacherSelect.innerHTML =
    '<option value="">اختاري المعلمة</option>' +
    teachers.map(t =>
      `<option value="${escapeAttr(t.Teacher_ID)}">${escapeHtml(t.Teacher_Name)}</option>`
    ).join('');

  el.teacherSelect.disabled = false;

  if (restoreSelection) {
    const pref = readPreferences();
    if (pref.teacherId && teachers.some(t => String(t.Teacher_ID) === String(pref.teacherId))) {
      el.teacherSelect.value = pref.teacherId;
      selectTeacher(pref.teacherId, pref);
    }
  }
}

async function selectTeacher(teacherId, preferred = null) {
  resetBoard();
  state.teacherId = teacherId;
  state.teacherName = '';
  if (!teacherId) {
    savePreferences();
    return;
  }

  try {
    let assignments = state.allAssignments.filter(a =>
      String(a.teacherId) === String(teacherId)
    );

    if (!assignments.length) {
      const data = await apiGet({ action: 'assignments', teacherId }, 1);
      state.teacherName = data.teacherName || '';
      assignments = Array.isArray(data.assignments) ? data.assignments : [];
    } else {
      state.teacherName = assignments[0]?.teacherName || '';
    }

    if (!assignments.length) {
      showToast('لا توجد مواد أو شعب مرتبطة بهذه المعلمة.', true);
      return;
    }

    const subjects = [...new Map(
      assignments.map(a => [a.subjectId, { id: a.subjectId, name: a.subjectName }])
    ).values()];

    el.subjectSelect.innerHTML =
      '<option value="">اختاري المادة</option>' +
      subjects.map(s =>
        `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`
      ).join('');

    el.subjectSelect.disabled = false;

    const desiredSubject =
      preferred?.subjectId && subjects.some(s => s.id === preferred.subjectId)
        ? preferred.subjectId
        : subjects[0].id;

    el.subjectSelect.value = desiredSubject;
    await selectSubject(desiredSubject, assignments, preferred);
  } catch (error) {
    console.error(error);
    showToast(error.message, true);
    setConnectionStatus('تعذر تحميل تكليفات المعلمة. اضغطي تحديث.', 'error');
  }
}

async function selectSubject(subjectId, teacherAssignments = null, preferred = null) {
  state.subjectId = subjectId;

  let assignments = teacherAssignments;
  if (!assignments) {
    assignments = state.allAssignments.filter(a =>
      String(a.teacherId) === String(state.teacherId)
    );
    if (!assignments.length) {
      const data = await apiGet({ action: 'assignments', teacherId: state.teacherId }, 1);
      assignments = Array.isArray(data.assignments) ? data.assignments : [];
    }
  }

  const matching = assignments.filter(a => String(a.subjectId) === String(subjectId));
  state.subjectName = matching[0]?.subjectName || '';

  const sections = [...new Set(matching.map(a => String(a.section)))].sort(sectionSort);

  el.sectionSelect.innerHTML =
    '<option value="">اختاري الشعبة</option>' +
    sections.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');

  el.sectionSelect.disabled = !sections.length;

  if (!sections.length) {
    setBoardEnabled(false);
    resetBoardData();
    return;
  }

  const desiredSection =
    preferred?.section && sections.includes(preferred.section)
      ? preferred.section
      : sections[0];

  state.section = desiredSection;
  el.sectionSelect.value = desiredSection;
  setBoardEnabled(true);
  savePreferences();

  await loadSection();
}

async function loadSection({ force = false } = {}) {
  if (state.loading || !state.teacherId || !state.subjectId || !state.section) return;

  const cacheKey = dashboardCacheKey();
  const cached = readCache(cacheKey);

  // Show last successful dashboard instantly, then refresh it.
  if (cached && !force) {
    applyDashboard(cached);
  } else if (!cached) {
    setLoading(true, false);
  }

  state.loading = true;
  setRefreshVisual(true);
  el.sectionTitle.textContent = `تاسع ${String(state.section).split('/')[1] || ''}`;

  try {
    const dashboard = await apiGet({
      action: 'dashboard',
      section: state.section,
      teacherId: state.teacherId,
      subjectId: state.subjectId
    }, 1);

    writeCache(cacheKey, dashboard);
    applyDashboard(dashboard);
    setConnectionStatus('', '');
  } catch (error) {
    console.error(error);

    if (cached) {
      applyDashboard(cached);
      setConnectionStatus('تعذر التحديث الآن؛ يتم عرض آخر بيانات محفوظة للصف.', 'warn');
    } else {
      setConnectionStatus('تعذر تحميل بيانات الشعبة. اضغطي «تحديث» لإعادة المحاولة.', 'error');
      showToast(error.message, true);
    }
  } finally {
    state.loading = false;
    setLoading(false, true);
    setRefreshVisual(false);
  }
}

function applyDashboard(data) {
  state.dashboard = data || {};
  state.ranking = Array.isArray(data?.ranking) ? data.ranking : [];

  // Dashboard already contains every student, including those with zero points.
  state.students = state.ranking.map(item => ({
    studentId: item.studentId,
    fullName: item.fullName,
    shortName: item.shortName,
    section: item.section
  }));

  updateStats(data || {});
  renderStudents();
  renderRanking();

  el.sectionTitle.textContent = state.section
    ? `تاسع ${String(state.section).split('/')[1] || ''}`
    : 'اختاري الشعبة';
}

function updateStats(data) {
  el.studentCount.textContent =
    Number.isFinite(Number(data.studentCount))
      ? Number(data.studentCount)
      : state.students.length;

  el.totalPoints.textContent = Number(data.totalPoints || 0);
  el.rewardEvents.textContent = Number(data.rewardEvents || 0);

  el.topStudent.textContent =
    data.topStudent && Number(data.topStudent.totalPoints) > 0
      ? `${data.topStudent.shortName} · ${data.topStudent.totalPoints}`
      : '—';
}

function getSummary(id) {
  return state.ranking.find(x => x.studentId === id) || {
    totalPoints: 0,
    rewardEvents: 0,
    categories: {}
  };
}

function renderStudents() {
  const query = normalize(el.searchInput?.value || '');

  const rows = state.students.filter(student =>
    !query || normalize(`${student.shortName} ${student.fullName}`).includes(query)
  );

  el.visibleCount.textContent = `${rows.length} طالبة`;
  el.emptyState.classList.toggle('hidden', rows.length !== 0);

  if (!rows.length) {
    el.studentsGrid.innerHTML = '';
    return;
  }

  el.studentsGrid.innerHTML = rows.map(student => {
    const summary = getSummary(student.studentId);
    const letter = escapeHtml((student.shortName || student.fullName || 'ط').trim().charAt(0));

    return `
      <button class="student-card" type="button" data-id="${escapeAttr(student.studentId)}">
        <div class="student-top">
          <span class="avatar">${letter}</span>
          <span class="student-name">${escapeHtml(student.shortName || student.fullName)}</span>
        </div>
        <div class="student-meta">
          <span class="mini"><small>النقاط</small><strong>${Number(summary.totalPoints || 0)}</strong></span>
          <span class="mini"><small>مرات التعزيز</small><strong>${Number(summary.rewardEvents || 0)}</strong></span>
        </div>
      </button>`;
  }).join('');

  el.studentsGrid.querySelectorAll('[data-id]').forEach(button => {
    button.addEventListener('click', () => {
      const student = state.students.find(x => x.studentId === button.dataset.id);
      if (student) openStudentModal(student);
    });
  });
}

function renderRanking() {
  const rows = [...state.ranking]
    .filter(x => Number(x.totalPoints) > 0)
    .sort((a, b) => Number(b.totalPoints) - Number(a.totalPoints))
    .slice(0, 10);

  if (!rows.length) {
    el.rankingList.innerHTML =
      '<div class="empty">لا توجد نقاط بعد. سيظهر الترتيب بعد أول تعزيز.</div>';
    return;
  }

  el.rankingList.innerHTML = rows.map((student, index) => `
    <div class="rank">
      <span class="rank-num">${index + 1}</span>
      <span class="rank-name" title="${escapeAttr(student.fullName || student.shortName)}">
        ${escapeHtml(student.shortName || student.fullName)}
      </span>
      <span class="rank-points">${Number(student.totalPoints || 0)} نقطة</span>
    </div>
  `).join('');
}

async function openStudentModal(student) {
  state.selectedStudent = student;
  state.selectedRewardType = 'مشاركة';
  state.selectedPoints = 1;
  resetChoices();

  el.noteInput.value = '';

  const summary = getSummary(student.studentId);
  el.modalAvatar.textContent = (student.shortName || student.fullName || 'ط').trim().charAt(0);
  el.modalStudentName.textContent = student.shortName || student.fullName;
  el.modalStudentFullName.textContent = student.fullName || student.shortName;
  el.modalPoints.textContent = Number(summary.totalPoints || 0);
  el.modalEvents.textContent = Number(summary.rewardEvents || 0);

  el.modalBackdrop.classList.remove('hidden');
  el.modalBackdrop.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  await loadHistory();
}

function closeModal() {
  state.selectedStudent = null;
  el.modalBackdrop.classList.add('hidden');
  el.modalBackdrop.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function resetChoices() {
  el.rewardTypes.querySelectorAll('[data-reward]')
    .forEach(button => button.classList.toggle('active', button.dataset.reward === 'مشاركة'));

  el.pointsChoices.querySelectorAll('[data-points]')
    .forEach(button => button.classList.toggle('active', button.dataset.points === '1'));
}

function playSound(id) {
  const sound = document.getElementById(id);
  if (!sound) return;

  sound.pause();
  sound.currentTime = 0;

  const playPromise = sound.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(error => {
      console.warn(`تعذر تشغيل الصوت ${id}:`, error);
    });
  }
}

async function submitReward() {
  if (!state.selectedStudent) return;

  setModalBusy(true);

  try {
    const response = await apiPost({
      action: 'addReward',
      studentId: state.selectedStudent.studentId,
      teacherId: state.teacherId,
      subjectId: state.subjectId,
      rewardType: state.selectedRewardType,
      points: state.selectedPoints,
      note: el.noteInput.value.trim()
    });

    applyRewardLocally(
      state.selectedStudent.studentId,
      Number(response.pointsAdded || state.selectedPoints),
      state.selectedRewardType,
      +1
    );

    el.noteInput.value = '';
    showToast(`تم تسجيل ${response.pointsAdded} نقطة لـ ${state.selectedStudent.shortName}.`);
    playSound('rewardSound');

    await loadHistory();
  } catch (error) {
    console.error(error);
    showToast(error.message, true);
  } finally {
    setModalBusy(false);
  }
}

async function undoLastReward() {
  if (!state.selectedStudent) return;

  if (!confirm(`هل تريدين التراجع عن آخر تعزيز للطالبة ${state.selectedStudent.shortName}؟`)) {
    return;
  }

  setModalBusy(true);

  try {
    const response = await apiPost({
      action: 'undoLastReward',
      studentId: state.selectedStudent.studentId,
      teacherId: state.teacherId,
      subjectId: state.subjectId
    });

    const removedPoints = Number(response.pointsRemoved || 0);
    const removedType = response.rewardType || '';

    if (removedPoints > 0) {
      applyRewardLocally(
        state.selectedStudent.studentId,
        removedPoints,
        removedType,
        -1
      );
    } else {
      await loadSection({ force: true });
    }

    showToast('تم التراجع عن آخر تعزيز.');
    playSound('undoSound');

    await loadHistory();
  } catch (error) {
    console.error(error);
    showToast(error.message, true);
  } finally {
    setModalBusy(false);
  }
}

function applyRewardLocally(studentId, points, rewardType, direction) {
  const row = state.ranking.find(x => x.studentId === studentId);
  if (!row) return;

  row.totalPoints = Math.max(0, Number(row.totalPoints || 0) + (points * direction));
  row.rewardEvents = Math.max(0, Number(row.rewardEvents || 0) + direction);
  row.categories = row.categories || {};

  if (rewardType) {
    row.categories[rewardType] = Math.max(
      0,
      Number(row.categories[rewardType] || 0) + direction
    );
  }

  state.ranking.sort((a, b) => Number(b.totalPoints) - Number(a.totalPoints));

  state.dashboard = state.dashboard || {};
  state.dashboard.totalPoints = Math.max(
    0,
    Number(state.dashboard.totalPoints || 0) + (points * direction)
  );
  state.dashboard.rewardEvents = Math.max(
    0,
    Number(state.dashboard.rewardEvents || 0) + direction
  );
  state.dashboard.ranking = state.ranking;
  state.dashboard.topStudent = state.ranking[0] || null;

  writeCache(dashboardCacheKey(), state.dashboard);

  updateStats(state.dashboard);
  renderStudents();
  renderRanking();

  const summary = getSummary(studentId);
  el.modalPoints.textContent = Number(summary.totalPoints || 0);
  el.modalEvents.textContent = Number(summary.rewardEvents || 0);
}

async function loadHistory() {
  if (!state.selectedStudent) return;

  el.historyStatus.textContent = 'جارٍ التحميل...';

  try {
    const data = await apiGet({
      action: 'history',
      studentId: state.selectedStudent.studentId,
      teacherId: state.teacherId,
      subjectId: state.subjectId
    }, 0);

    const rows = Array.isArray(data.history)
      ? [...data.history].reverse().slice(0, 6)
      : [];

    el.historyStatus.textContent = `${Number(data.rewardEvents || 0)} سجل`;

    if (!rows.length) {
      el.historyList.innerHTML = '<small>لا توجد تعزيزات مسجلة لهذه الطالبة بعد.</small>';
      return;
    }

    el.historyList.innerHTML = rows.map(item => `
      <div class="history-item">
        <span class="history-type">${escapeHtml(item.Reward_Type || 'تعزيز')}</span>
        <span class="history-info">
          <strong>${escapeHtml(item.Note || 'بدون ملاحظة')}</strong>
          <small>${escapeHtml(formatDate(item.Date, item.Time))}</small>
        </span>
        <span class="history-points">+${Number(item.Points || 0)}</span>
      </div>
    `).join('');
  } catch (error) {
    el.historyStatus.textContent = 'تعذر تحديث السجل';
    if (!el.historyList.innerHTML.trim()) {
      el.historyList.innerHTML = '<small>تم حفظ التعزيز، لكن تعذر تحديث السجل مؤقتًا.</small>';
    }
  }
}

function formatDate(dateValue, timeValue) {
  const date = normalizeDatePart(dateValue);
  const time = normalizeTimePart(timeValue);
  return [date, time].filter(Boolean).join(' · ') || '—';
}

function normalizeDatePart(value) {
  if (!value) return '';
  const text = String(value).trim();

  const direct = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() >= 2000) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return text.replace(/^1899-\d{2}-\d{2}\s*/,'');
}

function normalizeTimePart(value) {
  if (!value) return '';
  const text = String(value).trim();

  const time = text.match(/\b([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/);
  if (time) return time[0].slice(0, 5);

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return `${String(parsed.getHours()).padStart(2,'0')}:${String(parsed.getMinutes()).padStart(2,'0')}`;
  }

  return '';
}

function setBoardEnabled(on) {
  if (el.searchInput) el.searchInput.disabled = !on;
  if (el.refreshBtn) el.refreshBtn.disabled = !on;
}

function resetBoard() {
  state.subjectId = '';
  state.subjectName = '';
  state.section = '';
  state.students = [];
  state.ranking = [];
  state.dashboard = null;

  el.subjectSelect.innerHTML = '<option value="">—</option>';
  el.subjectSelect.disabled = true;
  el.sectionSelect.innerHTML = '<option value="">—</option>';
  el.sectionSelect.disabled = true;

  resetBoardData();
  setBoardEnabled(false);
}

function resetBoardData() {
  updateStats({});
  renderStudents();
  renderRanking();
  el.sectionTitle.textContent = 'اختاري الشعبة';
}

function setLoading(on, preserveExisting = true) {
  if (el.refreshBtn) {
    el.refreshBtn.disabled = on || !state.section;
    el.refreshBtn.classList.toggle('is-loading', on);
  }

  if (on && !preserveExisting && !state.students.length) {
    el.studentsGrid.innerHTML =
      Array.from({ length: 9 }, () => '<div class="skeleton"></div>').join('');
    el.rankingList.innerHTML =
      Array.from({ length: 5 }, () => '<div class="skeleton" style="min-height:50px"></div>').join('');
  }
}

function setRefreshVisual(on) {
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('is-refreshing', on));
}

function setModalBusy(on) {
  el.submitRewardBtn.disabled = on;
  el.undoRewardBtn.disabled = on;
  el.submitRewardBtn.textContent = on ? 'جارٍ الحفظ...' : '✦ تسجيل التعزيز';
}

function setConnectionStatus(message, type = '') {
  if (!el.connectionStatus) return;

  el.connectionStatus.textContent = message || '';
  el.connectionStatus.className = 'connection-status';

  if (!message) {
    el.connectionStatus.classList.add('hidden');
    return;
  }

  if (type) el.connectionStatus.classList.add(type);
}

let toastTimer;
function showToast(message, error = false) {
  if (!el.toast) return;
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.classList.toggle('error', error);
  el.toast.classList.remove('hidden');
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 3500);
}

function dashboardCacheKey() {
  return `dashboard:${state.teacherId}:${state.subjectId}:${state.section}`;
}

function cacheKey(name) {
  return `sibaq:${CONFIG.CACHE_VERSION}:${name}`;
}

function writeCache(name, value) {
  try {
    localStorage.setItem(cacheKey(name), JSON.stringify({
      savedAt: Date.now(),
      value
    }));
  } catch {}
}

function readCache(name) {
  try {
    const raw = localStorage.getItem(cacheKey(name));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.value || null;
  } catch {
    return null;
  }
}

function savePreferences() {
  try {
    localStorage.setItem(cacheKey('preferences'), JSON.stringify({
      teacherId: state.teacherId,
      subjectId: state.subjectId,
      section: state.section
    }));
  } catch {}
}

function readPreferences() {
  try {
    return JSON.parse(localStorage.getItem(cacheKey('preferences')) || '{}');
  } catch {
    return {};
  }
}

function sectionSort(a, b) {
  return Number(String(a).split('/')[1]) - Number(String(b).split('/')[1]);
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
