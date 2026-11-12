// =====================================================================
// STUDIO APP — app.js
// Block 1 of 6: config, auth, router
// =====================================================================

const db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON);

let CURRENT_PROFILE = null;

// =====================================================================
// ===== AUTH =====
// =====================================================================
async function login(email, password) {
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  await bootApp();
}

async function logout() {
  await db.auth.signOut();
  location.hash = '';
  location.reload();
}

async function getProfile() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return null;
  const { data, error } = await db.from('profiles')
    .select('*').eq('id', session.user.id).single();
  if (error) { console.error(error); return null; }
  return data;
}

// =====================================================================
// ===== BOOT / ROUTER =====
// =====================================================================
async function bootApp() {
  CURRENT_PROFILE = await getProfile();

  if (!CURRENT_PROFILE || !CURRENT_PROFILE.active) {
    document.getElementById('login-screen').style.display = 'grid';
    document.getElementById('app-shell').style.display    = 'none';
    return;
  }

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display    = 'flex';
  document.getElementById('user-name').textContent      =
    CURRENT_PROFILE.name || CURRENT_PROFILE.email || '';

  // Hide owner-only nav / buttons for members
  document.querySelectorAll('[data-role="owner"]').forEach(el => {
    el.style.display = CURRENT_PROFILE.role === 'owner' ? '' : 'none';
  });

  // Load studio name into sidebar brand
  try { await loadBrandName(); } catch {}

  // Default route by role
  if (!location.hash) {
    location.hash = CURRENT_PROFILE.role === 'owner' ? '#dashboard' : '#projects';
  }
  route();
}

function route() {
  const hash = location.hash.replace('#', '') || 'dashboard';
  const [name, param] = hash.split('/');

  // Map nested routes to their sidebar parent (for active highlight)
  const SIDEBAR_MAP = {
    'project':   'projects',
    'agreement': 'agreements',
  };

  // Explicit screen-level access rules
  const OWNER_ONLY_SCREENS = new Set([
    'dashboard', 'members', 'clients', 'gadgets',
    'invoices', 'agreements', 'agreement',
    'reports', 'studio-value', 'settings',
  ]);

  // Block members from owner-only screens
  if (CURRENT_PROFILE && CURRENT_PROFILE.role !== 'owner') {
    if (OWNER_ONLY_SCREENS.has(name)) {
      location.hash = '#projects';
      return;
    }
    // Also block via sidebar link data-role (belt and suspenders)
    const link = document.querySelector(`.sidebar a[data-screen="${name}"]`);
    if (link && link.dataset.role === 'owner') {
      location.hash = '#projects';
      return;
    }
  }

  // Hide all screens, show target
  document.querySelectorAll('.screen-content').forEach(el => el.style.display = 'none');

  const targetEl = document.getElementById('screen-' + name);
  if (!targetEl) {
    // Unknown route — bounce to default
    location.hash = CURRENT_PROFILE?.role === 'owner' ? '#dashboard' : '#projects';
    return;
  }
  targetEl.style.display = 'block';

  // Sidebar active state (map nested → parent)
  const sidebarName = SIDEBAR_MAP[name] || name;
  document.querySelectorAll('.sidebar a').forEach(a =>
    a.classList.toggle('active', a.dataset.screen === sidebarName));

  // Render
  const renderer = SCREENS[name];
  if (renderer) {
    Promise.resolve(renderer(targetEl, param)).catch(err => {
      console.error(err);
      targetEl.innerHTML = `<div class="card"><p class="error">${err.message}</p></div>`;
    });
  } else {
    targetEl.innerHTML = `<div class="card">
      <p class="empty">Screen "${esc(name)}" is not available.</p>
      <a href="#${CURRENT_PROFILE?.role === 'owner' ? 'dashboard' : 'projects'}">← Go home</a>
    </div>`;
  }
}

window.addEventListener('hashchange', route);

// =====================================================================
// ===== SCREENS REGISTRY (filled in blocks 2-6) =====
// =====================================================================
const SCREENS = {};

// =====================================================================
// BLOCK 2A — helpers + Dashboard
// =====================================================================

// ===== HELPERS =====
function fmtMoney(n) {
  if (n == null || n === '') return '0';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function badgeClass(status) {
  return 'badge badge-' + (status || 'scheduled');
}

// ===== DASHBOARD =====
SCREENS.dashboard = async function(el) {
  el.innerHTML = '<div class="loading">Loading dashboard…</div>';

  try {
    const today = todayISO();
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;

    const [liveRes, monthInRes, projectsRes, allInRes] = await Promise.all([
      db.from('projects')
        .select('id, name, status, start_date, end_date, venue_name, client:clients(name)')
        .in('status', ['live', 'scheduled'])
        .order('start_date', { ascending: true }),
      db.from('payments')
        .select('amount').eq('direction', 'in').gte('date', monthStart),
      db.from('projects').select('id, confirmed_amount'),
      db.from('payments').select('project_id, amount').eq('direction', 'in'),
    ]);

    const liveProjects = liveRes.data || [];
    const projectsAll = projectsRes.data || [];
    const allIn       = allInRes.data || [];

    const inByProject = {};
    allIn.forEach(p => {
      inByProject[p.project_id] = (inByProject[p.project_id] || 0) + Number(p.amount);
    });

    let receivable = 0;
    projectsAll.forEach(p => {
      const paid = inByProject[p.id] || 0;
      receivable += Math.max(0, Number(p.confirmed_amount) - paid);
    });

    const monthInTotal = (monthInRes.data || []).reduce((s, p) => s + Number(p.amount), 0);
    const liveCount    = liveProjects.filter(p => p.status === 'live').length;
    const todayProjects = liveProjects.filter(p => p.start_date === today || p.status === 'live');
    const upcoming      = liveProjects.filter(p => p.status === 'scheduled');

    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat">
          <div class="label">Live Now</div>
          <div class="value">${liveCount}</div>
        </div>
        <div class="stat">
          <div class="label">Received This Month</div>
          <div class="value pos">${fmtMoney(monthInTotal)}</div>
        </div>
        <div class="stat">
          <div class="label">Total Receivable</div>
          <div class="value ${receivable > 0 ? 'neg' : ''}">${fmtMoney(receivable)}</div>
        </div>
        <div class="stat">
          <div class="label">Upcoming</div>
          <div class="value">${upcoming.length}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Today &amp; Live</h2>
          <a href="#projects" class="small">View all →</a>
        </div>
        ${todayProjects.length ? todayProjects.map(p => `
          <div style="padding:10px 0;border-bottom:1px solid #f0f0f0">
            <div class="flex-between">
              <div>
                <a href="#project/${p.id}"><strong>${p.name}</strong></a>
                <span class="${badgeClass(p.status)}" style="margin-left:8px">${p.status}</span>
              </div>
              <div class="muted small">${fmtDate(p.start_date)}</div>
            </div>
            <div class="muted small" style="margin-top:4px">
              ${p.client?.name || '—'} · ${p.venue_name || 'no venue'}
            </div>
          </div>
        `).join('') : '<p class="empty">Nothing scheduled or live today.</p>'}
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Upcoming</h2>
        </div>
        ${upcoming.length
          ? upcoming.map(p => `
            <div style="padding:8px 0;border-bottom:1px solid #f0f0f0" class="flex-between">
              <div><a href="#project/${p.id}">${p.name}</a> · <span class="muted">${p.client?.name || '—'}</span></div>
              <div class="muted small">${fmtDate(p.start_date)}</div>
            </div>
          `).join('')
          : '<p class="empty">No upcoming projects.</p>'}
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="card"><p class="error">${err.message}</p></div>`;
  }
};

// =====================================================================
// BLOCK 2B — Projects list
// =====================================================================

let PROJECTS_FILTER = { search: '', status: 'all' };

SCREENS.projects = async function(el) {
  el.innerHTML = '<div class="loading">Loading projects…</div>';

  try {
    const { data, error } = await db.from('projects')
      .select('id, name, status, start_date, confirmed_amount, client:clients(name)')
      .order('start_date', { ascending: false, nullsFirst: false });
    if (error) throw error;

    const all = data || [];

    // Apply filters
    const f = PROJECTS_FILTER;
    const filtered = all.filter(p => {
      if (f.status !== 'all' && p.status !== f.status) return false;
      if (f.search && !p.name.toLowerCase().includes(f.search.toLowerCase())
                    && !(p.client?.name || '').toLowerCase().includes(f.search.toLowerCase()))
        return false;
      return true;
    });

    const counts = {
      all: all.length,
      live: all.filter(p => p.status === 'live').length,
      scheduled: all.filter(p => p.status === 'scheduled').length,
      completed: all.filter(p => p.status === 'completed').length,
    };

    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>Projects</h2>
          <button id="btn-new-project">+ New Project</button>
        </div>

        <div class="form-row mb-2">
          <input type="text" id="proj-search" placeholder="Search by project or client…"
                 value="${f.search.replace(/"/g,'&quot;')}">
          <select id="proj-status">
            <option value="all"       ${f.status==='all'?'selected':''}>All (${counts.all})</option>
            <option value="live"      ${f.status==='live'?'selected':''}>Live (${counts.live})</option>
            <option value="scheduled" ${f.status==='scheduled'?'selected':''}>Scheduled (${counts.scheduled})</option>
            <option value="completed" ${f.status==='completed'?'selected':''}>Completed (${counts.completed})</option>
          </select>
        </div>

        ${filtered.length ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Client</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th class="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map(p => `
                  <tr style="cursor:pointer" onclick="location.hash='#project/${p.id}'">
                    <td><strong>${p.name}</strong></td>
                    <td>${p.client?.name || '—'}</td>
                    <td>${fmtDate(p.start_date)}</td>
                    <td><span class="${badgeClass(p.status)}">${p.status}</span></td>
                    <td class="num">${fmtMoney(p.confirmed_amount)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `<p class="empty">No projects match. ${all.length === 0 ? 'Click "+ New Project" to create your first one.' : 'Try a different search or status.'}</p>`}
      </div>
    `;

    // Wire up
    document.getElementById('btn-new-project')
      .addEventListener('click', openProjectForm);

    document.getElementById('proj-search').addEventListener('input', (e) => {
      PROJECTS_FILTER.search = e.target.value;
      SCREENS.projects(el);
    });

    document.getElementById('proj-status').addEventListener('change', (e) => {
      PROJECTS_FILTER.status = e.target.value;
      SCREENS.projects(el);
    });

  } catch (err) {
    el.innerHTML = `<div class="card"><p class="error">${err.message}</p></div>`;
  }
};

// =====================================================================
// BLOCK 2C — New Project form
// =====================================================================

async function openProjectForm() {

  // 1) Load everything needed in parallel
  const [cRes, mRes, gRes, tRes, rRes] = await Promise.all([
    db.from('clients').select('id,name,phone').order('name'),
    db.from('team_members').select('id,name,role').eq('active', true).order('name'),
    db.from('gadgets').select('id,name,brand,model').eq('status', 'in_store').order('name'),
    db.from('project_types').select('id,name,is_default').order('name'),
    db.from('roles').select('name').eq('active', true).order('sort_order'),
  ]);

  // 2) Local state
  const S = {
    clients:  [...(cRes.data || [])],
    members:  [...(mRes.data || [])],
    gadgets:  gRes.data || [],
    types:    tRes.data || [],
    roles:    (rRes.data || []).map(r => r.name),
    selMembers: {},   // { team_member_id: { amount: '' } }
    selGadgets: {},   // { gadget_id: true }
    memberGear: {},   // { team_member_id: 'comma, list' }
  };

  // 3) Backdrop + modal shell
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'proj-modal';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:740px">
      <div class="flex-between mb-2">
        <h2 style="margin:0">New Project</h2>
        <button type="button" class="btn-secondary btn-sm" id="pf-close">✕</button>
      </div>
      <form id="pf-form" autocomplete="off">

        <div class="form-row">
          <div>
            <label>Project Name *</label>
            <input id="pf-name" type="text" required maxlength="150" placeholder="e.g. Sujit Ghosh Wedding">
          </div>
          <div>
            <label>Project Type *</label>
            <select id="pf-type" required>
              ${S.types.map(t =>
                `<option value="${t.id}" ${t.is_default ? 'selected' : ''}>${t.name}</option>`
              ).join('')}
            </select>
          </div>
        </div>

        <div class="form-row">
          <div>
            <label>Client *</label>
            <div style="display:flex;gap:6px">
              <select id="pf-client" required style="flex:1">
                <option value="">— select client —</option>
                ${S.clients.map(c =>
                  `<option value="${c.id}">${c.name}${c.phone ? ' · ' + c.phone : ''}</option>`
                ).join('')}
              </select>
              <button type="button" class="btn-secondary btn-sm" id="pf-add-client" title="Add new client">+</button>
            </div>
          </div>
          <div>
            <label>Status</label>
            <select id="pf-status">
              <option value="scheduled">Scheduled</option>
              <option value="live">Live now</option>
            </select>
          </div>
        </div>

        <div class="form-row form-row-3">
          <div><label>Start Date</label><input id="pf-start-date" type="date"></div>
          <div><label>Start Time</label><input id="pf-start-time" type="time"></div>
          <div><label>End Date</label><input id="pf-end-date" type="date"></div>
        </div>
        <div class="form-row">
          <div><label>End Time</label><input id="pf-end-time" type="time"></div>
          <div></div>
        </div>

        <div class="form-row">
          <div><label>Venue Name</label><input id="pf-venue" type="text"></div>
          <div><label>Venue Address</label><input id="pf-venue-addr" type="text"></div>
        </div>

        <div class="form-row">
          <div><label>Quoted Amount</label><input id="pf-quoted" type="number" min="0" step="0.01" value="0"></div>
          <div><label>Confirmed Amount</label><input id="pf-confirmed" type="number" min="0" step="0.01" value="0"></div>
        </div>

        <hr>

        <div class="flex-between mb-1">
          <label style="margin:0;font-weight:600">Team Members</label>
          <button type="button" class="btn-secondary btn-sm" id="pf-add-member">+ Add member</button>
        </div>
        <div id="pf-members-list" style="max-height:240px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:6px;padding:8px;margin-bottom:12px"></div>

        <hr>

        <label style="font-weight:600">Studio Gear</label>
        <div id="pf-gadgets-list" style="max-height:180px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:6px;padding:8px;margin-bottom:12px"></div>

        <div id="pf-member-gear-wrap"></div>

        <hr>

        <label>Notes</label>
        <textarea id="pf-notes"></textarea>

        <p id="pf-error" class="error"></p>

        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="pf-cancel">Cancel</button>
          <button type="submit" id="pf-save">Create Project</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  // 4) Renderers for dynamic sections
  function renderMembers() {
    const el = document.getElementById('pf-members-list');
    if (!S.members.length) {
      el.innerHTML = '<p class="empty" style="padding:12px">No members yet. Click "+ Add member".</p>';
      return;
    }
    el.innerHTML = S.members.map(m => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid #f0f0f0">
        <input type="checkbox" data-mid="${m.id}" class="pf-mem-check"
               ${S.selMembers[m.id] ? 'checked' : ''} style="width:auto;margin:0">
        <div style="flex:1">
          <div style="font-weight:500">${m.name}</div>
          <div class="muted small">${m.role || '—'}</div>
        </div>
        ${S.selMembers[m.id] ? `
          <input type="number" class="pf-mem-amount" data-mid="${m.id}"
                 placeholder="Pay amount" min="0" step="0.01"
                 value="${S.selMembers[m.id].amount || ''}"
                 style="width:130px;margin:0">
        ` : ''}
      </div>
    `).join('');

    el.querySelectorAll('.pf-mem-check').forEach(cb => {
      cb.onchange = e => {
        const mid = e.target.dataset.mid;
        if (e.target.checked) S.selMembers[mid] = { amount: '' };
        else delete S.selMembers[mid];
        renderMembers();
        renderMemberGear();
      };
    });
    el.querySelectorAll('.pf-mem-amount').forEach(inp => {
      inp.oninput = e => {
        const mid = e.target.dataset.mid;
        if (S.selMembers[mid]) S.selMembers[mid].amount = e.target.value;
      };
    });
  }

  function renderGadgets() {
    const el = document.getElementById('pf-gadgets-list');
    if (!S.gadgets.length) {
      el.innerHTML = '<p class="empty" style="padding:12px">No studio gear in store.</p>';
      return;
    }
    el.innerHTML = S.gadgets.map(g => `
      <label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-weight:400;cursor:pointer">
        <input type="checkbox" data-gid="${g.id}" class="pf-gad-check"
               ${S.selGadgets[g.id] ? 'checked' : ''} style="width:auto;margin:0">
        <span>${g.name}${g.brand ? ' · ' + g.brand : ''}${g.model ? ' ' + g.model : ''}</span>
      </label>
    `).join('');
    el.querySelectorAll('.pf-gad-check').forEach(cb => {
      cb.onchange = e => {
        const gid = e.target.dataset.gid;
        if (e.target.checked) S.selGadgets[gid] = true;
        else delete S.selGadgets[gid];
      };
    });
  }

  function renderMemberGear() {
    const wrap = document.getElementById('pf-member-gear-wrap');
    const sel = S.members.filter(m => S.selMembers[m.id]);
    if (!sel.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = `
      <label style="font-weight:600">Member's Own Gear</label>
      <p class="hint">Optional — comma separated, e.g. "extra lens, gimbal"</p>
      ${sel.map(m => `
        <div style="margin-bottom:8px">
          <label class="small">${m.name}</label>
          <input type="text" class="pf-mem-gear" data-mid="${m.id}"
                 placeholder="Personal items"
                 value="${(S.memberGear[m.id] || '').replace(/"/g,'&quot;')}"
                 style="margin-bottom:4px">
        </div>
      `).join('')}
    `;
    wrap.querySelectorAll('.pf-mem-gear').forEach(inp => {
      inp.oninput = e => { S.memberGear[e.target.dataset.mid] = e.target.value; };
    });
  }

  renderMembers();
  renderGadgets();

  // 5) Nested popup: add client
  document.getElementById('pf-add-client').onclick = () => {
    const nb = document.createElement('div');
    nb.className = 'modal-backdrop';
    nb.style.zIndex = '200';
    nb.innerHTML = `
      <div class="modal" style="max-width:400px">
        <h2>Add Client</h2>
        <label>Name *</label><input id="nc-name" type="text">
        <label>Phone</label><input id="nc-phone" type="tel">
        <label>Email</label><input id="nc-email" type="email">
        <label>Address</label><input id="nc-address" type="text">
        <p id="nc-error" class="error"></p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="nc-cancel">Cancel</button>
          <button type="button" id="nc-save">Save</button>
        </div>
      </div>`;
    document.body.appendChild(nb);
    nb.querySelector('#nc-cancel').onclick = () => nb.remove();
    nb.querySelector('#nc-save').onclick = async () => {
      const name = nb.querySelector('#nc-name').value.trim();
      if (!name) { nb.querySelector('#nc-error').textContent = 'Name required'; return; }
      const { data, error } = await db.from('clients').insert({
        name,
        phone:   nb.querySelector('#nc-phone').value.trim()   || null,
        email:   nb.querySelector('#nc-email').value.trim()   || null,
        address: nb.querySelector('#nc-address').value.trim() || null,
      }).select().single();
      if (error) { nb.querySelector('#nc-error').textContent = error.message; return; }
      S.clients.push(data);
      const sel = document.getElementById('pf-client');
      sel.insertAdjacentHTML('beforeend',
        `<option value="${data.id}" selected>${data.name}</option>`);
      sel.value = data.id;
      nb.remove();
    };
  };

  // 6) Nested popup: add member
  document.getElementById('pf-add-member').onclick = () => {
    const nb = document.createElement('div');
    nb.className = 'modal-backdrop';
    nb.style.zIndex = '200';
    nb.innerHTML = `
      <div class="modal" style="max-width:400px">
        <h2>Add Member</h2>
        <label>Name *</label><input id="nm-name" type="text">
        <label>Phone *</label><input id="nm-phone" type="tel">
        <label>Address</label><input id="nm-address" type="text">
        <label>Role</label>
        <select id="nm-role">${S.roles.map(r => `<option>${r}</option>`).join('')}</select>
        <p id="nm-error" class="error"></p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="nm-cancel">Cancel</button>
          <button type="button" id="nm-save">Save</button>
        </div>
      </div>`;
    document.body.appendChild(nb);
    nb.querySelector('#nm-cancel').onclick = () => nb.remove();
    nb.querySelector('#nm-save').onclick = async () => {
      const name  = nb.querySelector('#nm-name').value.trim();
      const phone = nb.querySelector('#nm-phone').value.trim();
      if (!name || !phone) {
        nb.querySelector('#nm-error').textContent = 'Name and phone required';
        return;
      }
      const { data, error } = await db.from('team_members').insert({
        name, phone,
        address: nb.querySelector('#nm-address').value.trim() || null,
        role:    nb.querySelector('#nm-role').value || null,
      }).select('id,name,role').single();
      if (error) { nb.querySelector('#nm-error').textContent = error.message; return; }
      S.members.push(data);
      S.selMembers[data.id] = { amount: '' };
      renderMembers();
      renderMemberGear();
      nb.remove();
    };
  };

  // 7) Close handlers
  const closeModal = () => backdrop.remove();
  document.getElementById('pf-close').onclick  = closeModal;
  document.getElementById('pf-cancel').onclick = closeModal;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });

  // 8) SAVE
  document.getElementById('pf-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errBox  = document.getElementById('pf-error');
    const saveBtn = document.getElementById('pf-save');
    errBox.textContent = '';

    const name      = document.getElementById('pf-name').value.trim();
    const client_id = document.getElementById('pf-client').value;
    if (!name)      { errBox.textContent = 'Project name required'; return; }
    if (!client_id) { errBox.textContent = 'Client required';       return; }

    saveBtn.disabled   = true;
    saveBtn.textContent = 'Creating…';

    let project = null;
    try {
      // Project
      const { data: p, error: pErr } = await db.from('projects').insert({
        name, client_id,
        project_type_id: document.getElementById('pf-type').value || null,
        status:          document.getElementById('pf-status').value,
        start_date:      document.getElementById('pf-start-date').value || null,
        start_time:      document.getElementById('pf-start-time').value || null,
        end_date:        document.getElementById('pf-end-date').value   || null,
        end_time:        document.getElementById('pf-end-time').value   || null,
        venue_name:      document.getElementById('pf-venue').value.trim()      || null,
        venue_address:   document.getElementById('pf-venue-addr').value.trim() || null,
        quoted_amount:   Number(document.getElementById('pf-quoted').value    || 0),
        confirmed_amount:Number(document.getElementById('pf-confirmed').value || 0),
        notes:           document.getElementById('pf-notes').value.trim() || null,
      }).select().single();
      if (pErr) throw pErr;
      project = p;

      // Members
      const memberRows = Object.entries(S.selMembers).map(([mid, { amount }]) => ({
        project_id: project.id,
        team_member_id: mid,
        rate: Number(amount || 0),
        quantity: 1,
        pay_amount: Number(amount || 0),
        status: 'assigned',
      }));
      if (memberRows.length) {
        const { error } = await db.from('project_members').insert(memberRows);
        if (error) throw error;
      }

      // Studio gear
      const gearRows = Object.keys(S.selGadgets).map(gid => ({
        project_id: project.id,
        gadget_id: gid,
        returned: false,
      }));
      if (gearRows.length) {
        const { error } = await db.from('project_gear').insert(gearRows);
        if (error) throw error;
      }

      // Member gear (text → member_gadgets → project_gear)
      const mgRows = [];
      for (const [mid, txt] of Object.entries(S.memberGear)) {
        if (!txt.trim()) continue;
        txt.split(',').map(s => s.trim()).filter(Boolean).forEach(n => {
          mgRows.push({ team_member_id: mid, name: n });
        });
      }
      if (mgRows.length) {
        const { data: created, error } = await db.from('member_gadgets')
          .insert(mgRows).select('id, team_member_id');
        if (error) throw error;
        const pgRows = (created || []).map(mg => ({
          project_id: project.id,
          member_gadget_id: mg.id,
          carried_by: mg.team_member_id,
          returned: false,
        }));
        if (pgRows.length) {
          const { error: pgErr } = await db.from('project_gear').insert(pgRows);
          if (pgErr) throw pgErr;
        }
      }

      closeModal();
      location.hash = '#project/' + project.id;

    } catch (err) {
      // Rollback project if it was created
      if (project?.id) {
        await db.from('projects').delete().eq('id', project.id);
      }
      errBox.textContent  = err.message;
      saveBtn.disabled    = false;
      saveBtn.textContent = 'Create Project';
    }
  });
}

