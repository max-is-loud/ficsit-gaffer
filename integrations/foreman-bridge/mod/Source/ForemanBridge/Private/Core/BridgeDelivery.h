#pragma once
#include "BridgeState.h"
#include <functional>
#include <map>
namespace foreman {
enum class Failure { Retryable, Auth, Protocol, Tls, Conflict };
enum class CommandDecision { Dispatch, Duplicate, Expired, Rejected };
struct PreparedSnapshot {
    std::string snapshotId;
    uint64_t watermark=0;
    uint32_t rowCount=0;
    std::vector<std::string> chunks;
    std::string sha256;
};
class Delivery {
public:
    Delivery(State& state, Envelope identity, Provenance provenance,
        std::function<MonotonicTime()> clock, std::function<double()> rng,
        std::function<std::string()> id, size_t commandCapacity=10000);
    std::optional<Request> Next(MonotonicTime now);
    void OnReply(RequestId requestId, const Reply& reply, MonotonicTime now);
    void OnFailure(RequestId requestId, Failure failure, MonotonicTime now);
    void Stop();
    CommandDecision AdmitCommand(const Command& command, int64_t utcNow, MonotonicTime now);
    void CompleteCommand(CommandId id, CommandStatus status);
    void CheckClock(int64_t utcNow, MonotonicTime now);
    std::optional<Snapshot> TakeSnapshot();
    void OnPrepared(PreparedSnapshot prepared);
    std::vector<Command> TakeCommands();
    uint64_t LastAck() const { return ack_; }
    bool Disabled() const { return disabled_; }
    const char* Status() const;
private:
    void Handshake(MonotonicTime now);
    void Freeze();
    bool SnapshotViable() const;
    State& state_;
    Envelope identity_;
    Provenance provenance_;
    std::function<MonotonicTime()> clock_;
    std::function<double()> rng_;
    std::function<std::string()> id_;
    std::optional<Request> pending_,retry_;
    MonotonicTime sent_{0},due_{0};
    uint64_t ack_=0;
    unsigned attempt_=0;
    bool stopped_=false,disabled_=false,hello_=true,chatReady_=false;
    std::optional<Snapshot> toPrepare_;
    std::optional<PreparedSnapshot> prepared_;
    std::string snapshotId_;
    uint64_t watermark_=0;
    size_t chunk_=0,commandCapacity_;
    struct Cached { int64_t expiresAt; std::optional<CommandStatus> status; };
    std::map<CommandId,Cached> cache_;
    std::map<CommandId,CommandStatus> results_;
    std::vector<Command> commands_;
    std::optional<std::pair<int64_t,MonotonicTime>> wallClock_;
};
}
