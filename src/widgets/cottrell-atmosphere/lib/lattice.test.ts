/**
 * lattice.test.ts — 場の評価の単体テスト(記事仕様 §5.0)
 *
 * 特に座標系の符号規約(y 上向き・引張側は y < 0・U(r, θ=−π/2) < 0)は
 * 符号バグの温床なので必ず検証する(§5.0 で単体テスト推奨とされている)。
 */

import { describe, expect, it } from "vitest";
import {
  C_FAR,
  KB_EV,
  U_BIND_EV,
  agingRecovery,
  agingTau,
  formatDuration,
  hopRate,
} from "./constants";
import {
  SUBSTITUTIONAL_AMP,
  buildEdgeLattice,
  edgeDisplacement,
  equilibriumOccupancy,
  pressureNorm,
  soluteEnergy,
} from "./lattice";

describe("soluteEnergy — 符号規約(§5.0)", () => {
  it("転位直下(θ=−π/2, r=b)で U = −U_b(引張側は安定)", () => {
    expect(soluteEnergy(0, -1)).toBeCloseTo(-U_BIND_EV, 10);
  });

  it("転位直上(θ=+π/2)で U > 0(圧縮側は不安定)", () => {
    expect(soluteEnergy(0, 2)).toBeGreaterThan(0);
  });

  it("すべり面上(θ=0, π)で U = 0", () => {
    expect(soluteEnergy(5, 0)).toBeCloseTo(0, 10);
    expect(soluteEnergy(-5, 0)).toBeCloseTo(0, 10);
  });

  it("1/r で減衰する(遠達性)", () => {
    expect(soluteEnergy(0, -4)).toBeCloseTo(-U_BIND_EV / 4, 10);
  });

  it("コア直上でも発散せず ±U_b で頭打ち(§5.0 クランプ)", () => {
    expect(Math.abs(soluteEnergy(0, -0.01))).toBeLessThanOrEqual(U_BIND_EV);
    expect(soluteEnergy(0, -0.01)).toBeCloseTo(-U_BIND_EV, 10);
  });

  it("置換型(小)は符号が反転し効果が弱まる(§5.3)", () => {
    const below = soluteEnergy(0, -3, SUBSTITUTIONAL_AMP);
    expect(below).toBeGreaterThan(0); // 引張側でむしろ不安定
    expect(Math.abs(below)).toBeCloseTo((0.6 * U_BIND_EV) / 3, 10);
  });
});

describe("pressureNorm — 圧縮/引張の符号(§5.2)", () => {
  it("上側(+y)で正 = 圧縮、下側(−y)で負 = 引張", () => {
    expect(pressureNorm(0, 3)).toBeGreaterThan(0);
    expect(pressureNorm(0, -3)).toBeLessThan(0);
  });
});

describe("equilibriumOccupancy — 飽和つきボルツマン分布(§5.4)", () => {
  it("U = 0 で c = c0", () => {
    expect(equilibriumOccupancy(0, 600, C_FAR)).toBeCloseTo(C_FAR, 12);
  });

  it("低温・強い結合で飽和(c → 1)", () => {
    expect(equilibriumOccupancy(-U_BIND_EV, 300, C_FAR)).toBeGreaterThan(0.99);
  });

  it("高温で雲が蒸発(c → c0 のオーダー)", () => {
    expect(equilibriumOccupancy(-U_BIND_EV, 1200, C_FAR)).toBeLessThan(0.02);
  });

  it("常に 0 < c < 1", () => {
    for (const u of [-0.5, -0.1, 0, 0.1, 0.5]) {
      for (const t of [300, 600, 1200]) {
        const c = equilibriumOccupancy(u, t, C_FAR);
        expect(c).toBeGreaterThan(0);
        expect(c).toBeLessThan(1);
      }
    }
  });
});

describe("hopRate / agingTau — アレニウス式(§5.5, §5.8)", () => {
  it("ホップ率は温度とともに桁で増える", () => {
    expect(hopRate(400)).toBeGreaterThan(1);
    expect(hopRate(900) / hopRate(400)).toBeGreaterThan(1e5);
  });

  it("τ(170 °C) は 10 分前後(§5.8: 分単位)", () => {
    const tau = agingTau(170 + 273.15);
    expect(tau).toBeGreaterThan(5 * 60);
    expect(tau).toBeLessThan(15 * 60);
  });

  it("室温では年オーダー(§5.8)", () => {
    const tau = agingTau(20 + 273.15);
    expect(tau).toBeGreaterThan(365 * 86400);
  });

  it("回復率 W は 0 → 1 に単調(t^(2/3) 則)", () => {
    const T = 443.15;
    expect(agingRecovery(0, T)).toBe(0);
    const w1 = agingRecovery(60, T);
    const w2 = agingRecovery(1200, T);
    const w3 = agingRecovery(1e6, T);
    expect(w1).toBeGreaterThan(0);
    expect(w2).toBeGreaterThan(w1);
    expect(w3).toBeGreaterThan(w2);
    expect(w3).toBeLessThanOrEqual(1);
  });
});

describe("edgeDisplacement — 変位場(§5.2)", () => {
  it("上側(+y)は水平圧縮(∂u_x/∂x < 0)", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    edgeDisplacement(-0.5, 2, a);
    edgeDisplacement(0.5, 2, b);
    expect(b.x - a.x).toBeLessThan(0);
  });

  it("下側(−y)は水平引張(∂u_x/∂x > 0)", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    edgeDisplacement(-0.5, -2, a);
    edgeDisplacement(0.5, -2, b);
    expect(b.x - a.x).toBeGreaterThan(0);
  });

  it("分枝切断(x < 0)をまたぐ相対すべりは b", () => {
    const above = { x: 0, y: 0 };
    const below = { x: 0, y: 0 };
    edgeDisplacement(-10, 0.01, above);
    edgeDisplacement(-10, -0.01, below);
    expect(above.x - below.x).toBeCloseTo(1, 2);
  });
});

describe("buildEdgeLattice", () => {
  it("原子数・すべり面上の原子なし・中央対称", () => {
    const lat = buildEdgeLattice(27, 16);
    expect(lat.count).toBe(27 * 16);
    for (let i = 0; i < lat.count; i++) {
      expect(Math.abs(lat.refY[i])).toBeGreaterThanOrEqual(0.5);
    }
    expect(Math.min(...lat.refX)).toBe(-13);
    expect(Math.max(...lat.refX)).toBe(13);
  });
});

describe("formatDuration(§5.5)", () => {
  it("秒/分/時間/日/年で自動整形する", () => {
    expect(formatDuration(4.1)).toBe("4.1 秒");
    expect(formatDuration(90)).toBe("1.5 分");
    expect(formatDuration(7200)).toBe("2 時間");
    expect(formatDuration(86400 * 3)).toBe("3 日");
    expect(formatDuration(86400 * 365 * 2.3)).toBe("2.3 年");
  });

  it("kB T との整合(参考): 室温 kBT ≈ 0.025 eV", () => {
    expect(KB_EV * 293).toBeCloseTo(0.0252, 3);
  });
});
