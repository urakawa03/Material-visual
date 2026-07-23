/**
 * pileup.ts — 1D パイルアップの数値モデル(記事仕様書 02 §5.7)
 *
 * すべり面上の刃状転位を位置 x_i ∈ (0, d) だけで表す 1 次元モデル。
 * 過減衰運動:
 *   ẋ_i = M b (τ_app + Σ_{j≠i} K/(x_i − x_j) − τ_wall(x_i))
 * K = μb/(2π(1−ν)) は同符号刃状転位の反発係数(MPa·μm)。
 * 壁(結晶粒界)は不可侵の強い短距離反発 τ_wall = C K/(d − x) で表す。
 *
 * 源: τ_eff = τ_app − Σ_j K/x_j が τ_c を上回っていれば一定間隔で新しい
 * 転位を x = 0⁺ に追加する。τ_eff < τ_c が続くと「源が止まった」state。
 *
 * 乱数不使用・完全決定論(reset 再現)。単位: μm・MPa・秒。
 * 簡略化: 1 次元・直線転位の弾性相互作用のみ(§5.7)。
 */

export interface PileupParams {
  /** 転位間相互作用係数 K(MPa·μm) */
  K: number;
  /** 源の作動応力 τ_c(MPa) */
  tauC: number;
  /** 易動度 × b(μm / (s·MPa)) */
  mobility: number;
  /** 固定タイムステップ(s) */
  dt: number;
  /** 放出間隔(s) */
  emitInterval: number;
  /** 放出位置(μm) */
  emitX: number;
  /** 壁反発の強さ(× K) */
  wallFactor: number;
  /** 転位速度の上限(μm/s) */
  vMax: number;
  /** 転位数の上限 */
  maxN: number;
  /** 「源が止まった」と判定する継続時間(s) */
  stallSeconds: number;
}

export const DEFAULT_PILEUP_PARAMS: PileupParams = {
  K: 1.82,
  tauC: 7.44,
  mobility: 0.15,
  dt: 0.004,
  emitInterval: 0.7,
  emitX: 0.05,
  wallFactor: 2,
  vMax: 5,
  maxN: 30,
  stallSeconds: 3,
};

/** 転位どうし・壁との最小間隔(μm)。数値の暴走防止 */
const MIN_GAP = 0.01;

export class PileupSim {
  readonly p: PileupParams;
  /** 壁までの距離 d(μm) */
  d = 2;
  /** 加える応力 τ_app(MPa) */
  tauApp = 0;
  /** 転位位置(源に近い順ではなく放出順。単調増加を保つ) */
  x: number[] = [];
  time = 0;
  /** 源が止まったと判定されたか */
  stalled = false;
  private emitClock = 0;
  private stallClock = 0;
  private acc = 0;
  private v: number[] = [];

  constructor(params?: Partial<PileupParams>) {
    this.p = { ...DEFAULT_PILEUP_PARAMS, ...params };
  }

  reset(): void {
    this.x.length = 0;
    this.v.length = 0;
    this.time = 0;
    this.emitClock = 0;
    this.stallClock = 0;
    this.stalled = false;
    this.acc = 0;
  }

  /** 源に届く背応力 τ_back = Σ K/x_j(MPa) */
  tauBack(): number {
    let sum = 0;
    for (const xi of this.x) sum += this.p.K / Math.max(xi, MIN_GAP);
    return sum;
  }

  /** 源に働く実効応力 */
  tauEff(): number {
    return this.tauApp - this.tauBack();
  }

  advance(dtReal: number): void {
    this.acc += dtReal;
    const h = this.p.dt;
    // 処理落ち時に雪だるま式に増えないよう上限を設ける
    let steps = Math.floor(this.acc / h);
    if (steps > 20) {
      steps = 20;
      this.acc = 0;
    } else {
      this.acc -= steps * h;
    }
    for (let s = 0; s < steps; s++) this.step(h);
  }

  private step(h: number): void {
    const { K, mobility, vMax, wallFactor } = this.p;
    const n = this.x.length;
    const x = this.x;
    if (this.v.length < n) this.v.length = n;

    for (let i = 0; i < n; i++) {
      let tau = this.tauApp;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        let dx = x[i] - x[j];
        if (dx > -MIN_GAP && dx < MIN_GAP) dx = dx >= 0 ? MIN_GAP : -MIN_GAP;
        tau += K / dx;
      }
      // 壁の不可侵(強い短距離反発)
      const wallDist = Math.max(this.d - x[i], MIN_GAP);
      tau -= (wallFactor * K) / wallDist;
      let vi = mobility * tau;
      if (vi > vMax) vi = vMax;
      else if (vi < -vMax) vi = -vMax;
      this.v[i] = vi;
    }
    for (let i = 0; i < n; i++) {
      x[i] += this.v[i] * h;
      if (x[i] < this.p.emitX) x[i] = this.p.emitX;
      if (x[i] > this.d - MIN_GAP) x[i] = this.d - MIN_GAP;
    }
    // 追い越し防止(放出順 = 位置順を保つ)
    for (let i = n - 2; i >= 0; i--) {
      if (x[i] > x[i + 1] - MIN_GAP) x[i] = x[i + 1] - MIN_GAP;
    }

    // 放出と停止判定
    this.time += h;
    this.emitClock += h;
    const eff = this.tauEff();
    if (eff < this.p.tauC) {
      this.stallClock += h;
      if (this.stallClock >= this.p.stallSeconds && n > 0) this.stalled = true;
    } else {
      this.stallClock = 0;
      this.stalled = false;
    }
    if (this.emitClock >= this.p.emitInterval) {
      this.emitClock = 0;
      if (eff > this.p.tauC && n < this.p.maxN) {
        // 新しい転位を源の位置に追加(先頭 = 源側)
        this.x.unshift(this.p.emitX);
        this.v.unshift(0);
      }
    }
  }
}
