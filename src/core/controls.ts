/**
 * controls.ts — 図版の操作部品(仕様書 §7.2)
 *
 * - 実体はネイティブ要素(<input type="range"> 等)をスタイルしたもので、
 *   キーボードだけで全操作が可能。
 * - 値変更は即時反映(Apply ボタン方式は禁止)。
 * - 図版が一時停止中でも、値変更は 1 フレーム描画で即時反映される
 *   (adapter.requestRender 経由 — §7.1 省モーション対応)。
 */

import { clamp } from "./mathx";

/**
 * Controls と図版実行環境(engine)をつなぐアダプタ。
 * engine が図版ごとに生成して渡す。style-guide などの単体デモには
 * Controls.demoAdapter() を使う。
 */
export interface FigureAdapter {
  /** 再生/一時停止をトグルする(ユーザー操作として扱う) */
  togglePlay(): void;
  /** 現在再生中かどうか */
  isPlaying(): boolean;
  /** 再生状態の変化を購読する */
  onPlayChange(cb: (playing: boolean) => void): void;
  /** 一時停止中でも 1 フレームだけ再描画する */
  requestRender(): void;
}

export interface SliderOptions {
  id: string;
  label: string;
  min: number;
  max: number;
  /** 線形スケール時の刻み。省略時 1。対数スケールでは無視される */
  step?: number;
  value: number;
  /** 単位表示(例: "K")。値の後ろに付く */
  unit?: string;
  /** "log" にすると対数スケール(min > 0 が必要)。既定は "linear" */
  scale?: "linear" | "log";
  /** 値の表示フォーマッタ。省略時は step / スケールから自動決定 */
  format?: (value: number) => string;
}

export interface SliderControl {
  readonly el: HTMLElement;
  readonly value: number;
  /** 値を設定して表示・リスナーに反映する */
  set(value: number): void;
  onChange(cb: (value: number) => void): void;
}

export interface ToggleOptions {
  id: string;
  label: string;
  value?: boolean;
}

export interface ToggleControl {
  readonly el: HTMLElement;
  readonly value: boolean;
  set(value: boolean): void;
  onChange(cb: (value: boolean) => void): void;
}

export interface SegmentedOptions<T extends string = string> {
  id: string;
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
}

export interface SegmentedControl<T extends string = string> {
  readonly el: HTMLElement;
  readonly value: T;
  set(value: T): void;
  onChange(cb: (value: T) => void): void;
}

export interface ButtonOptions {
  label: string;
}

export interface ButtonControl {
  readonly el: HTMLButtonElement;
  onClick(cb: () => void): void;
}

export interface PlayPauseControl {
  readonly el: HTMLButtonElement;
}

const PLAY_LABEL = "再生";
const PAUSE_LABEL = "一時停止";
/** 対数スライダーの内部分解能(離散位置の数) */
const LOG_SLIDER_RESOLUTION = 400;

let uidCounter = 0;

function stepDecimals(step: number): number {
  const s = String(step);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

/** 有効数字 3 桁程度の読みやすい表示(対数スライダーの既定フォーマッタ) */
function formatSignificant(v: number): string {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 100) return String(Math.round(v));
  return String(Number(v.toPrecision(3)));
}

export class Controls {
  private readonly container: HTMLElement;
  private readonly adapter: FigureAdapter;
  private buttonRow: HTMLElement | null = null;
  private readonly uid: number;

  constructor(container: HTMLElement, adapter: FigureAdapter) {
    this.container = container;
    this.adapter = adapter;
    this.uid = ++uidCounter;
  }

  /** 一時停止中の図版へ変更を即時反映させる(§7.1) */
  private renderIfPaused(): void {
    if (!this.adapter.isPlaying()) this.adapter.requestRender();
  }

  private domId(id: string): string {
    return `ctl-${this.uid}-${id}`;
  }

  private row(className: string): HTMLElement {
    const el = document.createElement("div");
    el.className = `ctl ${className}`;
    this.container.appendChild(el);
    return el;
  }

  /** playPause / reset / button は 1 行にまとめて横並びにする */
  private getButtonRow(): HTMLElement {
    if (!this.buttonRow) {
      const el = document.createElement("div");
      el.className = "ctl ctl-buttons";
      this.container.appendChild(el);
      this.buttonRow = el;
    }
    return this.buttonRow;
  }

  slider(opts: SliderOptions): SliderControl {
    const isLog = opts.scale === "log";
    if (isLog && opts.min <= 0) {
      throw new Error(
        `slider "${opts.id}": 対数スケールでは min > 0 が必要です`,
      );
    }
    const step = opts.step ?? 1;
    const decimals = stepDecimals(step);
    const format =
      opts.format ??
      (isLog ? formatSignificant : (v: number) => v.toFixed(decimals));
    const lnMin = isLog ? Math.log(opts.min) : 0;
    const lnMax = isLog ? Math.log(opts.max) : 0;
    const toValue = (t: number): number =>
      Math.exp(lnMin + ((lnMax - lnMin) * t) / LOG_SLIDER_RESOLUTION);
    const toT = (v: number): number =>
      Math.round(
        ((Math.log(v) - lnMin) / (lnMax - lnMin)) * LOG_SLIDER_RESOLUTION,
      );

    const el = this.row("ctl-slider");
    const inputId = this.domId(opts.id);

    const label = document.createElement("label");
    label.className = "ctl-label";
    label.htmlFor = inputId;
    label.textContent = opts.label;

    const input = document.createElement("input");
    input.type = "range";
    input.id = inputId;
    if (isLog) {
      input.min = "0";
      input.max = String(LOG_SLIDER_RESOLUTION);
      input.step = "1";
      input.value = String(toT(opts.value));
    } else {
      input.min = String(opts.min);
      input.max = String(opts.max);
      input.step = String(step);
      input.value = String(opts.value);
    }

    const output = document.createElement("output");
    output.className = "ctl-value";
    output.htmlFor.add(inputId);

    el.append(label, input, output);

    let current = opts.value;
    const listeners: Array<(v: number) => void> = [];

    const display = (v: number): void => {
      output.textContent = opts.unit ? `${format(v)} ${opts.unit}` : format(v);
    };
    const notify = (v: number): void => {
      for (const cb of listeners) cb(v);
      this.renderIfPaused();
    };

    display(current);

    input.addEventListener("input", () => {
      const raw = Number(input.value);
      current = clamp(isLog ? toValue(raw) : raw, opts.min, opts.max);
      display(current);
      notify(current);
    });

    return {
      el,
      get value(): number {
        return current;
      },
      set: (v: number): void => {
        current = clamp(v, opts.min, opts.max);
        input.value = String(isLog ? toT(current) : current);
        display(current);
        notify(current);
      },
      onChange: (cb: (v: number) => void): void => {
        listeners.push(cb);
      },
    };
  }

