import test from 'node:test';
import assert from 'node:assert/strict';
import {protectedMediaProcess,opusAudio,readableFile} from '../src/media-process.js';

test('already-Opus audio and UTF-8 files stay in memory without spawning conversion tools',async()=>{
  const input=Buffer.concat([Buffer.from('OggS'),Buffer.alloc(24),Buffer.from('OpusHead')]);
  const out=await opusAudio(input);assert.deepEqual(out,input);assert.notEqual(out,input);out.fill(0);assert.equal(input.subarray(0,4).toString(),'OggS');
  assert.deepEqual(await readableFile(Buffer.from('Synthetic document'),'text/plain'),{extracted_text:'Synthetic document',extraction_status:'complete'});
  await assert.rejects(opusAudio(Buffer.from('unsupported audio')));
});

test('native media conversion refuses a missing nondumpable guard before running a child',()=>{
  const previous=process.env.DOT_BRIDGE_AUDIO_GUARD;
  try{delete process.env.DOT_BRIDGE_AUDIO_GUARD;assert.throws(()=>protectedMediaProcess('python3',['-I','-B','-c','print(1)'],Buffer.from('synthetic')));}
  finally{if(previous===undefined)delete process.env.DOT_BRIDGE_AUDIO_GUARD;else process.env.DOT_BRIDGE_AUDIO_GUARD=previous;}
});

test('protected Linux child is nondumpable with zero core limit and bounded stdout',{skip:process.platform!=='linux'||!process.env.DOT_BRIDGE_AUDIO_GUARD?'requires Linux and an installed protected DOT_BRIDGE_AUDIO_GUARD':false},async()=>{
  const result=await protectedMediaProcess('python3',['-I','-B','-c','import ctypes,json,resource; print(json.dumps({"dumpable":ctypes.CDLL(None).prctl(3),"core":resource.getrlimit(resource.RLIMIT_CORE)}))'],Buffer.from('synthetic'));
  assert.deepEqual(JSON.parse(result),{dumpable:0,core:[0,0]});result.fill(0);
  await assert.rejects(protectedMediaProcess('python3',['-I','-B','-c','print("x"*1000)'],Buffer.from('synthetic'),{limit:16}));
});
