import { randomUUID } from 'node:crypto';
import { BridgeError, hash, plainText } from './common.js';
import { MAX_REPLY_TEXT, routeAllowed } from './interaction-policy.js';
import { createInteractionsApi } from './lark-interactions-api.js';

const TERMINAL = new Set(['sent','dead','expired','uncertain','cancelled']);
const STREAM_TERMINAL = new Set(['uncertain','failed','cancelled','expired','complete']);
export function createStreamRows(store,id,now) {
  if(store.get('SELECT message_id FROM reply_streams WHERE message_id=?',id))return;
  store.run('INSERT INTO reply_streams(message_id,payload,state) VALUES (?,?,?)',id,store.vault.seal({cardId:null,outboundId:null,text:'',final:false,phase:'idle',modelStarted:false,apiSequence:0},`stream:${id}`),'pending');
  const message=store.get('SELECT subscription_id FROM messages WHERE id=?',id);
  store.run('INSERT INTO jobs(id,kind,message_id,subscription_id,next_at) VALUES (?,?,?,?,?)',`stream:${id}`,'stream',id,message.subscription_id,now);
}
export function finalizeStream(store,id,text,now) {
  const row=store.get('SELECT * FROM reply_streams WHERE message_id=?',id);if(!row)return;
  const payload=store.vault.open(row.payload,`stream:${id}`);
  if(STREAM_TERMINAL.has(row.state))throw new BridgeError('Reply card cannot be safely resumed');
  payload.text=text;payload.final=true;
  store.run('UPDATE reply_streams SET payload=?,sequence=sequence+1,state=? WHERE message_id=?',store.vault.seal(payload,`stream:${id}`),'pending',id);
  store.run("UPDATE jobs SET state='pending',next_at=? WHERE id=? AND state NOT IN ('processing','uncertain')",now,`stream:${id}`);
}

