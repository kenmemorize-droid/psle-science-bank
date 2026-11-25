// Student app: sign in, practise by topic, mark, and review wrong answers on spaced gaps.
// Plain modules, no build step. The rules live in logic.js; the back end is chosen in store.js.
import * as L from "./logic.js";
import { questionHtml, radarHtml, pct, esc, fmt } from "./render.js";
import { makeStore } from "./store.js";

const view = document.getElementById("view");
const who = document.getElementById("who");
const REVIEW_BATCH = 20;
const THEME_BATCH = 10;  // questions in a run started by tapping a theme
const THEME_ORDER = ["Diversity", "Cycles", "Systems", "Interactions", "Energy"];   // corners of the pentagon, from the top, clockwise

let store, user, index, intervals, topics, sources;
let themes = [];         // the themes that have a corner on the pentagon
let qInfo = new Map();   // question id -> {theme, marks}, for the theme stats
let filters = null;      // practice set-up choices, kept while the page is open
let lastTried = new Map();
let session = null;      // {mode, qs, pos, done: [{q, outcome, queue}], queue: Map, finished}
let st = null;           // state of the question on screen
let saving = 0;          // answers still on their way to the database

const topicName = (id) => { const t = topics.get(id); return t ? t.topic + (t.sub_topic ? " — " + t.sub_topic : "") : "Unclassified"; };
const sourceName = (id) => { const s = sources.get(id); return s ? `${s.level} · ${s.school} · ${s.paper_type} ${s.year || "past year"}` : ""; };
const dayText = (iso) => new Date(iso).toLocaleDateString("en-SG", { weekday: "long", day: "numeric", month: "short" });
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function paint(html, keepScroll) {
  const y = window.scrollY;
  view.innerHTML = html;
  window.scrollTo(0, keepScroll ? y : 0);
}
function showError(e) {
  console.error(e);
  view.querySelectorAll(".alert").forEach((n) => n.remove());
  view.insertAdjacentHTML("afterbegin", `<div class="alert" role="alert">${esc(e && e.message ? e.message : String(e))}</div>`);
  window.scrollTo(0, 0);
}
const guard = (fn) => async (...args) => { try { await fn(...args); } catch (e) { showError(e); } };
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

function renderWho() {
  who.innerHTML = user
    ? `${store.mode === "trial" ? '<span class="pill">Trial mode</span>' : ""}<span class="name">${esc(user.name)}</span><button type="button" class="link" data-act="signout">Sign out</button>`
    : "";
}

// ---- sign in ---------------------------------------------------------------------------------
async function showSignIn() {
  session = null;
  renderWho();
  if (store.mode === "trial") {
    const levels = [...new Set((await store.catalog()).sources.map((s) => s.level))].sort();
    paint(`<section class="card narrow"><h1>Science Practice</h1>
      <p class="notice">Trial mode: no database is connected yet. Your answers are saved in this browser only.</p>
      <form data-form="signin">
        <label>Your name<input name="name" autocomplete="off" required maxlength="40"></label>
        <label>Your level<select name="level">${levels.map((l) => `<option>${l}</option>`).join("")}</select></label>
        <button class="btn primary" type="submit">Start</button>
      </form></section>`);
  } else {
    paint(`<section class="card narrow"><h1>Science Practice</h1>
      <form data-form="signin">
        <label>Username<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn primary" type="submit">Sign in</button>
      </form>
      <p class="sub">Your teacher gives you your username and password.</p></section>`);
  }
}

async function loadBase() {
  const [cat, idx, iv] = await Promise.all([store.catalog(), store.questionIndex(), store.intervals()]);
  topics = new Map(cat.topics.map((t) => [t.id, t]));
  sources = new Map(cat.sources.map((s) => [s.id, s]));
  index = idx;
  intervals = iv;
  const seen = new Set(cat.topics.map((t) => t.theme).filter(Boolean));
  themes = THEME_ORDER.filter((t) => seen.has(t)).concat([...seen].filter((t) => !THEME_ORDER.includes(t)));
  qInfo = new Map(idx.map((r) => [r.id, { theme: themeOf(r), marks: r.marks }]));
  renderWho();
}
function themeOf(row) { const t = topics.get(row.primary_topic_id); return t ? t.theme : null; }

