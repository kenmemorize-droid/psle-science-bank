// Rules of the student app: marking and the spaced review queue.
// Pure functions only (no page, no storage), so they can be tested on their own:
//   node tools/test_logic.mjs

export const SELF_MARKS = { got: 1, partly: 0.5, missed: 0 };
export const roundHalf = (x) => Math.round(x * 2) / 2;

// What an open-ended question is marked in: its parts, or the whole question when it has none.
export function markUnits(q) {
  if (q.section === "mcq") return [];
  if (q.parts && q.parts.length) {
    return q.parts.map((p) => ({ label: p.label, text: p.text, marks: p.marks, model_answer: p.model_answer, keywords: p.keywords && p.keywords.length ? p.keywords : null }));
  }
  return [{ label: null, text: null, marks: q.marks, model_answer: q.model_answer, keywords: q.keywords && q.keywords.length ? q.keywords : null }];
}

export function markMcq(q, selected) {
  const ok = selected === q.correct_option;
  return { result: ok ? "correct" : "wrong", marks_awarded: ok ? q.marks : 0, selected_option: selected, keywords_hit: null };
}

// One unit. choice is {mode: "self", value: "got" | "partly" | "missed"}
// or {mode: "keywords", hit: [keywords the student ticked]}. Marks go in half-mark steps.
export function unitMarks(unit, choice) {
  if (choice.mode === "keywords") return roundHalf(unit.marks * choice.hit.length / unit.keywords.length);
  return roundHalf(unit.marks * SELF_MARKS[choice.value]);
}

// choices lines up with markUnits(q). Full marks = correct, no marks = wrong, anything between = partial.
export function markOpen(q, choices) {
  const units = markUnits(q);
  const total = units.reduce((a, u) => a + u.marks, 0);
  const awarded = units.reduce((a, u, i) => a + unitMarks(u, choices[i]), 0);
  let hits = null;
  if (choices.some((c) => c.mode === "keywords")) {
    if (units.length === 1 && units[0].label == null) hits = choices[0].hit;
    else { hits = {}; units.forEach((u, i) => { if (choices[i].mode === "keywords") hits[u.label] = choices[i].hit; }); }
  }
  return { result: awarded >= total ? "correct" : awarded <= 0 ? "wrong" : "partial", marks_awarded: awarded, selected_option: null, keywords_hit: hits };
}

// ---- review queue -------------------------------------------------------------------------
// Gaps are whole days, counted from the start of the day, so a question answered wrongly at
// 8 pm is due at any time the next day, not at 8 pm.
export function dueAfter(now, days) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).toISOString();
}

// entry: the student's queue row for this question, or null. intervals: e.g. [1, 3, 7] days.
// Returns the new row {interval_step, due_at, status}, or null when the queue does not change.
//  - practice or test: a wrong or partial answer puts the question at the first step
//    (again, if it was already queued or mastered); a correct answer changes nothing.
//  - review: a correct answer moves one step on, and past the last step the question is
//    mastered; a wrong or partial answer goes back to the first step.
export function afterAttempt(entry, result, mode, intervals, now) {
  const first = { interval_step: 0, due_at: dueAfter(now, intervals[0]), status: "due" };
  if (mode !== "review") return result === "correct" ? null : first;
  if (result !== "correct") return first;
  const step = (entry ? entry.interval_step : 0) + 1;
  if (step >= intervals.length) return { interval_step: step, due_at: new Date(now).toISOString(), status: "mastered" };
  return { interval_step: step, due_at: dueAfter(now, intervals[step]), status: "due" };
}

export const isDue = (row, now) => row.status === "due" && new Date(row.due_at).getTime() <= now;

