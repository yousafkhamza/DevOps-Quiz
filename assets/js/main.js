// DevOps Quiz 2.0 — app flow (setup → rules → quiz → result)
import { CONFIG } from "./config.js";
import { $, $$, el, esc, md, shuffle, fmtTime, store } from "./util.js";
import { drawResultCard, postText, toBlob } from "./card.js";
import { render, renderContext, TYPE_LABEL } from "./types.js";

const LEVELS = Object.keys(CONFIG.levels);
const S = {
  bank: [], demo: [], meta: {},
  mode: "exam", level: "mixed", topics: new Set(), count: CONFIG.counts[1], topUp: false,
  quiz: null,
};

/* ---------------- boot ---------------- */
async function boot() {
  show("loading");
  try {
    const idx = await fetchJSON(CONFIG.banksIndex);
    S.meta = idx;
    const files = await Promise.all(idx.banks.map(b => fetchJSON("data/" + b.file).then(qs => qs.map(q => ({ ...q, level: q.level || b.level })))));
    S.bank = files.flat();
    S.demo = await fetchJSON("data/" + idx.demo);
    $("#bankVersion").textContent = `Question bank ${idx.version}, ${S.bank.length} questions.`;
  } catch (e) {
    $("#loading").innerHTML = `Could not load the question bank.<br><span class="small">If you opened index.html from disk, serve the folder instead: <code>python3 -m http.server</code></span>`;
    console.error(e);
    return;
  }
  buildSetup();
  wireGlobal();
  show("home");
}
const fetchJSON = u => fetch(u, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });
const categories = () => [...new Set(S.bank.map(q => q.category))].sort();

function show(id) {
  ["home", "rules", "quiz", "result", "history", "thanks"].forEach(s => $("#screen-" + s).classList.add("hidden"));
  $("#loading").classList.add("hidden");
  if (id === "loading") $("#loading").classList.remove("hidden");
  else $("#screen-" + id).classList.remove("hidden");
  window.scrollTo({ top: 0 });
}

/* ---------------- setup screen ---------------- */
const sevTag = l => `SEV-${CONFIG.levels[l].sev}`;
const TOPIC_FLAG = c => c.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function buildSetup() {
  $$('#modeChips input').forEach(r => r.onchange = () => { S.mode = r.value; updatePool(); });

  const lv = $("#levelChips");
  const items = [...Object.entries(CONFIG.levels), ["mixed", { label: "Mixed", tagline: "Starts easy and escalates to SEV-1" }]];
  items.forEach(([k, v]) => {
    const n = k === "mixed" ? S.bank.length : S.bank.filter(q => q.level === k).length;
    const b = el("label", { class: "sev" + (k === S.level ? " on" : ""), "data-level": k },
      `<input type="radio" name="level" value="${k}"${k === S.level ? " checked" : ""}>
       <span class="sev-tag ${k === "mixed" ? "sev-mix" : "sev-" + v.sev}">${k === "mixed" ? "SEV-4→1" : "SEV-" + v.sev}</span>
       <span class="sev-name">${esc(v.label)}</span>
       <span class="sev-desc">${esc(v.tagline)}</span>
       <span class="sev-meta">${n} questions${v.weight ? `, ${v.weight} pt, ${Math.round(v.time / 60)} min` : ""}</span>`);
    b.querySelector("input").onchange = () => { S.level = k; $$("#levelChips .sev").forEach(x => x.classList.toggle("on", x === b)); updatePool(); };
    lv.appendChild(b);
  });

  const tc = $("#topicChips");
  categories().forEach(c => {
    const b = el("button", { type: "button", class: "chip", "data-topic": c, "aria-pressed": "false" }, `${esc(c)} <span class="n">${S.bank.filter(q => q.category === c).length}</span>`);
    b.onclick = () => { S.topics.has(c) ? S.topics.delete(c) : S.topics.add(c); b.classList.toggle("on", S.topics.has(c)); b.setAttribute("aria-pressed", S.topics.has(c)); updatePool(); };
    tc.appendChild(b);
  });
  $("#topicsAll").onclick = () => {
    const all = S.topics.size !== categories().length;
    S.topics = new Set(all ? categories() : []);
    $$("#topicChips .chip").forEach(b => { b.classList.toggle("on", all); b.setAttribute("aria-pressed", all); });
    updatePool();
  };

  const cc = $("#countChips");
  CONFIG.counts.forEach(n => {
    const b = el("button", { type: "button", class: "chip" + (n === S.count ? " on" : "") }, String(n));
    b.onclick = () => { S.count = n; $$("#countChips .chip").forEach(x => x.classList.toggle("on", x === b)); updatePool(); };
    cc.appendChild(b);
  });
  $("#btnContinue").onclick = run;
  updatePool();
}

