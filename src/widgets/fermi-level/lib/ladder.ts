/**
 * ladder.ts — 図1「席のはしご」と T = 0 のフェルミ準位(仕様書 12 §5.1)
 *
 * パウリの排他律で、1 つの準位にはスピンの向きが逆の 2 席がある。電子は
 * 下の席から順に入る(T = 0 の基底状態)。準位の離散化は説明のための
 * 簡略化で、実際の結晶では準位は事実上連続である(図注に明示)。
 *
 * E_F の位置の規則(どちらも T → 0 の化学ポテンシャルの正しい極限 — §5.8 T1):
 * - 最後に埋まった準位が満席なら、その準位と次の準位の**中間**
 * - 最後に埋まった準位に空席が残っている(電子数が奇数)なら、その準位の高さ
 * 電子が 0 個・全席が埋まった状態では E_F は定まらない(NaN)。
 */

export type LadderMaterial = "gapless" | "gapped";

export interface LadderLevel {
  /** 準位のエネルギー [eV] */
  e: number;
  /** 属する帯の番号(下から 0, 1, …) */
  band: number;
}

/** 1 準位あたりの席の数(スピン ↑・↓) */
export const SEATS_PER_LEVEL = 2;

function evenly(
  from: number,
  to: number,
  count: number,
  band: number,
): LadderLevel[] {
  const out: LadderLevel[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ e: from + ((to - from) * i) / (count - 1), band });
  }
  return out;
}

/** 隙間なし: 0.25〜5.75 eV に等間隔 24 準位(金属の帯を離散化したもの) */
const GAPLESS: readonly LadderLevel[] = Object.freeze(
  evenly(0.25, 5.75, 24, 0),
);

/** 隙間あり: 下の帯 0.2〜2.4 eV と上の帯 3.6〜5.8 eV に 12 準位ずつ */
const GAPPED: readonly LadderLevel[] = Object.freeze([
  ...evenly(0.2, 2.4, 12, 0),
  ...evenly(3.6, 5.8, 12, 1),
]);

/** 材料ごとの準位(下から順) */
export function ladderLevels(material: LadderMaterial): readonly LadderLevel[] {
  return material === "gapless" ? GAPLESS : GAPPED;
}

/** 帯の範囲 [eV](下から順) */
export function ladderBands(
  material: LadderMaterial,
): ReadonlyArray<{ low: number; high: number }> {
  return material === "gapless"
    ? [{ low: 0.25, high: 5.75 }]
    : [
        { low: 0.2, high: 2.4 },
        { low: 3.6, high: 5.8 },
      ];
}

export interface LadderFilling {
  /** 満席の準位の数 */
  fullLevels: number;
  /** 半分だけ埋まった準位があるか(電子数が奇数) */
  halfFilled: boolean;
  /** 最後に埋まった席の準位 [eV](電子 0 個なら NaN) */
  lastFilled: number;
  /** 最初の空席の準位 [eV](全席が埋まっていれば NaN) */
  firstEmpty: number;
  /** T = 0 のフェルミ準位 [eV](定まらなければ NaN) */
  eF: number;
  /**
   * E_F の高さに席があるか。帯の中(離散化した連続の準位の間を含む)なら
   * true、禁制帯の中なら false、E_F が定まらなければ null
   */
  seatAtEF: boolean | null;
}

/** 電子を下から詰めたときの状態(電子数は 0〜全席数に丸める) */
export function fillLadder(
  levels: readonly LadderLevel[],
  electrons: number,
): LadderFilling {
  const seats = levels.length * SEATS_PER_LEVEL;
  const n = Math.max(0, Math.min(seats, Math.round(electrons)));
  const fullLevels = Math.floor(n / SEATS_PER_LEVEL);
  const halfFilled = n % SEATS_PER_LEVEL === 1;

  if (n === 0) {
    return {
      fullLevels: 0,
      halfFilled: false,
      lastFilled: NaN,
      firstEmpty: levels.length > 0 ? levels[0].e : NaN,
      eF: NaN,
      seatAtEF: null,
    };
  }
  if (n === seats) {
    return {
      fullLevels,
      halfFilled: false,
      lastFilled: levels[levels.length - 1].e,
      firstEmpty: NaN,
      eF: NaN,
      seatAtEF: null,
    };
  }
  if (halfFilled) {
    // 最後に埋まった準位に空席が残っている → E_F はその準位の高さ
    const level = levels[fullLevels];
    return {
      fullLevels,
      halfFilled: true,
      lastFilled: level.e,
      firstEmpty: level.e,
      eF: level.e,
      seatAtEF: true,
    };
  }
  // 満席の最上位(HOMO)と次の準位(LUMO)の中間
  const homo = levels[fullLevels - 1];
  const lumo = levels[fullLevels];
  return {
    fullLevels,
    halfFilled: false,
    lastFilled: homo.e,
    firstEmpty: lumo.e,
    eF: 0.5 * (homo.e + lumo.e),
    seatAtEF: homo.band === lumo.band,
  };
}
