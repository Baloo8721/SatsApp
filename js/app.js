import * as store from "./store.js";
import { initActivity, setActivityContext } from "./activity.js";
import { MODES, buildQuiz, checkAnswer, createAttempt, getCorrectText, isAnswered } from "./quiz.js";
import { buildReviewQueue, getDeckStats, gradeCard } from "./srs.js";
import * as sync from "./sync.js";

/* ------------------------------------------------------------------ */
/* State                                                              */
/* ------------------------------------------------------------------ */

const state = {
  content: {
    topics: [],
    formulas: [],
    flashcards: [],
    rwLessons: [],
    rwQuestions: [],
    mathQuestions: [],
  },
  ready: false,
  loadError: "",
  route: { name: "home", parts: [] },
  formulaFilter: "all",
  formulaSearch: "",
  cardsSearch: "",
  flash: {
    active: false,
    deck: "all",
    queue: [],
    index: 0,
    flipped: false,
    reviewed: 0,
    grades: { again: 0, hard: 0, good: 0, easy: 0 },
  },
  quiz: null,
  quizResponses: {},
  quizFlags: {},
  quizFeedback: {},
  quizLocked: {},
  quizIndex: 0,
  quizElapsed: 0,
  quizTicker: null,
  quizLastTick: 0,
  resultsFilter: {},
  progressMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  deferredPrompt: null,
  lastHash: "",
  calc: { expr: "", result: "" },
};

const MATH_DOMAINS = ["Algebra", "Advanced Math", "Geometry & Trig", "Data & Statistics"];
const FORMULA_DOMAINS = ["Reference", "Algebra", "Advanced Math", "Geometry & Trig", "Data & Statistics"];

/* ------------------------------------------------------------------ */
/* Utilities                                                          */
/* ------------------------------------------------------------------ */

