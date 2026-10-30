# SIGMA Studio × SIGMA Core 連携・自動更新 実装計画書

- 文書種別: 実装計画書
- 作成日: 2026-10-28
- ステータス: Phase 0 調査済み。Windows unpacked app での Core MCP 統合検証は CI 成功。NSIS installer など未確認事項を §16 に記録
- 主目的: SIGMA Core の更新を安全に SIGMA Studio へ反映できる開発・配布フローを構築する
- 対象リポジトリ:
  - SIGMA Studio: https://github.com/nishida0402shun-dev/SIGMA-Studio-main
  - SIGMA Core: https://github.com/nishida0402shun-dev/SIGMA-Core

---

## 1. 概要

SIGMA Studio と SIGMA Core は別々の GitHub リポジトリとして維持する。Core のコードを Studio に無条件でコピーしたり、Studio のビルド時に常に最新版を取得したりするのではなく、Core の更新を検知し、バージョンと互換性を確認したうえで Studio へ反映する。

目標とするフローは次のとおり。

1. SIGMA Core を独立して開発・テストする。
2. Core の変更をバージョン付きの成果物または固定コミットとして識別できるようにする。
3. Core のリリース／更新を契機に、Studio 側の依存更新を自動検知する。
4. Studio の更新ブランチ／Pull Request（PR）を作成する。
5. Core 単体テスト、Studio のテスト、MCP 統合テスト、パッケージング検証を実行する。
6. 成功した更新をレビュー・承認後にマージする。
7. 承認済みの Core バージョンを含む Studio をビルド・配布する。

**重要:** 自動化するのは更新の検知・PR 作成・テストまでを基本とし、初期段階では本番ブランチへの自動マージや、配布版への未検証更新の自動反映は行わない。

## 2. 設計原則

1. **リポジトリを分離する。** Studio と Core は別々の履歴・Issue・PR・リリースを持つ。
2. **Core のバージョンを固定する。** Studio の再現可能なビルドのため、依存する Core の版を lockfile 等で固定する。
3. **更新は段階的に反映する。** Core の更新を即座に本番採用せず、Studio 側の検証を通す。
4. **契約を明示する。** MCP のツール名・入力スキーマ・戻り値・エラー形式・互換性方針を管理する。
5. **非破壊を優先する。** 既存 Studio 文書ストア、既存 MCP、Skills、AI 設定を、移行検証前に削除・置換しない。
6. **ローカル MCP を初期接続方式とする。** Studio が Core MCP プロセスを起動し、stdio で通信する。初期実装では外部ポートを公開しない。
7. **証拠に基づいて完了判定する。** CI 設定の存在だけでなく、最新コミットの実行結果、配布版の動作、テストログを確認する。
8. **大きな設計変更は事前レビューする。** データ形式変更、破壊的 API 変更、書き込み系ツール追加は別途レビューする。
9. **秘密情報を保護する。** CI トークンは最小権限にし、不要な PAT を作成・保存しない。
10. **人間の承認点を残す。** 初期運用では依存更新 PR をレビュー後にマージする。

## 3. 目標アーキテクチャ

```text
┌────────────────────────────┐
│ SIGMA Core Repository      │
│ Source / Tests / CI        │
│ Versioned release          │
└──────────────┬─────────────┘
               │ release / version update event
               ▼
┌────────────────────────────┐
│ Update automation          │
│ Detect update              │
│ Create Studio update PR    │
│ Run compatibility tests    │
└──────────────┬─────────────┘
               ▼
┌────────────────────────────┐
│ SIGMA Studio Repository    │
│ Pinned Core dependency     │
│ Lockfile / Integration     │
│ Tests / Packaging          │
└──────────────┬─────────────┘
               │ approved build
               ▼
┌────────────────────────────┐
│ SIGMA Studio Desktop App   │
│ Electron UI / Local MCP    │
└──────────────┬─────────────┘
               │ stdio
               ▼
┌────────────────────────────┐
│ SIGMA Core MCP Server      │
│ Core Services / SQLite     │
│ BlobStore / Search / OCR   │
└────────────────────────────┘
```

