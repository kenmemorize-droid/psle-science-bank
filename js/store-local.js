// TRIAL MODE back end: no database. Questions come from ../data/bank.js (built by
// tools/build_bank.py) and the student's answers are kept in this browser only (localStorage).
// It hands the app exactly what the Supabase back end hands it: questions on hold are left out,
// and the school's replaced answers and their notes are stripped.

const KEY = "psle-trial-v1";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

export async function createStore() {
  await Promise.all([loadScript("../data/bank.js"), loadScript("../browser/taxonomy.js")]);
  const BANK = window.BANK, TAX = window.TAXONOMY;
  if (!BANK || !TAX) throw new Error("The question bank was not found. Run tools/build_bank.py first.");

  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || { user: null, attempts: [], queue: {} }; }
    catch { return { user: null, attempts: [], queue: {} }; }
  };
  const write = (d) => localStorage.setItem(KEY, JSON.stringify(d));

  const live = BANK.questions.filter((q) => !q.hold && (q.section !== "mcq" || q.correct_option != null));
  const byId = new Map(live.map((q) => [q.id, q]));
  const strip = ({ key_answer, correction_note, proposed_answer, answer_source, ...rest }) => rest;
  const shape = (q) => ({
    id: q.id, source_id: q.paper_id, level: q.level, section: q.section, q_number: q.q_number, marks: q.marks,
    stem_text: q.stem_text, options: q.options, correct_option: q.correct_option, model_answer: q.model_answer, keywords: q.keywords,
    parts: q.parts ? q.parts.map(strip) : null, primary_topic_id: q.primary_topic_id, secondary_topic_ids: q.secondary_topic_ids || [],
    images: q.images.map((im) => ({ role: im.role, option_no: im.option_no, part_label: im.part_label, position: im.position, alt_text: im.alt_text, url: "../" + im.file, w: im.w, h: im.h })),
  });

  return {
    mode: "trial",
    async currentUser() { return read().user; },
    // Trial sign-in: a name and a level, no password.
    async signIn({ name, level }) {
      const d = read();
      d.user = { id: "trial", name: name.trim() || "Trial student", role: "student", level };
      write(d);
      return d.user;
    },
    async signOut() { const d = read(); d.user = null; write(d); },
    async catalog() {
      return {
        topics: TAX.topics.map((t) => ({ id: t.id, theme: t.theme, topic: t.topic, sub_topic: t.sub_topic, level: t.level })),
        sources: BANK.sources.filter((s) => !s.held).map((s) => ({ id: s.paper_id, school: s.school, year: s.year, level: s.level, paper_type: s.paper_type })),
      };
    },
    async questionIndex() {
      return live.map((q) => ({ id: q.id, level: q.level, section: q.section, marks: q.marks, source_id: q.paper_id, primary_topic_id: q.primary_topic_id, secondary_topic_ids: q.secondary_topic_ids || [] }));
    },
    async questions(ids) { return ids.map((id) => byId.get(id)).filter(Boolean).map(shape); },
    async attempts() { return read().attempts; },
    async addAttempt(a) {
      const d = read();
      d.attempts.push({ ...a, answered_at: new Date().toISOString() });
      write(d);
    },
    async queue() { return Object.values(read().queue); },
    async saveQueue(row) { const d = read(); d.queue[row.question_id] = row; write(d); },
    async intervals() { return [1, 3, 7]; },
    // Trial mode only: wipe this browser's trial answers.
    async reset() { localStorage.removeItem(KEY); },
  };
}
