/**
 * cooling-rate.ts — 図1「冷やす速さで別物になる」(記事仕様書 10 §5.1)
 *
 * 左: 温度 × 時間(対数)のグラフ。C 曲線(パーライトの変態開始線)・A₁・
 * M_s と、選んだ冷やし方の冷却曲線(ニュートン冷却)。冷却曲線が C 曲線を
 * 横切って加算和が 1 に達すればパーライト、横切らずに M_s へ下りきれば
 * マルテンサイト(lib/kinetics.ts の coolingOutcome — §5.0)。
 * 右上: できた組織の模式(パーライトは変態温度が低いほど縞を細かく描く)。
 * 右下: 硬さの目安の棒グラフ(冷やした結果を並べて記録していく)。
 *
 * 実装方式: requestRender + tween(「冷やす」で冷却曲線を 1.5 秒かけて
 * 左から伸ばす)。省モーション時は tween が即座に最終状態を返す。
 *
 * 簡略化(図注): 等温変態の C 曲線と加算則による見積もり(実際の連続冷却は
 * CCT 図)。ベイナイトや混ざった組織、試料の内外の冷え方の差は扱わない。
 * 硬さは目安。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { tween, type Tween } from "../../core/anim";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  A1_C,
  COOLING_MEDIA,
  C_EUTECTOID,
  T_AUSTENITIZE_C,
  coolingMedium,
  toK,
  type CoolingId,
} from "./lib/constants";
import {
  coolingOutcome,
  coolingRateAt,
  mfCelsius,
  msCelsius,
  newtonTempC,
  newtonTimeS,
  pearliteStartTime,
  type CoolingOutcome,
} from "./lib/kinetics";
import {
  martensiteHardness,
  pearliteHardness,
  pearliteSpacingRel,
} from "./lib/hardness";
import {
  MIN_CANVAS_PX,
  type Pane,
  type Scale,
  context2d,
  drawAxes,
  fmtCelsius,
  fmtSig,
  font,
  makeScale,
  mapScale,
  plateText,
  resolvePalette,
  subLabel,
  timeTickLabel,
} from "./lib/draw";

/** 時間軸の範囲 [s](§5.1: 0.1〜10⁵ 秒) */
const T_MIN_S = 0.1;
const T_MAX_S = 1e5;
/** 温度軸の範囲 [℃](§5.1: 0〜900 ℃) */
const TEMP_MIN_C = 0;
const TEMP_MAX_C = 900;
/** 冷却曲線を伸ばす時間 [ms](§5.1: 1.5 秒) */
const SWEEP_MS = 1500;
/** 冷却曲線・C 曲線のサンプル数 */
const CURVE_SAMPLES = 320;
/** 冷却速度を読む温度 [℃](§5.1) */
const RATE_PROBE_C = 550;
/** 冷却曲線の名前を書く温度 [℃] */
const LABEL_AT_C = 120;
/** M_s のラベルの右端を置く時刻 [s](C 曲線の下の枝より左) */
const MS_LABEL_AT_S = 1500;
/** 硬さの棒グラフの上限 [HV] */
const HV_AXIS_MAX = 900;
/** パーライトの縞の基準間隔 [px](炉冷 = 632 ℃ のとき) */
const LAMELLA_REF_PX = 13;
const LAMELLA_REF_C = 632;
/** 初期状態(§5.1: 水・未冷却) */
const INIT_MEDIUM: CoolingId = "water";

const TAU2 = Math.PI * 2;
const LOG_SPAN = Math.log10(T_MAX_S) - Math.log10(T_MIN_S);

interface Run {
  outcome: CoolingOutcome;
  hv: number;
}

/** マルテンサイトの板(組織の模式の固定配置。単位正方形の座標・角度・大きさ) */
const PLATES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.24, 0.22, 35, 0.36],
  [0.66, 0.18, -28, 0.42],
  [0.82, 0.52, 78, 0.38],
  [0.42, 0.5, -62, 0.46],
  [0.2, 0.68, 12, 0.34],
  [0.62, 0.8, 40, 0.4],
  [0.9, 0.86, -40, 0.22],
  [0.1, 0.4, 80, 0.2],
  [0.5, 0.06, 5, 0.22],
  [0.38, 0.88, -10, 0.26],
  [0.06, 0.9, 55, 0.18],
  [0.62, 0.5, 25, 0.2],
  [0.3, 0.38, 10, 0.18],
  [0.96, 0.2, 85, 0.24],
  [0.78, 0.33, -55, 0.16],
];

