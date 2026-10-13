import { BridgeError, object, string } from './common.js';
import { readPrivateJson } from './private-files.js';
import { LARK_INPUT_LIMIT, LARK_REPLY_LIMIT, LARK_MEDIA_BYTES } from './tunnel-contract.js';

export const MAX_INPUT_TEXT = LARK_INPUT_LIMIT;
export const MAX_REPLY_TEXT = LARK_REPLY_LIMIT;
export const MAX_ATTACHMENT_BYTES = LARK_MEDIA_BYTES;
export const DEFAULT_INTERACTION = Object.freeze({ enabled: false, reactions: false, render: 'text', media: false, streaming: false, autoCard:false,botOpenId: '', groupMentions: Object.freeze({enabled:false,members:'owner',allowFrom:Object.freeze([]),replyInThread:false}), groups: Object.freeze([]) });

export function validateInteractionPolicy(value) {
  object(value, ['version', 'enabled', 'reactions', 'render', 'media', 'streaming','auto_card', 'bot_open_id', 'group_mentions', 'groups'], ['version']);
  if (value.version !== 1) throw new BridgeError('Unsupported interaction policy');
  for (const field of ['enabled', 'reactions', 'media', 'streaming','auto_card']) if (value[field] !== undefined && typeof value[field] !== 'boolean') throw new BridgeError('Invalid interaction setting');
  const policy = { ...DEFAULT_INTERACTION, enabled: value.enabled ?? true, reactions: value.reactions ?? false, render: value.render ?? 'post', media: value.media ?? false, streaming: value.streaming ?? false, botOpenId: value.bot_open_id ?? '', groups: [] };
  policy.autoCard=value.auto_card??policy.streaming;
  if (!['text', 'post', 'card'].includes(policy.render)) throw new BridgeError('Invalid reply renderer');
  if (policy.botOpenId) string(policy.botOpenId, 256);
  if(value.group_mentions!==undefined){
    const g=value.group_mentions;object(g,['enabled','members','allow_from','reply_in_thread','context_scope'],['enabled','members']);
    if(typeof g.enabled!=='boolean'||!['owner','allowlist','all'].includes(g.members)||(g.reply_in_thread!==undefined&&typeof g.reply_in_thread!=='boolean'))throw new BridgeError('Invalid global mention policy');
    const allowFrom=g.allow_from??[];if(!Array.isArray(allowFrom)||allowFrom.length>100)throw new BridgeError('Invalid global mention allowlist');for(const id of allowFrom)string(id,256);
    if(new Set(allowFrom).size!==allowFrom.length||(g.members==='allowlist'&&!allowFrom.length)||(g.members!=='allowlist'&&allowFrom.length))throw new BridgeError('Invalid global mention allowlist');
    if(g.enabled&&!policy.botOpenId)throw new BridgeError('Exact bot identity required for mentions');
    if(g.context_scope!==undefined&&!['sender','group'].includes(g.context_scope))throw new BridgeError('Invalid mention context scope');
    policy.groupMentions=Object.freeze({enabled:g.enabled,members:g.members,allowFrom:Object.freeze([...allowFrom]),replyInThread:g.reply_in_thread??false,contextScope:g.context_scope??'sender'});
  }
  if (value.groups !== undefined && (!Array.isArray(value.groups) || value.groups.length > 50)) throw new BridgeError('Invalid group policies');
  const seen = new Set();
  for (const group of value.groups ?? []) {
    object(group, ['chat_id', 'enabled', 'members', 'allow_from', 'mention', 'auto_reply', 'keywords', 'reply_in_thread','context_scope'], ['chat_id', 'members', 'auto_reply']);
    string(group.chat_id, 256);
    if (seen.has(group.chat_id)) throw new BridgeError('Duplicate group policy');
    seen.add(group.chat_id);
    if (!['owner', 'allowlist', 'all'].includes(group.members) || !['off', 'all', 'keywords'].includes(group.auto_reply)) throw new BridgeError('Invalid group trigger');
    for (const key of ['enabled', 'mention', 'reply_in_thread']) if (group[key] !== undefined && typeof group[key] !== 'boolean') throw new BridgeError('Invalid group setting');
    const allowFrom = group.allow_from ?? [], keywords = group.keywords ?? [];
    if (!Array.isArray(allowFrom) || allowFrom.length > 100 || !Array.isArray(keywords) || keywords.length > 50) throw new BridgeError('Invalid bounded group list');
    for (const sender of allowFrom) string(sender, 256);
    for (const keyword of keywords) { string(keyword, 100); if (!keyword.trim()) throw new BridgeError('Empty keyword'); }
    if (new Set(allowFrom).size !== allowFrom.length || new Set(keywords).size !== keywords.length) throw new BridgeError('Duplicate group list item');
    if (group.members === 'allowlist' && !allowFrom.length) throw new BridgeError('Empty member allowlist');
    if (group.members !== 'allowlist' && allowFrom.length) throw new BridgeError('Unused member allowlist');
    if (group.auto_reply === 'keywords' && !keywords.length) throw new BridgeError('Empty trigger keywords');
    if (group.auto_reply !== 'keywords' && keywords.length) throw new BridgeError('Unused trigger keywords');
    const mention = group.mention ?? true;
    if (mention && !policy.botOpenId) throw new BridgeError('Exact bot identity required for mentions');
    if(group.context_scope!==undefined&&!['sender','group'].includes(group.context_scope))throw new BridgeError('Invalid group context scope');
    policy.groups.push({ chatId: group.chat_id, enabled: group.enabled ?? true, members: group.members, allowFrom:[...allowFrom], mention, autoReply: group.auto_reply, keywords:[...keywords], replyInThread: group.reply_in_thread ?? false, contextScope:group.context_scope??'sender' });
  }
  if (!policy.enabled && (policy.groups.length || policy.groupMentions.enabled || policy.reactions || policy.media || policy.streaming)) throw new BridgeError('Disabled interaction policy cannot enable features');
  if (policy.streaming && policy.render !== 'card') throw new BridgeError('Streaming requires card rendering');
  if(policy.autoCard&&!policy.streaming)throw new BridgeError('Automatic status cards require card streaming');
  for(const group of policy.groups){Object.freeze(group.allowFrom);Object.freeze(group.keywords);Object.freeze(group);}Object.freeze(policy.groups);return Object.freeze(policy);
}
export function loadInteractionPolicy(file) { return file ? validateInteractionPolicy(readPrivateJson(file)) : Object.freeze({ ...DEFAULT_INTERACTION, groups: Object.freeze([]) }); }
export function groupPolicy(config, chatId, botMentioned=false) {
  if(!config.interaction?.enabled)return undefined;
  const explicit=config.interaction.groups.find(group=>group.chatId===chatId);if(explicit)return explicit.enabled?explicit:undefined;
  const global=config.interaction.groupMentions;if(!botMentioned||!global?.enabled)return undefined;
  return {chatId,enabled:true,members:global.members,allowFrom:global.allowFrom,mention:true,autoReply:'off',keywords:[],replyInThread:global.replyInThread,contextScope:global.contextScope??'sender'};
}
export function senderAllowed(config, group, sender) { return !!group && (group.members === 'all' || (group.members === 'owner' ? sender === config.ownerOpenId : group.allowFrom.includes(sender))); }
export function routeAllowed(config, message) {
  if (message.tenant_key !== config.tenantKey) return false;
  const kind = message.chat_type ?? 'p2p';
  if (kind === 'p2p') return message.owner === config.ownerOpenId && message.chat_id === config.ownerChatId;
  return kind === 'group' && senderAllowed(config, groupPolicy(config, message.chat_id,message.bot_mentioned===true), message.owner);
}
