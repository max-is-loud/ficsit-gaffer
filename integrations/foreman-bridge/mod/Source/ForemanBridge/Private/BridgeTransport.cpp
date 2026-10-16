#include "BridgeTransport.h"
#include "BridgeWire.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Async/Async.h"
#include "Misc/ScopeLock.h"
// Pinned engine backend: both supported platforms construct FCurlHttpRequest.
// No source copying or engine patch. Re-audit this private boundary on engine upgrades.
#include "Curl/CurlHttp.h"
#include <atomic>
struct FBridgeTransport::FShared {
    explicit FShared(FBridgeConfig In):Config(std::move(In)){}
    FBridgeConfig Config;
#if WITH_DEV_AUTOMATION_TESTS
    TFunction<void()> BeforeDispatch, Dispatched;
#endif
    std::atomic<uint64> Generation{0};
    FCriticalSection Mutex;
    TArray<TSharedPtr<IHttpRequest,ESPMode::ThreadSafe>> Requests;
};
FBridgeTransport::FBridgeTransport(FBridgeConfig Config):Shared(MakeShared<FShared,ESPMode::ThreadSafe>(std::move(Config))){}
FBridgeTransport::~FBridgeTransport(){CancelAll();}
#if WITH_DEV_AUTOMATION_TESTS
void FBridgeTransport::SetDispatchTestHooks(TFunction<void()> Before,TFunction<void()> Dispatched){Shared->BeforeDispatch=std::move(Before);Shared->Dispatched=std::move(Dispatched);}
#endif
void FBridgeTransport::CancelAll(){
    check(IsInGameThread());
    ++Shared->Generation;
    TArray<TSharedPtr<IHttpRequest,ESPMode::ThreadSafe>> Requests;
    {FScopeLock Lock(&Shared->Mutex);Requests=MoveTemp(Shared->Requests);}
    for(auto& Request:Requests)Request->CancelRequest();
}
void FBridgeTransport::Send(foreman::Request Request,TFunction<void(foreman::Outcome)> Callback) {
    const auto State=Shared;const uint64 Generation=State->Generation.load();
    Async(EAsyncExecution::ThreadPool,[State,Generation,Request=std::move(Request),Callback=std::move(Callback)]() mutable {
        if(State->Generation.load()!=Generation)return;
        auto Finish=[State,Generation,Callback=std::move(Callback)](foreman::Outcome Outcome) mutable {
            AsyncTask(ENamedThreads::GameThread,[State,Generation,Callback=std::move(Callback),Outcome=std::move(Outcome)]() mutable {
                if(State->Generation.load()==Generation)Callback(std::move(Outcome));
            });
        };
        auto Bytes=FBridgeWire::EncodeRequest(Request);if(Bytes.IsEmpty()){foreman::Outcome O;O.httpStatus=426;Finish(std::move(O));return;}
        const auto Kind=static_cast<foreman::RequestKind>(Request.body.index());
        const TCHAR* Path=Kind==foreman::RequestKind::Hello?TEXT("/v2/hello"):Kind==foreman::RequestKind::SnapshotChunk?TEXT("/v2/snapshot/chunk"):Kind==foreman::RequestKind::SnapshotCommit?TEXT("/v2/snapshot/commit"):TEXT("/v2/exchange");
        auto Http=FHttpModule::Get().CreateRequest();
        // CURLOPT_FOLLOWLOCATION is otherwise hardcoded to 1 in this engine.
        CURL* Handle=static_cast<FCurlHttpRequest*>(&Http.Get())->GetEasyHandle();
        const bool Secured=curl_easy_setopt(Handle,CURLOPT_FOLLOWLOCATION,0L)==CURLE_OK
            &&curl_easy_setopt(Handle,CURLOPT_MAXREDIRS,0L)==CURLE_OK
            &&curl_easy_setopt(Handle,CURLOPT_SSL_VERIFYPEER,1L)==CURLE_OK
            &&curl_easy_setopt(Handle,CURLOPT_SSL_VERIFYHOST,2L)==CURLE_OK
            &&curl_easy_setopt(Handle,CURLOPT_VERBOSE,0L)==CURLE_OK;
        if(!Secured){foreman::Outcome O;O.tlsError=true;Finish(std::move(O));return;}
        Http->SetURL(State->Config.Url+Path);Http->SetVerb(TEXT("POST"));Http->SetHeader(TEXT("Content-Type"),TEXT("application/json"));
        Http->SetHeader(TEXT("Authorization"),TEXT("Bearer ")+State->Config.Token);Http->SetContent(std::move(Bytes));Http->SetTimeout(5.0f);
        Http->SetDelegateThreadPolicy(EHttpRequestDelegateThreadPolicy::CompleteOnHttpThread);
        auto ResponseBytes=MakeShared<TArray<uint8>,ESPMode::ThreadSafe>();
        const bool Streaming=Http->SetResponseBodyReceiveStreamDelegateV2(FHttpRequestStreamDelegateV2::CreateLambda([ResponseBytes](void* Ptr,int64& Length){
            if(Length<0||Length>static_cast<int64>(foreman::Limits::MaxBodyBytes)-ResponseBytes->Num()){Length=0;return;}
            ResponseBytes->Append(static_cast<const uint8*>(Ptr),static_cast<int32>(Length));
        }));
        if(!Streaming){foreman::Outcome O;O.httpStatus=426;Finish(std::move(O));return;}
        foreman::ExpectedReply Expected{Request.envelope,Kind};
        Http->OnProcessRequestComplete().BindLambda([State,Generation,ResponseBytes,Expected,Finish=std::move(Finish)](FHttpRequestPtr Done,FHttpResponsePtr Response,bool Success) mutable {
            {FScopeLock Lock(&State->Mutex);State->Requests.Remove(Done);}
            if(State->Generation.load()!=Generation)return;
            foreman::Outcome Outcome;Outcome.networkError=!Success;Outcome.httpStatus=Response?Response->GetResponseCode():0;
            long VerifyResult=0;curl_easy_getinfo(static_cast<FCurlHttpRequest*>(Done.Get())->GetEasyHandle(),CURLINFO_SSL_VERIFYRESULT,&VerifyResult);
            Outcome.tlsError=VerifyResult!=0;
            if(Success&&Outcome.httpStatus==200){auto Reply=FBridgeWire::DecodeResponse(*ResponseBytes,Expected);if(Reply)Outcome.reply=std::move(Reply.GetValue());else Outcome.httpStatus=426;}
            Finish(std::move(Outcome));
        });
#if WITH_DEV_AUTOMATION_TESTS
        if(State->BeforeDispatch)State->BeforeDispatch();
#endif
        // Serialize the final generation check/start with game-thread teardown.
        // CancelRequest before ProcessRequest is insufficient: curl resets cancellation on start.
        AsyncTask(ENamedThreads::GameThread,[State,Generation,Http]() {
            if(State->Generation.load()!=Generation)return;
            {FScopeLock Lock(&State->Mutex);State->Requests.Add(Http);}
#if WITH_DEV_AUTOMATION_TESTS
            if(State->Dispatched)State->Dispatched();
#endif
            Http->ProcessRequest();
        });
    });
}
