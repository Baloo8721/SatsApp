const NS = "sats";
const SCHEMA = 1;

export const DAILY_GOAL_SECONDS = 30 * 60;

const DEFAULT_SETTINGS = {
  theme: "auto",
  targetScore: 1400,
  name: "",
  createdAt: new Date().toISOString(),
};

const DEFAULT_ACTIVITY = {
  days: {},
  totalActiveSeconds: 0,
  sessions: [],
};

function key(name) {
  return `${NS}.${name}`;
}

function read(name, fallback) {
  try {
    const raw = localStorage.getItem(key(name));
    if (!raw) return structuredClone(fallback);
    const parsed = JSON.parse(raw);
    return parsed ?? structuredClone(fallback);
  } catch (err) {
    console.warn(`[store] could not read ${name}`, err);
    return structuredClone(fallback);
  }
}

function write(name, value) {
  try {
    localStorage.setItem(key(name), JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn(`[store] could not write ${name}`, err);
    return false;
  }
}

export function uid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dateFromKey(dateKey) {
  const [y, m, d] = String(dateKey).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(date, amount) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() + amount);
  return copy;
}

export function daysBetween(aKey, bKey) {
  const a = dateFromKey(aKey);
  const b = dateFromKey(bKey);
  return Math.round((b - a) / 86400000);
}

