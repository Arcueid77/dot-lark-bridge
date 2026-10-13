import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,larkPayload,subscriptionParams} from './helpers.js';
import {validateInteractionPolicy} from '../src/interaction-policy.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {privateMkdtempSync} from '../../dot-qq-bridge/packages/dot-bridge-platform/test-fixtures.js';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=','base64');
function policy(groups=[],overrides={}){return validateInteractionPolicy({version:1,enabled:true,reactions:true,render:'card',media:true,streaming:true,auto_card:false,bot_open_id:'fixture-bot',groups,...overrides});}
function payload(f,id,{chat='fixture_private_chat',sender='fixture_lark_owner',text='测试',type='text',mentions=[],parent,...rest}={}){
  const data=larkPayload(f.now(),{message_id:id,chat_id:chat,chat_type:chat==='fixture_private_chat'?'p2p':'group',message_type:type,mentions,content:JSON.stringify(type==='text'?{text}:text),...(parent?{parent_id:parent}:{}),...rest});data.header.event_id='event-'+id;data.event.sender.sender_id.open_id=sender;return data;
}
async function setup(t,groups=[],options={}){
  let f;const calls={cards:[],updates:[],replies:[],reactions:[],deletes:[],uploads:[],resources:[]},routes=new Map();
  f=await harness({dbPath:options.dbPath,overrides:{interaction:policy(groups,options.policy)},sendOverride:async(url,request)=>{
    const overridden=await options.send?.(url,request,f,calls);if(overridden!==undefined)return overridden;
    const ok=data=>({status:200,body:Buffer.from(JSON.stringify({code:0,data}))});
    if(url.includes('/resources/')){calls.resources.push(url);return{status:200,headers:{'content-type':'image/png'},body:Buffer.from(PNG)};}
    if(url.endsWith('/reactions')&&request.method!=='GET'){calls.reactions.push(url);return ok({reaction_id:'reaction-fixture'});}
    if(url.includes('/reactions/')&&request.method==='DELETE'){calls.deletes.push(url);return ok({});}
    if(url.includes('/reactions?'))return ok({items:[{reaction_id:'reaction-fixture',reaction_type:{emoji_type:'Typing'},operator:{operator_type:'app',operator_id:'fixture-app'}}]});
    if(url.endsWith('/cardkit/v1/cards')){calls.cards.push(JSON.parse(request.body));return ok({card_id:'fixture-card'});}
    if(url.includes('/cardkit/v1/cards/')&&request.method==='PUT'){calls.updates.push(JSON.parse(request.body));return ok({});}
    if(url.endsWith('/im/v1/images')||url.endsWith('/im/v1/files')){calls.uploads.push(request.body);return ok({image_key:'img-uploaded',file_key:'file-uploaded'});}
    if(url.endsWith('/reply')){const id=decodeURIComponent(url.split('/').at(-2));calls.replies.push({id,body:JSON.parse(request.body)});return ok({message_id:'out-'+calls.replies.length,chat_id:routes.get(id)||'fixture_private_chat'});}
  }});
  t.after(()=>f.close());
  const receive=async(id,details={})=>{routes.set(id,details.chat||'fixture_private_chat');return f.receiveLark(payload(f,id,details));};
  const tool=(name,args)=>f.postMcp('tools/call',{name,arguments:args});
  return{...f,calls,receive,tool};
}
test('group configuration supports owner, allowlist and all with independent mention/keyword/all-message triggers',()=>{
  for(const members of ['owner','all','allowlist'])for(const auto_reply of ['off','all','keywords']){
    const p=policy([{chat_id:'group',members,auto_reply,...(members==='allowlist'?{allow_from:['member']}:{}) ,...(auto_reply==='keywords'?{keywords:['帮助']}:{})}]);assert.equal(p.groups[0].members,members);assert.equal(p.groups[0].autoReply,auto_reply);assert.ok(Object.isFrozen(p.groups[0]));
  }
  assert.throws(()=>policy([{chat_id:'g',members:'allowlist',allow_from:[],auto_reply:'off'}]));
  assert.throws(()=>policy([{chat_id:'g',members:'all',auto_reply:'keywords',keywords:[]} ]));
  assert.throws(()=>policy([{chat_id:'g',members:'all',auto_reply:'off'},{chat_id:'g',members:'all',auto_reply:'all'}]));
});
test('quoted rich private input and long text are durable while foreign sources and bots remain denied',async t=>{
  const f=await setup(t);await f.subscribe();
  const text='长'.repeat(5000);assert.equal((await f.receive('long',{text,parent:'old-reference'})).body.outcome,'queued');await f.app.bridge.tick();
  const read=await f.tool('get_lark_message',{message_id:'long'});assert.equal(read.status,200);assert.equal(read.body.result.structuredContent.text,text);assert.equal(read.body.result.structuredContent.quoted_message_id,'old-reference');
  const post={zh_cn:{title:'标题',content:[[{tag:'text',text:'正文'},{tag:'img',image_key:'img-fixture'}]]}};
  assert.equal((await f.receive('post',{type:'post',text:post})).body.outcome,'queued');await f.app.bridge.tick();
  assert.equal((await f.tool('get_lark_message',{message_id:'post'})).body.result.structuredContent.attachments.length,1);
  assert.equal((await f.receive('foreign',{sender:'another-user'})).body.outcome,'rejected');
  const bot=payload(f,'bot');bot.event.sender.sender_type='app';assert.equal((await f.receiveLark(bot)).body.outcome,'rejected');
});
test('configured group at must target the exact bot; owner-only subscriptions do not silently receive group messages',async t=>{
  const f=await setup(t,[{chat_id:'g',members:'all',auto_reply:'off'}]);await f.subscribe();
  const mentions=[{key:'@_user_1',id:{open_id:'fixture-bot'}}];
  assert.equal((await f.receive('before-scope',{chat:'g',sender:'guest',text:'@_user_1 帮助',mentions})).body.outcome,'ignored');
  await f.postMcp('events/unsubscribe',{name:'lark.message.created',arguments:{conversation:'owner'},delivery:{mode:'webhook',url:subscriptionParams().delivery.url}});
  await f.subscribe(subscriptionParams({arguments:{conversation:'configured'}}));
  assert.equal((await f.receive('not-at',{chat:'g',sender:'guest'})).body.outcome,'ignored');
  assert.equal((await f.receive('at-other',{chat:'g',sender:'guest',mentions:[{key:'@_user_1',id:{open_id:'another-bot'}}]})).body.outcome,'ignored');
  assert.equal((await f.receive('at-us',{chat:'g',sender:'guest',text:'@_user_1 帮助',mentions})).body.outcome,'queued');await f.app.bridge.tick();
  assert.equal(f.deliveries[0].data.conversation,'group');assert.equal(f.deliveries[0].data.text,'帮助');
  assert.equal((await f.receive('unknown-group',{chat:'other',sender:'guest',mentions})).body.outcome,'rejected');
});
test('all-message and keyword groups bind replies and context to the original group; membership changes revoke queued replies',async t=>{
  const groups=[{chat_id:'g1',members:'all',auto_reply:'all',reply_in_thread:true},{chat_id:'g2',members:'allowlist',allow_from:['allowed'],auto_reply:'keywords',keywords:['帮助']}];
  const f=await setup(t,groups,{policy:{render:'post',streaming:false}});await f.subscribe(subscriptionParams({arguments:{conversation:'configured'}}));
  await f.receive('private',{text:'private-canary'});await f.app.bridge.tick();f.advance(1);
  await f.receive('group1',{chat:'g1',sender:'guest',text:'group-canary'});await f.app.bridge.tick();
  assert.equal((await f.receive('keyword-miss',{chat:'g2',sender:'allowed',text:'普通文字'})).body.outcome,'ignored');
  assert.equal((await f.receive('not-member',{chat:'g2',sender:'denied',text:'帮助'})).body.outcome,'rejected');
  const context=await f.tool('get_lark_context',{message_id:'group1'});assert.equal(context.status,200);assert.equal(JSON.stringify(context.body).includes('private-canary'),false);
  assert.equal((await f.tool('reply_to_lark',{message_id:'group1',text:'**群内答复**'})).status,200);await f.app.bridge.tick();
  assert.equal(f.calls.replies[0].id,'group1');assert.equal(f.calls.replies[0].body.reply_in_thread,true);assert.equal(f.calls.replies[0].body.msg_type,'post');
  f.advance(1);await f.receive('revoked',{chat:'g1',sender:'guest'});await f.app.bridge.tick();await f.tool('reply_to_lark',{message_id:'revoked',text:'must not send'});
  f.config.interaction=policy([{chat_id:'g1',members:'owner',auto_reply:'all'}]);await f.app.bridge.tick();
  assert.equal(f.calls.replies.length,1);assert.equal(f.app.bridge.store.replyStatus('revoked').status,'cancelled');
});
test('typing reaction starts only after durable acceptance, disappears on positive reply acknowledgement, and does not block callback delivery',async t=>{
  const f=await setup(t);await f.subscribe();await f.receive('reaction');await f.app.bridge.interactions.tickFeedback();assert.equal(f.calls.reactions.length,1);
  await f.app.bridge.tick();await f.tool('reply_to_lark',{message_id:'reaction',text:'答复'});await f.app.bridge.tick();f.advance(5001);await f.app.bridge.interactions.tickFeedback();assert.equal(f.calls.deletes.length,1);assert.equal(f.app.bridge.store.replyStatus('reaction').status,'sent');
});
test('generated chunks are ordered/idempotent and finalization updates one card without a second text reply',async t=>{
  const f=await setup(t);await f.subscribe();await f.receive('stream');await f.app.bridge.tick();
  assert.equal((await f.tool('begin_lark_reply',{message_id:'stream'})).status,200);
  assert.equal((await f.tool('get_lark_message',{message_id:'stream'})).body.result.structuredContent.reply.status,'processing');
  await f.tool('append_lark_reply',{message_id:'stream',sequence:1,text:'真正生成的第一段。'});await f.app.bridge.tick();
  assert.equal(f.calls.replies.length,1);assert.equal(f.calls.replies[0].body.msg_type,'interactive');
  assert.equal((await f.tool('append_lark_reply',{message_id:'stream',sequence:1,text:'真正生成的第一段。'})).status,200);
  assert.equal((await f.tool('append_lark_reply',{message_id:'stream',sequence:1,text:'不同文字'})).status,400);
  await f.tool('append_lark_reply',{message_id:'stream',sequence:2,text:'第二段。'});
  await f.tool('reply_to_lark',{message_id:'stream',text:'真正生成的第一段。第二段。'});await f.app.bridge.tick();
  assert.equal(f.calls.replies.length,1);assert.equal(f.app.bridge.store.replyStatus('stream').status,'sent');assert.equal(f.app.bridge.interactions.stream('stream').state,'complete');
  assert.ok(f.calls.updates.every((value,index,list)=>index===0||value.sequence>list[index-1].sequence));
});
test('successful card progress can exceed the failure retry budget without losing updates',async t=>{
  const f=await setup(t);f.config.maxAttempts=2;
  await f.subscribe();await f.receive('many-chunks');await f.app.bridge.tick();
  await f.tool('begin_lark_reply',{message_id:'many-chunks'});await f.app.bridge.tick();
  let text='';
  for(let sequence=1;sequence<=12;sequence++){
    const chunk=`段落 ${sequence}。`;text+=chunk;
    assert.equal((await f.tool('append_lark_reply',{message_id:'many-chunks',sequence,text:chunk})).status,200);
    await f.app.bridge.tick();
    assert.equal(f.app.bridge.interactions.stream('many-chunks').applied_sequence,sequence);
    assert.equal(f.calls.replies.length,1);
  }
  await f.tool('reply_to_lark',{message_id:'many-chunks',text});await f.app.bridge.tick();
  assert.equal(f.app.bridge.store.replyStatus('many-chunks').status,'sent');
  assert.equal(f.app.bridge.interactions.stream('many-chunks').state,'complete');
  assert.equal(f.calls.replies.length,1);
});

