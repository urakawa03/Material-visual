/**
 * structurefactor.test.ts — 構造因子・消滅則・粉末図形の単体テスト
 * (仕様書 08 §5.8 T1〜T4・T6〜T9)
 *
 * 最重要は T1: 単原子の体心・面心立方で「F = 0 ⇔ 逆格子空間の記事の
 * isAllowed が偽」— 格子の言葉(05)と構造因子の言葉(本記事)が同じ答えを
 * 出すことの担保。
 */

import { describe, expect, it } from "vitest";
import { isAllowed } from "../../reciprocal-lattice/lattice";
import { powderRings, twoThetaDeg } from "../../ewald-sphere/ewald";
import { xrayFormFactor, neutronLength } from "./formfactors";
import {
  ALLOYS,
  CSCL,
  CU,
  FE,
  FE_AS_SC,
  KCL,
  NACL,
  SI,
  SIMPLE_CUBIC,
  atomsPerCell,
  buildSites,
  cellImages,
  orderedAlloy,
  type CrystalStructure,
} from "./structures";
import {
  applyWavelength,
  intensityTerms,
  isExtinct,
  lorentzPolarization,
  maxIndexFor,
  multiplicity,
  phasorChain,
  powderPattern,
  powderRingBase,
  structureFactor,
  structureFactor2,
} from "./structurefactor";
import { RULES, checkRule } from "./rules";

/** Cu Kα₁(仕様書 08 §2.3 の既定波長) */
const CU_KA = 0.15406;
/** 図1・図6 の 2θ の上限 */
const TWO_THETA_MAX = 140;
/** T1〜T4 で調べる指数の範囲 */
const N = 4;

function* allHkl(n: number): Generator<[number, number, number]> {
  for (let h = -n; h <= n; h++) {
    for (let k = -n; k <= n; k++) {
      for (let l = -n; l <= n; l++) {
        yield [h, k, l];
      }
    }
  }
}

function absF(
  st: CrystalStructure,
  h: number,
  k: number,
  l: number,
  s = 0,
): number {
  return Math.sqrt(structureFactor2(st, h, k, l, s, "xray"));
}

describe("T1: 単原子の体心・面心立方 — 格子の言葉と構造因子の言葉が一致する", () => {
  it("体心立方(Fe): F = 0 ⇔ isAllowed('bcc') が偽(全点・s = 0 と s > 0)", () => {
    for (const [h, k, l] of allHkl(N)) {
      for (const s of [0, 3.7]) {
        expect(isExtinct(FE, h, k, l, s, "xray"), `${h}${k}${l}`).toBe(
          !isAllowed("bcc", h, k, l),
        );
      }
    }
  });

  it("面心立方(Cu): F = 0 ⇔ isAllowed('fcc') が偽(全点・s = 0 と s > 0)", () => {
    for (const [h, k, l] of allHkl(N)) {
      for (const s of [0, 3.7]) {
        expect(isExtinct(CU, h, k, l, s, "xray"), `${h}${k}${l}`).toBe(
          !isAllowed("fcc", h, k, l),
        );
      }
    }
  });

  it("体心立方を「単純立方の格子 + 2 原子の基底」と見ても答えは同じ", () => {
    // 図2 の 2 つの見方: 原子の並びが同じなので F も完全に同じ
    expect(atomsPerCell(FE_AS_SC)).toBe(2);
    for (const [h, k, l] of allHkl(N)) {
      const a = structureFactor(FE, h, k, l, 0, "xray");
      const b = structureFactor(FE_AS_SC, h, k, l, 0, "xray");
      expect(b.re).toBeCloseTo(a.re, 12);
      expect(b.im).toBeCloseTo(a.im, 12);
    }
  });

  it("許される反射の大きさは体心 2f・面心 4f(式 E4)", () => {
    const fFe = xrayFormFactor("Fe", 0);
    const fCu = xrayFormFactor("Cu", 0);
    expect(absF(FE, 1, 1, 0)).toBeCloseTo(2 * fFe, 10);
    expect(absF(CU, 1, 1, 1)).toBeCloseTo(4 * fCu, 10);
    expect(absF(CU, 2, 0, 0)).toBeCloseTo(4 * fCu, 10);
  });
});

