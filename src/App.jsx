import { useState, useEffect, useRef } from "react";

const SUPABASE_URL = "https://mjucamqnmdjcnkbgkise.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdWNhbXFubWRqY25rYmdraXNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMzUzMDQsImV4cCI6MjA5MzcxMTMwNH0.lx_Yu6bdNEiDZ70E4QDMZlLPodC1y1jrrUkqU24mDTI";

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "",
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function fetchGames() {
  const games = await sbFetch("games?select=*&order=date.asc,time.asc");
  const registrations = await sbFetch("registrations?select=*");
  return games.map((g) => ({
    ...g,
    maxPlayers: g.max_players,
    endTime: g.end_time,
    players: registrations
      .filter((r) => r.game_id === g.id)
      .map((r) => ({ name: r.name, duprRating: r.dupr_rating, regId: r.id })),
  }));
}

async function createGame(data) {
  return sbFetch("games", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify({
      title: data.title,
      date: data.date,
      time: data.time,
      end_time: data.endTime || null,
      location: data.location,
      location_url: data.locationUrl || null,
      max_players: data.maxPlayers,
      price: data.price,
    }),
  });
}

async function createRegistration(gameId, player) {
  return sbFetch("registrations", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify({
      game_id: gameId,
      name: player.name,
      dupr_rating: player.duprRating || null,
    }),
  });
}

function ratingColor(r) {
  if (!r) return "text-gray-400";
  if (r >= 4.5) return "text-purple-500";
  if (r >= 3.5) return "text-blue-500";
  if (r >= 2.5) return "text-green-500";
  return "text-amber-500";
}

function formatTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
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
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