test('consecutive known card failures still exhaust the retry budget and stop updates',async t=>{
  let updates=0;const f=await setup(t,[],{send:async(url,request)=>{
    if(url.includes('/cardkit/v1/cards/')&&request.method==='PUT'){updates++;return{status:429,body:Buffer.from('{}')};}
  }});f.config.maxAttempts=2;
  await f.subscribe();await f.receive('limited-card');await f.app.bridge.tick();
  await f.tool('begin_lark_reply',{message_id:'limited-card'});await f.app.bridge.tick();
  f.advance(10000);await f.app.bridge.tick();
  assert.equal(updates,2);assert.equal(f.app.bridge.interactions.stream('limited-card').state,'failed');
  f.advance(10000);await f.app.bridge.tick();assert.equal(updates,2);
  assert.equal(f.calls.replies.length,1);
  assert.equal((await f.tool('append_lark_reply',{message_id:'limited-card',sequence:1,text:'不得继续'})).status,400);
});

test('unknown card reply acknowledgement is terminal and never causes a second message',async t=>{
  let dropped=false;const f=await setup(t,[],{send:async(url,request,_f,calls)=>{if(url.endsWith('/reply')){calls.replies.push({id:'unknown',body:JSON.parse(request.body)});dropped=true;throw new Error('synthetic acknowledgement lost');}}});
  await f.subscribe();await f.receive('unknown');await f.app.bridge.tick();await f.tool('begin_lark_reply',{message_id:'unknown'});await f.app.bridge.tick();assert.equal(dropped,true);
  assert.equal(f.app.bridge.interactions.stream('unknown').state,'uncertain');f.advance(120000);await f.app.bridge.tick();assert.equal(f.calls.replies.length,1);
  assert.equal((await f.tool('reply_to_lark',{message_id:'unknown',text:'must not resend'})).status,400);
  assert.equal((await f.tool('reply_lark_media',{message_id:'unknown',type:'image',name:'image.png',mime_type:'image/png',data:PNG.toString('base64')})).status,400);
  assert.equal(f.app.bridge.store.pendingMessages(f.config.principal,f.now()).length,0);
});

