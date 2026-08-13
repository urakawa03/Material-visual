/**
 * lattice.test.ts — サイト格子と空孔交換の単体テスト(記事仕様 §5.2)
 *
 * 検証したいのは次の 3 点:
 * - `_shared/lattice2d.ts` から作った格子が「完全正方格子」になっていること
 * - 空孔交換で空孔の数が保存され、原子は空孔が隣に来たときだけ動くこと
 * - シード固定で reset の再現性があること(母体仕様 §8.2)
 */

import { describe, expect, it } from "vitest";
import {
  InterstitialWalkers,
  SITE_A,
  SITE_B,
  SITE_VACANCY,
  VacancyExchange,
  buildInterstitialGrid,
  buildSiteGrid,
} from "./lattice";

describe("buildSiteGrid — _shared/lattice2d.ts の rigid モードの再利用", () => {
  const grid = buildSiteGrid(13, 5);

  it("サイト数と行数が正しい", () => {
    expect(grid.cols).toBe(13);
    expect(grid.rows).toBe(10);
    expect(grid.count).toBe(130);
  });

  it("x は 0 中心の整数間隔、y は上下対称の半整数", () => {
    expect(Math.min(...grid.px)).toBeCloseTo(-6, 12);
    expect(Math.max(...grid.px)).toBeCloseTo(6, 12);
    expect(Math.min(...grid.py)).toBeCloseTo(-4.5, 12);
    expect(Math.max(...grid.py)).toBeCloseTo(4.5, 12);
  });

  it("行 0 が最下段で、行が上がるごとに y が 1 増える", () => {
    for (let r = 1; r < grid.rows; r++) {
      const below = grid.py[(r - 1) * grid.cols];
      const here = grid.py[r * grid.cols];
      expect(here - below).toBeCloseTo(1, 12);
    }
  });

  it("同じ行の隣り合うサイトは x が 1 だけ違う(格子間隔 1)", () => {
    for (let c = 1; c < grid.cols; c++) {
      expect(grid.px[c] - grid.px[c - 1]).toBeCloseTo(1, 12);
    }
  });
});

describe("buildInterstitialGrid — 隙間(セル中心)のサイト", () => {
  const grid = buildSiteGrid(9, 4);
  const inter = buildInterstitialGrid(grid);

  it("サイト数は (cols−1)×(rows−1)", () => {
    expect(inter.cols).toBe(8);
    expect(inter.rows).toBe(7);
    expect(inter.count).toBe(56);
  });

  it("格子点のちょうど中間(x は半整数ずれ・y は整数)に来る", () => {
    expect(inter.px[0]).toBeCloseTo(grid.px[0] + 0.5, 12);
    expect(inter.py[0]).toBeCloseTo(grid.py[0] + 0.5, 12);
    // y は整数(格子点は半整数)
    for (let i = 0; i < inter.count; i++) {
      expect(Math.abs(inter.py[i] - Math.round(inter.py[i]))).toBeLessThan(
        1e-12,
      );
    }
  });
});

