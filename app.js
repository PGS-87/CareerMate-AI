import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
let auth, me = null, chatId = null, history = [], mode = 'login';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function md(t) { // minimal safe Markdown
  let h = esc(t).replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/^#{1,4} (.+)$/gm, '<p><b>$1</b></p>')
    .replace(/^\s*[*-] (.+)$/gm, '<li>$1</li>').replace(/^\s*\d+\. (.+)$/gm, '<li>$1</li>');
  return h.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>').replace(/\n{2,}/g, '<br>').replace(/\n/g, ' ');
}
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 2600); }
async function api(path, method = 'GET', body) {
  const token = await auth.currentUser?.getIdToken();
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed (' + r.status + ')');
  return j;
}
const busy = (btn, on, label) => { btn.disabled = on; if (label) btn.textContent = on ? 'Please wait…' : label; };
const friendly = e => ({ 'auth/invalid-credential': 'Email or password is incorrect.', 'auth/email-already-in-use': 'This email is already registered. Log in instead.', 'auth/weak-password': 'Password must be at least 6 characters.', 'auth/invalid-email': 'Enter a valid email address.', 'auth/too-many-requests': 'Too many attempts. Try again later.' }[e.code] || e.message);

// ---------- routing ----------
const views = { landing: '#v-landing', auth: '#v-auth', app: '#v-app' };
function show(v) { Object.entries(views).forEach(([k, s]) => $(s).hidden = k !== v); }
async function route() {
  const h = location.hash || '#top', user = auth?.currentUser;
  if (h === '#/login' || h === '#/signup') { if (user) return (location.hash = '#/app'); mode = h === '#/login' ? 'login' : 'signup'; setAuthMode(); show('auth'); return; }
  if (['#/app', '#/tutor', '#/career', '#/profile'].includes(h)) {
    if (!user) return (location.hash = '#/login');
    show('app'); const t = { '#/app': 'dash', '#/tutor': 'tutor', '#/career': 'career', '#/profile': 'profile' }[h];
    $$('[data-p]').forEach(s => s.hidden = s.dataset.p !== t); $$('aside a[data-t]').forEach(a => a.classList.toggle('on', a.dataset.t === t));
    if (t === 'dash') loadMe().catch(e => toast(e.message)); return;
  }
  show('landing'); if (h.length > 1 && !h.startsWith('#/')) $(h)?.scrollIntoView();
}
addEventListener('hashchange', route);

// ---------- auth ----------
function setAuthMode() {
  const s = mode === 'signup'; $$('.only-signup').forEach(e => e.hidden = !s);
  $('#authTitle').textContent = s ? 'Create your account' : 'Welcome back'; $('#authBtn').textContent = s ? 'Sign up' : 'Log in';
  $('#authSwitch').innerHTML = s ? 'Have an account? <a href="#/login"><u>Log in</u></a>' : 'New here? <a href="#/signup"><u>Create an account</u></a>'; $('#authErr').textContent = '';
}
$('#authForm').addEventListener('submit', async e => {
  e.preventDefault(); const err = $('#authErr'), btn = $('#authBtn'), label = btn.textContent;
  const email = $('#aEmail').value.trim(), pass = $('#aPass').value, name = $('#aName').value.trim(), edu = $('#aEdu').value;
  if (!/^\S+@\S+\.\S+$/.test(email)) return err.textContent = 'Enter a valid email address.';
  if (pass.length < 6) return err.textContent = 'Password must be at least 6 characters.';
  if (mode === 'signup' && (!name || !edu)) return err.textContent = 'Name and education level are required.';
  busy(btn, true, label); err.textContent = '';
  try {
    if (mode === 'signup') { await createUserWithEmailAndPassword(auth, email, pass); await api('/profile', 'PUT', { name, education: edu, interests: $('#aInt').value, skills: $('#aSk').value }); }
    else await signInWithEmailAndPassword(auth, email, pass);
    e.target.reset(); location.hash = '#/app';
  } catch (x) { err.textContent = friendly(x); } finally { busy(btn, false, label); }
});
$('#logout').onclick = async () => { await signOut(auth); me = null; location.hash = '#top'; };

// ---------- dashboard ----------
async function loadMe() {
  me = await api('/me'); const p = me.profile || {}, st = me.stats || {};
  $('#welcome').textContent = `Welcome back, ${(p.name || 'student').split(' ')[0]} 👋`;
  const stat = (n, l) => `<div class="card stat"><b>${n || 0}</b>${l}</div>`;
  $('#stats').innerHTML = stat(st.questions, 'Questions asked') + stat(st.plans, 'Study plans made') + stat(st.careers, 'Career analyses');
  const prem = me.plan === 'premium';
  $('#sub').innerHTML = `<span class="pill ${prem ? 'prem' : ''}">${prem ? 'Premium · ₹199/month' : 'Free plan'}</span>
    <p class="muted">Today: ${me.usage.tutor}/${me.limits.tutor} tutor messages · ${me.usage.career}/${me.limits.career} career analyses</p>
    <button class="btn ${prem ? 'ghost' : ''}" id="planBtn2">${prem ? 'Switch to Free' : 'Upgrade to Premium (demo)'}</button><p class="muted">Demo mode: no real payment is taken.</p>`;
  $('#planBtn2').onclick = async () => { await api('/plan', 'POST', { plan: prem ? 'free' : 'premium' }); toast('Plan updated'); loadMe(); };
  const subs = Object.entries(st.subjects || {}), max = Math.max(1, ...subs.map(s => s[1]));
  $('#prog').innerHTML = subs.length ? subs.map(([s, n]) => `<div>${esc(s)} <span class="muted">· ${n} sessions</span><div class="bar"><i style="width:${n / max * 100}%"></i></div></div>`).join('') : '<p class="muted">No activity yet. Ask the AI Tutor your first question.</p>';
  $('#recent').innerHTML = me.chats.length ? '<div class="list">' + me.chats.map(c => `<a href="#/tutor" data-chat="${esc(c.id)}">${esc(c.title)} <span class="pill">${esc(c.subject)}</span></a>`).join('') + '</div>' : '<p class="muted">No conversations yet.</p>';
  $$('[data-chat]').forEach(a => a.addEventListener('click', () => openChat(a.dataset.chat)));
  $('#recs').innerHTML = me.career ? me.career.paths.slice(0, 3).map(c => `<p><b>${esc(c.title)}</b> <span class="pill">${esc(c.match)}% match</span></p>`).join('') + '<a class="btn ghost" href="#/career">Run a new analysis</a>' : '<p class="muted">Run a career analysis to see recommendations.</p><a class="btn" href="#/career">Find careers</a>';
  if (!$('#cInt').value) { $('#cInt').value = p.interests || ''; $('#cSk').value = p.skills || ''; }
  $('#pName').value = p.name || ''; $('#pEdu').value = p.education || ''; $('#pInt').value = p.interests || ''; $('#pSk').value = p.skills || '';
}

