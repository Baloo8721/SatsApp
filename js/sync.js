import { getActivity, getAttempts, todayKey } from "./store.js";

const KEYS = {
  deviceId: "sats.sync.deviceId",
  deviceLabel: "sats.sync.deviceLabel",
  viewer: "sats.sync.viewer",
  activityOutbox: "sats.sync.activityOutbox",
  attemptOutbox: "sats.sync.attemptOutbox",
  lastSync: "sats.sync.lastSync",
  remote: "sats.sync.remote",
  backfilled: "sats.sync.backfilled",
};

const state = {
  initialized: false,
  configured: false,
  client: null,
  session: null,
  deviceId: "",
  deviceLabel: "",
  viewer: false,
  syncing: false,
  pulling: false,
  lastSync: null,
  error: "",
  errorSource: "",
  remote: emptyRemote(),
};

let flushTimer = 0;
let pullSeq = 0;

function emptyRemote() {
  return { daily: [], events: [], attempts: [], fetchedAt: null };
}

function readString(key, fallback = "") {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeString(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function readArray(key) {
  const value = readJson(key, []);
  return Array.isArray(value) ? value : [];
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.random() * 16 | 0;
    const v = ch === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function defaultDeviceLabel() {
  return window.matchMedia?.("(pointer: coarse)")?.matches ? "Phone" : "Computer";
}

function getDeviceId() {
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let id = readString(KEYS.deviceId, "");
  if (!valid.test(id)) {
    id = uuid();
    writeString(KEYS.deviceId, id);
  }
  return id;
}

function getDeviceLabel() {
  const label = readString(KEYS.deviceLabel, "").trim();
  return label || defaultDeviceLabel();
}

function setDeviceLabel(label) {
  const clean = String(label || "").trim().slice(0, 40);
  writeString(KEYS.deviceLabel, clean);
  state.deviceLabel = clean || defaultDeviceLabel();
  emit();
}

function isViewerDevice() {
  return readString(KEYS.viewer, "0") === "1";
}

function setViewerDevice(value) {
  writeString(KEYS.viewer, value ? "1" : "0");
  state.viewer = Boolean(value);
  emit();
}

function getLastSync() {
  return state.lastSync || readString(KEYS.lastSync, "") || null;
}

function getEmail() {
  return state.session?.user?.email || "";
}

function isConfigured() {
  return state.configured;
}

function isSignedIn() {
  return Boolean(state.session?.user);
}

function getRemote() {
  return state.remote;
}

function getStatus() {
  const activity = readArray(KEYS.activityOutbox);
  const attempts = readArray(KEYS.attemptOutbox);
  return {
    configured: state.configured,
    signedIn: isSignedIn(),
    email: getEmail(),
    deviceId: getDeviceId(),
    deviceLabel: getDeviceLabel(),
    viewer: isViewerDevice(),
    syncing: state.syncing,
    online: navigator.onLine,
    lastSync: getLastSync(),
    error: state.error,
    pending: activity.length + attempts.length,
    pendingActivity: activity.length,
    pendingAttempts: attempts.length,
    remoteFetchedAt: state.remote.fetchedAt,
  };
}

function setSyncError(source, err) {
  state.error = err?.message || String(err);
  state.errorSource = source;
}

function clearSyncError(source) {
  if (state.errorSource === source) {
    state.error = "";
    state.errorSource = "";
  }
}

function emit() {
  window.dispatchEvent(new CustomEvent("sats:sync", { detail: getStatus() }));
}

function scheduleFlush(delay = 1500) {
  if (flushTimer) window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => {
    flushTimer = 0;
    flush();
  }, delay);
}

function buildAttemptPayload(attempt) {
  const topics = new Map();
  for (const q of attempt.questions || []) {
    const key = String(q.topicId ?? q.topic ?? "unknown");
    const row = topics.get(key) || {
      key,
      label: q.topic || q.domain || "Question",
      subject: q.subject || "",
      total: 0,
      correct: 0,
    };
    row.total += 1;
    if (q.correct) row.correct += 1;
    topics.set(key, row);
  }
  const { questions, ...summary } = attempt;
  return {
    ...summary,
    topicBreakdown: [...topics.values()],
    device_label: state.deviceLabel,
  };
}

function enqueueActivity(session, { silent = false } = {}) {
  if (isViewerDevice()) return false;
  const seconds = Math.round(Number(session?.seconds) || 0);
  if (seconds < 1) return false;
  const ended = session.endedAt || session.at || new Date().toISOString();
  const endedMs = new Date(ended).getTime();
  const started = session.startedAt || new Date(endedMs - seconds * 1000).toISOString();
  const id = String(session.id || uuid());
  const outbox = readArray(KEYS.activityOutbox);
  if (outbox.some((item) => item.id === id)) return false;
  outbox.push({
    id,
    device_id: state.deviceId,
    device_label: state.deviceLabel,
    day: session.day || session.date || todayKey(new Date(ended)),
    seconds,
    started_at: started,
    ended_at: ended,
    kind: session.kind || "study",
    label: session.label || "Study",
  });
  writeJson(KEYS.activityOutbox, outbox.slice(-5000));
  if (!silent) scheduleFlush();
  emit();
  return true;
}

function enqueueAttempt(attempt, { silent = false } = {}) {
  if (isViewerDevice() || !attempt?.id) return false;
  const outbox = readArray(KEYS.attemptOutbox);
  if (outbox.some((item) => item.id === attempt.id)) return false;
  const toNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  outbox.push({
    id: String(attempt.id),
    device_id: state.deviceId,
    device_label: state.deviceLabel,
    mode: attempt.mode || "quick",
    title: attempt.title || attempt.mode || "Practice",
    subject: attempt.subject || "",
    completed_at: attempt.completedAt || new Date().toISOString(),
    elapsed_seconds: Math.round(Number(attempt.elapsedSeconds) || 0),
    correct: Math.max(0, Math.round(Number(attempt.correct) || 0)),
    total: Math.max(0, Math.round(Number(attempt.total) || 0)),
    percentage: toNumber(attempt.percentage),
    projected: toNumber(attempt.projected),
    math_scaled: toNumber(attempt.math?.scaled),
    rw_scaled: toNumber(attempt.rw?.scaled),
    payload: buildAttemptPayload(attempt),
  });
  writeJson(KEYS.attemptOutbox, outbox.slice(-500));
  if (!silent) scheduleFlush();
  emit();
  return true;
}

function backfillLocalData() {
  if (isViewerDevice() || readString(KEYS.backfilled, "0") === "1") return;
  const activity = getActivity();
  for (const session of activity.sessions || []) {
    enqueueActivity(session, { silent: true });
  }
  for (const attempt of getAttempts()) {
    enqueueAttempt(attempt, { silent: true });
  }
  writeString(KEYS.backfilled, "1");
  scheduleFlush(300);
}

async function flush() {
  if (!state.client || !state.session || isViewerDevice() || state.syncing || !navigator.onLine) {
    emit();
    return;
  }

  let activity = readArray(KEYS.activityOutbox);
  let attempts = readArray(KEYS.attemptOutbox);
  if (!activity.length && !attempts.length) return;

  state.syncing = true;
  clearSyncError("flush");
  emit();
  let sent = 0;

  try {
    while (activity.length) {
      const batch = activity.slice(0, 200);
      const { error } = await state.client.rpc("record_activity_events", { p_events: batch });
      if (error) throw error;
      const ids = new Set(batch.map((item) => item.id));
      activity = activity.filter((item) => !ids.has(item.id));
      writeJson(KEYS.activityOutbox, activity);
      sent += batch.length;
      if (batch.length < 200) break;
    }

    while (attempts.length) {
      const batch = attempts.slice(0, 100);
      const { error } = await state.client.rpc("record_quiz_attempts", { p_attempts: batch });
      if (error) throw error;
      const ids = new Set(batch.map((item) => item.id));
      attempts = attempts.filter((item) => !ids.has(item.id));
      writeJson(KEYS.attemptOutbox, attempts);
      sent += batch.length;
      if (batch.length < 100) break;
    }

    if (sent > 0) {
      state.lastSync = new Date().toISOString();
      writeString(KEYS.lastSync, state.lastSync);
    }
  } catch (err) {
    setSyncError("flush", err);
  } finally {
    state.syncing = false;
    emit();
  }
}

async function pullRemote() {
  if (!state.client || !state.session || !navigator.onLine) {
    emit();
    return state.remote;
  }
  if (state.pulling) return state.remote;

  const seq = ++pullSeq;
  state.pulling = true;
  const since = new Date();
  since.setDate(since.getDate() - 59);
  const sinceKey = todayKey(since);
  clearSyncError("pull");

  try {
    const [daily, events, attempts] = await Promise.all([
      state.client
        .from("daily_activity")
        .select("device_id,device_label,day,active_seconds,sessions,last_seen_at")
        .gte("day", sinceKey)
        .order("day", { ascending: false }),
      state.client
        .from("activity_events")
        .select("id,device_id,device_label,day,seconds,started_at,ended_at,kind,label")
        .order("ended_at", { ascending: false })
        .limit(50),
      state.client
        .from("quiz_attempts")
        .select("id,device_id,device_label,mode,title,subject,completed_at,elapsed_seconds,correct,total,percentage,projected,math_scaled,rw_scaled,payload")
        .order("completed_at", { ascending: false })
        .limit(50),
    ]);

    for (const response of [daily, events, attempts]) {
      if (response.error) throw response.error;
    }

    if (seq !== pullSeq || !state.session) return state.remote;

    state.remote = {
      daily: daily.data || [],
      events: events.data || [],
      attempts: attempts.data || [],
      fetchedAt: new Date().toISOString(),
    };
    state.lastSync = state.remote.fetchedAt;
    writeString(KEYS.lastSync, state.lastSync);
    writeJson(KEYS.remote, state.remote);
  } catch (err) {
    if (seq === pullSeq) setSyncError("pull", err);
  } finally {
    if (seq === pullSeq) {
      state.pulling = false;
      emit();
    }
  }

  return state.remote;
}

async function signIn(email, password) {
  if (!state.client) throw new Error("Sync is not configured yet.");
  clearSyncError("auth");
  clearSyncError("flush");
  clearSyncError("pull");
  const { data, error } = await state.client.auth.signInWithPassword({
    email: String(email || "").trim(),
    password: String(password || ""),
  });
  if (error) {
    setSyncError("auth", error);
    emit();
    throw error;
  }
  state.session = data.session;
  backfillLocalData();
  await flush();
  await pullRemote();
  emit();
  return data;
}

async function signOut() {
  if (state.client) {
    try {
      await state.client.auth.signOut({ scope: "local" });
    } catch {
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("sb-") && key.endsWith("-auth-token")) localStorage.removeItem(key);
        }
      } catch {}
    }
  }
  pullSeq += 1;
  state.pulling = false;
  state.session = null;
  state.remote = emptyRemote();
  state.error = "";
  state.errorSource = "";
  writeJson(KEYS.remote, state.remote);
  emit();
}

