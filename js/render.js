// Turns a question into HTML for the student. Same text conventions as the review browser:
// **bold**, *italic*, new lines, and {{imgN}} markers where a picture sits inside the text.
import { markUnits, unitMarks } from "./logic.js";

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const fmt = (n) => String(+(+n).toFixed(1));
export const marksText = (n) => `${fmt(n)} mark${+n === 1 ? "" : "s"}`;

export function inline(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
}
const img = (im) => `<img src="${esc(im.url)}" alt="${esc(im.alt_text || "")}"${im.w ? ` width="${im.w}" height="${im.h}"` : ""}>`;
const figure = (im) => `<figure>${img(im)}</figure>`;

function textWithImages(text, images) {
  const used = new Set();
  const html = (text || "").split(/(\{\{img\d+\}\})/).map((bit) => {
    const m = /^\{\{img(\d+)\}\}$/.exec(bit);
    if (!m) return bit.trim() ? `<div>${inline(bit.replace(/^\n+|\n+$/g, ""))}</div>` : "";
    const im = images[+m[1] - 1];
    if (!im) return "";
    used.add(im);
    return figure(im);
  }).join("");
  return html + images.filter((im) => !used.has(im)).map(figure).join("");
}
const partLabel = (label) => `(${esc(label.replace(/^([a-z])\((.+)\)$/, "$1)($2"))})`;

