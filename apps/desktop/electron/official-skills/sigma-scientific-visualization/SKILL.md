---
name: sigma-scientific-visualization
description: "科学・工学・数学の図表、回路図、アニメーションを作るときに、SIGMA Studio標準図形と外部のPython/LaTeX/GeoGebraツールを選び、出力形式・実行環境・検証方法を判断する。"
---

# 科学・工学ビジュアライゼーション

## 最初に判断すること

1. 教材内で編集可能な単純なグラフ、幾何図形、注釈なら、まず SIGMA Studio 標準の Graph2D / shape を使う。外部ランタイムを不要にし、編集可能性を維持する。
2. 高度な科学プロット、回路図、物理現象の時間変化など、標準機能で表現しにくい場合に限り、下記の外部ツールを選ぶ。
3. このSkillが存在するだけで外部ツールがインストール済みとは限らない。実行前にランタイムと依存関係を確認する。確認できない場合は、実行済みと主張せず、再現可能なソースコードとセットアップ手順を提示する。
4. 外部出力を教材へ取り込む場合は、可能ならSVG、難しければ高解像度PNGを使う。アニメーションはGIF/MP4など用途に合う形式を選び、元ソースも保存する。
5. 図の科学的正しさ、軸・単位・凡例・日本語文字化け、出力の可読性を確認する。生成できたことだけを正しさの証拠にしない。

## ツール選択

- **matplotlib + japanize-matplotlib**: Pythonのプロットに日本語ラベルが必要な場合。既存のmatplotlibコードへ `import japanize_matplotlib` を追加する方法を優先する。
- **SciencePlots**: 論文・学術発表向けの一貫したプロットスタイルが必要な場合。matplotlibと併用し、スタイル名はインストール版で利用可能か確認する。
- **Schemdraw**: 電気回路、ブロック図、流体・制御系など、記号と接続関係が重要な図に使う。回路の接続・極性・部品値を出力後に確認する。
- **Manim Community**: 数学・物理の概念を時間変化で説明するアニメーションに使う。依存関係が大きいため、静止画で十分なら選ばない。最終動画だけでなくソースコードと実行コマンドを残す。
- **PGFPlots**: LaTeX文書と一体化したベクトル品質の2D/3Dプロットに使う。TeX環境が必要。
- **CircuitikZ**: LaTeX/TikZベースの電気回路図に使う。TeX環境が必要で、PGFPlotsとは目的を分ける。
- **GeoGebra Calculator**: 対話的な作図、パラメータ操作、探索的な数学活動に使う。Webサービスなので、オフライン利用や埋め込み可能性を確認せずに保証しない。リンク: https://www.geogebra.org/calculator

## 出力と検証

- 静止図: SVGを第一候補、互換性が必要ならPNG。透明背景、余白、フォントの埋め込み/変換に注意する。
- LaTeX系: PDFまたはSVG/PNGへ変換し、TeXコンパイルの成功と出力を確認する。
- Manim: 動画の長さ、フレームレート、数式の崩れ、ナレーションとの同期を確認する。
- 日本語: 見出し、凡例、負号、単位、記号が欠けていないことを確認する。
- 納品: ソース、依存関係、実行コマンド、出力ファイル、未検証事項を明記する。

## 安全な実行

- AI生成コードを、環境確認なしに自動実行しない。
- shell文字列を組み立てて実行せず、実行が許可されたランタイムがある場合は実行ファイルと引数を分離する。
- ユーザーが指定した出力ディレクトリの外へ書き込まない。既存ファイルを上書きする前に確認する。
- 外部Webサービスへ教材内容を送る前に、送信される情報とユーザーの意図を確認する。
- 実行環境がない場合は、標準のSIGMA図形へ置き換えられるか検討し、無理ならセットアップ手順とソースのみ提供する。

## 最小コード例

### 日本語付き matplotlib

```python
import matplotlib.pyplot as plt
import japanize_matplotlib  # noqa: F401

x = list(range(-5, 6))
y = [value**2 for value in x]
fig, ax = plt.subplots()
ax.plot(x, y, label="二次関数")
ax.set(xlabel="x", ylabel="y", title="放物線")
ax.grid(True, alpha=0.25)
ax.legend()
fig.savefig("plot.svg", bbox_inches="tight")
```

### SciencePlots

```python
import matplotlib.pyplot as plt
import scienceplots  # registers the styles

plt.style.use(["science", "no-latex"])
fig, ax = plt.subplots()
ax.plot([0, 1, 2], [0, 1, 4], label="data")
ax.set_xlabel("x")
ax.set_ylabel("y")
ax.legend()
fig.savefig("science-plot.svg", bbox_inches="tight")
```

`no-latex` はLaTeX依存を避けたい場合の候補。利用可能なスタイルは実行環境で確認する。

### Schemdraw

```python
import schemdraw
import schemdraw.elements as elm

with schemdraw.Drawing() as drawing:
    drawing += elm.SourceV().label("Vin")
    drawing += elm.Resistor().right().label("R1")
    drawing += elm.Line().down()
    drawing += elm.Ground()
    drawing.save("circuit.svg")
```

APIや部品名はインストール済みSchemdrawのバージョンに合わせて確認する。例は構成のたたき台であり、回路の電気的妥当性を保証しない。

### PGFPlots / CircuitikZ

LaTeXソースを生成する際は、文書クラス・必要パッケージ・コンパイルコマンドを明記する。PGFPlotsはプロット、CircuitikZは回路図向け。コンパイラがない場合はコンパイル成功と報告しない。

### Manim Community

アニメーションを作る場合は、Sceneを小さく分け、依存関係と品質設定を明記する。実行後に生成された動画を再生確認する。Manimが未インストールなら、コード生成とレンダリング済み成果物を区別する。
