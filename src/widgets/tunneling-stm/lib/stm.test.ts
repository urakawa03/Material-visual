/**
 * stm.test.ts — STM の模型の単体テスト(仕様書 14 §5.8)
 *
 * T4: フィードバック。平らな表面で 0 < g < 1 は単調収束、1 < g < 2 は符号を
 *     変えながら収束、g > 2 は発散(図5 の「にじみ・振動」が模型から出ること)
 * T5: 凹凸。原子間隔 0.5 nm で 42 ± 5 pm、0.29 nm で 3 pm 未満(ノイズなし)
 * T6: 先端の原子の割合。φ = 4.5 eV、0.25 nm 差で 99.5%(正しくは 99.57%)、
 *     0.1 nm あたりの倍率 8.8
 * T7: 図6 の像。V < 0 で A 原子の位置、V > 0 で B 原子の位置が極大。原子の位置は不変
 * あわせて、図5 の走査の受け入れ基準(既定で接触しない・「速い」+ 低ゲインで
 * 吸着原子の手前で接触・g > 2 で縞・読み取りの凹凸・reset の再現性)を確かめる。
 */

import { describe, expect, it } from "vitest";
import {
  I_SET_NA,
  IMAGE_PIXELS,
  IMAGE_SIZE_NM,
  NOISE_SEED,
  SPACING_METAL_NM,
  SPACING_SEMI_NM,
  SURFACE_SEED,
  WORK_FUNCTION_EV,
  Z_REF_NM,
} from "./constants";
import {
  AB_SPACING_NM,
  apexFraction,
  computeConstantCurrentImage,
  constantCurrentHeight,
  createSurface,
  currentRatio,
  feedbackUpdate,
  gapCurrent,
  imageRange,
  latticeCorrugation,
  StmScanner,
  tipCurrent,
  TWO_KAPPA,
  windowWeights,
  type ImageRange,
  type Surface,
} from "./stm";
import { kappa } from "./tunneling";

describe("T4: フィードバック z ← z + g(ln I − ln I_set)/(2κ)", () => {
  /** 平らな表面(ln I が z に厳密に比例する): I = I_ref e^{−2κ(z − z_ref)} */
  function errors(gain: number, steps: number, e0 = 0.05): number[] {
    let z = Z_REF_NM - e0; // 0.05 nm 近すぎる位置から始める
    const out: number[] = [];
    for (let k = 0; k < steps; k++) {
      const I = gapCurrent(z);
      z = feedbackUpdate(z, I, gain);
      out.push(z - Z_REF_NM);
    }
    return out;
  }

  it("誤差は 1 回ごとにちょうど (1 − g) 倍になる", () => {
    for (const g of [0.3, 0.5, 1.5, 2.4]) {
      const e = errors(g, 6);
      for (let k = 1; k < e.length; k++) {
        expect(e[k] / e[k - 1]).toBeCloseTo(1 - g, 9);
      }
    }
  });

  /** 誤差が倍精度で表せる大きさ(z = 0.6 nm に対して 1e-12 nm)のあいだだけ調べる */
  const RESOLVABLE = 1e-12;

  it("0 < g < 1 は符号を変えずに単調に収束する(にじみの側)", () => {
    for (const g of [0.05, 0.3, 0.5, 0.9]) {
      const e = errors(g, 40);
      expect(Math.abs(e[e.length - 1])).toBeLessThan(Math.abs(e[0]));
      for (let k = 1; k < e.length && Math.abs(e[k]) > RESOLVABLE; k++) {
        expect(Math.sign(e[k])).toBe(Math.sign(e[0]));
        expect(Math.abs(e[k])).toBeLessThan(Math.abs(e[k - 1]));
      }
    }
  });

  it("1 < g < 2 は符号を変えながら収束する(振動しながら収束)", () => {
    for (const g of [1.2, 1.5, 1.9]) {
      const e = errors(g, 40);
      expect(Math.abs(e[e.length - 1])).toBeLessThan(Math.abs(e[0]));
      for (let k = 1; k < e.length && Math.abs(e[k]) > RESOLVABLE; k++) {
        expect(Math.sign(e[k])).toBe(-Math.sign(e[k - 1]));
        expect(Math.abs(e[k])).toBeLessThan(Math.abs(e[k - 1]));
      }
    }
  });

  it("g > 2 は発散する(|1 − g|¹⁰ ≥ 10 となる g ≥ 2.26 で誤差が 10 ステップで 10 倍以上)", () => {
    for (const g of [2.3, 2.5]) {
      const e = errors(g, 11, 1e-4);
      expect(Math.abs(e[10]) / Math.abs(e[0])).toBeGreaterThan(10);
      for (let k = 1; k < e.length; k++) {
        expect(Math.sign(e[k])).toBe(-Math.sign(e[k - 1]));
      }
    }
    // g = 2.1 でも誤差は育ち続ける(10 ステップで 2.6 倍)
    const e = errors(2.1, 11, 1e-4);
    expect(Math.abs(e[10]) / Math.abs(e[0])).toBeCloseTo(1.1 ** 10, 6);
  });
});