// ---- streak ----------------------------------------------------------------------------------
const ICE = "❄︎";   // a snowflake, drawn as text so that it takes the colour of the page
function streakHtml(sk) {
  const left = sk.goal - sk.today;
  const saved = sk.week[5].state === "frozen";
  let line;
  if (sk.doneToday) line = "Done for today. Come back tomorrow to keep it going.";
  else if (sk.days) line = `${saved ? "A freeze saved your streak yesterday. " : ""}Answer ${plural(left, "more question")} today to keep it going.`;
  else line = `Answer ${plural(left, sk.today ? "more question" : "question")} today to start a streak.`;
  const mark = { done: "✓", frozen: ICE, missed: "×", open: "", none: "" };
  const word = { done: "done", frozen: "saved by a freeze", missed: "missed", open: "not done yet", none: "before your streak" };
  const d = new Date();
  const week = sk.week.map((w) => {
    const name = new Date(d.getFullYear(), d.getMonth(), d.getDate() - w.back).toLocaleDateString("en-SG", { weekday: "short" });
    return `<li class="${w.state}${w.back ? "" : " today"}" title="${name}: ${word[w.state]}"><span class="wd">${name.slice(0, 2)}</span><span class="wm" aria-hidden="true">${mark[w.state]}</span><span class="vh">${word[w.state]}</span></li>`;
  }).join("");
  const ice = Array.from({ length: L.FREEZE_MAX }, (_, i) => `<span class="ice${i < sk.freezes ? " on" : ""}" aria-hidden="true">${ICE}</span>`).join("");
  return `<div class="streak">
      <p class="streak-n${sk.days ? "" : " none"}"><span class="flame" aria-hidden="true">🔥</span><b>${sk.days}</b><span>day streak</span></p>
      <p class="sub">${line}</p>
      <div class="today"><progress max="${sk.goal}" value="${Math.min(sk.today, sk.goal)}"></progress><span>${Math.min(sk.today, sk.goal)} of ${sk.goal} today</span></div>
      <ol class="week" aria-label="The last 7 days">${week}</ol>
      <p class="freezes">${ice}<span>${sk.freezes} of ${L.FREEZE_MAX} freezes</span></p>
      <p class="sub">A freeze saves your streak when you miss a day. It is used by itself. You earn one for every ${L.FREEZE_EVERY} days of streak.</p>
    </div>`;
}

// ---- home ------------------------------------------------------------------------------------
async function showHome() {
  session = null;
  const [attempts, queue] = await Promise.all([store.attempts(), store.queue()]);
  const now = Date.now(), live = new Set(index.map((r) => r.id));
  const due = queue.filter((r) => L.isDue(r, now) && live.has(r.question_id));
  const later = queue.filter((r) => r.status === "due" && !L.isDue(r, now));
  const mastered = queue.filter((r) => r.status === "mastered").length;
  const next = later.map((r) => r.due_at).sort()[0];
  const tried = new Set(attempts.map((a) => a.question_id)).size;
  const right = attempts.filter((a) => a.result === "correct").length;
  const stats = L.themeStats(attempts, qInfo, themes);
  paint(`<h1>Hello, ${esc(user.name)}</h1>
    <section class="card">
      <div class="profile">
        <div class="radar-box">
          <h2>Your science pentagon</h2>
          ${radarHtml(stats, { tap: true })}
        </div>
        ${streakHtml(L.streak(attempts, now))}
      </div>
      <p class="sub" data-theme-note role="status">A side grows when you answer more questions in that theme and get them right. It looks at your last ${L.STAT_WINDOW} questions in the theme. Tap a theme to practise it.</p>
      <div class="themes">${stats.map((s) => `<button type="button" class="theme-btn" data-act="theme" data-theme="${esc(s.theme)}">
        <span class="t-name">${esc(s.theme)}</span><b>${pct(s.value)}%</b><small>${s.tried} of ${L.STAT_WINDOW} questions</small></button>`).join("")}</div>
    </section>
    <section class="card">
      <h2>Review</h2>
      <p class="big">${due.length ? `${plural(due.length, "question")} to review today` : "Nothing to review today"}</p>
      <p class="sub">${later.length ? `${plural(later.length, "question")} will come back later. The next one is due on ${dayText(next)}.` : "Questions you get wrong come back here after 1 day, then 3 days, then 7 days."}${mastered ? ` ${plural(mastered, "question")} mastered.` : ""}</p>
      ${due.length ? '<a class="btn primary" href="#review">Start review</a>' : ""}
    </section>
    <section class="card">
      <h2>Practise by topic</h2>
      <p class="sub">Choose a topic and answer questions from school papers.</p>
      <a class="btn ${due.length ? "" : "primary"}" href="#practice">Choose questions</a>
    </section>
    <section class="card">
      <h2>So far</h2>
      <dl class="stats">
        <div><dt>Questions tried</dt><dd>${tried}</dd></div>
        <div><dt>Answers given</dt><dd>${attempts.length}</dd></div>
        <div><dt>Fully correct</dt><dd>${right}</dd></div>
        <div><dt>On review list</dt><dd>${due.length + later.length}</dd></div>
      </dl>
      ${store.mode === "trial" && attempts.length ? '<button type="button" class="link" data-act="reset">Clear my trial answers</button>' : ""}
    </section>`);
}