test('group context defaults to the sender, supports explicit group sharing, and excludes later same-time messages',async t=>{
  const f=await setup(t,[{chat_id:'g',members:'all',auto_reply:'all'}]);await f.subscribe(subscriptionParams({arguments:{conversation:'configured'}}));
  await f.receive('first',{chat:'g',sender:'alice',text:'alice-only'});await f.app.bridge.tick();
  await f.receive('second',{chat:'g',sender:'bob',text:'bob-only'});await f.app.bridge.tick();
  await f.receive('third',{chat:'g',sender:'alice',text:'future-alice'});await f.app.bridge.tick();
  const first=(await f.tool('get_lark_context',{message_id:'first'})).body.result.structuredContent;
  const second=(await f.tool('get_lark_context',{message_id:'second'})).body.result.structuredContent;
  assert.deepEqual(first.messages.map(m=>m.message_id),['first']);assert.deepEqual(second.messages.map(m=>m.message_id),['second']);assert.notEqual(first.context_key,second.context_key);
  f.config.interaction=policy([{chat_id:'g',members:'all',auto_reply:'all',context_scope:'group'}]);
  assert.deepEqual((await f.tool('get_lark_context',{message_id:'second'})).body.result.structuredContent.messages.map(m=>m.message_id),['first','second']);
});

