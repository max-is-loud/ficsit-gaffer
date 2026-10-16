// Strict JSON field readers and writers; see JsonFields.h.
#include "Wire/JsonFields.h"
#include "Core/BridgeTypes.h"
#include "Serialization/JsonSerializer.h"
#include <limits>

namespace {
using BridgeJson::Object;
using BridgeJson::Scalars;
int32 HexDigit(uint8 C) { if(C>='0'&&C<='9') { return C-'0'; } if(C>='a'&&C<='f') { return C-'a'+10; } if(C>='A'&&C<='F') { return C-'A'+10; } return -1; }
bool EscapeCode(TConstArrayView<uint8> B,int32 Start,uint32& Code) {
    if(Start+4>B.Num()) { return false; }Code=0;
    for(int32 I=Start;I<Start+4;++I) { int32 D=HexDigit(B[I]);if(D<0) { return false; }Code=Code*16+D; } return true;
}
bool JsonUnicode(TConstArrayView<uint8> B) {
    if(!Scalars(B)) { return false; }
    bool InString=false;int32 Depth=0;
    for(int32 I=0;I<B.Num();++I) {
        uint8 C=B[I];
        if(C=='"') { InString=!InString; }
        else if(InString&&C=='\\') {
            if(++I>=B.Num()) { return false; }
            if(B[I]=='u') {
                uint32 Code;if(!EscapeCode(B,I+1,Code)) { return false; }I+=4;
                if(Code>=0xd800&&Code<=0xdbff) {
                    if(I+6>=B.Num()||B[I+1]!='\\'||B[I+2]!='u') { return false; }
                    uint32 Low;if(!EscapeCode(B,I+3,Low)||Low<0xdc00||Low>0xdfff) { return false; } I+=6;
                } else if(Code>=0xdc00&&Code<=0xdfff) { return false; }
            }
        } else if(!InString) {
            if(C=='{'||C=='[') { if(++Depth>32) { return false; } }
            else if(C=='}'||C==']') { --Depth; }
        }
    }return true;
}
}

