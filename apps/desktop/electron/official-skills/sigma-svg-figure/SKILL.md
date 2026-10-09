---
name: sigma-svg-figure
description: "図・図解・模式図・イラスト・挿絵・フローチャート・幾何の作図・物理や化学の図を、静的SVG1枚として教材へ挿入・修正するときに使う。画像や図が必要になったら最初に検討する。"
---

# 図・イラストをSVGで挿入する

教材内でひとまとまりの図を表現する場合は、静的SVGを第一候補にする。後から個々の要素を動かす必要があるときだけ、個別の図形を使う。

追加には `insert_svg_image`、既存SVGの修正には `update_svg_image` を使う。SVGは自己完結させ、外部参照やスクリプトを含めない。数式や日本語ラベルは重なりを避け、縮小しても読める大きさにする。

単純な座標図の例:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140">
  <line x1="20" y1="120" x2="220" y2="120" stroke="#222" stroke-width="2"/>
  <line x1="40" y1="130" x2="40" y2="15" stroke="#222" stroke-width="2"/>
  <path d="M 55 100 Q 125 5 205 100" fill="none" stroke="#2463eb" stroke-width="3"/>
</svg>
```

簡単なフローチャートの例:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="150" viewBox="0 0 240 150">
  <rect x="55" y="12" width="130" height="38" rx="6" fill="#eef2ff" stroke="#334155"/>
  <rect x="55" y="100" width="130" height="38" rx="6" fill="#ecfdf5" stroke="#334155"/>
  <path d="M120 50 V100" stroke="#334155" stroke-width="2"/>
  <text x="120" y="36" text-anchor="middle" font-size="12">入力</text>
  <text x="120" y="124" text-anchor="middle" font-size="12">結果</text>
</svg>
```

出力前にSVGの構文、viewBox、文字のはみ出し、線の太さ、色のコントラストを確認する。既存の図を更新する場合は、依頼されていない要素を省略しない。
