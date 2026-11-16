import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,larkPayload} from './helpers.js';
import {validateInteractionPolicy} from '../src/interaction-policy.js';

test('Lark long work retains a full result after expiry under the original subscription', async t => {
  const f = await harness();
  t.after(f.close);
  await f.subscribe();
  await f.receiveLark();
  await f.app.bridge.tick();
  const call = (name, args) => f.postMcp('tools/call', {name, arguments: args});
  const started = await call('begin_lark_task', {message_id: 'fixture-message-1'});
  assert.equal(started.status, 200);
  const taskId = started.body.result.structuredContent.task_id;
  f.advance(f.config.replyTtlMs + 1000);
  const text = '完整结果'.repeat(5000);
  const args = {task_id: taskId, text, idempotency_key: 'one-retained-result'};
  assert.equal((await call('save_lark_task_result', args)).status, 200);
  assert.equal((await call('save_lark_task_result', args)).status, 200);
  const result = await call('get_lark_task_result', {task_id: taskId});
  assert.equal(result.status, 200);
  assert.equal(result.body.result.structuredContent.text, text);
  await f.app.bridge.tick();
  assert.equal(f.sends.length, 0);
});

test('Lark configured batches preserve source links and prevent a second reply',async t=>{
  const f=await harness({overrides:{interaction:validateInteractionPolicy({version:1,queue:{mode:'batch',window_ms:100}})}});
  t.after(f.close);await f.subscribe();await f.receiveLark();
  const second=larkPayload(f.now(),{message_id:'fixture-message-2',content:JSON.stringify({text:'second question'})});second.header.event_id='fixture-event-2';
  await f.receiveLark(second);await f.app.bridge.tick();assert.equal(f.deliveries.length,0);
  f.advance(101);await f.app.bridge.tick();assert.equal(f.deliveries.length,1);
  const read=await f.postMcp('tools/call',{name:'get_lark_message',arguments:{message_id:'fixture-message-2'}});
  assert.deepEqual(read.body.result.structuredContent.source_message_ids,['fixture-message-1','fixture-message-2']);
  assert.notEqual((await f.postMcp('tools/call',{name:'reply_to_lark',arguments:{message_id:'fixture-message-1',text:'duplicate'}})).status,200);
  assert.equal((await f.postMcp('tools/call',{name:'reply_to_lark',arguments:{message_id:'fixture-message-2',text:'combined answer'}})).status,200);
  await f.app.bridge.tick();assert.equal(f.sends.length,1);
  assert.equal(f.app.bridge.store.replyStatus('fixture-message-1').status,'sent');
});


test('lark speech tools queue one persisted reply and retain the generated text',async t=>{
  const f=await harness({overrides:{interaction:validateInteractionPolicy({version:1,media:true})}});t.after(f.close);await f.subscribe();await f.receiveLark();await f.app.bridge.tick();
  const {pcm16Wave}=await import('@dot-bridge/core/audio/wav.js');
  let conversions=0;
  f.app.bridge.speech.synthesizer={status:()=>({configured:true,runtime_ready:true,busy:false,last_failure:null}),generate:async()=>{conversions++;return {data:pcm16Wave(Buffer.alloc(32000)),mimeType:'audio/wav',name:'voice.wav'};}};
  const args={message_id:'fixture-message-1',text:'Generated answer',idempotency_key:'one-speech'};
  const call=()=>f.postMcp('tools/call',{name:'reply_lark_speech',arguments:args});
  assert.equal((await call()).body.result.structuredContent.status,'pending');
  assert.equal((await call()).body.result.structuredContent.status,'pending');assert.equal(conversions,1);
  const task=f.app.bridge.tasks.begin('fixture-message-1');assert.equal(task.result_available,true);
  assert.equal(f.app.bridge.tasks.get(task.task_id).text,'Generated answer');
});
