/**
 * lattice.ts — サイト格子と空孔交換モンテカルロ(記事仕様 §5.0・§5.2)
 *
 * 格子そのものは **`src/widgets/_shared/lattice2d.ts` の `DislocLattice2D` を
 * `mode = "rigid"` で再利用する**(転位なしの完全正方格子として使う)。
 * 格子の幾何を自前で書き直さないこと(依頼文 §4「必ず再利用する」)。
 *
 * 座標は格子単位(格子間隔 = 1)・y 上向き。描画層(draw.ts の LatticeView)で
 * Canvas の y 下向きへ反転する。
 *
 * 簡略化(母体仕様 §2-5): 2D 正方格子。空孔の数は実際の平衡濃度(高温でも
 * 〜10⁻⁴)より桁で多い。跳躍にエネルギー的なバイアスは入れない(この図の
 * 主題は「機構」であって偏析ではない)。
 */

import { mulberry32 } from "../../../core/mathx";
import { DislocLattice2D } from "../../_shared/lattice2d";

/** サイトの占有状態 */
export const SITE_VACANCY = 0;
/** A 原子(Cu = 母相。--mat-matrix) */
export const SITE_A = 1;
/** B 原子(Zn = 拡散対のもう一方。--mat-second) */
export const SITE_B = 2;

export interface SiteGrid {
  /** 列数 */
  cols: number;
  /** 行数(上下半分の合計) */
  rows: number;
  count: number;
  /** サイトの物理座標(格子単位・y 上向き)。index = row * cols + col */
  px: Float64Array;
  py: Float64Array;
}

/**
 * 完全正方格子のサイト座標を作る(`DislocLattice2D` の rigid モードを利用)。
 *
 * `DislocLattice2D` は「すべり面 y = 0 の上下に半分ずつ」という構成なので、
 * rowsPerHalf を渡して合計 2·rowsPerHalf 行の格子にする。行 0 が最下段。
 * x は 0 中心へ、y は上下対称(±0.5, ±1.5, …)になるよう平行移動する。
 */
export function buildSiteGrid(cols: number, rowsPerHalf: number): SiteGrid {
  const lattice = new DislocLattice2D(cols, rowsPerHalf);
  lattice.mode = "rigid";
  const rows = rowsPerHalf * 2;
  const count = cols * rows;
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  const xShift = -(cols - 1) / 2;
  let k = 0;
  // 下半分(y = −(rowsPerHalf−0.5) … −0.5)を下から詰める
  for (let r = rowsPerHalf - 1; r >= 0; r--) {
    for (let i = 0; i < cols; i++) {
      px[k] = lattice.lowerX(i) + xShift;
      py[k] = lattice.lowerY(i, r);
      k++;
    }
  }
  // 上半分(y = +0.5 … +(rowsPerHalf−0.5))
  for (let r = 0; r < rowsPerHalf; r++) {
    for (let j = 0; j < cols; j++) {
      px[k] = lattice.upperX(j) + xShift;
      py[k] = lattice.upperY(j, r);
      k++;
    }
  }
  return { cols, rows, count, px, py };
}

/**
 * 格子の隙間(セル中心)のサイト座標を作る(侵入型原子の通り道 — §5.2)。
 * サイト格子の隣り合う 4 点の中心なので、(cols−1) × (rows−1) 個になる。
 */
export function buildInterstitialGrid(grid: SiteGrid): SiteGrid {
  const cols = grid.cols - 1;
  const rows = grid.rows - 1;
  const count = cols * rows;
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  let k = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * grid.cols + c;
      const b = (r + 1) * grid.cols + c + 1;
      px[k] = (grid.px[a] + grid.px[b]) / 2;
      py[k] = (grid.py[a] + grid.py[b]) / 2;
      k++;
    }
  }
  return { cols, rows, count, px, py };
}

