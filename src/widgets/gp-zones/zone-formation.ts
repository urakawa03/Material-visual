/**
 * zone-formation.ts — 図4「GP ゾーンの誕生」(記事仕様書 07 §5.4・本記事の中心図版)
 *
 * 焼入れで凍結された過飽和の Cu(--mat-solute)が、同じく凍結された過剰空孔の
 * 助けを借りて動き、{100} 面上に板状に集まっていく。3 原子以上に育った
 * クラスタは **--mat-precip へ色が変わる** — 「ばらばらの溶質」と「集まって
 * 別の相になったもの」の違いを、色そのもので示す(§5.0 の色の約束)。
 *
 * モデルは lib/zones.ts(空孔機構の格子気体 + メトロポリス法)。
 *
 * 画面上の進み方は、跳躍頻度 c_v·Γ(T) を「焼入れまま・20 °C」で規格化した
 * 比で決める。空孔を平衡濃度に落とすと比が 10⁻⁷ 程度になり、室温では画面上
 * ほぼ完全に止まる — 過剰空孔がなければ室温時効は起きない(§5.3 の回収)。
 * 経過時間は `secondsPerSweep` による実時間換算で読み出す。
 *
 * 簡略化(図注): 2D 単純格子・原子数の大幅な削減・溶質の割合は見やすさのため
 * 実際(Al–4 wt% Cu ≈ 1.7 at%)より高い。描画している空孔の個数は模式で、
 * 実際の濃度は時間換算に反映してある。実際の GP ゾーンは 3 次元の {100} 板。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { clamp } from "../../core/mathx";
import { KELVIN, formatDuration, vacancyEq } from "./lib/constants";
import {
  SITE_SOLUTE,
  SITE_VACANCY,
  ZONE_MIN_ATOMS,
  ZoneLattice,
  type ZoneParams,
  jumpRate,
  secondsPerSweep,
} from "./lib/zones";
import {
  type Pane,
  drawReadouts,
  font,
  resolvePalette,
  vacancy,
} from "./lib/draw";

/** 格子の寸法と原子数 */
const COLS = 56;
const ROWS = 34;
const N_SOLUTE = 130;
const N_VAC = 8;
const SEED = 40129;

/** 焼入れで凍結された空孔濃度(図3 の急冷で得られる程度) */
const CV_QUENCHED = 1.7e-5;
/** 基準条件(焼入れまま・20 °C)での 1 秒あたりのスイープ数 */
const SWEEPS_PER_SEC_REF = 8000;
/** 画面上の進み方の上限倍率(高温で CPU を使い切らないための上限) */
const MAX_SPEEDUP = 8;
/** 1 フレームで実行するスイープ数の上限 */
const MAX_SWEEPS_PER_FRAME = 2400;
/** クラスタを数え直すスイープ間隔 */
const CLUSTER_EVERY = 400;
/** 「ゾーンができる」とみなすスイープ数(所要時間の見積もり用) */
const SWEEPS_TO_FORM = 150000;

/** 温度スライダー */
const TEMP_MIN = 20;
const TEMP_MAX = 200;
const TEMP_STEP = 5;
const TEMP_INIT = 20;

type VacMode = "quenched" | "equilibrium";

const TAU2 = Math.PI * 2;

