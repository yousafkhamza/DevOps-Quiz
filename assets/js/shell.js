// A small, believable shell around each lab: basic commands, man pages, Tab completion,
// and command "skeletons" for the second hint level. Lab-specific commands live in the bank.

/* ---------------- man pages: real-world usage, never the answer ---------------- */
const MAN = {
  kubectl: `kubectl controls the Kubernetes cluster manager.
Usage: kubectl <command> [TYPE[/NAME]] [flags]
Basic:        get, describe, logs, exec, apply, delete, edit
Deploy:       rollout (status | history | undo | restart), scale, set image
Cluster:      cordon, uncordon, drain, top (nodes | pods)
Auth:         auth can-i <verb> <resource> [--as USER]
Common flags: -n/--namespace NS, -A/--all-namespaces, -o wide|yaml|json|jsonpath=...,
              -l/--selector key=value, --field-selector key=value
logs flags:   -c CONTAINER, -f/--follow, -p/--previous, --since=1h, --tail=N
drain flags:  --ignore-daemonsets, --delete-emptydir-data, --force, --disable-eviction
Alias:        k = kubectl`,
  helm: `helm, the Kubernetes package manager.
Usage: helm <command> [RELEASE] [CHART] [flags]
Commands: install, upgrade, rollback, uninstall, list, history, status, get values, template
Flags:    -n/--namespace NS, --wait, --timeout 5m, --atomic, --dry-run, -f values.yaml
rollback: helm rollback RELEASE [REVISION] [flags]`,
  docker: `docker, a self-sufficient runtime for containers.
Usage: docker <command> [OPTIONS]
Containers: run, ps (-a), logs, exec, stop, start, rm, inspect, stats
Images:     images, build (-t NAME:TAG CONTEXT), history, pull, push, rmi, image prune
run flags:  -d, --name NAME, -p HOST:CONTAINER, -e KEY=VAL, -v SRC:DST, --rm, --dns IP, --init
Compose:    docker compose up | down | ps | logs`,
  git: `git, the version control system.
Usage: git <command> [<args>]
Everyday:  status, add, commit, log (--oneline --graph --merges), diff, show, switch, branch
History:   reflog, revert (-m 1 for merges), reset, cherry-pick (-x), bisect, blame
Remote:    fetch, pull, push (-u, --force-with-lease)
Branching: branch NAME [START], switch -c NAME [START], checkout -b NAME [START]`,
  terraform: `terraform, infrastructure as code.
Usage: terraform <command> [args]
Main:   init, validate, plan, apply, destroy, fmt, output
State:  state list | show ADDR | mv SRC DST | rm ADDR | pull, import ADDR ID, force-unlock LOCK_ID
Flags:  -target=ADDR, -refresh-only, -out=plan.tfplan, -var 'k=v'
Alias:  tf = terraform`,
  aws: `aws, the AWS command line interface.
Usage: aws <service> <operation> [parameters]
Identity:   aws sts get-caller-identity
EC2:        aws ec2 describe-instances | describe-security-groups --group-ids ID
            aws ec2 authorize-security-group-ingress --group-id ID --protocol tcp --port N
                (--cidr CIDR | --source-group SG_ID)
CloudTrail: aws cloudtrail lookup-events --lookup-attributes AttributeKey=KEY,AttributeValue=VALUE
IAM:        aws iam list-access-keys --user-name U
            aws iam update-access-key --user-name U --access-key-id ID --status Active|Inactive
S3:         aws s3 ls | cp, aws s3api get-bucket-policy --bucket NAME`,
  argocd: `argocd, the Argo CD CLI.
Usage: argocd app <command> APPNAME [flags]
Commands: get, list, sync, history, rollback APPNAME [HISTORY_ID], diff,
          set APPNAME --sync-policy (automated|none) [--auto-prune] [--self-heal]`,
  systemctl: `systemctl controls the systemd system and service manager.
Usage: systemctl [OPTIONS] COMMAND [UNIT]
Units:    status, start, stop, restart, reload, enable [--now], disable, is-active
Config:   cat UNIT, show UNIT [-p PROPERTY], edit UNIT, daemon-reload
Limits:   set-property UNIT PROPERTY=VALUE   (e.g. MemoryMax=, CPUQuota=)`,
  journalctl: `journalctl queries the systemd journal.
Usage: journalctl [OPTIONS] [MATCHES]
Flags: -u UNIT, -b (this boot), -k (kernel messages), -f (follow), -e (jump to end),
       -x (explanations), -n N, --since "1 hour ago", -p err, -g PATTERN (grep)`,
  ss: `ss, another utility to investigate sockets.
Usage: ss [options] [FILTER]
Flags: -t tcp, -u udp, -l listening, -n numeric, -p show process, -a all, -s summary
Filter example: ss -ltn 'sport = :443'`,
  lsof: `lsof lists open files.
Usage: lsof [options]
Flags: -i [:PORT], -p PID, -u USER, +L1 (files with link count < 1, i.e. deleted but still open)`,
  df: `df reports file system disk space usage.
Usage: df [OPTION]... [FILE]...
Flags: -h human-readable, -i inodes, -T show type`,
  du: `du estimates file space usage.
Usage: du [OPTION]... [FILE]...
Flags: -s summarize, -h human-readable, -x one file system, --max-depth=N, --inodes`,
  ps: `ps reports a snapshot of the current processes.
Usage: ps [options]
Common: ps aux, ps -ef, ps aux --sort=-%mem | head, ps -o pid,cmd -p PID`,
  awk: `awk, pattern scanning and processing language.
Usage: awk [-F SEP] 'pattern { action }' [file...]
Fields: $1, $2 … $NF; e.g. awk '{print $1}' file, awk '$9 ~ /^5/' file, awk 'END {print NR}'`,
  grep: `grep prints lines that match patterns.
Usage: grep [OPTION]... PATTERN [FILE]...
Flags: -i ignore case, -v invert, -c count, -n line numbers, -E extended regex, -r recursive, -o only match`,
  sort: `sort lines of text files.
Flags: -n numeric, -r reverse, -k N key, -t SEP, -u unique, -h human numbers`,
  uniq: `uniq reports or omits repeated lines (adjacent only — sort first).
Flags: -c prefix lines by count, -d only duplicates, -u only unique`,
  head: `head outputs the first part of files. Flags: -n N (or -N)`,
  tail: `tail outputs the last part of files. Flags: -n N, -f follow`,
  find: `find searches for files in a directory hierarchy.
Usage: find [path] [expression]
Tests: -name, -type f|d, -mtime +N, -size +100M; Actions: -print0, -delete, -exec CMD {} +`,
  chmod: `chmod changes file mode bits.
Usage: chmod [OPTION]... MODE FILE...
Modes: 755, 0440, u+x, a+x, g-w`,
  truncate: `truncate shrinks or extends the size of a file.
Usage: truncate -s SIZE FILE   (also: ': > FILE' truncates in bash)`,
  sudo: `sudo executes a command as another user.
Usage: sudo [-u USER] COMMAND, sudo -l [-U USER] (list privileges)`,
  visudo: `visudo edits the sudoers file safely. Flags: -c check syntax, -f FILE`,
  shellcheck: `shellcheck, a static analysis tool for shell scripts. Usage: shellcheck [OPTIONS] FILE...`,
  bash: `bash, the GNU Bourne-Again SHell.
Usage: bash [options] [script [args]]
Debug: -x trace commands after expansion, -n syntax check only, -e exit on error`,
  python3: `python3, the Python interpreter.
Usage: python3 [option] ... [-m module | file] [args]
Useful: -m venv DIR, -m pip install -r requirements.txt, --version`,
  pip: `pip, the Python package installer.
Usage: pip install PACKAGE | -r requirements.txt, pip list, pip freeze`,
  ansible: `ansible runs ad-hoc tasks.
Usage: ansible PATTERN -i INVENTORY -m MODULE [-a ARGS]
Example module: ping, setup, command, service`,
  "ansible-playbook": `ansible-playbook runs playbooks.
Usage: ansible-playbook [-i INVENTORY] PLAYBOOK [options]
Flags: --syntax-check, --check/-C (dry run), --diff/-D, --limit/-l HOSTS, --tags T, -v`,
  curl: `curl transfers a URL.
Flags: -s silent, -S show errors, -f fail on HTTP errors, -v verbose, -I headers only, --resolve HOST:PORT:IP`,
  nc: `nc (netcat). Usage: nc -zv HOST PORT  (-z scan only, -v verbose, -w SECS timeout)`,
  dig: `dig, DNS lookup utility. Usage: dig [@server] NAME [TYPE] [+short] [+trace]`,
  nslookup: `nslookup queries DNS servers. Usage: nslookup NAME [SERVER]`,
  resolvectl: `resolvectl, systemd-resolved control. Usage: resolvectl [status | dns | query NAME]`,
  dmesg: `dmesg prints the kernel ring buffer. Flags: -T human timestamps, -l err,warn`,
  echo: `echo displays a line of text. In bash, '>' overwrites a file and '>>' appends.`,
  cat: `cat concatenates files and prints them on standard output.`,
  "get-service": `Get-Service [[-Name] <string[]>] [-DisplayName <string[]>]
Gets the services on the computer (Status, Name, DisplayName).`,
  "set-service": `Set-Service [-Name] <string> [-StartupType <Automatic|Manual|Disabled>] [-Status <Running|Stopped>]`,
  "start-service": `Start-Service [-Name] <string[]>`,
  "restart-service": `Restart-Service [-Name] <string[]> [-Force]`,
  "get-winevent": `Get-WinEvent [-LogName] <string[]> [-MaxEvents <long>] [-FilterHashtable <hashtable>]
Example: Get-WinEvent -LogName Application -MaxEvents 10`,
  "get-eventlog": `Get-EventLog [-LogName] <string> [-Newest <int>] (Windows PowerShell 5.1 only)`,
  "test-netconnection": `Test-NetConnection [[-ComputerName] <string>] [-Port <int>]   (alias: tnc)`,
};
MAN.k = MAN.kubectl; MAN.tf = MAN.terraform; MAN.python = MAN.python3; MAN.pip3 = MAN.pip;
MAN["get-help"] = "Get-Help <cmdlet> shows help for a PowerShell cmdlet. Try: Get-Help Get-Service";