// Nearest levels to borrow from when the chosen level runs short (harder first, then easier).
const FALLBACK = { expert: ["hard", "medium", "easy"], hard: ["expert", "medium", "easy"], medium: ["hard", "easy", "expert"], easy: ["medium", "hard", "expert"] };
function plan(topUp = true) {
  if (S.level === "mixed") return { own: pool().length, borrow: [], total: pool().length };
  const own = pool().length;
  let need = Math.max(0, S.count - own);
  const borrow = [];
  if (topUp) for (const l of FALLBACK[S.level]) {
    if (!need) break;
    const n = Math.min(need, pool(l).length);
    if (n) { borrow.push([l, n]); need -= n; }
  }
  return { own, borrow, total: own + borrow.reduce((a, [, n]) => a + n, 0) };
}

function pool(level = S.level) {
  return S.bank.filter(q => S.topics.has(q.category) && (level === "mixed" || q.level === level));
}
function updatePool() {
  const P = plan(false);
  const all = S.topics.size === categories().length;
  const lvl = S.level === "mixed" ? "mixed" : "sev" + CONFIG.levels[S.level].sev;
  const topics = all ? "all" : [...S.topics].map(TOPIC_FLAG).join(",") || "<pick-one>";
  $("#cmdLine").innerHTML =
    `<span class="p">$</span> devops-quiz <span class="f">--mode</span> ${S.mode} <span class="f">--level</span> ${lvl} <span class="f">--count</span> ${S.count} \\\n    <span class="f">--topics</span> ${esc(topics)}`;
  const name = S.level === "mixed" ? "" : CONFIG.levels[S.level].label + " ";
  let msg;
  if (!S.topics.size) msg = "Pick one or more topics to start.";
  else if (P.own === 0 && S.level !== "mixed") msg = `No ${name}questions in these topics yet.`;
  else if (P.own >= S.count) msg = `${P.own} ${name}questions match.`;
  else msg = `${P.own} ${name}questions match, fewer than ${S.count}.`;
  $("#poolInfo").textContent = msg;
  $("#poolInfo").classList.toggle("bad", !S.topics.size);
  $("#topicsAll").textContent = all ? "Clear" : "Select all";
}

function run(e) {
  e?.preventDefault();
  if (!S.topics.size) {
    const tc = $("#topicChips");
    $("#poolInfo").textContent = "Pick at least one topic first.";
    $("#poolInfo").classList.add("bad");
    tc.scrollIntoView({ block: "center", behavior: "smooth" });
    tc.classList.remove("nudge"); void tc.offsetWidth; tc.classList.add("nudge");
    tc.querySelector(".chip")?.focus({ preventScroll: true });
    return;
  }
  const own = plan(false), full = plan(true);
  if (S.level === "mixed") {
    if (own.total >= S.count) return go(false);
    return askShort(own, full);
  }
  if (own.own >= S.count) return go(false);
  askShort(own, full);
}
function go(topUp) { S.topUp = topUp; showRules(); }