この図は目標構成であり、現時点で全経路が実装済みであることを示すものではない。

## 4. Core の配布方式を選ぶ

自動更新の仕組みを実装する前に、Core を Studio がどのように取得・実行するかを確定する。現行リポジトリの package.json、ビルド設定、ネイティブ依存、MCP 起動方法を確認し、以下から選定する。

### 選択肢 A — npm パッケージ

Core をバージョン付きパッケージとして公開し、Studio から依存関係としてインストールする。

利点:
- SemVer と lockfile によるバージョン固定が明確。
- 依存更新ツールとの連携が容易。
- Studio の依存関係として扱いやすい。

確認事項:
- Core が独立したパッケージとしてビルド可能か。
- public/private の公開範囲とレジストリ運用。
- ネイティブ依存や必要な実行時ファイルをパッケージに含められるか。
- パッケージ導入だけで packaged Electron 内の起動が保証されるわけではない点。

### 選択肢 B — Git 依存／固定コミット

Studio が Core リポジトリのタグまたは固定コミットを依存として参照する。

利点:
- 導入初期の配布基盤を増やさず試せる。
- 固定コミットで再現性を確保できる。

確認事項:
- Git 依存のインストール時ビルド、サブ依存、認証、キャッシュ。
- 実行可能な成果物の生成方法と再現性。
- Core のビルド成果物が必要な場合の生成・同梱方法。

### 選択肢 C — リリース成果物をダウンロードして同梱

Core の CI が MCP サーバーと必要な実行時ファイルをアーカイブし、Studio の CI が固定バージョンの成果物を取得してパッケージへ同梱する。

利点:
- 実行時ファイル一式とバージョンを明確に管理できる。
- Studio のアプリパッケージに何が含まれるかを検査しやすい。

確認事項:
- アーカイブのチェックサム、真正性、OS 別成果物。
- 依存関係、Electron／Node 起動方式。
- 更新時の互換性とリリース成果物の保持期間。

### 選定方針

Phase 0 で実装・依存・パッケージ構成を調査してから選ぶ。現 checkout で確認した方式と根拠は §16.1 に記録した。複数方式を同時に採用しない。新たな更新自動化や既存 workflow の意味変更は、採用方式と検証条件を明記してから行う。

## 5. バージョンと互換性契約

### 5.1 バージョン管理

- Core は明示的なバージョンを持つ。
- 公開 API／MCP 契約の後方互換性を SemVer 等の規則で管理する。
- Studio は利用する Core バージョンを package manifest、lockfile、またはリリース設定に固定する。
- Core の開発ブランチの先端を Studio の通常ビルドが暗黙に参照しない。
- リリースノートに変更点、破壊的変更、移行要件、既知の問題を記載する。

### 5.2 MCP 契約

契約書には少なくとも以下を含める。

- MCP サーバー識別子と互換性バージョン
- ツール名と用途
- 入力スキーマ、必須・任意フィールド、サイズ上限
- 出力スキーマ、出典情報、ページ番号等の意味
- エラー分類と再試行可能性
- 権限主体と Workspace の指定方法
- タイムアウト、キャンセル、進捗通知の扱い
- 廃止予定ツールと移行期間
- 互換性を壊す変更の検出方法

契約変更時には契約テストを更新し、Studio と Core の両方で実行する。

### 5.3 互換性ルール

- パッチ更新：原則として後方互換性を維持する。
- マイナー更新：既存契約を維持しながら機能を追加する。
- メジャー更新：破壊的変更、移行手順、Studio 側修正を明示する。
- 互換性が判定できない更新は、自動採用せず PR をブロックする。
- 実際のプロジェクトが別のバージョン規則を採用している場合は、既存ルールを調査してから統一する。

## 6. 自動更新フロー

### 6.1 通常フロー

1. Core の PR で型チェック・単体テスト・ライセンス検査などを実行する。
2. Core のリリース候補または正式リリースを作成する。
3. Core リリースをトリガーとして Studio 側の更新検知を開始する。
4. Studio 側で依存バージョン／固定コミットを更新するブランチを作成する。
5. Studio の型チェック、単体テスト、MCP 統合テスト、ビルド、パッケージ内容検査を実行する。
6. 結果、変更点、Core バージョン、テストログを記載した PR を作成する。
7. 必須チェックが成功した後、担当者が差分をレビューする。
8. 承認後にマージする。
9. Studio のリリース工程で承認済み Core を含む成果物を作成する。

