// DevOps Quiz 2.0 — central configuration. Tweak rules here, no build step needed.
export const CONFIG = {
  appVersion: "2.0.0",
  banksIndex: "data/index.json",

  levels: {
    easy:   { label: "Easy",       sev: 4, tagline: "Concepts with one right answer",        weight: 1, time: 60  },
    medium: { label: "Medium",     sev: 3, tagline: "Read the logs, pick the fix",           weight: 2, time: 120 },
    hard:   { label: "Hard",       sev: 2, tagline: "Live terminal, manifests, spot the bug", weight: 3, time: 240 },
    expert: { label: "Super hard", sev: 1, tagline: "Multi-step production incidents",       weight: 4, time: 420 },
  },
  // "Mixed" ramps difficulty: this share of each level, served easy → expert
  mixedRatio: { easy: 0.3, medium: 0.35, hard: 0.25, expert: 0.1 },

  counts: [10, 20, 30, 50],
  negativeRatio: 0.25,      // wrong answer costs 25% of the question's weight
  hintPenalty: 0.5,         // a terminal step solved after `hint` is worth 50%
  maxAttemptsPerStep: 3,    // wrong commands allowed per terminal step
  passPercent: 70,
  dailyAttempts: 5,         // exam mode only; practice is unlimited
  tabSwitchStrikes: 2,      // 1st = warning, 2nd = quiz exits (exam mode)
  blockPasteInExam: true,   // type it, don't paste it
  warningAt: 10,            // seconds left when the beep plays
  shareUrl: "https://yousafkhamza.github.io/devops-mcq-assets/",
};
