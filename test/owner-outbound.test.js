import test from 'node:test';
import assert from 'node:assert/strict';
import {createLarkSender} from '../src/lark.js';
import {larkAdapter} from '../src/tunnel-adapter.js';
import {toolResult} from '@dot-bridge/core/router/common.js';
import {OwnerOutbox} from '@dot-bridge/core/channels/outbound.js';
import {Store} from '../src/store.js';
import {config} from './helpers.js';

test('Feishu proactive text uses an independently authorized create route, original owner chat and stable UUID',async()=>{
 const settings={authMode:'tunnel-service',bridgeMode:'tunnel',tunnelServiceOperation:'live',outboundEnabled:true,larkAppId:'fixture-app',larkAppSecret:'fixture-secret',ownerChatId:'fixture-chat',ownerOpenId:'fixture-owner',tenantKey:'fixture-tenant'};
 const calls=[];let guards=0;
 const sender=createLarkSender(settings,async(url,options)=>{
  options.beforeConnect();calls.push({url,body:JSON.parse(options.body)});
  return {status:200,body:Buffer.from(JSON.stringify(url.endsWith('/tenant_access_token/internal')?{code:0,tenant_access_token:'fixture-token',expire:7200}:{code:0,data:{message_id:'fixture-outgoing',chat_id:'fixture-chat'}}))};
 });
 const args={text:'fixture notification',idempotencyKey:'fixture-occurrence',authorize:()=>{guards++;}};
 await sender.sendOwnerMessage(args);assert.ok(guards>=3);
 assert.equal(calls[1].url,'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id');assert.equal(calls[1].body.receive_id,'fixture-chat');assert.deepEqual(JSON.parse(calls[1].body.content),{text:args.text});assert.equal(Object.hasOwn(calls[1].body,'reply_in_thread'),false);
 const uuid=calls[1].body.uuid;await sender.sendOwnerMessage(args);assert.equal(calls.at(-1).body.uuid,uuid);
 const before=calls.length;await assert.rejects(sender.sendOwnerMessage({...args,authorize:()=>{throw Error('revoked');}}));assert.equal(calls.length,before);
 await assert.rejects(createLarkSender({...settings,outboundEnabled:false},async()=>{throw Error('must not call');}).sendOwnerMessage(args));
});

test('the native Feishu store and closed aggregate adapter share encrypted owner schedule persistence',async()=>{
 const settings=config(),store=new Store(settings);try{
  const box=new OwnerOutbox({channel:'lark',db:store.db,seal:(v,a)=>store.vault.seal(v,a),open:(v,a)=>store.vault.open(v,a),enabled:true,available:()=>true,send:async()=>{},clock:()=>Date.parse('2026-11-02T00:00:00Z')});
  const args={conversation:'owner',text:'fixture reminder',send_at:'2026-11-03T09:00:00+08:00',timezone:'Asia/Shanghai',repeat:'once',until:null,idempotency_key:'fixture-intent'};
  const name='schedule_lark_message',saved=box.call(name,args),call={name,arguments:args};
  assert.deepEqual(larkAdapter.validateToolArguments(name,args,true),args);assert.deepEqual(larkAdapter.projectToolResult(call,toolResult(saved),true),saved);
  assert.equal(store.db.prepare('SELECT payload FROM dotbridge_outbound').get().payload.includes(args.text),false);
  assert.throws(()=>larkAdapter.validateToolArguments(name,{...args,recipient:'someone'},true));
  await box.close();
 }finally{store.close();}
});