### 6.2 自動化してよい作業

- Core リリース／タグの検知
- Studio 側依存バージョンの更新ブランチ作成
- 更新 PR 作成
- テスト・型チェック・ビルド・パッケージ検査
- PR へのテスト結果・更新内容の要約追加
- 互換性テスト失敗時の PR チェック失敗

### 6.3 初期段階で自動化しない作業

- Studio の本番ブランチへの自動マージ
- 未検証バージョンの配布版への自動反映
- DB スキーマ変更やデータ移行の自動実行
- 破壊的 API 変更の自動承認
- 書き込み系 MCP ツールの無審査追加
- 不明なテスト失敗を無視しての強制マージ

## 7. GitHub Actions の構成案

実際の workflow 名やイベントは既存 CI を確認してから決定する。以下は役割の案であり、現状に存在する workflow 名を示すものではない。

### 7.1 Core CI

トリガー:
- Pull Request
- Core のメインブランチ更新
- リリース作成前

チェック候補:
- 型チェック
- 単体テスト
- MCP 契約テスト
- ライセンス検査
- パッケージビルド
- パッケージに必要ファイルが含まれることの検査
- 依存関係／脆弱性の検査（既存運用に合わせる）

### 7.2 Core Release

トリガー:
- 承認されたタグまたは GitHub Release

処理:
- クリーンな環境でビルド・テストを実行する。
- バージョンとコミット SHA を記録する。
- 必要なら成果物アーカイブを作成する。
- チェックサムを生成し、成果物と一緒に公開する。
- リリースノートを添付する。

### 7.3 Studio Update Check

トリガー:
- Core の正式リリース
- 手動実行（workflow_dispatch）
- 定期確認を導入する場合は、過剰な更新 PR を避ける頻度に制限

処理:
- 最新の許可された Core バージョンを確認する。
- Studio の依存参照だけを更新する。
- lockfile を更新する。
- 更新ブランチ／PR を作成する。
- Studio と Core の統合チェックを実行する。

### 7.4 Studio CI

チェック候補:
- Studio の型チェック・単体テスト
- Core MCP の起動・初期化・ツール一覧取得
- 読み取り専用ツール呼び出し
- Workspace 認可と不正入力テスト
- 既存 MCP／Skills／文書ストアの回帰テスト
- アプリビルド
- packaged app 内に Core 成果物が含まれることの検査
- Windows runner での起動・接続試験（可能なもの）
- ライセンス検査

CI 成功は、その CI 環境における成功を示す。Windows 実機・ユーザー環境の動作確認とは区別する。

### 7.5 トークンと権限

- GitHub Actions の `GITHUB_TOKEN` は必要最小限の権限で使用する。
- PR 作成に必要な権限を workflow 単位で限定する。
- private package 認証が必要な場合は、配布方式を確定してから秘密情報の管理方法を決める。
- トークンをソースコード、ログ、PR 本文へ出力しない。
- fork からの PR で秘密情報が実行されないよう、イベント種別と権限を確認する。
- 可能な限り、追加 PAT を避け、GitHub の標準トークンで成立する構成を優先する。

## 8. ローカル MCP 接続の要件

Studio のアプリ実行時には、承認済みの Core バージョンをローカルプロセスとして起動する。

### 8.1 起動・通信

- Studio が Core MCP サーバーを子プロセスとして起動する。
- stdio を使って MCP メッセージを交換する。
- stdout は MCP 通信専用、ログは stderr またはアプリ側ロガーに送る。
- 起動タイムアウト、接続切断、異常終了を処理する。
- Studio 終了時に子プロセスをクリーンアップする。
- 初期構成では HTTP ポートを公開しない。

### 8.2 データ・Workspace

