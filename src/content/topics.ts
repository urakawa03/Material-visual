/**
 * topics.ts — 記事メタ情報の一元管理(仕様書 §3.2)
 *
 * トップページ・前提バッジ・前後の記事ナビはすべてこのファイルを参照する。
 * 記事を公開するときは published を true にするだけでよい。
 */

export type CategoryId = "A" | "B" | "C";

export interface Category {
  id: CategoryId;
  /** カテゴリ名(表示用) */
  name: string;
}

/** カテゴリ定義(§1 の表の順) */
export const CATEGORIES: readonly Category[] = [
  { id: "A", name: "回折と結晶の幾何" },
  { id: "B", name: "転位と材料の強さ" },
  { id: "C", name: "拡散と組織の変化" },
] as const;

export interface Prerequisite {
  slug: string;
  /** true なら「推奨」(読了必須ではない — §1) */
  recommended: boolean;
}

export interface Topic {
  /** §1 の表の番号(前後ナビの順序) */
  order: number;
  slug: string;
  /** 記事タイトル(仮題) */
  title: string;
  category: CategoryId;
  /** カードに載せる一行説明 */
  summary: string;
  /** 主な描画方式 */
  render: "2d" | "3d";
  prerequisites: readonly Prerequisite[];
  /** 公開済みか(false = 準備中) */
  published: boolean;
}

/** 収録予定テーマ(全 7 本 — §1) */
export const TOPICS: readonly Topic[] = [
  {
    order: 1,
    slug: "reciprocal-lattice",
    title: "逆格子空間",
    category: "A",
    summary: "結晶の周期性を「波の言葉」で捉え直す、回折理解の出発点。",
    render: "3d",
    prerequisites: [],
    published: false,
  },
  {
    order: 2,
    slug: "ewald-sphere",
    title: "エヴァルト球",
    category: "A",
    summary: "どの方向に回折が起きるかを、球と格子点の幾何で見わたす。",
    render: "3d",
    prerequisites: [{ slug: "reciprocal-lattice", recommended: false }],
    published: false,
  },
  {
    order: 3,
    slug: "frank-read-source",
    title: "フランク・リード源",
    category: "B",
    summary: "1 本の転位が増殖する仕組みを、線の張り出しから追いかける。",
    render: "2d",
    prerequisites: [],
    published: true,
  },
  {
    order: 4,
    slug: "cottrell-atmosphere",
    title: "コットレル雰囲気",
    category: "B",
    summary: "溶質原子が転位を捕まえて、鋼が硬くなる理由を探る。",
    render: "2d",
    prerequisites: [{ slug: "frank-read-source", recommended: true }],
    published: false,
  },
  {
    order: 5,
    slug: "kirkendall-effect",
    title: "カーケンドール効果",
    category: "C",
    summary: "拡散速度の差が生む、界面の移動と空孔の集まり。",
    render: "2d",
    prerequisites: [],
    published: false,
  },
  {
    order: 6,
    slug: "gp-zones",
    title: "GPゾーン(ジュラルミンの時効)",
    category: "C",
    summary: "ジュラルミンが時効で強くなる、析出のはじまりを見る。",
    render: "2d",
    prerequisites: [{ slug: "kirkendall-effect", recommended: true }],
    published: false,
  },
  {
    order: 7,
    slug: "ostwald-ripening",
    title: "オストワルド成長",
    category: "C",
    summary: "大きい粒子が小さい粒子を「食べて」育つ、熟成のしくみ。",
    render: "2d",
    prerequisites: [{ slug: "gp-zones", recommended: true }],
    published: false,
  },
] as const;

export function getTopic(slug: string): Topic | undefined {
  return TOPICS.find((t) => t.slug === slug);
}

export function getCategory(id: CategoryId): Category {
  const cat = CATEGORIES.find((c) => c.id === id);
  if (!cat) throw new Error(`未定義のカテゴリ: ${id}`);
  return cat;
}

/** §1 の表の番号順で前後の記事を返す(§3.2 の記事ナビ用) */
export function getAdjacent(slug: string): { prev?: Topic; next?: Topic } {
  const topic = getTopic(slug);
  if (!topic) return {};
  const sorted = [...TOPICS].sort((a, b) => a.order - b.order);
  const i = sorted.findIndex((t) => t.slug === slug);
  return {
    prev: i > 0 ? sorted[i - 1] : undefined,
    next: i < sorted.length - 1 ? sorted[i + 1] : undefined,
  };
}
