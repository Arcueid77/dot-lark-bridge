import { BridgeError, hash } from './common.js';
import { routeAllowed, groupPolicy } from './interaction-policy.js';

export function initializeConversationStore(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS message_details(message_id TEXT PRIMARY KEY REFERENCES messages(id),payload TEXT);
    CREATE TABLE IF NOT EXISTS reply_details(message_id TEXT PRIMARY KEY REFERENCES messages(id),payload TEXT);
    CREATE TABLE IF NOT EXISTS feedback(message_id TEXT PRIMARY KEY REFERENCES messages(id),payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',next_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,lease_until INTEGER,lease_token TEXT);
    CREATE TABLE IF NOT EXISTS reply_streams(message_id TEXT PRIMARY KEY REFERENCES messages(id),payload TEXT NOT NULL,state TEXT NOT NULL,sequence INTEGER NOT NULL DEFAULT 0,applied_sequence INTEGER NOT NULL DEFAULT -1);
    CREATE TABLE IF NOT EXISTS reply_chunks(message_id TEXT NOT NULL REFERENCES messages(id),sequence INTEGER NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(message_id,sequence));`);
}
export function details(store, id) {
  const row = store.get('SELECT payload FROM message_details WHERE message_id=?', id);
  return row?.payload ? store.vault.open(row.payload, `details:${id}`) : { chat_type: 'p2p', reply_in_thread: false, attachments: [], quote_id: null };
}
export function saveDetails(store, message, now) {
  const value = { chat_type: message.chatType ?? 'p2p', reply_in_thread: message.replyInThread ?? false, attachments: message.attachments ?? [], quote_id: message.quoteId ?? null,bot_mentioned:message.botMentioned===true,notice:message.notice??null };
  store.run('INSERT INTO message_details VALUES (?,?)', message.id, store.vault.seal(value, `details:${message.id}`));
  if ((store.config.interaction?.reactions||store.config.interaction?.streaming)&&!message.notice) store.run('INSERT INTO feedback(message_id,payload,next_at) VALUES (?,?,?)', message.id, store.vault.seal({ reactionId: null, applied: null, uncertain: false }, `feedback:${message.id}`), now);
}
export function conversationReference(config, message) {
  const perSender = message.chat_type === 'group' && groupPolicy(config,message.chat_id,message.bot_mentioned)?.contextScope !== 'group';
  return hash(`${config.larkAppId}:${message.chat_type ?? 'p2p'}:${message.chat_id}${perSender?':'+message.owner:''}`).slice(0,32);
}
export function messageContext(store, source, now, limit = 6) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new BridgeError('Invalid context limit');
  const sourceRow=store.get('SELECT rowid AS ordinal FROM messages WHERE id=?',source.id).ordinal;
  const rows = store.all('SELECT * FROM messages WHERE principal=? AND tenant_key=? AND chat_id=? AND (received<? OR (received=? AND rowid<=?)) AND text IS NOT NULL ORDER BY received DESC,rowid DESC LIMIT 100', source.principal, source.tenant_key, source.chat_id, source.received,source.received,sourceRow);
  const items = []; let length = 0;
  for (const row of rows) {
    const route = { ...row, ...details(store, row.id) };
    if (route.chat_type !== source.chat_type || !routeAllowed(store.config, route) || conversationReference(store.config,route)!==conversationReference(store.config,source)) continue;
    const text = store.vault.open(row.text, `message:${row.id}`);
    const reply = store.replyText(row.id);
    if (length + text.length + (reply?.length ?? 0) > 30000) break;
    length += text.length + (reply?.length ?? 0);
    items.push({ message_id: row.id, timestamp: row.occurred_at, text, reply: reply ?? null, is_source: row.id === source.id });
    if (items.length >= limit) break;
  }
  return { message_id: source.id, context_key: conversationReference(store.config, source), messages: items.reverse() };
}