- DB と Blob の保存先はユーザーデータ領域に明示的に設定する。
- Workspace はユーザーが選択し、未選択時は自動で選ばない。
- Studio と Core の Workspace ID 契約を明文化する。
- `shared:` 等の ID 接頭辞を無検証で取り除かない。
- Studio の既存文書ストアを初期段階で削除・置換しない。

### 8.3 最小権限

- 最初に公開するツールは検索・メタデータ参照・ページ取得などの読み取り専用とする。
- 任意 SQL、任意パスのファイル読み込み、任意コマンド実行を公開しない。
- Studio の UI だけでなく Core 側でも権限を検証する。
- 結果に出典 ID・ページ番号等を保持する。
- クラウド上で動く Web AI がローカル MCP へ直接接続できるとは仮定しない。Studio 内の仲介など、別途検証された経路を用意する。

## 9. Windows 配布と実機検証

- Core MCP 成果物と必要な依存関係が配布パッケージに含まれる。
- 実行時にソースコードや開発用 Node.js の手動配置を要求しない。
- Electron／Node の起動方式が対象バージョンで動作する。
- パスに空白や日本語が含まれても起動できる。
- DB／Blob がインストールディレクトリではなくユーザーデータ領域へ保存される。
- クリーンな Windows 環境で初期化、ツール一覧、検索、ページ取得が成功する。
- Core が存在しない・起動できない場合、既存 Studio 機能が可能な範囲で利用でき、明確なエラーが表示される。
- 更新後もデータが維持される。データ形式変更時は明示的な移行手順がある。

## 10. テスト計画と品質ゲート

| ID | テスト内容 | 合格条件 |
|---|---|---|
| AUTO-001 | Core CI | 必須の型チェック・単体テストが成功 |
| AUTO-002 | Core リリース識別 | バージョンとコミット SHA が追跡できる |
| AUTO-003 | Studio 依存固定 | Studio の依存参照と lockfile が更新される |
| AUTO-004 | 更新 PR 自動作成 | Core 更新時に Studio の PR が作成される |
| AUTO-005 | PR 必須チェック | 必須チェックが成功するまでマージできない |
| MCP-001 | stdio 起動 | Core プロセスが正常に起動する |
| MCP-002 | MCP 初期化 | クライアントとの初期化が成功する |
| MCP-003 | ツール一覧 | 定義済みツールを取得できる |
| MCP-004 | 読み取りツール | 実際のデータに対する応答が返る |
| MCP-005 | stdout 分離 | ログがプロトコルを破壊しない |
| MCP-006 | Workspace 未選択 | 自動選択せず拒否する |
| MCP-007 | 権限外アクセス | Core 側で拒否される |
| MCP-008 | 不正・過大入力 | 安全に拒否される |
| MCP-009 | Core 異常終了 | Studio がエラーを処理し、回復可能な状態を保つ |
| MCP-010 | 既存機能回帰 | 既存 MCP／Skills／文書ストアが維持される |
| PKG-001 | packaged app 同梱 | 必要な Core 成果物がパッケージ内に存在する |
| PKG-002 | Windows 起動 | クリーン環境で Core が起動する |
| PKG-003 | 検索・ページ取得 | 配布版で実際のツール呼び出しが成功する |
| PKG-004 | データ保存先 | ユーザーデータ領域に保存される |
| SEC-001 | 権限・秘密情報 | 権限の過剰付与やログへの秘密情報漏えいがない |
| SEC-002 | 依存・ライセンス | 必須のライセンス検査等が成功する |

各テストについて、コミット SHA、OS、Node／Electron バージョン、実行日時、コマンド、実際の結果を記録する。実行していないテストを成功扱いにしない。

## 11. フェーズと完了条件

### Phase 0 — 現状調査

作業:
- Studio／Core の最新 HEAD、ブランチ、作業ツリー、CI を確認する。
- Studio の package.json、lockfile、workspace、Core 参照、Electron パッケージング設定を確認する。
- Core の package.json、MCP エントリーポイント、ビルド成果物、ネイティブ依存を確認する。
- 現在の MCP 起動コードと実際の呼び出し元を確認する。
- 既存の GitHub Actions とリリース手順を確認する。
- 配布方式 A/B/C を比較し、根拠付きで選定する。

