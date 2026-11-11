/**
 * Bayesian optimisation (Jones, Schonlau and Welch, 1998; Snoek, Larochelle and Adams, 2012)
 * of a noisy black-box objective over a 2-D box, with Expected Improvement, compared with
 * random search and a manual grid sweep using the same evaluation budget and seed.
 *
 * The surrogate models log(objective) because constraint penalties make the raw objective
 * span several orders of magnitude.
 */
import { Rng } from "../rng";
import { normCdf, normPdf } from "../stats";
import { GaussianProcess } from "./gp";

export interface Box {
  sMin: number;
  sMax: number;
  qMin: number;
  qMax: number;
}

export interface Evaluation {
  iteration: number;
  s: number;
  Q: number;
  objective: number;
  feasible: boolean;
  bestSoFar: number;
  /** "warm" (analytic warm start), "initial" (space-filling design), "ei" (global Expected Improvement), "local" (trust-region EI). */
  phase: "warm" | "initial" | "ei" | "local" | "random" | "grid";
}

export type Objective = (s: number, Q: number) => { objective: number; feasible: boolean };

export const BO_INITIAL = 10;
export const BO_BUDGET = 40;
/** Evaluations at the end of the budget spent in the trust-region (exploitation) phase. */
export const LOCAL_PHASE = 10;
export const OPT_SEED = 42;

function toUnit(b: Box, s: number, Q: number): number[] {
  return [(s - b.sMin) / (b.sMax - b.sMin), (Q - b.qMin) / (b.qMax - b.qMin)];
}

function fromUnit(b: Box, u: number[]): [number, number] {
  return [Math.round(b.sMin + u[0] * (b.sMax - b.sMin)), Math.max(1, Math.round(b.qMin + u[1] * (b.qMax - b.qMin)))];
}

/** Expected Improvement for minimisation. */
export function expectedImprovement(mean: number, sdv: number, best: number, xi = 0.01): number {
  if (sdv <= 1e-12) return Math.max(0, best - mean - xi);
  const imp = best - mean - xi;
  const z = imp / sdv;
  return imp * normCdf(z) + sdv * normPdf(z);
}

/** Latin hypercube sample of n points in [0,1]^2. */
function latinHypercube(n: number, rng: Rng): number[][] {
  const perm = (): number[] => {
    const p = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    return p;
  };
  const a = perm();
  const b = perm();
  return Array.from({ length: n }, (_, i) => [(a[i] + rng.next()) / n, (b[i] + rng.next()) / n]);
}

/** Halton sequence point (bases 2 and 3), shifted by a seeded offset (Cranley-Patterson rotation). */
function halton(i: number, base: number): number {
  let f = 1;
  let r = 0;
  let k = i;
  while (k > 0) {
    f /= base;
    r += f * (k % base);
    k = Math.floor(k / base);
  }
  return r;
}

function track(list: Evaluation[], s: number, Q: number, r: { objective: number; feasible: boolean }, phase: Evaluation["phase"]): void {
  const prev = list.length ? list[list.length - 1].bestSoFar : Infinity;
  list.push({ iteration: list.length + 1, s, Q, objective: r.objective, feasible: r.feasible, bestSoFar: Math.min(prev, r.objective), phase });
}

export interface BoResult {
  evaluations: Evaluation[];
  best: Evaluation;
  /** Final surrogate's mean surface on the heatmap grid (rows = Q values, cols = s values). */
  surrogate: number[][];
}

/**
 * @param warmStarts domain-knowledge policies (for example the formula and Monte Carlo reorder
 *   points with EOQ) evaluated first, as part of the 10-point initial design.
 */