/** 4 近傍の相対方向(右・左・上・下) */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * 空孔交換モンテカルロ(記事仕様 §5.2)。
 *
 * 1 ステップ = 各空孔が 1 回、4 近傍から等確率に選んだサイトの原子と席を
 * 交換する試行を行う(格子の外は棄却)。結果として空孔がランダムウォークし、
 * 原子は「空孔が隣に来たときだけ」1 席動く。
 *
 * 描画の補間のため、サイトごとに「いまの占有者がどのサイトから来たか」
 * (fromSite)と「そこからの経過時間」(hopT)を保持する。
 */
export class VacancyExchange {
  readonly grid: SiteGrid;
  /** 各サイトの占有(SITE_VACANCY / SITE_A / SITE_B) */
  readonly occupancy: Uint8Array;
  /** 空孔のサイト index */
  readonly vacancies: Int32Array;
  /** 直前の移動元サイト(−1 = 移動していない)。補間の始点に使う */
  readonly fromSite: Int32Array;
  /** 移動からの経過秒(補間用) */
  readonly hopT: Float64Array;
  /** 追跡原子のサイト index と、動いた回数 */
  trackedSite = 0;
  trackedHops = 0;
  /** 実行した交換の回数(全空孔の合計) */
  exchanges = 0;

  private readonly seed: number;
  private readonly bCount: number;
  private rand: () => number;

  /**
   * @param grid サイト格子
   * @param vacancyCount 空孔の個数(誇張値。図注で明示する)
   * @param bCount B 原子(Zn)の個数
   * @param seed 乱数シード(reset の再現性 — §8.2)
   */
  constructor(
    grid: SiteGrid,
    vacancyCount: number,
    bCount: number,
    seed: number,
  ) {
    this.grid = grid;
    this.occupancy = new Uint8Array(grid.count);
    this.vacancies = new Int32Array(vacancyCount);
    this.fromSite = new Int32Array(grid.count);
    this.hopT = new Float64Array(grid.count);
    this.seed = seed;
    this.bCount = bCount;
    this.rand = mulberry32(seed);
    this.init();
  }

  /** シード固定の初期配置へ戻す(reset で毎回同一 — §8.2) */
  init(): void {
    this.rand = mulberry32(this.seed);
    const { occupancy, grid } = this;
    occupancy.fill(SITE_A);
    this.fromSite.fill(-1);
    this.hopT.fill(0);
    // 追跡原子は中央のサイトに固定する(空孔・B 原子はここを避ける)
    const center =
      Math.floor(grid.rows / 2) * grid.cols + Math.floor(grid.cols / 2);
    this.trackedSite = center;
    // 空孔を散らす(中央 = 追跡原子のサイトは空けない)
    for (let v = 0; v < this.vacancies.length; v++) {
      let s = this.pickSite();
      while (s === center || occupancy[s] === SITE_VACANCY) s = this.pickSite();
      occupancy[s] = SITE_VACANCY;
      this.vacancies[v] = s;
    }
    // B 原子(Zn)を散らす
    for (let i = 0; i < this.bCount; i++) {
      let s = this.pickSite();
      while (s === center || occupancy[s] !== SITE_A) s = this.pickSite();
      occupancy[s] = SITE_B;
    }
    this.trackedHops = 0;
    this.exchanges = 0;
  }

  private pickSite(): number {
    return Math.floor(this.rand() * this.grid.count);
  }

  /** サイト index → 列・行 */
  private colOf(site: number): number {
    return site % this.grid.cols;
  }

  private rowOf(site: number): number {
    return Math.floor(site / this.grid.cols);
  }

