/**
 * stm.ts — 走査トンネル顕微鏡の模型(仕様書 14 §5.4〜§5.6)
 *
 * **電流**(探針の先端を点とみなす最も単純な模型。テルソフ=ハマンの s 波近似に相当):
 *
 *   I = I_ref Σ_a w_a exp(−2κ(|r_tip − r_a| − z_ref))   [nA]
 *
 * z_ref = 0.6 nm・I_ref = 1 nA は「原子 1 個の真上 0.6 nm で 1 nA」という基準。
 * w_a は原子ごとの重み(図5 では全原子 1、空孔は 0。図6 ではバイアスの窓に入る
 * 状態の量 — LDOS)。和は探針に近い 7×7 個の格子点と、格子にない原子
 * (吸着原子)だけでとる(§5.5)。
 *
 * **フィードバック**(対数比例制御):
 *
 *   z ← z + g (ln I − ln I_set)/(2κ)
 *
 * ln I が z にほぼ比例する(ln I ≈ −2κz + 定数)ので、高さの誤差は 1 回ごとに
 * (1 − g) 倍になる。0 < g < 1 で滑らかに追従、1 < g < 2 で振動しながら収束、
 * g > 2 で発散する(T4)。この振る舞いは式から自然に出てくるもので、作り込まない。
 */

import { clamp, gaussian, mulberry32 } from "../../../core/mathx";
import {
  ADATOM_HEIGHT_NM,
  I_REF_NA,
  I_SET_NA,
  IMAGE_PIXELS,
  IMAGE_SIZE_NM,
  WORK_FUNCTION_EV,
  Z_REF_NM,
} from "./constants";
import { kappa } from "./tunneling";

/** 既定の仕事関数での 2κ [nm⁻¹](= 21.7) */
export const TWO_KAPPA = 2 * kappa(WORK_FUNCTION_EV);

/** 和をとる近傍の格子点の数(片側)。7×7 = 49 個 */
const NEIGHBOR_HALF = 3;
/** 格子の外側に置く余白の格子点の数(像の端でも 7×7 がそろうように) */
const LATTICE_MARGIN = 4;
/** 吸着原子を電流の和に入れる水平距離の上限 [nm] */
const EXTRA_CUTOFF_NM = 1.6;

/* ------------------------------------------------- 距離と電流の関係(図4) */

/** 距離が dz [nm] 違う 2 つの原子が運ぶ電流の比 e^{2κ·dz}(φ [eV]) */
export function currentRatio(phi: number, dz: number): number {
  return Math.exp(2 * kappa(phi) * dz);
}

/** 探針の先端の原子と、その奥の原子の段(先端より dz 遠い原子が count 個) */
export interface TipLayer {
  dz: number;
  count: number;
}

/**
 * 先端の原子 1 個が運ぶ電流の割合 1/(1 + Σ count·e^{−2κ·dz})。
 * 既定は仕様書 §5.4 のとおり「1 段奥の原子 1 個(先端より 0.25 nm 遠い)」と比べる。
 * φ = 4.5 eV で 229 倍の差 → 99.57%。
 */
export function apexFraction(
  phi: number,
  layers: readonly TipLayer[] = [{ dz: 0.25, count: 1 }],
): number {
  let rest = 0;
  for (const l of layers) rest += l.count / currentRatio(phi, l.dz);
  return 1 / (1 + rest);
}

/** すき間 z [nm] での電流 I = I_ref e^{−2κ(z − z_ref)} [nA](式 E4。原子 1 個の真上) */
export function gapCurrent(z: number, phi = WORK_FUNCTION_EV): number {
  return I_REF_NA * Math.exp(-2 * kappa(phi) * (z - Z_REF_NM));
}

/* ------------------------------------------------------------ 表面 */

export interface SurfacePoint {
  x: number;
  y: number;
}

/**
 * 正方格子の表面。格子点 (i, j) の位置は (offset + i·a, offset + j·a)、
 * i, j = −margin … cells + margin。原子の中心はすべて高さ 0。
 * 格子にない原子(吸着原子)は extra* に別に持つ。
 */
