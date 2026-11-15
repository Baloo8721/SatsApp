import { generateMixed, estimateMathScore, estimateRwScore } from "./generators.js";
import { uid } from "./store.js";

export const MODES = {
  quick: {
    id: "quick",
    title: "Quick 10",
    short: "Quick 10",
    subtitle: "A fast mixed set to wake up your brain.",
    subject: "Mixed",
    count: 10,
    mix: { math: 5, rw: 5 },
    minutes: 10,
    timed: true,
    feedback: false,
    tone: "blue",
  },
  mixed20: {
    id: "mixed20",
    title: "30-minute session",
    short: "30-min session",
    subtitle: "20 mixed questions with a 30-minute clock — the daily core workout.",
    subject: "Mixed",
    count: 20,
    mix: { math: 10, rw: 10 },
    minutes: 30,
    timed: true,
    feedback: false,
    tone: "purple",
  },
  mathDrill: {
    id: "mathDrill",
    title: "Math drill",
    short: "Math drill",
    subtitle: "10 math questions with instant explanations after each answer.",
    subject: "Math",
    count: 10,
    minutes: 0,
    timed: false,
    feedback: true,
    tone: "green",
  },
  rwDrill: {
    id: "rwDrill",
    title: "Reading & Writing drill",
    short: "RW drill",
    subtitle: "10 RW questions with instant explanations after each answer.",
    subject: "RW",
    count: 10,
    minutes: 0,
    timed: false,
    feedback: true,
    tone: "amber",
  },
  mathModule: {
    id: "mathModule",
    title: "Math module",
    short: "Math module",
    subtitle: "22 questions · 35 minutes. No hints — just like test day.",
    subject: "Math",
    count: 22,
    minutes: 35,
    timed: true,
    feedback: false,
    tone: "green",
  },
  rwModule: {
    id: "rwModule",
    title: "Reading & Writing module",
    short: "RW module",
    subtitle: "27 questions · 32 minutes. No hints — just like test day.",
    subject: "RW",
    count: 27,
    minutes: 32,
    timed: true,
    feedback: false,
    tone: "amber",
  },
  full: {
    id: "full",
    title: "Full SAT simulation",
    short: "Full simulation",
    subtitle: "54 RW + 44 Math · 2 hr 14 min. The whole thing, in order.",
    subject: "Full",
    count: 98,
    mix: { math: 44, rw: 54 },
    minutes: 134,
    timed: true,
    feedback: false,
    tone: "purple",
  },
  topic: {
    id: "topic",
    title: "Topic drill",
    short: "Topic drill",
    subtitle: "10 focused questions with instant explanations.",
    subject: "Topic",
    count: 10,
    minutes: 0,
    timed: false,
    feedback: true,
    tone: "blue",
  },
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return ch;
    }
  });
}

function isHtml(value) {
  return /<[a-z][\s\S]*>/i.test(String(value || ""));
}

function htmlParagraph(value) {
  if (!value) return "";
  if (isHtml(value)) return value;
  return `<p>${escapeHtml(value)}</p>`;
}

export function normalizeRwQuestion(raw) {
  const choices = Array.isArray(raw.choices) ? raw.choices.map(String) : [];
  const answer = Number(raw.answer);
  const passage = raw.passage ? `<div class="rw-passage">${raw.passage}</div>` : "";
  const questionPrompt = raw.prompt ? `<p class="rw-question"><strong>${raw.prompt}</strong></p>` : "";
  return {
    id: raw.id || uid("rw"),
    subject: "RW",
    topicId: raw.skill || raw.topicId || "rw",
    topic: raw.skillLabel || raw.topic || "Reading & Writing",
    domain: raw.domain || "Reading & Writing",
    difficulty: Number(raw.difficulty) || 2,
    type: "mcq",
    prompt: `${passage}${questionPrompt}`,
    passage: raw.passage || "",
    questionPrompt: raw.prompt || "",
    choices,
    answer,
    answerText: choices[answer] ?? String(raw.answer ?? ""),
    explanation: htmlParagraph(raw.explanation),
    formulaIds: [],
    source: raw.source || "original",
  };
}