function esc(value) {
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

function attrs(value) {
  return esc(value).replace(/`/g, "&#96;");
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function pct(n, d) {
  return d ? Math.round((n / d) * 100) : 0;
}

function todayDateLabel() {
  return new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function dayOfYear(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

function preferredName() {
  const name = (store.getSettings().name || "").trim();
  return name ? `, ${name}` : "";
}

function masteryClass(stat) {
  if (!stat.attempts) return "";
  if (stat.accuracy >= 0.8 && stat.attempts >= 3) return "green";
  if (stat.accuracy >= 0.6) return "amber";
  return "red";
}

function masteryText(stat) {
  if (!stat.attempts) return "New";
  return `${Math.round((stat.accuracy || 0) * 100)}%`;
}

function difficultyLabel(difficulty) {
  const d = Number(difficulty) || 2;
  if (d <= 1) return "Easy";
  if (d >= 3) return "Hard";
  return "Medium";
}

function getMathTopics() {
  return state.content.topics.filter((t) => typeof t.id === "number");
}

function getMetaMap() {
  const map = new Map();
  for (const topic of getMathTopics()) {
    map.set(String(topic.id), { label: topic.title, subject: "Math", domain: topic.domain });
  }
  for (const question of state.content.rwQuestions) {
    const key = String(question.skill);
    if (!map.has(key)) {
      map.set(key, { label: question.skillLabel, subject: "RW", domain: "Reading & Writing" });
    }
  }
  for (const lesson of state.content.rwLessons) {
    const key = String(lesson.skill || lesson.id);
    if (!map.has(key)) {
      map.set(key, { label: lesson.title, subject: "RW", domain: "Reading & Writing" });
    }
  }
  return map;
}

function getRwSkills() {
  const map = new Map();
  for (const question of state.content.rwQuestions) {
    const key = String(question.skill);
    if (!map.has(key)) map.set(key, { id: key, label: question.skillLabel, count: 0 });
    map.get(key).count += 1;
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function getReferenceTopic() {
  return state.content.topics.find((t) => t.id === "reference-sheet") || null;
}

function getTipsTopic() {
  return state.content.topics.find((t) => t.id === "test-day-tips") || null;
}

function getFormulaById(id) {
  return state.content.formulas.find((f) => f.id === id) || null;
}

function getCardById(id) {
  return state.content.flashcards.find((c) => c.id === id) || null;
}

function getTopicById(id) {
  return state.content.topics.find((t) => String(t.id) === String(id)) || null;
}

function getLessonById(id) {
  return state.content.rwLessons.find((l) => l.id === id) || null;
}

function scoreInfo(attempt) {
  if (!attempt) return { value: 0, label: "Score", note: "", short: "score" };
  if (attempt.subject === "Math") {
    return { value: attempt.math?.scaled ?? 0, label: "Estimated Math score", note: "200-800 scale", short: "math" };
  }
  if (attempt.subject === "RW") {
    return { value: attempt.rw?.scaled ?? 0, label: "Estimated RW score", note: "200-800 scale", short: "RW" };
  }
  if (attempt.mode === "full") {
    return { value: attempt.projected ?? 0, label: "Projected total", note: "400-1600 estimate", short: "total" };
  }
  return { value: attempt.projected ?? 0, label: "Rough projection", note: "short quiz — noisy", short: "proj." };
}

function scoreRingPct(attempt) {
  if (!attempt) return 0;
  if (attempt.mode === "full" && attempt.projected) return clamp(Math.round(((attempt.projected - 400) / 1200) * 100), 0, 100);
  if (attempt.subject === "Math" || attempt.subject === "RW") {
    const scaled = attempt.subject === "Math" ? attempt.math?.scaled : attempt.rw?.scaled;
    if (scaled) return clamp(Math.round(((scaled - 200) / 600) * 100), 0, 100);
  }
  return clamp(attempt.percentage || 0, 0, 100);
}

function ringClass(percent) {
  if (percent >= 75) return "green";
  if (percent >= 45) return "amber";
  return "";
}

function scoreBadgeClass(attempt) {
  const value = scoreRingPct(attempt);
  if (value >= 75) return "green";
  if (value >= 45) return "amber";
  return "red";
}

function renderRing(seconds, goal, size = 92) {
  const percent = goal ? clamp(Math.round((seconds / goal) * 100), 0, 100) : 0;
  return `<div class="ring ${ringClass(percent)}" style="--p:${percent};--size:${size}px">
    <div>
      <div class="ring-value" data-live-minutes>${Math.round(seconds / 60)}</div>
      <div class="ring-label">of ${Math.round(goal / 60)} min</div>
    </div>
  </div>`;
}

function renderMiniRing(percent, value, label) {
  return `<div class="ring ${ringClass(percent)}" style="--p:${clamp(percent, 0, 100)};--size:64px">
    <div><div class="ring-value" style="font-size:.9rem">${value}</div><div class="ring-label">${label}</div></div>
  </div>`;
}

function formatAttemptDate(attempt) {
  return store.formatDate(attempt.completedAt, { withTime: true });
}

let lastAccountabilityStamp = "";
let lastSyncCardStamp = "";

function remoteDailyByDay() {
  const map = new Map();
  for (const row of sync.getRemote().daily || []) {
    const key = String(row.day || "").slice(0, 10);
    if (!key) continue;
    const entry = map.get(key) || { seconds: 0, sessions: 0, devices: new Set() };
    entry.seconds += Number(row.active_seconds) || 0;
    entry.sessions += Number(row.sessions) || 0;
    if (row.device_label) entry.devices.add(row.device_label);
    map.set(key, entry);
  }
  return map;
}

function displayDay(dateKey, remoteMap = remoteDailyByDay()) {
  const local = store.getDay(dateKey);
  const status = sync.getStatus();
  if (!status.signedIn || !sync.getRemote().fetchedAt) return local;
  const remote = remoteMap.get(dateKey);
  const remoteSeconds = Number(remote?.seconds) || 0;
  const remoteSessions = Number(remote?.sessions) || 0;
  if (dateKey === store.todayKey()) {
    const seconds = Math.max(local.seconds, remoteSeconds);
    return {
      ...local,
      seconds,
      sessions: Math.max(local.sessions, remoteSessions),
      goalMet: seconds >= store.getGoalSeconds(),
    };
  }
  return {
    ...local,
    seconds: remoteSeconds,
    sessions: remoteSessions,
    goalMet: remoteSeconds >= store.getGoalSeconds(),
  };
}

function accountabilityDays(count = 30, remoteMap = remoteDailyByDay()) {
  const days = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = store.addDays(new Date(), -i);
    const key = store.todayKey(date);
    const entry = displayDay(key, remoteMap);
    const remote = remoteMap.get(key);
    days.push({
      key,
      date,
      seconds: entry.seconds,
      sessions: entry.sessions,
      goalMet: entry.goalMet,
      remote: Boolean(remote),
      devices: remote ? [...remote.devices] : [],
    });
  }
  return days;
}

function accountabilitySummary(days) {
  const today = store.todayKey();
  const goal = store.getGoalSeconds();
  const past = days.filter((day) => day.key !== today);
  const totalSeconds = days.reduce((sum, day) => sum + day.seconds, 0);
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i];
    if (day.key === today && !day.goalMet) continue;
    if (day.goalMet) streak++;
    else break;
  }
  return {
    goalDays: days.filter((day) => day.goalMet).length,
    missedDays: past.filter((day) => day.seconds < goal).length,
    activeDays: days.filter((day) => day.seconds >= 60).length,
    totalSeconds,
    averageSeconds: days.length ? Math.round(totalSeconds / days.length) : 0,
    streak,
  };
}

function displayWeek(remoteMap = remoteDailyByDay()) {
  const goal = store.getGoalSeconds();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const date = store.addDays(new Date(), -i);
    const key = store.todayKey(date);
    const entry = displayDay(key, remoteMap);
    days.push({
      key,
      date,
      seconds: entry.seconds,
      sessions: entry.sessions,
      goalMet: entry.seconds >= goal,
    });
  }
  const totalSeconds = days.reduce((sum, day) => sum + day.seconds, 0);
  const activeDays = days.filter((day) => day.seconds >= 60).length;
  const goalDays = days.filter((day) => day.goalMet).length;
  return {
    days,
    totalSeconds,
    averageSeconds: Math.round(totalSeconds / 7),
    activeDays,
    goalDays,
    compliance: Math.round((goalDays / 7) * 100),
  };
}

function mergedAttempts() {
  const local = store.getAttempts();
  const status = sync.getStatus();
  const remote = sync.getRemote();
  if (!status.signedIn || !remote.fetchedAt) return local;
  const map = new Map();
  for (const attempt of remote.attempts || []) {
    map.set(attempt.id, {
      id: attempt.id,
      mode: attempt.mode,
      title: attempt.title || attempt.mode,
      subject: attempt.subject || "",
      completedAt: attempt.completed_at,
      elapsedSeconds: attempt.elapsed_seconds || 0,
      correct: attempt.correct || 0,
      total: attempt.total || 0,
      percentage: attempt.percentage,
      projected: attempt.projected,
      math: attempt.math_scaled != null ? { scaled: attempt.math_scaled } : null,
      rw: attempt.rw_scaled != null ? { scaled: attempt.rw_scaled } : null,
      remote: true,
    });
  }
  for (const attempt of local) map.set(attempt.id, attempt);
  return [...map.values()].sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
}

function syncStamp() {
  const status = sync.getStatus();
  const remote = sync.getRemote();
  return [
    status.configured,
    status.signedIn,
    status.viewer,
    status.syncing,
    status.pending,
    status.lastSync,
    status.error,
    status.online,
    status.deviceLabel,
    remote.fetchedAt,
    remote.daily?.length || 0,
    remote.events?.length || 0,
    remote.attempts?.length || 0,
  ].join("|");
}

function accountabilityStamp() {
  const status = sync.getStatus();
  const remote = sync.getRemote();
  return [
    status.signedIn,
    status.viewer,
    status.pending,
    status.error,
    status.online,
    JSON.stringify(remote.daily || []),
    JSON.stringify(remote.events || []),
    JSON.stringify(remote.attempts || []),
  ].join("|");
}

function syncStatusMeta(status) {
  if (status.viewer) return { text: "Viewer · not recording", tone: "amber" };
  if (!status.configured) return { text: "Local only", tone: "" };
  if (!status.signedIn) return { text: "Sign in to sync", tone: "amber" };
  if (status.error) return { text: "Sync error", tone: "red" };
  if (!status.online) return { text: "Offline · queued", tone: "amber" };
  if (status.syncing) return { text: "Syncing…", tone: "blue" };
  if (status.pending > 0) return { text: `${status.pending} pending`, tone: "amber" };
  return { text: "Synced", tone: "green" };
}

function renderRemoteActivity(limit = 6) {
  const events = sync.getRemote().events || [];
  if (!events.length) return '<p class="muted small">No synced sessions yet.</p>';
  return `<div class="list">${events.slice(0, limit).map((event) => `<div class="list-item">
    <span class="badge blue">${esc(event.kind || "study")}</span>
    <span class="grow"><span class="title">${esc(event.label || "Study")} · ${store.formatDuration(event.seconds)}</span><span class="sub">${esc(store.formatDate(event.ended_at, { withTime: true }))} · ${esc(event.device_label || "Device")}</span></span>
  </div>`).join("")}</div>`;
}

function renderRemoteAttempts(limit = 5) {
  const localIds = new Set(store.getAttempts().map((attempt) => attempt.id));
  const rows = (sync.getRemote().attempts || [])
    .filter((attempt) => !localIds.has(attempt.id))
    .slice(0, limit);
  if (!rows.length) return '<p class="muted small">No synced attempts from other devices yet.</p>';
  return `<div class="list">${rows.map((attempt) => {
    const percentage = Number(attempt.percentage) || 0;
    const tone = percentage >= 75 ? "green" : percentage >= 45 ? "amber" : "red";
    return `<button class="list-item" data-action="remote-attempt" data-id="${esc(attempt.id)}" style="background:none;border-left:0;border-right:0;border-top:0;text-align:left">
      <span class="badge ${tone}">${esc(attempt.projected ?? `${percentage}%`)}</span>
      <span class="grow"><span class="title">${esc(attempt.title || attempt.mode)}</span><span class="sub">${esc(store.formatDate(attempt.completed_at, { withTime: true }))} · ${attempt.correct}/${attempt.total} · ${esc(attempt.device_label || "Device")}</span></span>
      <span class="chev">›</span>
    </button>`;
  }).join("")}</div>`;
}

function renderAccountabilityCard(remoteMap = remoteDailyByDay()) {
  const status = sync.getStatus();
  const meta = syncStatusMeta(status);
  const days = accountabilityDays(30, remoteMap);
  const summary = accountabilitySummary(days);
  const today = store.todayKey();
  const cells = days.map((day) => {
    const cls = [
      "sync-day",
      day.goalMet ? "green" : day.seconds >= 60 ? "amber" : "",
      day.key === today ? "today" : "",
    ].filter(Boolean).join(" ");
    const title = `${day.key}: ${Math.round(day.seconds / 60)} min${day.remote ? " · synced" : " · local"}`;
    return `<span class="${cls}" title="${esc(title)}">${day.date.getDate()}</span>`;
  }).join("");
  const last = status.signedIn
    ? status.lastSync
      ? `Last sync ${store.formatDate(status.lastSync, { withTime: true })}`
      : "Not synced yet"
    : status.configured
      ? "Sign in under Settings to sync."
      : "Add Supabase credentials in js/config.js.";
  const syncButton = status.configured && status.signedIn
    ? `<button class="btn btn-small" data-action="sync-now" ${status.syncing || !status.online ? "disabled" : ""}>Sync now</button>`
    : "";
  return `<div class="card">
    <div class="section-head"><h2>30-day accountability</h2><span class="badge ${meta.tone}">${esc(meta.text)}</span></div>
    <p class="small muted">Fixed goal: 30 active minutes per day. Past days use synced server history; today includes local live time.</p>
    <div class="sync-strip">${cells}</div>
    <div class="hm-legend" style="margin-top:10px">
      <span class="hm-key"><span class="hm-swatch" style="background:var(--green)"></span>Goal met</span>
      <span class="hm-key"><span class="hm-swatch" style="background:color-mix(in srgb, var(--amber) 38%, var(--surface))"></span>Some activity</span>
      <span class="hm-key"><span class="hm-swatch" style="background:var(--surface-3)"></span>Missed</span>
    </div>
    <div class="stat-row" style="margin-top:14px">
      <div class="stat"><span class="stat-value">${summary.goalDays}</span><span class="stat-label">goal days</span></div>
      <div class="stat"><span class="stat-value">${summary.missedDays}</span><span class="stat-label">missed days</span></div>
      <div class="stat"><span class="stat-value">${summary.streak}</span><span class="stat-label">current streak</span></div>
      <div class="stat"><span class="stat-value">${Math.round(summary.averageSeconds / 60)}</span><span class="stat-label">avg min/day</span></div>
    </div>
    <div class="row between" style="margin-top:12px;gap:10px">
      <span class="tiny muted">${esc(last)}${status.pending ? ` · ${status.pending} pending` : ""}</span>
      ${syncButton}
    </div>
    ${status.error ? `<div class="callout bad small" style="margin-top:10px">${esc(status.error)}</div>` : ""}
    ${status.viewer ? '<div class="callout warn small" style="margin-top:10px">Viewer device: this device does not record activity or attempts.</div>' : ""}
    <details class="sync-details">
      <summary>Recent synced sessions</summary>
      ${renderRemoteActivity(6)}
    </details>
    <details class="sync-details">
      <summary>Synced attempts not on this device</summary>
      ${renderRemoteAttempts(5)}
    </details>
  </div>`;
}

function renderSyncCardHTML() {
  const status = sync.getStatus();
  const meta = syncStatusMeta(status);
  return `<div class="section-head"><h2>Accountability sync</h2><span class="badge ${meta.tone}">${esc(meta.text)}</span></div>
    <p class="small muted">Share one account across devices. Sign in once per device and stay signed in. Server history is append-only: the student cannot delete or edit recorded sessions and attempts.</p>
    <div class="settings-row">
      <div class="grow"><div class="title">Device label</div><div class="sub">Shown next to synced sessions and attempts.</div></div>
      <input class="input" type="text" maxlength="40" value="${attrs(status.deviceLabel)}" data-change="device-label" />
    </div>
    <div class="settings-row">
      <div class="grow"><div class="title">Viewer device</div><div class="sub">Use this on the parent phone. Stops recording activity and attempts after reload; the setting stays saved.</div></div>
      <label class="row small" style="gap:8px"><input type="checkbox" data-change="viewer-device" ${status.viewer ? "checked" : ""} /> On</label>
    </div>
    ${!status.configured ? '<div class="callout warn">Add your Supabase Project URL and anon public key to <code>js/config.js</code>, run <code>supabase/schema.sql</code>, then reload.</div>' : ""}
    ${status.configured && !status.signedIn ? `<form class="sync-form" data-form="sync-signin">
      <div class="grid grid-2">
        <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="username" required /></label>
        <label class="field"><span>Password</span><input class="input" name="password" type="password" autocomplete="current-password" required /></label>
      </div>
      <button class="btn btn-primary" type="submit">Sign in</button>
    </form>` : ""}
    ${status.signedIn ? `<div class="sync-meta">
      <div class="row between"><span class="muted small">Signed in as</span><span class="strong small">${esc(status.email)}</span></div>
      <div class="row between"><span class="muted small">Last sync</span><span class="strong small">${status.lastSync ? esc(store.formatDate(status.lastSync, { withTime: true })) : "Never"}</span></div>
      <div class="row between"><span class="muted small">Pending items</span><span class="strong small">${status.pending}</span></div>
      <div class="row" style="margin-top:10px;gap:8px">
        <button class="btn" data-action="sync-now" ${status.syncing || !status.online ? "disabled" : ""}>Sync now</button>
        <button class="btn btn-ghost" data-action="sync-signout">Sign out</button>
      </div>
    </div>` : ""}
    ${status.error ? `<div class="callout bad small">${esc(status.error)}</div>` : ""}
    <p class="tiny muted">The shared login cannot stop a determined person from adding fake entries. It does prevent deleting or changing recorded history after it reaches the server.</p>`;
}

function refreshSyncCard(force = false) {
  const el = document.getElementById("sync-card");
  if (!el) return;
  if (!force && el.contains(document.activeElement) && document.activeElement.matches?.("input, select, textarea")) return;
  if (!force) {
    const stamp = syncStamp();
    if (stamp === lastSyncCardStamp) return;
    const form = el.querySelector('[data-form="sync-signin"]');
    if (form && (form.querySelector('[name="email"]').value || form.querySelector('[name="password"]').value)) return;
    lastSyncCardStamp = stamp;
  } else {
    lastSyncCardStamp = syncStamp();
  }
  el.innerHTML = renderSyncCardHTML();
}

function refreshAccountability(force = false) {
  const el = document.getElementById("accountability-panel");
  if (!el) return;
  if (!force) {
    const stamp = accountabilityStamp();
    if (stamp === lastAccountabilityStamp) return;
    lastAccountabilityStamp = stamp;
  } else {
    lastAccountabilityStamp = accountabilityStamp();
  }
  el.innerHTML = renderAccountabilityCard();
}

function openRemoteAttempt(id) {
  const attempt = (sync.getRemote().attempts || []).find((row) => row.id === id);
  if (!attempt) {
    toast("That synced attempt is no longer available.", "bad");
    return;
  }
  const topics = attempt.payload?.topicBreakdown || [];
  const score = attempt.projected ?? attempt.percentage ?? 0;
  const body = `<div class="stack">
    <div class="row">
      <span class="badge blue">${esc(attempt.mode || "practice")}</span>
      <span class="badge">${esc(attempt.device_label || "Device")}</span>
      <span class="badge">${esc(store.formatDate(attempt.completed_at, { withTime: true }))}</span>
    </div>
    <div class="grid grid-3">
      <div class="card tight"><div class="stat"><span class="stat-value">${esc(score)}</span><span class="stat-label">${attempt.projected != null ? "projected" : "percent"}</span></div></div>
      <div class="card tight"><div class="stat"><span class="stat-value">${attempt.correct}/${attempt.total}</span><span class="stat-label">correct</span></div></div>
      <div class="card tight"><div class="stat"><span class="stat-value">${store.formatDuration(attempt.elapsed_seconds || 0, { compact: true })}</span><span class="stat-label">time</span></div></div>
    </div>
    ${attempt.math_scaled != null || attempt.rw_scaled != null ? `<div class="grid grid-2">
      <div class="card tight"><div class="stat"><span class="stat-value">${attempt.math_scaled ?? "—"}</span><span class="stat-label">Math estimate</span></div></div>
      <div class="card tight"><div class="stat"><span class="stat-value">${attempt.rw_scaled ?? "—"}</span><span class="stat-label">RW estimate</span></div></div>
    </div>` : ""}
    ${topics.length ? `<div class="meter-list">${topics.map((topic) => {
      const percentage = topic.total ? Math.round((topic.correct / topic.total) * 100) : 0;
      return `<div class="meter"><div class="meter-head"><span>${esc(topic.label || topic.key)}</span><span class="muted">${topic.correct}/${topic.total} · ${percentage}%</span></div><div class="bar ${percentage >= 80 ? "green" : percentage >= 60 ? "amber" : ""}"><span style="width:${clamp(percentage, 3, 100)}%"></span></div></div>`;
    }).join("")}</div>` : '<p class="muted small">No topic breakdown was stored with this attempt.</p>'}
    <p class="tiny muted">Read-only summary synced from another device.</p>
  </div>`;
  openModal(attempt.title || "Synced attempt", body);
}

async function handleSyncSignIn(form) {
  const email = form.querySelector('[name="email"]')?.value || "";
  const password = form.querySelector('[name="password"]')?.value || "";
  const button = form.querySelector('button[type="submit"]');
  if (button) {
    button.disabled = true;
    button.textContent = "Signing in…";
  }
  try {
    await sync.signIn(email, password);
    toast("Signed in. You'll stay signed in on this device.", "good");
    refreshSyncCard(true);
    refreshAccountability(true);
  } catch (err) {
    toast(err?.message || "Sign in failed.", "bad");
    refreshSyncCard(true);
  }
}

/* ------------------------------------------------------------------ */
/* Content loading                                                    */
/* ------------------------------------------------------------------ */

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

async function loadContent() {
  try {
    const [topics, formulas, flashcards, rwLessons, rwQuestions] = await Promise.all([
      loadJson("data/topics.json"),
      loadJson("data/formulas.json"),
      loadJson("data/flashcards.json"),
      loadJson("data/rw-lessons.json"),
      loadJson("data/rw-questions.json"),
    ]);

    let mathQuestions = [];
    try {
      mathQuestions = await loadJson("data/math-questions.json");
    } catch {
      mathQuestions = [];
    }

    state.content = {
      topics: Array.isArray(topics) ? topics : [],
      formulas: Array.isArray(formulas) ? formulas : [],
      flashcards: Array.isArray(flashcards) ? flashcards : [],
      rwLessons: Array.isArray(rwLessons) ? rwLessons : [],
      rwQuestions: Array.isArray(rwQuestions) ? rwQuestions : [],
      mathQuestions: Array.isArray(mathQuestions) ? mathQuestions : [],
    };
    state.loadError = "";
  } catch (err) {
    console.error(err);
    state.loadError = "Could not load the study content. Serve this folder over HTTP (for example, run a local web server) and try again.";
  }
  state.ready = true;
}

/* ------------------------------------------------------------------ */
/* Theme                                                              */
/* ------------------------------------------------------------------ */

function applyTheme() {
  const theme = store.getTheme();
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#0b1220" : "#2563eb";
}

function toggleTheme() {
  const current = store.getTheme();
  const next = current === "dark" ? "light" : "dark";
  store.saveSettings({ theme: next });
  applyTheme();
  toast(`Theme: ${next}`, "good");
}

/* ------------------------------------------------------------------ */
/* Router                                                             */
/* ------------------------------------------------------------------ */

function getRoute() {
  const raw = location.hash || "#/home";
  const clean = raw.split("?")[0];
  const parts = clean.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { name: parts[0] || "home", parts, hash: clean };
}

function navigate(route) {
  closeModal();
  if (location.hash === route) {
    render();
  } else {
    location.hash = route;
  }
}

function navForRoute(name) {
  if (name === "home") return "home";
  if (["learn", "topic", "rw", "formulas", "formula"].includes(name)) return "learn";
  if (["practice", "quiz", "results"].includes(name)) return "practice";
  if (name === "cards") return "cards";
  if (["progress", "attempt"].includes(name)) return "progress";
  return "";
}

function updateNav(name) {
  const active = navForRoute(name);
  document.querySelectorAll(".bottom-nav [data-nav]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.nav === active);
  });
}

function render() {
  if (!state.ready) return;
  const route = getRoute();
  state.route = route;

  if (route.name !== "quiz") stopQuizTicker();

  const main = document.getElementById("main");
  if (!main) return;

  if (state.loadError) {
    main.innerHTML = `<div class="view"><div class="empty"><div class="empty-icon">!</div><h3>Content could not load</h3><p>${esc(state.loadError)}</p></div></div>`;
    return;
  }

  let html = "";
  try {
    switch (route.name) {
      case "home":
        html = renderHome();
        break;
      case "learn":
        html = route.parts[1] === "topic"
          ? renderTopic(route.parts[2])
          : route.parts[1] === "rw"
            ? renderRwLesson(route.parts[2])
            : route.parts[1] === "formulas"
              ? route.parts[2]
                ? renderFormulaDetail(route.parts[2])
                : renderFormulas()
              : renderLearn();
        break;
      case "practice":
        html = renderPractice();
        break;
      case "quiz":
        html = renderQuiz();
        break;
      case "results":
        html = renderResults(route.parts[1]);
        break;
      case "cards":
        html = renderCards();
        break;
      case "progress":
        html = route.parts[1] === "attempt" ? renderAttempt(route.parts[2]) : renderProgress();
        break;
      case "settings":
        html = renderSettings();
        break;
      default:
        html = renderHome();
    }
  } catch (err) {
    console.error(err);
    html = `<div class="view"><div class="empty"><div class="empty-icon">!</div><h3>Something went wrong</h3><p>${esc(err.message || err)}</p><button class="btn btn-primary" data-route="#/home">Go home</button></div></div>`;
  }

  main.innerHTML = html;
  updateNav(route.name);
  updateTodayPill();
  afterRender(route);

  if (state.lastHash !== location.hash) {
    state.lastHash = location.hash;
    window.scrollTo(0, 0);
  }
}

function afterRender(route) {
  if (route.name === "quiz" && state.quiz) {
    startQuizTicker();
    updateQuizClock();
  }
  if (["learn", "topic", "rw", "formulas", "formula"].includes(route.name)) {
    setActivityContext("study", "Study");
  } else if (["practice", "quiz", "results"].includes(route.name)) {
    setActivityContext(route.name === "quiz" ? "quiz" : "practice", route.name === "quiz" ? "Practice test" : "Practice");
  } else if (route.name === "cards") {
    setActivityContext("flashcards", "Flashcards");
  } else if (["progress", "attempt"].includes(route.name)) {
    setActivityContext("review", "Progress");
  } else if (route.name === "settings") {
    setActivityContext("settings", "Settings");
  } else {
    setActivityContext("study", "Home");
  }

  if (route.hash === "#/home" || route.hash === "#/progress") {
    updateLiveActivity({
      todaySeconds: store.getDay().seconds,
      goalSeconds: store.getGoalSeconds(),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Home                                                               */
/* ------------------------------------------------------------------ */

function renderHome() {
  const remoteMap = remoteDailyByDay();
  const today = displayDay(store.todayKey(), remoteMap);
  const goal = store.getGoalSeconds();
  const minutes = Math.round(today.seconds / 60);
  const streak = accountabilitySummary(accountabilityDays(30, remoteMap)).streak;
  const weekly = displayWeek(remoteMap);
  const cardStats = getDeckStats(state.content.flashcards, "all");
  const allAttempts = mergedAttempts();
  const last = allAttempts[0] || null;
  const weak = store.getWeakTopics(4).map((row) => {
    const meta = getMetaMap().get(String(row.topicId));
    return { ...row, meta };
  }).filter((row) => row.meta);
  const practiced = getMathTopics().filter((t) => store.getTopicStat(t.id).attempts > 0).length;
  const formula = state.content.formulas.length
    ? state.content.formulas[dayOfYear() % state.content.formulas.length]
    : null;
  const attemptsToday = allAttempts.filter((a) => store.todayKey(new Date(a.completedAt)) === store.todayKey()).length;

  const planSteps = [
    {
      done: today.seconds >= goal,
      title: `${Math.round(goal / 60)} minutes of active practice`,
      sub: today.seconds >= goal ? "Goal met — nice." : `${Math.max(0, Math.round((goal - today.seconds) / 60))} min to go`,
      action: "start-quiz",
      dataMode: "mixed20",
      label: today.seconds >= goal ? "Practice more" : "Start session",
    },
    {
      done: attemptsToday > 0,
      title: "One practice set",
      sub: attemptsToday > 0 ? `${attemptsToday} set${attemptsToday === 1 ? "" : "s"} done today` : "A Quick 10 takes about 10 minutes",
      action: "start-quiz",
      dataMode: "quick",
      label: "Quick 10",
    },
    {
      done: cardStats.reviewedToday > 0,
      title: "Review due flashcards",
      sub: cardStats.due + cardStats.fresh > 0 ? `${cardStats.due + cardStats.fresh} cards ready` : "No cards due right now",
      route: "#/cards",
      label: "Review cards",
    },
    {
      done: false,
      title: "Study one weak spot",
      sub: weak.length ? `${weak[0].meta.label} · ${Math.round((weak[0].accuracy || 0) * 100)}% accuracy` : "Take a diagnostic to find weak spots",
      route: "#/practice",
      label: weak.length ? "Drill a topic" : "Find weak spots",
    },
  ];

  return `<div class="view">
    <div class="hero">
      <div class="hero-main">
        <div class="eyebrow">${esc(todayDateLabel())}</div>
        <h1>${esc(greeting())}${esc(preferredName())}.</h1>
        <p>One focused 30-minute block is enough to move the needle. Practice, review, and let the calendar do the rest.</p>
        <div class="row">
          <button class="btn btn-primary" data-action="start-quiz" data-mode="mixed20">Start 30-min session</button>
          <button class="btn" data-action="start-quiz" data-mode="quick">Quick 10</button>
        </div>
      </div>
      <div class="hero-side">
        <div class="card ring-card">
          ${renderRing(today.seconds, goal, 92)}
          <div class="stack" style="gap:4px">
            <span class="eyebrow">Today</span>
            <strong style="font-size:1.05rem">${minutes} min active</strong>
            <span class="small muted">${today.seconds >= goal ? "Daily goal met" : `${Math.max(0, Math.round((goal - today.seconds) / 60))} min left`}</span>
            <span class="badge ${today.seconds >= goal ? "green" : "amber"}">${streak} day streak</span>
          </div>
        </div>
        <div class="card tight">
          <div class="stat-row">
            <div class="stat"><span class="stat-value">${cardStats.due + cardStats.fresh}</span><span class="stat-label">cards ready</span></div>
            <div class="stat"><span class="stat-value">${practiced}/${getMathTopics().length}</span><span class="stat-label">topics touched</span></div>
            <div class="stat"><span class="stat-value">${weekly.goalDays}/7</span><span class="stat-label">goal days</span></div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="section-head"><h2>Today's plan</h2><span class="badge blue">${planSteps.filter((s) => s.done).length}/${planSteps.length}</span></div>
        <div class="list">
          ${planSteps.map((step) => `
            <div class="list-item">
              <span class="badge ${step.done ? "green" : "blue"}">${step.done ? "✓" : "•"}</span>
              <div class="grow"><div class="title">${esc(step.title)}</div><div class="sub">${esc(step.sub)}</div></div>
              ${step.action
                ? `<button class="btn btn-small" data-action="${step.action}" data-mode="${step.dataMode}">${esc(step.label)}</button>`
                : `<button class="btn btn-small" data-route="${step.route}">${esc(step.label)}</button>`}
            </div>`).join("")}
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="section-head"><h3>Jump back in</h3><span class="tiny muted">Keep it simple</span></div>
          <div class="grid grid-2" style="gap:9px">
            <button class="btn" data-route="#/learn">Study guide</button>
            <button class="btn" data-route="#/learn/formulas">Formula sheet</button>
            <button class="btn" data-route="#/cards">Flashcards</button>
            <button class="btn" data-route="#/practice">Practice</button>
          </div>
        </div>
        ${formula ? `<button class="card formula-card" data-route="#/learn/formulas/${esc(formula.id)}" style="text-align:left">
          <div class="row between"><span class="eyebrow">Formula of the day</span><span class="badge ${formula.given ? "blue" : "purple"}">${formula.given ? "Given" : "Know it"}</span></div>
          <span class="fc-title">${esc(formula.name)}</span>
          <span class="eq">${formula.html}</span>
          <span class="fc-sub">${esc(formula.hook || formula.when || "")}</span>
        </button>` : ""}
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="section-head"><h2>Weak spots</h2><button class="btn btn-small btn-ghost" data-route="#/progress">See all</button></div>
        ${weak.length ? `<div class="meter-list">
          ${weak.map((row) => `<div class="meter">
            <div class="meter-head"><span>${esc(row.meta.label)}</span><span class="muted">${Math.round((row.accuracy || 0) * 100)}% · ${row.attempts} q</span></div>
            <div class="bar ${row.accuracy >= 0.8 ? "green" : row.accuracy >= 0.6 ? "amber" : ""}"><span style="width:${clamp(Math.round((row.accuracy || 0) * 100), 3, 100)}%"></span></div>
          </div>`).join("")}
        </div>` : `<div class="empty" style="padding:22px 10px"><h3>No weak spots yet</h3><p>Take the Quick 10 diagnostic and the app will start tracking topic accuracy.</p><button class="btn btn-primary" data-action="start-quiz" data-mode="quick">Take the diagnostic</button></div>`}
      </div>

      <div class="card">
        <div class="section-head"><h2>Recent score</h2><button class="btn btn-small btn-ghost" data-route="#/progress">History</button></div>
        ${last ? `<div class="row" style="align-items:flex-start">
          ${renderMiniRing(scoreRingPct(last), scoreInfo(last).value, scoreInfo(last).short)}
          <div class="grow">
            <div class="strong">${esc(last.title)}</div>
            <div class="small muted">${esc(formatAttemptDate(last))}</div>
            <div class="row" style="margin-top:6px"><span class="badge ${scoreBadgeClass(last)}">${last.correct}/${last.total} correct</span><span class="badge">${store.formatDuration(last.elapsedSeconds, { compact: true })}</span></div>
            ${last.remote
              ? `<button class="btn btn-small" style="margin-top:9px" data-action="remote-attempt" data-id="${esc(last.id)}">Review synced attempt</button>`
              : `<button class="btn btn-small" style="margin-top:9px" data-route="#/results/${esc(last.id)}">Review attempt</button>`}
          </div>
        </div>` : `<div class="empty" style="padding:22px 10px"><h3>No attempts yet</h3><p>Your first Quick 10 sets the baseline. It is short on purpose.</p><button class="btn btn-primary" data-action="start-quiz" data-mode="quick">Start Quick 10</button></div>`}
      </div>
    </div>

    <div class="card accent">
      <div class="row between">
        <div><div class="eyebrow">Daily rule</div><div class="strong">Short, consistent, and honest beats one heroic cram session.</div></div>
        <button class="btn btn-primary" data-action="start-quiz" data-mode="mixed20">Start 30 min</button>
      </div>
    </div>
  </div>`;
}


/* ------------------------------------------------------------------ */
/* Learn / study                                                      */
/* ------------------------------------------------------------------ */

function learnTabs(active) {
  return `<div class="segmented no-print">
    <button class="${active === "study" ? "active" : ""}" data-route="#/learn">Study</button>
    <button class="${active === "formulas" ? "active" : ""}" data-route="#/learn/formulas">Formulas</button>
  </div>`;
}

function renderTopicItem(topic) {
  const stat = store.getTopicStat(topic.id);
  const read = store.isLessonRead(`topic-${topic.id}`);
  return `<button class="topic-item" data-route="#/learn/topic/${esc(topic.id)}">
    <span class="topic-num">${topic.number ?? "•"}</span>
    <span class="grow">
      <span class="title">${esc(topic.title)}</span>
      <span class="sub">${esc(topic.subtitle || "")}</span>
    </span>
    <span class="badge ${masteryClass(stat)}" title="${stat.attempts} attempts">${masteryText(stat)}</span>
    ${read ? '<span class="badge green">Studied</span>' : ""}
  </button>`;
}

function renderRwLessonItem(lesson) {
  const stat = store.getTopicStat(lesson.skill || lesson.id);
  const read = store.isLessonRead(lesson.id);
  return `<button class="topic-item" data-route="#/learn/rw/${esc(lesson.id)}">
    <span class="topic-num">RW</span>
    <span class="grow">
      <span class="title">${esc(lesson.title)}</span>
      <span class="sub">${esc(lesson.summary || "")}</span>
    </span>
    <span class="badge ${masteryClass(stat)}">${masteryText(stat)}</span>
    ${read ? '<span class="badge green">Read</span>' : ""}
  </button>`;
}

function renderLearn() {
  const mathTopics = getMathTopics();
  const readCount = mathTopics.filter((t) => store.isLessonRead(`topic-${t.id}`)).length
    + state.content.rwLessons.filter((l) => store.isLessonRead(l.id)).length;
  const totalStudy = mathTopics.length + state.content.rwLessons.length;
  const practiced = mathTopics.filter((t) => store.getTopicStat(t.id).attempts > 0).length;
  const reference = getReferenceTopic();
  const tips = getTipsTopic();

  return `<div class="view">
    <div class="view-head">
      <div>
        <div class="eyebrow">Learn</div>
        <h1>The whole test, one topic at a time.</h1>
        <p>Every math topic and every Reading & Writing skill is broken into a short, test-focused lesson. Mark lessons studied to keep your place.</p>
      </div>
      ${learnTabs("study")}
    </div>

    <div class="grid grid-3">
      <div class="card tight"><div class="stat"><span class="stat-value">${practiced}/${mathTopics.length}</span><span class="stat-label">math topics practiced</span></div></div>
      <div class="card tight"><div class="stat"><span class="stat-value">${readCount}/${totalStudy}</span><span class="stat-label">lessons studied</span></div></div>
      <div class="card tight"><div class="stat"><span class="stat-value">${getDeckStats(state.content.flashcards, "Math Formulas").mastered}/${getDeckStats(state.content.flashcards, "Math Formulas").total}</span><span class="stat-label">formula cards mastered</span></div></div>
    </div>

    <div class="grid grid-2">
      ${reference ? `<button class="card formula-card" data-route="#/learn/topic/reference-sheet" style="text-align:left">
        <div class="row between"><span class="eyebrow">Always available</span><span class="badge blue">Given</span></div>
        <span class="fc-title">${esc(reference.title)}</span>
        <span class="fc-sub">${esc(reference.subtitle || "")}</span>
        <span class="btn btn-small" style="align-self:flex-start">Open reference sheet</span>
      </button>` : ""}
      ${tips ? `<button class="card formula-card" data-route="#/learn/topic/test-day-tips" style="text-align:left">
        <div class="row between"><span class="eyebrow">Before test day</span><span class="badge purple">Strategy</span></div>
        <span class="fc-title">${esc(tips.title)}</span>
        <span class="fc-sub">${esc(tips.subtitle || "")}</span>
        <span class="btn btn-small" style="align-self:flex-start">Read the checklist</span>
      </button>` : ""}
    </div>

    ${MATH_DOMAINS.map((domain) => {
      const topics = mathTopics.filter((t) => t.domain === domain);
      if (!topics.length) return "";
      return `<div class="card">
        <div class="section-head"><h2>${esc(domain)}</h2><span class="badge">${topics.length} topics</span></div>
        <div class="stack">${topics.map(renderTopicItem).join("")}</div>
      </div>`;
    }).join("")}

    <div class="card">
      <div class="section-head"><h2>Reading & Writing</h2><span class="badge">${state.content.rwLessons.length} lessons</span></div>
      <div class="stack">${state.content.rwLessons.map(renderRwLessonItem).join("")}</div>
    </div>

    <div class="card accent">
      <div class="row between">
        <div><div class="eyebrow">Next step</div><div class="strong">Reading is a skill, not a vibe. Drill one RW skill after each lesson.</div></div>
        <button class="btn btn-primary" data-route="#/practice">Choose a drill</button>
      </div>
    </div>
  </div>`;
}

function renderTopicBlocks(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return "";
  const out = [];
  let buffer = "";
  const flush = () => {
    if (buffer.trim()) {
      out.push(`<div class="topic-block">${buffer}</div>`);
      buffer = "";
    }
  };
  for (const block of blocks) {
    if (block.type === "image") {
      flush();
      out.push(`<div class="topic-block"><figure style="margin:0"><img src="${attrs(block.src)}" alt="${attrs(block.alt || block.caption || "Study diagram")}" loading="lazy" />${block.caption ? `<figcaption class="tiny muted" style="margin-top:6px">${esc(block.caption)}</figcaption>` : ""}</figure></div>`);
    } else if (block.type === "ul") {
      buffer += block.html || "";
    } else {
      buffer += block.html || "";
    }
  }
  flush();
  return out.join("");
}

function renderRwBlocks(blocks) {
  if (!Array.isArray(blocks)) return "";
  return `<div class="topic-block">
    ${blocks.map((block) => {
      if (block.type === "h3") return `<h3>${block.html || ""}</h3>`;
      if (block.type === "p") return `<p>${block.html || ""}</p>`;
      if (block.type === "callout") return `<div class="callout">${block.html || ""}</div>`;
      if (block.type === "ul") return block.html || "";
      return block.html || "";
    }).join("")}
  </div>`;
}

function formulasForTopic(topicId) {
  return state.content.formulas.filter((f) => (f.topicIds || []).map(String).includes(String(topicId)));
}

function renderTopic(id) {
  const topic = getTopicById(id);
  if (!topic) {
    return `<div class="view"><div class="empty"><div class="empty-icon">?</div><h3>Topic not found</h3><button class="btn btn-primary" data-route="#/learn">Back to Learn</button></div></div>`;
  }

  const isMath = typeof topic.id === "number";
  const stat = isMath ? store.getTopicStat(topic.id) : { attempts: 0, accuracy: 0 };
  const readKey = isMath ? `topic-${topic.id}` : String(topic.id);
  const read = store.isLessonRead(readKey);
  const related = isMath ? formulasForTopic(topic.id) : [];

  return `<div class="view">
    <div class="row">
      <button class="btn btn-small btn-ghost" data-route="#/learn">← Learn</button>
      <span class="spacer"></span>
      <button class="btn btn-small ${read ? "btn-soft" : ""}" data-action="toggle-read" data-key="${esc(readKey)}">${read ? "Studied ✓" : "Mark studied"}</button>
    </div>

    <div class="view-head">
      <div>
        <div class="eyebrow">${esc(topic.domain || "Study")}${topic.number ? ` · Topic ${topic.number}` : ""}</div>
        <h1>${esc(topic.title)}</h1>
        ${topic.subtitle ? `<p>${esc(topic.subtitle)}</p>` : ""}
      </div>
      ${isMath ? `<span class="badge ${masteryClass(stat)}">${masteryText(stat)}</span>` : ""}
    </div>

    ${related.length ? `<div class="card">
      <div class="section-head"><h2>Key formulas</h2><span class="tiny muted">Tap a card for the full breakdown</span></div>
      <div class="grid grid-2">
        ${related.map((f) => `<button class="formula-card" data-route="#/learn/formulas/${esc(f.id)}" style="text-align:left">
          <span class="row between"><span class="fc-title">${esc(f.name)}</span>${f.given ? '<span class="badge blue">Given</span>' : ""}</span>
          <span class="eq">${f.html}</span>
          <span class="fc-sub">${esc(f.when || "")}</span>
        </button>`).join("")}
      </div>
    </div>` : ""}

    <div class="topic-blocks">${renderTopicBlocks(topic.blocks)}</div>

    ${isMath ? `<div class="card accent">
      <div class="row between">
        <div><div class="eyebrow">Make it stick</div><div class="strong">Ten focused questions on this topic right now.</div></div>
        <button class="btn btn-primary" data-action="start-topic" data-topic="${esc(topic.id)}" data-subject="Math">Drill this topic</button>
      </div>
    </div>` : ""}
  </div>`;
}

function renderRwLesson(id) {
  const lesson = getLessonById(id);
  if (!lesson) {
    return `<div class="view"><div class="empty"><div class="empty-icon">?</div><h3>Lesson not found</h3><button class="btn btn-primary" data-route="#/learn">Back to Learn</button></div></div>`;
  }
  const read = store.isLessonRead(lesson.id);
  return `<div class="view">
    <div class="row">
      <button class="btn btn-small btn-ghost" data-route="#/learn">← Learn</button>
      <span class="spacer"></span>
      <button class="btn btn-small ${read ? "btn-soft" : ""}" data-action="toggle-read" data-key="${esc(lesson.id)}">${read ? "Read ✓" : "Mark read"}</button>
    </div>

    <div class="view-head">
      <div>
        <div class="eyebrow">Reading & Writing</div>
        <h1>${esc(lesson.title)}</h1>
        ${lesson.summary ? `<p>${esc(lesson.summary)}</p>` : ""}
      </div>
    </div>

    <div class="topic-blocks">${renderRwBlocks(lesson.blocks)}</div>

    ${lesson.skill ? `<div class="card accent">
      <div class="row between">
        <div><div class="eyebrow">Practice the skill</div><div class="strong">Ten questions on ${esc(lesson.title)}.</div></div>
        <button class="btn btn-primary" data-action="start-topic" data-topic="${esc(lesson.skill)}" data-subject="RW">Drill this skill</button>
      </div>
    </div>` : ""}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Formulas                                                           */
/* ------------------------------------------------------------------ */

function filterFormulas() {
  const query = state.formulaSearch.trim().toLowerCase();
  return state.content.formulas.filter((f) => {
    if (state.formulaFilter !== "all" && f.domain !== state.formulaFilter) return false;
    if (!query) return true;
    const haystack = `${f.name} ${f.plain || ""} ${f.when || ""} ${f.hook || ""} ${f.domain}`.toLowerCase();
    return haystack.includes(query);
  });
}

function renderFormulaGridHTML(list) {
  if (!list.length) {
    return `<div class="empty"><div class="empty-icon">ƒ</div><h3>No formulas match</h3><p>Try a different search or domain filter.</p></div>`;
  }
  return list.map((f) => `<button class="formula-card" data-route="#/learn/formulas/${esc(f.id)}">
    <span class="row between"><span class="fc-title">${esc(f.name)}</span>${f.given ? '<span class="badge blue">Given</span>' : '<span class="badge purple">Know it</span>'}</span>
    <span class="eq">${f.html}</span>
    <span class="fc-sub">${esc(f.when || f.domain)}</span>
    <span class="formula-tags"><span class="badge">${esc(f.domain)}</span></span>
  </button>`).join("");
}

function renderFormulas() {
  const list = filterFormulas();
  const given = state.content.formulas.filter((f) => f.given).length;
  return `<div class="view">
    <div class="view-head">
      <div>
        <div class="eyebrow">Reference</div>
        <h1>Formulas, without the wall of text.</h1>
        <p>${state.content.formulas.length} high-value formulas. “Given” means it is on the test’s reference sheet; the rest are worth knowing cold.</p>
      </div>
      ${learnTabs("formulas")}
    </div>

    <div class="grid grid-3">
      <div class="card tight"><div class="stat"><span class="stat-value">${state.content.formulas.length}</span><span class="stat-label">formula cards</span></div></div>
      <div class="card tight"><div class="stat"><span class="stat-value">${given}</span><span class="stat-label">given on test day</span></div></div>
      <div class="card tight"><div class="stat"><span class="stat-value">${state.content.formulas.length - given}</span><span class="stat-label">worth memorizing</span></div></div>
    </div>

    <div class="card">
      <div class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16.5 16.5 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input type="search" placeholder="Search formulas…" value="${attrs(state.formulaSearch)}" data-input="formula-search" aria-label="Search formulas" />
      </div>
      <div class="chips" style="margin-top:11px">
        <button class="chip ${state.formulaFilter === "all" ? "active" : ""}" data-action="formula-filter" data-domain="all">All</button>
        ${FORMULA_DOMAINS.map((domain) => `<button class="chip ${state.formulaFilter === domain ? "active" : ""}" data-action="formula-filter" data-domain="${attrs(domain)}">${esc(domain)}</button>`).join("")}
      </div>
    </div>

    <div class="row between no-print">
      <span class="tiny muted" id="formula-count">${list.length} formula${list.length === 1 ? "" : "s"} shown</span>
      <div class="btn-group">
        <button class="btn btn-small" data-action="open-formula-sheet">Print sheet</button>
        <button class="btn btn-small btn-primary" data-action="start-flashcards" data-deck="Math Formulas">Drill formulas</button>
      </div>
    </div>

    <div class="grid grid-auto" id="formula-grid">${renderFormulaGridHTML(list)}</div>
  </div>`;
}

function renderFormulaDetail(id) {
  const formula = getFormulaById(id);
  if (!formula) {
    return `<div class="view"><div class="empty"><div class="empty-icon">ƒ</div><h3>Formula not found</h3><button class="btn btn-primary" data-route="#/learn/formulas">Back to formulas</button></div></div>`;
  }
  const card = state.content.flashcards.find((c) => c.formulaId === formula.id) || null;
  const meta = getMetaMap();
  const related = (formula.topicIds || []).map((tid) => ({ tid, meta: meta.get(String(tid)) })).filter((x) => x.meta);

  return `<div class="view">
    <div class="row">
      <button class="btn btn-small btn-ghost" data-route="#/learn/formulas">← Formulas</button>
      <span class="spacer"></span>
      ${formula.given ? '<span class="badge blue">Given on test day</span>' : '<span class="badge purple">Worth memorizing</span>'}
    </div>

    <div class="view-head">
      <div>
        <div class="eyebrow">${esc(formula.domain)}</div>
        <h1>${esc(formula.name)}</h1>
        <p>${esc(formula.when || "")}</p>
      </div>
    </div>

    <div class="card">
      <div class="eq" style="font-size:1.5rem;padding:18px">${formula.html}</div>
      <div class="grid grid-2" style="margin-top:12px">
        <div class="callout good"><strong>Hook</strong>${esc(formula.hook || "Make the formula tell a story so it sticks.")}</div>
        <div class="callout"><strong>Example</strong>${esc(formula.example || "Try it with simple numbers first.")}</div>
      </div>
      ${formula.mistake ? `<div class="callout bad"><strong>Watch out</strong>${esc(formula.mistake)}</div>` : ""}
      ${formula.image ? `<img src="${attrs(formula.image)}" alt="${attrs(formula.name)}" loading="lazy" style="border-radius:12px;margin-top:10px" />` : ""}
    </div>

    ${related.length ? `<div class="card">
      <div class="section-head"><h2>Where it shows up</h2></div>
      <div class="row">
        ${related.map((row) => `<button class="chip" data-route="#/learn/topic/${esc(row.tid)}">${esc(row.meta.label)}</button>`).join("")}
      </div>
    </div>` : ""}

    <div class="card accent">
      <div class="row between">
        <div><div class="eyebrow">Active recall</div><div class="strong">Review this formula as a flashcard.</div></div>
        <button class="btn btn-primary" data-action="${card ? "start-single-card" : "start-flashcards"}" ${card ? `data-id="${esc(card.id)}"` : 'data-deck="Math Formulas"'}>Review card</button>
      </div>
    </div>
  </div>`;
}


/* ------------------------------------------------------------------ */
/* Practice                                                           */
/* ------------------------------------------------------------------ */

function modeCard(modeId) {
  const mode = MODES[modeId];
  if (!mode) return "";
  return `<div class="card stack">
    <div class="row between">
      <h3>${esc(mode.title)}</h3>
      <span class="badge ${mode.tone}">${mode.timed ? `${mode.minutes} min` : "Untimed"}</span>
    </div>
    <p class="muted small">${esc(mode.subtitle)}</p>
    <div class="formula-tags">
      <span class="badge">${mode.count} questions</span>
      <span class="badge">${mode.feedback ? "Instant feedback" : "Test conditions"}</span>
      <span class="badge ${mode.subject === "RW" ? "amber" : mode.subject === "Full" ? "purple" : "blue"}">${esc(mode.subject)}</span>
    </div>
    <button class="btn btn-primary btn-wide" data-action="start-quiz" data-mode="${modeId}">Start ${esc(mode.short)}</button>
  </div>`;
}

function renderRecentAttempts(limit = 6) {
  const attempts = store.getAttempts().slice(0, limit);
  if (!attempts.length) {
    return `<div class="empty" style="padding:20px 10px"><h3>No attempts yet</h3><p>Start with the Quick 10. It is the fastest way to get a baseline.</p></div>`;
  }
  return `<div class="list">${attempts.map((a) => `<button class="list-item" data-route="#/progress/attempt/${esc(a.id)}" style="background:none;border-left:0;border-right:0;border-top:0;text-align:left">
    <span class="badge ${scoreBadgeClass(a)}">${esc(scoreInfo(a).value)}</span>
    <span class="grow"><span class="title">${esc(a.title)}</span><span class="sub">${esc(formatAttemptDate(a))} · ${a.correct}/${a.total} correct · ${store.formatDuration(a.elapsedSeconds, { compact: true })}</span></span>
    <span class="chev">›</span>
  </button>`).join("")}</div>`;
}

function renderPractice() {
  const mathTopics = getMathTopics();
  const rwSkills = getRwSkills();
  return `<div class="view">
    <div class="view-head">
      <div>
        <div class="eyebrow">Practice</div>
        <h1>Practice like it counts.</h1>
        <p>Short drills build the habit. Timed modules build the score. Pick the smallest thing you can do right now.</p>
      </div>
    </div>

    <div class="card">
      <div class="section-head"><h2>Daily core</h2><span class="badge purple">Start here</span></div>
      <div class="grid grid-2">${modeCard("mixed20")}${modeCard("quick")}</div>
    </div>

    <div class="card">
      <div class="section-head"><h2>Skill drills</h2><span class="tiny muted">Instant explanations</span></div>
      <div class="grid grid-2">${modeCard("mathDrill")}${modeCard("rwDrill")}</div>
    </div>

    <div class="card">
      <div class="section-head"><h2>Timed modules</h2><span class="tiny muted">No hints</span></div>
      <div class="grid grid-3">${modeCard("mathModule")}${modeCard("rwModule")}${modeCard("full")}</div>
    </div>

    <div class="card">
      <div class="section-head"><h2>Drill one topic</h2><span class="tiny muted">10 questions</span></div>
      <details ${mathTopics.some((t) => store.getTopicStat(t.id).attempts > 0) ? "" : "open"}>
        <summary class="strong" style="cursor:pointer;padding:6px 0">Math topics</summary>
        <div class="grid grid-auto" style="margin-top:10px">
          ${mathTopics.map((t) => {
            const stat = store.getTopicStat(t.id);
            return `<button class="topic-item" data-action="start-topic" data-topic="${esc(t.id)}" data-subject="Math" style="padding:10px">
              <span class="topic-num" style="width:28px;height:28px;font-size:.72rem">${t.number}</span>
              <span class="grow"><span class="title" style="font-size:.86rem">${esc(t.title)}</span></span>
              <span class="badge ${masteryClass(stat)}">${masteryText(stat)}</span>
            </button>`;
          }).join("")}
        </div>
      </details>
      <details style="margin-top:8px">
        <summary class="strong" style="cursor:pointer;padding:6px 0">Reading & Writing skills</summary>
        <div class="grid grid-auto" style="margin-top:10px">
          ${rwSkills.map((s) => {
            const stat = store.getTopicStat(s.id);
            return `<button class="topic-item" data-action="start-topic" data-topic="${esc(s.id)}" data-subject="RW" style="padding:10px">
              <span class="topic-num" style="width:28px;height:28px;font-size:.66rem">RW</span>
              <span class="grow"><span class="title" style="font-size:.86rem">${esc(s.label)}</span></span>
              <span class="badge ${masteryClass(stat)}">${masteryText(stat)}</span>
            </button>`;
          }).join("")}
        </div>
      </details>
    </div>

    <div class="card">
      <div class="section-head"><h2>Recent attempts</h2><button class="btn btn-small btn-ghost" data-route="#/progress">All history</button></div>
      ${renderRecentAttempts(6)}
    </div>

    <div class="card flat" style="border-style:dashed">
      <div class="row between">
        <div><div class="eyebrow">Phase 2</div><div class="strong">Official test pack</div><div class="small muted">The private official-test module will live here. The public app stays free of College Board content.</div></div>
        <span class="badge">Coming next</span>
      </div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Quiz                                                               */
/* ------------------------------------------------------------------ */

function startQuiz(mode, options = {}) {
  if (state.quiz && !options.force) {
    const ok = window.confirm("A quiz is already in progress. Start a new one and discard the current quiz?");
    if (!ok) return;
  }
  try {
    const quiz = buildQuiz({
      mode,
      content: state.content,
      topicId: options.topicId ?? null,
      subject: options.subject ?? null,
      count: options.count ?? null,
      title: options.title ?? null,
    });
    state.quiz = quiz;
    state.quizResponses = {};
    state.quizFlags = {};
    state.quizFeedback = {};
    state.quizLocked = {};
    state.quizIndex = 0;
    state.quizElapsed = 0;
    state.quizLastTick = Date.now();
    saveQuizDraft();
    closeModal();
    navigate("#/quiz");
    toast(`Started ${quiz.title}`, "good");
  } catch (err) {
    console.error(err);
    toast(err.message || "Could not start that quiz.", "bad");
  }
}

function restoreQuizDraft() {
  const draft = store.getDraft();
  if (!draft || !draft.quiz) return false;
  state.quiz = draft.quiz;
  state.quizResponses = draft.responses || {};
  state.quizFlags = draft.flags || {};
  state.quizFeedback = draft.feedback || {};
  state.quizLocked = draft.locked || {};
  state.quizIndex = clamp(Number(draft.index) || 0, 0, state.quiz.questions.length - 1);
  state.quizElapsed = Number(draft.elapsed) || 0;
  state.quizLastTick = Date.now();
  return true;
}

function saveQuizDraft() {
  if (!state.quiz) return;
  store.saveDraft({
    quiz: state.quiz,
    responses: state.quizResponses,
    flags: state.quizFlags,
    feedback: state.quizFeedback,
    locked: state.quizLocked,
    index: state.quizIndex,
    elapsed: state.quizElapsed,
  });
}

function clearQuiz() {
  stopQuizTicker();
  state.quiz = null;
  state.quizResponses = {};
  state.quizFlags = {};
  state.quizFeedback = {};
  state.quizLocked = {};
  state.quizIndex = 0;
  state.quizElapsed = 0;
  store.clearDraft();
}

function currentQuestion() {
  return state.quiz?.questions?.[state.quizIndex] || null;
}

function answeredCount() {
  if (!state.quiz) return 0;
  return state.quiz.questions.filter((q) => isAnswered(q, state.quizResponses[q.id])).length;
}

function flaggedCount() {
  return Object.values(state.quizFlags).filter(Boolean).length;
}

function startQuizTicker() {
  if (!state.quiz) return;
  if (state.quizTicker) return;
  state.quizLastTick = Date.now();
  state.quizTicker = window.setInterval(() => {
    if (!state.quiz) {
      stopQuizTicker();
      return;
    }
    if (document.visibilityState !== "visible") {
      state.quizLastTick = Date.now();
      return;
    }
    const now = Date.now();
    const delta = Math.min(2, Math.max(0, (now - state.quizLastTick) / 1000));
    state.quizLastTick = now;
    state.quizElapsed += delta;
    updateQuizClock();
    if (Math.floor(state.quizElapsed) % 10 === 0) saveQuizDraft();
    if (state.quiz.timed && state.quizElapsed >= state.quiz.timeLimit) {
      saveQuizDraft();
      toast("Time is up — submitting your answers.", "");
      submitQuiz(true);
    }
  }, 1000);
}

function stopQuizTicker() {
  if (state.quizTicker) {
    window.clearInterval(state.quizTicker);
    state.quizTicker = null;
  }
}

function updateQuizClock() {
  const timer = document.getElementById("quiz-timer");
  if (!timer || !state.quiz) return;
  if (state.quiz.timed) {
    const remaining = Math.max(0, state.quiz.timeLimit - state.quizElapsed);
    timer.textContent = store.formatClock(remaining);
    timer.classList.toggle("low", remaining <= 300);
    timer.title = "Time remaining";
  } else {
    timer.textContent = store.formatClock(state.quizElapsed);
    timer.classList.remove("low");
    timer.title = "Time elapsed";
  }
}

function renderQuiz() {
  if (!state.quiz && !restoreQuizDraft()) {
    return `<div class="view">
      <div class="empty">
        <div class="empty-icon">?</div>
        <h3>No quiz in progress</h3>
        <p>Start a quick mixed set or a full timed module. Your answers are saved in this tab as you go.</p>
        <div class="row" style="justify-content:center;margin-top:12px">
          <button class="btn btn-primary" data-action="start-quiz" data-mode="mixed20">Start 30-min session</button>
          <button class="btn" data-route="#/practice">Choose a mode</button>
        </div>
      </div>
    </div>`;
  }

  const quiz = state.quiz;
  const q = currentQuestion();
  if (!q) {
    return `<div class="view"><div class="empty"><h3>This quiz is empty</h3><button class="btn btn-primary" data-action="discard-quiz">Discard</button></div></div>`;
  }

  const total = quiz.questions.length;
  const index = state.quizIndex;
  const isLast = index === total - 1;
  const locked = Boolean(state.quizLocked[q.id]);
  const feedback = state.quizFeedback[q.id];
  const response = state.quizResponses[q.id];
  const answered = answeredCount();
  const flagged = flaggedCount();
  const drill = quiz.feedback;
  const currentAnswered = isAnswered(q, response);

  const primaryLabel = drill && !locked
    ? "Check answer"
    : isLast
      ? drill ? "See results" : "Submit test"
      : "Next";

  return `<div class="view quiz-shell">
    <div class="quiz-top">
      <button class="btn btn-small btn-ghost" data-action="exit-quiz">← Exit</button>
      <div class="grow">
        <div class="strong">${esc(quiz.title)}</div>
        <div class="tiny muted">Question ${index + 1} of ${total}${quiz.timed ? " · timed" : " · untimed"}</div>
      </div>
      <div class="timer" id="quiz-timer">0:00</div>
      <button class="btn btn-small" data-action="open-reference">Reference</button>
      <button class="btn btn-small" data-action="open-calc">Calc</button>
      ${!drill ? '<button class="btn btn-small btn-primary" data-action="submit-quiz">Submit</button>' : ""}
    </div>

    <div class="quiz-progress">
      <div class="tiny"><span>${answered} of ${total} answered</span><span>${flagged} flagged</span></div>
      <div class="bar"><span style="width:${pct(answered, total)}%"></span></div>
    </div>

    <div class="question-dots">
      ${quiz.questions.map((item, i) => {
        const cls = [
          "dot",
          isAnswered(item, state.quizResponses[item.id]) ? "answered" : "",
          state.quizFlags[item.id] ? "flagged" : "",
          i === index ? "current" : "",
        ].filter(Boolean).join(" ");
        return `<button class="${cls}" data-action="jump" data-index="${i}" title="Question ${i + 1}">${i + 1}</button>`;
      }).join("")}
    </div>

    <div class="card question-card">
      <div class="question-meta">
        <span class="badge ${q.subject === "RW" ? "amber" : "blue"}">${esc(q.subject)}</span>
        <span class="badge">${esc(q.topic || q.domain || "Question")}</span>
        <span class="badge">${difficultyLabel(q.difficulty)}</span>
        ${state.quizFlags[q.id] ? '<span class="badge amber">Flagged</span>' : ""}
      </div>

      <div class="question-text">${q.prompt}</div>

      ${q.type === "mcq" ? `<div class="choices">
        ${(q.choices || []).map((choice, i) => {
          const selected = Number(response) === i;
          const isCorrect = locked && i === Number(q.answer);
          const isWrong = locked && selected && i !== Number(q.answer);
          const cls = ["choice", selected ? "selected" : "", isCorrect ? "correct" : "", isWrong ? "wrong" : ""].filter(Boolean).join(" ");
          return `<button class="${cls}" data-action="select-choice" data-index="${i}" ${locked ? "disabled" : ""}>
            <span class="choice-letter">${String.fromCharCode(65 + i)}</span>
            <span>${choice}</span>
          </button>`;
        }).join("")}
      </div>` : `<div class="gridin">
        <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="Enter your answer" value="${attrs(response ?? "")}" data-input="grid-answer" ${locked ? "disabled" : ""} aria-label="Your answer" />
        ${!locked ? '<button class="btn btn-small" data-action="submit-grid">Check</button>' : `<span class="badge ${feedback?.correct ? "green" : "red"}">${feedback?.correct ? "Correct" : "Correct answer: " + esc(getCorrectText(q))}</span>`}
      </div>`}

      ${drill && locked && feedback ? `<div class="feedback ${feedback.correct ? "good" : "bad"}">
        <div class="fb-head">${feedback.correct ? "Correct" : feedback.unanswered ? "Unanswered" : "Not quite"}</div>
        ${!feedback.correct ? `<p><strong>Your answer:</strong> ${esc(feedback.userText || "—")}</p>` : ""}
        <p><strong>Correct answer:</strong> ${esc(feedback.correctText)}</p>
        <div>${q.explanation || ""}</div>
      </div>` : ""}
    </div>

    <div class="quiz-footer">
      <div class="left">
        <button class="btn btn-small" data-action="prev" ${index === 0 ? "disabled" : ""}>Previous</button>
        <button class="btn btn-small ${state.quizFlags[q.id] ? "btn-soft" : ""}" data-action="flag">${state.quizFlags[q.id] ? "Unflag" : "Flag"}</button>
      </div>
      <div class="right">
        ${drill && !locked ? `<button class="btn btn-primary" data-action="check-answer">${primaryLabel}</button>` : `<button class="btn btn-primary" data-action="next">${primaryLabel}</button>`}
      </div>
    </div>
  </div>`;
}

function selectChoice(index) {
  const q = currentQuestion();
  if (!q || q.type !== "mcq") return;
  if (state.quizLocked[q.id]) return;
  state.quizResponses[q.id] = Number(index);
  saveQuizDraft();
  render();
}

function submitGrid() {
  const q = currentQuestion();
  if (!q) return;
  const input = document.querySelector('[data-input="grid-answer"]');
  const value = input ? input.value : state.quizResponses[q.id];
  if (!String(value ?? "").trim()) {
    toast("Enter an answer first.", "bad");
    return;
  }
  state.quizResponses[q.id] = String(value);
  if (state.quiz?.feedback) {
    checkCurrent();
  } else {
    saveQuizDraft();
    render();
  }
}

function checkCurrent() {
  const q = currentQuestion();
  if (!q) return;
  if (!isAnswered(q, state.quizResponses[q.id])) {
    toast("Select or enter an answer first.", "bad");
    return;
  }
  state.quizFeedback[q.id] = checkAnswer(q, state.quizResponses[q.id]);
  state.quizLocked[q.id] = true;
  saveQuizDraft();
  render();
}

function nextQuestion() {
  if (!state.quiz) return;
  const q = currentQuestion();
  if (state.quiz.feedback && q && !state.quizLocked[q.id]) {
    checkCurrent();
    return;
  }
  if (state.quizIndex < state.quiz.questions.length - 1) {
    state.quizIndex += 1;
    saveQuizDraft();
    render();
    return;
  }
  submitQuiz(false);
}

function prevQuestion() {
  if (!state.quiz || state.quizIndex <= 0) return;
  state.quizIndex -= 1;
  saveQuizDraft();
  render();
}

function jumpTo(index) {
  if (!state.quiz) return;
  const next = clamp(Number(index) || 0, 0, state.quiz.questions.length - 1);
  state.quizIndex = next;
  saveQuizDraft();
  render();
}

function toggleFlag() {
  const q = currentQuestion();
  if (!q) return;
  state.quizFlags[q.id] = !state.quizFlags[q.id];
  saveQuizDraft();
  render();
}

function submitQuiz(auto = false) {
  if (!state.quiz) return;
  const unanswered = state.quiz.questions.filter((q) => !isAnswered(q, state.quizResponses[q.id])).length;
  if (!auto) {
    if (unanswered > 0) {
      const ok = window.confirm(`You have ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}. Submit anyway?`);
      if (!ok) return;
    } else {
      const ok = window.confirm("Submit this attempt and save your score?");
      if (!ok) return;
    }
  }

  const attempt = createAttempt(state.quiz, state.quizResponses, state.quizElapsed);
  store.saveAttempt(attempt);
  store.updateMastery(attempt);
  sync.enqueueAttempt(attempt);
  clearQuiz();
  toast("Attempt saved.", "good");
  navigate(`#/results/${attempt.id}`);
}

function exitQuiz() {
  if (!state.quiz) {
    navigate("#/practice");
    return;
  }
  const ok = window.confirm("Leave this quiz? Your progress stays saved in this tab, so you can resume later.");
  if (!ok) return;
  saveQuizDraft();
  stopQuizTicker();
  navigate("#/practice");
}

function discardQuiz() {
  if (!window.confirm("Discard this quiz and clear all answers?")) return;
  clearQuiz();
  navigate("#/practice");
}


/* ------------------------------------------------------------------ */
/* Results / attempt detail                                           */
/* ------------------------------------------------------------------ */

function renderResults(id) {
  const attempt = store.getAttempt(id);
  return renderAttemptDetail(attempt, { backRoute: "#/practice", backLabel: "Practice" });
}

function renderAttempt(id) {
  const attempt = store.getAttempt(id);
  return renderAttemptDetail(attempt, { backRoute: "#/progress", backLabel: "Progress" });
}

function topicBreakdown(attempt) {
  const map = new Map();
  const metaMap = getMetaMap();
  for (const q of attempt.questions || []) {
    const key = String(q.topicId ?? q.topic);
    const row = map.get(key) || { key, total: 0, correct: 0, meta: metaMap.get(key) || { label: q.topic || "Question", subject: q.subject, domain: q.domain } };
    row.total += 1;
    if (q.correct) row.correct += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => (a.correct / a.total) - (b.correct / b.total) || b.total - a.total);
}

function renderReviewQuestion(q, number) {
  const cls = q.correct ? "correct" : "wrong";
  const choiceList = q.type === "mcq" && Array.isArray(q.choices)
    ? `<ul style="list-style:none;padding:0;margin:8px 0;display:flex;flex-direction:column;gap:3px">
        ${q.choices.map((choice, i) => {
          const isCorrect = i === Number(q.answer);
          const isSelected = Number(q.response) === i;
          const style = isCorrect
            ? "color:var(--green);font-weight:650"
            : isSelected
              ? "color:var(--red);text-decoration:line-through"
              : "color:var(--muted)";
          return `<li style="${style}">${String.fromCharCode(65 + i)}. ${choice}${isCorrect ? " ✓" : ""}${isSelected && !isCorrect ? " (your answer)" : ""}</li>`;
        }).join("")}
      </ul>`
    : "";

  return `<div class="review-item ${cls}">
    <div class="row between">
      <span class="badge ${q.correct ? "green" : "red"}">Q${number} · ${q.correct ? "Correct" : q.unanswered ? "Unanswered" : "Wrong"}</span>
      <span class="tiny muted">${esc(q.topic || q.domain || "")}</span>
    </div>
    <div class="q-text">${q.prompt || ""}</div>
    ${choiceList}
    <div class="ans-line"><strong>Your answer:</strong> ${esc(q.userText || "—")} · <strong>Correct:</strong> ${esc(q.correctText || q.answerText || "")}</div>
    <details class="explain" ${q.correct ? "" : "open"}>
      <summary class="tiny strong" style="cursor:pointer">Explanation</summary>
      <div style="margin-top:6px">${q.explanation || ""}</div>
    </details>
  </div>`;
}

function renderAttemptDetail(attempt, { backRoute, backLabel }) {
  if (!attempt) {
    return `<div class="view"><div class="empty"><div class="empty-icon">?</div><h3>Attempt not found</h3><button class="btn btn-primary" data-route="${backRoute}">Back to ${esc(backLabel)}</button></div></div>`;
  }

  const info = scoreInfo(attempt);
  const ringPct = scoreRingPct(attempt);
  const breakdown = topicBreakdown(attempt);
  const wrong = (attempt.questions || []).filter((q) => !q.correct);
  const filter = state.resultsFilter[attempt.id] || (wrong.length ? "wrong" : "all");
  const shown = filter === "wrong" ? wrong : attempt.questions;
  const hasSections = attempt.math?.total && attempt.rw?.total;

  return `<div class="view">
    <div class="row no-print">
      <button class="btn btn-small btn-ghost" data-route="${backRoute}">← ${esc(backLabel)}</button>
      <span class="spacer"></span>
      <button class="btn btn-small" data-action="start-again" data-attempt="${esc(attempt.id)}">Try again</button>
    </div>

    <div class="score-hero">
      <div class="ring" style="--p:${ringPct};--size:96px">
        <div><div class="ring-value" style="color:#fff">${attempt.percentage}%</div><div class="ring-label" style="color:rgba(255,255,255,.6)">correct</div></div>
      </div>
      <div class="grow">
        <div class="eyebrow" style="color:rgba(255,255,255,.6)">${esc(attempt.title)} · ${esc(formatAttemptDate(attempt))}</div>
        <div class="score-big">${esc(info.value)}</div>
        <div class="muted">${esc(info.label)}${info.note ? ` · ${esc(info.note)}` : ""}</div>
        <div class="row" style="margin-top:10px">
          <span class="badge">${attempt.correct}/${attempt.total} correct</span>
          <span class="badge">${store.formatDuration(attempt.elapsedSeconds)}</span>
          ${attempt.unanswered ? `<span class="badge amber">${attempt.unanswered} skipped</span>` : ""}
        </div>
      </div>
      <div class="stat" style="text-align:right">
        <span class="stat-value" style="color:#fff">${attempt.percentage}%</span>
        <span class="stat-label" style="color:rgba(255,255,255,.6)">accuracy</span>
      </div>
    </div>

    ${hasSections ? `<div class="grid grid-2">
      <div class="card">
        <div class="section-head"><h3>Math</h3><span class="badge blue">${attempt.math.correct}/${attempt.math.total}</span></div>
        <div class="stat"><span class="stat-value">${attempt.math.scaled ?? "—"}</span><span class="stat-label">estimated section score (200-800)</span></div>
      </div>
      <div class="card">
        <div class="section-head"><h3>Reading & Writing</h3><span class="badge amber">${attempt.rw.correct}/${attempt.rw.total}</span></div>
        <div class="stat"><span class="stat-value">${attempt.rw.scaled ?? "—"}</span><span class="stat-label">estimated section score (200-800)</span></div>
      </div>
    </div>` : ""}

    <div class="grid grid-2">
      <div class="card">
        <div class="section-head"><h2>Topic breakdown</h2><span class="tiny muted">Weakest first</span></div>
        ${breakdown.length ? `<div class="meter-list">
          ${breakdown.map((row) => {
            const p = pct(row.correct, row.total);
            return `<div class="meter">
              <div class="meter-head"><span>${esc(row.meta.label)}</span><span class="muted">${row.correct}/${row.total} · ${p}%</span></div>
              <div class="bar ${p >= 80 ? "green" : p >= 60 ? "amber" : ""}"><span style="width:${clamp(p, 3, 100)}%"></span></div>
            </div>`;
          }).join("")}
        </div>` : '<p class="muted small">No topic data.</p>'}
      </div>
      <div class="card">
        <div class="section-head"><h2>What to do next</h2></div>
        <div class="stack">
          ${wrong.length ? `<div class="callout bad"><strong>${wrong.length} question${wrong.length === 1 ? "" : "s"} to review</strong>Read the explanation for each miss, then drill the weakest topic below.</div>` : `<div class="callout good"><strong>Clean sheet</strong>No wrong answers in this set. Increase difficulty or move to a timed module.</div>`}
          <button class="btn btn-primary" data-route="#/practice">Practice weak topics</button>
          <button class="btn" data-route="#/cards">Review flashcards</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="section-head">
        <h2>Question review</h2>
        <div class="segmented no-print">
          <button class="${filter === "wrong" ? "active" : ""}" data-action="review-filter" data-attempt="${esc(attempt.id)}" data-value="wrong">Wrong only (${wrong.length})</button>
          <button class="${filter === "all" ? "active" : ""}" data-action="review-filter" data-attempt="${esc(attempt.id)}" data-value="all">All (${attempt.total})</button>
        </div>
      </div>
      <div class="stack">
        ${shown.length ? shown.map((q) => renderReviewQuestion(q, attempt.questions.indexOf(q) + 1)).join("") : `<div class="empty" style="padding:24px"><h3>Nothing here</h3><p>No questions match this filter.</p></div>`}
      </div>
    </div>

    <div class="row no-print">
      <button class="btn" data-route="${backRoute}">← ${esc(backLabel)}</button>
      <span class="spacer"></span>
      <button class="btn" data-action="start-again" data-attempt="${esc(attempt.id)}">Try again</button>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Flashcards                                                         */
/* ------------------------------------------------------------------ */

const DECKS = ["Math Formulas", "Math Concepts", "Reading & Writing"];

function startFlashcards(deckOrCards = "all", options = {}) {
  let queue;
  let deck = "all";
  if (Array.isArray(deckOrCards)) {
    queue = deckOrCards;
    deck = options.deck || "custom";
  } else {
    deck = deckOrCards;
    queue = buildReviewQueue(state.content.flashcards, { deck, limit: options.limit || 20 });
  }
  state.flash = {
    active: true,
    deck,
    queue,
    index: 0,
    flipped: false,
    reviewed: 0,
    grades: { again: 0, hard: 0, good: 0, easy: 0 },
  };
  closeModal();
  if (getRoute().name !== "cards") navigate("#/cards");
  else render();
}

function exitFlashcards() {
  state.flash.active = false;
  state.flash.queue = [];
  navigate("#/cards");
}

function flashcardSummary() {
  const flash = state.flash;
  const total = flash.queue.length;
  return `<div class="view">
    <div class="row"><button class="btn btn-small btn-ghost" data-action="exit-flashcards">← Decks</button></div>
    <div class="card center" style="padding:34px 20px">
      <div class="empty-icon" style="margin:0 auto 12px">✓</div>
      <h2>Session complete</h2>
      <p class="muted">${flash.reviewed} card${flash.reviewed === 1 ? "" : "s"} reviewed.</p>
      <div class="row" style="justify-content:center;margin:16px 0">
        <span class="badge red">Again ${flash.grades.again}</span>
        <span class="badge amber">Hard ${flash.grades.hard}</span>
        <span class="badge blue">Good ${flash.grades.good}</span>
        <span class="badge green">Easy ${flash.grades.easy}</span>
      </div>
      <div class="row" style="justify-content:center">
        <button class="btn btn-primary" data-action="start-flashcards" data-deck="${esc(flash.deck)}">Review again</button>
        <button class="btn" data-action="exit-flashcards">Back to decks</button>
      </div>
    </div>
  </div>`;
}

function renderFlashcardSession() {
  const flash = state.flash;
  if (flash.index >= flash.queue.length) return flashcardSummary();
  const card = flash.queue[flash.index];
  if (!card) return flashcardSummary();
  const progress = pct(flash.index, flash.queue.length);
  return `<div class="view">
    <div class="row">
      <button class="btn btn-small btn-ghost" data-action="exit-flashcards">← Decks</button>
      <span class="spacer"></span>
      <span class="badge">${esc(card.deck)}</span>
      <span class="tiny muted">${flash.index + 1} / ${flash.queue.length}</span>
    </div>
    <div class="bar"><span style="width:${progress}%"></span></div>

    <div class="flashcard-stage">
      <div class="flashcard ${flash.flipped ? "flipped" : ""}" data-action="flip-card" role="button" tabindex="0" aria-label="Tap to reveal the answer">
        <div class="fc-face">
          <div class="fc-kicker">${esc(card.deck)}</div>
          <div class="fc-front-title">${card.front}</div>
          <div class="fc-hint">Tap to reveal</div>
        </div>
        <div class="fc-face fc-back">
          <div class="fc-kicker">Answer</div>
          <div class="strong">${card.front}</div>
          ${card.back}
          <div class="fc-hint">Tap to hide</div>
        </div>
      </div>
    </div>

    <div class="fc-actions" data-flash-actions>
      <button class="btn again" data-action="grade" data-grade="again" ${flash.flipped ? "" : "disabled"}>Again<small>1 min</small></button>
      <button class="btn hard" data-action="grade" data-grade="hard" ${flash.flipped ? "" : "disabled"}>Hard<small>1 day</small></button>
      <button class="btn good" data-action="grade" data-grade="good" ${flash.flipped ? "" : "disabled"}>Good<small>few days</small></button>
      <button class="btn easy" data-action="grade" data-grade="easy" ${flash.flipped ? "" : "disabled"}>Easy<small>a week</small></button>
    </div>
    <p class="tiny muted center">Grade honestly. “Again” is the card that teaches you the most.</p>
  </div>`;
}

function renderCardsBrowseHTML() {
  const query = state.cardsSearch.trim().toLowerCase();
  const cards = state.content.flashcards.filter((c) => {
    if (!query) return true;
    const haystack = `${c.front} ${c.deck} ${c.back || ""}`.toLowerCase();
    return haystack.includes(query);
  }).slice(0, 40);
  if (!cards.length) return `<div class="empty" style="padding:22px"><h3>No cards match</h3><p>Try a different search.</p></div>`;
  return cards.map((c) => `<button class="list-item" data-action="start-single-card" data-id="${esc(c.id)}" style="background:none;border-left:0;border-right:0;border-top:0;text-align:left">
    <span class="badge ${c.deck === "Math Formulas" ? "blue" : c.deck === "Math Concepts" ? "purple" : "amber"}">${esc(c.deck)}</span>
    <span class="grow"><span class="title">${esc(c.front)}</span></span>
    <span class="chev">›</span>
  </button>`).join("");
}

function renderCardsOverview() {
  const allStats = getDeckStats(state.content.flashcards, "all");
  return `<div class="view">
    <div class="view-head">
      <div>
        <div class="eyebrow">Flashcards</div>
        <h1>Active recall, on a schedule.</h1>
        <p>Cards you struggle with come back sooner. Cards you know fade into the background. Review a little every day.</p>
      </div>
      <button class="btn btn-primary" data-action="start-flashcards" data-deck="all">Review due cards</button>
    </div>

    <div class="grid grid-3">
      <div class="card tight"><div class="stat"><span class="stat-value">${allStats.due + allStats.fresh}</span><span class="stat-label">cards ready</span></div></div>
      <div class="card tight"><div class="stat"><span class="stat-value">${allStats.mastered}</span><span class="stat-label">mastered</span></div></div>
      <div class="card tight"><div class="stat"><span class="stat-value">${allStats.reviewedToday}</span><span class="stat-label">reviewed today</span></div></div>
    </div>

    <div class="grid grid-3">
      ${DECKS.map((deck) => {
        const stats = getDeckStats(state.content.flashcards, deck);
        return `<div class="card stack">
          <div class="row between"><h3>${esc(deck)}</h3><span class="badge ${deck === "Math Formulas" ? "blue" : deck === "Math Concepts" ? "purple" : "amber"}">${stats.total}</span></div>
          <div class="meter-list" style="gap:8px">
            <div class="meter"><div class="meter-head"><span class="muted">Due + new</span><span>${stats.due + stats.fresh}</span></div><div class="bar"><span style="width:${pct(stats.due + stats.fresh, stats.total)}%"></span></div></div>
            <div class="meter"><div class="meter-head"><span class="muted">Mastered</span><span>${stats.mastered}</span></div><div class="bar green"><span style="width:${stats.masteryPct}%"></span></div></div>
          </div>
          <button class="btn btn-wide" data-action="start-flashcards" data-deck="${attrs(deck)}">Review ${esc(deck)}</button>
        </div>`;
      }).join("")}
    </div>

    <div class="card">
      <div class="section-head"><h2>Browse all cards</h2><span class="tiny muted">Tap one to review it now</span></div>
      <div class="search" style="margin-bottom:10px">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16.5 16.5 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input type="search" placeholder="Search cards…" value="${attrs(state.cardsSearch)}" data-input="cards-search" aria-label="Search flashcards" />
      </div>
      <div id="cards-browse-list">${renderCardsBrowseHTML()}</div>
    </div>
  </div>`;
}

function renderCards() {
  return state.flash.active ? renderFlashcardSession() : renderCardsOverview();
}


/* ------------------------------------------------------------------ */
/* Progress                                                           */
/* ------------------------------------------------------------------ */

function renderWeeklyChart(days, goalSeconds) {
  const W = 360;
  const H = 150;
  const left = 26;
  const right = 10;
  const top = 12;
  const bottom = 28;
  const chartW = W - left - right;
  const chartH = H - top - bottom;
  const max = Math.max(goalSeconds, ...days.map((d) => d.seconds), 60);
  const slot = chartW / days.length;
  const bw = Math.max(10, slot - 10);
  const goalY = top + chartH * (1 - goalSeconds / max);
  const bars = days.map((d, i) => {
    const h = Math.max(1, Math.round((d.seconds / max) * chartH));
    const x = left + i * slot + (slot - bw) / 2;
    const y = top + chartH - h;
    const color = d.goalMet ? "var(--green)" : d.seconds > 0 ? "var(--accent)" : "var(--surface-3)";
    const label = d.date.toLocaleDateString(undefined, { weekday: "narrow" });
    return `<rect x="${x.toFixed(1)}" y="${y}" width="${bw}" height="${h}" rx="4" fill="${color}" opacity="${d.seconds > 0 ? 0.95 : 0.7}"><title>${label}: ${Math.round(d.seconds / 60)} min</title></rect>`
      + `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 9}" text-anchor="middle" font-size="10">${label}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="Active minutes for the last seven days">
    <line x1="${left}" y1="${goalY.toFixed(1)}" x2="${W - right}" y2="${goalY.toFixed(1)}" stroke="var(--amber)" stroke-width="1" stroke-dasharray="4 4" opacity="0.7"/>
    <text x="${W - right}" y="${(goalY - 4).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--amber)">goal</text>
    <line x1="${left}" y1="${top + chartH}" x2="${W - right}" y2="${top + chartH}" stroke="var(--line)" stroke-width="1"/>
    ${bars}
  </svg>`;
}

function renderTrendChart(attempts) {
  let rows = attempts.filter((a) => a.projected != null && (a.subject === "Full" || a.subject === "Mixed")).slice(0, 10);
  if (rows.length < 2) rows = attempts.filter((a) => a.projected != null).slice(0, 10);
  rows = rows.slice().reverse();
  if (rows.length < 2) {
    return `<div class="empty" style="padding:22px"><h3>Not enough scores yet</h3><p>Two attempts will start the trend line. The Quick 10 is enough.</p><button class="btn btn-primary" data-action="start-quiz" data-mode="quick">Start Quick 10</button></div>`;
  }

  const W = 360;
  const H = 180;
  const left = 34;
  const right = 12;
  const top = 14;
  const bottom = 32;
  const chartW = W - left - right;
  const chartH = H - top - bottom;
  const values = rows.map((a) => Number(a.projected));
  const isSection = rows.every((a) => a.subject === "Math" || a.subject === "RW");
  const floor = isSection ? 200 : 400;
  const ceiling = isSection ? 800 : 1600;
  let min = Math.max(floor, Math.min(...values) - 40);
  let max = Math.min(ceiling, Math.max(...values) + 40);
  if (max - min < 100) {
    const mid = (max + min) / 2;
    min = Math.max(floor, mid - 50);
    max = Math.min(ceiling, mid + 50);
  }
  const range = Math.max(1, max - min);
  const xFor = (i) => left + (rows.length === 1 ? chartW / 2 : (i / (rows.length - 1)) * chartW);
  const yFor = (v) => top + (1 - (v - min) / range) * chartH;
  const points = rows.map((a, i) => `${xFor(i).toFixed(1)},${yFor(Number(a.projected)).toFixed(1)}`);
  const area = `M ${xFor(0).toFixed(1)} ${(top + chartH).toFixed(1)} L ${points.join(" L ")} L ${xFor(rows.length - 1).toFixed(1)} ${(top + chartH).toFixed(1)} Z`;
  const grid = [0, 0.5, 1].map((f) => {
    const v = Math.round(min + range * f);
    const y = yFor(v);
    return `<line class="gridline" x1="${left}" y1="${y.toFixed(1)}" x2="${W - right}" y2="${y.toFixed(1)}"/>
      <text x="${left - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${v}</text>`;
  }).join("");
  const dots = rows.map((a, i) => `<circle class="dot" cx="${xFor(i).toFixed(1)}" cy="${yFor(Number(a.projected)).toFixed(1)}" r="3.5"><title>${store.formatDate(a.completedAt)}: ${a.projected}</title></circle>`).join("");
  const first = store.formatDate(rows[0].completedAt);
  const last = store.formatDate(rows[rows.length - 1].completedAt);
  return `<svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="Projected score trend">
    ${grid}
    <path class="area" d="${area}"/>
    <polyline class="line" points="${points.join(" ")}"/>
    ${dots}
    <text x="${left}" y="${H - 9}" text-anchor="start">${first}</text>
    <text x="${W - right}" y="${H - 9}" text-anchor="end">${last}</text>
  </svg>`;
}

