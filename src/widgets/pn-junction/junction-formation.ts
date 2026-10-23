/**
 * junction-formation.ts — 図1「くっつける」(仕様書 13 §5.1・中心図版)
 *
 * 上段(高さ 62%): 横長の結晶の帯。左半分が p 型、右半分が n 型。固定イオン
 * (左 = アクセプタ「−」、右 = ドナー「+」の `--mat-solute` の輪)を各 120 個、
 * 段に分けて並べ、その上に自由キャリア(左 = 正孔、右 = 電子の塗り丸)を
 * 各 120 個。イオンの上にキャリアが重なっている間は中性、キャリアが去ると輪
 * だけが「むき出し」になる。電場は帯のすぐ上に小さな矢印(n → p 向き)でも
 * 描く(「電場を表示」で on/off)。
 * 下段(高さ 38%): 同じ x 軸で、電荷密度のヒストグラム(80 区間。プラスは上・
 * マイナスは下)と電場の曲線。どちらも中立の量なので `--color-text-2`。
 *
 * 初期は接触前(左右の帯の間に細い隙間があり、キャリアは自分の側に閉じ込め
 * られている)・一時停止。「接触させる」で接触し、再生も始まる。
 *
 * モデル: lib/formation.ts の FormationSim(粒子の数・電場の強さ・時間を
 * 縮めた 1 次元の無次元模型。空乏層の幅は定性的)。下段のグラフと電場の矢印・
 * 坂の高さの読み取りは 0.4 秒の時間平均(粒子の揺らぎで読めなくならないよう
 * に。図注に明示)。
 *
 * 実装方式: 2D Canvas / onFrame + fixedStep(1/60 秒)。画面外・タブ非表示で
 * 停止(engine)。省モーション時は自動再生せず、「接触させる」を押すと内部で
 * 20 秒ぶん進めた平衡状態を 1 フレームで描く。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fixedStep } from "../../core/engine";
import { createReadout, drawArrow } from "../reciprocal-lattice/_shared2d";
import {
  acceptorX,
  AUX_HOME,
  BULK_NEAR_COUNT,
  CHARGE_BINS,
  donorX,
  FIELD_BINS,
  FORMATION_DT,
  FormationSim,
  IONS_PER_SIDE,
  NEAR_JUNCTION,
} from "./lib/formation";
import {
  drawBoxedLabel,
  drawDotsPx,
  drawIonRings,
  drawLabel,
  pnColors,
  prefersReducedMotion,
} from "./lib/draw";

/** 省モーション時に「接触させる」で内部で進める時間 [秒] */
const JUMP_SECONDS = 20;
/** 下段のグラフ・電場の矢印・坂の高さの時間平均の時定数 [秒] */
const SMOOTH_TAU = 0.4;
/** 接触前の左右の帯の隙間 [px] と、接触で閉じるまでの時間 [秒] */
const GAP_PX = 12;
const GAP_CLOSE_SECONDS = 0.3;
/** 電荷のグラフの縦軸(1 区間あたりの正味の電荷)と電場のグラフの縦軸 */
const CHARGE_RANGE = 6;
const FIELD_NEG = 8;
const FIELD_POS = 3;
/** 電場の矢印: 間隔の目安 [px]、最大の長さ [px]、描く下限の長さ [px] */
const ARROW_SPACING_PX = 26;
const ARROW_MAX_PX = 20;
const ARROW_MIN_PX = 5;
/** 電場の矢印の長さ: |𝓔| = 6 で最大の長さ */
const ARROW_FIELD_FULL = 6;
/** 再結合の印を描く時間 [秒] */
const EFFECT_SECONDS = 0.6;
const NARROW_WIDTH_PX = 480;