describe("T2: ダイヤモンド構造(Si)— 格子では説明できない消滅", () => {
  const f = xrayFormFactor("Si", 0);

  it("偶奇混在で 0、全偶数かつ h+k+l ≡ 2 (mod 4) で 0、全奇数で 4√2 f、≡ 0 (mod 4) で 8f", () => {
    for (const [h, k, l] of allHkl(N)) {
      const odd = [h, k, l].map((v) => Math.abs(v) % 2);
      const mixed = !(odd[0] === odd[1] && odd[1] === odd[2]);
      const F = absF(SI, h, k, l);
      if (mixed) {
        expect(F, `${h}${k}${l}`).toBeLessThan(1e-9);
      } else if (odd[0] === 1) {
        expect(F, `${h}${k}${l}`).toBeCloseTo(4 * Math.SQRT2 * f, 9);
      } else if ((((h + k + l) % 4) + 4) % 4 === 2) {
        expect(F, `${h}${k}${l}`).toBeLessThan(1e-9);
      } else {
        expect(F, `${h}${k}${l}`).toBeCloseTo(8 * f, 9);
      }
    }
  });

  it("(200)・(222)・(420) は格子(面心立方)では許されるのに消える", () => {
    for (const [h, k, l] of [
      [2, 0, 0],
      [2, 2, 2],
      [4, 2, 0],
    ] as const) {
      expect(isAllowed("fcc", h, k, l)).toBe(true);
      expect(isExtinct(SI, h, k, l, 0, "xray")).toBe(true);
    }
    for (const [h, k, l] of [
      [1, 1, 1],
      [2, 2, 0],
      [3, 1, 1],
      [4, 0, 0],
    ] as const) {
      expect(isExtinct(SI, h, k, l, 0, "xray")).toBe(false);
    }
  });
});

describe("T3: 2 種類の原子(NaCl・CsCl)", () => {
  it("NaCl: 全偶数 4(f_Na + f_Cl)、全奇数 4|f_Na − f_Cl|、混在 0", () => {
    const s = 2.9;
    const fNa = xrayFormFactor("Na", s);
    const fCl = xrayFormFactor("Cl", s);
    for (const [h, k, l] of allHkl(N)) {
      const odd = [h, k, l].map((v) => Math.abs(v) % 2);
      const F = absF(NACL, h, k, l, s);
      if (!(odd[0] === odd[1] && odd[1] === odd[2])) {
        expect(F).toBeLessThan(1e-9);
      } else if (odd[0] === 0) {
        expect(F).toBeCloseTo(4 * (fNa + fCl), 9);
      } else {
        expect(F).toBeCloseTo(4 * Math.abs(fNa - fCl), 9);
      }
    }
  });

  it("CsCl: h+k+l 偶数で f_Cs + f_Cl、奇数で |f_Cs − f_Cl|(消える点はない)", () => {
    const fCs = xrayFormFactor("Cs", 0);
    const fCl = xrayFormFactor("Cl", 0);
    for (const [h, k, l] of allHkl(N)) {
      const even = (((h + k + l) % 2) + 2) % 2 === 0;
      const F = absF(CSCL, h, k, l);
      expect(F).toBeCloseTo(even ? fCs + fCl : Math.abs(fCs - fCl), 9);
    }
  });

  it("CsCl 型で 2 つのサイトの f が等しければ、体心立方に帰着する", () => {
    const sameAtoms: CrystalStructure = {
      ...CSCL,
      sites: buildSites("sc", [
        { dx: 0, dy: 0, dz: 0, occ: [{ el: "Cs", p: 1 }] },
        { dx: 0.5, dy: 0.5, dz: 0.5, occ: [{ el: "Cs", p: 1 }] },
      ]),
    };
    for (const [h, k, l] of allHkl(N)) {
      expect(isExtinct(sameAtoms, h, k, l, 0, "xray")).toBe(
        !isAllowed("bcc", h, k, l),
      );
    }
  });

  it("KCl は K と Cl の電子数がほぼ等しく、奇数指数の反射がほぼ消える", () => {
    const odd = structureFactor2(KCL, 1, 1, 1, 0, "xray");
    const even = structureFactor2(KCL, 2, 0, 0, 0, "xray");
    // (19 − 17)²/(19 + 17)² ≈ 0.003(K⁺ と Cl⁻ なら 0。中性原子で代用 — 図注)
    expect(odd / even).toBeLessThan(0.005);
  });
});

