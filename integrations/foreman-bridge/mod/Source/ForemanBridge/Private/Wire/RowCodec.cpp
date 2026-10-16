// Protocol v2 row codec; see RowCodec.h. Each category contributes a name and
// three functions (decode, encode, outgoing validation) to CATEGORY_CODECS.
#include "Wire/RowCodec.h"

namespace {
using namespace BridgeJson;
using namespace foreman;

const TCHAR* const PURITY_NAMES[] = {TEXT("impure"), TEXT("normal"), TEXT("pure")};

// Nullable field readers: JSON null leaves the optional unset.
bool ReadPath(const Object& Json, const TCHAR* Key, std::optional<std::string>& Out) {
    if (IsNull(Json, Key)) { return true; }
    std::string Path;
    if (!Text(Json, Key, Path)) { return false; }
    Out = std::move(Path);
    return true;
}
bool ReadNumber(const Object& Json, const TCHAR* Key, std::optional<double>& Out) {
    if (IsNull(Json, Key)) { return true; }
    double Number = 0;
    if (!BridgeJson::Number(Field(Json, Key), Number)) { return false; }
    Out = Number;
    return true;
}
bool ReadCount(const Object& Json, const TCHAR* Key, std::optional<uint32_t>& Out) {
    if (IsNull(Json, Key)) { return true; }
    uint32_t Count = 0;
    if (!UInt(Json, Key, Count)) { return false; }
    Out = Count;
    return true;
}
bool ReadFlag(const Object& Json, const TCHAR* Key, std::optional<bool>& Out) {
    if (IsNull(Json, Key)) { return true; }
    const auto Flag = Field(Json, Key);
    if (!Flag || Flag->Type != EJson::Boolean) { return false; }
    Out = Flag->AsBool();
    return true;
}
bool ReadPurity(const Object& Json, const TCHAR* Key, std::optional<Purity>& Out) {
    if (IsNull(Json, Key)) { return true; }
    std::string Name;
    if (!Text(Json, Key, Name, 16)) { return false; }
    for (int32 Index = 0; Index < UE_ARRAY_COUNT(PURITY_NAMES); ++Index) {
        if (Wide(Name) == PURITY_NAMES[Index]) { Out = static_cast<Purity>(Index); return true; }
    }
    return false;
}

// Nullable field writers: an unset optional becomes JSON null.
void WritePath(const Object& Json, const TCHAR* Key, const std::optional<std::string>& Value) {
    if (Value) { Put(Json, Key, *Value); } else { PutNull(Json, Key); }
}
void WriteNumber(const Object& Json, const TCHAR* Key, const std::optional<double>& Value) {
    if (Value) { Json->SetNumberField(Key, *Value); } else { PutNull(Json, Key); }
}
void WriteCount(const Object& Json, const TCHAR* Key, const std::optional<uint32_t>& Value) {
    if (Value) { Json->SetNumberField(Key, *Value); } else { PutNull(Json, Key); }
}
void WriteFlag(const Object& Json, const TCHAR* Key, const std::optional<bool>& Value) {
    if (Value) { Json->SetBoolField(Key, *Value); } else { PutNull(Json, Key); }
}
void WritePurity(const Object& Json, const TCHAR* Key, const std::optional<Purity>& Value) {
    if (Value) { Json->SetStringField(Key, PURITY_NAMES[static_cast<int32>(*Value)]); } else { PutNull(Json, Key); }
}

bool ValidPath(const std::optional<std::string>& Path) { return !Path || (!Path->empty() && ValidString(*Path)); }
bool ValidNumber(const std::optional<double>& Number) { return !Number || FMath::IsFinite(*Number); }

bool DecodeManufacturer(const Object& Json, Config& Out) {
    static const TCHAR* const Keys[] = {TEXT("recipe"), TEXT("clockSpeed"), TEXT("productionBoost"), TEXT("powerShards"), TEXT("somersloops"), TEXT("paused")};
    ManufacturerConfig Value;
    if (!Fields(Json, Keys) || !ReadPath(Json, Keys[0], Value.recipe) || !ReadNumber(Json, Keys[1], Value.clockSpeed)
        || !ReadNumber(Json, Keys[2], Value.productionBoost) || !ReadCount(Json, Keys[3], Value.powerShards)
        || !ReadCount(Json, Keys[4], Value.somersloops) || !ReadFlag(Json, Keys[5], Value.paused)) { return false; }
    Out = std::move(Value);
    return true;
}
void EncodeManufacturer(const Config& In, const Object& Json) {
    const auto& Value = std::get<ManufacturerConfig>(In);
    WritePath(Json, TEXT("recipe"), Value.recipe);
    WriteNumber(Json, TEXT("clockSpeed"), Value.clockSpeed);
    WriteNumber(Json, TEXT("productionBoost"), Value.productionBoost);
    WriteCount(Json, TEXT("powerShards"), Value.powerShards);
    WriteCount(Json, TEXT("somersloops"), Value.somersloops);
    WriteFlag(Json, TEXT("paused"), Value.paused);
}
bool ValidManufacturer(const Config& In) {
    const auto& Value = std::get<ManufacturerConfig>(In);
    return ValidPath(Value.recipe) && ValidNumber(Value.clockSpeed) && ValidNumber(Value.productionBoost);
}

bool DecodeExtractor(const Object& Json, Config& Out) {
    static const TCHAR* const Keys[] = {TEXT("resource"), TEXT("purity"), TEXT("node"), TEXT("clockSpeed"), TEXT("powerShards"), TEXT("paused")};
    ExtractorConfig Value;
    if (!Fields(Json, Keys) || !ReadPath(Json, Keys[0], Value.resource) || !ReadPurity(Json, Keys[1], Value.purity)
        || !ReadPath(Json, Keys[2], Value.node) || !ReadNumber(Json, Keys[3], Value.clockSpeed)
        || !ReadCount(Json, Keys[4], Value.powerShards) || !ReadFlag(Json, Keys[5], Value.paused)) { return false; }
    Out = std::move(Value);
    return true;
}
void EncodeExtractor(const Config& In, const Object& Json) {
    const auto& Value = std::get<ExtractorConfig>(In);
    WritePath(Json, TEXT("resource"), Value.resource);
    WritePurity(Json, TEXT("purity"), Value.purity);
    WritePath(Json, TEXT("node"), Value.node);
    WriteNumber(Json, TEXT("clockSpeed"), Value.clockSpeed);
    WriteCount(Json, TEXT("powerShards"), Value.powerShards);
    WriteFlag(Json, TEXT("paused"), Value.paused);
}
bool ValidExtractor(const Config& In) {
    const auto& Value = std::get<ExtractorConfig>(In);
    return ValidPath(Value.resource) && ValidPath(Value.node) && ValidNumber(Value.clockSpeed);
}

bool DecodeGenerator(const Object& Json, Config& Out) {
    static const TCHAR* const Keys[] = {TEXT("fuel"), TEXT("clockSpeed"), TEXT("powerShards"), TEXT("paused")};
    GeneratorConfig Value;
    if (!Fields(Json, Keys) || !ReadPath(Json, Keys[0], Value.fuel) || !ReadNumber(Json, Keys[1], Value.clockSpeed)
        || !ReadCount(Json, Keys[2], Value.powerShards) || !ReadFlag(Json, Keys[3], Value.paused)) { return false; }
    Out = std::move(Value);
    return true;
}
void EncodeGenerator(const Config& In, const Object& Json) {
    const auto& Value = std::get<GeneratorConfig>(In);
    WritePath(Json, TEXT("fuel"), Value.fuel);
    WriteNumber(Json, TEXT("clockSpeed"), Value.clockSpeed);
    WriteCount(Json, TEXT("powerShards"), Value.powerShards);
    WriteFlag(Json, TEXT("paused"), Value.paused);
}
bool ValidGenerator(const Config& In) {
    const auto& Value = std::get<GeneratorConfig>(In);
    return ValidPath(Value.fuel) && ValidNumber(Value.clockSpeed);
}

bool DecodeStorage(const Object& Json, Config& Out) {
    if (!Json || Json->Values.Num() != 0) { return false; }
    Out = StorageConfig{};
    return true;
}
void EncodeStorage(const Config&, const Object&) {}
bool ValidStorage(const Config&) { return true; }

struct FCategoryCodec {
    const TCHAR* Name;
    bool (*Decode)(const Object&, Config&);
    void (*Encode)(const Config&, const Object&);
    bool (*Valid)(const Config&);
};
// Indexed by foreman::Category, which is also the Config variant index.
const FCategoryCodec CATEGORY_CODECS[] = {
    {TEXT("manufacturer"), DecodeManufacturer, EncodeManufacturer, ValidManufacturer},
    {TEXT("extractor"), DecodeExtractor, EncodeExtractor, ValidExtractor},
    {TEXT("generator"), DecodeGenerator, EncodeGenerator, ValidGenerator},
    {TEXT("storage"), DecodeStorage, EncodeStorage, ValidStorage},
};
static_assert(UE_ARRAY_COUNT(CATEGORY_CODECS) == std::variant_size_v<Config>, "one codec per category");

const FCategoryCodec* CodecNamed(const std::string& Name) {
    for (const auto& Codec : CATEGORY_CODECS) { if (Wide(Name) == Codec.Name) { return &Codec; } }
    return nullptr;
}

bool PlayerFromJson(const Object& Json, std::optional<Player>& Out) {
    if (IsNull(Json, TEXT("player"))) { return true; }
    const auto Person = Child(Json, TEXT("player"));
    Player Value;
    if (!Fields(Person, {TEXT("platform"), TEXT("accountId"), TEXT("displayName")}) || !Text(Person, TEXT("platform"), Value.platform, 1024)
        || !Text(Person, TEXT("accountId"), Value.accountId, 1024) || !Text(Person, TEXT("displayName"), Value.displayName, 1024)) { return false; }
    Out = std::move(Value);
    return true;
}
}

