# SIGMA Studio 詳細設計書
## Workspace / Knowledge DB / Vector Search / AI Chat 統合仕様 v1.0

- 対象: SIGMA Studio Desktop
- 正本: この文書と実装・テスト契約
- 実装方針: `main` を正本とし、仕様 → 実装 → テスト → CI success の順で進める
- 変更方針: 仕様を変更する場合は、実装より先に本書と関連テスト契約を更新する

---

## 1. 目的

SIGMA Studio に、ユーザーが明示的に選択した Workspace の中で利用できる Knowledge DB を提供する。

Knowledge DB は PDF 等の教材資料を登録し、文書単位・ページ単位・領域単位で参照でき、ベクトル検索結果を AI Chat に渡せるようにする。

最終的な利用フローは次のとおり。

```
Workspaceをユーザーが選択
  ↓
Knowledge DBを開く
  ↓
PDFを登録
  ↓
ページ情報・本文を抽出
  ↓
Chunk化・Vector Index化
  ↓
検索
  ↓
検索結果をページ単位で表示
  ↓
ページ / 範囲を確認
  ↓
AI Chatへ明示的に引き渡す
  ↓
AIが引用元情報を保持
  ↓
ユーザーが元ページを開く
```

---

# 2. 非目標

v1では以下を自動化しない。

- Workspaceの自動選択
- 最後に使用したWorkspaceの暗黙選択
- 未選択Workspaceへの自動フォールバック
- Workspaceをまたいだ検索
- ユーザーの明示操作なしのAI Chatへの資料送信
- 元PDFそのものをVector DBに保存すること
- PDF全ページ画像を常時メモリに保持すること
- AIによる資料の自動分類を必須とすること
- 外部クラウドへの資料アップロードを前提とすること

---

# 3. 基本原則

## 3.1 Workspaceはユーザー所有のコンテキスト

Workspaceはデータの境界であり、Knowledge DBはWorkspaceに従属する。

```
Workspace
 ├─ Documents
 ├─ AI settings / context
 └─ Knowledge DB
      ├─ Sources
      ├─ Pages
      ├─ Chunks
      └─ Vector Index
```

Knowledge DB自身がWorkspaceを作成・選択・変更してはならない。

## 3.2 明示選択原則

Workspaceが未選択の場合、Workspace依存操作は実行しない。

禁止:

- 起動時の自動選択
- 最後のWorkspaceの自動復元による選択状態化
- 最初のWorkspaceを自動選択
- Knowledge DBがWorkspaceを生成
- AI ChatがWorkspaceを暗黙に変更

## 3.3 Source of Truth

- 教材ファイル: ローカルファイル
- Workspace情報: Workspace/libraryの既存正本
- Knowledge DBメタデータ: Knowledge DB library
- Vector index: Knowledge DBから再構築可能な派生データ
- AI Chatの会話: 既存AI Chatの正本
- AIへ渡すKnowledge DB context: 選択操作から生成する一時的な派生データ

## 3.4 IDによる参照

ファイルパス、ファイル名、ページ表示名を内部参照キーにしない。

内部参照は最低限以下を持つ。

- workspaceId
- sourceId
- pageId
- chunkId

---

# 4. Workspace仕様

## 4.1 Workspace選択状態

状態:

- `unselected`
- `selected`

`unselected` は有効な状態であり、エラーではない。

## 4.2 Workspace未選択時

Knowledge DBを開こうとした場合:

1. DBデータを操作しない
2. Workspace選択UIを表示する
3. ユーザーがWorkspaceを選択するまで待つ

## 4.3 Workspace切替

Workspace切替時:

1. 現在のKnowledge DB表示状態を旧Workspaceへ紐付けたまま破棄
2. 検索queryをリセット
3. 選択ページをリセット
4. 選択範囲をリセット
5. 検索結果をリセット
6. 新WorkspaceのKnowledge DBをロード
7. 新WorkspaceのVector Indexだけを利用

旧WorkspaceのSourceが新Workspaceに見えてはならない。

