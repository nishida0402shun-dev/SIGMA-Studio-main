# 科学・工学ビジュアライゼーション統合方針

## 目的

SIGMA Studioで数学・理科・工学教材の図表作成を強化する。既存の編集可能なGraph2D/shapeを基本にし、専門的な表現だけを外部ツールへ委ねる。初期段階では、巨大なPython/TeX依存をElectronアプリ本体へ同梱せず、公式Skillを通じてAIが適切なツールと出力形式を選べるようにする。

## 対象ツールと用途

| ツール | SIGMA Studioでの用途 | 初期統合 | 実行条件・留意点 |
|---|---|---|---|
| [japanize-matplotlib](https://github.com/uehara1414/japanize-matplotlib) | matplotlib図表の日本語ラベル | Skillのコード生成ガイド | Python、matplotlib、対応フォント環境 |
| [SciencePlots](https://github.com/garrettj403/SciencePlots) | 論文・学術発表向けの図表スタイル | Skillのコード生成ガイド | Python、matplotlib、SciencePlots。スタイル/LaTeX依存は環境確認 |
| [Schemdraw](https://schemdraw.readthedocs.io/en/stable/) | 回路・ブロック図 | Skillのコード生成ガイド | Pythonパッケージ。APIは導入バージョンを確認 |
| [Manim Community](https://github.com/ManimCommunity/manim) | 数学・物理の説明アニメーション | Skillのコード生成ガイド | Pythonに加えて描画・動画生成依存があり、導入コストが高い |
| [PGFPlots](https://ctan.org/pkg/pgfplots) | LaTeX文書と統合された高品質プロット | SkillのLaTeX生成ガイド | TeX環境と必要パッケージ |
| [CircuitikZ](https://ctan.org/pkg/circuitikz) | LaTeX/TikZの電気回路図 | SkillのLaTeX生成ガイド | TeX環境と必要パッケージ |
| [GeoGebra Calculator](https://www.geogebra.org/calculator) | 対話的な作図・パラメータ探索 | 外部Webツールとして案内 | ネットワークが必要。オフライン/埋め込みは保証しない |

## 設計上の境界

- 初期統合は公式Skill `sigma-scientific-visualization` によるツール選択・コード生成・検証指針であり、各ライブラリをアプリに同梱したり、自動実行したりするものではない。
- 外部コードの実行機能を追加する場合は、ランタイム検出、明示的なユーザー承認、タイムアウト、出力ディレクトリ制限、プロセス終了、ログ、依存関係管理、署名/配布サイズ、Windows/macOS CIを別途設計する。
- GeoGebraをアプリ内iframeに直接埋め込む変更は、CSP・利用規約・認証・ネットワーク・保守性を検証するまで行わない。初期段階は公式URLを利用する。
- 教材内で再編集が必要な単純なグラフ・図形はSIGMAネイティブ形式を優先する。外部レンダリング画像だけに置き換えて編集可能性を失わないようにする。
- 生成コードの成功、コンパイル成功、図の数学的/電気的正しさはそれぞれ別の検証項目として扱う。

## 次段階の実装候補

1. Python / TeX / Manim のランタイム状態を読み取り専用で検出する。
2. ユーザーが選択したランタイムでのみ、テンプレートを実行するオプトイン型レンダラーを設ける。
3. 出力をSVG/PNG/PDF/MP4としてプレビューし、ユーザーが選んだ場合だけ教材へ挿入する。
4. 依存パッケージの導入手順、ライセンス、バージョン、診断情報を管理する。
5. 生成物の回帰テストとWindows/macOSのCIを追加する。

## 検証の完了条件

- Skillの検出・配布方法が既存の公式Skill機構と互換である。
- サンプルコードは実行環境がある場合のみ実行し、成果物を開いて検証する。
- ランタイム未導入時も通常のSIGMA Studio編集機能が影響を受けない。
- ツールごとの「生成のみ / 実行済み / 出力確認済み」を区別して報告する。