test('quoted-message reads use a fixed same-chat API route and never return a foreign quote',async t=>{
  let foreign=false;const f=await setup(t,[],{send:async(url)=>{
    if(url.endsWith('/im/v1/messages/quoted-source'))return{status:200,body:Buffer.from(JSON.stringify({code:0,data:{items:[{chat_id:foreign?'foreign-chat':'fixture_private_chat',msg_type:'text',body:{content:JSON.stringify({text:'quoted-fixture'})}}]}}))};
  }});
  await f.subscribe();await f.receive('quoting',{parent:'quoted-source'});await f.app.bridge.tick();
  assert.deepEqual((await f.tool('get_lark_context',{message_id:'quoting'})).body.result.structuredContent.quote,{available:true,text:'quoted-fixture'});
  foreign=true;const read=await f.tool('get_lark_context',{message_id:'quoting'});assert.deepEqual(read.body.result.structuredContent.quote,{available:false,text:null});
  assert.equal(JSON.stringify(read.body).includes('quoted-fixture'),false);
});

test('bursts are durably accepted and the callback rate postpones work without fabricating delivery',async t=>{
  const f=await setup(t);await f.subscribe();
  for(let i=0;i<13;i++)assert.equal((await f.receive('burst-'+i)).body.outcome,'queued');
  for(let i=0;i<13;i++)await f.app.bridge.tick();
  assert.equal(f.deliveries.length,10);assert.equal(f.app.bridge.store.message('burst-10').attempted_at,null);
  f.advance(60001);for(let i=0;i<3;i++)await f.app.bridge.tick();
  assert.equal(f.deliveries.length,13);assert.equal(new Set(f.deliveries.map(event=>event.eventId)).size,13);
});

