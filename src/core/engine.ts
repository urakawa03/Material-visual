/**
 * engine.ts — 図版実行環境(仕様書 §7.1)
 *
 * ページ内の全インタラクティブ図版を 1 つの実行環境で管理する。
 *
 * - 単一の requestAnimationFrame ループ(dt は 50ms でクランプ)
 * - IntersectionObserver: rootMargin 600px 圏内でウィジェットを動的 import、
 *   可視で再生・画面外/タブ非表示で停止(手動一時停止した図版は再開しない)
 * - ResizeObserver + devicePixelRatio(上限 2)でキャンバス寸法を管理
 * - prefers-reduced-motion: reduce では自動再生せず、静止フレーム +
 *   再生ボタンで開始。操作は 1 フレーム描画で即時反映
 */

import { registry } from "../widgets/registry";
import type { FigureHost, FigureSize, WidgetHandle } from "../widgets/types";
import { Controls, type FigureAdapter } from "./controls";

/** dt のクランプ上限(ms)。タブ復帰などの巨大な dt で物理が破綻しないように */
const MAX_DT_MS = 50;
/** devicePixelRatio の上限(§7.1) */
const MAX_DPR = 2;
/** ウィジェットを動的 import し始める距離(§7.1) */
const LOAD_ROOT_MARGIN = "600px";

interface FigureRuntime {
  root: HTMLElement;
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  controlsEl: HTMLElement | null;
  widgetId: string;
  handle: WidgetHandle | null;
  frameCb: ((dt: number, t: number) => void) | null;
  renderCb: (() => void) | null;
  size: FigureSize;
  /** 累積再生時間(秒)。一時停止中は進まない */
  time: number;
  loaded: boolean;
  loading: boolean;
  visible: boolean;
  /** ユーザーが手動で止めた(または省モーションで未開始の)状態 */
  userPaused: boolean;
  playListeners: Array<(playing: boolean) => void>;
  overlayButton: HTMLButtonElement | null;
}

const figures: FigureRuntime[] = [];
const byRoot = new Map<Element, FigureRuntime>();
const byStage = new Map<Element, FigureRuntime>();

/** いま実際にフレームを回している図版(可視 & 再生中) */
const running = new Set<FigureRuntime>();
/** requestRender の合流待ち(重複要求は 1 回にまとめる) */
const renderQueue = new Set<FigureRuntime>();

let rafId: number | null = null;
let lastTs: number | null = null;
let loadObserver: IntersectionObserver | null = null;
let viewObserver: IntersectionObserver | null = null;
let resizeObserver: ResizeObserver | null = null;
let globalListenersBound = false;

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/* ---------------------------------------------------------------- rAF ループ */

function schedule(): void {
  if (rafId === null) rafId = requestAnimationFrame(tick);
}

function tick(ts: number): void {
  rafId = null;
  const dtMs =
    lastTs === null ? 0 : Math.min(Math.max(ts - lastTs, 0), MAX_DT_MS);
  lastTs = ts;
  const dt = dtMs / 1000;

  for (const fig of running) {
    fig.time += dt;
    // 連続アニメが進むフレームでは個別の再描画要求は不要になる
    renderQueue.delete(fig);
    if (fig.frameCb) fig.frameCb(dt, fig.time);
  }

  if (renderQueue.size > 0) {
    for (const fig of renderQueue) {
      if (fig.renderCb) fig.renderCb();
      else if (fig.frameCb) fig.frameCb(0, fig.time);
    }
    renderQueue.clear();
  }

  if (running.size > 0) {
    schedule();
  } else {
    lastTs = null;
  }
}

function requestRenderFor(fig: FigureRuntime): void {
  if (!fig.loaded) return;
  renderQueue.add(fig);
  schedule();
}

/* ------------------------------------------------------------ 再生状態の管理 */

/** ユーザー意図としての「再生中」(画面外かどうかは含まない) */
function intentPlaying(fig: FigureRuntime): boolean {
  return fig.loaded && !fig.userPaused && fig.frameCb !== null;
}