describe("T5: 表面の凹凸(定電流の等高線、ノイズなし)", () => {
  it("原子間隔 0.5 nm で 42 ± 5 pm", () => {
    const c = latticeCorrugation(SPACING_SEMI_NM) * 1000;
    expect(c).toBeGreaterThan(37);
    expect(c).toBeLessThan(47);
  });

  it("原子間隔 0.29 nm で 3 pm 未満(単純な模型では金属の原子は見えにくい)", () => {
    const c = latticeCorrugation(SPACING_METAL_NM) * 1000;
    expect(c).toBeLessThan(3);
    expect(c).toBeGreaterThan(0);
  });

  it("等高線の高さで電流が設定値になっている", () => {
    const s = createSurface(SPACING_SEMI_NM);
    for (const [x, y] of [
      [1.1, 1.1],
      [1.35, 1.1],
      [1.35, 1.35],
    ]) {
      const z = constantCurrentHeight(s, x, y);
      expect(tipCurrent(s, x, y, z)).toBeCloseTo(I_SET_NA, 8);
    }
  });

  it("原子の真上は約 0.6 nm、空孔の上はくぼみ、吸着原子の上は約 0.2 nm 高い", () => {
    const s = createSurface(SPACING_SEMI_NM, {
      defects: true,
      seed: SURFACE_SEED,
    });
    const v = s.vacancy;
    const ad = s.adatom;
    if (!v || !ad) throw new Error("欠陥がない");
    const zTop = constantCurrentHeight(s, v.x + 2 * SPACING_SEMI_NM, v.y);
    expect(zTop).toBeCloseTo(0.604, 2);
    expect(zTop - constantCurrentHeight(s, v.x, v.y)).toBeGreaterThan(0.1);
    expect(constantCurrentHeight(s, ad.x, ad.y) - zTop).toBeCloseTo(0.2, 1);
  });
});

describe("T6: 距離の感度と先端の原子の割合(図4)", () => {
  it("φ = 4.5 eV で κ = 10.87 nm⁻¹、0.1 nm 近づけると電流が 8.8 倍", () => {
    expect(kappa(WORK_FUNCTION_EV)).toBeCloseTo(10.868, 3);
    expect(currentRatio(WORK_FUNCTION_EV, 0.1)).toBeCloseTo(8.79, 2);
    expect(Number(currentRatio(WORK_FUNCTION_EV, 0.1).toFixed(1))).toBe(8.8);
    expect(TWO_KAPPA).toBeCloseTo(21.736, 3);
  });

  it("先端の原子と 0.25 nm 奥の原子では電流が約 230 倍違い、先端の原子が 99.5% 以上を運ぶ", () => {
    expect(currentRatio(WORK_FUNCTION_EV, 0.25)).toBeCloseTo(229, 0);
    const f = apexFraction(WORK_FUNCTION_EV);
    // 仕様書の「99.5%」は比を 200 倍と丸めた値。式どおりの値は 99.57%
    expect(f).toBeGreaterThanOrEqual(0.995);
    expect(f).toBeCloseTo(0.99565, 5);
  });

  it("仕事関数が小さいほど距離への感度が下がり、割合も下がる", () => {
    expect(currentRatio(3, 0.1)).toBeLessThan(currentRatio(6, 0.1));
    expect(apexFraction(3)).toBeLessThan(apexFraction(6));
    expect(apexFraction(3)).toBeGreaterThan(0.98);
  });

  it("すき間 z_ref = 0.6 nm で 1 nA、傾き −2κ の直線(対数)", () => {
    expect(gapCurrent(Z_REF_NM)).toBeCloseTo(1, 12);
    const slope = (Math.log(gapCurrent(1.0)) - Math.log(gapCurrent(0.5))) / 0.5;
    expect(slope).toBeCloseTo(-TWO_KAPPA, 9);
  });
});