export function normalizeMathQuestion(raw) {
  const choices = Array.isArray(raw.choices) ? raw.choices.map(String) : null;
  const type = raw.type === "numeric" || raw.type === "grid" ? "numeric" : "mcq";
  const answer = type === "mcq" ? Number(raw.answer) : String(raw.answer);
  return {
    ...raw,
    id: raw.id || uid("math"),
    subject: "Math",
    topicId: raw.topicId ?? raw.topic,
    topic: raw.topic || "Math",
    domain: raw.domain || "Math",
    difficulty: Number(raw.difficulty) || 2,
    type,
    choices,
    answer,
    answerText: raw.answerText != null
      ? String(raw.answerText)
      : type === "mcq"
        ? choices?.[answer] ?? ""
        : String(raw.answer),
    explanation: htmlParagraph(raw.explanation),
    formulaIds: Array.isArray(raw.formulaIds) ? raw.formulaIds : [],
    source: raw.source || "generated",
  };
}

function sampleRw(pool, { skill = null, count = 10 } = {}) {
  let filtered = pool;
  if (skill) filtered = pool.filter((q) => q.skill === skill || q.topicId === skill);
  if (!filtered.length) filtered = pool;
  const shuffled = shuffle(filtered);
  const out = [];
  let i = 0;
  while (out.length < count) {
    if (i >= shuffled.length) {
      if (!shuffled.length) break;
      i = 0;
      shuffled.sort(() => Math.random() - 0.5);
    }
    out.push(normalizeRwQuestion(shuffled[i]));
    i += 1;
  }
  return out;
}

function mathSet(count, { topics = null, difficulty = 2 } = {}) {
  return generateMixed(count, topics, difficulty).map(normalizeMathQuestion);
}

function buildQuestions(mode, config, { content, topicId, subject, difficulty = 2, count = null }) {
  const rwPool = content?.rwQuestions || [];
  const target = Number(count) || config.count || 10;

  if (mode === "topic") {
    if (subject === "RW" || typeof topicId === "string") {
      return sampleRw(rwPool, { skill: topicId, count: target });
    }
    return mathSet(target, { topics: [Number(topicId)], difficulty });
  }

  if (config.subject === "Math") return mathSet(target, { difficulty });
  if (config.subject === "RW") return sampleRw(rwPool, { count: target });

  if (mode === "full") {
    const rw = sampleRw(rwPool, { count: config.mix.rw });
    const math = mathSet(config.mix.math, { difficulty });
    return [...rw, ...math];
  }

  const mix = config.mix || { math: Math.ceil(target / 2), rw: Math.floor(target / 2) };
  const math = mathSet(mix.math, { difficulty });
  const rw = sampleRw(rwPool, { count: mix.rw });
  return shuffle([...math, ...rw]);
}