export interface Surface {
  spacing: number;
  offset: number;
  margin: number;
  /** 像の中に入る格子の区間の数(1 辺あたりの格子点は cells + 1 個) */
  cells: number;
  /** 配列の 1 辺の格子点の数 = cells + 2·margin + 1 */
  side: number;
  /** 格子点の重み(原子があれば 1、空孔は 0) */
  weight: Float64Array;
  /** 格子点の種類(0 = A、1 = B。2 種類の原子の表面は市松模様) */
  kind: Uint8Array;
  /** 種類ごとの重みの倍率(図6 の LDOS。既定は 1, 1) */
  kindWeight: Float64Array;
  extraX: Float64Array;
  extraY: Float64Array;
  extraZ: Float64Array;
  extraW: Float64Array;
  extraCount: number;
  /** 欠陥の位置(像の読み取りで欠陥のまわりを除くため) */
  vacancy: SurfacePoint | null;
  adatom: SurfacePoint | null;
}

export interface SurfaceOptions {
  /** 空孔と吸着原子を 1 つずつ入れる(図5) */
  defects?: boolean;
  /** 欠陥の位置を決める乱数のシード */
  seed?: number;
  /** 2 種類の原子を市松模様に並べる(図6) */
  checkerboard?: boolean;
  /** 像の 1 辺 [nm] */
  size?: number;
}

/** 欠陥を置く範囲: 像の中心から ±この距離 [nm] の正方形の中(走査線の中央付近) */
const DEFECT_BOX_HALF_NM = 0.75;
/** 空孔と吸着原子のあいだに空ける最小の距離 [nm] */
const DEFECT_MIN_SEPARATION_NM = 0.9;

/** 正方格子の表面を作る(初期化時・表面の切り替え時だけ呼ぶ) */
export function createSurface(
  spacing: number,
  opts: SurfaceOptions = {},
): Surface {
  const size = opts.size ?? IMAGE_SIZE_NM;
  const cells = Math.floor(size / spacing + 1e-9);
  const offset = (size - cells * spacing) / 2;
  const margin = LATTICE_MARGIN;
  const side = cells + 2 * margin + 1;
  const weight = new Float64Array(side * side).fill(1);
  const kind = new Uint8Array(side * side);
  if (opts.checkerboard) {
    for (let i = 0; i < side; i++) {
      for (let j = 0; j < side; j++) {
        kind[i * side + j] = (i + j) % 2;
      }
    }
  }
  const s: Surface = {
    spacing,
    offset,
    margin,
    cells,
    side,
    weight,
    kind,
    kindWeight: new Float64Array([1, 1]),
    extraX: new Float64Array(1),
    extraY: new Float64Array(1),
    extraZ: new Float64Array(1),
    extraW: new Float64Array(1),
    extraCount: 0,
    vacancy: null,
    adatom: null,
  };
  if (opts.defects) {
    const rand = mulberry32(opts.seed ?? 1);
    const center = size / 2;
    const inBox = (p: number, half: number): boolean =>
      Math.abs(p - center) <= half + 1e-9;
    // 空孔の候補: 像の中心付近の格子点
    const sites: Array<[number, number]> = [];
    for (let i = 0; i <= cells; i++) {
      for (let j = 0; j <= cells; j++) {
        const x = offset + i * spacing;
        const y = offset + j * spacing;
        if (inBox(x, DEFECT_BOX_HALF_NM) && inBox(y, DEFECT_BOX_HALF_NM)) {
          sites.push([i, j]);
        }
      }
    }
    const [vi, vj] = sites[Math.floor(rand() * sites.length)];
    // 吸着原子の候補: 4 つの原子の間のくぼみ (i + ½, j + ½)。空孔から離す
    const hollows: Array<[number, number]> = [];
    const wider = DEFECT_BOX_HALF_NM + DEFECT_MIN_SEPARATION_NM / 3;
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < cells; j++) {
        const x = offset + (i + 0.5) * spacing;
        const y = offset + (j + 0.5) * spacing;
        const far =
          Math.hypot((i + 0.5 - vi) * spacing, (j + 0.5 - vj) * spacing) >=
          DEFECT_MIN_SEPARATION_NM;
        if (far && inBox(x, wider) && inBox(y, wider)) hollows.push([i, j]);
      }
    }
    const [ai, aj] = hollows[Math.floor(rand() * hollows.length)];
    s.weight[(vi + margin) * side + (vj + margin)] = 0;
    s.vacancy = { x: offset + vi * spacing, y: offset + vj * spacing };
    s.adatom = {
      x: offset + (ai + 0.5) * spacing,
      y: offset + (aj + 0.5) * spacing,
    };
    s.extraX[0] = s.adatom.x;
    s.extraY[0] = s.adatom.y;
    s.extraZ[0] = ADATOM_HEIGHT_NM;
    s.extraW[0] = 1;
    s.extraCount = 1;
  }
  return s;
}

