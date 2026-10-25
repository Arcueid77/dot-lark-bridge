import {makeOwnerScopedProxyTransport} from '@dot-bridge/core/transport/owner-scoped.js';
import {createServiceSender,makePublicRequester} from './network.js';
import {assertCallbackMode,ownerScopedProxy} from './callback-mode.js';
import {MAX_ATTACHMENT_BYTES} from './interaction-policy.js';

export function createMediaUploadRequester(options={}){
 const limit=MAX_ATTACHMENT_BYTES+65536;
 const upload=makePublicRequester({...options,maxBytes:limit,timeoutMs:30000,providerTimeoutMs:30000});
 return (url,request)=>{
  if(!['https://open.feishu.cn/open-apis/im/v1/images','https://open.feishu.cn/open-apis/im/v1/files'].includes(url)||request?.purpose!=='provider'||(request.method??'POST')!=='POST'||request.hosts?.length!==1||request.hosts[0]!=='open.feishu.cn'||!Buffer.isBuffer(request.body)||request.body.length>limit)throw new Error('Media transport requires the official bounded upload endpoint');
  return upload(url,request);
 };
}

// Explicit formal configuration selects a statically imported implementation.
// No module paths, credentials, readiness claims or arbitrary adapters from env.
export function createFormalServiceSender(config,{proxyEnv=process.env,transportFactory=makeOwnerScopedProxyTransport}={}){
 assertCallbackMode(config);
 const send=ownerScopedProxy(config)?makePublicRequester({proxyEnv,callbackTransport:transportFactory({channel:'lark',proxyEnv})}):createServiceSender({proxyEnv});
 const resource=makePublicRequester({proxyEnv,maxBytes:MAX_ATTACHMENT_BYTES});
 Object.defineProperty(send,'resourceRequester',{value:(url,options)=>{if(options?.purpose!=='provider'||options?.method!=='GET')throw new Error('Resource transport is read-only');return resource(url,options);}});
 Object.defineProperty(send,'uploadRequester',{value:createMediaUploadRequester({proxyEnv})});
 return send;
}
