import { addActiveSeconds, recordSession, getDay, getGoalSeconds, todayKey } from "./store.js";

const TICK_MS = 15000;
const ACTIVE_WINDOW_MS = 90000;
const SESSION_GAP_MS = 120000;
const MAX_SESSION_SECONDS = 30 * 60;

let initialized = false;
let timer = null;
let lastInteraction = 0;
let lastTick = 0;
let lastActiveTick = 0;
let sessionStart = null;
let sessionContext = { kind: "study", label: "Study" };

function isVisible() {
  return document.visibilityState === "visible";
}

function isActive(now = Date.now()) {
  return isVisible() && now - lastInteraction <= ACTIVE_WINDOW_MS;
}

function dispatch() {
  const active = isActive();
  const today = getDay();
  const goal = getGoalSeconds();
  window.dispatchEvent(
    new CustomEvent("sats:activity", {
      detail: {
        active,
        todaySeconds: today.seconds,
        goalSeconds: goal,
        sessionSeconds: sessionStart && lastActiveTick ? Math.max(0, (lastActiveTick - sessionStart) / 1000) : 0,
      },
    })
  );
}

function beginSession(now = Date.now()) {
  if (sessionStart) return;
  sessionStart = now;
  lastActiveTick = now;
  lastTick = now;
}

function flushSession(now = Date.now()) {
  if (!sessionStart) return null;
  const end = Math.max(sessionStart, lastActiveTick || sessionStart);
  const seconds = (end - sessionStart) / 1000;
  const sessions = [];
  if (seconds >= 5) {
    const start = new Date(sessionStart);
    const finish = new Date(end);
    const startKey = todayKey(start);
    const endKey = todayKey(finish);
    if (startKey === endKey) {
      const session = recordSession({
        seconds,
        kind: sessionContext.kind,
        label: sessionContext.label,
        startedAt: start.toISOString(),
        at: finish.toISOString(),
        day: startKey,
      });
      if (session) sessions.push(session);
    } else {
      const midnight = new Date(finish.getFullYear(), finish.getMonth(), finish.getDate()).getTime();
      const firstSeconds = (midnight - sessionStart) / 1000;
      const secondSeconds = (end - midnight) / 1000;
      const first = firstSeconds >= 5
        ? recordSession({
            seconds: firstSeconds,
            kind: sessionContext.kind,
            label: sessionContext.label,
            startedAt: start.toISOString(),
            at: new Date(midnight).toISOString(),
            day: startKey,
          })
        : null;
      const second = secondSeconds >= 5
        ? recordSession({
            seconds: secondSeconds,
            kind: sessionContext.kind,
            label: sessionContext.label,
            startedAt: new Date(midnight).toISOString(),
            at: finish.toISOString(),
            day: endKey,
          })
        : null;
      if (first) sessions.push(first);
      if (second) sessions.push(second);
    }
  }
  sessionStart = null;
  lastActiveTick = 0;
  for (const session of sessions) {
    window.dispatchEvent(new CustomEvent("sats:session", { detail: { session } }));
  }
  return sessions[sessions.length - 1] || null;
}

function tick() {
  const now = Date.now();
  if (isActive(now)) {
    if (!sessionStart) beginSession(now);
    if (now - sessionStart > SESSION_GAP_MS * 3 && now - lastActiveTick > SESSION_GAP_MS) {
      flushSession(now);
      beginSession(now);
    }
    const elapsed = Math.min(TICK_MS / 1000, Math.max(0, (now - lastTick) / 1000));
    if (elapsed > 0) {
      addActiveSeconds(elapsed);
      lastTick = now;
      lastActiveTick = now;
    }
    if ((lastActiveTick - sessionStart) / 1000 >= MAX_SESSION_SECONDS) {
      flushSession(now);
      beginSession(now);
    }
  } else {
    if (sessionStart) flushSession(now);
    lastTick = now;
  }
  dispatch();
}

function onInteraction() {
  lastInteraction = Date.now();
  if (isVisible() && !sessionStart) beginSession(lastInteraction);
}

function onVisibility() {
  if (document.visibilityState === "hidden") {
    flushSession();
    dispatch();
  } else {
    lastInteraction = Date.now();
    lastTick = Date.now();
    if (isActive()) beginSession();
  }
}

function onPageHide() {
  tick();
  flushSession();
}

export function initActivity() {
  if (initialized) return;
  initialized = true;

  const now = Date.now();
  lastInteraction = now;
  lastTick = now - TICK_MS;
  lastActiveTick = now;

  for (const evt of ["pointerdown", "keydown", "touchstart"]) {
    document.addEventListener(evt, onInteraction, { passive: true });
  }
  let scrollTimer = 0;
  document.addEventListener(
    "scroll",
    () => {
      const now = Date.now();
      if (now - scrollTimer > 1000) {
        scrollTimer = now;
        onInteraction();
      }
    },
    { passive: true }
  );

  let moveTimer = 0;
  document.addEventListener(
    "pointermove",
    () => {
      const now = Date.now();
      if (now - moveTimer > 4000) {
        moveTimer = now;
        onInteraction();
      }
    },
    { passive: true }
  );

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      lastTick = Date.now();
    }
  });

  timer = window.setInterval(tick, TICK_MS);
  dispatch();
}

export function setActivityContext(kind, label) {
  sessionContext = { kind, label };
}

export function getSessionSeconds() {
  if (!sessionStart || !lastActiveTick) return 0;
  return Math.max(0, (lastActiveTick - sessionStart) / 1000);
}

export function getActivityStatus() {
  const today = getDay();
  return {
    active: isActive(),
    todaySeconds: today.seconds,
    goalSeconds: getGoalSeconds(),
    sessionSeconds: getSessionSeconds(),
  };
}

export function stopActivity() {
  if (timer) window.clearInterval(timer);
  timer = null;
  flushSession();
  initialized = false;
}
