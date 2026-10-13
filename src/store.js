import { ownerScopedProxy, assertCallbackMode } from './callback-mode.js';
import { validateLiveConfig } from './live-validation.js';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BridgeError, canonical, hash } from './common.js';
import { Vault } from './signatures.js';
import { windowsPrivateDatabase, windowsPrivateDirectory } from '../../dot-qq-bridge/packages/dot-bridge-platform/index.js';
import { routeAllowed } from './interaction-policy.js';
import { initializeConversationStore, details, saveDetails } from './conversation-store.js';
import { createStreamRows, finalizeStream } from './interaction-state.js';
import {needsReplyFile,inlineText} from './reply-renderer.js';

export class Store {
  constructor(config) {
    assertCallbackMode(config);validateLiveConfig(config);
    this.config = config;
    this.vault = new Vault(config.storageKey);
    if (config.dbPath !== ':memory:' && process.platform === 'win32') {
      if (config.authMode !== 'tunnel-service') windowsPrivateDirectory(path.dirname(config.dbPath), { create: true }).close();
      this.privatePath = windowsPrivateDatabase(config.dbPath, { create: true });
    } else if (config.dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(config.dbPath), { recursive: true, mode: 0o700 });
      if (!fs.existsSync(config.dbPath)) fs.closeSync(fs.openSync(config.dbPath, 'wx', 0o600));
    }
    try { this.db = new DatabaseSync(this.privatePath?.path ?? config.dbPath); }
    catch (error) { this.privatePath?.close(); throw error; }
    try {
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY, principal TEXT NOT NULL, callback TEXT NOT NULL, expires INTEGER NOT NULL,
        verified_until INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, generation TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, source_event_id TEXT NOT NULL UNIQUE, event_id TEXT NOT NULL UNIQUE,
        principal TEXT NOT NULL, owner TEXT NOT NULL, subscription_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL, expires INTEGER NOT NULL, received INTEGER NOT NULL, text TEXT,
        outbound_id TEXT, attempted_at INTEGER, tenant_key TEXT NOT NULL, chat_id TEXT NOT NULL, generation TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS replies (
        message_id TEXT PRIMARY KEY REFERENCES messages(id), digest TEXT NOT NULL, text TEXT,
        created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, message_id TEXT NOT NULL REFERENCES messages(id),
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id), state TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, lease_until INTEGER,
        lease_token TEXT, last_error TEXT);
      CREATE INDEX IF NOT EXISTS due_jobs ON jobs(state,next_at);
      CREATE TABLE IF NOT EXISTS replays (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rates (kind TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS rate_window ON rates(kind,at);`);
      const check = this.get('SELECT value FROM metadata WHERE key=?', 'vault');
      if (check) this.vault.open(check.value, 'metadata');
      else this.run('INSERT INTO metadata VALUES (?,?)', 'vault', this.vault.seal({ version: 1 }, 'metadata'));
      const mode = config.bridgeMode ?? 'tunnel';
      const storedMode = this.get('SELECT value FROM metadata WHERE key=?', 'bridge_mode');
      if (storedMode && storedMode.value !== mode) throw new Error('Database bridge mode differs; explicit migration required');
      if (!storedMode && mode === 'sites' && this.get('SELECT count(*) AS n FROM messages').n) throw new Error('Legacy tunnel messages require explicit migration');
      if (!storedMode) this.run('INSERT INTO metadata VALUES (?,?)', 'bridge_mode', mode);
      const callbackMode=config.callbackTransportMode??'standard',storedCallbackMode=this.get('SELECT value FROM metadata WHERE key=?','callback_transport_mode');
      if(storedCallbackMode&&storedCallbackMode.value!==callbackMode)throw new Error('Stored callback mode differs; explicit migration required');
      if(!storedCallbackMode&&callbackMode==='owner-scoped-proxy'&&(this.get('SELECT count(*) AS n FROM messages').n||this.get('SELECT value FROM metadata WHERE key=?','owner_single_message:v1')))throw new Error('Use a separate formal owner database');
      const binding = canonical({ app: config.larkAppId, owner: config.ownerOpenId, tenant: config.tenantKey, chat: config.ownerChatId, principal: config.principal });
      const existing = this.get('SELECT value FROM metadata WHERE key=?', 'binding');
      if (existing && existing.value !== binding) throw new Error('Stored owner/AppID/principal binding differs; do not reuse this database for a different identity');
      if (!existing && config.larkAppId && config.ownerOpenId && config.tenantKey && config.ownerChatId && config.principal) this.run('INSERT INTO metadata VALUES (?,?)', 'binding', binding);
      if(!storedCallbackMode)this.run('INSERT INTO metadata VALUES (?,?)','callback_transport_mode',callbackMode);
      initializeConversationStore(this);
    } catch (error) { try { this.db.close(); } finally { this.privatePath?.close(); } throw error; }
  }
  get(sql, ...params) { return this.db.prepare(sql).get(...params); }
  all(sql, ...params) { return this.db.prepare(sql).all(...params); }
  run(sql, ...params) { return this.db.prepare(sql).run(...params); }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  subscription(id) {
    const row = this.get('SELECT * FROM subscriptions WHERE id=?', id);
    return row ? { ...row, ...this.vault.open(row.callback, `subscription:${id}`), scope: this.get('SELECT value FROM metadata WHERE key=?', `subscription_scope:${id}`)?.value ?? 'owner' } : undefined;
  }
  activeSubscription(now) {
    const row = this.get('SELECT id FROM subscriptions WHERE active=1 AND expires>? AND principal=?', now, this.config.principal);
    return row ? this.subscription(row.id) : undefined;
  }
  subscriptionEpoch(id) {
    return Number(this.get('SELECT value FROM metadata WHERE key=?', `subscription_epoch:${id}`)?.value ?? 0);
  }
  saveSubscription(subscription, now) {
    return this.tx(() => {
      if (subscription.expectedEpoch !== undefined && this.subscriptionEpoch(subscription.id) !== subscription.expectedEpoch) {
        throw new BridgeError('Subscription revoked during verification', { code: -32012 });
      }
      const other = this.get('SELECT id FROM subscriptions WHERE active=1 AND expires>? AND id<>?', now, subscription.id);
      if (other) throw new BridgeError('Only one current-dot subscription is allowed', { code: -32013, data: { limit: 'subscriptions', max: 1 } });
      const callback = this.vault.seal({ url: subscription.url, secret: subscription.secret,
        oldSecret: subscription.oldSecret ?? null, oldSecretUntil: subscription.oldSecretUntil ?? 0 }, `subscription:${subscription.id}`);
      const prior = this.get('SELECT active,expires,generation FROM subscriptions WHERE id=?', subscription.id);
      const generation = prior?.active && prior.expires > now ? prior.generation : randomUUID();
      this.run(`INSERT INTO subscriptions(id,principal,callback,expires,verified_until,active,generation) VALUES (?,?,?,?,?,1,?)
        ON CONFLICT(id) DO UPDATE SET callback=excluded.callback,expires=excluded.expires,verified_until=excluded.verified_until,active=1,generation=excluded.generation`,
        subscription.id, subscription.principal, callback, subscription.expires, subscription.verified_until, generation);
      this.run('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', `subscription_scope:${subscription.id}`, subscription.scope ?? 'owner');
    });
  }
  unsubscribe(id) {
    this.tx(() => {
      this.run(`INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        `subscription_epoch:${id}`, String(this.subscriptionEpoch(id) + 1));
      this.run('UPDATE subscriptions SET active=0 WHERE id=? AND principal=?', id, this.config.principal);
      this.run("UPDATE jobs SET state='cancelled',last_error='unsubscribed',lease_token=NULL WHERE subscription_id=? AND state IN ('pending','processing')", id);
    });
  }
  rate(kind, limit, now) {
    this.run('DELETE FROM rates WHERE at<=?', now - 60000);
    const count = this.get('SELECT count(*) AS n FROM rates WHERE kind=? AND at>?', kind, now - 60000).n;
    if (count >= limit) throw new BridgeError('Rate limit reached', { status: 429, code: -32013, retryable: true, data: { limit: kind, max: limit } });
    this.run('INSERT INTO rates VALUES (?,?)', kind, now);
  }
  capacity() {
    const sql=this.config.interaction?.enabled?"SELECT count(*) AS n FROM jobs WHERE state IN ('pending','processing') AND kind IN ('event','reply','notice')":"SELECT count(*) AS n FROM jobs WHERE state IN ('pending','processing')";
    if (this.get(sql).n >= this.config.queueLimit) {
      throw new BridgeError('Queue capacity reached', { status: 503, code: -32013, retryable: true, data: { limit: 'queue', max: this.config.queueLimit } });
    }
  }
  ingest(message, replayId, now) {
    return this.tx(() => {
      this.run('DELETE FROM replays WHERE expires<?', now);
      if (this.get('SELECT id FROM replays WHERE id=?', replayId) || this.get('SELECT id FROM messages WHERE id=? OR source_event_id=?', message.id, message.sourceEventId)) return 'duplicate';
      const subscription = this.activeSubscription(now);
      if (!subscription) throw new BridgeError('No active current-dot subscription', { status: 503 });
      if (message.chatType === 'group' && subscription.scope !== 'configured') return 'ignored';
      this.capacity();
      // Enhanced mode acknowledges only durable receipt, then rate-limits the
      // callback worker. A burst is queued instead of silently losing messages.
      if(!this.config.interaction?.enabled)this.rate('inbound', this.config.inboundPerMinute, now);
      const eventId = `evt_${hash(`${this.config.larkAppId}:${message.id}`)}`;
      this.run(`INSERT INTO messages(id,source_event_id,event_id,principal,owner,subscription_id,occurred_at,expires,received,text,tenant_key,chat_id,generation)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, message.id, message.sourceEventId, eventId, this.config.principal,
        message.owner, subscription.id, message.timestamp, message.expires, now, this.vault.seal(message.text, `message:${message.id}`),
        message.tenantKey, message.chatId, subscription.generation);
      if(message.notice){
        if(!this.config.interaction?.enabled||!['unsupported','too_long'].includes(message.notice))throw new BridgeError('Invalid message notice');
        this.run('INSERT INTO replies VALUES (?,?,?,?)',message.id,hash(message.text),this.vault.seal(message.text,`reply:${message.id}`),now);
        this.run('INSERT INTO jobs(id,kind,message_id,subscription_id,next_at) VALUES (?,?,?,?,?)',`notice:${message.id}`,'notice',message.id,subscription.id,now);
      }else this.run('INSERT INTO jobs(id,kind,message_id,subscription_id,next_at) VALUES (?,?,?,?,?)', `event:${eventId}`, 'event', message.id, subscription.id, now);
      saveDetails(this, message, now);
      if(this.config.interaction?.autoCard&&!message.notice)createStreamRows(this,message.id,now);
      this.run('INSERT INTO replays VALUES (?,?)', replayId, now + 600000);
      return 'queued';
    });
  }
  message(id) {
    const row = this.get('SELECT * FROM messages WHERE id=?', id);
    return row ? { ...row, ...details(this, id), text: row.text ? this.vault.open(row.text, `message:${id}`) : null } : undefined;
  }
  authorizeMessage(id, principal, now) {
    const message = this.message(id), subscription = message && this.subscription(message.subscription_id);
    if (!message || message.principal !== principal || !routeAllowed(this.config, message) || !subscription?.active ||
        subscription.expires <= now || subscription.principal !== principal || message.generation !== subscription.generation ||
        (message.chat_type === 'group' && subscription.scope !== 'configured') || !message.attempted_at) {
      throw new BridgeError('Message unavailable to this subscription', { code: -32012 });
    }
    return message;
  }
  pendingMessages(principal, now, limit = 10) {
    if(principal!==this.config.principal||!Number.isInteger(limit)||limit<1||limit>10)throw new BridgeError('Pending message scope refused',{code:-32012});
    const subscription=this.activeSubscription(now);if(!subscription)return [];
    const rows = this.all(`SELECT m.*,COALESCE(j.state,'none') AS reply_status
      FROM messages m LEFT JOIN jobs j ON j.id=('reply:'||m.id) AND j.kind='reply'
      WHERE m.principal=? AND m.tenant_key=? AND m.subscription_id=? AND m.generation=?
        AND m.attempted_at IS NOT NULL AND m.expires>? AND COALESCE(j.state,'none') IN ('none','pending','processing')
      ORDER BY m.received,m.rowid LIMIT 1000`,principal,this.config.tenantKey,subscription.id,subscription.generation,now);
    return rows.filter(row => { const route = { ...row, ...details(this, row.id) }; return routeAllowed(this.config, route) && (route.chat_type !== 'group' || subscription.scope === 'configured') && ['none','pending','processing'].includes(this.replyStatus(row.id).status); }).slice(0,limit)
      .map(row=>({message_id:row.id,reply_deadline:new Date(row.expires).toISOString(),reply_status:this.replyStatus(row.id).status}));
  }
  queueReply(id, text, principal, now, plan = null) {
    return this.tx(() => {
      const message = this.authorizeMessage(id, principal, now);
      const digest=hash(plan?canonical(plan):text);
      const previous = this.get('SELECT digest FROM replies WHERE message_id=?', id);
      if (previous) {
        if (previous.digest !== digest) throw new BridgeError('This message already has a different reply');
        return this.replyStatus(id);
      }
      if (message.expires <= now) throw new BridgeError('Bridge reply deadline expired');
      const stream=this.get('SELECT state FROM reply_streams WHERE message_id=?',id);
      if(stream&&['uncertain','failed','cancelled','expired','complete'].includes(stream.state))throw new BridgeError('Reply card cannot accept another answer');
      this.capacity();
      if(!plan&&this.config.interaction?.enabled&&needsReplyFile(text)){
        if(!this.config.interaction.media)throw new BridgeError('Long answers require media support; provide a shorter answer');
        plan={type:'file',name:'完整回复.md',mimeType:'text/markdown',data:Buffer.from(text,'utf8').toString('base64'),caption:inlineText(text).replace('将在完成后','已')};
      }
      this.run('INSERT INTO replies VALUES (?,?,?,?)', id, digest, this.vault.seal(text, `reply:${id}`), now);
      if(plan)this.run('INSERT INTO reply_details VALUES (?,?)',id,this.vault.seal(plan,`reply-details:${id}`));
      else finalizeStream(this,id,text,now);
      this.run('INSERT INTO jobs(id,kind,message_id,subscription_id,next_at) VALUES (?,?,?,?,?)', `reply:${id}`, 'reply', id, message.subscription_id, now);
      return this.replyStatus(id);
    });
  }
  replyStatus(id) {
    const row = this.get("SELECT state,last_error FROM jobs WHERE id=? AND kind='reply'", `reply:${id}`);
    const stream=!row?this.get('SELECT state,payload FROM reply_streams WHERE message_id=?',id):null;
    const notice=!row?this.get("SELECT state,last_error FROM jobs WHERE id=? AND kind='notice'",`notice:${id}`):null;
    const terminal={uncertain:'uncertain',failed:'dead',cancelled:'cancelled',expired:'expired'};
    const started=stream&&!terminal[stream.state]&&this.vault.open(stream.payload,`stream:${id}`).modelStarted;
    return { message_id: id, status: row?.state ?? notice?.state ?? terminal[stream?.state] ?? (started?'processing':'none'), error: row?.last_error ?? notice?.last_error ?? (terminal[stream?.state]?'reply_card_terminal':null) };
  }
  claim(now) {
    return this.tx(() => {
      // A crashed event delivery can be retried by eventId. A crashed Feishu reply is ambiguous.
      this.run("UPDATE jobs SET state='uncertain',last_error='worker_interrupted' WHERE kind='reply' AND state='processing' AND lease_until<=?", now);
      this.run("UPDATE jobs SET state='uncertain',last_error='worker_interrupted' WHERE kind='notice' AND state='processing' AND lease_until<=?", now);
      this.run("UPDATE reply_streams SET state='uncertain' WHERE message_id IN (SELECT message_id FROM jobs WHERE kind='stream' AND state='processing' AND lease_until<=?)",now);
      this.run("UPDATE jobs SET state='uncertain',last_error='worker_interrupted',lease_token=NULL WHERE kind='stream' AND state='processing' AND lease_until<=?",now);
      if(ownerScopedProxy(this.config))this.run("UPDATE jobs SET state='uncertain',last_error='worker_interrupted',lease_token=NULL WHERE kind='event' AND state='processing' AND lease_until<=?",now);
      else this.run("UPDATE jobs SET state='pending',lease_token=NULL WHERE kind='event' AND state='processing' AND lease_until<=?",now);
      const job = this.get("SELECT * FROM jobs WHERE state='pending' AND next_at<=? ORDER BY next_at,rowid LIMIT 1", now);
      if (!job) return undefined;
      const token = randomUUID();
      this.run("UPDATE jobs SET state='processing',attempts=attempts+1,lease_until=?,lease_token=? WHERE id=?", now + this.config.leaseMs, token, job.id);
      return { ...job, attempts: job.attempts + 1, lease_token: token };
    });
  }
  finish(job, state, reason = null, next = 0, { resetAttempts = false } = {}) {
    this.run("UPDATE jobs SET state=?,last_error=?,next_at=?,attempts=CASE WHEN ? THEN 0 ELSE attempts END,lease_until=NULL,lease_token=NULL WHERE id=? AND lease_token=? AND state='processing'", state, reason, next, resetAttempts ? 1 : 0, job.id, job.lease_token);
  }
  recordEventUncertain(job) {
    // Revocation can stop future work but cannot undo a callback already on wire.
    this.run("UPDATE jobs SET state='uncertain',last_error='delivery_uncertain',lease_until=NULL,lease_token=NULL WHERE id=? AND kind='event' AND attempts=? AND ((state='processing' AND lease_token=?) OR state='cancelled')",job.id,job.attempts,job.lease_token);
  }
  replyText(id) {
    const row = this.get('SELECT text FROM replies WHERE message_id=?', id);
    return row?.text ? this.vault.open(row.text, `reply:${id}`) : null;
  }
  recordReplyAck(job, outboundId) {
    // Revocation cannot undo an HTTP request already on the wire. Record its
    // positive acknowledgement even if unsubscribe cancelled the local lease.
    this.tx(() => {
      this.run('UPDATE messages SET outbound_id=? WHERE id=?', outboundId, job.message_id);
      this.run("UPDATE jobs SET state='sent',last_error=NULL,lease_until=NULL,lease_token=NULL WHERE id=? AND kind='reply'", job.id);
    });
  }
  prune(now) {
    this.tx(() => {
      const cutoff = now - this.config.textRetentionMs;
      this.run('UPDATE messages SET text=NULL WHERE received<? AND expires<=?', cutoff, now);
      this.run('UPDATE message_details SET payload=NULL WHERE message_id IN (SELECT id FROM messages WHERE received<? AND expires<=?)',cutoff,now);
      this.run('UPDATE reply_details SET payload=NULL WHERE message_id IN (SELECT id FROM messages WHERE received<? AND expires<=?)',cutoff,now);
      for(const row of this.all('SELECT s.message_id,s.payload FROM reply_streams s JOIN messages m ON m.id=s.message_id WHERE m.received<? AND m.expires<=?',cutoff,now)){
        const payload=this.vault.open(row.payload,`stream:${row.message_id}`);
        if(payload.phase!=='pruned'){payload.text='';payload.phase='pruned';this.run('UPDATE reply_streams SET payload=? WHERE message_id=?',this.vault.seal(payload,`stream:${row.message_id}`),row.message_id);}
      }
      // A shorter retention setting must not truncate a previously stored reply
      // window. Its original message expiry remains authoritative after restart.
      this.run(`UPDATE replies SET text=NULL WHERE created<? AND EXISTS
        (SELECT 1 FROM messages WHERE messages.id=replies.message_id AND messages.expires<=?)`, cutoff, now);
      // Tombstones intentionally survive text deletion to preserve durable deduplication.
      this.run('DELETE FROM replays WHERE expires<?', now);
      this.run('DELETE FROM rates WHERE at<=?', now - 60000);
    });
  }
  close() { try { this.db.close(); } finally { this.privatePath?.close(); } }
}
