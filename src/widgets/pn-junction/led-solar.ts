/**
 * led-solar.ts — 図6「同じ構造から生まれるもの」(仕様書 13 §5.6・発展)
 *
 * モード切り替えの 2 画面。
 * - LED: 順バイアスのバンド図。空乏層の付近で電子が正孔の高さへ縦に落ち
 *   (再結合)、直接遷移の材料なら光子(`--mat-beam` の短い波線の矢印)が外へ
 *   飛ぶ。間接遷移の Si では、落ちても光子はほとんど出ず(表示上の目安で 12 回に
 *   1 回)、代わりに格子の振動(小さな「〜」、`--color-text-2`)が出る。下端に
 *   波長の目盛り(灰色の帯に 300〜1200 nm、可視域 380〜780 nm を括弧で示す)と、
 *   発光波長の位置に `--mat-beam` の印。**虹色の帯は使わない**(母体仕様 §2-7)
 * - 太陽電池: 光子が空乏層に入って電子・正孔の対を作り、内蔵電場で電子は n 側へ、
 *   正孔は p 側へ引き離される。右に I-V 曲線(光あり / なし)。光ありの曲線が
 *   下へずれて電力を取り出せる象限ができることを薄い塗りで示す。動作点は曲線上で
 *   ドラッグでき(キーボードは矢印)、そのときの電力 |JV| を読み取りに出す
 *
 * モデル: 発光波長 λ = 1239.84/E_g(式 E12)。太陽電池は理想ダイオード式
 * J = J_0[exp(qV/k_BT) − 1] − J_L(式 E13。J_L は光の強さに比例、1 太陽で
 * 35 mA/cm²)、Si・N_A = N_D = 10¹⁶ cm⁻³。バンド図の坂は動作点の電圧で決まる。
 *
 * 誠実な簡略化(図注に明示): 光る割合と出来事の頻度は表示上の目安(内部量子
 * 効率の計算ではない)。LED のバンド図は Si の接合の形に材料のギャップだけを
 * 当てはめた模式。InGaN の E_g は組成で変わる代表値。太陽電池の理想模型の
 * V_oc ≈ 0.55 V は実際の Si 太陽電池(0.6〜0.7 V)より低い。
 *
 * 実装方式: 2D Canvas / onFrame(光子・キャリアの出来事)。I-V の描画とドラッグは
 * 粒子の更新とは独立に requestRender でも描ける。省モーション時は自動再生せず、
 * 3 秒ぶん進めた静止フレームを表示する。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fixedStep } from "../../core/engine";
import { clamp } from "../../core/mathx";
import {
  attachDragPoints,
  createReadout,
  drawFocusRing,
  type DragPoint,
} from "../reciprocal-lattice/_shared2d";
import {
  createPlotMapper,
  drawPlotFrame,
  setPlotRange,
  withPlotClip,
  type AxisTick,
  type PlotMapper,
} from "../_shared/banddiagram";
import { SILICON } from "../_shared/semiconductor";
import {
  DOPING_INIT,
  J_LIGHT_ONE_SUN,
  LED_MATERIALS,
  ROOM_T,
  SI_LIFETIMES,
  type LedMaterial,
} from "./lib/constants";
import {
  bandEdges,
  depletion,
  diodeCurrent,
  displayHalfRange,
  emissionWavelengthNm,
  maxPowerPoint,
  openCircuitVoltage,
  quasiFermiLevels,
  saturationCurrent,
  type BandEdges,
  type Depletion,
} from "./lib/junction";
import { PAIR_CAPACITY, PairStream } from "./lib/pairs";
import {
  BandSamples,
  curveSamples,
  drawBands,
  drawBoxedLabel,
  drawDotsPx,
  drawLabel,
  drawPhoton,
  drawSplitDivider,
  NARROW_WIDTH_PX,
  pnColors,
  setControlEnabled,
  splitByFraction,
} from "./lib/draw";

type Mode = "led" | "solar";
type MaterialId = LedMaterial["id"];

/** 操作パラメータ(§5.6 の表) */
const MODE_INIT: Mode = "led";
const MATERIAL_INIT: MaterialId = "GaAs";
const LIGHT_MIN = 0;
const LIGHT_MAX = 1;
const LIGHT_STEP = 0.05;
const LIGHT_INIT = 1;
/** LED のバンド図の順バイアス(「0.6 V 相当」の模式)[V] */
const LED_BIAS = 0.6;
/** 間接遷移(Si)で光子を描く割合の表示上の目安(10 回に 1 回未満) */
const INDIRECT_EMIT = 1 / 12;
/** 出来事の頻度 [1/秒](LED、太陽電池は 1 太陽あたり) */
const LED_RATE = 3.4;
const SOLAR_RATE = 4.5;
/** LED の出来事の段階 [秒]: 近づく → 落ちる → 光(または振動) */
const LED_TRAVEL = 1.1;
const LED_DROP = 0.32;
const LED_EMIT = 0.85;
/** 太陽電池の出来事の段階 [秒]: 光子が入る → 引き離される */
const SOLAR_PHOTON = 0.6;
const SOLAR_SEPARATE = 1.15;
/** 初期化時・リセット時に内部で進める時間 [秒](最初のフレームから出来事が見える) */
const WARMUP_SECONDS = 3;
const STEP_DT = 1 / 60;
/** 帯の見た目の厚み [eV] */
const BAND_THICKNESS = 0.32;
/** キャリアをバンド端から離して描く距離 [eV] */
const CARRIER_OFFSET = 0.05;
/** バンド図の縦軸 [eV](LED は InGaN の 2.7 eV まで、太陽電池は Si) */
const LED_E_MIN = -0.62;
const LED_E_MAX = 3.22;
const SOLAR_E_MIN = -1.12;
const SOLAR_E_MAX = 1.6;
/** I-V の軸(太陽電池)[V]・[mA/cm²] */
const IV_V_MIN = -0.1;
const IV_V_MAX = 0.65;
const IV_J_MIN = -42;
const IV_J_MAX = 24;
/** 波長の目盛り [nm] */
const WL_MIN = 300;
const WL_MAX = 1200;
const VIS_MIN = 380;
const VIS_MAX = 780;
/** 動作点のキーボード操作の刻み [V](Shift で粗く) */
const KEY_STEP = 0.01;
const KEY_STEP_COARSE = 0.05;

