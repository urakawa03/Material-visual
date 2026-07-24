/**
 * gibbs-thomson-probe.ts — 図3「界面濃度メーター」(記事仕様書 03 §5.3)
 *
 * 左: 粒子 1 個(中心固定・半径はスライダー)と、その周囲の「平衡ハロー」
 * (溶質ドットの数 ∝ c(r)/c∞)+界面での原子の出入りの微アニメ(発生頻度も
 * c(r)/c∞ に比例)。「界面ズーム」トグルで左パネルを平坦界面 vs 強曲率界面の
 * 2 コマ模式図(静的図 S-2 と同じ視覚言語)に入れ替える。
 * 右: c(r)/c∞ vs r の曲線(横軸 log 0.5〜50 nm)+現在点マーカー・l_c の目印・
 * 数値読み出し・数式パネル。
 *
 * 温度は 200 °C 固定(本図では操作なし)。c(r)/c∞ = e^(lc/r)、lc ≈ 1.0 nm。
 *
 * 簡略化(図注で明示):
 * - 粒子の描画半径は模式スケール(px = 26√r)で、実寸比ではない(パネルから
 *   はみ出す分はクリップ)。
 * - ハローと出入りアニメは表示演出であり物質収支は取らない(粒子サイズは
 *   スライダーのみが決める)。密度・頻度だけを c(r)/c∞ に比例させている。
 *
 * 実装方式: onFrame(§5.3)。「原子の出入りを表示」off(および界面ズーム中)は
 * host.setPlaying(false) + requestRender で静止し、requestRender 的に振る舞う。
 * dt = 0 の描画でも正しい静止画になる(アニメ時計は onFrame でのみ進む)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { darken, matColor, uiColor } from "../../core/colors";
import { clamp, mulberry32 } from "../../core/mathx";
import { T_REF_K, gibbsThomsonRatio, lcNm } from "./lib/constants";
import { arrow, fmtSig, font } from "./lib/draw";

/** 乱数シード(ハロー・出入りアニメの配置。母体仕様 §8.2) */
const SEED = 20260303;
/** 半径スライダーの範囲・初期値 [nm](§5.3) */
const R_MIN = 0.5;
const R_MAX = 50;
const R_INIT = 10;
/** 粒子の模式描画スケール: px = SCALE·√r(0.5 nm→約 18 px、50 nm→約 184 px) */
const PX_SCALE = 26;
const PX_SCALE_NARROW = 18;
/** 平衡ハローのドット候補プール数(r = 0.5 nm で全数表示) */
const HALO_POOL = 240;
/** ハロー帯の界面からの隙間と幅 [px] */
const HALO_GAP_PX = 12;
const HALO_BAND_PX = 62;
const HALO_GAP_NARROW_PX = 9;
const HALO_BAND_NARROW_PX = 44;
/** ハローの径方向分布の偏り(大きいほど界面寄りに密) */
const HALO_EXP = 1.6;
/** ハロードットの半径 [px](§5.3: 2 px の小ドット) */
const HALO_DOT_PX = 2;
/** 出入りアニメのスロット数と同時最少数 */
const EV_COUNT = 28;
const EV_MIN_ACTIVE = 2;
/** 1 周期のうちドットが見えている割合 */
const EV_SPAN_FRAC = 0.55;
/** 出入りドットの移動距離 [px](基準 + 乱数幅) */
const EV_DIST_BASE_PX = 16;
const EV_DIST_VAR_PX = 16;
/** 出入りドットの半径と界面からの初期隙間 [px] */
const EV_DOT_PX = 2.4;
const EV_GAP_PX = 3;
/** 「離脱」スロットの割合(残りは「付着」) */
const EV_OUTWARD_FRAC = 0.65;
/** 横幅がこれ未満なら縮小レイアウト(参照実装 ripening-arena と同じ流儀) */
const NARROW_W = 560;
/** 右プロットの縦軸上限(c/c∞。r = 0.5 nm で ≈ 7.6) */
const Y_MAX = 8;
/** 横軸(log)の目盛り [nm] */
const X_TICKS = [0.5, 1, 2, 5, 10, 20, 50] as const;
/** 縦軸の目盛り */
const Y_TICKS = [1, 2, 4, 6, 8] as const;
/** 母相・粒子内部の薄い背景の不透明度 */
const BG_MATRIX_ALPHA = 0.1;
const BG_INSIDE_ALPHA = 0.08;