export function monthLabel(date) {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function formatDuration(seconds, { compact = false } = {}) {
  const s = Math.max(0, Math.round(seconds || 0));
  if (compact) {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 1) return `${sec} sec`;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} hr ${m % 60} min`;
}

export function formatDate(iso, { withTime = false } = {}) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const opts = { month: "short", day: "numeric", year: "numeric" };
  if (withTime) {
    opts.hour = "numeric";
    opts.minute = "2-digit";
  }
  return d.toLocaleDateString(undefined, opts);
}

export function formatClock(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read("settings", {}) };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  write("settings", next);
  return next;
}

export function getTheme() {
  const pref = getSettings().theme || "auto";
  if (pref === "auto") {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return pref;
}

/* ------------------------------------------------------------------ */
/* Activity                                                           */
/* ------------------------------------------------------------------ */

export function getActivity() {
  const stored = read("activity", DEFAULT_ACTIVITY);
  return {
    days: stored.days && typeof stored.days === "object" ? stored.days : {},
    totalActiveSeconds: Number(stored.totalActiveSeconds) || 0,
    sessions: Array.isArray(stored.sessions) ? stored.sessions : [],
  };
}

export function saveActivity(activity) {
  return write("activity", activity);
}

export function getDay(dateKey = todayKey()) {
  const activity = getActivity();
  const day = activity.days[dateKey] || {};
  return {
    seconds: Number(day.seconds) || 0,
    sessions: Number(day.sessions) || 0,
    startedAt: day.startedAt || null,
    lastAt: day.lastAt || null,
    goalMet: Boolean(day.goalMet),
  };
}

export function addActiveSeconds(seconds) {
  const amount = Math.max(0, Math.round(seconds));
  if (!amount) return getDay();
  const activity = getActivity();
  const k = todayKey();
  const day = activity.days[k] || { seconds: 0, sessions: 0 };
  day.seconds = Number(day.seconds) + amount;
  day.lastAt = new Date().toISOString();
  day.startedAt = day.startedAt || day.lastAt;
  day.goalMet = day.seconds >= DAILY_GOAL_SECONDS;
  activity.days[k] = day;
  activity.totalActiveSeconds = Number(activity.totalActiveSeconds) + amount;
  saveActivity(activity);
  return getDay(k);
}

export function recordSession({ seconds, kind = "study", label = "", id, at, startedAt, day } = {}) {
  const amount = Math.max(0, Math.round(seconds));
  if (amount < 5) return null;
  const activity = getActivity();
  const endedAt = at || new Date().toISOString();
  const k = day || todayKey(new Date(endedAt));
  const entry = activity.days[k] || { seconds: 0, sessions: 0 };
  entry.sessions = Number(entry.sessions) + 1;
  entry.lastAt = endedAt;
  entry.startedAt = entry.startedAt || endedAt;
  activity.days[k] = entry;
  const session = {
    id: id || uid("session"),
    date: k,
    seconds: amount,
    kind,
    label,
    at: endedAt,
    startedAt: startedAt || new Date(new Date(endedAt).getTime() - amount * 1000).toISOString(),
  };
  activity.sessions.unshift(session);
  activity.sessions = activity.sessions.slice(0, 400);
  saveActivity(activity);
  return session;
}

export function getGoalSeconds() {
  return DAILY_GOAL_SECONDS;
}

export function getStreak() {
  const activity = getActivity();
  const goal = getGoalSeconds();
  let streak = 0;
  let day = new Date();
  for (let i = 0; i < 3660; i++) {
    const k = todayKey(day);
    const entry = activity.days[k];
    const minutes = entry ? (Number(entry.seconds) || 0) : 0;
    if (minutes >= goal) {
      streak++;
      day = addDays(day, -1);
      continue;
    }
    if (i === 0) {
      day = addDays(day, -1);
      continue;
    }
    break;
  }
  return streak;
}

export function getTodayMinutes() {
  return Math.round(getDay().seconds / 60);
}

export function getWeeklyStats() {
  const activity = getActivity();
  const goal = getGoalSeconds();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(new Date(), -i);
    const k = todayKey(d);
    const entry = activity.days[k] || {};
    days.push({
      key: k,
      date: d,
      seconds: Number(entry.seconds) || 0,
      sessions: Number(entry.sessions) || 0,
      goalMet: (Number(entry.seconds) || 0) >= goal,
    });
  }
  const totalSeconds = days.reduce((sum, d) => sum + d.seconds, 0);
  const activeDays = days.filter((d) => d.seconds >= 60).length;
  const goalDays = days.filter((d) => d.goalMet).length;
  return {
    days,
    totalSeconds,
    averageSeconds: Math.round(totalSeconds / 7),
    activeDays,
    goalDays,
    compliance: Math.round((goalDays / 7) * 100),
  };
}

export function getMonthDays(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const days = [];
  for (let i = 0; i < first.getDay(); i++) days.push(null);
  for (let d = 1; d <= last.getDate(); d++) {
    const date = new Date(year, month, d);
    days.push({ date, key: todayKey(date), day: d });
  }
  return days;
}

/* ------------------------------------------------------------------ */
/* Attempts + mastery                                                 */
/* ------------------------------------------------------------------ */

export function getAttempts() {
  const list = read("attempts", []);
  return Array.isArray(list) ? list : [];
}

export function getAttempt(id) {
  return getAttempts().find((a) => a.id === id) || null;
}

export function saveAttempt(attempt) {
  const list = getAttempts();
  list.unshift(attempt);
  write("attempts", list.slice(0, 250));
  return attempt;
}

export function getMastery() {
  return read("mastery", {});
}

export function updateMastery(attempt) {
  const mastery = getMastery();
  for (const q of attempt.questions || []) {
    const topic = String(q.topicId);
    const entry = mastery[topic] || { attempts: 0, correct: 0, lastAt: null, lastCorrect: null };
    entry.attempts += 1;
    if (q.correct) entry.correct += 1;
    entry.lastAt = attempt.completedAt || new Date().toISOString();
    entry.lastCorrect = Boolean(q.correct);
    mastery[topic] = entry;
  }
  write("mastery", mastery);
  return mastery;
}

export function getTopicStat(topicId) {
  const entry = getMastery()[String(topicId)];
  if (!entry) return { attempts: 0, correct: 0, accuracy: null, lastAt: null, lastCorrect: null };
  const attempts = Number(entry.attempts) || 0;
  const correct = Number(entry.correct) || 0;
  return {
    attempts,
    correct,
    accuracy: attempts ? correct / attempts : null,
    lastAt: entry.lastAt || null,
    lastCorrect: entry.lastCorrect ?? null,
  };
}

export function getWeakTopics(limit = 5) {
  const mastery = getMastery();
  const rows = Object.entries(mastery)
    .map(([id, e]) => {
      const attempts = Number(e.attempts) || 0;
      const correct = Number(e.correct) || 0;
      return { topicId: id, attempts, correct, accuracy: attempts ? correct / attempts : 0 };
    })
    .filter((r) => r.attempts >= 1)
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts);
  return rows.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Flashcards (spaced repetition)                                     */
/* ------------------------------------------------------------------ */

export const SRS_INTERVALS = {
  again: 0,
  hard: 1,
  good: 3,
  easy: 7,
};

export function getCards() {
  return read("cards", {});
}

export function getCardState(cardId) {
  const all = getCards();
  return all[cardId] || null;
}

export function saveCardState(cardId, state) {
  const all = getCards();
  all[cardId] = state;
  write("cards", all);
  return state;
}

export function getCardStats(cards) {
  const states = getCards();
  const now = Date.now();
  let due = 0;
  let learning = 0;
  let mastered = 0;
  let reviewed = 0;
  const today = todayKey();
  for (const card of cards) {
    const state = states[card.id];
    if (!state) continue;
    const dueAt = Number(state.due) || 0;
    if (dueAt <= now) due++;
    if ((Number(state.reps) || 0) >= 3) mastered++;
    if (state.lastReviewed && todayKey(new Date(state.lastReviewed)) === today) reviewed++;
    if ((Number(state.reps) || 0) > 0 && (Number(state.interval) || 0) < 3) learning++;
  }
  const seen = cards.filter((c) => states[c.id]).length;
  return {
    total: cards.length,
    seen,
    newCount: cards.length - seen,
    due,
    learning,
    mastered,
    reviewedToday: reviewed,
    masteryPct: cards.length ? Math.round((mastered / cards.length) * 100) : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Lessons                                                            */
/* ------------------------------------------------------------------ */

export function getLessons() {
  return read("lessons", {});
}

export function isLessonRead(id) {
  return Boolean(getLessons()[id]?.read);
}

export function markLessonRead(id, read = true) {
  const lessons = getLessons();
  lessons[id] = { read: Boolean(read), at: new Date().toISOString() };
  write("lessons", lessons);
  return lessons[id];
}

/* ------------------------------------------------------------------ */
/* Quiz draft (survives refresh in a tab)                             */
/* ------------------------------------------------------------------ */

export function getDraft() {
  try {
    const raw = sessionStorage.getItem(key("draft"));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveDraft(draft) {
  try {
    sessionStorage.setItem(key("draft"), JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

export function clearDraft() {
  try {
    sessionStorage.removeItem(key("draft"));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Export                                                             */
/* ------------------------------------------------------------------ */

export function exportData() {
  return {
    app: "SAT Sprint",
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    activity: getActivity(),
    attempts: getAttempts(),
    mastery: getMastery(),
    cards: getCards(),
    lessons: getLessons(),
  };
}

export function getSchemaVersion() {
  return SCHEMA;
}