完了条件:
- 現在の構成と不足点をファイル・設定・CI 結果に基づいて記録する。
- 配布方式とバージョン規則の案を確定する。
- 破壊的変更を伴わず次フェーズに進めることを確認する。

### Phase 1 — Core のリリース単位を確立

作業:
- バージョン番号、タグ、リリースノートの規則を整える。
- Core のビルド成果物を確定する。
- MCP 契約と互換性ルールを文書化する。
- Core CI とパッケージ内容検査を整える。

完了条件:
- 特定の Core バージョン／コミットから再現可能な成果物を生成できる。
- Core 単体テストと契約テストが実行できる。
- リリース成果物の内容と必要な依存関係が明確である。

### Phase 2 — Studio の依存固定と手動統合

作業:
- Studio が特定 Core バージョンを参照するようにする。
- Studio から Core MCP を起動する。
- initialize／tool list／読み取りツール呼び出しを統合する。
- 検索・ページ取得を接続する。

完了条件:
- Studio が固定された Core バージョンを利用する。
- 開発環境で MCP 接続と読み取り操作が成功する。
- 既存機能の回帰テストが成功する。

### Phase 3 — 更新検知と PR 自動化

作業:
- Core の正式リリースを検知する workflow を用意する。
- Studio の依存参照と lockfile を更新する PR を自動作成する。
- PR で Studio/Core の統合テストを実行する。
- 失敗時は自動的にチェックを失敗させ、更新を保留する。

完了条件:
- Core の新しいリリースから Studio の更新 PR まで自動化されている。
- PR に Core バージョン、変更概要、テスト結果が記録される。
- 必須チェック成功とレビューを経ない自動マージが行われない。

### Phase 4 — Windows 配布と品質ゲート

作業:
- Core 成果物の配布版同梱を実装する。
- Windows CI／実機で起動・接続・検索・ページ取得を検証する。
- 異常系・権限・データ保存先を検証する。
- 更新後のデータ保持と復旧手順を確認する。

完了条件:
- packaged app で MCP 接続と主要読み取り機能が成功する。
- 異常系と回帰テストが成功する。
- 未検証項目と残存リスクが明記されている。

### Phase 5 — 運用・拡張

候補:
- 会話履歴検索や OCR ジョブ状態取得の追加
- Web AI の安全な仲介
- Core データを共通基盤とする正式移行
- 必要に応じた書き込み系 MCP ツール

これらは初期接続・更新フローの受け入れ後に検討し、データ移行や書き込み系操作は別途の安全性レビューを必須とする。

## 12. ロールバックと障害対応

- 更新 PR のテストが失敗した場合はマージせず、直前の安定バージョンを維持する。
- リリース後に重大な問題が判明した場合、Studio が参照する Core バージョンを直前の安定版へ戻せるようにする。
- データベース形式を変更する Core 更新では、バックアップ、移行前チェック、移行後検証、失敗時の復旧手順を別途定義する。
- DB の自動ダウングレードは安全性が確認できない限り行わない。
- Core の起動失敗時に Studio 全体が起動不能にならないよう、障害を局所化する。
- 更新を停止するための手動 workflow／リリース無効化手順を用意する。

## 13. 成果物チェックリスト

- [ ] Studio/Core の現状調査レポート
- [ ] Core 配布方式の決定記録
- [ ] Core バージョン・リリース運用ルール
- [ ] MCP 契約・互換性文書
- [ ] Core CI／リリース workflow
- [ ] Studio の固定 Core 依存
- [ ] Studio の MCP プロセス管理と統合
- [ ] Core 更新検知・PR 自動作成 workflow
- [ ] Studio 統合テスト・回帰テスト
- [ ] Windows packaged app の接続テスト
- [ ] ロールバック・データ復旧手順
- [ ] 既知の制限と残課題一覧

## 14. 作業報告フォーマット

各作業の報告には必ず以下を記録する。

- 対象リポジトリ、ブランチ、コミット SHA
- 変更ファイルと変更目的
- 実行したテスト・コマンド
- 実際の結果（成功／失敗／未実行）
- CI 結果へのリンク（確認できた場合）
- 開発環境と Windows packaged app のどちらで検証したか
- 未確認事項、残課題、既知のリスク
- 次に着手する作業

