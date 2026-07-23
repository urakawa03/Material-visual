/**
 * line.ts — 節点列で表す転位線の数値コア(記事仕様書 02 §5.0・§5.5)
 *
 * 転位線を節点列で表し、過減衰運動
 *   v_i = M (τ b + T κ_i) n̂_i
 * (n̂ は進行方向の左法線、κ は符号付き曲率)で動かす。円弧平衡
 * τ b = T / R を自動的に満たす。リメッシュ・相殺(再結合)・ループ管理を含む。
 *
 * 座標系は数学座標(+y が「応力が線を押す向き」)。描画側で y を反転する。
 * 無次元単位 L = b = T = M = 1(τ_c^sim = 2)で使い、表示時のみ物理値へ
 * 換算する(§5.0)。
 *
 * このモジュールは自己完結(import なし)とする。scripts/verify-line.ts が
 * Node.js から直接読み込んで数値検証を行うため(仕様書 02 付記 1)。
 *
 * 簡略化: 等方弾性・一定線張力・過減衰・格子摩擦なしの理想化モデル。
 * 転位どうしの弾性相互作用は相殺(つなぎ替え)以外では考慮しない。
 */

/** 数値パラメータ(無次元) */
export interface LineParams {
  /** 線張力 T */
  tension: number;
  /** バーガースベクトルの大きさ b */
  burgers: number;
  /** 易動度 M(過減衰: v = M f) */
  mobility: number;
  /** リメッシュ目標間隔 s0(既定 L/40) */
  s0: number;
  /** 固定タイムステップ dt(シミュレーション時間単位) */
  dt: number;
  /** 節点速度の上限(数値安全策 — カスプ等の暴走防止) */
  vMax: number;
}

/** 既定パラメータ(L = 1 の無次元単位系) */
export const DEFAULT_LINE_PARAMS: LineParams = {
  tension: 1,
  burgers: 1,
  mobility: 1,
  s0: 1 / 40,
  dt: 2e-4,
  vMax: 8,
};

/** 無次元単位系での臨界応力 τ_c = 2T/(bL) = 2 */
export const TAU_C_SIM = 2;

/** 固定点の間隔(無次元で常に 1) */
export const SOURCE_LENGTH = 1;

/** 分割しきい値(× s0) */
const SPLIT_FACTOR = 1.5;
/** 結合しきい値(× s0) */
const MERGE_FACTOR = 0.5;
/** 相殺の距離しきい値(× s0) */
const RECOMBINE_DIST_FACTOR = 1.2;
/** 相殺の接線内積しきい値(ほぼ逆向き) */
const RECOMBINE_DOT_MAX = -0.7;
/** 相殺判定で除外する節点インデックスの最小離間 */
const RECOMBINE_MIN_SEP = 6;
/** リメッシュを走らせるステップ間隔 */
const REMESH_EVERY = 8;
/** 相殺判定を走らせるステップ間隔 */
const RECOMBINE_EVERY = 6;
/** NaN 検査を走らせるステップ間隔 */
const NAN_CHECK_EVERY = 32;
/** ループの目標節点数(これを超えないよう間隔を粗くする) */
const LOOP_TARGET_NODES = 130;
/** これ未満に縮んだループは消滅として除去する(節点数) */
const LOOP_MIN_NODES = 6;
/** これ未満に縮んだループは消滅として除去する(周長 × s0) */
const LOOP_MIN_PERIMETER_FACTOR = 5;
/** 1 回の advance で消化するステップ数の上限(処理落ち対策) */
const MAX_STEPS_PER_ADVANCE = 400;

let nextCurveId = 1;

/** 節点列の曲線。open = 両端が固定点の線分、closed = ループ */
export class Curve {
  readonly id: number;
  closed: boolean;
  x: number[];
  y: number[];
  /** リメッシュ間隔の倍率(大きなループは粗くする) */
  s0Scale = 1;

  constructor(x: number[], y: number[], closed: boolean) {
    this.id = nextCurveId++;
    this.x = x;
    this.y = y;
    this.closed = closed;
  }

  get n(): number {
    return this.x.length;
  }

