import { useState, useEffect } from "react";

const SUPABASE_URL = "https://mjucamqnmdjcnkbgkise.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdWNhbXFubWRqY25rYmdraXNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMzUzMDQsImV4cCI6MjA5MzcxMTMwNH0.lx_Yu6bdNEiDZ70E4QDMZlLPodC1y1jrrUkqU24mDTI";
const ADMIN_PASSWORD = "Ben150893@PickleballTaichung";
const GUEST_TOKENS_KEY = "pb_guest_tokens";

function authHeaders(token) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };
}

async function sbFetch(path, options = {}, token = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { ...authHeaders(token), Prefer: options.prefer || "", ...options.headers },
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const LINE_CHANNEL_ID = "2010007017";
const LINE_REDIRECT_URI = "https://pickleball-iota-one.vercel.app";

async function signInWithGoogle() {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(window.location.origin)}`,
    { headers: { apikey: SUPABASE_ANON_KEY }, redirect: "manual" }
  );
  const url = res.headers.get("location") || res.url;
  if (url && url !== window.location.href) window.location.href = url;
}

function signInWithLINE() {
  const state = Math.random().toString(36).slice(2);
  sessionStorage.setItem("line_state", state);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: LINE_CHANNEL_ID,
    redirect_uri: LINE_REDIRECT_URI,
    state,
    scope: "profile openid email",
  });
  window.location.href = `https://access.line.me/oauth2/v2.1/authorize?${params}`;
}

async function signOut(token) {
  await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: authHeaders(token) });
}

async function getSession() {
  // Handle LINE callback
  const urlParams = new URLSearchParams(window.location.search);
  const lineCode = urlParams.get("code");
  if (lineCode) {
    sessionStorage.removeItem("line_state");
    window.history.replaceState(null, "", window.location.pathname);
    try {
      const res = await fetch("https://mjucamqnmdjcnkbgkise.supabase.co/functions/v1/line-auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ code: lineCode, redirect_uri: LINE_REDIRECT_URI }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.access_token) {
          sessionStorage.setItem("sb_token", data.access_token);
          if (data.refresh_token) sessionStorage.setItem("sb_refresh", data.refresh_token);
          if (data.display_name) sessionStorage.setItem("line_display_name", data.display_name);
          if (data.avatar_url) sessionStorage.setItem("line_avatar_url", data.avatar_url);
          return data.access_token;
        }
      } else {
        const err = await res.text();
        console.error("LINE edge function error:", err);
      }
    } catch (e) { console.error("LINE auth error", e); }
  }

  // Handle Google/Supabase OAuth callback
  const hash = window.location.hash;
  if (hash.includes("access_token")) {
    const params = new URLSearchParams(hash.slice(1));
    const token = params.get("access_token");
    const refresh = params.get("refresh_token");
    if (token) {
      sessionStorage.setItem("sb_token", token);
      if (refresh) sessionStorage.setItem("sb_refresh", refresh);
      window.history.replaceState(null, "", window.location.pathname);
      return token;
    }
  }
  return sessionStorage.getItem("sb_token") || null;
}

async function getUser(token) {
  if (!token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: authHeaders(token) });
    if (!res.ok) return null;
    const user = await res.json();
    // Supplement with LINE profile data if available
    const lineName = sessionStorage.getItem("line_display_name");
    const lineAvatar = sessionStorage.getItem("line_avatar_url");
    if (lineName && !user.user_metadata?.full_name) {
      user.user_metadata = { ...user.user_metadata, full_name: lineName, avatar_url: lineAvatar };
    }
    return user;
  } catch { return null; }
}

function getGuestTokens() {
  try { return JSON.parse(localStorage.getItem(GUEST_TOKENS_KEY) || "{}"); }
  catch { return {}; }
}

function saveGuestToken(registrationId, token) {
  const tokens = getGuestTokens();
  tokens[registrationId] = token;
  localStorage.setItem(GUEST_TOKENS_KEY, JSON.stringify(tokens));
}

function generateToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// Check if cancellation is allowed (must be >24hrs before game)
function canCancelRegistration(gameDate, gameTime) {
  const gameDateTime = new Date(`${gameDate}T${gameTime}`);
  const now = new Date();
  const diffHours = (gameDateTime - now) / (1000 * 60 * 60);
  return diffHours > 24;
}

async function fetchGames(token) {
  const games = await sbFetch("games?select=*&order=date.asc,time.asc", {}, token);
  const registrations = await sbFetch("registrations?select=*", {}, token);
  const myTokens = getGuestTokens();
  return games.map((g) => ({
    ...g,
    maxPlayers: g.max_players,
    endTime: g.end_time,
    courts: g.courts || 1,
    createdByName: g.created_by_name || g.created_by || null,
    players: registrations
      .filter((r) => r.game_id === g.id && !r.is_waitlist)
      .sort((a, b) => (b.is_host ? 1 : 0) - (a.is_host ? 1 : 0))
      .map((r) => ({
        id: r.id,
        name: r.name,
        duprRating: r.dupr_rating,
        avatarUrl: r.avatar_url || null,
        isHost: r.is_host || false,
        canLeave: !!myTokens[r.id] && myTokens[r.id] === r.guest_token && !r.is_host,
      })),
    waitlist: registrations
      .filter((r) => r.game_id === g.id && r.is_waitlist)
      .map((r) => ({
        id: r.id,
        name: r.name,
        duprRating: r.dupr_rating,
        avatarUrl: r.avatar_url || null,
        canLeave: !!myTokens[r.id] && myTokens[r.id] === r.guest_token,
      })),
  }));
}

