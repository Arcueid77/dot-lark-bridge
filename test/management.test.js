import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,larkPayload} from './helpers.js';

test('verified private owner commands use shared durable replies and never create an event subscription',async t=>{
  const f=await harness();t.after(f.close);f.app.bridge.management.enabled=true;
  const payload=larkPayload(f.now(),{content:JSON.stringify({text:'/status'})});assert.equal((await f.receiveLark(payload)).status,200);await f.app.bridge.tick();
  assert.equal(f.deliveries.length,0);assert.equal(f.sends.length,1);assert.match(JSON.parse(f.sends[0].body.content).text,/subscription: none/);
  await f.receiveLark(payload);await f.app.bridge.tick();assert.equal(f.sends.length,1);assert.equal(f.app.bridge.store.get('SELECT count(*) AS n FROM subscriptions').n,0);
});
test('owner cancellation persists a terminal reply tombstone so a late model answer cannot enqueue',async t=>{
  const f=await harness();t.after(f.close);f.app.bridge.management.enabled=true;await f.subscribe();
  await f.receiveLark(larkPayload(f.now()));await f.app.bridge.tick();
  const command=larkPayload(f.now(),{message_id:'cancel-command',content:JSON.stringify({text:'/cancel'})});command.header.event_id='cancel-event';await f.receiveLark(command);await f.app.bridge.tick();
  assert.equal(f.app.bridge.store.replyStatus('fixture-message-1').status,'cancelled');
  const result=await f.postMcp('tools/call',{name:'reply_to_lark',arguments:{message_id:'fixture-message-1',text:'late answer'}});assert.ok(result.body.error||result.body.result?.isError);
});
