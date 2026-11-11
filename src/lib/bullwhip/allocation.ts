/**
 * Optimisation-based allocation for the Bullwhip Lab (AI routing).
 *
 * Each week, decide x[d][r] = units distributor d ships to retailer r to minimise
 *   sum_dr c[d][r] x[d][r]                      (shipping)
 * + sum_r  b[r] (need[r] - sum_d x[d][r])        (backlog left unserved)
 * + sum_d  h[d] (stock[d] - sum_r x[d][r])       (stock left holding)
 * subject to sum_r x[d][r] <= stock[d], sum_d x[d][r] <= need[r], x >= 0, and only on open lanes.
 *
 * This is a transportation LP, solved exactly as a min-cost flow by successive shortest paths
 * (Bellman-Ford on the residual graph, since arc costs c - b - h are negative), augmenting
 * while a negative-cost path exists.
 */

export interface AllocationInput {
  stock: number[];
  need: number[];
  /** Cost per unit shipped on each lane [d][r]; Infinity closes a lane. */
  laneCost: number[][];
  /** Cost per unit of retailer need left unserved this week. */
  backlogCost: number[];
  /** Cost per unit of distributor stock left on hand this week. */
  holdingCost: number[];
}

export interface AllocationResult {
  ship: number[][];
  cost: number;
}

interface Arc {
  to: number;
  cap: number;
  cost: number;
  rev: number;
}

export function allocate(inp: AllocationInput): AllocationResult {
  const D = inp.stock.length;
  const R = inp.need.length;
  const S = 0;
  const T = D + R + 1;
  const n = T + 1;
  const g: Arc[][] = Array.from({ length: n }, () => []);
  const add = (u: number, v: number, cap: number, cost: number): void => {
    g[u].push({ to: v, cap, cost, rev: g[v].length });
    g[v].push({ to: u, cap: 0, cost: -cost, rev: g[u].length - 1 });
  };
  for (let d = 0; d < D; d++) add(S, 1 + d, Math.max(0, inp.stock[d]), 0);
  for (let r = 0; r < R; r++) add(1 + D + r, T, Math.max(0, inp.need[r]), 0);
  const laneArc: { d: number; r: number; idx: number }[] = [];
  for (let d = 0; d < D; d++) {
    for (let r = 0; r < R; r++) {
      const c = inp.laneCost[d][r];
      if (!Number.isFinite(c)) continue;
      laneArc.push({ d, r, idx: g[1 + d].length });
      add(1 + d, 1 + D + r, Infinity, c - inp.backlogCost[r] - inp.holdingCost[d]);
    }
  }

  for (let iter = 0; iter < 4 * (D + R) + 10; iter++) {
    const dist = new Array(n).fill(Infinity);
    const prev: { u: number; e: number }[] = new Array(n);
    dist[S] = 0;
    for (let k = 0; k < n - 1; k++) {
      let changed = false;
      for (let u = 0; u < n; u++) {
        if (dist[u] === Infinity) continue;
        g[u].forEach((a, e) => {
          if (a.cap > 1e-9 && dist[u] + a.cost < dist[a.to] - 1e-12) {
            dist[a.to] = dist[u] + a.cost;
            prev[a.to] = { u, e };
            changed = true;
          }
        });
      }
      if (!changed) break;
    }
    if (dist[T] >= -1e-12) break; // no more profitable shipments
    let push = Infinity;
    for (let v = T; v !== S; v = prev[v].u) push = Math.min(push, g[prev[v].u][prev[v].e].cap);
    if (!(push > 1e-9) || !Number.isFinite(push)) break;
    for (let v = T; v !== S; v = prev[v].u) {
      const a = g[prev[v].u][prev[v].e];
      a.cap -= push;
      g[v][a.rev].cap += push;
    }
  }

  const ship = Array.from({ length: D }, () => new Array(R).fill(0));
  for (const { d, r, idx } of laneArc) ship[d][r] = g[1 + D + r][g[1 + d][idx].rev].cap;
  let cost = 0;
  for (let d = 0; d < D; d++) {
    let out = 0;
    for (let r = 0; r < R; r++) {
      cost += ship[d][r] * (Number.isFinite(inp.laneCost[d][r]) ? inp.laneCost[d][r] : 0);
      out += ship[d][r];
    }
    cost += inp.holdingCost[d] * (inp.stock[d] - out);
  }
  for (let r = 0; r < R; r++) {
    let got = 0;
    for (let d = 0; d < D; d++) got += ship[d][r];
    cost += inp.backlogCost[r] * (inp.need[r] - got);
  }
  return { ship, cost };
}