async function createGame(data, token) {
  const result = await sbFetch("games", {
    method: "POST", prefer: "return=representation",
    body: JSON.stringify({
      title: data.title, date: data.date, time: data.time,
      end_time: data.endTime || null, location: data.location,
      location_url: data.locationUrl || null, max_players: data.maxPlayers,
      price: data.price, courts: data.courts || 1,
      created_by: data.createdBy || null, created_by_name: data.createdByName || null,
    }),
  }, token);
  if (result && result[0] && data.createdBy) {
    const guestToken = generateToken();
    const reg = await sbFetch("registrations", {
      method: "POST", prefer: "return=representation",
      body: JSON.stringify({
        game_id: result[0].id, name: data.createdByName || data.createdBy,
        dupr_rating: null, is_waitlist: false, avatar_url: data.createdByAvatar || null,
        guest_token: guestToken, is_host: true,
      }),
    });
    if (reg && reg[0]) saveGuestToken(reg[0].id, guestToken);
  }
  return result;
}

async function updateGame(gameId, data, token) {
  return sbFetch(`games?id=eq.${gameId}`, {
    method: "PATCH", prefer: "return=representation",
    body: JSON.stringify({
      title: data.title, date: data.date, time: data.time,
      end_time: data.endTime || null, location: data.location,
      location_url: data.locationUrl || null, max_players: data.maxPlayers,
      price: data.price, courts: data.courts || 1,
    }),
  }, token);
}

async function deleteGame(gameId, token) {
  await sbFetch(`registrations?game_id=eq.${gameId}`, { method: "DELETE" }, token);
  await sbFetch(`games?id=eq.${gameId}`, { method: "DELETE" }, token);
}

async function createRegistration(gameId, player, isWaitlist = false) {
  const guestToken = generateToken();
  const result = await sbFetch("registrations", {
    method: "POST", prefer: "return=representation",
    body: JSON.stringify({
      game_id: gameId, name: player.name,
      dupr_rating: player.duprRating || null,
      avatar_url: player.avatarUrl || null,
      is_waitlist: isWaitlist, guest_token: guestToken,
    }),
  });
  if (result && result[0]) saveGuestToken(result[0].id, guestToken);
  return result;
}

async function deleteRegistration(registrationId) {
  return sbFetch(`registrations?id=eq.${registrationId}`, { method: "DELETE" });
}

function ratingColor(r) {
  if (!r) return "text-gray-400";
  if (r >= 4.5) return "text-purple-500";
  if (r >= 3.5) return "text-blue-500";
  if (r >= 2.5) return "text-green-500";
  return "text-amber-500";
}

function displayTime(t) {
  if (!t) return "";
  return t.slice(0, 5);
}