function updateRunState(fig: FigureRuntime): void {
  const shouldRun =
    intentPlaying(fig) && fig.visible && document.visibilityState === "visible";
  const wasRunning = running.has(fig);
  if (shouldRun && !wasRunning) {
    running.add(fig);
    fig.handle?.setPlaying?.(true);
    schedule();
  } else if (!shouldRun && wasRunning) {
    running.delete(fig);
    fig.handle?.setPlaying?.(false);
    if (running.size === 0 && renderQueue.size === 0 && rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
      lastTs = null;
    }
  }
}

function notifyPlayChange(fig: FigureRuntime): void {
  const playing = intentPlaying(fig);
  for (const cb of fig.playListeners) cb(playing);
}

function setUserPlaying(fig: FigureRuntime, playing: boolean): void {
  fig.userPaused = !playing;
  if (playing) hideOverlay(fig);
  updateRunState(fig);
  notifyPlayChange(fig);
}

/* ------------------------------------------------- 省モーション時の再生ボタン */

function showOverlay(fig: FigureRuntime): void {
  if (fig.overlayButton) {
    fig.overlayButton.hidden = false;
    return;
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ix-play-overlay";
  btn.setAttribute("aria-label", "アニメーションを再生");
  btn.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M6 3.5 L18 11 L6 18.5 Z" fill="currentColor"/></svg>';
  btn.addEventListener("click", () => setUserPlaying(fig, true));
  fig.stage.appendChild(btn);
  fig.overlayButton = btn;
}

function hideOverlay(fig: FigureRuntime): void {
  if (fig.overlayButton) fig.overlayButton.hidden = true;
}

/* ------------------------------------------------------------ 寸法・DPR 管理 */

function updateCanvasSize(fig: FigureRuntime): boolean {
  // ステージではなくキャンバス自身を測る(ステージの枠線幅を含めないため)
  const rect = fig.canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const changed = fig.size.w !== w || fig.size.h !== h || fig.size.dpr !== dpr;
  fig.size.w = w;
  fig.size.h = h;
  fig.size.dpr = dpr;
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (fig.canvas.width !== bw) fig.canvas.width = bw;
  if (fig.canvas.height !== bh) fig.canvas.height = bh;
  return changed;
}

function handleResize(fig: FigureRuntime): void {
  if (!updateCanvasSize(fig)) return;
  if (fig.loaded) {
    fig.handle?.resize?.();
    requestRenderFor(fig);
  }
}

/* ------------------------------------------------------------- 図版のロード */

async function loadFigure(fig: FigureRuntime): Promise<void> {
  if (fig.loaded || fig.loading) return;
  fig.loading = true;
  try {
    const load = registry[fig.widgetId];
    if (!load) {
      console.error(
        `[engine] registry に未登録のウィジェットです: "${fig.widgetId}"`,
      );
      return;
    }
    const mod = await load();
    updateCanvasSize(fig);

    const adapter: FigureAdapter = {
      togglePlay: () => setUserPlaying(fig, fig.userPaused),
      isPlaying: () => intentPlaying(fig),
      onPlayChange: (cb) => {
        fig.playListeners.push(cb);
      },
      requestRender: () => requestRenderFor(fig),
    };
    const controls = new Controls(
      fig.controlsEl ?? fig.root.appendChild(document.createElement("div")),
      adapter,
    );

    const host: FigureHost = {
      stage: fig.stage,
      canvas: fig.canvas,
      controls,
      size: fig.size,
      onFrame: (cb) => {
        fig.frameCb = cb;
      },
      onRender: (cb) => {
        fig.renderCb = cb;
      },
      requestRender: () => requestRenderFor(fig),
    };

    fig.handle = await mod.default(host);
    fig.loaded = true;

    // 省モーション設定では自動再生しない(§7.1)
    if (fig.frameCb && prefersReducedMotion()) {
      fig.userPaused = true;
      showOverlay(fig);
    }

    requestRenderFor(fig); // 初期フレーム(静止状態でも意味のある絵を出す)
    updateRunState(fig);
    notifyPlayChange(fig);
  } catch (err) {
    console.error(
      `[engine] ウィジェット "${fig.widgetId}" の初期化に失敗しました`,
      err,
    );
  } finally {
    fig.loading = false;
  }
}

/* -------------------------------------------------------------- 初期化・登録 */

function ensureObservers(): void {
  if (loadObserver) return;

  loadObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const fig = byRoot.get(entry.target);
        if (fig) {
          loadObserver?.unobserve(entry.target);
          void loadFigure(fig);
        }
      }
    },
    { rootMargin: LOAD_ROOT_MARGIN },
  );

  viewObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const fig = byRoot.get(entry.target);
      if (!fig) continue;
      fig.visible = entry.isIntersecting;
      updateRunState(fig);
    }
  });

  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const fig = byStage.get(entry.target);
      if (fig) handleResize(fig);
    }
  });

  if (!globalListenersBound) {
    globalListenersBound = true;
    document.addEventListener("visibilitychange", () => {
      for (const fig of figures) updateRunState(fig);
    });
    // ブラウザズーム等での devicePixelRatio 変化を拾う
    window.addEventListener("resize", () => {
      for (const fig of figures) handleResize(fig);
    });
  }
}