export class InteractionState {
  constructor(bridge){this.bridge=bridge;this.store=bridge.store;this.config=bridge.config;this.clock=bridge.clock;this.api=createInteractionsApi(this.config,bridge.send,bridge.sendLark,this.clock);this.feedbackRunning=false;this.currentFeedback=null;}
  stream(id){const row=this.store.get('SELECT * FROM reply_streams WHERE message_id=?',id);return row?{...row,...this.store.vault.open(row.payload,`stream:${id}`)}:null;}
  updateStream(id,fn){return this.store.tx(()=>{const row=this.stream(id);if(!row)throw new BridgeError('Reply card unavailable');fn(row);const payload={cardId:row.cardId,outboundId:row.outboundId,text:row.text,final:row.final,phase:row.phase,modelStarted:row.modelStarted??false,apiSequence:row.apiSequence??0};this.store.run('UPDATE reply_streams SET payload=?,state=?,sequence=?,applied_sequence=? WHERE message_id=?',this.store.vault.seal(payload,`stream:${id}`),row.state,row.sequence,row.applied_sequence,id);return row;});}
  nextCardSequence(id){return this.updateStream(id,row=>{row.apiSequence=(row.apiSequence??0)+1;}).apiSequence;}
  begin(message){
    if(!this.config.interaction?.streaming)throw new BridgeError('Reply cards are not enabled');
    const old=this.store.replyStatus(message.id);if(old.status!=='none')return old;
    this.store.tx(()=>createStreamRows(this.store,message.id,this.clock()));
    const stream=this.stream(message.id);
    if(!stream.modelStarted){this.updateStream(message.id,row=>{row.modelStarted=true;row.applied_sequence=-1;row.state='pending';});this.store.run("UPDATE jobs SET state='pending',next_at=? WHERE id=? AND state NOT IN ('processing','uncertain')",this.clock(),`stream:${message.id}`);}
    return {message_id:message.id,status:'processing',error:null};
  }
  append(message,sequence,text){
    if(!this.config.interaction?.streaming)throw new BridgeError('Reply cards are not enabled');plainText(text,5000);
    this.store.tx(()=>{
      const old=this.store.get('SELECT digest FROM reply_chunks WHERE message_id=? AND sequence=?',message.id,sequence);
      if(old){if(old.digest!==hash(text))throw new BridgeError('Different text for the same reply sequence');return;}
      const row=this.stream(message.id);if(!row||row.final||STREAM_TERMINAL.has(row.state))throw new BridgeError('Reply card cannot accept more text');
      if(!Number.isInteger(sequence)||sequence<1||sequence>100||sequence!==row.sequence+1)throw new BridgeError('Reply sequence is not consecutive');
      plainText(row.text+text,MAX_REPLY_TEXT);row.text+=text;
      this.store.run('INSERT INTO reply_chunks VALUES (?,?,?)',message.id,sequence,hash(text));
      this.store.run('UPDATE reply_streams SET payload=?,sequence=?,state=? WHERE message_id=?',this.store.vault.seal({cardId:row.cardId,outboundId:row.outboundId,text:row.text,final:false,phase:row.phase,modelStarted:true,apiSequence:row.apiSequence??0},`stream:${message.id}`),sequence,'pending',message.id);
      this.store.run("UPDATE jobs SET state='pending',next_at=? WHERE id=? AND state NOT IN ('processing','uncertain')",this.clock(),`stream:${message.id}`);
    });
    return {message_id:message.id,status:'processing',error:null};
  }
  async runStream(job){
    let stream=this.stream(job.message_id);if(!stream)throw new BridgeError('Reply card unavailable');
    if(['uncertain','failed','cancelled','expired'].includes(stream.state))throw new BridgeError('Reply card cannot be safely resumed',{uncertain:stream.state==='uncertain'});
    if(stream.state==='complete')return stream.outboundId;
    this.bridge.authorizeJob(job);const message=this.store.message(job.message_id),authorize=()=>this.bridge.authorizeJob(job);
    const text=stream.text||'消息已接收。';const state=stream.final?'complete':stream.text?'generating':stream.modelStarted?'processing':'waiting';
    try{
      if(!stream.cardId){
        this.updateStream(message.id,row=>{row.phase='create_started';});
        const cardId=await this.api.createCard(text,state,authorize);
        this.updateStream(message.id,row=>{row.cardId=cardId;row.phase='card_created';});stream=this.stream(message.id);
      }
      if(!stream.outboundId){
        this.updateStream(message.id,row=>{row.phase='send_started';});
        const outboundId=await this.api.replyCard(message,stream.cardId,authorize);
        this.updateStream(message.id,row=>{row.outboundId=outboundId;row.phase='sent';row.applied_sequence=-1;});stream=this.stream(message.id);
      }
      if(stream.applied_sequence<stream.sequence){
        const snapshot={...stream};this.updateStream(message.id,row=>{row.phase='update_started';});
        await this.api.updateCard(stream.cardId,snapshot.text||'消息已接收。',snapshot.final?'complete':snapshot.text?'generating':snapshot.modelStarted?'processing':'waiting',this.nextCardSequence(message.id),authorize);
        this.updateStream(message.id,row=>{
          row.applied_sequence=Math.max(row.applied_sequence,snapshot.sequence);row.phase='updated';
          // An on-wire positive final acknowledgement is authoritative. An old
          // progress update cannot reopen a card closed by expiry or revocation.
          if(snapshot.final)row.state='complete';
          else if(!STREAM_TERMINAL.has(row.state))row.state=row.sequence>snapshot.sequence?'pending':'active';
        });
        if(snapshot.final)this.store.recordReplyAck({id:`reply:${message.id}`,message_id:message.id},stream.outboundId);
      }
      return stream.outboundId;
    }catch(error){if(error.uncertain)this.updateStream(message.id,row=>{if(row.state!=='complete')row.state='uncertain';});throw error;}
  }
  async runMedia(job,plan){
    this.bridge.authorizeJob(job);const message=this.store.message(job.message_id),authorize=()=>this.bridge.authorizeJob(job);
    const priorStream=this.stream(message.id);
    if(priorStream&&STREAM_TERMINAL.has(priorStream.state))throw new BridgeError('Reply card cannot accept a media answer',{uncertain:priorStream.state==='uncertain'});
    let current={...plan};
    if(!current.uploadedKey){
      let media;
      if(current.attachmentIndex!==undefined)media=await this.api.attachment(message,current.attachmentIndex,authorize);
      else media={bytes:Buffer.from(current.data,'base64'),mime:current.mimeType,item:{type:current.type,name:current.name}};
      try{
        const name=media.item.name||(media.item.type==='image'?'image.png':media.item.type==='audio'?'voice.ogg':'attachment.bin');
        const uploadedKey=await this.api.upload(media.item.type,media.bytes,name,authorize);
        current={...current,type:media.item.type,uploadedKey};
        this.store.run('UPDATE reply_details SET payload=? WHERE message_id=?',this.store.vault.seal(current,`reply-details:${message.id}`),message.id);
      }finally{media.bytes.fill(0);}
    }
    const stream=this.stream(message.id);
    const outboundId=await this.api.replyMedia(message,current.type,current.uploadedKey,authorize,!!stream?.outboundId);
    this.store.recordReplyAck(job,outboundId);
    if(stream?.cardId){
      try{const text=current.caption??'已发送'+({image:'图片',file:'文件',audio:'语音'}[current.type]);await this.api.updateCard(stream.cardId,text,'complete',this.nextCardSequence(message.id),authorize);this.updateStream(message.id,row=>{row.text=text;row.state='complete';row.final=true;});}catch{/* The positive media acknowledgement remains authoritative. */}
    }
    return outboundId;
  }
  authorizeIndicator(message,remove=false){
    if(message.principal!==this.config.principal||!routeAllowed(this.config,message))throw new BridgeError('Indicator scope revoked',{code:-32012});
    if(!remove){const sub=this.store.subscription(message.subscription_id);if(!sub?.active||sub.expires<=this.clock()||message.expires<=this.clock()||sub.generation!==message.generation)throw new BridgeError('Indicator scope inactive',{code:-32012});}
  }
  async tickFeedback(){
    if(this.feedbackRunning)return;this.feedbackRunning=true;
    try{
      const now=this.clock();
      this.store.run("UPDATE feedback SET state='uncertain',lease_token=NULL WHERE state='working' AND lease_until<=?",now);
      const row=this.store.get("SELECT * FROM feedback WHERE state IN ('pending','active','uncertain') AND next_at<=? ORDER BY next_at,rowid LIMIT 1",now);if(!row)return;
      const message=this.store.message(row.message_id);if(!message)return;
      const status=this.store.replyStatus(message.id).status,event=this.store.get("SELECT state FROM jobs WHERE kind='event' AND message_id=?",message.id)?.state;
      const terminalCondition=TERMINAL.has(status)||['dead','uncertain','cancelled','expired'].includes(event)||message.expires<=now||!this.store.activeSubscription(now)||!this.config.interaction?.enabled;
      const remove=terminalCondition||!this.config.interaction?.reactions;
      const data=this.store.vault.open(row.payload,`feedback:${message.id}`);if(row.state==='uncertain')data.uncertain=true;
      const token=randomUUID();this.store.run("UPDATE feedback SET state='working',lease_until=?,lease_token=?,attempts=attempts+1 WHERE message_id=?",now+60000,token,message.id);
      try{
        const authorize=()=>this.authorizeIndicator(message,remove);
        authorize();
        const stream=this.stream(message.id);
        if(terminalCondition&&stream?.cardId&&stream.outboundId&&stream.state!=='complete'){
          const terminal=status==='sent'?'complete':status==='uncertain'||event==='uncertain'?'uncertain':message.expires<=now?'expired':status==='cancelled'||event==='cancelled'||!this.store.activeSubscription(now)||!this.config.interaction?.enabled?'cancelled':'failed';
          const label={complete:'已完成。',uncertain:'发送结果不确定，请勿重发。',expired:'未能在处理期限内完成，请重新发送一条新消息。',cancelled:'处理已取消。',failed:'处理失败，请发送一条新消息重试。'}[terminal];
          try{
            await this.api.updateCard(stream.cardId,stream.text||label,terminal,this.nextCardSequence(message.id),authorize);
            this.updateStream(message.id,item=>{if(item.state!=='complete')item.state=terminal;});
          }catch(error){
            if(error.code===-32012)throw error;
            // Retrying a cosmetic update to a known card never sends another reply.
            throw new BridgeError('Card status update unavailable',{retryable:true});
          }
        }
        if(data.uncertain){data.reactionId=await this.api.findTyping(message,authorize);data.uncertain=false;}
        if(remove){if(data.reactionId)await this.api.removeTyping(message,data.reactionId,authorize);data.reactionId=null;data.applied=null;}
        else if(!data.reactionId&&this.config.interaction?.reactions){data.reactionId=await this.api.addTyping(message,authorize);data.applied='Typing';}
        this.store.run('UPDATE feedback SET payload=?,state=?,next_at=?,lease_token=NULL,lease_until=NULL WHERE message_id=? AND lease_token=?',this.store.vault.seal(data,`feedback:${message.id}`),terminalCondition?'done':'active',now+5000,message.id,token);
      }catch(error){
        if(error.uncertain)data.uncertain=true;
        const state=error.code===-32012?'cancelled':row.attempts>=4?'failed':data.uncertain?'uncertain':error.retryable?'pending':'failed';
        this.store.run('UPDATE feedback SET payload=?,state=?,next_at=?,lease_token=NULL,lease_until=NULL WHERE message_id=? AND lease_token=?',this.store.vault.seal(data,`feedback:${message.id}`),state,now+5000,message.id,token);
      }
    }finally{this.feedbackRunning=false;}
  }
}