## 4.4 Workspace間分離

次の組み合わせは必ず拒否する。

```
workspaceId=A
sourceId=B所属
```

UIだけでなくElectron / DB service側でも検証する。

---

# 5. Knowledge DBデータモデル

## 5.1 Source

```ts
interface KnowledgeSource {
  id: string;
  workspaceId: string;
  name: string;
  originalPath: string;
  storedPath: string;
  mimeType: "application/pdf";
  sizeBytes: number;
  pageCount: number;
  importedAt: string;
  updatedAt: string;
  contentHash?: string;
  pages: KnowledgePage[];
}
```

## 5.2 Page

```ts
interface KnowledgePage {
  id: string;
  sourceId: string;
  pageNumber: number; // 1-based
  semanticType: KnowledgeSemanticType;
  title?: string;
  text?: string;
}
```

ページ番号は必ず1始まりとする。

## 5.3 Chunk

```ts
interface KnowledgeChunk {
  id: string;
  sourceId: string;
  pageId: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  startOffset?: number;
  endOffset?: number;
}
```

ChunkはVector Indexから元ページへ戻れる情報を必ず持つ。

## 5.4 Vector

Vectorは派生データとする。

必須metadata:

- workspaceId
- sourceId
- pageId
- pageNumber
- chunkId
- chunkIndex

Vector indexを削除しても、Source/Page/Chunk情報から再構築できる設計にする。

---

# 6. ファイル登録

## 6.1 対応形式

v1はPDFを正式対応とする。

ファイル選択:

- 単一PDF
- 複数PDF
- ディレクトリ内PDF

ディレクトリ選択時は再帰的にPDFを収集する。

## 6.2 登録処理

```
select
 ↓
validate
 ↓
copy to managed storage
 ↓
create Source
 ↓
read page count
 ↓
extract page text
 ↓
create Page records
 ↓
chunk
 ↓
vectorize
 ↓
persist index
```

途中失敗時は、壊れたSourceを「登録済み」として残さない。

## 6.3 重複

同一contentHashのSourceが同一Workspaceに存在する場合、既定では重複登録を防ぐ。

別Workspaceなら同一ファイルを登録可能。

## 6.4 大容量PDF

100ページ以上のPDFを正常系として扱う。

処理中はUIをブロックしない。

将来的な非同期Job化を妨げないよう、インデックス処理をUIコンポーネントから分離する。

---

# 7. PDFページ抽出

## 7.1 ページ取得

`get_page` は1ページを指定して取得する。

入力:

- workspaceId
- sourceId
- pageNumber

制約:

- pageNumberは整数
- 1以上
- pageCount以下

## 7.2 複数ページ取得

選択ページを新しいPDFとして抽出できる。

入力:

```ts
{
  selections: Array<{
    sourceId: string;
    pageNumbers: number[];
  }>
}
```

ページ順はユーザーが指定した選択順を基本とし、同一Source内の重複ページは1回だけ出力する。

## 7.3 範囲指定

将来のAPI互換性のため、ページ範囲を以下で表現可能にする。

```ts
{
  sourceId: string;
  pageRange: {
    start: number;
    end: number;
  };
}
```

start/endは1-based、inclusive。

---

# 8. Region仕様

## 8.1 座標

RegionはPDFページの表示座標系に変換可能な矩形として扱う。

