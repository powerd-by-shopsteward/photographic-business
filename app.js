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
    'invoice':   'invoices',
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
      db.from('payments').select('amount').eq('direction', 'in').gte('date', monthStart).not('project_id', 'is', null),
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
    document.getElementById('btn-new-project').addEventListener('click', () => openProjectForm());

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

async function openProjectForm(projectId = null) {
  const isEdit = !!projectId;
  let existing = null;

  // Fetch the data if we are editing
  if (isEdit) {
    const { data, error } = await db.from('projects').select('*').eq('id', projectId).single();
    if (error) { alert(error.message); return; }
    existing = data;
  }

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
    selMembers: {},   
    selGadgets: {},   
    memberGear: {},   
  };

  // 3) Backdrop + modal shell
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'proj-modal';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:740px">
      <div class="flex-between mb-2">
        <h2 style="margin:0">${isEdit ? 'Edit Project' : 'New Project'}</h2>
        <button type="button" class="btn-secondary btn-sm" id="pf-close">✕</button>
      </div>
      <form id="pf-form" autocomplete="off">

        <div class="form-row">
          <div>
            <label>Project Name *</label>
            <input id="pf-name" type="text" required maxlength="150" placeholder="e.g. Sujit Ghosh Wedding" value="${existing?.name || ''}">
          </div>
          <div>
            <label>Project Type *</label>
            <select id="pf-type" required>
              ${S.types.map(t =>
                `<option value="${t.id}" ${(existing?.project_type_id === t.id || (!isEdit && t.is_default)) ? 'selected' : ''}>${t.name}</option>`
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
                  `<option value="${c.id}" ${existing?.client_id === c.id ? 'selected' : ''}>${c.name}${c.phone ? ' · ' + c.phone : ''}</option>`
                ).join('')}
              </select>
              ${!isEdit ? `<button type="button" class="btn-secondary btn-sm" id="pf-add-client" title="Add new client">+</button>` : ''}
            </div>
          </div>
          <div>
            <label>Status</label>
            <select id="pf-status">
              <option value="scheduled" ${existing?.status === 'scheduled' ? 'selected' : ''}>Scheduled</option>
              <option value="live" ${existing?.status === 'live' ? 'selected' : ''}>Live now</option>
              <option value="completed" ${existing?.status === 'completed' ? 'selected' : ''}>Completed</option>
              <option value="cancelled" ${existing?.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
          </div>
        </div>

        <div class="form-row form-row-3">
          <div><label>Start Date</label><input id="pf-start-date" type="date" value="${existing?.start_date || ''}"></div>
          <div><label>Start Time</label><input id="pf-start-time" type="time" value="${existing?.start_time || ''}"></div>
          <div><label>End Date</label><input id="pf-end-date" type="date" value="${existing?.end_date || ''}"></div>
        </div>
        <div class="form-row">
          <div><label>End Time</label><input id="pf-end-time" type="time" value="${existing?.end_time || ''}"></div>
          <div></div>
        </div>

        <div class="form-row">
          <div><label>Venue Name</label><input id="pf-venue" type="text" value="${existing?.venue_name || ''}"></div>
          <div><label>Venue Address</label><input id="pf-venue-addr" type="text" value="${existing?.venue_address || ''}"></div>
        </div>

        <div class="form-row ${isEdit ? '' : 'form-row-3'}">
          <div><label>Quoted Amount</label><input id="pf-quoted" type="number" min="0" step="0.01" value="${existing?.quoted_amount || 0}"></div>
          <div><label>Confirmed Amount</label><input id="pf-confirmed" type="number" min="0" step="0.01" value="${existing?.confirmed_amount || 0}"></div>
          ${!isEdit ? `<div><label>Advance Payment</label><input id="pf-advance" type="number" min="0" step="0.01" value="0"></div>` : ''}
        </div>
        
        ${!isEdit ? `
        <div style="margin-bottom:12px; text-align:right; font-weight:600; color:#4b5563;">
          Balance Due: <span id="pf-balance-display">0</span>
        </div>
        ` : ''}

        <hr>

        ${!isEdit ? `
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
        ` : ''}

        <label>Notes</label>
        <textarea id="pf-notes">${existing?.notes || ''}</textarea>

        <p id="pf-error" class="error"></p>

        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="pf-cancel">Cancel</button>
          <button type="submit" id="pf-save">${isEdit ? 'Save Changes' : 'Create Project'}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  // Live calculation for balance (only on create)
  if (!isEdit) {
    const updateBalance = () => {
      const conf = Number(document.getElementById('pf-confirmed').value || 0);
      const adv  = Number(document.getElementById('pf-advance').value || 0);
      document.getElementById('pf-balance-display').textContent = fmtMoney(conf - adv);
    };
    document.getElementById('pf-confirmed').addEventListener('input', updateBalance);
    document.getElementById('pf-advance').addEventListener('input', updateBalance);
    updateBalance(); 
  }

  // 4) Renderers for dynamic sections (only on create)
  if (!isEdit) {
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
      
      let html = '<label style="font-weight:600">Member\'s Own Gear</label>';
      html += '<p class="hint">Optional — comma separated, e.g. "extra lens, gimbal"</p>';
      
      sel.forEach(m => {
        const val = (S.memberGear[m.id] || '').replace(/"/g, '&quot;');
        html += `
          <div style="margin-bottom:8px">
            <label class="small">${m.name}</label>
            <input type="text" class="pf-mem-gear" data-mid="${m.id}"
                   placeholder="Personal items"
                   value="${val}"
                   style="margin-bottom:4px">
          </div>
        `;
      });
      
      wrap.innerHTML = html;

      wrap.querySelectorAll('.pf-mem-gear').forEach(inp => {
        inp.oninput = e => { S.memberGear[e.target.dataset.mid] = e.target.value; };
      });
    }

    renderMembers();
    renderGadgets();
    
    // (Nested popups for Add Client and Add Member would go here, but omitted for brevity as they are not needed in Edit mode)
    // ...
  }

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
    saveBtn.textContent = isEdit ? 'Saving...' : 'Creating…';

    try {
      if (isEdit) {
        // JUST UPDATE THE PROJECT
        const { error: pErr } = await db.from('projects').update({
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
        }).eq('id', existing.id);
        if (pErr) throw pErr;
        
        closeModal();
        location.reload(); // Reload to show new data
        return;
      }

      // --- CREATE LOGIC ---
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
      
      const project = p;

      // Record Advance Payment
      const advanceAmt = Number(document.getElementById('pf-advance').value || 0);
      if (advanceAmt > 0) {
        await db.from('payments').insert({
          project_id: project.id, direction: 'in', type: 'client_advance', amount: advanceAmt, date: todayISO(), notes: 'Initial advance', created_by: CURRENT_PROFILE.id
        });
      }

      // Members
      const memberRows = Object.entries(S.selMembers).map(([mid, { amount }]) => ({
        project_id: project.id, team_member_id: mid, rate: Number(amount || 0), quantity: 1, pay_amount: Number(amount || 0), status: 'assigned',
      }));
      if (memberRows.length) {
        await db.from('project_members').insert(memberRows);
      }

      // Studio gear
      const gearRows = Object.keys(S.selGadgets).map(gid => ({
        project_id: project.id, gadget_id: gid, returned: false,
      }));
      if (gearRows.length) {
        await db.from('project_gear').insert(gearRows);
      }

      // Member gear
      const mgRows = [];
      for (const [mid, txt] of Object.entries(S.memberGear)) {
        if (!txt.trim()) continue;
        txt.split(',').map(s => s.trim()).filter(Boolean).forEach(n => {
          mgRows.push({ team_member_id: mid, name: n });
        });
      }
      if (mgRows.length) {
        const { data: created } = await db.from('member_gadgets').insert(mgRows).select('id, team_member_id');
        const pgRows = (created || []).map(mg => ({ project_id: project.id, member_gadget_id: mg.id, carried_by: mg.team_member_id, returned: false }));
        if (pgRows.length) await db.from('project_gear').insert(pgRows);
      }

      closeModal();
      location.hash = '#project/' + project.id;

    } catch (err) {
      errBox.textContent  = err.message;
      saveBtn.disabled    = false;
      saveBtn.textContent = isEdit ? 'Save Changes' : 'Create Project';
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
    const [pRes, pmRes, stRes, upRes, gRes, exRes, tmRes, invRes, agrRes] = await Promise.all([
      db.from('projects').select('*, client:clients(name, phone, email)').eq('id', projectId).single(),
      db.from('project_members').select('*, team_member:team_members(name, phone, role)').eq('project_id', projectId).order('created_at'),
      db.from('project_stages').select('*').eq('project_id', projectId).order('sort_order'),
      db.from('project_updates').select('*').eq('project_id', projectId).order('created_at', {ascending:false}),
      db.from('project_gear').select('*, gadget:gadgets(name, brand), member_gadget:member_gadgets(name), carrier:team_members(name)').eq('project_id', projectId),
      db.from('expenses').select('*').eq('project_id', projectId).order('date', {ascending:false}),
      isOwner ? db.from('team_members').select('id, name, role, default_rate').eq('active', true).order('name')
              : Promise.resolve({ data: [] }),
      // Fetch linked invoices
      db.from('invoices').select('id, invoice_no, total, issue_date, status').eq('project_id', projectId).order('created_at', {ascending: false}),
      // Fetch linked agreements
      db.from('agreements').select('id, agreement_no, status, agreement_date, total_amount').eq('project_id', projectId).order('created_at', {ascending: false})
    ]);

    if (pRes.error) throw pRes.error;

    const project = pRes.data;
    const members = pmRes.data || [];
    const stages  = stRes.data || [];
    const updates = upRes.data || [];
    const gear    = gRes.data || [];
    const expenses= exRes.data || [];
    const allTeam = tmRes.data || [];
    const linkedInvoices = invRes.data || [];
    const linkedAgreements = agrRes.data || [];

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
          <div style="text-align:right;">
            <a href="#projects" class="small" style="display:block; margin-bottom:8px;">← Back to Projects</a>
                        ${isOwner ? `
              <button id="btn-edit-project" class="btn-secondary btn-sm" style="margin-right:8px;">Edit Project</button>
              <button id="btn-delete-project" class="btn-danger btn-sm">Delete Project</button>
            ` : ''}
          </div>
        </div>
      </div>
      <div class="tabs" id="ptabs">
        ${tabs.map(([k,l]) =>
          `<button data-tab="${k}" class="${k===activeTab?'active':''}">${l}</button>`).join('')}
      </div>
      <div id="ptab"></div>
    `;

    // Wire Delete Button

        // Wire Edit Button
    const editBtn = document.getElementById('btn-edit-project');
    if (editBtn) {
      editBtn.onclick = () => openProjectForm(projectId);
    }
    const delBtn = document.getElementById('btn-delete-project');
    if (delBtn) {
      delBtn.onclick = async () => {
        // 1st Confirmation
        if (!confirm(`WARNING: Deleting "${project.name}" will remove all associated data (team assignments, expenses, payments). Are you absolutely sure?`)) return;
        
        // 2nd Confirmation
        if (!confirm(`FINAL WARNING: This action CANNOT be undone. Click OK to permanently delete this project.`)) return;

        delBtn.disabled = true;
        delBtn.textContent = 'Deleting...';
        
        const { error } = await db.from('projects').delete().eq('id', projectId);
        if (error) {
          alert("Error deleting project: " + error.message);
          delBtn.disabled = false;
          delBtn.textContent = 'Delete Project';
        } else {
          alert("Project deleted successfully.");
          location.hash = '#projects';
        }
      };
    }

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
          <div class="card-header">
            <h2>Invoices (${linkedInvoices.length})</h2>
            <button id="proj-new-invoice" class="btn-secondary">+ Create Invoice</button>
          </div>
          ${linkedInvoices.length ? `
            <table>
              <thead><tr><th>No.</th><th>Date</th><th class="num">Total</th><th>Status</th><th></th></tr></thead>
              <tbody>
                ${linkedInvoices.map(i => `
                  <tr style="cursor:pointer" onclick="location.hash='#invoice/${i.id}'">
                    <td><strong>${esc(i.invoice_no)}</strong></td>
                    <td>${fmtDate(i.issue_date)}</td>
                    <td class="num">${fmtMoney(i.total)}</td>
                    <td><span class="${badgeClass(i.status)}">${i.status}</span></td>
                    <td class="actions" onclick="event.stopPropagation()">
                      <button class="btn-secondary btn-sm" onclick="location.hash='#invoice/${i.id}'">Edit</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p class="empty">No invoices for this project yet.</p>'}
        </div>`;
    }
    function wireInvoices() {
      document.getElementById('proj-new-invoice').onclick = async () => {
        // Create a draft invoice linked to this project
        const { data, error } = await db.from('invoices').insert({
          project_id: projectId,
          invoice_no: 'DRAFT',
          amount: 0, tax: 0, total: 0,
          issue_date: todayISO(),
          status: 'draft',
          metadata: { items: [{ description: project.name, hsn: '', qty: 1, rate: project.confirmed_amount || 0 }], payment_mode: 'Bank Transfer', amount_words: '' }
        }).select().single();

        if (error) { alert(error.message); return; }
        location.hash = '#invoice/' + data.id;
      };
    }

    // ============ AGREEMENT ============
    function renderAgreement() {
      return `
        <div class="card">
          <div class="card-header">
            <h2>Agreements (${linkedAgreements.length})</h2>
            <button id="proj-new-agreement" class="btn-secondary">+ Create Agreement</button>
          </div>
          ${linkedAgreements.length ? `
            <table>
              <thead><tr><th>No.</th><th>Date</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
              <tbody>
                ${linkedAgreements.map(a => `
                  <tr style="cursor:pointer" onclick="location.hash='#agreement/${a.id}'">
                    <td><strong>${esc(a.agreement_no)}</strong></td>
                    <td>${fmtDate(a.agreement_date)}</td>
                    <td class="num">${fmtMoney(a.total_amount)}</td>
                    <td><span class="${badgeClass(a.status)}">${a.status}</span></td>
                    <td class="actions" onclick="event.stopPropagation()">
                      <button class="btn-secondary btn-sm" onclick="location.hash='#agreement/${a.id}'">Edit</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p class="empty">No agreements for this project yet.</p>'}
        </div>`;
    }
    function wireAgreement() {
      document.getElementById('proj-new-agreement').onclick = async () => {
        // Create a draft agreement linked to this project
        const { data, error } = await db.from('agreements').insert({
          client_id: project.client_id,
          project_id: projectId,
          title: 'New Agreement',
          body_rendered: 'Draft',
          total_amount: project.confirmed_amount || 0,
          advance_amount: 0, balance_amount: project.confirmed_amount || 0,
          status: 'draft',
          created_by: CURRENT_PROFILE.id,
        }).select().single();

        if (error) { alert(error.message); return; }
        location.hash = '#agreement/' + data.id;
      };
    }

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
  const [cRes, pRes] = await Promise.all([
    db.from('clients').select('id,name').order('name'),
    db.from('projects').select('id,name,client_id').order('start_date', { ascending: false }),
  ]);
  const clients   = cRes.data || [];
  const projects  = pRes.data || [];

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:480px">
      <h2>New Agreement</h2>
      <p class="muted small mb-2">Create a blank draft to fill out in the editor.</p>
      <form id="na-form" autocomplete="off">
        <label>Client *</label>
        <select id="na-client" required>
          <option value="">— select client —</option>
          ${clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
        </select>

        <label>Project (optional)</label>
        <select id="na-project">
          <option value="">— none (client-level agreement) —</option>
          ${projects.map(p => `<option value="${p.id}" data-client="${p.client_id}">${esc(p.name)}</option>`).join('')}
        </select>

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
    const client_id   = document.getElementById('na-client').value;
    const project_id  = document.getElementById('na-project').value || null;

    if (!client_id) { errBox.textContent = 'Client is required'; return; }

    const { data: created, error } = await db.from('agreements').insert({
      client_id, project_id,
      title: 'New Agreement',
      body_rendered: 'Draft',
      total_amount: 0, advance_amount: 0, balance_amount: 0,
      status: 'draft',
      created_by: CURRENT_PROFILE.id,
    }).select().single();

    if (error) { errBox.textContent = error.message; return; }
    backdrop.remove();
    location.hash = '#agreement/' + created.id;
  };
}

// =====================================================================
// BLOCK 5B (NEW) — Smart Agreement Editor
// =====================================================================
const STANDARD_CLAUSES = [
  // --- Universal / Payment ---
  "The remaining balance must be paid in full upon delivery of the final edited files, prior to download.",
  "Commercial usage rights are granted to the Client only upon full payment of the total fee.",
  "A late fee of [X]% per week will be applied to overdue balances.",
  
  // --- Universal / Deliverables ---
  "Final edited deliverables will be provided within [X] days of the event date.",
  "The Client is entitled to [X] rounds of revisions. Additional revisions will incur a fee of [Rate] per round.",
  "Unedited RAW files and original footage will not be provided to the Client. Only final edited deliverables are included.",
  "The Studio retains full copyright and ownership of all images/videos. The Client is granted a personal-use license only.",

  // --- Universal / Logistics ---
  "The Client is responsible for obtaining any necessary permits, location releases, or permissions required for the shoot.",
  "Any travel, accommodation, or transport costs outside the studio's base city limits are to be borne by the Client.",
  "The Client agrees to provide meals and drinking water for the photography crew during the event.",
  "Any additional hours required beyond the agreed timeframe will be billed at an overtime rate of [Rate]/hour.",
  
  // --- Wedding / Event Specific ---
  "The advance payment is strictly non-refundable if the event is cancelled within 7 days of the scheduled date.",
  "The Client may reschedule the event once without penalty, provided at least 14 days' notice is given.",
  "While the Studio takes utmost care, they are not liable for missed moments due to venue restrictions, acts of God, or sudden equipment failure."
];


// 1. Built-in Templates
const DOC_TEMPLATES = {
  wedding: {
    name: 'Wedding Photography',
    intro: 'This agreement is made on {{date}} between {{studio_name}} ("the Studio") and {{client_name}} ("the Client") for the wedding event at {{venue}}.',
    scope: 'The Studio agrees to provide professional photography and videography services. The deliverables include {{photos}} professionally edited photographs and {{videos}} edited highlight video(s).',
  },
  product: {
    name: 'Product / Commercial Shoot',
    intro: 'This agreement is made on {{date}} between {{studio_name}} ("the Studio") and {{client_name}} ("the Client") for a commercial product shoot at {{venue}}.',
    scope: 'The Studio agrees to provide commercial photography services. The deliverables include {{photos}} high-resolution retouched images and {{videos}} video ad(s).',
  },
  universal: {
    name: 'Universal Event / Service',
    intro: 'This agreement is made on {{date}} between {{studio_name}} ("the Studio") and {{client_name}} ("the Client") for the event "{{project_name}}" at {{venue}}.',
    scope: 'The Studio agrees to provide professional photography services. The deliverables include {{photos}} edited images and {{videos}} video(s).',
  }
};

SCREENS.agreement = async function(el, id) {
  if (!id) {
    el.innerHTML = '<div class="card"><p class="error">No agreement selected.</p></div>';
    return;
  }
  el.innerHTML = '<div class="loading">Loading agreement…</div>';

  try {
        // 2. Fetch Data
        const [agRes, studioRes, clRes, prjRes, payRes] = await Promise.all([
      db.from('agreements').select('*, client:clients(*), project:projects(*)').eq('id', id).single(),
      db.from('studio').select('*').single(),
      db.from('clients').select('id,name,phone,email,address').order('name'),
      db.from('projects').select('id,name,client_id,venue_name,start_date,confirmed_amount').order('start_date', {ascending:false}),
      db.from('payments').select('project_id, amount').eq('direction', 'in')
    ]);
    if (agRes.error) throw agRes.error;

        const ag = agRes.data;
    const studio = studioRes.data || { name: 'Studio' };
    const clients = clRes.data || [];
    const projects = prjRes.data || [];
    const payments = payRes.data || [];
    const meta = ag.metadata || {};

    // Calculate total received per project
    const receivedByProject = {};
    payments.forEach(p => {
      receivedByProject[p.project_id] = (receivedByProject[p.project_id] || 0) + Number(p.amount);
    });

    // State for custom clauses
    let customClauses = meta.clauses || [];

    // 3. Build Layout
       el.innerHTML = `
      <div style="margin-bottom:12px"><a href="#agreements" class="small">← Back to Agreements</a></div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;align-items:start">
        
        <!-- LEFT PANEL: FORM -->
        <div>
          <div class="card">
            <h2 style="margin-bottom:16px">Agreement Setup</h2>
            
            <label>Template Style</label>
            <select id="ag-template-type" style="margin-bottom:16px">
              <option value="wedding" ${meta.template==='wedding'?'selected':''}>Wedding Photography</option>
              <option value="product" ${meta.template==='product'?'selected':''}>Product / Commercial</option>
              <option value="universal" ${meta.template==='universal'?'selected':''}>Universal Event</option>
            </select>

            <div class="form-row">
              <div>
                <label>Client</label>
                <select id="ag-client">
                  ${clients.map(c => `<option value="${c.id}" ${c.id===ag.client_id?'selected':''}>${esc(c.name)}</option>`).join('')}
                </select>
              </div>
              <div>
                <label>Project (optional)</label>
                <select id="ag-project">
                  <option value="">— none —</option>
                  ${projects.map(p => `<option value="${p.id}" data-client="${p.client_id}" ${p.id===ag.project_id?'selected':''}>${esc(p.name)}</option>`).join('')}
                </select>
              </div>
            </div>

            <div class="form-row form-row-3">
              <div><label>Date</label><input id="ag-date" type="date" value="${ag.agreement_date || todayISO()}"></div>
              <div><label>Venue</label><input id="ag-venue" type="text" value="${esc(meta.venue || ag.project?.venue_name || '')}"></div>
              <div><label>Photos</label><input id="ag-photos" type="text" placeholder="e.g. 500" value="${esc(meta.photos || '')}"></div>
            </div>
            
            <div class="form-row form-row-3">
              <div><label>Videos</label><input id="ag-videos" type="text" placeholder="e.g. 1 highlight reel" value="${esc(meta.videos || '')}"></div>
              <div></div><div></div>
            </div>

            <div class="form-row form-row-3">
              <div><label>Total Amount</label><input id="ag-total" type="number" value="${ag.total_amount || 0}"></div>
              <div><label>Advance Paid</label><input id="ag-adv" type="number" value="${ag.advance_amount || 0}"></div>
              <div>
                <label>Balance</label>
                <div id="ag-balance" style="padding:10px;background:#f3f4f6;border-radius:6px;font-weight:bold">
                  ${fmtMoney((ag.total_amount||0) - (ag.advance_amount||0))}
                </div>
              </div>
            </div>

                       <hr style="margin:20px 0">

            <h3 style="margin-bottom:10px">Terms & Conditions</h3>
            
            <label>Add Pre-made Clause</label>
            <select id="ag-clause-dropdown" style="margin-bottom:16px; background:#f0fdf4; border-color:#bbf7d0;">
              <option value="">-- Select a clause to add --</option>
              ${STANDARD_CLAUSES.map((c, i) => `<option value="${i}">${c}</option>`).join('')}
            </select>

            <div class="flex-between mb-2">
              <label style="margin:0">Active Clauses (Click to edit text)</label>
              <button type="button" id="ag-add-clause" class="btn-secondary btn-sm">+ Add Blank Clause</button>
            </div>
            <div id="ag-clauses-list" style="background:#f9fafb; padding:10px; border-radius:6px; border:1px solid #e5e7eb;"></div>

            <div class="btn-group mt-2">
              <button id="ag-save">Save Agreement</button>
              <button id="ag-print" class="btn-success">🖨 Generate PDF</button>
            </div>
            <p id="ag-error" class="error"></p>
          </div>
        </div>

        <!-- RIGHT PANEL: A4 PREVIEW -->
        <div>
          <div class="card" style="position:sticky;top:20px;padding:10px;background:#e5e7eb">
            <div id="print-area" style="
              width:100%; max-width:210mm; min-height:297mm; background:#fff; padding:20mm;
              box-shadow:0 4px 12px rgba(0,0,0,.15); position:relative;
              font-family:'Times New Roman', Georgia, serif; font-size:13px; line-height:1.6; color:#111;
              display:flex; flex-direction:column; box-sizing:border-box;
            ">
              <!-- Watermark -->
              <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:80px;color:rgba(0,0,0,.04);font-weight:900;white-space:nowrap;pointer-events:none;z-index:0;font-family:sans-serif">
                ${esc(studio.name)}
              </div>

              <!-- Document Content -->
              <div style="position:relative;z-index:1; flex-grow: 1;">
                
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #000; padding-bottom:10px; margin-bottom:20px">
                  <div>
                    <h1 style="margin:0; font-size:24px">${esc(studio.name)}</h1>
                    <div style="font-size:11px">${esc(studio.address || '')} · ${esc(studio.phone || '')}</div>
                  </div>
                  <div style="text-align:right">
                    <h2 style="margin:0; font-size:18px">AGREEMENT</h2>
                    <div style="font-size:11px">Ref: ${esc(ag.agreement_no)}</div>
                  </div>
                </div>

                <div id="print-intro" style="margin-bottom:20px; text-align:justify;"></div>

                <h4 style="margin-bottom:8px; font-size:14px;">Scope of Work</h4>
                <div id="print-scope" style="margin-bottom:20px; text-align:justify;"></div>

                <h4 style="margin-bottom:8px; font-size:14px;">Financials</h4>
                <table style="width:100%; font-size:13px; margin-bottom:20px; border-collapse:collapse;">
                  <tr><td style="padding:4px 0">Total Fee:</td><td style="text-align:right">${esc(studio.currency || '')} <span id="print-total"></span></td></tr>
                  <tr><td style="padding:4px 0">Advance Paid:</td><td style="text-align:right">${esc(studio.currency || '')} <span id="print-adv"></span></td></tr>
                  <tr style="font-weight:bold; border-top:1px solid #ccc;"><td style="padding:4px 0">Balance Due:</td><td style="text-align:right">${esc(studio.currency || '')} <span id="print-bal"></span></td></tr>
                </table>

                <h4 style="margin-bottom:8px; font-size:14px;">Terms & Conditions</h4>
                <ul id="print-clauses" style="padding-left:20px; margin-bottom:30px; font-size:12px;">
                  <!-- Rendered via JS -->
                </ul>

              </div>

              <!-- SIGNATURES (Pushed to bottom) -->
              <div style="position:relative; z-index:1; margin-top:auto; padding-top:40px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-end;">
                  
                  <!-- Studio Signature & Stamp -->
                  <div style="width:45%; text-align:center; position:relative;">
                    <div style="height:70px; position:relative; display:flex; justify-content:center; align-items:flex-end;">
                      <!-- Signature -->
                      ${studio.signature_url ? `<img src="${studio.signature_url}" style="max-height:60px; z-index:2; position:relative;">` : ''}
                      
                      <!-- Stamp (Positioned nicely to the right of the signature) -->
                      ${studio.stamp_url ? `<img src="${studio.stamp_url}" style="position:absolute; right:-10px; bottom:-10px; max-height:85px; opacity:0.85; mix-blend-mode:multiply; z-index:1;">` : ''}
                    </div>
                    <div style="border-top:1px solid #000; padding-top:5px; margin-top:10px;">For ${esc(studio.name)}</div>
                  </div>
                  
                  <!-- Client Signature -->
                  <div style="width:45%; text-align:center;">
                    <div style="height:70px;"></div>
                    <div style="border-top:1px solid #000; padding-top:5px; margin-top:10px;">For the Client</div>
                  </div>

                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    `;

    // 4. Logic & Rendering
        function renderClausesInput() {
      const wrap = document.getElementById('ag-clauses-list');
      if (!customClauses.length) {
        wrap.innerHTML = '<p class="muted small" style="margin:0">No clauses selected yet. Choose from the dropdown above.</p>';
        return;
      }
      wrap.innerHTML = customClauses.map((c, i) => `
        <div style="display:flex; gap:8px; margin-bottom:8px; align-items:flex-start;">
          <textarea class="clause-input" data-idx="${i}" rows="2" style="flex:1; font-size:12px; padding:6px; margin:0; line-height:1.4; border:1px solid #d1d5db; border-radius:4px;" placeholder="Type custom clause here...">${esc(c)}</textarea>
          <button type="button" class="btn-danger btn-sm remove-clause" data-idx="${i}" style="padding:6px 10px; margin-top:0;">✕</button>
        </div>
      `).join('');

      // Allow editing the text directly
      wrap.querySelectorAll('.clause-input').forEach(inp => {
        inp.oninput = (e) => {
          customClauses[e.target.dataset.idx] = e.target.value;
          updatePreview();
        };
      });

      // Delete button
      wrap.querySelectorAll('.remove-clause').forEach(btn => {
        btn.onclick = (e) => {
          customClauses.splice(e.target.dataset.idx, 1);
          renderClausesInput();
          updatePreview();
        };
      });
    }
    function updatePreview() {
      const tplType = document.getElementById('ag-template-type').value;
      const tpl = DOC_TEMPLATES[tplType];
      
      const dateVal = document.getElementById('ag-date').value;
      const venueVal = document.getElementById('ag-venue').value;
      const photoVal = document.getElementById('ag-photos').value || '—';
      const videoVal = document.getElementById('ag-videos').value || '—';
      const totalVal = Number(document.getElementById('ag-total').value || 0);
      const advVal = Number(document.getElementById('ag-adv').value || 0);
      const balVal = totalVal - advVal;

      const clientId = document.getElementById('ag-client').value;
      const client = clients.find(c => c.id === clientId) || {};
      const projId = document.getElementById('ag-project').value;
      const project = projects.find(p => p.id === projId) || {};

      // Replace placeholders
      const fill = (text) => {
        return text
          .replace(/{{date}}/g, fmtDate(dateVal))
          .replace(/{{studio_name}}/g, studio.name)
          .replace(/{{client_name}}/g, client.name || '')
          .replace(/{{project_name}}/g, project.name || 'Event')
          .replace(/{{venue}}/g, venueVal || '—')
          .replace(/{{photos}}/g, photoVal)
          .replace(/{{videos}}/g, videoVal);
      };

      document.getElementById('print-intro').innerHTML = fill(tpl.intro);
      document.getElementById('print-scope').innerHTML = fill(tpl.scope);
      
      document.getElementById('ag-balance').textContent = fmtMoney(balVal);
      document.getElementById('print-total').textContent = fmtMoney(totalVal);
      document.getElementById('print-adv').textContent = fmtMoney(advVal);
      document.getElementById('print-bal').textContent = fmtMoney(balVal);

      // Render clauses in preview
          // Render ONLY the clauses the user added or selected
      const clWrap = document.getElementById('print-clauses');
      clWrap.innerHTML = customClauses.map(c => `<li>${esc(c)}</li>`).join('');
    }

    // 5. Wire events
    ['ag-template-type','ag-date','ag-venue','ag-photos','ag-videos','ag-total','ag-adv','ag-client','ag-project'].forEach(id => {
      document.getElementById(id).addEventListener('input', updatePreview);
      document.getElementById(id).addEventListener('change', updatePreview);
    });

    document.getElementById('ag-add-clause').onclick = () => {
      customClauses.push('');
      renderClausesInput();
    };

        document.getElementById('ag-clause-dropdown').onchange = (e) => {
      const idx = e.target.value;
      if (idx === '') return;
      const text = STANDARD_CLAUSES[idx];
      if (!customClauses.includes(text)) { // Prevent duplicates
        customClauses.push(text);
        renderClausesInput();
        updatePreview();
      }
      e.target.value = ''; // Reset dropdown
    };

           // Auto-fill project data
    document.getElementById('ag-project').addEventListener('change', e => {
      const pid = e.target.value;
      if (!pid) return;
      
      const p = projects.find(x => x.id === pid);
      if (p) {
        document.getElementById('ag-client').value = p.client_id;
        
        if (p.venue_name && !document.getElementById('ag-venue').value) {
          document.getElementById('ag-venue').value = p.venue_name;
        }
        
        // Auto-fill financials every time a project is picked
        document.getElementById('ag-total').value = p.confirmed_amount || 0;
        document.getElementById('ag-adv').value = receivedByProject[pid] || 0;
      }
      updatePreview();
    });
        // Save
    document.getElementById('ag-save').onclick = async () => {
      const btn = document.getElementById('ag-save');
      const err = document.getElementById('ag-error');
      btn.disabled = true; 
      btn.textContent = 'Saving...'; 
      err.textContent = '';

      const payload = {
        client_id: document.getElementById('ag-client').value,
        project_id: document.getElementById('ag-project').value || null,
        agreement_date: document.getElementById('ag-date').value,
        total_amount: Number(document.getElementById('ag-total').value),
        advance_amount: Number(document.getElementById('ag-adv').value),
        balance_amount: Number(document.getElementById('ag-total').value) - Number(document.getElementById('ag-adv').value),
        metadata: {
          template: document.getElementById('ag-template-type').value,
          venue: document.getElementById('ag-venue').value,
          photos: document.getElementById('ag-photos').value,
          videos: document.getElementById('ag-videos').value,
          clauses: customClauses
        }
      };

      try {
        const { error } = await db.from('agreements').update(payload).eq('id', id);
        if (error) throw error;
        
        alert('Agreement saved successfully!');
        
        // Refresh the list in the background so when you click "Back" it's up to date
        SCREENS.agreements(document.getElementById('screen-agreements'));
        
      } catch(e) {
        err.textContent = "Save failed: " + e.message;
      } finally {
        btn.disabled = false; 
        btn.textContent = 'Save Agreement';
      }
    };

    // Print
    document.getElementById('ag-print').onclick = () => {
      window.print();
    };

       // Initial render
    renderClausesInput();
    document.getElementById('ag-project').dispatchEvent(new Event('change'));
    updatePreview();

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
        const invId = b.dataset.ipaid;
        const inv = invoices.find(x => x.id === invId);
        
        if (!inv) return;
        if (!inv.project_id) {
          alert("Cannot record payment: This invoice is not linked to a project.");
          return;
        }

        b.disabled = true;
        b.textContent = 'Processing...';

        try {
          // 1. Find out how much has ALREADY been paid for this project
          const { data: existingPayments } = await db.from('payments')
            .select('amount')
            .eq('project_id', inv.project_id)
            .eq('direction', 'in');
          
          const totalPaidSoFar = (existingPayments || []).reduce((sum, p) => sum + Number(p.amount), 0);
          
          // 2. Calculate the remaining balance of the invoice
          const remainingToPay = Number(inv.total) - totalPaidSoFar;

          // 3. If money is owed, automatically record it in the ledger
          if (remainingToPay > 0) {
            const { data: { user } } = await db.auth.getUser();
            await db.from('payments').insert({
              project_id: inv.project_id,
              direction: 'in',
              type: 'client_final',
              amount: remainingToPay,
              date: todayISO(),
              notes: 'Auto-recorded via Mark Paid button',
              created_by: user.id
            });
          }

          // 4. Change the invoice status to paid
          await db.from('invoices').update({ status: 'paid' }).eq('id', invId);

                    // Automatically mark the project as completed since it's fully paid
          if (inv.project_id) {
            await db.from('projects').update({ status: 'completed' }).eq('id', inv.project_id);
          }
          
          SCREENS.invoices(el); // Refresh the page

        } catch (err) {
          alert("Error recording payment: " + err.message);
          b.disabled = false;
          b.textContent = 'Mark Paid';
        }
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

async function openInvoiceForm() {
  // Create a blank draft immediately and redirect to the new editor
  const { data, error } = await db.from('invoices').insert({
    project_id: null,
    invoice_no: 'DRAFT', // Will be auto-generated by DB trigger when saved
    amount: 0, tax: 0, total: 0,
    issue_date: todayISO(),
    status: 'draft',
    metadata: { items: [{ description: 'Photography Services', hsn: '', qty: 1, rate: 0 }], payment_mode: 'Bank Transfer', amount_words: '' }
  }).select().single();

  if (error) { 
    alert("Error creating invoice: " + error.message); 
    return; 
  }
  
  // Redirect to the full-page editor we built
  location.hash = '#invoice/' + data.id;
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
  let meta = full.metadata || {};
  
  if (!meta.items || !meta.items.length) {
    meta.items = [{ description: full.project?.name || 'Photography Services', hsn: '', qty: 1, rate: full.amount || 0 }];
  }

  let subtotal = meta.items.reduce((sum, item) => sum + (item.qty * item.rate), 0);
  let taxPct = meta.tax_pct || 0;
  let taxAmt = subtotal * (taxPct / 100);
  let grandTotal = subtotal + taxAmt;
  let words = meta.amount_words || numberToWords(Math.round(grandTotal));
  let upiLink = studio.upi_id ? `upi://pay?pa=${encodeURIComponent(studio.upi_id)}&pn=${encodeURIComponent(studio.name)}` : '';
  let contact = meta.contact_phone || studio.phone || '';

  const w = window.open('', '_blank');
  w.document.write(`
    <!DOCTYPE html><html><head><title>${esc(full.invoice_no)}</title>
    <style>
      body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      @page { margin: 0; size: A4; }
      .print-wrapper {
        width: 210mm; min-height: 297mm; padding: 15mm; box-sizing: border-box;
        font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #333; background: #fff;
        display: flex; flex-direction: column; margin: 0 auto;
      }
    </style></head>
    <body>
      <div class="print-wrapper">
        
        <!-- Header -->
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid #ccc; padding-bottom:15px;">
          <div style="display:flex; gap:15px;">
            ${studio.logo_url ? `<img src="${studio.logo_url}" style="max-height:60px; max-width:60px; object-fit:contain;">` : ''}
            <div>
              <h1 style="margin:0 0 5px 0; font-size:22px; color:#000;">${esc(studio.name)}</h1>
              <div style="color:#666; line-height:1.4;">
                ${esc(studio.address || '')}<br>
                ${esc(studio.email || '')} | ${esc(studio.phone || '')}
              </div>
            </div>
          </div>
          <div style="text-align:right;">
            <h2 style="margin:0 0 5px 0; font-size:24px; letter-spacing:1px; color:#000;">TAX INVOICE</h2>
            <div style="color:#666; font-size:10px; margin-bottom:10px;">ORIGINAL FOR RECIPIENT</div>
            <div style="display:inline-block; padding:4px 10px; border:1px solid #059669; color:#059669; font-weight:bold; font-size:10px; border-radius:4px;">
              ${full.status.toUpperCase()}
            </div>
          </div>
        </div>

        <!-- Info Bar -->
        <div style="display:flex; border-bottom:1px solid #ccc;">
          <div style="flex:1; border-right:1px solid #ccc; padding:10px 0;">
            <div style="color:#888; font-size:10px;">Invoice No: <span style="color:#333; font-weight:bold;">${esc(full.invoice_no)}</span></div>
            <div style="color:#888; font-size:10px; margin-top:5px;">Invoice Date: <span style="color:#333; font-weight:bold;">${fmtDate(full.issue_date)}</span></div>
          </div>
          <div style="flex:1; padding:10px 0 10px 15px;">
            <div style="color:#888; font-size:10px;">Payment Mode: <span style="color:#333; font-weight:bold;">${esc(meta.payment_mode || 'Bank Transfer')}</span></div>
            <div style="color:#888; font-size:10px; margin-top:5px;">Place of Supply: <span style="color:#333; font-weight:bold;">${esc(studio.address ? studio.address.split(',').pop().trim() : '')}</span></div>
          </div>
        </div>

        <!-- Bill To -->
        <div style="display:flex; border-bottom:1px solid #ccc;">
          <div style="flex:1; border-right:1px solid #ccc; padding:15px 0;">
            <div style="color:#888; font-size:10px; margin-bottom:5px;">BILLED TO (CLIENT):</div>
            <div style="font-weight:bold; font-size:14px; color:#000; margin-bottom:5px;">${esc(client.name || '—')}</div>
            <div style="color:#666;">${esc(client.address || 'Address will appear here if saved in client profile.')}</div>
            <div style="color:#666; margin-top:5px;">${esc(client.phone || '')}</div>
          </div>
          <div style="flex:1; padding:15px 0 15px 15px;">
            <div style="color:#888; font-size:10px; margin-bottom:5px;">SHIPPED / SUPPLIED TO:</div>
            <div style="font-weight:bold; color:#000;">Same as Billing Address</div>
          </div>
        </div>

        <!-- Items Table -->
        <div style="flex-grow:1; margin-top:20px;">
          <table style="width:100%; border-collapse:collapse; font-size:11px;">
            <thead>
              <tr style="background:#000; color:#fff;">
                <th style="padding:8px; text-align:center; width:30px;">#</th>
                <th style="padding:8px; text-align:left;">Description of Service / Solution</th>
                <th style="padding:8px; text-align:center; width:60px;">HSN/SAC</th>
                <th style="padding:8px; text-align:center; width:50px;">Qty</th>
                <th style="padding:8px; text-align:right; width:80px;">Rate (₹)</th>
                <th style="padding:8px; text-align:right; width:90px;">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${meta.items.map((item, i) => {
                const amt = (item.qty || 0) * (item.rate || 0);
                return `
                  <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:8px; text-align:center; color:#666;">${i+1}</td>
                    <td style="padding:8px;">${esc(item.description)}</td>
                    <td style="padding:8px; text-align:center;">${esc(item.hsn)}</td>
                    <td style="padding:8px; text-align:center;">${item.qty}</td>
                    <td style="padding:8px; text-align:right;">${fmtMoney(item.rate)}</td>
                    <td style="padding:8px; text-align:right;">${fmtMoney(amt)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <!-- Totals & Footer -->
        <div style="margin-top:20px; border-top:1px solid #ccc; padding-top:10px;">
          
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <!-- Left side: Amount in words & Bank -->
            <div style="flex:1; padding-right:20px;">
              <div style="font-style:italic; margin-bottom:15px; color:#555;">
                Amount in Words: <strong style="color:#000;">${esc(words)}</strong>
              </div>
              
              <div style="display:flex; gap:15px; align-items:flex-start;">
                ${upiLink ? `<img src="https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(upiLink)}" style="width:60px; height:60px; border:1px solid #ccc;">` : ''}
                <div>
                  <div style="font-weight:bold; margin-bottom:2px;">Bank Transfer / Direct UPI</div>
                  <div style="color:#666; font-size:10px;">
                    ${esc(studio.name)}<br>
                    A/c: ${esc(studio.bank_account_no || '—')}<br>
                    IFSC: ${esc(studio.bank_ifsc || '—')}<br>
                    UPI: ${esc(studio.upi_id || '—')}
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Right side: Calculation -->
            <div style="width:250px;">
              <div style="display:flex; justify-content:space-between; padding:4px 0;">
                <span style="color:#666;">Taxable Value</span>
                <span>₹${fmtMoney(subtotal)}</span>
              </div>
              <div style="display:flex; justify-content:space-between; padding:4px 0;">
                <span style="color:#666;">Tax / GST</span>
                <span>₹${fmtMoney(taxAmt)}</span>
              </div>
              <div style="display:flex; justify-content:space-between; padding:8px 0; border-top:1px solid #ccc; border-bottom:2px solid #333; font-weight:bold; font-size:14px; margin-top:5px;">
                <span>GRAND TOTAL</span>
                <span>₹${fmtMoney(grandTotal)}</span>
              </div>
            </div>
          </div>

          <!-- Terms and Signature -->
          <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:30px;">
            <div style="flex:1; padding-right:20px; font-size:9px; color:#666;">
              <div style="font-weight:bold; color:#000; margin-bottom:4px;">Terms & Conditions</div>
              <ol style="padding-left:12px; margin:0;">
                <li>This invoice is generated electronically and does not require a physical signature.</li>
                <li>Payment is due within 7 days of the invoice date.</li>
                <li>For any queries, please contact ${esc(contact)}.</li>
              </ol>
            </div>
            <div style="text-align:center; width:200px;">
              ${studio.signature_url ? `<img src="${studio.signature_url}" style="max-height:40px; margin-bottom:5px;">` : '<div style="height:40px;"></div>'}
              <div style="border-top:1px solid #000; padding-top:4px; font-size:10px;">
                <strong>AUTHORIZED SIGNATORY</strong><br>For ${esc(studio.name)}
              </div>
            </div>
          </div>

        </div>

      </div>
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
      db.from('project_members').select('project_id,pay_amount,status')
    ]);

    const gadgets = gRes.data || [];
    const proj    = prjRes.data || [];
    const pays    = payRes.data || [];
    const exps    = exRes.data || [];
    const pms     = pmRes.data || [];

    // 1. Equipment (Stock) Value
    const equipmentValue = gadgets.reduce((s, g) =>
      s + Number(g.current_value || g.purchase_price || 0), 0);

    // 2. Cash in Hand (Received minus Paid Out)
    let totalIn = 0, totalOut = 0;
    pays.forEach(p => {
      if (p.direction === 'in') totalIn += Number(p.amount);
      if (p.direction === 'out') totalOut += Number(p.amount);
    });
    const cashInHand = totalIn - totalOut;

    // 3. Receivables (Unpaid confirmed amounts)
    const totalConfirmed = proj.reduce((s, p) => s + Number(p.confirmed_amount || 0), 0);
    const totalReceivable = Math.max(0, totalConfirmed - totalIn);

    // 4. Lifetime Profit vs Pipeline
    const completedIds = new Set(proj.filter(p => p.status === 'completed').map(p => p.id));
    const activeProjects = proj.filter(p => p.status === 'scheduled' || p.status === 'live');
    
    let lifetimeRevenue = 0;
    let lifetimeExpenses = 0;
    let lifetimeMemberPay = 0;
    
    // Calculate ACTUAL profit (Deducting expenses and member pay)
    proj.filter(p => completedIds.has(p.id)).forEach(p => {
      lifetimeRevenue += Number(p.confirmed_amount || 0);
      
      const pExps = exps.filter(e => e.project_id === p.id).reduce((s, e) => s + Number(e.amount), 0);
      const pMems = pms.filter(m => m.project_id === p.id && m.status !== 'cancelled').reduce((s, m) => s + Number(m.pay_amount), 0);
      
      lifetimeExpenses += pExps;
      lifetimeMemberPay += pMems;
    });

    const lifetimeNetProfit = lifetimeRevenue - lifetimeExpenses - lifetimeMemberPay;
    const pipelineValue = activeProjects.reduce((s, p) => s + Number(p.confirmed_amount || 0), 0);

    // FIXED FORMULA: Equipment + True Net Profit + Active Pipeline
    const totalStudioValue = equipmentValue + lifetimeNetProfit + pipelineValue;

    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat">
          <div class="label">Stock (Equipment)</div>
          <div class="value">${fmtMoney(equipmentValue)}</div>
          <div class="muted small">${gadgets.length} items</div>
        </div>
        <div class="stat">
          <div class="label">Cash in Hand</div>
          <div class="value pos">${fmtMoney(cashInHand)}</div>
          <div class="muted small">actual bank balance</div>
        </div>
        <div class="stat">
          <div class="label">Total Receivables</div>
          <div class="value ${totalReceivable>0?'neg':''}">${fmtMoney(totalReceivable)}</div>
          <div class="muted small">unpaid by clients</div>
        </div>
        <div class="stat">
          <div class="label">Active Pipeline</div>
          <div class="value pos">${fmtMoney(pipelineValue)}</div>
          <div class="muted small">${activeProjects.length} upcoming shoots</div>
        </div>
      </div>

      <div class="card" style="background:linear-gradient(135deg,#1f2937,#374151);color:#fff">
        <div style="text-align:center;padding:20px 0">
          <div style="font-size:14px;opacity:.7;text-transform:uppercase;letter-spacing:2px">Total Studio Value</div>
          <div style="font-size:42px;font-weight:700;margin-top:8px">${fmtMoney(totalStudioValue)}</div>
          <div style="font-size:12px;opacity:.6;margin-top:6px">Equipment + Net Profit + Pipeline</div>
        </div>
      </div>

      <div class="card">
        <h2>Lifetime Performance (${completedIds.size} completed)</h2>
        <table>
          <tr><th style="width:200px">Gross Revenue</th><td class="num">${fmtMoney(lifetimeRevenue)}</td></tr>
          <tr><th style="color:#dc2626;">Less: Expenses</th><td class="num" style="color:#dc2626;">- ${fmtMoney(lifetimeExpenses)}</td></tr>
          <tr><th style="color:#dc2626;">Less: Member Payouts</th><td class="num" style="color:#dc2626;">- ${fmtMoney(lifetimeMemberPay)}</td></tr>
          <tr style="border-top:1px solid #ccc; font-weight:bold;">
            <th>Net Profit (Completed)</th><td class="num" style="color:#059669;">${fmtMoney(lifetimeNetProfit)}</td>
          </tr>
        </table>
      </div>

      <p class="muted small">
        <strong>How this is calculated:</strong><br>
        • <strong>Total Studio Value</strong> = The value of all your physical gear + money from completed shoots + money guaranteed from upcoming shoots.<br>
        • <strong>Cash in Hand</strong> = Actual money in your bank (Received minus Paid Out).<br>
        • <strong>Receivables</strong> = Money clients still owe you for both past and upcoming shoots.
      </p>
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
          <h3>Payment Details</h3>
          <p class="hint">These will appear on your Invoices.</p>
          <label>Bank Account No.</label>
          <input id="pf3-bank-acc" type="text" value="${esc(studio.bank_account_no || '')}" placeholder="e.g. 50100234567890">
          <div class="form-row">
            <div><label>IFSC Code</label><input id="pf3-bank-ifsc" type="text" value="${esc(studio.bank_ifsc || '')}" placeholder="e.g. HDFC0001234"></div>
            <div><label>UPI ID</label><input id="pf3-upi" type="text" value="${esc(studio.upi_id || '')}" placeholder="e.g. studio@okicici"></div>
          </div>

                   <hr>
          <h3>Branding</h3>
          <p class="hint">Upload PNG or JPG images (max 2MB). These appear on invoices and agreements.</p>
          <div class="form-row">
            <div>
              <label>Logo</label>
              <input id="pf3-logo-file" type="file" accept="image/png, image/jpeg" style="margin-bottom:4px">
              <img id="pf3-logo-preview" src="${esc(studio.logo_url || '')}" style="max-height:70px; display:${studio.logo_url ? 'block' : 'none'}; border-radius:6px; margin-top:4px;">
            </div>
            <div>
              <label>Signature</label>
              <input id="pf3-sign-file" type="file" accept="image/png, image/jpeg" style="margin-bottom:4px">
              <img id="pf3-sign-preview" src="${esc(studio.signature_url || '')}" style="max-height:70px; display:${studio.signature_url ? 'block' : 'none'}; border-radius:6px; margin-top:4px;">
            </div>
          </div>
          <label>Stamp</label>
          <input id="pf3-stamp-file" type="file" accept="image/png, image/jpeg" style="margin-bottom:4px">
          <img id="pf3-stamp-preview" src="${esc(studio.stamp_url || '')}" style="max-height:70px; display:${studio.stamp_url ? 'block' : 'none'}; border-radius:6px; margin-top:4px;">


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
      saveBtn.textContent = 'Saving...';
      
      try {
        // Upload images if new files were selected
        const logoFile = document.getElementById('pf3-logo-file').files[0];
        const signFile = document.getElementById('pf3-sign-file').files[0];
        const stampFile = document.getElementById('pf3-stamp-file').files[0];

        let logoUrl = studio.logo_url;
        let signUrl = studio.signature_url;
        let stampUrl = studio.stamp_url;

        if (logoFile) logoUrl = await uploadImage(logoFile, 'logo');
        if (signFile) signUrl = await uploadImage(signFile, 'signature');
        if (stampFile) stampUrl = await uploadImage(stampFile, 'stamp');

        const payload = {
          name:       document.getElementById('pf3-name').value.trim(),
          owner_name: document.getElementById('pf3-owner').value.trim() || null,
          phone:      document.getElementById('pf3-phone').value.trim() || null,
          email:      document.getElementById('pf3-email').value.trim() || null,
          address:    document.getElementById('pf3-address').value.trim() || null,
          currency:   document.getElementById('pf3-currency').value.trim() || 'BDT',
          timezone:   document.getElementById('pf3-tz').value.trim() || 'Asia/Dhaka',
          logo_url:   logoUrl,
          signature_url: signUrl,
          stamp_url:  stampUrl,
          bank_account_no: document.getElementById('pf3-bank-acc').value.trim() || null,
          bank_ifsc:       document.getElementById('pf3-bank-ifsc').value.trim() || null,
          upi_id:          document.getElementById('pf3-upi').value.trim() || null,
        };

        const { error } = await db.from('studio').update(payload)
          .eq('id', '00000000-0000-0000-0000-000000000001');
        if (error) throw error;
        
        alert('Profile saved.');
      
                
                // Update the top-left icon and sidebar name instantly
                loadBrandName(); 
                SCREENS.profile(el);
                
              } catch (err) {
                errBox.textContent = err.message;
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Profile';
              }
            }; // Closes pf3-form.onsubmit

            document.getElementById('pf3-logout').onclick = logout;

          } catch (err) {
            el.innerHTML = `<div class="card"><p class="error">${esc(err.message)}</p></div>`;
          }
        }; // Closes SCREENS.profile

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
// UPLOAD HELPER
// =====================================================================
async function uploadImage(file, folder) {
  if (!file) return null;
  if (file.size > 2 * 1024 * 1024) throw new Error('Image must be under 2MB');
  
  const ext = file.name.split('.').pop();
  // Unique filename: folder/timestamp-random.ext
  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
  
  const { error } = await db.storage.from('studio-assets').upload(fileName, file);
  if (error) throw error;
  
  const { data } = db.storage.from('studio-assets').getPublicUrl(fileName);
  return data.publicUrl;
}

// =====================================================================
// LOAD BRAND NAME & LOGO
// =====================================================================
async function loadBrandName() {
  const { data } = await db.from('studio').select('name, logo_url').single();
  
  if (data?.name) {
    document.getElementById('brand-name').textContent = data.name;
  }
  
  // Update the top-left Profile Button
  const profileBtn = document.getElementById('profile-btn');
  if (data?.logo_url) {
    profileBtn.innerHTML = `<img src="${data.logo_url}" style="width:24px; height:24px; border-radius:50%; object-fit:cover; border:1px solid #ccc;">`;
    profileBtn.style.padding = '2px';
  } else {
    profileBtn.innerHTML = '👤';
    profileBtn.style.padding = '6px 10px';
  }
}

// =====================================================================
// ===== START =====
// =====================================================================

// =====================================================================
// BLOCK 6A-2 — FULL INVOICE EDITOR
// =====================================================================

// Helper for number to words
function numberToWords(num) {
  if (num === 0) return 'Zero';
  const a = ['','One ','Two ','Three ','Four ', 'Five ','Six ','Seven ','Eight ','Nine ','Ten ','Eleven ','Twelve ','Thirteen ','Fourteen ','Fifteen ','Sixteen ','Seventeen ','Eighteen ','Nineteen '];
  const b = ['', '', 'Twenty','Thirty','Forty','Fifty', 'Sixty','Seventy','Eighty','Ninety'];
  num = num.toString().replace(/[\, ]/g,'');
  if (num != parseFloat(num)) return 'not a number';
  let n = ('000000000' + num).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
  if (!n) return;
  let str = '';
  str += (n[1] != 0) ? (a[Number(n[1])] || b[n[1][0]] + ' ' + a[n[1][1]]) + 'Crore ' : '';
  str += (n[2] != 0) ? (a[Number(n[2])] || b[n[2][0]] + ' ' + a[n[2][1]]) + 'Lakh ' : '';
  str += (n[3] != 0) ? (a[Number(n[3])] || b[n[3][0]] + ' ' + a[n[3][1]]) + 'Thousand ' : '';
  str += (n[4] != 0) ? (a[Number(n[4])] || b[n[4][0]] + ' ' + a[n[4][1]]) + 'Hundred ' : '';
  str += (n[5] != 0) ? ((str != '') ? 'and ' : '') + (a[Number(n[5])] || b[n[5][0]] + ' ' + a[n[5][1]]) : '';
  return str.trim() + ' Only';
}

SCREENS.invoice = async function(el, id) {
  if (!id) { el.innerHTML = '<p class="error">No invoice selected</p>'; return; }
  el.innerHTML = '<div class="loading">Loading invoice editor…</div>';

  try {
    const [invRes, studioRes, projRes] = await Promise.all([
      db.from('invoices').select('*, project:projects(name, client:clients(*))').eq('id', id).single(),
      db.from('studio').select('*').single(),
      db.from('projects').select('id, name, confirmed_amount, client:clients(name)').order('name')
    ]);
    
    if (invRes.error) throw invRes.error;
    const inv = invRes.data;
    const studio = studioRes.data || {};
    const projects = projRes.data || [];
    let meta = inv.metadata || {};
    if (!meta.items || !meta.items.length) {
      meta.items = [{ description: '', hsn: '', qty: 1, rate: 0 }];
    }

    // Generate UPI QR Code link
    const upiLink = studio.upi_id ? `upi://pay?pa=${encodeURIComponent(studio.upi_id)}&pn=${encodeURIComponent(studio.name)}` : '';

    el.innerHTML = `
      <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
        <a href="#invoices" class="small">← Back to Invoices</a>
        <div class="btn-group">
          <button id="inv-save" class="btn-success">Save Invoice</button>
          <button id="inv-print" class="btn-secondary">🖨 Print PDF</button>
        </div>
      </div>
      
      <div style="display:grid; grid-template-columns:minmax(0, 400px) minmax(0, 1fr); gap:20px; align-items:start;">
        
        <!-- LEFT PANEL: FORM -->
        <div class="card">
          <h2 style="margin-bottom:16px;">Invoice Setup</h2>
          
          <div class="form-row">
            <div>
              <label>Invoice No</label>
              <input type="text" value="${esc(inv.invoice_no)}" disabled style="background:#f3f4f6;">
            </div>
            <div>
              <label>Status</label>
              <select id="inv-status">
                <option value="draft" ${inv.status==='draft'?'selected':''}>Draft</option>
                <option value="sent" ${inv.status==='sent'?'selected':''}>Sent</option>
                <option value="paid" ${inv.status==='paid'?'selected':''}>Paid</option>
              </select>
            </div>
          </div>

          <label>Project / Client</label>
          <select id="inv-project" style="margin-bottom:12px;">
            <option value="">— select project —</option>
            ${projects.map(p => `<option value="${p.id}" data-client="${p.client?.name||''}" data-amt="${p.confirmed_amount||0}" ${inv.project_id===p.id?'selected':''}>${esc(p.name)} (${esc(p.client?.name||'')})</option>`).join('')}
          </select>

          <div class="form-row">
            <div><label>Issue Date</label><input id="inv-date" type="date" value="${inv.issue_date || todayISO()}"></div>
            <div><label>Due Date</label><input id="inv-due" type="date" value="${inv.due_date || ''}"></div>
          </div>
          <div class="form-row">
            <div><label>Payment Mode</label><input id="inv-pmode" type="text" value="${esc(meta.payment_mode||'Bank Transfer')}"></div>
            <div><label>Tax %</label><input id="inv-tax" type="number" value="0"></div>
          </div>
                     <div class="form-row">
            <div><label>Contact No. (For Inquiries)</label><input id="inv-contact" type="text" value="${esc(meta.contact_phone || studio.phone || '')}"></div>
            <div></div>
          </div>
          

          <hr style="margin:20px 0;">
          
          <div class="flex-between mb-2">
            <h3 style="margin:0;">Line Items</h3>
            <button type="button" id="inv-add-item" class="btn-secondary btn-sm">+ Add Item</button>
          </div>
          <div id="inv-items-list"></div>

          <label class="mt-2">Amount in Words (Optional)</label>
          <input id="inv-words" type="text" value="${esc(meta.amount_words||'')}" placeholder="Auto-generates if left blank">

          <p id="inv-error" class="error mt-1"></p>
        </div>

        <!-- RIGHT PANEL: A4 PREVIEW -->
        <div>
          <div class="card" style="position:sticky; top:20px; padding:10px; background:#e5e7eb;">
            <div id="print-area" style="
              width:100%; max-width:210mm; min-height:297mm; background:#fff; padding:15mm;
              box-shadow:0 4px 12px rgba(0,0,0,.15); position:relative;
              font-family: Arial, Helvetica, sans-serif; font-size:12px; color:#333;
              display:flex; flex-direction:column; box-sizing:border-box;
            ">
              
              <!-- Header -->
              <div style="display:flex; justify-content:space-between; border-bottom:1px solid #ccc; padding-bottom:15px;">
                <div style="display:flex; gap:15px;">
                  ${studio.logo_url ? `<img src="${studio.logo_url}" style="max-height:60px; max-width:60px; object-fit:contain;">` : ''}
                  <div>
                    <h1 style="margin:0 0 5px 0; font-size:22px; color:#000;">${esc(studio.name)}</h1>
                    <div style="color:#666; line-height:1.4;">
                      ${esc(studio.address || '')}<br>
                      ${esc(studio.email || '')} | ${esc(studio.phone || '')}
                    </div>
                  </div>
                </div>
                <div style="text-align:right;">
                  <h2 style="margin:0 0 5px 0; font-size:24px; letter-spacing:1px; color:#000;">TAX INVOICE</h2>
                  <div style="color:#666; font-size:10px; margin-bottom:10px;">ORIGINAL FOR RECIPIENT</div>
                  <div id="print-status" style="display:inline-block; padding:4px 10px; border:1px solid #059669; color:#059669; font-weight:bold; font-size:10px; border-radius:4px;">
                    ${inv.status.toUpperCase()}
                  </div>
                </div>
              </div>

              <!-- Info Bar -->
              <div style="display:flex; border-bottom:1px solid #ccc;">
                <div style="flex:1; border-right:1px solid #ccc; padding:10px 0;">
                  <div style="color:#888; font-size:10px;">Invoice No: <span style="color:#333; font-weight:bold;">${esc(inv.invoice_no)}</span></div>
                  <div style="color:#888; font-size:10px; margin-top:5px;">Invoice Date: <span style="color:#333; font-weight:bold;">${fmtDate(inv.issue_date)}</span></div>
                </div>
                <div style="flex:1; padding:10px 0 10px 15px;">
                  <div style="color:#888; font-size:10px;">Payment Mode: <span id="print-pmode" style="color:#333; font-weight:bold;"></span></div>
                  <div style="color:#888; font-size:10px; margin-top:5px;">Place of Supply: <span style="color:#333; font-weight:bold;">${esc(studio.address ? studio.address.split(',').pop().trim() : '')}</span></div>
                </div>
              </div>

              <!-- Bill To -->
              <div style="display:flex; border-bottom:1px solid #ccc;">
                <div style="flex:1; border-right:1px solid #ccc; padding:15px 0;">
                  <div style="color:#888; font-size:10px; margin-bottom:5px;">BILLED TO (CLIENT):</div>
                  <div id="print-client-name" style="font-weight:bold; font-size:14px; color:#000; margin-bottom:5px;"></div>
                  <div id="print-client-address" style="color:#666;"></div>
                  <div id="print-client-phone" style="color:#666; margin-top:5px;"></div>
                </div>
                <div style="flex:1; padding:15px 0 15px 15px;">
                  <div style="color:#888; font-size:10px; margin-bottom:5px;">SHIPPED / SUPPLIED TO:</div>
                  <div style="font-weight:bold; color:#000;">Same as Billing Address</div>
                </div>
              </div>

              <!-- Items Table -->
              <div style="flex-grow:1; margin-top:20px;">
                <table style="width:100%; border-collapse:collapse; font-size:11px;">
                  <thead>
                    <tr style="background:#000; color:#fff;">
                      <th style="padding:8px; text-align:center; width:30px;">#</th>
                      <th style="padding:8px; text-align:left;">Description of Service / Solution</th>
                      <th style="padding:8px; text-align:center; width:60px;">HSN/SAC</th>
                      <th style="padding:8px; text-align:center; width:50px;">Qty</th>
                      <th style="padding:8px; text-align:right; width:80px;">Rate (₹)</th>
                      <th style="padding:8px; text-align:right; width:90px;">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody id="print-items-body">
                    <!-- Rows rendered via JS -->
                  </tbody>
                </table>
              </div>

              <!-- Totals & Footer -->
              <div style="margin-top:20px; border-top:1px solid #ccc; padding-top:10px;">
                
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                  <!-- Left side: Amount in words & Bank -->
                  <div style="flex:1; padding-right:20px;">
                    <div style="font-style:italic; margin-bottom:15px; color:#555;">
                      Amount in Words: <strong id="print-words" style="color:#000;"></strong>
                    </div>
                    
                    <div style="display:flex; gap:15px; align-items:flex-start;">
                      ${upiLink ? `<img src="https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(upiLink)}" style="width:60px; height:60px; border:1px solid #ccc;">` : ''}
                      <div>
                        <div style="font-weight:bold; margin-bottom:2px;">Bank Transfer / Direct UPI</div>
                        <div style="color:#666; font-size:10px;">
                          ${esc(studio.name)}<br>
                          A/c: ${esc(studio.bank_account_no || '—')}<br>
                          IFSC: ${esc(studio.bank_ifsc || '—')}<br>
                          UPI: ${esc(studio.upi_id || '—')}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <!-- Right side: Calculation -->
                  <div style="width:250px;">
                    <div style="display:flex; justify-content:space-between; padding:4px 0;">
                      <span style="color:#666;">Taxable Value</span>
                      <span id="print-subtotal">₹0.00</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; padding:4px 0;">
                      <span style="color:#666;">Tax / GST</span>
                      <span id="print-tax">₹0.00</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; padding:8px 0; border-top:1px solid #ccc; border-bottom:2px solid #333; font-weight:bold; font-size:14px; margin-top:5px;">
                      <span>GRAND TOTAL</span>
                      <span id="print-total">₹0.00</span>
                    </div>
                  </div>
                </div>

                <!-- Terms and Signature -->
                <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:30px;">
                  <div style="flex:1; padding-right:20px; font-size:9px; color:#666;">
                    <div style="font-weight:bold; color:#000; margin-bottom:4px;">Terms & Conditions</div>
                    <ol style="padding-left:12px; margin:0;">
                      <li>This invoice is generated electronically and does not require a physical signature.</li>
                      <li>Payment is due within 7 days of the invoice date.</li>
                      <li>For any queries, please contact <span id="print-contact-phone">${esc(meta.contact_phone || studio.phone || '')}</span>.</li>
                    </ol>
                  </div>
                  <div style="text-align:center; width:200px;">
                    ${studio.signature_url ? `<img src="${studio.signature_url}" style="max-height:40px; margin-bottom:5px;">` : '<div style="height:40px;"></div>'}
                    <div style="border-top:1px solid #000; padding-top:4px; font-size:10px;">
                      <strong>AUTHORIZED SIGNATORY</strong><br>For ${esc(studio.name)}
                    </div>
                  </div>
                </div>

              </div>

            </div>
          </div>
        </div>

      </div>
    `;

    // --- Logic ---

    function renderItems() {
      const list = document.getElementById('inv-items-list');
      list.innerHTML = meta.items.map((item, i) => `
        <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:10px; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <strong style="font-size:12px; color:#374151;">Item ${i+1}</strong>
            <button type="button" class="btn-danger btn-sm" onclick="removeInvItem(${i})" style="padding:2px 6px; font-size:10px;">✕</button>
          </div>
          <input type="text" class="item-desc" data-idx="${i}" value="${esc(item.description)}" placeholder="Description of service" style="margin-bottom:6px; font-size:13px;">
          <div style="display:grid; grid-template-columns:1fr 50px 80px; gap:6px;">
            <input type="text" class="item-hsn" data-idx="${i}" value="${esc(item.hsn)}" placeholder="HSN/SAC" style="font-size:12px; margin:0;">
            <input type="number" class="item-qty" data-idx="${i}" value="${item.qty}" placeholder="Qty" style="font-size:12px; margin:0;">
            <input type="number" class="item-rate" data-idx="${i}" value="${item.rate}" placeholder="Rate" style="font-size:12px; margin:0;">
          </div>
        </div>
      `).join('');

      list.querySelectorAll('.item-desc').forEach(inp => inp.oninput = e => { meta.items[e.target.dataset.idx].description = e.target.value; updatePreview(); });
      list.querySelectorAll('.item-hsn').forEach(inp => inp.oninput = e => { meta.items[e.target.dataset.idx].hsn = e.target.value; updatePreview(); });
      list.querySelectorAll('.item-qty').forEach(inp => inp.oninput = e => { meta.items[e.target.dataset.idx].qty = Number(e.target.value); updatePreview(); });
      list.querySelectorAll('.item-rate').forEach(inp => inp.oninput = e => { meta.items[e.target.dataset.idx].rate = Number(e.target.value); updatePreview(); });
      
      updatePreview();
    }

    window.removeInvItem = function(idx) {
      meta.items.splice(idx, 1);
      renderItems();
    };

    document.getElementById('inv-add-item').onclick = () => {
      meta.items.push({ description: '', hsn: '', qty: 1, rate: 0 });
      renderItems();
    };

    function updatePreview() {
      const tbody = document.getElementById('print-items-body');
      let subtotal = 0;
      
      tbody.innerHTML = meta.items.map((item, i) => {
        const amt = (item.qty || 0) * (item.rate || 0);
        subtotal += amt;
        return `
          <tr style="border-bottom:1px solid #eee;">
            <td style="padding:8px; text-align:center; color:#666;">${i+1}</td>
            <td style="padding:8px;">${esc(item.description)}</td>
            <td style="padding:8px; text-align:center;">${esc(item.hsn)}</td>
            <td style="padding:8px; text-align:center;">${item.qty}</td>
            <td style="padding:8px; text-align:right;">${fmtMoney(item.rate)}</td>
            <td style="padding:8px; text-align:right;">${fmtMoney(amt)}</td>
          </tr>
        `;
      }).join('');

      const taxPct = Number(document.getElementById('inv-tax').value || 0);
      const taxAmt = subtotal * (taxPct / 100);
      const grandTotal = subtotal + taxAmt;

      document.getElementById('print-subtotal').textContent = '₹' + fmtMoney(subtotal);
      document.getElementById('print-tax').textContent = '₹' + fmtMoney(taxAmt);
      document.getElementById('print-total').textContent = '₹' + fmtMoney(grandTotal);

      const wordsInp = document.getElementById('inv-words');
      if (!wordsInp.value) {
        document.getElementById('print-words').textContent = numberToWords(Math.round(grandTotal));
      } else {
        document.getElementById('print-words').textContent = wordsInp.value;
      }

      const projSel = document.getElementById('inv-project');
      const selectedOpt = projSel.selectedOptions[0];
      if (selectedOpt && selectedOpt.value) {
        const client = selectedOpt.dataset.client;
        document.getElementById('print-client-name').textContent = client;
        document.getElementById('print-client-address').textContent = 'Address will appear here if saved in client profile.';
        document.getElementById('print-client-phone').textContent = '';
      } else {
        document.getElementById('print-client-name').textContent = '— Select a Project —';
        document.getElementById('print-client-address').textContent = '';
      }

            document.getElementById('print-pmode').textContent = document.getElementById('inv-pmode').value;
      document.getElementById('print-contact-phone').textContent = document.getElementById('inv-contact').value;
    }

    document.getElementById('inv-pmode').oninput = updatePreview;
    document.getElementById('inv-tax').oninput = updatePreview;
    document.getElementById('inv-words').oninput = updatePreview;
        document.getElementById('inv-contact').oninput = updatePreview;
    document.getElementById('inv-status').onchange = (e) => {
      document.getElementById('print-status').textContent = e.target.value.toUpperCase();
    };
    
    document.getElementById('inv-project').onchange = (e) => {
      const opt = e.target.selectedOptions[0];
      if (opt.value && meta.items.length === 1 && meta.items[0].rate === 0) {
        meta.items[0].description = opt.text.split(' (')[0];
        meta.items[0].rate = Number(opt.dataset.amt);
        renderItems();
      } else {
        updatePreview();
      }
    };

    document.getElementById('inv-save').onclick = async () => {
      const btn = document.getElementById('inv-save');
      const err = document.getElementById('inv-error');
      btn.disabled = true; btn.textContent = 'Saving...'; err.textContent = '';

      let subtotal = meta.items.reduce((sum, item) => sum + (item.qty * item.rate), 0);
      const taxPct = Number(document.getElementById('inv-tax').value || 0);
      const taxAmt = subtotal * (taxPct / 100);
      const grandTotal = subtotal + taxAmt;
      const words = document.getElementById('inv-words').value || numberToWords(Math.round(grandTotal));

      const payload = {
        project_id: document.getElementById('inv-project').value || null,
        issue_date: document.getElementById('inv-date').value,
        due_date: document.getElementById('inv-due').value || null,
        status: document.getElementById('inv-status').value,
        amount: subtotal,
        tax: taxAmt, // Save actual tax amount to DB
        total: grandTotal,
        metadata: {
          items: meta.items,
          payment_mode: document.getElementById('inv-pmode').value,
          amount_words: words,
         tax_pct: taxPct,
          contact_phone: document.getElementById('inv-contact').value // Save the percentage here so it loads correctly next time
        }
      };

      try {
        const { error } = await db.from('invoices').update(payload).eq('id', id);
        if (error) throw error;
        alert('Invoice saved successfully!');
        location.hash = '#invoices';
      } catch (e) {
        err.textContent = e.message;
      } finally {
        btn.disabled = false; btn.textContent = 'Save Invoice';
      }
    };

    document.getElementById('inv-print').onclick = () => window.print();

    renderItems();
    
    // Set the tax input value correctly from metadata if it exists
    if (meta.tax_pct) {
      document.getElementById('inv-tax').value = meta.tax_pct;
      updatePreview();
    }

  } catch (err) {
    el.innerHTML = `<div class="card"><p class="error">${esc(err.message)}</p></div>`;
  }
};

bootApp();
