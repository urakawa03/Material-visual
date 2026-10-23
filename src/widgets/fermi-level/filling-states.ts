/**
 * filling-states.ts — 図1「下から詰める」(仕様書 12 §5.1)
 *
 * 「席のはしご」。1 つの準位にはスピンの向きが逆の 2 席(左 = ↑、右 = ↓)が
 * あり、電子は下の席から順に入る(パウリの排他律・T = 0 の基底状態)。
 * 最後に埋まった席と最初の空席の中間に E_F の印が付く。隙間のある材料で
 * 下の帯をちょうど埋めきると、E_F は席が 1 つもない禁制帯の中央に跳ぶ —
 * 「席がないところに E_F がある」という違和感を次節以降で回収する。
 *
 * 簡略化(図注に明示): 準位は説明のために離散的に描いた(実際の結晶では
 * 事実上連続)。
 *
 * 実装方式: 2D Canvas / requestRender(操作時のみ再描画)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import {
  createPlotMapper,
  drawBandBox,
  drawElectronDots,
  drawGapMarks,
  drawPlotFrame,
  setPlotRange,
  type AxisTick,
} from "../_shared/banddiagram";
import {
  fillLadder,
  ladderBands,
  ladderLevels,
  SEATS_PER_LEVEL,
  type LadderMaterial,
} from "./lib/ladder";
import { drawFermiLine, drawLabel, fermiColors } from "./lib/draw";
import { formatEvFixed } from "./lib/format";

/** 縦軸の範囲 [eV] */
const E_MIN = 0;
const E_MAX = 6;
/** 余白(px) */
const MARGIN_LEFT = 56;
const MARGIN_RIGHT = 14;
const MARGIN_TOP = 28;
const MARGIN_BOTTOM = 16;
const NARROW_WIDTH_PX = 480;
/** 電子の数スライダー(§5.1 の表) */
const ELECTRONS_MAX = 48;
const ELECTRONS_INIT = 18;
const MATERIAL_INIT: LadderMaterial = "gapless";
/** 隙間ありの禁制帯 [eV] */
const GAP_LOW = 2.4;
const GAP_HIGH = 3.6;

const Y_TICKS: readonly AxisTick[] = [0, 1, 2, 3, 4, 5, 6].map((v) => ({
  value: v,
  label: String(v),
}));