test('a graceful restart resumes a known card and its chunks without sending another card message',async t=>{
  const directory=privateMkdtempSync(path.join(os.tmpdir(),'lark-interaction-restart-')),dbPath=path.join(directory,'bridge.sqlite');
  const first=await setup(t,[],{dbPath});await first.subscribe();await first.receive('restart');await first.app.bridge.tick();
  await first.tool('begin_lark_reply',{message_id:'restart'});await first.tool('append_lark_reply',{message_id:'restart',sequence:1,text:'已生成的第一段。'});await first.app.bridge.tick();
  assert.equal(first.calls.replies.length,1);await first.close();
  const second=await setup(t,[],{dbPath});t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  await second.tool('append_lark_reply',{message_id:'restart',sequence:2,text:'重启后第二段。'});await second.tool('reply_to_lark',{message_id:'restart',text:'已生成的第一段。重启后第二段。'});await second.app.bridge.tick();
  assert.equal(second.calls.replies.length,0);assert.equal(second.calls.cards.length,0);assert.equal(second.app.bridge.store.replyStatus('restart').status,'sent');
});

test('an unknown media reply acknowledgement is retained and an identical request never uploads or sends twice',async t=>{
  const f=await setup(t,[],{send:async(url,request,_f,calls)=>{if(url.endsWith('/reply')){calls.replies.push({id:'media-unknown',body:JSON.parse(request.body)});throw new Error('fixture ACK lost');}}});
  await f.subscribe();await f.receive('media-unknown',{type:'image',text:{image_key:'img-fixture'}});await f.app.bridge.tick();
  await f.tool('reply_lark_attachment',{message_id:'media-unknown',attachment_index:0});await f.app.bridge.tick();
  assert.equal(f.app.bridge.store.replyStatus('media-unknown').status,'uncertain');f.advance(60001);
  await f.tool('reply_lark_attachment',{message_id:'media-unknown',attachment_index:0});await f.app.bridge.tick();
  assert.equal(f.calls.uploads.length,1);assert.equal(f.calls.replies.length,1);
});