function renderCalendar(remoteMap = remoteDailyByDay()) {
  const month = state.progressMonth;
  const year = month.getFullYear();
  const m = month.getMonth();
  const days = store.getMonthDays(year, m);
  const goal = store.getGoalSeconds();
  const today = store.todayKey();
  const now = new Date();
  let activeDays = 0;
  let goalDays = 0;
  let totalSeconds = 0;

  const cells = days.map((d) => {
    if (!d) return '<div class="hm-cell blank"></div>';
    const entry = displayDay(d.key, remoteMap);
    if (entry.seconds > 0) activeDays += 1;
    if (entry.seconds >= goal) goalDays += 1;
    totalSeconds += entry.seconds;
    const isFuture = d.date > now && d.key !== today;
    const cls = [
      "hm-cell",
      entry.seconds >= goal ? "green" : entry.seconds >= 60 ? "amber" : "",
      d.key === today ? "today" : "",
      isFuture ? "future" : "",
    ].filter(Boolean).join(" ");
    return `<button class="${cls}" ${isFuture ? "disabled" : ""} data-action="day-detail" data-date="${d.key}" title="${d.key}: ${Math.round(entry.seconds / 60)} min">${d.day}</button>`;
  }).join("");

  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextDisabled = month >= currentMonth;

  return `<div class="card">
    <div class="section-head no-print">
      <h2>${esc(store.monthLabel(month))}</h2>
      <div class="row" style="gap:6px">
        <button class="btn btn-small" data-action="cal-prev" aria-label="Previous month">‹</button>
        <button class="btn btn-small" data-action="cal-next" ${nextDisabled ? "disabled" : ""} aria-label="Next month">›</button>
      </div>
    </div>
    <div class="heatmap" style="margin-top:4px">
      ${["S", "M", "T", "W", "T", "F", "S"].map((d) => `<div class="hm-head">${d}</div>`).join("")}
      ${cells}
    </div>
    <div class="hm-legend" style="margin-top:12px">
      <span class="hm-key"><span class="hm-swatch" style="background:var(--green)"></span>Goal met</span>
      <span class="hm-key"><span class="hm-swatch" style="background:color-mix(in srgb, var(--amber) 38%, var(--surface))"></span>Some activity</span>
      <span class="hm-key"><span class="hm-swatch" style="background:var(--surface-3)"></span>Missed</span>
    </div>
    <div class="stat-row" style="margin-top:14px">
      <div class="stat"><span class="stat-value">${activeDays}</span><span class="stat-label">active days</span></div>
      <div class="stat"><span class="stat-value">${goalDays}</span><span class="stat-label">goal days</span></div>
      <div class="stat"><span class="stat-value">${Math.round(totalSeconds / 60)}</span><span class="stat-label">total minutes</span></div>
    </div>
  </div>`;
}

