import {BridgeError,string} from './common.js';
import {createLarkSender} from './lark.js';
import {validateInteractionPolicy} from './interaction-policy.js';

export const FEATURE_SCOPES=Object.freeze([
  'im:message:readonly','im:message.group_at_msg:readonly','im:message.group_msg',
  'im:message.reactions:read','im:message.reactions:write_only','im:resource',
  'cardkit:card:write','im:chat:read','im:chat.members:read'
]);

// Operator-only, read-only provider requests. Neither the model's catalog nor
// the public HTTP server exposes permission or group-configuration tools.
export function interactionOperator(config,send){
  const sender=createLarkSender(config,send);
  async function get(path){
    const token=await sender.token(()=>{});
    const response=await send('https://open.feishu.cn/open-apis/'+path,{purpose:'provider',method:'GET',hosts:['open.feishu.cn'],headers:{Authorization:'Bearer '+token},body:Buffer.alloc(0)});
    let value;try{value=JSON.parse(response.body.toString('utf8'));}catch{throw new BridgeError('Operator read unavailable');}
    if(response.status!==200||value.code!==0)throw new BridgeError('Operator read unavailable');
    return value;
  }
  async function inventory(){
    let app,grants;
    try{app=(await get('application/v6/applications/'+encodeURIComponent(config.larkAppId)+'?lang=zh_cn&user_id_type=open_id')).data?.app;}catch{/* Do not add self-management permission to make this diagnostic work. */}
    try{grants=(await get('application/v6/scopes')).data?.scopes;}catch{/* An unavailable check is not a grant. */}
    return {application_read_available:!!app,grant_read_available:Array.isArray(grants),permissions:FEATURE_SCOPES.map(name=>({name,configured:app?app.scopes?.some(scope=>scope.scope===name&&scope.token_types?.includes('tenant'))??false:null,tenant_grant_status:Array.isArray(grants)?grants.filter(scope=>scope.scope_name===name&&scope.scope_type!=='user').map(scope=>scope.grant_status):null}))};
  }
  async function preparePolicy(){
    const bot=(await get('bot/v3/info')).bot;
    string(bot?.open_id,256);
    const policy={version:1,enabled:true,reactions:true,render:'card',media:true,streaming:true,auto_card:true,bot_open_id:bot.open_id,group_mentions:{enabled:false,members:'owner',context_scope:'sender'},groups:[]};
    validateInteractionPolicy(policy);return policy;
  }
  async function groupCatalog(){
    const groups=[];let pageToken;
    for(let page=0;page<10;page++){
      const query=new URLSearchParams({page_size:'100',...(pageToken?{page_token:pageToken}:{})});
      const data=(await get('im/v1/chats?'+query)).data;
      if(!Array.isArray(data?.items))throw new BridgeError('Group catalog unavailable');
      for(const item of data.items)groups.push({chat_id:string(item.chat_id,256),name:string(item.name,256)});
      if(!data.has_more)return {version:1,groups};
      pageToken=string(data.page_token,512);
    }
    throw new BridgeError('Group catalog limit reached');
  }
  async function members(chatId){
    string(chatId,256);const members=[];let pageToken;
    for(let page=0;page<10;page++){
      const query=new URLSearchParams({member_id_type:'open_id',page_size:'100',...(pageToken?{page_token:pageToken}:{})});
      const data=(await get('im/v1/chats/'+encodeURIComponent(chatId)+'/members?'+query)).data;
      if(!Array.isArray(data?.items))throw new BridgeError('Group members unavailable');
      for(const item of data.items)members.push({open_id:string(item.member_id,256),name:string(item.name,256)});
      if(!data.has_more)return {version:1,members};pageToken=string(data.page_token,512);
    }
    throw new BridgeError('Group member limit reached');
  }
  return {inventory,preparePolicy,groupCatalog,members};
}

export function safePolicyStatus(policy){
  return {version:1,enabled:policy.enabled,reactions:policy.reactions,render:policy.render,media:policy.media,streaming:policy.streaming,automatic_receipt_card:policy.autoCard,global_mentions_enabled:policy.groupMentions.enabled,groups:policy.groups.map((group,index)=>({index,enabled:group.enabled,members:group.members,allowlist_count:group.allowFrom.length,mention:group.mention,auto_reply:group.autoReply,keyword_count:group.keywords.length,reply_in_thread:group.replyInThread,context_scope:group.contextScope}))};
}
