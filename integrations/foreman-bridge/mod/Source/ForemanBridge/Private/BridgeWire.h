#pragma once
#include "CoreMinimal.h"
#include "Core/BridgeTypes.h"
#include "Core/BridgeDelivery.h"
class FBridgeWire {
public:
    static foreman::RequestKind Kind(const std::string& Name);
    static TArray<uint8> EncodeRequest(const foreman::Request& Request);
    static TOptional<foreman::Request> DecodeRequest(foreman::RequestKind Kind, TConstArrayView<uint8> Bytes);
    static TOptional<foreman::Reply> DecodeResponse(TConstArrayView<uint8> Bytes, const foreman::ExpectedReply& Expected);
    static TOptional<foreman::PreparedSnapshot> PrepareSnapshot(const foreman::Snapshot& Snapshot);
    static FString SnapshotDigest(const TArray<TArray<uint8>>& Chunks);
};