function renderWeakTopicsCard(limit = 6) {
  const rows = store.getWeakTopics(limit).map((row) => {
    const meta = getMetaMap().get(String(row.topicId));
    return { ...row, meta };
  }).filter((row) => row.meta);

  if (!rows.length) {
    return `<div class="card"><div class="section-head"><h2>Weak topics</h2></div><div class="empty" style="padding:22px"><h3>No data yet</h3><p>Take a diagnostic and this list will fill in automatically.</p><button class="btn btn-primary" data-action="start-quiz" data-mode="quick">Take the Quick 10</button></div></div>`;
  }

  return `<div class="card">
    <div class="section-head"><h2>Weak topics</h2><span class="tiny muted">Lowest accuracy first</span></div>
    <div class="meter-list">
      ${rows.map((row) => {
        const p = Math.round((row.accuracy || 0) * 100);
        return `<div class="meter">
          <div class="meter-head">
            <span>${esc(row.meta.label)}</span>
            <span class="muted">${p}% · ${row.attempts} q</span>
          </div>
          <div class="bar ${p >= 80 ? "green" : p >= 60 ? "amber" : ""}"><span style="width:${clamp(p, 3, 100)}%"></span></div>
          <div class="row" style="margin-top:4px">
            <button class="btn btn-small btn-ghost" data-action="start-topic" data-topic="${esc(row.topicId)}" data-subject="${esc(row.meta.subject)}">Drill this</button>
            <button class="btn btn-small btn-ghost" data-route="${row.meta.subject === "Math" ? `#/learn/topic/${esc(row.topicId)}` : "#/learn"}">Review</button>
          </div>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

function renderProgress() {
  const remoteMap = remoteDailyByDay();
  const today = displayDay(store.todayKey(), remoteMap);
  const goal = store.getGoalSeconds();
  const summary = accountabilitySummary(accountabilityDays(30, remoteMap));
  const streak = summary.streak;
  const weekly = displayWeek(remoteMap);
  const localAttempts = store.getAttempts();
  const allAttempts = mergedAttempts();
  const cardStats = getDeckStats(state.content.flashcards, "all");
  lastAccountabilityStamp = accountabilityStamp();

  return `<div class="view">
    <div class="view-head">
      <div>
        <div class="eyebrow">Progress</div>
        <h1>Proof that the habit is working.</h1>
        <p>Active time only counts while the tab is visible and you have interacted recently. Signed-in history is append-only on the server.</p>
      </div>
      <button class="btn btn-small" data-action="export">Export backup</button>
    </div>

    <div class="grid grid-3">
      <div class="card ring-card">
        ${renderRing(today.seconds, goal, 80)}
        <div class="stat"><span class="stat-value">${Math.round(today.seconds / 60)}</span><span class="stat-label">minutes today</span></div>
      </div>
      <div class="card tight"><div class="stat"><span class="stat-value">${streak}</span><span class="stat-label">day streak</span></div></div>
      <div class="card tight"><div class="stat"><span class="stat-value">${Math.round(weekly.averageSeconds / 60)}</span><span class="stat-label">7-day daily average</span></div></div>
    </div>

    <div id="accountability-panel">${renderAccountabilityCard(remoteMap)}</div>

    <div class="grid grid-2">
      ${renderCalendar(remoteMap)}
      <div class="stack">
        <div class="card">
          <div class="section-head"><h2>Last 7 days</h2><span class="badge ${weekly.compliance >= 70 ? "green" : weekly.compliance >= 40 ? "amber" : "red"}">${weekly.compliance}% goal compliance</span></div>
          ${renderWeeklyChart(weekly.days, goal)}
          <div class="stat-row" style="margin-top:10px">
            <div class="stat"><span class="stat-value">${weekly.goalDays}</span><span class="stat-label">goal days</span></div>
            <div class="stat"><span class="stat-value">${weekly.activeDays}</span><span class="stat-label">active days</span></div>
            <div class="stat"><span class="stat-value">${store.formatDuration(summary.totalSeconds, { compact: true })}</span><span class="stat-label">30-day active</span></div>
          </div>
        </div>
        <div class="card tight">
          <div class="row between"><span class="muted small">Flashcards mastered</span><span class="strong">${cardStats.mastered}/${cardStats.total}</span></div>
          <div class="bar green" style="margin:7px 0 12px"><span style="width:${cardStats.masteryPct}%"></span></div>
          <div class="row between"><span class="muted small">Cards reviewed today</span><span class="strong">${cardStats.reviewedToday}</span></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="section-head"><h2>Projected score trend</h2><span class="tiny muted">Estimates, not official scores</span></div>
      ${renderTrendChart(allAttempts)}
    </div>

    ${renderWeakTopicsCard(6)}

    <div class="card">
      <div class="section-head"><h2>Attempt history on this device</h2><span class="badge">${localAttempts.length} local</span></div>
      ${renderRecentAttempts(10)}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

function renderSettings() {
  const settings = store.getSettings();
  const canInstall = Boolean(state.deferredPrompt);
  lastSyncCardStamp = syncStamp();
  return `<div class="view">
    <div class="view-head">
      <div>
        <div class="eyebrow">Settings</div>
        <h1>Make the trainer fit you.</h1>
        <p>Study content stays local and offline-capable. Signed-in accountability history syncs to the server and cannot be deleted from the app.</p>
      </div>
    </div>

    <div class="card">
      <div class="section-head"><h2>Profile & goals</h2></div>
      <div class="settings-row">
        <div class="grow"><div class="title">Name</div><div class="sub">Used in the home greeting. Optional.</div></div>
        <input class="input" type="text" value="${attrs(settings.name || "")}" placeholder="Your name" data-change="setting" data-key="name" />
      </div>
      <div class="settings-row">
        <div class="grow"><div class="title">Daily active goal</div><div class="sub">Fixed at 30 minutes of visible, recent interaction time.</div></div>
        <span class="badge green">30 min / day</span>
      </div>
      <div class="settings-row">
        <div class="grow"><div class="title">Target score</div><div class="sub">A reminder, not a guarantee. 400-1600.</div></div>
        <input class="input small" type="number" min="400" max="1600" step="10" value="${Number(settings.targetScore) || 1400}" data-change="setting" data-key="targetScore" />
      </div>
      <div class="settings-row">
        <div class="grow"><div class="title">Theme</div><div class="sub">Auto follows your device.</div></div>
        <select class="input" data-change="setting" data-key="theme">
          <option value="auto" ${settings.theme === "auto" ? "selected" : ""}>Auto</option>
          <option value="light" ${settings.theme === "light" ? "selected" : ""}>Light</option>
          <option value="dark" ${settings.theme === "dark" ? "selected" : ""}>Dark</option>
        </select>
      </div>
    </div>

    <div class="card">
      <div class="section-head"><h2>Backup</h2></div>
      <div class="settings-row">
        <div class="grow"><div class="title">Export everything</div><div class="sub">Settings, local activity, attempts, mastery, flashcards, and lesson progress.</div></div>
        <button class="btn" data-action="export">Download JSON</button>
      </div>
      <p class="tiny muted" style="margin-top:10px">Import and reset are disabled in the app. Removing local data does not remove synced server history.</p>
    </div>

    <div class="card" id="sync-card">${renderSyncCardHTML()}</div>

    <div class="card">
      <div class="section-head"><h2>Install as an app</h2></div>
      ${canInstall
        ? `<p class="small muted">Install SAT Sprint on this device for a full-screen, offline-capable experience.</p><button class="btn btn-primary" data-action="install">Install app</button>`
        : `<p class="small muted">On iPhone/iPad: open this page in Safari, tap Share, then “Add to Home Screen.” On desktop Chrome/Edge: use the install icon in the address bar.</p>`}
    </div>

    <div class="card flat">
      <div class="section-head"><h2>About</h2><span class="badge">v0.2</span></div>
      <p class="small muted">SAT Sprint is an independent study tool. It is not affiliated with or endorsed by the College Board. Score estimates are simple linear projections from practice accuracy; they are not official SAT scores. The public app uses original and generated practice content only.</p>
      <p class="small muted">Need the real calculator during practice? The quiz calculator is basic; the actual digital SAT uses Desmos. <a href="https://www.desmos.com/calculator" target="_blank" rel="noopener">Open Desmos</a>.</p>
    </div>
  </div>`;
}


/* ------------------------------------------------------------------ */
/* Live activity + toast                                              */
/* ------------------------------------------------------------------ */

function updateTodayPill() {
  const pill = document.getElementById("today-mini");
  if (!pill) return;
  if (sync.isViewerDevice()) {
    pill.textContent = "Viewer";
    pill.classList.remove("good", "warn");
    return;
  }
  const today = displayDay(store.todayKey());
  const goal = store.getGoalSeconds();
  const minutes = Math.round(today.seconds / 60);
  pill.textContent = `${minutes} min`;
  pill.classList.toggle("good", today.seconds >= goal);
  pill.classList.toggle("warn", today.seconds > 0 && today.seconds < goal);
}

function updateLiveActivity(detail = {}) {
  if (sync.isViewerDevice()) {
    const viewerPill = document.getElementById("today-mini");
    if (viewerPill) {
      viewerPill.textContent = "Viewer";
      viewerPill.classList.remove("good", "warn");
    }
    return;
  }
  const localSeconds = Number(detail.todaySeconds ?? store.getDay().seconds);
  const remoteSeconds = displayDay(store.todayKey()).seconds;
  const todaySeconds = Math.max(localSeconds, remoteSeconds);
  const goalSeconds = Number(detail.goalSeconds ?? store.getGoalSeconds());
  const minutes = Math.round(todaySeconds / 60);
  const percent = goalSeconds ? clamp(Math.round((todaySeconds / goalSeconds) * 100), 0, 100) : 0;

  const pill = document.getElementById("today-mini");
  if (pill) {
    pill.textContent = `${minutes} min`;
    pill.classList.toggle("good", todaySeconds >= goalSeconds);
    pill.classList.toggle("warn", todaySeconds > 0 && todaySeconds < goalSeconds);
  }

  document.querySelectorAll('[data-live-minutes]').forEach((el) => {
    el.textContent = minutes;
  });

  document.querySelectorAll(".ring").forEach((ring) => {
    const live = ring.querySelector("[data-live-minutes]");
    if (!live) return;
    ring.style.setProperty("--p", percent);
    ring.classList.toggle("green", percent >= 100);
    ring.classList.toggle("amber", percent >= 50 && percent < 100);
  });
}

function toast(message, type = "") {
  const root = document.getElementById("toast-root");
  if (!root) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`.trim();
  el.textContent = message;
  root.appendChild(el);
  window.setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    el.style.transition = "opacity .2s, transform .2s";
    window.setTimeout(() => el.remove(), 220);
  }, 2600);
}

