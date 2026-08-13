/**
 * zones.ts — GP ゾーンの形成モデル(記事仕様書 07 §5.4。図4 で使う)
 *
 * 2 次元の格子気体モデル。**空孔機構**で溶質(Cu)が動く:
 * 空孔の隣にある原子と空孔を入れ替える。相手が溶質のときだけ、Cu–Cu 結合の
 * 損得で受理確率を決める(メトロポリス法)。
 *
 *   受理確率 p = min(1, e^(−ΔE/k_BT))、ΔE = −(w_new − w_old)
 *   w = 最近接の Cu の数(異方性 on では水平方向の結合を重く数える)
 *
 * 水平結合を重くすると、クラスタは板状(1〜2 原子層の帯)になる — これが
 * {100} 面上に板状に集まる GP ゾーンの 2D 版である。
 *
 * **時間の換算**が本図の要点: 溶質が跳べる回数は空孔濃度に比例する。
 * 焼入れで凍結された過剰空孔(平衡の 10⁶ 倍以上)があるからこそ、室温でも
 * 時効が進む。平衡空孔濃度に落とすと同じ変化に天文学的な時間がかかることを
 * `secondsPerSweep` の換算で示す(§5.3 の回収)。
 *
 * 乱数はシード固定(mulberry32)。reset で完全に同じ初期配置・同じ経路を再現する。
 *
 * 簡略化: 2D 単純格子・原子数の大幅な削減・溶質の割合は見やすさのため実際
 * (Al–4 wt% Cu ≈ 1.7 at%)より高くしてある。実際の GP ゾーンは 3 次元の
 * {100} 板(直径数 nm・厚さ 1〜2 原子層)。
 */

import { mulberry32 } from "../../../core/mathx";
import { KB_EV } from "./constants";

/** サイトの状態 */
export const SITE_MATRIX = 0;
export const SITE_SOLUTE = 1;
export const SITE_VACANCY = 2;

/** Cu–Cu 結合エネルギー [eV](異方性 on: 水平 / 垂直) */
export const BOND_H_EV = 0.1;
export const BOND_V_EV = 0.03;
/** 異方性 off のときの等方結合エネルギー [eV] */
export const BOND_ISO_EV = (BOND_H_EV + BOND_V_EV) / 2;

/** 原子の振動数 ν [1/s] と空孔の移動エネルギー E_m [eV] */
export const NU_HZ = 1e13;
export const EM_EV = 0.62;

/** GP ゾーンとみなす最小の原子数(色の切り替えしきい値) */
export const ZONE_MIN_ATOMS = 3;

export interface ZoneParams {
  /** 温度 [K] */
  tempK: number;
  /** 空孔濃度(サイトあたり)。焼入れまま or 平衡 */
  cv: number;
  /** {100} 面上に並ぶ(水平結合を重くする) */
  aniso: boolean;
}

/** 空孔 1 個あたりの跳躍頻度 Γ = ν e^(−E_m/k_BT) [1/s] */
export function jumpRate(tempK: number): number {
  return NU_HZ * Math.exp(-EM_EV / (KB_EV * tempK));
}

/**
 * 1 スイープ(描画している空孔 1 個あたり 1 回の跳躍試行)が対応する実時間 [s]。
 *
 * 実際の系では、サイト数 N の領域で 1 秒間に起きる空孔跳躍は N·c_v·Γ 回。
 * モデルは 1 スイープで nVac 回試行するので
 *   Δt = nVac / (N · c_v · Γ)
 * となる。c_v を平衡値に落とすと Δt が桁で伸びる = 何も起きなくなる。
 */
export function secondsPerSweep(
  sites: number,
  nVac: number,
  p: ZoneParams,
): number {
  return nVac / (sites * p.cv * jumpRate(p.tempK));
}

