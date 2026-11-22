// Picks the back end. Both hand the app the same functions:
//   currentUser, signIn, signOut, catalog, questionIndex, questions(ids),
//   attempts, addAttempt, queue, saveQueue, intervals
//
// The back end is wrapped so that the app does not wait on the network more than it must
// (each request to the database takes about half a second):
//   - the student's attempts and review list are read once and then kept in step in memory;
//   - the list of questions, the topics and the papers are remembered in this browser for a
//     day, per student, and refreshed in the background for the next visit.
export async function makeStore(config) {
  const mod = config.supabaseUrl && config.supabaseAnonKey
    ? await import("./store-supabase.js")
    : await import("./store-local.js");
  return withCache(await mod.createStore(config));
}

const BASE_KEY = "psle-base-v1";
const BASE_LIFE = 24 * 60 * 60 * 1000;

function withCache(inner) {
  let attempts = null, queue = null, uid = null;       // attempts and queue hold promises of arrays
  const remember = inner.mode === "supabase";          // trial mode already reads from this computer
  const forget = () => { attempts = null; queue = null; };

  const readBase = () => {
    if (!remember || !uid) return null;
    try {
      const d = JSON.parse(localStorage.getItem(BASE_KEY));
      return d && d.uid === uid && Date.now() - d.at < BASE_LIFE ? d : null;
    } catch { return null; }
  };
  const writeBase = (patch) => {
    if (!remember || !uid) return;
    try {
      const old = readBase() || {};
      localStorage.setItem(BASE_KEY, JSON.stringify({ ...old, ...patch, uid, at: Date.now() }));
    } catch { /* storage full or switched off: the app simply asks the database each time */ }
  };
  // Give back what this browser remembers and fetch a fresh copy for next time; with nothing remembered, wait for it.
  async function remembered(name, fetcher) {
    const d = readBase();
    const fresh = fetcher().then((v) => { writeBase({ [name]: v }); return v; });
    if (d && d[name]) { fresh.catch(() => {}); return d[name]; }
    return fresh;
  }

  return {
    ...inner,
    mode: inner.mode,
    async currentUser() { const u = await inner.currentUser(); uid = u ? u.id || u.name : null; return u; },
    async signIn(data) { forget(); const u = await inner.signIn(data); uid = u ? u.id || u.name : null; return u; },
    async signOut() {
      forget();
      uid = null;
      try { localStorage.removeItem(BASE_KEY); } catch { /* nothing to clear */ }
      return inner.signOut();
    },
    async reset() { forget(); return inner.reset(); },

    catalog: () => remembered("catalog", () => inner.catalog()),
    questionIndex: () => remembered("index", () => inner.questionIndex()),
    intervals: () => remembered("intervals", () => inner.intervals()),

    attempts() {
      if (!attempts) attempts = inner.attempts().catch((e) => { attempts = null; throw e; });
      return attempts.then((rows) => rows.slice());
    },
    async addAttempt(a) {
      await inner.addAttempt(a);
      if (attempts) {
        const rows = await attempts;
        rows.push({ question_id: a.question_id, result: a.result, mode: a.mode, marks_awarded: a.marks_awarded, answered_at: new Date().toISOString() });
      }
    },
    queue() {
      if (!queue) queue = inner.queue().catch((e) => { queue = null; throw e; });
      return queue.then((rows) => rows.slice());
    },
    async saveQueue(row) {
      await inner.saveQueue(row);
      if (queue) {
        const rows = await queue;
        const i = rows.findIndex((r) => r.question_id === row.question_id);
        const kept = { question_id: row.question_id, due_at: row.due_at, interval_step: row.interval_step, status: row.status };
        if (i >= 0) rows[i] = kept; else rows.push(kept);
      }
    },
  };
}
