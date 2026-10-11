# SIGMA Question Engine

SIGMA Studio 専用の問題ドメインとアプリケーション契約を定義するパッケージです。

## Scope

- `src/core/`: 問題・解答・出典・タグなどのドメイン型。
- `src/application/contracts.ts`: 問題検索、登録、インポート処理のためのインターフェース。
- `src/index.ts`: 公開エクスポート。

## Explicit non-goals

- SQLite、スキーマ、DB 接続、永続化実装は含みません。
- 旧 Knowledge DB、旧 SIGMA Core、旧ローカルデータを移植・再利用するための互換レイヤーではありません。
- Electron や AI プロバイダーへの依存を持ちません。

DB ライブラリと永続化アーキテクチャは別途新規設計し、このパッケージの型だけを理由に旧実装を復活させないでください。実装の接続は、仕様とテストを確定した後に行います。
