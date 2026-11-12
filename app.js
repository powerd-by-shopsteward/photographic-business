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
