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

/** 3. フランク・リード源: 両端を固定された転位の張り出しとループ */
function frankReadSource(): string {
  return svg(
    `<ellipse cx="100" cy="70" rx="62" ry="36" fill="none" stroke="var(--mat-defect)" stroke-width="2" opacity="0.45"/>` +
      `<path d="M 56 84 Q 100 26 144 84" fill="none" stroke="var(--mat-defect)" stroke-width="2.5"/>` +
      `<circle cx="56" cy="84" r="4.5" fill="var(--mat-recip)"/>` +
      `<circle cx="144" cy="84" r="4.5" fill="var(--mat-recip)"/>`,
  );
}

/** 4. コットレル雰囲気: 刃状転位(⊥)の下に集まる溶質原子 */
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

/** 5. カーケンドール効果: 拡散対(A|B)と流束の非対称 */
function kirkendallEffect(): string {
  const aPts = grid(22, 24, 82, 104, 20, 20);
  const bPts = grid(118, 24, 178, 104, 20, 20);
  return svg(
    dots(aPts, 4, "var(--mat-solute)", 0.9) +
      dots(bPts, 4, "var(--mat-second)", 0.9) +
      `<line x1="100" y1="14" x2="100" y2="111" stroke="var(--mat-recip)" stroke-width="1.5" stroke-dasharray="5 4"/>` +
      `<g stroke-width="2.5" fill="none">` +
      `<line x1="70" y1="14" x2="128" y2="14" stroke="var(--mat-solute)"/>` +
      `<line x1="124" y1="120" x2="96" y2="120" stroke="var(--mat-second)"/>` +
      `</g>` +
      `<path d="M 128 14 l -7 -4 v 8 Z" fill="var(--mat-solute)"/>` +
      `<path d="M 96 120 l 7 -4 v 8 Z" fill="var(--mat-second)"/>`,
  );
}

/** 6. GP ゾーン: 母相格子の中の円板状クラスター */
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

/** 7. オストワルド成長: 大粒子が育ち小粒子が消える */
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

const THUMBS: Record<string, () => string> = {
  "reciprocal-lattice": reciprocalLattice,
  "ewald-sphere": ewaldSphere,
  "frank-read-source": frankReadSource,
  "cottrell-atmosphere": cottrellAtmosphere,
  "kirkendall-effect": kirkendallEffect,
  "gp-zones": gpZones,
  "ostwald-ripening": ostwaldRipening,
};

/** slug に対応するサムネイル SVG 文字列を返す */
export function thumbSvg(slug: string): string {
  const make = THUMBS[slug];
  return make ? make() : svg("");
}
