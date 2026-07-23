/**
 * lattice2d.ts — 刃状転位入り 2D 格子の共有モジュール
 * (フランク・リード源仕様書 §5.0。コットレル雰囲気テーマとも共用する)
 *
 * 側面視の単純正方格子。すべり面(y = 0)の上半分に「余分な半原子面」を
 * 1 枚持つ刃状転位を、列の連続シフトで表現する:
 *
 *   上半分の列 j の x 座標 = j − S(j − c) + offset
 *   S(t) = (1 + tanh(t / w)) / 2(滑らかな 0 → 1 のステップ)
 *
 * c(芯の進行度)が 0 → cols と動くと、余分な半原子面が左端から右端へ
 * 渡り、上半分が下半分に対して合計 1 格子(= b)すべる。列は縦に
 * まっすぐのまま(半原子面が上へ伸びる古典的な描像)。
 *
 * mode = "rigid" では転位なしの完全結晶とし、offset で上半分を一斉に
 * ずらす(図1 の「一斉にすべらせる」モード用)。
 *
 * 簡略化: 2D 単純格子。原子位置は弾性論の厳密解ではなく、半原子面の
 * 受け渡しが伝わる模式である(§5.2)。
 */

/** 列シフトの滑らかさ(格子単位) */
const SHIFT_WIDTH = 0.85;
/** 芯近傍の上向きのふくらみ(格子単位) */
const BUMP_AMPLITUDE = 0.22;
/** ふくらみの水平方向の広がり(格子単位) */
const BUMP_SIGMA = 1.15;
/** ふくらみが行とともに減衰する係数 */
const BUMP_ROW_DECAY = 0.85;

export type LatticeMode = "rigid" | "dislocation";

/** 滑らかなステップ関数 S(t): −∞ → 0, 0 → 0.5, +∞ → 1 */
export function shiftProfile(t: number): number {
  return (1 + Math.tanh(t / SHIFT_WIDTH)) / 2;
}

export class DislocLattice2D {
  /** 下半分の列数(格子単位の幅も cols) */
  readonly cols: number;
  /** 半分(上または下)あたりの行数 */
  readonly rows: number;
  mode: LatticeMode = "dislocation";
  /** 転位芯の進行度 c(0 = 左端, cols = 右端)。連続値で補間可 */
  core = 0;
  /** 上半分の一様な追加ずれ(格子単位)。剛体モードのすべり量 */
  offset = 0;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
  }

  /** 上半分の列数(転位モードでは余分な半原子面のぶん +1) */
  upperCols(): number {
    return this.mode === "dislocation" ? this.cols + 1 : this.cols;
  }

  /** 上半分の原子 (列 j, 行 r) の x 座標(格子単位)。r は 0 が界面側 */
  upperX(j: number): number {
    if (this.mode === "rigid") return j + this.offset;
    return j - shiftProfile(j - this.core) + this.offset;
  }

  /** 上半分の原子 (列 j, 行 r) の y 座標(格子単位・上向き正) */
  upperY(j: number, r: number): number {
    let y = r + 0.5;
    if (this.mode === "dislocation") {
      const dx = this.upperX(j) - this.coreX();
      y +=
        (BUMP_AMPLITUDE / (1 + BUMP_ROW_DECAY * r)) *
        Math.exp(-(dx * dx) / (2 * BUMP_SIGMA * BUMP_SIGMA));
    }
    return y;
  }

  /** 下半分の原子 (列 i, 行 r) の x 座標。r は 0 が界面側 */
  lowerX(i: number): number {
    return i;
  }

  /** 下半分の原子 (列 i, 行 r) の y 座標(負) */
  lowerY(_i: number, r: number): number {
    return -(r + 0.5);
  }

  /** 転位芯(⊥ の位置)の x 座標(格子単位) */
  coreX(): number {
    return this.core - 0.5 + this.offset;
  }

  /**
   * 芯に近い上半分の列インデックスを列挙する(結合つなぎ替えの
   * ハイライト用)。|列位置 − 芯| < range の列を返す。
   */
  columnsNearCore(range: number, out: number[]): void {
    out.length = 0;
    if (this.mode !== "dislocation") return;
    const cx = this.coreX();
    const jc = this.upperCols();
    for (let j = 0; j < jc; j++) {
      if (Math.abs(this.upperX(j) - cx) < range) out.push(j);
    }
  }
}