export default function coolingRate(host: FigureHost): WidgetHandle {
  const ctx = context2d(host.canvas);
  const pal = resolvePalette();
  const ms = msCelsius(C_EUTECTOID);
  const mf = mfCelsius(ms);

  /** 5 通りの結果はモデルから一意に決まるので先に計算しておく */
  const runs = new Map<CoolingId, Run>();
  for (const m of COOLING_MEDIA) {
    const outcome = coolingOutcome(m.tauS, ms);
    const hv =
      outcome.product === "martensite"
        ? martensiteHardness(C_EUTECTOID)
        : pearliteHardness(outcome.startTempC);
    runs.set(m.id, { outcome, hv });
  }

  /* ---- 状態 ---- */
  let selected: CoolingId = INIT_MEDIUM;
  /** 冷却曲線の伸び具合(0 = 未冷却、1 = 描き切った) */
  let sweep = 0;
  /** 冷やし終えた(棒グラフに記録した)冷やし方 */
  const recorded = new Set<CoolingId>();
  let activeTween: Tween | null = null;

  /* ---- 読み取り値(§5.1) ---- */
  const readout = createReadout(host);
  const rRate = readout.item("550 ℃ での冷却速度");
  const rProduct = readout.item("結果");
  const rStart = readout.item("変態が始まった温度");
  const rHv = readout.item("硬さの目安");

  /** 冷却曲線がいま描かれている時刻の上限 [s] */
  function sweepTimeS(): number {
    return 10 ** (Math.log10(T_MIN_S) + LOG_SPAN * sweep);
  }

  /** 変態の印を出してよいか(曲線がその時刻まで伸びたか) */
  function eventShown(run: Run): boolean {
    return sweep >= 1 || run.outcome.startTimeS <= sweepTimeS();
  }

  function updateReadouts(): void {
    const m = coolingMedium(selected);
    const rate = coolingRateAt(RATE_PROBE_C, m.tauS);
    rRate.set(`${fmtSig(rate, 2)} ℃/秒`);
    const run = runs.get(selected);
    if (!run || sweep === 0 || !eventShown(run)) {
      rProduct.set("—");
      rStart.set("—");
      rHv.set("—");
      return;
    }
    const isM = run.outcome.product === "martensite";
    rProduct.set(isM ? "マルテンサイト" : "パーライト");
    rStart.set(
      isM
        ? `${Math.round(ms)} ℃(Ms)`
        : `${Math.round(run.outcome.startTempC)} ℃`,
    );
    rHv.set(`約 ${Math.round(run.hv / 10) * 10} HV`);
  }

  /* ---- 操作部品(§5.1) ---- */
  const seg = host.controls.segmented<CoolingId>({
    id: "medium",
    label: "冷やし方",
    options: COOLING_MEDIA.map((m) => ({ value: m.id, label: m.label })),
    value: INIT_MEDIUM,
  });
  seg.onChange((v) => {
    activeTween?.cancel();
    activeTween = null;
    selected = v;
    // 冷やし済みなら結果をそのまま見せる。未冷却なら「冷やす」を待つ
    sweep = recorded.has(v) ? 1 : 0;
    updateReadouts();
    host.requestRender();
  });

  const coolBtn = host.controls.button({ label: "冷やす" });
  coolBtn.onClick(() => {
    activeTween?.cancel();
    const id = selected;
    sweep = 0;
    activeTween = tween(
      0,
      1,
      SWEEP_MS,
      (u) => {
        sweep = u;
        updateReadouts();
        host.requestRender();
      },
      () => {
        recorded.add(id);
        activeTween = null;
        updateReadouts();
        host.requestRender();
      },
    );
  });

  host.controls.reset(() => {
    activeTween?.cancel();
    activeTween = null;
    recorded.clear();
    seg.set(INIT_MEDIUM);
    selected = INIT_MEDIUM;
    sweep = 0;
    updateReadouts();
  });

  /* ---- レイアウト ---- */

  interface Layout {
    plot: Pane;
    micro: Pane;
    bars: Pane;
    narrow: boolean;
  }

  function layout(): Layout {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    if (narrow) {
      const plotH = Math.round(h * 0.56);
      const rowY = plotH + pad;
      const rowH = h - rowY - pad;
      const microW = Math.round((w - 3 * pad) * 0.44);
      return {
        plot: { x: pad, y: pad, w: w - 2 * pad, h: plotH - pad },
        micro: { x: pad, y: rowY, w: microW, h: rowH },
        bars: {
          x: 2 * pad + microW,
          y: rowY,
          w: w - 3 * pad - microW,
          h: rowH,
        },
        narrow,
      };
    }
    const plotW = Math.round((w - 3 * pad) * 0.62);
    const colX = 2 * pad + plotW;
    const colW = w - colX - pad;
    const microH = Math.round((h - 3 * pad) * 0.48);
    return {
      plot: { x: pad, y: pad, w: plotW, h: h - 2 * pad },
      micro: { x: colX, y: pad, w: colW, h: microH },
      bars: {
        x: colX,
        y: 2 * pad + microH,
        w: colW,
        h: h - 3 * pad - microH,
      },
      narrow,
    };
  }

  /* ---- 左: 温度 × 時間(対数)---- */

  function drawPlot(p: Pane, narrow: boolean): void {
    const fs = narrow ? 10 : 11;
    const left = p.x + (narrow ? 34 : 42);
    const right = p.x + p.w - 6;
    const top = p.y + 22;
    const bottom = p.y + p.h - (narrow ? 34 : 38);
    const xs: Scale = makeScale(T_MIN_S, T_MAX_S, left, right, true);
    const ys: Scale = makeScale(TEMP_MIN_C, TEMP_MAX_C, bottom, top);
    const X = (t: number): number => mapScale(xs, t);
    const Y = (c: number): number => mapScale(ys, c);

    drawAxes(ctx, pal, xs, ys, {
      xTicks: [0.1, 1, 10, 100, 1e3, 1e4, 1e5],
      yTicks: [0, 200, 400, 600, 800],
      xFormat: timeTickLabel,
      xTitle: "冷やし始めてからの時間 [秒](対数目盛り)",
      yTitle: "温度 [℃]",
      fontPx: fs,
    });

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top - 4, right - left, bottom - top + 4);
    ctx.clip();

    // 時間の目安(1 分・1 時間・1 日)
    ctx.font = font(fs - 1);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    for (const [t, label] of [
      [60, "1 分"],
      [3600, "1 時間"],
      [86400, "1 日"],
    ] as const) {
      const x = Math.round(X(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      // 右端に近い目盛りは線の左に寄せて、枠からはみ出さないようにする
      const nearEdge = x > right - 28;
      ctx.textAlign = nearEdge ? "right" : "center";
      ctx.fillText(label, nearEdge ? x - 3 : x, top + 2);
    }

    // A₁(細い実線)
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(left, Math.round(Y(A1_C)) + 0.5);
    ctx.lineTo(right, Math.round(Y(A1_C)) + 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // M_s(破線)
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(left, Math.round(Y(ms)) + 0.5);
    ctx.lineTo(right, Math.round(Y(ms)) + 0.5);
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // C 曲線(パーライトの変態開始線 — text-2 の実線)
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      const tC = 150 + ((A1_C - 0.2 - 150) * i) / CURVE_SAMPLES;
      const ts = pearliteStartTime(toK(tC));
      if (!Number.isFinite(ts) || ts > T_MAX_S * 100) {
        pen = false;
        continue;
      }
      const x = X(ts);
      const y = Y(tC);
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      pen = true;
    }
    ctx.strokeStyle = pal.text2;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 記録済みの他の冷却曲線(淡く)と、選択中の冷却曲線(accent)
    for (const m of COOLING_MEDIA) {
      if (m.id === selected || !recorded.has(m.id)) continue;
      drawCoolingCurve(m.tauS, 1, X, Y, pal.text2, 1.2, 0.45);
      labelCurve(m.label, m.tauS, X, Y, pal.text2, fs);
    }
    const mSel = coolingMedium(selected);
    if (sweep > 0) {
      drawCoolingCurve(mSel.tauS, sweep, X, Y, pal.accent, 2.5, 1);
      if (sweep >= 1) labelCurve(mSel.label, mSel.tauS, X, Y, pal.accent, fs);
    }
    ctx.restore();

    // 線のラベル(クリップの外でも読めるように後から描く)
    subLabel(
      ctx,
      "A",
      "1",
      ` ${A1_C} ℃`,
      right - 4,
      Y(A1_C) - 5,
      pal.text2,
      fs,
      "right",
    );
    // M_s のラベルは、C 曲線の下の枝とぶつからない位置(10³ 秒付近)に置く
    const msLabelX = X(MS_LABEL_AT_S);
    subLabel(
      ctx,
      "M",
      "s",
      ` ${Math.round(ms)} ℃`,
      msLabelX,
      Y(ms) - 5,
      pal.text2,
      fs,
      "right",
    );
    // M_f の注記は広い幅だけ(狭い幅では冷やし方の名前の行と重なる)
    if (!narrow) {
      subLabel(
        ctx,
        "(M",
        "f",
        ` ≈ ${fmtCelsius(Math.round(mf / 10) * 10)} は軸より下)`,
        msLabelX,
        Y(ms) + fs + 5,
        pal.text2,
        fs - 1,
        "right",
      );
    }

    // 変態の印のラベルの位置(C 曲線の名前がこれを避ける)
    const run = runs.get(selected);
    const event =
      run && sweep > 0 && eventShown(run)
        ? (() => {
            const isM = run.outcome.product === "martensite";
            const x = X(Math.max(run.outcome.startTimeS, T_MIN_S));
            const y = Y(run.outcome.startTempC);
            // 狭い幅では「ここで」を省く(M_s のラベルと重なるため)
            const text =
              (narrow ? "" : "ここで") +
              (isM ? "マルテンサイトに" : "パーライトに");
            const toLeft = x > (left + right) / 2;
            ctx.font = font(fs + 1);
            const w = ctx.measureText(text).width + 6;
            const x0 = toLeft ? x - 10 - w + 3 : x + 10 - 3;
            return {
              x,
              y,
              text,
              toLeft,
              x0,
              x1: x0 + w,
              y0: y - 14 - (fs + 7) / 2,
            };
          })()
        : null;

    // 領域の名前と C 曲線の名前
    ctx.font = font(fs);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = pal.text2;
    ctx.fillText("オーステナイト(安定)", left + 6, Y(A1_C) - 4);
    // C 曲線の名前は上の枝(右へゆるく上がる)のすぐ下に、上端をそろえて
    // 置く。変態の印のラベルと重なるとき(狭い幅の油冷)は描かない
    const cText = "パーライトが始まる(C 曲線)";
    const cX = X(pearliteStartTime(toK(610))) + 8;
    const cTop = Y(610) + 3;
    ctx.font = font(fs);
    const cW = ctx.measureText(cText).width;
    const cH = fs + 6;
    const cHits =
      event !== null &&
      event.x0 < cX + cW + 3 &&
      event.x1 > cX - 3 &&
      event.y0 < cTop + cH &&
      event.y0 + fs + 7 > cTop;
    if (!cHits) {
      plateText(ctx, pal, cText, cX, cTop, pal.text2, fs, "left", "top");
    }
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("パーライト", X(400), Y(450));
    // 冷やし始めの温度
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `${T_AUSTENITIZE_C} ℃ から冷やす`,
      left + 6,
      Y(T_AUSTENITIZE_C) - 2,
    );

    // 変態の印
    if (event) {
      const { x, y, text, toLeft } = event;
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, TAU2);
      ctx.fillStyle = pal.bg;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = pal.accent;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, TAU2);
      ctx.fillStyle = pal.accent;
      ctx.fill();
      plateText(
        ctx,
        pal,
        text,
        toLeft ? x - 10 : x + 10,
        y - 14,
        pal.accent,
        fs + 1,
        toLeft ? "right" : "left",
      );
    }
  }

  /** 冷却曲線(progress 0〜1 は対数時間の上での伸び具合) */
  function drawCoolingCurve(
    tauS: number,
    progress: number,
    X: (t: number) => number,
    Y: (c: number) => number,
    color: string,
    width: number,
    alpha: number,
  ): void {
    const lgMin = Math.log10(T_MIN_S);
    const lgEnd = lgMin + LOG_SPAN * progress;
    ctx.beginPath();
    // 左端より前(0.1 秒より前)の冷却は、左端の外から入ってくる
    ctx.moveTo(X(T_MIN_S) - 30, Y(newtonTempC(T_MIN_S * 0.2, tauS)));
    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      const lg = lgMin + (LOG_SPAN * i) / CURVE_SAMPLES;
      if (lg > lgEnd) break;
      const t = 10 ** lg;
      ctx.lineTo(X(t), Y(newtonTempC(t, tauS)));
    }
    const tEnd = 10 ** lgEnd;
    ctx.lineTo(X(tEnd), Y(newtonTempC(tEnd, tauS)));
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /**
   * 冷却曲線の名前(LABEL_AT_C ℃ を通る点の右上に)。いちばん速い塩水だけは
   * 水の名前とぶつからないよう、曲線の左に書く。
   */
  function labelCurve(
    label: string,
    tauS: number,
    X: (t: number) => number,
    Y: (c: number) => number,
    color: string,
    fs: number,
  ): void {
    const t = newtonTimeS(LABEL_AT_C, tauS);
    const fastest = tauS <= COOLING_MEDIA[COOLING_MEDIA.length - 1].tauS;
    ctx.font = font(fs, 600);
    ctx.fillStyle = color;
    ctx.textAlign = fastest ? "right" : "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(label, X(t) + (fastest ? -4 : 4), Y(LABEL_AT_C) - 3);
  }

  /* ---- 右上: 組織の模式 ---- */

  function drawMicro(p: Pane, narrow: boolean): void {
    const fs = narrow ? 10 : 11;
    ctx.font = font(fs);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const run = runs.get(selected);
    const shown = run && sweep > 0 && eventShown(run);
    // 狭い幅では右隣の棒グラフの題と並ぶので、短い題にする
    const head = narrow ? "組織" : "できた組織";
    let title = "できた組織";
    if (shown && run) {
      title =
        run.outcome.product === "martensite"
          ? `${head}: マルテンサイト${narrow ? "" : "(針状)"}`
          : `${head}: パーライト(${Math.round(run.outcome.startTempC)} ℃${narrow ? "" : " で"})`;
    }
    ctx.fillText(title, p.x, p.y);
    const size = Math.min(p.w, p.h - fs - 8);
    const box: Pane = { x: p.x, y: p.y + fs + 6, w: size, h: size };
    if (!narrow) box.w = p.w;
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    if (!shown || !run) {
      ctx.fillStyle = pal.text2;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = font(fs);
      ctx.fillText(
        "「冷やす」を押すと",
        box.x + box.w / 2,
        box.y + box.h / 2 - 9,
      );
      ctx.fillText(
        "ここに組織が出る",
        box.x + box.w / 2,
        box.y + box.h / 2 + 9,
      );
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x + 1, box.y + 1, box.w - 2, box.h - 2);
    ctx.clip();
    if (run.outcome.product === "pearlite") {
      drawPearlite(
        box,
        pearliteSpacingRel(run.outcome.startTempC, LAMELLA_REF_C),
      );
    } else {
      drawMartensite(box);
    }
    ctx.restore();
  }

  /** パーライト: 向きの違う 3 つのコロニーに、フェライトと炭化物の縞 */
  function drawPearlite(b: Pane, spacingRel: number): void {
    const colonies: ReadonlyArray<{
      poly: ReadonlyArray<readonly [number, number]>;
      angle: number;
    }> = [
      {
        poly: [
          [0, 0],
          [0.62, 0],
          [0.45, 0.55],
          [0, 0.38],
        ],
        angle: 30,
      },
      {
        poly: [
          [0.62, 0],
          [1, 0],
          [1, 0.7],
          [0.45, 0.55],
        ],
        angle: -52,
      },
      {
        poly: [
          [0, 0.38],
          [0.45, 0.55],
          [1, 0.7],
          [1, 1],
          [0, 1],
        ],
        angle: 78,
      },
    ];
    const period = Math.max(LAMELLA_REF_PX * spacingRel, 4);
    const cementite = Math.max(period * 0.22, 1.4);
    const diag = Math.hypot(b.w, b.h);
    // 下地(フェライト)
    ctx.fillStyle = pal.matrix;
    ctx.globalAlpha = 0.28;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.globalAlpha = 1;
    for (const col of colonies) {
      ctx.save();
      ctx.beginPath();
      col.poly.forEach(([u, v], i) => {
        const x = b.x + u * b.w;
        const y = b.y + v * b.h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.clip();
      ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
      ctx.rotate((col.angle * Math.PI) / 180);
      ctx.fillStyle = pal.precip;
      ctx.globalAlpha = 0.85;
      for (let s = -diag; s <= diag; s += period) {
        ctx.fillRect(s, -diag, cementite, 2 * diag);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    // コロニーの境界
    ctx.strokeStyle = pal.text2;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(b.x + 0.62 * b.w, b.y);
    ctx.lineTo(b.x + 0.45 * b.w, b.y + 0.55 * b.h);
    ctx.lineTo(b.x, b.y + 0.38 * b.h);
    ctx.moveTo(b.x + 0.45 * b.w, b.y + 0.55 * b.h);
    ctx.lineTo(b.x + b.w, b.y + 0.7 * b.h);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** マルテンサイト: 向きの違う針状(レンズ形)の板。格子線は板の長軸に直交 */
  function drawMartensite(b: Pane): void {
    ctx.fillStyle = pal.matrix;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.globalAlpha = 1;
    const scale = Math.min(b.w, b.h);
    for (const [u, v, angle, len] of PLATES) {
      const halfL = (len * scale) / 2;
      const halfW = Math.max(halfL * 0.16, 2.5);
      ctx.save();
      ctx.translate(b.x + u * b.w, b.y + v * b.h);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.beginPath();
      ctx.moveTo(-halfL, 0);
      ctx.quadraticCurveTo(0, -2 * halfW, halfL, 0);
      ctx.quadraticCurveTo(0, 2 * halfW, -halfL, 0);
      ctx.closePath();
      ctx.fillStyle = pal.matrix;
      ctx.globalAlpha = 0.45;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = pal.matrixEdge;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // 板の中の格子線(長軸に直交)
      ctx.beginPath();
      for (let s = -halfL + 6; s <= halfL - 6; s += 5) {
        const hh = 0.85 * halfW * (1 - (s / halfL) ** 2);
        ctx.moveTo(s, -hh);
        ctx.lineTo(s, hh);
      }
      ctx.strokeStyle = pal.matrixEdge;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  /* ---- 右下: 硬さの棒グラフ ---- */

  function drawBars(p: Pane, narrow: boolean): void {
    const fs = narrow ? 10 : 11;
    const left = p.x + (narrow ? 30 : 34);
    const right = p.x + p.w - 4;
    const top = p.y + fs + 12;
    const bottom = p.y + p.h - fs - 10;
    const ys = makeScale(0, HV_AXIS_MAX, bottom, top);
    const xs = makeScale(0, 1, left, right);
    ctx.font = font(fs);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(
      narrow
        ? "硬さ [HV](冷やすたびに記録)"
        : "硬さの目安 [HV](冷やすたびに記録)",
      p.x,
      p.y,
    );
    drawAxes(ctx, pal, xs, ys, {
      xTicks: [],
      yTicks: [0, 200, 400, 600, 800],
      fontPx: fs - 1,
      gridY: true,
    });
    const n = COOLING_MEDIA.length;
    const slot = (right - left) / n;
    const barW = Math.min(slot * 0.56, 34);
    COOLING_MEDIA.forEach((m, i) => {
      const cx = left + slot * (i + 0.5);
      // 冷やし方の名前
      ctx.font = font(fs, m.id === selected ? 600 : 400);
      ctx.fillStyle = m.id === selected ? pal.accent : pal.text2;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(m.label, cx, bottom + 4);
      const run = runs.get(m.id);
      if (!run || !recorded.has(m.id)) return;
      const y = mapScale(ys, run.hv);
      ctx.fillStyle = m.id === selected ? pal.accent : pal.text2;
      ctx.globalAlpha = m.id === selected ? 0.9 : 0.45;
      ctx.fillRect(cx - barW / 2, y, barW, bottom - y);
      ctx.globalAlpha = 1;
      ctx.font = font(fs - 1);
      ctx.fillStyle = pal.text;
      ctx.textBaseline = "bottom";
      ctx.fillText(String(Math.round(run.hv / 10) * 10), cx, y - 2);
    });
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // レイアウト前の極小キャンバスでは描かない(負の半径などを避ける)
    if (w < MIN_CANVAS_PX || h < MIN_CANVAS_PX) return;
    const l = layout();
    drawPlot(l.plot, l.narrow);
    drawMicro(l.micro, l.narrow);
    drawBars(l.bars, l.narrow);
  }

  updateReadouts();
  host.onRender(draw);

  return {
    destroy(): void {
      activeTween?.cancel();
    },
  };
}