/* ------------------------------------------------------------------ */
/* Modals                                                             */
/* ------------------------------------------------------------------ */

function openModal(title, bodyHTML, { actions = "", wide = false } = {}) {
  const root = document.getElementById("modal-root");
  if (!root) return;
  root.innerHTML = `<div class="modal-backdrop" data-action="backdrop-close">
    <div class="modal" ${wide ? 'style="width:min(920px,100%)"' : ""}>
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        <div class="row" style="gap:8px">${actions}<button class="modal-close" data-action="close-modal" aria-label="Close">×</button></div>
      </div>
      <div class="modal-body">${bodyHTML}</div>
    </div>
  </div>`;
  document.body.style.overflow = "hidden";
  const close = root.querySelector(".modal-close");
  if (close) close.focus();
}

function closeModal() {
  const root = document.getElementById("modal-root");
  if (root) root.innerHTML = "";
  document.body.style.overflow = "";
}

function openFormulaSheet(referenceOnly = false) {
  const reference = getReferenceTopic();
  const images = referenceOnly && reference
    ? (reference.blocks || []).filter((b) => b.type === "image")
    : [];
  const formulas = state.content.formulas.filter((f) => !referenceOnly || f.given);
  const groups = FORMULA_DOMAINS.map((domain) => ({
    domain,
    items: formulas.filter((f) => f.domain === domain),
  })).filter((g) => g.items.length);

  const imageHtml = images.length
    ? `<div class="grid grid-2" style="margin-bottom:16px">${images.map((img) => `<figure style="margin:0"><img src="${attrs(img.src)}" alt="${attrs(img.alt || "Reference sheet")}" loading="lazy" style="border:1px solid var(--line);border-radius:10px" />${img.caption ? `<figcaption class="tiny muted">${esc(img.caption)}</figcaption>` : ""}</figure>`).join("")}</div>`
    : "";

  const body = `<div class="print-sheet">
    ${imageHtml}
    ${groups.map((group) => `<section style="margin-bottom:18px">
      <h3 style="margin-bottom:8px">${esc(group.domain)}</h3>
      <div class="grid grid-2">
        ${group.items.map((f) => `<div class="card tight">
          <div class="row between"><span class="strong small">${esc(f.name)}</span>${f.given ? '<span class="badge blue">Given</span>' : ""}</div>
          <div class="eq">${f.html}</div>
          ${f.when ? `<div class="tiny muted">${esc(f.when)}</div>` : ""}
        </div>`).join("")}
      </div>
    </section>`).join("")}
  </div>`;

  openModal(referenceOnly ? "Reference sheet" : "Formula sheet", body, {
    actions: '<button class="btn btn-small" data-action="print">Print</button>',
    wide: true,
  });
}