/** 格子点 (i, j)(配列の添字ではなく格子の番号)の位置 */
export function sitePosition(
  s: Surface,
  i: number,
  j: number,
  out: SurfacePoint,
): SurfacePoint {
  out.x = s.offset + i * s.spacing;
  out.y = s.offset + j * s.spacing;
  return out;
}

/**
 * 探針の先端が (x, y, z) にあるときのトンネル電流 [nA]。
 * twoKappa は 2κ [nm⁻¹](既定は φ = 4.5 eV)。
 */
export function tipCurrent(
  s: Surface,
  x: number,
  y: number,
  z: number,
  twoKappa = TWO_KAPPA,
): number {
  const a = s.spacing;
  const i0 = Math.round((x - s.offset) / a);
  const j0 = Math.round((y - s.offset) / a);
  const z2 = z * z;
  let sum = 0;
  for (let di = -NEIGHBOR_HALF; di <= NEIGHBOR_HALF; di++) {
    const ii = clamp(i0 + di, -s.margin, s.cells + s.margin) + s.margin;
    const dx = x - (s.offset + (ii - s.margin) * a);
    for (let dj = -NEIGHBOR_HALF; dj <= NEIGHBOR_HALF; dj++) {
      const jj = clamp(j0 + dj, -s.margin, s.cells + s.margin) + s.margin;
      const idx = ii * s.side + jj;
      const w = s.weight[idx] * s.kindWeight[s.kind[idx]];
      if (w === 0) continue;
      const dy = y - (s.offset + (jj - s.margin) * a);
      const r = Math.sqrt(dx * dx + dy * dy + z2);
      sum += w * Math.exp(-twoKappa * (r - Z_REF_NM));
    }
  }
  for (let e = 0; e < s.extraCount; e++) {
    const dx = x - s.extraX[e];
    const dy = y - s.extraY[e];
    if (Math.abs(dx) > EXTRA_CUTOFF_NM || Math.abs(dy) > EXTRA_CUTOFF_NM)
      continue;
    const dz = z - s.extraZ[e];
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    sum += s.extraW[e] * Math.exp(-twoKappa * (r - Z_REF_NM));
  }
  return I_REF_NA * sum;
}

/** 探針の先端から、いちばん近い原子の中心までの距離 [nm](接触の判定用) */
export function nearestAtomDistance(
  s: Surface,
  x: number,
  y: number,
  z: number,
): number {
  const a = s.spacing;
  const i0 = Math.round((x - s.offset) / a);
  const j0 = Math.round((y - s.offset) / a);
  let best = Infinity;
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const ii = clamp(i0 + di, -s.margin, s.cells + s.margin) + s.margin;
      const jj = clamp(j0 + dj, -s.margin, s.cells + s.margin) + s.margin;
      if (s.weight[ii * s.side + jj] === 0) continue;
      const dx = x - (s.offset + (ii - s.margin) * a);
      const dy = y - (s.offset + (jj - s.margin) * a);
      const r = Math.sqrt(dx * dx + dy * dy + z * z);
      if (r < best) best = r;
    }
  }
  for (let e = 0; e < s.extraCount; e++) {
    const dx = x - s.extraX[e];
    const dy = y - s.extraY[e];
    const dz = z - s.extraZ[e];
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r < best) best = r;
  }
  return best;
}

