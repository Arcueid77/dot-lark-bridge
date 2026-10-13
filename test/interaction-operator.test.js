import test from 'node:test';
import assert from 'node:assert/strict';
import {config} from './helpers.js';
import {interactionOperator,safePolicyStatus} from '../src/interaction-operator.js';
import {validateInteractionPolicy} from '../src/interaction-policy.js';

test('operator inventory is read-only, uses tenant grants and never prints returned credentials or identity fields',async()=>{
  const seen=[];
  const send=async(url,options)=>{
    seen.push({url,method:options.method??'POST'});
    const ok=data=>({status:200,body:Buffer.from(JSON.stringify(data))});
    if(url.endsWith('/tenant_access_token/internal'))return ok({code:0,tenant_access_token:'synthetic-token',expire:7200});
    if(url.includes('/application/v6/applications/'))return ok({code:0,data:{app:{secret:'credential-canary',owner:{owner_id:'identity-canary'},scopes:[{scope:'im:resource',token_types:['tenant']}]}}});
    if(url.endsWith('/application/v6/scopes'))return ok({code:0,data:{scopes:[{scope_name:'im:resource',scope_type:'tenant',grant_status:1}]}});
    if(url.endsWith('/bot/v3/info'))return ok({code:0,bot:{open_id:'synthetic-bot'}});
    throw new Error('Unexpected route');
  };
  const operator=interactionOperator(config(),send),inventory=await operator.inventory();
  assert.equal(inventory.permissions.find(scope=>scope.name==='im:resource').configured,true);
  assert.equal(inventory.permissions.find(scope=>scope.name==='im:message.group_msg').configured,false);
  assert.equal(JSON.stringify(inventory).includes('canary'),false);
  const policy=await operator.preparePolicy();assert.equal(policy.bot_open_id,'synthetic-bot');assert.equal(policy.groups.length,0);assert.equal(policy.group_mentions.enabled,false);
  const safe=safePolicyStatus(validateInteractionPolicy(policy));assert.equal(JSON.stringify(safe).includes('synthetic-bot'),false);
  assert.ok(seen.every(item=>item.method==='GET'||item.url.endsWith('/tenant_access_token/internal')));
});
