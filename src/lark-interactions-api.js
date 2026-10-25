import { randomBytes } from 'node:crypto';
import { BridgeError, hash, string } from './common.js';
import { FEISHU_ORIGIN, replyUuid } from './lark.js';
import { cardDocument } from './reply-renderer.js';
import { MAX_ATTACHMENT_BYTES } from './interaction-policy.js';
import {opusAudio} from './media-process.js';
import {parseMessageContent} from './message-content.js';

const segment = value => encodeURIComponent(string(value,256));
export function createInteractionsApi(config, send, sender, clock = Date.now) {
  async function request(path, data, { authorize=()=>{},method='POST',mutation=true,resource=false,missing=false }={}) {
    authorize();const token=await sender.token(authorize);authorize();
    let response;
    try { response=await (resource ? send.resourceRequester ?? send : send)(`${FEISHU_ORIGIN}/open-apis/${path}`, {purpose:'provider',hosts:['open.feishu.cn'],method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Accept-Encoding':'identity'},body:data===undefined?Buffer.alloc(0):Buffer.from(JSON.stringify(data)),beforeConnect:authorize}); }
    catch(error) { if(error instanceof BridgeError&&error.code===-32012)throw error;throw new BridgeError(mutation?'Feishu interaction acknowledgement unknown':'Feishu resource request failed',{uncertain:mutation,retryable:!mutation}); }
    if(response.status===401){sender.invalidate();throw new BridgeError('Feishu authentication rejected',{retryable:true});}
    if(missing&&response.status===404)return null;
    if(response.status===429)throw new BridgeError('Feishu rate limited',{retryable:true});
    if(response.status>=500)throw new BridgeError('Feishu interaction acknowledgement unknown',{uncertain:mutation,retryable:!mutation});
    if(response.status<200||response.status>=300)throw new BridgeError('Feishu interaction rejected');
    if(resource)return response;
    let value;try{value=JSON.parse(response.body.toString('utf8'));}catch{throw new BridgeError('Feishu interaction acknowledgement unknown',{uncertain:mutation});}
    if(!Number.isInteger(value?.code))throw new BridgeError('Feishu interaction acknowledgement unknown',{uncertain:mutation});
    if(value.code!==0)throw new BridgeError('Feishu interaction rejected');
    return value.data ?? (value.bot?{bot:value.bot}:{});
  }
  return {
    async verifyBot(authorize){const data=await request('bot/v3/info',undefined,{authorize,method:'GET',mutation:false});if(config.interaction.botOpenId&&data.bot?.open_id!==config.interaction.botOpenId)throw new BridgeError('Configured bot identity differs',{code:-32012});if(!data.bot?.open_id)throw new BridgeError('Bot identity unavailable',{status:503});},
    async quote(message,authorize){
      if(!message.quote_id)return null;
      const data=await request(`im/v1/messages/${segment(message.quote_id)}`,undefined,{authorize,method:'GET',mutation:false});authorize();
      if(!Array.isArray(data.items)||data.items.length!==1||data.items[0].chat_id!==message.chat_id)throw new BridgeError('Quoted conversation differs',{code:-32012});
      const item=data.items[0],parsed=parseMessageContent({message_type:item.msg_type,content:item.body?.content},config);
      return parsed?.text??null;
    },
    async addTyping(message,authorize){const data=await request(`im/v1/messages/${segment(message.id)}/reactions`,{reaction_type:{emoji_type:'Typing'}},{authorize});return string(data.reaction_id,256);},
    async removeTyping(message,reactionId,authorize){await request(`im/v1/messages/${segment(message.id)}/reactions/${segment(reactionId)}`,undefined,{authorize,method:'DELETE',missing:true});},
    async findTyping(message,authorize){
      let pageToken;
      for(let page=0;page<10;page++){
        const query=new URLSearchParams({page_size:'50',...(pageToken?{page_token:pageToken}:{})});
        const data=await request(`im/v1/messages/${segment(message.id)}/reactions?${query}`,undefined,{authorize,method:'GET',mutation:false});
        if(!Array.isArray(data.items))throw new BridgeError('Invalid reaction listing');
        const match=data.items.find(item=>item.reaction_type?.emoji_type==='Typing'&&item.operator?.operator_type==='app'&&[config.larkAppId,config.interaction.botOpenId].filter(Boolean).includes(item.operator?.operator_id));
        if(match)return string(match.reaction_id,256);
        if(!data.has_more)return null;
        pageToken=string(data.page_token,512);
      }
      // Never add a replacement reaction after an incomplete reconciliation.
      throw new BridgeError('Reaction listing limit reached');
    },
    async createCard(text,state,authorize){const data=await request('cardkit/v1/cards',{type:'card_json',data:JSON.stringify(cardDocument(text,state))},{authorize});return string(data.card_id,256);},
    async updateCard(cardId,text,state,sequence,authorize){await request(`cardkit/v1/cards/${segment(cardId)}`,{card:{type:'card_json',data:JSON.stringify(cardDocument(text,state))},sequence,uuid:hash(`${cardId}:${sequence}`).slice(0,32)},{authorize,method:'PUT'});},
    async replyCard(message,cardId,authorize){const data=await request(`im/v1/messages/${segment(message.id)}/reply`,{msg_type:'interactive',content:JSON.stringify({type:'card',data:{card_id:cardId}}),reply_in_thread:message.reply_in_thread,uuid:replyUuid(config.larkAppId,message.id)},{authorize});if(typeof data.message_id!=='string'||data.chat_id!==message.chat_id)throw new BridgeError('Feishu reply acknowledgement unknown',{uncertain:true});return data.message_id;},
    async attachment(message,index,authorize){
      const item=message.attachments[index];if(!item)throw new BridgeError('Attachment unavailable');
      const response=await request(`im/v1/messages/${segment(message.id)}/resources/${segment(item.key)}?type=${item.type==='image'?'image':'file'}`,undefined,{authorize,method:'GET',mutation:false,resource:true});
      const bytes=response.body;if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_ATTACHMENT_BYTES||(response.headers?.['content-encoding']&&response.headers['content-encoding']!=='identity')){if(Buffer.isBuffer(bytes))bytes.fill(0);throw new BridgeError('Attachment size refused');}
      let mime='application/octet-stream';
      if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
      else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
      else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')mime='image/webp';
      else if(['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString()))mime='image/gif';
      else if(bytes.subarray(0,4).toString()==='OggS')mime='audio/ogg';
      else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE')mime='audio/wav';
      else if(bytes.subarray(0,3).toString()==='ID3'||(bytes[0]===255&&(bytes[1]&224)===224))mime='audio/mpeg';
      else if(bytes.subarray(0,5).toString()==='%PDF-')mime='application/pdf';
      if(item.type==='image'&&!mime.startsWith('image/')){bytes.fill(0);throw new BridgeError('Unsupported image representation');}
      if(item.type==='audio'&&!mime.startsWith('audio/')){bytes.fill(0);throw new BridgeError('Unsupported audio representation; ask the sender to resend or send text');}
      return {item,bytes,mime};
    },
    async upload(type,bytes,name,authorize){
      if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_ATTACHMENT_BYTES||!['image','file','audio'].includes(type)||typeof name!=='string')throw new BridgeError('Media upload refused');
      name=name.replace(/[\r\n"\\/]/g,'_').slice(0,128);if(!name)throw new BridgeError('Invalid media filename');
      const converted=type==='audio'?await opusAudio(bytes):null;
      let body;
      try{
      if(converted){bytes=converted;name=name.replace(/\.[^.]+$/,'')+'.ogg';}
      const boundary='dotbridge'+randomBytes(16).toString('hex');
      const fields=type==='image'?{image_type:'message'}:{file_type:type==='audio'?'opus':name.toLowerCase().endsWith('.pdf')?'pdf':'stream',file_name:name};
      const chunks=Object.entries(fields).map(([key,value])=>Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${type==='image'?'image':'file'}"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`));
      authorize();const token=await sender.token(authorize);authorize();
      body=Buffer.concat(chunks);
      let response;try{response=await (send.uploadRequester??send)(`${FEISHU_ORIGIN}/open-apis/im/v1/${type==='image'?'images':'files'}`,{purpose:'provider',hosts:['open.feishu.cn'],headers:{Authorization:`Bearer ${token}`,'Content-Type':`multipart/form-data; boundary=${boundary}`},body,beforeConnect:authorize});}catch(error){if(error instanceof BridgeError&&error.code===-32012)throw error;throw new BridgeError('Media upload acknowledgement unknown',{uncertain:true});}
      if(response.status===401){sender.invalidate();throw new BridgeError('Feishu authentication rejected',{retryable:true});}
      if(response.status===429)throw new BridgeError('Feishu rate limited',{retryable:true});
      if(response.status>=500)throw new BridgeError('Media upload acknowledgement unknown',{uncertain:true});
      let data;try{data=JSON.parse(response.body.toString('utf8'));}catch{throw new BridgeError('Media upload acknowledgement unknown',{uncertain:true});}
      if(response.status!==200||data.code!==0)throw new BridgeError('Media upload rejected');
      return string(data.data?.[type==='image'?'image_key':'file_key'],256);
      }finally{converted?.fill(0);body?.fill(0);}
    },
    async replyMedia(message,type,key,authorize,withCard=false){const data=await request(`im/v1/messages/${segment(message.id)}/reply`,{msg_type:type,content:JSON.stringify({[type==='image'?'image_key':'file_key']:key}),reply_in_thread:message.reply_in_thread,uuid:replyUuid(config.larkAppId,withCard?`${message.id}:attachment`:message.id)},{authorize});if(typeof data.message_id!=='string'||data.chat_id!==message.chat_id)throw new BridgeError('Feishu reply acknowledgement unknown',{uncertain:true});return data.message_id;}
  };
}