「コードが存在する」「CI 設定が存在する」「過去の CI が成功した」「今回のコミットでテストが成功した」「Windows 配布版で動作した」は別々に扱う。

## 15. 参考資料

- SIGMA Studio: https://github.com/nishida0402shun-dev/SIGMA-Studio-main
- SIGMA Core: https://github.com/nishida0402shun-dev/SIGMA-Core
- MCP 公式仕様 — Transports: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- MCP 公式ガイド — Build an MCP server: https://modelcontextprotocol.io/docs/develop/build-server
- GitHub Actions 公式ドキュメント: https://docs.github.com/en/actions
- GitHub Actions の GITHUB_TOKEN 権限: https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication

---

## 16. 現状調査ステータス（2026-10-30）

Phase 0 の調査を完了した。以下はこの Studio checkout と、その submodule に記録されたローカル Git 参照・ファイル設定の確認結果であり、GitHub Actions の今回の実行結果や配布版の動作を示すものではない。

### 16.1 確認した現状と採用する方式

| 対象 | 確認結果 | 根拠 |
|---|---|---|
| Studio checkout | 調査開始時は `main` の `78eabea224bdefb2d48eec12d4827f4791d28e71`。その時点の作業ツリーは clean。ローカル `origin/main` は `9e38948230c1d7d41101b44005231baf261e5a7a` で、checkout は1コミット遅れていた。調査後の変更は本PRに反映する。 | `git status --short --branch`、`git log` |
| Core checkout | submodule `vendor/sigma-core` は clean な detached HEAD `7875235d5d9b985e745c24926a244b58c23ba413`。Studio の gitlink と Core checkout 内の `origin/main` が同じ SHA。これは checkout に記録された ref の比較であり、リモートを今回 fetch して最新性を確認した結果ではない。 | `.gitmodules`、`git submodule status`、`git ls-tree HEAD vendor/sigma-core`、Core の `git status` / `git branch -avv` |
| 依存の固定 | Core は Git submodule として SHA 固定され、root npm workspace にも含まれる。lockfile は npm 公開 tarball ではなく `vendor/sigma-core` を workspace link として記録する。 | `.gitmodules`、root `package.json`、`package-lock.json` |
| Core の package/CI | `@sigma-studio/core` は `private: true`、`version: 0.1.0`、ESM/TypeScript。package scripts に build/release はなく、Core CI は Node 22/24 の audit・license・test・typecheck と Windows OCR job を定義する。 | `vendor/sigma-core/package.json`、`vendor/sigma-core/.github/workflows/ci.yml` |
| Studio への実装・同梱 | Studio main は Core の TypeScript を `source-material/core-bridge.ts` 経由で直接利用する。esbuild は main と `sigma-core-mcp-server` を CJS に束ね、electron-builder は `dist-electron/**/*` を対象にする。配布物の実起動確認とは別。 | `apps/desktop/electron/source-material/core-bridge.ts`、`apps/desktop/scripts/build-electron.mjs`、`apps/desktop/electron-builder.config.cjs` |
| MCP | CLI AI 用に別の読み取り専用 `sigma-core-local` stdio server を Studio 側で実装し、Core のフル MCP entrypoint の代わりに Studio の制限されたツール面を使う。UI の資料機能は Electron main の `SourceMaterialService` が担う。 | `apps/desktop/mcp/source-material-mcp-server.ts`、`source-material-mcp-server-core.ts`、`electron/source-material/source-material-service.ts`、`electron/sigma-studio-mcp-launch.ts` |
| 更新自動化 | 手動実行と日次 schedule が Core `origin/main` を確認し、候補の audit/license/test/typecheck 後に SHA 固定と lockfile 更新の PR を作成する。続いて Studio Checks を dispatch して完了を待つ。PR は自動 merge しない。リリースイベント起点ではない。 | `.github/workflows/update-sigma-core.yml` |
| Studio CI | Linux checks に Core test/typecheck/license を含む。調査時点の Windows smoke は Electron での文書オープンのみだったため、本作業で Core MCP smoke を追加した。 | `.github/workflows/checks.yml` |

