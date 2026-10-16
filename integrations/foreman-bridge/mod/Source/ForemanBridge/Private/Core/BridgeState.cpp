// The game-thread projection and bounded event history; see BridgeState.h.
#include "BridgeState.h"
#include <algorithm>

namespace foreman {
namespace {
// The variable-length strings inside a configuration, for retention accounting.
std::vector<const std::string*> ConfigPaths(const Config& config) {
    std::vector<const std::string*> paths;
    const auto keep = [&paths](const std::optional<std::string>& text) { if (text) { paths.push_back(&*text); } };
    if (const auto* made = std::get_if<ManufacturerConfig>(&config)) { keep(made->recipe); }
    if (const auto* mined = std::get_if<ExtractorConfig>(&config)) { keep(mined->resource); keep(mined->node); }
    if (const auto* burned = std::get_if<GeneratorConfig>(&config)) { keep(burned->fuel); }
    return paths;
}
// Covers escaped UTF-8 (at most six bytes per source byte), DTO storage,
// deque bookkeeping and fixed JSON fields. Saturate rather than wrap.
size_t EventBytes(const Event& event) {
    size_t bytes = sizeof(Event) + 1024;
    const auto add = [&bytes](const std::string& text) {
        const size_t length = std::max(text.size(), text.capacity());
        if (length > (std::numeric_limits<size_t>::max()-bytes)/6) {
            bytes = std::numeric_limits<size_t>::max();
        } else { bytes += length*6; }
    };
    add(event.entityId);
    if (event.row) {
        add(event.row->entityId); add(event.row->actorPath); add(event.row->classPath);
        for (const auto* path : ConfigPaths(event.row->config)) { add(*path); }
        if (event.row->player) {
            add(event.row->player->platform); add(event.row->player->accountId); add(event.row->player->displayName);
        }
    }
    return bytes;
}
}
State::State(std::string epoch, Limits limits)
    : epoch_(std::move(epoch)), limits_(limits), sequence_(0,limits.maxSequence) {}
void State::Seed(std::vector<Row> rows) {
    if (seeded_) { return; }
    seeded_ = true;
    for (auto& row : rows) {
        const auto id = row.entityId;
        rows_.insert_or_assign(id,std::move(row));
    }
}
std::optional<Event> State::Upsert(Row row, Origin origin) {
    seeded_ = true;
    const auto found = rows_.find(row.entityId);
    if (found != rows_.end() && found->second == row) { return std::nullopt; }
    const auto id = row.entityId;
    rows_.insert_or_assign(id,row);
    return Emit(Event{0,EventType::Upsert,id,std::move(row),origin});
}
std::optional<Event> State::Reconfigure(Row row) {
    if (rows_.find(row.entityId) == rows_.end()) { return std::nullopt; }
    return Upsert(std::move(row), Origin::Reconfigured);
}
std::optional<Event> State::Remove(std::string entityId) {
    seeded_ = true;
    if (rows_.erase(entityId)==0) { return std::nullopt; }
    return Emit(Event{0,EventType::Remove,std::move(entityId),std::nullopt,Origin::Reconciled});
}
std::optional<Event> State::Emit(Event event) {
    const auto seq = sequence_.Next();
    if (!seq) { exhausted_ = true; gap_ = true; return std::nullopt; }
    event.seq = *seq;
    const size_t bytes = EventBytes(event);
    if (limits_.maxEvents==0 || bytes>limits_.maxBytes) {
        while (!events_.empty()) { DropFront(); }
        retentionFloor_ = event.seq;
        gap_ = true;
        return event;
    }
    while (!events_.empty() && (events_.size()>=limits_.maxEvents || retainedBytes_>limits_.maxBytes-bytes)) {
        DropFront(); gap_ = true;
    }
    events_.emplace_back(event,bytes);
    retainedBytes_ += bytes;
    return event;
}
void State::DropFront() {
    retentionFloor_ = events_.front().first.seq;
    retainedBytes_ -= events_.front().second;
    events_.pop_front();
}
Snapshot State::Capture(std::string snapshotId) {
    Snapshot snapshot{epoch_,std::move(snapshotId),sequence_.Latest(),{}};
    snapshot.rows.reserve(rows_.size());
    for (const auto& entry : rows_) { snapshot.rows.push_back(entry.second); }
    outstanding_ = std::make_pair(snapshot.snapshotId,snapshot.watermark);
    return snapshot;
}
ReplayResult State::ReplayAfter(uint64_t cursor, size_t maxEvents) const {
    ReplayResult result;
    result.gap = gap_ || exhausted_ || cursor<retentionFloor_ || cursor>sequence_.Latest();
    for (const auto& entry : events_) {
        if (result.events.size()>=maxEvents) { break; }
        if (entry.first.seq>cursor) { result.events.push_back(entry.first); }
    }
    return result;
}
bool State::Acknowledge(uint64_t cursor) {
    if (cursor>sequence_.Latest()) { return false; }
    while (!events_.empty() && events_.front().first.seq<=cursor) { DropFront(); }
    return true;
}
bool State::ConfirmSnapshot(std::string snapshotId, uint64_t watermark) {
    if (exhausted_ || !outstanding_ || outstanding_->first!=snapshotId || outstanding_->second!=watermark
        || retentionFloor_>watermark) { return false; }
    Acknowledge(watermark);
    gap_ = false;
    outstanding_.reset();
    return true;
}
}