/** 毛管長 lc(200 °C)[nm] ≈ 1.0(表示・目印に使う) */
const LC_NM = lcNm(T_REF_K);
/** c(r)/c∞ の最大値(r = R_MIN)。ハロー数・頻度の規格化に使う */
const RATIO_MAX = gibbsThomsonRatio(R_MIN);

const TAU = Math.PI * 2;

interface Pane {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 色・フォントつきのテキスト断片(数式・読み出しの描画用) */
interface Seg {
  t: string;
  c: string;
  f: string;
}

export default function gibbsThomsonProbe(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色(初期化時に一度だけ解決 — colors.ts の注意書き)
  const soluteFill = matColor("solute");
  const soluteEdge = darken(soluteFill, 0.2);
  const matrix = matColor("matrix");
  const accent = uiColor("accent");
  const text = uiColor("text");
  const text2 = uiColor("text2");
  const hairline = uiColor("hairline");

  /* ---- シード固定のドット候補プール(reset しても不変 — §8.2) ---- */

  const rand = mulberry32(SEED);
  /** ハロードット: 角度と径方向位置(0〜1。界面寄りに密) */
  const haloAng = new Float64Array(HALO_POOL);
  const haloU = new Float64Array(HALO_POOL);
  for (let i = 0; i < HALO_POOL; i++) {
    haloAng[i] = rand() * TAU;
    haloU[i] = Math.pow(rand(), HALO_EXP);
  }
  /** 出入りアニメのスロット: 角度・周期・位相・距離・向き */
  const evAng = new Float64Array(EV_COUNT);
  const evPeriod = new Float64Array(EV_COUNT);
  const evPhase = new Float64Array(EV_COUNT);
  const evDistU = new Float64Array(EV_COUNT);
  const evOut = new Uint8Array(EV_COUNT);
  for (let k = 0; k < EV_COUNT; k++) {
    evAng[k] = rand() * TAU;
    evPeriod[k] = 0.9 + rand() * 0.9;
    evPhase[k] = rand() * evPeriod[k];
    evDistU[k] = rand();
    evOut[k] = rand() < EV_OUTWARD_FRAC ? 1 : 0;
  }

  /* ---- 状態 ---- */

  /** 微アニメの初期値(reduced-motion 時は off — §5.3) */
  const ANIM_INIT =
    typeof matchMedia !== "function" ||
    !matchMedia("(prefers-reduced-motion: reduce)").matches;
  let rNm = R_INIT;
  let zoomOn = false;
  let animOn = ANIM_INIT;
  /** 微アニメの時計 [s]。onFrame でのみ進む(dt = 0 なら静止画) */
  let animT = 0;

  /* ---- 操作部品(§7.2。ネイティブ input なので矢印キー操作可) ---- */

  const rSlider = host.controls.slider({
    id: "r",
    label: "半径 r",
    min: R_MIN,
    max: R_MAX,
    value: R_INIT,
    unit: "nm",
    scale: "log",
  });
  rSlider.onChange((v) => {
    rNm = v;
  });

  const zoomToggle = host.controls.toggle({
    id: "zoom",
    label: "界面ズーム",
    value: false,
  });
  const animToggle = host.controls.toggle({
    id: "anim",
    label: "原子の出入りを表示",
    value: animOn,
  });

  /**
   * 微アニメ on かつズーム off のときだけ連続駆動する。off のときは
   * setPlaying(false) + requestRender で静止(requestRender 的挙動 — §5.3)。
   */
  function syncPlaying(): void {
    const playing = animOn && !zoomOn;
    host.setPlaying(playing);
    if (!playing) host.requestRender();
  }
  zoomToggle.onChange((v) => {
    zoomOn = v;
    syncPlaying();
  });
  animToggle.onChange((v) => {
    animOn = v;
    syncPlaying();
  });

  host.controls.reset(() => {
    // control.set() で初期値へ(onChange 経由で内部状態も戻る — §8.2)
    rSlider.set(R_INIT);
    zoomToggle.set(false);
    animToggle.set(ANIM_INIT);
  });

  /* ---- レイアウト(毎フレーム host.size から計算) ---- */

  function layout(): { left: Pane; right: Pane; narrow: boolean } {
    const { w, h } = host.size;
    const narrow = w < NARROW_W;
    const pad = narrow ? 8 : 12;
    const leftW = (narrow ? w * 0.46 : w * 0.42) - pad;
    return {
      left: { x: pad, y: pad, w: leftW, h: h - 2 * pad },
      right: {
        x: pad + leftW + pad,
        y: pad,
        w: w - leftW - 3 * pad,
        h: h - 2 * pad,
      },
      narrow,
    };
  }

  /** テキスト断片列を左詰めで描く(戻り値は末尾の x 座標) */
  function drawSegs(x: number, y: number, list: readonly Seg[]): number {
    ctx.textAlign = "left";
    let ax = x;
    for (const sgm of list) {
      ctx.font = sgm.f;
      ctx.fillStyle = sgm.c;
      ctx.fillText(sgm.t, ax, y);
      ax += ctx.measureText(sgm.t).width;
    }
    return ax;
  }

  /* ---- 左パネル: 粒子と平衡ハロー ---- */

  function drawHaloPane(p: Pane, narrow: boolean): void {
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();

    // 母相の薄い背景
    ctx.globalAlpha = BG_MATRIX_ALPHA;
    ctx.fillStyle = matrix;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.globalAlpha = 1;

    const scalePx = narrow ? PX_SCALE_NARROW : PX_SCALE;
    const R = scalePx * Math.sqrt(rNm);
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2 + 6;
    const ratio = gibbsThomsonRatio(rNm);

    // 平衡ハロー: 表示数 ∝ c(r)/c∞(r = 0.5 nm で全プール表示)
    const gap = narrow ? HALO_GAP_NARROW_PX : HALO_GAP_PX;
    const band = narrow ? HALO_BAND_NARROW_PX : HALO_BAND_PX;
    const nHalo = Math.round((HALO_POOL * ratio) / RATIO_MAX);
    ctx.beginPath();
    for (let i = 0; i < nHalo; i++) {
      const rr = R + gap + band * haloU[i];
      const x = cx + Math.cos(haloAng[i]) * rr;
      const y = cy + Math.sin(haloAng[i]) * rr;
      ctx.moveTo(x + HALO_DOT_PX, y);
      ctx.arc(x, y, HALO_DOT_PX, 0, TAU);
    }
    ctx.fillStyle = soluteFill;
    ctx.fill();

    // 粒子(塗り + 20% 暗い縁取り 1.5 px — §6.5)
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fillStyle = soluteFill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = soluteEdge;
    ctx.stroke();

    // 原子の出入り(装飾アニメ。頻度 ∝ c(r)/c∞、物質収支は取らない)
    if (animOn) {
      const nEv = clamp(
        Math.round((EV_COUNT * ratio) / RATIO_MAX),
        EV_MIN_ACTIVE,
        EV_COUNT,
      );
      const distBase = narrow ? EV_DIST_BASE_PX * 0.75 : EV_DIST_BASE_PX;
      for (let k = 0; k < nEv; k++) {
        const local = (animT + evPhase[k]) % evPeriod[k];
        const span = evPeriod[k] * EV_SPAN_FRAC;
        if (local >= span) continue;
        const u = local / span;
        const travel = evOut[k] === 1 ? u : 1 - u;
        const rr =
          R + EV_GAP_PX + (distBase + EV_DIST_VAR_PX * evDistU[k]) * travel;
        const x = cx + Math.cos(evAng[k]) * rr;
        const y = cy + Math.sin(evAng[k]) * rr;
        ctx.globalAlpha = Math.sin(Math.PI * u);
        ctx.beginPath();
        ctx.arc(x, y, EV_DOT_PX, 0, TAU);
        ctx.fillStyle = soluteFill;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 半径の矢印とラベル(中心 → 界面。ラベルはパネル内に収める)
    arrow(ctx, cx, cy, cx, cy - R, text, 2, Math.min(7, R * 0.45));
    ctx.font = font(12);
    ctx.fillStyle = text;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(`r = ${fmtSig(rNm)} nm`, cx, Math.max(cy - R - 6, p.y + 16));

    ctx.restore();

    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("粒子と平衡ハロー(スケールは模式)", p.x + 6, p.y + p.h - 5);
  }

  /* ---- 左パネル: 界面ズーム(静的図 S-2 と同じ視覚言語) ---- */

  /** 平坦界面のコマ: 表面の注目原子は同種のお隣 4 個 */
  function drawFlatFrame(x: number, y: number, w: number, h: number): void {
    const aR = clamp(Math.min(w / 12, h / 8), 6, 13);
    const s = aR * 2;
    const rowGap = s * 0.866;
    const by = y + h * 0.42; // 界面(平坦)の高さ

    // 上 = 母相、下 = 粒子内部の薄い塗り
    ctx.globalAlpha = BG_MATRIX_ALPHA;
    ctx.fillStyle = matrix;
    ctx.fillRect(x, y, w, by - y);
    ctx.globalAlpha = BG_INSIDE_ALPHA;
    ctx.fillStyle = soluteFill;
    ctx.fillRect(x, by, w, y + h - by);
    ctx.globalAlpha = 1;

    // 界面の線
    ctx.strokeStyle = text2;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 4, by + 0.5);
    ctx.lineTo(x + w - 4, by + 0.5);
    ctx.stroke();

    // 原子の並び(六方充填。表面行 + 下 1〜3 行)
    let n = Math.floor((w - 12) / s);
    if (n < 3) n = 3;
    const startX = x + w / 2 - ((n - 1) * s) / 2;
    const mid = Math.floor(n / 2);
    const y0 = by + aR + 1;
    const xF = startX + mid * s; // 注目原子(表面の中央)
    const nRows = clamp(Math.floor((y + h - 6 - aR - y0) / rowGap) + 1, 2, 4);

    // 結合線(原子の下に描く): 左右 2 + 斜め下 2 = 同種のお隣 4
    ctx.strokeStyle = text2;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xF, y0);
    ctx.lineTo(xF - s, y0);
    ctx.moveTo(xF, y0);
    ctx.lineTo(xF + s, y0);
    ctx.moveTo(xF, y0);
    ctx.lineTo(xF - s / 2, y0 + rowGap);
    ctx.moveTo(xF, y0);
    ctx.lineTo(xF + s / 2, y0 + rowGap);
    ctx.stroke();

    // 注目以外の原子(1 パス)
    ctx.beginPath();
    for (let row = 0; row < nRows; row++) {
      const yy = y0 + row * rowGap;
      const off = row % 2 === 1 ? s / 2 : 0;
      const cnt = row % 2 === 1 ? n - 1 : n;
      for (let i = 0; i < cnt; i++) {
        if (row === 0 && i === mid) continue;
        const xx = startX + off + i * s;
        ctx.moveTo(xx + aR, yy);
        ctx.arc(xx, yy, aR, 0, TAU);
      }
    }
    ctx.fillStyle = soluteFill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = soluteEdge;
    ctx.stroke();

    // 注目原子 + accent の輪 + 隣の数
    ctx.beginPath();
    ctx.arc(xF, y0, aR, 0, TAU);
    ctx.fillStyle = soluteFill;
    ctx.fill();
    ctx.strokeStyle = soluteEdge;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(xF, y0, aR + 3, 0, TAU);
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    ctx.stroke();
    ctx.font = font(13, 600);
    ctx.fillStyle = accent;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("4", xF, y0 - aR - 6);

    // コマの見出し
    ctx.textBaseline = "top";
    drawSegs(x + 6, y + 4, [
      { t: "平坦な界面 — 同種のお隣 ", c: text2, f: font(11) },
      { t: "4", c: accent, f: font(12, 600) },
    ]);
  }

  /** 強曲率のコマ: ごく小さな粒子の頂点原子は同種のお隣 2 個 */
  function drawTipFrame(x: number, y: number, w: number, h: number): void {
    const aR = clamp(Math.min(w / 12, h / 9), 6, 13);
    const s = aR * 2;
    const rowGap = s * 0.866;
    const cx = x + w / 2;
    const cyc = y + h * 0.55; // クラスタ重心(3+2+1 の三角配置の外接円中心)
    const circumR = 1.155 * s; // 外接円半径(原子中心まで)
    const apexY = cyc - circumR;
    const boundR = circumR + aR + 1.5;

    // 母相の薄い背景と、強く曲がった界面(円)
    ctx.globalAlpha = BG_MATRIX_ALPHA;
    ctx.fillStyle = matrix;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(cx, cyc, boundR, 0, TAU);
    ctx.globalAlpha = BG_INSIDE_ALPHA;
    ctx.fillStyle = soluteFill;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = text2;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 結合線: 頂点原子 → 斜め下 2 個
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, apexY);
    ctx.lineTo(cx - s / 2, apexY + rowGap);
    ctx.moveTo(cx, apexY);
    ctx.lineTo(cx + s / 2, apexY + rowGap);
    ctx.stroke();

    // 注目以外の原子(中 2 + 下 3 の三角配置。1 パス)
    ctx.beginPath();
    for (let i = 0; i < 2; i++) {
      const xx = cx + (i === 0 ? -s / 2 : s / 2);
      ctx.moveTo(xx + aR, apexY + rowGap);
      ctx.arc(xx, apexY + rowGap, aR, 0, TAU);
    }
    for (let i = -1; i <= 1; i++) {
      const xx = cx + i * s;
      ctx.moveTo(xx + aR, apexY + 2 * rowGap);
      ctx.arc(xx, apexY + 2 * rowGap, aR, 0, TAU);
    }
    ctx.fillStyle = soluteFill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = soluteEdge;
    ctx.stroke();

    // 注目原子(頂点)+ accent の輪 + 隣の数
    ctx.beginPath();
    ctx.arc(cx, apexY, aR, 0, TAU);
    ctx.fillStyle = soluteFill;
    ctx.fill();
    ctx.strokeStyle = soluteEdge;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, apexY, aR + 3, 0, TAU);
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    ctx.stroke();
    ctx.font = font(13, 600);
    ctx.fillStyle = accent;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("2", cx, apexY - aR - 6);

