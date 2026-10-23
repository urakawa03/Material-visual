/**
 * barrier.ts — 図4「坂を越える」のモンテカルロ(仕様書 13 §5.4)
 *
 * 純クラス・シード固定。電子(n 側の多数キャリア)と正孔(p 側の多数キャリア)
 * を各 300 個。どちらも自分の側の中性領域を、空乏層の端(u = 0)から外側の
 * 電極(u = 1)までの無次元の座標 u で動く(表示の幅は空乏層の幅で変わるが、
 * 模型の中の長さは変えない — 当たる頻度をバイアスによらず一定にするため)。
 *
 * - 横方向の運動: `_shared/carriers1d` の thermalStep(速さの目安 0.4/秒・
 *   方向の記憶時間 0.2 秒)。外側の電極で反射する
 * - 空乏層の端(u = 0)に当たったキャリアは、そのエネルギー ε(バンド端から
 *   測った運動エネルギー)を**指数分布(平均 k_BT)から引く**。1 次元で面を
 *   横切る粒子のエネルギーの分布(流束で重み付けしたもの)はちょうど指数分布
 *   なので、越える割合は厳密に exp(−B/k_BT)(B = 坂の高さ = q(V_bi − V))。
 *   ε > B なら越え、同じ高さのまま空乏層を渡る(エネルギー保存)。越えられない
 *   ものは跳ね返る(引いた ε はそのまま縦位置として表示する)
 * - 越えたキャリアは相手側で少数キャリアとなり、寿命(平均 1.2 秒の指数分布)
 *   ののち消える。そのとき同数を自分の側の外端から補給する(電極からの供給)。
 *   粒子の総数は各 300 個に保たれる
 *
 * エネルギーは実際の eV のスケールで持つ(拡大しない)。室温の k_BT は
 * 0.026 eV なので、キャリアはバンド端のすぐ上(下)に薄く溜まる。
 *
 * 誠実な簡略化(図注に明示): 越える過程を「坂を飛び越える」形(熱電子放出)で
 * 描いている。実際の Si ダイオードの電流は越えたあとの少数キャリアの拡散で
 * 決まる(式 E10)が、電圧への指数関数の依存は同じ。1 次元・時間は加速・
 * 粒子数は縮めている。
 */

import { mulberry32 } from "../../../core/mathx";
import { CarrierSet, thermalStep } from "../../_shared/carriers1d";
import { thermalEnergy } from "../../_shared/semiconductor";
import { ROOM_T } from "./constants";

/** 時間刻み [秒] */
export const BARRIER_DT = 1 / 60;
/** 片側のキャリアの数 */
export const CARRIERS_EACH = 300;
/** 熱運動(中性領域の長さを 1 とした単位で、速さの目安 0.4/秒・記憶時間 0.2 秒) */
export const BARRIER_THERMAL = Object.freeze({ speed: 0.4, tau: 0.2 });
/** 少数キャリアの平均寿命 [秒](表示の時間) */
export const MINORITY_LIFETIME = 1.2;
/** 空乏層を渡るのに要する時間 [秒](表示だけの量) */
export const TRANSIT_SECONDS = 0.35;
/** 越えた数 / 秒を平均する時間 [秒] */
export const RATE_WINDOW_SECONDS = 5;
const RATE_WINDOW_STEPS = Math.round(RATE_WINDOW_SECONDS / BARRIER_DT);
/** 既定のシード */
export const BARRIER_SEED = 20261024;

/** 付随値のチャンネル: エネルギー ε [eV](自分の側のバンド端から測る) */
export const AUX_ENERGY = 0;
/** 付随値のチャンネル: 渡り始めた時刻(transit)/ 消える時刻(minority)[秒] */
export const AUX_TIME = 1;

/** 当たる判定のために、内側の端は u = −1 まで動かして自前で処理する */
const MAJORITY_BOUNDS = Object.freeze({ min: -1, max: 1 });
const MINORITY_BOUNDS = Object.freeze({ min: 0, max: 1 });