async function syncNow() {
  await flush();
  await pullRemote();
  return getStatus();
}

async function initSync() {
  if (state.initialized) return getStatus();
  state.initialized = true;
  state.deviceId = getDeviceId();
  state.deviceLabel = getDeviceLabel();
  state.viewer = isViewerDevice();
  state.lastSync = readString(KEYS.lastSync, "") || null;
  state.remote = readJson(KEYS.remote, emptyRemote());

  const config = window.SAT_CONFIG || {};
  const canCreate = Boolean(config.supabaseUrl && config.supabaseAnonKey && window.supabase?.createClient);
  state.configured = canCreate;

  if (canCreate) {
    try {
      state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
      const { data } = await state.client.auth.getSession();
      state.session = data.session || null;
      if (!state.session) {
        state.remote = emptyRemote();
        writeJson(KEYS.remote, state.remote);
      }
      state.client.auth.onAuthStateChange((event, session) => {
        state.session = session;
        if (session) {
          pullSeq += 1;
          state.pulling = false;
          window.setTimeout(() => {
            backfillLocalData();
            flush();
            pullRemote();
          }, 0);
        } else {
          pullSeq += 1;
          state.pulling = false;
          state.remote = emptyRemote();
          writeJson(KEYS.remote, state.remote);
          emit();
        }
      });
      if (state.session) {
        backfillLocalData();
        window.setTimeout(() => {
          flush();
          pullRemote();
        }, 0);
      }
    } catch (err) {
      state.configured = false;
      setSyncError("init", err);
    }
  }

  window.addEventListener("online", () => {
    emit();
    flush();
    pullRemote();
  });
  window.addEventListener("offline", emit);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      flush();
      pullRemote();
    }
  });
  window.setInterval(() => {
    if (navigator.onLine) {
      flush();
      pullRemote();
    }
  }, 60000);

  emit();
  return getStatus();
}

export {
  initSync,
  signIn,
  signOut,
  syncNow,
  pullRemote,
  enqueueActivity,
  enqueueAttempt,
  getRemote,
  getStatus,
  getLastSync,
  getDeviceLabel,
  setDeviceLabel,
  isConfigured,
  isSignedIn,
  isViewerDevice,
  setViewerDevice,
};
