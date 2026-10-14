#include "BridgeConfig.h"
#include "Misc/Paths.h"
#include "Misc/FileHelper.h"
#include "Misc/Guid.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
TOptional<FBridgeConfig> LoadBridgeConfig(FString Path) {
    if(Path.IsEmpty()||FPaths::IsRelative(Path)||IFileManager::Get().FileSize(*Path)>65536)return {};
    FString Text;if(!FFileHelper::LoadFileToString(Text,*Path))return {};
    TSharedPtr<FJsonObject> Object;if(!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text),Object)||!Object)return {};
    FBridgeConfig Config;if(!Object->TryGetBoolField(TEXT("enabled"),Config.Enabled))return {};
    if(!Config.Enabled)return Config;
    if(Object->Values.Num()!=6)return {};
    if(!Object->TryGetStringField(TEXT("url"),Config.Url)||!Object->TryGetStringField(TEXT("token"),Config.Token)
        ||!Object->TryGetStringField(TEXT("serverId"),Config.ServerId)||!Object->TryGetStringField(TEXT("worldId"),Config.WorldId)
        ||!Object->TryGetStringField(TEXT("sessionName"),Config.SessionName))return {};
    if(Config.Url.Len()>2048||!Config.Url.StartsWith(TEXT("https://"),ESearchCase::CaseSensitive))return {};
    FString Authority=Config.Url.Mid(8);if(Authority.EndsWith(TEXT("/")))Authority.LeftChopInline(1);
    if(Authority.IsEmpty())return {};
    // Prototype endpoint is a DNS/IPv4 host plus optional port, no paths, credentials or query.
    for(TCHAR C:Authority)if(!((C>='a'&&C<='z')||(C>='A'&&C<='Z')||(C>='0'&&C<='9')||C=='.'||C=='-'||C==':'))return {};
    FString Host,Port;if(Authority.Split(TEXT(":"),&Host,&Port)) {
        if(Host.IsEmpty()||Port.IsEmpty()||Port.Len()>5)return {};
        for(TCHAR C:Port)if(C<'0'||C>'9')return {};
        const int32 Number=FCString::Atoi(*Port);if(Number<1||Number>65535)return {};
    }
    if(Config.Token.Len()<32||Config.Token.Len()>256)return {};
    for(TCHAR C:Config.Token)if(!((C>='a'&&C<='z')||(C>='A'&&C<='Z')||(C>='0'&&C<='9')||C=='_'||C=='-'))return {};
    for(const FString* Id:{&Config.ServerId,&Config.WorldId}) {FGuid Guid;if(!FGuid::ParseExact(*Id,EGuidFormats::DigitsWithHyphens,Guid)||Guid.ToString(EGuidFormats::DigitsWithHyphensLower)!=*Id)return {};}
    if(Config.SessionName.IsEmpty()||Config.SessionName.Len()>256)return {};
    Config.Url=TEXT("https://")+Authority;return Config;
}
