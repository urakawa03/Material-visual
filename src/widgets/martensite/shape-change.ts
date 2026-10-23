/**
 * shape-change.ts — 図5「表面起伏と自己調整」(記事仕様書 10 §5.5)
 *
 * 断面図。上端の線が研磨した平らな表面で、その下が母相(オーステナイト)。
 * 「変態させる」で、表面から斜めに入るマルテンサイトの板ができ、せん断で
 * 形が変わる。母相と板はどちらも鉄なので同じ色(--mat-matrix)で塗り、内部の
 * 格子線のハッチの傾きで区別する(§2.3・付録 A-4)。
 *
 * - バリアント 1 種類: 1 枚の板がせん断(γ)で傾き、表面に段差ができる。
 *   板の先端のまわりにひずみの場(--mat-tension / --mat-compression)が広がる。
 * - 交互(自己調整): 向きの違う薄い板が交互に並び、せん断が打ち消し合う。
 *   表面は小さなジグザグになり、ひずみの場は板の近くに限られる。板どうしの
 *   境界(双晶境界)は --mat-defect の線。
 *
 * 模式(図注に明示): 変位は「板の中は層を横切るにつれて γ ずつずれ、
 * 板の外では母相の拘束でずれが指数関数的に戻る」という簡単な場。ひずみの
 * 場の塗りは、板の先端を、ずれの合計を強さとする刃状転位とみなした
 * sinθ/r 型の場の重ね合わせ。数値は lib/shape.ts(全体のせん断・起伏・
 * ひずみエネルギー)。
 *
 * 実装方式: 2D / requestRender + tween(1.2 秒)。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { tween, type Tween } from "../../core/anim";
import { clamp } from "../../core/mathx";
import { createReadout } from "../reciprocal-lattice/_shared2d";
import { parseRgb } from "../cottrell-atmosphere/lib/lattice";
import { PLATE_SHEAR } from "./lib/constants";
import {
  type Arrangement,
  type PlateStack,
  netOffset,
  overallShear,
  plateStack,
  strainEnergyRel,
  surfaceReliefRatio,
} from "./lib/shape";
import {
  MIN_CANVAS_PX,
  type Pane,
  context2d,
  fmtPercent,
  font,
  plateText,
  resolvePalette,
} from "./lib/draw";

/** 断面の大きさ(模式の単位) */
const REGION_W = 12;
const REGION_H = 9.2;
/** 表面より上に空けておく高さ(起伏とラベルのため) */
const HEADROOM = 1.1;
/** 晶癖面(板の面)と表面のなす角 [度] */
const HABIT_DEG = 60;
/** 変態した層の厚さ d と、表面からの板の長さ(晶癖面に沿って) */
const LAYER_D = 1.6;
const PLATE_LEN = 7.4;
/** 表面で板が始まる位置 */
const PLATE_U0 = 3.4;
/** 母相の拘束でずれが戻る長さ */
const RELAX_LEN = 1.4;
/** 先端のひずみの場の芯の大きさ(発散を避ける) */
const FIELD_CORE = 0.35;
/** ひずみの場の塗りの最大不透明度と、塗りのセルの大きさ */
const FIELD_ALPHA_MAX = 0.42;
const FIELD_CELL = 0.12;
/** 格子線(ハッチ)の間隔と、板の中の格子線の傾き [度] */
const MATRIX_HATCH = 0.42;
const PLATE_HATCH_SINGLE = 0.3;
const PLATE_HATCH_ALT = 0.13;
const PLATE_LATTICE_DEG = 35;
/** 線を折れ線にするときの刻み(模式の単位) */
const LINE_STEP = 0.08;
/** 変態のアニメーションの長さ [ms](§5.5: 1.2 秒) */
const TRANSFORM_MS = 1200;
/** 初期状態(§5.5: 1 種類・変態前) */
const ARR_INIT: Arrangement = "single";

