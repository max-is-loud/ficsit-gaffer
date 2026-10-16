// Engine-independent bridge data types shared by State, Delivery and the wire
// codec: rows (with protocol v2 per-category configuration), events, snapshots
// and limits.
#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <vector>
#include <variant>
#include <chrono>

namespace foreman {
struct Transform {
    std::array<double,3> position{0,0,0};
    std::array<double,3> rotation{0,0,0};
    std::array<double,3> scale{1,1,1};
    bool operator==(const Transform&) const = default;
};
struct Player {
    std::string platform, accountId, displayName;
    bool operator==(const Player&) const = default;
};
// Protocol v2 categories. The Config variant's alternative index IS the
// category, so a row can never carry a configuration of the wrong kind.
enum class Category { Manufacturer, Extractor, Generator, Storage };
enum class Purity { Impure, Normal, Pure };
// Every field is optional: unset means the game could not say (JSON null).
struct ManufacturerConfig {
    std::optional<std::string> recipe;
    std::optional<double> clockSpeed, productionBoost;
    std::optional<uint32_t> powerShards, somersloops;
    std::optional<bool> paused;
    bool operator==(const ManufacturerConfig&) const = default;
};
struct ExtractorConfig {
    std::optional<std::string> resource;
    std::optional<Purity> purity;
    std::optional<std::string> node;
    std::optional<double> clockSpeed;
    std::optional<uint32_t> powerShards;
    std::optional<bool> paused;
    bool operator==(const ExtractorConfig&) const = default;
};
struct GeneratorConfig {
    std::optional<std::string> fuel;
    std::optional<double> clockSpeed;
    std::optional<uint32_t> powerShards;
    std::optional<bool> paused;
    bool operator==(const GeneratorConfig&) const = default;
};
struct StorageConfig {
    bool operator==(const StorageConfig&) const = default;
};
using Config = std::variant<ManufacturerConfig, ExtractorConfig, GeneratorConfig, StorageConfig>;
inline Category CategoryOf(const Config& config) { return static_cast<Category>(config.index()); }
struct Row {
    std::string entityId, actorPath, classPath;
    Config config;
    Transform transform;
    std::optional<Player> player;
    bool operator==(const Row&) const = default;
};
enum class Origin { Placed, Reconciled, Reconfigured };
enum class EventType { Upsert, Remove };
struct Event {
    uint64_t seq = 0;
    EventType type = EventType::Upsert;
    std::string entityId;
    std::optional<Row> row;
    Origin origin = Origin::Reconciled;
};
struct Snapshot {
    std::string epoch, snapshotId;
    uint64_t watermark = 0;
    std::vector<Row> rows;
};
struct Limits {
    static constexpr size_t MaxBodyBytes = 256*1024;
    static constexpr size_t MaxBatchEvents = 128;
    static constexpr size_t MaxChatScalars = 512;
    static constexpr size_t MaxChatBytes = 2048;
    size_t maxEvents = 10000;
    size_t maxBytes = 16*1024*1024;
    uint64_t maxSequence = std::numeric_limits<uint64_t>::max();
};
struct ReplayResult {
    bool gap = false;
    std::vector<Event> events;
};
// A checked monotonic allocator; exhaustion is sticky and never wraps.
class Sequence {
public:
    explicit Sequence(uint64_t watermark = 0,
        uint64_t ceiling = std::numeric_limits<uint64_t>::max()) : value_(watermark), ceiling_(ceiling) {}
    std::optional<uint64_t> Next() {
        if (value_ >= ceiling_) { return std::nullopt; }
        return ++value_;
    }
    uint64_t Latest() const { return value_; }
private:
    uint64_t value_, ceiling_;
};
}

namespace foreman {
using RequestId = std::string;
using CommandId = std::string;
using MonotonicTime = std::chrono::milliseconds;
enum class RequestKind { Hello, SnapshotChunk, SnapshotCommit, Exchange, Invalid };
struct Envelope {
    std::string serverId, worldId, epoch;
    RequestId requestId;
    std::string connectionId;
};
struct Provenance {
    std::string gameVersion, smlVersion, bridgeVersion, starterCommit, bridgeSourceSha256;
};
struct Hello { uint64_t latestSeq = 0, oldestRetainedSeq = 0; Provenance provenance; };
struct SnapshotChunk { std::string snapshotId; uint32_t chunkIndex = 0; std::string data; };
struct SnapshotCommit {
    std::string snapshotId;
    uint64_t watermark = 0;
    uint32_t chunkCount = 0, rowCount = 0;
    std::string sha256;
};
enum class CommandStatus { Executed, Skipped, Expired, Rejected };
struct CommandResult { CommandId commandId; CommandStatus status = CommandStatus::Rejected; };
struct Command {
    CommandId commandId;
    uint64_t causalSeq = 0;
    std::string type, text;
    int64_t expiresAt = 0;
};
struct Exchange { std::vector<Event> events; std::vector<CommandResult> commandResults; };
struct Request { Envelope envelope; std::variant<Hello,SnapshotChunk,SnapshotCommit,Exchange> body; };
struct HelloReply { bool snapshotRequired = false; uint64_t cursor = 0; std::string reason; };
struct ChunkReply { std::string snapshotId; uint32_t chunkIndex = 0; };
struct SnapshotReply { std::string snapshotId; uint64_t watermark = 0; };
struct ExchangeReply { uint64_t ackSeq = 0; std::vector<Command> commands; std::optional<std::string> resyncRequired; };
struct Reply { Envelope envelope; std::variant<HelloReply,ChunkReply,SnapshotReply,ExchangeReply> body; };
struct ExpectedReply { Envelope envelope; RequestKind kind = RequestKind::Invalid; };
struct Outcome { std::optional<Reply> reply; int httpStatus = 0; bool networkError = false; bool tlsError = false; };
}
