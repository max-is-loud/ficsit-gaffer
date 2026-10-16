#include "BridgeState.h"
#include "BridgeDelivery.h"
#include "RecaptureQueue.h"
#include <cassert>
#include <iostream>
#include <limits>
#include <string>

using namespace foreman;
static const std::string epoch = "10000000-0000-4000-8000-000000000001";
static const std::string snapshotId = "20000000-0000-4000-8000-000000000001";
static Row MakeRow(std::string id = "30000000-0000-4000-8000-000000000001") {
    Row row; row.entityId = std::move(id); row.actorPath = "Persistent_Level.Constructor_1";
    row.classPath = "/Game/FactoryGame/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C";
    return row;
}
static void seed_upsert_removal() {
    State state(epoch, {}); auto a = MakeRow(); auto b = MakeRow("30000000-0000-4000-8000-000000000002");
    state.Seed({a}); assert(state.Count() == 1 && state.Capture(snapshotId).watermark == 0);
    assert(!state.Upsert(a, Origin::Reconciled));
    auto added = state.Upsert(b, Origin::Placed); assert(added && added->seq == 1 && state.Count() == 2);
    assert(state.Remove(a.entityId)->seq == 2 && state.Count() == 1);
    assert(!state.Remove(a.entityId)); assert(!state.Acknowledge(3));
    assert(state.ReplayAfter(0).events.size() == 2);
    b.transform.position[0] = 42; assert(state.Upsert(b, Origin::Reconciled)->seq == 3);
    assert(state.Count() == 1); state.Seed({a}); // Seeding cannot reset a live epoch.
    assert(state.Count() == 1 && state.Capture(snapshotId).rows[0] == b);
}
static void snapshot_is_immutable() {
    State state(epoch, {}); auto a = MakeRow(); state.Seed({a});
    auto frozen = state.Capture(snapshotId); a.actorPath = "changed"; state.Upsert(a, Origin::Placed); state.Remove(a.entityId);
    assert(frozen.watermark == 0 && frozen.rows.size() == 1 && frozen.rows[0].actorPath == "Persistent_Level.Constructor_1");
    State sorted(epoch, {}); auto b = MakeRow("00000000-0000-4000-8000-000000000000"); sorted.Seed({a,b});
    assert(sorted.Capture(snapshotId).rows[0] == b);
}
static void overflow_requires_snapshot() {
    Limits limits; limits.maxBytes = 128*1024*1024; // Isolate the event-count bound.
    State state(epoch, limits); auto a = MakeRow();
    for (int i=0; i<10000; ++i) { a.transform.position[0] = i; assert(state.Upsert(a, Origin::Placed)); }
    assert(!state.ReplayAfter(0).gap && state.ReplayAfter(0).events.size() == 10000);
    a.transform.position[0] = 10000; state.Upsert(a, Origin::Placed);
    auto replay = state.ReplayAfter(0); assert(replay.gap && replay.events.size() <= 10000);
    assert(state.Count() == 1 && state.Capture(snapshotId).rows[0] == a);
}
static void byte_limit_requires_snapshot() {
    State state(epoch, {}); auto a = MakeRow(); a.actorPath.assign(1024*1024, 'x');
    for (int i=0; i<17; ++i) { a.transform.position[0] = i; state.Upsert(a, Origin::Placed); }
    assert(state.ReplayAfter(0).gap && state.RetainedBytes() <= 16*1024*1024);
    assert(state.Count() == 1 && state.Capture(snapshotId).rows[0] == a);
    a.actorPath.assign(17*1024*1024, 'x'); state.Upsert(a, Origin::Placed);
    assert(state.RetainedBytes() <= 16*1024*1024 && state.ReplayAfter(17).gap);
}
static void ack_releases_only_prefix() {
    State state(epoch, {}); auto a=MakeRow(); state.Upsert(a, Origin::Placed);
    a.transform.position[0]=1; state.Upsert(a, Origin::Placed); a.transform.position[0]=2; state.Upsert(a, Origin::Placed);
    auto before=state.RetainedBytes(); assert(!state.Acknowledge(4)); assert(state.RetainedBytes()==before);
    assert(state.Acknowledge(1)); auto remaining=state.ReplayAfter(1);
    assert(!remaining.gap && remaining.events.size()==2 && remaining.events[0].seq==2);
    assert(state.RetainedBytes()<before && state.ReplayAfter(0).gap);
    assert(state.Acknowledge(0)); assert(state.ReplayAfter(1).events.size()==2);
    assert(state.Acknowledge(3) && state.RetainedBytes()==0); assert(state.ReplayAfter(4).gap);
}
static void new_epoch_starts_empty() {
    State old(epoch, {}); old.Upsert(MakeRow(), Origin::Placed);
    State fresh("10000000-0000-4000-8000-000000000002", {});
    assert(fresh.Count()==0 && fresh.Capture(snapshotId).watermark==0);
    assert(!fresh.ConfirmSnapshot(snapshotId,1)); assert(fresh.Upsert(MakeRow(),Origin::Placed)->seq==1);
}
static void sequence_does_not_wrap() {
    Sequence sequence(std::numeric_limits<uint64_t>::max()-1);
    assert(sequence.Next()==std::numeric_limits<uint64_t>::max()); assert(!sequence.Next()); assert(!sequence.Next());
    Limits limits; limits.maxSequence=2; State state(epoch,limits); auto a=MakeRow();
    assert(state.Upsert(a,Origin::Placed)->seq==1); a.transform.position[0]=1; assert(state.Upsert(a,Origin::Placed)->seq==2);
    a.transform.position[0]=2; assert(!state.Upsert(a,Origin::Placed));
    assert(state.NeedsNewEpoch() && state.ReplayAfter(2).gap && state.Capture(snapshotId).rows[0]==a);
    assert(!state.ConfirmSnapshot(snapshotId,2)); assert(!state.Remove(a.entityId) && state.Count()==0);
}
static void snapshot_ack_clears_only_covered_gap() {
    Limits limits; limits.maxEvents=2; State state(epoch,limits); auto a=MakeRow();
    for(int i=0;i<3;++i) { a.transform.position[0]=i; state.Upsert(a,Origin::Placed); }
    auto frozen=state.Capture(snapshotId); assert(!state.ConfirmSnapshot("wrong",3)); assert(!state.ConfirmSnapshot(snapshotId,2));
    a.transform.position[0]=3; state.Upsert(a,Origin::Placed);
    assert(state.ConfirmSnapshot(snapshotId,frozen.watermark)); auto replay=state.ReplayAfter(3);
    assert(!replay.gap && replay.events.size()==1 && replay.events[0].seq==4);
    frozen=state.Capture(snapshotId);
    for(int i=4;i<7;++i) { a.transform.position[0]=i; state.Upsert(a,Origin::Placed); }
    assert(!state.ConfirmSnapshot(snapshotId,frozen.watermark));
    auto replacement=state.Capture("replacement"); assert(!state.ConfirmSnapshot(snapshotId,frozen.watermark));
    assert(state.ConfirmSnapshot("replacement",replacement.watermark)); assert(!state.ReplayAfter(7).gap);
}
static void reconfigure_skips_untracked_and_unchanged() {
    State state(epoch, {}); auto a = MakeRow(); state.Seed({a});
    // drain skips untracked entity: an unknown id emits nothing and allocates no sequence.
    assert(!state.Reconfigure(MakeRow("30000000-0000-4000-8000-000000000099")) && state.Latest() == 0 && state.Count() == 1);
    assert(!state.Reconfigure(a) && state.Latest() == 0);
    std::get<ManufacturerConfig>(a.config).recipe = "/Game/Recipes/Recipe_IronPlate.Recipe_IronPlate_C";
    auto changed = state.Reconfigure(a);
    assert(changed && changed->seq == 1 && changed->origin == Origin::Reconfigured && changed->type == EventType::Upsert);
    assert(state.Capture(snapshotId).rows[0] == a);
}
static void config_strings_count_towards_retained_bytes() {
    State plain(epoch, {}); State configured(epoch, {}); auto a = MakeRow(); auto b = MakeRow();
    std::get<ManufacturerConfig>(b.config).recipe = std::string(4096, 'r');
    plain.Upsert(a, Origin::Placed); configured.Upsert(b, Origin::Placed);
    assert(configured.RetainedBytes() >= plain.RetainedBytes() + 4096*6);
}
static int TestDelivery();
static int TestRecapture();
int main(int argc, char** argv) {
    if(argc==2 && std::string(argv[1])=="Delivery") return TestDelivery();
    if(argc==2 && std::string(argv[1])=="Recapture") return TestRecapture();
    if(argc!=2 || std::string(argv[1])!="State") { std::cerr<<"Unknown suite\n"; return 2; }
#define RUN(test) test(); std::cout << #test << " PASS\n";
    RUN(seed_upsert_removal) RUN(snapshot_is_immutable) RUN(overflow_requires_snapshot)
    RUN(byte_limit_requires_snapshot) RUN(ack_releases_only_prefix) RUN(new_epoch_starts_empty)
    RUN(sequence_does_not_wrap) RUN(snapshot_ack_clears_only_covered_gap)
    RUN(reconfigure_skips_untracked_and_unchanged) RUN(config_strings_count_towards_retained_bytes)
    std::cout<<"PASS: 10 State cases\n";
}
struct DeliveryHarness {
    State state;
    int64_t now=0;
    unsigned ids=0;
    Delivery delivery;
    DeliveryHarness(Limits limits={}, size_t cap=10000) : state(epoch,limits),
        delivery(state, {"server","world",epoch,"",""}, {}, [this]{return MonotonicTime(now);},
            []{return 0.5;}, [this]{return "request-"+std::to_string(++ids);},cap) {}
    std::optional<Request> Next(int64_t at) {now=at;return delivery.Next(MonotonicTime(now));}
    void Answer(const Request& q, Reply reply) {delivery.OnReply(q.envelope.requestId,reply,MonotonicTime(now));}
    Reply Wrap(const Request& q) {Reply r;r.envelope=q.envelope;r.envelope.connectionId="connection";return r;}
    void Hello(bool snapshot=false) {auto q=Next(now);assert(q&&std::holds_alternative<foreman::Hello>(q->body));auto r=Wrap(*q);r.body=HelloReply{snapshot,0,"baseline"};Answer(*q,r);}
    Request Prepare() {auto frozen=delivery.TakeSnapshot();assert(frozen);PreparedSnapshot p;p.snapshotId=frozen->snapshotId;p.watermark=frozen->watermark;p.rowCount=static_cast<uint32_t>(frozen->rows.size());p.sha256="hash";delivery.OnPrepared(std::move(p));auto q=Next(now);assert(q&&std::holds_alternative<SnapshotCommit>(q->body));return *q;}
};
static void delivery_schedule_and_timeout() {
    DeliveryHarness h;auto hello=h.Next(0);assert(hello);assert(!h.Next(4999));assert(!h.Next(5000));
    assert(!h.Next(5499));auto retry=h.Next(5500);assert(retry&&retry->envelope.requestId==hello->envelope.requestId);
    auto reply=h.Wrap(*retry);reply.body=HelloReply{};h.Answer(*retry,reply);
    auto q=h.Next(5500);assert(q&&std::holds_alternative<foreman::Exchange>(q->body));reply=h.Wrap(*q);reply.body=ExchangeReply{};h.Answer(*q,reply);
    assert(!h.Next(7499));q=h.Next(7500);assert(q);
    h.delivery.OnFailure(q->envelope.requestId,Failure::Retryable,MonotonicTime(7500));assert(!h.Next(7999));assert(h.Next(8000));
}
static void delivery_backoff_and_disable() {
    DeliveryHarness h;int64_t now=0;
    for(int i=0;i<9;++i) {auto q=h.Next(now);assert(q);h.delivery.OnFailure(q->envelope.requestId,Failure::Retryable,MonotonicTime(now));auto delay=std::min<int64_t>(30000,1000LL<<std::min(i,5))/2;assert(!h.Next(now+delay-1));now+=delay;}
    auto q=h.Next(now);assert(q);h.delivery.OnFailure(q->envelope.requestId,Failure::Auth,MonotonicTime(now));assert(!h.Next(now+999999));
    for(auto failure:{Failure::Protocol,Failure::Tls}) {DeliveryHarness x;auto request=x.Next(0);x.delivery.OnFailure(request->envelope.requestId,failure,MonotonicTime(0));assert(x.delivery.Disabled()&&!x.Next(999999));}
}
static void delivery_ack_and_stale_callbacks() {
    DeliveryHarness h;h.state.Upsert(MakeRow(),Origin::Placed);auto q=h.Next(0);auto r=h.Wrap(*q);r.body=HelloReply{false,2,""};h.Answer(*q,r);assert(h.state.RetainedBytes()>0&&h.delivery.Disabled());
    DeliveryHarness x;x.Hello();x.state.Upsert(MakeRow(),Origin::Placed);auto e=x.Next(0);auto a=x.Wrap(*e);a.body=ExchangeReply{1,{},{}};
    a.envelope.epoch="old";x.Answer(*e,a);assert(x.state.RetainedBytes()>0);
    a.envelope.epoch=epoch;a.envelope.connectionId="old";x.Answer(*e,a);assert(x.state.RetainedBytes()>0);
    a.envelope.connectionId="connection";x.delivery.OnReply("old-request",a,MonotonicTime(0));assert(x.state.RetainedBytes()>0);
    x.delivery.Stop();x.Answer(*e,a);assert(x.state.RetainedBytes()>0&&!x.Next(10000));
}
static void delivery_snapshot_replay_and_overflow() {
    DeliveryHarness h;h.state.Upsert(MakeRow(),Origin::Placed);h.Hello(true);auto q=h.Prepare();auto snap=std::get<SnapshotCommit>(q.body);
    auto row=MakeRow();row.actorPath="changed";h.state.Upsert(row,Origin::Placed);
    auto reply=h.Wrap(q);reply.body=SnapshotReply{snap.snapshotId,snap.watermark};h.Answer(q,reply);
    auto next=h.Next(0);assert(next);auto events=std::get<foreman::Exchange>(next->body).events;assert(events.size()==1&&events[0].seq==2);
    Limits limits;limits.maxEvents=1;DeliveryHarness x(limits);x.Hello(true);auto old=x.Prepare();auto s=std::get<SnapshotCommit>(old.body);
    x.state.Upsert(MakeRow(),Origin::Placed);x.state.Remove(MakeRow().entityId);assert(!x.Next(1));
    auto late=x.Wrap(old);late.body=SnapshotReply{s.snapshotId,s.watermark};x.Answer(old,late);assert(x.delivery.LastAck()==0);
    auto replacement=x.Prepare();assert(std::get<SnapshotCommit>(replacement.body).watermark==2);
}
static void delivery_conflict_rehandshakes() {
    DeliveryHarness h;h.Hello();auto q=h.Next(0);h.delivery.OnFailure(q->envelope.requestId,Failure::Conflict,MonotonicTime(0));auto next=h.Next(0);assert(next&&std::holds_alternative<foreman::Hello>(next->body));
}
static Command Chat(uint64_t seq=1) {return {"world/"+epoch+"/"+std::to_string(seq)+"/chat",seq,"chat.send","Foreman bridge: constructor recorded.",31000};}
static void delivery_command_lifecycle() {
    DeliveryHarness h({},1);h.state.Upsert(MakeRow(),Origin::Placed);h.state.Remove(MakeRow().entityId);h.Hello();auto q=h.Next(0);auto r=h.Wrap(*q);r.body=ExchangeReply{2,{Chat()}, {}};h.Answer(*q,r);
    auto commands=h.delivery.TakeCommands();assert(commands.size()==1);
    assert(h.delivery.AdmitCommand(commands[0],1000,MonotonicTime(0))==CommandDecision::Dispatch);
    assert(h.delivery.AdmitCommand(commands[0],1001,MonotonicTime(1))==CommandDecision::Duplicate);
    auto other=Chat(2);assert(h.delivery.AdmitCommand(other,1001,MonotonicTime(1))==CommandDecision::Rejected);
    h.delivery.CompleteCommand(commands[0].commandId,CommandStatus::Skipped);
    assert(h.delivery.AdmitCommand(commands[0],1002,MonotonicTime(2))==CommandDecision::Duplicate);
    assert(h.delivery.AdmitCommand(commands[0],31000,MonotonicTime(30000))==CommandDecision::Expired);
    auto invalid=Chat();invalid.type="console";assert(h.delivery.AdmitCommand(invalid,1003,MonotonicTime(3))==CommandDecision::Rejected);
    invalid=Chat();invalid.text.assign(513,'a');assert(h.delivery.AdmitCommand(invalid,1003,MonotonicTime(3))==CommandDecision::Rejected);
    invalid=Chat();invalid.text="<b>hello</b>";assert(h.delivery.AdmitCommand(invalid,1003,MonotonicTime(3))==CommandDecision::Rejected);
}
static void delivery_status_reports_retry_until_valid_success() {
    for(bool backlog:{false,true}) {
        DeliveryHarness h;h.Hello();if(backlog)h.state.Upsert(MakeRow(),Origin::Placed);
        auto q=h.Next(0);assert(q);h.delivery.OnFailure(q->envelope.requestId,Failure::Retryable,MonotonicTime(0));
        assert(std::string(h.delivery.Status())=="retrying");
        auto retry=h.Next(500);assert(retry);assert(std::string(h.delivery.Status())=="retrying");
        auto reply=h.Wrap(*retry);reply.body=ExchangeReply{backlog?1u:0u,{},{}};h.Answer(*retry,reply);
        assert(std::string(h.delivery.Status())=="connected");
        auto next=h.Next(2500);assert(next);assert(!h.Next(7500));assert(std::string(h.delivery.Status())=="retrying");
        h.Answer(*next,reply);assert(std::string(h.delivery.Status())=="retrying");
        auto recovery=h.Next(8000);assert(recovery);reply=h.Wrap(*recovery);reply.body=ExchangeReply{backlog?1u:0u,{},{}};h.Answer(*recovery,reply);
        assert(std::string(h.delivery.Status())=="connected");
    }
}
static void delivery_clock_jump_retains_evidence() {
    DeliveryHarness h;h.Hello();h.state.Upsert(MakeRow(),Origin::Placed);h.delivery.CheckClock(1000,MonotonicTime(0));
    h.delivery.CheckClock(8000,MonotonicTime(1));assert(h.state.RetainedBytes()>0);auto q=h.Next(1);assert(q&&std::holds_alternative<foreman::Hello>(q->body));
    assert(h.delivery.AdmitCommand(Chat(),8000,MonotonicTime(1))==CommandDecision::Rejected);
}
static int TestDelivery() {
    RUN(delivery_schedule_and_timeout) RUN(delivery_backoff_and_disable) RUN(delivery_ack_and_stale_callbacks)
    RUN(delivery_snapshot_replay_and_overflow) RUN(delivery_conflict_rehandshakes)
    RUN(delivery_command_lifecycle) RUN(delivery_clock_jump_retains_evidence) RUN(delivery_status_reports_retry_until_valid_success)
    std::cout<<"PASS: 8 Delivery cases\n";return 0;
}
static void recapture_deduplicates_repeated_requests() {
    RecaptureQueue queue(64);
    for (int i=0; i<100; ++i) { queue.Request("a", MonotonicTime(0)); }
    assert(queue.Pending() == 1);
    auto drained = queue.Drain(MonotonicTime(0)); assert(drained.size() == 1 && drained[0] == "a" && queue.Pending() == 0);
}
static void recapture_keeps_earliest_due_time() {
    RecaptureQueue queue(64); queue.Request("a", MonotonicTime(5000)); queue.Request("a", MonotonicTime(1000));
    assert(queue.Drain(MonotonicTime(999)).empty());
    assert(queue.Drain(MonotonicTime(1000)).size() == 1);
}
static void recapture_holds_entries_not_yet_due() {
    RecaptureQueue queue(64); queue.Request("late", MonotonicTime(2000)); queue.Request("now", MonotonicTime(0));
    auto drained = queue.Drain(MonotonicTime(10)); assert(drained == std::vector<std::string>{"now"} && queue.Pending() == 1);
}
static void recapture_caps_each_drain_in_due_order() {
    RecaptureQueue queue(2);
    for (int i=4; i>=0; --i) { queue.Request("e"+std::to_string(i), MonotonicTime(i)); }
    assert((queue.Drain(MonotonicTime(10)) == std::vector<std::string>{"e0","e1"}));
    assert((queue.Drain(MonotonicTime(10)) == std::vector<std::string>{"e2","e3"}));
    assert((queue.Drain(MonotonicTime(10)) == std::vector<std::string>{"e4"}));
}
static void recapture_forget_removes_pending() {
    RecaptureQueue queue(64); queue.Request("a", MonotonicTime(0)); queue.Forget("a"); queue.Forget("absent");
    assert(queue.Pending() == 0 && queue.Drain(MonotonicTime(0)).empty());
}
static int TestRecapture() {
    RUN(recapture_deduplicates_repeated_requests) RUN(recapture_keeps_earliest_due_time)
    RUN(recapture_holds_entries_not_yet_due) RUN(recapture_caps_each_drain_in_due_order) RUN(recapture_forget_removes_pending)
    std::cout<<"PASS: 5 Recapture cases\n";
    return 0;
}