describe("T4: フリーデル則 — 位相の符号の取り違えの検出", () => {
  it("F(−h −k −l) は F(hkl) の複素共役で、|F|² が等しい", () => {
    const all = [FE, CU, SI, NACL, CSCL, orderedAlloy("Cu3Au", 0.6)];
    for (const st of all) {
      for (const [h, k, l] of allHkl(3)) {
        const p = structureFactor(st, h, k, l, 1.5, "xray");
        const q = structureFactor(st, -h, -k, -l, 1.5, "xray");
        expect(q.re, `${st.id} ${h}${k}${l}`).toBeCloseTo(p.re, 12);
        expect(q.im, `${st.id} ${h}${k}${l}`).toBeCloseTo(-p.im, 12);
      }
    }
  });

  it("Si の全奇数の反射は複素数(位相が 0 でも π でもない)", () => {
    const F = structureFactor(SI, 1, 1, 1, 0, "xray");
    const f = xrayFormFactor("Si", 0);
    // F = 4f(1 − i)
    expect(F.re).toBeCloseTo(4 * f, 10);
    expect(F.im).toBeCloseTo(-4 * f, 10);
  });
});

describe("T6: 線の位置(Cu Kα)— エヴァルト球の記事との整合", () => {
  const cases = [
    { st: CU, hkl: [1, 1, 1], tt: 43.32 },
    { st: FE, hkl: [1, 1, 0], tt: 44.66 },
    { st: SI, hkl: [1, 1, 1], tt: 28.44 },
  ] as const;

  it("Cu (111) 43.32°・Fe (110) 44.66°・Si (111) 28.44°(0.01° 以内)", () => {
    for (const { st, hkl, tt } of cases) {
      const t = intensityTerms(st, hkl[0], hkl[1], hkl[2], CU_KA);
      expect(t).not.toBeNull();
      expect(Math.abs((t?.twoTheta ?? 0) - tt), st.id).toBeLessThan(0.01);
    }
  });

  it("粉末図形の線の位置は ewald.ts の twoThetaDeg と完全に一致する", () => {
    for (const st of [FE, CU, SI]) {
      const lines = powderPattern(
        st,
        CU_KA,
        maxIndexFor(st.a, CU_KA, TWO_THETA_MAX),
      );
      for (const line of lines) {
        expect(line.twoTheta).toBe(twoThetaDeg(line.d, CU_KA));
      }
    }
  });
});

describe("T7: 多重度", () => {
  it("立方晶の値({100} 6、{110} 12、{111} 8、{210} 24、{211} 24、{220} 12、{311} 24、{222} 8)", () => {
    const table: ReadonlyArray<readonly [number, number, number, number]> = [
      [1, 0, 0, 6],
      [1, 1, 0, 12],
      [1, 1, 1, 8],
      [2, 1, 0, 24],
      [2, 1, 1, 24],
      [2, 2, 0, 12],
      [3, 1, 1, 24],
      [2, 2, 2, 8],
      [3, 2, 1, 48],
    ];
    for (const [h, k, l, m] of table) {
      expect(multiplicity(h, k, l), `${h}${k}${l}`).toBe(m);
      // 符号・並びを変えても同じ族
      expect(multiplicity(-l, h, -k)).toBe(m);
    }
  });

  it("環のまとめ方と多重度が powderRings と一致する(単純立方・体心・面心)", () => {
    const pairs = [
      { st: SIMPLE_CUBIC, lattice: "sc" },
      { st: FE, lattice: "bcc" },
      { st: CU, lattice: "fcc" },
    ] as const;
    for (const { st, lattice } of pairs) {
      const maxIndex = 4;
      const ours = powderRingBase(st, maxIndex).filter((r) => r.mNonzero > 0);
      const theirs = powderRings(lattice, st.a, maxIndex);
      expect(ours.map((r) => r.n2)).toEqual(theirs.map((r) => r.n2));
      expect(ours.map((r) => r.m)).toEqual(theirs.map((r) => r.multiplicity));
      expect(ours.map((r) => r.mNonzero)).toEqual(
        theirs.map((r) => r.multiplicity),
      );
      // 代表の指数も同じ
      expect(ours.map((r) => [r.h, r.k, r.l])).toEqual(
        theirs.map((r) => [r.h, r.k, r.l]),
      );
    }
  });

  it("環の多重度は重なる族の多重度の和({300} + {221} = 30)", () => {
    const ring = powderRingBase(SIMPLE_CUBIC, 3).find((r) => r.n2 === 9);
    expect(ring?.forms.map((f) => [f.h, f.k, f.l, f.m])).toEqual([
      [3, 0, 0, 6],
      [2, 2, 1, 24],
    ]);
    expect(ring?.m).toBe(30);
  });
});