  /**
   * 1 MC ステップ。animate = false のときは補間せず即時表示にする
   * (×100 の高速表示用)。
   */
  step(animate: boolean): void {
    const { grid, occupancy } = this;
    for (let v = 0; v < this.vacancies.length; v++) {
      const site = this.vacancies[v];
      const col = this.colOf(site);
      const row = this.rowOf(site);
      const dir = DIRS[Math.floor(this.rand() * 4)];
      const nCol = col + dir[0];
      const nRow = row + dir[1];
      if (nCol < 0 || nCol >= grid.cols || nRow < 0 || nRow >= grid.rows) {
        continue; // 格子の外は棄却(壁)
      }
      const nSite = nRow * grid.cols + nCol;
      if (occupancy[nSite] === SITE_VACANCY) continue; // 空孔同士は交換しない
      // 席の交換: 隣の原子が空孔サイトへ移り、空孔が隣サイトへ移る
      occupancy[site] = occupancy[nSite];
      occupancy[nSite] = SITE_VACANCY;
      this.vacancies[v] = nSite;
      this.fromSite[site] = animate ? nSite : -1;
      this.hopT[site] = 0;
      this.fromSite[nSite] = -1;
      this.exchanges++;
      if (this.trackedSite === nSite) {
        this.trackedSite = site;
        this.trackedHops++;
      }
    }
  }

  /** 補間の経過時間を進める(見た目のみ。物理には影響しない) */
  advanceAnimation(dt: number, hopAnimS: number): void {
    const { hopT, fromSite } = this;
    for (let i = 0; i < hopT.length; i++) {
      if (fromSite[i] >= 0) {
        hopT[i] += dt;
        if (hopT[i] >= hopAnimS) fromSite[i] = -1;
      }
    }
  }
}

/**
 * 侵入型原子(C, N)のランダムウォーク(記事仕様 §5.2 の対比用)。
 * 隙間のサイト網を、空孔を待たずに自由に渡り歩く(占有の排他のみ課す)。
 */
export class InterstitialWalkers {
  readonly grid: SiteGrid;
  /** 各原子のサイト index */
  readonly site: Int32Array;
  /** 補間の始点サイト(−1 = 補間なし)と経過秒 */
  readonly fromSite: Int32Array;
  readonly hopT: Float64Array;
  private readonly occupied: Uint8Array;
  private readonly seed: number;
  private rand: () => number;

  constructor(grid: SiteGrid, count: number, seed: number) {
    this.grid = grid;
    this.site = new Int32Array(count);
    this.fromSite = new Int32Array(count);
    this.hopT = new Float64Array(count);
    this.occupied = new Uint8Array(grid.count);
    this.seed = seed;
    this.rand = mulberry32(seed);
    this.init();
  }

  init(): void {
    this.rand = mulberry32(this.seed);
    this.occupied.fill(0);
    this.fromSite.fill(-1);
    this.hopT.fill(0);
    for (let i = 0; i < this.site.length; i++) {
      let s = Math.floor(this.rand() * this.grid.count);
      while (this.occupied[s] !== 0)
        s = Math.floor(this.rand() * this.grid.count);
      this.occupied[s] = 1;
      this.site[i] = s;
    }
  }

  /** 1 ステップ: 各原子が 4 近傍のいずれかへ跳ぶ試行を 1 回行う */
  step(animate: boolean): void {
    const { grid, occupied } = this;
    for (let i = 0; i < this.site.length; i++) {
      const s = this.site[i];
      const col = s % grid.cols;
      const row = Math.floor(s / grid.cols);
      const dir = DIRS[Math.floor(this.rand() * 4)];
      const nCol = col + dir[0];
      const nRow = row + dir[1];
      if (nCol < 0 || nCol >= grid.cols || nRow < 0 || nRow >= grid.rows)
        continue;
      const nSite = nRow * grid.cols + nCol;
      if (occupied[nSite] !== 0) continue;
      occupied[s] = 0;
      occupied[nSite] = 1;
      this.site[i] = nSite;
      this.fromSite[i] = animate ? s : -1;
      this.hopT[i] = 0;
    }
  }

  advanceAnimation(dt: number, hopAnimS: number): void {
    for (let i = 0; i < this.site.length; i++) {
      if (this.fromSite[i] >= 0) {
        this.hopT[i] += dt;
        if (this.hopT[i] >= hopAnimS) this.fromSite[i] = -1;
      }
    }
  }
}