export interface ZoneStats {
  /** ZONE_MIN_ATOMS 以上のクラスタ(= GP ゾーン)の数 */
  zoneCount: number;
  /** 最大ゾーンの原子数 */
  maxZone: number;
  /** ゾーンに取り込まれた溶質の割合 */
  clusteredFraction: number;
  /** 1 個 / 2〜4 個 / 5 個以上のクラスタに属する溶質の数 */
  histogram: [number, number, number];
}

/** 格子上の溶質クラスタリング(空孔機構) */
export class ZoneLattice {
  readonly cols: number;
  readonly rows: number;
  readonly sites: number;
  readonly nSolute: number;
  readonly nVac: number;
  /** サイトの状態 */
  readonly site: Uint8Array;
  /** 空孔のサイト番号 */
  readonly vac: Int32Array;
  /** クラスタ番号(-1 = 溶質でない)。updateClusters() で更新 */
  readonly cluster: Int32Array;
  /** クラスタ番号 → 原子数 */
  private readonly sizeOf: Int32Array;
  private rand: () => number;
  private readonly seed: number;

  constructor(
    cols: number,
    rows: number,
    nSolute: number,
    nVac: number,
    seed: number,
  ) {
    this.cols = cols;
    this.rows = rows;
    this.sites = cols * rows;
    this.nSolute = nSolute;
    this.nVac = nVac;
    this.site = new Uint8Array(this.sites);
    this.vac = new Int32Array(nVac);
    this.cluster = new Int32Array(this.sites);
    this.sizeOf = new Int32Array(this.sites);
    this.seed = seed;
    this.rand = mulberry32(seed);
    this.reset();
  }

  /** 焼入れ直後(溶質はランダム分散)へ戻す。決定論的 */
  reset(): void {
    this.rand = mulberry32(this.seed);
    this.site.fill(SITE_MATRIX);
    let placed = 0;
    while (placed < this.nSolute) {
      const s = Math.floor(this.rand() * this.sites);
      if (this.site[s] === SITE_MATRIX) {
        this.site[s] = SITE_SOLUTE;
        placed++;
      }
    }
    let v = 0;
    while (v < this.nVac) {
      const s = Math.floor(this.rand() * this.sites);
      if (this.site[s] === SITE_MATRIX) {
        this.site[s] = SITE_VACANCY;
        this.vac[v] = s;
        v++;
      }
    }
    this.updateClusters();
  }

  /** 周期境界の隣接サイト(0: 右, 1: 左, 2: 上, 3: 下) */
  neighbor(s: number, dir: number): number {
    const x = s % this.cols;
    const y = (s / this.cols) | 0;
    switch (dir) {
      case 0:
        return y * this.cols + ((x + 1) % this.cols);
      case 1:
        return y * this.cols + ((x + this.cols - 1) % this.cols);
      case 2:
        return ((y + this.rows - 1) % this.rows) * this.cols + x;
      default:
        return ((y + 1) % this.rows) * this.cols + x;
    }
  }

  /**
   * サイト s に溶質があるとしたときの結合の重み(隣の Cu の数を方向で重みづけ)。
   * exclude で 1 サイトだけ数えない(移動前後の比較で自分自身を除くため)。
   */
  private weight(s: number, exclude: number, p: ZoneParams): number {
    const eh = p.aniso ? BOND_H_EV : BOND_ISO_EV;
    const ev = p.aniso ? BOND_V_EV : BOND_ISO_EV;
    let w = 0;
    for (let d = 0; d < 4; d++) {
      const n = this.neighbor(s, d);
      if (n === exclude) continue;
      if (this.site[n] === SITE_SOLUTE) w += d < 2 ? eh : ev;
    }
    return w;
  }