  perimeter(): number {
    const { x, y } = this;
    const n = x.length;
    let sum = 0;
    const last = this.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % n;
      sum += Math.hypot(x[j] - x[i], y[j] - y[i]);
    }
    return sum;
  }

  /** 符号付き面積(閉曲線用。数学座標系で反時計回りが正) */
  signedArea(): number {
    const { x, y } = this;
    const n = x.length;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      sum += x[i] * y[j] - x[j] * y[i];
    }
    return sum / 2;
  }

  /** 点 (px, py) を内包するか(レイキャスティング法) */
  containsPoint(px: number, py: number): boolean {
    const { x, y } = this;
    const n = x.length;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const intersects =
        y[i] > py !== y[j] > py &&
        px < ((x[j] - x[i]) * (py - y[i])) / (y[j] - y[i]) + x[i];
      if (intersects) inside = !inside;
    }
    return inside;
  }

  /** 原点からの最大距離(ステージ外判定用) */
  maxRadius(): number {
    const { x, y } = this;
    let max = 0;
    for (let i = 0; i < x.length; i++) {
      const r2 = x[i] * x[i] + y[i] * y[i];
      if (r2 > max) max = r2;
    }
    return Math.sqrt(max);
  }

  /** 最小の y 座標(相殺判定を回すかどうかの粗い判定用) */
  minY(): number {
    const { y } = this;
    let min = Infinity;
    for (let i = 0; i < y.length; i++) if (y[i] < min) min = y[i];
    return min;
  }

  /** 節点の向きを反転する(閉曲線の向き修正用) */
  reverse(): void {
    this.x.reverse();
    this.y.reverse();
  }

  /** 全節点が有限値か */
  isFinite(): boolean {
    const { x, y } = this;
    for (let i = 0; i < x.length; i++) {
      if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) return false;
    }
    return true;
  }
}

/* -------------------------------------------------------------- 1 ステップ */

/** 変位のスクラッチ(全曲線で共用。曲線ごとに順番に処理するため衝突しない) */
let scratchDx = new Float64Array(256);
let scratchDy = new Float64Array(256);

function ensureScratch(n: number): void {
  if (scratchDx.length < n) {
    const cap = 1 << Math.ceil(Math.log2(n));
    scratchDx = new Float64Array(cap);
    scratchDy = new Float64Array(cap);
  }
}

/**
 * 曲線を 1 ステップ動かす。open 曲線の両端(固定点)は動かさない。
 *
 * 各節点で隣接 3 点から接線 t̂ と符号付き曲率 κ(外接円 = Menger 曲率)を
 * 評価し、v = M (τ b + T κ) を左法線 n̂ = (-t_y, t_x) 方向に与える。
 * 反時計回りに曲がる(左に曲がる)とき κ > 0。
 */
export function stepCurve(c: Curve, tau: number, p: LineParams): void {
  const n = c.n;
  if (n < 3) return;
  ensureScratch(n);
  const { x, y } = c;
  const start = c.closed ? 0 : 1;
  const end = c.closed ? n : n - 1;
  const fApplied = tau * p.burgers;

  for (let i = start; i < end; i++) {
    const ia = i === 0 ? n - 1 : i - 1;
    const ic = i === n - 1 ? 0 : i + 1;
    const ux = x[i] - x[ia];
    const uy = y[i] - y[ia];
    const wx = x[ic] - x[i];
    const wy = y[ic] - y[i];
    const cx = x[ic] - x[ia];
    const cy = y[ic] - y[ia];
    const la = Math.hypot(ux, uy);
    const lb = Math.hypot(wx, wy);
    const lc = Math.hypot(cx, cy);
    if (la === 0 || lb === 0 || lc === 0) {
      scratchDx[i] = 0;
      scratchDy[i] = 0;
      continue;
    }
    const cross = ux * wy - uy * wx;
    const kappa = (2 * cross) / (la * lb * lc);
    let v = p.mobility * (fApplied + p.tension * kappa);
    if (v > p.vMax) v = p.vMax;
    else if (v < -p.vMax) v = -p.vMax;
    const s = (v * p.dt) / lc;
    // 左法線 n̂ = (-t_y, t_x)(数学座標系で接線を +90° 回転)
    scratchDx[i] = -cy * s;
    scratchDy[i] = cx * s;
  }

  for (let i = start; i < end; i++) {
    x[i] += scratchDx[i];
    y[i] += scratchDy[i];
  }
}

