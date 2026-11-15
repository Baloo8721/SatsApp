// Procedural SAT-style math question generators.
// Every generated question is self-contained and safe to store in an attempt.

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const uniq = (arr) => [...new Set(arr.map(String))];
const fmt = (n) => {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
};
const sign = (n) => (n >= 0 ? `+ ${n}` : `− ${Math.abs(n)}`);
const line = (m, b) => {
  const mPart = m === 1 ? "x" : m === -1 ? "−x" : `${m}x`;
  return `y = ${mPart} ${sign(b)}`;
};
const circle = (h, k) => {
  const x = h === 0 ? "x<sup>2</sup>" : `(x ${h > 0 ? "−" : "+"} ${Math.abs(h)})<sup>2</sup>`;
  const y = k === 0 ? "y<sup>2</sup>" : `(y ${k > 0 ? "−" : "+"} ${Math.abs(k)})<sup>2</sup>`;
  return `${x} + ${y}`;
};
const uid = () => `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const math = (s) => `<span class="math">${s}</span>`;

function mcq({ topicId, topic, domain, difficulty, prompt, correct, distractors, explanation, formulaIds = [] }) {
  const correctStr = String(correct);
  const pool = uniq([correctStr, ...distractors.map(String)]).filter((x) => x !== correctStr);
  while (pool.length < 3) {
    const n = Number.isFinite(Number(correctStr)) ? Number(correctStr) : 0;
    const candidate = String(n + pool.length + 1);
    if (candidate !== correctStr && !pool.includes(candidate)) pool.push(candidate);
    else pool.push(`${candidate} `);
  }
  const choices = shuffle([correctStr, ...pool.slice(0, 3)]);
  return {
    id: uid(), subject: "Math", topicId, topic, domain, difficulty,
    type: "mcq", prompt, choices, answer: choices.indexOf(correctStr),
    answerText: correctStr, explanation, formulaIds,
  };
}

function numeric({ topicId, topic, domain, difficulty, prompt, answer, explanation, formulaIds = [] }) {
  return {
    id: uid(), subject: "Math", topicId, topic, domain, difficulty,
    type: "numeric", prompt, choices: null, answer: String(answer),
    answerText: String(answer), explanation, formulaIds,
  };
}

const T = {
  1: { topic: "Solving Basic Equations", domain: "Algebra" },
  2: { topic: "Word Problems → Equations", domain: "Algebra" },
  3: { topic: "Percent & Ratios", domain: "Algebra" },
  4: { topic: "Solving for One Variable in a Formula", domain: "Algebra" },
  5: { topic: "Systems of Equations", domain: "Algebra" },
  6: { topic: "Systems of Inequalities", domain: "Algebra" },
  7: { topic: "Linear Functions & Graphs", domain: "Algebra" },
  8: { topic: "Quadratics & Parabolas", domain: "Advanced Math" },
  9: { topic: "Exponential Growth & Decay", domain: "Advanced Math" },
  10: { topic: "Exponents & Radicals", domain: "Advanced Math" },
  11: { topic: "Absolute Value Equations", domain: "Advanced Math" },
  12: { topic: "Special Right Triangles", domain: "Geometry & Trig" },
  13: { topic: "Right Triangle Trig", domain: "Geometry & Trig" },
  14: { topic: "Similar Triangles", domain: "Geometry & Trig" },
  15: { topic: "Circles in the Coordinate Plane", domain: "Geometry & Trig" },
  16: { topic: "Volume", domain: "Geometry & Trig" },
  17: { topic: "Surface Area", domain: "Geometry & Trig" },
  18: { topic: "Parallel Lines & Angles", domain: "Geometry & Trig" },
  19: { topic: "Mean, Median, Mode & Range", domain: "Data & Statistics" },
  20: { topic: "Probability & Two-Way Tables", domain: "Data & Statistics" },
  21: { topic: "Margin of Error", domain: "Data & Statistics" },
  22: { topic: "Unit Conversions", domain: "Data & Statistics" },
  23: { topic: "Reading Bar Graphs", domain: "Data & Statistics" },
  24: { topic: "Scatterplots & Line of Best Fit", domain: "Data & Statistics" },
};

function base(topicId, difficulty = 2) {
  return { topicId, ...T[topicId], difficulty };
}

const GENERATORS = {
  1(d) {
    const b = base(1, d);
    const a = rand(2, 9);
    const x = rand(-8, 8);
    const c = a * x + rand(-12, 12);
    const b2 = c - a * x;
    return mcq({
      ...b,
      prompt: `<p>Solve for x:</p><p class="math">${a}x ${sign(b2)} = ${c}</p>`,
      correct: x,
      distractors: [x + rand(1, 4), x - rand(1, 4), -x, Math.round((c + b2) / a)],
      explanation: `<p>Subtract ${b2} from both sides, then divide by ${a}: x = ${x}.</p>`,
      formulaIds: ["slope-intercept"],
    });
  },
  2(d) {
    const b = base(2, d);
    const fee = rand(10, 45);
    const rate = rand(5, 18);
    const hours = rand(2, 7);
    const total = fee + rate * hours;
    if (Math.random() < 0.5) {
      return mcq({
        ...b,
        prompt: `<p>A rental company charges a $${fee} service fee plus $${rate} per hour. A customer rents for ${hours} hours. What is the total cost?</p>`,
        correct: `$${total}`,
        distractors: [`$${fee * hours + rate}`, `$${rate * hours}`, `$${fee + rate + hours}`],
        explanation: `<p>Total = service fee + rate × hours = ${fee} + ${rate}(${hours}) = $${total}.</p>`,
      });
    }
    return mcq({
      ...b,
      prompt: `<p>A rental company charges a $${fee} service fee plus $${rate} per hour. The total cost is $${total}. How many hours did the customer rent?</p>`,
      correct: hours,
      distractors: [hours + 1, hours - 1, Math.round(total / rate)],
      explanation: `<p>Subtract the service fee: ${total} − ${fee} = ${total - fee}. Divide by ${rate}: ${hours} hours.</p>`,
    });
  },
  3(d) {
    const b = base(3, d);
    const p = pick([10, 15, 20, 25, 30, 40, 50, 60, 75, 80]);
    const x = rand(4, 40) * 10;
    const correct = (p / 100) * x;
    return mcq({
      ...b,
      prompt: `<p>What is ${p}% of ${x}?</p>`,
      correct: fmt(correct),
      distractors: [fmt(p * x), fmt(x / p), fmt(p + x), fmt(correct + x / 10)],
      explanation: `<p>${p}% = ${p / 100}. Multiply by ${x}: ${p / 100} × ${x} = ${fmt(correct)}.</p>`,
    });
  },
  3.1(d) {
    const b = base(3, d);
    const old = rand(20, 160);
    const change = rand(5, Math.max(6, Math.floor(old * 0.6)));
    const up = Math.random() < 0.5;
    const now = up ? old + change : old - change;
    const correct = ((now - old) / old) * 100;
    return mcq({
      ...b,
      prompt: `<p>A jacket's price changed from $${old} to $${now}. What is the percent change?</p>`,
      correct: `${fmt(correct)}%`,
      distractors: [`${fmt(((now - old) / now) * 100)}%`, `${fmt((now / old) * 100)}%`, `${fmt(Math.abs(now - old))}%`],
      explanation: `<p>Percent change = (new − old) ÷ old × 100% = (${now} − ${old}) ÷ ${old} × 100% = ${fmt(correct)}%.</p>`,
    });
  },
  3.2(d) {
    const b = base(3, d);
    const a = rand(2, 9);
    const bDen = rand(2, 9);
    const k = rand(2, 6);
    const c = a * k;
    const x = bDen * k;
    return mcq({
      ...b,
      prompt: `<p>Solve the proportion:</p><p class="math">${a}/${bDen} = ${c}/x</p>`,
      correct: x,
      distractors: [x + 1, x - 1, bDen * c, a * c],
      explanation: `<p>Cross-multiply: ${a}x = ${bDen * c}. Divide by ${a}: x = ${x}.</p>`,
    });
  },
  4(d) {
    const b = base(4, d);
    const forms = [
      ["A = lw", "w", "A / l", ["A − l", "l / A", "A + l"], "Divide both sides by l: w = A / l."],
      ["d = rt", "t", "d / r", ["d − r", "r / d", "d + r"], "Divide both sides by r: t = d / r."],
      ["P = 2l + 2w", "w", "(P − 2l) / 2", ["P − 2l", "(P + 2l) / 2", "2P − l"], "Subtract 2l, then divide by 2: w = (P − 2l) / 2."],
      ["y = mx + b", "x", "(y − b) / m", ["y / m − b", "(y + b) / m", "m(y − b)"], "Subtract b, then divide by m: x = (y − b) / m."],
      ["V = lwh", "h", "V / (lw)", ["V − lw", "lw / V", "V / l + w"], "Divide both sides by lw: h = V / (lw)."],
    ];
    const [eq, solve, correct, distractors, explain] = pick(forms);
    return mcq({
      ...b,
      prompt: `<p>Solve the formula for ${solve}.</p><p class="math">${eq}</p>`,
      correct,
      distractors,
      explanation: `<p>${explain}</p>`,
    });
  },
  5(d) {
    const b = base(5, d);
    const x = rand(-4, 5);
    const y = rand(-4, 5);
    const a = rand(1, 3);
    const bb = rand(-3, 3) || 1;
    const c = rand(1, 3);
    const dd = rand(-3, 3) || -1;
    const e = a * x + bb * y;
    const f = c * x + dd * y;
    return mcq({
      ...b,
      prompt: `<p>What is the solution (x, y) to the system?</p><p class="math">${a}x ${sign(bb)}y = ${e}<br>${c}x ${sign(dd)}y = ${f}</p>`,
      correct: `(${x}, ${y})`,
      distractors: [`(${y}, ${x})`, `(${-x}, ${y})`, `(${x}, ${-y})`],
      explanation: `<p>Solve the system by elimination or substitution. The intersection point is (${x}, ${y}).</p>`,
      formulaIds: ["systems-solutions"],
    });
  },
  5.1(d) {
    const b = base(5, d);
    const m = rand(-4, 4) || 2;
    const k = rand(-6, 6);
    const correct = `y = ${m === 1 ? "" : m}x ${sign(k)} and y = ${m === 1 ? "" : m}x ${sign(k + 3)}`;
    const opts = [
      `y = ${m}x ${sign(k)} and y = ${m + 1}x ${sign(k)}`,
      `y = ${m}x ${sign(k)} and y = ${m}x ${sign(k)}`,
      `y = ${m + 2}x ${sign(k)} and y = ${m + 2}x ${sign(k + 1)}`,
    ];
    return mcq({
      ...b,
      prompt: `<p>Which system of linear equations has no solution?</p>`,
      correct,
      distractors: opts,
      explanation: `<p>No solution means the lines are parallel: same slope, different y-intercepts. The correct pair has the same slope ${m} but different intercepts.</p>`,
      formulaIds: ["systems-solutions"],
    });
  },
  6(d) {
    const b = base(6, d);
    const a = rand(-4, 4) || 2;
    const x = rand(-6, 6);
    const bb = rand(-8, 8);
    const c = a * x + bb;
    const flip = a < 0;
    const correct = `x ${flip ? "<" : ">"} ${x}`;
    return mcq({
      ...b,
      prompt: `<p>Solve the inequality:</p><p class="math">${a}x ${sign(bb)} &gt; ${c}</p>`,
      correct,
      distractors: [`x ${flip ? ">" : "<"} ${x}`, `x ${flip ? "<" : ">"} ${-x}`, `x ${flip ? "≤" : "≥"} ${x}`],
      explanation: `<p>Subtract ${bb}, then divide by ${a}. Because ${a} is negative, flip the inequality sign: ${correct}.</p>`,
      formulaIds: ["linear-inequality"],
    });
  },
  6.1(d) {
    const b = base(6, d);
    const m1 = pick([-3, -2, -1, 1, 2, 3]);
    const b1 = rand(-6, 6);
    const m2 = pick([-3, -2, -1, 1, 2, 3]);
    const b2 = rand(-6, 6);
    const f1 = (x) => m1 * x + b1;
    const f2 = (x) => m2 * x + b2;
    const fmtExpr = (m, c) => {
      const mp = m === 1 ? "x" : m === -1 ? "−x" : `${m}x`;
      return c === 0 ? mp : `${mp} ${sign(c)}`;
    };
    const points = [];
    for (let x = -5; x <= 5; x++) {
      for (let y = -10; y <= 10; y++) {
        points.push({ x, y, ok: y > f1(x) && y < f2(x) });
      }
    }
    const good = points.filter((p) => p.ok);
    const bad = points.filter((p) => !p.ok);
    if (!good.length || bad.length < 3) return GENERATORS[6](d);
    const correctPoint = pick(good);
    const wrongPoints = shuffle(bad).slice(0, 3);
    const label = (p) => `(${p.x}, ${p.y})`;
    return mcq({
      ...b,
      prompt: `<p>Which ordered pair is a solution to the system of inequalities?</p><p class="math">y &gt; ${fmtExpr(m1, b1)}<br>y &lt; ${fmtExpr(m2, b2)}</p>`,
      correct: label(correctPoint),
      distractors: wrongPoints.map(label),
      explanation: `<p>Substitute ${label(correctPoint)}. Its y-value, ${correctPoint.y}, is greater than ${f1(correctPoint.x)} and less than ${f2(correctPoint.x)}, so it satisfies both inequalities.</p>`,
      formulaIds: ["linear-inequality"],
    });
  },
  8(d) {
    const b = base(8, d);
    let r1 = rand(-6, 6);
    let r2 = rand(-6, 6);
    if (r1 === r2) r2 += 1;
    const bCoef = -(r1 + r2);
    const c = r1 * r2;
    return mcq({
      ...b,
      prompt: `<p>What are the solutions to the equation?</p><p class="math">x<sup>2</sup> ${sign(bCoef)}x ${sign(c)} = 0</p>`,
      correct: `x = ${r1} or x = ${r2}`,
      distractors: [`x = ${-r1} or x = ${-r2}`, `x = ${r1} or x = ${-r2}`, `x = ${r1 + r2} or x = ${r1 * r2}`],
      explanation: `<p>Factor: (x ${sign(-r1)})(x ${sign(-r2)}) = 0. So x = ${r1} or x = ${r2}.</p>`,
    });
  },
  8.1(d) {
    const b = base(8, d);
    const a = rand(1, 3);
    const bb = rand(-8, 8);
    const c = rand(-10, 10);
    const D = bb * bb - 4 * a * c;
    const correct = D > 0 ? "2 real solutions" : D === 0 ? "1 real solution" : "no real solutions";
    return mcq({
      ...b,
      prompt: `<p>How many real solutions does the equation have?</p><p class="math">${a}x<sup>2</sup> ${sign(bb)}x ${sign(c)} = 0</p>`,
      correct,
      distractors: ["2 real solutions", "1 real solution", "no real solutions", "infinitely many real solutions"].filter((x) => x !== correct),
      explanation: `<p>Discriminant = b² − 4ac = ${bb}² − 4(${a})(${c}) = ${D}. ${D > 0 ? "Positive → 2 real solutions." : D === 0 ? "Zero → 1 real solution." : "Negative → no real solutions."}</p>`,
      formulaIds: ["discriminant"],
    });
  },
  8.2(d) {
    const b = base(8, d);
    const a = rand(1, 3) * (Math.random() < 0.5 ? 1 : -1);
    const k = rand(-5, 5);
    const bb = 2 * a * k;
    const c = rand(-10, 10);
    return mcq({
      ...b,
      prompt: `<p>What is the x-coordinate of the vertex of the parabola?</p><p class="math">y = ${a}x<sup>2</sup> ${sign(bb)}x ${sign(c)}</p>`,
      correct: k,
      distractors: [-k, bb, -bb, bb / (2 * a)],
      explanation: `<p>The vertex x-coordinate is −b ÷ (2a) = −(${bb}) ÷ (2 × ${a}) = ${k}.</p>`,
      formulaIds: ["vertex-x"],
    });
  },
  7(d) {
    const b = base(7, d);
    const x1 = rand(-5, 5);
    const x2 = x1 + rand(1, 5);
    const m = rand(-4, 4);
    const y1 = rand(-5, 5);
    const y2 = y1 + m * (x2 - x1);
    return mcq({
      ...b,
      prompt: `<p>What is the slope of the line passing through (${x1}, ${y1}) and (${x2}, ${y2})?</p>`,
      correct: m,
      distractors: [-m, m + 1, x2 - x1, fmt((x2 - x1) / (y2 - y1))],
      explanation: `<p>Slope = (y₂ − y₁) ÷ (x₂ − x₁) = (${y2} − ${y1}) ÷ (${x2} − ${x1}) = ${m}.</p>`,
      formulaIds: ["slope"],
    });
  },
  7.1(d) {
    const b = base(7, d);
    const m = rand(-4, 4) || 2;
    const x = rand(-5, 5);
    const bb = rand(-9, 9);
    const y = m * x + bb;
    return mcq({
      ...b,
      prompt: `<p>A line has slope ${m} and passes through (${x}, ${y}). What is its equation in slope-intercept form?</p>`,
      correct: line(m, bb),
      distractors: [line(m, -bb), line(-m, bb), line(m, x)],
      explanation: `<p>Use y = mx + b. Plug in (${x}, ${y}): ${y} = ${m}(${x}) + b, so b = ${bb}. The equation is ${line(m, bb)}.</p>`,
      formulaIds: ["slope-intercept"],
    });
  },
  7.2(d) {
    const b = base(7, d);
    const start = rand(20, 200);
    const rate = rand(3, 25);
    return mcq({
      ...b,
      prompt: `<p>The function f(t) = ${start} + ${rate}t models the total amount in an account after t deposits. What does ${rate} represent?</p>`,
      correct: "the amount added by each deposit",
      distractors: ["the starting amount", "the total after t deposits", "the number of deposits"],
      explanation: `<p>In a linear model a + bt, b is the rate of change: the amount added each time t increases by 1. So ${rate} is added by each deposit.</p>`,
    });
  },
  9(d) {
    const b = base(9, d);
    const a = rand(2, 90);
    const factor = pick([1.2, 1.5, 0.8, 0.5, 0.64, 1.05, 0.9, 1.25]);
    const growth = factor > 1;
    const pct = Math.round(Math.abs(1 - factor) * 100);
    return mcq({
      ...b,
      prompt: `<p>The function f(x) = ${a}(${factor})<sup>x</sup> models a quantity. Which statement is true?</p>`,
      correct: `${growth ? "Growth" : "Decay"} by ${pct}% per unit`,
      distractors: [`${growth ? "Decay" : "Growth"} by ${pct}% per unit`, `${growth ? "Growth" : "Decay"} by ${factor * 100}% per unit`, `${growth ? "Growth" : "Decay"} by ${100 - pct}% per unit`],
      explanation: `<p>The multiplier is ${factor}. ${growth ? "Greater than 1 → growth" : "Between 0 and 1 → decay"} by |1 − ${factor}| × 100% = ${pct}%.</p>`,
      formulaIds: ["exponential", "growth-decay"],
    });
  },
  10(d) {
    const b = base(10, d);
    const a = rand(2, 6);
    const c = rand(2, 6);
    if (Math.random() < 0.5) {
      return mcq({
        ...b,
        prompt: `<p>Simplify:</p><p class="math">x<sup>${a}</sup> · x<sup>${c}</sup></p>`,
        correct: `x<sup>${a + c}</sup>`,
        distractors: [`x<sup>${a * c}</sup>`, `x<sup>${a - c}</sup>`, `2x<sup>${a + c}</sup>`],
        explanation: `<p>Same base, multiplying → add the exponents: ${a} + ${c} = ${a + c}.</p>`,
        formulaIds: ["exponent-product"],
      });
    }
    return mcq({
      ...b,
      prompt: `<p>Simplify:</p><p class="math">(x<sup>${a}</sup>)<sup>${c}</sup></p>`,
      correct: `x<sup>${a * c}</sup>`,
      distractors: [`x<sup>${a + c}</sup>`, `x<sup>${a - c}</sup>`, `${c}x<sup>${a}</sup>`],
      explanation: `<p>Power to a power → multiply the exponents: ${a} × ${c} = ${a * c}.</p>`,
      formulaIds: ["exponent-power"],
    });
  },
  10.1(d) {
    const b = base(10, d);
    const baseNum = pick([2, 3, 4, 5]);
    const n = rand(1, 3);
    const den = baseNum ** n;
    return mcq({
      ...b,
      prompt: `<p>Evaluate:</p><p class="math">${baseNum}<sup>−${n}</sup></p>`,
      correct: `1/${den}`,
      distractors: [`−${den}`, `${den}`, `1/${baseNum * n}`, `−1/${den}`],
      explanation: `<p>A negative exponent flips the power: ${baseNum}<sup>−${n}</sup> = 1/${baseNum}<sup>${n}</sup> = 1/${den}.</p>`,
      formulaIds: ["negative-exponent"],
    });
  },
  11(d) {
    const b = base(11, d);
    const a = rand(-5, 5);
    const dist = rand(1, 8);
    return mcq({
      ...b,
      prompt: `<p>What are the solutions to the equation?</p><p class="math">|x ${sign(-a)}| = ${dist}</p>`,
      correct: `x = ${a + dist} or x = ${a - dist}`,
      distractors: [`x = ${a + dist}`, `x = ${-a + dist} or x = ${-a - dist}`, `x = ${a - dist}`, `x = ${dist} or x = ${-dist}`],
      explanation: `<p>Split into two cases: x ${sign(-a)} = ${dist} or x ${sign(-a)} = −${dist}. Solving gives x = ${a + dist} or x = ${a - dist}.</p>`,
      formulaIds: ["absolute-value"],
    });
  },
  12(d) {
    const b = base(12, d);
    if (Math.random() < 0.5) {
      const leg = rand(2, 10);
      return mcq({
        ...b,
        prompt: `<p>A 45-45-90 triangle has legs of length ${leg}. What is the length of the hypotenuse?</p>`,
        correct: `${leg}√2`,
        distractors: [`${leg}√3`, `${2 * leg}`, `${leg}/√2`, `${leg}√2/2`],
        explanation: `<p>In a 45-45-90 triangle, hypotenuse = leg × √2 = ${leg}√2.</p>`,
        formulaIds: ["special-45"],
      });
    }
    const short = rand(2, 10);
    const askLong = Math.random() < 0.5;
    return mcq({
      ...b,
      prompt: `<p>A 30-60-90 triangle has a short leg of length ${short}. What is the length of the ${askLong ? "long leg" : "hypotenuse"}?</p>`,
      correct: askLong ? `${short}√3` : `${2 * short}`,
      distractors: askLong ? [`${2 * short}`, `${short}√2`, `${short}/√3`] : [`${short}√3`, `${short}√2`, `${short}`],
      explanation: `<p>30-60-90 sides are x, x√3, 2x. With x = ${short}, the long leg is ${short}√3 and the hypotenuse is ${2 * short}.</p>`,
      formulaIds: ["special-30"],
    });
  },
  13(d) {
    const b = base(13, d);
    const triples = [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [6, 8, 10], [9, 12, 15]];
    const [opp, adj, hyp] = pick(triples);
    const which = pick(["sin", "cos", "tan"]);
    const correct = which === "sin" ? `${opp}/${hyp}` : which === "cos" ? `${adj}/${hyp}` : `${opp}/${adj}`;
    return mcq({
      ...b,
      prompt: `<p>In a right triangle, the side opposite angle θ has length ${opp}, the adjacent side has length ${adj}, and the hypotenuse has length ${hyp}. What is ${which} θ?</p>`,
      correct,
      distractors: [`${adj}/${hyp}`, `${opp}/${hyp}`, `${opp}/${adj}`, `${hyp}/${opp}`].filter((x) => x !== correct),
      explanation: `<p>SOH-CAH-TOA: sin = opposite/hypotenuse, cos = adjacent/hypotenuse, tan = opposite/adjacent. So ${which} θ = ${correct}.</p>`,
      formulaIds: ["sohcahtoa"],
    });
  },
  14(d) {
    const b = base(14, d);
    const a = rand(2, 9);
    const side = rand(3, 12);
    const k = rand(2, 4);
    const other = side + rand(1, 6);
    return mcq({
      ...b,
      prompt: `<p>Two triangles are similar. The side corresponding to ${side} has length ${side * k}. What is the length of the side corresponding to ${other}?</p>`,
      correct: other * k,
      distractors: [other + k, other / k, other * (k + 1), a * other],
      explanation: `<p>The scale factor is ${side * k} ÷ ${side} = ${k}. Multiply ${other} by ${k}: ${other * k}.</p>`,
    });
  },
  15(d) {
    const b = base(15, d);
    const r = rand(2, 12);
    if (Math.random() < 0.5) {
      return mcq({
        ...b,
        prompt: `<p>A circle has radius ${r}. What is its area?</p>`,
        correct: `${r * r}π`,
        distractors: [`${2 * r}π`, `${r}π`, `${4 * r * r}π`],
        explanation: `<p>Area = πr² = π(${r}²) = ${r * r}π.</p>`,
        formulaIds: ["circle-area"],
      });
    }
    return mcq({
      ...b,
      prompt: `<p>A circle has radius ${r}. What is its circumference?</p>`,
      correct: `${2 * r}π`,
      distractors: [`${r * r}π`, `${r}π`, `${4 * r}π`],
      explanation: `<p>Circumference = 2πr = 2π(${r}) = ${2 * r}π.</p>`,
      formulaIds: ["circumference"],
    });
  },
  15.1(d) {
    const b = base(15, d);
    const h = rand(-6, 6);
    const k = rand(-6, 6);
    const r = rand(2, 9);
    return mcq({
      ...b,
      prompt: `<p>What is the equation of the circle with center (${h}, ${k}) and radius ${r}?</p>`,
      correct: `${circle(h, k)} = ${r * r}`,
      distractors: [`${circle(-h, -k)} = ${r * r}`, `${circle(h, k)} = ${r}`, `${circle(-h, k)} = ${r * r}`, `${circle(h, -k)} = ${r * r}`],
      explanation: `<p>Use (x − h)² + (y − k)² = r². With center (${h}, ${k}) and r = ${r}, the equation is ${circle(h, k)} = ${r * r}.</p>`,
      formulaIds: ["circle-equation"],
    });
  },
  16(d) {
    const b = base(16, d);
    const type = pick(["box", "cylinder", "sphere", "cone"]);
    if (type === "box") {
      const l = rand(2, 8);
      const w = rand(2, 8);
      const h = rand(2, 8);
      return mcq({
        ...b,
        prompt: `<p>What is the volume of a rectangular box with length ${l}, width ${w}, and height ${h}?</p>`,
        correct: l * w * h,
        distractors: [l + w + h, 2 * (l * w + l * h + w * h), l * w, (l * w * h) / 3],
        explanation: `<p>V = ℓwh = ${l} × ${w} × ${h} = ${l * w * h}.</p>`,
        formulaIds: ["volume-box"],
      });
    }
    if (type === "cylinder") {
      const r = rand(2, 6);
      const h = rand(2, 10);
      return mcq({
        ...b,
        prompt: `<p>What is the volume of a cylinder with radius ${r} and height ${h}?</p>`,
        correct: `${r * r * h}π`,
        distractors: [`${2 * r * h}π`, `${r * h}π`, `${r * r * h}`, `${r * r * h}π/3`],
        explanation: `<p>V = πr²h = π(${r}²)(${h}) = ${r * r * h}π.</p>`,
        formulaIds: ["volume-cylinder"],
      });
    }
    if (type === "sphere") {
      const r = pick([3, 6, 9]);
      return mcq({
        ...b,
        prompt: `<p>What is the volume of a sphere with radius ${r}? Leave π in your answer.</p>`,
        correct: `${(4 / 3) * r ** 3}π`,
        distractors: [`${r ** 3}π`, `${(1 / 3) * r ** 3}π`, `${4 * r ** 2}π`],
        explanation: `<p>V = (4/3)πr³ = (4/3)π(${r}³) = ${(4 / 3) * r ** 3}π.</p>`,
        formulaIds: ["volume-sphere"],
      });
    }
    const r = rand(2, 6);
    const h = rand(3, 12);
    return mcq({
      ...b,
      prompt: `<p>What is the volume of a cone with radius ${r} and height ${h}? Leave π in your answer.</p>`,
      correct: `${((r * r * h) / 3)}π`,
      distractors: [`${r * r * h}π`, `${((r * r * h) / 3)}`, `${2 * r * h}π`, `${((r * r * h) / 2)}π`],
      explanation: `<p>V = (1/3)πr²h = (1/3)π(${r}²)(${h}) = ${((r * r * h) / 3)}π.</p>`,
      formulaIds: ["volume-cone"],
    });
  },
  17(d) {
    const b = base(17, d);
    const type = pick(["box", "cube", "cylinder"]);
    if (type === "cube") {
      const s = rand(2, 9);
      return mcq({
        ...b,
        prompt: `<p>What is the surface area of a cube with side length ${s}?</p>`,
        correct: 6 * s * s,
        distractors: [s ** 3, 4 * s * s, 12 * s, 6 * s],
        explanation: `<p>SA = 6s² = 6(${s}²) = ${6 * s * s}.</p>`,
        formulaIds: ["surface-cube"],
      });
    }
    if (type === "box") {
      const l = rand(2, 8);
      const w = rand(2, 8);
      const h = rand(2, 8);
      return mcq({
        ...b,
        prompt: `<p>What is the surface area of a box with length ${l}, width ${w}, and height ${h}?</p>`,
        correct: 2 * (l * w + l * h + w * h),
        distractors: [l * w * h, l * w + l * h + w * h, 4 * (l + w + h), 2 * l * w * h],
        explanation: `<p>SA = 2(ℓw + ℓh + wh) = 2(${l * w} + ${l * h} + ${w * h}) = ${2 * (l * w + l * h + w * h)}.</p>`,
        formulaIds: ["surface-box"],
      });
    }
    const r = rand(2, 6);
    const h = rand(2, 9);
    return mcq({
      ...b,
      prompt: `<p>What is the surface area of a cylinder with radius ${r} and height ${h}? Leave π in your answer.</p>`,
      correct: `${2 * r * r + 2 * r * h}π`,
      distractors: [`${2 * r * h}π`, `${r * r + r * h}π`, `${2 * r * r + r * h}π`, `${2 * r * r + 2 * r * h}`],
      explanation: `<p>SA = 2πr² + 2πrh = 2π(${r}²) + 2π(${r})(${h}) = ${2 * r * r + 2 * r * h}π.</p>`,
      formulaIds: ["surface-cylinder"],
    });
  },
  18(d) {
    const b = base(18, d);
    const angle = rand(30, 150);
    const type = pick(["corresponding", "same-side"]);
    const correct = type === "corresponding" ? angle : 180 - angle;
    return mcq({
      ...b,
      prompt: `<p>Two parallel lines are cut by a transversal. One angle measures ${angle}°. What is the measure of the ${type === "corresponding" ? "corresponding angle" : "same-side interior angle"}?</p>`,
      correct: `${correct}°`,
      distractors: [`${type === "corresponding" ? 180 - angle : angle}°`, `${90 - angle}°`, `${360 - angle}°`],
      explanation: `<p>${type === "corresponding" ? "Corresponding angles are equal" : "Same-side interior angles add to 180°"}, so the angle is ${correct}°.</p>`,
      formulaIds: ["parallel-angles"],
    });
  },
  19(d) {
    const b = base(19, d);
    const n = rand(5, 7);
    const data = Array.from({ length: n }, () => rand(1, 20));
    const type = pick(["mean", "median", "mode", "range"]);
    const sorted = [...data].sort((x, y) => x - y);
    let correct;
    if (type === "mean") correct = fmt(data.reduce((a, x) => a + x, 0) / n);
    else if (type === "median") correct = sorted[Math.floor(n / 2)];
    else if (type === "mode") {
      const counts = {};
      data.forEach((x) => { counts[x] = (counts[x] || 0) + 1; });
      correct = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
    } else correct = sorted[n - 1] - sorted[0];
    return mcq({
      ...b,
      prompt: `<p>What is the ${type} of the data set?</p><p class="math">${data.join(", ")}</p>`,
      correct,
      distractors: type === "mean" ? [fmt(correct + 1), fmt(correct - 1), sorted[Math.floor(n / 2)]] : [correct + 1, correct - 1, correct + 2],
      explanation: `<p>The ${type} is ${correct}. ${type === "mean" ? `Sum = ${data.reduce((a, x) => a + x, 0)}, count = ${n}.` : ""}</p>`,
      formulaIds: [type === "mean" ? "mean" : type === "median" ? "median" : type === "mode" ? "mode" : "range"],
    });
  },
  20(d) {
    const b = base(20, d);
    const total = rand(20, 100);
    const fav = rand(5, total - 5);
    const g = (a, c) => {
      const gcd = (x, y) => (y === 0 ? x : gcd(y, x % y));
      const d = gcd(a, c);
      return `${a / d}/${c / d}`;
    };
    return mcq({
      ...b,
      prompt: `<p>A bag contains ${total} tiles. ${fav} of the tiles are red. If one tile is chosen at random, what is the probability it is red?</p>`,
      correct: g(fav, total),
      distractors: [g(total - fav, total), g(total, fav), g(fav, total - fav)],
      explanation: `<p>P(red) = favorable ÷ total = ${fav}/${total} = ${g(fav, total)}.</p>`,
      formulaIds: ["probability"],
    });
  },
  20.1(d) {
    const b = base(20, d);
    const a = rand(4, 18);
    const b1 = rand(4, 18);
    const c = rand(4, 18);
    const d1 = rand(4, 18);
    const total = a + b1 + c + d1;
    const gcd = (x, y) => (y === 0 ? x : gcd(y, x % y));
    const frac = (n, dnm) => {
      const g = gcd(n, dnm);
      return `${n / g}/${dnm / g}`;
    };
    const correct = frac(a, total);
    const distractors = [
      frac(a, a + b1),
      frac(a + c, total),
      frac(a, a + c),
      frac(a + b1, total),
      frac(b1, total),
    ];
    return mcq({
      ...b,
      prompt: `<p>The table shows survey results for students in two grades and their preferred transportation.</p>
        <table><thead><tr><th></th><th>Bus</th><th>Car</th><th>Total</th></tr></thead><tbody>
        <tr><th>Juniors</th><td>${a}</td><td>${b1}</td><td>${a + b1}</td></tr>
        <tr><th>Seniors</th><td>${c}</td><td>${d1}</td><td>${c + d1}</td></tr>
        <tr><th>Total</th><td>${a + c}</td><td>${b1 + d1}</td><td>${total}</td></tr>
        </tbody></table>
        <p>If one student is selected at random, what is the probability that the student is a junior who prefers the bus?</p>`,
      correct,
      distractors,
      explanation: `<p>There are ${a} juniors who prefer the bus out of ${total} students total, so the probability is ${a}/${total} = ${correct}.</p>`,
      formulaIds: ["probability", "two-way-table"],
    });
  },
  21(d) {
    const b = base(21, d);
    const est = pick([0.32, 0.45, 0.49, 0.55, 0.62, 0.71, 0.38]);
    const moe = pick([0.02, 0.03, 0.04, 0.05]);
    const lo = Math.round((est - moe) * 100) / 100;
    const hi = Math.round((est + moe) * 100) / 100;
    return mcq({
      ...b,
      prompt: `<p>A survey estimates that ${est * 100}% of residents support a plan, with a margin of error of ${moe * 100} percentage points. Which interval is plausible for the true percentage?</p>`,
      correct: `${lo * 100}% to ${hi * 100}%`,
      distractors: [`${est * 100}% to ${hi * 100}%`, `${lo * 100}% to ${est * 100}%`, `${(est - 2 * moe) * 100}% to ${(est + 2 * moe) * 100}%`],
      explanation: `<p>Estimate ± margin of error = ${est * 100}% ± ${moe * 100}% = ${lo * 100}% to ${hi * 100}%. The correct answer is a range, not an exact value.</p>`,
      formulaIds: ["margin-error"],
    });
  },
  22(d) {
    const b = base(22, d);
    const conversions = [
      ["yards", "miles", 1760], ["feet", "yards", 3], ["inches", "feet", 12],
      ["minutes", "hours", 60], ["centimeters", "meters", 100],
    ];
    const [from, to, factor] = pick(conversions);
    const value = rand(2, 20) * factor;
    return mcq({
      ...b,
      prompt: `<p>Convert ${value} ${from} to ${to}. (1 ${to} = ${factor} ${from})</p>`,
      correct: value / factor,
      distractors: [value * factor, value / (factor * 2), value + factor],
      explanation: `<p>Divide by ${factor}: ${value} ÷ ${factor} = ${value / factor} ${to}.</p>`,
      formulaIds: ["unit-conversion"],
    });
  },
  23(d) {
    const b = base(23, d);
    const labels = ["Mon", "Tue", "Wed", "Thu"];
    const vals = [];
    while (vals.length < 4) {
      const v = rand(2, 12);
      if (!vals.includes(v)) vals.push(v);
    }
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const sum = vals.reduce((a, c) => a + c, 0);
    const maxIdx = vals.indexOf(max);
    const minIdx = vals.indexOf(min);
    const barW = 38;
    const gap = 18;
    const x0 = 44;
    const baseY = 128;
    const topY = 14;
    const scale = (baseY - topY) / max;
    const bars = vals.map((v, i) => {
      const h = Math.max(2, Math.round(v * scale));
      const x = x0 + i * (barW + gap);
      const y = baseY - h;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="#3b82f6"/>`
        + `<text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" font-size="11" fill="currentColor">${v}</text>`
        + `<text x="${x + barW / 2}" y="${baseY + 15}" text-anchor="middle" font-size="11" fill="currentColor">${labels[i]}</text>`;
    }).join("");
    const svg = `<svg viewBox="0 0 320 160" role="img" aria-label="Bar graph. ${labels.map((l, i) => `${l}: ${vals[i]}`).join(", ")}" style="max-width:320px;width:100%;height:auto;display:block;margin:10px auto;color:var(--text)"><line x1="28" y1="${baseY}" x2="304" y2="${baseY}" stroke="currentColor" stroke-width="1" opacity="0.35"/>${bars}</svg>`;
    const kind = pick(["difference", "total", "which"]);
    if (kind === "total") {
      return mcq({
        ...b,
        prompt: `<p>The bar graph shows the number of books a student read each day.</p>${svg}<p>What is the total number of books read over the four days?</p>`,
        correct: sum,
        distractors: [sum + 1, sum - 1, max * 4, sum + 4],
        explanation: `<p>Add the four bar heights: ${vals.join(" + ")} = ${sum} books.</p>`,
        formulaIds: ["bar-graph"],
      });
    }
    if (kind === "which") {
      return mcq({
        ...b,
        prompt: `<p>The bar graph shows the number of books a student read each day.</p>${svg}<p>On which day were the most books read?</p>`,
        correct: labels[maxIdx],
        distractors: labels.filter((l) => l !== labels[maxIdx]),
        explanation: `<p>${labels[maxIdx]} has the tallest bar, at ${max} books.</p>`,
        formulaIds: ["bar-graph"],
      });
    }
    return mcq({
      ...b,
      prompt: `<p>The bar graph shows the number of books a student read each day.</p>${svg}<p>How many more books were read on ${labels[maxIdx]} than on ${labels[minIdx]}?</p>`,
      correct: max - min,
      distractors: [max + min, max, min, max - min + 1],
      explanation: `<p>${labels[maxIdx]} has ${max} books and ${labels[minIdx]} has ${min} books. The difference is ${max} − ${min} = ${max - min} books.</p>`,
      formulaIds: ["bar-graph"],
    });
  },
  24(d) {
    const b = base(24, d);
    const neg = Math.random() < 0.5;
    return mcq({
      ...b,
      prompt: `<p>A scatterplot shows that as x increases, the points generally fall. What is the slope of the line of best fit?</p>`,
      correct: "negative",
      distractors: ["positive", "zero", "undefined"],
      explanation: `<p>As x increases, y decreases, so the line of best fit has a negative slope.</p>`,
      formulaIds: ["slope"],
    });
  },
};

