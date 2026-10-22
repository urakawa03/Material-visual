/**
 * anim.test.ts — 短い遷移 tween の単体テスト(docs/specs/90_remaining_work.md §3.3・§3.5)
 *
 * テストは Node で動くので、requestAnimationFrame と matchMedia を差し替えて
 * フレームの進行を手で進める。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tween } from "./anim";

type FrameCallback = (ts: number) => void;

let pending: Map<number, FrameCallback>;
let nextId: number;

/** 待っているコールバックを時刻 ts で 1 回ずつ呼ぶ */
function runFrame(ts: number): void {
  const callbacks = [...pending.values()];
  pending.clear();
  callbacks.forEach((cb) => cb(ts));
}

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
  }));
}

beforeEach(() => {
  pending = new Map();
  nextId = 1;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameCallback) => {
    const id = nextId++;
    pending.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    pending.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tween — 省モーション", () => {
  it("prefers-reduced-motion のときは即座に最終値になり、フレームを要求しない", () => {
    stubReducedMotion(true);
    const values: number[] = [];
    const onDone = vi.fn();
    const t = tween(0, 10, 150, (v) => values.push(v), onDone);
    expect(values).toEqual([10]);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(t.active).toBe(false);
    expect(pending.size).toBe(0);
  });

  it("所要時間が 0 以下でも即座に最終値になる", () => {
    stubReducedMotion(false);
    const values: number[] = [];
    tween(3, 7, 0, (v) => values.push(v));
    expect(values).toEqual([7]);
    expect(pending.size).toBe(0);
  });
});

describe("tween — 通常の遷移", () => {
  it("最初のフレームを起点に補間し、終点で onDone を 1 回呼ぶ", () => {
    stubReducedMotion(false);
    const values: number[] = [];
    const onDone = vi.fn();
    const t = tween(0, 10, 100, (v) => values.push(v), onDone);
    expect(t.active).toBe(true);

    runFrame(1000);
    expect(values[0]).toBe(0);
    runFrame(1050);
    expect(values[1]).toBeCloseTo(5, 12);
    expect(onDone).not.toHaveBeenCalled();
    runFrame(1100);
    expect(values[2]).toBe(10);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(t.active).toBe(false);
    expect(pending.size).toBe(0);
  });

  it("イージングは端でゆっくり、中央で速い", () => {
    stubReducedMotion(false);
    const values: number[] = [];
    tween(0, 1, 100, (v) => values.push(v));
    [0, 10, 50, 90, 100].forEach((ts) => runFrame(ts));
    const [, early, mid, late] = values;
    expect(early).toBeLessThan(0.1);
    expect(mid).toBeCloseTo(0.5, 12);
    expect(late).toBeGreaterThan(0.9);
  });

  it("cancel で以後の更新が止まる", () => {
    stubReducedMotion(false);
    const values: number[] = [];
    const onDone = vi.fn();
    const t = tween(0, 10, 100, (v) => values.push(v), onDone);
    runFrame(0);
    t.cancel();
    expect(t.active).toBe(false);
    runFrame(50);
    runFrame(100);
    expect(values).toEqual([0]);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("matchMedia がない環境でも動く", () => {
    const values: number[] = [];
    tween(0, 2, 100, (v) => values.push(v));
    runFrame(0);
    runFrame(100);
    expect(values).toEqual([0, 2]);
  });
});
