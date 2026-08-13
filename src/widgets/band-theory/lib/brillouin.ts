/**
 * brillouin.ts — 面心立方(FCC)結晶の第 1 ブリルアンゾーン(仕様書 11 §5.5)
 *
 * FCC の逆格子は体心立方(BCC)配列である(逆格子空間記事 §5.7 の入れ替わり)。
 * その第 1 ブリルアンゾーン = 逆格子点のウィグナー・ザイツ胞は **切頂八面体**
 * で、2π/a を単位に取ると
 *
 *   頂点 W: (±1, ±1/2, 0) とその巡回置換(24 個)
 *   正方形の面 6 枚(中心 X = (±1, 0, 0))
 *   六角形の面 8 枚(中心 L = (±1/2, ±1/2, ±1/2))
 *
 * となる。座標はすべて 2π/a を単位とする無次元量で返す(描画側でそのまま
 * ワールド座標に使える)。純関数のみ。
 */

export interface Vec3Lit {
  x: number;
  y: number;
  z: number;
}

/** 頂点 W: (±1, ±1/2, 0) の全巡回置換・符号違い(24 個) */
export function bzVertices(): Vec3Lit[] {
  const out: Vec3Lit[] = [];
  const patterns: Array<[number, number, number]> = [
    [1, 0.5, 0],
    [0.5, 1, 0],
    [1, 0, 0.5],
    [0, 1, 0.5],
    [0.5, 0, 1],
    [0, 0.5, 1],
  ];
  for (const [px, py, pz] of patterns) {
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        for (const sz of [1, -1]) {
          const v = { x: px * sx, y: py * sy, z: pz * sz };
          if (
            !out.some(
              (o) =>
                Math.abs(o.x - v.x) < 1e-9 &&
                Math.abs(o.y - v.y) < 1e-9 &&
                Math.abs(o.z - v.z) < 1e-9,
            )
          ) {
            out.push(v);
          }
        }
      }
    }
  }
  return out;
}

/** 面の法線(正方形 6 枚 = X 方向、六角形 8 枚 = L 方向)と面までの距離 */
function faceNormals(): Array<{ n: Vec3Lit; d: number }> {
  const faces: Array<{ n: Vec3Lit; d: number }> = [];
  // 正方形の面: 中心 (±1, 0, 0) など。法線・面上の点の内積 = 1
  for (const axis of [0, 1, 2]) {
    for (const s of [1, -1]) {
      const n = { x: 0, y: 0, z: 0 };
      if (axis === 0) n.x = s;
      else if (axis === 1) n.y = s;
      else n.z = s;
      faces.push({ n, d: 1 });
    }
  }
  // 六角形の面: 法線 (±1, ±1, ±1)、面上の点との内積 = 1.5
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      for (const sz of [1, -1]) {
        faces.push({ n: { x: sx, y: sy, z: sz }, d: 1.5 });
      }
    }
  }
  return faces;
}

/**
 * 第 1 ブリルアンゾーンの面(頂点を面上で反時計回りに並べたもの)。
 * 正方形 6 枚 + 六角形 8 枚 = 14 枚。
 */
export function bzFaces(): Vec3Lit[][] {
  const verts = bzVertices();
  const out: Vec3Lit[][] = [];
  for (const { n, d } of faceNormals()) {
    const on = verts.filter(
      (v) => Math.abs(v.x * n.x + v.y * n.y + v.z * n.z - d) < 1e-9,
    );
    if (on.length < 3) continue;
    out.push(sortAroundNormal(on, n));
  }
  return out;
}

/** 面上の頂点を法線まわりの角度で並べ替える(扇状三角形分割のため) */
function sortAroundNormal(vs: Vec3Lit[], n: Vec3Lit): Vec3Lit[] {
  const center = vs.reduce(
    (acc, v) => ({
      x: acc.x + v.x / vs.length,
      y: acc.y + v.y / vs.length,
      z: acc.z + v.z / vs.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  // 法線に直交する基底 (u, w) を作る
  const len = Math.hypot(n.x, n.y, n.z);
  const nz = { x: n.x / len, y: n.y / len, z: n.z / len };
  const ref =
    Math.abs(nz.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = cross(ref, nz);
  const un = norm(u);
  const w = cross(nz, un);
  return [...vs].sort((a, b) => angle(a) - angle(b));

  function angle(v: Vec3Lit): number {
    const dx = v.x - center.x;
    const dy = v.y - center.y;
    const dz = v.z - center.z;
    return Math.atan2(
      dx * w.x + dy * w.y + dz * w.z,
      dx * un.x + dy * un.y + dz * un.z,
    );
  }
}

function cross(a: Vec3Lit, b: Vec3Lit): Vec3Lit {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function norm(a: Vec3Lit): Vec3Lit {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

/** 面の稜線を [x0,y0,z0, x1,y1,z1, …] の平坦配列で返す(重複は除く) */
export function bzEdgePositions(): number[] {
  const out: number[] = [];
  const seen = new Set<string>();
  const key = (a: Vec3Lit, b: Vec3Lit): string => {
    const ka = `${a.x},${a.y},${a.z}`;
    const kb = `${b.x},${b.y},${b.z}`;
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  for (const face of bzFaces()) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      const k = key(a, b);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  return out;
}

/**
 * FCC 結晶の逆格子点。2π/a を単位に取ると、FCC の逆格子ベクトル
 * b₁ = (−1,1,1), b₂ = (1,−1,1), b₃ = (1,1,−1) の整数結合は
 * 「x, y, z の偶奇がそろった整数点」= 立方体の辺 2 の **体心立方(BCC)配列**
 * になる(逆格子空間記事 §5.7 の FCC ⇄ BCC の入れ替わり)。
 * |n| ≤ range の範囲でその点を返す。maxRadius を渡すと原点からの距離が
 * それ以下の点だけに絞る(図5 では第 1 ブリルアンゾーンに面する近傍だけを
 * 描くために使う)。
 */
export function fccReciprocalPoints(
  range: number,
  maxRadius = Number.POSITIVE_INFINITY,
): Vec3Lit[] {
  const out: Vec3Lit[] = [];
  for (let i = -range; i <= range; i++) {
    for (let j = -range; j <= range; j++) {
      for (let k = -range; k <= range; k++) {
        // x, y, z の偶奇がそろっているものだけが逆格子点(BCC 配列)
        const parity = Math.abs(i % 2);
        if (Math.abs(j % 2) !== parity || Math.abs(k % 2) !== parity) continue;
        if (Math.hypot(i, j, k) > maxRadius + 1e-9) continue;
        out.push({ x: i, y: j, z: k });
      }
    }
  }
  return out;
}

/** 対称点の座標(2π/a 単位) */
export const SYMMETRY_POINTS: ReadonlyArray<{ label: string; p: Vec3Lit }> = [
  { label: "Γ", p: { x: 0, y: 0, z: 0 } },
  { label: "X", p: { x: 1, y: 0, z: 0 } },
  { label: "L", p: { x: 0.5, y: 0.5, z: 0.5 } },
];
