/**
 * zone-folding.ts — 図5「折りたたむ — 拡張ゾーンと還元ゾーン」(仕様書 11 §5.5)
 *
 * 左(狭幅では上)= 2D の E-k 図。バンドは k → k + G の周期を持つので、
 * 拡張ゾーン表示と還元ゾーン表示は同じものの別の描き方である。
 * 右(狭幅では下)= 3D。面心立方結晶の第 1 ブリルアンゾーン(切頂八面体)と
 * 逆格子点(BCC 配列)。逆格子空間記事の図7 と地続きであることを見せる。
 *
 * 実装: 2D は host.canvas に、3D は stage に重ねた専用の WebGL キャンバスに
 * 描く。3D の雛形と視点操作は reciprocal-lattice/_shared3d.ts の
 * createSingleView を使う(再実装しない — 仕様書 11 §0-5)。three.js は
 * この図版に接近したときに初めて動的 import される。
 *
 * 簡略化(図注に明示): 左の 1 次元模型と右の立体は別々の系で、対応させる
 * ためのものではない。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  bandColors,
  createPlotMapper,
  drawCurve,
  drawPlotFrame,
  drawZoneBoundary,
  formatK,
  setPlotRange,
  withPlotClip,
  type AxisTick,
} from "../_shared/banddiagram";
import { DEFAULT_A, DEFAULT_B, DEFAULT_U0 } from "./lib/constants";
import { findBands, type Band, type KPParams } from "./lib/kronig-penney";
import {
  createCurveBuffer,
  fillExtendedSegment,
  fillReducedBand,
} from "./lib/curves";
import {
  bzEdgePositions,
  bzFaces,
  fccReciprocalPoints,
  SYMMETRY_POINTS,
} from "./lib/brillouin";

/** 2D 側の表示範囲 */
const ZONES = 3;
const E_MAX = 10;
const E_SCAN_MAX = 45;
const N_BANDS = 4;
/** 余白(px) */
const MARGIN_LEFT = 52;
const MARGIN_RIGHT = 12;
const MARGIN_TOP = 40; // 上のパネルラベル(ix-panel-tag)と目盛りが重ならない高さ
const MARGIN_BOTTOM = 44;
/** サンプル点数 */
const SAMPLES = 121;
const SAMPLES_NARROW = 61;
const NARROW_WIDTH_PX = 480;
/** 横並びと判定するアスペクト比の下限(_shared2d と同値) */
const SIDE_BY_SIDE_MIN_ASPECT = 1.25;
/** パネル間の隙間(px) */
const PANEL_GAP = 12;
/** バンドごとの線の濃度(折り返しの対応を追えるようにする) */
const BAND_ALPHA = [1, 0.78, 0.6, 0.46];

/**
 * 3D: 逆格子点を描く範囲(2π/a 単位の整数格子)と見た目の半径。
 * ゾーンに面する最近接(√3)と第 2 近接(2)までに絞る
 */
const RECIP_RANGE = 2;
const RECIP_MAX_RADIUS = 2.05;
const POINT_RADIUS = 0.055;
/** 3D: カメラ距離(2π/a 単位) */
const CAMERA_DIST = 5.2;
/** 3D: ラベルスプライトの高さ(2π/a 単位) */
const LABEL_HEIGHT = 0.2;
/** 3D の格子定数(逆格子空間記事の既定と揃える) */
const A_3D_NM = 0.4;

type ZoneMode = "extended" | "reduced";

/** 横軸の目盛りラベル(±nπ/a) */
function zoneLabel(n: number): string {
  if (n === 0) return "0";
  const sign = n < 0 ? "−" : "";
  const mag = Math.abs(n) === 1 ? "" : String(Math.abs(n));
  return `${sign}${mag}π/a`;
}