test('media authorization is checked again after the resource request and rich replies do not notify other people',async t=>{
  let f;f=await setup(t,[],{send:async(url)=>{if(url.includes('/resources/')){f.app.bridge.store.unsubscribe(f.app.bridge.store.activeSubscription(f.now()).id);return{status:200,body:Buffer.from(PNG)};}}});
  await f.subscribe();await f.receive('revoked-image',{type:'image',text:{image_key:'img-fixture'}});await f.app.bridge.tick();
  assert.equal((await f.tool('get_lark_attachment',{message_id:'revoked-image',attachment_index:0})).body.error.code,-32012);
  const {cardDocument,renderedReply}=await import('../src/reply-renderer.js');const text='<at id=all>所有人</at>';
  assert.equal(JSON.stringify(cardDocument(text)).includes('<at'),false);assert.equal(renderedReply(text,'post').content.includes('<at'),false);
});
test('image attachment reading returns bound MCP content and source attachment replies use one durable upload/send',async t=>{
  const f=await setup(t);await f.subscribe();await f.receive('image',{type:'image',text:{image_key:'img-fixture'}});await f.app.bridge.tick();
  const media=await f.tool('get_lark_attachment',{message_id:'image',attachment_index:0});assert.equal(media.status,200);assert.equal(media.body.result.content[1].type,'image');assert.equal(media.body.result.structuredContent.size,PNG.length);assert.equal(JSON.stringify(media.body.result.structuredContent).includes('img-fixture'),false);
  assert.equal((await f.tool('get_lark_attachment',{message_id:'image',attachment_index:1})).status,400);
  await f.tool('reply_lark_attachment',{message_id:'image',attachment_index:0});await f.app.bridge.tick();
  assert.equal(f.calls.uploads.length,1);assert.equal(f.calls.replies.length,1);assert.equal(f.calls.replies[0].body.msg_type,'image');assert.equal(f.app.bridge.store.replyStatus('image').status,'sent');
  await f.tool('reply_lark_attachment',{message_id:'image',attachment_index:0});await f.app.bridge.tick();assert.equal(f.calls.replies.length,1);
});
test('automatic cards show receipt before genuine model progress; expiry closes the existing card without a new reply',async t=>{
  const f=await setup(t,[],{policy:{auto_card:true,reactions:false}});await f.subscribe();await f.receive('auto');await f.app.bridge.tick();await f.app.bridge.tick();
  assert.equal(f.calls.replies.length,1);assert.equal(JSON.parse(f.calls.cards[0].data).body.elements[1].content,'已接收，等待处理');
  await f.app.bridge.interactions.tickFeedback();assert.equal(f.app.bridge.interactions.stream('auto').state,'active');
  f.advance(f.config.replyTtlMs+1);await f.app.bridge.interactions.tickFeedback();assert.equal(f.calls.replies.length,1);assert.equal(f.app.bridge.interactions.stream('auto').state,'expired');
  assert.equal(JSON.parse(f.calls.updates.at(-1).card.data).body.elements[1].content,'处理已超时');
});
test('unsupported and overlong private messages get one fixed notice without a fabricated callback delivery',async t=>{
  const f=await setup(t);await f.subscribe();await f.receive('unsupported',{type:'media',text:{file_key:'file-video'}});await f.app.bridge.tick();
  assert.equal(f.deliveries.length,0);assert.equal(f.calls.replies.length,1);assert.equal(f.app.bridge.store.message('unsupported').attempted_at,null);
  assert.equal((await f.tool('get_lark_message',{message_id:'unsupported'})).body.error.code,-32012);
  f.advance(1);await f.receive('overlong',{text:'a'.repeat(20001)});await f.app.bridge.tick();assert.equal(f.calls.replies.length,2);assert.equal(f.deliveries.length,0);await f.app.bridge.tick();assert.equal(f.calls.replies.length,2);
});
test('global mentions are configurable but disabled groups and non-mentions cannot bypass local policy',async t=>{
  const f=await setup(t,[{chat_id:'disabled',enabled:false,members:'all',auto_reply:'all'}],{policy:{group_mentions:{enabled:true,members:'all'}}});await f.subscribe(subscriptionParams({arguments:{conversation:'configured'}}));
  const mentions=[{key:'@_user_1',id:{open_id:'fixture-bot'}}];
  assert.equal((await f.receive('global',{chat:'joined-group',sender:'guest',text:'@_user_1 帮助',mentions})).body.outcome,'queued');await f.app.bridge.tick();
  assert.equal((await f.receive('no-mention',{chat:'joined-group',sender:'guest'})).body.outcome,'rejected');
  assert.equal((await f.receive('disabled-at',{chat:'disabled',sender:'guest',mentions})).body.outcome,'rejected');
  f.config.interaction=policy();assert.equal((await f.tool('get_lark_message',{message_id:'global'})).body.error.code,-32012);
});

