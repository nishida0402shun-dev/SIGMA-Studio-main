# SIGMA Studio 資料ビューアー / SIGMA Core 連携 実装計画

- 文書種別：実装・検証計画
- 対象：SIGMA Studio デスクトップ版
- 連携先：`nishida0402shun-dev/SIGMA-Core`
- 元計画：`docs/sigma-studio-implementation-plan.md`
- 状態：M0〜M2 を実装済み。M3（Office / HTML）と M4（OCR）は未実装。各項目は実装・テスト・CI・Electron確認が終わるまで完了扱いにしない。

## 1. 目的

既存の教材編集・保存・AI編集・PDF出力を壊さず、外部資料（PDF、テキスト、Office、画像）の一覧・閲覧・選択・AI引き渡しを追加する。資料の保存・抽出・検索・部分取得は SIGMA Core が担当し、Studio は表示と操作を担当する。

## 2. 現状（2026-10-22）

### Studio

- 基準コミット：`5e86d78`。実装ブランチ：`feat/source-material-viewer`。
- `/sources` に資料一覧・Workspace 明示選択・PDF / テキストビューアーを実装。
- PDF ページ画像は Electron main の pdf.js + `@napi-rs/canvas` で PNG 化し、レンダラは Blob URL で表示する。
- 選択テキスト・ページ・範囲のキャプチャー、確認ダイアログ、テキスト / Markdown / PNG のコピー・保存を実装。
- CLI AI 向け `sigma-core-local` MCP（読み取り専用）を実装。Web AI は MCP を前提にせず、プレビューから手動で渡す。
- 既存の「素材」は SigmaDoc 断片の再利用ライブラリであり、新しい「資料」とは別物。
- 旧 KnowledgeDB / SIGMA Core は main から削除済み（`ef4f559`、`10b3a9e`）。
- PPTX 取り込み、PaddleOCR ランタイムのビルドスクリプトは既存資産として存在するが、資料ビューアーには未統合。
- 未コミット変更：`apps/desktop/next-env.d.ts`（ユーザー所有。コミット対象外）。

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
- Studio 側で実装済み：
  - Studio Workspace との対応付け（`studio:<Studio workspace id>`）
  - 読み取り専用 MCP プロファイル（`sigma-core-local`、subject `studio-ai`）
  - Studio main プロセスへの CJS 同梱
- Core 側で未実装：
  - Office / HTML / 画像の抽出
  - OCR 抽出結果の保存・差し替え API
  - ページ内テキスト項目単位の範囲取得
- Studio / CLI AI の互換性：
  - Core の MCP アダプタは変更せず、Studio が読み取り専用ツールだけを公開するラッパーを同梱する。
  - PDF ページ画像は Core ではなく Electron main が生成する。

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
            └─ PDF bytes → main の pdf.js + @napi-rs/canvas → PNG → renderer

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

- Core から原本 bytes を取得し、Electron main の `SourcePdfPageRenderer` が `pdfjs-dist` + `@napi-rs/canvas` でページを PNG に描画する。
- レンダラは PNG bytes を Blob URL にして表示する。CSP の `worker-src 'none'` を変更せず、pdf.js の worker をレンダラへ持ち込まない。
- ページ番号は原本の1始まり。Core の抽出ページ番号と直接対応させる。
- 描画失敗とテキスト抽出失敗は別状態とする。パスワード保護・破損・ページ範囲外は別コードで返す。
- SigmaDoc の `PageCanvas` / `OutputSession` は教材 PDF 用の唯一のページネーションエンジンとして維持し、外部資料 PDF には使わない。

## 5. マイルストーン

### M0 基盤（実装・単体テスト済み）

- ベースライン取得：`next typegen`、typecheck、lint、テスト、build、Electron 起動。
- アーキテクチャ文書、形式対応表、Core ギャップ一覧。
- `vendor/sigma-core` submodule 固定。
- Core 同梱ビルド（`import.meta.url` shim、`node:sqlite`）。
- `CoreRuntime` / `SourceMaterialService` / IPC / preload 型。
- テスト：DB open、Workspace 明示登録、PDF 登録、一覧、ページ取得、bytes 取得、重複、権限、DB 異常。
- 受け入れ：既存アプリ無影響。Electron main で Core DB を開ける。

