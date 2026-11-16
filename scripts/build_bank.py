#!/usr/bin/env python3
"""Build the static question bank: bank/*.yaml  ->  data/<level>.json (+ data/index.json).

Any bank/*.yaml may hold questions of any level (set `level:` at the top of the file or per question);
questions are grouped by level on output. bank/demo.yaml is the tour.

  pip install pyyaml
  python3 scripts/build_bank.py          # build
  python3 scripts/build_bank.py --check  # CI: fail if data/ is out of date

YAML is the source of truth (easy to write multi-line logs & manifests).
The generated JSON is committed so GitHub Pages can serve it with no build step.
Matcher objects  { all: [...], none: [...] }  are compiled to a single regex string.
"""
import json, re, sys, pathlib, hashlib, datetime
import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
BANK, DATA = ROOT / "bank", ROOT / "data"
LEVELS = ["easy", "medium", "hard", "expert"]
TYPES = {"mcq", "multi", "terminal", "fill", "spot", "order"}
errors = []


def err(qid, msg):
    errors.append(f"[{qid}] {msg}")


def matcher(m, qid):
    """str -> itself; {all, none} -> lookahead regex."""
    if isinstance(m, str):
        pat = m
    elif isinstance(m, dict):
        pat = "^" + "".join(f"(?=.*?(?:{p}))" for p in m.get("all", [])) + "".join(f"(?!.*?(?:{p}))" for p in m.get("none", []))
    else:
        err(qid, f"bad matcher {m!r}")
        return "(?!)"
    try:
        re.compile(pat)
    except re.error as e:
        err(qid, f"regex does not compile: {pat} ({e})")
    return pat


def normalize(cmd):  # keep in sync with normalizeCmd() in assets/js/types.js
    c = re.sub(r"\s+", " ", str(cmd).strip())
    c = re.sub(r";+$", "", c)
    c = re.sub(r"^\$\s*", "", c)
    c = re.sub(r"^sudo\s+((-[EHnis]+|-u\s+\S+)\s+)*(?=[^-\s])", "", c)  # keep `sudo -l ...` as is
    c = re.sub(r"^k\s", "kubectl ", c)
    c = re.sub(r"^tf\s", "terraform ", c)
    return c


def check_q(q, level):
    qid = q.get("id", "?")
    for f in ("id", "category", "type"):
        if f not in q:
            err(qid, f"missing '{f}'")
    t = q.get("type")
    if t not in TYPES:
        err(qid, f"unknown type {t}")
        return q
    if level not in LEVELS:
        err(qid, f"unknown level {level}")
    q["level"] = level
    if not q.get("explanation"):
        err(qid, "missing explanation")

    if t in ("mcq", "multi"):
        opts, ans = q.get("options", []), q.get("answer")
        if len(opts) < 2:
            err(qid, "needs >= 2 options")
        answers = ans if isinstance(ans, list) else [ans]
        if t == "mcq" and isinstance(ans, list):
            err(qid, "mcq answer must be a single index")
        if t == "multi" and (not isinstance(ans, list) or len(ans) < 2):
            err(qid, "multi answer must be a list with >= 2 indexes")
        for a in answers:
            if not isinstance(a, int) or not 0 <= a < len(opts):
                err(qid, f"answer index {a} out of range")
        if len(set(map(str, opts))) != len(opts):
            err(qid, "duplicate options")
        if not q.get("question"):
            err(qid, "missing question")

    elif t == "terminal":
        q["explore"] = [{**e, "match": matcher(e["match"], qid)} for e in q.get("explore", [])]
        if not q.get("steps"):
            err(qid, "terminal needs steps")
        for i, s in enumerate(q.get("steps", [])):
            s["accept"] = [matcher(a, qid) for a in s.get("accept", [])]
            s["wrong"] = [{**w, "match": matcher(w["match"], qid)} for w in s.get("wrong", [])]
            for f in ("task", "solution"):
                if not s.get(f):
                    err(qid, f"step {i+1} missing {f}")
            for cmd in s.get("check", [s.get("solution", "")]):
                n = normalize(cmd)
                fl = re.I if q.get("ignoreCase") else 0
                if not any(re.search(a, n, fl) for a in s["accept"]):
                    err(qid, f"step {i+1}: solution/check does not match accept: {n!r}")

    elif t == "fill":
        tpl, blanks = q.get("template", ""), q.get("blanks", {})
        ids = re.findall(r"\{\{(\w+)\}\}", tpl)
        if set(ids) != set(blanks):
            err(qid, f"template blanks {ids} != blanks {list(blanks)}")
        for b, spec in blanks.items():
            spec["accept"] = [matcher(a, qid) for a in spec.get("accept", [])]
            spec["solution"] = str(spec.get("solution", ""))
            if not any(re.search(a, spec["solution"]) for a in spec["accept"]):
                err(qid, f"blank {b}: solution doesn't match accept")

    elif t == "spot":
        lines = q.get("code", "").rstrip("\n").split("\n")
        for a in q.get("answer", []):
            if not 1 <= a <= len(lines):
                err(qid, f"spot line {a} out of range (1..{len(lines)})")
            elif not lines[a - 1].strip():
                err(qid, f"spot line {a} is blank")

    elif t == "order":
        if len(q.get("items", [])) < 3:
            err(qid, "order needs >= 3 items")
    return q


def build():
    out, seen, cats = {}, set(), {}
    for f in sorted(BANK.glob("*.yaml")):
        doc = yaml.safe_load(f.read_text(encoding="utf-8"))
        level = doc.get("level")
        qs = []
        for q in doc["questions"]:
            q = check_q(q, q.get("level", level))
            if q["id"] in seen:
                err(q["id"], "duplicate id")
            seen.add(q["id"])
            qs.append(q)
            if f.stem != "demo":
                cats[q["category"]] = cats.get(q["category"], 0) + 1
        if f.stem == "demo":
            out["demo"] = qs
        else:
            for q in qs:
                out.setdefault(q["level"], []).append(q)
    blob = json.dumps(out, sort_keys=True).encode()
    index = {
        "version": "2." + hashlib.sha1(blob).hexdigest()[:7],
        "banks": [{"level": l, "file": f"{l}.json", "count": len(out.get(l, []))} for l in LEVELS if l in out],
        "demo": "demo.json",
        "categories": dict(sorted(cats.items())),
    }
    files = {f"{k}.json": v for k, v in out.items()}
    files["index.json"] = index
    return files


def main():
    files = build()
    if errors:
        print("\n".join(errors))
        print(f"\n{len(errors)} error(s)")
        sys.exit(1)
    rendered = {n: json.dumps(v, indent=1, ensure_ascii=False) + "\n" for n, v in files.items()}
    if "--check" in sys.argv:
        stale = [n for n, txt in rendered.items() if not (DATA / n).exists() or (DATA / n).read_text(encoding="utf-8") != txt]
        if stale:
            print("data/ is out of date, run: python3 scripts/build_bank.py ->", stale)
            sys.exit(1)
        print("data/ is up to date")
        return
    DATA.mkdir(exist_ok=True)
    for n, txt in rendered.items():
        (DATA / n).write_text(txt, encoding="utf-8")
    counts = {b["level"]: b["count"] for b in files["index.json"]["banks"]}
    print(f"built {sum(counts.values())} questions {counts} + {len(files['demo.json'])} demo · {files['index.json']['version']}")


if __name__ == "__main__":
    main()
