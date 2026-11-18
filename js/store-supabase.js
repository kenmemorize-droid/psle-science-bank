// Supabase back end. Used when app/config.js has a project URL and anon key.
// NOT YET RUN AGAINST A DATABASE (written 2026-11-17, before the Supabase project existed).
// It hands the app the same functions as store-local.js.
//
// What the database lets a student do (supabase/schema.sql): read questions through the view
// practice_questions, read question_images, topics, sources and app_config, add and read their
// own attempts, and manage their own review_queue rows. Nothing else.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const PAGE = 1000;                 // the API returns at most 1000 rows per request
const BUCKET = "question-images";
const URL_LIFE = 2 * 60 * 60;      // seconds a signed image link stays valid

const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

// Read every row of a query, a page at a time.
async function all(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const rows = check(await build().range(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function createStore(config) {
  const sb = createClient(config.supabaseUrl, config.supabaseAnonKey);
  let me = null;

  async function profile(uid) {
    const row = check(await sb.from("profiles").select("id, name, role, level").eq("id", uid).maybeSingle());
    if (!row) throw new Error("This account is not set up yet. Please ask your teacher.");
    return row;
  }

  return {
    mode: "supabase",
    async currentUser() {
      const { data } = await sb.auth.getSession();
      if (!data.session) return null;
      me = await profile(data.session.user.id);
      return me;
    },
    // Students type a username; Supabase needs an email, so the app adds a fixed ending.
    async signIn({ username, password }) {
      const name = username.trim().toLowerCase();
      const email = name.includes("@") ? name : `${name}@${config.usernameDomain}`;
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error("That username or password is not right. Please try again.");
      me = await profile(data.user.id);
      return me;
    },
    async signOut() { await sb.auth.signOut(); me = null; },

    async catalog() {
      const [topics, sources] = await Promise.all([
        sb.from("topics").select("id, theme, topic, sub_topic, level_range").order("id"),
        sb.from("sources").select("id, school, year, level, paper_type").order("id"),
      ]);
      return {
        topics: check(topics).map((t) => ({ id: t.id, theme: t.theme, topic: t.topic, sub_topic: t.sub_topic, level: t.level_range })),
        sources: check(sources),
      };
    },
    async questionIndex() {
      return all(() => sb.from("practice_questions").select("id, level, section, marks, source_id, primary_topic_id, secondary_topic_ids").order("id"));
    },
    async questions(ids) {
      if (!ids.length) return [];
      const [qs, ims] = await Promise.all([
        sb.from("practice_questions").select("*").in("id", ids),
        sb.from("question_images").select("question_id, role, option_no, part_label, position, alt_text, storage_path, width, height").in("question_id", ids).order("position"),
      ]);
      const images = check(ims);
      const urls = new Map();
      if (images.length) {
        const signed = check(await sb.storage.from(BUCKET).createSignedUrls(images.map((im) => im.storage_path), URL_LIFE));
        signed.forEach((s, i) => urls.set(images[i].storage_path, s.signedUrl));
      }
      const byQ = new Map();
      images.forEach((im) => {
        if (!byQ.has(im.question_id)) byQ.set(im.question_id, []);
        byQ.get(im.question_id).push({ role: im.role, option_no: im.option_no, part_label: im.part_label, position: im.position, alt_text: im.alt_text, url: urls.get(im.storage_path) || "", w: im.width, h: im.height });
      });
      const rows = new Map(check(qs).map((q) => [q.id, { ...q, secondary_topic_ids: q.secondary_topic_ids || [], images: byQ.get(q.id) || [] }]));
      return ids.map((id) => rows.get(id)).filter(Boolean);
    },

    async attempts() {
      return all(() => sb.from("attempts").select("question_id, result, mode, marks_awarded, answered_at").eq("student_id", me.id).order("answered_at"));
    },
    async addAttempt(a) {
      check(await sb.from("attempts").insert({ student_id: me.id, question_id: a.question_id, mode: a.mode, result: a.result, selected_option: a.selected_option, keywords_hit: a.keywords_hit, marks_awarded: a.marks_awarded }));
    },
    async queue() {
      return all(() => sb.from("review_queue").select("question_id, due_at, interval_step, status").eq("student_id", me.id).order("question_id"));
    },
    async saveQueue(row) {
      check(await sb.from("review_queue").upsert({ student_id: me.id, question_id: row.question_id, due_at: row.due_at, interval_step: row.interval_step, status: row.status }, { onConflict: "student_id,question_id" }));
    },
    async intervals() {
      const row = check(await sb.from("app_config").select("value").eq("key", "review_intervals_days").maybeSingle());
      return row && Array.isArray(row.value) && row.value.length ? row.value : [1, 3, 7];
    },
  };
}