  /** 1 スイープ = 空孔 1 個あたり 1 回の跳躍試行 */
  sweep(p: ZoneParams): void {
    const kT = KB_EV * p.tempK;
    for (let i = 0; i < this.nVac; i++) {
      const v = this.vac[i];
      const dir = Math.floor(this.rand() * 4);
      const n = this.neighbor(v, dir);
      const state = this.site[n];
      if (state === SITE_VACANCY) continue;
      if (state === SITE_SOLUTE) {
        // Cu が空孔へ移る: 結合の損得で受理判定(ΔE = −(w_new − w_old))
        const wOld = this.weight(n, v, p);
        const wNew = this.weight(v, n, p);
        const dE = -(wNew - wOld);
        if (dE > 0 && this.rand() >= Math.exp(-dE / kT)) continue;
      }
      // 入れ替え(母相原子との交換は常に受理 — 障壁は時間換算に丸め込む)
      this.site[v] = state;
      this.site[n] = SITE_VACANCY;
      this.vac[i] = n;
    }
  }

  /** 最近接の連結成分を求める(幅優先。クラスタ番号と大きさを更新) */
  updateClusters(): void {
    this.cluster.fill(-1);
    this.sizeOf.fill(0);
    const stack: number[] = [];
    let id = 0;
    for (let s = 0; s < this.sites; s++) {
      if (this.site[s] !== SITE_SOLUTE || this.cluster[s] >= 0) continue;
      let size = 0;
      stack.push(s);
      this.cluster[s] = id;
      while (stack.length > 0) {
        const cur = stack.pop() as number;
        size++;
        for (let d = 0; d < 4; d++) {
          const n = this.neighbor(cur, d);
          if (this.site[n] === SITE_SOLUTE && this.cluster[n] < 0) {
            this.cluster[n] = id;
            stack.push(n);
          }
        }
      }
      this.sizeOf[id] = size;
      id++;
    }
  }

  /** クラスタ番号の原子数(updateClusters 後に有効) */
  clusterSize(id: number): number {
    return id < 0 ? 0 : this.sizeOf[id];
  }

  /** 統計(読み出し・ヒストグラム用。updateClusters 後に呼ぶ) */
  stats(): ZoneStats {
    let zoneCount = 0;
    let maxZone = 0;
    let clustered = 0;
    const histogram: [number, number, number] = [0, 0, 0];
    for (let s = 0; s < this.sites; s++) {
      const id = this.cluster[s];
      if (id < 0) continue;
      const size = this.sizeOf[id];
      if (size === 1) histogram[0]++;
      else if (size <= 4) histogram[1]++;
      else histogram[2]++;
      if (size >= ZONE_MIN_ATOMS) clustered++;
    }
    for (let id = 0; this.sizeOf[id] > 0; id++) {
      if (this.sizeOf[id] >= ZONE_MIN_ATOMS) zoneCount++;
      if (this.sizeOf[id] > maxZone) maxZone = this.sizeOf[id];
    }
    return {
      zoneCount,
      maxZone,
      clusteredFraction: clustered / this.nSolute,
      histogram,
    };
  }

  /**
   * クラスタの平均的な扁平さ(幅 / 高さ)。異方性の効き目の検証用。
   * 大きさ 3 以上のクラスタについて、外接矩形の幅と高さの比を平均する。
   */
  meanAspect(): number {
    const minX = new Map<number, number>();
    const maxX = new Map<number, number>();
    const minY = new Map<number, number>();
    const maxY = new Map<number, number>();
    for (let s = 0; s < this.sites; s++) {
      const id = this.cluster[s];
      if (id < 0 || this.sizeOf[id] < ZONE_MIN_ATOMS) continue;
      const x = s % this.cols;
      const y = (s / this.cols) | 0;
      minX.set(id, Math.min(minX.get(id) ?? x, x));
      maxX.set(id, Math.max(maxX.get(id) ?? x, x));
      minY.set(id, Math.min(minY.get(id) ?? y, y));
      maxY.set(id, Math.max(maxY.get(id) ?? y, y));
    }
    let sum = 0;
    let n = 0;
    for (const id of minX.keys()) {
      const w = (maxX.get(id) as number) - (minX.get(id) as number) + 1;
      const h = (maxY.get(id) as number) - (minY.get(id) as number) + 1;
      sum += w / h;
      n++;
    }
    return n === 0 ? 1 : sum / n;
  }
}