export default function junctionFormation(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = pnColors();
  const sim = new FormationSim();

  /* ---- 表示用の時間平均(下段のグラフ・矢印・坂の高さ) ---- */
  const hist = new Float64Array(CHARGE_BINS);
  const histAvg = new Float64Array(CHARGE_BINS);
  const fieldAvg = new Float64Array(FIELD_BINS + 1);
  function syncAverages(): void {
    sim.chargeHistogram(hist);
    histAvg.set(hist);
    fieldAvg.set(sim.field);
  }
  function updateAverages(dt: number): void {
    const a = 1 - Math.exp(-dt / SMOOTH_TAU);
    sim.chargeHistogram(hist);
    for (let j = 0; j < CHARGE_BINS; j++)
      histAvg[j] += a * (hist[j] - histAvg[j]);
    const f = sim.field;
    for (let k = 0; k <= FIELD_BINS; k++)
      fieldAvg[k] += a * (f[k] - fieldAvg[k]);
  }
  syncAverages();

  /* ---- 使い回す描画バッファ(px) ---- */
  const ionAX = new Float64Array(IONS_PER_SIDE);
  const ionAY = new Float64Array(IONS_PER_SIDE);
  const ionDX = new Float64Array(IONS_PER_SIDE);
  const ionDY = new Float64Array(IONS_PER_SIDE);
  const holeX = new Float64Array(IONS_PER_SIDE);
  const holeY = new Float64Array(IONS_PER_SIDE);
  const elecX = new Float64Array(IONS_PER_SIDE);
  const elecY = new Float64Array(IONS_PER_SIDE);
  /** 段の y 座標(最大 16 段) */
  const rowY = new Float64Array(16);
  const exposed = { left: 0, right: 0 };

  /* ---- レイアウト(寸法が変わったときだけ計算し直す) ---- */
  const L = {
    w: 0,
    h: 0,
    left: 0,
    right: 0,
    mid: 0,
    titleY: 0,
    arrowY: 0,
    bandTop: 0,
    bandBottom: 0,
    rows: 4,
    ringR: 5,
    dotR: 4,
    bracketY: 0,
    chargeTop: 0,
    chargeMid: 0,
    chargeHalf: 0,
    fieldTop: 0,
    fieldZero: 0,
    fieldBottom: 0,
    narrow: false,
  };

  function layout(): void {
    const { w, h } = host.size;
    if (w === L.w && h === L.h) return;
    L.w = w;
    L.h = h;
    L.narrow = w < NARROW_WIDTH_PX;
    L.left = L.narrow ? 40 : 52;
    L.right = w - (L.narrow ? 10 : 16);
    L.mid = (L.left + L.right) / 2;
    const upperH = Math.round(h * 0.62);
    L.titleY = 13;
    L.arrowY = 38;
    L.bandTop = 52;
    L.bandBottom = upperH - 22;
    L.bracketY = upperH - 10;
    const bandH = L.bandBottom - L.bandTop;
    const halfW = (L.right - L.left) / 2;
    // イオンの並びがおおよそ等方的になるように段の数を選ぶ
    L.rows = Math.max(
      3,
      Math.min(12, Math.round(Math.sqrt((IONS_PER_SIDE * bandH) / halfW))),
    );
    for (let r = 0; r < L.rows; r++) {
      rowY[r] = L.bandTop + ((r + 0.5) * bandH) / L.rows;
    }
    const dxRow = (L.rows * halfW) / IONS_PER_SIDE;
    const dyRow = bandH / L.rows;
    L.ringR = Math.max(2.6, Math.min(6, 0.32 * Math.min(dxRow, dyRow)));
    L.dotR = Math.max(2, L.ringR - 0.7);
    // 下段: 電荷(上)と電場(下)の 2 本の細いグラフ
    const lowerTop = upperH + 8;
    const lowerH = h - lowerTop - 8;
    const gap = 14;
    const gh = (lowerH - gap) / 2;
    L.chargeTop = lowerTop;
    L.chargeMid = lowerTop + gh / 2;
    L.chargeHalf = gh / 2 - 2;
    L.fieldTop = lowerTop + gh + gap;
    L.fieldBottom = L.fieldTop + gh;
    L.fieldZero = L.fieldTop + (gh * FIELD_POS) / (FIELD_POS + FIELD_NEG);
    // 固定イオンの位置(段は番号で決める)
    for (let i = 0; i < IONS_PER_SIDE; i++) {
      ionAY[i] = rowY[i % L.rows];
      ionDY[i] = rowY[i % L.rows];
    }
  }

  /** 接触前の隙間の幅 [px](接触後 0.3 秒で閉じる) */
  function gapPx(): number {
    if (!sim.contacted) return GAP_PX;
    return GAP_PX * Math.max(0, 1 - sim.timeSinceContact / GAP_CLOSE_SECONDS);
  }

  /** 模型の位置 x(−1〜1)→ px(接触前は左右の間に隙間) */
  function toPx(x: number, gap: number): number {
    const half = (L.right - L.left) / 2 - gap / 2;
    return x < 0 ? L.left + (x + 1) * half : L.mid + gap / 2 + x * half;
  }

  /* ---- 描画 ---- */
  function drawUpper(gap: number, showField: boolean): void {
    const { bandTop, bandBottom } = L;
    // 結晶の帯(左 = p 型、右 = n 型)
    ctx.save();
    ctx.strokeStyle = colors.hairline;
    ctx.lineWidth = 1;
    const lx0 = toPx(-1, gap);
    const lx1 = toPx(-1e-9, gap);
    const rx0 = toPx(0, gap);
    const rx1 = toPx(1, gap);
    ctx.strokeRect(
      lx0 - 4.5,
      bandTop - 4.5,
      lx1 - lx0 + 9,
      bandBottom - bandTop + 9,
    );
    if (gap > 0.5) {
      ctx.strokeRect(
        rx0 - 4.5,
        bandTop - 4.5,
        rx1 - rx0 + 9,
        bandBottom - bandTop + 9,
      );
    } else {
      ctx.strokeRect(
        lx0 - 4.5,
        bandTop - 4.5,
        rx1 - lx0 + 9,
        bandBottom - bandTop + 9,
      );
      // 境目の薄い縦線
      ctx.beginPath();
      ctx.moveTo(Math.round(L.mid) + 0.5, bandTop - 4);
      ctx.lineTo(Math.round(L.mid) + 0.5, bandBottom + 4);
      ctx.stroke();
    }
    ctx.restore();
    drawLabel(
      ctx,
      "p 型",
      (lx0 + lx1) / 2,
      L.titleY,
      colors.hole,
      "center",
      "middle",
    );
    drawLabel(
      ctx,
      "n 型",
      (rx0 + rx1) / 2,
      L.titleY,
      colors.electron,
      "center",
      "middle",
    );

    // 固定イオン(輪 + 符号)
    for (let i = 0; i < IONS_PER_SIDE; i++) {
      ionAX[i] = toPx(acceptorX(i), gap);
      ionDX[i] = toPx(donorX(i), gap);
    }
    drawIonRings(ctx, ionAX, ionAY, IONS_PER_SIDE, L.ringR, "−", colors);
    drawIonRings(ctx, ionDX, ionDY, IONS_PER_SIDE, L.ringR, "+", colors);

    // 再結合の印(出会って消えた場所に、薄い輪を短い間だけ)
    const now = sim.time;
    ctx.save();
    ctx.strokeStyle = colors.text2;
    ctx.lineWidth = 1.2;
    for (let k = 0; k < sim.effectCount; k++) {
      const age = now - sim.effectT0[k];
      if (age < 0 || age > EFFECT_SECONDS) continue;
      const t = age / EFFECT_SECONDS;
      ctx.globalAlpha = 0.8 * (1 - t);
      const px = toPx(sim.effectX[k], gap);
      const py = rowY[Math.round(sim.effectHome[k]) % L.rows];
      ctx.beginPath();
      ctx.arc(px, py, L.ringR + 2 + 6 * t, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // 自由キャリア(塗り丸。持ち場の段の高さで横に動く)
    const h = sim.holes;
    for (let i = 0; i < h.count; i++) {
      holeX[i] = toPx(h.x[i], gap);
      holeY[i] = rowY[Math.round(h.aux[AUX_HOME][i]) % L.rows];
    }
    const e = sim.electrons;
    for (let i = 0; i < e.count; i++) {
      elecX[i] = toPx(e.x[i], gap);
      elecY[i] = rowY[Math.round(e.aux[AUX_HOME][i]) % L.rows];
    }
    drawDotsPx(ctx, holeX, holeY, h.count, L.dotR, colors.hole);
    drawDotsPx(ctx, elecX, elecY, e.count, L.dotR, colors.electron);

    // 電場の矢印(帯のすぐ上。n → p 向き = 電場が負なら左向き)
    if (showField && sim.contacted) {
      const n = Math.max(6, Math.floor((L.right - L.left) / ARROW_SPACING_PX));
      for (let j = 0; j < n; j++) {
        const x = -1 + (2 * (j + 0.5)) / n;
        const k = Math.round(((x + 1) / 2) * FIELD_BINS);
        const f = fieldAvg[k];
        const len = Math.min(
          ARROW_MAX_PX,
          (Math.abs(f) / ARROW_FIELD_FULL) * ARROW_MAX_PX,
        );
        if (len < ARROW_MIN_PX) continue;
        const cx = toPx(x, gap);
        const dir = f < 0 ? -1 : 1;
        drawArrow(
          ctx,
          cx - (dir * len) / 2,
          L.arrowY,
          cx + (dir * len) / 2,
          L.arrowY,
          {
            color: colors.text2,
            width: 1.6,
            head: 6,
          },
        );
      }
      drawLabel(ctx, "電場", L.left - 8, L.arrowY, colors.text2, "right");
    }

    // 「接合面付近」(読み取りの範囲)の括弧
    const bx0 = toPx(-NEAR_JUNCTION, gap);
    const bx1 = toPx(NEAR_JUNCTION, gap);
    const by = L.bracketY;
    ctx.save();
    ctx.strokeStyle = colors.text2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx0, by - 5);
    ctx.lineTo(bx0, by);
    ctx.lineTo(bx1, by);
    ctx.lineTo(bx1, by - 5);
    ctx.stroke();
    ctx.restore();
    drawLabel(ctx, "接合面付近", bx1 + 6, by - 1, colors.text2, "left");
  }

  function drawLower(gap: number): void {
    const x0 = L.left;
    const x1 = L.right;
    // 電荷密度(プラスは上・マイナスは下)
    ctx.save();
    ctx.strokeStyle = colors.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(L.chargeMid) + 0.5);
    ctx.lineTo(x1, Math.round(L.chargeMid) + 0.5);
    ctx.moveTo(x0, Math.round(L.fieldZero) + 0.5);
    ctx.lineTo(x1, Math.round(L.fieldZero) + 0.5);
    ctx.stroke();
    ctx.fillStyle = colors.text2;
    ctx.globalAlpha = 0.6;
    const scale = L.chargeHalf / CHARGE_RANGE;
    for (let j = 0; j < CHARGE_BINS; j++) {
      const v = histAvg[j];
      if (Math.abs(v) < 0.02) continue;
      const xa = -1 + (2 * j) / CHARGE_BINS;
      const xb = -1 + (2 * (j + 1)) / CHARGE_BINS;
      const pa = toPx(xa + 1e-9, gap);
      const pb = toPx(xb - 1e-9, gap);
      const hpx = Math.max(-L.chargeHalf, Math.min(L.chargeHalf, v * scale));
      if (hpx > 0) ctx.fillRect(pa + 0.5, L.chargeMid - hpx, pb - pa - 1, hpx);
      else ctx.fillRect(pa + 0.5, L.chargeMid, pb - pa - 1, -hpx);
    }
    ctx.restore();

    // 電場の曲線
    const fScale = (L.fieldBottom - L.fieldTop) / (FIELD_POS + FIELD_NEG);
    ctx.save();
    ctx.strokeStyle = colors.text2;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let k = 0; k <= FIELD_BINS; k++) {
      const x = -1 + (2 * k) / FIELD_BINS;
      const v = Math.max(-FIELD_NEG, Math.min(FIELD_POS, fieldAvg[k]));
      const px = toPx(k === FIELD_BINS / 2 ? 0 : x, gap);
      const py = L.fieldZero - v * fScale;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();

    // ラベル
    const lx = x0 - 8;
    drawLabel(ctx, "電荷", lx, L.chargeMid - 8, colors.text2, "right");
    drawLabel(ctx, "+ / −", lx, L.chargeMid + 8, colors.text2, "right");
    drawLabel(ctx, "電場", lx, L.fieldZero, colors.text2, "right");
    drawBoxedLabel(
      ctx,
      L.narrow ? "下向き = 左向き" : "下向き = 左向き(n → p)",
      x1 - 2,
      L.fieldBottom - 8,
      colors,
      "right",
    );
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    layout();
    const gap = gapPx();
    drawUpper(gap, fieldToggle.value);
    drawLower(gap);
    updateReadouts();
  }

  /* ---- 読み取り値(値が変わったときだけ文字列を作る) ---- */
  let shownPairs = -1;
  let shownExposed = -1;
  let shownNear = -1;
  let shownBarrier = -2;
  function updateReadouts(): void {
    if (sim.recombined !== shownPairs) {
      shownPairs = sim.recombined;
      pairsItem.set(`${sim.recombined} 対`);
    }
    sim.exposedIons(exposed);
    const key = exposed.left * 1000 + exposed.right;
    if (key !== shownExposed) {
      shownExposed = key;
      exposedItem.set(`左 ${exposed.left} 個 / 右 ${exposed.right} 個`);
    }
    const near = sim.nearJunctionCount();
    if (near !== shownNear) {
      shownNear = near;
      nearItem.set(`${near} 個(バルク換算 ${BULK_NEAR_COUNT} 個)`);
    }
    const b = sim.contacted
      ? Math.round(sim.barrierInThermal(fieldAvg) * 10)
      : -1;
    if (b !== shownBarrier) {
      shownBarrier = b;
      barrierItem.set(
        sim.contacted
          ? `熱エネルギーの ${(Math.max(0, b) / 10).toFixed(1)} 倍`
          : "—(接触前)",
      );
    }
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const pairsItem = readout.item("再結合した対");
  const exposedItem = readout.item("むき出しのイオン");
  const nearItem = readout.item("接合面付近の自由キャリア");
  const barrierItem = readout.item("坂の高さ");

  const contactBtn = host.controls.button({ label: "接触させる" });
  host.controls.playPause();
  const fieldToggle = host.controls.toggle({
    id: "field",
    label: "電場を表示",
    value: true,
  });

  contactBtn.onClick(() => {
    if (sim.contacted) return;
    sim.contact();
    contactBtn.el.disabled = true;
    if (prefersReducedMotion()) {
      // 省モーション: 内部で 20 秒ぶん進めた平衡状態を 1 フレームで描く
      sim.advance(Math.round(JUMP_SECONDS / FORMATION_DT));
      syncAverages();
      host.requestRender();
    } else {
      host.setPlaying(true);
    }
  });

  host.controls.reset(() => {
    sim.reset();
    syncAverages();
    contactBtn.el.disabled = false;
    fieldToggle.set(true);
    host.setPlaying(false);
  });

  /* ---- フレームループ(固定刻み 1/60 秒) ---- */
  const stepper = fixedStep(FORMATION_DT * 1000);
  host.onFrame((dt) => {
    stepper(dt, () => sim.step());
    updateAverages(dt);
    draw();
  });
  host.onRender(draw);
  // 初期は接触前・一時停止(§5.1)
  host.setPlaying(false);

  return {
    resize(): void {
      L.w = 0;
    },
    destroy(): void {
      readout.el.remove();
    },
  };
}