**この計画で採用する方式:** Core ソースを Git submodule の固定 SHA として保持し、Studio の Electron main と Core MCP server にビルド時バンドルする。更新は Core `main` の新 SHA を日次／手動で検知し、検証後にレビュー用 PR を作成する。これは npm 公開 package やリリース成果物ダウンロードではなく、既存実装に基づく commit-pinned source integration である。自動化は PR までとし、現 workflow のイベントや自動化範囲はこの Phase 0 では変更しない。

### 16.2 フェーズ別の判定

| フェーズ | 判定 | 根拠・残り |
|---|---|---|
| Phase 0 — 現状調査 | 完了 | 本節の checkout、依存、実装、workflow の確認結果と方式選定を記録した。今回の調査では workflow 実行ログや Windows 配布版は検証していない。 |
| Phase 1 — Core のリリース単位 | 一部あり／未完了 | Core の package version と独立 CI はあるが、package は private で build/release script はなく、固定 SHA を越える互換性・リリース規則や配布成果物は確認できていない。採用方式では Git SHA を成果物の固定識別子とし、npm 公開は前提にしない。 |
| Phase 2 — Studio の依存固定と手動統合 | 実装あり／CI検証済み | submodule pin、資料サービス、読み取り専用 stdio MCP、Electron バンドルが存在する。PR #40 の Windows CI で unpacked app 内の MCP 起動・読み取り往復・再起動後のデータ保持を確認した。 |
| Phase 3 — 更新検知と PR 自動化 | 実装あり／計画との差あり | schedule/manual 起点で Core `main` の SHA を検証して PR と Studio Checks を起動する。Core の正式 release/tag 起点ではないため、実装に合わせて本計画の更新トリガー記述を扱う必要がある。 |
| Phase 4 — Windows 配布と品質ゲート | 一部完了／継続中 | Core MCP bundled entrypoint の initialize・read-only tool list・登録済み Workspace／source の list・search・page・page range・再起動後のデータ保持・cleanupを検証する smoke がLinuxとWindows CIで成功。Windows 向け `win-unpacked` をCIで生成し、`app.asar` 内entrypointを実際のElectron executableから起動した。NSIS installer、Core更新をまたぐデータ保持、対象ユーザー環境での実機検証は未確認。 |
| Phase 5 — 運用・拡張 | 未着手 | 初期接続・配布検証後の候補として保留する。 |

### 16.3 追加した最小ゲートと未確認事項

`apps/desktop/tests/electron/sigma-core-mcp.spec.ts` に bundled `sigma-core-mcp-server.cjs` の stdio smoke を追加し、`.github/workflows/checks.yml` の Windows Electron smoke job から既存の文書オープン smoke と一緒に実行する。テストは `testInfo.outputPath` 以下の隔離データを使う。テスト用 Core seeder は `CoreService.createWorkspace` と `registerObject` を Studio subject の認証で実行し、Studio の `SourceMaterialService` と同じ `studio-ai` read grant を Core repository API で付与する。MCP 側は実際の `studio-ai` 認証で同じ DB／blob path を開き、initialize/server identity、read-only tool list、workspace list、sources list、検索、ページ取得、ページ範囲取得を検証する。Seeder は MCP 起動前に repository を閉じ、MCP は graceful shutdown 後に必要なら signal で終了させ、user data の削除と process close を確認する。

さらに既存PR #40 で、`apps/desktop/mcp/source-material-mcp-server-stdio.integration.test.ts` をLinux／Windowsで実行可能にし、Windows CIではelectron-builderの `--win --dir --publish never` で生成した `release/win-unpacked` の Electron executable から `resources/app.asar` 内のCore MCP entrypointを起動するよう拡張した。`check-native-lock-package.cjs` は従来のnative lock検査に加えて、asar内の `dist-electron/sigma-core-mcp-server.cjs` の存在も検査する。Windows runnerはCore更新workflowやリリースworkflowとは独立して、パッケージをpublishせず smoke を実行する。PRのCIで追加テストに起因する `content` の `unknown` 型エラーが見つかったため、MCP結果のcontent/textを実行時検証してからJSON parseする修正を追加した。