// =====================================================================
// BLOCK 3 — Members screen + login account creation
// =====================================================================

// --- 3.1 addMember(): create team_member, optionally create auth user ---
// The throwaway-client trick: signup happens on an isolated Supabase client
// with persistSession:false + a unique storageKey, so the OWNER's session
// in localStorage is never touched.
async function addMember({ name, phone, address, role,
                          default_pay_type, default_rate,
                          giveLogin, loginEmail, loginPassword }) {
  // 1. Insert team_member row
  const { data: tm, error: tmErr } = await db.from('team_members').insert({
    name, phone,
    address:  address || null,
    role:     role || null,
    default_pay_type: default_pay_type || null,
    default_rate:     default_rate ? Number(default_rate) : null,
  }).select().single();
  if (tmErr) throw tmErr;

  if (!giveLogin) return tm;

  if (!loginEmail || !loginPassword) {
    await db.from('team_members').delete().eq('id', tm.id);
    throw new Error('Email and password required for login access');
  }
  if (loginPassword.length < 6) {
    await db.from('team_members').delete().eq('id', tm.id);
    throw new Error('Password must be at least 6 characters');
  }

  // 2. Throwaway client — isolated from owner's session
  const uniqueKey = 'temp-signup-' + (window.crypto?.randomUUID?.() || Date.now());
  const tempClient = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON,
    { auth: { persistSession: false, autoRefreshToken: false, storageKey: uniqueKey } }
  );

  // 3. Create the auth user with team_member_id in metadata (trigger reads it)
  const { data: su, error: suErr } = await tempClient.auth.signUp({
    email: loginEmail,
    password: loginPassword,
    options: { data: {
      role: 'member',
      name, phone,
      team_member_id: tm.id,
    }}
  });

  if (suErr) {
    await db.from('team_members').delete().eq('id', tm.id);
    throw new Error('Login creation failed: ' + suErr.message);
  }

  // If email confirmation is on, session will be null → member can't log in.
  // Throw with a clear message so the owner fixes the config.
  if (su.user && !su.session) {
    await db.from('team_members').delete().eq('id', tm.id);
    throw new Error(
      'Member was created but cannot log in — email confirmation is ON. ' +
      'Turn OFF "Confirm email" in Supabase → Authentication → Providers → Email, then try again.'
    );
  }

  // 4. Confirm profile exists (trigger should have created it)
  const { data: prof } = await db.from('profiles')
    .select('id').eq('team_member_id', tm.id).maybeSingle();
  if (!prof) {
    console.warn('Profile missing for', tm.id, '— check trigger in Supabase');
  }

  try { await tempClient.auth.signOut(); } catch {}
  return tm;
}

