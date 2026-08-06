# うごく材料科学(仮称)/ Materials in Motion

材料科学の代表的な現象を「長文記事 + 操作可能な図版」で学ぶ、完全静的な教材サイトです。
本リポジトリはその母体(デザインシステム・コアライブラリ・ページ雛形)を実装しています。

公開サイト: <https://urakawa03.github.io/Material-visual/>

仕様書: [`docs/specs/00_base_site_spec.md`](docs/specs/00_base_site_spec.md)

## 技術スタック

- [Astro](https://astro.build/) v5(static output)+ TypeScript(strict)
- 図版: 素の Canvas 2D / three.js(3D ページのみ・動的 import)
- 数式: KaTeX(ビルド時レンダリング・クライアント JS ゼロ)
- スタイル: 素の CSS(デザイントークンは `src/styles/tokens.css`)

## 開発

```sh
pnpm install
pnpm dev        # 開発サーバ
pnpm build      # 本番ビルド(dist/)
pnpm preview    # ビルド結果の確認
pnpm check      # astro check(型チェック)
pnpm lint       # ESLint
pnpm format     # Prettier
```

## デプロイ設定

base path とサイト URL は環境変数で切り替えられます(GitHub Pages のサブパス配信対応):

```sh
BASE_PATH="/Material-visual/" SITE_URL="https://<user>.github.io" pnpm build
```

## ディレクトリ構成(抜粋)

```
src/
├─ content/topics.ts      # 記事メタ情報の一元管理
├─ core/                  # engine / controls / mathx / colors / three-helpers
├─ widgets/               # 図版ウィジェット(registry.ts で動的 import 登録)
├─ components/            # Figure / M(数式)/ TopicCard
├─ layouts/               # Base / Article
├─ pages/                 # index / about / style-guide / articles/
└─ styles/                # tokens / base / article / controls
```

## 記事の追加(M2 以降)

1. `docs/specs/<slug>.md` に個別仕様書を置く(章立ては母体仕様書 §12)
2. `src/widgets/<slug>/` にウィジェットを実装し `registry.ts` に登録
3. `src/pages/articles/<slug>.astro` を作成
4. `src/content/topics.ts` の該当テーマを `published: true` にする
