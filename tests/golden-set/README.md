# Golden Set 評価フレームワーク

AI チャット応答の回帰テスト基盤。修正前後の diff で regression を検出する。

## クイックスタート

```bash
# staging-bk に対して全 drafted クエリを実行
node tests/golden-set/run.mjs

# カテゴリ指定
node tests/golden-set/run.mjs --only faq
node tests/golden-set/run.mjs --only machine_spec

# 本番 URL 指定 (読み取りのみ)
node tests/golden-set/run.mjs --base-url https://sloten-standalone.rcc-aoki.workers.dev

# API レート制限対策 (デフォルト 2s)
node tests/golden-set/run.mjs --delay 3000
```

## ファイル構成

| ファイル | 内容 |
|---|---|
| `queries.json` | 50 エントリの評価セット (drafted 39 + tbd_bk_team 11) |
| `run.mjs` | Widget API 経由で実行・採点・結果出力 |
| `results-YYYYMMDD.json` | 実行結果 (自動生成、git 管理対象外推奨) |

## カテゴリ

| カテゴリ | drafted | tbd | 合計 |
|---|---|---|---|
| `faq` | 12 | 2 | 14 |
| `machine_spec` | 6 | 4 | 10 |
| `announcement` | 3 | 2 | 5 |
| `escalation` | 5 | 0 | 5 |
| `english` | 3 | 0 | 3 |
| `menu_keyword` | 10 | 1 | 11 |
| **合計** | **39** | **9** | **48** |

> ※ g-048, g-049, g-050 は tbd_bk_team 枠として予約済み

## 採点ロジック

```
PASS: expected_phrases のいずれか 1 つ以上を含み
      forbidden_phrases を 1 つも含まず
      expected_handoff が true なら handoff 検知
      応答が空でない
FAIL: 上記いずれかに違反
SKIP: source = "tbd_bk_team" (未記入)
```

---

## BK / Sloten CS チームへの依頼

### 目的
実顧客のチャットログから、AI が正しく答えるべき質問パターンを **11 件** 追加してください。

### 必要な情報 (1 件あたり)

```json
{
  "id": "g-0XX",
  "category": "machine_spec | announcement | faq | menu_keyword",
  "input": "実際のユーザー入力テキスト",
  "expected_phrases": ["応答に含まれるべきキーワード"],
  "forbidden_phrases": ["含まれてはいけないキーワード"],
  "expected_handoff": false,
  "expected_jump": null,
  "source": "from_bk_team"
}
```

### 具体的に欲しいもの

**machine_spec (4件: g-022〜g-025)**
- 実顧客が実際にチャットで聞いた機種名の質問
- 例: 「北斗の拳のスペック教えて」「からくりサーカスの天井は？」
- 正しい答えが分かっていれば `expected_phrases` に機種名 + 数値を入れる

**announcement (2件: g-029〜g-030)**
- 期間限定キャンペーンやメンテナンス予定についての問い合わせ
- 例: 「次のメンテナンスはいつ？」「入金キャンペーンやってる？」

**faq (2件: g-048〜g-049)**
- AI が回答を間違えやすい紛らわしい質問
- 例: 入金と出金を混同しやすい聞き方、KYC 関連の変わった聞き方

**menu_keyword (1件: g-050)**
- ユーザーがメニュー遷移によく使う言い回し
- 例: 「振り込む」「チャージ」「引き出し」

### 提出方法
上記 JSON フォーマットで Slack / メールで送ってください。`queries.json` に追加してテストを再実行します。

### 期限
2 週間以内 (次回のリリースサイクル前)