const RAD = Math.PI / 180;
const SIN_H = Math.sin(HABIT_DEG * RAD);
const COS_H = Math.cos(HABIT_DEG * RAD);
/** 板に沿って表面から下へ向かう向き t̂ と、層を横切る向き n̂ */
const TX = COS_H;
const TY = -SIN_H;
const NX = SIN_H;
const NY = COS_H;
/** せん断のずれの向き(晶癖面に沿って上向き = 表面が盛り上がる向き) */
const SX = -TX;
const SY = -TY;
/** 変態した部分が断面に占める割合(全体のせん断の計算用) */
const LAYER_FRACTION = (LAYER_D * PLATE_LEN) / (REGION_W * REGION_H);

export default function shapeChange(host: FigureHost): WidgetHandle {
  const ctx = context2d(host.canvas);
  const pal = resolvePalette();
  const tensionRgb = parseRgb(pal.tension);
  const compressionRgb = parseRgb(pal.compression);

  /* ---- 状態 ---- */
  let arrangement: Arrangement = ARR_INIT;
  let stack: PlateStack = plateStack(ARR_INIT);
  /** 変態の進み具合(0 = 変態前、1 = 変態後) */
  let progress = 0;
  let activeTween: Tween | null = null;

  /** 層を横切る座標 q での累積のずれ U(q)(層の厚さ d 単位ではなく模式の単位) */
  function offsetAt(q: number): number {
    const w = LAYER_D / stack.n;
    let u = 0;
    for (let i = 0; i < stack.n; i++) {
      u += stack.shears[i] * clamp(q - i * w, 0, w);
    }
    return u;
  }

  /** 点 (x, y) の変位(模式の単位)を out に書く。y は上向き、表面が y = 0 */
  function displacement(
    x: number,
    y: number,
    out: { x: number; y: number },
  ): void {
    const rx = x - PLATE_U0;
    const ry = y;
    const s = rx * TX + ry * TY; // 板に沿った深さ
    const q = rx * NX + ry * NY; // 層を横切る座標
    let mag = 0;
    if (q >= 0 && s >= -2) {
      mag =
        q <= LAYER_D
          ? offsetAt(q)
          : offsetAt(LAYER_D) * Math.exp(-(q - LAYER_D) / RELAX_LEN);
      if (s > PLATE_LEN) mag *= Math.exp(-(s - PLATE_LEN) / RELAX_LEN);
    }
    out.x = progress * mag * SX;
    out.y = progress * mag * SY;
  }

  /* ---- 読み取り値(§5.5) ---- */
  const readout = createReadout(host);
  const rRelief = readout.item("表面の最大の起伏(変態した層の厚さに対する比)");
  const rShear = readout.item("全体のせん断ひずみ");
  const rEnergy = readout.item("たまったひずみエネルギー(相対)");

  function updateReadouts(): void {
    rRelief.set(fmtPercent(progress * surfaceReliefRatio(stack, SIN_H)));
    rShear.set(
      fmtPercent(Math.abs(progress * overallShear(stack, LAYER_FRACTION))),
    );
    rEnergy.set((progress * progress * strainEnergyRel(stack)).toFixed(2));
  }

  /* ---- 操作部品(§5.5) ---- */
  const seg = host.controls.segmented<Arrangement>({
    id: "arr",
    label: "並び方",
    options: [
      { value: "single", label: "1 種類" },
      { value: "alternating", label: "交互(自己調整)" },
    ],
    value: ARR_INIT,
  });
  seg.onChange((v) => {
    arrangement = v;
    stack = plateStack(v);
    updateReadouts();
    host.requestRender();
  });

  const goBtn = host.controls.button({ label: "変態させる" });
  goBtn.onClick(() => {
    activeTween?.cancel();
    progress = 0;
    activeTween = tween(
      0,
      1,
      TRANSFORM_MS,
      (v) => {
        progress = v;
        updateReadouts();
        host.requestRender();
      },
      () => {
        activeTween = null;
      },
    );
  });

  host.controls.reset(() => {
    activeTween?.cancel();
    activeTween = null;
    seg.set(ARR_INIT);
    arrangement = ARR_INIT;
    stack = plateStack(ARR_INIT);
    progress = 0;
    updateReadouts();
  });

  /* ---- レイアウトと座標 ---- */

  interface View {
    ox: number;
    oy: number;
    scale: number;
  }

  function layout(): { section: Pane; bars: Pane; narrow: boolean } {
    const { w, h } = host.size;
    const narrow = w < 560;
    const pad = narrow ? 8 : 12;
    if (narrow) {
      const sh = Math.round((h - 3 * pad) * 0.66);
      return {
        section: { x: pad, y: pad, w: w - 2 * pad, h: sh },
        bars: { x: pad, y: 2 * pad + sh, w: w - 2 * pad, h: h - 3 * pad - sh },
        narrow,
      };
    }
    const sw = Math.round((w - 3 * pad) * 0.7);
    return {
      section: { x: pad, y: pad, w: sw, h: h - 2 * pad },
      bars: { x: 2 * pad + sw, y: pad, w: w - 3 * pad - sw, h: h - 2 * pad },
      narrow,
    };
  }

  function makeView(p: Pane, narrow: boolean): View {
    const labelH = narrow ? 18 : 22;
    const scale = Math.min(
      p.w / REGION_W,
      (p.h - labelH) / (REGION_H + HEADROOM),
    );
    const ox = p.x + (p.w - REGION_W * scale) / 2;
    const oy = p.y + labelH + HEADROOM * scale;
    return { ox, oy, scale };
  }

  const tmp = { x: 0, y: 0 };
  /** 模式の座標(変形前)→ 画面座標(変位を足す) */
  function toScreen(
    v: View,
    x: number,
    y: number,
    out: { x: number; y: number },
  ): void {
    displacement(x, y, tmp);
    out.x = v.ox + (x + tmp.x) * v.scale;
    out.y = v.oy - (y + tmp.y) * v.scale;
  }

  const sp = { x: 0, y: 0 };

  /** 変形前の線分 (x0,y0)→(x1,y1) を、変位に沿わせた折れ線として描く */
  function deformedLine(
    v: View,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(len / LINE_STEP));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      toScreen(v, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, sp);
      if (k === 0) ctx.moveTo(sp.x, sp.y);
      else ctx.lineTo(sp.x, sp.y);
    }
  }

  /**
   * 板 i の四隅(変形前)。板は「表面 y ≤ 0」「層を横切る座標 q₀ ≤ q ≤ q₁」
   * 「板に沿った深さ s ≤ PLATE_LEN」で囲まれた平行四辺形。
   * 順に、表面側の 2 点(q 一定の直線が y = 0 と交わる点)→ 先端側の 2 点。
   */
  function plateCorners(i: number): Array<[number, number]> {
    const w = LAYER_D / stack.n;
    const q0 = i * w;
    const q1 = (i + 1) * w;
    const surf = (q: number): [number, number] => [PLATE_U0 + q / NX, 0];
    // r = s t̂ + q n̂(原点は表面上の (PLATE_U0, 0))
    const tip = (q: number): [number, number] => [
      PLATE_U0 + PLATE_LEN * TX + q * NX,
      PLATE_LEN * TY + q * NY,
    ];
    return [surf(q0), surf(q1), tip(q1), tip(q0)];
  }

  /**
   * 直線 B + t·D(|D| = 1、−R ≤ t ≤ R)を板 i の平行四辺形で切った区間 [t₀, t₁]
   * (サイラス・ベック法)。交わらなければ null。
   */
  function clipToPlate(
    i: number,
    bx: number,
    by: number,
    dx: number,
    dy: number,
    R: number,
  ): [number, number] | null {
    const w = LAYER_D / stack.n;
    let t0 = -R;
    let t1 = R;
    // 半平面 a·P ≤ c の形の 4 本: y ≤ 0、−q ≤ −q₀、q ≤ q₁、s ≤ L
    const rx = bx - PLATE_U0;
    const planes: ReadonlyArray<readonly [number, number, number]> = [
      [0, 1, 0],
      [-NX, -NY, -i * w],
      [NX, NY, (i + 1) * w],
      [TX, TY, PLATE_LEN],
    ];
    for (const [ax, ay, c] of planes) {
      const num = c - (ax * rx + ay * by);
      const den = ax * dx + ay * dy;
      if (Math.abs(den) < 1e-12) {
        if (num < 0) return null;
        continue;
      }
      const t = num / den;
      if (den > 0) t1 = Math.min(t1, t);
      else t0 = Math.max(t0, t);
      if (t0 >= t1) return null;
    }
    return [t0, t1];
  }

  /** 板の多角形のパス(変形後)を作る */
  function platePath(v: View, i: number): void {
    const c = plateCorners(i);
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = c[k];
      const [bx, by] = c[(k + 1) % 4];
      const len = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.ceil(len / LINE_STEP));
      for (let m = 0; m < n; m++) {
        const t = m / n;
        toScreen(v, ax + (bx - ax) * t, ay + (by - ay) * t, sp);
        if (k === 0 && m === 0) ctx.moveTo(sp.x, sp.y);
        else ctx.lineTo(sp.x, sp.y);
      }
    }
    ctx.closePath();
  }

  /** 断面の外形(変形後の表面 + 左右と底)のパス */
  function sectionPath(v: View): void {
    ctx.beginPath();
    const n = Math.ceil(REGION_W / LINE_STEP);
    for (let k = 0; k <= n; k++) {
      toScreen(v, (REGION_W * k) / n, 0, sp);
      if (k === 0) ctx.moveTo(sp.x, sp.y);
      else ctx.lineTo(sp.x, sp.y);
    }
    ctx.lineTo(v.ox + REGION_W * v.scale, v.oy + REGION_H * v.scale);
    ctx.lineTo(v.ox, v.oy + REGION_H * v.scale);
    ctx.closePath();
  }

  /* ---- 描画 ---- */

  function drawField(v: View): void {
    if (progress <= 0) return;
    // 板の先端を刃状転位とみなした場の重ね合わせ(強さ = 各板のずれ)
    const w = LAYER_D / stack.n;
    const nx = Math.ceil(REGION_W / FIELD_CELL);
    const ny = Math.ceil(REGION_H / FIELD_CELL);
    const px = FIELD_CELL * v.scale + 0.5;
    for (let j = 0; j < ny; j++) {
      const y = -(j + 0.5) * FIELD_CELL;
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * FIELD_CELL;
        let pr = 0;
        for (let k = 0; k < stack.n; k++) {
          const b = progress * stack.shears[k] * w;
          const ex = PLATE_U0 + PLATE_LEN * TX + (k + 0.5) * w * NX;
          const ey = PLATE_LEN * TY + (k + 0.5) * w * NY;
          const dx = x - ex;
          const dy = y - ey;
          // 晶癖面の法線方向の成分 / r²(sinθ/r 型)
          pr +=
            (b * (dx * NX + dy * NY)) /
            (dx * dx + dy * dy + FIELD_CORE * FIELD_CORE);
        }
        const a =
          Math.min(Math.abs(pr) / (PLATE_SHEAR * LAYER_D * 0.9), 1) *
          FIELD_ALPHA_MAX;
        if (a < 0.02) continue;
        const [r, g, bl] = pr > 0 ? compressionRgb : tensionRgb;
        ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${a.toFixed(3)})`;
        ctx.fillRect(
          v.ox + i * FIELD_CELL * v.scale,
          v.oy + j * FIELD_CELL * v.scale,
          px,
          px,
        );
      }
    }
  }

  function drawSection(p: Pane, narrow: boolean): void {
    const fs = narrow ? 10 : 11;
    const v = makeView(p, narrow);
    const right = v.ox + REGION_W * v.scale;
    const bottom = v.oy + REGION_H * v.scale;

    // 母相の塗り(表面の変形に沿った外形)
    sectionPath(v);
    ctx.fillStyle = pal.matrix;
    ctx.globalAlpha = 0.16;
    ctx.fill();
    ctx.globalAlpha = 1;

    // ひずみの場(断面の中だけ)
    ctx.save();
    sectionPath(v);
    ctx.clip();
    drawField(v);

    // 母相の格子線(表面に平行な線。変位に沿って曲がる)。板の中は描かない
    ctx.save();
    if (progress > 0) {
      // 板の外側だけに描く(evenodd でくり抜く)
      ctx.beginPath();
      ctx.rect(
        v.ox - 10,
        v.oy - HEADROOM * v.scale,
        REGION_W * v.scale + 20,
        (REGION_H + HEADROOM) * v.scale + 10,
      );
      for (let i = 0; i < stack.n; i++) appendPlatePath(v, i);
      ctx.clip("evenodd");
    }
    ctx.beginPath();
    for (let y = -MATRIX_HATCH / 2; y > -REGION_H; y -= MATRIX_HATCH) {
      deformedLine(v, 0, y, REGION_W, y);
    }
    ctx.strokeStyle = pal.matrixEdge;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();

    // マルテンサイトの板(同じ色。格子線の傾きで区別する)
    if (progress > 0) {
      for (let i = 0; i < stack.n; i++) {
        ctx.save();
        platePath(v, i);
        ctx.fillStyle = pal.matrix;
        ctx.globalAlpha = 0.22 * progress;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.clip();
        const sign = stack.shears[i] >= 0 ? 1 : -1;
        const ang = sign * PLATE_LATTICE_DEG * RAD;
        const spacing = stack.n === 1 ? PLATE_HATCH_SINGLE : PLATE_HATCH_ALT;
        // 板の中心を通る向き ang の平行線を、板の多角形で切って描く
        const c = plateCorners(i);
        const cx = (c[0][0] + c[2][0]) / 2;
        const cy = (c[0][1] + c[2][1]) / 2;
        const R = Math.hypot(PLATE_LEN, LAYER_D) / 2 + 1;
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        ctx.beginPath();
        for (let o = -R; o <= R; o += spacing) {
          const bx = cx - dy * o;
          const by = cy + dx * o;
          const seg = clipToPlate(i, bx, by, dx, dy, R);
          if (seg) {
            deformedLine(
              v,
              bx + dx * seg[0],
              by + dy * seg[0],
              bx + dx * seg[1],
              by + dy * seg[1],
            );
          }
        }
        ctx.strokeStyle = pal.matrixEdge;
        ctx.globalAlpha = 0.75 * progress;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
      }
      // 板と母相の境界(text-2)と、板どうしの境界(双晶境界 — --mat-defect)
      const w = LAYER_D / stack.n;
      for (let i = 0; i <= stack.n; i++) {
        const q = i * w;
        const sx0 = PLATE_U0 + q / NX;
        const tx = PLATE_U0 + PLATE_LEN * TX + q * NX;
        const ty = PLATE_LEN * TY + q * NY;
        ctx.beginPath();
        deformedLine(v, sx0, 0, tx, ty);
        const twin = i > 0 && i < stack.n;
        ctx.strokeStyle = twin ? pal.defect : pal.text2;
        ctx.globalAlpha = (twin ? 0.9 : 0.6) * progress;
        ctx.lineWidth = twin ? 1.6 : 1.2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();

    // 元の平らな表面(破線)と、変形した表面
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = pal.text2;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(v.ox, Math.round(v.oy) + 0.5);
    ctx.lineTo(right, Math.round(v.oy) + 0.5);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    deformedLine(v, 0, 0, REGION_W, 0);
    ctx.strokeStyle = pal.text;
    ctx.lineWidth = 2;
    ctx.stroke();
    // 断面の枠(左右と底)
    ctx.strokeStyle = pal.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(v.ox + 0.5, v.oy);
    ctx.lineTo(v.ox + 0.5, bottom + 0.5);
    ctx.lineTo(right - 0.5, bottom + 0.5);
    ctx.lineTo(right - 0.5, v.oy);
    ctx.stroke();

    // ラベル
    ctx.font = font(fs);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(
      progress > 0
        ? arrangement === "single"
          ? "バリアント 1 種類: 表面が傾いて段差ができる"
          : "交互の並び: せん断が打ち消し合い、表面は小さなジグザグ"
        : "研磨した平らな表面(変態前 — 母相のオーステナイトだけ)",
      p.x,
      p.y,
    );
    if (progress > 0) {
      // 起伏の最大の位置に目印
      const relief = progress * surfaceReliefRatio(stack, SIN_H) * LAYER_D;
      const xEnd = PLATE_U0 + LAYER_D / NX;
      toScreen(
        v,
        arrangement === "single" ? xEnd : PLATE_U0 + LAYER_D / NX / stack.n,
        0,
        sp,
      );
      if (relief * v.scale > 3) {
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sp.x + 8, sp.y);
        ctx.lineTo(sp.x + 14, sp.y);
        ctx.moveTo(sp.x + 11, sp.y);
        ctx.lineTo(sp.x + 11, v.oy);
        ctx.moveTo(sp.x + 8, v.oy);
        ctx.lineTo(sp.x + 14, v.oy);
        ctx.stroke();
        plateText(
          ctx,
          pal,
          "表面の起伏",
          sp.x + 18,
          (sp.y + v.oy) / 2,
          pal.accent,
          fs,
          "left",
        );
      }
      ctx.font = font(fs - 1);
      ctx.fillStyle = pal.text2;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(
        arrangement === "single"
          ? "板のまわりにひずみの場が広がる"
          : "ひずみの場は板の先端の近くだけ",
        right - 4,
        bottom - 4,
      );
    }
  }

  /** 板の多角形を、現在のパスに追加する(clip のくり抜き用) */
  function appendPlatePath(v: View, i: number): void {
    const c = plateCorners(i);
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = c[k];
      const [bx, by] = c[(k + 1) % 4];
      const len = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.ceil(len / LINE_STEP));
      for (let m = 0; m < n; m++) {
        const t = m / n;
        toScreen(v, ax + (bx - ax) * t, ay + (by - ay) * t, sp);
        if (k === 0 && m === 0) ctx.moveTo(sp.x, sp.y);
        else ctx.lineTo(sp.x, sp.y);
      }
    }
    ctx.closePath();
  }

  /** 右(狭幅では下): 2 つの並び方のひずみエネルギーとずれの比較 */
  function drawBars(p: Pane, narrow: boolean): void {
    const fs = narrow ? 10 : 11;
    ctx.font = font(fs);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("たまったひずみエネルギー", p.x, p.y);
    ctx.fillText("(相対値。1 種類の変態後 = 1)", p.x, p.y + fs + 4);
    const rows: ReadonlyArray<[Arrangement, string]> = [
      ["single", "1 種類"],
      ["alternating", "交互"],
    ];
    const barX = p.x + (narrow ? 52 : 4);
    const barMax = p.x + p.w - 40 - barX;
    let y = p.y + 2 * fs + 18;
    for (const [arr, label] of rows) {
      const st = plateStack(arr);
      const current = arr === arrangement;
      const e = (current ? progress * progress : 1) * strainEnergyRel(st);
      ctx.font = font(fs, current ? 600 : 400);
      ctx.fillStyle = current ? pal.text : pal.text2;
      ctx.textAlign = "left";
      ctx.textBaseline = narrow ? "middle" : "bottom";
      if (narrow) ctx.fillText(label, p.x, y + 8);
      else ctx.fillText(label, barX, y - 3);
      const bw = Math.max(barMax * e, 1.5);
      ctx.fillStyle = current ? pal.accent : pal.text2;
      ctx.globalAlpha = current ? 0.9 : 0.35;
      ctx.fillRect(barX, y, bw, 16);
      ctx.globalAlpha = 1;
      ctx.font = font(fs - 1);
      ctx.fillStyle = pal.text;
      ctx.textBaseline = "middle";
      ctx.fillText(e.toFixed(2), barX + bw + 6, y + 8);
      y += narrow ? 26 : 50;
    }
    // ずれの打ち消し合いの一言
    const net = netOffset(stack);
    ctx.font = font(fs - 1);
    ctx.fillStyle = pal.text2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const note =
      Math.abs(net) < 1e-9
        ? "交互: +γ と −γ が打ち消し、層全体のずれは 0"
        : `1 種類: 層全体が γ = ${PLATE_SHEAR} だけずれる`;
    ctx.fillText(note, p.x, y + 4);
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // レイアウト前の極小キャンバスでは描かない(負の半径などを避ける)
    if (w < MIN_CANVAS_PX || h < MIN_CANVAS_PX) return;
    const l = layout();
    drawSection(l.section, l.narrow);
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
