"""thumb-spinodal.py — スピノーダル分解のサムネイル(topicThumbs.ts)の迷路を生成する

カーン・ヒリアード方程式(f(c) = c²(1−c)²、μ = f'(c) − κ∇²c)を周期境界の
格子で半陰的フーリエ・スペクトル法で解き、B リッチ相 {c > 1/2} の境界を
マーチング・スクエアで多角形にして、SVG の path の d 属性を標準出力に書く。
迷路の見た目は記事(仕様書 09)の図版と同じ方程式から来ている。

使い方(numpy が必要):
    python3 scripts/thumb-spinodal.py > /tmp/d.txt
出力を src/components/topicThumbs.ts の SPINODAL_PATH に貼る。
"""

import numpy as np

NX, NY = 96, 60  # 計算格子(サムネイルの枠 180 × 105 と同じ縦横比)
KAPPA = 2.5  # 勾配エネルギー係数(帯の幅を決める)
DT = 0.5
STEPS = 400
SEED = 11
UPSAMPLE = 2  # 等高線を取る前にフーリエ補間で細かくする倍率
FX, FY, FW, FH = 10.0, 10.0, 180.0, 105.0  # viewBox 200 × 125 の中の枠
TOLERANCE = 0.35  # 折れ線の間引き(ダグラス・ポーカー)の許容誤差 [viewBox 単位]
LEVEL = 0.5


def simulate() -> np.ndarray:
    rng = np.random.default_rng(SEED)
    c = 0.5 + 0.02 * (rng.random((NY, NX)) - 0.5)
    kx = 2 * np.pi * np.fft.fftfreq(NX)
    ky = 2 * np.pi * np.fft.fftfreq(NY)
    k2 = kx[None, :] ** 2 + ky[:, None] ** 2
    denom = 1 + DT * KAPPA * k2**2
    for _ in range(STEPS):
        fp = 2 * c * (1 - c) * (1 - 2 * c)
        c = np.real(np.fft.ifft2((np.fft.fft2(c) - DT * k2 * np.fft.fft2(fp)) / denom))
    spec = np.fft.fftshift(np.fft.fft2(c))
    big = np.zeros((NY * UPSAMPLE, NX * UPSAMPLE), dtype=complex)
    oy, ox = (NY * UPSAMPLE - NY) // 2, (NX * UPSAMPLE - NX) // 2
    big[oy : oy + NY, ox : ox + NX] = spec
    return np.real(np.fft.ifft2(np.fft.ifftshift(big))) * UPSAMPLE**2


def trace(c: np.ndarray) -> list:
    """{c > LEVEL} の境界を閉じた折れ線の列で返す(外周を A 相で埋めて必ず閉じる)"""
    ny0, nx0 = c.shape
    v = np.zeros((ny0 + 2, nx0 + 2))
    v[1:-1, 1:-1] = c
    ny, nx = v.shape
    sx, sy = FW / (nx - 1), FH / (ny - 1)

    def point(key):
        kind, i, j = key
        if kind == "h":
            a, b = v[j, i], v[j, i + 1]
            return (FX + (i + (LEVEL - a) / (b - a)) * sx, FY + j * sy)
        a, b = v[j, i], v[j + 1, i]
        return (FX + i * sx, FY + (j + (LEVEL - a) / (b - a)) * sy)

    table = {
        1: [("L", "B")], 2: [("B", "R")], 3: [("L", "R")], 4: [("R", "T")],
        6: [("B", "T")], 7: [("L", "T")], 8: [("T", "L")], 9: [("T", "B")],
        11: [("T", "R")], 12: [("R", "L")], 13: [("R", "B")], 14: [("B", "L")],
    }
    adj: dict = {}
    for j in range(ny - 1):
        for i in range(nx - 1):
            q = [v[j, i] > LEVEL, v[j, i + 1] > LEVEL, v[j + 1, i + 1] > LEVEL, v[j + 1, i] > LEVEL]
            idx = q[0] | (q[1] << 1) | (q[2] << 2) | (q[3] << 3)
            if idx in (0, 15):
                continue
            edges = {"B": ("h", i, j), "R": ("v", i + 1, j), "T": ("h", i, j + 1), "L": ("v", i, j)}
            if idx in (5, 10):
                center = (v[j, i] + v[j, i + 1] + v[j + 1, i + 1] + v[j + 1, i]) / 4 > LEVEL
                if idx == 5:
                    pairs = [("L", "T"), ("R", "B")] if center else [("L", "B"), ("R", "T")]
                else:
                    pairs = [("B", "L"), ("T", "R")] if center else [("B", "R"), ("T", "L")]
            else:
                pairs = table[idx]
            for a, b in pairs:
                adj.setdefault(edges[a], []).append(edges[b])
                adj.setdefault(edges[b], []).append(edges[a])
    loops, seen = [], set()
    for start in adj:
        if start in seen:
            continue
        loop, prev, cur = [start], None, start
        seen.add(start)
        while True:
            nxt = [k for k in adj[cur] if k != prev and k not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            loop.append(cur)
            seen.add(cur)
        loops.append([point(k) for k in loop])
    return loops


def douglas_peucker(pts: list, tol: float) -> list:
    if len(pts) < 3:
        return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    dx, dy = x1 - x0, y1 - y0
    norm = (dx * dx + dy * dy) ** 0.5 or 1e-12
    dists = [abs(dy * (px - x0) - dx * (py - y0)) / norm for px, py in pts[1:-1]]
    k = int(np.argmax(dists)) + 1
    if dists[k - 1] > tol:
        return douglas_peucker(pts[: k + 1], tol)[:-1] + douglas_peucker(pts[k:], tol)
    return [pts[0], pts[-1]]


def simplify_closed(loop: list) -> list:
    p0 = loop[0]
    far = max(range(len(loop)), key=lambda k: (loop[k][0] - p0[0]) ** 2 + (loop[k][1] - p0[1]) ** 2)
    a = douglas_peucker(loop[: far + 1], TOLERANCE)
    b = douglas_peucker(loop[far:] + [loop[0]], TOLERANCE)
    return a[:-1] + b[:-1]


def area(loop: list) -> float:
    return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(loop, loop[1:] + loop[:1]))) / 2


def fmt(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".")


def main() -> None:
    parts = []
    for loop in trace(simulate()):
        if area(loop) < 6:
            continue
        pts = simplify_closed(loop)
        parts.append("M" + " ".join(f"{fmt(x)} {fmt(y)}" for x, y in pts) + "Z")
    print("".join(parts))


if __name__ == "__main__":
    main()
