/* CaseFlow demo — simulates the Salesforce escalation engine in the browser.
   Rules mirror the Apex code: EscalationPolicyService, EscalationService,
   CaseTriggerHandler and CaseEscalationBatch. */
(function () {
  'use strict';

  const STORE_KEY = 'caseflow-demo-v1';
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const MAX_LEVEL = 3;
  const BATCH_INTERVAL = 15 * MIN; // CaseEscalationBatch runs every 15 minutes

  const LEVELS = ['Support Agent', 'Team Lead', 'Support Manager', 'Case Admin'];
  /* ---------------- accounts (role-based login) ----------------
     In the real app, login, profiles and roles are handled by Salesforce.
     This demo keeps accounts in the browser's localStorage, with passwords
     stored only as salted SHA-256 hashes, so the role-based flow can be shown. */
  const USERS_KEY = 'caseflow-users-v1';
  const SESSION_KEY = 'caseflow-session';
  const DEMO_PASSWORD = 'demo1234';
  const DEMO_USERS = [
    { username: 'asha', name: 'Asha R.', role: 0 },
    { username: 'ravi', name: 'Ravi K.', role: 0 },
    { username: 'lokesh', name: 'Lokesh M.', role: 1 },
    { username: 'divya', name: 'Divya S.', role: 1 },
    { username: 'meera', name: 'Meera P.', role: 2 },
    { username: 'arun', name: 'Arun V.', role: 3 }
  ];
  let users = [];          // [{ username, name, role, salt, hash, createdAt }]
  let PEOPLE = {};         // username -> { name, role }  (everyone who can own a case)
  let currentUser = null;  // username of the person signed in
  const PERMS = [
    { escalate: true, team: false, reassign: false, policy: false },
    { escalate: true, team: true, reassign: true, policy: false },
    { escalate: true, team: true, reassign: true, policy: false },
    { escalate: true, team: true, reassign: true, policy: true }
  ];
  const QUEUES = {
    tier1: { name: 'Tier 1 Support', level: 0 },
    tier2: { name: 'Tier 2 Escalations', level: 1 },
    mgr: { name: 'Manager Escalations', level: 2 }
  };
  const FALLBACK_QUEUE = { 1: 'tier2', 2: 'mgr', 3: 'mgr' };
  const DEFAULT_POLICY = { High: [2, 4, 8], Medium: [8, 16, 24], Low: [24, 48, 72] };
  const REASONS = ['Customer Request', 'Agent Request', 'Technical Complexity', 'Priority Change'];

  let state;
  let justMoved = new Set();

  /* ---------------- storage ---------------- */
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable: keep in memory */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.version === 1) return s;
      }
    } catch (e) { /* ignore */ }
    return seed();
  }

  /* ---------------- rules ---------------- */
  function hoursFor(priority, toLevel) {
    const row = state.policy[priority] || state.policy.Medium;
    return row[toLevel - 1];
  }
  // Deadline for a case sitting at `level` before it should move to level + 1
  function nextDue(priority, level, from) {
    if (level >= MAX_LEVEL) return null;
    return from + hoursFor(priority, level + 1) * HOUR;
  }
  function sla(c) {
    if (c.status === 'Closed') {
      return c.slaMet ? { key: 'ok', label: 'Met' } : { key: 'breach', label: 'Missed' };
    }
    if (c.slaDue == null) return { key: 'none', label: 'No SLA' };
    const left = c.slaDue - state.now;
    if (left < 0) return { key: 'breach', label: 'Breached' };
    if (left < HOUR) return { key: 'risk', label: 'At risk' };
    return { key: 'ok', label: 'On track' };
  }
  function isQueue(owner) { return owner.startsWith('queue:'); }
  function ownerName(owner) {
    return isQueue(owner) ? QUEUES[owner.slice(6)].name + ' queue' : PEOPLE[owner].name;
  }
  function openLoad(personId) {
    return state.cases.filter((c) => c.status !== 'Closed' && c.owner === personId).length;
  }
  // Least-loaded active user in the role; null means "use the queue"
  function pickTarget(level) {
    const candidates = Object.keys(PEOPLE).filter((p) => PEOPLE[p].role === level);
    if (!candidates.length) return null;
    return candidates.reduce((best, p) => (openLoad(p) < openLoad(best) ? p : best));
  }

  function log(c, entry) {
    c.log.push(Object.assign({ at: state.now }, entry));
  }

  function escalate(c, reason, comments, by, auto) {
    if (c.status === 'Closed' || c.level >= MAX_LEVEL) return false;
    const from = c.level;
    const to = from + 1;
    const target = pickTarget(to);
    c.level = to;
    c.escalatedOn = state.now;
    c.escalatedTo = target;
    c.owner = target || 'queue:' + FALLBACK_QUEUE[to];
    c.slaDue = nextDue(c.priority, to, state.now);
    log(c, { type: 'escalated', from, to, by: auto ? 'system' : by, toWho: target, reason, comments, auto });
    if (target) state.unseen[target] = (state.unseen[target] || 0) + 1;
    justMoved.add(c.id);
    return true;
  }

  // CaseEscalationBatch: run every 15 simulated minutes across the jump
  function advanceClock(minutes) {
    const end = state.now + minutes * MIN;
    let count = 0;
    while (state.now < end) {
      state.now = Math.min(end, state.now + BATCH_INTERVAL);
      state.cases.forEach((c) => {
        if (c.status !== 'Closed' && c.slaDue != null && c.slaDue <= state.now && c.level < MAX_LEVEL) {
          if (escalate(c, 'SLA Breach', 'Automatically escalated: SLA deadline passed.', null, true)) count++;
        }
      });
    }
    save();
    render();
    if (count) toast(count === 1 ? '1 overdue case escalated automatically.' : count + ' overdue cases escalated automatically.', 'warn');
  }

  /* ---------------- seed data ---------------- */
  function seed() {
    const start = new Date();
    start.setHours(9, 0, 0, 0);
    const now = start.getTime();
    state = { version: 1, now, viewer: 0, filter: 'mine', policy: JSON.parse(JSON.stringify(DEFAULT_POLICY)), unseen: {}, cases: [], seq: 1000 };

    function mk(subject, priority, dept, ageMin, owner, extra) {
      const createdAt = now - ageMin * MIN;
      const c = {
        id: 'c' + (++state.seq), num: '0000' + state.seq, subject, priority, dept,
        description: extra && extra.description || '', status: owner.startsWith('queue:') ? 'New' : 'Working',
        level: 0, owner, escalatedTo: null, escalatedOn: null, createdAt,
        slaDue: nextDue(priority, 0, createdAt), slaMet: false, log: []
      };
      c.log.push({ at: createdAt, type: 'created', by: 'asha' });
      if (!owner.startsWith('queue:')) c.log.push({ at: createdAt + 5 * MIN, type: 'taken', by: owner });
      state.cases.push(c);
      return c;
    }
    function bump(c, minutesAgo, reason, comments, toWho, auto) {
      const at = now - minutesAgo * MIN;
      const from = c.level;
      const by = auto ? 'system' : c.owner;
      c.level += 1;
      c.escalatedOn = at;
      c.escalatedTo = toWho;
      c.owner = toWho;
      c.slaDue = nextDue(c.priority, c.level, at);
      c.log.push({ at, type: 'escalated', from, to: c.level, by, toWho, reason, comments, auto: !!auto });
    }

    mk('Laptop will not boot after Windows update', 'High', 'IT Support', 90, 'asha', { description: 'Stuck on the recovery screen. User has a client demo at 2 pm.' });
    mk('VPN disconnects every 10 minutes', 'Medium', 'IT Support', 180, 'asha', { description: 'Happens only on home Wi-Fi. Reinstalled the client already.' });
    const payroll = mk('Payroll not credited for October', 'High', 'Finance', 200, 'asha', { description: 'Twelve employees in the Coimbatore office report no salary credit.' });
    bump(payroll, 70, 'Technical Complexity', 'Needs access to the payroll batch logs.', 'lokesh');
    mk('Access card not working at Gate 3', 'Medium', 'Facilities', 30, 'queue:tier1');
    mk('Printer on 2nd floor keeps jamming', 'Low', 'IT Support', 26 * 60, 'ravi', { description: 'Tray 2 jams on every A4 job.' });
    mk('New joiner needs email account by Monday', 'Medium', 'IT Support', 50, 'queue:tier1');
    mk('Expense claim rejected incorrectly', 'Low', 'Finance', 120, 'ravi');
    const ac = mk('AC failure in server room', 'High', 'Operations', 360, 'asha', { description: 'Room temperature at 31°C and rising.' });
    bump(ac, 240, 'SLA Breach', 'Automatically escalated: SLA deadline passed.', 'lokesh', true);
    bump(ac, 210, 'Customer Request', 'Vendor visit needs manager approval.', 'meera');
    const leave = mk('Leave balance shows wrong value', 'Medium', 'HR', 18 * 60, 'ravi');
    bump(leave, 15.5 * 60, 'Agent Request', 'Needs HRMS admin rights.', 'divya');
    const crm = mk('CRM login error for the whole sales team', 'High', 'IT Support', 20 * 60, 'asha', { description: 'SSO certificate expired overnight.' });
    bump(crm, 18 * 60, 'Technical Complexity', 'Certificate renewal.', 'lokesh');
    bump(crm, 15 * 60, 'Customer Request', 'Sales head escalated directly.', 'meera');
    bump(crm, 10 * 60, 'Technical Complexity', 'Vendor contract needs admin sign-off.', 'arun');
    const leak = mk('Water leakage near cafeteria', 'Medium', 'Facilities', 240, 'ravi');
    leak.status = 'Closed'; leak.slaMet = true; leak.closedAt = now - 60 * MIN;
    leak.log.push({ at: leak.closedAt, type: 'status', by: 'ravi', status: 'Closed' });

    state.unseen = { lokesh: 1, divya: 1 };
    save();
    return state;
  }

  /* ---------------- accounts ---------------- */
  async function hashPassword(password, salt) {
    const bytes = new TextEncoder().encode(salt + ':' + password);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  function newSalt() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  function saveUsers() {
    try { localStorage.setItem(USERS_KEY, JSON.stringify(users)); } catch (e) { /* storage unavailable */ }
  }
  function rebuildPeople() {
    PEOPLE = {};
    users.forEach((u) => { PEOPLE[u.username] = { name: u.name, role: u.role }; });
  }
  async function loadUsers() {
    try {
      const raw = localStorage.getItem(USERS_KEY);
      if (raw) users = JSON.parse(raw);
    } catch (e) { users = []; }
    // Make sure the demo accounts exist
    for (const d of DEMO_USERS) {
      if (!users.some((u) => u.username === d.username)) {
        const salt = newSalt();
        users.push({ ...d, salt, hash: await hashPassword(DEMO_PASSWORD, salt), createdAt: Date.now() });
      }
    }
    saveUsers();
    rebuildPeople();
  }
  async function signIn(username, password) {
    const u = users.find((x) => x.username === username.trim().toLowerCase());
    if (!u || (await hashPassword(password, u.salt)) !== u.hash) throw new Error('Wrong username or password.');
    return u;
  }
  async function createAccount(name, username, password, role) {
    username = username.trim().toLowerCase();
    name = name.trim();
    if (!name) throw new Error('Full name is required.');
    if (!/^[a-z0-9]{3,20}$/.test(username)) throw new Error('Username must be 3 to 20 lowercase letters or numbers.');
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');
    if (![0, 1, 2].includes(role)) throw new Error('Choose a role.');
    if (users.some((u) => u.username === username)) throw new Error('That username is taken.');
    const salt = newSalt();
    const u = { username, name, role, salt, hash: await hashPassword(password, salt), createdAt: Date.now() };
    users.push(u);
    saveUsers();
    rebuildPeople();
    return u;
  }
  function startSession(username) {
    currentUser = username;
    try { sessionStorage.setItem(SESSION_KEY, username); } catch (e) { /* ignore */ }
    state.filter = state.unseen[username] ? 'tome' : 'mine';
    showApp();
  }
  function endSession() {
    currentUser = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    closeDrawer();
    showAuth();
  }
  function showApp() {
    $('authView').hidden = true;
    $('appView').hidden = false;
    render();
    window.scrollTo(0, 0);
  }
  function showAuth(message) {
    $('appView').hidden = true;
    $('authView').hidden = false;
    authError(message || '');
  }
  function authError(message) {
    $('authError').textContent = message;
    $('authError').hidden = !message;
  }

  /* ---------------- visibility (role hierarchy + queues) ---------------- */
  function viewer() { return { role: PEOPLE[currentUser].role, person: currentUser }; }
  function me() { return viewer().person; }
  function perms() { return PERMS[viewer().role]; }
  function canSee(c) {
    const role = viewer().role;
    if (role >= 2) return true;
    if (isQueue(c.owner)) return QUEUES[c.owner.slice(6)].level <= role;
    return c.owner === me() || PEOPLE[c.owner].role < role || c.log.some((l) => l.by === me());
  }
  function canTake(c) {
    return c.status !== 'Closed' && isQueue(c.owner) && QUEUES[c.owner.slice(6)].level <= viewer().role;
  }
  function canWork(c) {
    return c.owner === me() || (perms().team && canSee(c) && !isQueue(c.owner));
  }

  const FILTERS = [
    { key: 'mine', label: 'My cases', test: (c) => c.status !== 'Closed' && c.owner === me() },
    { key: 'tome', label: 'Escalated to me', test: (c) => c.status !== 'Closed' && c.escalatedTo === me() },
    { key: 'queue', label: 'Waiting in queue', test: (c) => canTake(c) },
    { key: 'team', label: 'Whole team', team: true, test: (c) => c.status !== 'Closed' && canSee(c) },
    { key: 'breached', label: 'Overdue', team: true, test: (c) => c.status !== 'Closed' && canSee(c) && sla(c).key === 'breach' },
    { key: 'closed', label: 'Closed', test: (c) => c.status === 'Closed' && canSee(c) }
  ];

  // What each role does, in plain words (shown at the top after sign-in)
  const ROLE_HELP = [
    'Pick up new cases from the queue, solve them, and press Escalate when you need help.',
    'Cases your agents could not solve come to you. You can also see and reassign your team\'s cases.',
    'You see every case and every overdue case, and you receive cases your Team Leads escalate.',
    'You are the final step. You also set the deadlines and manage everyone\'s role.'
  ];

  /* ---------------- helpers ---------------- */
  const $ = (id) => document.getElementById(id);
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  const fmtDay = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtTime = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  function fmt(ms) {
    if (ms == null) return '—';
    const d = new Date(ms);
    const sameDay = new Date(state.now).toDateString() === d.toDateString();
    return (sameDay ? 'Today ' : fmtDay.format(d) + ', ') + fmtTime.format(d);
  }
  function relative(ms) {
    if (ms == null) return '';
    const diff = ms - state.now;
    const abs = Math.abs(diff);
    const h = Math.floor(abs / HOUR);
    const m = Math.round((abs % HOUR) / MIN);
    const span = h ? h + ' h' + (m ? ' ' + m + ' min' : '') : m + ' min';
    return diff >= 0 ? span + ' left' : span + ' overdue';
  }
  function who(id) {
    if (id === 'system') return 'Auto-escalation';
    return PEOPLE[id] ? PEOPLE[id].name : id;
  }
  function toast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }

  /* ---------------- render ---------------- */
  function render() {
    if (!currentUser) return;
    renderTop();
    renderWelcome();
    renderStats();
    renderPath();
    renderDesk();
    renderPolicy();
    renderTeam();
    scheduleCharts();
    if (openCaseId) renderDrawer();
    justMoved = new Set();
  }

  function renderTop() {
    const person = PEOPLE[me()];
    $('userName').textContent = person.name;
    $('userRole').textContent = LEVELS[person.role];
    $('userAvatar').textContent = person.name.charAt(0).toUpperCase();
    const n = state.unseen[me()] || 0;
    $('userBadge').hidden = !n;
    $('userBadge').textContent = n;
    $('userBadge').setAttribute('aria-label', n + ' new escalations');
    $('clockTime').textContent = fmtDay.format(new Date(state.now)) + ', ' + fmtTime.format(new Date(state.now));
  }

  function renderWelcome() {
    const v = viewer();
    const hour = new Date().getHours();
    const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    $('hello').textContent = `${part}, ${PEOPLE[v.person].name.split(' ')[0]}`;
    $('roleTitle').textContent = `You are signed in as ${/^[AEIOU]/.test(LEVELS[v.role]) ? 'an' : 'a'} ${LEVELS[v.role]}`;
    $('roleHelp').textContent = ROLE_HELP[v.role];
  }

  // Four big numbers. Clicking one shows those cases in the list.
  function renderStats() {
    const visibleOpen = state.cases.filter((c) => c.status !== 'Closed' && canSee(c));
    const overdue = visibleOpen.filter((c) => sla(c).key === 'breach' && (perms().team || c.owner === me())).length;
    const count = (key) => state.cases.filter(FILTERS.find((f) => f.key === key).test).length;
    const cards = [
      { key: 'mine', label: 'My open cases', value: count('mine'), tone: '' },
      { key: 'tome', label: 'Escalated to me', value: count('tome'), tone: 'info' },
      { key: 'queue', label: 'Waiting in queue', value: count('queue'), tone: '' },
      { key: perms().team ? 'breached' : 'mine', label: 'Overdue', value: overdue, tone: overdue ? 'alert' : '' }
    ];
    $('stats').innerHTML = cards.map((c) => `<button type="button" class="stat ${c.tone}" data-filter="${c.key}">
      <span class="stat-value">${c.value}</span><span class="stat-label">${c.label}</span></button>`).join('');
  }

  // The four steps of the escalation path with how many open cases sit at each
  function renderPath() {
    const open = state.cases.filter((c) => c.status !== 'Closed');
    const queued = open.filter((c) => isQueue(c.owner) && c.level === 0).length;
    $('path').innerHTML = [0, 1, 2, 3].map((lvl) => {
      const n = open.filter((c) => c.level === lvl && !(lvl === 0 && isQueue(c.owner))).length;
      const mine = viewer().role === lvl;
      return `<li class="step${mine ? ' is-me' : ''}">
        <span class="step-num">${lvl + 1}</span>
        <span class="step-name">${LEVELS[lvl]}${mine ? ' <em>(you)</em>' : ''}</span>
        <span class="step-count">${n} ${n === 1 ? 'case' : 'cases'}</span></li>`;
    }).join('') + `<li class="step queue-step"><span class="step-num">·</span><span class="step-name">Waiting in queue</span><span class="step-count">${queued}</span></li>`;
  }

  function renderDesk() {
    const v = viewer();
    const p = perms();
    const visible = FILTERS.filter((f) => !f.team || p.team);
    if (!visible.some((f) => f.key === state.filter)) state.filter = 'mine';
    $('filters').innerHTML = visible.map((f) => {
      const n = state.cases.filter(f.test).length;
      return `<button type="button" role="tab" data-filter="${f.key}" aria-selected="${f.key === state.filter}">${f.label}<span class="n">${n}</span></button>`;
    }).join('');

    const f = FILTERS.find((x) => x.key === state.filter);
    const rows = state.cases.filter(f.test).sort((a, b) => {
      if (a.status === 'Closed') return (b.closedAt || 0) - (a.closedAt || 0);
      return (a.slaDue == null ? Infinity : a.slaDue) - (b.slaDue == null ? Infinity : b.slaDue);
    });
    if (state.filter === 'tome' && state.unseen[me()]) {
      state.unseen[me()] = 0;
      save();
      renderTop();
    }
    if (!rows.length) {
      const hints = {
        mine: 'You have no open cases. Open "Waiting in queue" to pick one up.',
        tome: 'Nothing has been escalated to you.',
        queue: 'The queue is empty.',
        team: 'Your team has no open cases.',
        breached: 'No case has missed its deadline.',
        closed: 'No closed cases yet.'
      };
      $('caseList').innerHTML = `<p class="list-empty">${hints[state.filter]}</p>`;
      return;
    }
    $('caseList').innerHTML = rows.map((c) => {
      const s = sla(c);
      const due = c.status === 'Closed' ? 'Closed ' + fmt(c.closedAt) : relative(c.slaDue);
      return `<button type="button" class="case-row" data-case="${c.id}">
        <span class="case-num">${c.num}</span>
        <span class="case-subj">${esc(c.subject)}</span>
        <span class="case-meta"><span class="pri ${c.priority}">${c.priority}</span> priority, ${esc(c.dept)}. With ${esc(ownerName(c.owner))} at ${LEVELS[c.level]} level.</span>
        <span class="case-sla"><span class="sla-tag ${s.key}">${s.label}</span><span class="sla-due">${due}</span></span>
      </button>`;
    }).join('');
  }

  function renderPolicy() {
    const admin = perms().policy;
    $('policySection').hidden = !admin; // only the Case Admin needs to see deadlines
    $('policyNote').textContent = admin
      ? 'Hours a case may stay at one level before it moves to the next. Changes apply to the next deadline that is calculated, as in Salesforce custom metadata.'
      : 'Hours a case may stay at one level before it moves to the next. Only a Case Admin can edit these.';
    const head = `<thead><tr><th scope="col">Priority</th>${[1, 2, 3].map((l) => `<th scope="col">To ${LEVELS[l]}</th>`).join('')}</tr></thead>`;
    const body = ['High', 'Medium', 'Low'].map((pr) => `<tr><th scope="row">${pr}</th>${[0, 1, 2].map((i) =>
      `<td><input type="number" min="0.5" max="240" step="0.5" value="${state.policy[pr][i]}" data-pr="${pr}" data-i="${i}" ${admin ? '' : 'disabled'} aria-label="${pr} priority, hours before moving to ${LEVELS[i + 1]}"><span class="unit">h</span></td>`
    ).join('')}</tr>`).join('');
    $('policyTable').innerHTML = head + '<tbody>' + body + '</tbody>';
  }

  /* ---------------- team (Case Admin only) ---------------- */
  function renderTeam() {
    const admin = viewer().role === 3;
    $('teamSection').hidden = !admin;
    if (!admin) return;
    const rows = users.slice().sort((a, b) => b.role - a.role || a.name.localeCompare(b.name)).map((u) => {
      const options = LEVELS.map((label, i) => `<option value="${i}" ${i === u.role ? 'selected' : ''}>${label}</option>`).join('');
      const self = u.username === me();
      return `<tr><th scope="row">${esc(u.name)}${self ? ' (you)' : ''}</th><td>${esc(u.username)}</td>
        <td><select data-role-for="${esc(u.username)}" ${self ? 'disabled' : ''} aria-label="Role for ${esc(u.name)}">${options}</select></td>
        <td>${openLoad(u.username)}</td></tr>`;
    }).join('');
    $('teamTable').innerHTML = `<thead><tr><th scope="col">Name</th><th scope="col">Username</th><th scope="col">Role</th><th scope="col">Open cases</th></tr></thead><tbody>${rows}</tbody>`;
  }

  /* ---------------- charts (Python function /api/chart) ---------------- */
  let chartTimer = null;
  function scheduleCharts() {
    clearTimeout(chartTimer);
    chartTimer = setTimeout(renderCharts, 400);
  }
  async function renderCharts() {
    const open = state.cases.filter((c) => c.status !== 'Closed');
    const levels = [0, 1, 2, 3].map((l) => open.filter((c) => c.level === l).length);
    const slaCounts = { ok: 0, risk: 0, breach: 0, none: 0 };
    open.forEach((c) => { slaCounts[sla(c).key] += 1; });
    const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    try {
      const response = await fetch('api/chart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ levels, sla: slaCounts, theme })
      });
      if (!response.ok) throw new Error('chart service ' + response.status);
      const data = await response.json();
      // The SVG comes from our own Python function and holds only numbers and fixed labels
      $('levelChart').innerHTML = data.levelChart;
      $('slaChart').innerHTML = data.slaChart;
      $('chartsSection').hidden = false;
    } catch (e) {
      $('chartsSection').hidden = true; // e.g. opened without the Python backend
    }
  }

  /* ---------------- drawer ---------------- */
  let openCaseId = null;
  let lastFocus = null;

  function openDrawer(id) {
    lastFocus = document.activeElement;
    openCaseId = id;
    $('drawer').hidden = false;
    $('scrim').hidden = false;
    renderDrawer();
    const close = $('drawer').querySelector('.close-x');
    if (close) close.focus();
  }
  function closeDrawer() {
    openCaseId = null;
    $('drawer').hidden = true;
    $('scrim').hidden = true;
    if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  }

  const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  function renderDrawer() {
    const c = state.cases.find((x) => x.id === openCaseId);
    if (!c) { closeDrawer(); return; }
    const s = sla(c);
    const p = perms();
    const open = c.status !== 'Closed';
    let actions = '';

    if (canTake(c)) {
      actions += `<div class="block"><h3>Queue</h3><p class="notice">This case is waiting in the ${esc(ownerName(c.owner))}.</p>
        <div class="btn-row" style="margin-top:.75rem"><button type="button" class="primary" data-act="take">Take case</button></div></div>`;
    }

    if (open && !isQueue(c.owner) && canWork(c) && p.escalate) {
      if (c.level >= MAX_LEVEL) {
        actions += `<div class="block"><h3>Escalate</h3><p class="notice">This case is already with the Case Admin, the highest level.</p></div>`;
      } else {
        const target = pickTarget(c.level + 1);
        actions += `<div class="block"><h3>Escalate</h3>
          <div class="path"><span>${LEVELS[c.level]}</span>${ARROW}<span class="to">${LEVELS[c.level + 1]}</span>
          <small style="color:var(--ink-soft)">goes to ${target ? esc(PEOPLE[target].name) + ' (lightest workload)' : 'the ' + QUEUES[FALLBACK_QUEUE[c.level + 1]].name + ' queue'}</small></div>
          <form id="escalateForm">
            <label class="field">Reason<select name="reason" required><option value="">Choose a reason</option>${REASONS.map((r) => `<option>${r}</option>`).join('')}</select></label>
            <label class="field">Comments for the next level<textarea name="comments" rows="2" maxlength="4000"></textarea></label>
            <button type="submit" class="primary">Escalate</button>
          </form></div>`;
      }
    }

    if (canWork(c) && !isQueue(c.owner)) {
      const statusBtns = open
        ? `${c.status !== 'Working' ? '<button type="button" data-act="working">Mark as working</button>' : ''}<button type="button" data-act="close">Close case</button>`
        : '<button type="button" data-act="reopen">Reopen case</button>';
      actions += `<div class="block"><h3>Status</h3><div class="btn-row">${statusBtns}</div></div>`;
    }

    if (open && p.reassign && canSee(c)) {
      const options = Object.keys(PEOPLE).filter((id) => id !== c.owner && PEOPLE[id].role <= viewer().role)
        .map((id) => `<option value="${id}">${esc(PEOPLE[id].name)} (${LEVELS[PEOPLE[id].role]}, ${openLoad(id)} open)</option>`).join('');
      actions += `<div class="block"><h3>Reassign</h3><form id="reassignForm" class="btn-row">
        <label class="field" style="flex:1;margin:0">Give this case to<select name="to">${options}</select></label>
        <button type="submit" style="align-self:flex-end">Reassign</button></form></div>`;
    }

    if (!actions) {
      actions = `<div class="block"><p class="notice">Your profile can view this case but not change it.</p></div>`;
    }

    const history = c.log.slice().reverse().map((l) => {
      if (l.type === 'escalated') {
        return `<li class="${l.auto ? 'auto' : ''}"><div class="tl-title">${LEVELS[l.from]} to ${LEVELS[l.to]}${l.auto ? ' (automatic)' : ''}</div>
          <div class="tl-meta">${fmt(l.at)}, by ${esc(who(l.by))}, to ${l.toWho ? esc(PEOPLE[l.toWho].name) : 'queue'}</div>
          <div class="tl-note"><strong>${esc(l.reason)}</strong>${l.comments ? ': ' + esc(l.comments) : ''}</div></li>`;
      }
      const text = {
        created: 'Case created',
        taken: 'Taken from queue by ' + who(l.by),
        status: 'Status changed to ' + l.status + ' by ' + who(l.by),
        reassigned: 'Reassigned to ' + who(l.to) + ' by ' + who(l.by)
      }[l.type];
      return `<li class="event"><div class="tl-title">${esc(text)}</div><div class="tl-meta">${fmt(l.at)}</div></li>`;
    }).join('');

    $('drawer').innerHTML = `
      <div class="drawer-top"><div><p class="num">Case ${c.num}</p><h2 id="drawerTitle">${esc(c.subject)}</h2></div>
      <button type="button" class="close-x" data-act="closeDrawer" aria-label="Close">×</button></div>
      <dl class="facts">
        <dt>Priority</dt><dd><span class="pri ${c.priority}">${c.priority}</span></dd>
        <dt>Department</dt><dd>${esc(c.dept)}</dd>
        <dt>Status</dt><dd>${c.status}</dd>
        <dt>Level</dt><dd>${c.level}, ${LEVELS[c.level]}</dd>
        <dt>Owner</dt><dd>${esc(ownerName(c.owner))}</dd>
        <dt>Created</dt><dd>${fmt(c.createdAt)}</dd>
        <dt>SLA</dt><dd><span class="sla-tag ${s.key}">${s.label}</span> ${open && c.slaDue != null ? fmt(c.slaDue) + ', ' + relative(c.slaDue) : ''}</dd>
      </dl>
      ${c.description ? `<p class="desc">${esc(c.description)}</p>` : ''}
      ${actions}
      <div class="block"><h3>Escalation history</h3><ul class="timeline">${history}</ul></div>`;
  }

  /* ---------------- actions ---------------- */
  function act(name) {
    const c = state.cases.find((x) => x.id === openCaseId);
    if (!c) return;
    if (name === 'closeDrawer') { closeDrawer(); return; }
    if (name === 'take') {
      c.owner = me();
      c.status = 'Working';
      log(c, { type: 'taken', by: me() });
      toast(`Case ${c.num} is now yours.`);
    } else if (name === 'working') {
      c.status = 'Working';
      log(c, { type: 'status', by: me(), status: 'Working' });
    } else if (name === 'close') {
      c.status = 'Closed';
      c.closedAt = state.now;
      c.slaMet = c.slaDue == null || state.now <= c.slaDue;
      log(c, { type: 'status', by: me(), status: 'Closed' });
      toast(`Case ${c.num} closed. SLA ${c.slaMet ? 'met' : 'missed'}.`);
    } else if (name === 'reopen') {
      c.status = 'Working';
      c.closedAt = null;
      c.slaMet = false;
      c.slaDue = nextDue(c.priority, c.level, state.now);
      log(c, { type: 'status', by: me(), status: 'Working (reopened)' });
    }
    save();
    render();
  }

  function bind() {
    document.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.id === 'logoutBtn') {
        endSession();
      } else if (t.dataset.demo) {
        $('signInForm').elements.username.value = t.dataset.demo;
        $('signInForm').elements.password.value = DEMO_PASSWORD;
        authError('');
      } else if (t.id === 'tabSignIn' || t.id === 'tabCreate') {
        const signIn = t.id === 'tabSignIn';
        $('tabSignIn').setAttribute('aria-selected', signIn);
        $('tabCreate').setAttribute('aria-selected', !signIn);
        $('signInForm').hidden = !signIn;
        $('createForm').hidden = signIn;
        authError('');
      } else if (t.dataset.advance) {
        advanceClock(Number(t.dataset.advance));
      } else if (t.dataset.filter) {
        state.filter = t.dataset.filter;
        save(); render();
      } else if (t.dataset.case) {
        openDrawer(t.dataset.case);
      } else if (t.dataset.act) {
        act(t.dataset.act);
      }
    });

    $('scrim').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && openCaseId) closeDrawer();
    });

    $('drawer').addEventListener('submit', (e) => {
      e.preventDefault();
      const c = state.cases.find((x) => x.id === openCaseId);
      const data = new FormData(e.target);
      if (e.target.id === 'escalateForm') {
        if (!data.get('reason')) return;
        if (escalate(c, data.get('reason'), String(data.get('comments') || '').trim(), me(), false)) {
          toast(`Case ${c.num} is now with the ${LEVELS[c.level]}${c.escalatedTo ? ' (' + PEOPLE[c.escalatedTo].name + ')' : ''}.`);
        }
      } else if (e.target.id === 'reassignForm') {
        const to = data.get('to');
        c.owner = to;
        if (c.escalatedTo && PEOPLE[to].role === c.level) c.escalatedTo = to;
        log(c, { type: 'reassigned', by: me(), to });
        toast(`Case ${c.num} reassigned to ${PEOPLE[to].name}.`);
      }
      save();
      render();
    });

    $('signInForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      try {
        const u = await signIn(f.username.value, f.password.value);
        e.target.reset();
        startSession(u.username);
        toast(`Signed in as ${u.name}, ${LEVELS[u.role]}.`);
      } catch (err) {
        authError(err.message);
      }
    });

    $('createForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      try {
        const u = await createAccount(f.name.value, f.username.value, f.password.value, Number(f.role.value));
        e.target.reset();
        startSession(u.username);
        toast(`Account created. Welcome, ${u.name}.`);
      } catch (err) {
        authError(err.message);
      }
    });

    $('teamTable').addEventListener('change', (e) => {
      const username = e.target.dataset.roleFor;
      if (!username || viewer().role !== 3) return;
      const u = users.find((x) => x.username === username);
      u.role = Number(e.target.value);
      saveUsers();
      rebuildPeople();
      render();
      toast(`${u.name} is now ${LEVELS[u.role]}.`);
    });

    $('policyTable').addEventListener('change', (e) => {
      const inp = e.target;
      if (!inp.dataset.pr) return;
      const v = Math.max(0.5, Math.min(240, Number(inp.value) || 0.5));
      state.policy[inp.dataset.pr][Number(inp.dataset.i)] = v;
      save();
      toast(`${inp.dataset.pr} priority: ${v} h before ${LEVELS[Number(inp.dataset.i) + 1]}.`);
    });

    const dlg = $('newCaseDialog');
    $('newCaseBtn').addEventListener('click', () => { $('newCaseForm').reset(); dlg.showModal(); });
    $('cancelNewCase').addEventListener('click', () => dlg.close());
    $('newCaseForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const d = new FormData(e.target);
      const subject = String(d.get('subject') || '').trim();
      if (!subject) return;
      const c = {
        id: 'c' + (++state.seq), num: '0000' + state.seq, subject, priority: d.get('priority'), dept: d.get('dept'),
        description: String(d.get('description') || '').trim(), status: 'New', level: 0, owner: 'queue:tier1',
        escalatedTo: null, escalatedOn: null, createdAt: state.now, slaMet: false, log: []
      };
      c.slaDue = nextDue(c.priority, 0, state.now);
      c.log.push({ at: state.now, type: 'created', by: me() });
      state.cases.push(c);
      dlg.close();
      save();
      render();
      toast(`Case ${c.num} created. Due ${fmt(c.slaDue)}.`);
    });

    $('resetBtn').addEventListener('click', () => {
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
      closeDrawer();
      seed();
      render();
      toast('Demo data reset.');
    });
  }

  async function init() {
    if (!window.crypto || !crypto.subtle) {
      document.body.innerHTML = '<p style="padding:2rem">Open this page over https (or localhost) so secure login can work.</p>';
      return;
    }
    await loadUsers();
    state = load();
    bind();
    let saved = null;
    try { saved = sessionStorage.getItem(SESSION_KEY); } catch (e) { /* ignore */ }
    if (saved && PEOPLE[saved]) startSession(saved);
    else showAuth();
  }
  init();
})();