// Today's date string for min date validation
function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function SpotsBar({ filled, max }) {
  const pct = Math.round((filled / max) * 100);
  const color = pct >= 100 ? "bg-red-400" : pct >= 75 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-400 mb-1.5">
        <span>{filled} / {max} players</span>
        <span>{max - filled} spot{max - filled !== 1 ? "s" : ""} left</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

function PlayerRow({ player, game, isWaitlist, index, isAdmin, onRemove }) {
  const [leaving, setLeaving] = useState(false);
  const withinCutoff = !canCancelRegistration(game.date, game.time);

  async function handleLeave() {
    if (withinCutoff) {
      alert("You cannot cancel within 24 hours of the game start time.");
      return;
    }
    if (!window.confirm(`Are you sure you want to cancel your spot for ${player.name}? This cannot be undone.`)) return;
    setLeaving(true);
    await onRemove(player.id);
  }

  const showLeaveBtn = (player.canLeave || isAdmin) && !player.isHost;

  return (
    <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 overflow-hidden
          ${isWaitlist ? "bg-amber-400" : player.isHost ? "bg-gradient-to-br from-green-400 to-green-600" : "bg-gradient-to-br from-blue-400 to-blue-600"}`}>
          {player.avatarUrl
            ? <img src={player.avatarUrl} className="w-full h-full object-cover" alt="" onError={(e) => e.target.style.display="none"} />
            : isWaitlist ? index + 1 : player.name.charAt(0).toUpperCase()
          }
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-gray-700">{player.name}</span>
          {player.isHost && <span className="text-xs font-bold text-green-500 bg-green-50 px-1.5 py-0.5 rounded-full">Host</span>}
          {isWaitlist && <span className="text-xs text-amber-500 font-semibold">#{index + 1} waitlist</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {player.duprRating != null && (
          <span className={`text-xs font-bold ${ratingColor(player.duprRating)}`}>
            {Number(player.duprRating).toFixed(2)}
          </span>
        )}
        {showLeaveBtn && (
          <button onClick={handleLeave} disabled={leaving}
            className={`text-xs font-semibold px-2 py-1 rounded-lg transition-colors disabled:opacity-50
              ${withinCutoff ? "text-gray-300 cursor-not-allowed" : "text-red-400 hover:text-red-600 hover:bg-red-50"}`}
            title={withinCutoff ? "Cannot cancel within 24hrs of game" : player.canLeave ? "Leave game" : "Remove player"}>
            {leaving ? "..." : isAdmin && !player.canLeave ? "✕" : "Leave"}
          </button>
        )}
      </div>
    </div>
  );
}

function RegisterModal({ game, onRegister, onClose, user }) {
  const isFull = game.players.length >= game.maxPlayers;
  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || "";
  const avatarUrl = user?.user_metadata?.avatar_url || sessionStorage.getItem("line_avatar_url") || null;
  console.log("RegisterModal user:", JSON.stringify(user?.user_metadata));
  console.log("RegisterModal avatarUrl:", avatarUrl);
  console.log("sessionStorage line_avatar_url:", sessionStorage.getItem("line_avatar_url"));
  const [duprRating, setDuprRating] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    const rating = duprRating ? parseFloat(duprRating) : null;
    if (duprRating && (isNaN(rating) || rating < 1 || rating > 6)) {
      setError("DUPR rating must be between 1 and 6.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onRegister(game.id, { name: displayName, duprRating: rating, avatarUrl }, isFull);
      onClose();
    } catch { setError("Something went wrong. Please try again."); }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-base font-bold text-gray-900">{isFull ? "Join Waitlist" : "Join Game"}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{game.title}</p>
          </div>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-500 text-xl leading-none mt-0.5">✕</button>
        </div>

        {isFull && (
          <div className="mb-4 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 text-xs text-amber-600">
            This game is full. You'll be added to the waitlist.
          </div>
        )}

        {/* Show signed-in user */}
        <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-3 mb-4">
          {avatarUrl ? (
            <img src={avatarUrl} className="w-9 h-9 rounded-full object-cover" alt="" onError={(e) => e.target.style.display="none"} />
          ) : (
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-sm font-bold">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-gray-800">{displayName}</p>
            <p className="text-xs text-gray-400">Registering as this account</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
              DUPR Rating <span className="normal-case font-normal text-gray-300">(optional)</span>
            </label>
            <input type="number" min="1" max="6" step="0.01"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
              placeholder="e.g. 3.75" value={duprRating}
              onChange={(e) => setDuprRating(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()} />
            <p className="text-xs text-gray-300 mt-1">Enter your DUPR rating so others know your skill level.</p>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button onClick={handleSubmit} disabled={loading}
            className="mt-1 w-full py-3 rounded-xl font-bold text-sm text-white disabled:opacity-50"
            style={{ background: isFull ? "linear-gradient(135deg, #d97706, #f59e0b)" : "linear-gradient(135deg, #1e3a5f, #2d5a8e)" }}>
            {loading ? "Saving..." : isFull ? "Join Waitlist" : "Confirm Registration"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Full-screen game detail — uses native scroll, no fixed overlay clipping
function GameDetailModal({ game, onRegister, onClose, onRemovePlayer, user, isAdmin, onDelete, onEdit }) {
  const [showRegister, setShowRegister] = useState(false);
  const isFull = game.players.length >= game.maxPlayers;
  const spotsLeft = game.maxPlayers - game.players.length;
  const isOwner = user && game.created_by === user.email;
  const canEdit = isOwner || isAdmin;
  const canDelete = isOwner || isAdmin;

  const statusColor = isFull ? "bg-red-50 text-red-500 border-red-100"
    : spotsLeft <= 2 ? "bg-amber-50 text-amber-600 border-amber-100"
    : "bg-emerald-50 text-emerald-600 border-emerald-100";

  async function handleDelete() {
    if (!window.confirm(`Delete "${game.title}"? This cannot be undone.`)) return;
    await onDelete(game.id);
    onClose();
  }

  // Prevent background scroll on iOS
  useEffect(() => {
    document.body.style.overflow = "hidden";
    // Block horizontal swipe (iOS back gesture)
    const el = document.querySelector(".game-detail-scroll");
    if (el) {
      let startX = 0, startY = 0;
      const onStart = (e) => { startX = e.touches[0].clientX; startY = e.touches[0].clientY; };
      const onMove = (e) => {
        const dx = Math.abs(e.touches[0].clientX - startX);
        const dy = Math.abs(e.touches[0].clientY - startY);
        if (dx > dy) e.preventDefault();
      };
      el.addEventListener("touchstart", onStart, { passive: true });
      el.addEventListener("touchmove", onMove, { passive: false });
      return () => {
        document.body.style.overflow = "";
        el.removeEventListener("touchstart", onStart);
        el.removeEventListener("touchmove", onMove);
      };
    }
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <>
      {showRegister && (
        <RegisterModal game={game} user={user} onRegister={async (gid, player, isWaitlist) => {
          await onRegister(gid, player, isWaitlist);
          setShowRegister(false);
        }} onClose={() => setShowRegister(false)} />
      )}

      {/* Full screen overlay with native scroll */}
      <div className="fixed inset-0 z-40 flex flex-col" style={{ background: "rgba(0,0,0,0.5)" }}>
        <div className="flex-1 overflow-y-auto overscroll-contain game-detail-scroll">
          <div className="min-h-full flex items-end sm:items-center justify-center p-4 pt-16">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md">
              <div className="h-2 rounded-t-3xl" style={{ background: isFull ? "#f87171" : spotsLeft <= 2 ? "#fbbf24" : "#4ade80" }} />
              <div className="p-5">
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-black text-gray-900 leading-tight">{game.title}</h2>
                      <button onClick={(e) => {
                        e.stopPropagation();
                        const text = `🏓 ${game.title}\n📍 ${game.location}\n📅 ${new Date(game.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} ⏰ ${displayTime(game.time)}${game.endTime ? `–${displayTime(game.endTime)}` : ""}\n${game.price > 0 ? `NT$${Number(game.price).toFixed(0)}/player` : "Free"}\n\nJoin here: ${window.location.href}`;
                        if (navigator.share) { navigator.share({ title: "Pickleball Taichung", text }); }
                        else { navigator.clipboard.writeText(text); alert("Game details copied!"); }
                      }} className="text-gray-300 hover:text-gray-500 transition-colors" title="Share">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2l-4 4h3v9h2V6h3l-4-4z"/>
                          
                          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                        </svg>
                      </button>
                    </div>
                    {game.createdByName && <p className="text-xs text-gray-400 mt-0.5">Hosted by {game.createdByName}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {canEdit && (
                      <button onClick={() => { onEdit(game); onClose(); }}
                        className="w-8 h-8 flex items-center justify-center rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-400 transition-colors">✏️</button>
                    )}
                    {canDelete && (
                      <button onClick={handleDelete}
                        className="w-8 h-8 flex items-center justify-center rounded-xl bg-red-50 hover:bg-red-100 text-red-400 transition-colors">🗑</button>
                    )}
                    <button onClick={onClose}
                      className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400 text-lg">✕</button>
                  </div>
                </div>

                {/* Details */}
                <div className="bg-gray-50 rounded-2xl p-4 flex flex-col gap-2.5 mb-4">
                  <div className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="flex-shrink-0">📅</span>
                    <span>{new Date(game.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>⏰</span>
                    <span>{displayTime(game.time)}{game.endTime ? ` – ${displayTime(game.endTime)}` : ""}</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="flex-shrink-0">📍</span>
                    {game.location_url
                      ? <a href={game.location_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline break-all">{game.location}</a>
                      : <span>{game.location}</span>}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>🏟</span>
                    <span>{game.courts} court{game.courts !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>{game.price > 0 ? "💵" : "🆓"}</span>
                    <span>{game.price > 0 ? `NT$${Number(game.price).toFixed(0)} per player` : "Free"}</span>
                  </div>
                </div>

                {/* Spots */}
                <div className="mb-4"><SpotsBar filled={game.players.length} max={game.maxPlayers} /></div>
                <div className="flex flex-wrap items-center gap-2 mb-5">
                  <span className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${statusColor}`}>
                    {isFull ? "Game is Full" : `${spotsLeft} spot${spotsLeft !== 1 ? "s" : ""} remaining`}
                  </span>
                  {game.waitlist.length > 0 && (
                    <span className="text-xs font-semibold px-3 py-1.5 rounded-full border bg-amber-50 text-amber-600 border-amber-100">
                      {game.waitlist.length} on waitlist
                    </span>
                  )}
                </div>

                {/* Players */}
                <div className="mb-4">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
                    Registered Players ({game.players.length})
                  </h3>
                  {game.players.length === 0
                    ? <p className="text-sm text-gray-300 text-center py-4">No one registered yet. Be the first!</p>
                    : <div className="flex flex-col gap-2">
                        {game.players.map((p, i) => (
                          <PlayerRow key={p.id} player={p} game={game} index={i} isWaitlist={false} isAdmin={isAdmin} onRemove={onRemovePlayer} />
                        ))}
                      </div>
                  }
                </div>

                {/* Waitlist */}
                {game.waitlist.length > 0 && (
                  <div className="mb-5">
                    <h3 className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-3">
                      Waitlist ({game.waitlist.length})
                    </h3>
                    <div className="flex flex-col gap-2">
                      {game.waitlist.map((p, i) => (
                        <PlayerRow key={p.id} player={p} game={game} index={i} isWaitlist={true} isAdmin={isAdmin} onRemove={onRemovePlayer} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Action */}
                <div className="pb-2">
                  {!isFull ? (
                  user ? (
                    <button onClick={() => setShowRegister(true)}
                      className="w-full py-3 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-all"
                      style={{ background: "linear-gradient(135deg, #1e3a5f, #2d5a8e)" }}>
                      + Register for this Game
                    </button>
                  ) : (
                    <div className="text-center bg-gray-50 rounded-2xl p-4">
                      <p className="text-sm text-gray-500 mb-3">Sign in with LINE to register</p>
                      <button onClick={signInWithLINE}
                        className="flex items-center gap-1.5 text-white text-sm font-bold px-4 py-2 rounded-xl mx-auto"
                        style={{ background: "#06C755" }}>
                        <svg width="13" height="13" viewBox="0 0 48 48" fill="white">
                          <path d="M24 4C12.95 4 4 11.86 4 21.5c0 7.6 5.4 14.18 13.3 17.14.58.2.98.74.86 1.34l-.7 3.6c-.1.52.4.96.9.72l4.38-2.18c.38-.2.82-.24 1.22-.1A25.7 25.7 0 0 0 24 42c11.05 0 20-7.86 20-17.5S35.05 4 24 4zm-6.5 22.5h-4a1 1 0 0 1-1-1v-8a1 1 0 0 1 2 0v7h3a1 1 0 0 1 0 2zm3 0a1 1 0 0 1-1-1v-8a1 1 0 0 1 2 0v8a1 1 0 0 1-1 1zm9 0h-4a1 1 0 0 1-1-1v-8a1 1 0 0 1 2 0v7h3a1 1 0 0 1 0 2zm5-3.5h-3v-1.5h3a1 1 0 0 1 0 2zm0-3h-3V18.5h3a1 1 0 0 1 0 2z"/>
                        </svg>
                        Sign in with LINE
                      </button>
                    </div>
                  )
                ) : (
                  user ? (
                    <button onClick={() => setShowRegister(true)}
                      className="w-full py-3 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-all"
                      style={{ background: "linear-gradient(135deg, #d97706, #f59e0b)" }}>
                      Join Waitlist
                    </button>
                  ) : (
                    <div className="text-center bg-gray-50 rounded-2xl p-4">
                      <p className="text-sm text-gray-500 mb-3">Sign in with LINE to join the waitlist</p>
                      <button onClick={signInWithLINE}
                        className="flex items-center gap-1.5 text-white text-sm font-bold px-4 py-2 rounded-xl mx-auto"
                        style={{ background: "#06C755" }}>
                        <svg width="13" height="13" viewBox="0 0 48 48" fill="white">
                          <path d="M24 4C12.95 4 4 11.86 4 21.5c0 7.6 5.4 14.18 13.3 17.14.58.2.98.74.86 1.34l-.7 3.6c-.1.52.4.96.9.72l4.38-2.18c.38-.2.82-.24 1.22-.1A25.7 25.7 0 0 0 24 42c11.05 0 20-7.86 20-17.5S35.05 4 24 4zm-6.5 22.5h-4a1 1 0 0 1-1-1v-8a1 1 0 0 1 2 0v7h3a1 1 0 0 1 0 2zm3 0a1 1 0 0 1-1-1v-8a1 1 0 0 1 2 0v8a1 1 0 0 1-1 1zm9 0h-4a1 1 0 0 1-1-1v-8a1 1 0 0 1 2 0v7h3a1 1 0 0 1 0 2zm5-3.5h-3v-1.5h3a1 1 0 0 1 0 2zm0-3h-3V18.5h3a1 1 0 0 1 0 2z"/>
                        </svg>
                        Sign in with LINE
                      </button>
                    </div>
                  )
                )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tap outside to close */}
        <div className="absolute inset-0 -z-10" onClick={onClose} />
      </div>
    </>
  );
}

function GameCard({ game, onClick }) {
  const isFull = game.players.length >= game.maxPlayers;
  const spotsLeft = game.maxPlayers - game.players.length;
  const pct = game.players.length / game.maxPlayers;
  const almostFull = !isFull && spotsLeft <= 2;

  const statusColor = isFull ? "bg-red-50 text-red-500 border-red-100"
    : almostFull ? "bg-amber-50 text-amber-600 border-amber-100"
    : "bg-emerald-50 text-emerald-600 border-emerald-100";

  function handleShare(e) {
    e.stopPropagation();
    const text = `🏓 ${game.title}\n📍 ${game.location}\n📅 ${new Date(game.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} ⏰ ${displayTime(game.time)}${game.endTime ? `–${displayTime(game.endTime)}` : ""}\n${game.price > 0 ? `💵 NT$${Number(game.price).toFixed(0)}/player` : "🆓 Free"}\n\nJoin here: ${window.location.href}`;
    if (navigator.share) {
      navigator.share({ title: "Pickleball Taichung", text });
    } else {
      navigator.clipboard.writeText(text);
      alert("Game details copied!");
    }
  }

  return (
    <div onClick={onClick}
      className="bg-white rounded-2xl overflow-hidden active:scale-[0.99] transition-all cursor-pointer"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)" }}>
      <div className="h-1" style={{ background: isFull ? "#f87171" : pct >= 0.75 ? "#fbbf24" : "#4ade80" }} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="font-bold text-gray-900 text-base leading-tight">{game.title}</h3>
              <button onClick={handleShare}
                className="text-gray-300 hover:text-gray-500 transition-colors flex-shrink-0"
                title="Share">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l-4 4h3v9h2V6h3l-4-4z"/>
                  
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                </svg>
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">📍 {game.location}</p>
            {game.createdByName && (
              <p className="text-xs text-gray-400 mt-0.5">🏅 Host: {game.createdByName}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              {almostFull && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
              )}
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${statusColor}`}>
                {isFull ? "Full" : `${spotsLeft} left`}
              </span>
            </div>
            {isFull && game.waitlist.length > 0 && (
              <span className="text-xs text-amber-500 font-semibold">{game.waitlist.length} waiting</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-gray-500 mb-3">
          <span>📅 {new Date(game.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
          <span>⏰ {displayTime(game.time)}{game.endTime ? `–${displayTime(game.endTime)}` : ""}</span>
          <span>🏟 {game.courts}ct</span>
          {game.price > 0
            ? <span className="text-emerald-600 font-semibold">NT${Number(game.price).toFixed(0)}</span>
            : <span className="text-emerald-500 font-semibold">Free</span>
          }
        </div>

        <SpotsBar filled={game.players.length} max={game.maxPlayers} />
      </div>
    </div>
  );
}

function GameFormModal({ game, onClose, onSave }) {
  const isEdit = !!game;
  const today = todayString();
  const [form, setForm] = useState({
    title: game?.title || "",
    date: game?.date || "",
    timeHr: game?.time ? game.time.split(":")[0] : "",
    timeMin: game?.time ? game.time.split(":")[1] || "00" : "",
    endTimeHr: game?.endTime ? game.endTime.split(":")[0] : "",
    endTimeMin: game?.endTime ? game.endTime.split(":")[1] || "00" : "",
    location: game?.location || "",
    locationUrl: game?.location_url || "",
    maxPlayers: game?.maxPlayers || 8,
    courts: game?.courts || 1,
    price: game?.price ?? "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function update(field, val) { setForm((f) => ({ ...f, [field]: val })); }

  useEffect(() => {
    const el = document.querySelector(".game-form-scroll");
    if (!el) return;
    let startX = 0;
    let startY = 0;
    const onStart = (e) => { startX = e.touches[0].clientX; startY = e.touches[0].clientY; };
    const onMove = (e) => {
      const dx = Math.abs(e.touches[0].clientX - startX);
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (dx > dy) e.preventDefault(); // block horizontal swipe
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
    };
  }, []);

  async function handleSave() {
    if (!form.title.trim()) { setError("Please enter a game title."); return; }
    if (!form.date) { setError("Please select a date."); return; }
    if (form.date < today) { setError("Date cannot be in the past."); return; }
    if (!form.timeHr || !form.timeMin) { setError("Please select a start time."); return; }
    if (!form.location.trim()) { setError("Please enter a location."); return; }
    if (form.price === "" || form.price === null || form.price === undefined) {
      setError("Please enter a price (enter 0 if free)."); return;
    }
    const time = `${form.timeHr}:${form.timeMin}`;
    const endTime = form.endTimeHr && form.endTimeMin ? `${form.endTimeHr}:${form.endTimeMin}` : "";
    setLoading(true);
    try {
      await onSave({ ...form, time, endTime, maxPlayers: Number(form.maxPlayers), courts: Number(form.courts), price: Number(form.price) });
      onClose();
    } catch (e) { setError("Something went wrong: " + e.message); }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto overscroll-contain game-form-scroll">
        <div className="p-6">
          <div className="flex justify-between items-center mb-5">
            <h2 className="text-lg font-bold text-gray-900">{isEdit ? "Edit Game" : "Host a Game"}</h2>
            <button onClick={onClose} className="text-gray-300 hover:text-gray-500 text-xl leading-none">✕</button>
          </div>
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">Game Title</label>
              <input type="text" placeholder="e.g. Morning Rally" value={form.title}
                onChange={(e) => update("title", e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50" />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">Date</label>
              <input type="date" value={form.date} min={today}
                onChange={(e) => update("date", e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50" />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">Start Time</label>
              <div className="flex gap-2">
                <select value={form.timeHr}
                  onChange={(e) => update("timeHr", e.target.value)}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-3 text-sm outline-none focus:border-blue-300 bg-white">
                  <option value="">Hour</option>
                  {Array.from({length: 24}, (_, i) => String(i).padStart(2,"0")).map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                <select value={form.timeMin}
                  onChange={(e) => update("timeMin", e.target.value)}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-3 text-sm outline-none focus:border-blue-300 bg-white">
                  <option value="">Min</option>
                  {["00","15","30","45"].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">
                End Time <span className="normal-case font-normal text-gray-300">(optional)</span>
              </label>
              <div className="flex gap-2">
                <select value={form.endTimeHr}
                  onChange={(e) => update("endTimeHr", e.target.value)}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-3 text-sm outline-none focus:border-blue-300 bg-white">
                  <option value="">Hour</option>
                  {Array.from({length: 24}, (_, i) => String(i).padStart(2,"0")).map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                <select value={form.endTimeMin}
                  onChange={(e) => update("endTimeMin", e.target.value)}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-3 text-sm outline-none focus:border-blue-300 bg-white">
                  <option value="">Min</option>
                  {["00","15","30","45"].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">Location Name</label>
              <input type="text" placeholder="e.g. Zhongshan Park Court 3" value={form.location}
                onChange={(e) => update("location", e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50" />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">
                Google Maps Link <span className="normal-case font-normal text-gray-300">(optional)</span>
              </label>
              <input type="url" placeholder="Paste Google Maps URL here" value={form.locationUrl}
                onChange={(e) => update("locationUrl", e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50" />
              <p className="text-xs text-gray-300 mt-1">Open Google Maps, find the place, copy the URL and paste here.</p>
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">Max Players</label>
                <input type="number" min={2} max={64} value={form.maxPlayers}
                  onChange={(e) => update("maxPlayers", e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50" />
              </div>
              <div className="flex-1">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">Number of Courts</label>
                <input type="number" min={1} max={20} value={form.courts}
                  onChange={(e) => update("courts", e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50" />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">
                Price / Player (NTD) <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">NT$</span>
                <input type="number" min={0} step={10} placeholder="0" value={form.price}
                  onChange={(e) => update("price", e.target.value)}
                  className="w-full border border-gray-200 rounded-xl pl-11 pr-3 py-3 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50" />
              </div>
              <p className="text-xs text-gray-300 mt-1">Enter 0 if the game is free.</p>
            </div>
          </div>

          {error && <p className="text-xs text-red-500 mt-3 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

          <button onClick={handleSave} disabled={loading}
            className="mt-5 w-full py-3.5 rounded-xl font-bold text-sm text-white disabled:opacity-50 hover:opacity-90 active:scale-95 transition-all"
            style={{ background: "linear-gradient(135deg, #1e3a5f, #2d5a8e)" }}>
            {loading ? "Saving..." : isEdit ? "Save Changes" : "Create Game"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminLoginModal({ onSuccess, onClose }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  function handleSubmit() {
    if (password === ADMIN_PASSWORD) { onSuccess(); onClose(); }
    else setError("Incorrect password.");
  }
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-base font-bold text-gray-900">Admin Login</h2>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-500 text-xl">✕</button>
        </div>
        <div className="flex flex-col gap-3">
          <input autoFocus type="password" placeholder="Enter admin password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50" />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button onClick={handleSubmit}
            className="w-full py-3 rounded-xl font-bold text-sm text-white"
            style={{ background: "linear-gradient(135deg, #1e3a5f, #2d5a8e)" }}>
            Log In
          </button>
        </div>
      </div>
    </div>
  );
}

function CalendarView({ games, onGameClick }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(null);

  const startPad = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  const gamesByDate = {};
  games.forEach((g) => {
    if (!gamesByDate[g.date]) gamesByDate[g.date] = [];
    gamesByDate[g.date].push(g);
  });

  function prevMonth() { if (month === 0) { setMonth(11); setYear(y => y-1); } else setMonth(m => m-1); setSelectedDate(null); }
  function nextMonth() { if (month === 11) { setMonth(0); setYear(y => y+1); } else setMonth(m => m+1); setSelectedDate(null); }

  const selectedGames = selectedDate ? (gamesByDate[selectedDate] || []) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400 font-bold text-xl active:bg-gray-200">‹</button>
          <span className="font-bold text-gray-800">{new Date(year, month).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
          <button onClick={nextMonth} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400 font-bold text-xl active:bg-gray-200">›</button>
        </div>
        <div className="grid grid-cols-7 mb-1">
          {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
            <div key={d} className="text-center text-xs font-semibold text-gray-300 py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {Array.from({ length: startPad }).map((_, i) => <div key={`p${i}`} />)}
          {Array.from({ length: totalDays }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
            const hasGames = !!gamesByDate[dateStr];
            const isToday = dateStr === today.toISOString().slice(0,10);
            const isSelected = dateStr === selectedDate;
            const isPast = new Date(dateStr) < new Date(today.toISOString().slice(0,10));
            return (
              <button key={day}
                onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                className={`relative mx-auto w-10 h-10 flex flex-col items-center justify-center rounded-xl text-sm font-medium transition-all active:scale-95
                  ${isSelected ? "text-white shadow-sm" : isToday ? "font-bold" : isPast ? "text-gray-300" : "text-gray-700"}`}
                style={isSelected ? { background: "linear-gradient(135deg, #1e3a5f, #2d5a8e)" } : isToday ? { color: "#1e3a5f" } : {}}>
                {day}
                {hasGames && <span className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${isSelected ? "bg-white" : "bg-green-400"}`} />}
              </button>
            );
          })}
        </div>
      </div>
      {selectedDate && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
          {selectedGames.length === 0
            ? <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-sm text-gray-300">No games on this day.</div>
            : <div className="flex flex-col gap-4">
                {selectedGames.map((game) => (
                  <GameCard key={game.id} game={game} onClick={() => onGameClick(game)} />
                ))}
              </div>
          }
        </div>
      )}
      {!selectedDate && <p className="text-xs text-center text-gray-300 mt-2">Tap a date with a green dot to see games</p>}
    </div>
  );
}

