#pragma once
#include "BridgeTypes.h"
#include <deque>
#include <map>
#include <utility>

namespace foreman {
// Owned and mutated by the game thread. Returned DTOs own their data.
class State {
public:
    State(std::string epoch, Limits limits);
    void Seed(std::vector<Row> rows);
    std::optional<Event> Upsert(Row row, Origin origin);
    std::optional<Event> Remove(std::string entityId);
    Snapshot Capture(std::string snapshotId);
    ReplayResult ReplayAfter(uint64_t cursor, size_t maxEvents = 10000) const;
    bool Acknowledge(uint64_t cursor);
    bool ConfirmSnapshot(std::string snapshotId, uint64_t watermark);
    uint64_t Latest() const { return sequence_.Latest(); }
    uint64_t RetentionFloor() const { return retentionFloor_; }
    uint64_t Oldest() const { return events_.empty() ? 0 : events_.front().first.seq; }
    size_t QueueSize() const { return events_.size(); }
    bool HasGap() const { return gap_ || exhausted_; }
    size_t Count() const { return rows_.size(); }
    size_t RetainedBytes() const { return retainedBytes_; }
    bool NeedsNewEpoch() const { return exhausted_; }
private:
    std::optional<Event> Emit(Event event);
    void DropFront();
    std::string epoch_;
    Limits limits_;
    Sequence sequence_;
    std::map<std::string,Row> rows_;
    std::deque<std::pair<Event,size_t>> events_;
    std::optional<std::pair<std::string,uint64_t>> outstanding_;
    size_t retainedBytes_ = 0;
    uint64_t retentionFloor_ = 0;
    bool seeded_ = false;
    bool gap_ = false;
    bool exhausted_ = false;
};
}
