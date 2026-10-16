// Strict JSON field readers and writers shared by the wire codec and the row
// codec. Readers reject wrong types, over-long strings and invalid UTF-8;
// nothing here knows about protocol messages.
#pragma once
#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include <array>
#include <initializer_list>
#include <optional>
#include <string>

namespace BridgeJson {
using Object = TSharedPtr<FJsonObject>;
using Value = TSharedPtr<FJsonValue>;

FString Wide(const std::string& Text);
std::string Narrow(const FString& Text);
TArray<uint8> BytesOf(const FString& Text);

Value Field(const Object& Json, const TCHAR* Key);
Object Child(const Object& Json, const TCHAR* Key);
/** Exactly the required keys plus any optional ones. */
bool Fields(const Object& Json, std::initializer_list<const TCHAR*> Required, std::initializer_list<const TCHAR*> Optional = {});
bool Fields(const Object& Json, TConstArrayView<const TCHAR*> Required);
bool Text(const Object& Json, const TCHAR* Key, std::string& Out, size_t Max = 4096, bool AllowEmpty = false);
bool Hex(const std::string& Text, size_t Length);
bool Uuid(const std::string& Text);
bool Id(const Object& Json, const TCHAR* Key, std::string& Out);
bool SeqText(const std::string& Text, uint64_t& Out, bool AllowZero = true);
bool Seq(const Object& Json, const TCHAR* Key, uint64_t& Out, bool AllowZero = true);
bool Number(const Value& Json, double& Out);
bool UInt(const Object& Json, const TCHAR* Key, uint32_t& Out);
bool Vector(const Object& Json, const TCHAR* Key, std::array<double, 3>& Out);
bool IsNull(const Object& Json, const TCHAR* Key);

/** UTF-8 scalar validation before Unreal conversion, which would replace invalid input. */
bool Scalars(TConstArrayView<uint8> Bytes, TArray<uint32>* Out = nullptr);
bool ValidString(const std::string& Text);
/** Parse a body: size-bounded, scalar-valid, unpaired-surrogate-free, nesting at most 32. */
Object Parse(TConstArrayView<uint8> Bytes);

void Put(const Object& Json, const TCHAR* Key, const std::string& Text);
void PutSeq(const Object& Json, const TCHAR* Key, uint64_t Number);
void PutVector(const Object& Json, const TCHAR* Key, const std::array<double, 3>& Vector);
void PutNull(const Object& Json, const TCHAR* Key);
}