/* ---------------------------------------------------------------- リメッシュ */

/**
 * 節点間隔を目標 s0(× s0Scale)に保つ。SPLIT_FACTOR 倍を超える線分は
 * 中点分割し、MERGE_FACTOR 倍未満の線分は中点へ結合する。
 * open 曲線では固定点に隣接する線分の結合は行わない(§5.5)。
 * 変更が不要なら配列を作り直さない。
 */
export function remeshCurve(c: Curve, p: LineParams): void {
  const s0 = p.s0 * c.s0Scale;
  const splitLen = s0 * SPLIT_FACTOR;
  const mergeLen = s0 * MERGE_FACTOR;
  const { x, y } = c;
  const n = c.n;
  const segCount = c.closed ? n : n - 1;

  // 変更の要不要を先に走査(毎ステップの配列再構築を避ける)
  let needs = false;
  for (let i = 0; i < segCount; i++) {
    const j = (i + 1) % n;
    const d = Math.hypot(x[j] - x[i], y[j] - y[i]);
    if (d > splitLen) {
      needs = true;
      break;
    }
    if (d < mergeLen) {
      const pinAdjacent = !c.closed && (i === 0 || j === n - 1);
      if (!pinAdjacent && n > (c.closed ? LOOP_MIN_NODES : 4)) {
        needs = true;
        break;
      }
    }
  }
  if (!needs) return;

  const nx: number[] = [];
  const ny: number[] = [];
  const lastIdx = n - 1;
  let skipNext = false;
  for (let i = 0; i < n; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    const isLastPoint = !c.closed && i === lastIdx;
    if (isLastPoint) {
      nx.push(x[i]);
      ny.push(y[i]);
      break;
    }
    const j = (i + 1) % n;
    const d = Math.hypot(x[j] - x[i], y[j] - y[i]);
    const pinAdjacent = !c.closed && (i === 0 || j === lastIdx);
    if (d < mergeLen && !pinAdjacent && (c.closed || j !== lastIdx)) {
      // 2 節点を中点 1 点へ結合
      nx.push((x[i] + x[j]) / 2);
      ny.push((y[i] + y[j]) / 2);
      skipNext = true;
      continue;
    }
    nx.push(x[i]);
    ny.push(y[i]);
    if (d > splitLen) {
      nx.push((x[i] + x[j]) / 2);
      ny.push((y[i] + y[j]) / 2);
    }
  }
  // 閉曲線で最終セグメントの結合により先頭が消えるケースは扱わない
  // (次パスで解消される)。節点数の下限を保証する。
  if (nx.length >= (c.closed ? 3 : 2)) {
    c.x = nx;
    c.y = ny;
  }
}

/* ---------------------------------------------------------------- 相殺判定 */

/** 相殺(セグメント中点・接線のスクラッチ) */
let segMx = new Float64Array(256);
let segMy = new Float64Array(256);
let segTx = new Float64Array(256);
let segTy = new Float64Array(256);

function ensureSegScratch(n: number): void {
  if (segMx.length < n) {
    const cap = 1 << Math.ceil(Math.log2(n));
    segMx = new Float64Array(cap);
    segMy = new Float64Array(cap);
    segTx = new Float64Array(cap);
    segTy = new Float64Array(cap);
  }
}

/**
 * open 曲線の自己相殺(再結合)。非隣接の線分ペアで、中点間距離が
 * 1.2 s0 未満かつ接線がほぼ逆向き(t̂a·t̂b < -0.7)のとき、つなぎ替えて
 * 「固定点間の新しい開いた線分」と「閉じたループ」に分離する(§5.5)。
 *
 * 見つかったら曲線 c を開いた線分に書き換え、切り離したループを返す。
 * 見つからなければ null。
 */