describe("強度(式 E5)と粉末図形", () => {
  it("L_p = (1 + cos²2θ)/(sin²θ cosθ)。中性子は偏光の項を除く", () => {
    const th = 20;
    const r = (th * Math.PI) / 180;
    const lorentz = 1 / (Math.sin(r) ** 2 * Math.cos(r));
    expect(lorentzPolarization(th, "xray")).toBeCloseTo(
      (1 + Math.cos(2 * r) ** 2) * lorentz,
      10,
    );
    expect(lorentzPolarization(th, "neutron")).toBeCloseTo(lorentz, 10);
  });

  it("I = |F|² × m × L_p で、届かない反射と 000 は null", () => {
    const t = intensityTerms(SI, 2, 2, 0, CU_KA);
    expect(t).not.toBeNull();
    if (t) {
      expect(t.m).toBe(12);
      expect(t.I).toBeCloseTo(t.F2 * t.m * t.Lp, 6);
      expect(t.s).toBeCloseTo(1 / (2 * t.d), 12);
    }
    expect(intensityTerms(SI, 0, 0, 0, CU_KA)).toBeNull();
    // d = 0.5431/√300 ≈ 0.031 nm < λ/2 → 届かない
    expect(intensityTerms(SI, 10, 10, 10, CU_KA)).toBeNull();
  });

  it("環の I は環の全反射の |F|² の和 × L_p", () => {
    const lines = powderPattern(SI, CU_KA, 6);
    const ring = lines.find((r) => r.n2 === 8);
    const t = intensityTerms(SI, 2, 2, 0, CU_KA);
    expect(ring && t).toBeTruthy();
    if (ring && t) expect(ring.I).toBeCloseTo(t.I, 6);
  });

  it("Cu では (111) が最強線になる(図6)", () => {
    const lines = powderPattern(
      CU,
      CU_KA,
      maxIndexFor(CU.a, CU_KA, TWO_THETA_MAX),
    ).filter((r) => r.twoTheta <= TWO_THETA_MAX);
    const strongest = lines.reduce((p, q) => (q.I > p.I ? q : p));
    expect([strongest.h, strongest.k, strongest.l]).toEqual([1, 1, 1]);
  });

  it("Si の「格子では説明できない欠け」は (200)・(222)・(420)・(600)/(442)", () => {
    const lines = powderPattern(
      SI,
      CU_KA,
      maxIndexFor(SI.a, CU_KA, TWO_THETA_MAX),
    ).filter((r) => r.twoTheta <= TWO_THETA_MAX);
    const unexplained = lines
      .filter((r) => r.latticeAllowed && r.mNonzero === 0)
      .map((r) => r.n2);
    expect(unexplained).toEqual([4, 12, 20, 36]);
    // Fe・Cu の欠けはすべて格子で説明できる
    for (const st of [FE, CU]) {
      const ls = powderPattern(st, CU_KA, 7).filter(
        (r) => r.latticeAllowed && r.mNonzero === 0,
      );
      expect(ls).toEqual([]);
    }
  });

  it("applyWavelength は λ に応じて 2θ だけを動かし、|F|² は変えない", () => {
    const base = powderRingBase(SI, 8);
    const a = applyWavelength(base, 0.15406);
    const b = applyWavelength(base, 0.12);
    const ra = a.find((r) => r.n2 === 3);
    const rb = b.find((r) => r.n2 === 3);
    expect(ra && rb).toBeTruthy();
    if (ra && rb) {
      expect(rb.F2).toBe(ra.F2);
      expect(rb.twoTheta).toBeLessThan(ra.twoTheta);
    }
  });
});

