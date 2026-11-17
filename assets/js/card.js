// DevOps Quiz 2.0: the shareable result card.
// Draws a 1200x1200 PNG (square crops well in the LinkedIn feed on phones and desktop),
// in the site's own look: cool paper, slate ink, pager yellow, one dark terminal block.
import { CONFIG } from "./config.js";

const C = {
  paper: "#f7f8fa", sheet: "#ffffff", ink: "#1d232b", ink2: "#4f5a68", ink3: "#7b8594",
  rule: "#dde1e7", pager: "#f5c518", wash: "#fdf1b8",
  ok: "#2f7d4f", mid: "#9a6a07", bad: "#b8322a",
  term: "#1b1e23", termInk: "#dfe3e8", termDim: "#8b939e",
  sev: { 1: "#b8322a", 2: "#c9661c", 3: "#2f6aa6", 4: "#4c7d5a" },
};
const SANS = '"IBM Plex Sans", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';

// A line that sounds like an on-call engineer, not a certificate.
export function headline(pct, mode) {
  if (mode === "practice") return pct >= 70 ? "Practice round, solid result." : "Practice round. Learning the hard way, safely.";
  if (pct >= 95) return "SEV-1? Already on it.";
  if (pct >= 85) return "On-call ready.";
  if (pct >= 70) return "Passed the on-call drill.";
  if (pct >= 50) return "Close. A few incidents got away.";
  if (pct >= 30) return "Rough shift. Every incident teaches something.";
  return "Day one on the pager. Everyone starts here.";
}

