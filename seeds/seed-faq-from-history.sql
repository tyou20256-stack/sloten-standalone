-- @idempotent — seed-faq-from-history.sql
-- Generated from 5434 customer messages, 1381 unique clusters, top 200 emitted.
-- Deposit-related Q&A filtered (3783 excluded) — those are handled by GAS flows.

DELETE FROM faq WHERE tenant_id = 'tenant_default' AND category IN ('一般','アカウント','ボーナス','ゲーム','本人確認','VIP') AND keywords = 'auto-extracted';

INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'まだですか？', 'スロット天国カスタマーサポートへようこそ！🎰

※AIが初期対応します。人のオペレーターをご希望の場合は「オペレーター」とお送りください。

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 25, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'オペレーター', 'スロット天国カスタマーサポートへようこそ！🎰

※AIが初期対応します。人のオペレーターをご希望の場合は「オペレーター」とお送りください。

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 16, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'お願いします', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 15, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'わかりました。', '大変お待たせいたしました。   
ご確認させて頂きましたところ、こちらは当選発表はみんなへの報告になります。   
ご自身が当選しているかのご確認は「私の宝くじ」でご確認いただけます。    
今回期待させてしまい申し訳ございません。', '一般', 'ja', 'auto-extracted', 11, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '10000', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 7, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'ありがとうございます。', '金額は **[AMT]円〜[AMT]円** の範囲で入力してください。
（例: 5000）', '一般', 'ja', 'auto-extracted', 7, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'よろしくお願いします', '恐れ入ります。回答があるまでしばらくお待ちくださいませ。', '一般', 'ja', 'auto-extracted', 6, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '[PHONE]', 'ありがとうございます。

こちらで処理させていただきますので、再度コードを受け取るボタンを押してください。

その後に直ぐにこちらへ押したと伝えていただけますでしょうか？

こちらからコードを送らせていただきます。', '一般', 'ja', 'auto-extracted', 6, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '3000円', '金額は **[AMT]円〜[AMT]円** の範囲で入力してください。
（例: 5000）', '一般', 'ja', 'auto-extracted', 6, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245585670981492736', 'スロット天国カスタマーサポートへようこそ！🎰

※AIが初期対応します。人のオペレーターをご希望の場合は「オペレーター」とお送りください。

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 6, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '[AMT]円', '対応いたしますので少しお待ちください。', '一般', 'ja', 'auto-extracted', 6, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '12000', 'オペレーターにお繋ぎします。ご用件をお書きになって、そのままお待ちください。', '一般', 'ja', 'auto-extracted', 6, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'tai831', 'お手数ですが金額お伺いしてもよろしいでしょうか？', '一般', 'ja', 'auto-extracted', 6, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'まだでしょうか？', 'スロット天国カスタマーサポートへようこそ！🎰

※AIが初期対応します。人のオペレーターをご希望の場合は「オペレーター」とお送りください。

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 5, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '5000円', 'スロット天国カスタマーサポートへようこそ！🎰

※AIが初期対応します。人のオペレーターをご希望の場合は「オペレーター」とお送りください。

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 5, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'mpompo', '金額は **[AMT]円〜[AMT]円** の範囲で入力してください。
（例: 5000）', '一般', 'ja', 'auto-extracted', 5, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'happei31', '金額は **[AMT]円〜[AMT]円** の範囲で入力してください。
（例: 5000）', '一般', 'ja', 'auto-extracted', 5, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '問い合わせ', 'ご希望の項目をお選びください。', '一般', 'ja', 'auto-extracted', 5, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'ログインできない', '現在、スロット天国にログインできない事象について、複数のお客様よりお問い合わせをいただいております。  
当サイトでも、原因の調査を進めております。

ご不便をおかけしておりますこと、深くお詫び申し上げます。  
恐れ入りますが、状況改善まで今しばらくお待ちくださいますようお願いいたします。', 'アカウント', 'ja', 'auto-extracted', 4, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '分かりました。', '只今、キャンセルさせていただきましたのでよろしくお願い

いたします。', '一般', 'ja', 'auto-extracted', 4, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '承知しました。', 'ぜひ、お問い合わせ頂きますようお願い致します。', '一般', 'ja', 'auto-extracted', 4, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '大丈夫ですか？', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 4, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'アカウント再開お願い致します', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', 'アカウント', 'ja', 'auto-extracted', 4, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'daigo555', '❌ アカウントIDは英数字3〜20文字で入力してください。