describe("T8: 規則化と超格子反射(図7)", () => {
  it("η = 0 で超格子反射はちょうど 0、基本反射は η によらない", () => {
    for (const id of ["CuZn", "Cu3Au"] as const) {
      const st0 = orderedAlloy(id, 0);
      for (const rad of ["xray", "neutron"] as const) {
        expect(structureFactor2(st0, 1, 0, 0, 0, rad), `${id} ${rad}`).toBe(0);
      }
      const fundamental: readonly [number, number, number] =
        ALLOYS[id].disorderedLattice === "bcc" ? [1, 1, 0] : [1, 1, 1];
      const f0 = structureFactor2(st0, ...fundamental, 0, "xray");
      const f1 = structureFactor2(
        orderedAlloy(id, 1),
        ...fundamental,
        0,
        "xray",
      );
      expect(f1).toBeCloseTo(f0, 9);
    }
  });

  it("不規則(η = 0)では消滅則が不規則状態の格子(体心・面心)と一致する", () => {
    for (const id of ["CuZn", "Cu3Au"] as const) {
      const st = orderedAlloy(id, 0);
      for (const [h, k, l] of allHkl(3)) {
        expect(isExtinct(st, h, k, l, 0, "xray")).toBe(
          !isAllowed(ALLOYS[id].disorderedLattice, h, k, l),
        );
      }
    }
  });

  it("超格子反射の強度は η² に比例する(相対 1e-12)", () => {
    for (const id of ["CuZn", "Cu3Au"] as const) {
      for (const rad of ["xray", "neutron"] as const) {
        const i1 = structureFactor2(orderedAlloy(id, 1), 1, 0, 0, 2, rad);
        for (const eta of [0.25, 0.5, 0.75]) {
          const ie = structureFactor2(orderedAlloy(id, eta), 1, 0, 0, 2, rad);
          expect(Math.abs(ie / (eta * eta * i1) - 1)).toBeLessThan(1e-12);
        }
      }
    }
  });

  it("超格子 / 基本の |F|² 比(s = 0、η = 1)が仕様書の表と一致する", () => {
    const ratio = (id: "CuZn" | "Cu3Au", rad: "xray" | "neutron"): number => {
      const st = orderedAlloy(id, 1);
      const fund: readonly [number, number, number] =
        id === "CuZn" ? [1, 1, 0] : [1, 1, 1];
      return (
        structureFactor2(st, 1, 0, 0, 0, rad) /
        structureFactor2(st, ...fund, 0, rad)
      );
    };
    // 表示桁(有効数字 2 桁)で一致
    expect(Number(ratio("CuZn", "xray").toPrecision(2))).toBe(2.9e-4);
    expect(Number(ratio("CuZn", "neutron").toPrecision(2))).toBe(0.023);
    expect(Number(ratio("Cu3Au", "xray").toPrecision(2))).toBe(0.091);
    expect(Number(ratio("Cu3Au", "neutron").toPrecision(1))).toBe(8e-6);
    // X 線と中性子で見え方が逆転する
    expect(ratio("CuZn", "neutron")).toBeGreaterThan(ratio("CuZn", "xray"));
    expect(ratio("Cu3Au", "xray")).toBeGreaterThan(ratio("Cu3Au", "neutron"));
    // 式 E6: CuZn の比は (f_A − f_B)²/(f_A + f_B)²
    const bCu = neutronLength("Cu");
    const bZn = neutronLength("Zn");
    expect(ratio("CuZn", "neutron")).toBeCloseTo(
      ((bCu - bZn) / (bCu + bZn)) ** 2,
      12,
    );
  });

  it("平均組成は η によらない(Cu₃Au は Au 25%)", () => {
    for (const eta of [0, 0.3, 1]) {
      const st = orderedAlloy("Cu3Au", eta);
      let au = 0;
      for (const site of st.sites) {
        for (const o of site.occ) if (o.el === "Au") au += o.p;
      }
      expect(au / st.sites.length).toBeCloseTo(0.25, 12);
    }
  });
});

