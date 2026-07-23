/**
 * source-operation.ts — 図5「源の一回転」(記事仕様書 02 §5.5・本記事の中心図版)
 *
 * 節点法(lib/line.ts)によるフランク・リード源の連続動作。
 * 張り出し → 固定点の回り込み → 逆向き線分どうしの相殺 → ループ放出 →
 * 元の線分の再生、のサイクルを応力下で繰り返す。
 *
 * - ループがステージ余白を越えたらフェードアウトして除去し、n++
 *   (「結晶表面へ抜けた」扱い)。すべり量 nb を nm 換算で表示。
 * - τ < τ_c に下げると源は弧のまま静止し、既存ループは縮んで消える
 *   (格子摩擦ゼロの理想化 — 図注に明示)。
 * - 乱数不使用・完全決定論。NaN 検出時は自動リセット(開発時ログ)。
 *
 * 実装方式: onFrame + 固定タイムステップ(FrankReadSim 内蔵)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { FrankReadSim, TAU_C_SIM, type SimEvents } from "./lib/line";
import { B_NM, L_DEFAULT_UM, tauRatioToMPa } from "./lib/constants";
import {
  addSliderTick,
  drawGrid,
  drawPin,
  drawReadout,
  drawSenseChevrons,
  drawViewBadge,
  projectCurve,
  resolvePalette,
  strokePts,
} from "./lib/draw";

/** τ スライダーの範囲(× τ_c)と初期値(§5.5) */
const TAU_MAX_RATIO = 1.5;
const TAU_INIT_RATIO = 1.1;
/** 実時間 1 秒あたりのシミュレーション時間 */
const SIM_RATE = 1.5;
/** ループのフェードアウト時間(秒) */
const FADE_SECONDS = 0.6;
/** ステージ幅に対する L の割合(§5.5: 1/4 程度) */
const L_PER_WIDTH = 1 / 4;

export default function sourceOperation(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const pal = resolvePalette();
  const tauCMPaValue = tauRatioToMPa(1, L_DEFAULT_UM);

  const sim = new FrankReadSim();
  sim.tau = TAU_INIT_RATIO * TAU_C_SIM;
  const events: SimEvents = {
    recombined: false,
    collapsedLoops: 0,
    nan: false,
  };

  /** 放出ループ数(ステージ外へ抜けた数) */
  let emitted = 0;
  /** フェード中のループ: id → 経過秒 */
  const fading = new Map<number, number>();
  let showSense = false;

  let screenPts = new Float64Array(1024);
  function ensurePts(n: number): void {
    if (screenPts.length < 2 * n) {
      screenPts = new Float64Array(1 << Math.ceil(Math.log2(2 * n)));
    }
  }

  /** ループがここを越えたらフェード開始(世界座標・原点からの距離) */
  function escapeRadius(): number {
    const { w, h } = host.size;
    const scale = w * L_PER_WIDTH;
    const halfW = w / 2 / scale;
    const halfH = h / 2 / scale;
    return Math.max(halfW, halfH) + 0.4;
  }

  function update(dt: number): void {
    sim.advance(dt * SIM_RATE, events);
    if (events.nan) {
      console.warn("[source-operation] 数値破綻を検出したためリセットします");
      sim.reset();
      fading.clear();
      return;
    }
    // ステージ余白を越えたループはフェードへ(counted at 到達時 — §5.5)
    const rEscape = escapeRadius();
    for (const loop of sim.loops) {
      if (!fading.has(loop.id) && loop.maxRadius() > rEscape) {
        fading.set(loop.id, 0);
        emitted++;
      }
    }
    // フェード進行と除去
    for (const [id, t] of fading) {
      const t2 = t + dt;
      if (t2 >= FADE_SECONDS) {
        sim.removeLoop(id);
        fading.delete(id);
      } else {
        fading.set(id, t2);
      }
    }
    // 消滅済み(縮んで消えた)ループの掃除
    for (const id of fading.keys()) {
      if (!sim.loops.some((l) => l.id === id)) fading.delete(id);
    }
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawGrid(ctx, w, h, 40, pal.hairline);

    const scale = w * L_PER_WIDTH;
    const ox = w / 2;
    const oy = h / 2;

    ctx.lineJoin = "round";
    // 放出済みループ
    for (const loop of sim.loops) {
      ensurePts(loop.n);
      projectCurve(loop.x, loop.y, loop.n, ox, oy, scale, screenPts);
      const fade = fading.get(loop.id);
      ctx.globalAlpha =
        fade === undefined ? 1 : Math.max(1 - fade / FADE_SECONDS, 0);
      ctx.strokeStyle = pal.defect;
      ctx.lineWidth = 2.5;
      strokePts(ctx, screenPts, loop.n, true);
      if (showSense) {
        drawSenseChevrons(
          ctx,
          screenPts.subarray(0, loop.n * 2),
          6,
          true,
          pal.defectDark,
        );
      }
      ctx.globalAlpha = 1;
    }

    // 源の線分
    const src = sim.source;
    ensurePts(src.n);
    projectCurve(src.x, src.y, src.n, ox, oy, scale, screenPts);
    ctx.strokeStyle = pal.defect;
    ctx.lineWidth = 2.5;
    strokePts(ctx, screenPts, src.n, false);
    if (showSense) {
      drawSenseChevrons(
        ctx,
        screenPts.subarray(0, src.n * 2),
        5,
        false,
        pal.defectDark,
      );
    }

    // 固定点
    drawPin(ctx, ox + sim.pinAx * scale, oy, pal);
    drawPin(ctx, ox + sim.pinBx * scale, oy, pal);

    // 読み出し(§5.5)
    const slipNm = emitted * B_NM;
    drawReadout(
      ctx,
      [`放出ループ数 n = ${emitted}`, `すべり量 nb ≈ ${slipNm.toFixed(2)} nm`],
      14,
      12,
      pal,
    );

    drawViewBadge(ctx, w, "top", pal);
  }

  /* ---- 操作部品(§5.5) ---- */

  const tauSlider = host.controls.slider({
    id: "tau",
    label: "せん断応力 τ",
    min: 0,
    max: TAU_MAX_RATIO,
    step: 0.01,
    value: TAU_INIT_RATIO,
    format: (v) => `${v.toFixed(2)} τc(${(v * tauCMPaValue).toFixed(1)} MPa)`,
  });
  tauSlider.onChange((v) => {
    sim.tau = v * TAU_C_SIM;
  });
  const removeTick = addSliderTick(tauSlider.el, 1 / TAU_MAX_RATIO, "τc");

  const senseToggle = host.controls.toggle({
    id: "sense",
    label: "線の向きを表示",
    value: false,
  });
  senseToggle.onChange((v) => {
    showSense = v;
  });

  host.controls.playPause();
  host.controls.reset(() => {
    sim.reset();
    sim.tau = TAU_INIT_RATIO * TAU_C_SIM;
    tauSlider.set(TAU_INIT_RATIO);
    emitted = 0;
    fading.clear();
  });

  host.onFrame((dt) => {
    update(dt);
    draw();
  });
  host.onRender(draw);

  return {
    destroy(): void {
      removeTick();
    },
  };
}
