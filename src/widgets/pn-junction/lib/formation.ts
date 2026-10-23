/**
 * formation.ts — 図1「くっつける」の粒子モデル(仕様書 13 §5.1)
 *
 * 純クラス・シード固定。位置は −1 ≤ x ≤ 1 の無次元(p 型が左半分、n 型が
 * 右半分、接合面が x = 0)。粒子の数・電場の強さ・時間を大きく縮めた**定性
 * モデル**で、空乏層の幅は定性的(実際の値は図2 以降の junction.ts)。
 *
 * - 固定イオン: 左にアクセプタ(電荷 −1)、右にドナー(+1)を各 120 個、
 *   等間隔に置く(動かない)
 * - 自由キャリア: 左に正孔(+1)、右に電子(−1)を各 120 個。初期位置は自分の
 *   「持ち場」のイオンと同じ x(局所的にも中性)
 * - 運動: `_shared/carriers1d` の thermalStep(速さの目安 0.4/秒、方向の記憶
 *   時間 0.2 秒 — フェルミ準位の図4 と同じ)+ addDrift(電場による力。正孔は
 *   電場の向き、電子は逆向き)。両端で反射。接触前は接合面でも反射する
 *   (キャリアは自分の側に閉じ込められている)
 * - 電場: 400 区間で電荷を数え、𝓔(x) = A·Σ_{x'<x} ρ(1 次元のガウスの法則。
 *   左端で 0)、A = 0.24。総電荷がゼロなので右端でも自動的に 0 になる。
 *   粒子が受ける電場は、自分の区間の他の電荷の半分を「左にある」とみなした
 *   値(自分自身の電荷は含めない — 自分で自分を押す誤差を作らない)
 * - 再結合: 接触後、各電子について捕獲幅 w = 0.01 以内の正孔の数 k に対し、
 *   確率 1 − (1 − p_c)^k(p_c = 0.05)で最も近い 1 個と対消滅させる
 *   (フェルミ準位の図4 と同じ規則)
 * - 熱生成は無視する(Si では E_g/k_BT ≈ 43 で生成は極めてまれ)
 *
 * 熱エネルギーの目安: 速度の揺らぎの分散が speed²(= 0.16)なので、
 * 単位質量あたりの k_BT は speed²(ランジュバン方程式の定常分布
 * ∝ exp[−(v²/2 + U)/speed²])。「坂の高さ」= −∫𝓔dx をこれで割って
 * 熱エネルギーの何倍かを出す。
 *
 * 仕様書の試作(同じ規則を Python で 60 秒): 約 5 秒で 17 対が再結合し、
 * 10 秒以降は 20〜23 対で自己停止する。接合面付近(|x| < 0.1)の自由キャリアは
 * バルク換算 22 個から 0〜3 個へ、坂の高さは熱エネルギーの 7〜10 倍。
 * 総電荷ゼロと両端の電場ゼロは全ステップで成り立つ。
 */

import { mulberry32 } from "../../../core/mathx";
import {
  addDrift,
  CarrierSet,
  nearestWithin,
  thermalStep,
  type NearestResult,
} from "../../_shared/carriers1d";

/** 時間刻み [秒](図版は fixedStep で 16.7 ms 刻みに回す) */
export const FORMATION_DT = 1 / 60;
/** 片側の固定イオンの数 */
export const IONS_PER_SIDE = 120;
/** 片側の自由キャリアの数(初期) */
export const CARRIERS_PER_SIDE = 120;
/** 電場を作る区間の数 */
export const FIELD_BINS = 400;
/** ガウスの法則の係数 A(電荷 1 個あたりの電場の飛び) */
export const FIELD_COEF = 0.24;
/** 熱運動(速さの目安 0.4/秒・方向の記憶時間 0.2 秒) */
export const FORMATION_THERMAL = Object.freeze({ speed: 0.4, tau: 0.2 });
/** 単位質量あたりの熱エネルギー k_BT = speed² */
export const THERMAL_ENERGY = FORMATION_THERMAL.speed * FORMATION_THERMAL.speed;
/** 捕獲幅 */
export const CAPTURE_WIDTH = 0.01;
/** 捕獲幅内の正孔 1 個あたりの、1 ステップの再結合確率 */
export const CAPTURE_PROB = 0.05;
/** 「接合面付近」の半幅(|x| < 0.1) */
export const NEAR_JUNCTION = 0.1;
/** 接合面付近のバルク換算のキャリア数(両側の密度 120/単位長 × 幅 0.2) */
export const BULK_NEAR_COUNT = Math.round(
  CARRIERS_PER_SIDE * 2 * NEAR_JUNCTION,
);
/** 電荷密度のヒストグラム(表示用)の区間数 */
export const CHARGE_BINS = 80;
/** 既定のシード */
export const FORMATION_SEED = 20261023;

/** CarrierSet の付随値のチャンネル: 持ち場のイオンの番号(描画の段を決める) */
export const AUX_HOME = 0;

/** 再結合の表示用の記録の容量 */
const EFFECT_CAPACITY = 48;

