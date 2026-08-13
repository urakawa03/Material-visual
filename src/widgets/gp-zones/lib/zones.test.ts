/**
 * zones.test.ts — GP ゾーン形成モデルの単体テスト(記事仕様書 07 §5.4)
 */

import { describe, expect, it } from "vitest";
import {
  SITE_SOLUTE,
  SITE_VACANCY,
  ZoneLattice,
  type ZoneParams,
  secondsPerSweep,
} from "./zones";
import { KELVIN, vacancyEq } from "./constants";

const COLS = 56;
const ROWS = 34;
const N_SOLUTE = 130;
const N_VAC = 8;
const SEED = 40129;

/** 焼入れで凍結された空孔濃度(図3 の急冷で得られる程度) */
const CV_QUENCHED = 1.7e-5;

function make(): ZoneLattice {
  return new ZoneLattice(COLS, ROWS, N_SOLUTE, N_VAC, SEED);
}

function run(lat: ZoneLattice, p: ZoneParams, sweeps: number): void {
  for (let i = 0; i < sweeps; i++) lat.sweep(p);
  lat.updateClusters();
}

function count(lat: ZoneLattice, state: number): number {
  let n = 0;
  for (let s = 0; s < lat.sites; s++) if (lat.site[s] === state) n++;
  return n;
}

const P: ZoneParams = { tempK: 20 + KELVIN, cv: CV_QUENCHED, aniso: true };

describe("格子の保存則と再現性", () => {
  it("溶質と空孔の数は跳躍しても変わらない", () => {
    const lat = make();
    expect(count(lat, SITE_SOLUTE)).toBe(N_SOLUTE);
    expect(count(lat, SITE_VACANCY)).toBe(N_VAC);
    run(lat, P, 2000);
    expect(count(lat, SITE_SOLUTE)).toBe(N_SOLUTE);
    expect(count(lat, SITE_VACANCY)).toBe(N_VAC);
  });

  it("シード固定で完全に再現する(§8.2)", () => {
    const a = make();
    const b = make();
    run(a, P, 1500);
    run(b, P, 1500);
    expect(Array.from(a.site)).toEqual(Array.from(b.site));
  });

  it("reset で初期配置に戻る", () => {
    const lat = make();
    const initial = Array.from(lat.site);
    run(lat, P, 800);
    lat.reset();
    expect(Array.from(lat.site)).toEqual(initial);
  });
});

describe("クラスタリング(GP ゾーンの誕生)", () => {
  it("時間が経つと溶質がクラスタに取り込まれていく", () => {
    const lat = make();
    lat.updateClusters();
    const before = lat.stats();
    run(lat, P, 50000);
    const after = lat.stats();
    expect(after.clusteredFraction).toBeGreaterThan(
      before.clusteredFraction + 0.4,
    );
    expect(after.maxZone).toBeGreaterThan(before.maxZone);
    expect(after.zoneCount).toBeGreaterThan(0);
  });

  it("異方性 on では板状(横長)、off では等方的になる", () => {
    const aniso = make();
    const iso = make();
    run(aniso, P, 50000);
    run(iso, { ...P, aniso: false }, 50000);
    expect(aniso.meanAspect()).toBeGreaterThan(iso.meanAspect());
    expect(aniso.meanAspect()).toBeGreaterThan(1.5);
  });
});

describe("時間換算 — 過剰空孔がなければ室温では何も起きない(§5.3 の回収)", () => {
  const sites = COLS * ROWS;

  it("平衡空孔では 1 スイープあたりの実時間が桁違いに長い", () => {
    const quenched = secondsPerSweep(sites, N_VAC, P);
    const equilibrium = secondsPerSweep(sites, N_VAC, {
      ...P,
      cv: vacancyEq(20 + KELVIN),
    });
    expect(equilibrium / quenched).toBeGreaterThan(1e6);
  });

  it("焼入れままの室温なら、ゾーン形成が現実的な時間(日オーダー以内)で進む", () => {
    const t = secondsPerSweep(sites, N_VAC, P) * 50000;
    expect(t).toBeGreaterThan(3600);
    expect(t).toBeLessThan(30 * 86400);
  });

  it("温度を上げると 1 スイープあたりの実時間が短くなる", () => {
    const cold = secondsPerSweep(sites, N_VAC, P);
    const hot = secondsPerSweep(sites, N_VAC, { ...P, tempK: 150 + KELVIN });
    expect(hot).toBeLessThan(cold / 100);
  });
});