function askShort(own, full) {
  const mixed = S.level === "mixed";
  const name = mixed ? "" : CONFIG.levels[S.level].label + " ";
  const tn = S.topics.size === 1 ? [...S.topics][0] : `these ${S.topics.size} topics`;
  $("#shortTitle").textContent = `Only ${own.own} ${name}questions here`;
  $("#shortText").textContent = `You asked for ${S.count}, but ${tn} ${S.topics.size === 1 ? "has" : "have"} ${own.own} at ${mixed ? "all levels" : (CONFIG.levels[S.level].label + " (SEV-" + CONFIG.levels[S.level].sev + ")")}. How do you want to run it?`;
  const opts = $("#shortOpts"); opts.innerHTML = "";
  const add = (title, sub, fn) => {
    const b = el("button", { type: "button", class: "short-opt" }, `<b>${esc(title)}</b><span>${esc(sub)}</span>`);
    b.onclick = () => { $("#shortDlg").close(); fn(); };
    opts.appendChild(b);
  };
  if (!mixed && full.borrow.length) {
    const parts = full.borrow.map(([l, n]) => `${n} ${CONFIG.levels[l].label}`);
    const from = parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts.at(-1) : parts[0];
    add(`Top up to ${full.total} from nearby levels`, `${own.own} ${name}+ ${from}${full.total < S.count ? `. That's everything ${S.topics.size === 1 ? "this topic has" : "these topics have"}.` : "."}`, () => go(true));
  }
  if (own.own > 0) add(`Run ${own.own} ${name}questions only`, mixed ? `Every question ${S.topics.size === 1 ? "this topic has" : "these topics have"}.` : `Stays at ${sevTag(S.level)}, a shorter test.`, () => go(false));
  if (S.topics.size < categories().length) add("Add more topics", "Go back and pick more topics.", () => { const tc = $("#topicChips"); tc.scrollIntoView({ block: "center", behavior: "smooth" }); tc.querySelector(".chip:not(.on)")?.focus({ preventScroll: true }); });
  const d = $("#shortDlg");
  if (d.showModal) d.showModal(); else d.setAttribute("open", "");
  opts.querySelector("button")?.focus();
}

/* ---------------- question picking ---------------- */
function pickFrom(list, n) {
  const seen = new Set(store.get("seen", []));
  const unseen = shuffle(list.filter(q => !seen.has(q.id)));
  const rest = shuffle(list.filter(q => seen.has(q.id)));
  return [...unseen, ...rest].slice(0, n);
}
function buildQuiz() {
  let picked = [];
  if (S.level === "mixed") {
    const want = {};
    let total = 0;
    LEVELS.forEach(l => { want[l] = Math.round(S.count * CONFIG.mixedRatio[l]); total += want[l]; });
    want.medium += S.count - total; // rounding fix
    LEVELS.forEach(l => picked.push(...pickFrom(pool(l), want[l])));
    if (picked.length < S.count) { // top up from whatever is left
      const ids = new Set(picked.map(q => q.id));
      picked.push(...pickFrom(pool().filter(q => !ids.has(q.id)), S.count - picked.length));
    }
    picked.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
  } else {
    picked = pickFrom(pool(), S.count);
    if (S.topUp) for (const l of FALLBACK[S.level]) {
      if (picked.length >= S.count) break;
      picked.push(...pickFrom(pool(l), S.count - picked.length));
    }
  }
  return picked.map(fresh);
}
const fresh = q => { const c = structuredClone(q); delete c._order; return c; };

/* ---------------- rules ---------------- */
function attemptsToday() {
  const today = new Date().toDateString();
  const d = store.get("attempts", { date: today, count: 0 });
  return d.date === today ? d.count : 0;
}
function showRules() {
  const qs = buildQuiz();
  S.pending = qs;
  const max = qs.reduce((a, q) => a + CONFIG.levels[q.level].weight, 0);
  const time = qs.reduce((a, q) => a + CONFIG.levels[q.level].time, 0);
  const exam = S.mode === "exam";
  const left = CONFIG.dailyAttempts - attemptsToday();
  $("#rulesIntro").textContent = exam
    ? `${qs.length} questions worth ${max} points. At most ${Math.ceil(time / 60)} minutes if you use every second. You have ${left} of ${CONFIG.dailyAttempts} exam attempts left today.`
    : `${qs.length} questions, no timer, no negative marks.`;
  $("#rulesSummary").innerHTML = "";
  const types = [...new Set(qs.map(q => q.type))];
  const rows = LEVELS.filter(l => qs.some(q => q.level === l)).map(l => {
    const c = CONFIG.levels[l];
    return `<tr><td><span class="sev-tag sev-${c.sev}">SEV-${c.sev}</span> ${c.label}</td><td>+${c.weight}</td><td>${exam ? "−" + (c.weight * CONFIG.negativeRatio) : "0"}</td><td>${exam ? fmtTime(c.time) : "none"}</td></tr>`;
  }).join("");
  $("#rulesList").innerHTML = (exam ? [
    `<table class="wtable"><tr><th>Severity</th><th>Right</th><th>Wrong</th><th>Time each</th></tr>${rows}</table>`,
    "A skipped question scores 0. Select-all, spot-the-bug and ordering questions only score when fully right.",
    "Terminal and manifest questions give credit for each task or blank you get right. Getting none of it right counts as wrong.",
    `In the terminal you get ${CONFIG.maxAttemptsPerStep} tries per task. <code>man</code>, <code>--help</code> and Tab completion are free, like a real shell. <code>hint</code> costs 25% of that task, and a second <code>hint</code> (which shows the command's shape) costs 50%. Stuck? <code>skip</code> (or the Skip this task button) gives up just that task: it scores 0, never negative, and you go on to the next one. Output is pre-recorded, so type commands the way you would on a real jump host.`,
    "When time runs out the question locks and only Skip question works. Terminal tasks and blanks you already solved still count.",
    "You see your score and the explanations after the last question.",
    "Leaving the tab once gives a warning. Leaving it a second time ends the test. Pasting into the terminal is turned off.",
  ] : [
    "Press Check to see the right answer and why.",
    "Stuck in the terminal? Type <code>solution</code>.",
    `This set has: ${types.map(t => TYPE_LABEL[t].toLowerCase()).join(", ")}.`,
  ]).map(x => `<li>${x}</li>`).join("");
  $("#btnStart").disabled = exam && left <= 0;
  if (exam && left <= 0) $("#rulesList").insertAdjacentHTML("beforeend", `<li class="bad">You've used today's ${CONFIG.dailyAttempts} exam attempts. Practice mode has no limit, or come back tomorrow.</li>`);
  show("rules");
}

/* ---------------- quiz engine ---------------- */
function startQuiz(qs, mode) {
  if (mode === "exam") {
    const today = new Date().toDateString();
    store.set("attempts", { date: today, count: attemptsToday() + 1 });
  }
  S.quiz = { qs, mode, i: 0, results: [], started: Date.now(), strikes: 0, timer: null, left: 0, locked: false, checked: false, handler: null, timedOut: null };
  document.body.classList.toggle("exam", mode === "exam");
  show("quiz");
  loadQuestion();
}

function loadQuestion() {
  const Z = S.quiz, q = Z.qs[Z.i], lv = CONFIG.levels[q.level];
  clearInterval(Z.timer);
  Z.locked = false; Z.checked = false; Z.timedOut = null; Z.warned = false;
  $("#qCounter").textContent = `${Z.i + 1} / ${Z.qs.length}`;
  $("#qLevel").className = "sev-tag sev-" + lv.sev; $("#qLevel").textContent = "SEV-" + lv.sev;
  $("#qType").className = "qtype"; $("#qType").textContent = TYPE_LABEL[q.type];
  $("#qCat").textContent = q.category;
  $("#qPoints").textContent = Z.mode === "exam" ? `${lv.weight} pt, wrong −${lv.weight * CONFIG.negativeRatio}` : "";
  $("#progressFill").style.width = (Z.i / Z.qs.length) * 100 + "%";
  $("#banner").classList.add("hidden");
  $("#qFeedback").classList.add("hidden");

  $("#qTitle").textContent = q.title || "";
  $("#qScenario").innerHTML = q.scenario ? md(q.scenario) : "";
  const ctxBox = $("#qContext"); ctxBox.innerHTML = "";
  if (q.coach && Z.mode === "demo") ctxBox.appendChild(el("div", { class: "coach" }, md(q.coach)));
  ctxBox.appendChild(renderContext(q.context));
  $("#qQuestion").innerHTML = md(q.question || "");
  const body = $("#qBody"); body.innerHTML = ""; body.classList.remove("locked");
  Z.handler = render(q, body, { mode: Z.mode, isLocked: () => Z.locked, onChange: refreshButtons });

  $("#btnSkip").disabled = false;
  const nOpt = (q.options || []).length;
  const act = Z.mode === "exam" ? "go to the next question" : "check your answer";
  $("#kbdHint").innerHTML = (q.type === "mcq" || q.type === "multi")
    ? `Press <kbd>1</kbd> to <kbd>${nOpt}</kbd> to pick an option and <kbd>Enter</kbd> to ${act}.`
    : q.type === "terminal" ? "<kbd>Enter</kbd> runs the command you typed. Use the buttons below to move on."
    : `<kbd>Enter</kbd> outside a text box to ${act}.`;
  refreshButtons();

  const t = $("#timer");
  t.classList.remove("warning", "danger", "idle");
  if (Z.mode === "exam") {
    Z.left = lv.time; t.textContent = fmtTime(Z.left);
    Z.timer = setInterval(tick, 1000);
  } else {
    Z.left = 0; t.classList.add("idle"); t.textContent = Z.mode === "demo" ? "Tour, not scored" : "No timer";
  }
}

function tick() {
  const Z = S.quiz, t = $("#timer");
  Z.left--;
  t.textContent = fmtTime(Z.left);
  t.classList.toggle("danger", Z.left <= CONFIG.warningAt);
  t.classList.toggle("warning", Z.left > CONFIG.warningAt && Z.left <= 30);
  if (Z.left === CONFIG.warningAt && !Z.warned) { Z.warned = true; const a = $("#warningSound"); a.currentTime = 0; a.play().catch(() => {}); }
  if (Z.left <= 0) {
    clearInterval(Z.timer);
    // keep solved terminal tasks / blanks, never penalise on timeout
    const g = Z.handler.grade();
    const keep = (Z.handler.terminal || Z.qs[Z.i].type === "fill") && g.fraction > 0;
    Z.timedOut = keep ? { fraction: g.fraction, status: "partial" } : { fraction: 0, status: "timeout" };
    lockCurrent();
    const b = $("#banner"); b.className = "banner"; b.textContent = keep ? "Time's up. The tasks you finished still count. Press Skip question to go on." : "Time's up. Press Skip question to go on.";
    refreshButtons();
  }
}

function lockCurrent() { S.quiz.locked = true; S.quiz.handler.lock(); }

function refreshButtons() {
  const Z = S.quiz; if (!Z) return;
  const next = $("#btnNext");
  const last = Z.i === Z.qs.length - 1;
  if (Z.mode === "exam") {
    next.textContent = last ? "Finish" : "Next";
    next.disabled = !!Z.timedOut;
  } else {
    next.textContent = Z.checked ? (last ? "See results" : "Next") : "Check";
    next.disabled = !Z.checked && !Z.handler.answered();
  }
  $("#btnSkip").textContent = "Skip question";
  $("#btnSkip").disabled = Z.mode !== "exam" && Z.checked;
}

function points(q, fraction, answered, mode) {
  const w = CONFIG.levels[q.level].weight;
  if (fraction > 0) return +(w * fraction).toFixed(2);
  if (answered && mode === "exam") return -w * CONFIG.negativeRatio;
  return 0;
}

function record(kind) {
  const Z = S.quiz, q = Z.qs[Z.i], h = Z.handler;
  let fraction = 0, status = "skip", answered = false;
  if (kind === "skip") {
    if (Z.timedOut) { fraction = Z.timedOut.fraction; status = Z.timedOut.status; }
  } else {
    answered = h.answered();
    fraction = answered ? h.grade().fraction : 0;
    status = !answered ? "skip" : fraction === 1 ? "correct" : fraction > 0 ? "partial" : "wrong";
  }
  const res = { q, status, fraction, pts: points(q, fraction, answered && status === "wrong", Z.mode), summary: h.summary() };
  Z.results[Z.i] = res;
  return res;
}

function onNext() {
  const Z = S.quiz;
  if (Z.mode === "exam") {
    if (Z.timedOut) return;
    record("next");
    return advance();
  }
  if (!Z.checked) {
    const r = record("next");
    lockCurrent(); Z.handler.reveal(); Z.checked = true;
    showFeedback(r);
    return refreshButtons();
  }
  advance();
}
function onSkip() {
  const Z = S.quiz;
  record("skip");
  if (Z.mode !== "exam" && !Z.checked) { lockCurrent(); Z.handler.reveal(); Z.checked = true; showFeedback(Z.results[Z.i]); return refreshButtons(); }
  advance();
}
function advance() {
  const Z = S.quiz;
  clearInterval(Z.timer);
  if (Z.mode === "exam") { const seen = new Set(store.get("seen", [])); seen.add(Z.qs[Z.i].id); store.set("seen", [...seen].slice(-2000)); }
  Z.i++;
  if (Z.i < Z.qs.length) loadQuestion(); else finish();
}

function showFeedback(r) {
  const f = $("#qFeedback");
  const cls = r.status === "correct" ? "ok" : r.status === "partial" ? "part" : "bad";
  const head = r.status === "correct" ? "Right" : r.status === "partial" ? `Partly right, ${Math.round(r.fraction * 100)}% of the points` : r.status === "skip" ? "Skipped" : "Wrong";
  f.className = "feedback " + cls;
  f.innerHTML = `<h4>${head}</h4>${r.q.type === "terminal" || r.q.type === "fill" ? r.summary : ""}<div>${md(r.q.explanation || "")}</div>`;
  f.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ---------------- exit / anti-cheat ---------------- */
let exitArmed = null;
function onExit() {
  const b = $("#btnExit");
  if (!exitArmed) {
    b.textContent = "Exit and lose progress?";
    exitArmed = setTimeout(() => { b.textContent = "Exit"; exitArmed = null; }, 3000);
    return;
  }
  clearTimeout(exitArmed); exitArmed = null; b.textContent = "Exit";
  quit("You left the test. Nothing was scored.");
}
function quit(msg) {
  const Z = S.quiz; if (Z) clearInterval(Z.timer);
  S.quiz = null;
  document.body.classList.remove("exam");
  $("#thanksMsg").textContent = msg;
  show("thanks");
}
document.addEventListener("visibilitychange", () => {
  const Z = S.quiz;
  if (!Z || Z.mode !== "exam" || !document.hidden) return;
  Z.strikes++;
  if (Z.strikes >= CONFIG.tabSwitchStrikes) return quit("The test ended because you left the tab twice. Nothing was scored.");
  const b = $("#banner"); b.className = "banner bad";
  b.textContent = "You left the test tab. If you leave again, the test ends.";
});
document.addEventListener("contextmenu", e => { if (S.quiz && S.quiz.mode === "exam") e.preventDefault(); });

/* ---------------- result ---------------- */
function finish() {
  const Z = S.quiz;
  clearInterval(Z.timer);
  document.body.classList.remove("exam");
  const R = Z.results;
  const max = R.reduce((a, r) => a + CONFIG.levels[r.q.level].weight, 0);
  const score = +R.reduce((a, r) => a + r.pts, 0).toFixed(2);
  const pct = Math.max(0, Math.round((score / max) * 1000) / 10);
  const cnt = k => R.filter(r => r.status === k).length;
  const secs = Math.round((Date.now() - Z.started) / 1000);
  const pass = pct >= CONFIG.passPercent;
  const group = key => {
    const m = {};
    R.forEach(r => { const k = r.q[key]; m[k] = m[k] || { got: 0, max: 0, n: 0 }; m[k].got += Math.max(0, r.pts); m[k].max += CONFIG.levels[r.q.level].weight; m[k].n++; });
    return Object.entries(m).map(([k, v]) => ({ k, pct: Math.round((v.got / v.max) * 100), n: v.n }));
  };
  const byCat = group("category").sort((a, b) => b.pct - a.pct);
  const byLvl = group("level").sort((a, b) => LEVELS.indexOf(a.k) - LEVELS.indexOf(b.k));
  const lvlName = Z.mode === "demo" ? "Tour" : S.level === "mixed" ? "Mixed" : CONFIG.levels[S.level]?.label;

  if (Z.mode !== "demo") {
    const hist = store.get("history", []);
    hist.unshift({ at: Date.now(), mode: Z.mode, level: lvlName, n: R.length, pct, score, max });
    store.set("history", hist.slice(0, 30));
  }
  const row = (label, p, n) => `<tr><td>${label}</td><td class="num">${n}</td><td class="num">${p}%</td><td class="barcell"><span class="bar"><i style="width:${p}%" class="${p >= 70 ? "ok" : p >= 40 ? "mid" : "low"}"></i></span></td></tr>`;
  const mark = r => ({ correct: ["ok", "+" + r.pts], partial: ["part", "+" + r.pts], wrong: ["bad", String(r.pts)], skip: ["skip", "0"], timeout: ["skip", "0, timed out"] }[r.status]);
  const mistakes = R.filter(r => r.status !== "correct").map(r => r.q);
  const verdict = Z.mode === "demo" ? "That's the tour." : pass ? "Passed." : `Below the ${CONFIG.passPercent}% pass mark.`;
  const weakest = [...byCat].sort((a, b) => a.pct - b.pct)[0];

  $("#resultBody").innerHTML = `
  <article class="report">
    <p class="report-kicker">${Z.mode === "demo" ? `Tour, ${R.length} questions, ${fmtTime(secs)}` : `${esc(lvlName)}, ${R.length} questions, ${Z.mode} mode, ${fmtTime(secs)}`}</p>
    <h1 class="report-score"><span class="${pass ? "ok" : "bad"}">${pct}%</span> ${score} of ${max} points. ${verdict}</h1>
    <ul class="tally">
      <li><b>${cnt("correct")}</b> right</li>
      <li><b>${cnt("partial")}</b> partly right</li>
      <li><b>${cnt("wrong")}</b> wrong</li>
      <li><b>${cnt("skip") + cnt("timeout")}</b> skipped</li>
    </ul>
    ${weakest && weakest.pct < 70 && Z.mode !== "demo" ? `<p class="advice">Your weakest topic was <b>${esc(weakest.k)}</b> at ${weakest.pct}%. Start there.</p>` : ""}
    <div class="cta-row">
      ${mistakes.length ? `<button class="btn primary" id="btnMistakes">Practise the ${mistakes.length} you missed</button>` : ""}
      <button class="btn" id="btnAgain">Start a new test</button>
      ${Z.mode !== "demo" ? `<button class="btn" id="btnShare">Share on LinkedIn</button>
      <button class="btn ghost" id="btnDownload">Download result image</button>` : ""}
    </div>

    <div class="report-grid">
      <section><h2>By topic</h2><table class="rtable"><tr><th>Topic</th><th class="num">Qs</th><th class="num">Score</th><th></th></tr>${byCat.map(x => row(esc(x.k), x.pct, x.n)).join("")}</table></section>
      <section><h2>By severity</h2><table class="rtable"><tr><th>Level</th><th class="num">Qs</th><th class="num">Score</th><th></th></tr>${byLvl.map(x => row(`<span class="sev-tag sev-${CONFIG.levels[x.k].sev}">SEV-${CONFIG.levels[x.k].sev}</span> ${CONFIG.levels[x.k].label}`, x.pct, x.n)).join("")}</table></section>
    </div>

    <section class="review"><h2>Every question, with the explanation</h2>
    ${R.map((r, i) => { const [c, t] = mark(r); return `<details class="ritem"><summary><span class="rnum">${i + 1}</span><span class="rq">${esc(r.q.title || stripMd(r.q.question || r.q.scenario))}</span><span class="rmeta">SEV-${CONFIG.levels[r.q.level].sev}, ${TYPE_LABEL[r.q.type].toLowerCase()}</span><span class="rpts ${c}">${t}</span></summary>
      <div class="rbody">${r.q.scenario ? `<p class="scenario">${md(r.q.scenario)}</p>` : ""}${r.q.question ? `<p><b>${md(r.q.question)}</b></p>` : ""}${r.summary}<div class="why"><h4>Why</h4>${md(r.q.explanation || "")}</div></div></details>`; }).join("")}
    </section>
  </article>`;
  $("#btnAgain").onclick = () => show("home");
  const bm = $("#btnMistakes"); if (bm) bm.onclick = () => startQuiz(mistakes.map(fresh), "practice");
  if (Z.mode !== "demo") {
    const card = {
      pct, score, max, pass, mode: Z.mode, n: R.length, levelName: lvlName, levelKey: S.level,
      sevTag: S.level === "mixed" ? "SEV-4→1" : `SEV-${CONFIG.levels[S.level].sev}`,
      secs: `in ${fmtTime(secs)}`,
      counts: { correct: cnt("correct"), partial: cnt("partial"), wrong: cnt("wrong"), skip: cnt("skip") + cnt("timeout") },
      topics: byCat, date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
    };
    wireShare(card);
  }
  S.quiz = null;
  show("result");
}
/* ---------------- share card ---------------- */
function wireShare(card) {
  let blob = null, url = null;
  const fname = `devops-quiz-${card.levelName.toLowerCase().replace(/\s+/g, "-")}-${Math.round(card.pct)}.png`;
  const ready = (async () => { const cv = await drawResultCard(card); blob = await toBlob(cv); url = URL.createObjectURL(blob); })();
  const download = async () => {
    await ready;
    const a = el("a", { href: url, download: fname }); document.body.appendChild(a); a.click(); a.remove();
  };
  $("#btnDownload").onclick = async e => { e.target.textContent = "Downloading…"; await download(); e.target.textContent = "Download result image"; };
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  $("#btnShare").onclick = async () => {
    await ready;
    const d = $("#shareDlg"), note = $("#shareNote");
    $("#shareImg").src = url;
    $("#shareText").value = postText(card);
    note.textContent = ""; note.classList.remove("done");
    $("#shareDlDone").hidden = true;
    $("#shareWhere").innerHTML = ios
      ? "<b>On iPhone:</b> Safari asks whether to download the file. Tap <b>Download</b>, then come back to this page for step 2. It's saved in the Files app: open it there and tap Share, then Save Image, so LinkedIn can find it in Photos."
      : mobile ? "It goes to your phone's Downloads, so you can pick it from your gallery or files in LinkedIn." : "It goes to your Downloads folder.";
    $("#shareApp").textContent = mobile
      ? "The post text, with the quiz link, is copied. LinkedIn opens. Tap Start a post, paste the text, add the image with the photo button, and post."
      : "The post text, with the quiz link, is copied and LinkedIn opens in a new tab with the post box. Paste the text if it isn't already there, add the image with the photo button, and post.";
    const file = new File([blob], fname, { type: "image/png" });
    const canNative = mobile && !!(navigator.canShare && navigator.canShare({ files: [file] }));
    $("#shareFast").hidden = !canNative;
    $("#shareLead").hidden = canNative;
    $("#shareNative").onclick = async () => {
      const text = $("#shareText").value;
      navigator.clipboard?.writeText(text).catch(() => {});
      try {
        await navigator.share({ files: [file], text });
        note.textContent = "Sent. If LinkedIn left the text out, paste it: it's copied."; note.classList.add("done");
      } catch (err) { if (err.name !== "AbortError") note.textContent = "Your phone couldn't share it. Use the two steps below instead."; }
    };
    // Each step runs straight from the tap: phones only allow downloads, copying and new tabs from a tap.
    const plainDownload = () => { const a = el("a", { href: url, download: fname }); document.body.appendChild(a); a.click(); a.remove(); $("#shareDlDone").hidden = false; };
    const iosPhotos = ios && !!(navigator.canShare && navigator.canShare({ files: [file] }));
    $("#shareDownload").textContent = iosPhotos ? "Save image to Photos" : "Download image";
    if (iosPhotos) $("#shareWhere").innerHTML = "In the menu that opens, tap <b>Save Image</b>. It goes to your Photos, where LinkedIn's photo button can find it. Then come back here for step 2.";
    $("#shareDownload").onclick = async () => {
      if (!iosPhotos) return plainDownload();
      try { await navigator.share({ files: [file] }); $("#shareDlDone").hidden = false; }
      catch (err) { if (err.name !== "AbortError") plainDownload(); }
    };
    $("#shareLinkedIn").onclick = () => {
      const text = $("#shareText").value;
      navigator.clipboard?.writeText(text).catch(() => {});
      const w = window.open(`https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`, "_blank");
      if (w) w.opener = null;
      note.classList.add("done");
      note.textContent = w === null && !mobile
        ? "Text copied. Your browser blocked the new tab: open linkedin.com, click Start a post and paste."
        : "Text copied. If the post box isn't open, start a post and paste.";
    };
    d.showModal ? d.showModal() : d.setAttribute("open", "");
    (canNative ? $("#shareNative") : $("#shareDownload")).focus();
  };
}
const stripMd = s => String(s || "").replace(/[`*]/g, "").slice(0, 120);

/* ---------------- history ---------------- */
function showHistory() {
  const h = store.get("history", []);
  $("#historyBody").innerHTML = h.length ? `<table class="rtable"><tr><th>When</th><th>Test</th><th class="num">Points</th><th class="num">Score</th></tr>${h.map(x => `<tr><td>${new Date(x.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</td><td>${esc(x.level)}, ${x.n} questions, ${x.mode}</td><td class="num">${x.score} / ${x.max}</td><td class="num ${x.pct >= CONFIG.passPercent ? "ok" : "bad"}">${x.pct}%</td></tr>`).join("")}</table>`
    : `<p>Your finished tests show up here. <button class="link inline" data-go="home">Start one</button></p>`;
  show("history");
}

/* ---------------- wiring ---------------- */
function wireGlobal() {
  const applyTheme = t => {
    const dark = t === "dark";
    if (dark) document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme;
    $("#themeBtn").setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    $("#themeBtn").title = dark ? "Light mode" : "Dark mode";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#15181c" : "#f7f8fa");
  };
  applyTheme(store.get("theme", "light"));
  $("#themeBtn").onclick = () => { const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; store.set("theme", t); applyTheme(t); };
  $("#btnStart").onclick = () => startQuiz(S.pending, S.mode);
  $("#btnNext").onclick = onNext;
  $("#btnSkip").onclick = onSkip;
  $("#btnExit").onclick = onExit;
  $("#btnClearHistory").onclick = () => { store.del("history"); showHistory(); };
  $("#brandHome").onclick = e => { e.preventDefault(); if (!S.quiz) show("home"); };
  document.addEventListener("click", e => {
    const g = e.target.closest("[data-go]"); if (!g) return;
    if (S.quiz && g.dataset.go !== "home") return; // no navigation mid-test
    if (g.dataset.go === "home") show("home");
    if (g.dataset.go === "history") showHistory();
    if (g.dataset.go === "demo") startQuiz(S.demo.map(q => ({ ...fresh(q), level: q.level || "easy" })), "demo");
  });
  document.addEventListener("keydown", e => {
    if (!S.quiz || $("#screen-quiz").classList.contains("hidden")) return;
    if (e.target.tagName === "INPUT") return;
    if ((e.ctrlKey || e.metaKey) && ["+", "-", "0", "="].includes(e.key) && S.quiz.mode === "exam") { e.preventDefault(); return; }
    if (/^[1-9]$/.test(e.key) && S.quiz.handler.key) S.quiz.handler.key(+e.key - 1);
    if (e.key === "Enter" && !$("#btnNext").disabled) { e.preventDefault(); onNext(); }
  });
  document.addEventListener("wheel", e => { if (e.ctrlKey && S.quiz && S.quiz.mode === "exam") e.preventDefault(); }, { passive: false });
}

boot();