describe("T9: 図3 の矢の列", () => {
  it("phasorChain の最後の終点は structureFactor と一致する(1e-12)", () => {
    const all = [FE, CU, SI, NACL, CSCL, KCL, orderedAlloy("CuZn", 0.4)];
    for (const st of all) {
      for (const [h, k, l] of allHkl(4)) {
        const chain = phasorChain(st, h, k, l, 0, "xray");
        const F = structureFactor(st, h, k, l, 0, "xray");
        const last = chain[chain.length - 1];
        expect(chain.length).toBe(st.sites.length);
        expect(Math.abs(last.x1 - F.re)).toBeLessThan(1e-12);
        expect(Math.abs(last.y1 - F.im)).toBeLessThan(1e-12);
        // 矢は頭と尾でつながっている
        for (let i = 1; i < chain.length; i++) {
          expect(chain[i].x0).toBe(chain[i - 1].x1);
          expect(chain[i].y0).toBe(chain[i - 1].y1);
        }
      }
    }
  });

  it("Si (200)・(222) では矢が閉じ、(111)・(220) では閉じない", () => {
    const end = (h: number, k: number, l: number): number => {
      const c = phasorChain(SI, h, k, l, 0, "xray");
      const last = c[c.length - 1];
      return Math.hypot(last.x1, last.y1);
    };
    expect(end(2, 0, 0)).toBeLessThan(1e-9);
    expect(end(2, 2, 2)).toBeLessThan(1e-9);
    expect(end(1, 1, 1)).toBeGreaterThan(10);
    expect(end(2, 2, 0)).toBeGreaterThan(10);
  });
});

describe("単位胞の原子(図2)", () => {
  it("単位胞の原子数: Fe 2・Cu 4・Si 8・NaCl 8・CsCl 2(角・辺・面の共有を数える)", () => {
    expect(atomsPerCell(FE)).toBe(2);
    expect(atomsPerCell(CU)).toBe(4);
    expect(atomsPerCell(SI)).toBe(8);
    expect(atomsPerCell(NACL)).toBe(8);
    expect(atomsPerCell(CSCL)).toBe(2);
    // 描く像の数(角 8・面心 6・辺 12・内部)
    expect(cellImages(CU).length).toBe(14);
    expect(cellImages(SI).length).toBe(18);
    expect(cellImages(NACL).length).toBe(27);
  });

  it("Fe の 2 つの見方で原子の並びは 1 つも動かない", () => {
    const key = (st: CrystalStructure): string[] =>
      cellImages(st)
        .map((im) => `${im.x},${im.y},${im.z}`)
        .sort();
    expect(key(FE_AS_SC)).toEqual(key(FE));
  });
});

describe("図4 の規則の候補の照合", () => {
  const expected: ReadonlyArray<readonly [CrystalStructure, string]> = [
    [FE, "odd-sum"],
    [CU, "mixed"],
    [SI, "diamond"],
    [NACL, "mixed"],
    [CSCL, "none"],
  ];

  it("正しい規則だけが全点で一致し、他は食い違う", () => {
    for (const [st, correct] of expected) {
      for (const rule of RULES) {
        const r = checkRule(st, rule, N);
        expect(r.total).toBe(9 * 9 * 9 - 1);
        if (rule.id === correct) {
          expect(r.mismatchCount, `${st.id} ${rule.id}`).toBe(0);
        } else {
          expect(r.mismatchCount, `${st.id} ${rule.id}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("Si に面心の規則を当てると、食い違いの最初の例は (2 0 0) 族", () => {
    const fcc = RULES.find((r) => r.id === "mixed");
    expect(fcc).toBeDefined();
    if (fcc) {
      const r = checkRule(SI, fcc, N);
      const first = r.mismatches[0];
      expect(first.h * first.h + first.k * first.k + first.l * first.l).toBe(4);
      expect(first.actualZero).toBe(true);
    }
  });
});