/** 二分法の初期区間 [nm](この範囲に必ず解がある) */
const Z_LOW = 0.02;
const Z_HIGH = 4;
/** 高さ合わせの反復の上限と許容誤差 [nm] */
const HEIGHT_ITERATIONS = 60;
const HEIGHT_TOLERANCE = 1e-8;

/**
 * 電流が iSet になる探針の高さ z(定電流の等高線)[nm]。
 * ln I(z) は z について単調減少でほぼ直線なので、ニュートン法で解き、
 * 区間から出たら二分法に切り替える(数回の反復で収束する)。
 */
export function constantCurrentHeight(
  s: Surface,
  x: number,
  y: number,
  iSet = I_SET_NA,
  zGuess = Z_REF_NM,
  twoKappa = TWO_KAPPA,
): number {
  const target = Math.log(iSet);
  let lo = Z_LOW;
  let hi = Z_HIGH;
  let z = clamp(zGuess, lo, hi);
  const h = 1e-5;
  for (let it = 0; it < HEIGHT_ITERATIONS; it++) {
    const f = Math.log(tipCurrent(s, x, y, z, twoKappa)) - target;
    if (f > 0) lo = z;
    else hi = z;
    if (hi - lo < HEIGHT_TOLERANCE) break;
    const fp =
      (Math.log(tipCurrent(s, x, y, z + h, twoKappa)) - target - f) / h;
    let next = fp < 0 ? z - f / fp : 0.5 * (lo + hi);
    if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
    if (Math.abs(next - z) < HEIGHT_TOLERANCE) {
      z = next;
      break;
    }
    z = next;
  }
  return z;
}

/**
 * 欠陥のない正方格子の凹凸(定電流の等高線の最大 − 最小)[nm](T5)。
 * 単位胞を samples × samples 点で調べる。
 */
export function latticeCorrugation(spacing: number, samples = 21): number {
  const s = createSurface(spacing);
  const x0 = s.offset + Math.round(s.cells / 2) * spacing;
  let mn = Infinity;
  let mx = -Infinity;
  let guess = Z_REF_NM;
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const x = x0 + (spacing * i) / (samples - 1);
      const y = x0 + (spacing * j) / (samples - 1);
      const z = constantCurrentHeight(s, x, y, I_SET_NA, guess);
      guess = z;
      if (z < mn) mn = z;
      if (z > mx) mx = z;
    }
  }
  return mx - mn;
}

/** フィードバックの 1 回分: z ← z + g(ln I − ln I_set)/(2κ) */
export function feedbackUpdate(
  z: number,
  current: number,
  gain: number,
  iSet = I_SET_NA,
  twoKappa = TWO_KAPPA,
): number {
  return z + (gain * (Math.log(current) - Math.log(iSet))) / twoKappa;
}

/* ---------------------------------------------- 定電流モードの走査(図5) */

/** 接触とみなす近づきすぎの量 [nm]: 設定の距離(0.6 nm)より 0.15 nm 以上近づいたら */
export const CONTACT_MARGIN_NM = 0.15;
/** 接触したときに探針を引き上げる量 [nm] */
export const RETRACT_NM = 0.5;
/** 振動ノイズ(高さの白色ノイズの実効値)[nm] = 3 pm */
export const VIBRATION_RMS_NM = 0.003;
/** 状態の判定の時定数(画素数) */
const STATUS_WINDOW_PX = 24;
/** 「振動」「にじみ」と判定するしきい値 [nm](8 pm・10 pm) */
const OSCILLATION_THRESHOLD_NM = 0.008;
const LAG_THRESHOLD_NM = 0.01;
/** 接触のあと「接触!」を出し続ける画素数(1 行) */
const CONTACT_HOLD_PX = IMAGE_PIXELS;

export type ScanStatus =
  "idle" | "tracking" | "lag" | "oscillation" | "contact";