function evaluateCalc(expression) {
  let s = String(expression || "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/π/g, "Math.PI")
    .replace(/√/g, "Math.sqrt");
  if (!s.trim()) return null;
  if (!/^[0-9+\-*/().\sMathPIsqrt]+$/.test(s)) throw new Error("Unsupported expression");
  const value = Function(`"use strict";return (${s});`)();
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Not a number");
  return Math.round(value * 1e10) / 1e10;
}

function updateCalcDisplay() {
  const display = document.getElementById("calc-display");
  if (!display) return;
  display.textContent = state.calc.result || state.calc.expr || "0";
}

function openCalculator() {
  state.calc = { expr: "", result: "" };
  const keys = [
    ["C", "op"], ["⌫", "op"], ["(", "op"], [")", "op"],
    ["7", ""], ["8", ""], ["9", ""], ["÷", "op"],
    ["4", ""], ["5", ""], ["6", ""], ["×", "op"],
    ["1", ""], ["2", ""], ["3", ""], ["−", "op"],
    ["0", ""], [".", ""], ["±", "op"], ["+", "op"],
    ["√", "op"], ["π", "op"], ["=", "eq wide"],
  ];
  const body = `<div class="calc-display" id="calc-display">0</div>
    <div class="calc-grid">
      ${keys.map(([value, cls]) => `<button class="${cls}" data-action="calc" data-value="${attrs(value)}">${esc(value)}</button>`).join("")}
    </div>
    <p class="tiny muted" style="margin-top:10px">Basic calculator. The real digital SAT provides Desmos.</p>`;
  openModal("Calculator", body);
}

function handleCalc(value) {
  const calc = state.calc;
  const justEvaluated = Boolean(calc.result);
  const isDigit = /^[0-9.]$/.test(value);
  const isOperator = ["+", "−", "×", "÷"].includes(value);

  if (value === "C") {
    calc.expr = "";
    calc.result = "";
  } else if (value === "⌫") {
    if (calc.result) {
      calc.expr = calc.result;
      calc.result = "";
    }
    calc.expr = calc.expr.slice(0, -1);
  } else if (value === "=") {
    try {
      const result = evaluateCalc(calc.expr);
      if (result == null) return;
      calc.result = String(result);
      calc.expr = String(result);
    } catch {
      calc.result = "Error";
      calc.expr = "";
    }
  } else if (value === "±") {
    if (calc.result) {
      calc.result = calc.result.startsWith("-") ? calc.result.slice(1) : `-${calc.result}`;
      calc.expr = calc.result;
    } else {
      calc.expr = calc.expr.startsWith("-") ? calc.expr.slice(1) : `-${calc.expr}`;
    }
  } else {
    if (justEvaluated) {
      if (isDigit || value === "(" || value === "√" || value === "π") {
        calc.expr = "";
      }
      calc.result = "";
    }
    if (value === "π") {
      calc.expr += /[0-9)]$/.test(calc.expr) ? "×π" : "π";
    } else if (value === "√") {
      calc.expr += /[0-9)]$/.test(calc.expr) ? "×√(" : "√(";
    } else if (value === "(") {
      calc.expr += /[0-9)]$/.test(calc.expr) ? "×(" : "(";
    } else {
      calc.expr += value;
    }
  }
  updateCalcDisplay();
}