const IV_X_TICKS: readonly AxisTick[] = [0, 0.2, 0.4, 0.6].map((v) => ({
  value: v,
  label: v === 0 ? "0" : v.toFixed(1),
}));
const IV_Y_TICKS: readonly AxisTick[] = [-40, -20, 0, 20].map((v) => ({
  value: v,
  label: v === 0 ? "0" : `${v < 0 ? "−" : ""}${Math.abs(v)}`,
}));
const LED_E_TICKS: readonly AxisTick[] = [0, 1, 2, 3].map((v) => ({
  value: v,
  label: String(v),
}));
const SOLAR_E_TICKS: readonly AxisTick[] = [-1, -0.5, 0, 0.5, 1, 1.5].map(
  (v) => ({
    value: v,
    label: v === 0 ? "0" : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`,
  }),
);

function materialOf(id: MaterialId): LedMaterial {
  return LED_MATERIALS.find((m) => m.id === id) ?? LED_MATERIALS[1];
}

/** 0〜1 の滑らかな進み(ease-out) */
function easeOut(t: number): number {
  const s = clamp(t, 0, 1);
  return 1 - (1 - s) * (1 - s);
}

export default function ledSolar(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = pnColors();
  const band = createPlotMapper();
  const iv = createPlotMapper();
  const bands = new BandSamples(241);
  const edges: BandEdges = { ec: 0, ev: 0, ei: 0 };
  /** 枠の設定(毎フレームの新規割当てを避けるため初期化時に作る) */
  const ledFrame = {
    colors,
    yTicks: LED_E_TICKS,
    yLabel: "エネルギー [eV]" as string | undefined,
  };
  const ledFrameNarrow = { ...ledFrame, yLabel: undefined };
  const solarFrame = { ...ledFrame, yTicks: SOLAR_E_TICKS };
  const solarFrameNarrow = { ...solarFrame, yLabel: undefined };
  const ivFrame = {
    colors,
    xTicks: IV_X_TICKS,
    yTicks: IV_Y_TICKS,
    xLabel: "電圧 V [V]",
    yLabel: "電流密度 J [mA/cm²]" as string | undefined,
  };
  const ivFrameNarrow = { ...ivFrame, yLabel: undefined };

  /* ---- 状態 ---- */
  let mode: Mode = MODE_INIT;
  let material: LedMaterial = materialOf(MATERIAL_INIT);
  let light = LIGHT_INIT;
  /**
   * 太陽電池の動作点の電圧 [V]。vPref は読者が選んだ電圧で、表示する vOp は
   * それを 0〜V_oc に収めた値(光を弱めて V_oc が下がっても、戻せば元の点に
   * 戻る)。動かすまでは最大電力点に追従する
   */
  let vOp = 0;
  let vPref = 0;
  let followMpp = true;

  const j0 = saturationCurrent(
    SILICON,
    SI_LIFETIMES,
    DOPING_INIT,
    DOPING_INIT,
    ROOM_T,
  );
  const dZero = depletion(SILICON, DOPING_INIT, DOPING_INIT, 0, ROOM_T);
  const R = displayHalfRange(dZero);
  const dLed = depletion(SILICON, DOPING_INIT, DOPING_INIT, LED_BIAS, ROOM_T);
  let dSolar: Depletion = dZero;
  let jL = J_LIGHT_ONE_SUN * light;
  let voc = openCircuitVoltage(j0, jL, ROOM_T);

  const ledEvents = new PairStream(
    20261025,
    LED_RATE,
    LED_TRAVEL + LED_DROP + LED_EMIT,
  );
  const solarEvents = new PairStream(
    20261026,
    SOLAR_RATE * light,
    SOLAR_PHOTON + SOLAR_SEPARATE,
  );

  function updateEmission(): void {
    ledEvents.emitProbability = material.direct ? 1 : INDIRECT_EMIT;
  }

  function warmUp(): void {
    ledEvents.reset();
    solarEvents.reset();
    const n = Math.round(WARMUP_SECONDS / STEP_DT);
    for (let i = 0; i < n; i++) {
      ledEvents.step(STEP_DT);
      solarEvents.step(STEP_DT);
    }
  }

  /** 光の強さが変わったとき(J_L・V_oc・動作点・坂) */
  function updateSolar(): void {
    jL = J_LIGHT_ONE_SUN * light;
    voc = openCircuitVoltage(j0, jL, ROOM_T);
    solarEvents.rate = SOLAR_RATE * light;
    if (followMpp) vPref = maxPowerPoint(j0, jL, ROOM_T).v;
    vOp = clamp(vPref, 0, voc);
    dSolar = depletion(SILICON, DOPING_INIT, DOPING_INIT, vOp, ROOM_T);
  }

  function setOperatingPoint(v: number): void {
    vOp = clamp(v, 0, voc);
    vPref = vOp;
    followMpp = false;
    dSolar = depletion(SILICON, DOPING_INIT, DOPING_INIT, vOp, ROOM_T);
  }

  updateEmission();
  updateSolar();
  warmUp();

  /* ---- 使い回す描画バッファ(px) ---- */
  const eX = new Float64Array(PAIR_CAPACITY);
  const eY = new Float64Array(PAIR_CAPACITY);
  const hX = new Float64Array(PAIR_CAPACITY);
  const hY = new Float64Array(PAIR_CAPACITY);

  /** いまの図のバンド(LED は材料のギャップ、太陽電池は Si) */
  function edgesAt(x: number): BandEdges {
    if (mode === "led") {
      bandEdges(SILICON, dLed, x, ROOM_T, edges);
      edges.ec += material.eg - SILICON.eg;
    } else {
      bandEdges(SILICON, dSolar, x, ROOM_T, edges);
    }
    return edges;
  }

  /* ---- バンド図 ---- */
  function drawBandPanel(narrow: boolean): void {
    const led = mode === "led";
    const d = led ? dLed : dSolar;
    drawPlotFrame(
      ctx,
      band,
      led
        ? narrow
          ? ledFrameNarrow
          : ledFrame
        : narrow
          ? solarFrameNarrow
          : solarFrame,
    );
    bands.sample(
      SILICON,
      d,
      ROOM_T,
      -R,
      R,
      curveSamples(host.size.w),
      BAND_THICKNESS,
    );
    if (led) {
      const shift = material.eg - SILICON.eg;
      for (let i = 0; i < bands.count; i++) {
        bands.ec[i] += shift;
        bands.ecTop[i] += shift;
      }
    }
    const now = led ? ledEvents.time : solarEvents.time;
    withPlotClip(ctx, band, () => {
      drawBands(ctx, band, bands, colors);
      if (!led) {
        // 擬フェルミ準位(中性領域だけ)。差は動作点の qV
        const q = quasiFermiLevels(d);
        ctx.save();
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = colors.hole;
        ctx.beginPath();
        ctx.moveTo(band.toPxX(-R), band.toPxY(q.eFp));
        ctx.lineTo(band.toPxX(-d.xp), band.toPxY(q.eFp));
        ctx.stroke();
        ctx.strokeStyle = colors.electron;
        ctx.beginPath();
        ctx.moveTo(band.toPxX(d.xn), band.toPxY(q.eFn));
        ctx.lineTo(band.toPxX(R), band.toPxY(q.eFn));
        ctx.stroke();
        ctx.restore();
      }
      let ne = 0;
      let nh = 0;
      if (led) {
        const span = d.xp + d.xn;
        for (let i = 0; i < PAIR_CAPACITY; i++) {
          if (!ledEvents.active[i]) continue;
          const age = now - ledEvents.t0[i];
          const xr = -d.xp + ledEvents.pos[i] * span;
          const jit = ledEvents.jitter[i];
          if (age < LED_TRAVEL) {
            const s = easeOut(age / LED_TRAVEL);
            const xe = xr + (R - xr) * (1 - s);
            const xh = xr - (xr + R) * (1 - s);
            eX[ne] = band.toPxX(xe);
            eY[ne] = band.toPxY(edgesAt(xe).ec + CARRIER_OFFSET + 0.03 * jit);
            ne++;
            hX[nh] = band.toPxX(xh);
            hY[nh] = band.toPxY(edgesAt(xh).ev - CARRIER_OFFSET - 0.03 * jit);
            nh++;
          } else if (age < LED_TRAVEL + LED_DROP) {
            // 電子が正孔の高さへ縦に落ちる(落ちる道筋を薄い線で)
            const s = (age - LED_TRAVEL) / LED_DROP;
            const e = edgesAt(xr);
            const yTop = e.ec + CARRIER_OFFSET;
            const yBottom = e.ev - CARRIER_OFFSET;
            const y = yTop + (yBottom - yTop) * s * s;
            const px = band.toPxX(xr);
            ctx.save();
            ctx.strokeStyle = colors.electron;
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = 1.2;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(px, band.toPxY(yTop));
            ctx.lineTo(px, band.toPxY(y));
            ctx.stroke();
            ctx.restore();
            eX[ne] = px;
            eY[ne] = band.toPxY(y);
            ne++;
            hX[nh] = px;
            hY[nh] = band.toPxY(yBottom);
            nh++;
          } else {
            // 再結合したあと: 光子が外へ飛ぶ / 格子の振動
            const t = (age - LED_TRAVEL - LED_DROP) / LED_EMIT;
            const e = edgesAt(xr);
            const mid = 0.5 * (e.ec + e.ev);
            const px = band.toPxX(xr);
            const py = band.toPxY(mid);
            if (ledEvents.radiative[i]) {
              const ang = -Math.PI / 2 + (jit - 0.5) * 1.6;
              const dist = 10 + 90 * t;
              const len = 44;
              const hx = px + Math.cos(ang) * dist;
              const hy = py + Math.sin(ang) * dist;
              drawPhoton(
                ctx,
                hx - Math.cos(ang) * len,
                hy - Math.sin(ang) * len,
                hx,
                hy,
                colors.beam,
                1 - t * t,
                Math.max(2, Math.round(2.4 * material.eg)),
              );
            } else {
              drawPhonon(px, py, 1 - t);
            }
          }
        }
      } else {
        const span = d.xp + d.xn;
        for (let i = 0; i < PAIR_CAPACITY; i++) {
          if (!solarEvents.active[i]) continue;
          const age = now - solarEvents.t0[i];
          const xg = -d.xp + solarEvents.pos[i] * span;
          const e0 = edgesAt(xg);
          const mid = 0.5 * (e0.ec + e0.ev);
          if (age < SOLAR_PHOTON) {
            // 光子が上から入ってくる
            const t = age / SOLAR_PHOTON;
            const px = band.toPxX(xg);
            const yEnd = band.toPxY(mid);
            const yHead = band.rect.y + (yEnd - band.rect.y) * t;
            drawPhoton(ctx, px, yHead - 42, px, yHead, colors.beam, 1, 3);
          } else {
            // 電子は n 側(右)へ坂を下り、正孔は p 側(左)へ引き離される
            const s = (age - SOLAR_PHOTON) / SOLAR_SEPARATE;
            const k = s * s;
            const xe = xg + (R - xg) * k;
            const xh = xg - (xg + R) * k;
            eX[ne] = band.toPxX(xe);
            eY[ne] = band.toPxY(edgesAt(xe).ec + CARRIER_OFFSET);
            ne++;
            hX[nh] = band.toPxX(xh);
            hY[nh] = band.toPxY(edgesAt(xh).ev - CARRIER_OFFSET);
            nh++;
          }
        }
      }
      const r = narrow ? 3.4 : 4.2;
      drawDotsPx(ctx, hX, hY, nh, r, colors.hole);
      drawDotsPx(ctx, eX, eY, ne, r, colors.electron);
    });
    drawLabel(
      ctx,
      "p 型",
      band.rect.x + 4,
      band.rect.y - 8,
      colors.hole,
      "left",
    );
    drawLabel(
      ctx,
      "n 型",
      band.rect.x + band.rect.w - 4,
      band.rect.y - 8,
      colors.electron,
      "right",
    );
    if (led) {
      drawBoxedLabel(
        ctx,
        `${material.label}: E_g = ${material.eg.toFixed(2)} eV`,
        band.rect.x + 6,
        band.toPxY(LED_E_MAX) + 12,
        colors,
        "left",
        colors.text,
      );
    } else {
      // 擬フェルミ準位のラベル(差は動作点の電圧 qV)。E_Fn は n 側の E_c のすぐ
      // 下を通るので、線の下(禁制帯の空いた所)に置く
      const q = quasiFermiLevels(d);
      drawLabel(
        ctx,
        "E_Fp",
        band.rect.x + 4,
        band.toPxY(q.eFp) - 9,
        colors.hole,
        "left",
      );
      drawLabel(
        ctx,
        "E_Fn",
        band.rect.x + band.rect.w - 4,
        band.toPxY(q.eFn) + 10,
        colors.electron,
        "right",
      );
      drawBoxedLabel(
        ctx,
        light > 0 ? "光" : "光なし",
        band.rect.x + band.rect.w - 6,
        band.rect.y + 10,
        colors,
        "right",
        colors.beamInk,
      );
    }
  }

  /** 格子の振動の印(小さな「〜」) */
  function drawPhonon(px: number, py: number, alpha: number): void {
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.strokeStyle = colors.text2;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let row = -1; row <= 1; row += 2) {
      const y0 = py + row * 5;
      for (let i = 0; i <= 12; i++) {
        const x = px - 9 + (18 * i) / 12;
        const y = y0 + 2.5 * Math.sin((i / 12) * Math.PI * 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ---- 波長の目盛り(LED) ---- */
  /**
   * 灰色の帯に 300〜1200 nm の目盛り(虹色は使わない — 母体仕様 §2-7)。
   * 紫外・可視光・赤外の名前は帯の中に書き、可視域(380〜780 nm)の境目に
   * 縦の刻み。発光波長の印と数値は帯の上に置く(名前と重ならない)。
   */
  function drawWavelengthScale(
    x0: number,
    x1: number,
    y: number,
    narrow: boolean,
  ): void {
    const toX = (nm: number): number =>
      x0 + ((nm - WL_MIN) / (WL_MAX - WL_MIN)) * (x1 - x0);
    const bandH = 16;
    const vx0 = toX(VIS_MIN);
    const vx1 = toX(VIS_MAX);
    ctx.save();
    ctx.fillStyle = colors.hairline;
    ctx.fillRect(x0, y, x1 - x0, bandH);
    ctx.strokeStyle = colors.text2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // 目盛り(帯の下)と、可視域の境目(帯を横切る刻み)
    for (let nm = 400; nm <= WL_MAX; nm += 200) {
      const px = Math.round(toX(nm)) + 0.5;
      ctx.moveTo(px, y + bandH);
      ctx.lineTo(px, y + bandH + 4);
    }
    for (const px of [vx0, vx1]) {
      const p = Math.round(px) + 0.5;
      ctx.moveTo(p, y - 3);
      ctx.lineTo(p, y + bandH + 3);
    }
    ctx.stroke();
    ctx.restore();
    for (let nm = 400; nm <= WL_MAX; nm += 200) {
      drawLabel(
        ctx,
        nm === WL_MAX ? `${nm} nm` : String(nm),
        toX(nm),
        y + bandH + 12,
        colors.text2,
        nm === WL_MAX ? "right" : "center",
      );
    }
    const ym = y + bandH / 2;
    drawLabel(
      ctx,
      narrow ? "可視光" : "可視光(380〜780 nm)",
      (vx0 + vx1) / 2,
      ym,
      colors.text2,
      "center",
    );
    drawLabel(ctx, "赤外", (vx1 + x1) / 2, ym, colors.text2, "center");
    if (vx0 - x0 >= 28) {
      drawLabel(ctx, "紫外", (x0 + vx0) / 2, ym, colors.text2, "center");
    }
    // 発光波長の印(帯を横切る線と、帯の上の三角)
    const lam = emissionWavelengthNm(material.eg);
    const lx = toX(clamp(lam, WL_MIN, WL_MAX));
    ctx.save();
    ctx.fillStyle = colors.beam;
    ctx.strokeStyle = colors.beam;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(lx, y - 2);
    ctx.lineTo(lx, y + bandH + 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(lx, y - 3);
    ctx.lineTo(lx - 6, y - 13);
    ctx.lineTo(lx + 6, y - 13);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    drawBoxedLabel(
      ctx,
      `発光 ${Math.round(lam)} nm`,
      lx + (lam > 1000 ? -10 : 10),
      y - 12,
      colors,
      lam > 1000 ? "right" : "left",
      colors.beamInk,
    );
  }

  /* ---- I-V 曲線(太陽電池) ---- */
  const MAX_IV = 161;
  const ivV = new Float64Array(MAX_IV);
  const ivDark = new Float64Array(MAX_IV);
  const ivLight = new Float64Array(MAX_IV);

  function drawIvPanel(narrow: boolean): void {
    drawPlotFrame(ctx, iv, narrow ? ivFrameNarrow : ivFrame);
    const n = host.size.w < NARROW_WIDTH_PX ? 81 : MAX_IV;
    for (let i = 0; i < n; i++) {
      const v = IV_V_MIN + ((IV_V_MAX - IV_V_MIN) * i) / (n - 1);
      ivV[i] = v;
      ivDark[i] = 1000 * diodeCurrent(j0, v, ROOM_T);
      ivLight[i] = 1000 * diodeCurrent(j0, v, ROOM_T, jL);
    }
    const jOp = 1000 * diodeCurrent(j0, vOp, ROOM_T, jL);
    withPlotClip(ctx, iv, () => {
      // 軸の 0 の線
      ctx.save();
      ctx.strokeStyle = colors.hairline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const y0 = Math.round(iv.toPxY(0)) + 0.5;
      const x0 = Math.round(iv.toPxX(0)) + 0.5;
      ctx.moveTo(iv.rect.x, y0);
      ctx.lineTo(iv.rect.x + iv.rect.w, y0);
      ctx.moveTo(x0, iv.rect.y);
      ctx.lineTo(x0, iv.rect.y + iv.rect.h);
      ctx.stroke();
      // 電力を取り出せる象限(0 ≤ V ≤ V_oc で、光ありの曲線と J = 0 の間)
      if (voc > 0) {
        ctx.fillStyle = colors.beam;
        ctx.globalAlpha = 0.16;
        ctx.beginPath();
        ctx.moveTo(iv.toPxX(0), iv.toPxY(0));
        const m = 60;
        for (let i = 0; i <= m; i++) {
          const v = (voc * i) / m;
          ctx.lineTo(
            iv.toPxX(v),
            iv.toPxY(1000 * diodeCurrent(j0, v, ROOM_T, jL)),
          );
        }
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        // 動作点の電力 = 長方形の面積
        ctx.strokeStyle = colors.text2;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(
          iv.toPxX(0),
          iv.toPxY(0),
          iv.toPxX(vOp) - iv.toPxX(0),
          iv.toPxY(jOp) - iv.toPxY(0),
        );
      }
      ctx.restore();
      // 光なし(破線)と光あり(実線)
      curve(iv, ivV, ivDark, n, colors.text2, 1.6, true);
      curve(iv, ivV, ivLight, n, colors.level, 2.2, false);
      // 動作点
      const px = iv.toPxX(vOp);
      const py = iv.toPxY(jOp);
      ctx.save();
      ctx.fillStyle = colors.electron;
      ctx.strokeStyle = colors.bg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (dragHandle.focusedIndex() === 0) drawFocusRing(ctx, px, py);
    });
    // ラベル
    drawBoxedLabel(
      ctx,
      "光なし",
      iv.toPxX(0.5),
      iv.toPxY(6),
      colors,
      "right",
      colors.text2,
    );
    if (light > 0) {
      drawBoxedLabel(
        ctx,
        "光あり",
        iv.toPxX(0.02),
        iv.toPxY(-1000 * jL) + 12,
        colors,
        "left",
        colors.level,
      );
      drawBoxedLabel(
        ctx,
        narrow ? "電力を取り出せる" : "電力を取り出せる象限",
        iv.toPxX(0.04),
        iv.toPxY(-1000 * jL * 0.45),
        colors,
        "left",
        colors.beamInk,
      );
    }
  }

  function curve(
    m: PlotMapper,
    xs: Float64Array,
    ys: Float64Array,
    n: number,
    color: string,
    width: number,
    dashed: boolean,
  ): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    if (dashed) ctx.setLineDash([5, 4]);
    ctx.beginPath();
    const lo = m.yMin - 50;
    const hi = m.yMax + 50;
    for (let i = 0; i < n; i++) {
      const px = m.toPxX(xs[i]);
      const py = m.toPxY(clamp(ys[i], lo, hi));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ---- 全体 ---- */
  /** 太陽電池の 2 パネルの配置(寸法が変わったときだけ作り直す) */
  let layout = splitByFraction(host.size, 0.56, 0.52);
  let layoutW = host.size.w;
  let layoutH = host.size.h;
  let lastHandleX = NaN;
  let lastHandleY = NaN;

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const narrow = w < NARROW_WIDTH_PX;
    const left = narrow ? 34 : 58;
    if (mode === "led") {
      const scaleH = narrow ? 70 : 74;
      setPlotRange(
        band,
        left,
        22,
        w - left - 10,
        h - 22 - 34 - scaleH,
        -R,
        R,
        LED_E_MIN,
        LED_E_MAX,
      );
      drawBandPanel(narrow);
      drawWavelengthScale(left, w - 14, h - scaleH + 26, narrow);
    } else {
      if (w !== layoutW || h !== layoutH) {
        layout = splitByFraction(host.size, 0.56, 0.52);
        layoutW = w;
        layoutH = h;
      }
      const a = layout.first;
      const b = layout.second;
      setPlotRange(
        band,
        a.x + left,
        a.y + 22,
        a.w - left - 8,
        a.h - 22 - 34,
        -R,
        R,
        SOLAR_E_MIN,
        SOLAR_E_MAX,
      );
      const ivLeft = narrow ? 40 : 54;
      setPlotRange(
        iv,
        b.x + ivLeft,
        b.y + 18,
        b.w - ivLeft - 10,
        b.h - 18 - 40,
        IV_V_MIN,
        IV_V_MAX,
        IV_J_MIN,
        IV_J_MAX,
      );
      drawBandPanel(narrow);
      drawSplitDivider(ctx, layout, colors);
      drawIvPanel(narrow);
    }
    // 動作点の代理ボタンの位置を追従(変わったときだけ DOM を触る)
    const hx = opPoint.x();
    const hy = opPoint.y();
    if (hx !== lastHandleX || hy !== lastHandleY) {
      lastHandleX = hx;
      lastHandleY = hy;
      dragHandle.sync();
    }
    updateReadouts();
  }

  /* ---- 読み取り値(値が変わったときだけ文字列を作る) ---- */
  let shownMode: Mode | "" = "";
  let shownMaterial = "";
  let shownLight = NaN;
  let shownVop = NaN;
  function updateReadouts(): void {
    if (
      mode === shownMode &&
      material.id === shownMaterial &&
      light === shownLight &&
      vOp === shownVop
    ) {
      return;
    }
    shownMode = mode;
    shownMaterial = material.id;
    shownLight = light;
    shownVop = vOp;
    const led = mode === "led";
    for (const it of ledItems) it.el.hidden = !led;
    for (const it of solarItems) it.el.hidden = led;
    if (led) {
      const lam = emissionWavelengthNm(material.eg);
      egItem.set(`${material.eg.toFixed(2)} eV`);
      const region =
        lam < VIS_MIN
          ? "紫外"
          : lam <= VIS_MAX
            ? lam < 490
              ? "青"
              : "可視"
            : "赤外";
      lamItem.set(`${Math.round(lam)} nm(${region})`);
      typeItem.set(material.direct ? "直接遷移" : "間接遷移");
      emitItem.set(
        material.direct ? "ほぼ毎回" : "10 回に 1 回未満(実際はさらに少ない)",
      );
    } else {
      jscItem.set(`${(1000 * jL).toFixed(1)} mA/cm²`);
      vocItem.set(`${voc.toFixed(3)} V`);
      const p = -diodeCurrent(j0, vOp, ROOM_T, jL) * vOp;
      powerItem.set(
        `${(1000 * Math.max(0, p)).toFixed(1)} mW/cm²(V = ${vOp.toFixed(3)} V)`,
      );
    }
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const egItem = readout.item("E_g");
  const lamItem = readout.item("発光波長");
  const typeItem = readout.item("遷移の型");
  const emitItem = readout.item("光る割合(目安)");
  const jscItem = readout.item("短絡電流 J_sc");
  const vocItem = readout.item("開放電圧 V_oc");
  const powerItem = readout.item("動作点の電力", { color: "electron" });
  const ledItems = [egItem, lamItem, typeItem, emitItem];
  const solarItems = [jscItem, vocItem, powerItem];

  const modeSeg = host.controls.segmented<Mode>({
    id: "mode",
    label: "モード",
    options: [
      { value: "led", label: "LED" },
      { value: "solar", label: "太陽電池" },
    ],
    value: MODE_INIT,
  });
  const materialSeg = host.controls.segmented<MaterialId>({
    id: "material",
    label: "材料(LED)",
    options: LED_MATERIALS.map((m) => ({ value: m.id, label: m.label })),
    value: MATERIAL_INIT,
  });
  const lightSlider = host.controls.slider({
    id: "light",
    label: "光の強さ(太陽電池)",
    min: LIGHT_MIN,
    max: LIGHT_MAX,
    step: LIGHT_STEP,
    value: LIGHT_INIT,
    unit: "太陽",
    format: (v) => v.toFixed(2),
  });
  host.controls.playPause();

  const opPoint: DragPoint = {
    label: "太陽電池の動作点(左右の矢印キーで動かす)",
    x: () => (mode === "solar" ? iv.toPxX(vOp) : -1000),
    y: () =>
      mode === "solar"
        ? iv.toPxY(1000 * diodeCurrent(j0, vOp, ROOM_T, jL))
        : -1000,
    drag: (xPx) => {
      if (mode !== "solar") return;
      setOperatingPoint(iv.toValX(xPx));
    },
    key: (dx, dy, coarse) => {
      if (mode !== "solar") return;
      const s = dx !== 0 ? dx : dy;
      setOperatingPoint(vOp + s * (coarse ? KEY_STEP_COARSE : KEY_STEP));
    },
  };
  const dragHandle = attachDragPoints(host, [opPoint]);
  const handleEl = host.stage.querySelector<HTMLButtonElement>(".ix-handle");

  function applyMode(): void {
    const led = mode === "led";
    setControlEnabled(materialSeg.el, led);
    setControlEnabled(lightSlider.el, !led);
    if (handleEl) handleEl.hidden = led;
    lastHandleX = NaN;
  }

  modeSeg.onChange((v) => {
    mode = v;
    applyMode();
  });
  materialSeg.onChange((v) => {
    material = materialOf(v);
    updateEmission();
  });
  lightSlider.onChange((v) => {
    light = v;
    updateSolar();
  });

  host.controls.reset(() => {
    modeSeg.set(MODE_INIT);
    materialSeg.set(MATERIAL_INIT);
    lightSlider.set(LIGHT_INIT);
    mode = MODE_INIT;
    material = materialOf(MATERIAL_INIT);
    light = LIGHT_INIT;
    followMpp = true;
    updateEmission();
    updateSolar();
    warmUp();
    applyMode();
  });

  applyMode();

  /* ---- フレームループ(固定刻み 1/60 秒) ---- */
  const stepper = fixedStep(STEP_DT * 1000);
  host.onFrame((dt) => {
    stepper(dt, () => {
      ledEvents.step(STEP_DT);
      solarEvents.step(STEP_DT);
    });
    draw();
  });
  host.onRender(draw);

  return {
    destroy(): void {
      dragHandle.dispose();
      readout.el.remove();
    },
  };
}