export interface ScanSettings {
  /** 制御の強さ g */
  gain: number;
  /** 1 画素あたりのフィードバックの回数(遅い 12・中 4・速い 1) */
  substeps: number;
  /** 振動ノイズの実効値 [nm] */
  noiseRms?: number;
  /** ノイズの乱数のシード */
  seed?: number;
}

/** 1 行のフィードバックの回数の上限(遅い 12 回 × 64 画素) */
export const MAX_SUBSTEPS = 12;

/**
 * 定電流モードのラスタ走査。上の行(像の上端 = y の大きい側)から 1 行ずつ、
 * 左から右へ 1 画素ずつ進む。画素ごとに n 回フィードバックをかけ、その間の
 * 探針の高さの平均を像の値として記録する(信号を画素の滞在時間で平均する
 * 実際の装置と同じ)。走査線の終わりで探針は高さを保ったまま左端へ戻る。
 */
export class StmScanner {
  readonly pixels = IMAGE_PIXELS;
  readonly size = IMAGE_SIZE_NM;
  readonly pixelSize = IMAGE_SIZE_NM / IMAGE_PIXELS;
  /** 像(画素ごとの探針の高さ [nm])。走査前の画素は NaN */
  readonly image = new Float64Array(IMAGE_PIXELS * IMAGE_PIXELS);
  /** いまの走査線の軌跡(フィードバック 1 回ごとの x と z) */
  readonly trajX = new Float64Array(IMAGE_PIXELS * MAX_SUBSTEPS + 1);
  readonly trajZ = new Float64Array(IMAGE_PIXELS * MAX_SUBSTEPS + 1);
  trajCount = 0;
  /** 次に走査する画素 */
  row = 0;
  col = 0;
  done = false;
  /** 探針の高さ [nm] と最後に測った電流 [nA] */
  z = Z_REF_NM;
  current = I_SET_NA;
  /** この像を撮るあいだの接触の回数 */
  contacts = 0;
  /** 走査した画素の数 */
  scanned = 0;

  surface: Surface;
  gain: number;
  substeps: number;
  private readonly noiseRms: number;
  private readonly seed: number;
  private gauss: () => number;
  private lastContactAt = -Infinity;
  private prevError = 0;
  private emaSmooth = 0;
  private emaAlt = 0;

  constructor(surface: Surface, settings: ScanSettings) {
    this.surface = surface;
    this.gain = settings.gain;
    this.substeps = settings.substeps;
    this.noiseRms = settings.noiseRms ?? VIBRATION_RMS_NM;
    this.seed = settings.seed ?? 1;
    this.gauss = gaussian(mulberry32(this.seed));
    this.reset();
  }

  /** 像を消して最初の行へ戻す(同じシード = 同じノイズ列から描き直す) */
  reset(): void {
    this.gauss = gaussian(mulberry32(this.seed));
    this.image.fill(Number.NaN);
    this.row = 0;
    this.col = 0;
    this.done = false;
    this.contacts = 0;
    this.scanned = 0;
    this.trajCount = 0;
    this.lastContactAt = -Infinity;
    this.prevError = 0;
    this.emaSmooth = 0;
    this.emaAlt = 0;
    // 最初の画素の真上で、設定電流になる高さから始める
    this.z = constantCurrentHeight(
      this.surface,
      this.pixelX(0),
      this.pixelY(0),
      I_SET_NA,
      Z_REF_NM,
    );
    this.current = I_SET_NA;
  }

  /** 列 col の画素の中心の x [nm] */
  pixelX(col: number): number {
    return (col + 0.5) * this.pixelSize;
  }

  /** 行 row の画素の中心の y [nm](行 0 が像の上端) */
  pixelY(row: number): number {
    return this.size - (row + 0.5) * this.pixelSize;
  }

  /** いま探針がいる x [nm](次に走査する画素) */
  tipX(): number {
    return this.pixelX(this.done ? this.pixels - 1 : this.col);
  }