describe("T7: バイアスで見える原子が入れ替わる(図6)", () => {
  function atomHeights(s: Surface, bias: number): { a: number; b: number } {
    const w = windowWeights(bias, { a: 0, b: 0 });
    s.kindWeight[0] = w.a;
    s.kindWeight[1] = w.b;
    // 像の中央の A 原子と、その右隣の B 原子の真上の高さ
    const i = Math.round(s.cells / 2);
    const j = i % 2 === 0 ? i : i + 1; // (i + j) 偶数 = A
    const xa = s.offset + i * s.spacing;
    const ya = s.offset + j * s.spacing;
    const za = constantCurrentHeight(s, xa, ya);
    const zb = constantCurrentHeight(s, xa + s.spacing, ya);
    return { a: za, b: zb };
  }

  it("V < 0 では A 原子の位置が、V > 0 では B 原子の位置が高く写る", () => {
    const s = createSurface(AB_SPACING_NM, { checkerboard: true });
    for (const bias of [-2, -1.5, -0.5, -0.3]) {
      const h = atomHeights(s, bias);
      expect(h.a).toBeGreaterThan(h.b + 0.01);
    }
    for (const bias of [0.3, 0.5, 1.5, 2]) {
      const h = atomHeights(s, bias);
      expect(h.b).toBeGreaterThan(h.a + 0.01);
    }
  });

  it("窓に入る状態の量: V < 0 では A だけ、V > 0 ではほぼ B だけ", () => {
    const w = { a: 0, b: 0 };
    windowWeights(-1.5, w);
    expect(w.a).toBeCloseTo(0.952, 2);
    // B の山(E_F の 1.2 eV 上)の裾がわずかに E_F の下へはみ出すだけ
    expect(w.b).toBeLessThan(1e-4);
    windowWeights(1.5, w);
    expect(w.b).toBeCloseTo(0.841, 2);
    expect(w.a).toBeLessThan(1e-3);
    windowWeights(-1.0, w);
    expect(w.a).toBeCloseTo(0.5, 2);
  });

  it("像の極大が、V < 0 では A 原子の位置に、V > 0 では B 原子の位置に来る", () => {
    const s = createSurface(AB_SPACING_NM, { checkerboard: true });
    const img = new Float64Array(IMAGE_PIXELS * IMAGE_PIXELS);
    const px = IMAGE_SIZE_NM / IMAGE_PIXELS;
    for (const [bias, kindExpected] of [
      [-1.5, 0],
      [1.5, 1],
    ] as const) {
      const w = windowWeights(bias, { a: 0, b: 0 });
      s.kindWeight[0] = w.a;
      s.kindWeight[1] = w.b;
      computeConstantCurrentImage(s, img);
      // 像の内側の極大(8 近傍のどれよりも低くない画素)を探し、いちばん近い
      // 格子点の種類を調べる。格子点は画素の境目に来るので、極大は 2×2 画素の
      // 同じ高さの組として現れる(1e-9 nm より小さな差は同じ高さとみなす)
      let maxima = 0;
      for (let r = 2; r < IMAGE_PIXELS - 2; r++) {
        for (let c = 2; c < IMAGE_PIXELS - 2; c++) {
          const v = img[r * IMAGE_PIXELS + c];
          let isMax = true;
          for (let dr = -1; dr <= 1 && isMax; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (
                (dr || dc) &&
                img[(r + dr) * IMAGE_PIXELS + c + dc] > v + 1e-9
              ) {
                isMax = false;
                break;
              }
            }
          }
          if (!isMax) continue;
          maxima++;
          const x = (c + 0.5) * px;
          const y = IMAGE_SIZE_NM - (r + 0.5) * px;
          const i = Math.round((x - s.offset) / s.spacing);
          const j = Math.round((y - s.offset) / s.spacing);
          const kind = (((i + j) % 2) + 2) % 2;
          expect(kind).toBe(kindExpected);
          // 極大は格子点の真上(画素の大きさの範囲内)
          expect(Math.abs(x - (s.offset + i * s.spacing))).toBeLessThan(px);
          expect(Math.abs(y - (s.offset + j * s.spacing))).toBeLessThan(px);
        }
      }
      expect(maxima).toBeGreaterThan(10);
    }
  });

  it("バイアスを変えても原子の位置は動かない(動くのは重みだけ)", () => {
    const s = createSurface(AB_SPACING_NM, { checkerboard: true });
    const before = {
      offset: s.offset,
      spacing: s.spacing,
      kind: s.kind.slice(),
    };
    for (const bias of [-2, -0.3, 0.3, 2]) {
      const w = windowWeights(bias, { a: 0, b: 0 });
      s.kindWeight[0] = w.a;
      s.kindWeight[1] = w.b;
    }
    expect(s.offset).toBe(before.offset);
    expect(s.spacing).toBe(before.spacing);
    expect(Array.from(s.kind)).toEqual(Array.from(before.kind));
  });
});