Linux上ではbundled MCPのinitialize、read-only tool list、登録済み資料の一覧・検索・ページ・range取得、mutation拒否、MCP再起動後のデータ保持、隔離DB/blobの利用とcleanupを確認した。Windows CIではunpacked appを作成し、`app.asar`内のCore MCP entrypointを実際のWindows Electron executableから起動して同じread-only往復と再起動後の保持を確認した。PR #40 のChecks run `41025838625` では既存package hook test用asar fixtureがCore bundle必須条件を満たさず2 job失敗したが、fixtureへCore MCP entryを追加し解消した。run `41027066836` はPublic package jobの`npm ci`がGitHub runnerのネットワークtimeoutで一度失敗したが、failed-job retry (attempt 2) ですべて成功した。再起動後のデータ保持テストを加えた最新head `5762504` のrun `41028731742` も全4 job成功。NSIS installer、Core更新をまたぐデータ保持、対象ユーザー環境での実機検証は未確認。自動merge・インストーラー公開は行っていない。

この checkout では focused MCP smoke と desktop typecheck／lint が成功した。既存の stdio 統合テストは Windows runner 上で packaged Electron を使った起動・終了まで確認済み。一方、本PRで追加する Playwright smoke の Windows 実行結果は、この変更を含む CI が完了するまで未確認とする。NSIS installer、Core 更新をまたぐデータ保持、対象ユーザー環境での実機確認も未確認である。

今回の検証結果:

| コマンド | 結果 |
|---|---|
| `npm --workspace @sigma-studio/desktop run electron:build` | 成功（Core MCP の CJS bundle を生成） |
| `npm --workspace @sigma-studio/desktop run test:e2e:electron -- tests/electron/sigma-core-mcp.spec.ts` | 成功（1 test passed、Node fallback） |
| `npm --workspace @sigma-studio/desktop run test -- mcp/source-material-mcp-server-core.test.ts electron/source-material/source-material-service.test.ts` | 成功（2 files、20 tests passed） |
| `npm --workspace @sigma-studio/desktop run typecheck` | 成功 |
| `npm --workspace @sigma-studio/desktop run lint`（実装時）／`npm exec --workspace @sigma-studio/desktop -- eslint tests/electron/sigma-core-mcp.spec.ts tests/electron/fixtures/seed-sigma-core-mcp.ts --max-warnings=0`（最終変更後） | 成功 |
| PR #40 `npm run test -- mcp/source-material-mcp-server-stdio.integration.test.ts`（PR worktree） | 成功（1 test passed、Node fallback） |
| PR #40 `NODE_OPTIONS=--max-old-space-size=3000 npm run typecheck`（PR worktree） | 成功 |
| PR #40 `npm exec -- electron-builder --config electron-builder.config.cjs --win --dir --publish never`（PR worktree） | 成功（Windows unpacked appをcross-buildし、afterPackでCore MCP bundleとnative lockを検査。Windows実行ではない） |
| PR #40 `npm --workspace @sigma-studio/desktop run test -- electron/file-lock-package.test.ts`（fixture修正後） | 成功（1 test passed） |
| PR #40 `npm --workspace @sigma-studio/desktop run test -- mcp/source-material-mcp-server-stdio.integration.test.ts electron/file-lock-package.test.ts`（再起動検証追加後） | 成功（2 tests passed、Linux Node fallback） |
| PR #40 Checks run `41025838625` | Windows desktop packaged MCP smoke 成功。file-lock-package fixtureの契約差分を検出し、修正 |
| PR #40 Checks run `41027066836` (attempt 2) | 成功（全4 jobs）。初回Public package `npm ci` はrunner network timeout |
| PR #40 Checks run `41028731742`（Playwright smoke追加前） | 成功（4/4 jobs。Windows unpacked app内のCore MCP起動、読み取り往復、再起動後の資料保持を確認） |
| `git diff --check` | 成功 |
| 今回追加する Playwright smoke を含む Windows CI | 未実行（本PR更新後に実行） |
