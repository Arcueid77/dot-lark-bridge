import { BridgeError, plainText } from './common.js';
import { MAX_REPLY_TEXT } from './interaction-policy.js';

// Replies must not turn model-generated markup into notifications for people
// or an entire group. Incoming mentions are handled only by verified SDK IDs.
export function safeMarkdown(text){return text.replace(/<\s*\/?\s*at\b/gi,match=>match.replace('<','&lt;'));}
const INLINE_BYTES=18000;
export function needsReplyFile(text){return Buffer.byteLength(JSON.stringify({text:safeMarkdown(text)}),'utf8')>INLINE_BYTES;}
export function inlineText(text){
  if(!needsReplyFile(text))return safeMarkdown(text);
  const chars=Array.from(text),suffix='\n\n（完整回答将在完成后以 Markdown 文件附上。）';
  let low=0,high=chars.length;
  while(low<high){const mid=Math.ceil((low+high)/2),candidate=safeMarkdown(chars.slice(0,mid).join('')+suffix);if(Buffer.byteLength(JSON.stringify({text:candidate}),'utf8')<=INLINE_BYTES)low=mid;else high=mid-1;}
  return safeMarkdown(chars.slice(0,low).join('')+suffix);
}

export function cardDocument(text, state = 'complete') {
  plainText(text, MAX_REPLY_TEXT);
  const labels = { waiting: '已接收，等待处理', processing: '正在处理', generating: '正在生成', complete: '已完成', failed: '处理失败', expired: '处理已超时', uncertain: '发送结果不确定，请勿重复发送', cancelled: '处理已取消' };
  if (!Object.hasOwn(labels, state)) throw new BridgeError('Invalid card state');
  return { schema: '2.0', config: { update_multi: true, streaming_mode: !['complete','failed','expired','uncertain','cancelled'].includes(state), summary: { content: labels[state] } },
    body: { elements: [{ tag: 'markdown', element_id: 'answer', content: inlineText(text) }, { tag: 'markdown', element_id: 'status', content: labels[state], text_size: 'notation' }] } };
}
export function renderedReply(text, mode = 'text') {
  plainText(text, mode === 'text' ? MAX_REPLY_TEXT : MAX_REPLY_TEXT);
  if (mode === 'text') return { msg_type: 'text', content: JSON.stringify({ text:safeMarkdown(text) }) };
  if (mode === 'post') return { msg_type: 'post', content: JSON.stringify({ zh_cn: { title: '', content: [[{ tag: 'md', text:safeMarkdown(text) }]] } }) };
  if (mode === 'card') return { msg_type: 'interactive', content: JSON.stringify(cardDocument(text)) };
  throw new BridgeError('Invalid reply renderer');
}