例: syt2525m, riv3633, hiromu', '一般', 'ja', 'auto-extracted', 4, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'まだかかりますか？', '順番に対応させて頂いておりますのでしばらく終わり次第お知らせいたします。', '一般', 'ja', 'auto-extracted', 4, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'keirin', '金額は **[AMT]円〜[AMT]円** の範囲で入力してください。
（例: 5000）', '一般', 'ja', 'auto-extracted', 4, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'noonb03', '金額は **[AMT]円〜[AMT]円** の範囲で入力してください。
（例: 5000）', '一般', 'ja', 'auto-extracted', 4, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'こんばんは', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 3, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'どうなりましたか？', '未だ回答待ちの状態となっております。   
回答あり次第すぐにご連絡させていただきます', '一般', 'ja', 'auto-extracted', 3, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'いかがですか？', 'こちら詳細をもっと具体的お伺いしてもよろしいでしょうか？', '一般', 'ja', 'auto-extracted', 3, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'わかりましたありがとうございます！', 'ご理解ありがとうございます。', '一般', 'ja', 'auto-extracted', 3, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'I send it alredy ', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 3, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'エボリューションの件', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 3, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'ken0627', '大変恐れ入りますが、お客様のご希望では永久凍結ですのでできかねます。', '一般', 'ja', 'auto-extracted', 3, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'ご対応お願い致します', '順番に対応させて頂いておりますのでしばらくお待ちください。', '一般', 'ja', 'auto-extracted', 3, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'フリースピン', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', 'ゲーム', 'ja', 'auto-extracted', 3, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '最初のボーナスは換金できないのですか？', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', 'ボーナス', 'ja', 'auto-extracted', 3, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245603898823434240', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 3, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'brave', '金額は **[AMT]円〜[AMT]円** の範囲で入力してください。
（例: 5000）', '一般', 'ja', 'auto-extracted', 3, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245710766198431748', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 3, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245826644416602114', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 3, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'いかがでしょうか', 'ご希望の項目をお選びください。', '一般', 'ja', 'auto-extracted', 3, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'takimaru777', '金額は **[AMT]円〜[AMT]円** の範囲で入力してください。
（例: 5000）', '一般', 'ja', 'auto-extracted', 3, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'パチンコはメンテナンス中ですか？', 'オペレーターにお繋ぎします。ご用件をお書きになって、そのままお待ちください。', '一般', 'ja', 'auto-extracted', 3, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'どうなっていますか？', '畏まりました！では関連部署に確認いたしますのでしばらくお待ちくださいませ。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '確認お願いします', 'オペレーターにお繋ぎします。ご用件をお書きになって、そのままお待ちください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '認証コードがきません', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02242076399232188432', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '20000円', '申しわけございません！   
すぐに手配させて頂きます！', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'サイト落ちてる？', 'お問い合わせありがとうございます。

現在、ログインしづらい状況について確認を行っております。

ご不便をおかけし申し訳ございませんが、復旧まで今しばらくお待ちいただけますと幸いです。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'ログイン異常が頻発してます', 'お手数をおかけいたしますが、下記の手順をお試しいただけますでしょうか。

1. サイトから一度ログアウトし、再度ログインしてください。

2. 履歴（キャッシュ）のクリアをお願いいたします。

3. 端末の 再起動 を行ってください。

4. インターネット接続の確認をお願いいたします。

  ・Wi-Fiをご利用中の場合 → データ通信へ切り替え

  ・データ通信をご利用中の場合 → Wi-Fiへ切り替え

上記をお試しいただくことで、改善される場合が多くございます。

お手数をおかけいたしますが、ご協力のほどよろしくお願いいたします。', 'アカウント', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '1万𝙸𝙽お願い致します', 'ご希望の項目をお選びください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'kinako923', '❌ アカウントIDは英数字3〜20文字で入力してください。

