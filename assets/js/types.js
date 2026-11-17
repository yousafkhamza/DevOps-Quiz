// Question type renderers + graders.
// Each renderer returns a handler: { answered(), grade(), lock(), reveal(), summary() }
//   grade()   -> { fraction: 0..1, detail: string(html) }
//   summary() -> html describing the user's response (for review)
import { CONFIG } from "./config.js";
import { el, esc, md, shuffle, codeBlock, highlightOutput, $$ } from "./util.js";
import { basicCommand, hasMan, skeleton, completions, commonPrefix, harvest } from "./shell.js";

export const TYPE_LABEL = { mcq: "Single answer", multi: "Select all", terminal: "Live terminal", fill: "Fill the manifest", spot: "Spot the bug", order: "Order the steps" };

/* ------------------------------------------------------------------ */
/* Shared: context blocks (logs, manifests, terminal snapshots)        */
/* ------------------------------------------------------------------ */
export function renderContext(blocks = []) {
  const box = el("div", { class: "ctx" });
  if (!blocks.length) return box;
  if (blocks.length === 1) {
    const b = blocks[0];
    if (b.title) box.appendChild(el("div", { class: "ctx-tabs" }, `<span class="ctx-tab active">${esc(b.title)}</span>`));
    box.appendChild(codeBlock(b.content, b.kind, { numbers: b.kind !== "terminal" && b.kind !== "log", single: !b.title }));
    return box;
  }
  const tabs = el("div", { class: "ctx-tabs" });
  const panes = blocks.map((b, i) => {
    const t = el("button", { class: "ctx-tab" + (i ? "" : " active"), type: "button" }, esc(b.title || b.kind));
    tabs.appendChild(t);
    const p = codeBlock(b.content, b.kind, { numbers: b.kind !== "terminal" && b.kind !== "log", single: false });
    if (i) p.classList.add("hidden");
    t.onclick = () => {
      $$(".ctx-tab", tabs).forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      panes.forEach(x => x.classList.add("hidden"));
      p.classList.remove("hidden");
    };
    return p;
  });
  box.appendChild(tabs);
  panes.forEach(p => box.appendChild(p));
  return box;
}

export function render(q, root, ctx) {
  const fn = { mcq: renderChoice, multi: renderChoice, terminal: renderTerminal, fill: renderFill, spot: renderSpot, order: renderOrder }[q.type];
  if (!fn) throw new Error("Unknown question type " + q.type);
  return fn(q, root, ctx);
}

/* ------------------------------------------------------------------ */
/* MCQ / MULTI                                                         */
/* ------------------------------------------------------------------ */
function renderChoice(q, root, ctx) {
  const multi = q.type === "multi";
  const correct = new Set([].concat(q.answer));
  // shuffle once per attempt, keep the original indexes for grading
  const order = q._order || (q._order = q.shuffle === false ? q.options.map((_, i) => i) : shuffle(q.options.map((_, i) => i)));
  const chosen = new Set();
  const list = el("div", { class: "options" });
  if (multi) root.appendChild(el("p", { class: "muted small" }, `${correct.size} options are right. You only score if you pick all of them and nothing else.`));
  const btns = order.map((oi, pos) => {
    const b = el("button", { class: "opt" + (multi ? " multi" : ""), type: "button", "data-oi": oi },
      `<span class="key">${pos + 1}</span><span>${md(q.options[oi])}</span>`);
    b.onclick = () => toggle(oi);
    list.appendChild(b);
    return b;
  });
  root.appendChild(list);

  function toggle(oi) {
    if (ctx.isLocked()) return;
    if (multi) chosen.has(oi) ? chosen.delete(oi) : chosen.add(oi);
    else { chosen.clear(); chosen.add(oi); }
    btns.forEach(b => b.classList.toggle("selected", chosen.has(+b.dataset.oi)));
    ctx.onChange();
  }
  return {
    key(n) { if (order[n] !== undefined) toggle(order[n]); },
    answered: () => chosen.size > 0,
    grade() {
      const ok = chosen.size === correct.size && [...chosen].every(i => correct.has(i));
      return { fraction: ok ? 1 : 0 };
    },
    lock() { list.parentElement.classList.add("locked"); },
    reveal() {
      btns.forEach(b => {
        const oi = +b.dataset.oi;
        if (correct.has(oi)) b.classList.add("is-correct");
        else if (chosen.has(oi)) b.classList.add("is-wrong");
      });
    },
    summary() {
      const yours = [...chosen].map(i => md(q.options[i])).join(", ") || "<i>no answer</i>";
      const right = [...correct].map(i => md(q.options[i])).join(", ");
      return `<p class="yours">Your answer: ${yours}</p><p>Correct: <b>${right}</b></p>`;
    },
  };
}

