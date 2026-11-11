/**
 * Seeded pseudo-random number generation. Every stochastic step in the app draws from
 * an Rng built from an explicit seed, so results are reproducible run to run.
 *
 * Generator: xoshiro128** (Blackman and Vigna), state seeded with splitmix32.
 * Normal: Box-Muller. Gamma: Marsaglia and Tsang (2000).
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare: number | null = null;

  constructor(seed: number) {
    let s = seed >>> 0;
    const splitmix = (): number => {
      s = (s + 0x9e3779b9) | 0;
      let t = s ^ (s >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t ^= t >>> 15;
      t = Math.imul(t, 0x735a2d97);
      t ^= t >>> 15;
      return t >>> 0;
    };
    this.a = splitmix();
    this.b = splitmix();
    this.c = splitmix();
    this.d = splitmix();
  }

  /** Uniform on [0, 1). */
  next(): number {
    const result = Math.imul(rotl(Math.imul(this.b, 5), 7), 9) >>> 0;
    const t = this.b << 9;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = rotl(this.d, 11);
    return result / 4294967296;
  }

  /** Integer uniform on [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Standard normal draw. */
  normal(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    const u1 = 1 - this.next(); // (0, 1]
    const u2 = this.next();
    const r = Math.sqrt(-2 * Math.log(u1));
    this.spare = r * Math.sin(2 * Math.PI * u2);
    return r * Math.cos(2 * Math.PI * u2);
  }

  /** Gamma(shape, scale) draw: mean shape*scale, variance shape*scale^2. */
  gamma(shape: number, scale: number): number {
    if (shape < 1) {
      const u = this.next();
      return this.gamma(shape + 1, scale) * Math.pow(u, 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number;
      let v: number;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.next();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v * scale;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
    }
  }
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/**
 * Lead time with mean L and standard deviation sdL, drawn from a gamma distribution
 * (positive and right-skewed): shape = (L / sdL)^2, scale = sdL^2 / L.
 * Returns L exactly when sdL is zero.
 */
export function drawLeadTime(rng: Rng, L: number, sdL: number): number {
  if (sdL <= 1e-9) return L;
  const shape = (L / sdL) ** 2;
  return rng.gamma(shape, (sdL * sdL) / L);
}
