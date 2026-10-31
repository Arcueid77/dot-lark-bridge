import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_MEDIA_BYTES,MAX_MEDIA_BASE64,MEDIA_RPC_LIMIT} from '@dot-bridge/core/channels/media.js';
import {LARK_MEDIA_BYTES,LARK_BASE64_LIMIT,validateLarkArguments,projectLarkResult} from '../src/tunnel-contract.js';
import {larkAdapter} from '../src/tunnel-adapter.js';
import {hash} from '../src/common.js';

test('Feishu input, output and routing use the shared five MiB original-file budget',()=>{
 assert.equal(MAX_MEDIA_BYTES,5*1024*1024);assert.equal(LARK_MEDIA_BYTES,MAX_MEDIA_BYTES);assert.equal(LARK_BASE64_LIMIT,MAX_MEDIA_BASE64);
 for(const budget of [larkAdapter.limits.bodyTools.reply_lark_media,larkAdapter.limits.requestTools.reply_lark_media,larkAdapter.limits.responseTools.get_lark_attachment])assert.equal(budget,MEDIA_RPC_LIMIT);
 const data=Buffer.alloc(MAX_MEDIA_BYTES,65).toString('base64'),oversize=Buffer.alloc(MAX_MEDIA_BYTES+1,65).toString('base64');assert.equal(data.length,oversize.length);
 const args={message_id:'fixture-media',type:'file',name:'answer.bin',mime_type:'application/octet-stream',data};
 assert.equal(validateLarkArguments('reply_lark_media',args).data.length,MAX_MEDIA_BASE64);assert.throws(()=>validateLarkArguments('reply_lark_media',{...args,data:oversize}));
 const value={message_id:args.message_id,attachment_index:0,type:'file',name:args.name,mime_type:args.mime_type,size:MAX_MEDIA_BYTES};
 const resource=blob=>({type:'resource',resource:{uri:`lark-attachment:${hash(`${value.message_id}:0`).slice(0,32)}`,mimeType:value.mime_type,blob}});
 const call={name:'get_lark_attachment',arguments:{message_id:value.message_id,attachment_index:0}};
 assert.equal(projectLarkResult(call,{isError:false,structuredContent:value,content:[resource(data)]}).value.size,MAX_MEDIA_BYTES);
 assert.throws(()=>projectLarkResult(call,{isError:false,structuredContent:{...value,size:MAX_MEDIA_BYTES+1},content:[resource(oversize)]}));
});