export const TOPICS = [
  { id: 1, label: "Solving Basic Equations" },
  { id: 2, label: "Word Problems" },
  { id: 3, label: "Percent & Ratios" },
  { id: 4, label: "Solve for a Variable" },
  { id: 5, label: "Systems of Equations" },
  { id: 6, label: "Systems of Inequalities" },
  { id: 7, label: "Linear Functions & Graphs" },
  { id: 8, label: "Quadratics & Parabolas" },
  { id: 9, label: "Exponential Growth & Decay" },
  { id: 10, label: "Exponents & Radicals" },
  { id: 11, label: "Absolute Value Equations" },
  { id: 12, label: "Special Right Triangles" },
  { id: 13, label: "Right Triangle Trig" },
  { id: 14, label: "Similar Triangles" },
  { id: 15, label: "Circles" },
  { id: 16, label: "Volume" },
  { id: 17, label: "Surface Area" },
  { id: 18, label: "Parallel Lines & Angles" },
  { id: 19, label: "Mean, Median, Mode & Range" },
  { id: 20, label: "Probability" },
  { id: 21, label: "Margin of Error" },
  { id: 22, label: "Unit Conversions" },
  { id: 23, label: "Reading Bar Graphs" },
  { id: 24, label: "Scatterplots" },
];