/** 1 種類のキャリア(電子なら n 側が自分の側) */
export class BarrierSpecies {
  /** 自分の側の多数キャリア(座標 u: 空乏層の端 0 → 電極 1) */
  readonly majority = new CarrierSet(CARRIERS_EACH, 2);
  /** 空乏層を渡っている途中(x は使わない。aux[AUX_TIME] = 渡り始めた時刻) */
  readonly transit = new CarrierSet(CARRIERS_EACH, 2);
  /** 相手側に入った少数キャリア(座標 u: 相手側の空乏層の端 0 → 電極 1) */
  readonly minority = new CarrierSet(CARRIERS_EACH, 2);
  /** 総数(= 多数 + 渡っている途中 + 少数。常に CARRIERS_EACH) */
  get total(): number {
    return this.majority.count + this.transit.count + this.minority.count;
  }
}

/**
 * 1 秒あたりに坂に当たる数の理論値(片側)。区間 [0, 1] に一様に N 個、
 * 速度が標準偏差 σ の正規分布なら、端を外向きに横切る流束は N·σ/√(2π)。
 */
export function hitRatePerSide(): number {
  return (CARRIERS_EACH * BARRIER_THERMAL.speed) / Math.sqrt(2 * Math.PI);
}

/** 1 秒あたりに越える数の理論値(両側の合計)= 2·(当たる数)·exp(−B/k_BT) */
export function theoryCrossingRate(barrierEv: number, T = ROOM_T): number {
  return 2 * hitRatePerSide() * Math.exp(-barrierEv / thermalEnergy(T));
}

export class BarrierSim {
  /** 電子(n 側 = 右が自分の側) */
  readonly electrons = new BarrierSpecies();
  /** 正孔(p 側 = 左が自分の側) */
  readonly holes = new BarrierSpecies();
  /** 坂の高さ B = q(V_bi − V) [eV] */
  barrier: number;
  /** 熱エネルギー k_BT [eV] */
  readonly kT: number;
  time = 0;
  steps = 0;
  /** 累計: 坂に当たった数・越えた数(両側の合計) */
  hits = 0;
  crossings = 0;

  private readonly seed: number;
  private rand: () => number;
  /** 直近のステップごとの越えた数(リングバッファ) */
  private readonly window = new Int32Array(RATE_WINDOW_STEPS);
  private windowHead = 0;
  private windowCount = 0;
  private windowSum = 0;

  constructor(barrierEv: number, seed = BARRIER_SEED, T = ROOM_T) {
    this.seed = seed;
    this.kT = thermalEnergy(T);
    this.barrier = barrierEv;
    this.rand = mulberry32(seed);
    this.reset();
  }

  /** 同じ乱数列・同じ初期状態に戻す(坂の高さはそのまま) */
  reset(): void {
    this.rand = mulberry32(this.seed);
    this.time = 0;
    this.steps = 0;
    this.hits = 0;
    this.crossings = 0;
    for (const s of [this.electrons, this.holes]) {
      s.majority.clear();
      s.transit.clear();
      s.minority.clear();
      for (let i = 0; i < CARRIERS_EACH; i++) {
        const k = s.majority.add(
          (i + this.rand()) / CARRIERS_EACH,
          BARRIER_THERMAL.speed * this.normal(),
        );
        s.majority.aux[AUX_ENERGY][k] = this.energy();
      }
    }
    this.restartRate();
  }

  /** 坂の高さを変える(越えた数 / 秒の平均は測り直す) */
  setBarrier(barrierEv: number): void {
    if (barrierEv === this.barrier) return;
    this.barrier = barrierEv;
    this.restartRate();
  }

  /** 越えた数 / 秒の平均を測り直す */
  restartRate(): void {
    this.window.fill(0);
    this.windowHead = 0;
    this.windowCount = 0;
    this.windowSum = 0;
  }