export default function App() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [gameForm, setGameForm] = useState(null);
  const [selectedGame, setSelectedGame] = useState(null);
  const [view, setView] = useState("games");

  useEffect(() => {
    // Prevent pinch-to-zoom on iOS Safari
    const preventZoom = (e) => { if (e.touches.length > 1) e.preventDefault(); };
    document.addEventListener("touchmove", preventZoom, { passive: false });
    return () => document.removeEventListener("touchmove", preventZoom);
  }, []);

  useEffect(() => {
    async function init() {
      const t = await getSession();
      if (t) {
        const u = await getUser(t);
        if (u) { setToken(t); setUser(u); }
        else { sessionStorage.removeItem("sb_token"); }
      }
      await loadGames(t);
    }
    init();
  }, []);

  async function loadGames(t = token) {
    try {
      const data = await fetchGames(t);
      setGames(data);
      if (selectedGame) {
        const updated = data.find(g => g.id === selectedGame.id);
        if (updated) setSelectedGame(updated);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function handleRegister(gameId, player, isWaitlist = false) {
    await createRegistration(gameId, player, isWaitlist);
    await loadGames();
  }

  async function handleRemovePlayer(registrationId) {
    await deleteRegistration(registrationId);
    await loadGames();
  }

  async function handleSaveGame(data) {
    const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || sessionStorage.getItem("line_display_name") || user?.email || null;
    const avatarUrl = user?.user_metadata?.avatar_url || sessionStorage.getItem("line_avatar_url") || null;
    if (gameForm?.id) {
      await updateGame(gameForm.id, data, token);
    } else {
      await createGame({ ...data, createdBy: user?.email || null, createdByName: displayName, createdByAvatar: avatarUrl }, token);
    }
    await loadGames();
  }

  async function handleDelete(gameId) {
    await deleteGame(gameId, token);
    setSelectedGame(null);
    await loadGames();
  }

  const sorted = [...games].sort((a, b) => new Date(a.date) - new Date(b.date));

  return (
    <div className="min-h-screen" style={{ background: "#f8f9fb" }}>
      {gameForm !== null && (
        <GameFormModal game={gameForm?.id ? gameForm : null} onClose={() => setGameForm(null)} onSave={handleSaveGame} />
      )}
      {showAdminLogin && (
        <AdminLoginModal onSuccess={() => setIsAdmin(true)} onClose={() => setShowAdminLogin(false)} />
      )}
      {selectedGame && (
        <GameDetailModal
          game={selectedGame}
          onClose={() => setSelectedGame(null)}
          onRegister={handleRegister}
          onRemovePlayer={handleRemovePlayer}
          user={user}
          isAdmin={isAdmin}
          onDelete={handleDelete}
          onEdit={(g) => { setGameForm(g); setSelectedGame(null); }}
        />
      )}

      <header className="bg-white sticky top-0 z-10" style={{ boxShadow: "0 1px 0 rgba(0,0,0,0.06)" }}>
        <div className="max-w-2xl mx-auto px-4 pt-4 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Taichung Pickleball Community" className="w-9 h-9 object-contain" />
            <div>
              <h1 className="font-black text-gray-900 text-sm leading-tight tracking-tight">Pickleball Taichung</h1>
              <p className="text-xs text-gray-400 tracking-wide">Community · Play · Learn</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {user ? (
              <>
                {user.user_metadata?.avatar_url && (
                  <img src={user.user_metadata.avatar_url} className="w-8 h-8 rounded-full ring-2 ring-white shadow-sm" alt=""
                    onError={(e) => e.target.style.display="none"} />
                )}
              </>
            ) : (
              <button onClick={() => setShowAdminLogin(true)} className="text-gray-200 hover:text-gray-400 text-base px-1 transition-colors" title="Admin">⚙️</button>
            )}
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 pb-3 flex items-center gap-2">
          {user ? (
            <button onClick={() => setGameForm({})}
              className="text-white text-xs font-bold px-4 py-2 rounded-xl hover:opacity-90 flex-shrink-0 active:scale-95 transition-all shadow-sm"
              style={{ background: "#06C755" }}>
              + Host a Game
            </button>
          ) : (
            <button onClick={() => signInWithLINE()}
              className="flex items-center gap-1.5 text-white text-xs font-bold px-4 py-2 rounded-xl hover:opacity-90 flex-shrink-0 active:scale-95 transition-all shadow-sm"
              style={{ background: "#06C755" }}>
              <svg width="12" height="12" viewBox="0 0 48 48" fill="white">
                <path d="M24 4C12.95 4 4 11.86 4 21.5c0 7.6 5.4 14.18 13.3 17.14.58.2.98.74.86 1.34l-.7 3.6c-.1.52.4.96.9.72l4.38-2.18c.38-.2.82-.24 1.22-.1A25.7 25.7 0 0 0 24 42c11.05 0 20-7.86 20-17.5S35.05 4 24 4z"/>
              </svg>
              Sign in to host
            </button>
          )}
          <div className="flex gap-0.5 ml-auto bg-gray-100 rounded-xl p-1">
            {[{ id: "games", label: "Play" }, { id: "learn", label: "Learn" }, { id: "about", label: "About" }].map((v) => (
              <button key={v.id} onClick={() => setView(v.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  view === v.id ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-gray-600"
                }`}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5">
        {isAdmin && (
          <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 flex items-center justify-between">
            <p className="text-xs font-semibold text-emerald-600">🛡 Admin mode — you can delete any game</p>
            <button onClick={() => setIsAdmin(false)} className="text-xs text-emerald-400 hover:text-emerald-600 font-semibold">Exit</button>
          </div>
        )}        {loading ? (
          <div className="flex items-center justify-center py-24 text-gray-300 text-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-400 rounded-full animate-spin" />
              Loading games...
            </div>
          </div>
        ) : view === "games" ? (
          <>
            <CalendarView games={games} onGameClick={(game) => setSelectedGame(game)} />
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-6 mb-3">Upcoming Games</h2>
            {sorted.length === 0
              ? <div className="text-center text-gray-300 text-sm py-16"><p className="text-4xl mb-3">🏓</p><p>No games yet.</p></div>
              : <div className="flex flex-col gap-3">
                  {sorted.map((game) => (
                    <GameCard key={game.id} game={game} onClick={() => setSelectedGame(game)} />
                  ))}
                </div>
            }
          </>
        ) : view === "learn" ? (
          <div className="flex flex-col gap-6">

            {/* Hero */}
            <div className="rounded-2xl overflow-hidden relative" style={{ background: "linear-gradient(135deg, #1e3a5f, #2d5a8e)" }}>
              <div className="p-6">
                <p className="text-xs font-bold text-blue-300 uppercase tracking-widest mb-1">Learn Pickleball</p>
                <h2 className="text-2xl font-black text-white leading-tight mb-2">New to the game?</h2>
                <p className="text-sm text-blue-200 leading-relaxed">Everything you need to get on the court with confidence.</p>
              </div>
            </div>

            {/* What is Pickleball */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-base font-black text-gray-900 mb-3">What is Pickleball?</h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                Pickleball is a racket sport that combines elements of tennis, badminton, and table tennis. It's played on a small court with a solid paddle and a perforated plastic ball. The sport is easy to learn, low-impact, and suitable for all ages and fitness levels.
              </p>
              <p className="text-sm text-gray-500 leading-relaxed mt-3">
                The court is about a quarter of the size of a tennis court, making rallies faster and more fun. Points are only scored by the serving team, and the first team to reach 11 points (win by 2) wins the game.
              </p>
            </div>

            {/* Basic Rules */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-base font-black text-gray-900 mb-4">Basic Rules</h3>
              <div className="flex flex-col gap-3">
                {[
                  { title: "The Kitchen", desc: "The 7-foot zone on each side of the net is called the Non-Volley Zone (NVZ) or 'kitchen'. You cannot volley the ball while standing in it." },
                  { title: "The Two-Bounce Rule", desc: "After the serve, the ball must bounce once on each side before either team can volley. This prevents rushing the net on the serve." },
                  { title: "Serving", desc: "Serves must be underhand and hit diagonally to the opponent's service box. The ball must clear the kitchen and land in bounds." },
                  { title: "Scoring", desc: "Only the serving team can score points. Games are played to 11 points, win by 2. In tournaments, games may go to 15 or 21." },
                  { title: "Faults", desc: "Hitting into the net, out of bounds, volleying from the kitchen, or not letting the ball bounce when required are all faults." },
                ].map((rule, i) => (
                  <div key={i} className="flex gap-3 p-3 bg-gray-50 rounded-xl">
                    <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-black mt-0.5"
                      style={{ background: "linear-gradient(135deg, #1e3a5f, #2d5a8e)" }}>{i + 1}</div>
                    <div>
                      <p className="text-sm font-bold text-gray-800">{rule.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{rule.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Video Tutorials */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-base font-black text-gray-900 mb-1">Video Tutorials</h3>
              <p className="text-xs text-gray-400 mb-4">Watch and learn the essential shots</p>
              <div className="flex flex-col gap-3">
                {[
                  { title: "Complete Beginner's Guide to Pickleball", channel: "Pickleball University", id: "I1p7NwhGPOc" },
                  { title: "How to Serve — Beginner Lesson", channel: "Pickleball University", id: "v6QWUweWmMc" },
                  { title: "How to Dink (The Right Way)", channel: "Pickleball Channel", id: "5-ty-cyg6sI" },
                  { title: "3rd Shot Drop — Master It", channel: "Pickleball Channel", id: "xu6pukeV32w" },
                ].map((video, i) => (
                  <a key={i} href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors group">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: "linear-gradient(135deg, #ff0000, #cc0000)" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 leading-tight">{video.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{video.channel} · YouTube</p>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  </a>
                ))}
              </div>
            </div>

            {/* Glossary */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-base font-black text-gray-900 mb-4">Common Terms</h3>
              <div className="flex flex-col gap-2">
                {[
                  { term: "Dink", def: "A soft shot that lands in or near the kitchen, forcing the opponent to hit upward." },
                  { term: "Kitchen", def: "The Non-Volley Zone (NVZ) — the 7-foot area closest to the net on each side." },
                  { term: "Erne", def: "An advanced shot where you jump around the kitchen post to volley the ball." },
                  { term: "Lob", def: "A high, deep shot intended to go over the opponent's head when they're at the net." },
                  { term: "Stacking", def: "A doubles strategy where both players position themselves on the same side of the court." },
                  { term: "Bangers", def: "Players who prefer to hit hard drives instead of playing the soft dinking game." },
                  { term: "ATP", def: "Around the Post — hitting the ball around the net post instead of over it. Legal and impressive." },
                ].map((item, i) => (
                  <div key={i} className="flex gap-3 py-2 border-b border-gray-50 last:border-0">
                    <span className="text-sm font-bold text-blue-800 w-20 flex-shrink-0">{item.term}</span>
                    <span className="text-sm text-gray-500 leading-relaxed">{item.def}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Find a Coach — Coming Soon */}
            <div className="rounded-2xl border-2 border-dashed border-gray-200 p-6 text-center">
              <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5">
                  <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                </svg>
              </div>
              <p className="text-sm font-bold text-gray-700 mb-1">Find a Coach</p>
              <p className="text-xs text-gray-400 mb-3">Connect with certified pickleball coaches in Taichung</p>
              <span className="text-xs font-bold px-3 py-1.5 rounded-full text-blue-600 bg-blue-50">Coming Soon</span>
            </div>

          </div>
        ) : view === "about" ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-base font-black text-gray-900 mb-2">Welcome to Pickleball Taichung!</h2>
            <p className="text-sm text-gray-500 leading-relaxed mb-4">
              This is your community spot for finding games, meeting fellow players, and getting on the court. Browse upcoming games, grab a spot, and just show up. Simple as that.
              <br /><br />
              To join or host a game, simply sign in with your LINE account.
              <br /><br />
              See you on the court!
            </p>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">A few house rules to keep things fun for everyone</p>
            <div className="flex flex-col gap-2.5">
              {[
                "Only sign up if you're planning to come. Others are counting on a full court and your spot matters.",
                "Need to cancel? Please do it at least 24 hours before the game. Late cancellations mean you'll be asked to cover the session fee next time you join.",
                "Settle your court fees in cash with the host before the game starts. It keeps things smooth for everyone.",
                "Arrive 10 minutes early. Games start on time and we want everyone warmed up and ready.",
                "Be kind and encouraging. All levels are welcome here - cheer on the beginners and keep the vibe positive.",
                "No-shows without a heads-up to the host will be noted. Two strikes and your LINE account will be blacklisted!",
              ].map((rule, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center text-white mt-0.5"
                    style={{ background: "linear-gradient(135deg, #1e3a5f, #2d5a8e)" }}>
                    {i + 1}
                  </span>
                  <p className="text-sm text-gray-500 leading-relaxed">{rule}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