// --- 3.2 Members list screen ---
SCREENS.members = async function(el) {
  el.innerHTML = '<div class="loading">Loading members…</div>';
  try {
    const [tmRes, pRes] = await Promise.all([
      db.from('team_members').select('*').order('name'),
      db.from('profiles')
        .select('id, team_member_id, email, active, role')
        .eq('role', 'member'),
    ]);
    if (tmRes.error) throw tmRes.error;

    const members  = tmRes.data || [];
    const profiles = pRes.data || [];
    const profByTm = {};
    profiles.forEach(p => { if (p.team_member_id) profByTm[p.team_member_id] = p; });

    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>Members (${members.length})</h2>
          <button id="btn-new-member">+ Add Member</button>
        </div>
        ${members.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th>Name</th><th>Phone</th><th>Role</th>
                <th>Login</th><th class="num">Default Rate</th><th></th>
              </tr></thead>
              <tbody>
                ${members.map(m => {
                  const prof = profByTm[m.id];
                  const loginCell = prof
                    ? `<span class="badge badge-${prof.active ? 'signed' : 'cancelled'}">${prof.email}</span>`
                    : '<span class="muted small">none</span>';
                  return `<tr>
                    <td><strong>${m.name}</strong>${m.active ? '' : ' <span class="badge badge-cancelled">inactive</span>'}</td>
                    <td>${m.phone || '—'}</td>
                    <td>${m.role || '—'}</td>
                    <td>${loginCell}</td>
                    <td class="num">${m.default_rate ? fmtMoney(m.default_rate) : '—'}</td>
                    <td class="actions">
                      <button class="btn-secondary btn-sm" data-edit="${m.id}">Edit</button>
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : `<p class="empty">No members yet. Click "+ Add Member".</p>`}
      </div>
    `;

    document.getElementById('btn-new-member').onclick = () => openMemberForm();
    el.querySelectorAll('[data-edit]').forEach(b => {
      b.onclick = () => {
        const m = members.find(x => x.id === b.dataset.edit);
        openMemberForm(m, profByTm[m.id]);
      };
    });

  } catch (err) {
    el.innerHTML = `<div class="card"><p class="error">${err.message}</p></div>`;
  }
};

// --- 3.3 Member form modal (add new + edit existing) ---
async function openMemberForm(existing, profile) {
  const { data: rData } = await db.from('roles')
    .select('name').eq('active', true).order('sort_order');
  const roles  = (rData || []).map(r => r.name);
  const isEdit = !!existing;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:500px">
      <h2>${isEdit ? 'Edit Member' : 'Add Member'}</h2>
      <form id="mf-form" autocomplete="off">
        <div class="form-row">
          <div><label>Name *</label><input id="mf-name" type="text" required value="${existing?.name || ''}"></div>
          <div><label>Phone *</label><input id="mf-phone" type="tel" required value="${existing?.phone || ''}"></div>
        </div>
        <label>Address</label>
        <input id="mf-address" type="text" value="${(existing?.address || '').replace(/"/g,'&quot;')}">

        <div class="form-row">
          <div>
            <label>Role</label>
            <select id="mf-role">
              <option value="">—</option>
              ${roles.map(r => `<option ${existing?.role===r?'selected':''}>${r}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Default Pay Type</label>
            <select id="mf-paytype">
              <option value="">—</option>
              ${['per_day','per_project','per_hour','per_deliverable'].map(t =>
                `<option ${existing?.default_pay_type===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
        </div>

        <label>Default Rate</label>
        <input id="mf-rate" type="number" min="0" step="0.01"
               value="${existing?.default_rate ?? ''}">

        ${isEdit ? `
          <hr>
          <p class="muted small" style="margin-bottom:12px">
            Login: ${profile
              ? `<strong>${profile.email}</strong> (${profile.active ? 'active' : 'inactive'})`
              : 'none'}
          </p>
          ${profile ? `
            <button type="button" class="btn-${profile.active ? 'danger' : 'success'} btn-sm" id="mf-toggle-login">
              ${profile.active ? 'Deactivate login' : 'Reactivate login'}
            </button>
          ` : `
            <p class="hint">This member has no login. To add one later, create a new member with the same details plus login.</p>
          `}
        ` : `
          <hr>
          <div class="checkbox-row">
            <input type="checkbox" id="mf-give-login">
            <label for="mf-give-login">Give app login access</label>
          </div>
          <div id="mf-login-fields" style="display:none">
            <label>Login Email *</label>
            <input id="mf-email" type="email" placeholder="member@example.com">
            <label>Password *</label>
            <input id="mf-password" type="password" minlength="6" placeholder="Min 6 characters">
            <p class="hint">Requires "Confirm email" to be OFF in Supabase → Authentication → Providers → Email.</p>
          </div>
        `}

        <p id="mf-error" class="error"></p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="mf-cancel">Cancel</button>
          <button type="submit" id="mf-save">${isEdit ? 'Save Changes' : 'Add Member'}</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(backdrop);

  // Toggle login fields on new-member form
  const giveLoginBox = document.getElementById('mf-give-login');
  if (giveLoginBox) {
    giveLoginBox.onchange = e => {
      document.getElementById('mf-login-fields').style.display = e.target.checked ? 'block' : 'none';
    };
  }

  // Deactivate / reactivate login (edit mode with login)
  const toggleBtn = document.getElementById('mf-toggle-login');
  if (toggleBtn) {
    toggleBtn.onclick = async () => {
      const errBox = document.getElementById('mf-error');
      errBox.textContent = '';
      const { error } = await db.from('profiles')
        .update({ active: !profile.active }).eq('id', profile.id);
      if (error) { errBox.textContent = error.message; return; }
      backdrop.remove();
      SCREENS.members(document.getElementById('screen-members'));
    };
  }

  document.getElementById('mf-cancel').onclick = () => backdrop.remove();
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });

  document.getElementById('mf-form').onsubmit = async e => {
    e.preventDefault();
    const errBox  = document.getElementById('mf-error');
    const saveBtn = document.getElementById('mf-save');
    errBox.textContent = '';
    saveBtn.disabled   = true;
    saveBtn.textContent = 'Saving…';

    try {
      const payload = {
        name:  document.getElementById('mf-name').value.trim(),
        phone: document.getElementById('mf-phone').value.trim(),
        address:  document.getElementById('mf-address').value.trim() || null,
        role:     document.getElementById('mf-role').value || null,
        default_pay_type: document.getElementById('mf-paytype').value || null,
        default_rate:     document.getElementById('mf-rate').value
                            ? Number(document.getElementById('mf-rate').value)
                            : null,
      };
      if (!payload.name || !payload.phone) throw new Error('Name and phone are required');

      if (isEdit) {
        const { error } = await db.from('team_members').update(payload).eq('id', existing.id);
        if (error) throw error;
      } else {
        const giveLogin = document.getElementById('mf-give-login')?.checked;
        await addMember({
          ...payload,
          giveLogin,
          loginEmail:    giveLogin ? document.getElementById('mf-email').value.trim() : null,
          loginPassword: giveLogin ? document.getElementById('mf-password').value       : null,
        });
      }

      backdrop.remove();
      SCREENS.members(document.getElementById('screen-members'));

    } catch (err) {
      errBox.textContent  = err.message;
      saveBtn.disabled    = false;
      saveBtn.textContent = isEdit ? 'Save Changes' : 'Add Member';
    }
  };
}

// =====================================================================
// BLOCK 4A — Clients screen
// =====================================================================

SCREENS.clients = async function(el) {
  el.innerHTML = '<div class="loading">Loading clients…</div>';
  try {
    const [cRes, pRes] = await Promise.all([
      db.from('clients').select('*').order('name'),
      db.from('projects').select('client_id, confirmed_amount'),
    ]);
    if (cRes.error) throw cRes.error;

    const clients  = cRes.data || [];
    const projects = pRes.data || [];

    // Count projects + sum confirmed amount per client
    const stats = {};
    projects.forEach(p => {
      if (!stats[p.client_id]) stats[p.client_id] = { count: 0, total: 0 };
      stats[p.client_id].count += 1;
      stats[p.client_id].total += Number(p.confirmed_amount || 0);
    });

    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>Clients (${clients.length})</h2>
          <button id="btn-new-client">+ Add Client</button>
        </div>
        ${clients.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th>Name</th><th>Phone</th><th>Email</th>
                <th class="num">Projects</th><th class="num">Total Value</th><th></th>
              </tr></thead>
              <tbody>
                ${clients.map(c => {
                  const s = stats[c.id] || { count: 0, total: 0 };
                  return `<tr>
                    <td><strong>${c.name}</strong></td>
                    <td>${c.phone || '—'}</td>
                    <td>${c.email || '—'}</td>
                    <td class="num">${s.count}</td>
                    <td class="num">${s.total ? fmtMoney(s.total) : '—'}</td>
                    <td class="actions">
                      <button class="btn-secondary btn-sm" data-edit="${c.id}">Edit</button>
                      <button class="btn-danger btn-sm" data-del="${c.id}" data-name="${c.name.replace(/"/g,'&quot;')}">Delete</button>
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : `<p class="empty">No clients yet. Click "+ Add Client" to start.</p>`}
      </div>
    `;

    document.getElementById('btn-new-client').onclick = () => openClientForm();

    el.querySelectorAll('[data-edit]').forEach(b => {
      b.onclick = () => {
        const c = clients.find(x => x.id === b.dataset.edit);
        openClientForm(c);
      };
    });

    el.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = async () => {
        const id   = b.dataset.del;
        const name = b.dataset.name;
        const s    = stats[id] || { count: 0 };
        if (s.count > 0) {
          alert(`Cannot delete "${name}" — they have ${s.count} project(s). Delete or reassign those projects first.`);
          return;
        }
        if (!confirm(`Delete client "${name}"? This cannot be undone.`)) return;
        const { error } = await db.from('clients').delete().eq('id', id);
        if (error) { alert('Delete failed: ' + error.message); return; }
        SCREENS.clients(el);
      };
    });

  } catch (err) {
    el.innerHTML = `<div class="card"><p class="error">${err.message}</p></div>`;
  }
};

function openClientForm(existing) {
  const isEdit = !!existing;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:460px">
      <h2>${isEdit ? 'Edit Client' : 'Add Client'}</h2>
      <form id="cf-form" autocomplete="off">
        <label>Name *</label>
        <input id="cf-name" type="text" required value="${existing?.name || ''}">

        <div class="form-row">
          <div><label>Phone</label><input id="cf-phone" type="tel" value="${existing?.phone || ''}"></div>
          <div><label>Email</label><input id="cf-email" type="email" value="${existing?.email || ''}"></div>
        </div>

        <label>Address</label>
        <input id="cf-address" type="text" value="${(existing?.address || '').replace(/"/g,'&quot;')}">

        <label>Notes</label>
        <textarea id="cf-notes">${existing?.notes || ''}</textarea>

        <p id="cf-error" class="error"></p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="cf-cancel">Cancel</button>
          <button type="submit" id="cf-save">${isEdit ? 'Save Changes' : 'Add Client'}</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(backdrop);

  document.getElementById('cf-cancel').onclick = () => backdrop.remove();
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });

  document.getElementById('cf-form').onsubmit = async e => {
    e.preventDefault();
    const errBox  = document.getElementById('cf-error');
    const saveBtn = document.getElementById('cf-save');
    errBox.textContent = '';

    const payload = {
      name:    document.getElementById('cf-name').value.trim(),
      phone:   document.getElementById('cf-phone').value.trim()   || null,
      email:   document.getElementById('cf-email').value.trim()   || null,
      address: document.getElementById('cf-address').value.trim() || null,
      notes:   document.getElementById('cf-notes').value.trim()   || null,
    };
    if (!payload.name) { errBox.textContent = 'Name is required'; return; }

    saveBtn.disabled    = true;
    saveBtn.textContent = 'Saving…';

    try {
      if (isEdit) {
        const { error } = await db.from('clients').update(payload).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await db.from('clients').insert(payload);
        if (error) throw error;
      }
      backdrop.remove();
      SCREENS.clients(document.getElementById('screen-clients'));
    } catch (err) {
      errBox.textContent  = err.message;
      saveBtn.disabled    = false;
      saveBtn.textContent = isEdit ? 'Save Changes' : 'Add Client';
    }
  };
}

// =====================================================================
// BLOCK 4B — Project Detail page with tabs
// =====================================================================

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

SCREENS.project = async function(el, projectId) {
  if (!projectId) { el.innerHTML = '<div class="card"><p class="error">No project selected.</p></div>'; return; }
  el.innerHTML = '<div class="loading">Loading project…</div>';
  const isOwner = CURRENT_PROFILE.role === 'owner';

  try {
    const [pRes, pmRes, stRes, upRes, gRes, exRes, tmRes] = await Promise.all([
      db.from('projects').select('*, client:clients(name, phone, email)').eq('id', projectId).single(),
      db.from('project_members').select('*, team_member:team_members(name, phone, role)').eq('project_id', projectId).order('created_at'),
      db.from('project_stages').select('*').eq('project_id', projectId).order('sort_order'),
      db.from('project_updates').select('*').eq('project_id', projectId).order('created_at', {ascending:false}),
      db.from('project_gear').select('*, gadget:gadgets(name, brand), member_gadget:member_gadgets(name), carrier:team_members(name)').eq('project_id', projectId),
      db.from('expenses').select('*').eq('project_id', projectId).order('date', {ascending:false}),
      isOwner ? db.from('team_members').select('id, name, role, default_rate').eq('active', true).order('name')
              : Promise.resolve({ data: [] }),
    ]);

    if (pRes.error) throw pRes.error;

    const project = pRes.data;
    const members = pmRes.data || [];
    const stages  = stRes.data || [];
    const updates = upRes.data || [];
    const gear    = gRes.data || [];
    const expenses= exRes.data || [];
    const allTeam = tmRes.data || [];

    // Resolve update author names
    const userIds = [...new Set(updates.map(u => u.user_id).filter(Boolean))];
    const nameById = {};
    if (userIds.length) {
      const { data: profs } = await db.from('profiles').select('id, name, role').in('id', userIds);
      (profs || []).forEach(p => nameById[p.id] = p.name || 'Unknown');
    }

    // Money card (owner only)
    let fin = null;
    if (isOwner) {
      const { data } = await db.rpc('get_project_financials', { p_project_id: projectId });
      fin = data;
    }

    const isMemberOnProject = members.some(m =>
      m.team_member_id === CURRENT_PROFILE.team_member_id);
    const myRow = members.find(m =>
      m.team_member_id === CURRENT_PROFILE.team_member_id);

    const tabs = isOwner
      ? [['overview','Overview'],['team','Team'],['stages','Stages'],['updates','Updates'],
         ['gear','Gear'],['expenses','Expenses'],['invoices','Invoices'],['agreement','Agreement']]
      : [['stages','Stages'],['updates','Updates'],['gear','Gear']];
    let activeTab = tabs[0][0];

    el.innerHTML = `
      <div class="card">
        <div class="flex-between">
          <div>
            <h1 style="margin:0">${esc(project.name)}</h1>
            <div class="muted small mt-1">
              ${esc(project.client?.name || '—')}
              · ${fmtDate(project.start_date)}
              ${project.venue_name ? ' · ' + esc(project.venue_name) : ''}
              <span class="${badgeClass(project.status)}" style="margin-left:8px">${project.status}</span>
            </div>
            ${!isOwner && myRow ? `
              <div class="small mt-1"><strong>Your pay on this project:</strong> ${fmtMoney(myRow.pay_amount)}</div>
            ` : ''}
          </div>
          <a href="#projects" class="small">← Back</a>
        </div>
      </div>
      <div class="tabs" id="ptabs">
        ${tabs.map(([k,l]) =>
          `<button data-tab="${k}" class="${k===activeTab?'active':''}">${l}</button>`).join('')}
      </div>
      <div id="ptab"></div>
    `;

    document.querySelectorAll('#ptabs button').forEach(b => {
      b.onclick = () => switchTab(b.dataset.tab);
    });

    function switchTab(k) {
      activeTab = k;
      document.querySelectorAll('#ptabs button').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === k));
      renderTab(k);
    }

    async function renderTab(k) {
      const t = document.getElementById('ptab');
      try {
        if (k === 'overview')  t.innerHTML = renderOverview(), wireOverview();
        if (k === 'team')      t.innerHTML = renderTeam(),     wireTeam();
        if (k === 'stages')    t.innerHTML = renderStages(),   wireStages();
        if (k === 'updates')   t.innerHTML = renderUpdates(),  wireUpdates();
        if (k === 'gear')      t.innerHTML = renderGear(),     isOwner && wireGear();
        if (k === 'expenses')  t.innerHTML = renderExpenses(), wireExpenses();
        if (k === 'invoices')  t.innerHTML = renderInvoices(), wireInvoices();
        if (k === 'agreement') t.innerHTML = renderAgreement(),wireAgreement();
      } catch (err) {
        t.innerHTML = `<div class="card"><p class="error">${err.message}</p></div>`;
      }
    }

    // ============ OVERVIEW ============
    function renderOverview() {
      const stats = fin ? [
        ['Confirmed',        fin.confirmed_amount, ''],
        ['Received',         fin.total_received,   'pos'],
        ['Outstanding',      (fin.confirmed_amount || 0) - (fin.total_received || 0), 'neg'],
        ['Member Pay',       fin.total_member_pay, ''],
        ['Expenses',         fin.total_expenses,   ''],
        ['Gross Profit',     (fin.confirmed_amount || 0) - (fin.total_member_pay || 0) - (fin.total_expenses || 0), 'pos'],
      ] : [];
      return `
        <div class="stat-grid">
          ${stats.map(([l,v,c]) =>
            `<div class="stat"><div class="label">${l}</div>
              <div class="value ${c}">${fmtMoney(v)}</div></div>`).join('')}
        </div>
        <div class="card">
          <h2>Project Info</h2>
          <table>
            <tr><th style="width:160px">Client</th><td>${esc(project.client?.name || '—')}</td></tr>
            <tr><th>Client Phone</th><td>${esc(project.client?.phone || '—')}</td></tr>
            <tr><th>Client Email</th><td>${esc(project.client?.email || '—')}</td></tr>
            <tr><th>Start</th><td>${fmtDate(project.start_date)} ${project.start_time || ''}</td></tr>
            <tr><th>End</th><td>${fmtDate(project.end_date)} ${project.end_time || ''}</td></tr>
            <tr><th>Venue</th><td>${esc(project.venue_name || '—')}</td></tr>
            <tr><th>Address</th><td>${esc(project.venue_address || '—')}</td></tr>
            <tr><th>Quoted</th><td>${fmtMoney(project.quoted_amount)}</td></tr>
            <tr><th>Confirmed</th><td>${fmtMoney(project.confirmed_amount)}</td></tr>
            <tr><th>Notes</th><td>${esc(project.notes || '—')}</td></tr>
          </table>
        </div>`;
    }
    function wireOverview() {}

    // ============ TEAM ============
    function renderTeam() {
      return `
        <div class="card">
          <div class="card-header">
            <h2>Team (${members.length})</h2>
            <button id="t-add-member">+ Add to Project</button>
          </div>
          ${members.length ? `
            <table>
              <thead><tr><th>Name</th><th>Role</th><th>Status</th><th class="num">Pay</th><th></th></tr></thead>
              <tbody>
                ${members.map(m => `
                  <tr>
                    <td><strong>${esc(m.team_member?.name || '—')}</strong></td>
                    <td>${esc(m.team_member?.role || '—')}</td>
                    <td><span class="${badgeClass(m.status)}">${m.status}</span></td>
                    <td class="num">${fmtMoney(m.pay_amount)}</td>
                    <td class="actions"><button class="btn-danger btn-sm" data-rm="${m.id}">Remove</button></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          ` : `<p class="empty">No team assigned yet.</p>`}
        </div>`;
    }
    function wireTeam() {
      document.getElementById('t-add-member').onclick = openAddProjectMember;
      document.querySelectorAll('[data-rm]').forEach(b => {
        b.onclick = async () => {
          if (!confirm('Remove this member from the project?')) return;
          const { error } = await db.from('project_members').delete().eq('id', b.dataset.rm);
          if (error) { alert(error.message); return; }
          reloadProject();
        };
      });
    }

    async function openAddProjectMember() {
      const assigned = new Set(members.map(m => m.team_member_id));
      const available = allTeam.filter(t => !assigned.has(t.id));
      if (!available.length) { alert('All active members are already assigned.'); return; }

      const nb = document.createElement('div');
      nb.className = 'modal-backdrop';
      nb.innerHTML = `
        <div class="modal" style="max-width:420px">
          <h2>Add to Project</h2>
          <label>Member</label>
          <select id="ap-member">
            ${available.map(t => `<option value="${t.id}" data-rate="${t.default_rate || ''}">${esc(t.name)} — ${esc(t.role || '—')}</option>`).join('')}
          </select>
          <label>Pay Amount</label>
          <input id="ap-pay" type="number" min="0" step="0.01" value="0">
          <p id="ap-error" class="error"></p>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="ap-cancel">Cancel</button>
            <button type="button" id="ap-save">Add</button>
          </div>
        </div>`;
      document.body.appendChild(nb);

      const sel = document.getElementById('ap-member');
      const pay = document.getElementById('ap-pay');
      const autofill = () => {
        const rate = sel.selectedOptions[0]?.dataset.rate;
        if (rate) pay.value = rate;
      };
      sel.onchange = autofill;
      autofill();

      document.getElementById('ap-cancel').onclick = () => nb.remove();
      nb.querySelector('#ap-save').onclick = async () => {
        const errBox = document.getElementById('ap-error');
        errBox.textContent = '';
        const { error } = await db.from('project_members').insert({
          project_id: projectId,
          team_member_id: sel.value,
          rate: Number(pay.value || 0),
          quantity: 1,
          pay_amount: Number(pay.value || 0),
          status: 'assigned',
        });
        if (error) { errBox.textContent = error.message; return; }
        nb.remove();
        reloadProject();
      };
    }

    // ============ STAGES ============
    function renderStages() {
      const canTick = isOwner || isMemberOnProject;
      return `
        <div class="card">
          <div class="card-header">
            <h2>Stages</h2>
            ${isOwner ? `<button id="st-add">+ Add Stage</button>` : ''}
          </div>
          ${stages.length ? stages.map(s => `
            <div class="flex-between" style="padding:10px 0;border-bottom:1px solid #f0f0f0">
              <div style="display:flex;align-items:center;gap:10px;flex:1">
                <input type="checkbox" class="st-check" data-sid="${s.id}"
                  ${s.is_done?'checked':''} ${canTick?'':'disabled'} style="width:auto;margin:0">
                <div>
                  <div style="font-weight:500;${s.is_done?'text-decoration:line-through;color:#6b7280':''}">
                    ${esc(s.name)}
                  </div>
                  ${s.is_done && s.done_at ? `<div class="muted small">Done ${fmtDate(s.done_at)}</div>` : ''}
                </div>
              </div>
            </div>`).join('')
          : '<p class="empty">No stages. Wedding projects auto-load Gaye Holud, Mehendi, Wedding, Reception.</p>'}
        </div>`;
    }
    function wireStages() {
      const addBtn = document.getElementById('st-add');
      if (addBtn) addBtn.onclick = openAddStage;
      document.querySelectorAll('.st-check').forEach(cb => {
        cb.onchange = async () => {
          const sid = cb.dataset.sid;
          const done = cb.checked;
          const { data: { user } } = await db.auth.getUser();
          const { error } = await db.from('project_stages').update({
            is_done: done,
            done_at: done ? new Date().toISOString() : null,
            done_by: done ? user.id : null,
          }).eq('id', sid);
          if (error) { alert(error.message); cb.checked = !done; return; }
          const stg = stages.find(s => s.id === sid);
          await db.from('project_updates').insert({
            project_id: projectId,
            user_id: user.id,
            type: 'stage_done',
            stage_id: sid,
            body: `${done ? 'Marked done' : 'Marked undone'}: ${stg?.name || 'stage'}`,
          });
          reloadProject();
        };
      });
    }

    function openAddStage() {
      const name = prompt('New stage name:');
      if (!name || !name.trim()) return;
      db.from('project_stages').insert({
        project_id: projectId, name: name.trim(),
        sort_order: stages.length + 1,
      }).then(({ error }) => {
        if (error) { alert(error.message); return; }
        reloadProject();
      });
    }

    // ============ UPDATES ============
    function renderUpdates() {
      return `
        <div class="card">
          <h2>Post an Update</h2>
          <div class="form-row">
            <select id="up-type">
              <option value="note">Note</option>
              <option value="issue">Issue / Problem</option>
            </select>
            <div></div>
          </div>
          <textarea id="up-body" placeholder="What's happening?" maxlength="1000"></textarea>
          <p id="up-error" class="error"></p>
          <button id="up-post">Post</button>
        </div>
        <div class="card">
          <h2>Timeline</h2>
          ${updates.length ? updates.map(u => `
            <div style="padding:12px 0;border-bottom:1px solid #f0f0f0">
              <div class="flex-between">
                <div>
                  <strong>${esc(nameById[u.user_id] || '—')}</strong>
                  <span class="badge badge-${u.type === 'issue' ? 'cancelled' : u.type === 'stage_done' ? 'signed' : 'scheduled'}"
                        style="margin-left:8px">${u.type.replace('_',' ')}</span>
                </div>
                <div class="muted small">${new Date(u.created_at).toLocaleString('en-GB')}</div>
              </div>
              ${u.body ? `<div style="margin-top:6px">${esc(u.body)}</div>` : ''}
            </div>`).join('')
          : '<p class="empty">No updates yet.</p>'}
        </div>`;
    }
    function wireUpdates() {
      document.getElementById('up-post').onclick = async () => {
        const type = document.getElementById('up-type').value;
        const body = document.getElementById('up-body').value.trim();
        const errBox = document.getElementById('up-error');
        errBox.textContent = '';
        if (!body) { errBox.textContent = 'Write something first'; return; }
        const { data: { user } } = await db.auth.getUser();
        const { error } = await db.from('project_updates').insert({
          project_id: projectId, user_id: user.id, type, body,
        });
        if (error) { errBox.textContent = error.message; return; }
        reloadProject();
      };
    }

    // ============ GEAR ============
    function renderGear() {
      const studioGear   = gear.filter(g => g.gadget_id);
      const memberGear   = gear.filter(g => g.member_gadget_id);
      return `
        <div class="card">
          <h2>Studio Gear (${studioGear.length})</h2>
          ${studioGear.length ? `
            <table>
              <thead><tr><th>Item</th><th>Carried By</th><th>Out</th><th>Returned</th><th></th></tr></thead>
              <tbody>
                ${studioGear.map(g => `
                  <tr>
                    <td>${esc(g.gadget?.name || '—')}${g.gadget?.brand ? ' · ' + esc(g.gadget.brand) : ''}</td>
                    <td>${esc(g.carrier?.name || '—')}</td>
                    <td>${esc(g.out_condition || '—')}</td>
                    <td><span class="badge badge-${g.returned ? 'signed' : 'scheduled'}">${g.returned ? 'yes' : 'no'}</span></td>
                    <td class="actions">${isOwner && !g.returned ?
                      `<button class="btn-success btn-sm" data-ret="${g.id}">Mark Returned</button>` : ''}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          ` : '<p class="empty">No studio gear attached.</p>'}
        </div>
        <div class="card">
          <h2>Member's Own Gear (${memberGear.length})</h2>
          ${memberGear.length ? `
            <table>
              <thead><tr><th>Item</th><th>Carried By</th><th>Returned</th></tr></thead>
              <tbody>
                ${memberGear.map(g => `
                  <tr>
                    <td>${esc(g.member_gadget?.name || '—')}</td>
                    <td>${esc(g.carrier?.name || '—')}</td>
                    <td><span class="badge badge-${g.returned ? 'signed' : 'scheduled'}">${g.returned ? 'yes' : 'no'}</span></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          ` : '<p class="empty">No member gear recorded.</p>'}
        </div>`;
    }
    function wireGear() {
      document.querySelectorAll('[data-ret]').forEach(b => {
        b.onclick = async () => {
          const { error } = await db.from('project_gear').update({
            returned: true, returned_at: new Date().toISOString(),
          }).eq('id', b.dataset.ret);
          if (error) { alert(error.message); return; }
          reloadProject();
        };
      });
    }

    // ============ EXPENSES ============
    function renderExpenses() {
      const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
      return `
        <div class="card">
          <div class="card-header">
            <h2>Expenses (${expenses.length})</h2>
            <button id="ex-add">+ Add Expense</button>
          </div>
          ${expenses.length ? `
            <table>
              <thead><tr><th>Date</th><th>Category</th><th>Description</th><th class="num">Amount</th></tr></thead>
              <tbody>
                ${expenses.map(e => `
                  <tr>
                    <td>${fmtDate(e.date)}</td>
                    <td>${esc(e.category || '—')}</td>
                    <td>${esc(e.description || '—')}</td>
                    <td class="num">${fmtMoney(e.amount)}</td>
                  </tr>`).join('')}
              </tbody>
              <tfoot>
                <tr><th colspan="3" class="right">Total</th><th class="num">${fmtMoney(total)}</th></tr>
              </tfoot>
            </table>
          ` : '<p class="empty">No expenses yet.</p>'}
        </div>`;
    }
    function wireExpenses() {
      document.getElementById('ex-add').onclick = () => {
        const nb = document.createElement('div');
        nb.className = 'modal-backdrop';
        nb.innerHTML = `
          <div class="modal" style="max-width:420px">
            <h2>Add Expense</h2>
            <div class="form-row">
              <div><label>Date</label><input id="ex-date" type="date" value="${todayISO()}"></div>
              <div><label>Amount *</label><input id="ex-amount" type="number" min="0" step="0.01"></div>
            </div>
            <label>Category</label>
            <select id="ex-cat">
              ${['travel','equipment_rent','props','studio','food','editing_software','other']
                .map(c => `<option>${c}</option>`).join('')}
            </select>
            <label>Description</label>
            <input id="ex-desc" type="text">
            <p id="ex-error" class="error"></p>
            <div class="modal-actions">
              <button type="button" class="btn-secondary" id="ex-cancel">Cancel</button>
              <button type="button" id="ex-save">Add</button>
            </div>
          </div>`;
        document.body.appendChild(nb);
        document.getElementById('ex-cancel').onclick = () => nb.remove();
        nb.querySelector('#ex-save').onclick = async () => {
          const errBox = document.getElementById('ex-error');
          errBox.textContent = '';
          const amount = Number(document.getElementById('ex-amount').value || 0);
          if (!amount) { errBox.textContent = 'Amount required'; return; }
          const { data: { user } } = await db.auth.getUser();
          const { error } = await db.from('expenses').insert({
            project_id: projectId,
            date: document.getElementById('ex-date').value,
            amount,
            category: document.getElementById('ex-cat').value,
            description: document.getElementById('ex-desc').value.trim() || null,
            created_by: user.id,
          });
          if (error) { errBox.textContent = error.message; return; }
          nb.remove();
          reloadProject();
        };
      };
    }

    // ============ INVOICES ============
    function renderInvoices() {
      return `
        <div class="card">
          <h2>Invoices</h2>
          <p class="muted">Full invoice management is on the Invoices screen.</p>
          <button onclick="location.hash='#invoices'">Go to Invoices →</button>
        </div>`;
    }
    function wireInvoices() {}

    // ============ AGREEMENT ============
    function renderAgreement() {
      return `
        <div class="card">
          <h2>Agreement</h2>
          <p class="muted">Create or manage this project's agreement on the Agreements screen.</p>
          <button onclick="location.hash='#agreements'">Go to Agreements →</button>
        </div>`;
    }
    function wireAgreement() {}

    // ============ RELOAD ============
    function reloadProject() { SCREENS.project(el, projectId); }

    renderTab(activeTab);

  } catch (err) {
    el.innerHTML = `<div class="card"><p class="error">${esc(err.message)}</p></div>`;
  }
};

// =====================================================================
// BLOCK 5A — Agreements list + Templates management
// =====================================================================

let AGREEMENTS_TAB = 'list';   // 'list' | 'templates'

SCREENS.agreements = async function(el) {
  el.innerHTML = '<div class="loading">Loading agreements…</div>';
  try {
    if (AGREEMENTS_TAB === 'templates') {
      return renderTemplates(el);
    }
    return renderList(el);
  } catch (err) {
    el.innerHTML = `<div class="card"><p class="error">${esc(err.message)}</p></div>`;
  }
};

async function renderList(el) {
  const { data, error } = await db.from('agreements')
    .select('id, agreement_no, title, status, total_amount, advance_amount, balance_amount, signed_on, created_at, client:clients(name), project:projects(name)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const list = data || [];

  el.innerHTML = `
    <div class="tabs" style="margin-bottom:16px">
      <button class="${AGREEMENTS_TAB==='list'?'active':''}"    data-tab="list">Agreements (${list.length})</button>
      <button class="${AGREEMENTS_TAB==='templates'?'active':''}" data-tab="templates">Templates</button>
    </div>
    <div class="card">
      <div class="card-header">
        <h2>Agreements</h2>
        <div class="btn-group">
          <button id="ag-new">+ New Agreement</button>
        </div>
      </div>
      ${list.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>No.</th><th>Client</th><th>Project</th><th>Amount</th>
              <th>Status</th><th>Signed</th><th></th>
            </tr></thead>
            <tbody>
              ${list.map(a => `
                <tr style="cursor:pointer" onclick="location.hash='#agreement/${a.id}'">
                  <td><strong>${esc(a.agreement_no)}</strong></td>
                  <td>${esc(a.client?.name || '—')}</td>
                  <td>${esc(a.project?.name || '—')}</td>
                  <td class="num">${fmtMoney(a.total_amount)}</td>
                  <td><span class="${badgeClass(a.status)}">${a.status}</span></td>
                  <td>${a.signed_on ? fmtDate(a.signed_on) : '—'}</td>
                  <td class="actions" onclick="event.stopPropagation()">
                    <button class="btn-secondary btn-sm" data-del="${a.id}" data-no="${esc(a.agreement_no)}">Delete</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      ` : '<p class="empty">No agreements yet. Click "+ New Agreement".</p>'}
    </div>
  `;

  // Tabs
  el.querySelectorAll('.tabs button').forEach(b => {
    b.onclick = () => { AGREEMENTS_TAB = b.dataset.tab; SCREENS.agreements(el); };
  });

  // New
  document.getElementById('ag-new').onclick = () => openNewAgreementModal();

  // Delete
  el.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete agreement "${b.dataset.no}"? Signed and archived versions will also be deleted.`)) return;
      const { error } = await db.from('agreements').delete().eq('id', b.dataset.del);
      if (error) { alert(error.message); return; }
      SCREENS.agreements(el);
    };
  });
}

async function renderTemplates(el) {
  const { data, error } = await db.from('agreement_templates')
    .select('id, name, is_default, active, project_type:project_types(name)')
    .order('name');
  if (error) throw error;
  const list = data || [];

  el.innerHTML = `
    <div class="tabs" style="margin-bottom:16px">
      <button data-tab="list">Agreements</button>
      <button class="active" data-tab="templates">Templates (${list.length})</button>
    </div>
    <div class="card">
      <div class="card-header">
        <h2>Agreement Templates</h2>
        <button id="tpl-new">+ New Template</button>
      </div>
      <p class="hint">
        Placeholders: <code>{{client_name}}</code> <code>{{client_phone}}</code>
        <code>{{client_address}}</code> <code>{{project_name}}</code>
        <code>{{project_date}}</code> <code>{{venue}}</code>
        <code>{{total_amount}}</code> <code>{{advance_amount}}</code>
        <code>{{balance_amount}}</code> <code>{{deliverables}}</code>
        <code>{{studio_name}}</code> <code>{{studio_phone}}</code>
        <code>{{studio_address}}</code> <code>{{agreement_no}}</code>
        <code>{{agreement_date}}</code>
      </p>
      ${list.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Name</th><th>For Project Type</th><th>Default</th><th></th>
            </tr></thead>
            <tbody>
              ${list.map(t => `
                <tr>
                  <td><strong>${esc(t.name)}</strong></td>
                  <td>${esc(t.project_type?.name || 'Any')}</td>
                  <td>${t.is_default ? '<span class="badge badge-signed">default</span>' : ''}</td>
                  <td class="actions">
                    <button class="btn-secondary btn-sm" data-edit="${t.id}">Edit</button>
                    <button class="btn-danger btn-sm" data-del="${t.id}">Delete</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      ` : '<p class="empty">No templates yet. Click "+ New Template" to start.</p>'}
    </div>
  `;

  el.querySelectorAll('.tabs button').forEach(b => {
    b.onclick = () => { AGREEMENTS_TAB = b.dataset.tab; SCREENS.agreements(el); };
  });

  document.getElementById('tpl-new').onclick = () => openTemplateForm();
  el.querySelectorAll('[data-edit]').forEach(b => {
    b.onclick = async () => {
      const { data } = await db.from('agreement_templates').select('*').eq('id', b.dataset.edit).single();
      if (data) openTemplateForm(data);
    };
  });
  el.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('Delete this template?')) return;
      const { error } = await db.from('agreement_templates').delete().eq('id', b.dataset.del);
      if (error) { alert(error.message); return; }
      SCREENS.agreements(el);
    };
  });
}