const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
function fitText(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

export async function drawResultCard(d) {
  // d: { pct, score, max, pass, mode, levelName, levelKey, sevTag, n, secs, counts:{correct,partial,wrong,skip}, topics:[{k,pct,n}], date }
  try { await Promise.all([`600 40px ${SANS}`, `400 20px ${SANS}`, `500 20px ${SANS}`, `400 20px ${MONO}`, `600 20px ${MONO}`].map(f => document.fonts.load(f))); } catch { /* fallback fonts are fine */ }
  const W = 1200, H = 1200, P = 80;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.textBaseline = "alphabetic";

  // paper with a faint dot grid, like an ops notebook
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#e6e9ee";
  for (let x = 40; x < W; x += 40) for (let y = 40; y < H; y += 40) ctx.fillRect(x, y, 2, 2);

  // brand row: the favicon mark and the name
  rr(ctx, P, P - 6, 56, 56, 12); ctx.fillStyle = C.term; ctx.fill();
  ctx.fillStyle = C.pager; ctx.font = `600 26px ${MONO}`; ctx.fillText(">_", P + 10, P + 31);
  ctx.fillStyle = C.ink; ctx.font = `600 30px ${MONO}`; ctx.fillText("devops-quiz", P + 76, P + 32);
  ctx.textAlign = "right"; ctx.fillStyle = C.ink3; ctx.font = `400 22px ${SANS}`;
  ctx.fillText(d.date, W - P, P + 30); ctx.textAlign = "left";

  // severity / mode line
  let y = P + 130;
  const tag = d.sevTag;
  ctx.font = `600 24px ${MONO}`;
  const tw = ctx.measureText(tag).width + 28;
  rr(ctx, P, y - 30, tw, 42, 6); ctx.fillStyle = d.levelKey === "mixed" ? C.ink : C.sev[CONFIG.levels[d.levelKey]?.sev || 1]; ctx.fill();
  ctx.fillStyle = "#fff"; ctx.fillText(tag, P + 14, y);
  ctx.fillStyle = C.ink2; ctx.font = `500 26px ${SANS}`;
  ctx.fillText(`${d.levelName}, ${d.n} questions, ${d.mode} mode`, P + tw + 18, y);

  // the score, big, with a highlighter stroke under it
  y += 200;
  const pctText = `${d.pct}%`;
  ctx.font = `600 190px ${SANS}`;
  const pw = ctx.measureText(pctText).width;
  ctx.fillStyle = C.wash; ctx.fillRect(P - 8, y - 58, pw + 16, 60);
  ctx.fillStyle = d.pass ? C.ok : d.pct >= 40 ? C.mid : C.bad;
  ctx.fillText(pctText, P, y);
  ctx.fillStyle = C.ink2; ctx.font = `400 28px ${SANS}`;
  ctx.fillText(`${d.score} of ${d.max} points`, P + pw + 30, y - 76);
  ctx.fillText(d.secs, P + pw + 30, y - 36);

  // headline
  y += 76;
  ctx.fillStyle = C.ink; ctx.font = `600 46px ${SANS}`;
  ctx.fillText(fitText(ctx, headline(d.pct, d.mode), W - 2 * P), P, y);

  // terminal block: the tally as if printed by the CLI
  y += 46;
  const th = 190;
  rr(ctx, P, y, W - 2 * P, th, 14); ctx.fillStyle = C.term; ctx.fill();
  ctx.fillStyle = "#2a2f37"; rr(ctx, P, y, W - 2 * P, 40, [14, 14, 0, 0]); ctx.fill();
  ["#ef7d73", "#f0c060", "#86c39a"].forEach((c, i) => { ctx.beginPath(); ctx.arc(P + 26 + i * 22, y + 20, 6, 0, 7); ctx.fillStyle = c; ctx.fill(); });
  let ty = y + 88;
  ctx.font = `400 26px ${MONO}`;
  ctx.fillStyle = C.pager; ctx.fillText("$", P + 28, ty);
  ctx.fillStyle = C.termInk; ctx.fillText(`devops-quiz --level ${d.levelKey === "mixed" ? "mixed" : "sev" + (CONFIG.levels[d.levelKey]?.sev ?? "")} --count ${d.n}`, P + 56, ty);
  ty += 54;
  const parts = [["#86c39a", `${d.counts.correct} resolved`], ["#f0c060", `${d.counts.partial} partial`], ["#ef7d73", `${d.counts.wrong} failed`], [C.termDim, `${d.counts.skip} skipped`]];
  let tx = P + 28;
  parts.forEach(([c, t]) => { ctx.fillStyle = c; ctx.fillText(t, tx, ty); tx += ctx.measureText(t).width + 40; });

  // topic bars (best first, up to 4)
  y += th + 58;
  ctx.fillStyle = C.ink3; ctx.font = `500 24px ${SANS}`;
  ctx.fillText(d.topics.length > 1 ? "By topic" : "Topic", P, y);
  y += 18;
  const topics = d.topics.slice(0, 4);
  const barX = P + 300, barW = W - 2 * P - 300 - 110;
  topics.forEach(t => {
    y += 52;
    ctx.fillStyle = C.ink; ctx.font = `500 30px ${SANS}`;
    ctx.fillText(fitText(ctx, t.k, 280), P, y);
    rr(ctx, barX, y - 22, barW, 22, 11); ctx.fillStyle = C.rule; ctx.fill();
    if (t.pct > 0) { rr(ctx, barX, y - 22, Math.max(22, barW * t.pct / 100), 22, 11); ctx.fillStyle = t.pct >= 70 ? C.ok : t.pct >= 40 ? "#d29a1f" : C.bad; ctx.fill(); }
    ctx.textAlign = "right"; ctx.fillStyle = C.ink2; ctx.font = `500 28px ${MONO}`;
    ctx.fillText(`${t.pct}%`, W - P, y); ctx.textAlign = "left";
  });
  if (d.topics.length > 4) { y += 40; ctx.fillStyle = C.ink3; ctx.font = `400 22px ${SANS}`; ctx.fillText(`+ ${d.topics.length - 4} more topics`, P, y); }

  // footer: the invitation and the author
  const fy = H - P + 8;
  ctx.strokeStyle = C.rule; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(P, fy - 62); ctx.lineTo(W - P, fy - 62); ctx.stroke();
  ctx.fillStyle = C.ink; ctx.font = `600 30px ${SANS}`;
  ctx.fillText("Can you beat it?", P, fy - 10);
  const cw = ctx.measureText("Can you beat it?").width;
  ctx.fillStyle = C.ink2; ctx.font = `400 26px ${SANS}`;
  ctx.fillText("Free DevOps practice with live terminal labs.", P + cw + 16, fy - 10);
  ctx.textAlign = "right"; ctx.fillStyle = C.ink3; ctx.font = `400 22px ${SANS}`;
  ctx.fillText("by Yousaf Hamza", W - P, fy - 10); ctx.textAlign = "left";
  return cv;
}

const TAGS = { Kubernetes: "#Kubernetes", AWS: "#AWS", Terraform: "#Terraform", Docker: "#Docker", Linux: "#Linux", Bash: "#Bash", PowerShell: "#PowerShell", Python: "#Python", Ansible: "#Ansible", Git: "#Git", "CI/CD": "#CICD", GitOps: "#GitOps", Networking: "#Networking", Observability: "#Observability", Security: "#DevSecOps", "AI/MLOps": "#MLOps" };

// Short post text in the person's voice. Honest about low scores, never boastful.
export function postText(d) {
  const best = d.topics[0], worst = d.topics.length > 1 ? d.topics[d.topics.length - 1] : null;
  const round = `${/^[aeiou]/i.test(d.levelName) ? "an" : "a"} ${d.levelName} round of DevOps Quiz (${d.n} questions)`;
  const labs = ["hard", "expert", "mixed"].includes(d.levelKey);
  const what = labs ? "live terminal incidents" : "scenario questions";
  let open;
  if (d.pct >= 85) open = `Scored ${d.pct}% on ${round}.${labs ? " The live terminal incidents, where you type the actual fix, were the fun part." : ""}`;
  else if (d.pct >= 70) open = `Passed ${round} with ${d.pct}%. Some of the ${what} made me think twice.`;
  else if (d.pct >= 40) open = `Took ${round} and got ${d.pct}%. The ${what} are no joke.`;
  else open = `Tried ${round} and scored ${d.pct}%. Humbling, and exactly why I practise.`;
  const lines = [open, ""];
  if (best && worst && best.k !== worst.k) lines.push(`Strongest: ${best.k} (${best.pct}%). Working on: ${worst.k} (${worst.pct}%).`, "");
  else if (best) lines.push(`All of it on ${best.k}.`, "");
  lines.push("It's free, no sign-up, from quick concepts to SEV-1 incidents. Think you can beat my score?", CONFIG.shareUrl, "");
  const tags = ["#DevOps", ...new Set(d.topics.slice(0, 3).map(t => TAGS[t.k]).filter(Boolean))].slice(0, 4);
  lines.push(tags.join(" "));
  return lines.join("\n");
}

export const toBlob = cv => new Promise(r => cv.toBlob(r, "image/png"));