namespace BridgeRows {
bool RowFromJson(const Object& Json, Row& Out) {
    std::string CategoryName;
    if (!Fields(Json, {TEXT("entityId"), TEXT("actorPath"), TEXT("classPath"), TEXT("category"), TEXT("config"), TEXT("transform"), TEXT("player")})
        || !Id(Json, TEXT("entityId"), Out.entityId) || !Text(Json, TEXT("actorPath"), Out.actorPath)
        || !Text(Json, TEXT("classPath"), Out.classPath) || !Text(Json, TEXT("category"), CategoryName, 32)) { return false; }
    const FCategoryCodec* Codec = CodecNamed(CategoryName);
    if (!Codec || !Codec->Decode(Child(Json, TEXT("config")), Out.config)) { return false; }
    const auto Transform = Child(Json, TEXT("transform"));
    if (!Fields(Transform, {TEXT("position"), TEXT("rotation"), TEXT("scale")}) || !Vector(Transform, TEXT("position"), Out.transform.position)
        || !Vector(Transform, TEXT("rotation"), Out.transform.rotation) || !Vector(Transform, TEXT("scale"), Out.transform.scale)) { return false; }
    return PlayerFromJson(Json, Out.player);
}

Object RowToJson(const Row& Value) {
    auto Json = MakeShared<FJsonObject>();
    const auto& Codec = CATEGORY_CODECS[Value.config.index()];
    Put(Json, TEXT("entityId"), Value.entityId);
    Put(Json, TEXT("actorPath"), Value.actorPath);
    Put(Json, TEXT("classPath"), Value.classPath);
    Json->SetStringField(TEXT("category"), Codec.Name);
    auto Config = MakeShared<FJsonObject>();
    Codec.Encode(Value.config, Config);
    Json->SetObjectField(TEXT("config"), Config);
    auto Transform = MakeShared<FJsonObject>();
    PutVector(Transform, TEXT("position"), Value.transform.position);
    PutVector(Transform, TEXT("rotation"), Value.transform.rotation);
    PutVector(Transform, TEXT("scale"), Value.transform.scale);
    Json->SetObjectField(TEXT("transform"), Transform);
    if (!Value.player) { PutNull(Json, TEXT("player")); return Json; }
    auto Person = MakeShared<FJsonObject>();
    Put(Person, TEXT("platform"), Value.player->platform);
    Put(Person, TEXT("accountId"), Value.player->accountId);
    Put(Person, TEXT("displayName"), Value.player->displayName);
    Json->SetObjectField(TEXT("player"), Person);
    return Json;
}

bool ValidRow(const Row& Value) {
    if (!ValidString(Value.entityId) || !ValidString(Value.actorPath) || !ValidString(Value.classPath)) { return false; }
    for (const auto& Vector : {Value.transform.position, Value.transform.rotation, Value.transform.scale}) {
        for (double Number : Vector) { if (!FMath::IsFinite(Number)) { return false; } }
    }
    if (!CATEGORY_CODECS[Value.config.index()].Valid(Value.config)) { return false; }
    return !Value.player || (ValidString(Value.player->platform) && ValidString(Value.player->accountId) && ValidString(Value.player->displayName));
}
}
