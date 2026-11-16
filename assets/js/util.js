// Small helpers: escaping, markdown-lite, syntax highlighting, storage.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// `code`, **bold**, line breaks. Input is escaped first.
export function md(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s.,;:)!?]|$)/g, "$1<i>$2</i>")
    .replace(/\n/g, "<br>");
}

export function el(tag, attrs = {}, html = "") {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  if (html) e.innerHTML = html;
  return e;
}

export function shuffle(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

export const store = {
  get(k, d) { try { const v = localStorage.getItem("dq2:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("dq2:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem("dq2:" + k); } catch { } },
};

/* ---------- syntax highlighting (tiny, regex based, line by line) ---------- */
const STATUS_BAD = /\b(Error|ERROR|error:|Failed|FAILED|failed|CrashLoopBackOff|OOMKilled|ImagePullBackOff|ErrImagePull|Evicted|Pending|denied|Denied|refused|forbidden|Forbidden|Unauthorized|AccessDenied|NotReady|timeout|timed out|fatal:|panic:|Killed|exit code [1-9]\d*|5\d\d)\b/g;
const STATUS_OK = /\b(Running|Ready|Healthy|Synced|Succeeded|Completed|active \(running\)|OK|ok|PASS|passed|created|configured|unchanged|rolled back|successfully)\b/g;
const STATUS_WARN = /\b(Warning|WARN|warn|OutOfSync|Degraded|Progressing|Terminating|ContainerCreating|Unknown|deprecated|BackOff)\b/g;

function hlStatus(h) {
  return h.replace(STATUS_BAD, '<span class="h-err">$1</span>')
          .replace(STATUS_OK, '<span class="h-ok">$1</span>')
          .replace(STATUS_WARN, '<span class="h-warn">$1</span>');
}

export function highlightLine(line, lang) {
  const raw = line;
  let h = esc(raw);
  switch (lang) {
    case "yaml": {
      const m = raw.match(/^(\s*-?\s*)([\w.\-/"']+)(:)(\s.*|$)/);
      if (/^\s*#/.test(raw)) return `<span class="h-com">${h}</span>`;
      if (m) {
        let val = esc(m[4]);
        val = val.replace(/(#.*)$/, '<span class="h-com">$1</span>')
                 .replace(/^(\s*)(&quot;.*?&quot;|&#39;.*?&#39;)/, '$1<span class="h-str">$2</span>')
                 .replace(/^(\s*)(\d+[\w.]*|true|false|null)(\s*)$/, '$1<span class="h-num">$2</span>$3');
        return `${esc(m[1])}<span class="h-key">${esc(m[2])}</span>${m[3]}${val}`;
      }
      return h.replace(/(#.*)$/, '<span class="h-com">$1</span>');
    }
    case "hcl":
      if (/^\s*(#|\/\/)/.test(raw)) return `<span class="h-com">${h}</span>`;
      return h.replace(/(&quot;.*?&quot;)/g, '<span class="h-str">$1</span>')
              .replace(/^(\s*)(resource|data|module|variable|output|provider|terraform|locals|backend|moved|import|removed|check|dynamic|lifecycle|for_each|count|depends_on)\b/, '$1<span class="h-kw">$2</span>')
              .replace(/^(\s*)([\w-]+)(\s*=)/, '$1<span class="h-key">$2</span>$3');
    case "dockerfile":
      if (/^\s*#/.test(raw)) return `<span class="h-com">${h}</span>`;
      return h.replace(/^(\s*)(FROM|RUN|CMD|ENTRYPOINT|COPY|ADD|ENV|ARG|WORKDIR|USER|EXPOSE|LABEL|HEALTHCHECK|VOLUME|SHELL)\b/i, '$1<span class="h-kw">$2</span>')
              .replace(/(&quot;.*?&quot;)/g, '<span class="h-str">$1</span>');
    case "json":
      return h.replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span class="h-key">$1</span>$2')
              .replace(/(:\s*)(&quot;.*?&quot;)/g, '$1<span class="h-str">$2</span>')
              .replace(/(:\s*)(-?\d+(\.\d+)?|true|false|null)/g, '$1<span class="h-num">$2</span>');
    case "diff":
      if (/^\+/.test(raw)) return `<span class="h-add">${h}</span>`;
      if (/^-/.test(raw)) return `<span class="h-del">${h}</span>`;
      if (/^@@/.test(raw)) return `<span class="h-com">${h}</span>`;
      return h;
    case "terminal": {
      const m = raw.match(/^(\S*[$#]\s)(.*)$/);
      if (m && /^(\$|#|[\w@.\-:~/]+[$#])\s/.test(raw)) return `<span class="h-prompt">${esc(m[1])}</span><span class="h-cmd">${esc(m[2])}</span>`;
      return hlStatus(h);
    }
    case "log":
      return hlStatus(h).replace(/^(\S+T\S+Z|\d{4}-\d\d-\d\d[ T][\d:.]+)/, '<span class="h-com">$1</span>');
    case "bash":
    case "sh":
      if (/^\s*#/.test(raw)) return `<span class="h-com">${h}</span>`;
      return h.replace(/(&quot;.*?&quot;)/g, '<span class="h-str">$1</span>');
    default:
      return h;
  }
}

export function highlightOutput(text) {
  return text.split("\n").map(l => hlStatus(esc(l))).join("\n");
}

// Renders a code block as line elements (line numbers optional).
export function codeBlock(content, lang, { numbers = true, single = true } = {}) {
  const wrap = el("div", { class: "code" + (single ? " single" : "") });
  content.replace(/\n$/, "").split("\n").forEach((line, i) => {
    const row = el("div", { class: "codeline", "data-line": i + 1 });
    row.innerHTML = (numbers ? `<span class="ln">${i + 1}</span>` : `<span class="ln"></span>`) +
      `<span class="lc">${highlightLine(line, lang) || " "}</span>`;
    wrap.appendChild(row);
  });
  return wrap;
}
