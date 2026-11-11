/** Dense linear algebra for small symmetric positive-definite systems (ridge, Gaussian process). */

/** Cholesky factor L (lower triangular, row-major n x n) of SPD matrix A. Adds jitter if needed. */
export function cholesky(A: Float64Array, n: number): Float64Array {
  for (let attempt = 0; attempt < 6; attempt++) {
    const jitter = attempt === 0 ? 0 : 1e-10 * 10 ** attempt;
    const L = new Float64Array(n * n);
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      for (let j = 0; j <= i; j++) {
        let s = A[i * n + j] + (i === j ? jitter : 0);
        for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
        if (i === j) {
          if (s <= 0) {
            ok = false;
            break;
          }
          L[i * n + i] = Math.sqrt(s);
        } else {
          L[i * n + j] = s / L[j * n + j];
        }
      }
    }
    if (ok) return L;
  }
  throw new Error("cholesky: matrix is not positive definite");
}

/** Solve L y = b (forward substitution). */
export function forwardSolve(L: Float64Array, n: number, b: ArrayLike<number>): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  return y;
}

/** Solve L^T x = y (back substitution). */
export function backSolve(L: Float64Array, n: number, y: ArrayLike<number>): Float64Array {
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

/** Solve A x = b for SPD A via Cholesky. */
export function solveSPD(A: Float64Array, n: number, b: ArrayLike<number>): Float64Array {
  const L = cholesky(A, n);
  return backSolve(L, n, forwardSolve(L, n, b));
}
