# 記事実装プロンプト集 — 全体ロードマップ

このディレクトリには、未実装の記事を別セッションで作らせるためのプロンプトを置く。
各セッションには次の 1 行を投げればよい。

```
docs/prompts/<ファイル名> を読んで、その通りに実装してください。
```

---

## 1. 記事の全体マップ(最終形)

母体サイト仕様書は当初 7 本を想定していたが、**カテゴリ D(電子とバンド)を新設して 14 本**に拡張する。

| order | カテゴリ | 記事 | slug | 前提記事 | 状態 | プロンプト |
|---|---|---|---|---|---|---|
| 1 | A. 回折と結晶の幾何 | 逆格子空間 | `reciprocal-lattice` | — | **公開済** | — |
| 2 | A | エヴァルト球 | `ewald-sphere` | 逆格子空間 | 未 | `04_ewald_sphere_prompt.md` |
| 3 | A | 構造因子と消滅則 | `structure-factor` | 逆格子空間 / エヴァルト球(推奨) | 未 | `08_structure_factor_prompt.md` |
| 4 | B. 転位と材料の強さ | フランク・リード源 | `frank-read-source` | — | **公開済** | — |
| 5 | B | コットレル雰囲気 | `cottrell-atmosphere` | フランク・リード源(推奨) | **公開済** | — |
| 6 | C. 拡散と組織の変化 | カーケンドール効果 | `kirkendall-effect` | — | 未 | `06_kirkendall_effect_prompt.md` |
| 7 | C | GPゾーン | `gp-zones` | カーケンドール効果(推奨) | 未 | `07_gp_zones_prompt.md` |
| 8 | C | オストワルド成長 | `ostwald-ripening` | GPゾーン(推奨) | **公開済** | — |
| 9 | C | スピノーダル分解 | `spinodal-decomposition` | カーケンドール効果 / GPゾーン(推奨) | 未 | `09_spinodal_decomposition_prompt.md` |
| 10 | C | マルテンサイト変態 | `martensite` | GPゾーン(推奨) | 未 | `10_martensite_prompt.md` |
| 11 | D. 電子とバンド | バンド理論 | `band-theory` | 逆格子空間 | 未 | `11_band_theory_prompt.md` |
| 12 | D | フェルミ準位 | `fermi-level` | バンド理論 | 未 | `12_fermi_level_prompt.md` |
| 13 | D | pn接合 | `pn-junction` | フェルミ準位 | 未 | `13_pn_junction_prompt.md` |
| 14 | D | トンネル効果とSTM | `tunneling-stm` | バンド理論(推奨) | 未 | `14_tunneling_stm_prompt.md` |

### 前提記事の強さ

`src/content/topics.ts` の `Prerequisite.recommended` は次の意味である(母体仕様 §1 に対応)。

- `recommended: false` = **必須の前提**(表の「前提記事」に注記なし)
- `recommended: true` = **推奨**(表の「(推奨)」)

---

## 2. ⚠️ 共有ファイル — 並行実行してはいけない

次のファイルは**全記事が書き込む**ため、複数の記事を同時に別ブランチで実装すると必ずコンフリクトする。

| ファイル | 何が競合するか |
|---|---|
| `src/content/topics.ts` | 記事エントリの追加・`order` の値・カテゴリ定義 |
| `src/widgets/registry.ts` | 図版の登録行 |
| `src/styles/tokens.css` / `src/core/colors.ts` | 色トークンの追加 |
| `docs/specs/00_base_site_spec.md` | §6.2 の色表への追記 |

**必ず 1 本ずつ、`main` にマージしてから次を始めること。** 各セッションは作業開始時に `git pull origin main` で最新を取り込む。

### `order` の振り直しについて

現在の `topics.ts` は order 1〜7 で、上表の 1〜14 とはずれている(既存記事の order は 1,2,3,4,5,6,7)。

**最初に実装する記事のセッションが、上表に合わせて既存 7 件の `order` を振り直す。**
2 本目以降のセッションは、振り直し済みかを確認し、自分のエントリを追加するだけでよい。

### カテゴリ D の追加

カテゴリ D の記事を最初に実装するセッションが、`topics.ts` の `CATEGORIES` と `CategoryId` 型に D を追加する。

```ts
export type CategoryId = "A" | "B" | "C" | "D";

export const CATEGORIES: readonly Category[] = [
  { id: "A", name: "回折と結晶の幾何" },
  { id: "B", name: "転位と材料の強さ" },
  { id: "C", name: "拡散と組織の変化" },
  { id: "D", name: "電子とバンド" },
] as const;
```

母体仕様書 §1 の収録テーマ表にも D の 4 本を追記すること。

---

## 3. 新規色トークン(カテゴリ D 共通)

母体仕様書 §6.2 は「**新しい種類の対象が出てきた場合は、勝手に色を増やさず、この表への追加を提案すること**」と定めている。カテゴリ D では既存トークンで表せない対象(電子・正孔・バンド)が出るため、下記を追加する。