function openDayDetail(dateKey) {
  const remoteMap = remoteDailyByDay();
  const day = displayDay(dateKey, remoteMap);
  const date = store.dateFromKey(dateKey);
  const activity = store.getActivity();
  const sessions = activity.sessions.filter((s) => s.date === dateKey).slice(0, 20);
  const remoteEvents = (sync.getRemote().events || [])
    .filter((event) => String(event.day || "").slice(0, 10) === dateKey)
    .slice(0, 20);
  const goal = store.getGoalSeconds();
  const status = day.seconds >= goal ? "Goal met" : day.seconds >= 60 ? "Partial day" : "No activity";
  const body = `<div class="stack">
    <div class="row">
      <span class="badge ${day.seconds >= goal ? "green" : day.seconds >= 60 ? "amber" : ""}">${status}</span>
      <span class="badge">${Math.round(day.seconds / 60)} min</span>
      <span class="badge">${day.sessions} session${day.sessions === 1 ? "" : "s"}</span>
    </div>
    <div class="card tight">
      <div class="stat"><span class="stat-value">${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span><span class="stat-label">${status}</span></div>
    </div>
    ${sessions.length ? `<div class="stack" style="gap:6px">
      <div class="tiny muted strong">Local sessions</div>
      <div class="list">
        ${sessions.map((s) => `<div class="list-item">
          <span class="badge blue">${esc(s.label || s.kind || "Study")}</span>
          <span class="grow"><span class="title">${store.formatDuration(s.seconds)}</span><span class="sub">${new Date(s.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span></span>
        </div>`).join("")}
      </div>
    </div>` : ""}
    ${remoteEvents.length ? `<div class="stack" style="gap:6px">
      <div class="tiny muted strong">Synced check-ins</div>
      <div class="list">
        ${remoteEvents.map((s) => `<div class="list-item">
          <span class="badge blue">${esc(s.label || s.kind || "Study")}</span>
          <span class="grow"><span class="title">${store.formatDuration(s.seconds)} · ${esc(s.device_label || "Device")}</span><span class="sub">${esc(store.formatDate(s.ended_at, { withTime: true }))}</span></span>
        </div>`).join("")}
      </div>
    </div>` : ""}
    ${!sessions.length && !remoteEvents.length ? '<p class="muted small">No session details for this day. The total above still counts.</p>' : ""}
  </div>`;
  openModal("Day detail", body);
}

