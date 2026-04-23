# Feedback Synthesizer 視点: 失敗パターンの自動検出とフィードバック活用

**エージェント**: Feedback Synthesizer
**視点**: サイレント失敗 / 👍👎 UI / 587 rejected の再活用 / 重大事故検知

---

## サイレント失敗パターン TOP 5

1. **即時エスカレーション**: AI 応答 < 60 秒以内に conversation が `open` 状態へ遷移 → AI 回答が不十分の強シグナル。528 件の open のうち直近 AI 応答があるものを対象
2. **同一顧客の短時間リピート質問**: 同一 `contact_id` が 10 分以内に類似クエリ (Levenshtein 距離 < 30% or embedding cosine > 0.85) を再送 → 前回 AI 回答が刺さらなかった
3. **怒り/不満ワード出現**: 顧客次ターンに「違う」「分からない」「人に」「オペレーター」「詐欺」「返金」「金返せ」等が含まれる → `ai_logs.response` 直後メッセージで正規表現スキャン
4. **AI 長文 + 顧客短返信**: AI response > 300 字 → 顧客 returns ≤ 5 字 (「？」「は？」) → 理解不能パターン
5. **bonus_code_submissions 直前 AI 応答**: 49 件のボーナス申請の直前 10 分以内に AI が応答していた場合、誤誘導リスク。AI が誤コード案内していないか全件レビュー必須

---

## 運用者フィードバック UI

- **管理画面の ai_logs 一覧行末に常設 3 ボタン**: 👍 / 👎 / ⚠️(重大)。クリック 1 回で `ai_log_feedback` に INSERT、モーダル無し。👎 クリック時のみ右側に任意 textarea (blur で保存)
- **Slack 通知導線**: `#ai-review` チャンネルに新規 ai_log を 1 時間バッチで投下、絵文字リアクション `:+1:` `:-1:` `:warning:` を webhook で D1 に反映 → 運用者が普段いる場所で完結
- **ゲーミフィケーション**: 週次「最多フィードバック提供者」を Slack 掲示。0 行問題の根本原因は「見られてない」なので動線を運用者の既存ルートへ

---

## 顧客側 👍👎

**結論: 置くが、常時表示はしない**。疲労回避のため次条件で **1 セッション最大 1 回** 表示:
- AI 応答 3 ターン目以降
- 会話 closure 直前 (widget 閉じる onbeforeunload)
- 表示は薄い灰色「この回答は役立ちましたか？」+ 👍👎、スキップ可

👎 選択時のみ「理由 (任意)」chip 選択 (的外れ / 情報古い / 分からない / その他)。CSAT 疲労を避け、回答率より **負例の純度** を優先。

---

## 👎 → 実装パイプライン

1. `ai_log_feedback` に rating=-1 蓄積
2. 週次バッチ: 👎 ログを embedding クラスタリング → 上位 20 クラスタ抽出
3. 各クラスタに RICE スコア (Reach=出現頻度, Impact=怒りワード有無, Confidence=クラスタ純度, Effort=プロンプト改修 or FAQ 追加 or ルール追加)
4. 上位 5 件を Linear issue 自動起票 → プロンプト修正 / FAQ 追加 / ハードコードルール
5. 次週効果測定: 同クラスタの 👎 率減少を KPI 化

---

## 587 rejected candidates の再活用

rejected = 「FAQ にするには弱いが質問は実在」。これは **プロンプト側の few-shot 補強素材** として最適:
- TOP 50 を embedding クラスタリング → 各クラスタ代表質問を system prompt の「よくある周辺質問集」に注入
- 同時に **曖昧質問に対する逆質問テンプレート** (「〇〇の件でしょうか、△△の件でしょうか」) 生成元に
- 月次で rejected を再評価: 3 回以上同クラスタで再出現したら FAQ 昇格候補へ

---

## 重大事故検知 (lightweight)

ai_logs INSERT トリガー相当で応答本文を正規表現スキャン:

- 金額断定 (`\d+円(返金|保証|支払)`)
- 確率断定 (`必ず当た|100%`)
- 景表法 NG (`絶対|最高`)
- 他社誹謗
- 個人情報要求 (`パスワード|口座番号教えて`)

→ 即 Slack `#ai-critical` + 該当 conversation を bot 停止フラグ

---

## SQL 例

```sql
-- 1. サイレント失敗: AI応答60秒以内にopen化
SELECT a.id, a.prompt, a.response, c.id conv_id
FROM ai_logs a
JOIN conversations c ON c.id = a.conversation_id
WHERE c.status = 'open'
  AND (c.status_changed_at - a.created_at) < 60
  AND a.status = 'ok'
ORDER BY a.created_at DESC;

-- 2. 怒りワード検知 (直後の顧客メッセージ)
SELECT a.id, a.response, m.content next_msg
FROM ai_logs a
JOIN messages m ON m.conversation_id = a.conversation_id
  AND m.created_at > a.created_at
  AND m.sender_type = 'contact'
WHERE m.content REGEXP '(違う|人に|オペレーター|詐欺|返金|金返せ|は？)'
  AND m.created_at < a.created_at + 300;

-- 3. bonus_code申請直前のAI応答 (誤誘導監査)
SELECT b.id bonus_id, b.code, a.prompt, a.response
FROM bonus_code_submissions b
JOIN ai_logs a ON a.conversation_id = b.conversation_id
WHERE a.created_at BETWEEN b.created_at - 600 AND b.created_at
ORDER BY b.created_at DESC;
```