  /** 1 画素ぶん走査する。像が完成したら false */
  stepPixel(): boolean {
    if (this.done) return false;
    const s = this.surface;
    const x = this.pixelX(this.col);
    const y = this.pixelY(this.row);
    const n = this.substeps;
    const x0 = x - this.pixelSize / 2;
    let zSum = 0;
    let lastErr = this.prevError;
    let prevErr = this.prevError;
    for (let k = 0; k < n; k++) {
      // 探針は振動ノイズのぶんだけ上下に揺れた位置で電流を流す
      const zAct = this.z + this.noiseRms * this.gauss();
      const I = tipCurrent(s, x, y, zAct);
      this.current = I;
      const err = (Math.log(I) - Math.log(I_SET_NA)) / TWO_KAPPA;
      this.z += this.gain * err;
      if (nearestAtomDistance(s, x, y, this.z) < Z_REF_NM - CONTACT_MARGIN_NM) {
        this.contacts++;
        this.lastContactAt = this.scanned;
        this.z += RETRACT_NM;
      }
      zSum += this.z;
      prevErr = lastErr;
      lastErr = err;
      if (this.trajCount < this.trajX.length) {
        this.trajX[this.trajCount] = x0 + (this.pixelSize * (k + 1)) / n;
        this.trajZ[this.trajCount] = this.z;
        this.trajCount++;
      }
    }
    this.image[this.row * this.pixels + this.col] = zSum / n;
    this.prevError = lastErr;
    // 状態の判定: 最後の 2 回の誤差を、ゆっくりした成分(にじみ)と
    // 1 回ごとに符号が変わる成分(振動)に分けて移動平均する
    const smooth = 0.5 * (lastErr + prevErr);
    const alt = 0.5 * (lastErr - prevErr);
    const a = 1 / STATUS_WINDOW_PX;
    this.emaSmooth += a * (smooth * smooth - this.emaSmooth);
    this.emaAlt += a * (alt * alt - this.emaAlt);
    this.scanned++;
    this.col++;
    if (this.col >= this.pixels) {
      this.col = 0;
      this.row++;
      if (this.row >= this.pixels) {
        this.done = true;
      } else {
        this.trajCount = 0;
      }
    }
    return !this.done;
  }

  /** 残りをすべて走査する(省モーション時の「完成像」) */
  runAll(): void {
    while (this.stepPixel()) {
      /* 走査を続ける */
    }
  }

  /** いまの状態(直近の画素のふるまいから判定する) */
  status(): ScanStatus {
    if (this.scanned === 0) return "idle";
    if (this.scanned - this.lastContactAt <= CONTACT_HOLD_PX) return "contact";
    if (Math.sqrt(this.emaAlt) > OSCILLATION_THRESHOLD_NM) return "oscillation";
    if (Math.sqrt(this.emaSmooth) > LAG_THRESHOLD_NM) return "lag";
    return "tracking";
  }
}

/* ------------------------------------------------------ 像の読み取り(図5) */

/** 欠陥のまわりの、凹凸の読み取りから除く半径 [nm] */
export const DEFECT_EXCLUSION_NM = 0.8;

export interface ImageRange {
  /** 欠陥から離れた場所の高さの最小・最大 [nm](3×3 画素でならした値) */
  lo: number;
  hi: number;
  /** 範囲が求まったか(走査した画素がまだ少ないと false) */
  valid: boolean;
}

/**
 * 実際の凹凸の読み取りと、像の濃淡の自動調整に使う高さの範囲。
 * 欠陥(空孔・吸着原子)から DEFECT_EXCLUSION_NM 以上離れた画素を、
 * 3×3 画素の平均でならして(振動ノイズをならすため)最小・最大をとる。
 * 欠陥はこの範囲を超えるので、像では濃淡の端に張り付く。
 */