const X_MIN = -1;
const X_MAX = 1;
const BIN_WIDTH = (X_MAX - X_MIN) / FIELD_BINS;
const FULL = Object.freeze({ min: X_MIN, max: X_MAX });
const LEFT = Object.freeze({ min: X_MIN, max: 0 });
const RIGHT = Object.freeze({ min: 0, max: X_MAX });

/** 位置 → 電場の区間の番号 */
function binOf(x: number): number {
  const k = Math.floor((x - X_MIN) / BIN_WIDTH);
  return k < 0 ? 0 : k >= FIELD_BINS ? FIELD_BINS - 1 : k;
}

/** i 番目のアクセプタ(左)の位置 */
export function acceptorX(i: number): number {
  return X_MIN + (i + 0.5) / IONS_PER_SIDE;
}

/** j 番目のドナー(右)の位置 */
export function donorX(j: number): number {
  return (j + 0.5) / IONS_PER_SIDE;
}

export class FormationSim {
  /** 正孔(電荷 +1)。aux[AUX_HOME] = 持ち場のアクセプタの番号 */
  readonly holes = new CarrierSet(CARRIERS_PER_SIDE, 1);
  /** 電子(電荷 −1)。aux[AUX_HOME] = 持ち場のドナーの番号 */
  readonly electrons = new CarrierSet(CARRIERS_PER_SIDE, 1);
  /** 区間ごとの正味の電荷(イオン + キャリア) */
  readonly binCharge = new Float64Array(FIELD_BINS);
  /**
   * 区間の境目での電場 𝓔_k = A·(左端から境目 k までの電荷の和)。
   * 長さ FIELD_BINS + 1(両端 k = 0・FIELD_BINS は総電荷ゼロのため 0)
   */
  readonly field = new Float64Array(FIELD_BINS + 1);
  /** 境目 k までの電荷の累積和(整数) */
  readonly cumulative = new Float64Array(FIELD_BINS + 1);

  /** 接触させたか */
  contacted = false;
  /** シミュレーション時刻 [秒](reset から) */
  time = 0;
  /** 接触してからの時刻 [秒] */
  timeSinceContact = 0;
  steps = 0;
  /** 再結合した対の数 */
  recombined = 0;

  /** 再結合の表示用リングバッファ(位置・持ち場の番号・時刻) */
  readonly effectX = new Float64Array(EFFECT_CAPACITY);
  readonly effectHome = new Float64Array(EFFECT_CAPACITY);
  readonly effectT0 = new Float64Array(EFFECT_CAPACITY);
  effectCount = 0;
  private effectHead = 0;

  private readonly seed: number;
  private rand: () => number;
  private readonly ionCharge = new Float64Array(FIELD_BINS);
  private readonly found: NearestResult = { index: -1, count: 0 };

  /** 正孔が受ける加速度(電場の向き。自分の電荷を除く) */
  private readonly holeAccel = (x: number): number => {
    const k = binOf(x);
    return FIELD_COEF * (this.cumulative[k] + 0.5 * (this.binCharge[k] - 1));
  };
  /** 電子が受ける加速度(電場と逆向き。自分の電荷を除く) */
  private readonly electronAccel = (x: number): number => {
    const k = binOf(x);
    return -FIELD_COEF * (this.cumulative[k] + 0.5 * (this.binCharge[k] + 1));
  };

  constructor(seed = FORMATION_SEED) {
    this.seed = seed;
    this.rand = mulberry32(seed);
    for (let i = 0; i < IONS_PER_SIDE; i++) {
      this.ionCharge[binOf(acceptorX(i))] -= 1;
      this.ionCharge[binOf(donorX(i))] += 1;
    }
    this.reset();
  }

  /** 接触前・同じ乱数列の初期状態に戻す */
  reset(): void {
    this.rand = mulberry32(this.seed);
    this.contacted = false;
    this.time = 0;
    this.timeSinceContact = 0;
    this.steps = 0;
    this.recombined = 0;
    this.effectCount = 0;
    this.effectHead = 0;
    this.holes.clear();
    this.electrons.clear();
    const speed = FORMATION_THERMAL.speed;
    for (let i = 0; i < CARRIERS_PER_SIDE; i++) {
      const h = this.holes.add(acceptorX(i), speed * this.normal());
      this.holes.aux[AUX_HOME][h] = i;
      const e = this.electrons.add(donorX(i), speed * this.normal());
      this.electrons.aux[AUX_HOME][e] = i;
    }
    this.computeField();
  }

  /** 左右を接触させる(以後、キャリアは接合面を越えられ、再結合が起きる) */
  contact(): void {
    this.contacted = true;
  }