export default async function zoneFolding(
  host: FigureHost,
): Promise<WidgetHandle> {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = bandColors();
  const mapper = createPlotMapper();

  /* ---- 状態 ---- */
  const params: KPParams = { a: DEFAULT_A, b: DEFAULT_B, u0: DEFAULT_U0 };
  let mode: ZoneMode = "extended";
  let showFaces = true;
  const bands: Band[] = findBands(params, N_BANDS, E_SCAN_MAX);
  const boundary = Math.PI / params.a;
  const kMax = ZONES * boundary;

  /* ---- 使い回すバッファ ---- */
  const curve = createCurveBuffer(SAMPLES);
  const xTicksExtended: AxisTick[] = [];
  for (let z = -ZONES; z <= ZONES; z++) {
    xTicksExtended.push({ value: z * boundary, label: zoneLabel(z) });
  }
  const xTicksReduced: AxisTick[] = [
    { value: -boundary, label: "−π/a" },
    { value: 0, label: "0" },
    { value: boundary, label: "π/a" },
  ];

  /* ---- 3D(専用キャンバスを stage に重ねる) ---- */
  const glCanvas = document.createElement("canvas");
  glCanvas.setAttribute("aria-hidden", "true");
  glCanvas.style.position = "absolute";
  glCanvas.style.right = "auto";
  glCanvas.style.bottom = "auto";
  host.stage.appendChild(glCanvas);
  const glSize = { w: 1, h: 1, dpr: 1 };

  const shared3d = await import("../reciprocal-lattice/_shared3d");
  const view = shared3d.createSingleView(host, {
    dist: CAMERA_DIST,
    canvas: glCanvas,
    size: glSize,
    onChange: () => host.requestRender(),
    ariaLabel:
      "ブリルアンゾーンの立体表示。矢印キーで回転、+ と − で拡大縮小できます。",
  });

  // 逆格子点(FCC の逆格子 = BCC 配列)
  const points = fccReciprocalPoints(RECIP_RANGE, RECIP_MAX_RADIUS);
  const atoms = shared3d.createInstancedAtoms(
    points.length,
    POINT_RADIUS,
    colors.recip,
  );
  points.forEach((p, i) => atoms.setAtom(i, p.x, p.y, p.z));
  atoms.commit();
  view.scene.add(atoms.mesh);

  // 第 1 ブリルアンゾーン(切頂八面体): 面つき表示と稜線だけの表示を切り替える
  const faces = shared3d.createPlaneStack(colors.recip, 0.12);
  faces.set(bzFaces());
  view.scene.add(faces.group);
  const wire = shared3d.createLineSegments(
    bzEdgePositions(),
    colors.recip,
    0.55,
  );
  view.scene.add(wire);

  // 対称点のラベル(Γ, X, L)
  for (const { label, p } of SYMMETRY_POINTS) {
    const sprite = shared3d.makeLabelSprite(label, colors.text, LABEL_HEIGHT);
    // 点に重ならないよう少し上へずらす
    sprite.position.set(p.x, p.y + LABEL_HEIGHT * 0.9, p.z);
    view.scene.add(sprite);
  }

  const tags = shared3d.createPanelTags(host.stage, [
    "E-k(1 次元模型)",
    `第 1 ブリルアンゾーン(FCC・a = ${A_3D_NM.toFixed(2)} nm)`,
  ]);

  function applyFaceVisibility(): void {
    faces.group.visible = showFaces;
    wire.visible = !showFaces;
  }
  applyFaceVisibility();

  function sampleCount(): number {
    return host.size.w < NARROW_WIDTH_PX ? SAMPLES_NARROW : SAMPLES;
  }

  /** 2D 側と 3D 側の矩形を決める(狭幅では上下積み) */
  function layout(): {
    plot: { x: number; y: number; w: number; h: number };
    gl: { x: number; y: number; w: number; h: number };
  } {
    const { w, h } = host.size;
    if (w >= h * SIDE_BY_SIDE_MIN_ASPECT) {
      const pw = (w - PANEL_GAP) / 2;
      return {
        plot: { x: 0, y: 0, w: pw, h },
        gl: { x: pw + PANEL_GAP, y: 0, w: pw, h },
      };
    }
    const ph = (h - PANEL_GAP) / 2;
    return {
      plot: { x: 0, y: 0, w, h: ph },
      gl: { x: 0, y: ph + PANEL_GAP, w, h: ph },
    };
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const rects = layout();

    /* ---- 3D 側のレイアウト追従 ---- */
    glCanvas.style.left = `${rects.gl.x}px`;
    glCanvas.style.top = `${rects.gl.y}px`;
    glCanvas.style.width = `${rects.gl.w}px`;
    glCanvas.style.height = `${rects.gl.h}px`;
    if (
      glSize.w !== rects.gl.w ||
      glSize.h !== rects.gl.h ||
      glSize.dpr !== dpr
    ) {
      glSize.w = rects.gl.w;
      glSize.h = rects.gl.h;
      glSize.dpr = dpr;
      view.resize();
    }
    view.render();
    tags.update([
      { x: rects.plot.x, y: rects.plot.y, w: rects.plot.w, h: rects.plot.h },
      { x: rects.gl.x, y: rects.gl.y, w: rects.gl.w, h: rects.gl.h },
    ]);

    /* ---- 2D 側(E-k 図) ---- */
    const extended = mode === "extended";
    const xMax = extended ? kMax : boundary;
    setPlotRange(
      mapper,
      rects.plot.x + MARGIN_LEFT,
      rects.plot.y + MARGIN_TOP,
      rects.plot.w - MARGIN_LEFT - MARGIN_RIGHT,
      rects.plot.h - MARGIN_TOP - MARGIN_BOTTOM,
      -xMax,
      xMax,
      0,
      E_MAX,
    );
    drawPlotFrame(ctx, mapper, {
      colors,
      xTicks: extended ? xTicksExtended : xTicksReduced,
      yTicks: [
        { value: 0, label: "0" },
        { value: 5, label: "5" },
        { value: 10, label: "10" },
      ],
      xLabel: "波数 k",
      yLabel: "エネルギー E [eV]",
      yAxisAtZero: true,
    });

    const n = sampleCount();
    withPlotClip(ctx, mapper, () => {
      // ゾーン境界(還元表示では第 1 ゾーンの両端だけ)
      const zoneCount = extended ? ZONES : 1;
      for (let z = 1; z <= zoneCount; z++) {
        drawZoneBoundary(ctx, mapper, z * boundary, { colors });
        drawZoneBoundary(ctx, mapper, -z * boundary, { colors });
      }
      for (let i = 0; i < bands.length; i++) {
        const alpha = BAND_ALPHA[Math.min(i, BAND_ALPHA.length - 1)];
        if (extended) {
          if (i >= ZONES) continue;
          for (const sign of [1, -1] as const) {
            fillExtendedSegment(curve, n, bands[i], params, i + 1, sign);
            drawCurve(ctx, mapper, curve.k, curve.e, curve.count, {
              color: colors.level,
              width: 2.4,
              alpha,
            });
          }
        } else {
          fillReducedBand(curve, n, bands[i], params);
          drawCurve(ctx, mapper, curve.k, curve.e, curve.count, {
            color: colors.level,
            width: 2.4,
            alpha,
          });
        }
      }
    });

    modeItem.set(extended ? "拡張ゾーン" : "還元ゾーン");
    boundaryItem.set(formatK(boundary));
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const modeItem = readout.item("表示");
  const boundaryItem = readout.item("ゾーン境界 π/a", { color: "recip" });
  const shapeItem = readout.item("第 1 BZ の形");
  shapeItem.set("切頂八面体(FCC)");

  const modeSeg = host.controls.segmented<ZoneMode>({
    id: "mode",
    label: "ゾーンの描き方",
    options: [
      { value: "extended", label: "拡張ゾーン" },
      { value: "reduced", label: "還元ゾーン" },
    ],
    value: "extended",
  });
  modeSeg.onChange((v) => {
    mode = v;
  });

  const facesToggle = host.controls.toggle({
    id: "faces",
    label: "ブリルアンゾーンの面を表示",
    value: true,
  });
  facesToggle.onChange((v) => {
    showFaces = v;
    applyFaceVisibility();
  });

  host.controls.reset(() => {
    modeSeg.set("extended");
    facesToggle.set(true);
    mode = "extended";
    showFaces = true;
    applyFaceVisibility();
    view.resetView();
  });

  host.onRender(draw);

  return {
    destroy(): void {
      readout.el.remove();
      tags.dispose();
      faces.dispose();
      atoms.dispose();
      view.dispose();
      glCanvas.remove();
    },
  };
}