    // コマの見出し
    ctx.textBaseline = "top";
    drawSegs(x + 6, y + 4, [
      { t: "強い曲率(小さな粒子)— 同種のお隣 ", c: text2, f: font(11) },
      { t: "2", c: accent, f: font(12, 600) },
    ]);
  }

  function drawZoomPane(p: Pane): void {
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();

    const capH = 18;
    const frameH = (p.h - capH) / 2;
    drawFlatFrame(p.x, p.y, p.w, frameH);
    drawTipFrame(p.x, p.y + frameH, p.w, frameH);

    // コマの区切り線
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + frameH + 0.5);
    ctx.lineTo(p.x + p.w, p.y + frameH + 0.5);
    ctx.stroke();

    ctx.restore();

    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      "隣が少ないほど、界面から離れやすい(模式図)",
      p.x + 6,
      p.y + p.h - 4,
    );
  }

  /* ---- 右パネル: c(r)/c∞ の曲線・読み出し・数式 ---- */

  function drawRightPane(p: Pane, narrow: boolean): void {
    const ratio = gibbsThomsonRatio(rNm);
    const fLab = narrow ? font(10.5) : font(12.5);
    const fVal = narrow ? font(11, 600) : font(13, 600);
    const fTick = narrow ? font(10.5) : font(11);
    const lcStr = LC_NM.toFixed(1);

    // 数値読み出し(§5.3: 「界面の平衡濃度: c∞ の 2.7 倍」)
    ctx.textBaseline = "alphabetic";
    drawSegs(p.x, p.y + (narrow ? 11 : 14), [
      { t: "界面の平衡濃度: ", c: text2, f: fLab },
      { t: "c∞ の ", c: text, f: fLab },
      { t: `${ratio.toFixed(2)} 倍`, c: text, f: fVal },
    ]);

    // 数式パネル(テキスト描画。変数色は §5.0: c 系・lc → solute)
    const fpH = narrow ? 40 : 52;
    const fpY = p.y + p.h - fpH;
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, fpY + 0.5, p.w - 1, fpH - 1);
    const ff = narrow ? font(10.5) : font(12.5);
    const line1: Seg[] = [
      { t: "c(r)", c: soluteFill, f: ff },
      { t: " = ", c: text, f: ff },
      { t: "c∞", c: soluteFill, f: ff },
      { t: " · e^(", c: text, f: ff },
      { t: "lc", c: soluteFill, f: ff },
      { t: "/r)", c: text, f: ff },
    ];
    if (!narrow) {
      line1.push(
        { t: "  ≈  ", c: text, f: ff },
        { t: "c∞", c: soluteFill, f: ff },
        { t: "(1 + ", c: text, f: ff },
        { t: "lc", c: soluteFill, f: ff },
        { t: "/r)", c: text, f: ff },
      );
    }
    ctx.textBaseline = "alphabetic";
    drawSegs(p.x + 8, fpY + (narrow ? 15 : 20), line1);
    drawSegs(p.x + 8, fpY + (narrow ? 30 : 40), [
      { t: "lc", c: soluteFill, f: ff },
      { t: ` = 2γΩ/kBT ≈ ${lcStr} nm(200 °C)`, c: text, f: ff },
    ]);

    // プロット領域
    ctx.font = font(11);
    ctx.fillStyle = text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const titleY = p.y + (narrow ? 16 : 22);
    ctx.fillText(
      narrow
        ? "c(r)/c∞(横軸 r、対数)"
        : "界面濃度の倍率 c(r)/c∞(横軸: 半径 r、対数)",
      p.x,
      titleY,
    );
    const plotTop = titleY + (narrow ? 14 : 17);
    const axisX = p.x + 26;
    const axisY = fpY - (narrow ? 22 : 26);
    const xRight = p.x + p.w - 6;
    const lnMin = Math.log(R_MIN);
    const lnMax = Math.log(R_MAX);
    const mapX = (r: number): number =>
      axisX + ((xRight - axisX) * (Math.log(r) - lnMin)) / (lnMax - lnMin);
    const mapY = (c: number): number =>
      axisY - ((axisY - plotTop) * (c - 1)) / (Y_MAX - 1);

    // 軸(hairline 1 px)
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX + 0.5, plotTop);
    ctx.lineTo(axisX + 0.5, axisY + 0.5);
    ctx.lineTo(xRight, axisY + 0.5);
    ctx.stroke();
    ctx.font = fTick;
    ctx.fillStyle = text2;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of Y_TICKS) {
      const y = mapY(v);
      ctx.beginPath();
      ctx.moveTo(axisX - 3, y + 0.5);
      ctx.lineTo(axisX + 0.5, y + 0.5);
      ctx.stroke();
      ctx.fillText(String(v), axisX - 5, y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const v of X_TICKS) {
      const x = mapX(v);
      ctx.beginPath();
      ctx.moveTo(x, axisY + 0.5);
      ctx.lineTo(x, axisY + 3.5);
      ctx.stroke();
      ctx.fillText(fmtSig(v), x, axisY + 5);
    }

    // lc の目印(accent の小さな縦線 + ラベル — §5.3)
    const xlc = mapX(LC_NM);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xlc, axisY);
    ctx.lineTo(xlc, axisY - 12);
    ctx.stroke();
    ctx.font = font(11);
    ctx.fillStyle = accent;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("lc ≈ 1 nm", xlc, axisY - 15);

    // 曲線 c(r)/c∞ = e^(lc/r)(solute 色)
    const N_SAMPLE = 120;
    ctx.beginPath();
    for (let i = 0; i <= N_SAMPLE; i++) {
      const rr = Math.exp(lnMin + ((lnMax - lnMin) * i) / N_SAMPLE);
      const x = mapX(rr);
      const y = mapY(gibbsThomsonRatio(rr));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = soluteFill;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 現在点(ドロップライン + マーカー)
    const cxp = mapX(rNm);
    const cyp = mapY(ratio);
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cxp, axisY);
    ctx.lineTo(cxp, cyp);
    ctx.moveTo(axisX, cyp);
    ctx.lineTo(cxp, cyp);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cxp, cyp, 4, 0, TAU);
    ctx.fillStyle = soluteFill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = soluteEdge;
    ctx.stroke();
    ctx.textAlign = "left";
  }

  /* ---- 描画 ---- */

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const l = layout();
    if (zoomOn) drawZoomPane(l.left);
    else drawHaloPane(l.left, l.narrow);
    drawRightPane(l.right, l.narrow);
  }

  /* ---- フレームループ ---- */

  host.onFrame((dt) => {
    animT += dt;
    draw();
  });
  // 静止中の操作(スライダー・トグル・省モーション初期表示)用
  host.onRender(draw);

  syncPlaying();

  return {
    setPlaying(playing: boolean): void {
      // 省モーションのオーバーレイ再生ボタン等で engine 側から再生が
      // 始まった場合は、微アニメのトグル表示を追従させる(off 側は
      // 画面外停止でも呼ばれるため同期しない)
      if (playing && !animToggle.value) animToggle.set(true);
    },
    destroy(): void {
      // このウィジェットは canvas へのイベントリスナーを持たない
    },
  };
}
