import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {BridgeError} from './common.js';
import {MAX_ATTACHMENT_BYTES} from './interaction-policy.js';

function executable(name){
  if(process.platform!=='linux')throw new BridgeError('This media conversion requires the protected Linux runtime');
  const resolved=fs.realpathSync('/usr/bin/'+name),stat=fs.statSync(resolved);
  if(!resolved.startsWith('/usr/bin/')||!stat.isFile()||stat.uid!==0||(stat.mode&0o022))throw new BridgeError('Untrusted media runtime');
  return resolved;
}
export function protectedMediaProcess(name,args,input,{limit=MAX_ATTACHMENT_BYTES,timeout=20000}={}){
  const target=executable(name),launcher=executable('prlimit');
  return new Promise((resolve,reject)=>{
    let child,finished=false,size=0;const chunks=[];
    const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);if(error){child?.kill('SIGKILL');reject(new BridgeError('Media conversion unavailable or rejected'));}else resolve(result);};
    const timer=setTimeout(()=>finish(true),timeout);
    try{
      child=spawn(launcher,['--as=536870912','--cpu=15','--',target,...args],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});
      child.stdout.on('data',chunk=>{size+=chunk.length;if(size>limit)finish(true);else chunks.push(chunk);});
      child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});child.on('error',()=>finish(true));child.on('close',code=>finish(code!==0,Buffer.concat(chunks)));
      child.stdin.end(input);
    }catch{finish(true);}
  });
}
export async function opusAudio(bytes){
  if(bytes.subarray(0,4).toString()==='OggS'&&bytes.subarray(0,256).includes(Buffer.from('OpusHead')))return Buffer.from(bytes);
  if(!(bytes.subarray(0,3).toString()==='ID3'||(bytes[0]===255&&(bytes[1]&224)===224)||(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE')||bytes.subarray(0,4).toString()==='OggS'))throw new BridgeError('Unsupported audio representation');
  return protectedMediaProcess('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-protocol_whitelist','pipe','-i','pipe:0','-t','600','-vn','-map_metadata','-1','-threads','1','-c:a','libopus','-f','ogg','pipe:1'],bytes);
}
export async function readableFile(bytes,mime){
  try{
    if(mime!=='application/pdf'&&bytes.subarray(0,2).toString()!=='PK'){
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text))return{extraction_status:'unsupported'};
      return{extracted_text:text.slice(0,30000),extraction_status:text.length>30000?'truncated':'complete'};
    }
    const output=await protectedMediaProcess('python3',['-I','-B',fileURLToPath(new URL('./read-document.py',import.meta.url)),mime==='application/pdf'?'pdf':'office'],bytes,{limit:300000});
    const value=JSON.parse(output.toString('utf8'));
    if(!['complete','truncated','unsupported'].includes(value.status)||typeof value.text!=='string'||value.text.length>30000)throw new Error();
    return{...(value.text?{extracted_text:value.text}:{}),extraction_status:value.status};
  }catch{return{extraction_status:'unsupported'};}
}