// ---- practice set-up -------------------------------------------------------------------------
async function loadLastTried() {
  const attempts = await store.attempts();
  lastTried = new Map();
  attempts.forEach((a) => lastTried.set(a.question_id, Math.max(lastTried.get(a.question_id) || 0, Date.parse(a.answered_at))));
}
// Tapping a theme on the pentagon: a short run in that theme, at the student's level when the
// bank has questions there, the ones never tried first.
let starting = false;
async function startTheme(theme) {
  if (starting) return;
  starting = true;
  try {
    const note = view.querySelector("[data-theme-note]");
    if (note) note.textContent = `Loading ${theme} questions…`;
    await loadLastTried();
    const all = index.filter((r) => themeOf(r) === theme), mine = all.filter((r) => r.level === user.level);
    await startSession("practice", L.pickQuestions(mine.length ? mine : all, lastTried, THEME_BATCH).map((r) => r.id));
  } finally { starting = false; }
}
async function showSetup() {
  session = null;
  await loadLastTried();
  const levels = [...new Set(index.map((r) => r.level))].sort();
  if (!filters) filters = { level: levels.includes(user.level) ? user.level : "", topic: 0, section: "", source: "", count: 10 };
  paintSetup();
}
function paintSetup() {
  const f = filters;
  const levels = [...new Set(index.map((r) => r.level))].sort();
  const atLevel = index.filter((r) => !f.level || r.level === f.level);
  const count = (extra) => atLevel.filter((r) => L.matches(r, { ...f, ...extra })).length;
  // topics and schools that have questions at this level
  const topicIds = new Set(atLevel.flatMap((r) => [r.primary_topic_id, ...r.secondary_topic_ids]));
  const srcIds = new Set(atLevel.map((r) => r.source_id));
  if (f.topic && !topicIds.has(f.topic)) f.topic = 0;
  if (f.source && ![...srcIds].some((id) => String(id) === String(f.source))) f.source = "";
  let topicOpts = `<option value="0">All topics (${count({ topic: 0 })})</option>`, theme = null;
  [...topics.values()].filter((t) => topicIds.has(t.id)).forEach((t) => {
    if (t.theme !== theme) { topicOpts += `${theme ? "</optgroup>" : ""}<optgroup label="${esc(t.theme)}">`; theme = t.theme; }
    topicOpts += `<option value="${t.id}" ${f.topic === t.id ? "selected" : ""}>${esc(topicName(t.id))} (${count({ topic: t.id })})</option>`;
  });
  if (theme) topicOpts += "</optgroup>";
  const schools = [...sources.values()].filter((s) => srcIds.has(s.id)).sort((a, b) => (a.school + a.paper_type).localeCompare(b.school + b.paper_type));
  const rows = index.filter((r) => L.matches(r, f));
  const fresh = rows.filter((r) => !lastTried.has(r.id)).length;
  const sel = (v, cur) => (String(v) === String(cur) ? "selected" : "");
  paint(`<h1>Practise by topic</h1>
    <form class="card" data-form="setup">
      <div class="grid">
        <label>Level<select name="level"><option value="">All levels</option>${levels.map((l) => `<option ${sel(l, f.level)}>${l}</option>`).join("")}</select></label>
        <label>Topic<select name="topic">${topicOpts}</select></label>
        <label>Type of question<select name="section"><option value="">Both types</option><option value="mcq" ${sel("mcq", f.section)}>Multiple choice</option><option value="open" ${sel("open", f.section)}>Open-ended</option></select></label>
        <label>School paper<select name="source"><option value="">All schools</option>${schools.map((s) => `<option value="${esc(s.id)}" ${sel(s.id, f.source)}>${esc(`${s.school} · ${s.paper_type} ${s.year || "past year"}${f.level ? "" : " (" + s.level + ")"}`)}</option>`).join("")}</select></label>
        <label>How many questions<select name="count">${[5, 10, 20].map((n) => `<option ${sel(n, f.count)}>${n}</option>`).join("")}</select></label>
      </div>
      <p class="sub" role="status">${rows.length ? `${plural(rows.length, "question")} match${rows.length === 1 ? "es" : ""}. You have not tried ${fresh} of them.` : "No questions match. Change a choice above."}</p>
      <button class="btn primary" type="submit" ${rows.length ? "" : "disabled"}>Start</button>
    </form>`, true);
}