例: syt2525m, riv3633, hiromu', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'お願い致します', '関連部署にて確認をさせていただいておりますので、進捗あり次第ご連絡させていただきます', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'アカウント', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', 'アカウント', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'アカウント凍結してください。　ギャンブル依存者だから', 'アカウントIDをお願いします。', 'アカウント', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'sodashi1103', '解除いたしました。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '完了しました', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'どうなってますか？', 'プロバイダーの調査結果次第となりますのでそれまでお待ちいただけますようお願い致します。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02244561398590504960', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02244679278262714372', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02244717494882213900', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '送りました', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02244852133517590528', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'よろしくね', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'ログイン出来ない', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', 'アカウント', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'スペシャルステップ', 'スペシャルステップのプロモは初回限定になっておりますのでお客様は対象外となります。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245100691864944640', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '10.000円', '金額は **[AMT]円〜[AMT]円** の範囲で入力してください。
（例: 10000）', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245156663877689344', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'プロモーション', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', 'ボーナス', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245224197944664076', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245228054825140232', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245233603921797124', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'よろしくお願い致します。', '受け取り口座名義をご確認くださいませ。   
ローマ字は受け付けていないかと存じます。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '本日16時にplay''ngoのフリースピン付与は、私は対象ですか？

kuromi88です。', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', 'ゲーム', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245282832836960264', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245297092128309259', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '選択できません。', '只今、調整させていただきました。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245409362573688836', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'ユーザーネームを6桁以上にしているのに6桁未満といわれる', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'まだオペレーターに繋がりませんか？', 'ご確認いたしますので少々お待ちくださいませ。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'アカウント凍結解除してください', '既に解除されております。', 'アカウント', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245447836891021313', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'なにかボーナスないですか。ほんとに困ってて間違って多く賭けてしまいお金が無くなりそうです
', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', 'ボーナス', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'こんにちは', 'ご希望の項目をお選びください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'Daigo555', '❌ アカウントIDは英数字3〜20文字で入力してください。

例: syt2525m, riv3633, hiromu', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245533066221748224', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245534535101603843', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245539190845898756', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245556207505342464', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'gazirizaurusu', 'スロット天国カスタマーサポートへようこそ！🎰

※AIが初期対応します。人のオペレーターをご希望の場合は「オペレーター」とお送りください。

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245593427692896261', 'スロット天国カスタマーサポートへようこそ！🎰

※AIが初期対応します。人のオペレーターをご希望の場合は「オペレーター」とお送りください。

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '退会したい', 'スロット天国カスタマーサポートへようこそ！🎰

※AIが初期対応します。人のオペレーターをご希望の場合は「オペレーター」とお送りください。

ご希望の項目を下記メニューからお選びください。', 'アカウント', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'なんかサーバーの調子ずっと変だしチャットボットもおかしいけど、いつ直る？', 'オペレーターにお繋ぎします。ご用件をお書きになって、そのままお待ちください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245600213740281856', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245600548747902976', 'ご希望の項目をお選びください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'かしこまりました。', '畏まりました。ありがとうございます。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'キャンセル', 'ご希望の項目をお選びください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245679481657638912', 'ご希望の項目をお選びください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245704452596531200', 'ご希望の項目をお選びください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245705500568485892', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'hal8686', '金額は **[AMT]円〜[AMT]円** の範囲で入力してください。
（例: 5000）', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245730849465507840', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '誕生日ボーナスないん？', 'はい、現在そのようなボーナスはございません。', 'ボーナス', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245787500084150272', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245787173666676740', 'ご希望の項目をお選びください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245809894043656200', 'ご希望の項目をお選びください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'ai1278', 'オペレーターにお繋ぎします。ご用件をお書きになって、そのままお待ちください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'もしもし？', '金額は **[AMT]円〜[AMT]円** の範囲で入力してください。
（例: 5000）', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'アラカキシュン', '手配いたしますので少々お待ちくださいませ。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245849261714382848', 'ご希望の項目をお選びください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'rinmama', 'ご希望の項目をお選びください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02245905465655902214', 'ご希望の項目をお選びください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'パチンコが出来ない', '🎮 ゲームについてですね。