// ---------- tutor ----------
const bubble = (role, text) => { const d = document.createElement('div'); d.className = 'm ' + role; d.innerHTML = role === 'user' ? esc(text) : md(text); $('#log').append(d); $('#log').scrollTop = 1e9; return d; };
function resetChat() { chatId = null; history = []; $('#log').innerHTML = '<p class="muted">New conversation. Ask anything.</p>'; }
async function openChat(id) {
  try { const c = await api('/chats/' + id); chatId = id; history = c.messages; $('#subject').value = c.subject; $('#log').innerHTML = ''; c.messages.forEach(m => bubble(m.role, m.text)); }
  catch (e) { toast(e.message); }
}
async function ask(kind) {
  const input = $('#msg'), text = input.value.trim(), err = $('#chatErr'); err.textContent = '';
  if (!text) return err.textContent = 'Type a question or goal first.';
  if ($('#log .muted')) $('#log').innerHTML = '';
  bubble('user', text); input.value = ''; const wait = bubble('model', ''); wait.classList.add('dots'); $$('#chatForm button').forEach(b => b.disabled = true);
  try {
    const r = await api('/tutor', 'POST', { message: text, subject: $('#subject').value, mode: kind, chatId, history });
    chatId = r.chatId; history.push({ role: 'user', text }, { role: 'model', text: r.reply }); wait.classList.remove('dots'); wait.innerHTML = md(r.reply);
  } catch (e) { wait.remove(); err.textContent = e.message; } finally { $$('#chatForm button').forEach(b => b.disabled = false); $('#log').scrollTop = 1e9; }
}
$('#chatForm').addEventListener('submit', e => { e.preventDefault(); ask('ask'); });
$('#planBtn').onclick = () => ask('plan'); $('#newChat').onclick = resetChat;

// ---------- career ----------
$('#careerForm').addEventListener('submit', async e => {
  e.preventDefault(); const err = $('#careerErr'), btn = $('#careerBtn'), out = $('#careerOut'); err.textContent = '';
  const interests = $('#cInt').value.trim(); if (!interests) return err.textContent = 'Enter at least one interest.';
  busy(btn, true, 'Find my career paths'); out.innerHTML = '<p class="muted">Analysing your profile…</p>';
  try {
    const r = await api('/career', 'POST', { interests, skills: $('#cSk').value });
    const list = a => '<ul>' + (a || []).map(x => `<li>${esc(x)}</li>`).join('') + '</ul>';
    out.innerHTML = `<div class="card path"><p>${esc(r.summary)}</p></div>` + r.paths.map(p => `<article class="card path"><h3>${esc(p.title)} <span class="pill">${esc(p.match)}% match</span></h3><p>${esc(p.why)}</p>
      <h4>Skills to learn</h4>${list(p.skillsToLearn)}<h4>Opportunities</h4>${list(p.opportunities)}
      ${p.roadmap?.length ? '<h4>Learning roadmap</h4>' + p.roadmap.map(s => `<p><b>${esc(s.phase)}</b></p>${list(s.steps)}`).join('') : '<div class="lock">Detailed roadmaps are part of Premium. <a href="#/app"><u>Upgrade on your dashboard</u></a></div>'}</article>`).join('');
  } catch (x) { out.innerHTML = ''; err.textContent = x.message; } finally { busy(btn, false, 'Find my career paths'); }
});

// ---------- profile ----------
$('#profForm').addEventListener('submit', async e => {
  e.preventDefault(); const err = $('#profErr'); err.textContent = '';
  if (!$('#pName').value.trim() || !$('#pEdu').value) return err.textContent = 'Name and education level are required.';
  try { await api('/profile', 'PUT', { name: $('#pName').value, education: $('#pEdu').value, interests: $('#pInt').value, skills: $('#pSk').value }); toast('Profile saved'); loadMe(); }
  catch (x) { err.textContent = x.message; }
});

// ---------- boot ----------
(async () => {
  try {
    const cfg = await (await fetch('/api/config')).json();
    auth = getAuth(initializeApp(cfg));
    onAuthStateChanged(auth, () => route());
  } catch { document.body.insertAdjacentHTML('afterbegin', '<p class="err" style="padding:1rem">Cannot reach the server or Firebase config is missing. See README.</p>'); show('landing'); }
})();