test('long answers retain all text in one Markdown attachment and finalize the existing bounded preview card',async t=>{
  const f=await setup(t,[],{policy:{auto_card:true}});await f.subscribe();await f.receive('long-answer');await f.app.bridge.tick();await f.app.bridge.tick();
  const text='完整长回复\n'+'汉'.repeat(25000);
  await f.tool('reply_to_lark',{message_id:'long-answer',text});await f.app.bridge.tick();
  const plan=f.app.bridge.store.vault.open(f.app.bridge.store.get('SELECT payload FROM reply_details WHERE message_id=?','long-answer').payload,'reply-details:long-answer');
  assert.equal(Buffer.from(plan.data,'base64').toString('utf8'),text);assert.equal(plan.type,'file');
  assert.equal(f.calls.replies.length,2);assert.equal(f.calls.replies[0].body.msg_type,'interactive');assert.equal(f.calls.replies[1].body.msg_type,'file');
  assert.ok(f.calls.updates.every(update=>Buffer.byteLength(update.card.data)<=20000));
  assert.equal(f.app.bridge.store.replyStatus('long-answer').status,'sent');
  await f.tool('reply_to_lark',{message_id:'long-answer',text});await f.app.bridge.tick();assert.equal(f.calls.uploads.length,1);assert.equal(f.calls.replies.length,2);
});

test('an older in-flight progress update cannot reopen a card after expiry',async t=>{
  let release,started;const waiting=new Promise(resolve=>{started=resolve;});let first=true;
  const f=await setup(t,[],{policy:{reactions:false},send:async(url,request)=>{
    if(url.includes('/cardkit/v1/cards/')&&request.method==='PUT'&&first){first=false;started();return await new Promise(resolve=>{release=()=>resolve({status:200,body:Buffer.from('{"code":0,"data":{}}')});});}
  }});
  await f.subscribe();await f.receive('race');await f.app.bridge.tick();await f.tool('begin_lark_reply',{message_id:'race'});
  const inFlight=f.app.bridge.tick();await waiting;f.advance(f.config.replyTtlMs+1);await f.app.bridge.interactions.tickFeedback();
  assert.equal(f.app.bridge.interactions.stream('race').state,'expired');release();await inFlight;
  assert.equal(f.app.bridge.interactions.stream('race').state,'expired');assert.equal(f.calls.replies.length,1);
});

test('unknown reaction acknowledgement reconciles only this app across pages and does not add another reaction',async t=>{
  let add=0,lists=0;const f=await setup(t,[],{send:async(url,request)=>{
    if(url.endsWith('/reactions')&&request.method!=='GET'){add++;throw new Error('fixture lost reaction ACK');}
    if(url.includes('/reactions?')){
      lists++;const own=url.includes('page_token=second');return{status:200,body:Buffer.from(JSON.stringify({code:0,data:own?{items:[{reaction_id:'reaction-fixture',reaction_type:{emoji_type:'Typing'},operator:{operator_type:'app',operator_id:'fixture-app'}}],has_more:false}:{items:[{reaction_id:'foreign',reaction_type:{emoji_type:'Typing'},operator:{operator_type:'app',operator_id:'another-app'}}],has_more:true,page_token:'second'}}))};
    }
  }});
  await f.subscribe();await f.receive('reaction-reconcile');await f.app.bridge.interactions.tickFeedback();f.advance(5001);await f.app.bridge.interactions.tickFeedback();
  assert.equal(add,1);assert.equal(lists,2);await f.app.bridge.tick();await f.tool('reply_to_lark',{message_id:'reaction-reconcile',text:'完成'});await f.app.bridge.tick();f.advance(5001);await f.app.bridge.interactions.tickFeedback();assert.equal(f.calls.deletes.length,1);
});
