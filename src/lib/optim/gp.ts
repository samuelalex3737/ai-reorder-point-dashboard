/**
 * Gaussian-process regression (Rasmussen and Williams, 2006) with a Matern 5/2 ARD kernel.
 * Inputs are expected on [0, 1]^d; outputs are standardised internally. Hyperparameters
 * (length-scales and noise) are chosen by maximising the log marginal likelihood over a grid.
 */
import { backSolve, cholesky, forwardSolve } from "../linalg";

export interface GpHyper {
  lengthScales: number[];
  /** Noise variance on the standardised scale. */
  noise: number;
}

function matern52(a: number[], b: number[], ls: number[]): number {
  let r2 = 0;
  for (let i = 0; i < a.length; i++) r2 += ((a[i] - b[i]) / ls[i]) ** 2;
  const r = Math.sqrt(5 * r2);
  return (1 + r + (5 / 3) * r2) * Math.exp(-r);
}

export class GaussianProcess {
  private X: number[][] = [];
  private yMean = 0;
  private yStd = 1;
  private L: Float64Array = new Float64Array(0);
  private alpha: Float64Array = new Float64Array(0);
  hyper: GpHyper = { lengthScales: [0.3, 0.3], noise: 1e-3 };
  logLik = -Infinity;

  /**
   * @param noises candidate noise variances (standardised scale). The default suits a
   *   deterministic objective, such as a simulator evaluated with common random numbers.
   */
  fit(X: number[][], y: number[], noises: number[] = [1e-6, 1e-5, 1e-4, 1e-3]): this {
    const n = X.length;
    this.X = X;
    this.yMean = y.reduce((a, b) => a + b, 0) / n;
    const v = y.reduce((a, b) => a + (b - this.yMean) ** 2, 0) / Math.max(1, n - 1);
    this.yStd = Math.sqrt(v) || 1;
    const ys = y.map((t) => (t - this.yMean) / this.yStd);
    const grid = [0.05, 0.1, 0.2, 0.35, 0.6, 1.0, 1.6];
    let best: { ll: number; hyper: GpHyper; L: Float64Array; alpha: Float64Array } | null = null;
    const d = X[0].length;
    const combos: number[][] = d === 2 ? grid.flatMap((a) => grid.map((b) => [a, b])) : grid.map((a) => new Array(d).fill(a));
    for (const ls of combos) {
      for (const noise of noises) {
        const K = new Float64Array(n * n);
        for (let i = 0; i < n; i++) {
          for (let j = 0; j <= i; j++) {
            const k = matern52(X[i], X[j], ls) + (i === j ? noise : 0);
            K[i * n + j] = k;
            K[j * n + i] = k;
          }
        }
        let L: Float64Array;
        try {
          L = cholesky(K, n);
        } catch {
          continue;
        }
        const alpha = backSolve(L, n, forwardSolve(L, n, ys));
        let quad = 0;
        let logDet = 0;
        for (let i = 0; i < n; i++) {
          quad += ys[i] * alpha[i];
          logDet += Math.log(L[i * n + i]);
        }
        const ll = -0.5 * quad - logDet - 0.5 * n * Math.log(2 * Math.PI);
        if (!best || ll > best.ll) best = { ll, hyper: { lengthScales: ls, noise }, L, alpha };
      }
    }
    if (!best) throw new Error("GP fit failed");
    this.hyper = best.hyper;
    this.L = best.L;
    this.alpha = best.alpha;
    this.logLik = best.ll;
    return this;
  }

  /** Posterior mean and standard deviation of the latent function (original output scale). */
  predict(x: number[]): { mean: number; sd: number } {
    const n = this.X.length;
    const k = new Float64Array(n);
    for (let i = 0; i < n; i++) k[i] = matern52(x, this.X[i], this.hyper.lengthScales);
    let mu = 0;
    for (let i = 0; i < n; i++) mu += k[i] * this.alpha[i];
    const v = forwardSolve(this.L, n, k);
    let vv = 0;
    for (let i = 0; i < n; i++) vv += v[i] * v[i];
    const varStd = Math.max(1e-12, 1 - vv);
    return { mean: this.yMean + this.yStd * mu, sd: this.yStd * Math.sqrt(varStd) };
  }
}