/* ------------------------------------------------------------------ */
/* TERMINAL (live session)                                             */
/* ------------------------------------------------------------------ */
export function normalizeCmd(raw) {
  let c = String(raw).trim().replace(/\s+/g, " ").replace(/;+$/, "");
  c = c.replace(/^\$\s*/, "").replace(/^sudo\s+((-[EHnis]+|-u\s+\S+)\s+)*(?=[^-\s])/, "");
  c = c.replace(/^k\s/, "kubectl ").replace(/^tf\s/, "terraform ");
  return c;
}
const toRe = (p, flags = "") => new RegExp(p, flags);
// A command "tries to solve" the task if it starts like the solution does
// (first two words, or the step's explicit `tool` prefix). Everything else is free exploration.
function toolsOf(step) {
  if (step.tool) return [].concat(step.tool);
  const t = normalizeCmd(step.solution).split(" ");
  return [t[1] && !t[1].startsWith("-") ? t[0] + " " + t[1] : t[0]];
}
const isToolCmd = (cmd, step, ci) => toolsOf(step).some(t => {
  const c = ci ? cmd.toLowerCase() : cmd, x = ci ? t.toLowerCase() : t;
  return c === x || c.startsWith(x + " ");
});
const BUILTINS = ["help", "clear", "hint", "skip", "tasks", "history"];
const HINT_COST = CONFIG.hintPenalties; // cumulative cost after hint 1 and hint 2
const pct = x => Math.round(x * 100) + "%";