// ============ TEMPLATE FORM ============
async function openTemplateForm(existing) {
  const isEdit = !!existing;
  const { data: types } = await db.from('project_types').select('id,name').order('name');

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:680px">
      <h2>${isEdit ? 'Edit Template' : 'New Template'}</h2>
      <form id="tpl-form" autocomplete="off">
        <div class="form-row">
          <div>
            <label>Template Name *</label>
            <input id="tpl-name" type="text" required value="${esc(existing?.name || '')}">
          </div>
          <div>
            <label>For Project Type</label>
            <select id="tpl-type">
              <option value="">Any</option>
              ${(types || []).map(t => `
                <option value="${t.id}" ${existing?.project_type_id===t.id?'selected':''}>${esc(t.name)}</option>
              `).join('')}
            </select>
          </div>
        </div>
        <div class="checkbox-row">
          <input type="checkbox" id="tpl-default" ${existing?.is_default?'checked':''}>
          <label for="tpl-default">Set as default template</label>
        </div>

        <label>Body *</label>
        <textarea id="tpl-body" required style="min-height:280px;font-family:monospace;font-size:13px">${esc(existing?.body || '')}</textarea>

        <label>Default Terms (optional)</label>
        <textarea id="tpl-terms" style="min-height:100px;font-family:monospace;font-size:13px">${esc(existing?.default_terms || '')}</textarea>

        <p id="tpl-error" class="error"></p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="tpl-cancel">Cancel</button>
          <button type="submit" id="tpl-save">${isEdit ? 'Save Changes' : 'Create Template'}</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(backdrop);

  document.getElementById('tpl-cancel').onclick = () => backdrop.remove();
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });

  document.getElementById('tpl-form').onsubmit = async e => {
    e.preventDefault();
    const errBox  = document.getElementById('tpl-error');
    const saveBtn = document.getElementById('tpl-save');
    errBox.textContent = '';

    const payload = {
      name:      document.getElementById('tpl-name').value.trim(),
      body:      document.getElementById('tpl-body').value,
      default_terms: document.getElementById('tpl-terms').value || null,
      project_type_id: document.getElementById('tpl-type').value || null,
      is_default: document.getElementById('tpl-default').checked,
    };
    if (!payload.name || !payload.body.trim()) {
      errBox.textContent = 'Name and body are required'; return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      // If setting as default, clear other defaults of same type
      if (payload.is_default) {
        await db.from('agreement_templates').update({ is_default: false })
          .eq('is_default', true);
        if (payload.project_type_id) {
          // only clear those matching this type — already cleared all above, acceptable
        }
      }
      if (isEdit) {
        const { error } = await db.from('agreement_templates').update(payload).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await db.from('agreement_templates').insert(payload);
        if (error) throw error;
      }
      backdrop.remove();
      SCREENS.agreements(document.getElementById('screen-agreements'));
    } catch (err) {
      errBox.textContent = err.message;
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? 'Save Changes' : 'Create Template';
    }
  };
}

// ============ NEW AGREEMENT MODAL ============
async function openNewAgreementModal() {
  const [cRes, tRes, pRes] = await Promise.all([
    db.from('clients').select('id,name').order('name'),
    db.from('agreement_templates').select('id,name,is_default,project_type_id').eq('active', true).order('name'),
    db.from('projects').select('id,name,client_id,project_type_id').order('start_date', { ascending: false }),
  ]);
  const clients   = cRes.data || [];
  const templates = tRes.data || [];
  const projects  = pRes.data || [];

  if (!templates.length) {
    alert('Create an agreement template first (Templates tab).');
    return;
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:480px">
      <h2>New Agreement</h2>
      <form id="na-form" autocomplete="off">
        <label>Template *</label>
        <select id="na-template" required>
          ${templates.map(t =>
            `<option value="${t.id}" data-type="${t.project_type_id || ''}" ${t.is_default?'data-default="1"':''}>${esc(t.name)}</option>`
          ).join('')}
        </select>

        <label>Client *</label>
        <select id="na-client" required>
          <option value="">— select client —</option>
          ${clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
        </select>

        <label>Project (optional)</label>
        <select id="na-project">
          <option value="">— none (client-level agreement) —</option>
          ${projects.map(p => `<option value="${p.id}" data-client="${p.client_id}" data-type="${p.project_type_id || ''}">${esc(p.name)}</option>`).join('')}
        </select>
        <p class="hint">Pick a project to auto-fill date, venue, and amounts.</p>

        <p id="na-error" class="error"></p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="na-cancel">Cancel</button>
          <button type="submit" id="na-create">Open Editor</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(backdrop);

  // Filter projects by chosen client
  const clientSel = document.getElementById('na-client');
  const projectSel = document.getElementById('na-project');
  clientSel.onchange = () => {
    [...projectSel.options].forEach(opt => {
      if (!opt.value) return;
      opt.style.display = (!clientSel.value || opt.dataset.client === clientSel.value) ? '' : 'none';
    });
    if (projectSel.selectedOptions[0]?.style.display === 'none') projectSel.value = '';
  };

  document.getElementById('na-cancel').onclick = () => backdrop.remove();
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });

  document.getElementById('na-form').onsubmit = async e => {
    e.preventDefault();
    const errBox = document.getElementById('na-error');
    errBox.textContent = '';
    const template_id = document.getElementById('na-template').value;
    const client_id   = document.getElementById('na-client').value;
    const project_id  = document.getElementById('na-project').value || null;

    if (!template_id || !client_id) {
      errBox.textContent = 'Template and client are required'; return;
    }

    const { data: tpl } = await db.from('agreement_templates').select('*').eq('id', template_id).single();
    if (!tpl) { errBox.textContent = 'Template not found'; return; }

    // Create a draft agreement with template body as starting point
    const { data: created, error } = await db.from('agreements').insert({
      client_id,
      project_id,
      template_id,
      title:     tpl.name,
      body_rendered: tpl.body,
      total_amount:   0,
      advance_amount: 0,
      balance_amount: 0,
      status: 'draft',
      created_by: CURRENT_PROFILE.id,
    }).select().single();

    if (error) { errBox.textContent = error.message; return; }
    backdrop.remove();
    location.hash = '#agreement/' + created.id;
  };
}

// =====================================================================
// BLOCK 5B — Agreement Editor (form left, A4 preview right)
// =====================================================================