### M1 最初の縦切り（実装・単体テスト済み）

- `/sources` ルート、`app-navigation.ts`、静的ルート。
- Workspace 明示選択。未選択時の空状態。既定 Workspace を暗黙に使わない。
- ファイル取り込み（OSダイアログは main）。
- PDF ビューアー：ページ移動、ページ番号、ズーム、フィット幅、読み込み中 / 失敗。
- テキストビューアー：TXT / MD / CSV。UTF-8 / Shift_JIS。CSV は安全な表表示。
- 状態：loading / ready / unsupported / password-required / corrupt / ocr-required / empty / text-extraction-failed。
- テスト：ページ番号、抽出と描画の失敗分離、エンコーディング、UI状態、e2e。

### M2 選択・キャプチャー・AI引き渡し・Workspace（実装・単体テスト済み）

- 選択モデル：ページ、テキスト範囲、領域。
- 出典：sourceId、contentHash、page、offsets、bbox。
- プレビュー dialog：本文編集、ページ画像の有無、サイズ見積り、切り詰め警告。
- コピー / Markdown / TXT エクスポート。Web AI ごとのサイズ上限。
- ページ画像はビューアーの canvas から生成。`desktopCapturer` は使わない。
- CLI AI：Core MCP サーバーを `sigma-core-local` として追加。読み取り専用プロファイル。
- Workspace 切替時に選択・プレビュー・AI入力を破棄。
- 古い contentHash / 削除済み source の参照を拒否。
- テスト：出典パッケージ、サイズ上限、Workspace 切替、MCP スキーマ、e2e。

### M3 形式拡張（未実装）

- HTML：サニタイズ表示、Core テキスト抽出。
- DOCX：HTML / テキスト抽出、サニタイズ表示。
- XLSX：シート / セル抽出、グリッド表示。
- PPTX：スライド表示、スライド / 図形の出典。
- 各形式で表示忠実度と AI 抽出品質を別々に記録。
- 新規依存はライセンス、保守状況、サイズ、Electron 互換性を確認。
- 代表サンプルと破損・大容量・パスワード等の異常系テスト。

### M4 OCR・性能（未実装）

- 既存 PaddleOCR ランタイムをサイドカーとして統合。
- PDF / 画像の OCR を非同期ジョブにし、進捗・キャンセル・失敗を表示。
- Core に抽出結果の差し替え API を追加し、OCR 結果を出典付きで保存。
- 重い抽出を worker / utility process に分離。
- 大容量 PDF のメモリ・描画時間を測定。
- 必要なら Core にページ内テキスト項目と範囲取得 API を追加。

### M5 品質・リリース（進行中）

- 単体 / 統合 / e2e / 回帰テスト。
- typecheck、lint、build、Electron / Windows スモーク。
- CI の submodule checkout、Core テスト、パッケージ検証。
- `THIRD_PARTY_NOTICES.md` 更新。
- 未確認事項を区別した作業報告。
- feature branch を push し、PR を作成。

## 5.1 実装結果（2026-10-22）

### 実装済み

- Core 同梱、DB / blob の分離、`SourceMaterialService`、IPC / preload、明示的な Workspace 登録。
- `/sources` の一覧、Workspace 選択、PDF ページ画像、ページ移動、ズーム、フィット幅、抽出テキスト。
- TXT / Markdown / CSV の表示。UTF-8 / Shift_JIS を UTF-8 に正規化してから Core へ登録。
- CSV は自前の防御的パーサーで表表示し、セル内容を HTML として解釈しない。
- テキスト選択・ページ・範囲のキャプチャー。出典に sourceId / contentHash / page / offsets / bbox を保持。
- キャプチャーの確認ダイアログ、本文編集、テキスト / Markdown コピー、範囲 PNG の保存、サイズ警告。
- キャプチャーはビューアーの表示画像 / 選択テキストから生成し、`desktopCapturer` や外部アプリの画面を使わない。
- Workspace 切替・資料切替・ページ移動時に選択とプレビューを破棄。更新済み contentHash / 削除済み source はコピー操作を拒否。
- 資料の削除（アプリ内確認）と undo（Core の PendingDeletion からの復元）。
- CLI AI の `sigma-core-local`（読み取り専用、subject `studio-ai`）。Claude / Codex / Antigravity の設定へ追加。
- Web AI は MCP を前提にせず、プレビューからコピー / 画像保存で渡す。