  /** 正規乱数(ボックス=ミュラー。初速に使う) */
  private normal(): number {
    let u1 = this.rand();
    if (u1 < 1e-300) u1 = 1e-300;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * this.rand());
  }

  /** 電荷を 400 区間で数え、累積和から電場を作る(ガウスの法則) */
  computeField(): void {
    const bins = this.binCharge;
    bins.set(this.ionCharge);
    const h = this.holes;
    for (let i = 0; i < h.count; i++) bins[binOf(h.x[i])] += 1;
    const e = this.electrons;
    for (let i = 0; i < e.count; i++) bins[binOf(e.x[i])] -= 1;
    let c = 0;
    for (let k = 0; k < FIELD_BINS; k++) {
      this.cumulative[k] = c;
      this.field[k] = FIELD_COEF * c;
      c += bins[k];
    }
    this.cumulative[FIELD_BINS] = c;
    this.field[FIELD_BINS] = FIELD_COEF * c;
  }

  /** 1 ステップ(Δt = 1/60 秒)進める */
  step(): void {
    const dt = FORMATION_DT;
    const rand = this.rand;
    const h = this.holes;
    const e = this.electrons;

    // 1. 電場による力(電荷はステップの始めの配置で数えてある — reset と
    //    前のステップの終わりで computeField 済み)
    addDrift(h, dt, this.holeAccel);
    addDrift(e, dt, this.electronAccel);

    // 2. 熱運動(接触前は自分の側に閉じ込める)
    thermalStep(h, dt, FORMATION_THERMAL, rand, this.contacted ? FULL : LEFT);
    thermalStep(e, dt, FORMATION_THERMAL, rand, this.contacted ? FULL : RIGHT);

    // 3. 再結合(接触後のみ。入れ替え削除なので添字の大きい方から回す)
    if (this.contacted) {
      const keep = 1 - CAPTURE_PROB;
      for (let i = e.count - 1; i >= 0; i--) {
        const hit = nearestWithin(h, e.x[i], CAPTURE_WIDTH, -1, this.found);
        if (hit.count === 0) continue;
        if (rand() >= 1 - Math.pow(keep, hit.count)) continue;
        this.pushEffect(0.5 * (e.x[i] + h.x[hit.index]), e.aux[AUX_HOME][i]);
        h.removeAt(hit.index);
        e.removeAt(i);
        this.recombined++;
      }
      this.timeSinceContact += dt;
    }

    this.time += dt;
    this.steps++;
    this.computeField();
  }

  /** n ステップまとめて進める(省モーション時の「20 秒ぶん進めた平衡」) */
  advance(steps: number): void {
    for (let i = 0; i < steps; i++) this.step();
  }

  private pushEffect(x: number, home: number): void {
    const i = this.effectHead;
    this.effectX[i] = x;
    this.effectHome[i] = home;
    this.effectT0[i] = this.time;
    this.effectHead = (i + 1) % EFFECT_CAPACITY;
    if (this.effectCount < EFFECT_CAPACITY) this.effectCount++;
  }

  /** 総電荷(イオン + キャリア)。対で消えるので常に 0 */
  get totalCharge(): number {
    return this.cumulative[FIELD_BINS];
  }

  /**
   * むき出しのイオンの数: 左半分の正味の負電荷と、右半分の正味の正電荷
   * (= 持ち場のキャリアで打ち消されていないイオンの数)。総電荷がゼロなので
   * 常に等しい。
   */
  exposedIons(out: { left: number; right: number }): {
    left: number;
    right: number;
  } {
    let holesLeft = 0;
    let electronsLeft = 0;
    const h = this.holes;
    const e = this.electrons;
    for (let i = 0; i < h.count; i++) if (h.x[i] < 0) holesLeft++;
    for (let i = 0; i < e.count; i++) if (e.x[i] < 0) electronsLeft++;
    const holesRight = h.count - holesLeft;
    const electronsRight = e.count - electronsLeft;
    out.left = IONS_PER_SIDE - holesLeft + electronsLeft;
    out.right = IONS_PER_SIDE - electronsRight + holesRight;
    return out;
  }

  /** 接合面付近(|x| < 0.1)の自由キャリアの数 */
  nearJunctionCount(): number {
    let n = 0;
    const h = this.holes;
    const e = this.electrons;
    for (let i = 0; i < h.count; i++) if (Math.abs(h.x[i]) < NEAR_JUNCTION) n++;
    for (let i = 0; i < e.count; i++) if (Math.abs(e.x[i]) < NEAR_JUNCTION) n++;
    return n;
  }

  /**
   * 坂の高さ(正孔が左の中性領域から右の中性領域へ登る電位エネルギー
   * −∫𝓔dx)を、熱エネルギー speed² の何倍かで返す。電子にとっても同じ高さ。
   * field を渡すと、その(時間平均した)電場で計算する。
   */
  barrierInThermal(field: ArrayLike<number> = this.field): number {
    let s = 0;
    for (let k = 1; k < FIELD_BINS; k++) s += field[k];
    return (-s * BIN_WIDTH) / THERMAL_ENERGY;
  }

  /**
   * 表示用の電荷密度のヒストグラム(CHARGE_BINS 区間の正味の電荷)を out に
   * 書く。400 区間を 5 つずつまとめる。
   */
  chargeHistogram(out: Float64Array): void {
    const per = FIELD_BINS / CHARGE_BINS;
    for (let j = 0; j < CHARGE_BINS; j++) {
      let s = 0;
      for (let k = j * per; k < (j + 1) * per; k++) s += this.binCharge[k];
      out[j] = s;
    }
  }
}
