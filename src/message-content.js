import { BridgeError, object, plainText, string } from './common.js';
import { MAX_INPUT_TEXT } from './interaction-policy.js';

const resourceKey = value => { string(value, 256); if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new BridgeError('Invalid attachment key'); return value; };
function attachment(type, key, name = '') { if (name) string(name, 256); return { type, key: resourceKey(key), name }; }
export function parseMessageContent(message, config) {
  const enabled = config.interaction?.enabled === true;
  if (!enabled && (message.message_type !== 'text' || message.root_id || message.parent_id || message.mentions?.length)) return null;
  if(enabled&&typeof message.content==='string'&&message.content.length>200000)return{text:'消息内容过长，目前最多支持 20000 长度的文字。请拆成几条发送。',attachments:[],quoteId:null,notice:'too_long'};
  let data;
  try { data = JSON.parse(string(message.content, enabled ? 200000 : 10000)); } catch { throw new BridgeError('Invalid Feishu content'); }
  const attachments = []; let text = '';
  switch (message.message_type) {
    case 'text': object(data, ['text'], ['text']); text = data.text; break;
    case 'post': {
      if (!enabled) return null;
      const post = data.content ? data : data.zh_cn ?? data.en_us ?? Object.values(data)[0];
      if (!post || !Array.isArray(post.content) || post.content.length > 1000) throw new BridgeError('Invalid rich text');
      const lines = []; if (post.title) lines.push(string(post.title, 1000));
      let nodes = 0;
      for (const line of post.content) {
        if (!Array.isArray(line)) throw new BridgeError('Invalid rich text line');
        let part = '';
        for (const node of line) {
          if (++nodes > 2000 || !node || typeof node.tag !== 'string') throw new BridgeError('Rich text too large');
          if (['text', 'md', 'code_block'].includes(node.tag)) part += typeof node.text === 'string' ? node.text : '';
          else if (node.tag === 'a') part += typeof node.text === 'string' ? node.text : '';
          else if (node.tag === 'at') part += '@' + (typeof node.user_name === 'string' ? node.user_name : '成员');
          else if (node.tag === 'img' && config.interaction.media) { attachments.push(attachment('image', node.image_key)); part += '[图片]'; }
        }
        lines.push(part);
      }
      text = lines.join('\n'); break;
    }
    case 'image': if (!enabled || !config.interaction.media) return null; attachments.push(attachment('image', data.image_key)); text = '[图片]'; break;
    case 'file': if (!enabled || !config.interaction.media) return null; attachments.push(attachment('file', data.file_key, data.file_name ?? '')); text = '[文件]' + (data.file_name ?? ''); break;
    case 'audio': if (!enabled || !config.interaction.media) return null; attachments.push(attachment('audio', data.file_key)); text = '[语音]'; break;
    default: return enabled?{text:'目前支持文字、富文本、图片、文件和语音；这条消息类型暂不支持。',attachments:[],quoteId:null,notice:'unsupported'}:null;
  }
  if (attachments.length > 10) throw new BridgeError('Too many attachments');
  if(enabled&&typeof text==='string'&&text.length>MAX_INPUT_TEXT)return{text:'消息内容过长，目前最多支持 20000 长度的文字。请拆成几条发送。',triggerText:text.slice(0,MAX_INPUT_TEXT),attachments:[],quoteId:null,notice:'too_long'};
  plainText(text, enabled ? MAX_INPUT_TEXT : 2000);
  return { text, attachments, quoteId: message.parent_id ? string(message.parent_id, 256) : null };
}
export function groupTriggered(message, parsed, policy, botOpenId) {
  const mentions = message.mentions ?? [];
  if (!Array.isArray(mentions) || mentions.length > 100) throw new BridgeError('Invalid mentions');
  const botMentions = mentions.filter(mention => mention?.id?.open_id === botOpenId && botOpenId);
  parsed.botMentioned=botMentions.length>0;
  const mentioned = policy.mention && botMentions.length > 0;
  if (!mentioned && policy.autoReply !== 'all' && !(policy.autoReply === 'keywords' && policy.keywords.some(keyword => (parsed.triggerText??parsed.text).toLocaleLowerCase().includes(keyword.toLocaleLowerCase())))) return false;
  delete parsed.triggerText;
  for (const mention of botMentions) if (typeof mention.key === 'string' && mention.key) parsed.text = parsed.text.split(mention.key).join('').trim();
  if (!parsed.text) parsed.text = '[提及机器人]';
  return true;
}
