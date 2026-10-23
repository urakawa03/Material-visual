/**
 * tempering.ts — 図7「焼戻しと硬さ・靭性」(記事仕様書 10 §5.7)
 *
 * 左: 組織の模式。焼入れままのマルテンサイトの針の中には炭素(--mat-solute)が
 * 閉じ込められている。焼戻しが進むと炭素が動けるようになって、微細な炭化物
 * (--mat-precip — GP ゾーン・オストワルド成長の記事の析出物と同じ色)が
 * 析出し、次第に数が減って粗くなる。
 * 右: 横軸 ホロモン・ジャッフェのパラメータ P = T (20 + log₁₀ t)(式 E7)、
 * 縦軸 左 = 硬さ [HV]、右 = 靭性(相対値)。2 本の模式曲線と現在の P の縦線。
 * 同じ P を与える別の温度・時間の組を読み取りに出す。
 *
 * 簡略化(図注): 硬さ・靭性の曲線は模式。焼戻し脆性(250〜400 ℃ 付近の靭性の
 * くぼみ)も模式として描く。曲線の両端は図6・図1 の値(焼入れまま 820 HV・
 * 十分に焼き戻して 250 HV)に合わせてある。時間はスライダーの値そのもの
 * (アニメーションはしない)。
 *
 * 実装方式: 2D / requestRender。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { mulberry32 } from "../../core/mathx";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  TEMPER_TIME_MAX_H,
  TEMPER_TIME_MIN_H,
  TEMPER_T_MAX_C,
  TEMPER_T_MIN_C,
} from "./lib/constants";
import {
  P_MAX,
  P_MIN,
  hollomonJaffe,
  temperProgress,
  temperedHardness,
  tempForP,
  timeForP,
  toughness,
} from "./lib/tempering";
import {
  MIN_CANVAS_PX,
  type Pane,
  context2d,
  drawAxes,
  font,
  makeScale,
  mapScale,
  plateText,
  resolvePalette,
} from "./lib/draw";

/** 初期状態(§5.7: 共析鋼・400 ℃・1 時間) */
const T_INIT = 400;
const TIME_INIT = 1;
/** 横軸 P の範囲(スライダーの範囲を含む) */
const P_AXIS_MIN = 6000;
const P_AXIS_MAX = 22000;
/** 硬さの軸の上限 [HV] */
const HV_MAX = 900;
/** 曲線のサンプル数 */
const SAMPLES = 220;
/** 1 時間の焼戻しの温度の目安を上の目盛りに出す温度 [℃] */
const ONE_HOUR_TICKS = [200, 300, 400, 500, 600, 700];
/** 組織の模式: 炭素の点と炭化物の候補の数、乱数シード */
const N_CARBON_DOTS = 46;
const N_CARBIDE_SITES = 40;
const SEED = 7707;
/** 同じ P の組を探すときの温度の差 [℃] */
const EQUIV_DT = 50;
/**
 * 曲線の名前を書く P の位置の候補(先頭から順に、現在の P の縦線と値の
 * ラベルに重ならないものを使う)
 */
const HV_LABEL_PS = [16800, 19600, 10200];
const TOUGH_LABEL_PS = [16000, 19000, 8600];
/** 曲線の名前を、現在の P の縦線からこれ以上離す [px](値のラベルの幅を含む) */
const LABEL_CLEAR_PX = 60;

const TAU2 = Math.PI * 2;

/** マルテンサイトの針(単位正方形の中心・角度・長さ・太さ) */
const NEEDLES: ReadonlyArray<
  readonly [number, number, number, number, number]
> = [
  [0.3, 0.26, 28, 0.62, 0.15],
  [0.7, 0.34, -40, 0.6, 0.14],
  [0.42, 0.66, -18, 0.68, 0.15],
  [0.78, 0.76, 52, 0.42, 0.12],
  [0.14, 0.72, 70, 0.4, 0.11],
];

interface Dot {
  needle: number;
  /** 針の局所座標(−1〜1) */
  u: number;
  v: number;
  /** 0〜1 の乱数(表示の順番・大きさのばらつき) */
  r: number;
}