  toggle(opts: ToggleOptions): ToggleControl {
    const el = this.row("ctl-toggle");
    el.remove(); // row() は div を作るが、トグルは label 要素にしたいので作り直す
    const label = document.createElement("label");
    label.className = "ctl ctl-toggle";
    const text = document.createElement("span");
    text.className = "ctl-label";
    text.textContent = opts.label;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = this.domId(opts.id);
    input.checked = opts.value ?? false;
    label.append(text, input);
    this.container.appendChild(label);

    const listeners: Array<(v: boolean) => void> = [];
    const notify = (): void => {
      for (const cb of listeners) cb(input.checked);
      this.renderIfPaused();
    };
    input.addEventListener("change", notify);

    return {
      el: label,
      get value(): boolean {
        return input.checked;
      },
      set: (v: boolean): void => {
        if (input.checked !== v) {
          input.checked = v;
          notify();
        }
      },
      onChange: (cb: (v: boolean) => void): void => {
        listeners.push(cb);
      },
    };
  }

  segmented<T extends string>(opts: SegmentedOptions<T>): SegmentedControl<T> {
    const el = this.row("ctl-seg");
    const groupName = this.domId(opts.id);

    const labelEl = document.createElement("span");
    labelEl.className = "ctl-label";
    labelEl.id = `${groupName}-label`;
    labelEl.textContent = opts.label;

    const group = document.createElement("div");
    group.className = "ctl-seg-group";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-labelledby", labelEl.id);

    let current = opts.value;
    const listeners: Array<(v: T) => void> = [];
    const inputs = new Map<T, HTMLInputElement>();

    const notify = (): void => {
      for (const cb of listeners) cb(current);
      this.renderIfPaused();
    };

    for (const opt of opts.options) {
      const optLabel = document.createElement("label");
      optLabel.className = "ctl-seg-opt";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = groupName;
      input.value = opt.value;
      input.checked = opt.value === opts.value;
      const span = document.createElement("span");
      span.textContent = opt.label;
      optLabel.append(input, span);
      group.appendChild(optLabel);
      inputs.set(opt.value, input);
      input.addEventListener("change", () => {
        if (input.checked) {
          current = opt.value;
          notify();
        }
      });
    }

    el.append(labelEl, group);

    return {
      el,
      get value(): T {
        return current;
      },
      set: (v: T): void => {
        const input = inputs.get(v);
        if (input && current !== v) {
          input.checked = true;
          current = v;
          notify();
        }
      },
      onChange: (cb: (v: T) => void): void => {
        listeners.push(cb);
      },
    };
  }

  button(opts: ButtonOptions): ButtonControl {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ctl-btn";
    btn.textContent = opts.label;
    this.getButtonRow().appendChild(btn);
    return {
      el: btn,
      onClick: (cb: () => void): void => {
        btn.addEventListener("click", cb);
      },
    };
  }

  /** engine と連動する再生/一時停止ボタン(§7.2) */
  playPause(): PlayPauseControl {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ctl-btn ctl-btn-play";
    const sync = (): void => {
      const playing = this.adapter.isPlaying();
      btn.textContent = playing ? PAUSE_LABEL : PLAY_LABEL;
      btn.setAttribute("aria-pressed", playing ? "true" : "false");
    };
    btn.addEventListener("click", () => this.adapter.togglePlay());
    this.adapter.onPlayChange(sync);
    sync();
    this.getButtonRow().appendChild(btn);
    return { el: btn };
  }

  /**
   * 初期状態へ戻すボタン。cb で状態をリセットした後、1 フレーム描画する。
   * 乱数はシード固定で完全に同じ初期状態に戻ること(§8.2)。
   */
  reset(cb: () => void): ButtonControl {
    const control = this.button({ label: "リセット" });
    control.onClick(() => {
      cb();
      this.adapter.requestRender();
    });
    return control;
  }

  /**
   * 図版に紐付かない単体デモ用のアダプタ(style-guide で使用)。
   * 再生状態だけを内部に持ち、描画要求は何もしない。
   */
  static demoAdapter(): FigureAdapter {
    let playing = true;
    const listeners: Array<(p: boolean) => void> = [];
    return {
      togglePlay: (): void => {
        playing = !playing;
        for (const cb of listeners) cb(playing);
      },
      isPlaying: (): boolean => playing,
      onPlayChange: (cb: (p: boolean) => void): void => {
        listeners.push(cb);
      },
      requestRender: (): void => {
        /* 単体デモでは何もしない */
      },
    };
  }
}