export default function fillingStates(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const colors = fermiColors();
  const mapper = createPlotMapper();

  /* ---- 状態 ---- */
  let material: LadderMaterial = MATERIAL_INIT;
  let electrons = ELECTRONS_INIT;

  /* ---- 使い回すバッファ(席は最大 48) ---- */
  const seatCount = 24 * SEATS_PER_LEVEL;
  const fullX = new Float64Array(seatCount);
  const fullY = new Float64Array(seatCount);
  const emptyX = new Float64Array(seatCount);
  const emptyY = new Float64Array(seatCount);

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const narrow = w < NARROW_WIDTH_PX;
    const plotW = w - MARGIN_LEFT - MARGIN_RIGHT;
    const plotH = h - MARGIN_TOP - MARGIN_BOTTOM;
    // 横は「プロット左端からの px」をそのまま値にする(はしごの幅を px で決めるため)
    setPlotRange(
      mapper,
      MARGIN_LEFT,
      MARGIN_TOP,
      plotW,
      plotH,
      0,
      plotW,
      E_MIN,
      E_MAX,
    );
    drawPlotFrame(ctx, mapper, {
      colors,
      yTicks: Y_TICKS,
      yLabel: "エネルギー E [eV]",
    });

    const levels = ladderLevels(material);
    const filling = fillLadder(levels, electrons);

    // はしごの寸法(px)
    const seatGap = narrow ? 14 : 18;
    const radius = narrow ? 4.2 : 5;
    const barHalf = seatGap / 2 + (narrow ? 11 : 15);
    const xc = Math.round(plotW * (narrow ? 0.38 : 0.34));
    const xUp = xc - seatGap / 2;
    const xDown = xc + seatGap / 2;

    // 帯(許容帯)の薄い塗り — 準位はこの帯を離散化したもの
    for (const band of ladderBands(material)) {
      drawBandBox(
        ctx,
        mapper,
        xc - barHalf - 8,
        xc + barHalf + 8,
        band.low,
        band.high,
        { colors, edges: false },
      );
    }

    // 準位の横棒
    ctx.save();
    ctx.strokeStyle = colors.level;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const level of levels) {
      const py = mapper.toPxY(level.e);
      ctx.moveTo(mapper.toPxX(xc - barHalf), py);
      ctx.lineTo(mapper.toPxX(xc + barHalf), py);
    }
    ctx.stroke();
    ctx.restore();

    // 席(埋まった席 = 塗り丸、空いた席 = 中抜き)
    let nFull = 0;
    let nEmpty = 0;
    for (let i = 0; i < levels.length; i++) {
      for (let s = 0; s < SEATS_PER_LEVEL; s++) {
        const seat = i * SEATS_PER_LEVEL + s;
        const x = s === 0 ? xUp : xDown;
        if (seat < electrons) {
          fullX[nFull] = x;
          fullY[nFull] = levels[i].e;
          nFull++;
        } else {
          emptyX[nEmpty] = x;
          emptyY[nEmpty] = levels[i].e;
          nEmpty++;
        }
      }
    }
    drawElectronDots(ctx, mapper, emptyX, emptyY, nEmpty, {
      colors,
      radius,
      empty: true,
    });
    drawElectronDots(ctx, mapper, fullX, fullY, nFull, { colors, radius });

    // スピンの向き(列の見出し)
    drawLabel(
      ctx,
      "↑",
      mapper.toPxX(xUp),
      MARGIN_TOP - 12,
      colors.text2,
      "center",
    );
    drawLabel(
      ctx,
      "↓",
      mapper.toPxX(xDown),
      MARGIN_TOP - 12,
      colors.text2,
      "center",
    );
    drawLabel(
      ctx,
      "スピン",
      mapper.toPxX(xc + barHalf + 6),
      MARGIN_TOP - 12,
      colors.text2,
      "left",
    );

    // 右側: 帯と禁制帯の名前
    const xr = xc + barHalf + 28;
    if (material === "gapped") {
      drawGapMarks(ctx, mapper, xr, xr + 22, GAP_LOW, GAP_HIGH, {
        colors,
        measure: true,
      });
      drawLabel(
        ctx,
        "禁制帯 1.2 eV",
        mapper.toPxX(xr + 30),
        mapper.toPxY((GAP_LOW + GAP_HIGH) / 2),
        colors.text2,
      );
      drawLabel(
        ctx,
        "許容帯",
        mapper.toPxX(xr + 30),
        mapper.toPxY(1.3),
        colors.text2,
      );
      drawLabel(
        ctx,
        "許容帯",
        mapper.toPxX(xr + 30),
        mapper.toPxY(4.7),
        colors.text2,
      );
    } else {
      drawLabel(
        ctx,
        "許容帯(隙間なし)",
        mapper.toPxX(xr),
        mapper.toPxY(3),
        colors.text2,
      );
    }

    // フェルミ準位(定まらない両端では描かない)
    if (Number.isFinite(filling.eF)) {
      drawFermiLine(
        ctx,
        mapper,
        xc - barHalf - 40,
        xc + barHalf + 10,
        filling.eF,
        colors,
      );
    }

    // 読み取り値
    lastItem.set(
      Number.isFinite(filling.lastFilled)
        ? formatEvFixed(filling.lastFilled, 2)
        : "—",
    );
    emptyItem.set(
      Number.isFinite(filling.firstEmpty)
        ? formatEvFixed(filling.firstEmpty, 2)
        : "—",
    );
    efItem.set(
      Number.isFinite(filling.eF)
        ? formatEvFixed(filling.eF, 2)
        : "—(定まらない)",
    );
    seatItem.set(
      filling.seatAtEF === null
        ? "—"
        : filling.seatAtEF
          ? "ある"
          : "ない(禁制帯の中)",
    );
  }

  /* ---- 操作部品 ---- */
  const readout = createReadout(host);
  const lastItem = readout.item("最後に埋まった席");
  const emptyItem = readout.item("最初の空席");
  const efItem = readout.item("E_F(T = 0)", { color: "electron" });
  const seatItem = readout.item("E_F の高さに席が");

  const materialSeg = host.controls.segmented<LadderMaterial>({
    id: "material",
    label: "材料",
    options: [
      { value: "gapless", label: "隙間なし" },
      { value: "gapped", label: "隙間あり" },
    ],
    value: MATERIAL_INIT,
  });
  materialSeg.onChange((v) => {
    material = v;
  });

  const electronSlider = host.controls.slider({
    id: "electrons",
    label: "電子の数",
    min: 0,
    max: ELECTRONS_MAX,
    step: 1,
    value: ELECTRONS_INIT,
    unit: "個",
  });
  electronSlider.onChange((v) => {
    electrons = Math.round(v);
  });

  host.controls.reset(() => {
    materialSeg.set(MATERIAL_INIT);
    electronSlider.set(ELECTRONS_INIT);
    material = MATERIAL_INIT;
    electrons = ELECTRONS_INIT;
  });

  host.onRender(draw);

  return {
    destroy(): void {
      readout.el.remove();
    },
  };
}