// ---- multiple choice ------------------------------------------------------------------------
// st: {selected, saved}. Before the answer is checked the options are buttons; afterwards they
// show which one is right and which one the student picked.
function mcqHtml(q, st) {
  const done = !!st.saved;
  const cls = (no) => [st.selected === no ? "picked" : "", done && no === q.correct_option ? "right" : "", done && st.selected === no && no !== q.correct_option ? "wrong" : ""].join(" ");
  const tag = (no) => (done && no === q.correct_option ? '<span class="tag ok">Answer</span>' : done && st.selected === no ? '<span class="tag bad">Your choice</span>' : "");
  const o = q.options;
  if (o && !Array.isArray(o)) {
    const head = `<tr><th></th>${o.headers.map((h) => `<th>${inline(h)}</th>`).join("")}</tr>`;
    const rows = o.rows.map((r) => `<tr class="optrow ${cls(r.no)}" data-opt="${r.no}">
      <td><button type="button" class="pick" data-opt="${r.no}" aria-pressed="${st.selected === r.no}" ${done ? "disabled" : ""}>(${r.no})</button>${tag(r.no)}</td>
      ${r.cells.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("");
    return `<div class="table-scroll"><table class="opttable">${head}${rows}</table></div>`;
  }
  const pics = (no) => q.images.filter((im) => im.role === "option" && im.option_no === no).map(img).join("");
  return `<div class="opts">${(o || []).map((r) => `<button type="button" class="opt ${cls(r.no)}" data-opt="${r.no}" aria-pressed="${st.selected === r.no}" ${done ? "disabled" : ""}>
      <span class="no">(${r.no})</span><span class="opt-body">${r.text ? inline(r.text) : ""}${pics(r.no)}</span>${tag(r.no)}</button>`).join("")}</div>`;
}

// ---- open-ended -----------------------------------------------------------------------------
// st: {revealed, choices: [null | {mode, value | hit}], typed: [text], kwMode: [bool], saved}
function unitHtml(q, unit, i, st) {
  const done = !!st.saved;
  const stemImgs = q.images.filter((im) => im.role === "stem" && (im.part_label || null) === unit.label);
  const ansImgs = q.images.filter((im) => im.role === "answer" && (im.part_label || null) === unit.label);
  let html = `<section class="unit">`;
  if (unit.label != null) {
    html += `<div class="unit-head"><span class="part-label">${partLabel(unit.label)}</span><span class="marks">[${fmt(unit.marks)}]</span></div>
      <div class="unit-text">${textWithImages(unit.text, stemImgs)}</div>`;
  }
  html += `<label class="typed"><span>Your answer${unit.label != null ? " to " + partLabel(unit.label) : ""} (you may write it on paper instead)</span>
    <textarea rows="3" data-typed="${i}" ${done ? "readonly" : ""}>${esc(st.typed[i] || "")}</textarea></label>`;
  if (!st.revealed) return html + "</section>";

  html += `<div class="answer"><b>Suggested solution</b>${inline(unit.model_answer || "")}</div>${ansImgs.map(figure).join("")}`;
  const choice = st.choices[i];
  const kw = unit.keywords;
  const useKw = kw && st.kwMode[i];
  html += `<div class="marking" role="group" aria-label="Mark your answer">`;
  if (kw) {
    html += `<div class="seg"><button type="button" data-kwmode="${i}:0" aria-pressed="${!useKw}" ${done ? "disabled" : ""}>My own judgement</button>
      <button type="button" data-kwmode="${i}:1" aria-pressed="${!!useKw}" ${done ? "disabled" : ""}>Tick the key words</button></div>`;
  }
  if (useKw) {
    const hit = choice && choice.mode === "keywords" ? choice.hit : [];
    html += `<div class="kwlist"><p class="hint">Tick each key idea that is in your answer.</p>${kw.map((k, n) => `<label class="kwitem"><input type="checkbox" data-kw="${i}:${n}" ${hit.includes(k) ? "checked" : ""} ${done ? "disabled" : ""}><span>${inline(k)}</span></label>`).join("")}</div>`;
  } else {
    const val = choice && choice.mode === "self" ? choice.value : null;
    html += `<div class="self">${[["got", "Got it"], ["partly", "Partly"], ["missed", "Missed it"]].map(([v, label]) =>
      `<button type="button" class="selfbtn ${v}" data-self="${i}:${v}" aria-pressed="${val === v}" ${done ? "disabled" : ""}>${label}</button>`).join("")}</div>`;
  }
  if (choice) html += `<p class="got-marks">${fmt(unitMarks(unit, choice))} out of ${fmt(unit.marks)}</p>`;
  return html + "</div></section>";
}

function openHtml(q, st) {
  const units = markUnits(q);
  let html = units.map((u, i) => unitHtml(q, u, i, st)).join("");
  // an answer picture that belongs to a part label the question does not have is still shown
  if (st.revealed) {
    const labels = new Set(units.map((u) => u.label));
    html += q.images.filter((im) => im.role === "answer" && !labels.has(im.part_label || null)).map(figure).join("");
  }
  return html;
}

// ctx: {source, topic, position, total}
export function questionHtml(q, st, ctx) {
  const stemImgs = q.images.filter((im) => im.role === "stem" && !im.part_label);
  return `<article class="q">
    <div class="q-head"><span class="q-meta">${esc(ctx.source)} · Q${q.q_number}</span><span class="marks">${marksText(q.marks)}</span></div>
    <div class="chips"><span class="chip">${esc(ctx.topic)}</span><span class="chip plain">${q.section === "mcq" ? "Multiple choice" : "Open-ended"}</span></div>
    <div class="stem">${textWithImages(q.stem_text, stemImgs)}</div>
    ${q.section === "mcq" ? mcqHtml(q, st) : openHtml(q, st)}
  </article>`;
}

// ---- the pentagon of theme stats -------------------------------------------------------------
// stats: [{theme, value 0..1}] from logic.themeStats, one corner each, the first at the top.
// opts.before: the stats before a session, drawn as a dashed outline that the shape grows from.
// opts.tap: the labels can be tapped to practise that theme.  opts.calm: no movement.
export const pct = (v) => Math.round(v * 100);
export function radarHtml(stats, opts = {}) {
  const n = stats.length, cx = 160, cy = 148, R = 96;
  const dir = (i) => { const a = (-90 + (i * 360) / n) * Math.PI / 180; return [Math.cos(a), Math.sin(a)]; };
  const at = (i, r) => { const [c, s] = dir(i); return [+(cx + r * c).toFixed(1), +(cy + r * s).toFixed(1)]; };
  const reach = (v) => R * (0.06 + 0.94 * v);          // an empty side still shows as a small shape in the middle
  const shape = (values) => values.map((v, i) => at(i, reach(v)).join(",")).join(" ");
  const now = shape(stats.map((s) => s.value)), was = opts.before ? shape(opts.before.map((s) => s.value)) : null;
  const rings = [1, 0.75, 0.5, 0.25].map((v) => `<polygon class="ring${v === 1 ? " outer" : ""}" points="${shape(stats.map(() => v))}"/>`).join("");
  const spokes = stats.map((_, i) => { const [x, y] = at(i, R); return `<line class="spoke" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`; }).join("");
  const grow = was && was !== now && !opts.calm
    ? `<animate attributeName="points" from="${was}" to="${now}" dur="1.1s" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.7 0.2 1" fill="freeze"/>` : "";
  const dots = grow ? "" : stats.map((s, i) => { const [x, y] = at(i, reach(s.value)); return `<circle class="dot" cx="${x}" cy="${y}" r="3.5"/>`; }).join("");
  const labels = stats.map((s, i) => {
    const [c, sn] = dir(i), [x, y] = at(i, R + 14);
    const anchor = Math.abs(c) < 0.3 ? "middle" : c > 0 ? "start" : "end";
    const y1 = sn < -0.5 ? y - 20 : sn > 0.5 ? y + 14 : y - 4;
    const diff = opts.before ? pct(s.value) - pct(opts.before[i].value) : 0;
    const change = diff ? `<tspan class="${diff > 0 ? "up" : "down"}"> ${diff > 0 ? "+" : "−"}${Math.abs(diff)}</tspan>` : "";
    const box = `<rect x="${anchor === "middle" ? x - 50 : anchor === "start" ? x - 8 : x - 92}" y="${y1 - 18}" width="100" height="44" rx="8"/>`;
    return `<g class="lab"${opts.tap ? ` data-act="theme" data-theme="${esc(s.theme)}"` : ""}>${opts.tap ? box : ""}
      <text class="lab-name" x="${x}" y="${y1}" text-anchor="${anchor}">${esc(s.theme)}</text>
      <text class="lab-val" x="${x}" y="${y1 + 16}" text-anchor="${anchor}">${pct(s.value)}%${change}</text></g>`;
  }).join("");
  return `<svg class="radar${opts.tap ? " tap" : ""}" viewBox="0 0 320 280" role="img" aria-label="${esc(stats.map((s) => `${s.theme} ${pct(s.value)}%`).join(", "))}">
    ${rings}${spokes}${was ? `<polygon class="was" points="${was}"/>` : ""}<polygon class="now" points="${now}">${grow}</polygon>${dots}${labels}</svg>`;
}