function renderTerminal(q, root, ctx) {
  const F = q.ignoreCase ? "i" : "";
  const re = p => toRe(p, F);
  const steps = q.steps.map(s => ({ ...s, hintText: s.hint, status: "todo", attempts: 0, hints: 0, passedWith: null }));
  // a believable shell: who/where we are, which tools exist, words seen on screen (for Tab)
  const [user, host] = String(q.host || "devops@bastion").split("@");
  const pm = String(q.prompt || "").match(/:(~?[^$#]*)[$#]\s*$/);
  const winCwd = String(q.prompt || "").match(/^PS\s+(.+?)>\s*$/);
  const home = user === "root" ? "/root" : `/home/${user}`;
  const env = {
    user, host: host || "bastion", home, ignoreCase: !!q.ignoreCase,
    cwd: winCwd ? winCwd[1] : pm ? pm[1].replace(/^~/, home) || home : home,
    tools: new Set(q.steps.flatMap(s => [].concat(s.check || s.solution).map(c => normalizeCmd(c).split(" ")[0].toLowerCase()))
      .concat((q.explore || []).map(e => (String(e.match).match(/^\^?([a-zA-Z][\w-]*)/) || [])[1]).filter(Boolean).map(w => w.toLowerCase()))),
  };
  // the prompt follows cd, like a real shell
  const promptText = () => {
    const p0 = String(q.prompt || "$");
    if (winCwd) return `PS ${env.cwd}>`;
    if (!pm) return p0;
    const d = env.cwd === env.home ? "~" : env.cwd.startsWith(env.home + "/") ? "~" + env.cwd.slice(env.home.length) : env.cwd;
    return p0.replace(/:(~?[^$#]*)([$#])\s*$/, `:${d}$2`);
  };
  const screenWords = new Set();
  const explore = (q.explore || []).map(e => ({ re: re(e.match), out: e.output, sets: e.sets }));
  const flags = new Set(); // simple lab state, e.g. "autosync_off"
  let cur = 0;
  const history = [];
  let hIdx = 0;
  let touched = false;

  const term = el("div", { class: "term" });
  term.innerHTML = `
    <div class="term-head"><span class="ttl">${esc(q.host || "devops@bastion")}</span></div>
    <div class="term-tasks"></div>
    <div class="term-out"></div>
    <div class="term-foot"><span><b>Tab</b> completes · <b>man</b> <i>cmd</i> or <i>cmd</i> <b>--help</b> (free) · <b>hint</b> −${pct(HINT_COST[0])}, again −${pct(HINT_COST[1])} · <b>skip</b> gives up a task</span><span class="foot-r"><span class="att"></span><button type="button" class="skip-task">Skip this task</button></span></div>`;
  root.appendChild(term);
  const tasksEl = term.querySelector(".term-tasks");
  const out = term.querySelector(".term-out");
  const att = term.querySelector(".att");
  const skipBtn = term.querySelector(".skip-task");
  skipBtn.onclick = () => { if (!ctx.isLocked() && steps[cur]) { echo("skip"); skipTask(); input.focus(); } };
  const inRow = el("div", { class: "term-in" }, `<span class="ps">${esc(promptText())}</span>`);
  const input = el("input", { type: "text", spellcheck: "false", autocomplete: "off", autocapitalize: "off", "aria-label": "terminal input" });
  inRow.appendChild(input);

  if (ctx.mode === "exam" && CONFIG.blockPasteInExam) {
    input.addEventListener("paste", e => { e.preventDefault(); print("[paste disabled in exam mode — type it]", "t-sys"); });
  }
  out.addEventListener("click", () => input.focus());

  function print(text, cls = "") {
    const line = el("div", { class: "term-line " + cls });
    line.innerHTML = cls ? esc(text) : highlightOutput(text);
    if (!cls) harvest(text).forEach(w => screenWords.add(w));
    out.insertBefore(line, inRow);
    out.scrollTop = out.scrollHeight;
  }
  function echo(cmd) {
    const line = el("div", { class: "term-line" }, `<span class="h-prompt">${esc(promptText())}</span> <span class="h-cmd">${esc(cmd)}</span>`);
    out.insertBefore(line, inRow);
  }
  function drawTasks() {
    tasksEl.innerHTML = steps.map((s, i) => {
      const cls = s.status === "pass" ? "done" : s.status === "fail" ? "fail" : s.status === "skip" ? "skipped" : i === cur ? "cur" : "";
      const ic = s.status === "pass" ? "✔" : s.status === "fail" ? "✘" : s.status === "skip" ? "↷" : i === cur ? "▶" : "·";
      const hint = s.hints && s.status === "pass" ? ` <span class="t-hint">(${s.hints} hint${s.hints > 1 ? "s" : ""})</span>` : "";
      return `<div class="term-task ${cls}"><span class="ic">${ic}</span><span>Task ${i + 1}/${steps.length}: ${md(s.task)}${hint}</span></div>`;
    }).join("");
    const s = steps[cur];
    att.textContent = s ? `attempts left: ${CONFIG.maxAttemptsPerStep - s.attempts}` : "all tasks finished";
    skipBtn.hidden = !s;
  }

  out.appendChild(inRow);
  (q.motd ? q.motd.split("\n") : []).forEach(l => print(l));
  print(`# ${steps.length} task${steps.length > 1 ? "s" : ""}. Type the command you'd really run — flags in any order. Exploring is free;`, "t-sys");
  print("# only commands that try to solve the current task use an attempt. Stuck? man <cmd>, Tab, then hint.", "t-sys");
  drawTasks();

  function finishStep(status) {
    steps[cur].status = status;
    cur++;
    if (cur >= steps.length) {
      print("# all tasks finished — press Next to submit.", "t-sys");
      input.disabled = true;
      ctx.onChange(true);
      skipBtn.hidden = true;
    }
    drawTasks();
  }

  function skipTask() {
    const s = steps[cur];
    if (!s) return;
    print(`↷ task ${cur + 1} skipped — it scores 0, nothing negative. Moving on.`, "t-sys");
    if (ctx.mode !== "exam") print("solution: " + s.solution, "t-hint");
    finishStep("skip");
    ctx.onChange();
  }

  function run(raw) {
    const cmd = normalizeCmd(raw);
    if (!cmd) return;
    echo(raw.trim());
    history.push(raw.trim()); hIdx = history.length;
    const word = cmd.split(" ")[0];

    if (BUILTINS.includes(cmd) || cmd === "solution") {
      if (cmd === "clear") { $$(".term-line", out).forEach(n => n.remove()); return; }
      if (cmd === "help") {
        print(`Lab commands: hint (−${pct(HINT_COST[0])}; a second hint shows the command's shape, −${pct(HINT_COST[1])} total), skip (gives up this task: 0, never negative), tasks, history, clear` + (ctx.mode !== "exam" ? ", solution (practice only)" : ""), "t-sys");
        print("Free help, like a real shell: man <cmd>, <cmd> --help, Tab to complete, ↑/↓ for history, Ctrl+C to cancel a line.", "t-sys");
        print(`Tools in this lab: ${[...env.tools].filter(t => t !== "answer").join(", ")}. Aliases: k → kubectl, tf → terraform.`, "t-sys");
        print("Output is pre-recorded for this incident, so only commands related to it are simulated.", "t-sys");
        return;
      }
      if (cmd === "tasks") { steps.forEach((s, i) => print(`${i + 1}. [${s.status}] ${s.task.replace(/`/g, "")}`, "t-sys")); return; }
      if (cmd === "history") { history.forEach((h, i) => print(`${String(i + 1).padStart(4)}  ${h}`)); return; }
      const s = steps[cur];
      if (!s) return print("# nothing left to do", "t-sys");
      if (cmd === "skip") return skipTask();
      if (cmd === "hint") {
        if (s.hints >= 2) return print("# no more hints for this task — try it, or skip", "t-sys");
        s.hints++; touched = true;
        const solo = (s.check && s.check[0]) || s.solution;
        if (s.hints === 1) {
          print(`hint 1/2 (task now worth ${pct(1 - HINT_COST[0])}): ` + (s.hintText || `start with \`${normalizeCmd(solo).split(" ")[0]}\` — check its man page`), "t-hint");
        } else {
          print(`hint 2/2 (task now worth ${pct(1 - HINT_COST[1])}): shape of the command → ${skeleton(solo)}`, "t-hint");
        }
        drawTasks();
        return;
      }
      if (cmd === "solution") {
        if (ctx.mode === "exam") return print("solution: not available in exam mode", "t-sys");
        touched = true;
        print("solution: " + s.solution, "t-hint");
        print("# task marked failed", "t-fail");
        return finishStep("fail");
      }
      return;
    }
    const s = steps[cur];
    if (s && s.accept.some(p => re(p).test(cmd))) {
      touched = true;
      if (s.requires && !flags.has(s.requires)) { // right command, wrong moment
        s.attempts++;
        print(s.blocked || "error: precondition not met");
        const left = CONFIG.maxAttemptsPerStep - s.attempts;
        print(left > 0 ? `✘ that didn't complete the task (${left} attempt${left > 1 ? "s" : ""} left)` : "✘ out of attempts for this task", "t-fail");
        if (left <= 0) { if (ctx.mode !== "exam") print("solution: " + s.solution, "t-hint"); finishStep("fail"); } else drawTasks();
        ctx.onChange();
        return;
      }
      s.passedWith = cmd;
      if (s.output) print(s.output);
      print(`✔ task ${cur + 1} complete`, "t-pass");
      ctx.onChange();
      return finishStep("pass");
    }
    // re-running an earlier task's command just replays its output (free)
    const prev = steps.slice(0, cur).find(p => p.accept.some(a => re(a).test(cmd)));
    if (prev) { if (prev.output) print(prev.output); return; }
    const ex = explore.find(e => e.re.test(cmd));
    if (ex) { if (ex.sets) flags.add(ex.sets); print(ex.out); return; }
    // custom realistic output for common wrong moves (always counts as an attempt)
    const wrong = s && (s.wrong || []).find(w => re(w.match).test(cmd));
    if (s && (wrong || isToolCmd(cmd, s, !!F))) {
      touched = true;
      s.attempts++;
      if (wrong) print(wrong.output);
      const left = CONFIG.maxAttemptsPerStep - s.attempts;
      print(left > 0 ? `✘ that didn't complete the task (${left} attempt${left > 1 ? "s" : ""} left)` : "✘ out of attempts for this task", "t-fail");
      if (left <= 0) {
        if (ctx.mode !== "exam") print("solution: " + s.solution, "t-hint");
        finishStep("fail");
      } else drawTasks();
      ctx.onChange();
      return;
    }
    const before = env.cwd;
    const basic = basicCommand(cmd, env);
    if (env.cwd !== before) { env.prev = before; inRow.querySelector(".ps").textContent = promptText(); }
    if (basic !== null) { if (basic) print(basic); return; }
    const lw = word.toLowerCase();
    if (lw === "ls" || lw === "dir" || lw === "get-childitem") return;               // nothing else of interest here
    if (lw === "cat" || lw === "less" || lw === "more" || lw === "get-content") return print(`${word}: ${cmd.split(" ").slice(1).join(" ") || "missing file operand"}: No such file or directory`);
    if (env.tools.has(lw) || hasMan(lw))
      return print(`# ${word}: that works on a real system, but this incident only simulates the commands that matter here (no attempt used). Try man ${word}, Tab, or hint.`, "t-sys");
    print(env.ignoreCase
      ? `${word}: The term '${word}' is not recognized as a name of a cmdlet, function, script file, or executable program.`
      : `bash: ${word}: command not found`);
  }

  let lastTab = "";
  input.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Tab") {
      e.preventDefault();
      const line = input.value;
      const list = completions(line, screenWords, env.tools, env.ignoreCase);
      const head = line.slice(0, line.length - line.split(" ").pop().length);
      if (list.length === 1) input.value = head + list[0] + " ";
      else if (list.length > 1) {
        const p = commonPrefix(list);
        if (p.length > line.split(" ").pop().length) input.value = head + p;
        else if (lastTab === line) { echo(line); print(list.slice(0, 40).join("   ")); }
      }
      lastTab = line;
      return;
    }
    lastTab = "";
    if (e.key === "c" && e.ctrlKey && !window.getSelection().toString()) { e.preventDefault(); echo(input.value + "^C"); input.value = ""; return; }
    if (e.key === "u" && e.ctrlKey) { e.preventDefault(); input.value = ""; return; }
    if (e.key === "Enter") { e.preventDefault(); if (!ctx.isLocked()) { run(input.value); input.value = ""; } }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (hIdx > 0) input.value = history[--hIdx] || ""; }
    else if (e.key === "ArrowDown") { e.preventDefault(); hIdx = Math.min(history.length, hIdx + 1); input.value = history[hIdx] || ""; }
    else if (e.key === "l" && e.ctrlKey) { e.preventDefault(); $$(".term-line", out).forEach(n => n.remove()); }
  });
  setTimeout(() => input.focus({ preventScroll: true }), 50);

  const value = s => s.status === "pass" ? 1 - (s.hints ? HINT_COST[s.hints - 1] : 0) : 0;
  return {
    terminal: true,
    // a skipped task never counts as an attempt, so skipping everything scores 0, not negative
    answered: () => touched && steps.some(s => s.status === "pass" || s.status === "fail" || (s.status === "todo" && (s.attempts || s.hints))),
    grade() {
      const f = steps.reduce((a, s) => a + value(s), 0) / steps.length;
      return { fraction: Math.round(f * 100) / 100 };
    },
    lock() { input.disabled = true; term.classList.add("locked"); },
    reveal() {
      steps.forEach((s, i) => { if (s.status !== "pass") print(`solution ${i + 1}: ${s.solution}`, "t-hint"); });
    },
    summary() {
      return steps.map((s, i) => {
        const pill = s.status === "pass" ? (s.hints ? `<span class="pill part">${s.hints} hint${s.hints > 1 ? "s" : ""}</span>` : '<span class="pill ok">pass</span>') : s.status === "skip" ? '<span class="pill skip">skipped</span>' : '<span class="pill bad">' + (s.status === "fail" ? "fail" : "not done") + "</span>";
        return `<p>${pill} <b>Task ${i + 1}:</b> ${md(s.task)}</p>` +
          (s.passedWith ? `<div class="solution">$ ${esc(s.passedWith)}</div>` : "") +
          (s.passedWith && normalizeCmd(s.passedWith) === normalizeCmd(s.solution) ? "" : `<div class="solution">✔ reference: ${esc(s.solution)}</div>`);
      }).join("");
    },
  };
}