```ts
interface KnowledgeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

width/heightは0より大きい必要がある。

## 8.2 Regionの用途

- 選択範囲のPDF抽出
- AIへ選択範囲の文脈を渡す
- 将来のOCR / text bounding box連携

## 8.3 v1の制約

Region抽出はPDFページの部分PDFとして出力する。

RegionそのものをVector検索単位にはしない。

---

# 9. Semantic Type

v1で許可する分類:

- problem
- example
- explanation
- column
- definition
- theorem
- answer
- figure
- unknown

初期値は`unknown`。

分類は検索・表示filterに利用できる。

分類が変更されてもVector IDは変更しない。

---

# 10. Chunk仕様

## 10.1 基本方針

検索単位はChunk、表示単位はPage。

検索結果をChunk単位で返しても、UIでは同一ページをまとめて表示する。

## 10.2 Page aggregation

同一Source + Pageについて複数Chunkがヒットした場合、UI結果はページ単位に集約する。

ページのscoreはそのページ内の最大scoreを採用する。

## 10.3 上限

外部API / UIから指定されたlimitは1〜50に正規化する。

内部Vector検索ではページ集約前に候補数を多めに取得する。

---

# 11. Vector Search

## 11.1 API

```
knowledge_db_search
```

入力:

```ts
{
  workspaceId: string;
  query: string;
  limit?: number;
}
```

## 11.2 出力

最低限:

```ts
{
  id: string;
  sourceId: string;
  sourceName: string;
  pageId: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  score: number;
}
```

## 11.3 空検索

queryが空白のみの場合は検索を実行せず、空配列を返す。

## 11.4 検索範囲

検索は現在選択中Workspaceのみ。

Source単位のfilterは将来拡張可能とする。

---

# 12. MCP Tool契約

v1のKnowledge DB公開Tool:

- `knowledge_db_list_sources`
- `knowledge_db_search`
- `knowledge_db_get_page`
- `knowledge_db_get_region`

Tool名は安易に変更しない。

変更する場合は:

1. 設計書更新
2. Tool category更新
3. contract test更新
4. 実装
5. CI

の順。

## 12.1 list_sources

目的: 現在Workspaceの資料一覧を取得。

## 12.2 search

目的: Vector検索。

## 12.3 get_page

目的: 検索結果から特定ページの本文 / 参照情報を取得。

## 12.4 get_region

目的: ページの指定領域を取得。

全Toolでworkspace境界を検証する。

---

# 13. AI Chat連携

## 13.1 原則

Knowledge DBからAI Chatへのデータ送信は明示操作とする。

自動で全DBをAIへ送らない。

## 13.2 AI Context

```ts
interface KnowledgeDbAiContext {
  sourceId: string;
  sourceName: string;
  pageNumber: number;
  semanticType: KnowledgeSemanticType;
  text: string;
}
```

可能ならpageIdも保持する。

## 13.3 引き渡し単位

ユーザーが選択したページをAI Chatへ送る。

複数ページ選択時は複数contextとして渡す。

## 13.4 引用

AI側では最低限:

- sourceName
- pageNumber
- context text

を保持する。

AI回答から元資料を開くため、内部的にはsourceId/pageNumberを失わない。

---

# 14. AI ChatとKnowledge DBの同時表示

Knowledge DBはAI sidebarが開いていても利用可能とする。

既存のAI sidebar幅を尊重し、Knowledge DB overlayはAI sidebar領域と重ならない。

```
┌──────────────────────────────┬───────────────┐
│ Knowledge DB                 │ AI Chat       │
│                              │               │
│ Search / Results             │ Context       │
│                              │ Conversation  │
│ Page preview                 │               │
└──────────────────────────────┴───────────────┘
```

UI実装ではAI sidebarの幅を固定値として複製せず、既存CSS variable / layout stateを参照する。

---

# 15. Page Viewer

## 15.1 Viewer責務

Viewerは:

- 指定ページを表示
- ページ番号を表示
- Region selection
- 選択ページの外部表示
- AI context生成

を担当する。

## 15.2 ViewerがDB責務を持たない

ViewerはVector検索やWorkspace選択を直接実行しない。

---

# 16. UI状態

Knowledge DB UIは次の状態を明示的に扱う。

- closed
- opening
- ready
- loading sources
- indexing
- searching
- empty
- error

エラー後に再試行できる操作を提供する。

## 16.1 Empty

資料0件:

「資料を追加してください」

検索結果0件:

「一致する資料がありません」

## 16.2 Loading

検索中は古い検索結果を新しい結果と誤認させない。

request sequenceを管理し、古い非同期結果で新しいqueryの結果を上書きしない。

---

# 17. 削除仕様

Source削除:

1. Sourceを対象としてロック
2. Vector indexからsourceのentriesを削除
3. stored PDF削除
4. libraryからSource削除
5. UIへ完了通知

途中失敗時は再実行可能な状態にする。

Workspace外のSourceを削除しない。

---

# 18. 更新・再インデックス

Sourceの内容が変更された場合、既存indexをそのまま信用しない。

contentHashまたは明示的な再インデックスで変更を検出する。

再インデックス:

1. 旧Vector entries削除
2. Page text更新
3. Chunk再生成
4. Vector再生成
5. index commit

失敗時は旧indexを破壊しないことを優先する。

---

# 19. エラー契約

エラーはユーザー向けメッセージと内部原因を分離する。

最低限の分類:

- INVALID_REQUEST
- WORKSPACE_NOT_SELECTED
- WORKSPACE_MISMATCH
- SOURCE_NOT_FOUND
- PAGE_NOT_FOUND
- REGION_INVALID
- PDF_READ_FAILED
- INDEX_FAILED
- SEARCH_FAILED
- FILE_WRITE_FAILED

内部エラー文字列をそのままUIに表示しない。

---

# 20. IPC境界

RendererからElectronへ直接filesystem操作をさせない。

Knowledge DB IPCは:

- choose-sources
- list
- import
- delete-source
- get-page-pdf
- extract-region
- open-page
- extract-pages
- search
- set-page-type

を提供する。

IPC handlerでは必ず:

1. sender検証
2. payload validation
3. Workspace validation
4. service呼び出し

を行う。

---

# 21. セキュリティ

禁止:

- Rendererから任意パスをshell.openPathへ渡す
- Workspace外のSourceをsourceIdだけで取得
- 不正なpageNumberをPDF処理へ渡す
- 任意のfilesystem pathをKnowledge DB storageとして扱う

managed storageのパスはDB/service側で解決する。

---

# 22. 永続化

Knowledge DB root:

```
<app data>/knowledge-db/
 ├─ library.json
 ├─ sources/
 │   ├─ <sourceId>.pdf
 │   └─ ...
 ├─ vector-index/
 └─ opened-pages/