SCREENS.agreement = async function(el, id) {
  if (!id) {
    el.innerHTML = '<div class="card"><p class="error">No agreement selected.</p></div>';
    return;
  }
  el.innerHTML = '<div class="loading">Loading agreement…</div>';

  try {
    const [agRes, tmplRes, studioRes, clRes, prjRes, verRes] = await Promise.all([
      db.from('agreements')
        .select('*, client:clients(*), project:projects(*)')
        .eq('id', id).single(),
      db.from('agreement_templates').select('id,name,body,is_default').eq('active', true).order('name'),
      db.from('studio').select('*').single(),
      db.from('clients').select('id,name,phone,email,address').order('name'),
      db.from('projects').select('id,name,client_id,venue_name,start_date,confirmed_amount').order('start_date', {ascending:false}),
      db.from('agreement_versions').select('id,version_no,edited_at').eq('agreement_id', id).order('version_no', {ascending:false}),
    ]);
    if (agRes.error) throw agRes.error;

    const ag       = agRes.data;
    const templates= tmplRes.data || [];
    const studio   = studioRes.data || { name: 'Studio' };
    const clients  = clRes.data || [];
    const projects = prjRes.data || [];
    const versions = verRes.data || [];
    const meta     = ag.metadata || {};

    // Form state
    const S = {
      agreement_date: ag.agreement_date || (ag.created_at ? ag.created_at.split('T')[0] : todayISO()),
      venue:          meta.venue || ag.project?.venue_name || '',
      deliverables:   meta.deliverables || '',
      total:          Number(ag.total_amount) || Number(ag.project?.confirmed_amount) || 0,
      advance:        Number(ag.advance_amount) || 0,
      body:           ag.body_rendered || '',
    };
    S.balance = S.total - S.advance;

    // ---- Substitution ----
    function substitutionData() {
      const clientId  = document.getElementById('ag-client').value;
      const projectId = document.getElementById('ag-project').value;
      const client    = clients.find(c => c.id === clientId) || {};
      const project   = projects.find(p => p.id === projectId) || {};
      return {
        client_name:    client.name || '',
        client_phone:   client.phone || '',
        client_address: client.address || '',
        project_name:   project.name || '',
        project_date:   project.start_date ? fmtDate(project.start_date) : '',
        venue:          document.getElementById('ag-venue').value || '',
        total_amount:   fmtMoney(document.getElementById('ag-total').value),
        advance_amount: fmtMoney(document.getElementById('ag-adv').value),
        balance_amount: fmtMoney(Number(document.getElementById('ag-total').value || 0)
                                - Number(document.getElementById('ag-adv').value || 0)),
        deliverables:   document.getElementById('ag-deliv').value || '',
        studio_name:    studio.name || '',
        studio_phone:   studio.phone || '',
        studio_address: studio.address || '',
        agreement_no:   ag.agreement_no,
        agreement_date: document.getElementById('ag-date').value
                          ? fmtDate(document.getElementById('ag-date').value) : '',
      };
    }
    function substitute(text, data) {
      return String(text || '').replace(/\{\{(\w+)\}\}/g, (_, k) => data[k] ?? '');
    }

    // ---- Layout ----
    el.innerHTML = `
      <div style="margin-bottom:12px"><a href="#agreements" class="small">← Back to Agreements</a></div>
      <div id="ag-layout" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start">
        <style>
          @media (max-width:1000px) { #ag-layout { grid-template-columns: 1fr !important; } #print-area { min-height:auto !important; padding:20px !important; } }
          @media print {
            #print-area { width:210mm !important; min-height:auto !important; padding:15mm !important; box-shadow:none !important; position:absolute !important; left:0 !important; top:0 !important; font-size:11pt !important; }
            #print-area * { visibility:visible !important; }
            .print-watermark { font-size:120px !important; }
          }
        </style>

        <!-- LEFT: FORM -->
        <div>
          <div class="card">
            <div class="flex-between mb-2">
              <h2 style="margin:0">${esc(ag.agreement_no)}</h2>
              <span class="${badgeClass(ag.status)}">${ag.status}</span>
            </div>

            <div class="form-row">
              <div>
                <label>Template</label>
                <select id="ag-tpl">
                  ${templates.map(t =>
                    `<option value="${t.id}" data-body="${esc(t.body || '').replace(/"/g,'&quot;')}" ${t.id===ag.template_id?'selected':''}>${esc(t.name)}</option>`
                  ).join('')}
                </select>
              </div>
              <div>
                <label>Agreement Date</label>
                <input id="ag-date" type="date" value="${S.agreement_date}">
              </div>
            </div>

            <div class="form-row">
              <div>
                <label>Client</label>
                <select id="ag-client">
                  ${clients.map(c =>
                    `<option value="${c.id}" ${c.id===ag.client_id?'selected':''}>${esc(c.name)}</option>`
                  ).join('')}
                </select>
              </div>
              <div>
                <label>Project</label>
                <select id="ag-project">
                  <option value="">— none (client-level) —</option>
                  ${projects.map(p =>
                    `<option value="${p.id}" data-client="${p.client_id}" ${p.id===ag.project_id?'selected':''}>${esc(p.name)}</option>`
                  ).join('')}
                </select>
              </div>
            </div>

            <div class="form-row">
              <div><label>Venue</label><input id="ag-venue" type="text" value="${esc(S.venue).replace(/"/g,'&quot;')}"></div>
              <div><label>Deliverables</label><input id="ag-deliv" type="text" placeholder="e.g. 500 edited photos, 1 album" value="${esc(S.deliverables).replace(/"/g,'&quot;')}"></div>
            </div>

            <div class="form-row form-row-3">
              <div><label>Total</label><input id="ag-total" type="number" min="0" step="0.01" value="${S.total}"></div>
              <div><label>Advance</label><input id="ag-adv" type="number" min="0" step="0.01" value="${S.advance}"></div>
              <div><label>Balance</label><div id="ag-balance" style="padding:10px 11px;background:#f3f4f6;border-radius:6px;font-weight:600;font-variant-numeric:tabular-nums">${fmtMoney(S.balance)}</div></div>
            </div>

            <label>Body (edit text, use placeholders)</label>
            <textarea id="ag-body" style="min-height:260px;font-family:ui-monospace,Consolas,monospace;font-size:13px;line-height:1.5">${esc(S.body)}</textarea>
            <p class="hint">Placeholders: <code>{{client_name}}</code> <code>{{client_phone}}</code> <code>{{client_address}}</code> <code>{{project_name}}</code> <code>{{project_date}}</code> <code>{{venue}}</code> <code>{{total_amount}}</code> <code>{{advance_amount}}</code> <code>{{balance_amount}}</code> <code>{{deliverables}}</code> <code>{{studio_name}}</code> <code>{{studio_phone}}</code> <code>{{studio_address}}</code> <code>{{agreement_no}}</code> <code>{{agreement_date}}</code></p>

            <label>Internal Notes (not printed)</label>
            <textarea id="ag-notes" style="min-height:60px">${esc(ag.notes || '')}</textarea>

            <hr>
            <h3>Signed Copy</h3>
            <div class="form-row">
              <div><label>Signed On</label><input id="ag-signed-on" type="date" value="${ag.signed_on || ''}"></div>
              <div><label>Scan URL (paste link)</label><input id="ag-signed-url" type="url" placeholder="https://drive.google.com/… or Supabase Storage URL" value="${esc(ag.signed_copy_url || '').replace(/"/g,'&quot;')}"></div>
            </div>

            <hr>
            <div class="btn-group mb-2">
              <button id="ag-save">Save</button>
              <button id="ag-print" class="btn-secondary">🖨 Generate PDF</button>
            </div>
            <div class="btn-group mb-2">
              <button id="ag-wa"    class="btn-success">📱 Send WhatsApp</button>
              <button id="ag-email" class="btn-secondary">✉ Send Email</button>
            </div>
            <div class="btn-group">
              <button id="ag-status-generated" class="btn-secondary btn-sm">Mark Generated</button>
              <button id="ag-status-sent"      class="btn-secondary btn-sm">Mark Sent</button>
              <button id="ag-status-signed"    class="btn-success btn-sm">Mark Signed</button>
              <button id="ag-status-archived"  class="btn-secondary btn-sm">Archive</button>
            </div>
            <p id="ag-error" class="error"></p>
          </div>

          ${versions.length ? `
            <div class="card">
              <h3>Version History</h3>
              <table class="small">
                <thead><tr><th>Version</th><th>Saved</th></tr></thead>
                <tbody>
                  ${versions.map(v => `<tr>
                    <td>v${v.version_no}</td>
                    <td>${new Date(v.edited_at).toLocaleString('en-GB')}</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          ` : ''}
        </div>

        <!-- RIGHT: LIVE A4 PREVIEW -->
        <div>
          <div class="card" style="position:sticky;top:20px">
            <div class="flex-between mb-2">
              <h3 style="margin:0">Live Preview</h3>
              <span class="muted small">A4 · ${esc(studio.currency || '')}</span>
            </div>
            <div id="print-area" style="
              width:100%;max-width:210mm;min-height:297mm;
              background:#fff;padding:32px 40px;
              box-shadow:0 2px 12px rgba(0,0,0,.12);
              position:relative;
              font-family:'Times New Roman',Georgia,serif;
              font-size:14px;line-height:1.7;
              color:#111;
            ">
              <div class="print-watermark" style="
                position:absolute;top:50%;left:50%;
                transform:translate(-50%,-50%) rotate(-30deg);
                font-size:90px;color:rgba(0,0,0,.06);
                font-weight:900;white-space:nowrap;
                pointer-events:none;user-select:none;
                z-index:0;font-family:system-ui,sans-serif;
              ">${esc(studio.name)}</div>

              <div id="print-content" style="position:relative;z-index:1;white-space:pre-wrap"></div>

              <div style="position:relative;z-index:1;margin-top:40px;padding-top:24px;border-top:1px solid #ddd">
                <div style="display:flex;justify-content:space-between;gap:20px">
                  <div style="flex:1">
                    <div style="font-size:11px;color:#666">For ${esc(studio.name)}</div>
                    <div style="margin-top:30px;border-top:1px solid #000;padding-top:4px;font-size:11px">Signature / Stamp</div>
                  </div>
                  <div style="flex:1">
                    <div style="font-size:11px;color:#666">For the Client</div>
                    <div style="margin-top:30px;border-top:1px solid #000;padding-top:4px;font-size:11px">Signature</div>
                  </div>
                </div>
                <div style="margin-top:20px;font-size:10px;color:#888;text-align:center">
                  ${esc(ag.agreement_no)} · ${esc(studio.name)} · ${esc(studio.phone || '')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // ---- Live preview refresh ----
    function refresh() {
      const total   = Number(document.getElementById('ag-total').value || 0);
      const advance = Number(document.getElementById('ag-adv').value   || 0);
      const balance = total - advance;
      document.getElementById('ag-balance').textContent = fmtMoney(balance);

      const data = substitutionData();
      const body = substitute(document.getElementById('ag-body').value, data);
      document.getElementById('print-content').innerHTML =
        esc(body).replace(/\n/g, '<br>');
    }

    // Wire up all inputs
    ['ag-date','ag-venue','ag-deliv','ag-total','ag-adv','ag-body','ag-client','ag-project']
      .forEach(id => document.getElementById(id).addEventListener('input', refresh));
    ['ag-client','ag-project'].forEach(id =>
      document.getElementById(id).addEventListener('change', refresh));

    // Template change — replace body (with confirm)
    document.getElementById('ag-tpl').onchange = e => {
      const tplBody = e.target.selectedOptions[0]?.dataset.body || '';
      if (!tplBody) return;
      if (!confirm('Replace current body with this template\'s body? Unsaved changes will be lost.')) {
        e.target.value = ag.template_id || e.target.value;
        return;
      }
      document.getElementById('ag-body').value = tplBody;
      refresh();
    };

    // Client change — filter projects
    document.getElementById('ag-client').onchange = () => {
      const cid = document.getElementById('ag-client').value;
      const projSel = document.getElementById('ag-project');
      [...projSel.options].forEach(opt => {
        if (!opt.value) return;
        opt.style.display = (!cid || opt.dataset.client === cid) ? '' : 'none';
      });
      if (projSel.selectedOptions[0]?.style.display === 'none') projSel.value = '';
      refresh();
    };
    document.getElementById('ag-client').dispatchEvent(new Event('change'));

    // Auto-fill total from project when project picked (only if currently 0)
    document.getElementById('ag-project').addEventListener('change', e => {
      const pid = e.target.value;
      if (!pid) return;
      const p = projects.find(x => x.id === pid);
      if (p && Number(document.getElementById('ag-total').value || 0) === 0) {
        document.getElementById('ag-total').value = p.confirmed_amount || 0;
      }
      if (p && !document.getElementById('ag-venue').value) {
        document.getElementById('ag-venue').value = p.venue_name || '';
      }
      refresh();
    });

    refresh();

    // ---- SAVE ----
    async function save(newStatus) {
      const errBox = document.getElementById('ag-error');
      errBox.textContent = '';

      const newBody = document.getElementById('ag-body').value;
      const payload = {
        agreement_date:    document.getElementById('ag-date').value || null,
        body_rendered:     newBody,
        total_amount:      Number(document.getElementById('ag-total').value || 0),
        advance_amount:    Number(document.getElementById('ag-adv').value   || 0),
        balance_amount:    Number(document.getElementById('ag-total').value || 0)
                          - Number(document.getElementById('ag-adv').value   || 0),
        status:            newStatus || ag.status,
        signed_on:         document.getElementById('ag-signed-on').value  || null,
        signed_copy_url:   document.getElementById('ag-signed-url').value.trim() || null,
        notes:             document.getElementById('ag-notes').value.trim() || null,
        metadata: {
          venue:        document.getElementById('ag-venue').value.trim(),
          deliverables: document.getElementById('ag-deliv').value.trim(),
        },
        project_id:        document.getElementById('ag-project').value || null,
      };

      try {
        // Snapshot version if body changed
        if (ag.body_rendered !== newBody) {
          const { data: maxVer } = await db.from('agreement_versions')
            .select('version_no').eq('agreement_id', id)
            .order('version_no', { ascending: false }).limit(1).maybeSingle();
          const nextVer = (maxVer?.version_no || 0) + 1;
          await db.from('agreement_versions').insert({
            agreement_id:   id,
            version_no:     nextVer,
            body_rendered:  ag.body_rendered,
            total_amount:   ag.total_amount,
            advance_amount: ag.advance_amount,
            balance_amount: ag.balance_amount,
            edited_by:      CURRENT_PROFILE.id,
          });
        }

        const { error } = await db.from('agreements').update(payload).eq('id', id);
        if (error) throw error;

        // Reset local state so next save doesn't snapshot again
        ag.body_rendered  = newBody;
        ag.total_amount   = payload.total_amount;
        ag.advance_amount = payload.advance_amount;
        ag.balance_amount = payload.balance_amount;

        if (newStatus) {
          SCREENS.agreement(el, id);   // reload to show new status + versions
        }
      } catch (err) {
        errBox.textContent = err.message;
        throw err;
      }
    }

    document.getElementById('ag-save').onclick = async () => {
      try { await save(null); alert('Saved.'); } catch {}
    };

    ['generated','sent','signed','archived'].forEach(st => {
      const btn = document.getElementById('ag-status-' + st);
      if (btn) btn.onclick = async () => {
        try { await save(st); } catch {}
      };
    });

    // ---- PRINT ----
    document.getElementById('ag-print').onclick = () => {
      refresh();
      setTimeout(() => window.print(), 100);
    };

    // ---- WHATSAPP ----
    document.getElementById('ag-wa').onclick = () => {
      const client = clients.find(c => c.id === document.getElementById('ag-client').value);
      if (!client?.phone) { alert('Client has no phone number. Add one in the Clients screen first.'); return; }
      const digits = client.phone.replace(/\D/g, '');
      if (digits.length < 8) { alert('Client phone too short. Fix it in Clients screen.'); return; }
      const total   = fmtMoney(document.getElementById('ag-total').value);
      const advance = fmtMoney(document.getElementById('ag-adv').value);
      const proj    = projects.find(p => p.id === document.getElementById('ag-project').value);
      const msg = `Dear ${client.name},\n\nPlease find attached agreement ${ag.agreement_no} for ${proj?.name || 'our service'}.\n\nTotal: ${total}\nAdvance: ${advance}\n\nKindly review and sign.\n\n— ${studio.name}${studio.phone ? ' · ' + studio.phone : ''}`;
      window.open(`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`, '_blank');
    };

    // ---- EMAIL ----
    document.getElementById('ag-email').onclick = () => {
      const client = clients.find(c => c.id === document.getElementById('ag-client').value);
      if (!client?.email) { alert('Client has no email address. Add one in Clients screen.'); return; }
      const proj = projects.find(p => p.id === document.getElementById('ag-project').value);
      const subj = `Agreement ${ag.agreement_no} — ${studio.name}`;
      const body = `Dear ${client.name},\n\nPlease find attached agreement ${ag.agreement_no}${proj ? ' for ' + proj.name : ''}.\n\nTotal: ${fmtMoney(document.getElementById('ag-total').value)}\nAdvance: ${fmtMoney(document.getElementById('ag-adv').value)}\n\nKindly review and sign at your earliest convenience.\n\nBest regards,\n${studio.name}\n${studio.phone || ''}\n${studio.email || ''}`;
      window.location.href = `mailto:${encodeURIComponent(client.email)}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
    };

  } catch (err) {
    el.innerHTML = `<div class="card"><p class="error">${esc(err.message)}</p></div>`;
  }
};

// =====================================================================
// BLOCK 6A — Gadgets + Invoices + Payments
// =====================================================================

// ============ GADGETS ============
let GADGETS_TAB = 'studio';   // 'studio' | 'member'

SCREENS.gadgets = async function(el) {
  el.innerHTML = '<div class="loading">Loading gear…</div>';
  try {
    const [gRes, mgRes, tmRes] = await Promise.all([
      db.from('gadgets').select('*').order('name'),
      db.from('member_gadgets').select('*, owner:team_members(name)').order('name'),
      db.from('team_members').select('id,name').eq('active', true).order('name'),
    ]);
    if (gRes.error) throw gRes.error;

    const gadgets    = gRes.data || [];
    const memberGear = mgRes.data || [];
    const members    = tmRes.data || [];

    el.innerHTML = `
      <div class="tabs" style="margin-bottom:16px">
        <button class="${GADGETS_TAB==='studio'?'active':''}" data-tab="studio">Studio Gear (${gadgets.length})</button>
        <button class="${GADGETS_TAB==='member'?'active':''}" data-tab="member">Member Gear (${memberGear.length})</button>
      </div>
      <div id="gadgets-panel"></div>
    `;
    el.querySelectorAll('.tabs button').forEach(b => {
      b.onclick = () => { GADGETS_TAB = b.dataset.tab; SCREENS.gadgets(el); };
    });

    const panel = document.getElementById('gadgets-panel');

    if (GADGETS_TAB === 'studio') {
      const totalValue = gadgets.reduce((s, g) =>
        s + Number(g.current_value || g.purchase_price || 0), 0);
      panel.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h2>Studio Gear</h2>
            <button id="g-new">+ Add Gadget</button>
          </div>
          <p class="muted small mb-2">Total current value: <strong>${fmtMoney(totalValue)}</strong></p>
          ${gadgets.length ? `
            <div class="table-wrap"><table>
              <thead><tr>
                <th>Name</th><th>Category</th><th>Brand / Model</th>
                <th>Serial</th><th>Status</th><th class="num">Value</th><th></th>
              </tr></thead>
              <tbody>
                ${gadgets.map(g => `<tr>
                  <td><strong>${esc(g.name)}</strong></td>
                  <td>${esc(g.category || '—')}</td>
                  <td>${esc(g.brand || '')}${g.brand && g.model ? ' · ' : ''}${esc(g.model || '')}</td>
                  <td class="small">${esc(g.serial_no || '—')}</td>
                  <td><span class="badge badge-${g.status==='in_store'?'signed':g.status==='out_on_project'?'scheduled':'cancelled'}">${esc(g.status.replace(/_/g,' '))}</span></td>
                  <td class="num">${fmtMoney(g.current_value || g.purchase_price)}</td>
                  <td class="actions">
                    <button class="btn-secondary btn-sm" data-gedit="${g.id}">Edit</button>
                    <button class="btn-danger btn-sm"    data-gdel="${g.id}" data-gname="${esc(g.name)}">Delete</button>
                  </td>
                </tr>`).join('')}
              </tbody>
            </table></div>
          ` : '<p class="empty">No studio gear yet.</p>'}
        </div>`;

      document.getElementById('g-new').onclick = () => openGadgetForm();
      panel.querySelectorAll('[data-gedit]').forEach(b => b.onclick = async () => {
        const { data } = await db.from('gadgets').select('*').eq('id', b.dataset.gedit).single();
        if (data) openGadgetForm(data);
      });
      panel.querySelectorAll('[data-gdel]').forEach(b => b.onclick = async () => {
        if (!confirm(`Delete "${b.dataset.gname}"?`)) return;
        const { error } = await db.from('gadgets').delete().eq('id', b.dataset.gdel);
        if (error) { alert(error.message); return; }
        SCREENS.gadgets(el);
      });

    } else {
      panel.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h2>Member Gear</h2>
            <button id="mg-new">+ Add Member Item</button>
          </div>
          ${memberGear.length ? `
            <div class="table-wrap"><table>
              <thead><tr>
                <th>Item</th><th>Owner</th><th>Category</th>
                <th class="num">Est. Value</th><th>Condition</th><th></th>
              </tr></thead>
              <tbody>
                ${memberGear.map(mg => `<tr>
                  <td><strong>${esc(mg.name)}</strong></td>
                  <td>${esc(mg.owner?.name || '—')}</td>
                  <td>${esc(mg.category || '—')}</td>
                  <td class="num">${fmtMoney(mg.estimated_value)}</td>
                  <td>${esc(mg.condition || '—')}</td>
                  <td class="actions">
                    <button class="btn-secondary btn-sm" data-mgedit="${mg.id}">Edit</button>
                    <button class="btn-danger btn-sm"    data-mgdel="${mg.id}" data-mgname="${esc(mg.name)}">Delete</button>
                  </td>
                </tr>`).join('')}
              </tbody>
            </table></div>
          ` : '<p class="empty">No member gear yet.</p>'}
        </div>`;

      document.getElementById('mg-new').onclick = () => openMemberGadgetForm(null, members);
      panel.querySelectorAll('[data-mgedit]').forEach(b => b.onclick = async () => {
        const { data } = await db.from('member_gadgets').select('*').eq('id', b.dataset.mgedit).single();
        if (data) openMemberGadgetForm(data, members);
      });
      panel.querySelectorAll('[data-mgdel]').forEach(b => b.onclick = async () => {
        if (!confirm(`Delete "${b.dataset.mgname}"?`)) return;
        const { error } = await db.from('member_gadgets').delete().eq('id', b.dataset.mgdel);
        if (error) { alert(error.message); return; }
        SCREENS.gadgets(el);
      });
    }

  } catch (err) {
    el.innerHTML = `<div class="card"><p class="error">${esc(err.message)}</p></div>`;
  }
};

async function openGadgetForm(existing) {
  const isEdit = !!existing;
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="max-width:560px">
      <h2>${isEdit ? 'Edit Gadget' : 'Add Gadget'}</h2>
      <form id="gf-form" autocomplete="off">
        <div class="form-row">
          <div><label>Name *</label><input id="gf-name" type="text" required value="${esc(existing?.name||'')}"></div>
          <div><label>Category</label><input id="gf-category" type="text" placeholder="Camera, Lens, Light, Audio…" value="${esc(existing?.category||'')}"></div>
        </div>
        <div class="form-row">
          <div><label>Brand</label><input id="gf-brand" type="text" value="${esc(existing?.brand||'')}"></div>
          <div><label>Model</label><input id="gf-model" type="text" value="${esc(existing?.model||'')}"></div>
        </div>
        <div class="form-row">
          <div><label>Serial No.</label><input id="gf-serial" type="text" value="${esc(existing?.serial_no||'')}"></div>
          <div><label>Condition</label><input id="gf-cond" type="text" placeholder="Excellent / Good / Fair" value="${esc(existing?.condition||'')}"></div>
        </div>
        <div class="form-row form-row-3">
          <div><label>Purchase Date</label><input id="gf-pdate" type="date" value="${existing?.purchase_date||''}"></div>
          <div><label>Purchase Price</label><input id="gf-pprice" type="number" min="0" step="0.01" value="${existing?.purchase_price||''}"></div>
          <div><label>Current Value</label><input id="gf-cvalue" type="number" min="0" step="0.01" value="${existing?.current_value||''}"></div>
        </div>
        <label>Status</label>
        <select id="gf-status">
          ${['in_store','out_on_project','maintenance','lost'].map(s =>
            `<option value="${s}" ${existing?.status===s?'selected':''}>${s.replace(/_/g,' ')}</option>`).join('')}
        </select>
        <label>Notes</label>
        <textarea id="gf-notes">${esc(existing?.notes||'')}</textarea>
        <p id="gf-error" class="error"></p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="gf-cancel">Cancel</button>
          <button type="submit" id="gf-save">${isEdit?'Save Changes':'Add Gadget'}</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(bd);
  document.getElementById('gf-cancel').onclick = () => bd.remove();
  bd.addEventListener('click', e => { if (e.target === bd) bd.remove(); });

  document.getElementById('gf-form').onsubmit = async e => {
    e.preventDefault();
    const errBox = document.getElementById('gf-error');
    const saveBtn = document.getElementById('gf-save');
    errBox.textContent = '';
    const payload = {
      name:        document.getElementById('gf-name').value.trim(),
      category:    document.getElementById('gf-category').value.trim() || null,
      brand:       document.getElementById('gf-brand').value.trim() || null,
      model:       document.getElementById('gf-model').value.trim() || null,
      serial_no:   document.getElementById('gf-serial').value.trim() || null,
      condition:   document.getElementById('gf-cond').value.trim() || null,
      purchase_date: document.getElementById('gf-pdate').value || null,
      purchase_price: document.getElementById('gf-pprice').value ? Number(document.getElementById('gf-pprice').value) : null,
      current_value:  document.getElementById('gf-cvalue').value ? Number(document.getElementById('gf-cvalue').value) : null,
      status:      document.getElementById('gf-status').value,
      notes:       document.getElementById('gf-notes').value.trim() || null,
    };
    if (!payload.name) { errBox.textContent = 'Name required'; return; }
    saveBtn.disabled = true;
    try {
      if (isEdit) {
        const { error } = await db.from('gadgets').update(payload).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await db.from('gadgets').insert(payload);
        if (error) throw error;
      }
      bd.remove();
      SCREENS.gadgets(document.getElementById('screen-gadgets'));
    } catch (err) {
      errBox.textContent = err.message;
      saveBtn.disabled = false;
    }
  };
}

