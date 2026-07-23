/**
 * edge-dislocation-field.ts — 図2: 刃状転位の応力場(記事仕様 §5.2)
 *
 * 2D 正方格子(約 27×16 原子)の中央に刃状転位を置き、格子点を等方弾性の
 * 変位場で動かして表示する。トグルで静水圧場(圧縮/引張)のセル塗り
 * オーバーレイを重ね、スライダーで変位の誇張率を変えられる。
 *
 * 実装方式: 2D / requestRender(操作時のみ再描画 — アイドル時の消費ゼロ)。
 * 簡略化(図注に明示): 実際の α-Fe は BCC。ここでは 2D 正方格子に簡略化。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { darken, matColor, uiColor } from "../../core/colors";
import {
  buildEdgeLattice,
  dislocationSymbolPos,
  drawDislocationMark,
  drawLatticeAtoms,
  drawPressureOverlay,
  makeLatticeView,
  parseRgb,
  viewY,
} from "./lib/lattice";

/** 格子の列数・行数(約 26×16 — 奇数列で余分な半面が中央に来る) */
const COLS = 27;
const ROWS = 16;
/** 変位の誇張(§5.2: ×1〜×4、初期 ×2) */
const EXAG_MIN = 1;
const EXAG_MAX = 4;
const EXAG_INIT = 2;
const EXAG_STEP = 0.1;
/** 原子半径(格子間隔に対する割合) */
const ATOM_RADIUS_RATIO = 0.3;

export default function edgeDislocationField(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  const matrixFill = matColor("matrix");
  const matrixEdge = darken(matrixFill);
  const defectColor = matColor("defect");
  const labelColor = uiColor("text2");
  const bgColor = uiColor("bg");
  const tensionRgb = parseRgb(matColor("tension"));
  const compressionRgb = parseRgb(matColor("compression"));

  const lat = buildEdgeLattice(COLS, ROWS);
  const symPos = { x: 0, y: 0 };

  let exaggeration = EXAG_INIT;
  let showField = false;

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // 誇張による変位(u_x は最大 ±b/2 × 誇張率)も収まる寸法でフィット
    const view = makeLatticeView(
      w,
      h,
      COLS + exaggeration,
      ROWS + 0.5 * exaggeration,
    );

    if (showField) {
      drawPressureOverlay(ctx, view, COLS, ROWS, tensionRgb, compressionRgb);
    }

    drawLatticeAtoms(
      ctx,
      view,
      lat,
      exaggeration,
      ATOM_RADIUS_RATIO * view.scale,
      matrixFill,
      matrixEdge,
    );

    // ⊥ 記号は余分な半面の端(変位に追従)に置く
    dislocationSymbolPos(exaggeration, symPos);
    drawDislocationMark(ctx, view, symPos.x, symPos.y, defectColor);

    if (showField) {
      // 圧縮側(上)/引張側(下)のラベル(14px, --color-text-2 — §6.5)。
      // 原子と重なっても読めるよう白の縁取りを敷く
      ctx.font = "14px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 4;
      ctx.strokeStyle = bgColor;
      ctx.fillStyle = labelColor;
      const lx = 14;
      const yTop = viewY(view, ROWS / 2 - 1);
      const yBot = viewY(view, -ROWS / 2 + 1);
      ctx.strokeText("圧縮(詰まっている)", lx, yTop);
      ctx.fillText("圧縮(詰まっている)", lx, yTop);
      ctx.strokeText("引張(間延びしている)", lx, yBot);
      ctx.fillText("引張(間延びしている)", lx, yBot);
    }
  }

  const fieldToggle = host.controls.toggle({
    id: "show-field",
    label: "体積ひずみを表示",
    value: false,
  });
  fieldToggle.onChange((v) => {
    showField = v;
    host.requestRender();
  });

  const exagSlider = host.controls.slider({
    id: "exaggeration",
    label: "変位の誇張",
    min: EXAG_MIN,
    max: EXAG_MAX,
    step: EXAG_STEP,
    value: EXAG_INIT,
    format: (v) => `×${v.toFixed(1)}`,
  });
  exagSlider.onChange((v) => {
    exaggeration = v;
    host.requestRender();
  });

  host.onRender(draw);

  return {
    destroy(): void {
      /* イベントリスナーなし */
    },
  };
}
