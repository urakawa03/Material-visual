/**
 * contour.ts — 濃度場の等高線を SVG の path にする(静的図 S-2・S-3 用)
 *
 * 静的図の組織(迷路・島)は手描きせず、図版と同じカーン・ヒリアード方程式の
 * 解からビルド時に作る(サムネイルの scripts/thumb-spinodal.py と同じ考え方)。
 * {c > level} の境界をマーチング・スクエア(辺の上で線形補間)で閉じた折れ線に
 * し、ダグラス・ポーカー法で間引く。外周は level より低い値で囲んでから
 * たどるので、枠に触れる領域も枠に沿って必ず閉じる。
 *
 * 純関数(DOM なし)。Astro のフロントマター(ビルド時)から呼ぶ。
 */

type Point = [number, number];

/** 辺の識別子: 横の辺 h(i, j)・縦の辺 v(i, j) */
function edgeKey(kind: 0 | 1, i: number, j: number, stride: number): number {
  return (j * stride + i) * 2 + kind;
}

/**
 * n × n の場 c(行優先・行 0 が上)の {c > level} の境界を、
 * 左上 (x0, y0)・一辺 size の正方形に収めた SVG の path(d 属性)で返す。
 * 穴があるので fill-rule="evenodd" で塗ること。
 */
export function contourPath(
  c: Float64Array,
  n: number,
  level: number,
  x0: number,
  y0: number,
  size: number,
  tolerance = 0.35,
): string {
  // 外周を level より低い値で 1 格子ぶん囲む
  const m = n + 2;
  const v = new Float64Array(m * m).fill(level - 1);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) v[(y + 1) * m + x + 1] = c[y * n + x];
  }
  const cell = size / n;
  // 格子点 (i, j)(拡張後の添字)の座標: 元の格子点の中心
  const px = (i: number): number => x0 + (i - 0.5) * cell;
  const py = (j: number): number => y0 + (j - 0.5) * cell;
  const stride = m;
  const adj = new Map<number, number[]>();
  const pointOf = new Map<number, Point>();

  const edgePoint = (kind: 0 | 1, i: number, j: number): number => {
    const key = edgeKey(kind, i, j, stride);
    if (!pointOf.has(key)) {
      if (kind === 0) {
        const a = v[j * m + i];
        const b = v[j * m + i + 1];
        const t = (level - a) / (b - a);
        pointOf.set(key, [px(i + t), py(j)]);
      } else {
        const a = v[j * m + i];
        const b = v[(j + 1) * m + i];
        const t = (level - a) / (b - a);
        pointOf.set(key, [px(i), py(j + t)]);
      }
    }
    return key;
  };
  const link = (a: number, b: number): void => {
    const la = adj.get(a);
    if (la) la.push(b);
    else adj.set(a, [b]);
    const lb = adj.get(b);
    if (lb) lb.push(a);
    else adj.set(b, [a]);
  };

  for (let j = 0; j < m - 1; j++) {
    for (let i = 0; i < m - 1; i++) {
      const q0 = v[j * m + i] > level ? 1 : 0;
      const q1 = v[j * m + i + 1] > level ? 1 : 0;
      const q2 = v[(j + 1) * m + i + 1] > level ? 1 : 0;
      const q3 = v[(j + 1) * m + i] > level ? 1 : 0;
      const idx = q0 | (q1 << 1) | (q2 << 2) | (q3 << 3);
      if (idx === 0 || idx === 15) continue;
      // 4 辺: 上(h i, j)・右(v i+1, j)・下(h i, j+1)・左(v i, j)
      const T = (): number => edgePoint(0, i, j);
      const R = (): number => edgePoint(1, i + 1, j);
      const B = (): number => edgePoint(0, i, j + 1);
      const Lf = (): number => edgePoint(1, i, j);
      switch (idx) {
        case 1:
        case 14:
          link(Lf(), T());
          break;
        case 2:
        case 13:
          link(T(), R());
          break;
        case 3:
        case 12:
          link(Lf(), R());
          break;
        case 4:
        case 11:
          link(R(), B());
          break;
        case 6:
        case 9:
          link(T(), B());
          break;
        case 7:
        case 8:
          link(Lf(), B());
          break;
        case 5:
        case 10: {
          // 鞍点: セルの中心の値で分け方を決める
          const center =
            (v[j * m + i] +
              v[j * m + i + 1] +
              v[(j + 1) * m + i + 1] +
              v[(j + 1) * m + i]) /
              4 >
            level;
          if ((idx === 5) === center) {
            link(Lf(), B());
            link(T(), R());
          } else {
            link(Lf(), T());
            link(R(), B());
          }
          break;
        }
      }
    }
  }

  // つながりをたどって閉じた折れ線にする
  const seen = new Set<number>();
  const parts: string[] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop: Point[] = [];
    let prev = -1;
    let cur = start;
    for (;;) {
      seen.add(cur);
      const p = pointOf.get(cur);
      if (p) loop.push(p);
      const next = (adj.get(cur) ?? []).find((k) => k !== prev && !seen.has(k));
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    if (loop.length < 3) continue;
    const pts = simplifyClosed(loop, tolerance);
    parts.push(
      "M" + pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(" ") + "Z",
    );
  }
  return parts.join("");
}

function fmt(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/** ダグラス・ポーカー法(開いた折れ線) */
function douglasPeucker(pts: Point[], tol: number): Point[] {
  if (pts.length < 3) return pts;
  const [x0, y0] = pts[0];
  const [x1, y1] = pts[pts.length - 1];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const norm = Math.hypot(dx, dy) || 1e-12;
  let best = -1;
  let bestD = -1;
  for (let k = 1; k < pts.length - 1; k++) {
    const d = Math.abs(dy * (pts[k][0] - x0) - dx * (pts[k][1] - y0)) / norm;
    if (d > bestD) {
      bestD = d;
      best = k;
    }
  }
  if (bestD > tol) {
    const a = douglasPeucker(pts.slice(0, best + 1), tol);
    const b = douglasPeucker(pts.slice(best), tol);
    return a.slice(0, -1).concat(b);
  }
  return [pts[0], pts[pts.length - 1]];
}

/** 閉じた折れ線の間引き(最も遠い点で 2 つに分けて開いた折れ線として処理) */
function simplifyClosed(loop: Point[], tol: number): Point[] {
  const [sx, sy] = loop[0];
  let far = 0;
  let farD = -1;
  for (let k = 0; k < loop.length; k++) {
    const d = (loop[k][0] - sx) ** 2 + (loop[k][1] - sy) ** 2;
    if (d > farD) {
      farD = d;
      far = k;
    }
  }
  const a = douglasPeucker(loop.slice(0, far + 1), tol);
  const b = douglasPeucker(loop.slice(far).concat([loop[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}
