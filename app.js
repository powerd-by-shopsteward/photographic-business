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
