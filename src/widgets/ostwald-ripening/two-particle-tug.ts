/**
 * two-particle-tug.ts — 図4「大は小を食う」(記事仕様書 03 §5.4)
 *
 * 上段: 母相中の 2 粒子(左: 小、右: 大)。溶質ドットが小 → 大へ平均ドリフト
 * するランダムウォークで、界面近傍の濃度差と拡散流の向きを見せる(装飾)。
 * 下段: 2 粒子を結ぶ線上の準定常濃度プロファイル c(x)/c∞(1±0.4 を拡大表示)。
 *
 * モデル: dr_i/dτ = (A/r_i)(1/r*₂ − 1/r_i)·g(d)、r*₂ = (r1+r2)/2(2 粒子の
 * 体積保存閉包)、g(d) = d₀/d(d₀ = 60 nm。距離が遠いほど遅い模式係数)。
 * A = A_GROWTH_NM3S。積分は体積空間 v = r³ の Heun 法(サブ刻み ≤ 2 τ秒)で
 * 行い、Σr³ を厳密に保存する。r1 < r_dis で溶解演出(縮んで消え、残量は
 * 体積保存により粒子2 へ渡る)。温度は 200 °C 固定で、エンジン時間 τ を
 * そのまま「経過 …(200 °C 換算)」として表示する(§5.0)。
 *
 * 簡略化(図注で明示): 1 対 1・準定常・模式配置。実際は 3 次元の拡散場での
 * 多体問題。溶質ドットの運動・密度は装飾で物質収支は取らない。g(d) と
 * 閉包式は実装用で本文非掲載。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { darken, matColor, uiColor } from "../../core/colors";
import { clamp, gaussian, mulberry32 } from "../../core/mathx";
import { R_DIS_NM, formatDuration, gibbsThomsonRatio } from "./lib/constants";
import { A_GROWTH_NM3S } from "./lib/ripening";
import { arrow, font, linTicks } from "./lib/draw";

/** 乱数シード(reset で完全に同じ初期状態へ — 母体仕様 §8.2) */
const SEED = 4;
/** 粒子1(小)の初期半径 [nm](固定 — §5.4) */
const R1_INIT_NM = 6;
/** 初期サイズ比 r2/r1 の初期値 */
const RATIO_INIT = 1.5;
/** 中心間距離 d の初期値 [nm] */
const D_INIT_NM = 60;
/** g(d) = d₀/d の基準距離 [nm] */
const D0_NM = 60;
/** エンジン時間の速さ [τ秒/実秒](比 1.5・d=60 で寿命 ≈ 10 実秒 — 検証済み) */
const RATE_TAU_PER_S = 150;
/** Heun 積分のサブ刻み上限 [τ秒] */
const DTAU_SUB = 2;
/** 終盤(r1 が小さい)の細分化サブ刻み [τ秒] と、その切替半径 [nm] */
const DTAU_SUB_FINE = 0.5;
const FINE_R_NM = 2;
/** ステージの固定視野幅 [nm]。d=120 nm・r₂ ≈ 18 nm でも収まる(§5.4) */
const SPAN_NM = 170;
/** プロファイルの縦レンジ c/c∞(1±0.4 を拡大表示) */
const C_MIN = 0.6;
const C_MAX = 1.4;

/** 溶質ドットの個数(30〜50 — §5.4) */
const DOT_COUNT = 40;
/** 初期配置で小粒子近傍の環状域に置く割合(密度を濃くする) */
const DOT_NEAR_FRACTION = 0.6;
/** 小粒子近傍の環状域の幅 [nm] */
const DOT_RING_NM = 20;
/** ランダムウォークの散らばり [nm/√s](装飾の調整値) */
const DOT_JITTER = 3.5;
/** 流量(dv2/dτ [nm³/τ秒])→ ドリフト速度 [nm/s] の換算係数(装飾) */
const DRIFT_GAIN = 120;
/** ドリフト速度の上限 [nm/s] */
const DRIFT_MAX = 45;
/** ドットの描画半径 [px] */
const DOT_RADIUS_PX = 2.2;
/** 溶解フェードの時間 [実秒] */
const FADE_S = 0.4;
/** 「流れあり」とみなす流量のしきい値(比 1.0 の完全平衡と区別する) */
const FLOW_EPS = 1e-4;

