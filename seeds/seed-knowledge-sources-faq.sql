-- @idempotent — seed-knowledge-sources-faq.sql
-- Frequent customer questions extracted from real Chatwoot conversations.
-- Source: 1500 conversations scanned, 1942 customer messages,
-- 35 frequent question patterns across 11 topics.
-- PII masked. source_type=real_faq to distinguish from manual_kb (11 staff-written articles).

DELETE FROM knowledge_sources WHERE source_type = 'real_faq';

INSERT INTO knowledge_sources (url, title, content, metadata, source_type, priority, category, is_active, created_at, updated_at) VALUES (  NULL,
  '顧客頻出質問 — 入金',
  '# 顧客頻出質問 — 入金

実顧客対応履歴から抽出された、入金 に関する頻出質問パターンです。
AI 応答の参考や、新規 FAQ 記事作成の基礎資料として利用できます。

## 頻出パターン（出現回数順）

### 1. チャットより入金 (12件)

### 2. 入金反映お願いいたします (9件)

### 3. 反映お願いいたします (8件)

### 4. 入金されてません (6件)

### 5. 入金しましたが反映されません (5件)

### 6. PayPayで入金したい (5件)

類似パターン:
- PayPayで入金したい
- PayPayで入金したいのですが
- PayPayで入金したいです
',
  '{"topic":"入金","total_questions":6,"total_count":45,"source":"chatwoot_incoming_extraction"}',
  'real_faq',
  100,
  '入金',
  1,
  datetime('now'), datetime('now')
);

INSERT INTO knowledge_sources (url, title, content, metadata, source_type, priority, category, is_active, created_at, updated_at) VALUES (  NULL,
  '顧客頻出質問 — 確認',
  '# 顧客頻出質問 — 確認

実顧客対応履歴から抽出された、確認 に関する頻出質問パターンです。
AI 応答の参考や、新規 FAQ 記事作成の基礎資料として利用できます。

## 頻出パターン（出現回数順）

### 1. どうなりましたか？ (3件)

### 2. 確認お願いします！ (3件)

類似パターン:
- 確認お願いします
- 確認お願いします！

### 3. まだかかりますか？ (2件)

### 4. エボリューションの件回答ありましたか？ (2件)

類似パターン:
- エボリューションの件回答ありました？
- エボリューションの件回答ありましたか？

### 5. どうなりますか？？ (2件)

類似パターン:
- どうなりますか？
- どうなりますか？？
',
  '{"topic":"確認","total_questions":5,"total_count":12,"source":"chatwoot_incoming_extraction"}',
  'real_faq',
  101,
  '確認',
  1,
  datetime('now'), datetime('now')
);

INSERT INTO knowledge_sources (url, title, content, metadata, source_type, priority, category, is_active, created_at, updated_at) VALUES (  NULL,
  '顧客頻出質問 — アカウント',
  '# 顧客頻出質問 — アカウント

実顧客対応履歴から抽出された、アカウント に関する頻出質問パターンです。
AI 応答の参考や、新規 FAQ 記事作成の基礎資料として利用できます。

## 頻出パターン（出現回数順）

### 1. ログインできない (4件)

### 2. アカウント再開お願い致します (3件)

### 3. 電話番号[PHONE] (3件)

### 4. アカウント凍結解除してください　[ID] (2件)

類似パターン:
- アカウント凍結解除してください　[ID]
- アカウント凍結解除してください

### 5. アカウント凍結してください。　ギャンブル依存者だからアカウント凍結してください。　ギャンブル依存者だから (2件)

類似パターン:
- アカウント凍結してください。　ギャンブル依存者だから
- アカウント凍結してください。　ギャンブル依存者だからアカウント凍結してください。　ギャンブル依存者だ

### 6. ログインできません (2件)

### 7. プロバイダーへ報告をいたしますので、報告用の下記のフォーマットをご入力ください。

機種名：スマスロソードアートオンライン
台番号：不明　　10スロ
報告理由：気づいたら消えていた
発生時間：11:40ごろ
アカウントID：kesaniki

台が大当たり状態かどうか：不明
保持が必要かどうか：YES 
閉店しているかどうか：YES (2件)

### 8. アカウント削除希望です。 (2件)

### 9. 電話番号:[PHONE] (2件)
',
  '{"topic":"アカウント","total_questions":9,"total_count":22,"source":"chatwoot_incoming_extraction"}',
  'real_faq',
  102,
  'アカウント',
  1,
  datetime('now'), datetime('now')
);

INSERT INTO knowledge_sources (url, title, content, metadata, source_type, priority, category, is_active, created_at, updated_at) VALUES (  NULL,
  '顧客頻出質問 — 出金',
  '# 顧客頻出質問 — 出金

実顧客対応履歴から抽出された、出金 に関する頻出質問パターンです。
AI 応答の参考や、新規 FAQ 記事作成の基礎資料として利用できます。

## 頻出パターン（出現回数順）

### 1. PayPayマネーで出金したいです。 (9件)

類似パターン:
- PayPayマネーで出金したいです。
- PayPayマネーで出金可能ですか？
- PayPayマネーで出金できないことはどこかのページに記載されていますか？

### 2. pay payマネー出金 (6件)

### 3. PayPay出金 (5件)

### 4. PayPayマネー出金 (5件)

類似パターン:
- paypayマネー出金
- PayPayマネー出金

### 5. 出金項目タップ出来ない (5件)

### 6. PayPayで出金したい (3件)

類似パターン:
- PayPayで出金したいです
- PayPayで出金したい

### 7. PayPay出金申請お願い致します。 (3件)

### 8. 仮想通貨出金お願いします (3件)

### 9. 銀行出金が選択出来ません (3件)
',
  '{"topic":"出金","total_questions":9,"total_count":42,"source":"chatwoot_incoming_extraction"}',
  'real_faq',
  103,
  '出金',
  1,
  datetime('now'), datetime('now')
);

INSERT INTO knowledge_sources (url, title, content, metadata, source_type, priority, category, is_active, created_at, updated_at) VALUES (  NULL,
  '顧客頻出質問 — 決済方法',
  '# 顧客頻出質問 — 決済方法

実顧客対応履歴から抽出された、決済方法 に関する頻出質問パターンです。
AI 応答の参考や、新規 FAQ 記事作成の基礎資料として利用できます。

## 頻出パターン（出現回数順）

### 1. PayPayマネー (6件)

### 2. 銀行振り込み手動 (5件)

### 3. コンビニ支払いについて (2件)

### 4. PayPayで5000円お願いします (2件)

### 5. 手動銀行振り込み (2件)
',
  '{"topic":"決済方法","total_questions":5,"total_count":17,"source":"chatwoot_incoming_extraction"}',
  'real_faq',
  104,
  '決済方法',
  1,
  datetime('now'), datetime('now')
);

INSERT INTO knowledge_sources (url, title, content, metadata, source_type, priority, category, is_active, created_at, updated_at) VALUES (  NULL,
  '顧客頻出質問 — KYC',
  '# 顧客頻出質問 — KYC

実顧客対応履歴から抽出された、KYC に関する頻出質問パターンです。
AI 応答の参考や、新規 FAQ 記事作成の基礎資料として利用できます。

## 頻出パターン（出現回数順）

### 1. 出勤の項目が何も選べないのですがどうすればいい？本人確認必要？ (2件)
',
  '{"topic":"KYC","total_questions":1,"total_count":2,"source":"chatwoot_incoming_extraction"}',
  'real_faq',
  105,
  'KYC',
  1,
  datetime('now'), datetime('now')
);
