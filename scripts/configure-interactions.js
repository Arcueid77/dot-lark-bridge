import {readConfig} from '../src/config.js';
import {createFormalServiceSender} from '../src/formal-sender.js';
import {readPrivateJson,writePrivateJson,assertPrivateDestination} from '../src/private-files.js';
import {validateInteractionPolicy} from '../src/interaction-policy.js';
import {interactionOperator,safePolicyStatus} from '../src/interaction-operator.js';

try{
  const [command,...args]=process.argv.slice(2);
  let result;
  if(command==='validate'&&args.length===1)result=safePolicyStatus(validateInteractionPolicy(readPrivateJson(args[0])));
  else if(command==='set-groups'&&args.length===4&&args[3]==='--confirm-private-storage'){
    const base=readPrivateJson(args[0]),input=readPrivateJson(args[1]);
    if(!input||Object.keys(input).some(key=>!['groups','group_mentions'].includes(key))||!Array.isArray(input.groups))throw new Error();
    const value={...base,...input};const normalized=validateInteractionPolicy(value);
    assertPrivateDestination(args[2]);writePrivateJson(args[2],value);result={saved:true,...safePolicyStatus(normalized)};
  }else{
    const config=readConfig();
    if(config.authMode!=='tunnel-service'||config.tunnelServiceOperation!=='live'||config.callbackTransportMode!=='standard')throw new Error();
    const operator=interactionOperator(config,createFormalServiceSender(config));
    if(command==='permissions'&&args.length===1&&args[0]==='--confirm-remote-read')result=await operator.inventory();
    else if(['prepare','group-catalog'].includes(command)&&args.length===3&&args[1]==='--confirm-private-storage'&&args[2]==='--confirm-remote-read'){
      assertPrivateDestination(args[0]);const value=command==='prepare'?await operator.preparePolicy():await operator.groupCatalog();writePrivateJson(args[0],value);
      result=command==='prepare'?{saved:true,...safePolicyStatus(validateInteractionPolicy(value))}:{saved:true,groups:value.groups.length};
    }else throw new Error();
  }
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch{
  process.stderr.write('Interaction configuration refused. Use validate FILE; permissions --confirm-remote-read; prepare|group-catalog NEW_PRIVATE_FILE --confirm-private-storage --confirm-remote-read; set-groups POLICY PRIVATE_GROUP_RULES NEW_PRIVATE_FILE --confirm-private-storage. No identities or credentials were printed.\n');process.exitCode=1;
}
