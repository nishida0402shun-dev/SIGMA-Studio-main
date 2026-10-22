# SIGMA Studio 資料ビューアー / SIGMA Core 連携 実装計画

- 文書種別：実装・検証計画
- 対象：SIGMA Studio デスクトップ版
- 連携先：`nishida0402shun-dev/SIGMA-Core`
- 元計画：`docs/sigma-studio-implementation-plan.md`
- 状態：実装開始時点の計画。各項目は実装・テスト・CI・Electron確認が終わるまで完了扱いにしない。

## 1. 目的

既存の教材編集・保存・AI編集・PDF出力を壊さず、外部資料（PDF、テキスト、Office、画像）の一覧・閲覧・選択・AI引き渡しを追加する。資料の保存・抽出・検索・部分取得は SIGMA Core が担当し、Studio は表示と操作を担当する。

## 2. 現状（2026-10-22）

### Studio

- `main` / `origin/main`：`5e86d78`
- 外部資料の一覧・ビューアーは未実装。
- 既存の「素材」は SigmaDoc 断片の再利用ライブラリであり、新しい「資料」とは別物。
- PDF は SigmaDoc の出力と、AI 添付時の main プロセス一時描画のみ。
- 旧 KnowledgeDB / SIGMA Core は main から削除済み（`ef4f559`、`10b3a9e`）。
- PPTX 取り込み、PaddleOCR ランタイムのビルドスクリプトは既存資産として存在。
- 未コミット変更：`apps/desktop/next-env.d.ts`、`package-lock.json`（実装中も保持）。

### SIGMA Core

- リポジトリ：`https://github.com/nishida0402shun-dev/SIGMA-Core`（public / MIT / `main`）
- 確認コミット：`5934a9d`
- ローカル確認：`npm ci`、`typecheck`、61テスト成功。
- 実装済み：
  - SQLite 正本ストア、内容アドレス型 blob 保管
  - Workspace・権限・監査・バックアップ・隔離
  - テキスト / PDF 抽出、1始まりページ番号、出典 bbox、警告
  - FTS5 検索、ページ範囲取得、MCP アダプタ
  - `SigmaStudioAdapter`
- 未実装：
  - Office / OCR 抽出
  - ページ内テキスト項目単位の範囲取得
  - PDF ページ画像レンダリング
  - Studio への接続、配布用パッケージ、読み取り専用 MCP プロファイル
  - Studio Workspace との対応付け

### 技術検証済み

- Electron 44.5.1 は Node.js 24.21.0 を使用する。
- Core の `CoreService` / `extraction` を esbuild で CJS に束ね、Node 24.21 で日本語2ページ PDF の登録・ページ取得に成功。
- CJS バンドル時の `import.meta.url` は `pathToFileURL(__filename)` の注入で解決できる。
- `node:sqlite` は Node 24.21 で動作確認済み。Electron 実機確認は M0 で行う。

## 3. 責務境界

### Studio

- `/sources` の資料一覧・Workspace 選択 UI
- ビューアー表示、ページ移動、ズーム、選択、スクロール
- 形式別レンダリングの統合
- ビューアー内に表示されている内容だけのキャプチャー
- 選択ページ / 範囲 / テキストの確認・編集・エクスポート
- CLI AI / Web AI ごとの引き渡し UI
- Core の状態・エラー表示

### SIGMA Core

- 原本保管、メタデータ、整合性管理
- テキスト抽出と出典位置情報
- 検索、ページ・範囲単位の部分取得
- AI 向け資料パッケージに必要なデータ API
- 永続化・抽出・検索のテストとデータ契約

### 守る境界

- レンダラは Core の DB に直接依存しない。Electron main の `SourceMaterialService` 経由にする。
- 既存の SigmaDoc 保存先（`library.json`、`documents/*.sigmadoc.json`）は Core へ移行しない。
- Core の DB / blob は `userData/data/sigma-core/` に置き、教材データと分離する。
- Core Workspace はユーザーが明示的に登録・選択したときだけ作成する。
- 既存の `PageCanvas` / `OutputSession` は SigmaDoc 用として維持する。外部 PDF は pdf.js で表示する。
- キャプチャーはビューアー内のページ画像 / 選択テキストだけ。デスクトップ全体・外部アプリは対象外。

