import { describe, it, expect } from 'vitest';
import { shouldRejectFaqPair } from '../src/extractor.mjs';

describe('shouldRejectFaqPair', () => {
  it('rejects deposit-related pairs', () => {
    expect(shouldRejectFaqPair('入金したい', 'PayPayで入金できます')).toBe('deposit');
    expect(shouldRejectFaqPair('銀行振込の方法', '振込先は...')).toBe('deposit');
  });

  it('rejects transactional content', () => {
    expect(shouldRejectFaqPair('取引番号を教えて', 'こちらです')).toBe('transactional');
    expect(shouldRejectFaqPair('スクリーンショットを送ります', '確認します')).toBe('transactional');
    expect(shouldRejectFaqPair('アカウントIDは何ですか', 'こちらで確認します')).toBe('transactional');
  });

  it('rejects long digit sequences', () => {
    expect(shouldRejectFaqPair('番号は 123456789012345 です', '確認します')).toBe('long_digit');
  });

  it('rejects account-ID-like tokens (letters+digits)', () => {
    expect(shouldRejectFaqPair('IDは syt2525m です', '確認します')).toBe('account_id');
  });

  it('does NOT reject pure-letter or pure-number tokens', () => {
    // Pure letters (no digits) should not be flagged as account_id
    expect(shouldRejectFaqPair('ゲームについて', 'スロットがあります')).toBeNull();
  });

  it('rejects amounts', () => {
    expect(shouldRejectFaqPair('質問です', '5000円を...')).toBe('amount');
    expect(shouldRejectFaqPair('質問', '¥10,000')).toBe('amount');
  });

  it('rejects bot canned answers', () => {
    expect(shouldRejectFaqPair('質問', 'ご希望の項目をお選びください')).toBe('bot_answer');
    expect(shouldRejectFaqPair('質問', 'スロット天国カスタマーサポートへようこそ')).toBe('bot_answer');
    expect(shouldRejectFaqPair('質問', 'このメッセージは削除されました')).toBe('bot_answer');
  });

  it('rejects noise questions (pleasantries/status checks)', () => {
    expect(shouldRejectFaqPair('ありがとうございます', '何かあればお知らせください')).toBe('noise_question');
    expect(shouldRejectFaqPair('まだですか？', '確認中です')).toBe('noise_question');
    expect(shouldRejectFaqPair('よろしくお願いします', 'こちらこそ')).toBe('noise_question');
    expect(shouldRejectFaqPair('どうなりましたか', '回答待ちです')).toBe('noise_question');
  });

  it('rejects too-short questions', () => {
    expect(shouldRejectFaqPair('はい', 'かしこまりました')).toBe('noise_question');
    expect(shouldRejectFaqPair('test', '確認します')).toBe('too_short');
  });

  it('passes clean FAQ pairs', () => {
    expect(shouldRejectFaqPair('ログインできません', 'パスワードをリセットしてください')).toBeNull();
    expect(shouldRejectFaqPair('ゲームがフリーズした', 'ブラウザを再読み込みしてください')).toBeNull();
    expect(shouldRejectFaqPair('本人確認は必要？', 'KYCは原則不要です')).toBeNull();
  });
});
