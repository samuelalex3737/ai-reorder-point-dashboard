/**
 * Regression trees (CART, squared-error splits) and two ensembles built on them:
 * Random Forest (Breiman, 2001) and Gradient Boosted Trees (Friedman, 2001).
 */
import { Rng } from "../rng";

interface TreeNode {
  feature: number; // -1 for a leaf
  threshold: number;
  left: TreeNode | null;
  right: TreeNode | null;
  value: number;
}

interface TreeOptions {
  maxDepth: number;
  minLeaf: number;
  /** Features considered per split (random subset when below the feature count). */
  mtry: number;
}

function leaf(value: number): TreeNode {
  return { feature: -1, threshold: 0, left: null, right: null, value };
}

function buildTree(X: number[][], y: number[], idx: number[], opts: TreeOptions, rng: Rng, depth: number): TreeNode {
  const n = idx.length;
  let total = 0;
  for (const i of idx) total += y[i];
  const nodeMean = total / n;
  if (depth >= opts.maxDepth || n < 2 * opts.minLeaf) return leaf(nodeMean);

  const p = X[0].length;
  let features: number[] = Array.from({ length: p }, (_, j) => j);
  if (opts.mtry < p) {
    for (let k = p - 1; k > 0; k--) {
      const r = rng.int(k + 1);
      [features[k], features[r]] = [features[r], features[k]];
    }
    features = features.slice(0, opts.mtry);
  }

  const parentScore = (total * total) / n;
  let bestGain = 1e-9;
  let bestFeature = -1;
  let bestThreshold = 0;
  for (const f of features) {
    const order = idx.slice().sort((a, b) => X[a][f] - X[b][f]);
    let leftSum = 0;
    for (let k = 0; k < n - 1; k++) {
      leftSum += y[order[k]];
      const nl = k + 1;
      const nr = n - nl;
      if (nl < opts.minLeaf || nr < opts.minLeaf) continue;
      const v = X[order[k]][f];
      const vNext = X[order[k + 1]][f];
      if (vNext <= v) continue;
      const rightSum = total - leftSum;
      const gain = (leftSum * leftSum) / nl + (rightSum * rightSum) / nr - parentScore;
      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = f;
        bestThreshold = (v + vNext) / 2;
      }
    }
  }
  if (bestFeature < 0) return leaf(nodeMean);
  const leftIdx: number[] = [];
  const rightIdx: number[] = [];
  for (const i of idx) (X[i][bestFeature] <= bestThreshold ? leftIdx : rightIdx).push(i);
  return {
    feature: bestFeature,
    threshold: bestThreshold,
    left: buildTree(X, y, leftIdx, opts, rng, depth + 1),
    right: buildTree(X, y, rightIdx, opts, rng, depth + 1),
    value: nodeMean,
  };
}

function predictTree(node: TreeNode, x: number[]): number {
  let cur = node;
  while (cur.feature >= 0) cur = (x[cur.feature] <= cur.threshold ? cur.left : cur.right)!;
  return cur.value;
}

export class RandomForest {
  private trees: TreeNode[] = [];
  constructor(
    private readonly nTrees = 200,
    private readonly maxDepth = 10,
    private readonly minLeaf = 2,
    private readonly seed = 42,
  ) {}

  fit(X: number[][], y: number[]): this {
    const rng = new Rng(this.seed);
    const n = X.length;
    const mtry = Math.max(1, Math.floor(X[0].length / 3));
    this.trees = [];
    for (let t = 0; t < this.nTrees; t++) {
      const sample = Array.from({ length: n }, () => rng.int(n));
      this.trees.push(buildTree(X, y, sample, { maxDepth: this.maxDepth, minLeaf: this.minLeaf, mtry }, rng, 0));
    }
    return this;
  }

  predict(x: number[]): number {
    let s = 0;
    for (const tr of this.trees) s += predictTree(tr, x);
    return s / this.trees.length;
  }
}

export class GradientBoosting {
  private trees: TreeNode[] = [];
  private base = 0;
  constructor(
    private readonly nRounds = 300,
    private readonly learningRate = 0.05,
    private readonly maxDepth = 3,
    private readonly minLeaf = 4,
    private readonly subsample = 0.8,
    private readonly seed = 43,
  ) {}

  fit(X: number[][], y: number[]): this {
    const rng = new Rng(this.seed);
    const n = X.length;
    const p = X[0].length;
    this.base = y.reduce((a, b) => a + b, 0) / n;
    const pred = new Array(n).fill(this.base);
    this.trees = [];
    for (let r = 0; r < this.nRounds; r++) {
      const resid = y.map((v, i) => v - pred[i]);
      const idx: number[] = [];
      for (let i = 0; i < n; i++) if (rng.next() < this.subsample) idx.push(i);
      if (idx.length < 2 * this.minLeaf) continue;
      const tree = buildTree(X, resid, idx, { maxDepth: this.maxDepth, minLeaf: this.minLeaf, mtry: p }, rng, 0);
      this.trees.push(tree);
      for (let i = 0; i < n; i++) pred[i] += this.learningRate * predictTree(tree, X[i]);
    }
    return this;
  }

  predict(x: number[]): number {
    let s = this.base;
    for (const tr of this.trees) s += this.learningRate * predictTree(tr, x);
    return s;
  }
}
