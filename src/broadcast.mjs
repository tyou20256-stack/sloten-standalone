// Thin Worker-side helper to push events into a ConversationRoom DO.
// Best-effort — DB writes must not fail if broadcast does.

export async function broadcastToConversation(env, conversationId, frame) {
  if (!env.CONVERSATION_ROOM) return { sent: 0, skipped: 'no_binding' };
  try {
    const id = env.CONVERSATION_ROOM.idFromName(conversationId);
    const stub = env.CONVERSATION_ROOM.get(id);
    const r = await stub.fetch('https://do/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(frame),
    });
    if (!r.ok) return { sent: 0, skipped: `http_${r.status}` };
    return await r.json();
  } catch (e) {
    console.warn('[broadcast] failed:', e.message);
    return { sent: 0, skipped: 'exception' };
  }
}
