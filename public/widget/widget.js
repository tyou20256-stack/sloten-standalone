/*
 * Sloten Chat Widget — embeddable standalone script.
 *
 * Usage (host site):
 *   <script src="https://<worker>/widget/widget.js"
 *           data-api="https://<worker>"
 *           data-tenant-id="tenant_default"
 *           data-title="スロット天国サポート"
 *           async></script>
 *
 * Config precedence: script[data-*] > window.SlotenChatConfig > defaults.
 * All state persisted in localStorage under "sloten_chat:v1".
 */
(function () {
  'use strict';
  if (window.__SlotenChatLoaded) return;
  window.__SlotenChatLoaded = true;

  // Visible version banner in console for debugging cache issues.
  console.log(
    '%c[SlotenChat] widget v20260430.fix21 loaded',
    'background:#2563eb;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold',
  );

  const script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  const ds = (script && script.dataset) || {};
  const userCfg = window.SlotenChatConfig || {};

  // Fix 8: time-zone-sensitive Japanese greeting
  function timeGreeting() {
    const h = new Date().getHours();
    if (h >= 5 && h < 11) return 'おはようございます';
    if (h >= 11 && h < 17) return 'こんにちは';
    return 'こんばんは';
  }

  // Fix 9: Operator availability — 10:00〜翌02:00 (JST). AI is 24/7.
  // During off-hours, the welcome text is augmented with a note so users
  // know handoff may be slower. Actual routing still works (flow hasn't
  // changed), but expectations are set up-front.
  function isOperatorAvailable() {
    const h = new Date().getHours();
    return h >= 10 || h < 2;
  }

  const defaults = {
    tenantId: 'tenant_default',
    title: 'スロット天国',
    subtitle: '対応中',
    brandInitials: 'ST',
    // Fix 8: time-of-day greeting — replaced at runtime based on local hour.
    welcomeTitle: '__TIME_GREETING__、スロット天国サポートです',
    welcomeBody: 'ご用件をお選びいただくか、自由にご質問ください。',
    menuButtonLabel: 'メニュー',
    dreampotUrl: 'https://sloten.io/lottery',
    inputPlaceholder: 'ご質問を入力…',
    autoOpen: false,
  };

  const apiBase = (ds.api || userCfg.api || (script ? new URL(script.src).origin : window.location.origin)).replace(/\/$/, '');

  // Cache-bust suffix for widget.css. Declared BEFORE cfg so it's accessible
  // during cssUrl resolution (TDZ avoidance).
  const WIDGET_VERSION = 'v20260430.fix21';

  // Host-provided user info (optional). Populated from:
  //   data-user-name / data-user-email / data-user-phone
  //   data-user-identifier  (preferred, Chatwoot parity)
  //   data-user-external-id (legacy, same semantics)
  //   window.SlotenChatConfig.user = { identifier, name, email, phone, metadata }
  const hostUser = Object.assign({}, (userCfg.user || {}));
  if (ds.userName)       hostUser.name = ds.userName;
  if (ds.userEmail)      hostUser.email = ds.userEmail;
  if (ds.userPhone)      hostUser.phone = ds.userPhone;
  if (ds.userIdentifier) hostUser.identifier = ds.userIdentifier;
  if (ds.userExternalId && !hostUser.identifier) hostUser.identifier = ds.userExternalId;
  // Back-compat: legacy `external_id` key still maps to identifier.
  if (hostUser.external_id && !hostUser.identifier) hostUser.identifier = hostUser.external_id;

  const cfg = {
    apiBase,
    wsBase: apiBase.replace(/^http/, 'ws'),
    tenantId: ds.tenantId || userCfg.tenantId || defaults.tenantId,
    title: ds.title || userCfg.title || defaults.title,
    subtitle: ds.subtitle || userCfg.subtitle || defaults.subtitle,
    brandInitials: ds.brandInitials || userCfg.brandInitials || defaults.brandInitials,
    // Fix 11: optional brand logo URL — when set, replaces the "ST" initials
    // in the chat header. data-brand-logo="https://sloten.io/logo.png" on the
    // script tag, or window.SlotenChatConfig.brandLogoUrl.
    brandLogoUrl: ds.brandLogo || userCfg.brandLogoUrl || null,
    welcomeTitle: (ds.welcomeTitle || userCfg.welcomeTitle || defaults.welcomeTitle).replace('__TIME_GREETING__', timeGreeting()),
    welcomeBody: (ds.welcomeBody || userCfg.welcomeBody || defaults.welcomeBody) +
      (isOperatorAvailable() ? '' : '\n※ただ今オペレーター対応時間外です (10:00〜翌2:00)。AI が 24 時間ご案内します。'),
    menuButtonLabel: ds.menuButtonLabel || userCfg.menuButtonLabel || defaults.menuButtonLabel,
    dreampotUrl: ds.dreampotUrl || userCfg.dreampotUrl || defaults.dreampotUrl,
    inputPlaceholder: ds.inputPlaceholder || userCfg.inputPlaceholder || defaults.inputPlaceholder,
    autoOpen: (ds.autoOpen || userCfg.autoOpen || '').toString() === '1' || userCfg.autoOpen === true,
    cssUrl: ds.cssUrl || userCfg.cssUrl || (script ? new URL('./widget.css?v=' + encodeURIComponent(WIDGET_VERSION), script.src).toString() : null),
    user: hostUser,
  };

  const STORAGE_KEY = 'sloten_chat:v1';
  const state = Object.assign(
    { contactId: null, conversationId: null, contactToken: null, status: null, history: [] },
    loadState()
  );

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; }
    catch { return {}; }
  }
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        contactId: state.contactId,
        conversationId: state.conversationId,
        contactToken: state.contactToken,
      }));
    } catch (_) {}
  }

  async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.contactToken) headers['X-Sloten-Contact-Token'] = state.contactToken;
    const r = await fetch(cfg.apiBase + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) {
      // 401/403 on existing state means token or conversation is invalid —
      // clear and force fresh bootstrap on next send.
      if ((r.status === 401 || r.status === 403) && state.contactToken) {
        state.contactId = null;
        state.conversationId = null;
        state.contactToken = null;
        saveState();
      }
      throw new Error(data.error || `HTTP ${r.status}`);
    }
    return data;
  }

  function injectStyles() {
    if (cfg.cssUrl && !document.querySelector('link[data-sloten-chat="1"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cfg.cssUrl;
      link.setAttribute('data-sloten-chat', '1');
      document.head.appendChild(link);
    }
  }

  // --- DOM construction ---
  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    for (const c of children) {
      if (c == null) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  };

  const ICON_CHAT = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 5.94 2 10.8c0 2.52 1.26 4.79 3.3 6.41L4 22l5.22-2.61c.9.14 1.83.21 2.78.21 5.52 0 10-3.94 10-8.8C22 5.94 17.52 2 12 2z"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  const ICON_PAPERCLIP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.83l-8.57 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
  const ICON_SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>';
  const ICON_SPARKLE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5z"/><path d="M19 14l.75 2.25L22 17l-2.25.75L19 20l-.75-2.25L16 17l2.25-.75z"/></svg>';
  const ICON_CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

  // System emoji icon system (fix19).
  //
  // We tried Twemoji via jsdelivr CDN in fix17/18 but the <img> approach had
  // multiple failure modes in production: lazy-loading delays, intermittent
  // CDN reachability, and onerror-handler escaping bugs all caused blank
  // icons. fix19 abandons CDN dependence in favor of native system emoji
  // fonts (Apple Color Emoji on iOS/macOS, Segoe UI Emoji on Windows, Noto
  // Color Emoji on Android/Linux). These are pre-installed, render
  // instantly, are colorful 3D-ish on every modern OS, and have zero
  // network cost. The visual style varies slightly per OS but always
  // matches "color emoji" expectation.

  // Map step values to actual emoji characters (with VS-16 where needed
  // for explicit emoji presentation).
  const MENU_EMOJI_CHAR = {
    // ─── Top-level (8 categories) ────────────────────────────────────
    deposit_withdrawal: '💰',                // 💰 money bag
    game_info:          '🎮',                // 🎮 gamepad
    bonus_promo:        '🎁',                // 🎁 wrapped gift
    no_deposit_bonus:   '🆓',                // 🆓 FREE button
    account_issues:     '👤',                // 👤 bust silhouette
    faq_main:           '❓',                       // ❓ red question
    bonus_code_request: '🎟️',          // 🎟️ admission tickets (VS-16)
    transfer_to_agent:  '🎧',                // 🎧 headphone
    // ─── Payment methods (sub-menu) ──────────────────────────────────
    bank_transfer:             '🏦',         // 🏦 bank
    convenience_store_deposit: '🏪',         // 🏪 convenience store
    atm_deposit:               '🏧',         // 🏧 ATM sign
    // ─── Withdrawal ──────────────────────────────────────────────────
    withdrawal_auto:           '🏦',         // 🏦
    // ─── Trouble ─────────────────────────────────────────────────────
    payment_troubleshooting:   '⚠️',          // ⚠️ warning (VS-16)
    deposit_not_reflected:     '⏳',                // ⏳ hourglass
    withdrawal_not_received:   '⏳',                // ⏳
    deposit_cancelled:         '❌',                // ❌ cross
    withdrawal_cancelled:      '❌',                // ❌
    // ─── Game ────────────────────────────────────────────────────────
    game_types:        '🎰',                 // 🎰 slot machine
    game_issues:       '🔧',                 // 🔧 wrench
    supported_devices: '📱',                 // 📱 mobile phone
    // ─── Promo ───────────────────────────────────────────────────────
    current_promotions:    '🎉',             // 🎉 party popper
    heavens_stepup:        '🎰',             // 🎰
    wagering_requirements: '🔄',             // 🔄 anticlockwise arrows
    // ─── Account ─────────────────────────────────────────────────────
    login_issues:    '🔑',                   // 🔑 key
    email_change:    '📧',                   // 📧 e-mail
    phone_change:    '📱',                   // 📱
    password_change: '🔒',                   // 🔒 locked
    // ─── FAQ leaves ──────────────────────────────────────────────────
    faq_kyc:              '🔐',              // 🔐 locked with key
    faq_processing_time:  '⏱️',               // ⏱️ stopwatch (VS-16)
    faq_payment_methods:  '💳',              // 💳 credit card
    faq_bonus_usage:      '🎁',              // 🎁
  };

  // Background color for icon containers per step. Default = dark slate so
  // emojis pop. Special: PayPay/BTC use brand colors.
  const MENU_BG = {
    paypay_money:      '#ed3050',  // PayPay red
    paypay_money_lite: '#f87171',  // PayPay Lite
    cryptocurrency:    '#f7931a',  // Bitcoin orange
  };

  // Custom branded letter-mark icons. Returned as inner HTML for the icon
  // container — no emoji image. The container provides the colored circle.
  const MENU_LETTER = {
    paypay_money:      { ch: 'P', fontSize: '20px', fontFamily: '-apple-system, "Helvetica Neue", Arial, sans-serif', weight: 900, color: '#fff', letterSpacing: '-1px' },
    paypay_money_lite: { ch: 'P', fontSize: '20px', fontFamily: '-apple-system, "Helvetica Neue", Arial, sans-serif', weight: 900, color: '#fff', letterSpacing: '-1px' },
    cryptocurrency:    { ch: '₿', fontSize: '22px', fontFamily: 'Georgia, "Times New Roman", serif', weight: 900, color: '#fff' },
  };

  // Build inner HTML for the icon container.
  // 1) Custom letter-mark (PayPay, ₿)? render as <span> text glyph.
  // 2) Known step value? render the emoji char in a styled <span>.
  // 3) Has fallback emoji from title? render that.
  // 4) Otherwise empty.
  function getMenuIconHtml(stepValue, fallbackEmoji) {
    const letter = MENU_LETTER[stepValue];
    if (letter) {
      return '<span style="color:' + letter.color
        + ';font-family:' + letter.fontFamily
        + ';font-size:' + letter.fontSize
        + ';font-weight:' + letter.weight
        + (letter.letterSpacing ? ';letter-spacing:' + letter.letterSpacing : '')
        + ';line-height:1;">' + letter.ch + '</span>';
    }
    const ch = MENU_EMOJI_CHAR[stepValue] || fallbackEmoji || '';
    if (!ch) return '';
    return '<span class="sloten-chat-emoji">' + ch + '</span>';
  }

  function getMenuIconBg(stepValue) {
    return MENU_BG[stepValue] || '#1e293b';
  }

  // ─── Dreampot coin: precision SVG (fix21 redesign) ──────────────────
  // Composition: confetti perimeter + bottom laurel branches + central
  // gold disk with crown floating above + bold "JP" serif wordmark.
  // Authored as a template literal to avoid the `+ // comment + 'str'`
  // ASI trap that prepended NaN tokens between SVG groups in earlier drafts.
  const ICON_DREAMPOT_COIN = `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <radialGradient id="dpC" cx="34%" cy="28%" r="72%">
          <stop offset="0%" stop-color="#fef9c3"/>
          <stop offset="35%" stop-color="#fde047"/>
          <stop offset="68%" stop-color="#eab308"/>
          <stop offset="100%" stop-color="#a16207"/>
        </radialGradient>
        <linearGradient id="dpL" x1="0%" y1="0%" x2="40%" y2="100%">
          <stop offset="0%" stop-color="#fde68a"/>
          <stop offset="100%" stop-color="#b45309"/>
        </linearGradient>
        <radialGradient id="dpCrown" cx="40%" cy="30%" r="80%">
          <stop offset="0%" stop-color="#fef9c3"/>
          <stop offset="60%" stop-color="#fbbf24"/>
          <stop offset="100%" stop-color="#92400e"/>
        </radialGradient>
      </defs>
      <g>
        <circle cx="8" cy="14" r="2.6" fill="#fcd34d"/>
        <circle cx="91" cy="20" r="2.2" fill="#fcd34d"/>
        <circle cx="6" cy="40" r="1.8" fill="#fbbf24"/>
        <circle cx="93" cy="48" r="1.6" fill="#fbbf24"/>
        <circle cx="11" cy="68" r="1.4" fill="#fcd34d"/>
        <circle cx="89" cy="72" r="1.6" fill="#fcd34d"/>
        <path d="M 16 6 L 19 10 L 14 11 Z" fill="#facc15"/>
        <path d="M 84 7 L 88 9 L 86 13 Z" fill="#facc15"/>
        <path d="M 4 26 L 7 27 L 5 31 Z" fill="#fde047"/>
        <path d="M 95 32 L 96 36 L 92 35 Z" fill="#fde047"/>
        <path d="M 12 84 L 16 85 L 14 89 Z" fill="#facc15"/>
        <path d="M 84 86 L 88 84 L 88 89 Z" fill="#facc15"/>
        <path d="M 24 8 L 25.5 11 L 28 12 L 25.5 13 L 24 16 L 22.5 13 L 20 12 L 22.5 11 Z" fill="#fef3c7"/>
        <path d="M 76 10 L 77.5 13 L 80 14 L 77.5 15 L 76 18 L 74.5 15 L 72 14 L 74.5 13 Z" fill="#fef3c7"/>
      </g>
      <g fill="url(#dpL)" stroke="#7c4a02" stroke-width="0.5">
        <ellipse cx="18" cy="60" rx="3.2" ry="6" transform="rotate(-35 18 60)"/>
        <ellipse cx="14" cy="70" rx="3" ry="5.5" transform="rotate(-20 14 70)"/>
        <ellipse cx="18" cy="80" rx="3" ry="5" transform="rotate(-5 18 80)"/>
        <ellipse cx="28" cy="86" rx="2.6" ry="4.6" transform="rotate(15 28 86)"/>
        <ellipse cx="82" cy="60" rx="3.2" ry="6" transform="rotate(35 82 60)"/>
        <ellipse cx="86" cy="70" rx="3" ry="5.5" transform="rotate(20 86 70)"/>
        <ellipse cx="82" cy="80" rx="3" ry="5" transform="rotate(5 82 80)"/>
        <ellipse cx="72" cy="86" rx="2.6" ry="4.6" transform="rotate(-15 72 86)"/>
      </g>
      <circle cx="50" cy="54" r="29" fill="url(#dpC)" stroke="#78350f" stroke-width="2.2"/>
      <path d="M 28 42 Q 36 30 52 28 Q 38 32 30 50 Z" fill="#fef9c3" opacity="0.55"/>
      <circle cx="50" cy="54" r="22" fill="none" stroke="#854d0e" stroke-width="0.9" stroke-dasharray="2 2" opacity="0.7"/>
      <g transform="translate(50 22)">
        <path d="M -16 5 L -12 -5 L -7 2 L -3 -8 L 0 -10 L 3 -8 L 7 2 L 12 -5 L 16 5 L 14 9 L -14 9 Z"
              fill="url(#dpCrown)" stroke="#7c2d12" stroke-width="1" stroke-linejoin="round"/>
        <rect x="-14" y="9" width="28" height="3" rx="1.2" fill="#b45309" stroke="#7c2d12" stroke-width="0.8"/>
        <circle cx="-12" cy="-5" r="1.6" fill="#dc2626" stroke="#7c2d12" stroke-width="0.5"/>
        <circle cx="0" cy="-10" r="2" fill="#dc2626" stroke="#7c2d12" stroke-width="0.5"/>
        <circle cx="12" cy="-5" r="1.6" fill="#dc2626" stroke="#7c2d12" stroke-width="0.5"/>
      </g>
      <text x="50" y="62" font-family="Georgia, 'Times New Roman', serif"
            font-size="26" font-weight="900" fill="#78350f" text-anchor="middle" letter-spacing="-1">JP</text>
    </svg>
  `;

  const dom = {};
  function buildUI() {
    dom.root = el('div', { class: 'sloten-chat-root', 'data-open': cfg.autoOpen ? '1' : '0' });
    dom.launcher = el('button', {
      class: 'sloten-chat-launcher',
      'aria-label': 'チャットを開く',
      onclick: open,
      html: ICON_CHAT,
    });
    dom.panel = el('div', { class: 'sloten-chat-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'サポートチャット' });

    // Header: avatar (logo img or initials) + title + "対応中" + close
    const brandInitials = (cfg.brandInitials || 'ST').slice(0, 2);
    const avatarNode = cfg.brandLogoUrl
      ? el('img', {
          class: 'sloten-chat-header-avatar sloten-chat-header-logo',
          src: cfg.brandLogoUrl,
          alt: cfg.title || 'ブランドロゴ',
          width: '32', height: '32',
        })
      : el('div', { class: 'sloten-chat-header-avatar', 'aria-hidden': 'true' }, brandInitials);
    const header = el('div', { class: 'sloten-chat-header' },
      avatarNode,
      el('div', { class: 'sloten-chat-header-text' },
        el('div', { class: 'sloten-chat-title' }, cfg.title),
        el('div', { class: 'sloten-chat-subtitle' }, cfg.subtitle + ' · fix21'),
      ),
      el('button', { class: 'sloten-chat-close', type: 'button', 'aria-label': 'チャットウィジェットを閉じる', onclick: close }, '\u00d7'),
    );

    // --- Welcome card (white) ---
    // Body may include "オペレーター対応時間外" warning — split so we
    // can highlight the warning while keeping the rest as muted text.
    const fullBody = cfg.welcomeBody;
    const warnIdx = fullBody.indexOf('※');
    const bodyMain = warnIdx >= 0 ? fullBody.slice(0, warnIdx).trim() : fullBody;
    const bodyWarn = warnIdx >= 0 ? fullBody.slice(warnIdx) : '';
    const welcomeBodyEl = el('div', { class: 'sloten-chat-welcome-body' });
    if (bodyMain) welcomeBodyEl.appendChild(document.createTextNode(bodyMain));
    if (bodyWarn) {
      if (bodyMain) welcomeBodyEl.appendChild(el('br'));
      welcomeBodyEl.appendChild(el('span', { class: 'sloten-chat-welcome-warn' }, bodyWarn));
    }
    dom.welcome = el('div', { class: 'sloten-chat-welcome' },
      el('div', { class: 'sloten-chat-welcome-text' },
        el('div', { class: 'sloten-chat-welcome-title' }, '👋 ' + cfg.welcomeTitle),
        welcomeBodyEl,
      ),
      dom.menuBtn = el('button', {
        class: 'sloten-chat-menu-btn', type: 'button',
        'aria-label': 'メニューを表示',
        onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); onMenuClick(); },
        html: ICON_SPARKLE + '<span>' + cfg.menuButtonLabel + '</span>',
      }),
    );

    // --- Dreampot banner ---
    // Three-column layout to match the fix13/fix21 mockup:
    //   [coin 80px] [title + sub (2 lines)] [CTA pill on right]
    // The whole banner remains tappable (forgiving hit area), but the CTA
    // is the visual primary action. Stop click propagation on the CTA so
    // both targets navigate independently and only once.
    const openDreampot = () => window.open(cfg.dreampotUrl, '_blank', 'noopener');
    dom.dreampot = el('div', {
      class: 'sloten-chat-dreampot',
      role: 'button', tabindex: '0',
      onclick: openDreampot,
      onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') openDreampot(); },
    },
      el('div', { class: 'sloten-chat-dreampot-coin', html: ICON_DREAMPOT_COIN }),
      el('div', { class: 'sloten-chat-dreampot-text' },
        el('div', { class: 'sloten-chat-dreampot-row' },
          el('span', { class: 'sloten-chat-dreampot-label' }, 'ドリームポット'),
          el('span', { class: 'sloten-chat-dreampot-amount', id: 'slc-dreampot-amount' }, '¥…'),
        ),
        el('div', { class: 'sloten-chat-dreampot-sub' }, '夢をつかむチャンス！'),
      ),
      el('button', {
        class: 'sloten-chat-dreampot-cta', type: 'button',
        'aria-label': 'ドリームポットの詳細を見る',
        onclick: (ev) => { ev.stopPropagation(); openDreampot(); },
      }, '詳しくはこちら ›'),
    );

    dom.banner = el('div', { class: 'sloten-chat-banner' });

    // --- Single scrollable area: welcome + dreampot + banner + messages ---
    // Combining everything into one scroll lets the chat history flow
    // naturally below the static cards.
    dom.messages = el('div', { class: 'sloten-chat-scroll' });
    dom.typing = el('div', { class: 'sloten-chat-typing' }, '入力中…');
    dom.input = el('textarea', {
      class: 'sloten-chat-input',
      rows: '1',
      placeholder: cfg.inputPlaceholder,
      onkeydown: onKeyDown,
      oninput: () => autoResize(dom.input),
    });
    dom.send = el('button', { class: 'sloten-chat-send', type: 'button', 'aria-label': 'メッセージを送信', onclick: onSend, html: ICON_SEND });
    dom.attach = el('button', {
      class: 'sloten-chat-attach', type: 'button',
      'aria-label': 'ファイルを添付',
      title: 'ファイル添付 (JPG/PNG/GIF/WEBP/PDF, 最大5MB)',
      onclick: () => dom.file.click(),
      html: ICON_PAPERCLIP,
    });
    dom.file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp,application/pdf', style: 'display:none', onchange: onFilePicked });
    dom.pending = el('div', { class: 'sloten-chat-pending', style: 'display:none' });
    const inputWrap = el('div', { class: 'sloten-chat-input-wrap' }, dom.attach, dom.input, dom.send);
    // Default status: shield icon + "AIが24時間ご案内します". setStatus() can
    // override this temporarily for reconnect/error notices.
    dom.status = el('div', { class: 'sloten-chat-status' });
    dom.status.innerHTML = ICON_SHIELD + ' AI が 24 時間ご案内します';

    // Compose the panel: welcome + dreampot + banner all live INSIDE the
    // scroll container so they flow naturally with the message history.
    dom.messages.appendChild(dom.welcome);
    dom.messages.appendChild(dom.dreampot);
    dom.messages.appendChild(dom.banner);
    dom.messages.appendChild(dom.typing);

    dom.panel.appendChild(header);
    dom.panel.appendChild(dom.messages);
    dom.panel.appendChild(dom.pending);
    dom.panel.appendChild(inputWrap);
    dom.panel.appendChild(dom.file);
    dom.panel.appendChild(dom.status);
    dom.root.appendChild(dom.launcher);
    dom.root.appendChild(dom.panel);
    (document.body || document.documentElement).appendChild(dom.root);
  }

  // --- Attachments ---
  let pendingAttachment = null; // { id, filename, content_type, size_bytes }

  function showPending(att) {
    pendingAttachment = att;
    if (!att) { dom.pending.style.display = 'none'; dom.pending.innerHTML = ''; return; }
    dom.pending.style.display = 'flex';
    dom.pending.innerHTML = '';
    dom.pending.appendChild(document.createTextNode(`📎 ${att.filename} (${Math.round(att.size_bytes/1024)} KB)`));
    const x = el('button', { type: 'button', 'aria-label': '添付キャンセル', onclick: () => showPending(null) }, '×');
    dom.pending.appendChild(x);
  }

  // Fix 10: allowlisted MIME types for file attachment
  const ALLOWED_UPLOAD_TYPES = [
    'image/jpeg', 'image/pjpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
  ];
  const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5 MB (was 10 MB — align with fix spec)

  async function onFilePicked(ev) {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    // Fix 10: MIME type + size validation
    if (!ALLOWED_UPLOAD_TYPES.includes(f.type)) {
      renderMessage({
        id: 'err-' + Date.now(),
        sender_type: 'system',
        content: `📎 対応ファイル形式: JPG / PNG / GIF / WEBP / PDF\n(受信: ${f.type || '不明'})`,
        created_at: new Date().toISOString(),
      });
      return;
    }
    if (f.size > MAX_UPLOAD_SIZE) {
      renderMessage({ id: 'err-' + Date.now(), sender_type: 'system', content: `📎 ファイルサイズは ${MAX_UPLOAD_SIZE / 1024 / 1024} MB 以下でお願いします`, created_at: new Date().toISOString() });
      return;
    }
    try {
      await ensureConversation();
      const form = new FormData();
      form.append('file', f);
      const headers = state.contactToken ? { 'X-Sloten-Contact-Token': state.contactToken } : {};
      const r = await fetch(`${cfg.apiBase}/api/widget/conversations/${state.conversationId}/attachments`, { method: 'POST', headers, body: form });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = {}; }
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      showPending(data.attachment);
    } catch (e) {
      renderMessage({ id: 'err-' + Date.now(), sender_type: 'system', content: 'アップロード失敗: ' + e.message, created_at: new Date().toISOString() });
    }
  }

  function autoResize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 100) + 'px';
  }

  function onKeyDown(ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      onSend();
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  }

  // Default status caption — shown when no transient state (reconnecting,
  // error) is in effect. fix19 design: shield icon + "AI が 24 時間ご案内します".
  const STATUS_DEFAULT_HTML = ICON_SHIELD + ' AI が 24 時間ご案内します';
  function setStatus(text) {
    if (text) {
      // Transient notice — plain text, replaces shield+default.
      dom.status.textContent = text;
    } else {
      dom.status.innerHTML = STATUS_DEFAULT_HTML;
    }
  }
  function setBanner(text) {
    if (!text) { dom.banner.removeAttribute('data-visible'); dom.banner.textContent = ''; }
    else { dom.banner.setAttribute('data-visible', '1'); dom.banner.textContent = text; }
  }
  function setTyping(on) { dom.typing.setAttribute('data-visible', on ? '1' : '0'); }

  function formatTime(iso) {
    try {
      const d = new Date((iso && !iso.endsWith('Z') ? iso.replace(' ', 'T') + 'Z' : iso));
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  // --- Lightweight Markdown renderer (Fix 3) ------------------------------
  // Handles the common patterns: **bold**, *italic*, `code`, URLs, line breaks.
  // No external dependencies. Escapes HTML first, then re-introduces safe
  // inline markup.
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function renderMarkdown(text) {
    if (!text) return '';
    let html = escHtml(text);
    // Auto-link URLs (http/https)
    html = html.replace(
      /(https?:\/\/[^\s<]+?)(?=[.,;:!?)]?(?:\s|$))/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
    );
    // Bold **x**
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    // Italic *x* (no underscore to avoid URL collisions)
    html = html.replace(/(^|[^\*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
    // Inline code `x`
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // Line breaks
    html = html.replace(/\n/g, '<br />');
    return html;
  }

  // Fix 2: Track values that were sent from button clicks so the user bubble
  // displays the human label instead of the internal action ID (e.g.
  // "game_info"). Maps sendValue → displayLabel, expires in 10s.
  const buttonClickLabels = new Map();
  function rememberButtonClick(value, label) {
    if (!value || value === label) return;
    buttonClickLabels.set(value, label);
    setTimeout(() => buttonClickLabels.delete(value), 10_000);
  }

  function renderMessage(msg) {
    if (!msg || !msg.id) return;
    if (dom.messages.querySelector(`[data-msg-id="${msg.id}"]`)) return; // dedupe
    const bubble = el('div', { class: 'sloten-chat-msg', 'data-sender': msg.sender_type || 'bot', 'data-msg-id': msg.id });
    // Fix 2: replace internal action ID with the label the user saw when
    // clicking a menu button.
    let shownContent = msg.content || '';
    if (msg.sender_type === 'customer' && buttonClickLabels.has(shownContent)) {
      shownContent = buttonClickLabels.get(shownContent);
    }
    // Fix 3: render Markdown for bot messages (preserve plain text for customer).
    const contentDiv = el('div', {});
    if (msg.sender_type === 'bot' || msg.sender_type === 'staff') {
      contentDiv.innerHTML = renderMarkdown(shownContent);
      // Ensure any <a> we rendered opens in a new tab
      contentDiv.querySelectorAll('a').forEach((a) => {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      });
    } else {
      contentDiv.textContent = shownContent;
    }
    bubble.appendChild(contentDiv);

    // Attachment preview
    if (msg.attachment) {
      const a = msg.attachment;
      const url = `${cfg.apiBase}/api/widget/attachments/${a.id}`;
      const isImg = (a.content_type || '').startsWith('image/');
      const box = el('div', { class: 'sloten-chat-attachment' });
      if (isImg) {
        const img = el('img', { alt: a.filename, 'data-att-id': a.id });
        // Fetch with header auth, blob-convert to object URL so <img> can show it.
        fetch(url, { headers: { 'X-Sloten-Contact-Token': state.contactToken || '' } })
          .then((r) => r.ok ? r.blob() : Promise.reject(new Error('download failed')))
          .then((b) => { img.src = URL.createObjectURL(b); })
          .catch(() => { img.alt = '画像の読み込みに失敗'; });
        img.addEventListener('click', () => window.open(img.src, '_blank', 'noopener'));
        box.appendChild(img);
      } else {
        const link = el('a', {
          class: 'sloten-chat-attachment-file',
          href: '#', onclick: async (ev) => {
            ev.preventDefault();
            try {
              const r = await fetch(url, { headers: { 'X-Sloten-Contact-Token': state.contactToken || '' } });
              if (!r.ok) throw new Error('download failed');
              const b = await r.blob();
              const u = URL.createObjectURL(b);
              window.open(u, '_blank', 'noopener');
            } catch (e) { console.warn(e); }
          },
        }, '📎 ' + (a.filename || 'file'),
           el('span', { class: 'sloten-chat-attachment-meta' }, Math.round((a.size_bytes || 0) / 1024) + ' KB'));
        box.appendChild(link);
      }
      bubble.appendChild(box);
    }

    if (msg.content_type === 'input_select' && msg.content_attributes) {
      try {
        const attrs = typeof msg.content_attributes === 'string' ? JSON.parse(msg.content_attributes) : msg.content_attributes;
        const items = (attrs && attrs.items) || [];
        if (items.length) {
          // Mark all PRIOR input_select grids as stale so the user can only
          // click the latest menu. Without this, scrolling up reveals old
          // welcome-menu buttons that still send (now-invalid) flow values
          // and trigger AI fallback / wrong sub-menu.
          dom.messages.querySelectorAll('.sloten-chat-msg-grid:not([data-stale])').forEach((priorGrid) => {
            priorGrid.setAttribute('data-stale', '1');
          });
          // Strip the bot-bubble styling so the grid renders as a full-width
          // card area without the chat-bubble box (matches design mockup).
          bubble.classList.add('sloten-chat-msg-grid');
          // Decide single vs two-column. Long titles or few items → 1 col.
          const longest = items.reduce((m, it) => Math.max(m, (it.title || '').length), 0);
          const singleCol = items.length <= 3 || longest > 14;
          const grid = el('div', { class: 'sloten-chat-grid', 'data-cols': singleCol ? '1' : '2' });
          for (const it of items) {
            const displayText = it.title || it.value || '';
            const sendValue = it.value || it.title || '';
            // Strip the leading emoji from the title (if any) — used both as
            // the visual fallback when sendValue isn't in MENU_EMOJIS, and to
            // produce a clean text label without duplicate emoji.
            let labelText = displayText;
            let fallbackEmoji = null;
            const m = displayText.match(/^([\p{Emoji_Presentation}\p{Extended_Pictographic}☀-➿⌀-⏿⬀-⯿])\s*/u);
            if (m) {
              fallbackEmoji = m[1];
              labelText = displayText.slice(m[0].length).trim();
            }
            const iconHtml = getMenuIconHtml(sendValue, fallbackEmoji);
            const iconBg = getMenuIconBg(sendValue);
            const btn = el('button', {
              class: 'sloten-chat-grid-item',
              type: 'button',
              onclick: () => {
                rememberButtonClick(sendValue, displayText);
                sendText(sendValue);
              },
            },
              el('span', {
                class: 'sloten-chat-grid-icon',
                style: 'background:' + iconBg,
                html: iconHtml,
              }),
              el('span', { class: 'sloten-chat-grid-label' }, labelText),
              // Chevron restored to match reference design. Pill row uses
              // truncating label so long text does not push the chevron off.
              el('span', { class: 'sloten-chat-grid-chevron', html: ICON_CHEVRON_RIGHT }),
            );
            grid.appendChild(btn);
          }
          bubble.appendChild(grid);
        }
      } catch (_) {}
    }

    bubble.appendChild(el('div', { class: 'sloten-chat-meta' }, formatTime(msg.created_at)));
    dom.messages.insertBefore(bubble, dom.typing);
    scrollToBottom();
  }

  function scrollToBottom() {
    // Fix 7: smooth scroll — use scrollTo API when available. Fallback to
    // immediate jump if smooth behavior isn't supported (older browsers).
    requestAnimationFrame(() => {
      try {
        dom.messages.scrollTo({ top: dom.messages.scrollHeight, behavior: 'smooth' });
      } catch (_) {
        dom.messages.scrollTop = dom.messages.scrollHeight;
      }
    });
  }

  // --- Bootstrap conversation ---
  async function ensureContact() {
    if (state.contactId) return state.contactId;
    // Collect host-provided user info. `identifier` goes to contacts.external_id
    // (Chatwoot `$chatwoot.setUser(identifier)` parity). Additional metadata
    // (if any) is merged into contacts.metadata.
    const payload = { tenant_id: cfg.tenantId };
    const u = cfg.user || {};
    if (u.name)       payload.name  = u.name;
    if (u.email)      payload.email = u.email;
    if (u.phone)      payload.phone = u.phone;
    if (u.identifier) payload.identifier = u.identifier;
    const meta = Object.assign({}, u.metadata || {});
    if (Object.keys(meta).length) payload.metadata = meta;

    const r = await api('POST', '/api/widget/contacts', payload);
    state.contactId = r.contact.id;
    if (r.contact_token) state.contactToken = r.contact_token;
    saveState();
    return state.contactId;
  }

  // Runtime profile update — mirrors Chatwoot's `window.$chatwoot.setUser()`.
  // Safe to call before or after the contact has been created. If called
  // before, the values are held in cfg.user and sent on first create. If
  // called after, a PATCH is issued to apply the changes server-side.
  async function setUser(identifier, userInfo = {}) {
    const u = cfg.user = cfg.user || {};
    if (identifier != null) u.identifier = String(identifier);
    if (userInfo && typeof userInfo === 'object') {
      if (userInfo.name  !== undefined) u.name  = userInfo.name;
      if (userInfo.email !== undefined) u.email = userInfo.email;
      // Chatwoot uses `phone_number`; accept both for compatibility.
      if (userInfo.phone !== undefined) u.phone = userInfo.phone;
      if (userInfo.phone_number !== undefined) u.phone = userInfo.phone_number;
      if (userInfo.avatar_url !== undefined) u.avatar_url = userInfo.avatar_url;
      if (userInfo.custom_attributes && typeof userInfo.custom_attributes === 'object') {
        u.metadata = Object.assign({}, u.metadata || {}, userInfo.custom_attributes);
      }
      if (userInfo.metadata && typeof userInfo.metadata === 'object') {
        u.metadata = Object.assign({}, u.metadata || {}, userInfo.metadata);
      }
    }
    if (!state.contactId) return { deferred: true };
    const body = {};
    if (u.identifier !== undefined) body.identifier = u.identifier;
    if (u.name       !== undefined) body.name       = u.name;
    if (u.email      !== undefined) body.email      = u.email;
    if (u.phone      !== undefined) body.phone      = u.phone;
    if (u.avatar_url !== undefined) body.avatar_url = u.avatar_url;
    if (u.metadata   !== undefined) body.metadata   = u.metadata;
    try {
      const r = await api('PATCH', '/api/widget/contacts/' + encodeURIComponent(state.contactId), body);
      return { ok: true, contact: r.contact };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function ensureConversation() {
    if (state.conversationId) return state.conversationId;
    await ensureContact();
    const r = await api('POST', '/api/widget/conversations', {
      tenant_id: cfg.tenantId,
      contact_id: state.contactId,
    });
    state.conversationId = r.conversation.id;
    state.status = r.conversation.status;
    saveState();
    // First-time conversation: open WS immediately so operator replies appear in real time.
    connectWS();
    return state.conversationId;
  }

  async function loadHistory() {
    if (!state.conversationId) return;
    try {
      const r = await api('GET', `/api/widget/conversations/${state.conversationId}/messages`);
      for (const m of (r.messages || [])) renderMessage(m);
    } catch (e) {
      console.warn('[sloten-chat] loadHistory failed:', e.message);
      state.conversationId = null;
      saveState();
    }
  }

  async function refreshConversation() {
    if (!state.conversationId) return;
    try {
      const r = await api('GET', `/api/widget/conversations/${state.conversationId}`);
      state.status = r.conversation.status;
      if (r.conversation.status === 'open' && r.conversation.assignee_id) {
        setBanner('担当者におつなぎしました。少々お待ちください。');
      } else if (r.conversation.status === 'closed') {
        setBanner('この会話は終了しています。新しい質問は送信ボタンから。');
      } else {
        setBanner('');
      }
    } catch (_) { /* ignore */ }
  }

  // --- Menu button ---
  // Dedicated in-flight guard so it is NOT blocked by the unrelated `sending`
  // state used for text/attachment sends. Always renders bot_replies from the
  // HTTP response so the new menu appears even when the WS channel is mid-
  // reconnect. dedupe in renderMessage handles any duplicates from WS.
  let menuClickInFlight = false;
  async function onMenuClick() {
    if (menuClickInFlight) return;
    menuClickInFlight = true;
    if (dom.menuBtn) dom.menuBtn.disabled = true;
    setTyping(true);
    try {
      await ensureConversation();
      const r = await api('POST', `/api/widget/conversations/${state.conversationId}/messages`, {
        sender_type: 'customer',
        content: cfg.menuButtonLabel,
        reset_flow: true,
      });
      if (r && Array.isArray(r.bot_replies)) {
        for (const m of r.bot_replies) renderMessage(m);
      } else if (r && r.bot_reply) {
        renderMessage(r.bot_reply);
      }
    } catch (e) {
      renderMessage({
        id: 'err-' + Date.now(), sender_type: 'system',
        content: 'メニュー表示に失敗しました: ' + (e && e.message ? e.message : e),
        created_at: new Date().toISOString(),
      });
    } finally {
      menuClickInFlight = false;
      setTyping(false);
      if (dom.menuBtn) dom.menuBtn.disabled = false;
    }
  }

  // --- Sending ---
  let sending = false;
  async function onSend() {
    const text = (dom.input.value || '').trim();
    // Allow send when either text OR an attachment is present.
    if (sending) return;
    if (!text && !pendingAttachment) return;
    dom.input.value = '';
    autoResize(dom.input);
    await sendText(text);
  }

  async function sendText(text) {
    // Allow empty text if an attachment is pending — send just the file.
    if (!text && !pendingAttachment) return;
    sending = true;
    dom.send.disabled = true;
    setTyping(true);
    try {
      await ensureConversation();
      const body = {
        sender_type: 'customer',
        content: text || (pendingAttachment ? pendingAttachment.filename : ''),
      };
      if (pendingAttachment) {
        body.content_attributes = { attachment_id: pendingAttachment.id };
      }
      const r = await api('POST', `/api/widget/conversations/${state.conversationId}/messages`, body);
      if (pendingAttachment) showPending(null);
      // Render the customer's own message from the HTTP response using the
      // real server-assigned id. WS will broadcast the same id and renderMessage
      // dedupes on data-msg-id, so no double bubble appears. This covers the
      // race where WS is still opening on first message and the broadcast fires
      // before the client is listening.
      if (r && r.message) renderMessage(r.message);
      // Render bot replies from the HTTP response as a safety net.
      if (r && Array.isArray(r.bot_replies)) {
        for (const m of r.bot_replies) renderMessage(m);
      } else if (r && r.bot_reply) {
        renderMessage(r.bot_reply);
      }
      if (!wsActive()) setTimeout(pollMessages, 800);
    } catch (e) {
      renderMessage({
        id: 'err-' + Date.now(),
        sender_type: 'system',
        content: '送信に失敗しました: ' + e.message,
        created_at: new Date().toISOString(),
      });
    } finally {
      sending = false;
      dom.send.disabled = false;
      setTyping(false);
    }
  }

  // --- WebSocket ---
  let ws = null;
  let wsReconnectTimer = null;
  let wsAttempt = 0;
  let pollTimer = null;

  function wsActive() { return ws && ws.readyState === WebSocket.OPEN; }

  function connectWS() {
    if (!state.conversationId || !state.contactToken) return;
    if (ws && ws.readyState !== WebSocket.CLOSED) return; // already connected/connecting
    try {
      const u = `${cfg.wsBase}/ws/widget/conversations/${state.conversationId}?contact_token=${encodeURIComponent(state.contactToken)}`;
      ws = new WebSocket(u);
    } catch (e) {
      console.warn('[sloten-chat] ws construct failed:', e.message);
      startPolling();
      return;
    }
    ws.addEventListener('open', () => {
      // Fix 4: hide status entirely on successful connection. Only show it
      // when there's something the user needs to know (reconnecting / error).
      setStatus('');
      wsAttempt = 0;
      stopPolling();
    });
    ws.addEventListener('message', (ev) => {
      let f; try { f = JSON.parse(ev.data); } catch { return; }
      if (f.type === 'message.created' && f.message) {
        // Skip private notes — operator-only.
        if (f.message.is_private) return;
        renderMessage(f.message);
      } else if (f.type === 'conversation.updated' && f.conversation) {
        state.status = f.conversation.status;
        refreshConversation();
      }
    });
    ws.addEventListener('close', () => {
      setStatus('再接続待機中');
      startPolling();
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      try { ws.close(); } catch (_) {}
    });
  }

  function scheduleReconnect() {
    if (wsReconnectTimer) return;
    // Exponential backoff with cap: 3s -> 6s -> 12s -> ... up to 60s.
    // After 10 consecutive failures, stop trying; polling fallback continues.
    if (wsAttempt >= 10) return;
    const delay = Math.min(60000, 3000 * Math.pow(2, wsAttempt));
    wsAttempt++;
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      connectWS();
    }, delay);
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pollMessages, 5000);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  async function pollMessages() {
    if (!state.conversationId) return;
    try {
      const r = await api('GET', `/api/widget/conversations/${state.conversationId}/messages`);
      for (const m of (r.messages || [])) renderMessage(m);
      refreshConversation();
    } catch (_) { /* ignore */ }
  }

  // --- Lifecycle ---
  // Fix 12: Esc from anywhere closes the chat when the panel is open.
  // Fix 13: Tab cycling stays within the dialog for accessibility.
  function installGlobalKeyHandlers() {
    if (window.__slotenKeyInstalled) return;
    window.__slotenKeyInstalled = true;
    document.addEventListener('keydown', (e) => {
      if (dom.root.getAttribute('data-open') !== '1') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === 'Tab') {
        const focusables = dom.panel.querySelectorAll(
          'button:not([disabled]), [href], input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  async function open() {
    dom.root.setAttribute('data-open', '1');
    dom.input.focus();
    installGlobalKeyHandlers();
    if (!state.conversationId) {
      // Greet message only on fresh open. WS is deferred until first send
      // creates the conversation (ensureConversation calls connectWS).
      renderMessage({
        id: 'greet-' + Date.now(),
        sender_type: 'bot',
        content: 'こんにちは！ご質問やお困りごとをお書きください。',
        created_at: new Date().toISOString(),
      });
    } else {
      await loadHistory();
      await refreshConversation();
      connectWS();
    }
  }
  function close() {
    dom.root.setAttribute('data-open', '0');
    stopPolling();
  }

  // --- Dreampot live amount ---
  let dreampotTimer = null;
  async function refreshDreampot() {
    try {
      const r = await fetch(cfg.apiBase + '/api/public/jackpot', { credentials: 'omit' });
      const j = await r.json();
      if (j && j.success && Number.isFinite(j.amount)) {
        const t = document.getElementById('slc-dreampot-amount');
        if (t) t.textContent = '¥' + j.amount.toLocaleString('en-US');
      }
    } catch (_) { /* ignore transient errors */ }
  }

  async function init() {
    injectStyles();
    buildUI();
    refreshDreampot();
    if (dreampotTimer) clearInterval(dreampotTimer);
    dreampotTimer = setInterval(refreshDreampot, 60 * 1000);
    if (cfg.autoOpen) await open();
    if (state.conversationId) {
      // Resume on fresh page load: connect WS eagerly so operator replies
      // arrive even if the user hasn't opened the panel yet.
      connectWS();
    }
    setStatus('');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // Expose minimal API for host pages.
  window.SlotenChat = {
    version: 'v20260430.fix21',
    open,
    close,
    // Chatwoot parity: `window.$chatwoot.setUser(identifier, userInfo)`
    //   userInfo: { name, email, phone|phone_number, avatar_url, custom_attributes }
    // Safe to call before or after widget initialization. Before: held in
    // config and sent on first contact creation. After: PATCH to update.
    setUser,
    reset() {
      state.contactId = null;
      state.conversationId = null;
      localStorage.removeItem(STORAGE_KEY);
      dom.messages.querySelectorAll('.sloten-chat-msg').forEach((n) => n.remove());
    },
    getState() { return Object.assign({}, state); },
  };
})();