function openMemberGadgetForm(existing, members) {
  const isEdit = !!existing;
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="max-width:480px">
      <h2>${isEdit?'Edit Member Item':'Add Member Item'}</h2>
      <form id="mgf-form" autocomplete="off">
        <label>Owner *</label>
        <select id="mgf-owner" required>
          ${members.map(m => `<option value="${m.id}" ${existing?.team_member_id===m.id?'selected':''}>${esc(m.name)}</option>`).join('')}
        </select>
        <label>Item Name *</label>
        <input id="mgf-name" type="text" required value="${esc(existing?.name||'')}">
        <div class="form-row">
          <div><label>Category</label><input id="mgf-cat" type="text" value="${esc(existing?.category||'')}"></div>
          <div><label>Est. Value</label><input id="mgf-val" type="number" min="0" step="0.01" value="${existing?.estimated_value||''}"></div>
        </div>
        <label>Condition</label>
        <input id="mgf-cond" type="text" value="${esc(existing?.condition||'')}">
        <label>Notes</label>
        <textarea id="mgf-notes">${esc(existing?.notes||'')}</textarea>
        <p id="mgf-error" class="error"></p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="mgf-cancel">Cancel</button>
          <button type="submit" id="mgf-save">${isEdit?'Save Changes':'Add Item'}</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(bd);
  document.getElementById('mgf-cancel').onclick = () => bd.remove();
  bd.addEventListener('click', e => { if (e.target === bd) bd.remove(); });

  document.getElementById('mgf-form').onsubmit = async e => {
    e.preventDefault();
    const errBox = document.getElementById('mgf-error');
    const saveBtn = document.getElementById('mgf-save');
    errBox.textContent = '';
    const payload = {
      team_member_id: document.getElementById('mgf-owner').value,
      name:           document.getElementById('mgf-name').value.trim(),
      category:       document.getElementById('mgf-cat').value.trim() || null,
      estimated_value: document.getElementById('mgf-val').value ? Number(document.getElementById('mgf-val').value) : null,
      condition:      document.getElementById('mgf-cond').value.trim() || null,
      notes:          document.getElementById('mgf-notes').value.trim() || null,
    };
    if (!payload.name) { errBox.textContent = 'Name required'; return; }
    saveBtn.disabled = true;
    try {
      if (isEdit) {
        const { error } = await db.from('member_gadgets').update(payload).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await db.from('member_gadgets').insert(payload);
        if (error) throw error;
      }
      bd.remove();
      SCREENS.gadgets(document.getElementById('screen-gadgets'));
    } catch (err) {
      errBox.textContent = err.message;
      saveBtn.disabled = false;
    }
  };
}

// ============ INVOICES + PAYMENTS ============
let INVOICES_TAB = 'invoices';