export function tryRecombine(c: Curve, p: LineParams): Curve | null {
  const n = c.n;
  const segCount = n - 1;
  if (segCount < RECOMBINE_MIN_SEP + 2) return null;
  ensureSegScratch(segCount);
  const { x, y } = c;
  const dLim = RECOMBINE_DIST_FACTOR * p.s0;
  const dLim2 = dLim * dLim;

  for (let i = 0; i < segCount; i++) {
    segMx[i] = (x[i] + x[i + 1]) / 2;
    segMy[i] = (y[i] + y[i + 1]) / 2;
    const dx = x[i + 1] - x[i];
    const dy = y[i + 1] - y[i];
    const len = Math.hypot(dx, dy) || 1;
    segTx[i] = dx / len;
    segTy[i] = dy / len;
  }

  // 相殺は応力と逆側(y < 0)へ回り込んだ腕どうしで起きる。
  // 上側(拡大前線)のペアは判定しない(高速化 + 誤検出防止)。
  for (let i = 0; i < segCount; i++) {
    if (segMy[i] > 0) continue;
    for (let j = i + RECOMBINE_MIN_SEP; j < segCount; j++) {
      if (segMy[j] > 0) continue;
      const dx = segMx[j] - segMx[i];
      if (dx > dLim || dx < -dLim) continue;
      const dy = segMy[j] - segMy[i];
      if (dx * dx + dy * dy > dLim2) continue;
      const dot = segTx[i] * segTx[j] + segTy[i] * segTy[j];
      if (dot >= RECOMBINE_DOT_MAX) continue;

      // つなぎ替え: 開いた線分 = P_0..P_i + P_{j+1}..P_{n-1}
      //             ループ     = P_{i+1}..P_j(閉)
      const loopX = x.slice(i + 1, j + 1);
      const loopY = y.slice(i + 1, j + 1);
      const openX = x.slice(0, i + 1).concat(x.slice(j + 1));
      const openY = y.slice(0, i + 1).concat(y.slice(j + 1));
      c.x = openX;
      c.y = openY;
      return new Curve(loopX, loopY, true);
    }
  }
  return null;
}

/* ---------------------------------------------------- フランク・リード源全体 */

/** advance() が 1 回の呼び出しで報告するイベント */
export interface SimEvents {
  /** このフレーム中に相殺(ループ切り離し)が起きたか */
  recombined: boolean;
  /** 縮んで消滅したループの数(τ を下げたときなど) */
  collapsedLoops: number;
  /** 数値破綻(NaN)を検出したか。検出時は呼び出し側で reset すること */
  nan: boolean;
}

/**
 * フランク・リード源のシミュレーション。
 * 固定点は (±L/2, 0)(L = 1)。source が固定点間の開いた線分、
 * loops が放出済みの閉ループ。
 */
export class FrankReadSim {
  readonly p: LineParams;
  readonly pinAx = -SOURCE_LENGTH / 2;
  readonly pinBx = SOURCE_LENGTH / 2;
  readonly pinY = 0;
  /** せん断応力(無次元。τ_c^sim = 2) */
  tau = 0;
  source!: Curve;
  loops: Curve[] = [];
  /** 累積シミュレーション時間 */
  time = 0;
  private stepCount = 0;
  private acc = 0;

  constructor(params?: Partial<LineParams>) {
    this.p = { ...DEFAULT_LINE_PARAMS, ...params };
    this.reset();
  }

