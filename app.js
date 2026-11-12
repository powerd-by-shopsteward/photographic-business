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

  // Default route by role
  if (!location.hash) {
    location.hash = CURRENT_PROFILE.role === 'owner' ? '#dashboard' : '#projects';
  }
  route();
}

function route() {
  const hash = location.hash.replace('#', '') || 'dashboard';
  const [name, param] = hash.split('/');

  // Block members from owner-only screens
  if (CURRENT_PROFILE && CURRENT_PROFILE.role !== 'owner') {
    const link = document.querySelector(`.sidebar a[data-screen="${name}"]`);
    if (link && link.dataset.role === 'owner') {
      location.hash = '#projects';
      return;
    }
  }

  // Hide all screens, show target
  document.querySelectorAll('.screen-content').forEach(el => el.style.display = 'none');

  const targetEl = document.getElementById('screen-' + name);
  if (!targetEl) { console.warn('No screen:', name); return; }
  targetEl.style.display = 'block';

  // Sidebar active state
  document.querySelectorAll('.sidebar a').forEach(a =>
    a.classList.toggle('active', a.dataset.screen === name));

  // Render
  const renderer = SCREENS[name];
  if (renderer) {
    Promise.resolve(renderer(targetEl, param)).catch(err => {
      console.error(err);
      targetEl.innerHTML = `<div class="card"><p class="error">${err.message}</p></div>`;
    });
  } else {
    targetEl.innerHTML = `<div class="card">
      <p class="empty">This screen arrives in a later block.</p>
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