/* ------------------------------------------------------------------ */
/* FILL (manifest / HCL / Dockerfile with blanks)                      */
/* ------------------------------------------------------------------ */
function renderFill(q, root, ctx) {
  const wrap = el("div", { class: "code single fill" });
  const inputs = {};
  q.template.replace(/\n$/, "").split("\n").forEach((line, i) => {
    const row = el("div", { class: "codeline" });
    row.innerHTML = `<span class="ln">${i + 1}</span>`;
    const lc = el("span", { class: "lc" });
    // split on {{id}}
    const parts = line.split(/(\{\{\w+\}\})/);
    parts.forEach(p => {
      const m = p.match(/^\{\{(\w+)\}\}$/);
      if (m) {
        const b = q.blanks[m[1]];
        const inp = el("input", { type: "text", spellcheck: "false", autocomplete: "off", "data-id": m[1], placeholder: b.placeholder || "" });
        inp.style.width = Math.max(6, (b.width || b.solution.length) + 2) + "ch";
        inp.addEventListener("input", () => ctx.onChange());
        inp.addEventListener("keydown", e => e.stopPropagation());
        if (ctx.mode === "exam" && CONFIG.blockPasteInExam) inp.addEventListener("paste", e => e.preventDefault());
        inputs[m[1]] = inp;
        lc.appendChild(inp);
      } else {
        const s = el("span"); s.innerHTML = highlightLineSafe(p, q.lang); lc.appendChild(s);
      }
    });
    row.appendChild(lc);
    wrap.appendChild(row);
  });
  root.appendChild(el("p", { class: "muted small" }, "Type into the dashed boxes. Case matters; extra spaces don't."));
  root.appendChild(wrap);
  const ids = Object.keys(q.blanks);
  const ok = id => q.blanks[id].accept.some(p => toRe(p).test(inputs[id].value.trim()));
  return {
    answered: () => ids.some(id => inputs[id].value.trim() !== ""),
    grade() {
      const n = ids.filter(ok).length;
      return { fraction: Math.round((n / ids.length) * 100) / 100 };
    },
    lock() { wrap.classList.add("locked"); Object.values(inputs).forEach(i => i.disabled = true); },
    reveal() { ids.forEach(id => inputs[id].classList.add(ok(id) ? "good" : "bad")); },
    summary() {
      return ids.map(id => `<p>${ok(id) ? '<span class="pill ok">ok</span>' : '<span class="pill bad">wrong</span>'} blank <b>${esc(id)}</b>: <code>${esc(inputs[id].value || "—")}</code> → expected <code>${esc(q.blanks[id].solution)}</code></p>`).join("");
    },
  };
}
// highlight a partial line without breaking on fragments
function highlightLineSafe(text, lang) {
  if (lang === "yaml" && /^\s*[\w.\-/]+:/.test(text)) {
    return text.replace(/^(\s*-?\s*)([\w.\-/]+)(:)(.*)$/, (_, a, k, c, r) => `${esc(a)}<span class="h-key">${esc(k)}</span>${c}${esc(r)}`);
  }
  if (/^\s*#/.test(text)) return `<span class="h-com">${esc(text)}</span>`;
  return esc(text);
}

/* ------------------------------------------------------------------ */
/* SPOT the buggy line(s)                                              */
/* ------------------------------------------------------------------ */
function renderSpot(q, root, ctx) {
  const correct = new Set([].concat(q.answer));
  const max = q.selectMax || correct.size;
  const chosen = new Set();
  root.appendChild(el("p", { class: "muted small" }, max > 1 ? `Click the ${max} lines that cause the problem.` : "Click the line that causes the problem."));
  const block = codeBlock(q.code, q.lang, { numbers: true, single: true });
  block.classList.add("spot");
  $$(".codeline", block).forEach(row => {
    row.onclick = () => {
      if (ctx.isLocked()) return;
      const n = +row.dataset.line;
      if (chosen.has(n)) chosen.delete(n);
      else {
        if (chosen.size >= max) chosen.delete([...chosen][0]);
        chosen.add(n);
      }
      $$(".codeline", block).forEach(r => r.classList.toggle("sel", chosen.has(+r.dataset.line)));
      ctx.onChange();
    };
  });
  root.appendChild(block);
  return {
    answered: () => chosen.size > 0,
    grade() { return { fraction: chosen.size === correct.size && [...chosen].every(n => correct.has(n)) ? 1 : 0 }; },
    lock() { block.classList.add("locked"); },
    reveal() {
      $$(".codeline", block).forEach(r => {
        const n = +r.dataset.line;
        r.classList.remove("sel");
        if (correct.has(n)) r.classList.add("good"); else if (chosen.has(n)) r.classList.add("miss");
      });
    },
    summary() {
      return `<p class="yours">You picked line(s): ${[...chosen].sort((a, b) => a - b).join(", ") || "—"}</p><p>Buggy line(s): <b>${[...correct].join(", ")}</b></p>`;
    },
  };
}

/* ------------------------------------------------------------------ */
/* ORDER the runbook                                                   */
/* ------------------------------------------------------------------ */
function renderOrder(q, root, ctx) {
  let cur = q._order || (q._order = (() => { let s; do { s = shuffle(q.items.map((_, i) => i)); } while (s.every((v, i) => v === i)); return s; })());
  let moved = false;
  const list = el("ol", { class: "order-list" });
  root.appendChild(el("p", { class: "muted small" }, "Move the steps with ↑ and ↓ until the first one is at the top."));
  root.appendChild(list);
  function draw(revealed) {
    list.innerHTML = "";
    cur.forEach((ii, pos) => {
      const li = el("li", { class: "order-item" + (revealed ? (ii === pos ? " good" : " bad") : "") },
        `<span class="num">${pos + 1}</span><span class="txt">${md(q.items[ii])}</span>`);
      const up = el("button", { type: "button", title: "move up" }, "↑");
      const dn = el("button", { type: "button", title: "move down" }, "↓");
      up.onclick = () => move(pos, -1); dn.onclick = () => move(pos, 1);
      li.append(up, dn);
      list.appendChild(li);
    });
  }
  function move(pos, d) {
    if (ctx.isLocked()) return;
    const np = pos + d;
    if (np < 0 || np >= cur.length) return;
    [cur[pos], cur[np]] = [cur[np], cur[pos]];
    moved = true; q._order = cur;
    draw(); ctx.onChange();
  }
  draw();
  return {
    answered: () => moved,
    grade() { return { fraction: cur.every((v, i) => v === i) ? 1 : 0 }; },
    lock() { list.classList.add("locked"); root.classList.add("locked"); },
    reveal() { draw(true); },
    summary() {
      return `<p class="yours">Your order: ${cur.map(i => i + 1).join(" → ")}</p><ol>${q.items.map(t => `<li>${md(t)}</li>`).join("")}</ol>`;
    },
  };
}
