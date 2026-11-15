import { getCards, saveCardState, todayKey } from "./store.js";

const DAY_MS = 86400000;
const AGAIN_MS = 60000;
const MIN_EASE = 1.3;
const MAX_EASE = 3.1;

export const GRADE_LABELS = {
  again: "Again",
  hard: "Hard",
  good: "Good",
  easy: "Easy",
};

function clampEase(ease) {
  return Math.min(MAX_EASE, Math.max(MIN_EASE, ease));
}

export function getState(cardId) {
  return getCards()[cardId] || null;
}

export function isDue(cardId, now = Date.now()) {
  const state = getState(cardId);
  if (!state) return true;
  return (Number(state.due) || 0) <= now;
}

export function gradeCard(cardId, grade) {
  const now = Date.now();
  const prev = getState(cardId) || {
    ease: 2.5,
    interval: 0,
    due: 0,
    reps: 0,
    lapses: 0,
    lastGrade: null,
    lastReviewed: null,
    createdAt: new Date(now).toISOString(),
  };

  let ease = Number(prev.ease) || 2.5;
  let interval = Number(prev.interval) || 0;
  let reps = Number(prev.reps) || 0;
  let lapses = Number(prev.lapses) || 0;

  if (grade === "again") {
    ease = clampEase(ease - 0.2);
    interval = 0;
    lapses += 1;
    reps = 0;
  } else if (grade === "hard") {
    ease = clampEase(ease - 0.15);
    interval = interval < 1 ? 1 : Math.max(1, Math.round(interval * 1.2));
    reps += 1;
  } else if (grade === "good") {
    if (interval < 1) interval = 1;
    else interval = Math.max(1, Math.round(interval * ease));
    reps += 1;
  } else if (grade === "easy") {
    ease = clampEase(ease + 0.15);
    if (interval < 1) interval = 4;
    else interval = Math.max(4, Math.round(interval * ease * 1.3));
    reps += 1;
  } else {
    throw new Error(`Unknown grade: ${grade}`);
  }

  const due = grade === "again" ? now + AGAIN_MS : now + interval * DAY_MS;

  const next = {
    ...prev,
    ease: Number(ease.toFixed(2)),
    interval,
    due,
    reps,
    lapses,
    lastGrade: grade,
    lastReviewed: new Date(now).toISOString(),
    lastReviewedDay: todayKey(new Date(now)),
  };

  saveCardState(cardId, next);
  return next;
}

export function getDeckCards(cards, deck = "all") {
  if (!deck || deck === "all") return cards;
  return cards.filter((c) => c.deck === deck);
}

export function getDeckNames(cards) {
  const seen = new Map();
  for (const card of cards) {
    if (!seen.has(card.deck)) seen.set(card.deck, 0);
    seen.set(card.deck, seen.get(card.deck) + 1);
  }
  return [...seen.entries()].map(([name, count]) => ({ name, count }));
}

export function buildReviewQueue(cards, { deck = "all", limit = 20 } = {}) {
  const now = Date.now();
  const states = getCards();
  const pool = getDeckCards(cards, deck);
  const due = [];
  const fresh = [];

  for (const card of pool) {
    const state = states[card.id];
    if (!state) {
      fresh.push(card);
    } else if ((Number(state.due) || 0) <= now) {
      due.push({ card, state });
    }
  }

  due.sort((a, b) => (Number(a.state.due) || 0) - (Number(b.state.due) || 0));
  fresh.sort(() => Math.random() - 0.5);

  const queue = [];
  const dueTake = Math.min(due.length, Math.max(0, limit));
  for (let i = 0; i < dueTake; i++) queue.push(due[i].card);

  const remaining = Math.max(0, limit - queue.length);
  for (let i = 0; i < Math.min(fresh.length, remaining); i++) queue.push(fresh[i]);

  if (!queue.length && pool.length) {
    const soonest = pool
      .map((card) => ({ card, state: states[card.id] }))
      .filter((row) => row.state)
      .sort((a, b) => (Number(a.state.due) || 0) - (Number(b.state.due) || 0));
    if (soonest.length) queue.push(soonest[0].card);
  }

  return queue;
}

export function getDeckStats(cards, deck = "all") {
  const pool = getDeckCards(cards, deck);
  const states = getCards();
  const now = Date.now();
  let due = 0;
  let fresh = 0;
  let mastered = 0;
  let reviewedToday = 0;
  const today = todayKey();

  for (const card of pool) {
    const state = states[card.id];
    if (!state) {
      fresh += 1;
      continue;
    }
    if ((Number(state.due) || 0) <= now) due += 1;
    if ((Number(state.reps) || 0) >= 3) mastered += 1;
    if (state.lastReviewedDay === today) reviewedToday += 1;
  }

  return {
    total: pool.length,
    due,
    fresh,
    mastered,
    reviewedToday,
    masteryPct: pool.length ? Math.round((mastered / pool.length) * 100) : 0,
  };
}
