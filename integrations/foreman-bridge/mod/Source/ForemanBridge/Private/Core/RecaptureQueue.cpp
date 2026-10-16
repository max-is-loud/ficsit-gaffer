// Deduplicating, capped re-capture queue; see RecaptureQueue.h.
#include "RecaptureQueue.h"

namespace foreman {
RecaptureQueue::RecaptureQueue(size_t perDrainCap) : cap_(perDrainCap) {}

void RecaptureQueue::Request(const std::string& entityId, MonotonicTime dueAt) {
    const auto found = due_.find(entityId);
    if (found != due_.end()) {
        if (found->second <= dueAt) { return; }
        order_.erase({found->second, entityId});
        found->second = dueAt;
    } else {
        due_.emplace(entityId, dueAt);
    }
    order_.emplace(dueAt, entityId);
}

std::vector<std::string> RecaptureQueue::Drain(MonotonicTime now) {
    std::vector<std::string> drained;
    while (!order_.empty() && drained.size() < cap_ && order_.begin()->first <= now) {
        drained.push_back(order_.begin()->second);
        due_.erase(order_.begin()->second);
        order_.erase(order_.begin());
    }
    return drained;
}

void RecaptureQueue::Forget(const std::string& entityId) {
    const auto found = due_.find(entityId);
    if (found == due_.end()) { return; }
    order_.erase({found->second, entityId});
    due_.erase(found);
}
}
