// ConversationRoom — Durable Object per conversation.
// Uses Hibernation WebSocket API so idle rooms don't accrue billing.
//
// Wire protocol (JSON frames, newline-terminated not required):
//   client -> server:  { type: 'hello', role: 'customer' | 'operator', conversation_id }
//   client -> server:  { type: 'ping' }  -> server replies with { type: 'pong' }
//   server -> client:  { type: 'message.created', message: {...} }
//   server -> client:  { type: 'conversation.updated', conversation: {...} }
//   server -> client:  { type: 'hello.ack', connection_id, connections }
//   server -> client:  { type: 'error', error: '...' }
//
// REST (Worker -> DO):
//   POST /broadcast  body { type, payload }   -> fans out to all connections
//   GET  /info                                 -> { connections, conversation_id }

export class ConversationRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.conversationId = null; // lazy-loaded on first WS or REST call
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.#handleUpgrade(request, url);
    }

    if (path === '/broadcast' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return new Response('Invalid JSON', { status: 400 }); }
      const sent = this.#broadcast(body);
      return Response.json({ success: true, sent });
    }

    if (path === '/info' && request.method === 'GET') {
      const sockets = this.state.getWebSockets();
      return Response.json({
        conversation_id: this.conversationId,
        connections: sockets.length,
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  async #handleUpgrade(request, url) {
    const conversationId = url.searchParams.get('conversation_id');
    const role = url.searchParams.get('role') || 'customer';
    if (!conversationId) return new Response('conversation_id required', { status: 400 });
    if (role !== 'customer' && role !== 'operator') {
      return new Response('invalid role', { status: 400 });
    }
    this.conversationId = conversationId;

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Hibernation: attach tags so we can identify role on wakeup.
    const connectionId = crypto.randomUUID();
    const tags = [`conv:${conversationId}`, `role:${role}`, `cid:${connectionId}`];
    this.state.acceptWebSocket(server, tags);

    // Send hello.ack synchronously — hibernation supports send() immediately after accept.
    try {
      server.send(JSON.stringify({
        type: 'hello.ack',
        connection_id: connectionId,
        conversation_id: conversationId,
        role,
        connections: this.state.getWebSockets().length,
      }));
    } catch (_) { /* noop */ }

    return new Response(null, { status: 101, webSocket: client });
  }

  // Hibernation callback — invoked for incoming client messages.
  async webSocketMessage(ws, message) {
    let msg;
    try { msg = typeof message === 'string' ? JSON.parse(message) : JSON.parse(new TextDecoder().decode(message)); }
    catch { try { ws.send(JSON.stringify({ type: 'error', error: 'invalid_json' })); } catch (_) {} return; }

    if (msg.type === 'ping') {
      try { ws.send(JSON.stringify({ type: 'pong', t: Date.now() })); } catch (_) {}
      return;
    }
    if (msg.type === 'hello') {
      // Client-initiated hello is informational in Phase 2-1 (tags already set at upgrade).
      try {
        ws.send(JSON.stringify({
          type: 'hello.ack',
          conversation_id: this.conversationId,
          connections: this.state.getWebSockets().length,
        }));
      } catch (_) {}
      return;
    }
    // Phase 2-1 does not accept message.send over WS — customers use REST POST.
    // Reserved for future: typing indicators, read receipts.
    try { ws.send(JSON.stringify({ type: 'error', error: `unknown_type:${msg.type}` })); } catch (_) {}
  }

  async webSocketClose(ws, code, reason, wasClean) {
    // Nothing to persist — hibernation API removes the socket automatically.
  }

  async webSocketError(ws, error) {
    // Best-effort log; do not throw.
    console.warn('[ConversationRoom] ws error', error?.message || error);
  }

  #broadcast(frame) {
    const text = JSON.stringify(frame);
    const sockets = this.state.getWebSockets();
    let sent = 0;
    for (const ws of sockets) {
      try { ws.send(text); sent++; }
      catch (_) { /* drop failed peer */ }
    }
    return sent;
  }
}