// ---- a run of questions (practice or review) ------------------------------------------------------
async function startSession(mode, ids) {
  const [qs, queue, before] = await Promise.all([store.questions(ids), store.queue(), store.attempts()]);
  if (!qs.length) return go("#home");
  // before: the answers given up to now, to show at the end how the pentagon and the streak moved
  session = { mode, qs, pos: 0, done: [], queue: new Map(queue.map((r) => [r.question_id, r])), finished: false, before };
  preload(qs[0]);
  newState();
  go("#session");
}
async function startReview() {
  const queue = await store.queue();
  const now = Date.now(), live = new Set(index.map((r) => r.id));
  const due = queue.filter((r) => L.isDue(r, now) && live.has(r.question_id)).sort((a, b) => (a.due_at < b.due_at ? -1 : 1)).slice(0, REVIEW_BATCH);
  if (!due.length) return go("#home");
  await startSession("review", due.map((r) => r.question_id));
}
const current = () => session.qs[session.pos];
const fetched = new Set();
// Fetch the pictures of a question before it is shown, so that "Next question" does not wait for them.
function preload(q) {
  if (!q) return;
  q.images.forEach((im) => {
    if (!im.url || fetched.has(im.url)) return;
    fetched.add(im.url);
    new Image().src = im.url;
  });
}
function newState() {
  const n = L.markUnits(current()).length;
  st = { selected: null, revealed: false, choices: Array(n).fill(null), typed: Array(n).fill(""), kwMode: Array(n).fill(false), saved: null };
}

function feedbackHtml(q) {
  const { outcome: o, queue: row } = st.saved;
  const line = q.section === "mcq"
    ? (o.result === "correct" ? "Correct." : `Not this time. The answer is (${q.correct_option}).`)
    : `You gave yourself ${fmt(o.marks_awarded)} out of ${fmt(q.marks)}.`;
  let follow = "";
  if (row && row.status === "mastered") follow = "You have mastered this question, so it leaves your review list.";
  else if (row && o.result === "correct") follow = `It will come back for another check on ${dayText(row.due_at)}.`;
  else if (row) follow = `It is on your review list and will come back on ${dayText(row.due_at)}.`;
  return `<div class="feedback ${o.result}" role="status"><strong>${line}</strong> ${follow}</div>`;
}

function showQuestion(keepScroll) {
  const q = current(), n = session.qs.length;
  preload(session.qs[session.pos + 1]);
  let actions;
  if (st.saved) actions = `${feedbackHtml(q)}<button type="button" class="btn primary" data-act="next">${session.pos + 1 < n ? "Next question" : "See my results"}</button>`;
  else if (q.section === "mcq") actions = `<button type="button" class="btn primary" data-act="check" ${st.selected == null ? "disabled" : ""}>Check my answer</button>`;
  else if (!st.revealed) actions = '<button type="button" class="btn primary" data-act="reveal">Show the suggested solution</button>';
  else {
    const ready = st.choices.every(Boolean);
    actions = `${ready ? "" : '<p class="hint">Mark every part to go on.</p>'}<button type="button" class="btn primary" data-act="save" ${ready ? "" : "disabled"}>Save my marks</button>`;
  }
  paint(`<div class="progress"><span>${session.mode === "review" ? "Review" : "Practice"} · Question ${session.pos + 1} of ${n}</span>
      <progress max="${n}" value="${session.pos + (st.saved ? 1 : 0)}"></progress></div>
    ${questionHtml(q, st, { source: sourceName(q.source_id), topic: topicName(q.primary_topic_id) })}
    <div class="actions">${actions}</div>`, keepScroll);
  if (st.saved && keepScroll) view.querySelector(".feedback").scrollIntoView({ block: "nearest" });
}