export default function tempering(host: FigureHost): WidgetHandle {
  const ctx = context2d(host.canvas);
  const pal = resolvePalette();

  /* ---- 組織の模式の点(シード固定)---- */
  const rand = mulberry32(SEED);
  const makeDots = (n: number): Dot[] => {
    const out: Dot[] = [];
    while (out.length < n) {
      const needle = Math.floor(rand() * NEEDLES.length);
      const u = rand() * 2 - 1;
      const v = rand() * 2 - 1;
      // レンズの内側だけ
      if (Math.abs(v) > 0.8 * (1 - u * u)) continue;
      out.push({ needle, u: u * 0.9, v, r: rand() });
    }
    return out;
  };
  const carbonDots = makeDots(N_CARBON_DOTS);
  const carbideSites = makeDots(N_CARBIDE_SITES);

  /* ---- 状態 ---- */
  let tempC = T_INIT;
  let timeH = TIME_INIT;

  const pNow = (): number => hollomonJaffe(tempC, timeH);

  /* ---- 読み取り値(§5.7) ---- */
  const readout = createReadout(host);
  const rP = readout.item("P");
  const rHv = readout.item("硬さの目安");
  const rTough = readout.item("靭性の目安(相対)");
  const rEq = readout.item("同じ P になる別の組");

  function fmtHours(h: number): string {
    if (h >= 100) return `${Math.round(h)} 時間`;
    if (h >= 1) return `${Number(h.toPrecision(2))} 時間`;
    const min = h * 60;
    if (min >= 1) return `${Number(min.toPrecision(2))} 分`;
    return `${Number((min * 60).toPrecision(2))} 秒`;
  }

  function updateReadouts(): void {
    const p = pNow();
    rP.set(String(Math.round(p / 10) * 10));
    rHv.set(`約 ${Math.round(temperedHardness(p) / 10) * 10} HV`);
    rTough.set(toughness(p).toFixed(2));
    // 50 ℃ 低い温度なら何時間か(低すぎるときは 50 ℃ 高い温度で)
    const t2 =
      tempC - EQUIV_DT >= TEMPER_T_MIN_C ? tempC - EQUIV_DT : tempC + EQUIV_DT;
    const h2 = timeForP(p, t2);
    const one = tempForP(p, 1);
    rEq.set(`${t2} ℃ × ${fmtHours(h2)}(1 時間なら ${Math.round(one)} ℃)`);
  }

  /* ---- 操作部品(§5.7) ---- */
  const tSlider = host.controls.slider({
    id: "temp",
    label: "焼戻し温度",
    min: TEMPER_T_MIN_C,
    max: TEMPER_T_MAX_C,
    step: 10,
    value: T_INIT,
    unit: "℃",
  });
  tSlider.onChange((v) => {
    tempC = v;
    updateReadouts();
    host.requestRender();
  });
  const timeSlider = host.controls.slider({
    id: "time",
    label: "焼戻し時間",
    min: TEMPER_TIME_MIN_H,
    max: TEMPER_TIME_MAX_H,
    value: TIME_INIT,
    scale: "log",
    format: fmtHours,
  });
  timeSlider.onChange((v) => {
    timeH = v;
    updateReadouts();
    host.requestRender();
  });
  host.controls.reset(() => {
    tSlider.set(T_INIT);
    timeSlider.set(TIME_INIT);
    tempC = T_INIT;
    timeH = TIME_INIT;
    updateReadouts();
  });

  /* ---- レイアウト ---- */

  function layout(): { micro: Pane; plot: Pane; narrow: boolean } {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    if (narrow) {
      const mh = Math.round((h - 3 * pad) * 0.4);
      return {
        micro: { x: pad, y: pad, w: w - 2 * pad, h: mh },
        plot: { x: pad, y: 2 * pad + mh, w: w - 2 * pad, h: h - 3 * pad - mh },
        narrow,
      };
    }
    const mw = Math.round((w - 3 * pad) * 0.4);
    return {
      micro: { x: pad, y: pad, w: mw, h: h - 2 * pad },
      plot: { x: 2 * pad + mw, y: pad, w: w - 3 * pad - mw, h: h - 2 * pad },
      narrow,
    };
  }

  /* ---- 左: 組織の模式 ---- */

  /** 箱の下の凡例: 閉じ込められた炭素と、析出した炭化物 */
  function drawLegend(box: Pane, narrow: boolean, lfs: number): void {
    const items: ReadonlyArray<readonly [string, string, string]> = [
      // 図の炭素は縁取りなしで描いているので、凡例も同じにする
      [pal.solute, pal.solute, "針の中に閉じ込められた炭素"],
      [pal.precip, pal.precipEdge, "析出した炭化物(焼戻しで現れ、粗くなる)"],
    ];
    ctx.font = font(lfs);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    let x = box.x + 6;
    let y = box.y + box.h + (narrow ? lfs / 2 + 6 : lfs / 2 + 10);
    for (const [fill, edge, label] of items) {
      const text = narrow ? label.replace(/(.*)$/, "") : label;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, TAU2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = edge;
      ctx.stroke();
      ctx.fillStyle = pal.text2;
      ctx.fillText(text, x + 9, y);
      if (narrow) x += 9 + ctx.measureText(text).width + 18;
      else y += lfs + 8;
    }
  }

  function drawMicro(p: Pane, narrow: boolean): void {
    const fs = narrow ? 10 : 11;
    const prog = temperProgress(pNow());
    ctx.font = font(fs);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let title: string;
    if (prog < 0.08) title = "焼入れまま: 炭素は針の中に閉じ込められたまま";
    else if (prog < 0.6) title = "炭素が動き、微細な炭化物が析出";
    else title = "炭化物が粗くなり、数が減る";
    ctx.fillText(title, p.x, p.y);
    const top = p.y + fs + 8;
    // 凡例の高さ(広い幅は箱の下に 2 行、狭い幅は 1 行に 2 つ)
    const legendH = narrow ? fs + 10 : 2 * (fs + 8) + 6;
    const size = Math.min(p.w, p.h - (top - p.y) - legendH);
    const box: Pane = narrow
      ? { x: p.x, y: top, w: p.w, h: p.h - (top - p.y) - legendH }
      : { x: p.x, y: top, w: p.w, h: size };
    drawLegend(box, narrow, fs - 1);
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x + 1, box.y + 1, box.w - 2, box.h - 2);
    ctx.clip();
    ctx.fillStyle = pal.matrix;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.globalAlpha = 1;

    const scale = Math.min(box.w, box.h);
    const local = (
      n: number,
      u: number,
      v: number,
    ): { x: number; y: number } => {
      const [cu, cv, ang, len, wid] = NEEDLES[n];
      const halfL = (len * scale) / 2;
      const halfW = (wid * scale) / 2;
      const a = (ang * Math.PI) / 180;
      const lx = u * halfL;
      const ly = v * halfW;
      return {
        x: box.x + cu * box.w + lx * Math.cos(a) - ly * Math.sin(a),
        y: box.y + cv * box.h + lx * Math.sin(a) + ly * Math.cos(a),
      };
    };

    // 針(レンズ形)。焼戻しが進むと格子線(ハッチ)が薄れる(回復)
    NEEDLES.forEach(([cu, cv, ang, len, wid]) => {
      const halfL = (len * scale) / 2;
      const halfW = (wid * scale) / 2;
      ctx.save();
      ctx.translate(box.x + cu * box.w, box.y + cv * box.h);
      ctx.rotate((ang * Math.PI) / 180);
      ctx.beginPath();
      ctx.moveTo(-halfL, 0);
      ctx.quadraticCurveTo(0, -2 * halfW, halfL, 0);
      ctx.quadraticCurveTo(0, 2 * halfW, -halfL, 0);
      ctx.closePath();
      ctx.fillStyle = pal.matrix;
      ctx.globalAlpha = 0.38;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = pal.matrixEdge;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      for (let s = -halfL + 7; s <= halfL - 7; s += 6) {
        const hh = 0.85 * halfW * (1 - (s / halfL) ** 2);
        ctx.moveTo(s, -hh);
        ctx.lineTo(s, hh);
      }
      ctx.strokeStyle = pal.matrixEdge;
      ctx.globalAlpha = 0.65 * (1 - 0.7 * prog);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    });

    // 閉じ込められた炭素(焼戻しが進むと消える — 炭化物へ移る)
    const cAlpha = Math.max(0, 1 - prog * 3.2);
    if (cAlpha > 0) {
      const rC = Math.max(scale * 0.011, 2);
      ctx.globalAlpha = cAlpha;
      ctx.beginPath();
      for (const d of carbonDots) {
        const q = local(d.needle, d.u, d.v);
        ctx.moveTo(q.x + rC, q.y);
        ctx.arc(q.x, q.y, rC, 0, TAU2);
      }
      ctx.fillStyle = pal.solute;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 炭化物: 析出して数が増え、その後は粗くなって数が減る(模式)
    if (prog > 0.03) {
      const appear = Math.min(1, (prog - 0.03) / 0.25);
      const keep = 1 - 0.78 * Math.max(0, (prog - 0.3) / 0.7);
      const n = Math.round(N_CARBIDE_SITES * appear * keep);
      const rBase = scale * (0.008 + 0.03 * prog ** 1.3);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const d = carbideSites[i];
        const q = local(d.needle, d.u, d.v);
        const r = rBase * (0.75 + 0.5 * d.r);
        ctx.moveTo(q.x + r, q.y);
        ctx.arc(q.x, q.y, r, 0, TAU2);
      }
      ctx.fillStyle = pal.precip;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = pal.precipEdge;
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---- 右: P と硬さ・靭性 ---- */

  function drawPlot(p: Pane, narrow: boolean): void {
    const fs = narrow ? 10 : 11;
    const left = p.x + (narrow ? 34 : 42);
    const right = p.x + p.w - (narrow ? 30 : 36);
    const top = p.y + 2 * fs + 26;
    const bottom = p.y + p.h - (narrow ? 32 : 36);
    const xs = makeScale(P_AXIS_MIN, P_AXIS_MAX, left, right);
    const ys = makeScale(0, HV_MAX, bottom, top);
    const ts = makeScale(0, 1, bottom, top);
    const X = (v: number): number => mapScale(xs, v);

    drawAxes(ctx, pal, xs, ys, {
      xTicks: [6000, 10000, 14000, 18000, 22000],
      yTicks: [0, 200, 400, 600, 800],
      xFormat: (v) => `${v / 1000}`,
      xTitle: "P = T (20 + log₁₀ t) [× 1000](T は K、t は時間)",
      fontPx: fs,
      gridY: true,
    });
    // 縦軸の題(左 = 硬さ、右 = 靭性)は最上段に置く
    ctx.font = font(fs);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("硬さ [HV]", left - (narrow ? 30 : 36), p.y);
    // 右の縦軸(靭性)
    ctx.strokeStyle = pal.text2;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(right) + 0.5, top);
    ctx.lineTo(Math.round(right) + 0.5, bottom);
    for (const v of [0, 0.5, 1]) {
      const y = Math.round(mapScale(ts, v)) + 0.5;
      ctx.moveTo(right, y);
      ctx.lineTo(right + 4, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = font(fs - 1);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const v of [0, 0.5, 1])
      ctx.fillText(String(v), right + 6, mapScale(ts, v));
    ctx.font = font(fs);
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("靭性(相対)", p.x + p.w, p.y);

    // 上の目盛り: 1 時間の焼戻しなら何 ℃ か
    ctx.font = font(fs - 1);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.strokeStyle = pal.text2;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (const tC of ONE_HOUR_TICKS) {
      const x = Math.round(X(hollomonJaffe(tC, 1))) + 0.5;
      ctx.moveTo(x, top - 2);
      ctx.lineTo(x, top + 3);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    for (const tC of ONE_HOUR_TICKS) {
      ctx.fillText(`${tC}`, X(hollomonJaffe(tC, 1)), top - 4);
    }
    // 上の目盛りの題(目盛りの数字の 1 段上、グラフの中央)
    ctx.fillText(
      "上の目盛り: 1 時間焼き戻すときの温度 [℃]",
      (left + right) / 2,
      top - 4 - fs - 4,
    );

    // スライダーで届く範囲の外を淡く
    ctx.fillStyle = pal.hairline;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(left, top, X(P_MIN) - left, bottom - top);
    ctx.fillRect(X(P_MAX), top, right - X(P_MAX), bottom - top);
    ctx.globalAlpha = 1;

    // 硬さ(実線)と靭性(破線)
    const curve = (
      f: (pp: number) => number,
      sc: typeof ys,
      color: string,
      dash: boolean,
    ): void => {
      ctx.save();
      if (dash) ctx.setLineDash([7, 4]);
      ctx.beginPath();
      for (let i = 0; i <= SAMPLES; i++) {
        const pp = P_MIN + ((P_MAX - P_MIN) * i) / SAMPLES;
        const x = X(pp);
        const y = mapScale(sc, f(pp));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    };
    curve(temperedHardness, ys, pal.text, false);
    curve(toughness, ts, pal.text2, true);
    // 曲線の名前。現在の P の縦線と値のラベルに重ならない候補の位置に置く
    const pp = pNow();
    const x = X(pp);
    ctx.font = font(fs, 600);
    const pickP = (cands: readonly number[], label: string): number => {
      const w = ctx.measureText(label).width;
      return (
        cands.find((c) => {
          const xl = X(c) + 6;
          return xl > x + LABEL_CLEAR_PX || xl + w < x - LABEL_CLEAR_PX;
        }) ?? cands[0]
      );
    };
    const hvP = pickP(HV_LABEL_PS, "硬さ");
    const tgP = pickP(TOUGH_LABEL_PS, "靭性");
    ctx.fillStyle = pal.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("硬さ", X(hvP) + 6, mapScale(ys, temperedHardness(hvP)) - 6);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("靭性", X(tgP) + 6, mapScale(ts, toughness(tgP)) + 6);

    // 焼戻し脆性のくぼみのラベル(模式)。現在の P の縦線にかかるときは脇へ
    const pDip = hollomonJaffe(320, 1);
    const dipText = "焼戻し脆性(模式)";
    ctx.font = font(fs - 1);
    const dipHalf = ctx.measureText(dipText).width / 2 + 3;
    const xDip = X(pDip);
    const dipNear = Math.abs(xDip - x) < dipHalf + 8;
    plateText(
      ctx,
      pal,
      dipText,
      dipNear ? (x >= xDip ? x - 8 : x + 8) : xDip,
      mapScale(ts, toughness(pDip)) + 18,
      pal.text2,
      fs - 1,
      dipNear ? (x >= xDip ? "right" : "left") : "center",
    );

    // 現在の P
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, top);
    ctx.lineTo(Math.round(x) + 0.5, bottom);
    ctx.stroke();
    for (const [v, sc] of [
      [temperedHardness(pp), ys],
      [toughness(pp), ts],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x, mapScale(sc, v), 5.5, 0, TAU2);
      ctx.fillStyle = pal.accent;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = pal.bg;
      ctx.stroke();
    }
    // 値のラベル。硬さの曲線は右下がりなので、点の右上か左下に置けば
    // 曲線と重ならない(右半分では左下、左半分では右上)
    const rightHalf = x > (left + right) / 2;
    const yHv = mapScale(ys, temperedHardness(pp));
    plateText(
      ctx,
      pal,
      `${Math.round(temperedHardness(pp) / 10) * 10} HV`,
      x + (rightHalf ? -10 : 10),
      rightHalf ? yHv + 16 : yHv - 14,
      pal.accent,
      fs + 1,
      rightHalf ? "right" : "left",
    );
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // レイアウト前の極小キャンバスでは描かない(負の半径などを避ける)
    if (w < MIN_CANVAS_PX || h < MIN_CANVAS_PX) return;
    const l = layout();
    drawMicro(l.micro, l.narrow);
    drawPlot(l.plot, l.narrow);
  }

  updateReadouts();
  host.onRender(draw);

  return {
    destroy(): void {
      /* 追加のイベントリスナーは持たない */
    },
  };
}