  /** 平均に入っている時間 [秒](最大 5 秒) */
  get rateSeconds(): number {
    return this.windowCount * BARRIER_DT;
  }

  /** 直近(最大 5 秒)の越えた数 / 秒(両側の合計)。測り始めは NaN */
  get measuredRate(): number {
    return this.windowCount > 0
      ? this.windowSum / (this.windowCount * BARRIER_DT)
      : NaN;
  }

  /** 正規乱数(ボックス=ミュラー) */
  private normal(): number {
    let u1 = this.rand();
    if (u1 < 1e-300) u1 = 1e-300;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * this.rand());
  }

  /** 指数分布(平均 k_BT)のエネルギー [eV] */
  private energy(): number {
    return -this.kT * Math.log(1 - this.rand());
  }

  /** 1 ステップ(Δt = 1/60 秒)進める */
  step(): void {
    const dt = BARRIER_DT;
    let crossed = 0;
    crossed += this.stepSpecies(this.electrons, dt);
    crossed += this.stepSpecies(this.holes, dt);
    this.time += dt;
    this.steps++;
    // 越えた数 / 秒の移動平均
    if (this.windowCount === RATE_WINDOW_STEPS) {
      this.windowSum -= this.window[this.windowHead];
    } else {
      this.windowCount++;
    }
    this.window[this.windowHead] = crossed;
    this.windowSum += crossed;
    this.windowHead = (this.windowHead + 1) % RATE_WINDOW_STEPS;
  }

  private stepSpecies(s: BarrierSpecies, dt: number): number {
    const rand = this.rand;
    const maj = s.majority;
    const tr = s.transit;
    const mi = s.minority;
    let crossed = 0;

    // 1. 多数キャリアの熱運動。空乏層の端(u < 0)に当たったら判定する
    thermalStep(maj, dt, BARRIER_THERMAL, rand, MAJORITY_BOUNDS);
    const eMaj = maj.aux[AUX_ENERGY];
    for (let i = maj.count - 1; i >= 0; i--) {
      if (maj.x[i] >= 0) continue;
      this.hits++;
      const eps = this.energy();
      if (eps > this.barrier) {
        // 越える: 同じ高さのまま空乏層を渡る
        const k = tr.add(0, 0);
        tr.aux[AUX_ENERGY][k] = eps;
        tr.aux[AUX_TIME][k] = this.time;
        maj.removeAt(i);
        crossed++;
      } else {
        // 跳ね返る
        maj.x[i] = -maj.x[i];
        maj.v[i] = -maj.v[i];
        eMaj[i] = eps;
      }
    }
    this.crossings += crossed;

    // 2. 渡り終えたものは相手側の少数キャリアになる(寿命を引く)
    const tTr = tr.aux[AUX_TIME];
    for (let i = tr.count - 1; i >= 0; i--) {
      if (this.time - tTr[i] < TRANSIT_SECONDS) continue;
      const k = mi.add(0, Math.abs(BARRIER_THERMAL.speed * this.normal()));
      mi.aux[AUX_ENERGY][k] = tr.aux[AUX_ENERGY][i];
      mi.aux[AUX_TIME][k] =
        this.time - MINORITY_LIFETIME * Math.log(1 - rand());
      tr.removeAt(i);
    }

    // 3. 少数キャリアの熱運動と再結合(消えたら自分の側の外端から補給)
    thermalStep(mi, dt, BARRIER_THERMAL, rand, MINORITY_BOUNDS);
    const tMi = mi.aux[AUX_TIME];
    for (let i = mi.count - 1; i >= 0; i--) {
      if (this.time < tMi[i]) continue;
      mi.removeAt(i);
      const k = maj.add(1, -Math.abs(BARRIER_THERMAL.speed * this.normal()));
      maj.aux[AUX_ENERGY][k] = this.energy();
    }
    return crossed;
  }
}
