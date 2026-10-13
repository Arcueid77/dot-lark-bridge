import {makeOwnerScopedProxyTransport} from '../../dot-qq-bridge/packages/dot-bridge-transport/owner-scoped.js';
import {createServiceSender,makePublicRequester} from './network.js';
import {assertCallbackMode,ownerScopedProxy} from './callback-mode.js';
import {MAX_ATTACHMENT_BYTES} from './interaction-policy.js';

// Explicit formal configuration selects a statically imported implementation.
// No module paths, credentials, readiness claims or arbitrary adapters from env.
export function createFormalServiceSender(config,{proxyEnv=process.env,transportFactory=makeOwnerScopedProxyTransport}={}){
 assertCallbackMode(config);
 const send=ownerScopedProxy(config)?makePublicRequester({proxyEnv,callbackTransport:transportFactory({channel:'lark',proxyEnv})}):createServiceSender({proxyEnv});
 const resource=makePublicRequester({proxyEnv,maxBytes:MAX_ATTACHMENT_BYTES});
 Object.defineProperty(send,'resourceRequester',{value:(url,options)=>{if(options?.purpose!=='provider'||options?.method!=='GET')throw new Error('Resource transport is read-only');return resource(url,options);}});
 return send;
}