### 形式サポート状況

| 形式 | 表示 | Core 抽出 | 状態 |
|---|---|---|---|
| PDF | あり（main で PNG 化） | あり | 実装・単体テスト済み |
| TXT / MD | あり | あり | 実装・単体テスト済み |
| CSV | 表表示 | あり（プレーンテキスト） | 実装・単体テスト済み |
| HTML | なし | なし | 未実装。サニタイズ方針と Core 抽出が必要 |
| DOCX | なし | なし | 未実装。抽出・表示の依存とライセンス評価が必要 |
| XLSX | なし | なし | 未実装。シート / セル出典の設計が必要 |
| PPTX | なし | なし | 未実装。既存 PPTX 取り込み資産を資料ビューアー向けに再利用する設計が必要 |
| 画像 / OCR | なし | なし | 未実装。PaddleOCR ランタイムが未同梱 |

未対応形式は取り込み時に `UNSUPPORTED_FORMAT` と日本語の案内を返し、壊れた表示や空の成功にしない。

### OCR の未確認事項

- `apps/desktop/ocr-runtime/windows|mac` は `.gitkeep` のみで、PaddleOCR の実行バイナリはリポジトリに含まれていない。
- `npm run ocr:runtime:build` は PaddlePaddle / PaddleOCR / PyInstaller を必要とし、この Linux 環境では実行していない。
- OCR 結果を Core の抽出成果物として差し替える API は Core 側に未実装。
- そのため、画像ベース PDF は `OCR_REQUIRED` の警告とテキスト抽出不可を表示する。OCR 実行・進捗・キャンセルは未実装。

### 実行済みの検証

- 資料サービス、PDF ページ描画、キャプチャー、CSV、UI、MCP、CLI 設定の focused tests（71 tests）。
- TypeScript typecheck。
- ESLint（`@sigma-studio/desktop`、`--max-warnings=0`）。
- Electron ビルド（main / preload / 2 MCP サーバー）。
- 静的エクスポート（`NEXT_PUBLIC_TARGET=desktop`）。`out/sources.html` を確認。

### 未確認事項

- Electron GUI はこの Linux コンテナの共有ライブラリ不足（`libatk-1.0.so.0` など）で起動できないため、実ウィンドウでの PDF 表示・範囲ドラッグ・コピー・OS ファイルダイアログは未確認。
- PaddleOCR の実バイナリでの OCR 精度・速度・配布サイズは未確認。
- Windows / macOS 実機でのパッケージ済み MCP 起動は未確認。

## 6. 形式対応表

| 形式 | 表示 | 抽出 | 選択・出典 | 備考 |
|---|---|---|---|---|
| PDF | main の pdf.js で PNG 化 | Core | ページ / テキスト / 範囲 | パスワード・破損・OCR必要を区別 |
| TXT / MD | テキスト | Core | テキスト範囲 | UTF-8 / Shift_JIS |
| CSV | 表 | Core | 行 / セル | 引用符・改行対応 |
| HTML | サニタイズ表示 | Core | テキスト / ブロック | スクリプト・外部読込なし |
| DOCX | サニタイズHTML | Core | 段落 / テキスト | 画像・容量制限 |
| XLSX | グリッド | Core | シート / セル範囲 | 数式・結合セルの制約 |
| PPTX | スライド | Core / Studio | スライド / 図形 | 既存 pptx 資産を評価 |
| 画像 / OCR | 画像 | PaddleOCR | 範囲 | 既存 OCR ランタイム（未統合） |

上表は目標とする形式対応。現時点の実装状況は「5.1 実装結果」を正とする。

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