  /** 初期状態(固定点間の直線)へ戻す。決定論的(乱数不使用) */
  reset(): void {
    const n = Math.round(SOURCE_LENGTH / this.p.s0) + 1;
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < n; i++) {
      x.push(this.pinAx + (SOURCE_LENGTH * i) / (n - 1));
      y.push(0);
    }
    this.source = new Curve(x, y, false);
    this.loops = [];
    this.time = 0;
    this.stepCount = 0;
    this.acc = 0;
  }

  /** id 指定でループを除去する(ステージ外へ抜けた扱いなど) */
  removeLoop(id: number): void {
    const idx = this.loops.findIndex((l) => l.id === id);
    if (idx >= 0) this.loops.splice(idx, 1);
  }

  /**
   * シミュレーション時間 dtSim ぶんだけ固定ステップで進める。
   * イベントは out に書き込む(毎フレームの割当てを避ける)。
   */
  advance(dtSim: number, out: SimEvents): void {
    out.recombined = false;
    out.collapsedLoops = 0;
    out.nan = false;
    this.acc += dtSim;
    let steps = Math.floor(this.acc / this.p.dt);
    if (steps > MAX_STEPS_PER_ADVANCE) {
      steps = MAX_STEPS_PER_ADVANCE;
      this.acc = 0;
    } else {
      this.acc -= steps * this.p.dt;
    }
    for (let s = 0; s < steps; s++) this.stepOnce(out);
  }

  private stepOnce(out: SimEvents): void {
    const p = this.p;
    stepCurve(this.source, this.tau, p);
    for (const loop of this.loops) stepCurve(loop, this.tau, p);
    this.stepCount++;
    this.time += p.dt;

    if (this.stepCount % REMESH_EVERY === 0) {
      remeshCurve(this.source, p);
      for (let i = this.loops.length - 1; i >= 0; i--) {
        const loop = this.loops[i];
        // 大きなループは節点間隔を粗くして節点数を抑える(§8.3)
        const perim = loop.perimeter();
        loop.s0Scale = Math.max(1, perim / (LOOP_TARGET_NODES * p.s0));
        remeshCurve(loop, p);
        if (
          loop.n < LOOP_MIN_NODES ||
          perim < LOOP_MIN_PERIMETER_FACTOR * p.s0
        ) {
          this.loops.splice(i, 1);
          out.collapsedLoops++;
        }
      }
    }

    if (this.stepCount % RECOMBINE_EVERY === 0) {
      // 腕が固定点の背後(y < 0)へ回り込んでいるときだけ判定する
      if (this.source.minY() < -p.s0) {
        const loop = tryRecombine(this.source, p);
        if (loop) {
          this.orientLoop(loop);
          this.loops.push(loop);
          remeshCurve(this.source, p);
          out.recombined = true;
        }
      }
    }

    if (this.stepCount % NAN_CHECK_EVERY === 0) {
      if (!this.source.isFinite()) {
        out.nan = true;
        return;
      }
      for (const loop of this.loops) {
        if (!loop.isFinite()) {
          out.nan = true;
          return;
        }
      }
    }
  }

  /**
   * 切り離した主ループの向きを「応力で拡大する向き」(数学座標系で時計回り)
   * に揃える(§5.5)。判定は符号付き面積。固定点を囲まない小ループ
   * (2 次的なつまみ切り)は向きを保存し、自然に縮んで消える。
   */
  private orientLoop(loop: Curve): void {
    if (!loop.containsPoint(0, 0)) return;
    if (loop.signedArea() > 0) loop.reverse();
  }
}

/* ------------------------------------------------------------ 弧の解析解 */

/**
 * 固定点間隔 L・たわみ h の円弧の半径 R(h) = L²/(8h) + h/2(§5.4)。
 * h > L/2 では優弧になる。全 h > 0 で有効。
 */
export function arcRadiusFromSag(h: number, L: number): number {
  return (L * L) / (8 * h) + h / 2;
}

/** 半径 R の劣弧のたわみ h = R − √(R² − L²/4)(τ < τ_c の安定解) */
export function sagFromRadius(R: number, L: number): number {
  const half = L / 2;
  const d = Math.max(R * R - half * half, 0);
  return R - Math.sqrt(d);
}

/** 形を保つのに必要な応力 τ_req(h) = T / (b R(h))(§5.4) */
export function tauRequiredForSag(
  h: number,
  L: number,
  tension: number,
  burgers: number,
): number {
  return tension / (burgers * arcRadiusFromSag(h, L));
}

/**
 * 固定点 (±L/2, 0) を通りたわみ h の円弧を n 点でサンプルする
 * (世界座標・+y 上向き)。out は長さ 2n の平坦配列 [x0, y0, x1, y1, ...]。
 * h > L/2 では優弧になる(図4)。h ≈ 0 は直線を返す。
 */
export function sampleArcPoints(
  h: number,
  L: number,
  n: number,
  out: Float64Array,
): void {
  if (h < L * 1e-4) {
    for (let i = 0; i < n; i++) {
      out[2 * i] = -L / 2 + (L * i) / (n - 1);
      out[2 * i + 1] = 0;
    }
    return;
  }
  const R = arcRadiusFromSag(h, L);
  const cy = h - R;
  let a0 = Math.atan2(-cy, -L / 2);
  const a1 = Math.atan2(-cy, L / 2);
  if (a0 < Math.PI / 2) a0 += Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / (n - 1);
    out[2 * i] = R * Math.cos(a);
    out[2 * i + 1] = cy + R * Math.sin(a);
  }
}