**カテゴリ D の記事を最初に実装するセッションが、次の 3 箇所すべてに同じ値で追加する**:
`docs/specs/00_base_site_spec.md` §6.2 の表 / `src/styles/tokens.css` / `src/core/colors.ts`。
2 本目以降は追加せず、既にあるものを使う。

| 変数 | 提案値 | 対象 |
|---|---|---|
| `--mat-electron` | `#2f7d5b` | 電子(負の電荷キャリア) |
| `--mat-hole` | `#b5476b` | 正孔(正の電荷キャリア) |
| `--mat-band` | `rgba(154,167,184,0.18)` | 許容帯(バンド)の塗り |
| `--mat-gap` | 塗りなし + `--color-hairline` の破線 | 禁制帯(バンドギャップ) |
| `--mat-level` | `#2f3a4a` | エネルギー準位線(フェルミ準位・バンド端) |

上の値はあくまで提案である。既存の意味パレット(`--mat-matrix` `#9aa7b8` / `--mat-solute` `#e07a2f` / `--mat-second` `#4f83cc` / `--mat-defect` `#d1483f` / `--mat-precip` `#7d5bc7` / `--mat-beam` `#d99000` / `--mat-recip` `#2f3a4a`)と**十分に見分けがつくこと**、および白背景で AA を満たすことを確認したうえで確定させる。文字に使う場合は、コットレル記事で導入された `--mat-beam-ink` と同じ考え方で、必要なら暗色版(`-ink`)を用意する。

**再利用すべきもの**(新色を作らない):

- ドーパント原子(P, B など)は溶質なので `--mat-solute` を使う
- 母相の原子・格子は `--mat-matrix`
- 入射光・放出光は `--mat-beam`(LED・太陽電池)

---

## 4. 全プロンプト共通の約束

各プロンプトはこの節を前提とする。

### 進め方(2 フェーズ)

1. **フェーズ1 — 個別仕様書**: `docs/specs/NN_<slug>_spec.md` を母体仕様書 **§12 のフォーマット**で作成し、**実装前に一度コミット**する。書式・粒度は `docs/specs/02_frank_read_source_spec.md` を手本にする。
2. **フェーズ2 — 実装**: 仕様書に従って実装する。

### 最初に必ず読むもの

- `docs/specs/00_base_site_spec.md` — 全体の憲法。特に §2 デザイン原則 / §6 デザインシステム / §8 図版契約 / §12 仕様書フォーマット
- 同じカテゴリの既存記事の仕様書と実装(各プロンプトで指定)

### 守るべき規約

- **色**: §6.2 の意味パレットのみ。勝手に増やさない(§3 の手順で追加する)
- **図版契約**: `src/widgets/<slug>/<name>.ts` が `WidgetFactory` を default export、`registry.ts` に登録(§8.2)
- **連続アニメが不要な図は `requestRender` 方式**にしてアイドル時の消費をゼロにする(§8.2)
- **乱数はシード固定**。`reset` で完全に同じ初期状態へ戻る(§8.2)
- **パフォーマンス**: 1 フレーム中の新規割当てを避け TypedArray を再利用。中位スマホで 60fps。重い場合は画面幅で自動スケール(§8.3)
- **簡略化は必ず図注に明示**(§2-5)。時間の加速・次元の削減・粒子数の削減はすべて対象
- **演出しない**(§2-7)。画面上で動くのは物理だけ。影・グラデーション・発光エフェクトを使わない
- 全図版に `alt`(スクリーンリーダー向け説明)を書く
- `prefers-reduced-motion` に対応する(既存図版の実装に倣う)

### 品質ゲート(全部通すこと)

```sh
pnpm check   # astro check — 0 errors
pnpm test    # vitest
pnpm lint    # eslint
pnpm build   # 本番ビルド
```

物理モデルを持つ記事は、そのモデルの**単体テストを書く**
(`src/widgets/cottrell-atmosphere/lib/lattice.test.ts` や
`src/widgets/reciprocal-lattice/lattice.test.ts` に倣う)。

### 完了時

- `src/content/topics.ts` の該当エントリを **`published: true`** に
- コミットして `git push -u origin <ブランチ名>`
- **PR は指示があるまで作らない**

---

## 5. 推奨する実装順

依存関係と共有ファイルの都合から、次の順を推奨する。

1. `06_kirkendall_effect` — カテゴリ C の入口。GPゾーンが前提にする
2. `07_gp_zones` — 既存 3 記事の伏線を回収する結節点
3. `04_ewald_sphere` — 逆格子空間の直接の続編
4. `08_structure_factor` — エヴァルト球の図版を流用できる
5. `09_spinodal_decomposition` — GPゾーンとの対比が効く
6. `10_martensite` — カテゴリ C の締め
7. `11_band_theory` — **カテゴリ D の最初**。D の追加と新色トークンをここで行う
8. `12_fermi_level`
9. `13_pn_junction` — D の到達点
10. `14_tunneling_stm`

7〜10(カテゴリ D)は 1〜6 と独立しているので、カテゴリ C/A 側と並行してよい。
ただし **D の中では 11 → 12 → 13 の順を守る**(前提関係があり、バンド図の描画コードを共有するため)。