/* ------------------------------------------------------------------ */
/* Data export                                                        */
/* ------------------------------------------------------------------ */

function downloadData() {
  const data = store.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sat-sprint-backup-${store.todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Backup downloaded.", "good");
}

/* ------------------------------------------------------------------ */
/* Actions                                                            */
/* ------------------------------------------------------------------ */

function handleAction(action, data, event) {
  switch (action) {
    case "toggle-theme":
      toggleTheme();
      break;
    case "close-modal":
      closeModal();
      break;
    case "backdrop-close":
      if (event.target.closest('[data-action="backdrop-close"]') === event.target) closeModal();
      break;
    case "start-quiz":
      startQuiz(data.mode);
      break;
    case "start-topic": {
      const meta = getMetaMap().get(String(data.topic));
      startQuiz("topic", {
        topicId: data.topic,
        subject: data.subject,
        title: `${meta?.label || "Topic"} drill`,
      });
      break;
    }
    case "start-flashcards":
      startFlashcards(data.deck || "all");
      break;
    case "start-single-card": {
      const card = getCardById(data.id);
      if (card) startFlashcards([card], { deck: card.deck });
      break;
    }
    case "flip-card": {
      if (!state.flash.active) break;
      state.flash.flipped = !state.flash.flipped;
      const card = document.querySelector(".flashcard");
      if (card) card.classList.toggle("flipped", state.flash.flipped);
      document.querySelectorAll("[data-flash-actions] .btn").forEach((btn) => {
        btn.disabled = !state.flash.flipped;
      });
      break;
    }
    case "grade": {
      if (!state.flash.active || !state.flash.flipped) break;
      const card = state.flash.queue[state.flash.index];
      if (!card) break;
      const grade = data.grade;
      if (!["again", "hard", "good", "easy"].includes(grade)) break;
      gradeCard(card.id, grade);
      state.flash.grades[grade] += 1;
      state.flash.reviewed += 1;
      state.flash.index += 1;
      state.flash.flipped = false;
      render();
      break;
    }
    case "exit-flashcards":
      exitFlashcards();
      break;
    case "exit-quiz":
      exitQuiz();
      break;
    case "discard-quiz":
      discardQuiz();
      break;
    case "select-choice":
      selectChoice(data.index);
      break;
    case "submit-grid":
      submitGrid();
      break;
    case "check-answer":
      checkCurrent();
      break;
    case "next":
      nextQuestion();
      break;
    case "prev":
      prevQuestion();
      break;
    case "jump":
      jumpTo(data.index);
      break;
    case "flag":
      toggleFlag();
      break;
    case "submit-quiz":
      submitQuiz(false);
      break;
    case "open-reference":
      openFormulaSheet(true);
      break;
    case "open-calc":
      openCalculator();
      break;
    case "open-formula-sheet":
      openFormulaSheet(false);
      break;
    case "print":
      window.print();
      break;
    case "calc":
      handleCalc(data.value);
      break;
    case "formula-filter":
      state.formulaFilter = data.domain || "all";
      render();
      break;
    case "review-filter":
      state.resultsFilter[data.attempt] = data.value || "all";
      render();
      break;
    case "day-detail":
      openDayDetail(data.date);
      break;
    case "cal-prev":
      state.progressMonth = new Date(state.progressMonth.getFullYear(), state.progressMonth.getMonth() - 1, 1);
      render();
      break;
    case "cal-next":
      state.progressMonth = new Date(state.progressMonth.getFullYear(), state.progressMonth.getMonth() + 1, 1);
      render();
      break;
    case "export":
      downloadData();
      break;
    case "sync-now":
      toast("Syncing…", "");
      sync.syncNow()
        .then((status) => {
          refreshSyncCard(true);
          refreshAccountability(true);
          if (status.error) toast(status.error, "bad");
          else toast("Sync complete.", "good");
        })
        .catch((err) => toast(err?.message || "Sync failed.", "bad"));
      break;
    case "sync-signout":
      if (!window.confirm("Sign out of sync on this device? Local history stays.")) break;
      sync.signOut()
        .then(() => {
          refreshSyncCard(true);
          refreshAccountability(true);
          toast("Signed out.", "good");
        })
        .catch((err) => toast(err?.message || "Could not sign out.", "bad"));
      break;
    case "remote-attempt":
      openRemoteAttempt(data.id);
      break;
    case "start-again": {
      const attempt = store.getAttempt(data.attempt);
      if (!attempt) break;
      if (attempt.mode === "topic") {
        const first = (attempt.questions || []).find((q) => q.subject);
        startQuiz("topic", {
          topicId: first?.topicId ?? null,
          subject: first?.subject ?? null,
          title: attempt.title,
        });
      } else {
        startQuiz(attempt.mode);
      }
      break;
    }
    case "toggle-read": {
      const key = data.key;
      if (!key) break;
      const read = store.isLessonRead(key);
      store.markLessonRead(key, !read);
      toast(!read ? "Marked studied." : "Marked unread.", "good");
      render();
      break;
    }
    case "install": {
      if (!state.deferredPrompt) {
        toast("Use your browser's Add to Home Screen option.", "");
        break;
      }
      state.deferredPrompt.prompt();
      state.deferredPrompt = null;
      break;
    }
    default:
      console.warn("Unknown action", action);
  }
}

/* ------------------------------------------------------------------ */
/* Event handlers                                                     */
/* ------------------------------------------------------------------ */

function handleClick(event) {
  const routeEl = event.target.closest("[data-route]");
  if (routeEl && !routeEl.disabled) {
    event.preventDefault();
    navigate(routeEl.dataset.route);
    return;
  }
  const actionEl = event.target.closest("[data-action]");
  if (actionEl && !actionEl.disabled) {
    event.preventDefault();
    handleAction(actionEl.dataset.action, actionEl.dataset, event);
  }
}

function handleInput(event) {
  const target = event.target.closest("[data-input]");
  if (!target) return;
  if (target.dataset.input === "formula-search") {
    state.formulaSearch = target.value;
    const list = filterFormulas();
    const grid = document.getElementById("formula-grid");
    if (grid) grid.innerHTML = renderFormulaGridHTML(list);
    const count = document.getElementById("formula-count");
    if (count) count.textContent = `${list.length} formula${list.length === 1 ? "" : "s"} shown`;
  } else if (target.dataset.input === "cards-search") {
    state.cardsSearch = target.value;
    const list = document.getElementById("cards-browse-list");
    if (list) list.innerHTML = renderCardsBrowseHTML();
  } else if (target.dataset.input === "grid-answer") {
    const q = currentQuestion();
    if (q && state.quiz) {
      state.quizResponses[q.id] = target.value;
      saveQuizDraft();
    }
  }
}

function handleChange(event) {
  const target = event.target.closest("[data-change]");
  if (!target) return;
  if (target.dataset.change === "setting") {
    const key = target.dataset.key;
    let value = target.value;
    if (key === "targetScore") value = clamp(Number(value) || 1400, 400, 1600);
    if (key === "name") value = String(value || "").trim().slice(0, 40);
    store.saveSettings({ [key]: value });
    if (["targetScore", "name"].includes(key)) target.value = value;
    if (key === "theme") applyTheme();
    updateTodayPill();
    toast("Saved.", "good");
  } else if (target.dataset.change === "device-label") {
    sync.setDeviceLabel(target.value);
    toast("Device label saved.", "good");
  } else if (target.dataset.change === "viewer-device") {
    const viewer = Boolean(target.checked);
    sync.setViewerDevice(viewer);
    updateTodayPill();
    const reload = window.confirm(
      viewer
        ? "Reload now for viewer mode? This device will stop recording activity and attempts."
        : "Reload now to resume recording activity and attempts on this device?"
    );
    if (reload) location.reload();
    else toast("Viewer setting saved. Reload to apply.", "good");
  }
}

async function handleSubmit(event) {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  if (form.dataset.form === "sync-signin") {
    await handleSyncSignIn(form);
  }
}

function handleKeydown(event) {
  if (event.key === "Escape") {
    closeModal();
    return;
  }

  const flashcard = event.target.closest?.(".flashcard");
  if (flashcard && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    handleAction("flip-card", {}, event);
    return;
  }

  if (getRoute().name !== "quiz" || !state.quiz) return;
  const tag = event.target.tagName;
  const isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

  if (isTyping) {
    if (event.key === "Enter" && event.target.matches('[data-input="grid-answer"]')) {
      event.preventDefault();
      if (state.quiz.feedback) submitGrid();
      else nextQuestion();
    }
    return;
  }

  const key = event.key.toLowerCase();
  if (key === "arrowleft") {
    event.preventDefault();
    prevQuestion();
  } else if (key === "arrowright") {
    event.preventDefault();
    nextQuestion();
  } else if (key === "enter") {
    event.preventDefault();
    const q = currentQuestion();
    if (state.quiz.feedback && q && !state.quizLocked[q.id]) checkCurrent();
    else nextQuestion();
  } else if (key === "f") {
    event.preventDefault();
    toggleFlag();
  } else if (["a", "b", "c", "d"].includes(key) || ["1", "2", "3", "4"].includes(key)) {
    const q = currentQuestion();
    if (!q || q.type !== "mcq") return;
    const index = ["a", "b", "c", "d"].includes(key) ? ["a", "b", "c", "d"].indexOf(key) : Number(key) - 1;
    event.preventDefault();
    selectChoice(index);
  }
}

/* ------------------------------------------------------------------ */
/* Init                                                               */
/* ------------------------------------------------------------------ */

async function init() {
  applyTheme();
  sync.initSync().catch((err) => console.warn("Sync init failed", err));
  window.addEventListener("sats:session", (event) => {
    const session = event.detail?.session;
    if (session) sync.enqueueActivity(session);
  });
  if (!sync.isViewerDevice()) initActivity();
  await loadContent();

  if (!location.hash) {
    history.replaceState(null, "", "#/home");
  }

  document.addEventListener("click", handleClick);
  document.addEventListener("input", handleInput);
  document.addEventListener("change", handleChange);
  document.addEventListener("submit", handleSubmit);
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("hashchange", render);
  window.addEventListener("sats:activity", (event) => updateLiveActivity(event.detail || {}));
  window.addEventListener("sats:sync", () => {
    updateTodayPill();
    if (getRoute().name === "settings") refreshSyncCard();
    if (getRoute().name === "progress") refreshAccountability();
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredPrompt = event;
    if (getRoute().name === "settings") render();
  });
  window.addEventListener("appinstalled", () => {
    state.deferredPrompt = null;
    toast("App installed.", "good");
  });
  window.addEventListener("pagehide", () => {
    if (state.quiz) saveQuizDraft();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.quiz) {
      state.quizLastTick = Date.now();
    }
  });

  const themeButton = document.getElementById("theme-btn");
  if (themeButton) themeButton.addEventListener("click", toggleTheme);

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (err) {
      console.warn("Service worker registration failed", err);
    }
  }

  render();
}

init();