どのようなことをお知りになりたいですか？', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '30000円', '対応いたしますので少しお待ちください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '5000円です', '修正しておりますので、次回からお願いいたします。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'パチンコスロット出来ません
', 'ご希望の項目をお選びください。', 'ゲーム', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'shin2525', '手配いたしますので金額をお願い致します。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02246020407571193856', '順番に対応させて頂いておりますので少々お待ちください。', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02246018380346327045', '金額は **[AMT]円〜[AMT]円** の範囲で入力してください。
（例: 5000）', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02246071431782105094', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02246096720550707212', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 2, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'れんらくかえして', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'aohada12', 'ご希望の項目をお選びください。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '誕生日ボーナスとかってありますか？？', '現状はございません。', 'ボーナス', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'ありがとうございます😊', 'ご希望の項目をお選びください。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02246049415779835904', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'まだかかるんですか？', '只今、すぐに確認させていただきますので少々お待ちくださいませ。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'アカウントID atsu111でした。', 'ご報告有難うございます！', 'アカウント', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02235006144328622087', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02235415806899339267', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02235894790242156552', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02236264664235671553', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02236495862325248000', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02236602626622308352', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'ここはどれだけお金を使っても対応してくれないんですか', '順次対応いたしますので、少々お待ちくださいませ。 ', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '履歴、確認してもらったらわかると思います', '現在、そのようなボーナス等はございません。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'こんなもの、ギャンブルでもなんでもない', '現在、そのようなボーナス等はございません。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '本当になにか出してください。', '現在、そのようなボーナス等はございません。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'そして、16連敗です。', '現在、そのようなボーナス等はございません。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '文句を言いたくなるのも分かるでしょう、流石におかしすぎるし理不尽すぎます', '現在、そのようなボーナス等はございません。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '流石になにか出して欲しい、チップを', '現在、そのようなボーナス等はございません。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '対応まで、まだ時間かかりますか', '現在、そのようなボーナス等はございません。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02237428651912413184', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02237748060040454151', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02238829584345137152', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02238531986061164568', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02238675721436725262', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '検討します。ありがとうございます。', '畏まりました！よろしくお願いいたします。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '0x3c2e53107ac10052430ac1625e090c5e8225900d71fc115219a7b7b40b1ee249', '詳しいお時間はお伝え出来ないですが、すぐに関連部署に確認いたします。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '時間はどれくらいかかりますか？', '詳しいお時間はお伝え出来ないですが、すぐに関連部署に確認いたします。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02239249013671927812', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02239566729582182404', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02239612685732118530', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'この画面になります。', '現在担当部署による修正が行われております。修正時間に関しましてはわかりかねます。大変ご迷惑をおかけしております何卒よろしくお願い申し上げます', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'どうしたらいいですか？', '現在担当部署による修正が行われております。修正時間に関しましてはわかりかねます。大変ご迷惑をおかけしております何卒よろしくお願い申し上げます', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'かけた金額も減ってます。', '確認させていただきます。   
ではスクショなどはございますでしょうか？', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'スクショないです。', 'プロバイダー   
発生したお時間もお伺いできますでしょうか？', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'LiveスピードバカラEだと思います。', 'プロバイダー   
発生したお時間もお伺いできますでしょうか？', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '30分前くらいです', 'プロバイダー   
発生したお時間もお伺いできますでしょうか？', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'エボのスピードバカラです。', '履歴をお調べ致しましたが10時くらいにご遊戯はなく。最後が9時33分になります。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '時間は10時くらいです。', '履歴をお調べ致しましたが10時くらいにご遊戯はなく。最後が9時33分になります。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'スピードバカラEですか？', 'はい、Speed Baccarat Eでございます。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '履歴で5500円くらい勝ってるのは確認できますか？', '確認いたしましたがSpeed Baccarat Eで勝利金が5500円というのはございません。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02240331835056275456', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '番号もスクショも送ったます', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '送ってます', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02240562938656546816', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02240720194589007888', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02241052573519028232', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02241245451909562368', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02241374558626979842', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '3500円', '一回3万までになります。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'ID   kouhei19910214', '一回3万までになります。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '一日3万円上限ですか？', '一回3万までになります。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02241497283021873163', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02241737019506499594', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02241818598115336192', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '今の時間帯は対応できなさそうな感じですかね。。？', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '5800番台の件', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'まだ掛かるのでしょうか。流石に時間かかり過ぎだと思います。', '大変ご案内が遅くなり誠に申し訳ございません。   
確認いたしましたところ、該当の機台は一定時間内に受け取り操作が行われなかったため、自動的にリセットされております。

また、リセット後は再度上架されており、該当データの保持はされておりません。

何卒ご理解のほどよろしくお願いいたします。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '連絡が無いのですがまだ掛かるのでしょうか。', '大変ご案内が遅くなり誠に申し訳ございません。   
確認いたしましたところ、該当の機台は一定時間内に受け取り操作が行われなかったため、自動的にリセットされております。