// Google Maps place search input
function PlaceSearchInput({ value, onChange, onPlaceSelect }) {
  const [query, setQuery] = useState(value || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounce = useRef(null);

  async function searchPlaces(q) {
    if (!q || q.length < 3) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`,
        { headers: { "Accept-Language": "en" } }
      );
      const data = await res.json();
      setResults(data);
    } catch (e) {
      setResults([]);
    }
    setLoading(false);
  }

  function handleChange(e) {
    const q = e.target.value;
    setQuery(q);
    onChange(q, null);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => searchPlaces(q), 400);
  }

  function handleSelect(place) {
    const name = place.display_name;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
    setQuery(name);
    setResults([]);
    onChange(name, url);
    onPlaceSelect && onPlaceSelect(name, url);
  }

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Search for a location..."
        value={query}
        onChange={handleChange}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-navy-400 focus:ring-1 focus:ring-blue-100"
      />
      {loading && (
        <div className="absolute right-3 top-2.5 text-gray-300 text-xs">Searching...</div>
      )}
      {results.length > 0 && (
        <div className="absolute z-50 w-full bg-white border border-gray-100 rounded-xl shadow-lg mt-1 overflow-hidden">
          {results.map((place) => (
            <button
              key={place.place_id}
              onClick={() => handleSelect(place)}
              className="w-full text-left px-3 py-2.5 text-xs text-gray-700 hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors"
            >
              <span className="font-medium">{place.name || place.display_name.split(",")[0]}</span>
              <span className="text-gray-400 ml-1">{place.display_name.split(",").slice(1, 3).join(",")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RegisterModal({ game, onRegister, onClose }) {
  const [name, setName] = useState("");
  const [duprRating, setDuprRating] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!name.trim()) { setError("Please enter your name."); return; }
    const rating = duprRating ? parseFloat(duprRating) : null;
    if (duprRating && (isNaN(rating) || rating < 1 || rating > 6)) {
      setError("DUPR rating must be a number between 1 and 6.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onRegister(game.id, { name: name.trim(), duprRating: rating });
      onClose();
    } catch (e) {
      setError("Something went wrong. Please try again.");
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex justify-between items-start mb-1">
          <div>
            <h2 className="text-base font-bold text-gray-900">Join Game</h2>
            <p className="text-xs text-gray-400 mt-0.5">{game.title}</p>
          </div>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-500 text-xl leading-none mt-0.5">✕</button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Your Name</label>
            <input
              autoFocus
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50 transition-all"
              placeholder="e.g. Jamie Chen"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
              DUPR Rating <span className="normal-case font-normal text-gray-300">(optional)</span>
            </label>
            <input
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50 transition-all"
              placeholder="e.g. 3.75"
              value={duprRating}
              onChange={(e) => setDuprRating(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              type="number"
              min="1"
              max="6"
              step="0.01"
            />
            <p className="text-xs text-gray-300 mt-1">Enter your DUPR rating so others know your skill level.</p>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="mt-1 w-full py-3 rounded-xl font-bold text-sm text-white transition-all disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #1e3a5f, #2d5a8e)" }}
          >
            {loading ? "Joining..." : "Confirm Registration"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GameCard({ game, onRegister }) {
  const [showModal, setShowModal] = useState(false);
  const isFull = game.players.length >= game.maxPlayers;
  const spotsLeft = game.maxPlayers - game.players.length;
  const pct = game.players.length / game.maxPlayers;

  const statusColor = isFull
    ? "bg-red-50 text-red-500 border-red-100"
    : spotsLeft <= 2
    ? "bg-amber-50 text-amber-600 border-amber-100"
    : "bg-emerald-50 text-emerald-600 border-emerald-100";

  const statusLabel = isFull ? "Full" : `${spotsLeft} spot${spotsLeft !== 1 ? "s" : ""} left`;

  return (
    <>
      {showModal && (
        <RegisterModal game={game} onRegister={onRegister} onClose={() => setShowModal(false)} />
      )}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
        {/* Card header accent */}
        <div className="h-1" style={{ background: isFull ? "#f87171" : pct >= 0.75 ? "#fbbf24" : "#4ade80" }} />

        <div className="p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-gray-900 text-base leading-tight truncate">{game.title}</h3>
              {game.location_url ? (
                <a
                  href={game.location_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:underline mt-0.5 flex items-center gap-1"
                >
                  📍 {game.location}
                </a>
              ) : (
                <p className="text-xs text-gray-400 mt-0.5">📍 {game.location}</p>
              )}
            </div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border flex-shrink-0 ${statusColor}`}>
              {statusLabel}
            </span>
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-gray-500 mb-4">
            <span className="flex items-center gap-1">
              📅 {new Date(game.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </span>
            <span className="flex items-center gap-1">
              ⏰ {formatTime(game.time)}{game.endTime ? ` – ${formatTime(game.endTime)}` : ""}
            </span>
            {game.price > 0
              ? <span className="flex items-center gap-1 text-emerald-600 font-semibold">💵 ${Number(game.price).toFixed(2)}/player</span>
              : <span className="flex items-center gap-1 text-emerald-500 font-semibold">🆓 Free</span>
            }
          </div>

          <SpotsBar filled={game.players.length} max={game.maxPlayers} />

          {game.players.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {game.players.map((p, i) => (
                <div key={i} className="flex items-center gap-1 bg-gray-50 border border-gray-100 rounded-full pl-2 pr-2.5 py-0.5">
                  <span className="text-xs text-gray-600 font-medium">{p.name}</span>
                  {p.duprRating != null && (
                    <span className={`text-xs font-bold ${ratingColor(p.duprRating)}`}>
                      · {Number(p.duprRating).toFixed(2)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mt-4">
            {!isFull ? (
              <button
                onClick={() => setShowModal(true)}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-95"
                style={{ background: "linear-gradient(135deg, #1e3a5f, #2d5a8e)" }}
              >
                + Register
              </button>
            ) : (
              <div className="w-full py-2.5 rounded-xl text-sm font-semibold text-red-400 bg-red-50 text-center">
                Game is Full
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function CalendarView({ games, onRegister }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(null);

  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const startPad = monthStart.getDay();
  const totalDays = monthEnd.getDate();

  const gamesByDate = {};
  games.forEach((g) => {
    if (!gamesByDate[g.date]) gamesByDate[g.date] = [];
    gamesByDate[g.date].push(g);
  });

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
    setSelectedDate(null);
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
    setSelectedDate(null);
  }

  const monthLabel = new Date(year, month).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const selectedGames = selectedDate ? (gamesByDate[selectedDate] || []) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-5">
          <button onClick={prevMonth} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400 transition-colors font-bold text-lg">‹</button>
          <span className="font-bold text-gray-800">{monthLabel}</span>
          <button onClick={nextMonth} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400 transition-colors font-bold text-lg">›</button>
        </div>
        <div className="grid grid-cols-7 mb-2">
          {days.map(d => (
            <div key={d} className="text-center text-xs font-semibold text-gray-300 py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {Array.from({ length: startPad }).map((_, i) => <div key={`pad-${i}`} />)}
          {Array.from({ length: totalDays }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const hasGames = !!gamesByDate[dateStr];
            const isToday = dateStr === today.toISOString().slice(0, 10);
            const isSelected = dateStr === selectedDate;
            const isPast = new Date(dateStr) < new Date(today.toISOString().slice(0, 10));

            return (
              <button
                key={day}
                onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                className={`relative mx-auto w-9 h-9 flex flex-col items-center justify-center rounded-xl text-sm font-medium transition-all
                  ${isSelected ? "text-white shadow-sm" : isToday ? "font-bold" : isPast ? "text-gray-300" : "text-gray-700 hover:bg-gray-50"}`}
                style={isSelected ? { background: "linear-gradient(135deg, #1e3a5f, #2d5a8e)" } : isToday ? { color: "#1e3a5f" } : {}}
              >
                {day}
                {hasGames && (
                  <span className={`absolute bottom-1 w-1 h-1 rounded-full ${isSelected ? "bg-white" : "bg-green-400"}`} />
                )}
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
          {selectedGames.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-sm text-gray-300">
              No games on this day.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {selectedGames.map((game) => (
                <GameCard key={game.id} game={game} onRegister={onRegister} />
              ))}
            </div>
          )}
        </div>
      )}
      {!selectedDate && (
        <p className="text-xs text-center text-gray-300">Tap a date with a green dot to see games</p>
      )}
    </div>
  );
}

function AdminModal({ onClose, onCreate }) {
  const [form, setForm] = useState({
    title: "", date: "", time: "", endTime: "", location: "", locationUrl: "", maxPlayers: 8, price: ""
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function update(field, val) {
    setForm((f) => ({ ...f, [field]: val }));
  }

  async function handleCreate() {
    if (!form.title || !form.date || !form.time || !form.location) {
      setError("Please fill in all required fields.");
      return;
    }
    setLoading(true);
    try {
      await onCreate({ ...form, maxPlayers: Number(form.maxPlayers), price: form.price ? Number(form.price) : 0 });
      onClose();
    } catch (e) {
      setError("Something went wrong. Please try again.");
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-bold text-gray-900">Create New Game</h2>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-500 text-xl leading-none">✕</button>
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">Game Title</label>
            <input
              type="text" placeholder="e.g. Morning Rally"
              value={form.title} onChange={(e) => update("title", e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">Date</label>
            <input
              type="date" value={form.date} onChange={(e) => update("date", e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">Start Time</label>
              <input
                type="time" value={form.time} onChange={(e) => update("time", e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">End Time <span className="normal-case font-normal text-gray-300">(optional)</span></label>
              <input
                type="time" value={form.endTime} onChange={(e) => update("endTime", e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">Location</label>
            <PlaceSearchInput
              value={form.location}
              onChange={(name, url) => update("location", name) || update("locationUrl", url || "")}
              onPlaceSelect={(name, url) => {
                update("location", name);
                update("locationUrl", url);
              }}
            />
            {form.locationUrl && (
              <a href={form.locationUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline mt-1 block">
                View on Google Maps ↗
              </a>
            )}
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">Max Players</label>
              <input
                type="number" min={2} max={32} value={form.maxPlayers}
                onChange={(e) => update("maxPlayers", e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 block">Price / Player ($)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="number" min={0} step={0.5} placeholder="0.00" value={form.price}
                  onChange={(e) => update("price", e.target.value)}
                  className="w-full border border-gray-200 rounded-xl pl-6 pr-3 py-2.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
                />
              </div>
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-red-500 mt-3">{error}</p>}

        <button
          onClick={handleCreate}
          disabled={loading}
          className="mt-5 w-full py-3 rounded-xl font-bold text-sm text-white transition-all disabled:opacity-50 hover:opacity-90"
          style={{ background: "linear-gradient(135deg, #1e3a5f, #2d5a8e)" }}
        >
          {loading ? "Creating..." : "Create Game"}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);
  const [view, setView] = useState("list");

  async function loadGames() {
    try {
      const data = await fetchGames();
      setGames(data);
    } catch (e) {
      console.error("Failed to load games", e);
    }
    setLoading(false);
  }

  useEffect(() => { loadGames(); }, []);

  async function handleRegister(gameId, player) {
    await createRegistration(gameId, player);
    await loadGames();
  }

  async function handleCreate(data) {
    await createGame(data);
    await loadGames();
  }

  const sorted = [...games].sort((a, b) => new Date(a.date) - new Date(b.date));

  return (
    <div className="min-h-screen bg-gray-50">
      {showAdmin && (
        <AdminModal onClose={() => setShowAdmin(false)} onCreate={handleCreate} />
      )}

      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Taichung Pickleball Community"
              className="w-10 h-10 object-contain"
            />
            <div>
              <h1 className="font-black text-gray-900 text-base leading-tight tracking-tight">Pickleball Taichung</h1>
              <p className="text-xs text-gray-400">Find & join games</p>
            </div>
          </div>
          <button
            onClick={() => setShowAdmin(true)}
            className="text-white text-sm font-bold px-4 py-2 rounded-xl transition-all hover:opacity-90 shadow-sm"
            style={{ background: "linear-gradient(135deg, #1e3a5f, #2d5a8e)" }}
          >
            + New Game
          </button>
        </div>

        {/* View toggle */}
        <div className="max-w-2xl mx-auto px-4 pb-3 flex gap-1">
          {[
            { id: "list", label: "📋 List" },
            { id: "calendar", label: "📅 Calendar" },
          ].map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                view === v.id
                  ? "text-white"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              }`}
              style={view === v.id ? { background: "linear-gradient(135deg, #1e3a5f, #2d5a8e)" } : {}}
            >
              {v.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-gray-300 text-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-400 rounded-full animate-spin" />
              Loading games...
            </div>
          </div>
        ) : view === "list" ? (
          <>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Upcoming Games</h2>
            {sorted.length === 0 ? (
              <div className="text-center text-gray-300 text-sm py-20">
                <p className="text-4xl mb-3">🏓</p>
                <p>No games yet. Create one!</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {sorted.map((game) => (
                  <GameCard key={game.id} game={game} onRegister={handleRegister} />
                ))}
              </div>
            )}
          </>
        ) : (
          <CalendarView games={games} onRegister={handleRegister} />
        )}
      </main>
    </div>
  );
}