describe("VacancyExchange — 空孔機構(§5.2)", () => {
  function make(): VacancyExchange {
    return new VacancyExchange(buildSiteGrid(13, 5), 3, 8, 20470513);
  }

  it("初期配置: 空孔 3 個・B 原子 8 個・残りは A 原子", () => {
    const ex = make();
    let vac = 0;
    let b = 0;
    let a = 0;
    for (let i = 0; i < ex.occupancy.length; i++) {
      if (ex.occupancy[i] === SITE_VACANCY) vac++;
      else if (ex.occupancy[i] === SITE_B) b++;
      else a++;
    }
    expect(vac).toBe(3);
    expect(b).toBe(8);
    expect(a).toBe(130 - 3 - 8);
  });

  it("追跡原子は中央サイトの A 原子から始まる", () => {
    const ex = make();
    expect(ex.occupancy[ex.trackedSite]).toBe(SITE_A);
    expect(ex.trackedHops).toBe(0);
  });

  it("何ステップ進めても空孔の数と原子の種類ごとの数が保存する", () => {
    const ex = make();
    for (let s = 0; s < 3000; s++) ex.step(false);
    let vac = 0;
    let b = 0;
    for (let i = 0; i < ex.occupancy.length; i++) {
      if (ex.occupancy[i] === SITE_VACANCY) vac++;
      else if (ex.occupancy[i] === SITE_B) b++;
    }
    expect(vac).toBe(3);
    expect(b).toBe(8);
    // vacancies 配列と occupancy の整合
    for (let v = 0; v < ex.vacancies.length; v++) {
      expect(ex.occupancy[ex.vacancies[v]]).toBe(SITE_VACANCY);
    }
  });

  it("原子が動くのは空孔と席を交換したときだけ(交換回数 = 動いた原子の数)", () => {
    const ex = make();
    for (let s = 0; s < 500; s++) ex.step(false);
    expect(ex.exchanges).toBeGreaterThan(0);
    // 追跡原子の跳躍回数は交換回数よりずっと少ない(空孔待ちがある)
    expect(ex.trackedHops).toBeLessThan(ex.exchanges);
  });

  it("追跡原子は空孔が隣に来た瞬間だけ動く", () => {
    const ex = make();
    const cols = ex.grid.cols;
    for (let s = 0; s < 2000; s++) {
      const before = ex.trackedSite;
      const neighbors = [before + 1, before - 1, before + cols, before - cols];
      const vacancyAdjacent = neighbors.some(
        (n) =>
          n >= 0 && n < ex.occupancy.length && ex.occupancy[n] === SITE_VACANCY,
      );
      ex.step(false);
      if (ex.trackedSite !== before) {
        // 動いたなら、動く前に空孔が隣にいたはず
        expect(vacancyAdjacent).toBe(true);
      }
    }
  });

  it("追跡原子は十分な時間で必ず動く(空孔がやってくる)", () => {
    const ex = make();
    for (let s = 0; s < 20000; s++) ex.step(false);
    expect(ex.trackedHops).toBeGreaterThan(0);
  });

  it("シード固定: init() で完全に同じ初期配置へ戻る(§8.2)", () => {
    const ex = make();
    const snapshot = Uint8Array.from(ex.occupancy);
    for (let s = 0; s < 1000; s++) ex.step(false);
    ex.init();
    expect(Array.from(ex.occupancy)).toEqual(Array.from(snapshot));
    expect(ex.trackedHops).toBe(0);
    expect(ex.exchanges).toBe(0);
  });
});

describe("InterstitialWalkers — 侵入型(§5.2)", () => {
  it("空孔を待たずに動く(短時間で全員が動く)", () => {
    const grid = buildInterstitialGrid(buildSiteGrid(13, 5));
    const w = new InterstitialWalkers(grid, 3, 7);
    const start = Int32Array.from(w.site);
    for (let s = 0; s < 200; s++) w.step(false);
    let moved = 0;
    for (let i = 0; i < w.site.length; i++) {
      if (w.site[i] !== start[i]) moved++;
    }
    expect(moved).toBe(3);
  });

  it("同じサイトに 2 個以上入らない(排他)", () => {
    const grid = buildInterstitialGrid(buildSiteGrid(13, 5));
    const w = new InterstitialWalkers(grid, 5, 7);
    for (let s = 0; s < 2000; s++) {
      w.step(false);
      const seen = new Set<number>();
      for (let i = 0; i < w.site.length; i++) {
        expect(seen.has(w.site[i])).toBe(false);
        seen.add(w.site[i]);
      }
    }
  });

  it("シード固定: init() で同じ初期配置へ戻る", () => {
    const grid = buildInterstitialGrid(buildSiteGrid(13, 5));
    const w = new InterstitialWalkers(grid, 4, 7);
    const snapshot = Int32Array.from(w.site);
    for (let s = 0; s < 500; s++) w.step(false);
    w.init();
    expect(Array.from(w.site)).toEqual(Array.from(snapshot));
  });
});
