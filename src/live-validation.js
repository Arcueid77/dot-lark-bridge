import { loadCredentials } from './credentials.js';
import { assertTunnelServiceConfig, readPrivateKey, tunnelLive } from './tunnel-service-auth.js';
import { assertLiveStorage } from './live-storage.js';
import { loadInteractionPolicy, DEFAULT_INTERACTION } from './interaction-policy.js';
import { canonical } from './common.js';
export function validateLiveConfig(config) {
 if (!tunnelLive(config)) return;
 assertTunnelServiceConfig(config);
 if(canonical(loadInteractionPolicy(config.interactionPolicyFile||''))!==canonical(config.interaction??DEFAULT_INTERACTION))throw new Error('Live interaction policy provenance mismatch');
 const paired=loadCredentials(config.credentialsFile,{paired:true});
 for(const [field,key] of Object.entries({appId:'larkAppId',appSecret:'larkAppSecret',tenantKey:'tenantKey',ownerOpenId:'ownerOpenId',ownerChatId:'ownerChatId'})) if(paired[field]!==config[key]) throw new Error('Live paired credential provenance mismatch');
 if(paired.appId!==config.expectedAppId) throw new Error('Approved application mismatch');
 const storage=readPrivateKey(config.storageKeyFile), service=readPrivateKey(config.tunnelServiceKeyFile);
 if(storage===service || Buffer.from(storage,'base64url').toString('base64')!==config.storageKey) throw new Error('Independent live storage key provenance required');
 assertLiveStorage(config);
}