## 4. 統合アーキテクチャ

```text
/sources (renderer)
  └─ IPC source-materials
       └─ SourceMaterialService (Electron main)
            ├─ SigmaStudioAdapter / CoreService
            │    ├─ SQLite: userData/data/sigma-core/core.sqlite
            │    └─ blob:   userData/data/sigma-core/blobs
            └─ PDF bytes → renderer の pdf.js でページ描画

CLI AI
  ├─ sigma-studio-local MCP（既存）
  └─ sigma-core-local MCP（Core の stdio サーバーを同梱・読み取り専用）

Web AI
  └─ Studio のプレビュー → コピー / エクスポート（MCP 接続を前提にしない）
```

### Core の取り込み

- `vendor/sigma-core` を submodule として固定し、Studio の main ビルドに esbuild で同梱する。
- Core の依存（`unpdf` など）はビルド時にバンドルし、実行時に submodule を要求しない。
- `better-sqlite3` は optional fallback として external のままにする。Electron 44 の Node 24 では `node:sqlite` を使う。
- Core の `SigmaStudioAdapter` を Studio 側の `SourceMaterialService` でラップする。
- Core の Workspace ID は `studio:<Studio workspace id>` とし、Studio の Workspace と対応付ける。
- `studio-local` を Studio 操作用、`studio-ai` を CLI AI 用の読み取り専用 subject とする。

### PDF 表示

- Core から原本 bytes を取得し、レンダラの `pdfjs-dist` でページ描画する。
- pdf.js の worker は使わず、CSP `worker-src 'none'` のまま fake worker で動かす。旧 KnowledgeDB の実装で前例がある。
- ページ番号は原本の1始まり。Core の抽出ページ番号と直接対応させる。
- 描画失敗とテキスト抽出失敗は別状態とする。
- fake worker が現在の pdfjs-dist / CSP で動かない場合は、main プロセスの `pdfjs-dist` + `@napi-rs/canvas` にフォールバックする。この場合も SigmaDoc のページネーションは使わない。

## 5. マイルストーン

### M0 基盤

- ベースライン取得：`next typegen`、typecheck、lint、テスト、build、Electron 起動。
- アーキテクチャ文書、形式対応表、Core ギャップ一覧。
- `vendor/sigma-core` submodule 固定。
- Core 同梱ビルド（`import.meta.url` shim、`node:sqlite`）。
- `CoreRuntime` / `SourceMaterialService` / IPC / preload 型。
- テスト：DB open、Workspace 明示登録、PDF 登録、一覧、ページ取得、bytes 取得、重複、権限、DB 異常。
- 受け入れ：既存アプリ無影響。Electron main で Core DB を開ける。

### M1 最初の縦切り

- `/sources` ルート、`app-navigation.ts`、静的ルート。
- Workspace 明示選択。未選択時の空状態。既定 Workspace を暗黙に使わない。
- ファイル取り込み（OSダイアログは main）。
- PDF ビューアー：ページ移動、ページ番号、ズーム、フィット幅、読み込み中 / 失敗。
- テキストビューアー：TXT / MD / CSV。UTF-8 / Shift_JIS。CSV は安全な表表示。
- 状態：loading / ready / unsupported / password-required / corrupt / ocr-required / empty / text-extraction-failed。
- テスト：ページ番号、抽出と描画の失敗分離、エンコーディング、UI状態、e2e。

### M2 選択・キャプチャー・AI引き渡し・Workspace

- 選択モデル：ページ、テキスト範囲、領域。
- 出典：sourceId、contentHash、page、offsets、bbox。
- プレビュー dialog：本文編集、ページ画像の有無、サイズ見積り、切り詰め警告。
- コピー / Markdown / TXT エクスポート。Web AI ごとのサイズ上限。
- ページ画像はビューアーの canvas から生成。`desktopCapturer` は使わない。
- CLI AI：Core MCP サーバーを `sigma-core-local` として追加。読み取り専用プロファイル。
- Workspace 切替時に選択・プレビュー・AI入力を破棄。
- 古い contentHash / 削除済み source の参照を拒否。
- テスト：出典パッケージ、サイズ上限、Workspace 切替、MCP スキーマ、e2e。