/* ---------------- basic commands that "just work" ---------------- */
export function basicCommand(cmd, env) {
  const [w, ...rest] = cmd.split(" ");
  const arg = rest.join(" ");
  const ps = env.ignoreCase; // PowerShell-flavoured lab
  switch (w.toLowerCase()) {
    case "pwd": case "get-location": return env.cwd;
    case "whoami": return env.user;
    case "hostname": return env.host;
    case "id": return `uid=1000(${env.user}) gid=1000(${env.user}) groups=1000(${env.user}),27(sudo)`;
    case "date": case "get-date": return new Date().toString().replace(/\(.*\)/, "").trim();
    case "uname": return arg.includes("-a") ? `Linux ${env.host} 6.8.0-1017-aws #18-Ubuntu SMP x86_64 GNU/Linux` : "Linux";
    case "echo": case "write-output": return arg.startsWith(">") || /\s>{1,2}\s?\S/.test(arg) ? null : arg.replace(/^["']|["']$/g, "").replace(/\$USER/g, env.user).replace(/\$HOME/g, env.home);
    case "cd": case "set-location":
      if (!arg || arg === "~") env.cwd = env.home;
      else if (ps || /^[a-z]:\\/i.test(env.cwd)) {
        const sep = "\\";
        if (arg === "..") env.cwd = env.cwd.replace(/\\[^\\]+\\?$/, "") || env.cwd;
        else if (/^[a-z]:\\/i.test(arg)) env.cwd = arg.replace(/\\$/, "");
        else env.cwd = env.cwd.replace(/\\$/, "") + sep + arg.replace(/^\.\\/, "");
        if (/^[a-z]:$/i.test(env.cwd)) env.cwd += sep;
      }
      else if (arg === "-") env.cwd = env.prev || env.cwd;
      else if (arg === "..") env.cwd = env.cwd.replace(/\/[^/]+\/?$/, "") || "/";
      else if (arg.startsWith("/")) env.cwd = arg.replace(/(.)\/$/, "$1");
      else if (arg.startsWith("~/")) env.cwd = env.home + arg.slice(1);
      else env.cwd = (env.cwd.endsWith("/") ? env.cwd : env.cwd + "/") + arg.replace(/^\.\//, "").replace(/\/$/, "");
      return "";
    case "true": case ":": return "";
    case "exit": case "logout": return "# this is a lab session — use Next or Skip question to move on";
    case "which": case "type": case "get-command": {
      const t = arg.toLowerCase();
      if (MAN[t] || env.tools.has(t)) return ps ? `CommandType  Name  Source\n-----------  ----  ------\nCmdlet       ${arg}` : `/usr/bin/${arg}`;
      return ps ? `Get-Command: The term '${arg}' is not recognized.` : `${arg} not found`;
    }
    case "man": case "info": case "help": case "get-help": {
      if (!arg) return null;
      const page = MAN[arg.toLowerCase()] || MAN[arg.toLowerCase().split(" ")[0]];
      return page ? page : (ps ? `Get-Help: no help found for '${arg}'` : `No manual entry for ${arg}`);
    }
  }
  // "<tool> --help", "<tool> -h", "<tool> help", "Get-Help <cmdlet>"
  if (/(^|\s)(--help|-h|help|-\?)$/.test(cmd)) {
    const page = MAN[w.toLowerCase()];
    if (page) return page;
  }
  return null; // not handled here
}

export const hasMan = w => !!MAN[String(w).toLowerCase()];

/* ---------------- hint level 2: show the shape, not the answer ---------------- */
export function skeleton(solution) {
  const first = String(solution).split(/\s+(?:&&|then:|,\s*then:)\s+/)[0].replace(/,$/, "");
  const t = first.trim().split(/\s+/);
  let words = true, seg = 0; // leading sub-commands (e.g. "ec2 authorize-security-group-ingress") stay visible
  return t.map((tok, i) => {
    if (i === 0) return tok;
    if (tok === "|" || tok === "&&") { words = true; seg = i + 1; return tok; }
    if (i === seg) return tok;                                   // the command after a pipe
    if (words && i - seg <= 3 && /^[a-z][a-z0-9-]*$/.test(tok)) return tok;
    words = false;
    if (/^--?[A-Za-z][\w-]*/.test(tok)) {
      const [flag, val] = tok.split("=");
      const dashes = flag.startsWith("--") ? 2 : 1, body = flag.slice(dashes);
      const keep = Math.max(1, Math.ceil(body.length * 0.4));
      const shown = body.length <= 2 ? flag : flag.slice(0, dashes + keep) + "…";
      return val !== undefined ? `${shown}=<…>` : shown;
    }
    return "<…>";
  }).join(" ");
}

/* ---------------- Tab completion ---------------- */
// Candidates: commands for the first word; for later words, the tool's own man-page vocabulary
// (subcommands and flags) plus names already printed on screen (pods, files, IDs).
const ALIAS = { k: "kubectl", tf: "terraform", python: "python3", pip3: "pip", tnc: "test-netconnection" };
const PS_VERB = /^(get|set|new|remove|start|stop|restart|test|invoke|import|export|select|where|sort|format|out|write|copy|move|enter|resolve|measure|convert|update|add|clear|register|unregister|enable|disable|install|uninstall)-/;
const psCase = w => PS_VERB.test(w) ? w.split("-").map(x => x[0].toUpperCase() + x.slice(1)).join("-") : w;

// Tab candidates. First word: lab tools, shell builtins and any command with a man page (like PATH on a real box).
export function completions(line, screenWords, tools, ps = false) {
  const parts = line.split(" ");
  const cur = parts[parts.length - 1];
  let pool;
  if (parts.length === 1) {
    const known = Object.keys(MAN).filter(k => ps ? PS_VERB.test(k) || tools.has(k) : !PS_VERB.test(k));
    pool = new Set([...tools, ...known, "help", "hint", "skip", "tasks", "history", "clear", "man", "pwd", "whoami", "ls", "cat", "cd", "echo", "which"].map(w => ps ? psCase(w) : w));
  } else {
    const tool = parts[0].toLowerCase();
    const page = MAN[ALIAS[tool] || tool] || "";
    const vocab = page.match(/--?[a-zA-Z][\w-]*|\b[a-z][a-z-]{2,}\b/g) || [];
    pool = new Set([...vocab, ...screenWords]);
    if (/^(man|help|get-help|which|type|get-command)$/i.test(parts[0])) { tools.forEach(t => pool.add(t)); Object.keys(MAN).forEach(t => pool.add(t)); }
  }
  const lc = ps ? s => s.toLowerCase() : s => s;
  return [...pool].filter(c => lc(c).startsWith(lc(cur)) && lc(c) !== lc(cur)).sort();
}

export function commonPrefix(list) {
  if (!list.length) return "";
  let p = list[0];
  for (const s of list) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p;
}

// Words worth completing that appeared in output: resource names, files, IDs, hostnames.
export function harvest(text) {
  return (text.match(/(?<![\w-])[A-Za-z0-9][A-Za-z0-9._/:@-]{3,}/g) || [])
    .map(w => w.replace(/[.:,]+$/, ""))
    .filter(w => /[-_.\/:0-9]/.test(w) && !/^\d+$/.test(w) && !/\/-|-\/|^[a-z]\//i.test(w) && w.length < 80);
}