const TWO_PI = Math.PI * 2;

export default function twoParticleTug(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色(初期化時に一度だけ解決 — colors.ts の注意書き)
  const soluteFill = matColor("solute");
  const soluteEdge = darken(soluteFill, 0.2);
  const matrix = matColor("matrix");
  const text = uiColor("text");
  const text2 = uiColor("text2");
  const hairline = uiColor("hairline");

  /* ---- シミュレーション状態 ---- */

  let ratio = RATIO_INIT;
  let dNm = D_INIT_NM;
  /** 体積 v = r³ [nm³](積分は体積空間で行う) */
  let v1 = 0;
  let v2 = 0;
  let vTot = 0;
  let r1 = R1_INIT_NM;
  let r2 = R1_INIT_NM * RATIO_INIT;
  /** エンジン時間 τ [200 °C 換算の秒]。溶解後は凍結(寿命の読み) */
  let tau = 0;
  let alive1 = true;
  /** 溶解演出のフェード(1 → 0) */
  let fade1 = 1;
  /** 溶解の瞬間の描画半径 [nm] */
  let lastR1 = R1_INIT_NM;

  let rand = mulberry32(SEED);
  let gauss = gaussian(rand);
  const dotX = new Float64Array(DOT_COUNT);
  const dotY = new Float64Array(DOT_COUNT);

  /** 小 → 大への流量 dv2/dτ [nm³/τ秒](≥ 0。ドリフト・矢印表示の駆動値) */
  function flowRate(): number {
    if (!alive1) return 0;
    const g = D0_NM / dNm;
    const rs = (r1 + r2) / 2;
    return 3 * A_GROWTH_NM3S * g * (1 - r1 / rs);
  }

  /**
   * エンジン時間を dTau 進める(体積空間の Heun 法。r*₂ を中点でも再評価し、
   * v2 = vTot − v1 で Σr³ を厳密保存)。r1 < r_dis で溶解し、残量は粒子2 へ。
   */
  function stepTau(dTau: number): void {
    if (!alive1 || dTau <= 0) return;
    const g = D0_NM / dNm;
    const sub = r1 < FINE_R_NM ? DTAU_SUB_FINE : DTAU_SUB;
    const n = Math.max(1, Math.ceil(dTau / sub));
    const h = dTau / n;
    for (let k = 0; k < n; k++) {
      const rsA = (r1 + r2) / 2;
      const f1 = 3 * A_GROWTH_NM3S * g * (r1 / rsA - 1);
      const v1e = Math.max(v1 + h * f1, 0);
      const r1e = Math.cbrt(v1e);
      const r2e = Math.cbrt(vTot - v1e);
      const rsB = (r1e + r2e) / 2;
      const f1b = 3 * A_GROWTH_NM3S * g * (r1e / rsB - 1);
      v1 = Math.max(v1 + (h * (f1 + f1b)) / 2, 0);
      v2 = vTot - v1;
      r1 = Math.cbrt(v1);
      r2 = Math.cbrt(v2);
      tau += h;
      if (r1 < R_DIS_NM) {
        // 溶解: 縮んで消え、残量(r1³)は体積保存で粒子2 が受け取る
        lastR1 = Math.max(r1, R_DIS_NM * 0.8);
        alive1 = false;
        fade1 = 1;
        v1 = 0;
        r1 = 0;
        v2 = vTot;
        r2 = Math.cbrt(v2);
        break;
      }
    }
  }

  /* ---- 溶質ドット(装飾。物質収支は取らない) ---- */

  function insideParticle(x: number, y: number): boolean {
    const half = dNm / 2;
    if (alive1 && Math.hypot(x + half, y) < r1 + 1) return true;
    return Math.hypot(x - half, y) < r2 + 1;
  }

  /** 小粒子近傍の環状域へ(再)配置する(吸収 → 再出現の見かけ) */
  function respawnNearSmall(i: number): void {
    const ang = rand() * TWO_PI;
    const rad = r1 + 2 + rand() * DOT_RING_NM;
    dotX[i] = -dNm / 2 + Math.cos(ang) * rad;
    dotY[i] = Math.sin(ang) * rad;
  }

  /** シード固定のドット初期配置(6 割を小粒子近傍に濃く置く) */
  function initDots(): void {
    const near = Math.round(DOT_COUNT * DOT_NEAR_FRACTION);
    for (let i = 0; i < DOT_COUNT; i++) {
      let x = 0;
      let y = 0;
      for (let t = 0; t < 12; t++) {
        if (i < near) {
          const ang = rand() * TWO_PI;
          const rad = r1 + 2 + rand() * DOT_RING_NM;
          x = -dNm / 2 + Math.cos(ang) * rad;
          y = Math.sin(ang) * rad;
        } else {
          x = -SPAN_NM / 2 + 4 + rand() * (SPAN_NM - 8);
          y = (rand() * 2 - 1) * 40;
        }
        if (!insideParticle(x, y)) break;
      }
      dotX[i] = x;
      dotY[i] = y;
    }
  }

  /**
   * ドットを 1 フレーム進める。平均として小 → 大へ流れて見えるよう、
   * ランダムウォークに流量比例のドリフトを重ねる。大粒子に達したドットは
   * 小粒子の近くへ再出現(吸収)、小粒子に入ったドットは界面から再放出。
   */
  function updateDots(dt: number, yMaxNm: number): void {
    const flow = flowRate();
    const drift = Math.min(flow * DRIFT_GAIN, DRIFT_MAX);
    const jit = DOT_JITTER * Math.sqrt(dt);
    const half = dNm / 2;
    const xMin = -SPAN_NM / 2 + 2;
    const xMax = SPAN_NM / 2 - 2;
    for (let i = 0; i < DOT_COUNT; i++) {
      let x = dotX[i] + drift * dt + jit * gauss();
      let y = dotY[i] + jit * gauss();
      // 上下・左端は反射
      if (y > yMaxNm) y = yMaxNm - (y - yMaxNm);
      else if (y < -yMaxNm) y = -yMaxNm - (y + yMaxNm);
      y = clamp(y, -yMaxNm, yMaxNm);
      if (x < xMin) x = xMin + (xMin - x);
      // 右端へ流れ出たら小粒子近傍へ戻す(循環の見かけ)
      if (x > xMax) {
        if (drift > 0) {
          respawnNearSmall(i);
          continue;
        }
        x = xMax - (x - xMax);
      }
      // 大粒子に取り込まれたら小粒子近傍へ再出現(流れなしなら表面へ押し戻す)
      const dx2 = x - half;
      const len2 = Math.hypot(dx2, y);
      if (len2 < r2 + 0.5) {
        if (flow > FLOW_EPS) {
          respawnNearSmall(i);
          continue;
        }
        const push = (r2 + 1) / (len2 || 1);
        x = half + dx2 * push;
        y *= push;
      }
      // 小粒子に入ったら界面のすぐ外へ再放出(離脱の見かけ)
      if (alive1 && Math.hypot(x + half, y) < r1 + 0.3) {
        const ang = rand() * TWO_PI;
        const rad = r1 + 1 + rand() * 3;
        x = -half + Math.cos(ang) * rad;
        y = Math.sin(ang) * rad;
      }
      dotX[i] = x;
      dotY[i] = y;
    }
  }

  /** シード固定の初期状態へ戻す(スライダー変更時の自動リセットにも使う) */
  function resetSim(): void {
    r1 = R1_INIT_NM;
    r2 = R1_INIT_NM * ratio;
    v1 = r1 ** 3;
    v2 = r2 ** 3;
    vTot = v1 + v2;
    tau = 0;
    alive1 = true;
    fade1 = 1;
    lastR1 = r1;
    rand = mulberry32(SEED);
    gauss = gaussian(rand);
    initDots();
  }

  /* ---- 操作部品(§7.2) ---- */

  const ratioSlider = host.controls.slider({
    id: "ratio",
    label: "初期サイズ比 r2/r1",
    min: 1,
    max: 3,
    step: 0.05,
    value: RATIO_INIT,
  });
  ratioSlider.onChange((v) => {
    ratio = v;
    resetSim(); // 変更で自動リセットして新初期値から(§5.4)
  });

  const dSlider = host.controls.slider({
    id: "d",
    label: "距離 d",
    min: 30,
    max: 120,
    step: 1,
    value: D_INIT_NM,
    unit: "nm",
  });
  dSlider.onChange((v) => {
    dNm = v;
    resetSim(); // 変更で自動リセット(§5.4)
  });

  const evenBtn = host.controls.button({ label: "ほぼ互角" });
  evenBtn.onClick(() => {
    ratioSlider.set(1.05); // onChange 経由で自動リセット(不安定平衡の演出)
    host.requestRender();
  });

  host.controls.playPause();
  host.controls.reset(() => {
    ratioSlider.set(RATIO_INIT); // set() の onChange 経由で resetSim される
    dSlider.set(D_INIT_NM);
    resetSim();
  });

  /* ---- レイアウト(毎フレーム host.size から計算) ---- */

  interface Pane {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  function layout(): {
    stage: Pane;
    profile: Pane;
    readoutY: number;
    narrow: boolean;
  } {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    const readoutH = narrow ? 32 : 22;
    const top = pad + readoutH;
    const gap = narrow ? 8 : 12;
    const profileH = Math.max(64, Math.min(150, h * 0.3));
    const stageH = h - top - gap - profileH - pad;
    return {
      stage: { x: pad, y: top, w: w - 2 * pad, h: stageH },
      profile: { x: pad, y: top + stageH + gap, w: w - 2 * pad, h: profileH },
      readoutY: pad,
      narrow,
    };
  }

  /* ---- 描画 ---- */

  function drawReadouts(y: number, narrow: boolean): void {
    const { w } = host.size;
    const size = narrow ? 11 : 12.5;
    ctx.font = font(size);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const parts: Array<[string, string]> = [
      [alive1 ? `r₁ ${r1.toFixed(1)} nm` : "r₁ 溶解", alive1 ? text : text2],
      [`r₂ ${r2.toFixed(1)} nm`, text],
      [`経過 ${formatDuration(tau)}(200 °C 換算)`, text2],
    ];
    let x = narrow ? 8 : 12;
    let line = 0;
    for (const [s, color] of parts) {
      const tw = ctx.measureText(s).width;
      if (narrow && x + tw > w - 8 && line === 0) {
        line = 1;
        x = 8;
      }
      ctx.fillStyle = color;
      ctx.fillText(s, x, y + line * (size + 4));
      x += tw + (narrow ? 12 : 18);
    }
  }

  function drawStagePane(p: Pane, narrow: boolean): void {
    const s = p.w / SPAN_NM; // nm → px(視野幅固定 — d や r で変わらない)
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    const half = (dNm / 2) * s;
    const x1 = cx - half;
    const x2 = cx + half;
    const r1px = r1 * s;
    const r2px = r2 * s;

    // 枠と母相の薄い背景
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = matrix;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.globalAlpha = 1;

    // 溶質ドット(1 パスでまとめ描き — 母体仕様 §8.3)
    ctx.beginPath();
    for (let i = 0; i < DOT_COUNT; i++) {
      const x = cx + dotX[i] * s;
      const y = cy + dotY[i] * s;
      ctx.moveTo(x + DOT_RADIUS_PX, y);
      ctx.arc(x, y, DOT_RADIUS_PX, 0, TWO_PI);
    }
    ctx.fillStyle = soluteFill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = soluteEdge;
    ctx.stroke();

    // 粒子(塗り + 20% 暗い縁 1.5px — §6.5)。生存分は 1 パス
    ctx.beginPath();
    if (alive1) {
      ctx.moveTo(x1 + r1px, cy);
      ctx.arc(x1, cy, Math.max(r1px, 1), 0, TWO_PI);
    }
    ctx.moveTo(x2 + r2px, cy);
    ctx.arc(x2, cy, r2px, 0, TWO_PI);
    ctx.fillStyle = soluteFill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = soluteEdge;
    ctx.stroke();

    // 溶解演出: 縮みながらフェードアウト
    if (!alive1 && fade1 > 0) {
      ctx.globalAlpha = fade1;
      ctx.beginPath();
      ctx.arc(x1, cy, Math.max(lastR1 * s * fade1, 0.5), 0, TWO_PI);
      ctx.fillStyle = soluteFill;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = soluteEdge;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 流れの向き矢印(小 → 大。text2 色 — §5.4)
    const flow = flowRate();
    if (alive1 && flow > FLOW_EPS) {
      const yArr = Math.max(p.y + 18, cy - Math.max(r1px, r2px) - 16);
      arrow(ctx, x1 + 6, yArr, x2 - 6, yArr, text2);
      ctx.font = font(12);
      ctx.fillStyle = text2;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("溶質の流れ", (x1 + x2) / 2, yArr - 5);
    }

    // 左右の粒子の下に数字を添える(狭幅では読み出し行に委ねる)
    if (!narrow) {
      ctx.font = font(12);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const labelMaxY = p.y + p.h - 16;
      if (alive1) {
        ctx.fillStyle = text;
        ctx.fillText(
          `r₁ ${r1.toFixed(1)} nm`,
          x1,
          Math.min(cy + r1px + 7, labelMaxY),
        );
      } else {
        ctx.fillStyle = text2;
        ctx.fillText("溶解", x1, Math.min(cy + 10, labelMaxY));
      }
      ctx.fillStyle = text;
      ctx.fillText(
        `r₂ ${r2.toFixed(1)} nm`,
        x2,
        Math.min(cy + r2px + 7, labelMaxY),
      );
      ctx.font = font(11);
      ctx.fillStyle = text2;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText("母相(ドットは溶質のイメージ)", p.x + 6, p.y + p.h - 5);
    }
    ctx.restore();
    ctx.textAlign = "left";
  }

  function drawProfilePane(p: Pane, stage: Pane): void {
    const s = stage.w / SPAN_NM; // ステージと同じ x 写像(粒子と縦位置が揃う)
    const cx = stage.x + stage.w / 2;
    const axisX = p.x + 30;
    const yTop = p.y + 14;
    const yBot = p.y + p.h - 6;
    const mapC = (c: number): number =>
      yBot - ((yBot - yTop) * (c - C_MIN)) / (C_MAX - C_MIN);

    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("濃度プロファイル c/c∞(拡大)", axisX + 4, p.y);

    // 縦軸と目盛り
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 0.5, yTop);
    ctx.lineTo(axisX + 0.5, yBot);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of linTicks(C_MIN, C_MAX, 4)) {
      const y = mapC(v);
      ctx.beginPath();
      ctx.moveTo(axisX - 3, y + 0.5);
      ctx.lineTo(axisX + 0.5, y + 0.5);
      ctx.stroke();
      ctx.fillText(v.toFixed(1), axisX - 5, y);
    }
    ctx.textAlign = "left";

    // c∞ = 1 の参照破線(hairline — §5.4)
    const yInf = mapC(1);
    ctx.strokeStyle = hairline;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(axisX + 2, yInf + 0.5);
    ctx.lineTo(p.x + p.w - 26, yInf + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = text2;
    ctx.textBaseline = "middle";
    ctx.fillText("c∞", p.x + p.w - 22, yInf);

    // 両界面位置(x 軸はステージと共有)
    const xB = cx + (dNm / 2 - r2) * s;
    const cB = gibbsThomsonRatio(r2);
    const xA = cx + (-dNm / 2 + Math.max(r1, R_DIS_NM)) * s;
    const cA = gibbsThomsonRatio(Math.max(r1, R_DIS_NM));

    // 界面位置の目安の縦ハシゴ(hairline)
    ctx.strokeStyle = hairline;
    ctx.beginPath();
    if (alive1) {
      ctx.moveTo(Math.round(xA) + 0.5, yTop);
      ctx.lineTo(Math.round(xA) + 0.5, yBot);
    }
    ctx.moveTo(Math.round(xB) + 0.5, yTop);
    ctx.lineTo(Math.round(xB) + 0.5, yBot);
    ctx.stroke();

    // プロファイル線(小界面 c(r1) → 大界面 c(r2) の直線勾配。レンジ外はクリップ)
    ctx.save();
    ctx.beginPath();
    ctx.rect(axisX + 1, yTop, p.x + p.w - axisX - 1, yBot - yTop);
    ctx.clip();
    ctx.strokeStyle = soluteFill;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (alive1) {
      ctx.moveTo(xA, mapC(cA));
      ctx.lineTo(xB, mapC(cB));
    } else {
      // 溶解後: 残った粒子2 の平衡濃度で平坦
      ctx.moveTo(axisX + 4, mapC(cB));
      ctx.lineTo(xB, mapC(cB));
    }
    ctx.stroke();
    // 界面の端点マーカー
    ctx.beginPath();
    if (alive1) {
      ctx.moveTo(xA + 3, mapC(cA));
      ctx.arc(xA, mapC(cA), 3, 0, TWO_PI);
    }
    ctx.moveTo(xB + 3, mapC(cB));
    ctx.arc(xB, mapC(cB), 3, 0, TWO_PI);
    ctx.fillStyle = soluteFill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = soluteEdge;
    ctx.stroke();
    ctx.restore();

    // 勾配の向き矢印(高 → 低 = 小 → 大。レンジ内にクランプして常に見せる)
    if (alive1 && flowRate() > FLOW_EPS) {
      const yA = mapC(clamp(cA, C_MIN + 0.05, C_MAX - 0.05));
      const yB = mapC(clamp(cB, C_MIN + 0.05, C_MAX - 0.05));
      const dx = xB - xA;
      const dy = yB - yA;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (dy / len) * 10;
      const ny = (-dx / len) * 10;
      arrow(
        ctx,
        xA + dx * 0.4 + nx,
        yA + dy * 0.4 + ny,
        xA + dx * 0.6 + nx,
        yA + dy * 0.6 + ny,
        text2,
      );
    }
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const l = layout();
    drawReadouts(l.readoutY, l.narrow);
    drawStagePane(l.stage, l.narrow);
    drawProfilePane(l.profile, l.stage);
  }

  /* ---- フレームループ ---- */

  host.onFrame((dt) => {
    if (alive1) {
      stepTau(dt * RATE_TAU_PER_S); // 溶解後は τ を凍結(寿命の読み)
    } else if (fade1 > 0) {
      fade1 = Math.max(0, fade1 - dt / FADE_S);
    }
    const stage = layout().stage;
    const s = stage.w / SPAN_NM;
    const yMaxNm = Math.max(stage.h / (2 * s) - 1, 8);
    updateDots(dt, yMaxNm);
    draw();
  });
  // 一時停止中のスライダー変更・リセット・省モーション初期表示用
  host.onRender(draw);

  resetSim();
  host.setPlaying(false); // 初期状態は一時停止(§5.4)

  return {
    destroy(): void {
      /* canvas 直付けのリスナーなし(操作は controls 経由のみ) */
    },
  };
}
