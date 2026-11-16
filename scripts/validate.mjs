// Validates data/*.json with the *browser's* regex engine and the real normalizeCmd().
// Usage: node scripts/validate.mjs
import { readFileSync } from "node:fs";
import { normalizeCmd } from "../assets/js/types.js";

const dir = new URL("../data/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("index.json", dir)));
const files = [...index.banks.map(b => b.file), index.demo];
let errors = 0, total = 0;
const fail = (id, m) => { errors++; console.error(`✘ [${id}] ${m}`); };
const re = (p, id, f = "") => { try { return new RegExp(p, f); } catch (e) { fail(id, `bad regex ${p}: ${e.message}`); return /(?!)/; } };

for (const f of files) {
  const qs = JSON.parse(readFileSync(new URL(f, dir)));
  for (const q of qs) {
    total++;
    if (q.type === "terminal") {
      (q.explore || []).forEach(e => re(e.match, q.id));
      q.steps.forEach((s, i) => {
        const acc = s.accept.map(p => re(p, q.id, q.ignoreCase ? "i" : ""));
        (s.wrong || []).forEach(w => re(w.match, q.id));
        for (const c of s.check || [s.solution]) {
          if (!acc.some(r => r.test(normalizeCmd(c)))) fail(q.id, `step ${i + 1} solution not accepted: ${c}`);
        }
      });
    }
    if (q.type === "fill") {
      for (const [k, b] of Object.entries(q.blanks)) {
        if (!b.accept.some(p => re(p, q.id).test(b.solution))) fail(q.id, `blank ${k} solution not accepted`);
      }
    }
  }
}
console.log(errors ? `\n${errors} error(s) in ${total} questions` : `✔ ${total} questions valid (bank ${index.version})`);
process.exit(errors ? 1 : 0);