// The result is shown at once; the answer is sent to the database behind it. If the sending
// fails it is tried again, and the student is told only if it still fails.
function finish(outcome) {
  if (st.saved) return;
  const q = current(), mode = session.mode;
  const row = L.afterAttempt(session.queue.get(q.id) || null, outcome.result, mode, intervals, Date.now());
  const full = row ? { question_id: q.id, ...row } : null;
  if (full) session.queue.set(q.id, full);
  st.saved = { outcome, queue: row };
  session.done.push({ q, outcome, queue: row, at: new Date().toISOString() });
  showQuestion(true);
  send(() => store.addAttempt({ question_id: q.id, mode, ...outcome }));
  if (full) send(() => store.saveQueue(full));
}
async function send(write) {
  saving += 1;
  try {
    for (let tries = 1; ; tries += 1) {
      try { await write(); return; }
      catch (e) {
        if (tries === 3) { showError(new Error("One of your answers could not be saved. Check the internet connection, then carry on.")); return; }
        await new Promise((r) => setTimeout(r, 1500 * tries));
      }
    }
  } finally { saving -= 1; }
}
window.addEventListener("beforeunload", (e) => { if (saving) { e.preventDefault(); e.returnValue = ""; } });

function showSummary() {
  const done = session.done;
  const got = done.reduce((a, d) => a + d.outcome.marks_awarded, 0), out = done.reduce((a, d) => a + d.q.marks, 0);
  const queued = done.filter((d) => d.queue && d.queue.status === "due" && d.outcome.result !== "correct").length;
  const mastered = done.filter((d) => d.queue && d.queue.status === "mastered").length;
  const label = { correct: "Correct", partial: "Partly", wrong: "Wrong" };
  // the pentagon and the streak, before and after this run
  const after = session.before.concat(done.map((d) => ({ question_id: d.q.id, marks_awarded: d.outcome.marks_awarded, answered_at: d.at })));
  const was = L.themeStats(session.before, qInfo, themes), is = L.themeStats(after, qInfo, themes);
  const moved = is.map((s, i) => ({ theme: s.theme, from: pct(was[i].value), to: pct(s.value) })).filter((m) => m.from !== m.to);
  const now = Date.now(), s0 = L.streak(session.before, now), s1 = L.streak(after, now);
  let streakLine;
  if (s1.doneToday && !s0.doneToday) streakLine = `<span aria-hidden="true">🔥</span> Today is done. Your streak is now ${plural(s1.days, "day")}.${s1.freezes > s0.freezes ? " You earned a freeze." : ""}`;
  else if (s1.doneToday) streakLine = `<span aria-hidden="true">🔥</span> Your streak is ${plural(s1.days, "day")}.`;
  else streakLine = `${s1.today} of ${s1.goal} answers today. ${plural(s1.goal - s1.today, "more answer")} ${s1.days ? "will keep your streak going" : "will start a streak"}.`;
  const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const growth = `<section class="card">
      <h2>Your science pentagon</h2>
      <div class="radar-box">${radarHtml(is, { before: was, calm })}</div>
      <p class="big">${moved.length ? moved.map((m) => `<span class="move ${m.to > m.from ? "up" : "down"}">${esc(m.theme)} ${m.from}% → ${m.to}%</span>`).join("") : "No side moved this time."}</p>
      <p class="sub">${moved.length ? "The dashed line shows where you were before this run. " : ""}${streakLine}</p>
    </section>`;
  paint(`<h1>${session.mode === "review" ? "Review done" : "Practice done"}</h1>
    <section class="card">
      <p class="big">${fmt(got)} out of ${fmt(out)} marks</p>
      <p class="sub">${plural(done.filter((d) => d.outcome.result === "correct").length, "question")} fully correct out of ${done.length}.
        ${queued ? `${plural(queued, "question")} ${queued === 1 ? "is" : "are"} on your review list.` : ""} ${mastered ? `${plural(mastered, "question")} mastered.` : ""}</p>
    </section>
    ${themes.length ? growth : ""}
    <section class="card">
      <h2>Your answers</h2>
      <ul class="results">${done.map((d) => `<li><span class="badge ${d.outcome.result}">${label[d.outcome.result]}</span>
        <span>${esc(sourceName(d.q.source_id))} · Q${d.q.q_number}</span><span class="marks">${fmt(d.outcome.marks_awarded)} / ${fmt(d.q.marks)}</span></li>`).join("")}</ul>
      <div class="row"><a class="btn primary" href="#home">Back to home</a>${session.mode === "practice" ? '<a class="btn" href="#practice">Practise more</a>' : ""}</div>
    </section>`);
}