また、リセット後は再度上架されており、該当データの保持はされておりません。

何卒ご理解のほどよろしくお願いいたします。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'どうゆう事でしょうか？', '当たり中にゲームが終了し、台が消えてしまった件につきまして、ご不便・ご不快な思いをおかけしましたこと、改めてお詫び申し上げます。

本件につきましては、システム上の影響により機台が終了処理となり、その後データがリセットされている状況でございました。

本来であればゲーム状態の復元ができかねる内容ではございますが、今回に限りお詫びとして[AMT]円分のポイントを付与させていただきました。

恐れ入りますが、ご確認いただけますと幸いです。

今後とも何卒よろしくお願いいたします。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '当たっている最中にゲームが終了致しました。と表示され台が消えたんですけど。ゲーム数も残っていたのでジャッジメントも残っていました。えっ？意味が分からないんですが。', '当たり中にゲームが終了し、台が消えてしまった件につきまして、ご不便・ご不快な思いをおかけしましたこと、改めてお詫び申し上げます。

本件につきましては、システム上の影響により機台が終了処理となり、その後データがリセットされている状況でございました。

本来であればゲーム状態の復元ができかねる内容ではございますが、今回に限りお詫びとして[AMT]円分のポイントを付与させていただきました。

恐れ入りますが、ご確認いただけますと幸いです。

今後とも何卒よろしくお願いいたします。', 'ゲーム', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '1500円では割に合わないですが意図的に終了させられたのかな。と思ってしまいますが2度とない様にお願いします。当たってない時なら別に良いんですが当たってる最中にゲームが終了しました。は流石にタチ悪いですよ', 'この度の件につきまして、ご不快な思いをさせてしまい重ねてお詫び申し上げます。

本件は意図的に終了させたものではなく、システム上の影響によるものでございますので、その点につきましてはご安心いただけますと幸いです。

また、同様の事象が発生しないよう、今後の改善に努めてまいります。

貴重なご意見をいただきありがとうございました。', 'ゲーム', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02242147111573897223', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'ryoji21', '手配いたしますので少々お待ちくださいませ。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'こちらになります', '手配いたしますので少々お待ちくださいませ。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02242095984283181056', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02242132800742752257', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02242192999004962830', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '頻繁にログイン異常になるのですが原因はなんですか？', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', 'アカウント', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02242368147770703882', '確認させて頂きますので少々お待ちくださいませ。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02242408288535199749', '取引番号を受け取りました✅

**スクリーンショット** もお送りください📷
（取引詳細画面で①取引番号 ②金額 ③日時 が確認できるもの）', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', '02242718660051828736', 'スクリーンショットを受け取りました📷

**取引番号（取引ID）** もテキストでコピー＆ペーストしてお送りください。
👉 数字20桁程度の番号です。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'サイトにアクセスしにくいです。', '現在、スロット天国にログインできない事象について、複数のお客様よりお問い合わせをいただいております。  
当サイトでも、原因の調査を進めております。

ご不便をおかけしておりますこと、深くお詫び申し上げます。  
恐れ入りますが、状況改善まで今しばらくお待ちくださいますようお願いいたします。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'これはサイト側の問題ですか？', '現在、スロット天国にログインできない事象について、複数のお客様よりお問い合わせをいただいております。  
当サイトでも、原因の調査を進めております。

ご不便をおかけしておりますこと、深くお詫び申し上げます。  
恐れ入りますが、状況改善まで今しばらくお待ちくださいますようお願いいたします。', '一般', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'ログインできないのですが', 'スロット天国カスタマーサポートへようこそ！🎰

ご希望の項目を下記メニューからお選びください。', 'アカウント', 'ja', 'auto-extracted', 1, 1);
INSERT INTO faq (tenant_id, question, answer, category, language, keywords, priority, is_active) VALUES ('tenant_default', 'ログインできません', '現在、スロット天国にログインできない事象について、複数のお客様よりお問い合わせをいただいております。  
当サイトでも、原因の調査を進めております。

ご不便をおかけしておりますこと、深くお詫び申し上げます。  
恐れ入りますが、状況改善まで今しばらくお待ちくださいますようお願いいたします。', 'アカウント', 'ja', 'auto-extracted', 1, 1);