describe("図5 の走査(受け入れ基準)", () => {
  function scan(
    spacing: number,
    gain: number,
    substeps: number,
    noiseRms?: number,
  ): StmScanner {
    const surface = createSurface(spacing, {
      defects: true,
      seed: SURFACE_SEED,
    });
    const sc = new StmScanner(surface, {
      gain,
      substeps,
      noiseRms,
      seed: NOISE_SEED,
    });
    sc.runAll();
    return sc;
  }

  function range(sc: StmScanner): ImageRange {
    return imageRange(sc.image, sc.pixels, sc.size, sc.surface, {
      lo: 0,
      hi: 0,
      valid: false,
    });
  }

  it("既定(ゲイン 0.5・中)では接触せず、実際の凹凸の読み取りが 42 ± 8 pm", () => {
    const sc = scan(SPACING_SEMI_NM, 0.5, 4);
    expect(sc.done).toBe(true);
    expect(sc.contacts).toBe(0);
    const r = range(sc);
    expect(r.valid).toBe(true);
    const pm = (r.hi - r.lo) * 1000;
    expect(pm).toBeGreaterThan(34);
    expect(pm).toBeLessThan(50);
    expect(sc.status()).toBe("tracking");
  });

  it("0.29 nm の表面では凹凸の読み取りが 5 pm 未満(ノイズ込み)", () => {
    const sc = scan(SPACING_METAL_NM, 0.5, 4);
    const pm = (range(sc).hi - range(sc).lo) * 1000;
    expect(pm).toBeLessThan(5);
  });

  it("「速い」+ いちばん弱いゲインでは、吸着原子の手前で接触する", () => {
    const surface = createSurface(SPACING_SEMI_NM, {
      defects: true,
      seed: SURFACE_SEED,
    });
    const sc = new StmScanner(surface, {
      gain: 0.05,
      substeps: 1,
      seed: NOISE_SEED,
    });
    const ad = surface.adatom;
    if (!ad) throw new Error("吸着原子がない");
    let firstContactX = Number.NaN;
    let firstContactY = Number.NaN;
    while (!sc.done) {
      const x = sc.pixelX(sc.col);
      const y = sc.pixelY(sc.row);
      const before = sc.contacts;
      sc.stepPixel();
      if (sc.contacts > before && Number.isNaN(firstContactX)) {
        firstContactX = x;
        firstContactY = y;
      }
    }
    expect(sc.contacts).toBeGreaterThan(0);
    // 走査の向き(+x)で吸着原子の中心より手前、0.4 nm 以内
    expect(firstContactX).toBeLessThan(ad.x);
    expect(ad.x - firstContactX).toBeLessThan(0.4);
    expect(Math.abs(firstContactY - ad.y)).toBeLessThan(0.2);
  });

  it("弱すぎるゲインでは「にじみ」と判定される", () => {
    const surface = createSurface(SPACING_SEMI_NM, {
      defects: true,
      seed: SURFACE_SEED,
    });
    const sc = new StmScanner(surface, {
      gain: 0.1,
      substeps: 4,
      seed: NOISE_SEED,
    });
    for (let i = 0; i < 20 * IMAGE_PIXELS; i++) sc.stepPixel();
    expect(sc.status()).toBe("lag");
  });

  /** 走査の向きに隣り合う画素の高さの差の実効値 [nm](縞の強さ。欠陥のまわりは除く) */
  function roughness(sc: StmScanner): number {
    let sum = 0;
    let count = 0;
    const ad = sc.surface.adatom;
    const v = sc.surface.vacancy;
    for (let r = 0; r < sc.pixels; r++) {
      for (let c = 1; c < sc.pixels; c++) {
        const x = sc.pixelX(c);
        const y = sc.pixelY(r);
        if (ad && Math.hypot(x - ad.x, y - ad.y) < 0.8) continue;
        if (v && Math.hypot(x - v.x, y - v.y) < 0.8) continue;
        const d = sc.image[r * sc.pixels + c] - sc.image[r * sc.pixels + c - 1];
        sum += d * d;
        count++;
      }
    }
    return Math.sqrt(sum / count);
  }

  it("ゲイン 2.1 以上では振動が育ち、像が縞だらけになる", () => {
    const good = roughness(scan(SPACING_SEMI_NM, 0.5, 4));
    for (const [g, n] of [
      [2.1, 4],
      [2.1, 1],
      [2.5, 4],
    ] as const) {
      const sc = scan(SPACING_SEMI_NM, g, n);
      expect(roughness(sc)).toBeGreaterThan(3 * good);
    }
    // 振動が育って探針が表面にぶつかる(接触 → 引き上げ、をくり返す)
    expect(scan(SPACING_SEMI_NM, 2.2, 4).contacts).toBeGreaterThan(100);
    // 走査の途中の状態は「振動」または「接触!」
    const surface = createSurface(SPACING_SEMI_NM, {
      defects: true,
      seed: SURFACE_SEED,
    });
    const sc = new StmScanner(surface, {
      gain: 2.2,
      substeps: 1,
      seed: NOISE_SEED,
    });
    for (let i = 0; i < 10 * IMAGE_PIXELS; i++) sc.stepPixel();
    expect(["oscillation", "contact"]).toContain(sc.status());
  });

  it("ゲイン 1.2〜1.9 では振動しながら収束し、像は崩れない", () => {
    for (const g of [1.2, 1.9]) {
      const sc = scan(SPACING_SEMI_NM, g, 4);
      expect(sc.contacts).toBe(0);
      const pm = (range(sc).hi - range(sc).lo) * 1000;
      expect(pm).toBeLessThan(60);
    }
  });

  it("reset で同じ表面・同じノイズ列から描き直される", () => {
    const surface = createSurface(SPACING_SEMI_NM, {
      defects: true,
      seed: SURFACE_SEED,
    });
    const sc = new StmScanner(surface, {
      gain: 0.5,
      substeps: 4,
      seed: NOISE_SEED,
    });
    sc.runAll();
    const first = sc.image.slice();
    sc.reset();
    expect(Number.isNaN(sc.image[0])).toBe(true);
    expect(sc.status()).toBe("idle");
    sc.runAll();
    expect(Array.from(sc.image)).toEqual(Array.from(first));
  });

  it("1 フレームの計算量: 1 画素 = サブステップ × 49 原子以内(+ 吸着原子)", () => {
    const sc = scan(SPACING_SEMI_NM, 0.5, 12);
    expect(sc.scanned).toBe(IMAGE_PIXELS * IMAGE_PIXELS);
    expect(sc.trajCount).toBeLessThanOrEqual(IMAGE_PIXELS * 12 + 1);
  });
});