export function buildQuiz({
  mode = "quick",
  content,
  topicId = null,
  subject = null,
  difficulty = 2,
  count = null,
  title = null,
} = {}) {
  const config = MODES[mode] || MODES.quick;
  const questions = buildQuestions(mode, config, { content, topicId, subject, difficulty, count });
  if (!questions.length) throw new Error("No questions are available for that mode yet.");

  return {
    id: uid("quiz"),
    mode,
    title: title || config.title,
    subject: config.subject,
    timed: Boolean(config.timed),
    timeLimit: config.timed ? config.minutes * 60 : 0,
    feedback: Boolean(config.feedback),
    questions,
    createdAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Grading                                                            */
/* ------------------------------------------------------------------ */

function parseNumeric(value) {
  let s = String(value ?? "").trim().toLowerCase();
  if (!s) return null;
  s = s
    .replace(/[−–—]/g, "-")
    .replace(/[$,]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  let percent = false;
  if (s.endsWith("%")) {
    percent = true;
    s = s.slice(0, -1).trim();
  }

  let match = s.match(/^(-?\d+)\s+(\d+)\/(\d+)$/);
  if (match) {
    const sign = match[1].startsWith("-") ? -1 : 1;
    const whole = Math.abs(Number(match[1]));
    const value = sign * (whole + Number(match[2]) / Number(match[3]));
    return percent ? value / 100 : value;
  }

  match = s.match(/^(-?\d+)\/(\d+)$/);
  if (match) {
    const value = Number(match[1]) / Number(match[2]);
    return percent ? value / 100 : value;
  }

  if (/^-?\d*\.?\d+$/.test(s)) {
    const value = Number(s);
    return percent ? value / 100 : value;
  }

  return null;
}

export function normalizeGridAnswer(value) {
  const numeric = parseNumeric(value);
  if (numeric != null && Number.isFinite(numeric)) {
    return String(Math.round(numeric * 10000) / 10000);
  }
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function isAnswered(question, response) {
  if (response == null) return false;
  if (question.type === "mcq") return Number.isInteger(Number(response)) && Number(response) >= 0;
  return String(response).trim() !== "";
}

export function checkAnswer(question, response) {
  if (!isAnswered(question, response)) {
    return {
      correct: false,
      correctText: getCorrectText(question),
      userText: "",
      unanswered: true,
    };
  }

  if (question.type === "mcq") {
    const idx = Number(response);
    return {
      correct: idx === Number(question.answer),
      correctText: getCorrectText(question),
      userText: question.choices?.[idx] ?? "",
      unanswered: false,
    };
  }

  const a = parseNumeric(response);
  const b = parseNumeric(question.answerText ?? question.answer);
  let correct;
  if (a != null && b != null) {
    correct = Math.abs(a - b) <= Math.max(0.0005, Math.abs(b) * 0.0005);
  } else {
    correct = normalizeGridAnswer(response) === normalizeGridAnswer(question.answerText ?? question.answer);
  }

  return {
    correct,
    correctText: getCorrectText(question),
    userText: String(response).trim(),
    unanswered: false,
  };
}

export function getCorrectText(question) {
  if (question.type === "mcq") {
    const idx = Number(question.answer);
    return question.choices?.[idx] ?? question.answerText ?? "";
  }
  return String(question.answerText ?? question.answer ?? "");
}

export function getUserText(question, response) {
  if (question.type === "mcq") {
    const idx = Number(response);
    return question.choices?.[idx] ?? "";
  }
  return String(response ?? "").trim();
}

export function summarize(quiz, responses, elapsedSeconds = 0) {
  const rows = quiz.questions.map((question) => {
    const response = responses?.[question.id];
    const result = checkAnswer(question, response);
    return {
      ...question,
      response: response ?? null,
      ...result,
    };
  });

  const total = rows.length;
  const correct = rows.filter((r) => r.correct).length;
  const mathRows = rows.filter((r) => r.subject === "Math");
  const rwRows = rows.filter((r) => r.subject === "RW");
  const mathCorrect = mathRows.filter((r) => r.correct).length;
  const rwCorrect = rwRows.filter((r) => r.correct).length;

  const mathScaled = mathRows.length ? estimateMathScore(mathCorrect, mathRows.length) : null;
  const rwScaled = rwRows.length ? estimateRwScore(rwCorrect, rwRows.length) : null;

  let projected = null;
  if (mathRows.length && rwRows.length) {
    const mathProjection = mathScaled ?? 200;
    const rwProjection = rwScaled ?? 200;
    projected = mathProjection + rwProjection;
  } else if (mathRows.length) {
    projected = mathScaled;
  } else if (rwRows.length) {
    projected = rwScaled;
  }

  return {
    total,
    correct,
    percentage: total ? Math.round((correct / total) * 100) : 0,
    unanswered: rows.filter((r) => r.unanswered).length,
    math: {
      total: mathRows.length,
      correct: mathCorrect,
      scaled: mathScaled,
    },
    rw: {
      total: rwRows.length,
      correct: rwCorrect,
      scaled: rwScaled,
    },
    projected,
    elapsedSeconds: Math.max(0, Math.round(elapsedSeconds)),
    rows,
  };
}

export function createAttempt(quiz, responses, elapsedSeconds = 0) {
  const summary = summarize(quiz, responses, elapsedSeconds);
  const completedAt = new Date().toISOString();
  return {
    id: uid("attempt"),
    quizId: quiz.id,
    mode: quiz.mode,
    title: quiz.title,
    subject: quiz.subject,
    timed: quiz.timed,
    timeLimit: quiz.timeLimit,
    startedAt: quiz.createdAt,
    completedAt,
    elapsedSeconds: summary.elapsedSeconds,
    total: summary.total,
    correct: summary.correct,
    percentage: summary.percentage,
    unanswered: summary.unanswered,
    math: summary.math,
    rw: summary.rw,
    projected: summary.projected,
    questions: summary.rows.map((row) => ({
      id: row.id,
      subject: row.subject,
      topicId: row.topicId,
      topic: row.topic,
      domain: row.domain,
      difficulty: row.difficulty,
      type: row.type,
      prompt: row.prompt,
      passage: row.passage || "",
      questionPrompt: row.questionPrompt || "",
      choices: row.choices,
      answer: row.answer,
      answerText: row.answerText,
      explanation: row.explanation,
      formulaIds: row.formulaIds || [],
      response: row.response,
      correct: row.correct,
      correctText: row.correctText,
      userText: row.userText,
      unanswered: row.unanswered,
      source: row.source || "",
    })),
  };
}

export function formatModeSubject(mode) {
  return MODES[mode]?.subject || "Mixed";
}
