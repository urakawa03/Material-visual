/**
 * atmosphere-kinetics.ts — 図5: 雰囲気ができるまで(記事仕様 §5.5・中心図版)
 *
 * 図2 と同じ刃状転位入り格子(転位固定)を下敷きに、格子間サイトを
 * 跳び回る炭素原子 120 個を Metropolis 型ランダムウォークで動かす。
 * 低温では転位下側(引張側)へ雲が凝縮し、高温ではまばらなまま —
 * ボルツマン分布(図4)へ向かう「過程」を実時間換算つきで観察させる。
 *
 * 実装方式: 2D / onFrame + fixedStep。原子の位置は TypedArray で保持し
 * 1 パス描画(母体仕様 §8.3)。サイト間の移動は約 80ms のイージング補間
 * (×100 時は省略して即時表示)。
 *
 * 時間の注意(§5.5): 実時間換算 1 MC ステップ = 1/Γ(T) 秒は表示にのみ
 * 使い、描画レートは温度によらず一定に保つ(そうしないと低温で何も
 * 動かない)。「時間の縮尺は温度ごとに違う」ことは図注で明示する。
 * 簡略化(図注に明示): 2D・正方格子・希薄(相互作用なし)・転位は動かない。
 */

import type { FigureHost, WidgetHandle } from "../types";
import { fixedStep } from "../../core/engine";
import { easeOutCubic, mulberry32 } from "../../core/mathx";
import { darken, matColor, uiColor } from "../../core/colors";
import { KB_EV, formatDuration, hopRate } from "./lib/constants";
import {
  buildEdgeLattice,
  dislocationSymbolPos,
  drawDislocationMark,
  drawLatticeAtoms,
  makeLatticeView,
  soluteEnergy,
  viewX,
  viewY,
} from "./lib/lattice";

/** 格子の列数・行数(図2 と同一 — §5.5) */
const COLS = 27;
const ROWS = 16;
/** 下敷き格子の変位誇張(図2 の初期値と同じ ×2) */
const LATTICE_EXAG = 2;
/** 母相原子の半径(格子間隔に対する割合。図2 と同一) */
const ATOM_RADIUS_RATIO = 0.3;
/** 炭素原子の半径は母相の 0.55 倍(§5.5) */
const SOLUTE_RADIUS_RATIO = 0.55 * ATOM_RADIUS_RATIO;

/**
 * 格子間サイト = 格子の「マス目の中心」のグリッド(§5.5)。
 * x ∈ {−12.5, …, +12.5}(26 列・周期境界)、y ∈ {−7, …, +7}(15 行)。
 */
const SITE_COLS = COLS - 1;
const SITE_ROWS = ROWS - 1;
const SITE_COUNT = SITE_COLS * SITE_ROWS;
/** サイト左端の x と下端の y(b 単位・転位中心原点・y 上向き) */
const SITE_X0 = -(SITE_COLS - 1) / 2;
const SITE_Y0 = -(SITE_ROWS - 1) / 2;

/** 炭素原子の個数(§5.5: 約 120 個) */
const ATOM_COUNT = 120;
/** 乱数シード(reset で完全に同じ初期配置に戻す — §8.2) */
const SEED = 20260505;

/** 温度スライダー(§5.5: 300〜1000 K・step 10・初期 600) */
const TEMP_MIN = 300;
const TEMP_MAX = 1000;
const TEMP_STEP = 10;
const TEMP_INIT = 600;

/** 時間の進み(内部ステップ数の倍率)。1 tick = speedMult MC ステップ */
type SpeedValue = "1" | "10" | "100";
const SPEED_INIT: SpeedValue = "10";
/** この倍率以上ではホップの補間を省略して即時表示する(§5.5) */
const ANIM_SKIP_MULT = 100;

/** 固定タイムステップ(ms)。1 tick ごとに speedMult ステップ実行(§5.5) */
const STEP_MS = 16;
/** サイト間移動のイージング補間の所要時間(秒 — §5.5: 約 80ms) */
const HOP_ANIM_S = 0.08;

/** 縁取り(同系色を約 20% 暗く・1.5px — §6.5) */
const EDGE_WIDTH = 1.5;

const TAU = Math.PI * 2;