function setupFigure(root: HTMLElement): void {
  const widgetId = root.dataset.widget;
  if (!widgetId) return;
  const stage = root.querySelector<HTMLElement>(".ix-stage");
  const canvas = root.querySelector<HTMLCanvasElement>("canvas");
  if (!stage || !canvas) {
    console.error(
      `[engine] .ix-stage / canvas が見つかりません: "${widgetId}"`,
    );
    return;
  }

  const fig: FigureRuntime = {
    root,
    stage,
    canvas,
    controlsEl: root.querySelector<HTMLElement>(".ix-controls"),
    widgetId,
    handle: null,
    frameCb: null,
    renderCb: null,
    size: { w: 1, h: 1, dpr: 1 },
    time: 0,
    loaded: false,
    loading: false,
    visible: false,
    userPaused: false,
    playListeners: [],
    overlayButton: null,
  };

  figures.push(fig);
  byRoot.set(root, fig);
  byStage.set(stage, fig);
  updateCanvasSize(fig);

  ensureObservers();
  loadObserver?.observe(root);
  viewObserver?.observe(root);
  resizeObserver?.observe(stage);
}

/**
 * ページ内の全図版(.ix[data-widget])を engine に登録する。
 * Figure.astro のスクリプトから呼ばれる。複数回呼んでも安全(冪等)。
 */
export function initFigures(root: ParentNode = document): void {
  const nodes = root.querySelectorAll<HTMLElement>(".ix[data-widget]");
  nodes.forEach((el) => {
    if (el.dataset.ixBound === "1") return;
    el.dataset.ixBound = "1";
    setupFigure(el);
  });
}

/* ------------------------------------------------------- 固定タイムステップ */

/** 1 フレームで消化するステップ数の上限(タブ復帰直後などの発散防止) */
const FIXED_STEP_MAX_PER_FRAME = 8;

/**
 * 物理シミュレーション向けの固定タイムステップ補助(アキュムレータ方式)。
 *
 * 使い方:
 * ```ts
 * const stepper = fixedStep(8); // 8ms 刻み
 * host.onFrame((dt) => {
 *   stepper(dt, (h) => sim.step(h)); // h は秒
 *   draw();
 * });
 * ```
 */
export function fixedStep(
  stepMs: number,
): (dtSeconds: number, step: (hSeconds: number) => void) => void {
  const h = stepMs / 1000;
  let acc = 0;
  return (dt, step) => {
    acc += dt;
    let n = 0;
    while (acc >= h && n < FIXED_STEP_MAX_PER_FRAME) {
      step(h);
      acc -= h;
      n++;
    }
    // 上限に達したら残りは捨てる(処理落ち時に雪だるま式に増やさない)
    if (n === FIXED_STEP_MAX_PER_FRAME) acc = 0;
  };
}
