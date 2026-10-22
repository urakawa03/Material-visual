/**
 * topicThumbs.ts — テーマカードの静的 SVG サムネイル(仕様書 §9.1)
 *
 * 意味パレット(§6.2)で描いた簡単な模式図。色は CSS 変数経由で参照する
 * ので、トークンを変えればサムネイルも追従する(§13)。
 * ビルド時にサーバ側で文字列として生成される(クライアント JS ゼロ)。
 */

const VIEW_W = 200;
const VIEW_H = 125;

function svg(body: string): string {
  return `<svg class="topic-card-thumb" viewBox="0 0 ${VIEW_W} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${body}</svg>`;
}

function dots(
  points: ReadonlyArray<readonly [number, number]>,
  r: number,
  fill: string,
  opacity = 1,
): string {
  const circles = points
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`)
    .join("");
  return `<g fill="${fill}" opacity="${opacity}">${circles}</g>`;
}

function grid(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  sx: number,
  sy: number,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let y = y0; y <= y1; y += sy) {
    for (let x = x0; x <= x1; x += sx) {
      pts.push([x, y]);
    }
  }
  return pts;
}

/** 座標を小数 1 桁の文字列にする(SVG を短く保つ) */
function n1(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/** (x0, y0) → (x1, y1) の矢(線 + 塗りの三角の矢じり — 母体仕様 §6.5) */
function arrow(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width = 2.5,
  head = 8,
): string {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const bx = x1 - head * Math.cos(a);
  const by = y1 - head * Math.sin(a);
  const px = -0.5 * head * Math.sin(a);
  const py = 0.5 * head * Math.cos(a);
  return (
    `<line x1="${n1(x0)}" y1="${n1(y0)}" x2="${n1(bx)}" y2="${n1(by)}" stroke="${color}" stroke-width="${width}"/>` +
    `<path d="M ${n1(x1)} ${n1(y1)} L ${n1(bx + px)} ${n1(by + py)} L ${n1(bx - px)} ${n1(by - py)} Z" fill="${color}"/>`
  );
}

/** 1. 逆格子空間: 実格子(密)⇄ 逆格子(疎)の対(仕様書 05 §6.1 S1) */
function reciprocalLattice(): string {
  const real = grid(24, 42, 68, 86, 22, 22);
  const recip = grid(124, 30, 188, 94, 32, 32);
  return svg(
    dots(real, 3.4, "var(--mat-matrix)") +
      dots(recip, 3.2, "var(--mat-recip)") +
      // 中央の双方向矢印
      `<g stroke="var(--mat-recip)" stroke-width="2" fill="var(--mat-recip)">` +
      `<line x1="86" y1="64" x2="106" y2="64"/>` +
      `<path d="M 86 64 l 7 -4 v 8 Z"/>` +
      `<path d="M 106 64 l -7 -4 v 8 Z"/>` +
      `</g>`,
  );
}

/** 2. エヴァルト球: 球面 + 逆格子点 + 入射/回折ビーム */
function ewaldSphere(): string {
  const pts = grid(20, 22, 180, 102, 32, 27);
  return svg(
    dots(pts, 2.6, "var(--mat-recip)", 0.5) +
      `<circle cx="84" cy="62" r="46" fill="var(--mat-sphere-fill)" stroke="var(--mat-sphere-line)" stroke-width="2"/>` +
      `<line x1="10" y1="62" x2="84" y2="62" stroke="var(--mat-beam)" stroke-width="2.5"/>` +
      `<line x1="84" y1="62" x2="116" y2="27" stroke="var(--mat-beam)" stroke-width="2.5"/>` +
      `<circle cx="130" cy="62" r="4" fill="var(--mat-recip)"/>` +
      `<circle cx="116" cy="27" r="4" fill="var(--mat-recip)"/>`,
  );
}

/**
 * 3. 構造因子と消滅則: 複素平面で頭と尾をつないだ 4 本の矢(4 原子の散乱波)が
 * 閉じて和がゼロになる様子と、強さ(円の大きさ)の違う逆格子点の並び。
 * 現れない点は中抜きの小円(逆格子空間記事と同じ描き方 — 仕様書 08 §6.1 S-1)
 */
function structureFactor(): string {
  const ox = 40;
  const oy = 90;
  const len = 42;
  let x = ox;
  let y = oy;
  let phasors = "";
  for (const deg of [20, 110, 200, 290]) {
    const a = (deg * Math.PI) / 180;
    const nx = x + len * Math.cos(a);
    const ny = y - len * Math.sin(a);
    phasors += arrow(x, y, nx, ny, "var(--mat-matrix)", 3, 9);
    x = nx;
    y = ny;
  }
  const spots: ReadonlyArray<readonly [number, number, number]> = [
    [122, 28, 6.5],
    [166, 28, 4],
    [144, 50, 3],
    [188, 50, 5.5],
    [122, 72, 4.5],
    [166, 72, 6.5],
    [144, 94, 5.5],
    [188, 94, 3],
  ];
  const absent: ReadonlyArray<readonly [number, number]> = [
    [144, 28],
    [188, 28],
    [122, 50],
    [166, 50],
    [144, 72],
    [188, 72],
    [122, 94],
    [166, 94],
  ];
  return svg(
    `<g stroke="var(--color-hairline)" stroke-width="1.5">` +
      `<line x1="12" y1="${oy}" x2="100" y2="${oy}"/>` +
      `<line x1="${ox}" y1="14" x2="${ox}" y2="114"/>` +
      `</g>` +
      phasors +
      `<circle cx="${ox}" cy="${oy}" r="5.5" fill="none" stroke="var(--mat-beam)" stroke-width="2.5"/>` +
      `<g fill="var(--mat-recip)">` +
      spots
        .map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`)
        .join("") +
      `</g>` +
      `<g fill="none" stroke="var(--mat-recip)" stroke-width="1.5">` +
      absent
        .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="2.6"/>`)
        .join("") +
      `</g>`,
  );
}

/** 4. フランク・リード源: 両端を固定された転位の張り出しとループ */
function frankReadSource(): string {
  return svg(
    `<ellipse cx="100" cy="70" rx="62" ry="36" fill="none" stroke="var(--mat-defect)" stroke-width="2" opacity="0.45"/>` +
      `<path d="M 56 84 Q 100 26 144 84" fill="none" stroke="var(--mat-defect)" stroke-width="2.5"/>` +
      `<circle cx="56" cy="84" r="4.5" fill="var(--mat-recip)"/>` +
      `<circle cx="144" cy="84" r="4.5" fill="var(--mat-recip)"/>`,
  );
}

/** 5. コットレル雰囲気: 刃状転位(⊥)の下に集まる溶質原子 */
function cottrellAtmosphere(): string {
  const matrixPts = grid(24, 20, 176, 108, 30, 29);
  const solutePts: ReadonlyArray<readonly [number, number]> = [
    [86, 78],
    [100, 84],
    [114, 78],
    [92, 94],
    [108, 94],
    [100, 106],
  ];
  return svg(
    dots(matrixPts, 3, "var(--mat-matrix)", 0.5) +
      `<g stroke="var(--mat-defect)" stroke-width="3.5" stroke-linecap="round">` +
      `<line x1="100" y1="38" x2="100" y2="62"/>` +
      `<line x1="84" y1="62" x2="116" y2="62"/>` +
      `</g>` +
      dots(solutePts, 3.8, "var(--mat-solute)"),
  );
}

/**
 * 6. カーケンドール効果: 拡散対(左 Cu | 右 真鍮)と、初期界面から
 * 真鍮側へずれた目印。色は記事本体と同じ約束(A = --mat-matrix、
 * B = --mat-second、目印 = --color-accent — 仕様書 06 §5.0)。
 */
function kirkendallEffect(): string {
  const aPts = grid(22, 24, 82, 104, 20, 20);
  const bPts = grid(118, 24, 178, 104, 20, 20);
  return svg(
    dots(aPts, 4, "var(--mat-matrix)", 0.9) +
      dots(bPts, 4, "var(--mat-second)", 0.9) +
      // 初期界面(破線)と、真鍮側へ動いた目印(accent)
      `<line x1="100" y1="14" x2="100" y2="111" stroke="var(--mat-recip)" stroke-width="1.5" stroke-dasharray="5 4"/>` +
      `<line x1="122" y1="18" x2="122" y2="107" stroke="var(--color-accent)" stroke-width="3"/>` +
      // Zn は左へ、Cu は右へ(足の速さが違うので長さも違う)
      `<g stroke-width="2.5" fill="none">` +
      `<line x1="150" y1="14" x2="62" y2="14" stroke="var(--mat-second)"/>` +
      `<line x1="76" y1="118" x2="124" y2="118" stroke="var(--mat-matrix)"/>` +
      `</g>` +
      `<path d="M 62 14 l 7 -4 v 8 Z" fill="var(--mat-second)"/>` +
      `<path d="M 124 118 l -7 -4 v 8 Z" fill="var(--mat-matrix)"/>`,
  );
}

/** 7. GP ゾーン: 母相格子の中の円板状クラスター */
function gpZones(): string {
  const matrixPts = grid(20, 18, 180, 108, 26, 22.5);
  return svg(
    dots(matrixPts, 3, "var(--mat-matrix)", 0.55) +
      `<rect x="58" y="59" width="84" height="7" rx="3.5" fill="var(--mat-precip)"/>` +
      dots(
        [
          [48, 62.5],
          [152, 62.5],
        ],
        4,
        "var(--mat-precip)",
      ),
  );
}

/** 8. オストワルド成長: 大粒子が育ち小粒子が消える */
function ostwaldRipening(): string {
  return svg(
    `<g fill="var(--mat-precip)">` +
      `<circle cx="70" cy="66" r="27"/>` +
      `<circle cx="136" cy="40" r="11" opacity="0.75"/>` +
      `<circle cx="150" cy="92" r="7" opacity="0.6"/>` +
      `<circle cx="106" cy="103" r="4.5" opacity="0.5"/>` +
      `</g>`,
  );
}

/**
 * スピノーダル分解の迷路(B リッチ相の輪郭)。カーン・ヒリアード方程式を
 * 解いた濃度場の等高線から scripts/thumb-spinodal.py で生成した(手描きでは
 * ない — 記事の図版と同じ方程式の組織)。作り直すときはスクリプトの出力を貼る。
 */
const SPINODAL_PATH = [
  "M24 10.8 15.6 15.3 10.9 18.6 10.5 27.4 10.9 35.5 15.6 36.5 18.4 36.2 22.1 34.6 25.9 31.9 36.1 22.4 40.8 20 52.9 15.5 55.9 13.5 58.4 10.9 44.5 10.4Z",
  "M77.2 10.8 76.5 10.9 77.4 16.9 80.3 23.9 84.6 28.5 93.3 34.3 96.7 37.3 99.3 41.2 100.4 46.4 99.4 51.7 96.7 56.9 88.3 67.7 79.1 77.7 76.2 82.9 75.3 87.2 75 92.4 76.4 114.1 84.6 114.6 95.8 114.2 95.9 105.5 94.9 90.7 96.3 82.9 99.5 76.8 106.8 67.3 110.1 62.1 118.2 41.2 121 36 124.4 31.7 128.3 28.2 132.2 26.1 136.8 24.8 140.6 25 144.3 26.4 146.5 28.2 148.3 31.7 148.6 35.2 147.2 39.5 144.7 43 131.2 53.9 126.3 59.5 123.2 64.7 117.9 76.8 111.6 88.1 110.1 93.3 110.2 95.9 111.1 98.5 114.5 101.9 119.1 103.1 123.8 101.9 127.5 98.4 131 91.6 135.9 75.3 139.6 68.1 144.2 62.1 149.3 56.9 163.9 45.6 167.7 42.1 171 36.9 171.7 33.4 171.6 30.8 169.5 25.7 165.6 21.3 158.3 15.8 149.9 10.9 135 10.5 123.4 10.9 114.5 21.6 110.7 23.8 107 24.6 103.2 23.9 99.5 21.2 97.2 16.9 96.1 10.9 89.3 10.5Z",
  "M189.1 19.5 186 23.9 185.2 28.2 186.3 32 189.1 35 189.5 27.4Z",
  "M54.8 29 51 30.6 48.5 32.6 40 43.8 34.2 47.9 30.5 49.2 25.9 49.9 10.9 49.4 10.5 58.6 10.9 67.6 21.2 64.5 25.9 64 29.6 64.3 34 65.5 38 67.6 48.4 76.8 53.8 79.8 57.6 80.5 61.3 80.1 65 78.7 67.7 76.8 70.7 72.5 77.1 55.1 77.8 49.9 77.2 45.6 73.8 38.6 71.1 35.2 67.8 32.3 65 30.5 61.3 29 57.6 28.6Z",
  "M53.8 48.2 56.6 48.1 59.7 49 61.9 50.8 63.5 53.4 63.8 56 63.2 58.4 61.7 60.3 59.4 61.7 56.6 62.4 52.9 61.9 50.1 60.3 48.2 57.7 47.7 54.3 48.6 51.7 51 49.2Z",
  "M187.2 49.8 180.7 52.1 173.9 56.9 153.9 75.1 150.8 78.9 148.8 82.9 148.1 86.4 148.3 90.7 149.4 94.2 151.5 97.6 154.6 101.1 158.3 104.1 163 106.9 167.6 108.9 173.2 110 177.9 109.9 183.5 108.4 189.1 105.5 189.5 96.8 189.1 86.6 185.3 89.8 182.5 91.5 179.7 92.4 176.9 92.6 174.1 92 171.3 90.2 169.5 87.4 169 84.6 169.4 82 170.4 79.6 174.1 75.4 179.7 71.9 189.1 68 189.5 62.1 189.3 50.8 189.1 49.5Z",
  "M19.3 80.1 15.3 82 10.9 85.7 10.5 95.9 10.9 104.9 26.8 95.5 29.6 92.9 31.3 89.8 31.5 85.5 30.5 83.4 28.7 81.4 24 79.6Z",
  "M48.2 95.9 43.6 97.1 39.8 99.4 30.5 109.8 25.1 114.1 43.6 114.6 59 114.1 60.6 110.7 61.1 107.2 60.6 103.7 59.4 101.2 57.6 98.9 54.8 97 52 96.1Z",
  "M129.4 111.5 124.3 114.1 148.1 114.1 142.4 112.1 137.8 111.1 133.1 110.9Z",
].join("");

/**
 * 9. スピノーダル分解: A(--mat-matrix)の中に B(--mat-second)の帯が
 * 枝分かれしながらつながる迷路状の組織の断片(仕様書 09 §6.1 S-1)
 */
function spinodalDecomposition(): string {
  return svg(
    `<rect x="10" y="10" width="180" height="105" rx="6" fill="var(--mat-matrix)" opacity="0.35"/>` +
      `<path d="${SPINODAL_PATH}" fill="var(--mat-second)" fill-rule="evenodd" opacity="0.85"/>`,
  );
}

/**
 * 10. マルテンサイト変態: 向きの違う針状の板(内部の格子線の傾きで区別)が
 * 交互に並ぶ組織と、閉じ込められた炭素(--mat-solute — 仕様書 10 §6.1 S-1)
 */
function martensite(): string {
  /**
   * 中心 (cx, cy)、長軸の傾き angleDeg のレンズ形の板。格子線は長軸に直交
   * させるので、板の傾きが ±35° の隣どうしでは格子線が 125° と 55° の
   * 鏡像になり、向きの違い(バリアント)が一目で分かる。
   */
  const plate = (cx: number, cy: number, angleDeg: number): string => {
    const halfL = 34;
    const halfW = 6;
    let hatch = "";
    for (let u = -halfL + 8; u <= halfL - 8; u += 6) {
      // レンズの半厚 halfW·(1 − (u/halfL)²) の内側に収める
      const h = n1(0.85 * halfW * (1 - (u / halfL) ** 2));
      hatch += `M ${u} -${h} V ${h} `;
    }
    return (
      `<g transform="translate(${cx} ${cy}) rotate(${angleDeg})">` +
      `<path d="M ${-halfL} 0 Q 0 ${-2 * halfW} ${halfL} 0 Q 0 ${2 * halfW} ${-halfL} 0 Z" fill="var(--mat-matrix)" fill-opacity="0.35" stroke="var(--mat-matrix)" stroke-width="1.5"/>` +
      `<path d="${hatch.trim()}" stroke="var(--mat-matrix)" stroke-width="1.2"/>` +
      `</g>`
    );
  };
  return svg(
    plate(46, 44, 35) +
      plate(96, 44, -35) +
      plate(146, 44, 35) +
      plate(46, 92, -35) +
      plate(96, 92, 35) +
      plate(146, 92, -35) +
      dots(
        [
          [71, 26],
          [121, 68],
          [21, 68],
          [171, 68],
          [71, 110],
          [121, 20],
          [171, 112],
        ],
        3,
        "var(--mat-solute)",
      ),
  );
}

/**
 * 11. バンド理論: 許容帯 2 本と、その間の禁制帯(破線)。
 * 下の帯だけ電子で埋まっている(仕様書 11 §6.1 S1)
 */
function bandTheory(): string {
  const band = (y: number, h: number): string =>
    `<rect x="34" y="${y}" width="132" height="${h}" fill="var(--mat-band)"/>` +
    `<line x1="34" y1="${y}" x2="166" y2="${y}" stroke="var(--mat-level)" stroke-width="2"/>` +
    `<line x1="34" y1="${y + h}" x2="166" y2="${y + h}" stroke="var(--mat-level)" stroke-width="2"/>`;
  return svg(
    band(22, 24) +
      band(78, 26) +
      // 占有(下の帯だけ電子で埋まる)
      `<rect x="34" y="78" width="132" height="26" fill="var(--mat-electron)" opacity="0.55"/>` +
      // 禁制帯(塗りなし + 破線)
      `<line x1="34" y1="63" x2="166" y2="63" stroke="var(--color-hairline)" stroke-width="2" stroke-dasharray="6 5"/>`,
  );
}

/** 12. フェルミ準位: バンドの間に引かれた水位の線と、裾を引く分布 */
function fermiLevel(): string {
  return svg(
    `<rect x="30" y="18" width="140" height="22" fill="var(--mat-band)"/>` +
      `<rect x="30" y="86" width="140" height="22" fill="var(--mat-band)"/>` +
      `<rect x="30" y="86" width="140" height="22" fill="var(--mat-electron)" opacity="0.5"/>` +
      `<line x1="22" y1="63" x2="178" y2="63" stroke="var(--mat-level)" stroke-width="2" stroke-dasharray="7 5"/>` +
      `<path d="M 40 50 q 40 0 50 13 q 10 13 50 13" fill="none" stroke="var(--mat-electron)" stroke-width="2.5"/>`,
  );
}

/**
 * 13. pn接合: 左(p)で高く右(n)で低い E_c・E_v の 2 本が接合面で滑らかに
 * 曲がり、フェルミ準位(破線)は全体で水平。電子は右の E_c のすぐ上、
 * 正孔は左の E_v のすぐ下(仕様書 13 §2.3・§6.1 S-1)
 */
function pnJunction(): string {
  /** 左で y0、右で y0 + 30 の段差を接合面(x = 100)の前後で滑らかにつなぐ */
  const edge = (y0: number): string =>
    `M 18 ${y0} H 78 C 100 ${y0} 100 ${y0 + 30} 122 ${y0 + 30} H 182`;
  /** 帯の外側(伝導帯は上、価電子帯は下)へ厚み 16 の帯を塗る */
  const ribbon = (y0: number, dy: number): string =>
    `${edge(y0)} V ${y0 + 30 + dy} H 122 C 100 ${y0 + 30 + dy} 100 ${y0 + dy} 78 ${y0 + dy} H 18 Z`;
  return svg(
    `<line x1="100" y1="8" x2="100" y2="117" stroke="var(--color-hairline)" stroke-width="1.5" stroke-dasharray="5 4"/>` +
      `<path d="${ribbon(30, -16)}" fill="var(--mat-band)"/>` +
      `<path d="${ribbon(70, 16)}" fill="var(--mat-band)"/>` +
      `<g fill="none" stroke="var(--mat-level)" stroke-width="2.5">` +
      `<path d="${edge(30)}"/>` +
      `<path d="${edge(70)}"/>` +
      `</g>` +
      `<line x1="14" y1="65" x2="186" y2="65" stroke="var(--mat-level)" stroke-width="1.5" stroke-dasharray="6 4"/>` +
      dots(
        [
          [138, 52],
          [154, 52],
          [170, 52],
        ],
        4,
        "var(--mat-electron)",
      ) +
      dots(
        [
          [30, 78],
          [46, 78],
          [62, 78],
        ],
        4,
        "var(--mat-hole)",
      ),
  );
}

/** 14. トンネル効果と STM: 障壁を抜けて減衰する波と探針 */
function tunnelingStm(): string {
  return svg(
    `<rect x="88" y="30" width="24" height="70" fill="var(--mat-matrix)" opacity="0.35"/>` +
      `<path d="M 14 66 q 9 -22 18 0 q 9 22 18 0 q 9 -22 18 0 q 9 22 18 0" fill="none" stroke="var(--mat-electron)" stroke-width="2.5"/>` +
      `<path d="M 88 66 q 12 -6 24 0" fill="none" stroke="var(--mat-electron)" stroke-width="2.5" opacity="0.6"/>` +
      `<path d="M 112 66 q 7 -8 14 0 q 7 8 14 0 q 7 -8 14 0 q 7 8 14 0" fill="none" stroke="var(--mat-electron)" stroke-width="2.5" opacity="0.7"/>` +
      `<path d="M 100 30 l -10 -18 h 20 Z" fill="var(--mat-recip)"/>`,
  );
}

const THUMBS: Record<string, () => string> = {
  "reciprocal-lattice": reciprocalLattice,
  "ewald-sphere": ewaldSphere,
  "structure-factor": structureFactor,
  "frank-read-source": frankReadSource,
  "cottrell-atmosphere": cottrellAtmosphere,
  "kirkendall-effect": kirkendallEffect,
  "gp-zones": gpZones,
  "ostwald-ripening": ostwaldRipening,
  "spinodal-decomposition": spinodalDecomposition,
  martensite,
  "band-theory": bandTheory,
  "fermi-level": fermiLevel,
  "pn-junction": pnJunction,
  "tunneling-stm": tunnelingStm,
};

/** slug に対応するサムネイル SVG 文字列を返す */
export function thumbSvg(slug: string): string {
  const make = THUMBS[slug];
  return make ? make() : svg("");
}
