#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wincrypt.h>
#include <bcrypt.h>
#define DISCORDPP_IMPLEMENTATION
#include "discordpp.h"
#include <nlohmann/json.hpp>
#include <atomic>
#include <chrono>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <thread>
#include <regex>

using json = nlohmann::json;
using namespace std::chrono_literals;

static void output(const json& value) { std::cout << value.dump() << std::endl; }
static std::string read_file(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary);
    return {std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
}
static std::string utf8(const std::wstring& value) {
    if (value.empty()) return {};
    const auto size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    if (!size) throw std::runtime_error("Invalid Windows path");
    std::string result(size, '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
    return result;
}
static std::string protect(const std::string& value, bool decrypt) {
    DATA_BLOB input{static_cast<DWORD>(value.size()), reinterpret_cast<BYTE*>(const_cast<char*>(value.data()))}, result{};
    BOOL ok = decrypt ? CryptUnprotectData(&input, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &result)
                      : CryptProtectData(&input, L"Moewatch Discord", nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &result);
    if (!ok) throw std::runtime_error("Credential storage failed");
    std::string bytes(reinterpret_cast<char*>(result.pbData), result.cbData);
    SecureZeroMemory(result.pbData, result.cbData); LocalFree(result.pbData);
    return bytes;
}
static std::string secret() {
    unsigned char bytes[32];
    if (BCryptGenRandom(nullptr, bytes, sizeof(bytes), BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0) throw std::runtime_error("Random generation failed");
    std::string value = "mw1.";
    for (auto byte : bytes) { value += "0123456789abcdef"[byte >> 4]; value += "0123456789abcdef"[byte & 15]; }
    return value;
}

class Bridge {
    discordpp::Client client;
    uint64_t app_id;
    int window_pid;
    std::filesystem::path token_path;
    std::string refresh_token, pending_secret, room_secret;
    uint64_t room = 0, previous_room = 0;
    bool ready = false, authorizing = false, auth_attempted = false, joining = false, guest = false, reconnecting = false;
    unsigned generation = 0;
    json playback = nullptr, presence = nullptr;
    std::string last_members;

    void respond(uint64_t id, bool ok) { if (id) output({{"id", id}, {"ok", ok}}); }
    void disconnected() { output({{"event", {{"type", "disconnected"}}}}); }
    void save_token() {
        std::filesystem::create_directories(token_path.parent_path());
        const auto encrypted = protect(json{{"refresh", refresh_token}, {"room", room ? room : previous_room}}.dump(), false);
        auto temporary = token_path; temporary += L".tmp";
        { std::ofstream file(temporary, std::ios::binary | std::ios::trunc); file.write(encrypted.data(), encrypted.size()); if (!file) throw std::runtime_error("Credential write failed"); }
        if (!MoveFileExW(temporary.c_str(), token_path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) throw std::runtime_error("Credential commit failed");
    }
    discordpp::Client::TokenExchangeCallback token_callback(bool restoring) {
        return [this, restoring](discordpp::ClientResult result, std::string access, std::string refresh,
                                 discordpp::AuthorizationTokenType type, int32_t, std::string) {
            if (!result.Successful()) {
                authorizing = false;
                if (restoring) { refresh_token.clear(); if (!playback.is_null() || !pending_secret.empty()) authorize(); }
                else disconnected();
                return;
            }
            if (!refresh.empty()) refresh_token = std::move(refresh);
            try { save_token(); } catch (...) { authorizing = false; disconnected(); return; }
            client.UpdateToken(type, access, [this](discordpp::ClientResult updated) {
                authorizing = false;
                if (updated.Successful()) client.Connect(); else disconnected();
            });
        };
    }
    void authorize() {
        if (authorizing || ready || auth_attempted) return;
        authorizing = true; auth_attempted = true;
        auto verifier = client.CreateAuthorizationCodeVerifier();
        discordpp::AuthorizationArgs args;
        args.SetClientId(app_id);
        args.SetScopes(discordpp::Client::GetDefaultCommunicationScopes());
        args.SetCodeChallenge(verifier.Challenge());
        client.Authorize(args, [this, code_verifier = verifier.Verifier()](discordpp::ClientResult result, std::string code, std::string redirect) {
            if (!result.Successful()) { authorizing = false; disconnected(); return; }
            client.GetToken(app_id, code, code_verifier, redirect, token_callback(false));
        });
    }
    std::vector<discordpp::LobbyMemberHandle> members() {
        if (!room || !ready) return {};
        const auto lobby = client.GetLobbyHandle(room);
        return lobby ? lobby->LobbyMembers() : std::vector<discordpp::LobbyMemberHandle>{};
    }
    void publish_presence() {
        if (playback.is_null() && room == 0) { client.ClearRichPresence(); return; }
        discordpp::Activity activity;
        // Discord's game invite UI uses Playing activities; solo presence can remain Watching.
        activity.SetType(room && ready ? discordpp::ActivityTypes::Playing : discordpp::ActivityTypes::Watching);
        activity.SetDetails(presence.is_object() ? presence.value("details", "Watching together") : "Watching together");
        activity.SetState(presence.is_object() ? presence.value("state", "Watchparty") : "Watchparty");
        if (presence.is_object() && presence.contains("assets")) {
            auto art = presence["assets"];
            discordpp::ActivityAssets assets;
            if (art.contains("large_image")) assets.SetLargeImage(art["large_image"].get<std::string>());
            if (art.contains("large_text")) assets.SetLargeText(art["large_text"].get<std::string>());
            if (art.contains("small_image")) assets.SetSmallImage(art["small_image"].get<std::string>());
            if (art.contains("small_text")) assets.SetSmallText(art["small_text"].get<std::string>());
            activity.SetAssets(assets);
        }
        if (presence.is_object() && presence.contains("timestamps")) {
            discordpp::ActivityTimestamps timestamps;
            timestamps.SetStart(presence["timestamps"].value("start", uint64_t{0}));
            timestamps.SetEnd(presence["timestamps"].value("end", uint64_t{0}));
            activity.SetTimestamps(timestamps);
        }
        if (room && ready) {
            int count = 0;
            for (const auto& member : members()) if (member.Connected()) ++count;
            discordpp::ActivityParty party;
            party.SetId(std::to_string(room)); party.SetCurrentSize(std::max(1, count)); party.SetMaxSize(1000);
            party.SetPrivacy(discordpp::ActivityPartyPrivacy::Private);
            activity.SetParty(party);
            // Only the original inviter advertises the capability. Guests cannot re-invite through their presence.
            if (!guest && !room_secret.empty()) {
                discordpp::ActivitySecrets secrets;
                const auto destination = playback.is_object() ? ":" + std::to_string(playback.value("animeId", uint64_t{0})) + ":" + std::to_string(playback.value("episode", 0)) : "";
                secrets.SetJoin(room_secret + destination); activity.SetSecrets(secrets);
            }
        }
        client.UpdateRichPresence(activity, [](discordpp::ClientResult) {});
    }
    void publish_members(bool reconnected = false) {
        if (!ready) return;
        const auto self = client.GetCurrentUserV2();
        if (!self) return;
        json list = json::array();
        for (const auto& member : members()) {
            if (!member.Connected()) continue;
            const auto user = member.User();
            list.push_back({{"id", std::to_string(member.Id())}, {"name", user ? user->DisplayName() : "Guest"},
                {"avatar", user ? user->AvatarUrl(discordpp::UserHandle::AvatarType::Png, discordpp::UserHandle::AvatarType::Png) : ""}});
        }
        const json event = {{"type", "members"}, {"room", room ? std::to_string(room) : ""},
                            {"self", std::to_string(self->Id())}, {"members", list}, {"reconnected", reconnected}};
        const auto encoded = event.dump();
        if (encoded != last_members) { last_members = encoded; output({{"event", event}}); }
        publish_presence();
    }
    void ensure_room() {
        if (!ready || joining) return;
        if (pending_secret.empty() && (room || playback.is_null())) return;
        const bool invited = !pending_secret.empty();
        const auto target = invited ? std::exchange(pending_secret, {}) : secret();
        const auto operation = ++generation;
        const auto old_room = room;
        joining = true;
        client.CreateOrJoinLobby(target, [this, invited, target, operation, old_room](discordpp::ClientResult result, uint64_t id) {
            if (operation != generation) { if (result.Successful()) client.LeaveLobby(id, [](discordpp::ClientResult) {}); return; }
            joining = false;
            if (!result.Successful()) { disconnected(); return; }
            room = id; room_secret = target; guest = invited; last_members.clear();
            if (old_room && old_room != id) client.LeaveLobby(old_room, [](discordpp::ClientResult) {});
            if (previous_room && previous_room != id && previous_room != old_room) client.LeaveLobby(previous_room, [](discordpp::ClientResult) {});
            previous_room = 0;
            try { save_token(); } catch (...) { disconnected(); }
            publish_members();
            if (!pending_secret.empty()) ensure_room();
        });
    }
public:
    Bridge(uint64_t id, std::filesystem::path tokens, std::string launch, int pid): app_id(id), window_pid(pid), token_path(std::move(tokens)) {
        client.SetApplicationId(app_id);
        if (pid > 0) client.SetGameWindowPid(pid);
        if (!launch.empty()) client.RegisterLaunchCommand(app_id, launch);
        client.SetActivityJoinCallback([this](std::string value) {
            std::smatch match;
            if (!std::regex_match(value, match, std::regex("(mw1\\.[0-9a-f]{64}):([1-9][0-9]{0,8}):([1-9][0-9]{0,4})"))) return;
            const auto anime = std::stoull(match[2].str()), episode = std::stoull(match[3].str());
            if (episode > 10000) return;
            pending_secret = match[1].str();
            if (window_pid > 0) EnumWindows([](HWND window, LPARAM expected_pid) -> BOOL {
                DWORD process = 0; GetWindowThreadProcessId(window, &process);
                wchar_t title[256]{}; GetWindowTextW(window, title, 256);
                if (process != static_cast<DWORD>(expected_pid) || !wcsstr(title, L"Moewatch")) return TRUE;
                ShowWindow(window, SW_RESTORE); SetForegroundWindow(window); return FALSE;
            }, static_cast<LPARAM>(window_pid));
            output({{"event", {{"type", "invite"}, {"animeId", anime}, {"episode", episode}}}});
            if (ready) ensure_room(); else authorize();
        });
        // Do not register or reply to JoinRequest callbacks. Invitations stay inside Discord.
        client.SetStatusChangedCallback([this](discordpp::Client::Status status, discordpp::Client::Error, int32_t) {
            ready = status == discordpp::Client::Status::Ready;
            if (ready) {
                const bool recovered = std::exchange(reconnecting, false); publish_members(recovered);
                if (!room && previous_room) {
                    const auto stale_room = std::exchange(previous_room, uint64_t{0});
                    const auto cleanup_generation = ++generation; joining = true;
                    client.LeaveLobby(stale_room, [this, cleanup_generation](discordpp::ClientResult) {
                        if (cleanup_generation != generation) return;
                        joining = false; ensure_room();
                    });
                } else ensure_room();
            }
            else if (room) { reconnecting = true; disconnected(); }
        });
        const auto changed = [this](uint64_t id, uint64_t) { if (id == room) publish_members(); };
        client.SetLobbyCreatedCallback([this](uint64_t id) { if (id == room) publish_members(); });
        client.SetLobbyUpdatedCallback([this](uint64_t id) { if (id == room) publish_members(); });
        client.SetLobbyMemberAddedCallback(changed);
        client.SetLobbyMemberRemovedCallback(changed);
        client.SetLobbyMemberUpdatedCallback(changed);
        client.SetLobbyDeletedCallback([this](uint64_t id) { if (id == room) { room = 0; room_secret.clear(); publish_members(); disconnected(); } });
        client.SetMessageCreatedCallback([this](uint64_t id) {
            if (!room || !ready) return;
            auto message = client.GetMessageHandle(id);
            if (!message) return;
            const auto lobby = message->Lobby();
            if (!lobby || lobby->Id() != room) return;
            const auto member = lobby->GetLobbyMemberHandle(message->AuthorId());
            if (!member || !member->Connected()) return;
            try {
                const auto raw = message->RawContent();
                if (raw.size() > 2000) return;
                const auto payload = json::parse(raw);
                if (payload.value("v", 0) != 1 || !payload.contains("playback")) return;
                output({{"event", {{"type", "message"}, {"room", std::to_string(room)},
                    {"sender", std::to_string(message->AuthorId())}, {"data", payload["playback"]}}}});
            } catch (...) { /* Other lobby messages do not control the player. */ }
        });
        client.SetTokenExpirationCallback([this]() {
            if (refresh_token.empty() || authorizing) return;
            authorizing = true; client.RefreshToken(app_id, refresh_token, token_callback(true));
        });
        try {
            const auto cached = json::parse(protect(read_file(token_path), true));
            refresh_token = cached.value("refresh", ""); previous_room = cached.value("room", uint64_t{0});
        } catch (...) { /* First use, corrupt files and credentials from other Windows users need authorization. */ }
        if (!refresh_token.empty()) { authorizing = true; client.RefreshToken(app_id, refresh_token, token_callback(true)); }
        output({{"ready", true}});
    }
    void command(const json& input) {
        const auto id = input.value("id", uint64_t{0});
        const auto type = input.value("type", "");
        if (type == "advertise") {
            const auto previous = playback;
            playback = input.at("playback");
            if (playback.is_null()) { ++generation; joining = false; pending_secret.clear(); if (!authorizing && !ready) auth_attempted = false; }
            if (!playback.is_null()) { if (ready) ensure_room(); else authorize(); }
            if (previous.is_null() || playback.is_null() || previous.value("animeId", 0) != playback.value("animeId", 0)
                || previous.value("episode", 0) != playback.value("episode", 0)) publish_presence();
            respond(id, true);
        } else if (type == "presence") {
            presence = input.at("activity"); publish_presence(); respond(id, true);
        } else if (type == "send") {
            if (!ready || !room || joining) { respond(id, false); return; }
            const auto text = json{{"v", 1}, {"playback", input.at("playback")}}.dump();
            if (text.size() > 2000) { respond(id, false); return; }
            client.SendLobbyMessage(room, text, [this, id](discordpp::ClientResult result, uint64_t) { respond(id, result.Successful()); });
        } else if (type == "leave") {
            ++generation; joining = false; pending_secret.clear();
            playback = nullptr;
            const auto old = std::exchange(room, uint64_t{0}); room_secret.clear(); guest = false; last_members.clear();
            previous_room = old;
            publish_members();
            try { save_token(); } catch (...) { /* Leaving still succeeds when credential storage is unavailable. */ }
            if (old && ready) client.LeaveLobby(old, [this, id](discordpp::ClientResult result) {
                if (result.Successful()) { previous_room = 0; try { save_token(); } catch (...) {} }
                respond(id, result.Successful());
            });
            else respond(id, true);
        } else respond(id, false);
    }
    void shutdown() {
        if (room && ready) client.LeaveLobby(room, [this](discordpp::ClientResult result) {
            if (result.Successful()) { room = 0; previous_room = 0; try { save_token(); } catch (...) {} }
        });
        client.ClearRichPresence();
        for (int i = 0; i < 20; ++i) { discordpp::RunCallbacks(); std::this_thread::sleep_for(10ms); }
        client.Disconnect();
    }
};

int wmain(int argc, wchar_t** argv) {
    try {
        if (argc == 2 && std::wstring(argv[1]) == L"--self-test") {
            const auto capability = secret();
            if (!std::regex_match(capability, std::regex("mw1\\.[0-9a-f]{64}")) || protect(protect("test credential", false), true) != "test credential") return 1;
            discordpp::Client client;
            if (client.CreateAuthorizationCodeVerifier().Verifier().empty()) return 1;
            output({{"ok", true}, {"sdk", "loaded"}, {"credentials", "Windows DPAPI"}}); return 0;
        }
        if (argc != 5) return 2;
        struct Input { std::mutex mutex; std::deque<std::string> lines; std::atomic<bool> open{true}; };
        auto input = std::make_shared<Input>();
        std::thread([input]() {
            std::string line;
            while (std::getline(std::cin, line)) {
                std::lock_guard lock(input->mutex);
                if (line.size() > 32768 || input->lines.size() >= 128) break;
                input->lines.push_back(std::move(line));
            }
            input->open = false;
        }).detach();
        Bridge bridge(std::stoull(argv[1]), std::filesystem::path(argv[2]), utf8(argv[3]), std::stoi(argv[4]));
        while (input->open) {
            std::deque<std::string> lines;
            { std::lock_guard lock(input->mutex); lines.swap(input->lines); }
            for (const auto& line : lines) {
                try { bridge.command(json::parse(line)); }
                catch (...) { output({{"error", "Invalid native party command"}}); }
            }
            discordpp::RunCallbacks(); std::this_thread::sleep_for(10ms);
        }
        bridge.shutdown();
    } catch (...) { output({{"error", "Discord integration unavailable"}}); return 1; }
    return 0;
}
