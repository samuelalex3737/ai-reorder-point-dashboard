/** Ridge regression on standardised features (closed form), unpenalised intercept. */
import { solveSPD } from "../linalg";

export class RidgeRegression {
  private mu: number[] = [];
  private sigma: number[] = [];
  private beta: Float64Array = new Float64Array(0);
  private intercept = 0;

  constructor(private readonly lambda = 1.0) {}

  fit(X: number[][], y: number[]): this {
    const n = X.length;
    const p = X[0].length;
    this.mu = new Array(p).fill(0);
    this.sigma = new Array(p).fill(0);
    for (const row of X) for (let j = 0; j < p; j++) this.mu[j] += row[j] / n;
    for (const row of X) for (let j = 0; j < p; j++) this.sigma[j] += (row[j] - this.mu[j]) ** 2 / n;
    this.sigma = this.sigma.map((v) => (v > 1e-12 ? Math.sqrt(v) : 1));
    const ym = y.reduce((a, b) => a + b, 0) / n;
    const A = new Float64Array(p * p);
    const b = new Float64Array(p);
    for (let i = 0; i < n; i++) {
      const z = X[i].map((v, j) => (v - this.mu[j]) / this.sigma[j]);
      const yc = y[i] - ym;
      for (let j = 0; j < p; j++) {
        b[j] += z[j] * yc;
        for (let k = 0; k <= j; k++) A[j * p + k] += z[j] * z[k];
      }
    }
    for (let j = 0; j < p; j++) {
      for (let k = 0; k < j; k++) A[k * p + j] = A[j * p + k];
      A[j * p + j] += this.lambda;
    }
    this.beta = solveSPD(A, p, b);
    this.intercept = ym;
    return this;
  }

  predict(x: number[]): number {
    let s = this.intercept;
    for (let j = 0; j < x.length; j++) s += this.beta[j] * ((x[j] - this.mu[j]) / this.sigma[j]);
    return s;
  }

  /** Coefficients on the standardised scale (useful for explaining drivers). */
  coefficients(): number[] {
    return Array.from(this.beta);
  }
}
