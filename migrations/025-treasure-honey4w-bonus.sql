-- Add 4 bonus codes that exist in chatwoot-final-working (production) but
-- were missing from sloten-standalone: TREASURE Day 1/2/3 + HONEY4W.
--
-- Source: chatwoot-final-working/messages.js lines 873-906 (parity audit
-- 2026-05-09). Content preserved verbatim including campaign dates so that
-- staging-bk and the production AgentBot Worker behave identically until
-- BK chooses to refresh dates.
--
-- @idempotent — uses INSERT OR IGNORE on (tenant_id, type_key) so re-running
-- this migration is safe.

INSERT OR IGNORE INTO bonus_codes
  (tenant_id, type_key, display_name, codes, match_mode, success_content, success_items,
   gas_type, transfer_after, enabled, source, priority, sheet_name, game_selection,
   created_at, updated_at)
VALUES
  ('tenant_default', 'treasure_day1', 'Treasure Hunter Day 1 (宝箱1)',
   '["宝箱1"]',
   'exact',
   '🎰「Treasure Hunter」へようこそ！ 🗺💰' || char(10) ||
   'ボーナスコード「宝箱1」を確認しました！' || char(10) ||
   'ご参加ありがとうございます 😊✨' || char(10) || char(10) ||
   '📅 開催期間：4/22（水）〜 4/24（金）' || char(10) || char(10) ||
   'キャンペーンの詳細はこちら👇' || char(10) ||
   '🔗 https://slotenpromotion.com/treasurehunter/' || char(10) || char(10) ||
   '⚠️ 注意事項' || char(10) || char(10) ||
   '・サポートにて条件達成を確認後、問題なければ' || char(10) ||
   ' 達成日の翌日12:00〜順次付与されます' || char(10) ||
   '・申請がない場合は対象外となりますのでご注意ください' || char(10) ||
   '・フリースピン・ボーナスの賭け条件は1倍です' || char(10) ||
   '・有効期限は付与から48時間以内です' || char(10) || char(10) || char(10) ||
   '引き続き冒険をお楽しみください 🏴‍☠️✨',
   '[{"title":"↩️ メインメニューに戻る","value":"welcome_message"},{"title":"🙋 オペレーターと話す","value":"transfer_to_agent"}]',
   'BC_トレジャー', 0, 1, 'hardcoded', 100, NULL, 0,
   datetime('now'), datetime('now')),

  ('tenant_default', 'treasure_day2', 'Treasure Hunter Day 2 (宝箱2)',
   '["宝箱2"]',
   'exact',
   '🎰「Treasure Hunter」へようこそ！ 🗺💰' || char(10) ||
   'ボーナスコード「宝箱2」を確認しました！' || char(10) ||
   'ご参加ありがとうございます 😊✨' || char(10) || char(10) ||
   '📅 開催期間：4/22（水）〜 4/24（金）' || char(10) || char(10) ||
   'キャンペーンの詳細はこちら👇' || char(10) ||
   '🔗 https://slotenpromotion.com/treasurehunter/' || char(10) || char(10) ||
   '⚠️ 注意事項' || char(10) || char(10) ||
   '・サポートにて条件達成を確認後、問題なければ' || char(10) ||
   ' 達成日の翌日12:00〜順次付与されます' || char(10) ||
   '・申請がない場合は対象外となりますのでご注意ください' || char(10) ||
   '・フリースピン・ボーナスの賭け条件は1倍です' || char(10) ||
   '・有効期限は付与から48時間以内です' || char(10) || char(10) ||
   '🔥 次はいよいよ最終ステージ！' || char(10) ||
   '最大報酬を目指して最後まで進みましょう！',
   '[{"title":"↩️ メインメニューに戻る","value":"welcome_message"},{"title":"🙋 オペレーターと話す","value":"transfer_to_agent"}]',
   'BC_トレジャー', 0, 1, 'hardcoded', 100, NULL, 0,
   datetime('now'), datetime('now')),

  ('tenant_default', 'treasure_day3', 'Treasure Hunter Day 3 (宝箱3)',
   '["宝箱3"]',
   'exact',
   '🎰「Treasure Hunter」へようこそ！ 🗺💰' || char(10) ||
   'ボーナスコード「宝箱3」を確認しました！' || char(10) ||
   'ご参加ありがとうございます 😊✨' || char(10) || char(10) ||
   '📅 開催期間：4/22（水）〜 4/24（金）' || char(10) || char(10) ||
   'キャンペーンの詳細はこちら👇' || char(10) ||
   '🔗 https://slotenpromotion.com/treasurehunter/' || char(10) || char(10) ||
   '⚠️ 注意事項' || char(10) || char(10) ||
   '・宝箱は A / B / C / D のいずれかを選択して申請してください' || char(10) ||
   ' （例：「宝箱3 A」）' || char(10) ||
   '・サポートにて条件達成を確認後、問題なければ' || char(10) ||
   ' 達成日の翌日12:00〜順次付与されます' || char(10) ||
   '・申請がない場合は対象外となりますのでご注意ください' || char(10) ||
   '・フリースピン・ボーナスの賭け条件は1倍です' || char(10) ||
   '・有効期限は付与から48時間以内です' || char(10) || char(10) ||
   '🎁 いよいよ最終報酬！' || char(10) ||
   'あなたの選択で結果が決まります…！' || char(10) || char(10) ||
   '幸運を祈ります 🍀✨',
   '[{"title":"↩️ メインメニューに戻る","value":"welcome_message"},{"title":"🙋 オペレーターと話す","value":"transfer_to_agent"}]',
   'BC_トレジャー', 0, 1, 'hardcoded', 100, NULL, 0,
   datetime('now'), datetime('now')),

  ('tenant_default', 'honey4w', '4 Weeks of Honey Rush (HONEY4W)',
   '["HONEY4W"]',
   'case_insensitive',
   '🐝「4 Weeks of Honey Rush」へようこそ！ 🍯' || char(10) ||
   'ボーナスコード「HONEY4W」を確認しました！' || char(10) ||
   'ご参加ありがとうございます 😊✨' || char(10) ||
   '📅 開催期間：4/23（木）〜 5/20（水）' || char(10) ||
   '🎰 対象機種：Honey Rush Black & Yellow（Play''n GO）' || char(10) ||
   'キャンペーンの詳細はこちらからご確認ください👇' || char(10) ||
   '🔗 https://slotenpromotion.com/honeyrush/' || char(10) ||
   '⚠️ 注意事項' || char(10) ||
   '・特典は各週水曜 23:59 締め後、翌日（木 ）12:00〜順次付与されます。' || char(10) ||
   '・各週ごとに条件はリセットされます（各週独立達成型）。' || char(10) ||
   '・ボーナス・FSの賭け条件は1倍です。' || char(10) ||
   '・FSおよびボーナスの使用期限は、付与完了より1週間です。期限内にご使用ください。' || char(10) ||
   'ご不明な点はお気軽にチャットでお問い合わせください 💬✨' || char(10) ||
   '🐝 週を追うごとに報酬は加速。全4週、駆け抜けろ！ 🏆',
   '[{"title":"↩️ メインメニューに戻る","value":"welcome_message"},{"title":"🙋 オペレーターと話す","value":"transfer_to_agent"}]',
   'BC_HONEY4W', 0, 1, 'hardcoded', 100, NULL, 0,
   datetime('now'), datetime('now'));