// ---- theme stats (the pentagon) -----------------------------------------------------------
// One number from 0 to 1 for each theme: accuracy x coverage, over the student's most recent
// STAT_WINDOW questions in that theme.
//   accuracy = marks earned / marks possible, taking only the latest answer to each question
//   coverage = questions in the window / STAT_WINDOW (so a side is full only after
//              STAT_WINDOW questions, all of them right)
// attempts: [{question_id, marks_awarded, answered_at}]. info: Map of question id -> {theme, marks}.
export const STAT_WINDOW = 40;
export function themeStats(attempts, info, themes, size = STAT_WINDOW) {
  const latest = new Map();
  for (const a of attempts) {
    const at = Date.parse(a.answered_at), old = latest.get(a.question_id);
    if (!old || at >= old.at) latest.set(a.question_id, { at, got: Number(a.marks_awarded) || 0 });
  }
  const by = new Map(themes.map((t) => [t, []]));
  latest.forEach((a, id) => {
    const q = info.get(id);
    if (q && q.marks > 0 && by.has(q.theme)) by.get(q.theme).push({ ...a, out: Number(q.marks) });
  });
  return themes.map((theme) => {
    const rows = by.get(theme).sort((a, b) => b.at - a.at).slice(0, size);
    const got = rows.reduce((s, r) => s + r.got, 0), out = rows.reduce((s, r) => s + r.out, 0);
    const accuracy = out ? Math.min(1, got / out) : 0, coverage = rows.length / size;
    return { theme, tried: rows.length, accuracy, coverage, value: accuracy * coverage };
  });
}

// ---- daily streak -------------------------------------------------------------------------
// A day counts once the student has given DAILY_GOAL answers on it (practice or review).
// Every FREEZE_EVERY days of streak earns one freeze, and at most FREEZE_MAX are kept. A missed
// day uses up a freeze by itself and the streak stays as it was; with no freeze left it goes
// back to 0. Today never breaks a streak: it is still open until midnight.
// Nothing is stored: the whole history is worked out again from the dates of the answers.
export const DAILY_GOAL = 10, FREEZE_EVERY = 10, FREEZE_MAX = 2;
const dayNo = (t) => { const d = new Date(t); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000); };
export function streak(attempts, now, goal = DAILY_GOAL) {
  const counts = new Map();
  for (const a of attempts) { const d = dayNo(Date.parse(a.answered_at)); counts.set(d, (counts.get(d) || 0) + 1); }
  const today = dayNo(now), done = (d) => (counts.get(d) || 0) >= goal;
  const first = Math.min(...[...counts.keys()].filter(done));          // Infinity when no day has counted yet
  const state = new Map();
  let days = 0, freezes = 0;
  for (let d = first; d <= today; d += 1) {
    if (done(d)) {
      days += 1;
      if (days % FREEZE_EVERY === 0) freezes = Math.min(FREEZE_MAX, freezes + 1);
      state.set(d, "done");
    } else if (d === today) state.set(d, "open");
    else if (days > 0 && freezes > 0) { freezes -= 1; state.set(d, "frozen"); }
    else { days = 0; state.set(d, "missed"); }
  }
  // the last 7 days, oldest first: "done", "frozen", "missed", "open" (today, not done yet) or "none"
  const week = [];
  for (let back = 6; back >= 0; back -= 1) week.push({ back, state: state.get(today - back) || (back === 0 ? "open" : "none") });
  return { days, freezes, goal, today: counts.get(today) || 0, doneToday: done(today), week };
}

// ---- choosing practice questions ----------------------------------------------------------
export function matches(row, f) {
  return (!f.level || row.level === f.level) && (!f.section || row.section === f.section) &&
    (!f.source || String(row.source_id) === String(f.source)) &&
    (!f.topic || row.primary_topic_id === f.topic || (row.secondary_topic_ids || []).includes(f.topic));
}

// Questions the student has never tried come first, then the ones tried longest ago; random within ties.
export function pickQuestions(rows, lastTried, n, rng = Math.random) {
  const shuffled = rows.map((r) => [rng(), r]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  shuffled.sort((a, b) => (lastTried.get(a.id) || 0) - (lastTried.get(b.id) || 0));
  return shuffled.slice(0, n);
}