```

実際のVector index構造はLocalVectorIndexの実装に従うが、UI層は内部ファイル構造に依存しない。

---

# 23. 復旧

起動時に:

1. library読み込み
2. 壊れたSource record検出
3. storedPath存在確認
4. Page metadata不足確認
5. Vector index存在確認
6. 不足なら再構築可能な範囲でrepair

DB全体が壊れた場合、Source PDFから再構築できることを基本方針とする。

---

# 24. テスト設計

## 24.1 Unit

対象:

- page number validation
- region validation
- limit normalization
- page aggregation
- semantic type
- chunk metadata
- workspace mismatch
- error mapping

## 24.2 Integration

最低限:

1. PDF import
2. library persistence
3. page extraction
4. vector indexing
5. search
6. page retrieval
7. region extraction
8. selected page extraction
9. source deletion
10. re-open / repair

## 24.3 MCP contract

Tool一覧とcategory一覧を独立した期待値で検査する。

新しい公開Toolを追加した場合、次を同時更新する:

- registrar
- tool contract
- category map
- tests
- documentation

## 24.4 UI

検査対象:

- Workspace未選択
- Workspace選択
- Source追加
- 検索
- page selection
- multiple page selection
- page viewer
- region selection
- PDF extraction
- AI handoff
- AI sidebar同時表示
- Source deletion
- empty / error / loading

---

# 25. E2E受け入れ条件

以下をすべて満たした時点でKnowledge DB v1を完了とする。

- [ ] Workspaceをユーザーが明示選択できる
- [ ] Workspaceを自動選択しない
- [ ] 未選択状態でDB操作を開始しない
- [ ] PDFを登録できる
- [ ] 複数PDFを登録できる
- [ ] ディレクトリからPDFを登録できる
- [ ] 100ページ以上のPDFを扱える
- [ ] ページ本文を取得できる
- [ ] Vector検索できる
- [ ] 検索結果からSource/Pageへ戻れる
- [ ] 1ページをPDFとして取得できる
- [ ] 複数ページをPDFとして抽出できる
- [ ] Regionを選択できる
- [ ] RegionをPDFとして抽出できる
- [ ] AI Chatへ選択contextを送れる
- [ ] AI ChatとKnowledge DBを同時表示できる
- [ ] AI contextから元ページを特定できる
- [ ] Workspaceを切り替えると旧Workspaceの資料が表示されない
- [ ] Source削除でVector indexも整合する
- [ ] 再起動後にDBが復元される
- [ ] MCP contract testが成功する
- [ ] 全CI workflowがsuccessになる

---

# 26. 完了判定

「実装済み」だけでは完了としない。

機能単位の完了条件:

```
仕様記載
  ↓