export default function atmosphereKinetics(host: FigureHost): WidgetHandle {
  const maybeCtx = host.canvas.getContext("2d");
  if (!maybeCtx) throw new Error("2D コンテキストを取得できません");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  // 色は初期化時に一度だけ解決する(matColor/uiColor — §6.2)
  const matrixFill = matColor("matrix");
  const matrixEdge = darken(matrixFill);
  const soluteFill = matColor("solute");
  const soluteEdge = darken(soluteFill);
  const defectColor = matColor("defect");
  const labelColor = uiColor("text2");
  const bgColor = uiColor("bg");

  // 下敷きの格子(転位固定)と ⊥ 記号の位置は不変なので一度だけ作る
  const lat = buildEdgeLattice(COLS, ROWS);
  const symPos = { x: 0, y: 0 };
  dislocationSymbolPos(LATTICE_EXAG, symPos);

  /* ---- サイトの事前計算(毎フレーム割当て回避 — §8.3) ---- */

  // 各サイトの物理座標(b 単位)と相互作用エネルギー U [eV]。
  // U は soluteEnergy(サイト位置)を初期化時に評価して使い回す
  const sitePosX = new Float64Array(SITE_COUNT);
  const sitePosY = new Float64Array(SITE_COUNT);
  const siteU = new Float64Array(SITE_COUNT);
  for (let s = 0; s < SITE_COUNT; s++) {
    const x = SITE_X0 + (s % SITE_COLS);
    const y = SITE_Y0 + Math.floor(s / SITE_COLS);
    sitePosX[s] = x;
    sitePosY[s] = y;
    siteU[s] = soluteEnergy(x, y);
  }

  /* ---- 原子の状態(TypedArray — §5.5) ---- */

  /** サイト占有(0/1) */
  const occupancy = new Uint8Array(SITE_COUNT);
  /** 原子 → サイト index */
  const atomSite = new Int32Array(ATOM_COUNT);
  /** 表示位置(b 単位)。サイト間をイージング補間した現在値 */
  const dispX = new Float64Array(ATOM_COUNT);
  const dispY = new Float64Array(ATOM_COUNT);
  /** 補間の始点(ホップ受理時の表示位置) */
  const fromX = new Float64Array(ATOM_COUNT);
  const fromY = new Float64Array(ATOM_COUNT);
  /** ホップからの経過秒。HOP_ANIM_S 以上で「静定」扱い */
  const hopT = new Float64Array(ATOM_COUNT);

  let rand = mulberry32(SEED);
  let temperature = TEMP_INIT;
  let speedMult = Number(SPEED_INIT);
  /** シミュレーション内経過時間 [s](実時間換算・表示のみに使用) */
  let simTime = 0;

  /** シード固定の一様ランダム初期配置(排他)。reset で毎回同一(§5.5) */
  function init(): void {
    rand = mulberry32(SEED);
    occupancy.fill(0);
    for (let i = 0; i < ATOM_COUNT; i++) {
      // 空きサイトが出るまで引き直す(充填率 120/390 ≈ 0.31 なので速い)
      let s = Math.floor(rand() * SITE_COUNT);
      while (occupancy[s] !== 0) s = Math.floor(rand() * SITE_COUNT);
      occupancy[s] = 1;
      atomSite[i] = s;
      dispX[i] = sitePosX[s];
      dispY[i] = sitePosY[s];
      fromX[i] = sitePosX[s];
      fromY[i] = sitePosY[s];
      hopT[i] = HOP_ANIM_S; // 静定状態から開始
    }
    simTime = 0;
  }

  /**
   * 1 MC ステップ = 全原子 1 試行(§5.5)。各試行: 4 近傍から等確率で
   * 候補を選び(x は周期境界で折返し、y は範囲外なら棄却)、占有済みなら
   * 棄却、ΔU = U(候補) − U(現在) を Metropolis 判定
   * min(1, e^(−ΔU/(kB T))) で受理する。
   */
  function mcStep(animate: boolean): void {
    const beta = 1 / (KB_EV * temperature);
    for (let i = 0; i < ATOM_COUNT; i++) {
      const site = atomSite[i];
      const col = site % SITE_COLS;
      const row = (site - col) / SITE_COLS;
      const dir = Math.floor(rand() * 4);
      let nCol = col;
      let nRow = row;
      let wrapped = false; // 周期境界をまたいだら補間せず即時表示する
      if (dir === 0) {
        nCol = col + 1;
        if (nCol === SITE_COLS) {
          nCol = 0;
          wrapped = true;
        }
      } else if (dir === 1) {
        nCol = col - 1;
        if (nCol < 0) {
          nCol = SITE_COLS - 1;
          wrapped = true;
        }
      } else if (dir === 2) {
        nRow = row + 1;
        if (nRow === SITE_ROWS) continue; // y は範囲外なら棄却
      } else {
        nRow = row - 1;
        if (nRow < 0) continue;
      }
      const nSite = nRow * SITE_COLS + nCol;
      if (occupancy[nSite] !== 0) continue; // 占有済みは棄却(排他)
      const dU = siteU[nSite] - siteU[site];
      if (dU > 0 && rand() >= Math.exp(-dU * beta)) continue;
      // 受理: サイトを移す
      occupancy[site] = 0;
      occupancy[nSite] = 1;
      atomSite[i] = nSite;
      if (animate && !wrapped) {
        // 現在の表示位置から新サイトへ約 80ms かけて補間する
        fromX[i] = dispX[i];
        fromY[i] = dispY[i];
        hopT[i] = 0;
      } else {
        hopT[i] = HOP_ANIM_S; // ×100 時・折返し時は即時表示
      }
    }
  }

  function draw(): void {
    const { w, h, dpr } = host.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // 誇張 ×2 の変位でもはみ出さない寸法でフィット(図2 と同じ余裕)
    const view = makeLatticeView(
      w,
      h,
      COLS + LATTICE_EXAG,
      ROWS + 0.5 * LATTICE_EXAG,
    );

    // 下敷き: 母相格子(誇張 ×2・通常表示)+ ⊥ 記号
    drawLatticeAtoms(
      ctx,
      view,
      lat,
      LATTICE_EXAG,
      ATOM_RADIUS_RATIO * view.scale,
      matrixFill,
      matrixEdge,
    );
    drawDislocationMark(ctx, view, symPos.x, symPos.y, defectColor);

    // 炭素原子: 表示位置を補間で更新しつつ 1 パスでまとめ描き(§8.3)
    const r = SOLUTE_RADIUS_RATIO * view.scale;
    ctx.beginPath();
    for (let i = 0; i < ATOM_COUNT; i++) {
      const s = atomSite[i];
      if (hopT[i] >= HOP_ANIM_S) {
        dispX[i] = sitePosX[s];
        dispY[i] = sitePosY[s];
      } else {
        const e = easeOutCubic(hopT[i] / HOP_ANIM_S);
        dispX[i] = fromX[i] + (sitePosX[s] - fromX[i]) * e;
        dispY[i] = fromY[i] + (sitePosY[s] - fromY[i]) * e;
      }
      const px = viewX(view, dispX[i]);
      const py = viewY(view, dispY[i]);
      ctx.moveTo(px + r, py);
      ctx.arc(px, py, r, 0, TAU);
    }
    ctx.fillStyle = soluteFill;
    ctx.fill();
    ctx.lineWidth = EDGE_WIDTH;
    ctx.strokeStyle = soluteEdge;
    ctx.stroke();

    // 読み出し: 実時間換算の経過時間(§5.5)。原子と重なっても読めるよう
    // 白の縁取りを敷いてキャンバス上部に表示(端から 8px 以上の余白)
    const readout = `経過: ${formatDuration(simTime)}(${Math.round(temperature)} K 換算)`;
    ctx.font = "14px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.lineWidth = 4;
    ctx.strokeStyle = bgColor;
    ctx.fillStyle = labelColor;
    ctx.strokeText(readout, 14, 10);
    ctx.fillText(readout, 14, 10);
  }

  /* ---- 操作部品(§7.2) ---- */

  const tempSlider = host.controls.slider({
    id: "temperature",
    label: "温度 T",
    min: TEMP_MIN,
    max: TEMP_MAX,
    step: TEMP_STEP,
    value: TEMP_INIT,
    unit: "K",
  });
  tempSlider.onChange((v) => {
    // T 変更は分布を保ったまま続行(reset しない — 凝縮⇔蒸発が可逆に
    // 見えるように §5.5)
    temperature = v;
  });

  const speedSeg = host.controls.segmented<SpeedValue>({
    id: "speed",
    label: "時間の進み",
    options: [
      { value: "1", label: "×1" },
      { value: "10", label: "×10" },
      { value: "100", label: "×100" },
    ],
    value: SPEED_INIT,
  });
  speedSeg.onChange((v) => {
    speedMult = Number(v);
  });

  // 初期状態は再生中(engine の既定のまま。reduced-motion 時は engine が
  // 自動で停止 + 再生ボタン表示に切り替える — §7.1)
  host.controls.playPause();
  host.controls.reset(() => {
    // 再生状態は変えず、T・倍率・配置・経過時間を初期状態へ
    // (set は onChange 経由で内部状態にも反映される)
    tempSlider.set(TEMP_INIT);
    speedSeg.set(SPEED_INIT);
    init();
  });

  /* ---- フレームループ ---- */

  const stepper = fixedStep(STEP_MS);
  host.onFrame((dt) => {
    // 補間の経過時間を進める(見た目のみ。物理には影響しない)
    for (let i = 0; i < ATOM_COUNT; i++) {
      if (hopT[i] < HOP_ANIM_S) hopT[i] += dt;
    }
    // 1 tick = speedMult MC ステップ。描画レートは T によらず一定で、
    // 実時間換算(1 ステップ = 1/Γ(T) 秒)は表示にのみ使う(§5.5)
    stepper(dt, () => {
      const animate = speedMult < ANIM_SKIP_MULT;
      for (let s = 0; s < speedMult; s++) mcStep(animate);
      simTime += speedMult / hopRate(temperature);
    });
    draw();
  });
  // 一時停止中の操作(リセット・省モーション初期表示)用
  host.onRender(draw);

  init();

  return {
    destroy(): void {
      /* キャンバスへのイベントリスナーなし */
    },
  };
}