SCREENS.invoices = async function(el) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const [iRes, pRes, prjRes, pmRes] = await Promise.all([
      db.from('invoices')
        .select('*, project:projects(name, client:clients(name))')
        .order('created_at', { ascending: false }),
      db.from('payments')
        .select('*, project:projects(name), member:team_members(name)')
        .order('date', { ascending: false }).limit(200),
      db.from('projects').select('id,name,confirmed_amount,client:clients(name)').order('start_date', {ascending:false}),
      db.from('payment_methods').select('name').eq('active', true).order('name'),
    ]);
    if (iRes.error) throw iRes.error;

    const invoices = iRes.data || [];
    const payments = pRes.data || [];
    const projects = prjRes.data || [];
    const methods  = (pmRes.data || []).map(m => m.name);

    const invTotal = invoices.reduce((s, i) => s + Number(i.total || 0), 0);
    const paidTotal = invoices.filter(i => i.status === 'paid').reduce((s,i) => s + Number(i.total||0), 0);
    const paidSum = payments.filter(p=>p.direction==='in').reduce((s,p)=>s+Number(p.amount),0);
    const outSum  = payments.filter(p=>p.direction==='out').reduce((s,p)=>s+Number(p.amount),0);

    el.innerHTML = `
      <div class="tabs" style="margin-bottom:16px">
        <button class="${INVOICES_TAB==='invoices'?'active':''}" data-tab="invoices">Invoices (${invoices.length})</button>
        <button class="${INVOICES_TAB==='payments'?'active':''}" data-tab="payments">Payments (${payments.length})</button>
      </div>
      <div id="inv-panel"></div>
    `;
    el.querySelectorAll('.tabs button').forEach(b => {
      b.onclick = () => { INVOICES_TAB = b.dataset.tab; SCREENS.invoices(el); };
    });

    const panel = document.getElementById('inv-panel');

    if (INVOICES_TAB === 'invoices') {
      panel.innerHTML = `
        <div class="stat-grid">
          <div class="stat"><div class="label">Total Invoiced</div><div class="value">${fmtMoney(invTotal)}</div></div>
          <div class="stat"><div class="label">Paid Invoices</div><div class="value pos">${fmtMoney(paidTotal)}</div></div>
          <div class="stat"><div class="label">Total Received</div><div class="value pos">${fmtMoney(paidSum)}</div></div>
          <div class="stat"><div class="label">Total Paid Out</div><div class="value neg">${fmtMoney(outSum)}</div></div>
        </div>
        <div class="card">
          <div class="card-header">
            <h2>Invoices</h2>
            <div class="btn-group">
              <button id="inv-new">+ New Invoice</button>
              <button id="pay-new" class="btn-secondary">+ Record Payment</button>
            </div>
          </div>
          ${invoices.length ? `
            <div class="table-wrap"><table>
              <thead><tr>
                <th>No.</th><th>Project</th><th>Client</th><th class="num">Total</th>
                <th>Issue</th><th>Due</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>
                ${invoices.map(i => `<tr>
                  <td><strong>${esc(i.invoice_no)}</strong></td>
                  <td>${esc(i.project?.name || '—')}</td>
                  <td>${esc(i.project?.client?.name || '—')}</td>
                  <td class="num">${fmtMoney(i.total)}</td>
                  <td class="small">${fmtDate(i.issue_date)}</td>
                  <td class="small">${fmtDate(i.due_date)}</td>
                  <td><span class="${badgeClass(i.status)}">${i.status}</span></td>
                  <td class="actions">
                    <button class="btn-secondary btn-sm" data-iprint="${i.id}">Print</button>
                    ${i.status !== 'paid' ? `<button class="btn-success btn-sm" data-ipaid="${i.id}">Mark Paid</button>` : ''}
                    <button class="btn-danger btn-sm" data-idel="${i.id}" data-ino="${esc(i.invoice_no)}">Delete</button>
                  </td>
                </tr>`).join('')}
              </tbody>
            </table></div>
          ` : '<p class="empty">No invoices yet.</p>'}
        </div>`;

      document.getElementById('inv-new').onclick = () => openInvoiceForm(projects, methods);
      document.getElementById('pay-new').onclick = () => openPaymentForm(projects, methods, null);
      panel.querySelectorAll('[data-iprint]').forEach(b => b.onclick = async () => {
        const inv = invoices.find(x => x.id === b.dataset.iprint);
        if (inv) await printInvoice(inv);
      });
      panel.querySelectorAll('[data-ipaid]').forEach(b => b.onclick = async () => {
        const { error } = await db.from('invoices').update({ status: 'paid' }).eq('id', b.dataset.ipaid);
        if (error) { alert(error.message); return; }
        SCREENS.invoices(el);
      });
      panel.querySelectorAll('[data-idel]').forEach(b => b.onclick = async () => {
        if (!confirm(`Delete invoice ${b.dataset.ino}?`)) return;
        const { error } = await db.from('invoices').delete().eq('id', b.dataset.idel);
        if (error) { alert(error.message); return; }
        SCREENS.invoices(el);
      });

    } else {
      panel.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h2>Payment Ledger</h2>
            <button id="pay-new2">+ Record Payment</button>
          </div>
          ${payments.length ? `
            <div class="table-wrap"><table>
              <thead><tr>
                <th>Date</th><th>Project</th><th>Type</th><th>Method</th>
                <th>Member</th><th class="num">Amount</th><th></th>
              </tr></thead>
              <tbody>
                ${payments.map(p => `<tr>
                  <td class="small">${fmtDate(p.date)}</td>
                  <td>${esc(p.project?.name || '—')}</td>
                  <td><span class="badge badge-${p.direction==='in'?'signed':'cancelled'}">${p.direction==='in'?'IN':'OUT'}</span> ${esc(p.type.replace(/_/g,' '))}</td>
                  <td class="small">${esc(p.method || '—')}</td>
                  <td class="small">${esc(p.member?.name || '—')}</td>
                  <td class="num">${p.direction==='in'?'+':'−'} ${fmtMoney(p.amount)}</td>
                  <td class="actions"><button class="btn-danger btn-sm" data-pdel="${p.id}">Delete</button></td>
                </tr>`).join('')}
              </tbody>
            </table></div>
          ` : '<p class="empty">No payments recorded yet.</p>'}
        </div>`;

      document.getElementById('pay-new2').onclick = () => openPaymentForm(projects, methods, null);
      panel.querySelectorAll('[data-pdel]').forEach(b => b.onclick = async () => {
        if (!confirm('Delete this payment record?')) return;
        const { error } = await db.from('payments').delete().eq('id', b.dataset.pdel);
        if (error) { alert(error.message); return; }
        SCREENS.invoices(el);
      });
    }
  } catch (err) {
    el.innerHTML = `<div class="card"><p class="error">${esc(err.message)}</p></div>`;
  }
};

function openInvoiceForm(projects, methods) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="max-width:520px">
      <h2>New Invoice</h2>
      <form id="if-form" autocomplete="off">
        <label>Project *</label>
        <select id="if-project" required>
          <option value="">— select project —</option>
          ${projects.map(p => `<option value="${p.id}" data-amt="${p.confirmed_amount||0}">${esc(p.name)}${p.client?.name ? ' · ' + esc(p.client.name) : ''}</option>`).join('')}
        </select>
        <div class="form-row form-row-3">
          <div><label>Amount *</label><input id="if-amount" type="number" min="0" step="0.01" required></div>
          <div><label>Tax %</label><input id="if-tax" type="number" min="0" step="0.01" value="0"></div>
          <div><label>Total</label><div id="if-total" style="padding:10px 11px;background:#f3f4f6;border-radius:6px;font-weight:600">0</div></div>
        </div>
        <div class="form-row">
          <div><label>Issue Date</label><input id="if-issue" type="date" value="${todayISO()}"></div>
          <div><label>Due Date</label><input id="if-due" type="date"></div>
        </div>
        <label>Notes</label>
        <textarea id="if-notes" style="min-height:60px"></textarea>
        <p id="if-error" class="error"></p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="if-cancel">Cancel</button>
          <button type="submit" id="if-save">Create Invoice</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(bd);

  const amtEl = document.getElementById('if-amount');
  const taxEl = document.getElementById('if-tax');
  const totEl = document.getElementById('if-total');
  const recompute = () => {
    const a = Number(amtEl.value || 0);
    const t = Number(taxEl.value || 0);
    totEl.textContent = fmtMoney(a + (a * t / 100));
  };
  amtEl.oninput = recompute;
  taxEl.oninput = recompute;

  document.getElementById('if-project').onchange = e => {
    const amt = e.target.selectedOptions[0]?.dataset.amt;
    if (amt && !amtEl.value) { amtEl.value = amt; recompute(); }
  };

  document.getElementById('if-cancel').onclick = () => bd.remove();
  bd.addEventListener('click', e => { if (e.target === bd) bd.remove(); });

  document.getElementById('if-form').onsubmit = async e => {
    e.preventDefault();
    const errBox = document.getElementById('if-error');
    const saveBtn = document.getElementById('if-save');
    errBox.textContent = '';
    const amount = Number(amtEl.value || 0);
    const taxPct = Number(taxEl.value || 0);
    if (!amount) { errBox.textContent = 'Amount required'; return; }
    const tax = amount * taxPct / 100;
    const total = amount + tax;
    saveBtn.disabled = true;
    try {
      const { data: { user } } = await db.auth.getUser();
      const { error } = await db.from('invoices').insert({
        project_id: document.getElementById('if-project').value,
        amount, tax, total,
        issue_date: document.getElementById('if-issue').value,
        due_date:   document.getElementById('if-due').value || null,
        status: 'draft',
        notes: document.getElementById('if-notes').value.trim() || null,
      });
      if (error) throw error;
      bd.remove();
      SCREENS.invoices(document.getElementById('screen-invoices'));
    } catch (err) {
      errBox.textContent = err.message;
      saveBtn.disabled = false;
    }
  };
}

function openPaymentForm(projects, methods, prefilled) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  const payTypes = [
    { v:'client_advance',     d:'in',  l:'Client Advance' },
    { v:'client_final',       d:'in',  l:'Client Final Payment' },
    { v:'client_other',       d:'in',  l:'Client Other' },
    { v:'team_payout',        d:'out', l:'Team Payout' },
    { v:'expense_reimbursement', d:'out', l:'Expense Reimbursement' },
    { v:'other',              d:'out', l:'Other Out' },
  ];
  bd.innerHTML = `
    <div class="modal" style="max-width:520px">
      <h2>Record Payment</h2>
      <form id="pf2-form" autocomplete="off">
        <div class="form-row">
          <div>
            <label>Project *</label>
            <select id="pf2-project" required>
              <option value="">— select —</option>
              ${projects.map(p => `<option value="${p.id}" ${prefilled?.project_id===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Type *</label>
            <select id="pf2-type" required>
              <optgroup label="Money In">
                ${payTypes.filter(t=>t.d==='in').map(t=>`<option value="${t.v}">${t.l}</option>`).join('')}
              </optgroup>
              <optgroup label="Money Out">
                ${payTypes.filter(t=>t.d==='out').map(t=>`<option value="${t.v}">${t.l}</option>`).join('')}
              </optgroup>
            </select>
          </div>
        </div>
        <div class="form-row form-row-3">
          <div><label>Amount *</label><input id="pf2-amount" type="number" min="0" step="0.01" required></div>
          <div><label>Method</label>
            <select id="pf2-method">
              <option value="">—</option>
              ${methods.map(m => `<option>${esc(m)}</option>`).join('')}
            </select>
          </div>
          <div><label>Date</label><input id="pf2-date" type="date" value="${todayISO()}"></div>
        </div>
        <label>Reference / Note</label>
        <input id="pf2-ref" type="text" placeholder="Txn ID, cheque no, etc.">
        <p id="pf2-error" class="error"></p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="pf2-cancel">Cancel</button>
          <button type="submit" id="pf2-save">Save Payment</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(bd);
  document.getElementById('pf2-cancel').onclick = () => bd.remove();
  bd.addEventListener('click', e => { if (e.target === bd) bd.remove(); });

  document.getElementById('pf2-form').onsubmit = async e => {
    e.preventDefault();
    const errBox = document.getElementById('pf2-error');
    const saveBtn = document.getElementById('pf2-save');
    errBox.textContent = '';
    const amount = Number(document.getElementById('pf2-amount').value || 0);
    if (!amount) { errBox.textContent = 'Amount required'; return; }
    const type = document.getElementById('pf2-type').value;
    const direction = payTypes.find(t => t.v === type)?.d || 'in';
    saveBtn.disabled = true;
    try {
      const { data: { user } } = await db.auth.getUser();
      const { error } = await db.from('payments').insert({
        project_id: document.getElementById('pf2-project').value,
        direction, type, amount,
        method:    document.getElementById('pf2-method').value || null,
        date:      document.getElementById('pf2-date').value,
        reference: document.getElementById('pf2-ref').value.trim() || null,
        created_by: user.id,
      });
      if (error) throw error;
      bd.remove();
      SCREENS.invoices(document.getElementById('screen-invoices'));
    } catch (err) {
      errBox.textContent = err.message;
      saveBtn.disabled = false;
    }
  };
}

async function printInvoice(inv) {
  const [studioRes, fullInv] = await Promise.all([
    db.from('studio').select('*').single(),
    db.from('invoices').select('*, project:projects(name, venue_name, confirmed_amount, client:clients(name, phone, email, address))').eq('id', inv.id).single(),
  ]);
  const studio = studioRes.data || {};
  const full = fullInv.data || inv;
  const client = full.project?.client || {};

  const taxAmt = Number(full.tax || 0);
  const total  = Number(full.total || 0);
  const amount = Number(full.amount || 0);

  const w = window.open('', '_blank');
  w.document.write(`
    <!DOCTYPE html><html><head><title>${esc(full.invoice_no)}</title>
    <style>
      body { font-family: Georgia, 'Times New Roman', serif; color: #222; max-width: 210mm; margin: 0 auto; padding: 20mm; font-size: 13px; line-height: 1.6; }
      h1 { font-size: 40px; color: #888; font-weight: 900; letter-spacing: 2px; margin: 0; }
      .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #333; padding-bottom:20px; margin-bottom:30px; }
      .studio-name { font-size: 22px; font-weight: bold; margin-bottom: 6px; }
      .grid { display:flex; justify-content:space-between; margin-bottom:30px; gap:40px; }
      .col { flex:1; }
      .label { font-size: 10px; text-transform: uppercase; color: #888; letter-spacing: 1px; margin-bottom: 4px; }
      table { width:100%; border-collapse:collapse; margin-bottom:30px; }
      th { background:#f5f5f5; padding:12px; text-align:left; border-bottom:1px solid #ddd; }
      td { padding:12px; border-bottom:1px solid #f0f0f0; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      tfoot td { border-top: 2px solid #333; font-weight: bold; font-size: 15px; }
      .footer { margin-top:40px; padding-top:20px; border-top:1px solid #ddd; font-size: 11px; color: #666; }
      .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 140px; color: rgba(0,0,0,.04); font-weight: 900; white-space: nowrap; pointer-events: none; z-index: -1; font-family: system-ui, sans-serif; }
      @media print { @page { margin: 0; size: A4; } }
    </style></head>
    <body>
      <div class="watermark">${esc(studio.name)}</div>
      <div class="header">
        <div>
          <div class="studio-name">${esc(studio.name)}</div>
          <div>${esc(studio.address || '')}</div>
          <div>${esc(studio.phone || '')}${studio.email ? ' · ' + esc(studio.email) : ''}</div>
        </div>
        <div style="text-align:right">
          <h1>INVOICE</h1>
          <div><strong>#${esc(full.invoice_no)}</strong></div>
          <div style="margin-top:8px">Date: ${fmtDate(full.issue_date)}</div>
          ${full.due_date ? `<div>Due: ${fmtDate(full.due_date)}</div>` : ''}
        </div>
      </div>

      <div class="grid">
        <div class="col">
          <div class="label">Bill To</div>
          <div><strong>${esc(client.name || '—')}</strong></div>
          ${client.address ? `<div>${esc(client.address)}</div>` : ''}
          ${client.phone ? `<div>${esc(client.phone)}</div>` : ''}
          ${client.email ? `<div>${esc(client.email)}</div>` : ''}
        </div>
        <div class="col" style="text-align:right">
          <div class="label">For Project</div>
          <div><strong>${esc(full.project?.name || '—')}</strong></div>
          ${full.project?.venue_name ? `<div>${esc(full.project.venue_name)}</div>` : ''}
        </div>
      </div>

      <table>
        <thead><tr><th>Description</th><th class="num">Amount</th></tr></thead>
        <tbody>
          <tr>
            <td>Photography Services — ${esc(full.project?.name || 'Project')}</td>
            <td class="num">${fmtMoney(amount)}</td>
          </tr>
          ${taxAmt ? `<tr><td>Tax</td><td class="num">${fmtMoney(taxAmt)}</td></tr>` : ''}
        </tbody>
        <tfoot>
          <tr><td>Total Due</td><td class="num">${fmtMoney(total)}</td></tr>
        </tfoot>
      </table>

      ${studio.bank_details ? `<div class="footer"><strong>Payment Details</strong><div>${esc(studio.bank_details)}</div></div>` : ''}
      ${studio.invoice_payment_terms ? `<div class="footer"><strong>Terms</strong><div>${esc(studio.invoice_payment_terms)}</div></div>` : ''}
      ${full.notes ? `<div class="footer"><strong>Notes</strong><div>${esc(full.notes)}</div></div>` : ''}
    </body></html>
  `);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 500);
}

// =====================================================================
// BLOCK 6B — Reports + Studio Value + Profile
// =====================================================================

// ============ REPORTS ============
let REPORTS_TAB = 'profitability';

SCREENS.reports = async function(el) {
  el.innerHTML = '<div class="loading">Loading reports…</div>';
  try {
    const [prjRes, pmRes, exRes, payRes] = await Promise.all([
      db.from('projects').select('id,name,status,confirmed_amount,start_date,client:clients(name)').order('start_date', {ascending:false}),
      db.from('project_members').select('project_id,team_member_id,pay_amount,status,team_member:team_members(name)'),
      db.from('expenses').select('project_id,amount'),
      db.from('payments').select('project_id,direction,amount,member_id,date'),
    ]);
    if (prjRes.error) throw prjRes.error;

    const projects   = prjRes.data || [];
    const members    = pmRes.data || [];
    const expenses   = exRes.data || [];
    const payments   = payRes.data || [];

    el.innerHTML = `
      <div class="tabs" style="margin-bottom:16px">
        <button class="${REPORTS_TAB==='profitability'?'active':''}" data-tab="profitability">Profitability</button>
        <button class="${REPORTS_TAB==='receivables'?'active':''}"   data-tab="receivables">Receivables</button>
        <button class="${REPORTS_TAB==='payouts'?'active':''}"       data-tab="payouts">Team Payouts</button>
      </div>
      <div id="reports-panel"></div>
    `;
    el.querySelectorAll('.tabs button').forEach(b => {
      b.onclick = () => { REPORTS_TAB = b.dataset.tab; SCREENS.reports(el); };
    });

    const panel = document.getElementById('reports-panel');

    // ---- PROFITABILITY ----
    if (REPORTS_TAB === 'profitability') {
      const memberPayBy = {};
      members.forEach(m => {
        if (m.status !== 'cancelled')
          memberPayBy[m.project_id] = (memberPayBy[m.project_id] || 0) + Number(m.pay_amount || 0);
      });
      const expBy = {};
      expenses.forEach(e => expBy[e.project_id] = (expBy[e.project_id] || 0) + Number(e.amount || 0));
      const receivedBy = {};
      payments.filter(p => p.direction === 'in').forEach(p => {
        receivedBy[p.project_id] = (receivedBy[p.project_id] || 0) + Number(p.amount || 0);
      });

      const rows = projects.map(p => {
        const mp  = memberPayBy[p.id] || 0;
        const ex  = expBy[p.id] || 0;
        const rev = Number(p.confirmed_amount || 0);
        const profit = rev - mp - ex;
        const margin = rev > 0 ? (profit / rev * 100) : 0;
        return { ...p, mp, ex, rev, profit, margin };
      }).sort((a,b) => b.profit - a.profit);

      const totals = rows.reduce((s, r) => ({
        rev: s.rev + r.rev, mp: s.mp + r.mp, ex: s.ex + r.ex, profit: s.profit + r.profit,
      }), { rev:0, mp:0, ex:0, profit:0 });

      panel.innerHTML = `
        <div class="stat-grid">
          <div class="stat"><div class="label">Revenue</div><div class="value">${fmtMoney(totals.rev)}</div></div>
          <div class="stat"><div class="label">Member Pay</div><div class="value">${fmtMoney(totals.mp)}</div></div>
          <div class="stat"><div class="label">Expenses</div><div class="value">${fmtMoney(totals.ex)}</div></div>
          <div class="stat"><div class="label">Gross Profit</div><div class="value ${totals.profit>=0?'pos':'neg'}">${fmtMoney(totals.profit)}</div></div>
        </div>
        <div class="card">
          <h2>Project Profitability</h2>
          ${rows.length ? `
            <div class="table-wrap"><table>
              <thead><tr>
                <th>Project</th><th>Client</th><th class="num">Revenue</th>
                <th class="num">Member Pay</th><th class="num">Expenses</th>
                <th class="num">Profit</th><th class="num">Margin</th>
              </tr></thead>
              <tbody>
                ${rows.map(r => `<tr>
                  <td><a href="#project/${r.id}">${esc(r.name)}</a></td>
                  <td>${esc(r.client?.name || '—')}</td>
                  <td class="num">${fmtMoney(r.rev)}</td>
                  <td class="num">${fmtMoney(r.mp)}</td>
                  <td class="num">${fmtMoney(r.ex)}</td>
                  <td class="num" style="color:${r.profit>=0?'#059669':'#dc2626'};font-weight:600">${fmtMoney(r.profit)}</td>
                  <td class="num">${r.margin.toFixed(0)}%</td>
                </tr>`).join('')}
              </tbody>
            </table></div>
          ` : '<p class="empty">No projects yet.</p>'}
        </div>`;
    }

    // ---- RECEIVABLES ----
    else if (REPORTS_TAB === 'receivables') {
      const receivedBy = {};
      payments.filter(p => p.direction === 'in').forEach(p => {
        receivedBy[p.project_id] = (receivedBy[p.project_id] || 0) + Number(p.amount || 0);
      });
      const today = new Date();
      const rows = projects.map(p => {
        const rec = Number(p.confirmed_amount || 0);
        const paid = receivedBy[p.id] || 0;
        const out = Math.max(0, rec - paid);
        let ageDays = 0;
        if (p.start_date && out > 0) {
          ageDays = Math.floor((today - new Date(p.start_date)) / 86400000);
        }
        return { ...p, paid, out, ageDays };
      }).filter(r => r.out > 0).sort((a,b) => b.out - a.out);

      const totalOut = rows.reduce((s, r) => s + r.out, 0);
      const bucket = (lo, hi) => rows.filter(r => r.ageDays >= lo && r.ageDays < hi).reduce((s,r)=>s+r.out,0);

      panel.innerHTML = `
        <div class="stat-grid">
          <div class="stat"><div class="label">Total Outstanding</div><div class="value neg">${fmtMoney(totalOut)}</div></div>
          <div class="stat"><div class="label">Current (&lt;30d)</div><div class="value">${fmtMoney(bucket(0,30))}</div></div>
          <div class="stat"><div class="label">30–60 days</div><div class="value">${fmtMoney(bucket(30,60))}</div></div>
          <div class="stat"><div class="label">60+ days</div><div class="value neg">${fmtMoney(bucket(60,99999))}</div></div>
        </div>
        <div class="card">
          <h2>Outstanding by Project</h2>
          ${rows.length ? `
            <div class="table-wrap"><table>
              <thead><tr>
                <th>Project</th><th>Client</th><th>Date</th>
                <th class="num">Confirmed</th><th class="num">Received</th>
                <th class="num">Outstanding</th><th class="num">Age</th>
              </tr></thead>
              <tbody>
                ${rows.map(r => `<tr>
                  <td><a href="#project/${r.id}">${esc(r.name)}</a></td>
                  <td>${esc(r.client?.name || '—')}</td>
                  <td class="small">${fmtDate(r.start_date)}</td>
                  <td class="num">${fmtMoney(r.rev || r.confirmed_amount)}</td>
                  <td class="num">${fmtMoney(r.paid)}</td>
                  <td class="num" style="color:#dc2626;font-weight:600">${fmtMoney(r.out)}</td>
                  <td class="num small">${r.ageDays}d</td>
                </tr>`).join('')}
              </tbody>
            </table></div>
          ` : '<p class="empty">Nothing outstanding. 🎉</p>'}
        </div>`;
    }

    // ---- TEAM PAYOUTS ----
    else {
      const byMember = {};
      members.forEach(m => {
        if (m.status === 'cancelled') return;
        const id = m.team_member_id;
        if (!byMember[id]) byMember[id] = { name: m.team_member?.name || '—', projects: 0, total: 0, paid: 0 };
        byMember[id].projects += 1;
        byMember[id].total    += Number(m.pay_amount || 0);
      });
      payments.filter(p => p.direction === 'out' && p.type === 'team_payout' && p.member_id)
        .forEach(p => {
          if (byMember[p.member_id]) byMember[p.member_id].paid += Number(p.amount || 0);
        });

      const rows = Object.values(byMember).sort((a,b) => (b.total - b.paid) - (a.total - a.paid));
      const totals = rows.reduce((s, r) => ({
        total: s.total + r.total, paid: s.paid + r.paid,
      }), { total:0, paid:0 });

      panel.innerHTML = `
        <div class="stat-grid">
          <div class="stat"><div class="label">Total Owed</div><div class="value">${fmtMoney(totals.total)}</div></div>
          <div class="stat"><div class="label">Total Paid</div><div class="value pos">${fmtMoney(totals.paid)}</div></div>
          <div class="stat"><div class="label">Balance Due</div><div class="value ${(totals.total-totals.paid)>0?'neg':'pos'}">${fmtMoney(totals.total - totals.paid)}</div></div>
        </div>
        <div class="card">
          <h2>Payout per Member</h2>
          ${rows.length ? `
            <div class="table-wrap"><table>
              <thead><tr>
                <th>Member</th><th class="num">Projects</th>
                <th class="num">Owed</th><th class="num">Paid</th>
                <th class="num">Balance</th>
              </tr></thead>
              <tbody>
                ${rows.map(r => {
                  const bal = r.total - r.paid;
                  return `<tr>
                    <td><strong>${esc(r.name)}</strong></td>
                    <td class="num">${r.projects}</td>
                    <td class="num">${fmtMoney(r.total)}</td>
                    <td class="num">${fmtMoney(r.paid)}</td>
                    <td class="num" style="color:${bal>0?'#dc2626':'#059669'};font-weight:600">${fmtMoney(bal)}</td>
                  </tr>`;
                }).join('')}
              </tbody>
              <tfoot><tr>
                <th colspan="2" class="right">Totals</th>
                <th class="num">${fmtMoney(totals.total)}</th>
                <th class="num">${fmtMoney(totals.paid)}</th>
                <th class="num">${fmtMoney(totals.total - totals.paid)}</th>
              </tr></tfoot>
            </table></div>
          ` : '<p class="empty">No member assignments yet.</p>'}
        </div>
        <p class="muted small">Record team payouts in <a href="#invoices">Invoices → Payments</a> tab with type "Team Payout" and pick the member.</p>`;
    }

  } catch (err) {
    el.innerHTML = `<div class="card"><p class="error">${esc(err.message)}</p></div>`;
  }
};

// ============ STUDIO VALUE ============
SCREENS['studio-value'] = async function(el) {
  el.innerHTML = '<div class="loading">Calculating studio value…</div>';
  try {
    const [gRes, prjRes, payRes, exRes, pmRes] = await Promise.all([
      db.from('gadgets').select('current_value,purchase_price,status'),
      db.from('projects').select('id,status,confirmed_amount'),
      db.from('payments').select('project_id,direction,amount'),
      db.from('expenses').select('project_id,amount'),
      db.from('project_members').select('project_id,pay_amount,status'),
    ]);

    const gadgets = gRes.data || [];
    const proj    = prjRes.data || [];
    const pays    = payRes.data || [];
    const exps    = exRes.data || [];
    const pms     = pmRes.data || [];

    const equipmentValue = gadgets.reduce((s, g) =>
      s + Number(g.current_value || g.purchase_price || 0), 0);

    // Receivable = confirmed across completed/live/scheduled - received
    const receivedBy = {};
    pays.filter(p => p.direction === 'in').forEach(p => {
      receivedBy[p.project_id] = (receivedBy[p.project_id] || 0) + Number(p.amount || 0);
    });
    let receivable = 0;
    proj.forEach(p => {
      const paid = receivedBy[p.id] || 0;
      receivable += Math.max(0, Number(p.confirmed_amount || 0) - paid);
    });

    // Pipeline = scheduled + live projects' confirmed amount
    const pipelineValue = proj
      .filter(p => p.status === 'scheduled' || p.status === 'live')
      .reduce((s, p) => s + Number(p.confirmed_amount || 0), 0);

    // Lifetime revenue/profit from completed projects
    const completedIds = new Set(proj.filter(p => p.status === 'completed').map(p => p.id));
    const memberPayBy = {};
    pms.forEach(m => {
      if (m.status !== 'cancelled' && completedIds.has(m.project_id))
        memberPayBy[m.project_id] = (memberPayBy[m.project_id] || 0) + Number(m.pay_amount || 0);
    });
    const expBy = {};
    exps.forEach(e => {
      if (completedIds.has(e.project_id))
        expBy[e.project_id] = (expBy[e.project_id] || 0) + Number(e.amount || 0);
    });

    let lifetimeRevenue = 0, lifetimeProfit = 0;
    proj.filter(p => completedIds.has(p.id)).forEach(p => {
      const rev    = Number(p.confirmed_amount || 0);
      const mp     = memberPayBy[p.id] || 0;
      const ex     = expBy[p.id] || 0;
      lifetimeRevenue += rev;
      lifetimeProfit  += rev - mp - ex;
    });

    const totalStudioValue = equipmentValue + receivable + pipelineValue;

    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat">
          <div class="label">Equipment</div>
          <div class="value">${fmtMoney(equipmentValue)}</div>
          <div class="muted small">${gadgets.length} items</div>
        </div>
        <div class="stat">
          <div class="label">Receivable</div>
          <div class="value ${receivable>0?'neg':''}">${fmtMoney(receivable)}</div>
          <div class="muted small">across ${proj.length} projects</div>
        </div>
        <div class="stat">
          <div class="label">Pipeline</div>
          <div class="value pos">${fmtMoney(pipelineValue)}</div>
          <div class="muted small">scheduled + live</div>
        </div>
        <div class="stat">
          <div class="label">Lifetime Revenue</div>
          <div class="value">${fmtMoney(lifetimeRevenue)}</div>
          <div class="muted small">${completedIds.size} completed</div>
        </div>
      </div>

      <div class="card" style="background:linear-gradient(135deg,#1f2937,#374151);color:#fff">
        <div style="text-align:center;padding:20px 0">
          <div style="font-size:14px;opacity:.7;text-transform:uppercase;letter-spacing:2px">Total Studio Value</div>
          <div style="font-size:42px;font-weight:700;margin-top:8px">${fmtMoney(totalStudioValue)}</div>
          <div style="font-size:12px;opacity:.6;margin-top:6px">Equipment + Receivable + Pipeline</div>
        </div>
      </div>

      <div class="card">
        <h2>Lifetime Performance</h2>
        <table>
          <tr><th style="width:200px">Revenue (completed)</th><td class="num">${fmtMoney(lifetimeRevenue)}</td></tr>
          <tr><th>Gross Profit (completed)</th><td class="num" style="color:${lifetimeProfit>=0?'#059669':'#dc2626'};font-weight:600">${fmtMoney(lifetimeProfit)}</td></tr>
          <tr><th>Margin</th><td class="num">${lifetimeRevenue>0?(lifetimeProfit/lifetimeRevenue*100).toFixed(1):'0.0'}%</td></tr>
        </table>
      </div>

      <p class="muted small">Equipment = sum of gadget current values. Receivable = confirmed − received per project. Pipeline = confirmed amount of scheduled + live projects. Keep your gadget values and project amounts updated for accurate numbers.</p>
    `;
  } catch (err) {
    el.innerHTML = `<div class="card"><p class="error">${esc(err.message)}</p></div>`;
  }
};

// ============ PROFILE ============
SCREENS.profile = async function(el) {
  el.innerHTML = '<div class="loading">Loading profile…</div>';
  const isOwner = CURRENT_PROFILE.role === 'owner';
  try {
    if (!isOwner) {
      // Member profile — read-only summary
      const tmId = CURRENT_PROFILE.team_member_id;
      const { data: tm } = await db.from('team_members').select('*').eq('id', tmId).single();
      el.innerHTML = `
        <div class="card">
          <h2>My Profile</h2>
          <table>
            <tr><th style="width:160px">Name</th><td>${esc(tm?.name || CURRENT_PROFILE.name || '—')}</td></tr>
            <tr><th>Email</th><td>${esc(CURRENT_PROFILE.email || '—')}</td></tr>
            <tr><th>Phone</th><td>${esc(tm?.phone || '—')}</td></tr>
            <tr><th>Role</th><td>${esc(tm?.role || '—')}</td></tr>
            <tr><th>Address</th><td>${esc(tm?.address || '—')}</td></tr>
          </table>
          <p class="muted small mt-2">To update your details, contact the studio owner.</p>
        </div>`;
      return;
    }

    // Owner — editable studio profile
    const { data: studio, error } = await db.from('studio').select('*').single();
    if (error) throw error;

    el.innerHTML = `
      <div class="card">
        <h2>Studio Profile</h2>
        <p class="muted small mb-2">These details appear on invoices, agreements, and the header of the app.</p>
        <form id="pf3-form" autocomplete="off">
          <div class="form-row">
            <div><label>Studio Name *</label><input id="pf3-name" type="text" required value="${esc(studio.name || '')}"></div>
            <div><label>Owner Name</label><input id="pf3-owner" type="text" value="${esc(studio.owner_name || '')}"></div>
          </div>
          <div class="form-row">
            <div><label>Phone</label><input id="pf3-phone" type="tel" value="${esc(studio.phone || '')}"></div>
            <div><label>Email</label><input id="pf3-email" type="email" value="${esc(studio.email || '')}"></div>
          </div>
          <label>Address</label>
          <input id="pf3-address" type="text" value="${esc(studio.address || '')}">

          <div class="form-row form-row-3">
            <div><label>Currency</label><input id="pf3-currency" type="text" placeholder="BDT / INR / USD" value="${esc(studio.currency || '')}"></div>
            <div><label>Timezone</label><input id="pf3-tz" type="text" placeholder="Asia/Dhaka" value="${esc(studio.timezone || '')}"></div>
            <div></div>
          </div>

          <hr>
          <h3>Branding</h3>
          <p class="hint">Paste publicly accessible image URLs (Google Drive direct link, Imgur, or Supabase Storage URL). These appear on invoices and agreements.</p>
          <div class="form-row">
            <div><label>Logo URL</label><input id="pf3-logo" type="url" value="${esc(studio.logo_url || '')}"></div>
            <div><label>Signature URL</label><input id="pf3-sign" type="url" value="${esc(studio.signature_url || '')}"></div>
          </div>
          <label>Stamp URL</label>
          <input id="pf3-stamp" type="url" value="${esc(studio.stamp_url || '')}">

          ${studio.logo_url || studio.signature_url || studio.stamp_url ? `
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px">
              ${studio.logo_url    ? `<div><div class="label">Logo</div><img src="${esc(studio.logo_url)}" style="max-height:70px;border:1px solid #e5e7eb;border-radius:6px;padding:4px;background:#fff"></div>` : ''}
              ${studio.signature_url ? `<div><div class="label">Signature</div><img src="${esc(studio.signature_url)}" style="max-height:70px;border:1px solid #e5e7eb;border-radius:6px;padding:4px;background:#fff"></div>` : ''}
              ${studio.stamp_url    ? `<div><div class="label">Stamp</div><img src="${esc(studio.stamp_url)}" style="max-height:70px;border:1px solid #e5e7eb;border-radius:6px;padding:4px;background:#fff"></div>` : ''}
            </div>
          ` : ''}

          <p id="pf3-error" class="error"></p>
          <button type="submit" id="pf3-save" class="mt-2">Save Profile</button>
        </form>
      </div>

      <div class="card">
        <h3>My Login</h3>
        <p class="small">Email: <strong>${esc(CURRENT_PROFILE.email || '—')}</strong></p>
        <p class="small">Name: <strong>${esc(CURRENT_PROFILE.name || '—')}</strong></p>
        <button class="btn-secondary btn-sm" id="pf3-logout">Logout</button>
      </div>
    `;

    document.getElementById('pf3-form').onsubmit = async e => {
      e.preventDefault();
      const errBox = document.getElementById('pf3-error');
      const saveBtn = document.getElementById('pf3-save');
      errBox.textContent = '';
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      const payload = {
        name:       document.getElementById('pf3-name').value.trim(),
        owner_name: document.getElementById('pf3-owner').value.trim() || null,
        phone:      document.getElementById('pf3-phone').value.trim() || null,
        email:      document.getElementById('pf3-email').value.trim() || null,
        address:    document.getElementById('pf3-address').value.trim() || null,
        currency:   document.getElementById('pf3-currency').value.trim() || 'BDT',
        timezone:   document.getElementById('pf3-tz').value.trim() || 'Asia/Dhaka',
        logo_url:      document.getElementById('pf3-logo').value.trim() || null,
        signature_url: document.getElementById('pf3-sign').value.trim() || null,
        stamp_url:     document.getElementById('pf3-stamp').value.trim() || null,
      };
      try {
        const { error } = await db.from('studio').update(payload)
          .eq('id', '00000000-0000-0000-0000-000000000001');
        if (error) throw error;
        // Update brand name in sidebar
        document.getElementById('brand-name').textContent = payload.name;
        alert('Profile saved.');
        SCREENS.profile(el);
      } catch (err) {
        errBox.textContent = err.message;
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Profile';
      }
    };

    document.getElementById('pf3-logout').onclick = logout;

  } catch (err) {
    el.innerHTML = `<div class="card"><p class="error">${esc(err.message)}</p></div>`;
  }
};

// Load studio name into sidebar brand on boot (called from bootApp later)
async function loadBrandName() {
  const { data } = await db.from('studio').select('name').single();
  if (data?.name) document.getElementById('brand-name').textContent = data.name;
}

// =====================================================================
// BLOCK 6C-1 — Settings screen (all tabs)
// =====================================================================

// Small reusable modal for add/edit of simple config items
function openSimpleModal({ title, fields, onSave, initial = {} }) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="max-width:420px">
      <h2>${esc(title)}</h2>
      <form id="sm-form" autocomplete="off">
        ${fields.map(f => {
          const val = initial[f.key] ?? f.default ?? '';
          if (f.type === 'select') {
            return `<label>${esc(f.label)}</label>
              <select id="sm-${f.key}">
                ${f.options.map(o => `<option value="${esc(o.value)}" ${val===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}
              </select>`;
          }
          if (f.type === 'textarea') {
            return `<label>${esc(f.label)}</label>
              <textarea id="sm-${f.key}" style="min-height:80px">${esc(val)}</textarea>`;
          }
          return `<label>${esc(f.label)}</label>
            <input id="sm-${f.key}" type="${f.type || 'text'}" value="${esc(val).replace(/"/g,'&quot;')}">`;
        }).join('')}
        <p id="sm-error" class="error"></p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="sm-cancel">Cancel</button>
          <button type="submit">Save</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(bd);
  document.getElementById('sm-cancel').onclick = () => bd.remove();
  bd.addEventListener('click', e => { if (e.target === bd) bd.remove(); });
  document.getElementById('sm-form').onsubmit = async e => {
    e.preventDefault();
    const errBox = document.getElementById('sm-error');
    errBox.textContent = '';
    try {
      const data = {};
      fields.forEach(f => { data[f.key] = document.getElementById('sm-' + f.key).value.trim(); });
      await onSave(data, bd);
    } catch (err) {
      errBox.textContent = err.message;
    }
  };
}

function renderDetails(details) {
  if (!details || typeof details !== 'object') return '';
  return Object.entries(details)
    .filter(([k, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
}

let SETTINGS_TAB = 'invoicing';

SCREENS.settings = async function(el) {
  el.innerHTML = '<div class="loading">Loading settings…</div>';
  try {
    el.innerHTML = `
      <div class="tabs" style="margin-bottom:16px;flex-wrap:wrap">
        <button class="${SETTINGS_TAB==='invoicing'?'active':''}" data-tab="invoicing">Invoicing</button>
        <button class="${SETTINGS_TAB==='agreements'?'active':''}" data-tab="agreements">Agreements</button>
        <button class="${SETTINGS_TAB==='roles'?'active':''}"      data-tab="roles">Roles</button>
        <button class="${SETTINGS_TAB==='types'?'active':''}"      data-tab="types">Project Types</button>
        <button class="${SETTINGS_TAB==='methods'?'active':''}"    data-tab="methods">Payment Methods</button>
        <button class="${SETTINGS_TAB==='templates'?'active':''}"  data-tab="templates">Messages</button>
        <button class="${SETTINGS_TAB==='activity'?'active':''}"   data-tab="activity">Activity</button>
      </div>
      <div id="settings-panel"></div>
    `;
    el.querySelectorAll('.tabs button').forEach(b => {
      b.onclick = () => { SETTINGS_TAB = b.dataset.tab; SCREENS.settings(el); };
    });

    const panel = document.getElementById('settings-panel');

    // ---------- INVOICING ----------
    if (SETTINGS_TAB === 'invoicing') {
      const { data: s } = await db.from('studio').select('*').single();
      panel.innerHTML = `
        <div class="card">
          <h2>Invoice Settings</h2>
          <form id="si-form" autocomplete="off">
            <div class="form-row">
              <div><label>Invoice Prefix</label><input id="si-prefix" type="text" value="${esc(s.invoice_prefix || 'INV')}"></div>
              <div><label>Next Invoice Number</label><input id="si-next" type="number" min="1" value="${s.invoice_next_number || 1}"></div>
            </div>
            <div class="form-row">
              <div><label>Default Tax %</label><input id="si-tax" type="number" min="0" step="0.01" value="${s.invoice_tax_percent || 0}"></div>
              <div></div>
            </div>
            <label>Payment Terms (shown on invoice)</label>
            <textarea id="si-terms" style="min-height:70px">${esc(s.invoice_payment_terms || '')}</textarea>

            <label>Bank / Payment Details (shown on invoice)</label>
            <textarea id="si-bank" style="min-height:70px">${esc(s.bank_details || '')}</textarea>

            <p id="si-error" class="error"></p>
            <button type="submit" id="si-save">Save Invoice Settings</button>
          </form>
        </div>`;

      document.getElementById('si-form').onsubmit = async e => {
        e.preventDefault();
        const errBox = document.getElementById('si-error');
        errBox.textContent = '';
        const payload = {
          invoice_prefix: document.getElementById('si-prefix').value.trim() || 'INV',
          invoice_next_number: Number(document.getElementById('si-next').value || 1),
          invoice_tax_percent: Number(document.getElementById('si-tax').value || 0),
          invoice_payment_terms: document.getElementById('si-terms').value.trim() || null,
          bank_details:          document.getElementById('si-bank').value.trim() || null,
        };
        const { error } = await db.from('studio').update(payload)
          .eq('id', '00000000-0000-0000-0000-000000000001');
        if (error) { errBox.textContent = error.message; return; }
        alert('Invoice settings saved.');
      };
    }

    // ---------- AGREEMENTS ----------
    else if (SETTINGS_TAB === 'agreements') {
      const { data: s } = await db.from('studio').select('*').single();
      panel.innerHTML = `
        <div class="card">
          <h2>Agreement Settings</h2>
          <form id="sa-form" autocomplete="off">
            <div class="form-row">
              <div><label>Agreement Prefix</label><input id="sa-prefix" type="text" value="${esc(s.agreement_prefix || 'AGR')}"></div>
              <div><label>Next Agreement Number</label><input id="sa-next" type="number" min="1" value="${s.agreement_next_number || 1}"></div>
            </div>
            <p class="hint">Agreements are named <code>PREFIX-YYYY-NNN</code> automatically.</p>
            <p id="sa-error" class="error"></p>
            <button type="submit" id="sa-save">Save Agreement Settings</button>
          </form>
        </div>
        <div class="card">
          <h3>Manage Agreement Templates</h3>
          <p class="muted small">Template editing is on the Agreements screen → Templates tab.</p>
          <button class="btn-secondary btn-sm" onclick="location.hash='#agreements'; setTimeout(()=>{AGREEMENTS_TAB='templates'; location.hash='#agreements';},50)">Open Templates →</button>
        </div>`;

      document.getElementById('sa-form').onsubmit = async e => {
        e.preventDefault();
        const errBox = document.getElementById('sa-error');
        errBox.textContent = '';
        const payload = {
          agreement_prefix: document.getElementById('sa-prefix').value.trim() || 'AGR',
          agreement_next_number: Number(document.getElementById('sa-next').value || 1),
        };
        const { error } = await db.from('studio').update(payload)
          .eq('id', '00000000-0000-0000-0000-000000000001');
        if (error) { errBox.textContent = error.message; return; }
        alert('Agreement settings saved.');
      };
    }

    // ---------- ROLES ----------
    else if (SETTINGS_TAB === 'roles') {
      const { data: roles } = await db.from('roles').select('*').order('sort_order');
      panel.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h2>Roles (${(roles || []).length})</h2>
            <button id="role-add">+ Add Role</button>
          </div>
          ${(roles || []).length ? `
            <table>
              <thead><tr><th>Name</th><th>Sort</th><th>Active</th><th></th></tr></thead>
              <tbody>
                ${roles.map(r => `<tr>
                  <td><strong>${esc(r.name)}</strong></td>
                  <td class="num">${r.sort_order}</td>
                  <td>${r.active ? '<span class="badge badge-signed">yes</span>' : '<span class="badge badge-cancelled">no</span>'}</td>
                  <td class="actions"><button class="btn-danger btn-sm" data-rdel="${r.id}" data-rname="${esc(r.name)}">Delete</button></td>
                </tr>`).join('')}
              </tbody>
            </table>
          ` : '<p class="empty">No roles.</p>'}
        </div>`;

      document.getElementById('role-add').onclick = () => {
        openSimpleModal({
          title: 'Add Role',
          fields: [{ key: 'name', label: 'Name', type: 'text' }],
          onSave: async (data, bd) => {
            if (!data.name) throw new Error('Name required');
            const { error } = await db.from('roles').insert({
              name: data.name, sort_order: (roles || []).length + 1,
            });
            if (error) throw error;
            bd.remove();
            SCREENS.settings(el);
          },
        });
      };

      panel.querySelectorAll('[data-rdel]').forEach(b => {
        b.onclick = async () => {
          if (!confirm(`Delete role "${b.dataset.rname}"?`)) return;
          const { error } = await db.from('roles').delete().eq('id', b.dataset.rdel);
          if (error) { alert(error.message); return; }
          SCREENS.settings(el);
        };
      });
    }

    // ---------- PROJECT TYPES ----------
    else if (SETTINGS_TAB === 'types') {
      const { data: types } = await db.from('project_types').select('*').order('name');
      panel.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h2>Project Types (${(types || []).length})</h2>
            <button id="type-add">+ Add Project Type</button>
          </div>
          ${(types || []).length ? `
            <table>
              <thead><tr><th>Name</th><th>Default</th><th></th></tr></thead>
              <tbody>
                ${types.map(t => `<tr>
                  <td><strong>${esc(t.name)}</strong></td>
                  <td>${t.is_default ? '<span class="badge badge-signed">default</span>' : ''}</td>
                  <td class="actions"><button class="btn-danger btn-sm" data-tdel="${t.id}" data-tname="${esc(t.name)}">Delete</button></td>
                </tr>`).join('')}
              </tbody>
            </table>
          ` : '<p class="empty">No project types.</p>'}
        </div>
        <p class="hint">Deleting a project type does not delete existing projects of that type — they just lose the association.</p>`;

      document.getElementById('type-add').onclick = () => {
        openSimpleModal({
          title: 'Add Project Type',
          fields: [{ key: 'name', label: 'Name', type: 'text' }],
          onSave: async (data, bd) => {
            if (!data.name) throw new Error('Name required');
            const { error } = await db.from('project_types').insert({ name: data.name });
            if (error) throw error;
            bd.remove();
            SCREENS.settings(el);
          },
        });
      };

      panel.querySelectorAll('[data-tdel]').forEach(b => {
        b.onclick = async () => {
          if (!confirm(`Delete project type "${b.dataset.tname}"?`)) return;
          const { error } = await db.from('project_types').delete().eq('id', b.dataset.tdel);
          if (error) { alert(error.message); return; }
          SCREENS.settings(el);
        };
      });
    }

    // ---------- PAYMENT METHODS ----------
    else if (SETTINGS_TAB === 'methods') {
      const { data: methods } = await db.from('payment_methods').select('*').order('name');
      panel.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h2>Payment Methods (${(methods || []).length})</h2>
            <button id="method-add">+ Add Method</button>
          </div>
          ${(methods || []).length ? `
            <table>
              <thead><tr><th>Name</th><th>Active</th><th></th></tr></thead>
              <tbody>
                ${methods.map(m => `<tr>
                  <td><strong>${esc(m.name)}</strong></td>
                  <td>${m.active ? '<span class="badge badge-signed">yes</span>' : '<span class="badge badge-cancelled">no</span>'}</td>
                  <td class="actions"><button class="btn-danger btn-sm" data-mdel="${m.id}" data-mname="${esc(m.name)}">Delete</button></td>
                </tr>`).join('')}
              </tbody>
            </table>
          ` : '<p class="empty">No payment methods.</p>'}
        </div>`;

      document.getElementById('method-add').onclick = () => {
        openSimpleModal({
          title: 'Add Payment Method',
          fields: [{ key: 'name', label: 'Name', type: 'text' }],
          onSave: async (data, bd) => {
            if (!data.name) throw new Error('Name required');
            const { error } = await db.from('payment_methods').insert({ name: data.name });
            if (error) throw error;
            bd.remove();
            SCREENS.settings(el);
          },
        });
      };

      panel.querySelectorAll('[data-mdel]').forEach(b => {
        b.onclick = async () => {
          if (!confirm(`Delete method "${b.dataset.mname}"?`)) return;
          const { error } = await db.from('payment_methods').delete().eq('id', b.dataset.mdel);
          if (error) { alert(error.message); return; }
          SCREENS.settings(el);
        };
      });
    }

    // ---------- MESSAGE TEMPLATES ----------
    else if (SETTINGS_TAB === 'templates') {
      const { data: tpls } = await db.from('message_templates').select('*').order('name');
      panel.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h2>Message Templates (${(tpls || []).length})</h2>
            <button id="msg-add">+ Add Template</button>
          </div>
          <p class="hint">Reusable WhatsApp / SMS / Email templates. Use these when sending payment reminders, shoot reminders, etc.</p>
          ${(tpls || []).length ? `
            <table>
              <thead><tr><th>Name</th><th>Channel</th><th>Subject</th><th></th></tr></thead>
              <tbody>
                ${tpls.map(t => `<tr>
                  <td><strong>${esc(t.name)}</strong></td>
                  <td><span class="badge badge-${t.channel==='whatsapp'?'signed':t.channel==='sms'?'scheduled':'generated'}">${esc(t.channel)}</span></td>
                  <td class="small">${esc(t.subject || '—')}</td>
                  <td class="actions">
                    <button class="btn-secondary btn-sm" data-medit="${t.id}">Edit</button>
                    <button class="btn-danger btn-sm"    data-mmsgdel="${t.id}" data-mtname="${esc(t.name)}">Delete</button>
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>
          ` : '<p class="empty">No templates yet.</p>'}
        </div>`;

      document.getElementById('msg-add').onclick = () => {
        openSimpleModal({
          title: 'New Message Template',
          fields: [
            { key: 'name',    label: 'Template Name', type: 'text' },
            { key: 'channel', label: 'Channel', type: 'select', options: [
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'sms',      label: 'SMS' },
              { value: 'email',    label: 'Email' },
            ]},
            { key: 'subject', label: 'Subject (email only)', type: 'text' },
            { key: 'body',    label: 'Body', type: 'textarea' },
          ],
          onSave: async (data, bd) => {
            if (!data.name || !data.body) throw new Error('Name and body required');
            const { error } = await db.from('message_templates').insert({
              name: data.name, channel: data.channel,
              subject: data.subject || null, body: data.body,
            });
            if (error) throw error;
            bd.remove();
            SCREENS.settings(el);
          },
        });
      };

      panel.querySelectorAll('[data-medit]').forEach(b => {
        b.onclick = async () => {
          const { data } = await db.from('message_templates').select('*').eq('id', b.dataset.medit).single();
          if (!data) return;
          openSimpleModal({
            title: 'Edit Template',
            initial: data,
            fields: [
              { key: 'name',    label: 'Template Name', type: 'text' },
              { key: 'channel', label: 'Channel', type: 'select', options: [
                { value: 'whatsapp', label: 'WhatsApp' },
                { value: 'sms',      label: 'SMS' },
                { value: 'email',    label: 'Email' },
              ]},
              { key: 'subject', label: 'Subject (email only)', type: 'text' },
              { key: 'body',    label: 'Body', type: 'textarea' },
            ],
            onSave: async (d, bd) => {
              if (!d.name || !d.body) throw new Error('Name and body required');
              const { error } = await db.from('message_templates').update({
                name: d.name, channel: d.channel,
                subject: d.subject || null, body: d.body,
              }).eq('id', data.id);
              if (error) throw error;
              bd.remove();
              SCREENS.settings(el);
            },
          });
        };
      });

      panel.querySelectorAll('[data-mmsgdel]').forEach(b => {
        b.onclick = async () => {
          if (!confirm(`Delete template "${b.dataset.mtname}"?`)) return;
          const { error } = await db.from('message_templates').delete().eq('id', b.dataset.mmsgdel);
          if (error) { alert(error.message); return; }
          SCREENS.settings(el);
        };
      });
    }

    // ---------- ACTIVITY LOG ----------
    else if (SETTINGS_TAB === 'activity') {
      const { data: log } = await db.from('activity_log')
        .select('*').order('created_at', { ascending: false }).limit(200);
      const entries = log || [];

      // Resolve user names
      const userIds = [...new Set(entries.map(e => e.user_id).filter(Boolean))];
      const names = {};
      if (userIds.length) {
        const { data: profs } = await db.from('profiles').select('id, name, email').in('id', userIds);
        (profs || []).forEach(p => names[p.id] = p.name || p.email || 'unknown');
      }

      panel.innerHTML = `
        <div class="card">
          <h2>Activity Log</h2>
          <p class="hint">Last 200 events. Includes payment records.</p>
          ${entries.length ? `
            <div class="table-wrap"><table>
              <thead><tr>
                <th>When</th><th>User</th><th>Entity</th><th>Action</th><th>Details</th>
              </tr></thead>
              <tbody>
                ${entries.map(e => `<tr>
                  <td class="small" style="white-space:nowrap">${new Date(e.created_at).toLocaleString('en-GB')}</td>
                  <td class="small">${esc(names[e.user_id] || '—')}</td>
                  <td class="small">${esc(e.entity_type)}</td>
                  <td class="small"><span class="badge badge-${e.action==='created'?'signed':e.action==='deleted'?'cancelled':'scheduled'}">${esc(e.action)}</span></td>
                  <td class="small" style="word-break:break-word;max-width:340px">${esc(renderDetails(e.details))}</td>
                </tr>`).join('')}
              </tbody>
            </table></div>
          ` : '<p class="empty">No activity recorded yet. This fills up as payments are recorded.</p>'}
        </div>`;
    }

  } catch (err) {
    el.innerHTML = `<div class="card"><p class="error">${esc(err.message)}</p></div>`;
  }
};





// =====================================================================
// ===== DOM WIRING =====
// =====================================================================
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errBox   = document.getElementById('login-error');
  errBox.textContent = '';
  try {
    await login(email, password);
  } catch (err) {
    errBox.textContent = err.message;
  }
});

document.getElementById('logout-btn').addEventListener('click', logout);
document.getElementById('profile-btn').addEventListener('click', () => location.hash = '#profile');
document.getElementById('settings-btn').addEventListener('click', () => location.hash = '#settings');

// =====================================================================
// ===== START =====
// =====================================================================
bootApp();