実装
  ↓
Unit / Integration
  ↓
UI / E2E
  ↓
MCP contract
  ↓
GitHub Actions
  ↓
success
  ↓
完了
```

GitHub Actionsがfailure / cancelled / queued / in_progressの場合は完了扱いにしない。

---

# 27. 変更管理

仕様変更時:

1. 本書を更新
2. 変更理由を記録
3. 影響する型・IPC・MCP契約を更新
4. テストを更新
5. 実装
6. CI確認

実装先行で仕様を後追いしない。

---

# 28. 現在実装との差分

現在のmainには以下が既に存在する。

- PDF Source登録
- Source一覧
- Vector検索
- Page PDF取得
- Pageを開く
- Region抽出
- 複数ページPDF抽出
- Semantic Type
- Knowledge DB UI
- AI context handoff
- MCP Knowledge DB tools

今後の実装では、これらを壊さずに以下を重点的に整備する。

1. Workspaceとの明示的な紐付け
2. workspace境界のIPC/service/MCP検証
3. Source/Chunk/Vector metadataの完全性
4. index更新・削除・復旧の原子性
5. AI citationのsourceId/pageId保持
6. DB + AI Chat layout
7. E2E受け入れ条件
8. 設計書とcontract testの同期

---

# 29. 設計上の禁止事項

- UIだけでWorkspace境界を保証しない
- Source IDからWorkspaceを推測してアクセスを許可しない
- ファイル名を一意キーにしない
- pageNumberを0始まりに変更しない
- Vector indexを唯一の正本にしない
- AI contextからsource/page情報を捨てない
- Toolを追加してcategory contractを更新しないままCIを通そうとしない
- テストを実装詳細だけに依存させない
- エラーを文字列一致だけで契約化しない
- 未確認のCIをsuccessと扱わない

---

# 30. 実装フェーズ

## Phase A — 設計固定
- 本書を正本化
- 型・IPC・MCP契約との差分確認
- Workspace契約確定

## Phase B — Workspace境界
- DB serviceへworkspaceId導入
- IPC validation
- MCP validation
- UI state

## Phase C — DB整合性
- Source hash
- Chunk metadata
- delete/reindex
- repair

## Phase D — AI連携
- citation metadata
- page open
- DB + Chat layout
- multi-page context

## Phase E — テスト
- Unit
- Integration
- MCP contract
- E2E

## Phase F — CI
- 全workflow確認
- failureがあれば修正
- success確認後にPhase完了

---

## 31. v1の設計原則まとめ

**Workspaceを勝手に選ばない。**

**Knowledge DBはWorkspaceのデータ境界を越えない。**

**PDFは正本、Vectorは再構築可能な派生データ。**

**検索はChunk、ユーザーの参照単位はPage。**

**AIへの送信は明示操作。**

**AI contextには必ず元資料への参照を残す。**

**UIではなくservice/IPC/MCPでも境界を検証する。**

**仕様を先に変更し、実装とテストを仕様に追従させる。**

**CI successを確認して初めて機能完成とする。**
