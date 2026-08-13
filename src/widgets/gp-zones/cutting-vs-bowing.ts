/**
 * cutting-vs-bowing.ts — 図6「切るか、迂回するか」(記事仕様書 07 §5.6)
 *
 * すべり面の上面視。間隔 L で並ぶ 2 個の析出粒子(--mat-precip)と、その間に
 * 張られた転位線(--mat-defect)。応力を上げていくと、転位は**安い方の道**を
 * 通る:
 *   - せん断(切断): τ ≥ τ_cut で粒子を切って通る。粒子に b のずれが残る。
 *   - 迂回(オロワン): τ ≥ τ_bow で粒子の背後に回り込み、腕どうしが相殺して
 *     粒子を取り巻くループを残して進む。
 *
 * **迂回の動力学はフランク・リード源記事の `lib/line.ts`(FrankReadSim)を
 * そのまま使う**(再実装しない — 仕様書 07 §5.0)。無次元応力は
 * τ^sim = τ_c^sim · τ/τ_bow で与える。図6 はフランク・リード源記事 図5 の
 * 親戚である。
 *
 * 視野は粒子間隔 L で規格化してある(f 一定なので r を変えても図形は相似)。
 * 絶対寸法はスケールバーと L の寸法線で伝える(オストワルド記事 図7 と同じ流儀)。
 *
 * 簡略化(図注): 理想化モデル(等方弾性・一定線張力・過減衰・格子摩擦なし)。
 * せん断の抵抗則は √(rf) の現象論。粒子は球で代表。
 */

import type { FigureHost, WidgetHandle } from "../types";
import {
  FrankReadSim,
  TAU_C_SIM,
  type SimEvents,
} from "../frank-read-source/lib/line";
import { clamp, easeOutCubic, smoothstep } from "../../core/mathx";
import { B_NM } from "./lib/constants";
import { bowingMPa, shearingMPa, spacing } from "./lib/aging";
import {
  type Pane,
  arrow,
  badge,
  drawReadouts,
  fmtSig,
  font,
  linTicks,
  projectCurve,
  resolvePalette,
  strokePts,
} from "./lib/draw";

/** 粒子半径スライダー [nm] */
const R_MIN = 0.5;
const R_MAX = 12;
const R_INIT = 1.5;
/** 応力スライダー [MPa] */
const TAU_MAX_MPA = 400;
const TAU_STEP = 5;
/** 体積分率(ピーク時効相当。本図では固定) */
const F_FIXED = 0.07;
/** 実時間 1 秒あたりのシミュレーション時間(フランク・リード源 図5 と同じ流儀) */
const SIM_RATE = 1.5;
/** 無次元応力の上限(数値安定のため) */
const TAU_SIM_MAX = 6;
/** 切断アニメの長さ [s] */
const CUT_SECONDS = 0.9;
/** 迂回して抜けた線が消えるまで [s] */
const ESCAPE_SECONDS = 1.4;
/** 応力ランプの長さ [s] */
const RAMP_SECONDS = 2.5;
/** 粒子中心の間隔がステージ幅に占める割合 */
const L_PER_WIDTH = 0.55;
/** 切られた粒子のずれ(見た目の誇張) */
const SHEAR_STEP = 0.32;

const TAU2 = Math.PI * 2;

type Phase = "idle" | "cut" | "bypass" | "done";

