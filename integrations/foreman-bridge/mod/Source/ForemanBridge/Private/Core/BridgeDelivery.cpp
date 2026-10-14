#include "BridgeDelivery.h"
#include <algorithm>
#include <cmath>
namespace foreman {
namespace {
bool SafeText(const std::string& text) {
    if(text.empty()||text.size()>Limits::MaxChatBytes)return false;
    size_t count=0;
    for(size_t i=0;i<text.size();) {
        const auto first=static_cast<unsigned char>(text[i++]);uint32_t cp=first;unsigned extra=0;
        if(first>=0xc2&&first<=0xdf){cp=first&31;extra=1;}
        else if(first>=0xe0&&first<=0xef){cp=first&15;extra=2;}
        else if(first>=0xf0&&first<=0xf4){cp=first&7;extra=3;}
        else if(first>=128)return false;
        if(i+extra>text.size())return false;
        for(unsigned j=0;j<extra;++j){auto c=static_cast<unsigned char>(text[i++]);if((c&0xc0)!=0x80)return false;cp=(cp<<6)|(c&63);}
        if((extra==1&&cp<128)||(extra==2&&cp<2048)||(extra==3&&cp<65536)||cp>0x10ffff||(cp>=0xd800&&cp<=0xdfff))return false;
        if(cp<32||(cp>=127&&cp<=159)||cp=='<'||cp=='>'||cp==0xad||cp==0x61c||cp==0x6dd||cp==0x70f||cp==0x8e2||cp==0x180e||cp==0xfeff||cp==0x110bd||cp==0x110cd||cp==0xe0001
            ||(cp>=0x600&&cp<=0x605)||(cp>=0x890&&cp<=0x891)||(cp>=0x200b&&cp<=0x200f)||(cp>=0x202a&&cp<=0x202e)||(cp>=0x2060&&cp<=0x2064)||(cp>=0x2066&&cp<=0x206f)||(cp>=0xfff9&&cp<=0xfffb)||(cp>=0x13430&&cp<=0x1343f)||(cp>=0x1bca0&&cp<=0x1bca3)||(cp>=0x1d173&&cp<=0x1d17a)||(cp>=0xe0020&&cp<=0xe007f))return false;
        if(++count>Limits::MaxChatScalars)return false;
    }
    return true;
}
size_t EventBudget(const Event& e) {
    size_t n=1024+e.entityId.size()*6;
    if(e.row){const auto& r=*e.row;n+=(r.entityId.size()+r.actorPath.size()+r.classPath.size())*6;if(r.player)n+=(r.player->platform.size()+r.player->accountId.size()+r.player->displayName.size())*6;}
    return n;
}
}
Delivery::Delivery(State& state,Envelope identity,Provenance provenance,std::function<MonotonicTime()> clock,
    std::function<double()> rng,std::function<std::string()> id,size_t commandCapacity)
    : state_(state),identity_(std::move(identity)),provenance_(std::move(provenance)),clock_(std::move(clock)),rng_(std::move(rng)),id_(std::move(id)),commandCapacity_(commandCapacity) {due_=clock_();}
const char* Delivery::Status() const {return stopped_?"stopped":disabled_?"disabled":attempt_>0?"retrying":hello_?"connecting":!snapshotId_.empty()?"snapshot":"connected";}
void Delivery::Stop(){stopped_=true;pending_.reset();retry_.reset();toPrepare_.reset();prepared_.reset();commands_.clear();chatReady_=false;}
void Delivery::Handshake(MonotonicTime now){pending_.reset();retry_.reset();toPrepare_.reset();prepared_.reset();snapshotId_.clear();commands_.clear();hello_=true;chatReady_=false;identity_.connectionId.clear();due_=now;}
void Delivery::Freeze(){pending_.reset();retry_.reset();prepared_.reset();snapshotId_=id_();toPrepare_=state_.Capture(snapshotId_);watermark_=toPrepare_->watermark;chunk_=0;}
bool Delivery::SnapshotViable() const {return !state_.NeedsNewEpoch()&&state_.RetentionFloor()<=watermark_;}
std::optional<Snapshot> Delivery::TakeSnapshot(){auto result=std::move(toPrepare_);toPrepare_.reset();return result;}
void Delivery::OnPrepared(PreparedSnapshot p){if(stopped_||disabled_||p.snapshotId!=snapshotId_||p.watermark!=watermark_)return;prepared_=std::move(p);}
std::vector<Command> Delivery::TakeCommands(){auto result=std::move(commands_);commands_.clear();return result;}
std::optional<Request> Delivery::Next(MonotonicTime now) {
    if(stopped_||disabled_)return {};
    if(state_.NeedsNewEpoch()){disabled_=true;return {};}
    if(!snapshotId_.empty()&&!SnapshotViable()){Freeze();return {};}
    if(pending_){if(now-sent_>=MonotonicTime(5000))OnFailure(pending_->envelope.requestId,Failure::Retryable,now);else return {};}
    if(now<due_)return {};
    Request q;
    if(retry_){q=*retry_;retry_.reset();}
    else {
        q.envelope=identity_;q.envelope.requestId=id_();
        if(hello_)q.body=Hello{state_.Latest(),state_.Oldest(),provenance_};
        else if(!snapshotId_.empty()) {
            if(!prepared_)return {};
            if(chunk_<prepared_->chunks.size())q.body=SnapshotChunk{snapshotId_,static_cast<uint32_t>(chunk_),prepared_->chunks[chunk_]};
            else q.body=SnapshotCommit{snapshotId_,watermark_,static_cast<uint32_t>(prepared_->chunks.size()),prepared_->rowCount,prepared_->sha256};
        } else {
            auto replay=state_.ReplayAfter(ack_,Limits::MaxBatchEvents);
            if(replay.gap){Freeze();return {};}
            Exchange body;size_t budget=2048;
            for(const auto& e:replay.events){size_t cost=EventBudget(e);if(budget+cost>Limits::MaxBodyBytes)break;body.events.push_back(e);budget+=cost;}
            if(!replay.events.empty()&&body.events.empty()){disabled_=true;return {};}
            for(const auto& result:results_){if(body.commandResults.size()>=128||budget+1024>Limits::MaxBodyBytes)break;body.commandResults.push_back({result.first,result.second});budget+=1024;}
            q.body=std::move(body);
        }
    }
    pending_=q;sent_=now;return q;
}
void Delivery::OnFailure(RequestId requestId,Failure failure,MonotonicTime now) {
    if(stopped_||disabled_||!pending_||pending_->envelope.requestId!=requestId)return;
    if(failure==Failure::Conflict){Handshake(now);return;}
    if(failure==Failure::Auth||failure==Failure::Protocol||failure==Failure::Tls){disabled_=true;pending_.reset();retry_.reset();chatReady_=false;return;}
    retry_=std::move(pending_);pending_.reset();
    const int64_t ceiling=std::min<int64_t>(30000,1000LL<<std::min(attempt_,5u));attempt_=std::min(attempt_+1,6u);
    due_=now+MonotonicTime(static_cast<int64_t>(std::clamp(rng_(),0.0,1.0)*static_cast<double>(ceiling)));
}
void Delivery::OnReply(RequestId requestId,const Reply& r,MonotonicTime now) {
    if(stopped_||disabled_||!pending_||pending_->envelope.requestId!=requestId)return;
    const auto q=*pending_;const auto& a=q.envelope;const auto& b=r.envelope;
    if(b.requestId!=a.requestId||b.serverId!=a.serverId||b.worldId!=a.worldId||b.epoch!=a.epoch||b.connectionId.empty()||(!std::holds_alternative<Hello>(q.body)&&a.connectionId!=b.connectionId))return;
    auto invalid=[&]{OnFailure(requestId,Failure::Protocol,now);};
    if(std::holds_alternative<Hello>(q.body)) {
        const auto* h=std::get_if<HelloReply>(&r.body);if(!h){invalid();return;}
        if(!h->snapshotRequired&&h->cursor>state_.Latest()){invalid();return;}
        identity_.connectionId=b.connectionId;hello_=false;chatReady_=true;
        pending_.reset();retry_.reset();
        if(h->snapshotRequired||state_.ReplayAfter(h->cursor,0).gap)Freeze();
        else {ack_=h->cursor;state_.Acknowledge(ack_);}
    } else if(const auto* chunk=std::get_if<SnapshotChunk>(&q.body)) {
        const auto* response=std::get_if<ChunkReply>(&r.body);if(!response||response->snapshotId!=chunk->snapshotId||response->chunkIndex!=chunk->chunkIndex){invalid();return;}
        if(!SnapshotViable()){Freeze();return;}++chunk_;
    } else if(const auto* commit=std::get_if<SnapshotCommit>(&q.body)) {
        const auto* response=std::get_if<SnapshotReply>(&r.body);if(!response||response->snapshotId!=commit->snapshotId||response->watermark!=commit->watermark){invalid();return;}
        if(!state_.ConfirmSnapshot(commit->snapshotId,commit->watermark)){Freeze();return;}
        ack_=commit->watermark;snapshotId_.clear();prepared_.reset();
    } else {
        const auto* response=std::get_if<ExchangeReply>(&r.body);const auto& sent=std::get<Exchange>(q.body);
        const uint64_t highest=sent.events.empty()?ack_:sent.events.back().seq;
        if(!response||response->ackSeq<ack_||response->ackSeq>highest||response->commands.size()>128){invalid();return;}
        if(response->resyncRequired){Handshake(now);return;}
        if(!state_.Acknowledge(response->ackSeq)){invalid();return;}ack_=response->ackSeq;
        for(const auto& result:sent.commandResults)results_.erase(result.commandId);
        commands_=response->commands;
    }
    pending_.reset();retry_.reset();attempt_=0;due_=now+(std::holds_alternative<Exchange>(q.body)?MonotonicTime(2000):MonotonicTime(0));
}
void Delivery::CheckClock(int64_t utcNow,MonotonicTime now) {
    if(wallClock_) {
        const auto wallDelta=utcNow-wallClock_->first;const auto monoDelta=(now-wallClock_->second).count();
        if(std::abs(static_cast<double>(wallDelta)-static_cast<double>(monoDelta))>5000.0) {
            for(auto& entry:cache_)if(!entry.second.status){entry.second.status=CommandStatus::Expired;results_[entry.first]=CommandStatus::Expired;}
            Handshake(now);
        }
    }
    wallClock_=std::make_pair(utcNow,now);
}
CommandDecision Delivery::AdmitCommand(const Command& c,int64_t utcNow,MonotonicTime now) {
    CheckClock(utcNow,now);
    if(stopped_||disabled_||!chatReady_||c.type!="chat.send"||c.causalSeq==0||c.causalSeq>ack_||c.commandId!=identity_.worldId+"/"+identity_.epoch+"/"+std::to_string(c.causalSeq)+"/chat"||!SafeText(c.text))return CommandDecision::Rejected;
    if(c.expiresAt<=utcNow)return CommandDecision::Expired;
    for(auto it=cache_.begin();it!=cache_.end();) {if(it->second.expiresAt<=utcNow&&!results_.contains(it->first))it=cache_.erase(it);else ++it;}
    if(cache_.contains(c.commandId))return CommandDecision::Duplicate;
    if(cache_.size()>=commandCapacity_||results_.size()>=commandCapacity_)return CommandDecision::Rejected;
    cache_.emplace(c.commandId,Cached{c.expiresAt,{}});return CommandDecision::Dispatch;
}
void Delivery::CompleteCommand(CommandId id,CommandStatus status) {
    if(stopped_||disabled_)return;
    auto found=cache_.find(id);
    if(found!=cache_.end()){if(found->second.status)return;found->second.status=status;}
    if(results_.size()<commandCapacity_)results_.insert_or_assign(std::move(id),status);
}
}
