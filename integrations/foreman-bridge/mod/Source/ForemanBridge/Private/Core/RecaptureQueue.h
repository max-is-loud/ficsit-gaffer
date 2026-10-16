// A deduplicating queue of buildables waiting to be re-captured. Hooks, game
// delegates, settle timers and other mods may request the same buildable many
// times (dragging a clock-speed slider fires on every step); each entity is
// held once, at its earliest due time, and each drain is capped so the game
// thread's cost per tick is bounded regardless of world size.
#pragma once
#include "BridgeTypes.h"
#include <map>
#include <set>
#include <utility>

namespace foreman {
class RecaptureQueue {
public:
    explicit RecaptureQueue(size_t perDrainCap);
    /** Keeps the earliest due time when the entity is already queued. */
    void Request(const std::string& entityId, MonotonicTime dueAt);
    /** Due entries, earliest first, at most perDrainCap; removed from the queue. */
    std::vector<std::string> Drain(MonotonicTime now);
    void Forget(const std::string& entityId);
    size_t Pending() const { return due_.size(); }
private:
    size_t cap_;
    std::map<std::string, MonotonicTime> due_;
    std::set<std::pair<MonotonicTime, std::string>> order_;
};
constexpr size_t RecapturePerTickCap = 64;
constexpr MonotonicTime SettleDelay{2000};
}