export function bayesianOptimise(
  f: Objective,
  box: Box,
  gridS: number[],
  gridQ: number[],
  budget = BO_BUDGET,
  seed = OPT_SEED,
  warmStarts: [number, number][] = [],
): BoResult {
  const rng = new Rng(seed);
  const evals: Evaluation[] = [];
  const seen = new Set<string>();
  const evalAt = (u: number[], phase: Evaluation["phase"]): void => {
    const [s, Q] = fromUnit(box, u);
    seen.add(`${s}|${Q}`);
    track(evals, s, Q, f(s, Q), phase);
  };
  const starts = warmStarts.slice(0, BO_INITIAL - 2);
  for (const [s, Q] of starts) {
    seen.add(`${Math.round(s)}|${Math.round(Q)}`);
    track(evals, Math.round(s), Math.round(Q), f(Math.round(s), Math.round(Q)), "warm");
  }
  for (const u of latinHypercube(BO_INITIAL - starts.length, rng)) evalAt(u, "initial");

  const shift = [rng.next(), rng.next()];
  const globalCandidates: number[][] = Array.from({ length: 2048 }, (_, i) => [(halton(i + 1, 2) + shift[0]) % 1, (halton(i + 1, 3) + shift[1]) % 1]);
  // The final evaluations run EI inside a shrinking trust region around the incumbent.
  const localStart = Math.max(BO_INITIAL, budget - LOCAL_PHASE);
  const clip = (v: number): number => Math.min(1, Math.max(0, v));
  let gp = new GaussianProcess();
  while (evals.length < budget) {
    const X = evals.map((e) => toUnit(box, e.s, e.Q));
    const y = surrogateTargets(evals);
    gp = new GaussianProcess().fit(X, y);
    const bestY = Math.min(...y);
    const isLocal = evals.length >= localStart;
    let candidates: number[][];
    if (isLocal) {
      const inc = toUnit(box, bestOf(evals).s, bestOf(evals).Q);
      const radius = Math.max(0.01, 0.08 * Math.pow(0.8, evals.length - localStart));
      candidates = Array.from({ length: 600 }, () => [clip(inc[0] + (2 * rng.next() - 1) * radius), clip(inc[1] + (2 * rng.next() - 1) * radius)]);
    } else {
      const top = [...evals].sort((a, b) => a.objective - b.objective).slice(0, 5);
      const local: number[][] = [];
      for (const e of top) {
        const u = toUnit(box, e.s, e.Q);
        for (let k = 0; k < 40; k++) local.push([clip(u[0] + (rng.next() - 0.5) * 0.1), clip(u[1] + (rng.next() - 0.5) * 0.1)]);
      }
      candidates = [...globalCandidates, ...local];
    }
    let bestU: number[] | null = null;
    let bestEi = -1;
    for (const u of candidates) {
      const [s, Q] = fromUnit(box, u);
      if (seen.has(`${s}|${Q}`)) continue;
      const p = gp.predict(u);
      const ei = expectedImprovement(p.mean, p.sd, bestY, isLocal ? 0 : 0.01);
      if (ei > bestEi) {
        bestEi = ei;
        bestU = u;
      }
    }
    if (!bestU) bestU = [rng.next(), rng.next()];
    evalAt(bestU, isLocal ? "local" : "ei");
  }
  const X = evals.map((e) => toUnit(box, e.s, e.Q));
  gp = new GaussianProcess().fit(X, surrogateTargets(evals));
  const surrogate = gridQ.map((Q) => gridS.map((s) => Math.exp(gp.predict(toUnit(box, s, Q)).mean)));
  return { evaluations: evals, best: bestOf(evals), surrogate };
}

/**
 * Surrogate targets: log(objective), capped at log(2 x best) so heavily penalised points
 * do not dominate the GP's scale and it keeps resolution near the optimum.
 */
function surrogateTargets(evals: Evaluation[]): number[] {
  const y = evals.map((e) => Math.log(e.objective));
  const cap = Math.min(...y) + Math.log(2);
  return y.map((v) => Math.min(v, cap));
}

/** Lowest-objective evaluation, preferring points that satisfy every constraint. */
export function bestOf<T extends { objective: number; feasible: boolean }>(list: T[]): T {
  const feasible = list.filter((e) => e.feasible);
  const pool = feasible.length ? feasible : list;
  return pool.reduce((a, b) => (b.objective < a.objective ? b : a));
}

export function randomSearch(f: Objective, box: Box, budget = BO_BUDGET, seed = OPT_SEED, warmStarts: [number, number][] = []): Evaluation[] {
  const rng = new Rng(seed);
  const evals: Evaluation[] = [];
  for (const [s, Q] of warmStarts.slice(0, BO_INITIAL - 2)) track(evals, Math.round(s), Math.round(Q), f(Math.round(s), Math.round(Q)), "warm");
  while (evals.length < budget) {
    const [s, Q] = fromUnit(box, [rng.next(), rng.next()]);
    track(evals, s, Q, f(s, Q), "random");
  }
  return evals;
}

/** Evenly spaced values from lo to hi (inclusive), rounded to integers. */
export function linspace(lo: number, hi: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.round(lo + ((hi - lo) * i) / Math.max(1, n - 1)));
}

/** Manual sweep in the order a planner would run it: Q outer loop, s inner loop. */
export function gridSearch(f: Objective, sValues: number[], qValues: number[]): Evaluation[] {
  const evals: Evaluation[] = [];
  for (const Q of qValues) for (const s of sValues) track(evals, s, Math.max(1, Q), f(s, Math.max(1, Q)), "grid");
  return evals;
}
