require('dotenv').config();
const express = require('express'), path = require('path'), admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT || './serviceAccountKey.json'))) });
const db = admin.firestore(), FV = admin.firestore.FieldValue, app = express();
const LIMITS = { free: { tutor: 10, career: 3 }, premium: { tutor: 200, career: 50 } };
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (_, r) => r.json({ apiKey: process.env.FIREBASE_WEB_API_KEY, authDomain: process.env.FIREBASE_AUTH_DOMAIN, projectId: process.env.FIREBASE_PROJECT_ID, appId: process.env.FIREBASE_APP_ID }));

// Verify Firebase ID token on every /api route below
app.use('/api', async (req, res, next) => {
  try { req.uid = (await admin.auth().verifyIdToken((req.headers.authorization || '').replace('Bearer ', ''))).uid; next(); }
  catch { res.status(401).json({ error: 'Please log in again.' }); }
});

const ref = uid => db.collection('users').doc(uid);
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(e.status || 500).json({ error: e.message || 'Server error' }); });
const fail = (status, message) => Object.assign(new Error(message), { status });
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);

async function gemini(system, contents, json) {
  if (!process.env.GEMINI_API_KEY) throw fail(500, 'Server is missing GEMINI_API_KEY.');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: json ? { responseMimeType: 'application/json' } : {} })
  });
  const j = await r.json();
  if (!r.ok) throw fail(502, 'AI service error: ' + (j.error?.message || r.status));
  return (j.candidates?.[0]?.content?.parts || []).map(p => p.text).join('');
}

// Reads profile, resets daily usage, and enforces plan limits
async function userWithQuota(uid, kind) {
  const snap = await ref(uid).get(), u = snap.exists ? snap.data() : {};
  const today = new Date().toISOString().slice(0, 10), plan = u.plan || 'free';
  const usage = u.usage?.date === today ? u.usage : { date: today, tutor: 0, career: 0 };
  if (kind && usage[kind] >= LIMITS[plan][kind]) throw fail(429, `Daily ${kind} limit reached on the ${plan} plan. Upgrade for more.`);
  return { u, plan, usage };
}

app.get('/api/me', wrap(async (req, res) => {
  const { u, plan, usage } = await userWithQuota(req.uid);
  const chats = await ref(req.uid).collection('chats').orderBy('updatedAt', 'desc').limit(5).get();
  res.json({ profile: u.profile || null, plan, usage, limits: LIMITS[plan], stats: u.stats || {}, career: u.career || null,
    chats: chats.docs.map(d => ({ id: d.id, title: d.data().title, subject: d.data().subject })) });
}));

app.put('/api/profile', wrap(async (req, res) => {
  const p = { name: clean(req.body.name, 60), education: clean(req.body.education, 60), interests: clean(req.body.interests, 300), skills: clean(req.body.skills, 300) };
  if (!p.name || !p.education) throw fail(400, 'Name and education level are required.');
  await ref(req.uid).set({ profile: p }, { merge: true });
  res.json({ profile: p });
}));

app.get('/api/chats/:id', wrap(async (req, res) => {
  const d = await ref(req.uid).collection('chats').doc(req.params.id).get();
  if (!d.exists) throw fail(404, 'Conversation not found.');
  res.json({ id: d.id, ...d.data() });
}));

app.post('/api/tutor', wrap(async (req, res) => {
  const message = clean(req.body.message, 2000), subject = clean(req.body.subject, 60) || 'General', mode = req.body.mode === 'plan' ? 'plan' : 'ask';
  if (!message) throw fail(400, 'Please type a question.');
  const { u, plan, usage } = await userWithQuota(req.uid, 'tutor');
  const prem = plan === 'premium';
  const system = `You are CareerMate AI, a patient tutor for college students in India. Subject: ${subject}. Student level: ${u.profile?.education || 'college'}. ` +
    (mode === 'plan' ? `Create a ${prem ? 'detailed day-by-day study plan with goals, practice tasks, revision slots and a self-test at the end' : 'short, basic weekly study plan'} for the student's goal.`
      : `Explain in simple language with numbered steps and one small example. ${prem ? 'Go deeper: add common mistakes, a practice problem with solution, and further reading.' : 'Keep it concise.'}`) + ' Use Markdown.';
  const hist = (Array.isArray(req.body.history) ? req.body.history : []).slice(-8).map(m => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: clean(m.text, 3000) }] }));
  const reply = await gemini(system, [...hist, { role: 'user', parts: [{ text: message }] }]);
  const chatRef = req.body.chatId ? ref(req.uid).collection('chats').doc(String(req.body.chatId)) : ref(req.uid).collection('chats').doc();
  await chatRef.set({ title: message.slice(0, 60), subject, updatedAt: FV.serverTimestamp(),
    messages: FV.arrayUnion({ role: 'user', text: message, t: Date.now() }, { role: 'model', text: reply, t: Date.now() + 1 }) }, { merge: true });
  await ref(req.uid).set({ usage: { ...usage, tutor: usage.tutor + 1 },
    stats: { questions: FV.increment(mode === 'ask' ? 1 : 0), plans: FV.increment(mode === 'plan' ? 1 : 0), subjects: { [subject]: FV.increment(1) } } }, { merge: true });
  res.json({ reply, chatId: chatRef.id });
}));

app.post('/api/career', wrap(async (req, res) => {
  const interests = clean(req.body.interests, 400), skills = clean(req.body.skills, 400);
  if (!interests) throw fail(400, 'Enter at least one interest.');
  const { plan, usage } = await userWithQuota(req.uid, 'career');
  const prem = plan === 'premium';
  const system = `You are a career counsellor for Indian college students. Return ONLY JSON: {"summary":string,"paths":[{"title":string,"why":string,"match":number(0-100),"skillsToLearn":[string],` +
    `"roadmap":[{"phase":string,"steps":[string]}],"opportunities":[string]}]}. Give ${prem ? '4 paths, each with a 3-4 phase roadmap, 5-6 skills and 4 opportunities (roles, internships, platforms, exams)' : '2 paths, with 3 skills and 2 opportunities, and an empty roadmap array'}.`;
  let data;
  try { data = JSON.parse(await gemini(system, [{ role: 'user', parts: [{ text: `Interests: ${interests}\nSkills: ${skills || 'none yet'}` }] }], true)); }
  catch (e) { if (e.status) throw e; throw fail(502, 'AI returned an unreadable answer. Please try again.'); }
  if (!Array.isArray(data.paths)) throw fail(502, 'AI returned an unexpected format. Please try again.');
  const career = { ...data, plan, at: Date.now() };
  await ref(req.uid).set({ usage: { ...usage, career: usage.career + 1 }, career, stats: { careers: FV.increment(1) } }, { merge: true });
  res.json(career);
}));

// Demo only: no real payment is processed
app.post('/api/plan', wrap(async (req, res) => {
  const plan = req.body.plan === 'premium' ? 'premium' : 'free';
  await ref(req.uid).set({ plan }, { merge: true });
  res.json({ plan });
}));

app.listen(process.env.PORT || 3000, () => console.log('CareerMate AI running on http://localhost:' + (process.env.PORT || 3000)));
