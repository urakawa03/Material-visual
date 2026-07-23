/**
 * pileup-backstress.ts — 図7「押し戻される源」(記事仕様書 02 §5.7・発展)
 *
 * 上面視を 1 次元に簡約: 左端に源(⊥ とミニ弧のアイコン)、右端に壁
 * (結晶粒界)。源から放出された転位を ⊥ の列で表示する(位置のみの
 * 1D モデル — lib/pileup.ts)。
 *
 * 放出が進むと背応力 τ_back が源に届き、τ_eff = τ_app − τ_back < τ_c で
 * 源は自己停止する。壁までの距離 d が大きいほど停止までの放出数 n が
 * 増える(粒径と強さの関係 = ホール・ペッチ則の入口)。
 *
 * 簡略化(図注に明示): 1 次元・直線転位の弾性相互作用のみ。
 * 源の詳細動作(図5)は既習として省略。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { PileupSim } from "./lib/pileup";
import { K_INTERACTION_MPA_UM, L_DEFAULT_UM, tauCMPa } from "./lib/constants";
import {
  FIG_FONT,
  FIG_FONT_SMALL,
  drawMessage,
  drawTeeSymbol,
  drawViewBadge,
  resolvePalette,
} from "./lib/draw";

/** d スライダー範囲(μm)と初期値(§5.7) */
const D_MIN = 0.5;
const D_MAX = 5;
const D_INIT = 2;
/** τ_app スライダー範囲(× τ_c)と初期値 */
const TAU_MIN_RATIO = 1.0;
const TAU_MAX_RATIO = 3.0;
const TAU_INIT_RATIO = 1.5;
/** 応力ゲージの上限(× τ_c) */
const GAUGE_MAX_RATIO = 3.2;

export default function pileupBackstress(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();
  const tauC = tauCMPa(L_DEFAULT_UM);

  const sim = new PileupSim({ K: K_INTERACTION_MPA_UM, tauC });
  sim.reset();
  sim.d = D_INIT;
  sim.tauApp = TAU_INIT_RATIO * tauC;

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    /* ---- 応力ゲージ(τ_app と τ_back の比較バー — §5.7) ---- */
    const gx0 = 120;
    const gx1 = w - 30;
    const gaugeVal = (ratio: number): number =>
      gx0 + Math.min(ratio / GAUGE_MAX_RATIO, 1) * (gx1 - gx0);
    const bars: Array<{
      y: number;
      label: string;
      ratio: number;
      color: string;
    }> = [
      {
        y: 18,
        label: "加える応力 τ_app",
        ratio: sim.tauApp / tauC,
        color: pal.accent,
      },
      {
        y: 40,
        label: "背応力 τ_back",
        ratio: sim.tauBack() / tauC,
        color: pal.defect,
      },
    ];
    ctx.font = FIG_FONT_SMALL;
    for (const bar of bars) {
      ctx.fillStyle = pal.text2;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(bar.label, gx0 - 8, bar.y + 5);
      ctx.strokeStyle = pal.hairline;
      ctx.strokeRect(gx0, bar.y, gx1 - gx0, 10);
      ctx.fillStyle = bar.color;
      ctx.fillRect(gx0, bar.y, gaugeVal(bar.ratio) - gx0, 10);
    }
    // τ_c の目盛
    const tcx = gaugeVal(1);
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(tcx, 12);
    ctx.lineTo(tcx, 56);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("τc", tcx + 4, 62);

    /* ---- すべり面(1D)---- */
    const planeY = h * 0.62;
    const x0 = 60;
    const x1 = w - 50;
    const pxOf = (xUm: number): number => x0 + (xUm / sim.d) * (x1 - x0);

    // すべり面の線
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(x0 - 20, planeY);
    ctx.lineTo(x1 + 10, planeY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 壁(結晶粒界)
    ctx.strokeStyle = pal.text;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x1, planeY - 70);
    ctx.lineTo(x1, planeY + 70);
    ctx.stroke();
    ctx.font = FIG_FONT_SMALL;
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("結晶粒界(壁)", x1, planeY + 76);

    // 源のアイコン(⊥ + ミニ弧)
    const stalled = sim.stalled;
    ctx.globalAlpha = stalled ? 0.45 : 1;
    ctx.strokeStyle = pal.defect;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x0 - 14, planeY, 16, -Math.PI * 0.42, Math.PI * 0.42);
    ctx.stroke();
    drawTeeSymbol(ctx, x0 - 14, planeY, 10, pal.defect, 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.fillText("源", x0 - 14, planeY + 76);

    // d の寸法線
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1;
    const dimY = planeY + 52;
    ctx.beginPath();
    ctx.moveTo(x0, dimY - 4);
    ctx.lineTo(x0, dimY + 4);
    ctx.moveTo(x0, dimY);
    ctx.lineTo(x1, dimY);
    ctx.moveTo(x1, dimY - 4);
    ctx.lineTo(x1, dimY + 4);
    ctx.stroke();
    ctx.fillText(`d = ${sim.d.toFixed(1)} μm`, (x0 + x1) / 2, dimY + 6);

    // 放出された転位(⊥ の列)
    for (const xi of sim.x) {
      drawTeeSymbol(ctx, pxOf(xi), planeY, 11, pal.defect, 2.2);
    }

    // 読み出し
    ctx.font = FIG_FONT;
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`放出数 n = ${sim.x.length}`, 14, 66);

    if (stalled) {
      drawMessage(
        ctx,
        w,
        h - 32,
        "源が止まった — 背応力で τ_eff < τ_c(パイルアップの反発が源に届いた)",
        pal,
      );
    }

    drawViewBadge(ctx, w, "top", pal);
  }

  /* ---- 操作部品(§5.7) ---- */

  const dSlider = host.controls.slider({
    id: "distance",
    label: "壁までの距離 d",
    min: D_MIN,
    max: D_MAX,
    step: 0.1,
    value: D_INIT,
    unit: "μm",
    format: (v) => v.toFixed(1),
  });
  dSlider.onChange((v) => {
    sim.d = v;
  });

  const tauSlider = host.controls.slider({
    id: "tau-app",
    label: "加える応力 τ_app",
    min: TAU_MIN_RATIO,
    max: TAU_MAX_RATIO,
    step: 0.05,
    value: TAU_INIT_RATIO,
    format: (v) => `${v.toFixed(2)} τc(${(v * tauC).toFixed(1)} MPa)`,
  });
  tauSlider.onChange((v) => {
    sim.tauApp = v * tauC;
  });

  host.controls.playPause();
  host.controls.reset(() => {
    sim.reset();
    sim.d = D_INIT;
    sim.tauApp = TAU_INIT_RATIO * tauC;
    dSlider.set(D_INIT);
    tauSlider.set(TAU_INIT_RATIO);
  });

  host.onFrame((dt) => {
    sim.advance(dt);
    draw();
  });
  host.onRender(draw);

  return {
    destroy(): void {
      /* イベントリスナーなし */
    },
  };
}