export default function cuttingVsBowing(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const c = resolvePalette();

  const sim = new FrankReadSim();
  const events: SimEvents = {
    recombined: false,
    collapsedLoops: 0,
    nan: false,
  };
  let screenPts = new Float64Array(1024);
  function ensurePts(n: number): void {
    if (screenPts.length < 2 * n) {
      screenPts = new Float64Array(1 << Math.ceil(Math.log2(2 * n)));
    }
  }

  let rNm = R_INIT;
  let tauMPa = 0;
  let phase: Phase = "idle";
  let phaseT = 0;
  /** 粒子が切られた(せん断で通過した)か */
  let sheared = false;
  /** 粒子にオロワンループが残っているか */
  let orowan = false;
  /** 応力ランプ中か */
  let ramping = false;

  const tauCut = (): number => shearingMPa(rNm, F_FIXED);
  const tauBow = (): number => bowingMPa(rNm, F_FIXED);
  /** いま安い(先に起きる)機構 */
  const activeMech = (): "cut" | "bow" =>
    tauCut() <= tauBow() ? "cut" : "bow";
  const threshold = (): number => Math.min(tauCut(), tauBow());

  /** 無次元応力(τ_c^sim = 2 が迂回のしきい値になるよう規格化) */
  function tauSim(): number {
    return Math.min((TAU_C_SIM * tauMPa) / tauBow(), TAU_SIM_MAX);
  }

  function rearm(): void {
    sim.reset();
    sim.tau = tauSim();
    phase = "idle";
    phaseT = 0;
  }

  /* ---- 操作部品(§7.2) ---- */

  const rSlider = host.controls.slider({
    id: "r",
    label: "粒子半径 r",
    min: R_MIN,
    max: R_MAX,
    value: R_INIT,
    scale: "log",
    unit: "nm",
  });
  rSlider.onChange((v) => {
    rNm = v;
    sheared = false;
    orowan = false;
    rearm();
    host.requestRender();
  });

  const tauSlider = host.controls.slider({
    id: "tau",
    label: "せん断応力 τ",
    min: 0,
    max: TAU_MAX_MPA,
    step: TAU_STEP,
    value: 0,
    unit: "MPa",
  });
  tauSlider.onChange((v) => {
    tauMPa = v;
    sim.tau = tauSim();
    if (phase === "done" && tauMPa < threshold()) rearm();
    if (tauMPa > 0 || phase !== "idle") host.setPlaying(true);
  });

  const rampBtn = host.controls.button({ label: "応力を上げていく" });
  rampBtn.onClick(() => {
    sheared = false;
    orowan = false;
    tauSlider.set(0);
    rearm();
    ramping = true;
    host.setPlaying(true);
  });

  host.controls.playPause();
  host.controls.reset(() => {
    rSlider.set(R_INIT);
    tauSlider.set(0);
    sheared = false;
    orowan = false;
    ramping = false;
    rearm();
    host.setPlaying(false);
  });

  /* ---- 更新 ---- */

  function update(dt: number): void {
    if (ramping) {
      const target = threshold() * 1.05;
      const next = tauMPa + (target / RAMP_SECONDS) * dt;
      if (next >= target) {
        ramping = false;
        tauSlider.set(Math.min(target, TAU_MAX_MPA));
      } else {
        tauSlider.set(next);
      }
    }

    switch (phase) {
      case "idle": {
        sim.advance(dt * SIM_RATE, events);
        if (events.nan) {
          rearm();
          break;
        }
        if (tauMPa >= threshold()) {
          if (activeMech() === "cut") {
            phase = "cut";
            phaseT = 0;
          } else {
            phase = "bypass";
            phaseT = 0;
          }
        }
        break;
      }
      case "cut": {
        phaseT += dt;
        if (phaseT >= CUT_SECONDS) {
          sheared = true;
          phase = "done";
          phaseT = 0;
        }
        break;
      }
      case "bypass": {
        sim.advance(dt * SIM_RATE, events);
        if (events.nan) {
          rearm();
          break;
        }
        if (events.recombined) orowan = true;
        if (orowan) {
          phaseT += dt;
          if (phaseT >= ESCAPE_SECONDS) {
            phase = "done";
            phaseT = 0;
          }
        }
        break;
      }
      case "done":
        // 応力を下げると再挑戦できる(rearm はスライダー側で処理)
        if (!ramping) host.setPlaying(false);
        break;
    }
  }

  /* ---- レイアウト ---- */

  function layout(): { bars: Pane; stage: Pane; narrow: boolean } {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    const strip = narrow ? 34 : 22;
    const top = pad + strip;
    const barsW = narrow ? 86 : 112;
    return {
      bars: { x: pad, y: top, w: barsW, h: h - top - pad },
      stage: {
        x: pad + barsW + 8,
        y: top,
        w: w - pad * 2 - barsW - 8,
        h: h - top - pad,
      },
      narrow,
    };
  }

  /* ---- 描画 ---- */

  /** 2 本のしきい値バーと現在応力 */
  function drawBars(p: Pane, narrow: boolean): void {
    const y0 = p.y + 22;
    const y1 = p.y + p.h - 26;
    const toY = (v: number): number =>
      y1 - ((y1 - y0) * clamp(v, 0, TAU_MAX_MPA)) / TAU_MAX_MPA;
    const barW = narrow ? 26 : 34;
    const gap = narrow ? 10 : 16;
    const x0 = p.x + (p.w - barW * 2 - gap) / 2;

    ctx.font = font(narrow ? 10 : 11);
    ctx.fillStyle = c.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("必要な応力 [MPa]", p.x, p.y);

    // 目盛り
    ctx.strokeStyle = c.hairline;
    ctx.lineWidth = 1;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of linTicks(0, TAU_MAX_MPA, 4)) {
      const y = toY(v);
      ctx.beginPath();
      ctx.moveTo(x0 - 5, y + 0.5);
      ctx.lineTo(x0 - 2, y + 0.5);
      ctx.stroke();
      if (!narrow) ctx.fillText(String(v), x0 - 7, y);
    }

    const cheap = activeMech();
    const entries: ReadonlyArray<[string, number, string, boolean]> = [
      ["切る", tauCut(), c.precip, cheap === "cut"],
      ["迂回", tauBow(), c.defect, cheap === "bow"],
    ];
    entries.forEach(([label, value, color, isCheap], i) => {
      const x = x0 + i * (barW + gap);
      const yv = toY(value);
      ctx.globalAlpha = isCheap ? 0.9 : 0.35;
      ctx.fillStyle = color;
      ctx.fillRect(x, yv, barW, y1 - yv);
      ctx.globalAlpha = 1;
      if (isCheap) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.strokeRect(x - 0.5, yv - 0.5, barW + 1, y1 - yv + 1);
      }
      ctx.font = font(narrow ? 10 : 11, isCheap ? 600 : 400);
      ctx.fillStyle = isCheap ? color : c.text2;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(label, x + barW / 2, y1 + 4);
      ctx.textBaseline = "bottom";
      ctx.fillText(
        value > TAU_MAX_MPA ? "≫" : String(Math.round(value)),
        x + barW / 2,
        yv - 3,
      );
    });

    // 現在応力の水平線
    const yNow = toY(tauMPa);
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = c.text;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0 - 6, yNow + 0.5);
    ctx.lineTo(x0 + barW * 2 + gap + 6, yNow + 0.5);
    ctx.stroke();
    ctx.restore();
    // ラベルはバーの値表示や軸ラベルと重なりやすいので、下地を敷いたうえで
    // 線が下端に近いときは線の上に置く
    ctx.font = font(narrow ? 10 : 11, 600);
    const label = `τ = ${Math.round(tauMPa)}`;
    const lw = ctx.measureText(label).width;
    const above = yNow > y1 - 20;
    const ly = above ? yNow - 16 : yNow + 2;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = c.bg;
    ctx.fillRect(x0 - 6, ly, lw + 6, 14);
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(label, x0 - 4, ly + 1);
  }

  /** 粒子(切られていれば b のずれを付けた 2 つの半円) */
  function drawParticle(x: number, y: number, r: number): void {
    if (!sheared) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU2);
      ctx.fillStyle = c.precip;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = c.precipEdge;
      ctx.stroke();
      return;
    }
    const d = r * SHEAR_STEP;
    ctx.fillStyle = c.precip;
    ctx.strokeStyle = c.precipEdge;
    ctx.lineWidth = 1.5;
    // 上半分を右へ、下半分を左へずらす(すべり面でのせん断)
    ctx.beginPath();
    ctx.arc(x + d, y, r, Math.PI, TAU2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x - d, y, r, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawStage(p: Pane, narrow: boolean): void {
    ctx.strokeStyle = c.hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();

    const scale = p.w * L_PER_WIDTH; // 無次元 1(= L)あたりの px
    const ox = p.x + p.w / 2;
    const oy = p.y + p.h * 0.56;
    const lNm = spacing(rNm, F_FIXED);
    // 粒子半径は L で規格化(f 一定なので r/L = √f/β の定数)
    const rPx = Math.max((rNm / lNm) * scale, 5);

    // すべり面(水平の破線)
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = c.hairline;
    ctx.beginPath();
    ctx.moveTo(p.x, oy + 0.5);
    ctx.lineTo(p.x + p.w, oy + 0.5);
    ctx.stroke();
    ctx.restore();

    // 応力の向き(線を押す向き = 画面上向き)
    if (tauMPa > 0) {
      const ax = p.x + 22;
      arrow(ctx, ax, oy + 26, ax, oy - 26, c.text2, 2, 7);
      ctx.font = font(10.5);
      ctx.fillStyle = c.text2;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("τ", ax + 5, oy);
    }

    // 粒子(固定点)
    const pinAx = ox + sim.pinAx * scale;
    const pinBx = ox + sim.pinBx * scale;

    // 転位線 / 放出された線
    ctx.lineJoin = "round";
    ctx.strokeStyle = c.defect;
    ctx.lineWidth = 2.5;
    if (phase === "cut" || (phase === "done" && sheared)) {
      // 切って通過: 線が上方へ抜けていく(残った垂みは減衰)
      const u = phase === "cut" ? phaseT / CUT_SECONDS : 1;
      // 抜けていく距離はステージ内に収める(L で規格化すると画面外へ出るため)
      const travel = Math.min(scale * 0.9, p.h * 0.34);
      const yFree = oy - (rPx + 6) - travel * easeOutCubic(u);
      // 通過後も薄く残し、「転位が抜けていった」ことが静止画でも読めるようにする
      ctx.globalAlpha = 1 - 0.65 * smoothstep(0.75, 1, u);
      ctx.beginPath();
      ctx.moveTo(p.x, yFree);
      ctx.lineTo(p.x + p.w, yFree);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      for (const loop of sim.loops) {
        ensurePts(loop.n);
        projectCurve(loop.x, loop.y, loop.n, ox, oy, scale, screenPts);
        ctx.globalAlpha =
          phase === "bypass" && orowan
            ? Math.max(0, 1 - phaseT / ESCAPE_SECONDS)
            : 1;
        strokePts(ctx, screenPts, loop.n, true);
        ctx.globalAlpha = 1;
      }
      const src = sim.source;
      ensurePts(src.n);
      projectCurve(src.x, src.y, src.n, ox, oy, scale, screenPts);
      strokePts(ctx, screenPts, src.n, false);
    }

    // 粒子に残ったオロワンループ
    if (orowan) {
      ctx.strokeStyle = c.defect;
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      for (const x of [pinAx, pinBx]) {
        ctx.moveTo(x + rPx * 1.45, oy);
        ctx.arc(x, oy, rPx * 1.45, 0, TAU2);
      }
      ctx.stroke();
    }

    drawParticle(pinAx, oy, rPx);
    drawParticle(pinBx, oy, rPx);

    // L の寸法線
    const yd = oy + Math.max(rPx + 26, 44);
    arrow(ctx, pinAx, yd, pinBx, yd, c.text2, 2, 7);
    arrow(ctx, pinBx, yd, pinAx, yd, c.text2, 2, 7);
    ctx.font = font(narrow ? 11 : 12);
    ctx.fillStyle = c.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(`L = ${fmtSig(lNm)} nm`, ox, yd + 5);

    // 状態バッジ
    if (phase === "done") {
      badge(
        ctx,
        sheared
          ? `切って通った(粒子に ${B_NM} nm のずれ)`
          : "迂回した(オロワンループが残る)",
        p.x + 8,
        p.y + 8,
        sheared ? c.precipEdge : c.defect,
        sheared ? c.precip : c.defect,
      );
    }
    ctx.restore();
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const l = layout();
    drawReadouts(
      ctx,
      [
        [`r ${fmtSig(rNm)} nm`, c.text],
        [`L ${fmtSig(spacing(rNm, F_FIXED))} nm`, c.text],
        [`切る ${fmtSig(tauCut())} MPa`, c.precipEdge],
        [`迂回 ${fmtSig(tauBow())} MPa`, c.defect],
        [
          activeMech() === "cut" ? "安い道: 切って通る" : "安い道: 迂回する",
          c.text2,
        ],
      ],
      l.narrow ? 8 : 12,
      l.narrow ? 6 : 8,
      w - 8,
      l.narrow,
    );
    drawBars(l.bars, l.narrow);
    drawStage(l.stage, l.narrow);
  }

  host.onFrame((dt) => {
    update(dt);
    draw();
  });
  host.onRender(draw);
  sim.tau = 0;
  host.setPlaying(false);

  return {
    destroy(): void {
      // 追加のイベントリスナーは持たない
    },
  };
}