### M3 形式拡張

- HTML：サニタイズ表示、Core テキスト抽出。
- DOCX：HTML / テキスト抽出、サニタイズ表示。
- XLSX：シート / セル抽出、グリッド表示。
- PPTX：スライド表示、スライド / 図形の出典。
- 各形式で表示忠実度と AI 抽出品質を別々に記録。
- 新規依存はライセンス、保守状況、サイズ、Electron 互換性を確認。
- 代表サンプルと破損・大容量・パスワード等の異常系テスト。

### M4 OCR・性能

- 既存 PaddleOCR ランタイムをサイドカーとして統合。
- PDF / 画像の OCR を非同期ジョブにし、進捗・キャンセル・失敗を表示。
- Core に抽出結果の差し替え API を追加し、OCR 結果を出典付きで保存。
- 重い抽出を worker / utility process に分離。
- 大容量 PDF のメモリ・描画時間を測定。
- 必要なら Core にページ内テキスト項目と範囲取得 API を追加。

### M5 品質・リリース

- 単体 / 統合 / e2e / 回帰テスト。
- typecheck、lint、build、Electron / Windows スモーク。
- CI の submodule checkout、Core テスト、パッケージ検証。
- `THIRD_PARTY_NOTICES.md` 更新。
- 未確認事項を区別した作業報告。
- feature branch を push し、PR を作成。

## 6. 形式対応表

| 形式 | 表示 | 抽出 | 選択・出典 | 備考 |
|---|---|---|---|---|
| PDF | pdf.js canvas + テキストレイヤー | Core | ページ / テキスト / 範囲 | パスワード・破損・OCR必要を区別 |
| TXT / MD | テキスト | Core | テキスト範囲 | UTF-8 / Shift_JIS |
| CSV | 表 | Core | 行 / セル | 引用符・改行対応 |
| HTML | サニタイズ表示 | Core | テキスト / ブロック | スクリプト・外部読込なし |
| DOCX | サニタイズHTML | Core | 段落 / テキスト | 画像・容量制限 |
| XLSX | グリッド | Core | シート / セル範囲 | 数式・結合セルの制約 |
| PPTX | スライド | Core / Studio | スライド / 図形 | 既存 pptx 資産を評価 |
| 画像 / OCR | 画像 | PaddleOCR | 範囲 | 既存 OCR ランタイム |

## 7. テスト方針

- 単体：形式判定、能力表、状態遷移、選択→出典変換、サイズ上限、プレビュー生成、Workspace 切替。
- main：CoreRuntime の DB open/migrate、登録/一覧/ページ/範囲/検索、重複、権限、DB 異常。
- レンダラ：PDF ページ移動 / ズーム / 選択、TXT/MD/CSV/HTML/Office の状態表示。
- e2e：資料追加 → 表示 → ページ移動 → ズーム → 選択 → プレビュー → コピー → 再読込 → 削除/復元。
- 回帰：SigmaDoc の保存・読込・編集・マージ・提案承認、PDF 出力、素材、AI。
- Core：新 API、読み取り専用 MCP、抽出差し替え、範囲取得、エンコーディング。
- 未実行は「未実行」、結果不明は「未確認」と記録する。

## 8. リスク

- Core submodule 化により、ローカル / CI で `git submodule update --init` が必要。
- Electron 実機の `node:sqlite` / FTS5 / pdf.js fake worker は M0/M1 で確認する。
- Office / OCR は Core 側の追加実装が必要。OCR は PyInstaller / PaddleOCR の配布ライセンスとサイズを確認する。
- 既存 KnowledgeDB の削除判断と衝突しないよう、Core は新規資料ドメインだけに使う。
- 大容量 PDF のレンダラメモリと main の抽出ブロック。M1 で測定し、必要なら M4 で worker 化する。
- `next-env.d.ts` はコミットしない。`package-lock.json` は既存の無関係な差分と分離して扱う。

## 9. 作業報告テンプレート

- 目的：
- 変更ファイル：
- 変更内容：
- 実行したテスト：
- テスト結果：
- Electron 確認：
- CI 結果：
- 未確認事項：
- 回帰リスクと確認内容：
- 次の作業：
