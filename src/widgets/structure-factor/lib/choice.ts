/**
 * choice.ts — 本記事の図版の小さな操作部品(仕様書 08 §5.4・§5.5)
 *
 * src/core/controls.ts の部品では表せない 2 つを、同じ規約(ネイティブ要素・
 * キーボードだけで操作できる・44px のタッチ標的・即時反映)で作る。
 * - createChoiceList: 長い文の選択肢を縦に並べたラジオボタン(図4 の規則の候補)
 * - createChipGroup: 複数選べるチップ(図5 の元素。選べる数に上限がある)
 * 見た目は記事ページの <style>(.sf-choice / .sf-chips)で付ける。
 */

import type { FigureHost } from "../../types";

let uid = 0;

function controlsContainer(host: FigureHost): HTMLElement | null {
  return (
    host.stage.closest(".ix")?.querySelector<HTMLElement>(".ix-controls") ??
    host.stage.parentElement
  );
}

export interface ChoiceList<T extends string> {
  el: HTMLFieldSetElement;
  readonly value: T | null;
  /** 選択を変える(null で未選択)。変わったときだけ onChange を呼ぶ */
  set(v: T | null): void;
  setEnabled(enabled: boolean): void;
  setLegend(text: string): void;
  onChange(cb: (v: T | null) => void): void;
}

/**
 * 縦に並んだラジオボタンの選択肢(fieldset + legend)。最初は未選択。
 * 値を変えると host.requestRender() も呼ぶ。
 */
export function createChoiceList<T extends string>(
  host: FigureHost,
  opts: {
    label: string;
    options: ReadonlyArray<{ value: T; label: string }>;
  },
): ChoiceList<T> {
  const name = `sf-choice-${++uid}`;
  const el = document.createElement("fieldset");
  el.className = "ctl sf-choice";
  const legend = document.createElement("legend");
  legend.className = "ctl-label";
  legend.textContent = opts.label;
  const list = document.createElement("div");
  list.className = "sf-choice-list";
  el.append(legend, list);

  let current: T | null = null;
  const listeners: Array<(v: T | null) => void> = [];
  const inputs = new Map<T, HTMLInputElement>();
  const notify = (): void => {
    for (const cb of listeners) cb(current);
    host.requestRender();
  };
  for (const opt of opts.options) {
    const lab = document.createElement("label");
    lab.className = "sf-choice-opt";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = opt.value;
    const span = document.createElement("span");
    span.textContent = opt.label;
    lab.append(input, span);
    list.appendChild(lab);
    inputs.set(opt.value, input);
    input.addEventListener("change", () => {
      if (input.checked) {
        current = opt.value;
        notify();
      }
    });
  }
  controlsContainer(host)?.appendChild(el);

  return {
    el,
    get value(): T | null {
      return current;
    },
    set(v: T | null): void {
      if (v === current) return;
      current = v;
      for (const [key, input] of inputs) input.checked = key === v;
      notify();
    },
    setEnabled(enabled: boolean): void {
      el.disabled = !enabled;
      el.classList.toggle("is-disabled", !enabled);
    },
    setLegend(text: string): void {
      if (legend.textContent !== text) legend.textContent = text;
    },
    onChange(cb: (v: T | null) => void): void {
      listeners.push(cb);
    },
  };
}

export interface ChipGroup<T extends string> {
  el: HTMLElement;
  /** 選ばれている値(選んだ順) */
  readonly values: readonly T[];
  set(values: readonly T[]): void;
  onChange(cb: (values: readonly T[]) => void): void;
}

/**
 * 複数選べるチップ(チェックボックス)。max 個選ばれている間は、選ばれて
 * いないチップを無効にする(「最大 4」— 仕様書 08 §5.5)。
 */
export function createChipGroup<T extends string>(
  host: FigureHost,
  opts: {
    label: string;
    options: ReadonlyArray<{ value: T; label: string }>;
    values: readonly T[];
    max: number;
  },
): ChipGroup<T> {
  const el = document.createElement("div");
  el.className = "ctl sf-chips";
  const labelId = `sf-chips-${++uid}`;
  const lab = document.createElement("span");
  lab.className = "ctl-label";
  lab.id = labelId;
  lab.textContent = opts.label;
  const group = document.createElement("div");
  group.className = "sf-chip-group";
  group.setAttribute("role", "group");
  group.setAttribute("aria-labelledby", labelId);
  el.append(lab, group);

  let current: T[] = [...opts.values];
  const listeners: Array<(v: readonly T[]) => void> = [];
  const inputs = new Map<T, HTMLInputElement>();

  const sync = (): void => {
    const full = current.length >= opts.max;
    for (const [key, input] of inputs) {
      input.checked = current.includes(key);
      input.disabled = full && !input.checked;
    }
  };
  const notify = (): void => {
    for (const cb of listeners) cb(current);
    host.requestRender();
  };

  for (const opt of opts.options) {
    const chip = document.createElement("label");
    chip.className = "sf-chip";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = opt.value;
    const span = document.createElement("span");
    span.textContent = opt.label;
    chip.append(input, span);
    group.appendChild(chip);
    inputs.set(opt.value, input);
    input.addEventListener("change", () => {
      if (input.checked) {
        if (!current.includes(opt.value)) current = [...current, opt.value];
      } else {
        current = current.filter((v) => v !== opt.value);
      }
      sync();
      notify();
    });
  }
  sync();
  controlsContainer(host)?.appendChild(el);

  return {
    el,
    get values(): readonly T[] {
      return current;
    },
    set(values: readonly T[]): void {
      const same =
        values.length === current.length &&
        values.every((v, i) => v === current[i]);
      if (same) return;
      current = [...values].slice(0, opts.max);
      sync();
      notify();
    },
    onChange(cb: (values: readonly T[]) => void): void {
      listeners.push(cb);
    },
  };
}