export function imageRange(
  image: Float64Array,
  pixels: number,
  size: number,
  surface: Surface,
  out: ImageRange,
): ImageRange {
  const px = size / pixels;
  const r2 = DEFECT_EXCLUSION_NM * DEFECT_EXCLUSION_NM;
  let lo = Infinity;
  let hi = -Infinity;
  for (let row = 1; row < pixels - 1; row++) {
    const y = size - (row + 0.5) * px;
    for (let col = 1; col < pixels - 1; col++) {
      const x = (col + 0.5) * px;
      if (nearDefect(surface, x, y, r2)) continue;
      let sum = 0;
      let ok = true;
      for (let dr = -1; dr <= 1 && ok; dr++) {
        const base = (row + dr) * pixels + col;
        for (let dc = -1; dc <= 1; dc++) {
          const v = image[base + dc];
          if (Number.isNaN(v)) {
            ok = false;
            break;
          }
          sum += v;
        }
      }
      if (!ok) continue;
      const m = sum / 9;
      if (m < lo) lo = m;
      if (m > hi) hi = m;
    }
  }
  out.valid = hi >= lo;
  out.lo = out.valid ? lo : 0;
  out.hi = out.valid ? hi : 0;
  return out;
}

function nearDefect(s: Surface, x: number, y: number, r2: number): boolean {
  if (s.vacancy) {
    const dx = x - s.vacancy.x;
    const dy = y - s.vacancy.y;
    if (dx * dx + dy * dy < r2) return true;
  }
  if (s.adatom) {
    const dx = x - s.adatom.x;
    const dy = y - s.adatom.y;
    if (dx * dx + dy * dy < r2) return true;
  }
  return false;
}

/* ------------------------------------------ バイアスの窓と LDOS(図6) */

/** 図6 の試料の状態: A 原子の詰まった状態と B 原子の空いた状態(E_F からの位置 [eV]) */
export const STATE_A_EV = -1.0;
export const STATE_B_EV = 1.2;
/** 状態の山の幅(ガウス型の標準偏差)[eV] */
export const STATE_WIDTH_EV = 0.3;
/** 2 種類の原子の表面の、A と B の最近接距離 [nm] */
export const AB_SPACING_NM = 0.4;

/** 標準正規分布の累積分布関数 Φ(x)(erfc の連分数を使わない近似で誤差 1e-7) */
export function normalCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26(erf の有理近似)
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly =
    t *
    (0.254829592 +
      t *
        (-0.284496736 +
          t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** ガウス型の山(中心 center、幅 width)のうち、区間 [a, b] に入る面積 */
export function peakAreaInWindow(
  center: number,
  width: number,
  a: number,
  b: number,
): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return Math.max(
    0,
    normalCdf((hi - center) / width) - normalCdf((lo - center) / width),
  );
}

export interface WindowWeights {
  /** A 原子・B 原子の状態のうち、バイアスの窓に入る割合(0〜1) */
  a: number;
  b: number;
}

/**
 * 試料のバイアス V [V] での、窓に入る状態の量(図6 の重み w)。
 * 窓は試料のフェルミ準位から E_F + qV まで: V < 0 では詰まった状態
 * [E_F + qV, E_F] から電子が探針へ出ていき、V > 0 では空いた状態
 * [E_F, E_F + qV] に探針から電子が入る(エネルギーは E_F を 0 とした eV)。
 */
export function windowWeights(bias: number, out: WindowWeights): WindowWeights {
  out.a = peakAreaInWindow(STATE_A_EV, STATE_WIDTH_EV, 0, bias);
  out.b = peakAreaInWindow(STATE_B_EV, STATE_WIDTH_EV, 0, bias);
  return out;
}

/**
 * 定電流像を一度に計算する(図6。走査のアニメーションなし)。
 * out[row·pixels + col] に探針の高さ [nm] を書く。行 0 が像の上端。
 * 隣の画素の高さを初期値にしたニュートン法なので、64×64 画素でも数 ms。
 */
export function computeConstantCurrentImage(
  s: Surface,
  out: Float64Array,
  pixels = IMAGE_PIXELS,
  size = IMAGE_SIZE_NM,
  iSet = I_SET_NA,
): void {
  const px = size / pixels;
  let guess = Z_REF_NM;
  for (let row = 0; row < pixels; row++) {
    const y = size - (row + 0.5) * px;
    let rowGuess = guess;
    for (let col = 0; col < pixels; col++) {
      const x = (col + 0.5) * px;
      const z = constantCurrentHeight(s, x, y, iSet, rowGuess);
      out[row * pixels + col] = z;
      rowGuess = z;
      if (col === 0) guess = z;
    }
  }
}