const EXTRA = {
  1: [1, 2],
  3: [3, 3.1, 3.2],
  4: [4],
  5: [5, 5.1],
  6: [6, 6.1],
  7: [7, 7.1, 7.2],
  8: [8, 8.1, 8.2],
  10: [10, 10.1],
  15: [15, 15.1],
  20: [20, 20.1],
  23: [23],
};

export function generateQuestion(topicId, difficulty = 2) {
  const options = EXTRA[topicId] || [topicId];
  const key = pick(options);
  const fn = GENERATORS[key] || GENERATORS[1];
  return fn(difficulty);
}

export function generateMixed(count = 10, topics = null, difficulty = 2) {
  const pool = topics && topics.length ? topics : TOPICS.map((t) => t.id);
  const out = [];
  const seen = new Set();
  let guard = 0;
  while (out.length < count && guard < count * 20) {
    guard += 1;
    const topicId = pick(pool);
    const q = generateQuestion(topicId, difficulty);
    const key = `${q.topicId}-${q.answerText}-${q.prompt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  while (out.length < count) out.push(generateQuestion(pick(pool), difficulty));
  return out;
}

export function estimateMathScore(raw, total = 44) {
  const pct = total ? raw / total : 0;
  const scaled = Math.round(200 + pct * 600);
  return Math.max(200, Math.min(800, scaled));
}

export function estimateRwScore(raw, total = 54) {
  const pct = total ? raw / total : 0;
  const scaled = Math.round(200 + pct * 600);
  return Math.max(200, Math.min(800, scaled));
}