export default function zoneFormation(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const c = resolvePalette();

  const lat = new ZoneLattice(COLS, ROWS, N_SOLUTE, N_VAC, SEED);
  const params: ZoneParams = {
    tempK: TEMP_INIT + KELVIN,
    cv: CV_QUENCHED,
    aniso: true,
  };
  let vacMode: VacMode = "quenched";
  /** 経過した実時間 [s] */
  let elapsed = 0;
  let sinceCluster = 0;
  /** スイープの端数(1 フレームで 1 回未満のときのため) */
  let sweepAcc = 0;

  /** 基準条件の跳躍頻度(画面上の進み方の規格化に使う) */
  const rateRef = CV_QUENCHED * jumpRate(TEMP_INIT + KELVIN);
  const rateNow = (): number => params.cv * jumpRate(params.tempK);

  function resetAll(): void {
    lat.reset();
    elapsed = 0;
    sinceCluster = 0;
    sweepAcc = 0;
  }

  /* ---- 操作部品(§7.2) ---- */

  const tempSlider = host.controls.slider({
    id: "T",
    label: "温度",
    min: TEMP_MIN,
    max: TEMP_MAX,
    step: TEMP_STEP,
    value: TEMP_INIT,
    unit: "°C",
  });
  tempSlider.onChange((v) => {
    params.tempK = v + KELVIN;
    if (vacMode === "equilibrium") params.cv = vacancyEq(params.tempK);
  });

  const vacSeg = host.controls.segmented<VacMode>({
    id: "vac",
    label: "空孔",
    options: [
      { value: "quenched", label: "焼入れまま(過剰)" },
      { value: "equilibrium", label: "平衡" },
    ],
    value: "quenched",
  });
  vacSeg.onChange((v) => {
    vacMode = v;
    params.cv = v === "quenched" ? CV_QUENCHED : vacancyEq(params.tempK);
  });

  const anisoToggle = host.controls.toggle({
    id: "aniso",
    label: "{100} 面上に並ぶ",
    value: true,
  });
  anisoToggle.onChange((v) => {
    params.aniso = v;
  });

  host.controls.playPause();
  host.controls.reset(() => {
    tempSlider.set(TEMP_INIT);
    vacSeg.set("quenched");
    anisoToggle.set(true);
    params.cv = CV_QUENCHED;
    params.aniso = true;
    resetAll();
    host.setPlaying(true);
  });

  /* ---- 更新 ---- */

  function update(dt: number): void {
    const speed = clamp(rateNow() / rateRef, 0, MAX_SPEEDUP);
    sweepAcc += SWEEPS_PER_SEC_REF * speed * dt;
    let n = Math.floor(sweepAcc);
    if (n <= 0) return;
    sweepAcc -= n;
    if (n > MAX_SWEEPS_PER_FRAME) {
      sweepAcc = 0;
      n = MAX_SWEEPS_PER_FRAME;
    }
    const dtReal = secondsPerSweep(lat.sites, N_VAC, params);
    for (let i = 0; i < n; i++) lat.sweep(params);
    elapsed += n * dtReal;
    sinceCluster += n;
    if (sinceCluster >= CLUSTER_EVERY) {
      sinceCluster = 0;
      lat.updateClusters();
    }
  }

  /* ---- レイアウト ---- */

  function layout(): { field: Pane; side: Pane; narrow: boolean } {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    const strip = narrow ? 34 : 24;
    const top = pad + strip;
    const sideW = narrow ? 96 : 150;
    return {
      field: { x: pad, y: top, w: w - pad * 2 - sideW - 8, h: h - top - pad },
      side: {
        x: w - pad - sideW,
        y: top,
        w: sideW,
        h: h - top - pad,
      },
      narrow,
    };
  }

  /* ---- 描画 ---- */

  function drawField(p: Pane): void {
    ctx.strokeStyle = c.hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    const s = Math.min((p.w - 10) / COLS, (p.h - 10) / ROWS);
    const ox = p.x + (p.w - s * COLS) / 2 + s / 2;
    const oy = p.y + (p.h - s * ROWS) / 2 + s / 2;
    const rMatrix = s * 0.16;
    const rSolute = s * 0.34;

    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
    ctx.clip();

    // 母相の格子(小さな点。1 パスでまとめ描き — 母体仕様 §8.3)
    ctx.beginPath();
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        const k = j * COLS + i;
        if (lat.site[k] !== 0) continue;
        const x = ox + i * s;
        const y = oy + j * s;
        ctx.moveTo(x + rMatrix, y);
        ctx.arc(x, y, rMatrix, 0, TAU2);
      }
    }
    ctx.fillStyle = c.matrix;
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;

    // ゾーン(3 原子以上のクラスタ)の帯を薄く敷く
    const boxes = zoneBoxes();
    ctx.fillStyle = c.precip;
    ctx.globalAlpha = 0.16;
    for (const b of boxes) {
      const x0 = ox + b[0] * s - rSolute * 1.5;
      const y0 = oy + b[1] * s - rSolute * 1.5;
      const w0 = (b[2] - b[0]) * s + rSolute * 3;
      const h0 = (b[3] - b[1]) * s + rSolute * 3;
      ctx.beginPath();
      ctx.roundRect(x0, y0, w0, h0, rSolute);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 溶質原子: 単独 = solute 色、ゾーンに入ったもの = precip 色(1 パスずつ)
    for (const inZone of [false, true]) {
      ctx.beginPath();
      for (let k = 0; k < lat.sites; k++) {
        if (lat.site[k] !== SITE_SOLUTE) continue;
        const big = lat.clusterSize(lat.cluster[k]) >= ZONE_MIN_ATOMS;
        if (big !== inZone) continue;
        const x = ox + (k % COLS) * s;
        const y = oy + ((k / COLS) | 0) * s;
        ctx.moveTo(x + rSolute, y);
        ctx.arc(x, y, rSolute, 0, TAU2);
      }
      ctx.fillStyle = inZone ? c.precip : c.solute;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = inZone ? c.precipEdge : c.soluteEdge;
      ctx.stroke();
    }

    // 空孔(塗りなし + 破線縁)
    for (let k = 0; k < lat.sites; k++) {
      if (lat.site[k] !== SITE_VACANCY) continue;
      vacancy(
        ctx,
        ox + (k % COLS) * s,
        oy + ((k / COLS) | 0) * s,
        rSolute * 0.85,
        c.matrixEdge,
      );
    }
    ctx.restore();
  }

  /** ゾーンの外接矩形(格子座標)。周期境界をまたぐものは描かない */
  function zoneBoxes(): number[][] {
    const map = new Map<number, number[]>();
    for (let k = 0; k < lat.sites; k++) {
      if (lat.site[k] !== SITE_SOLUTE) continue;
      const id = lat.cluster[k];
      if (id < 0 || lat.clusterSize(id) < ZONE_MIN_ATOMS) continue;
      const x = k % COLS;
      const y = (k / COLS) | 0;
      const b = map.get(id);
      if (!b) map.set(id, [x, y, x, y]);
      else {
        b[0] = Math.min(b[0], x);
        b[1] = Math.min(b[1], y);
        b[2] = Math.max(b[2], x);
        b[3] = Math.max(b[3], y);
      }
    }
    const out: number[][] = [];
    for (const b of map.values()) {
      if (b[2] - b[0] > COLS / 2 || b[3] - b[1] > ROWS / 2) continue;
      out.push(b);
    }
    return out;
  }

  /** 右側: クラスタサイズの分布と所要時間の見積もり */
  function drawSide(p: Pane, narrow: boolean): void {
    const st = lat.stats();
    ctx.font = font(narrow ? 10 : 11);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = c.text2;
    ctx.fillText("クラスタの内訳", p.x, p.y);

    const labels = ["1 個(固溶)", "2〜4 個", "5 個以上"];
    const colors = [c.solute, c.precip, c.precip];
    const barY = p.y + 18;
    const barH = narrow ? 12 : 14;
    const gap = narrow ? 22 : 26;
    for (let i = 0; i < 3; i++) {
      const y = barY + i * gap;
      const frac = st.histogram[i] / N_SOLUTE;
      ctx.fillStyle = c.text2;
      ctx.font = font(narrow ? 9.5 : 10.5);
      ctx.fillText(labels[i], p.x, y);
      ctx.fillStyle = colors[i];
      ctx.globalAlpha = i === 0 ? 0.9 : 0.55 + 0.35 * (i - 1);
      ctx.fillRect(p.x, y + 12, Math.max(frac * p.w, 1), barH * 0.5);
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.text;
      ctx.font = font(narrow ? 9.5 : 10.5);
      ctx.textAlign = "right";
      ctx.fillText(String(st.histogram[i]), p.x + p.w, y);
      ctx.textAlign = "left";
    }

    const infoY = barY + 3 * gap + 6;
    ctx.fillStyle = c.text2;
    ctx.font = font(narrow ? 9.5 : 10.5);
    ctx.fillText("ゾーンができるまで", p.x, infoY);
    const est = secondsPerSweep(lat.sites, N_VAC, params) * SWEEPS_TO_FORM;
    ctx.fillStyle = est > 3.2e7 ? c.soluteEdge : c.text;
    ctx.font = font(narrow ? 11 : 12.5, 600);
    ctx.fillText(formatDuration(est), p.x, infoY + 14);
    if (vacMode === "equilibrium") {
      ctx.fillStyle = c.text2;
      ctx.font = font(narrow ? 9 : 10);
      ctx.fillText("(平衡空孔だけでは", p.x, infoY + 32);
      ctx.fillText("室温では動けない)", p.x, infoY + 44);
    }
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const l = layout();
    const st = lat.stats();
    drawReadouts(
      ctx,
      [
        [`経過 ${formatDuration(elapsed)}`, c.text],
        [`ゾーン ${st.zoneCount} 個`, c.precipEdge],
        [`最大 ${st.maxZone} 原子`, c.precipEdge],
        [
          `ゾーン外 ${Math.round((1 - st.clusteredFraction) * 100)} %`,
          c.soluteEdge,
        ],
      ],
      l.narrow ? 8 : 12,
      l.narrow ? 6 : 8,
      w - 8,
      l.narrow,
    );
    drawField(l.field);
    drawSide(l.side, l.narrow);
  }

  host.onFrame((dt) => {
    update(dt);
    draw();
  });
  host.onRender(draw);

  return {
    destroy(): void {
      // 追加のイベントリスナーは持たない
    },
  };
}
