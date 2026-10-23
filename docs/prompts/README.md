# 記事実装プロンプト集 — 全体ロードマップ

このディレクトリには、未実装の記事を別セッションで作らせるためのプロンプトを置く。
各セッションには次の 1 行を投げればよい。

```
docs/prompts/<ファイル名> を読んで、その通りに実装してください。
```

**現状(2026-10-23)**: 14 本のうち 12 本が公開済み(当初の 8 本に、#3・#9・#12・#13 が加わった)。残る 2 本(#10・#14)は**個別仕様書まで作成済み**で実装中。各プロンプトの冒頭にその旨を追記してある(フェーズ 2 の実装から始める)。**共通基盤の整備(P0)も `main` に入っている**。公開した記事で仕様書から変えた点は、各仕様書の付録B にある。残作業の全体像・実装順・並行実装の規則は `docs/specs/90_remaining_work.md` にまとめてあり、**本 README と食い違う場合は 90 を優先する**。

---

## 1. 記事の全体マップ(最終形)

母体サイト仕様書は当初 7 本を想定していたが、**カテゴリ D(電子とバンド)を新設して 14 本**に拡張する。

| order | カテゴリ | 記事 | slug | 前提記事 | 状態 | 仕様書(`docs/specs/`) | プロンプト |
|---|---|---|---|---|---|---|---|
| 1 | A. 回折と結晶の幾何 | 逆格子空間 | `reciprocal-lattice` | — | **公開済** | `05_reciprocal-lattice.md` | — |
| 2 | A | エヴァルト球 | `ewald-sphere` | 逆格子空間 | **公開済** | `04_ewald_sphere_spec.md` | `04_ewald_sphere_prompt.md`(記録) |
| 3 | A | 構造因子と消滅則 | `structure-factor` | 逆格子空間 / エヴァルト球(推奨) | **公開済** | `08_structure_factor_spec.md` | `08_structure_factor_prompt.md`(記録) |
| 4 | B. 転位と材料の強さ | フランク・リード源 | `frank-read-source` | — | **公開済** | `02_frank_read_source_spec.md` | — |
| 5 | B | コットレル雰囲気 | `cottrell-atmosphere` | フランク・リード源(推奨) | **公開済** | `01_cottrell_atmosphere_spec.md` | — |
| 6 | C. 拡散と組織の変化 | カーケンドール効果 | `kirkendall-effect` | — | **公開済** | `06_kirkendall_effect_spec.md` | `06_kirkendall_effect_prompt.md`(記録) |
| 7 | C | GPゾーン | `gp-zones` | カーケンドール効果(推奨) | **公開済** | `07_gp_zones_spec.md` | `07_gp_zones_prompt.md`(記録) |
| 8 | C | オストワルド成長 | `ostwald-ripening` | GPゾーン(推奨) | **公開済** | `03_ostwald_ripening.md` | — |
| 9 | C | スピノーダル分解 | `spinodal-decomposition` | カーケンドール効果 / GPゾーン(推奨) | **公開済** | `09_spinodal_decomposition_spec.md` | `09_spinodal_decomposition_prompt.md`(記録) |
| 10 | C | マルテンサイト変態 | `martensite` | GPゾーン(推奨) | 仕様書あり・未実装 | `10_martensite_spec.md` | `10_martensite_prompt.md` |
| 11 | D. 電子とバンド | バンド理論 | `band-theory` | 逆格子空間 | **公開済** | `11_band_theory_spec.md` | `11_band_theory_prompt.md`(記録) |
| 12 | D | フェルミ準位 | `fermi-level` | バンド理論 | **公開済** | `12_fermi_level_spec.md` | `12_fermi_level_prompt.md`(記録) |
| 13 | D | pn接合 | `pn-junction` | フェルミ準位 / バンド理論(推奨) | **公開済** | `13_pn_junction_spec.md` | `13_pn_junction_prompt.md`(記録) |
| 14 | D | トンネル効果とSTM | `tunneling-stm` | バンド理論(推奨) | 仕様書あり・未実装 | `14_tunneling_stm_spec.md` | `14_tunneling_stm_prompt.md` |

仕様書の文書番号と記事番号(`order`)は一致しない(歴史的な経緯。01 = #5 など)。記事番号は `topics.ts` の `order` と本表を正とする。

### 前提記事の強さ

`src/content/topics.ts` の `Prerequisite.recommended` は次の意味である(母体仕様 §1 に対応)。

- `recommended: false` = **必須の前提**(表の「前提記事」に注記なし)
- `recommended: true` = **推奨**(表の「(推奨)」)

---

## 2. ⚠️ 共有ファイルと並行実装

次のファイルは複数の記事が書き込むため、無計画に並行実装するとコンフリクトする。実際に、4 本(エヴァルト球・カーケンドール効果・GP ゾーン・バンド理論)を並行実装したときは `registry.ts`・`base.css`・`controls.css`・`M.astro`・`_shared2d.ts`・`_shared3d.ts` で衝突し、手作業でマージした。

| ファイル | 何が競合するか |
|---|---|
| `src/content/topics.ts` | 記事エントリの追加・公開フラグ |
| `src/widgets/registry.ts` | 図版の登録行 |
| `src/components/topicThumbs.ts` | サムネイルの追加 |
| `src/styles/*.css` / `src/core/colors.ts` | 色トークン・読み取りの色 |
| `src/widgets/_shared/*` / `src/widgets/reciprocal-lattice/_shared2d.ts` | 共有部品の拡張 |
| `docs/specs/00_base_site_spec.md` | §1 の収録テーマ表・§6.2 の色表への追記 |

**P0(`docs/specs/90_remaining_work.md` §3)は `main` にマージ済み。** P0 が共有ファイルへの追記(`topics.ts` への #3・#9・#10 の登録、サムネイル、`registry.ts` の記事ごとのアンカーコメント、読み取りの `"hole"` 色)を先に済ませたので、各記事のブランチは共有ファイルの別々の行だけを触ることになる。これにより第 1 波の 5 本は並行してよい(90 §6)。

- `topics.ts`: 自分の項目の `published` を `true` にするだけ(項目の追加・`order` の変更はしない)
- `registry.ts`: 自分の記事のアンカーコメント(`// 記事「…」(仕様書 NN)— 実装時にこの直下へ登録する`)の**直下**に登録行を足す。アンカーの間の空行は消さない
- `topicThumbs.ts`: 触らない(サムネイルは P0 で用意済み)

それでも**マージは 1 本ずつ**行い、マージのたびに `main` を取り込んでから次をマージする。各セッションは作業開始時に `git pull origin main` で最新を取り込む。

### 完了済みの準備(記録)

- **`order` の振り直し**: 完了。`topics.ts` の `order` は上表の 1〜14 と一致している
- **カテゴリ D の追加**: 完了(バンド理論の記事で、`CategoryId` 型・`CATEGORIES`・母体仕様書 §1 の表に追加済み)

---

## 3. カテゴリ D の色トークン(追加済み)

母体仕様書 §6.2 は「**新しい種類の対象が出てきた場合は、勝手に色を増やさず、この表への追加を提案すること**」と定めている。カテゴリ D では既存トークンで表せない対象(電子・正孔・バンド)が出るため、**バンド理論の記事で次の 3 箇所すべてに同じ値で追加済み**である:
`docs/specs/00_base_site_spec.md` §6.2 の表 / `src/styles/tokens.css` / `src/core/colors.ts`。
以降の記事は追加せず、既にあるものを使う(残り 6 本の仕様書は、新しい色トークンを足さずに書いてある)。

| 変数 | 値 | 対象 |
|---|---|---|
| `--mat-electron` | `#2f7d5b`(白地で約 5.0:1) | 電子(負の電荷キャリア) |
| `--mat-hole` | `#b5476b`(白地で約 5.2:1) | 正孔(正の電荷キャリア) |
| `--mat-band` | `rgba(154,167,184,0.18)` | 許容帯(バンド)の塗り |
| `--mat-gap` | 塗りなし + `--color-hairline` の破線 | 禁制帯(バンドギャップ)。**CSS 変数ではなく規約**(`--mat-vacancy` と同じ扱い) |
| `--mat-level` | `#2f3a4a` | エネルギー準位線(フェルミ準位・バンド端) |

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

**残り 6 本はフェーズ 1 が完了している**(仕様書は §1 の表のとおり)。フェーズ 2 から始め、仕様書とプロンプトが食い違うときは仕様書を優先する。仕様書は、実装済みの共有モジュールの実際の API と、作成時に行った数値の試作による検証を反映している(`docs/specs/90_remaining_work.md` §8)。

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
- **共通部品を使う**(コピーしない): 物理定数と時間の書式は `src/core/units.ts`(`KB_EV`・`formatDuration` など)、図中のフォント・軸の目盛り・数値の書式は `src/core/plot.ts`(`font`・`linTicks`・`logTicks`・`fmtSig`・`fmtSci`・`fmtPow10`)、操作直後の短い遷移は `src/core/anim.ts` の `tween`(90 §3.1〜3.3)
- **本文で他の記事に言及するときは `<ArticleRef slug="…">` を使う**(`src/components/ArticleRef.astro`)。公開済みならリンク、準備中なら「(準備中)」が自動で出るので、相手の記事を後から公開しても本文を直さずに済む(90 §4.1)

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

## 5. 実装順(残り 6 本)

公開済みの 8 本(06・07・04・11 の各プロンプトを含む)は完了。残り 6 本は次の順で進める(詳細と理由は `docs/specs/90_remaining_work.md` §6)。

1. **P0 — 共通基盤と下準備**(90 §3。補助関数の共通化 `src/core/units.ts`・`plot.ts`・`anim.ts`、共有ファイルへの先行追記、公開済み記事の古い相互参照の修正、`<ArticleRef>`)— **済み(`main` にマージ済み)**
2. **第 1 波**(並行してよい): `12_fermi_level` / `08_structure_factor` / `09_spinodal_decomposition` / `10_martensite` / `14_tunneling_stm`
3. **第 2 波**: `13_pn_junction`(#12 のマージ後 — #12 が新設する `_shared/semiconductor.ts`・`_shared/carriers1d.ts` を使う)

**D の中の前提関係(11 → 12 → 13)は変わらない**。#14 は #12・#13 と独立している。