// ---- routing and events ------------------------------------------------------------------------
const route = guard(async () => {
  if (!user) return showSignIn();
  const h = location.hash || "#home";
  if (h === "#session") {
    if (!session) return go("#home");
    return session.finished ? showSummary() : showQuestion(false);
  }
  if (h === "#practice") return showSetup();
  if (h === "#review") return startReview();
  return showHome();
});
window.addEventListener("hashchange", route);

view.addEventListener("submit", guard(async (e) => {
  e.preventDefault();
  const form = e.target.dataset.form, data = Object.fromEntries(new FormData(e.target));
  const btn = e.target.querySelector('button[type="submit"]'), label = btn && btn.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }
  try { await submit(form, data); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; } }
}));
async function submit(form, data) {
  if (form === "signin") {
    user = await store.signIn(data);
    await loadBase();
    go("#home");
  } else if (form === "setup") {
    const rows = index.filter((r) => L.matches(r, filters));
    await startSession("practice", L.pickQuestions(rows, lastTried, filters.count).map((r) => r.id));
  }
}

view.addEventListener("change", guard(async (e) => {
  const t = e.target;
  if (t.form && t.form.dataset.form === "setup") {
    filters = { ...filters, [t.name]: t.name === "topic" || t.name === "count" ? +t.value : t.value };
    return paintSetup();
  }
  if (t.dataset.kw && session && !st.saved) {
    const i = +t.dataset.kw.split(":")[0], unit = L.markUnits(current())[i];
    const hit = [...view.querySelectorAll(`[data-kw^="${i}:"]`)].filter((c) => c.checked).map((c) => unit.keywords[+c.dataset.kw.split(":")[1]]);
    st.choices[i] = { mode: "keywords", hit };
    showQuestion(true);
  }
}));

view.addEventListener("input", (e) => {
  if (e.target.dataset.typed != null && st) st.typed[+e.target.dataset.typed] = e.target.value;
});

view.addEventListener("click", guard(async (e) => {
  const t = e.target;
  if (session && st && !st.saved && !session.finished) {
    const q = current();
    const opt = t.closest("[data-opt]");
    if (opt && q.section === "mcq") { st.selected = +opt.dataset.opt; return showQuestion(true); }
    const self = t.closest("[data-self]");
    if (self) { const [i, v] = self.dataset.self.split(":"); st.choices[+i] = { mode: "self", value: v }; return showQuestion(true); }
    const kwm = t.closest("[data-kwmode]");
    if (kwm) {
      const [i, on] = kwm.dataset.kwmode.split(":").map(Number);
      st.kwMode[i] = !!on;
      st.choices[i] = on ? { mode: "keywords", hit: [] } : null;
      return showQuestion(true);
    }
  }
  const act = t.closest("[data-act]");
  if (!act) return;
  const a = act.dataset.act;
  if (a === "theme") return startTheme(act.dataset.theme);
  if (a === "check" && st.selected != null) return finish(L.markMcq(current(), st.selected));
  if (a === "reveal") { st.revealed = true; return showQuestion(true); }
  if (a === "save" && st.choices.every(Boolean)) return finish(L.markOpen(current(), st.choices));
  if (a === "next") {
    if (session.pos + 1 < session.qs.length) { session.pos += 1; newState(); return showQuestion(false); }
    session.finished = true;
    return showSummary();
  }
  if (a === "reset" && window.confirm("Clear all your trial answers on this browser?")) {
    await store.reset();
    user = null;
    return showSignIn();
  }
}));

who.addEventListener("click", guard(async (e) => {
  if (!e.target.closest('[data-act="signout"]')) return;
  await store.signOut();
  user = null;
  session = null;
  filters = null;
  if (location.hash && location.hash !== "#home") history.replaceState(null, "", location.pathname);
  await showSignIn();
}));

guard(async () => {
  store = await makeStore(window.APP_CONFIG || {});
  user = await store.currentUser();
  if (user) await loadBase();
  await route();
})();