namespace BridgeJson {
using foreman::Limits;
FString Wide(const std::string& Text) { FUTF8ToTCHAR Utf8(Text.data(),static_cast<int32>(Text.size())); return FString(Utf8.Length(),Utf8.Get()); }
std::string Narrow(const FString& Text) { FTCHARToUTF8 Utf8(*Text,Text.Len()); return std::string(Utf8.Get(),Utf8.Length()); }
TArray<uint8> BytesOf(const FString& Text) {
    FTCHARToUTF8 Utf8(*Text,Text.Len()); TArray<uint8> Bytes;
    Bytes.Append(reinterpret_cast<const uint8*>(Utf8.Get()),Utf8.Length()); return Bytes;
}
Value Field(const Object& O,const TCHAR* Key) { if(!O) { return {}; } const auto* Found=O->Values.Find(Key); return Found?*Found:Value{}; }
bool Text(const Object& O,const TCHAR* Key,std::string& Out,size_t Max,bool Empty) {
    const auto V=Field(O,Key); if(!V || V->Type!=EJson::String) { return false; }
    Out=Narrow(V->AsString()); return (Empty || !Out.empty()) && Out.size()<=Max;
}
Object Child(const Object& O,const TCHAR* Key) { const auto V=Field(O,Key); return V && V->Type==EJson::Object ? V->AsObject():Object{}; }
bool Fields(const Object& O,std::initializer_list<const TCHAR*> Required,std::initializer_list<const TCHAR*> Optional) {
    if(!O) { return false; }
    for(const auto* Key:Required) { if(!O->HasField(Key)) { return false; } }
    for(const auto& Pair:O->Values) {
        bool Found=false;
        for(const auto* Key:Required) { Found|=Pair.Key==Key; }
        for(const auto* Key:Optional) { Found|=Pair.Key==Key; }
        if(!Found) { return false; }
    }
    return true;
}
bool Hex(const std::string& S,size_t Length) {
    if(S.size()!=Length) { return false; }
    for(char C:S) { if(!((C>='0'&&C<='9')||(C>='a'&&C<='f'))) { return false; } } return true;
}
bool Uuid(const std::string& S) {
    if(S.size()!=36) { return false; }
    for(size_t I=0;I<S.size();++I) {
        if(I==8||I==13||I==18||I==23) { if(S[I]!='-') { return false; } }
        else if(!((S[I]>='0'&&S[I]<='9')||(S[I]>='a'&&S[I]<='f'))) { return false; }
    } return true;
}
bool Id(const Object& O,const TCHAR* Key,std::string& Out) { return Text(O,Key,Out,36)&&Uuid(Out); }
bool SeqText(const std::string& S,uint64_t& Out,bool Zero) {
    if(S.empty()||S.size()>20||(S.size()>1&&S[0]=='0')) { return false; }
    uint64_t N=0;
    for(char C:S) {
        if(C<'0'||C>'9') { return false; }
        const uint64_t Digit=C-'0';
        if(N>(std::numeric_limits<uint64_t>::max()-Digit)/10) { return false; }
        N=N*10+Digit;
    }
    if(!Zero&&N==0) { return false; } Out=N;return true;
}
bool Seq(const Object& O,const TCHAR* Key,uint64_t& Out,bool Zero) { std::string S;return Text(O,Key,S,20)&&SeqText(S,Out,Zero); }
bool Number(const Value& V,double& Out) { if(!V||V->Type!=EJson::Number) { return false; } Out=V->AsNumber();return FMath::IsFinite(Out); }
bool UInt(const Object& O,const TCHAR* Key,uint32_t& Out) {
    double N; if(!Number(Field(O,Key),N)||N<0||N>4294967295.0||N!=FMath::FloorToDouble(N)) { return false; }
    Out=static_cast<uint32_t>(N);return true;
}
// Validate UTF-8 scalars before Unreal conversion, which may otherwise replace invalid input.
bool Scalars(TConstArrayView<uint8> Bytes,TArray<uint32>* Out) {
    for(int32 I=0;I<Bytes.Num();) {
        const uint8 First=Bytes[I++];uint32 Code=First,Minimum=0;int32 More=0;
        if(First>=0xc2&&First<=0xdf) { Code=First&31;More=1;Minimum=0x80; }
        else if(First>=0xe0&&First<=0xef) { Code=First&15;More=2;Minimum=0x800; }
        else if(First>=0xf0&&First<=0xf4) { Code=First&7;More=3;Minimum=0x10000; }
        else if(First>=0x80) { return false; }
        if(I+More>Bytes.Num()) { return false; }
        while(More-->0) { uint8 C=Bytes[I++];if((C&0xc0)!=0x80) { return false; } Code=(Code<<6)|(C&63); }
        if(Code<Minimum||Code>0x10ffff||(Code>=0xd800&&Code<=0xdfff)) { return false; }
        if(Out) { Out->Add(Code); }
    } return true;
}
bool ValidString(const std::string& S) {
    return S.size()<=Limits::MaxBodyBytes && Scalars(TConstArrayView<uint8>(reinterpret_cast<const uint8*>(S.data()),static_cast<int32>(S.size())));
}
Object Parse(TConstArrayView<uint8> B) {
    if(B.Num()==0||B.Num()>static_cast<int32>(Limits::MaxBodyBytes)||!JsonUnicode(B)) { return {}; }
    FUTF8ToTCHAR Utf8(reinterpret_cast<const ANSICHAR*>(B.GetData()),B.Num());
    FString Source(Utf8.Length(),Utf8.Get());Object O;
    if(!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Source),O)) { return {}; }return O;
}
bool Vector(const Object& O,const TCHAR* Key,std::array<double,3>& Out) {
    auto V=Field(O,Key);if(!V||V->Type!=EJson::Array||V->AsArray().Num()!=3) { return false; }
    for(int I=0;I<3;++I) { if(!Number(V->AsArray()[I],Out[I])) { return false; } }return true;
}
bool Fields(const Object& O,TConstArrayView<const TCHAR*> Required) {
    if(!O||O->Values.Num()!=Required.Num()) { return false; }
    for(const auto* Key:Required) { if(!O->HasField(Key)) { return false; } }
    return true;
}
bool IsNull(const Object& O,const TCHAR* Key) { const auto V=Field(O,Key); return V&&V->Type==EJson::Null; }
void Put(const Object& O,const TCHAR* Key,const std::string& S) { O->SetStringField(Key,Wide(S)); }
void PutSeq(const Object& O,const TCHAR* Key,uint64_t N) { Put(O,Key,std::to_string(N)); }
void PutVector(const Object& O,const TCHAR* Key,const std::array<double,3>& V) {
    TArray<Value> Values;for(double N:V) { Values.Add(MakeShared<FJsonValueNumber>(N)); }O->SetArrayField(Key,Values);
}
void PutNull(const Object& O,const TCHAR* Key) { O->SetField(Key,MakeShared<FJsonValueNull>()); }
}
