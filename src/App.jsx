import { useState, useEffect } from "react";

const SUPABASE_URL = "https://mjucamqnmdjcnkbgkise.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdWNhbXFubWRqY25rYmdraXNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMzUzMDQsImV4cCI6MjA5MzcxMTMwNH0.lx_Yu6bdNEiDZ70E4QDMZlLPodC1y1jrrUkqU24mDTI";

const MOCK_DUPR_DB = {
  "DUPR-1001": { rating: 4.25 },
  "DUPR-2002": { rating: 3.10 },
  "DUPR-3003": { rating: 5.00 },
  "DUPR-4004": { rating: 2.85 },
};

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
      location: data.location,
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
      dupr_rating: player.duprRating,
    }),
  });
}

function ratingColor(r) {
  if (!r) return "text-gray-400";
  if (r >= 4.5) return "text-purple-600";
  if (r >= 3.5) return "text-blue-600";
  if (r >= 2.5) return "text-green-600";
  return "text-amber-600";
}

function Badge({ children, color }) {
  const colors = {
    green: "bg-emerald-100 text-emerald-700",
    yellow: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors[color]}`}>
      {children}
    </span>
  );
}

function SpotsBar({ filled, max }) {
  const pct = Math.round((filled / max) * 100);
  const color = pct >= 100 ? "bg-red-400" : pct >= 75 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
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

function RegisterModal({ game, onRegister, onClose }) {
  const [name, setName] = useState("");
  const [duprId, setDuprId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!name.trim()) { setError("Please enter your name."); return; }
    setLoading(true);
    setError("");
    let duprRating = null;
    if (duprId.trim()) {
      await new Promise((r) => setTimeout(r, 900));
      const id = duprId.trim().toUpperCase();
      const found = MOCK_DUPR_DB[id];
      if (found) {
        duprRating = found.rating;
      } else {
        setError("DUPR ID not found. Leave it blank if you don't have one.");
        setLoading(false);
        return;
      }
    }
    try {
      await onRegister(game.id, { name: name.trim(), duprRating });
      onClose();
    } catch (e) {
      setError("Something went wrong. Please try again.");
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex justify-between items-center mb-1">
          <h2 className="text-base font-bold text-gray-900">Register for game</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <p className="text-xs text-gray-400 mb-5">{game.title} · {game.location}</p>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Your Name</label>
            <input
              autoFocus
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-400 focus:ring-1 focus:ring-green-200"
              placeholder="e.g. Jamie Chen"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">
              DUPR ID <span className="normal-case font-normal text-gray-400">(optional)</span>
            </label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-400 focus:ring-1 focus:ring-green-200 uppercase tracking-widest"
              placeholder="e.g. DUPR-1001"
              value={duprId}
              onChange={(e) => setDuprId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
            <p className="text-xs text-gray-300 mt-1">Enter your DUPR ID to show your rating to other players.</p>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="mt-1 w-full bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl transition-colors text-sm"
          >
            {loading ? "Saving..." : "Join Game"}
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
  const badgeColor = isFull ? "red" : spotsLeft <= 2 ? "yellow" : "green";
  const badgeLabel = isFull ? "Full" : `${spotsLeft} spot${spotsLeft !== 1 ? "s" : ""} left`;

  return (
    <>
      {showModal && (
        <RegisterModal game={game} onRegister={onRegister} onClose={() => setShowModal(false)} />
      )}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-bold text-gray-900 text-base leading-tight">{game.title}</h3>
            <p className="text-sm text-gray-400 mt-0.5">{game.location}</p>
          </div>
          <Badge color={badgeColor}>{badgeLabel}</Badge>
        </div>
        <div className="flex gap-4 text-sm text-gray-500 flex-wrap">
          <span>📅 {new Date(game.date).toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" })}</span>
          <span>⏰ {game.time}</span>
          {game.price > 0 && <span className="text-green-600 font-semibold">💵 ${Number(game.price).toFixed(2)} / player</span>}
          {game.price === 0 && <span className="text-emerald-500 font-semibold">🆓 Free</span>}
        </div>
        <SpotsBar filled={game.players.length} max={game.maxPlayers} />
        {game.players.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {game.players.map((p, i) => (
              <div key={i} className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-full pl-2 pr-2.5 py-0.5">
                <span className="text-xs text-gray-700 font-medium">{p.name}</span>
                {p.duprRating != null && (
                  <span className={`text-xs font-bold ${ratingColor(p.duprRating)}`}>· {Number(p.duprRating).toFixed(2)}</span>
                )}
              </div>
            ))}
          </div>
        )}
        {!isFull ? (
          <button
            onClick={() => setShowModal(true)}
            className="mt-1 w-full border-2 border-dashed border-green-300 hover:border-green-400 hover:bg-green-50 text-green-600 font-semibold text-sm rounded-xl py-2 transition-colors"
          >
            + Register
          </button>
        ) : (
          <p className="text-sm text-red-400 font-medium text-center py-1">This game is full</p>
        )}
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
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">‹</button>
          <span className="font-bold text-gray-800 text-sm">{monthLabel}</span>
          <button onClick={nextMonth} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">›</button>
        </div>
        <div className="grid grid-cols-7 mb-1">
          {days.map(d => (
            <div key={d} className="text-center text-xs font-semibold text-gray-400 py-1">{d}</div>
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
                className={`relative mx-auto w-8 h-8 flex flex-col items-center justify-center rounded-lg text-xs font-medium transition-colors
                  ${isSelected ? "bg-green-500 text-white" : isToday ? "bg-green-50 text-green-700 font-bold" : isPast ? "text-gray-300" : "text-gray-700 hover:bg-gray-50"}`}
              >
                {day}
                {hasGames && (
                  <span className={`absolute bottom-0.5 w-1 h-1 rounded-full ${isSelected ? "bg-white" : "bg-green-400"}`} />
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
            <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center text-sm text-gray-400">
              No games scheduled for this day.
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
        <p className="text-xs text-center text-gray-300 mt-1">Tap a date with a green dot to see games</p>
      )}
    </div>
  );
}

function AdminModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ title: "", date: "", time: "", location: "", maxPlayers: 8, price: "" });
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
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-bold text-gray-900">Create New Game</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="flex flex-col gap-3">
          {[
            { label: "Game Title", field: "title", type: "text", placeholder: "e.g. Morning Rally" },
            { label: "Date", field: "date", type: "date" },
            { label: "Time", field: "time", type: "time" },
            { label: "Location", field: "location", type: "text", placeholder: "e.g. Court A, Riverside Park" },
          ].map(({ label, field, type, placeholder }) => (
            <div key={field}>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">{label}</label>
              <input
                type={type}
                placeholder={placeholder}
                value={form[field]}
                onChange={(e) => update(field, e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-400 focus:ring-1 focus:ring-green-200"
              />
            </div>
          ))}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Max Players</label>
              <input
                type="number" min={2} max={32} value={form.maxPlayers}
                onChange={(e) => update("maxPlayers", e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-400 focus:ring-1 focus:ring-green-200"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Price / Player ($)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="number" min={0} step={0.5} placeholder="0.00" value={form.price}
                  onChange={(e) => update("price", e.target.value)}
                  className="w-full border border-gray-200 rounded-lg pl-6 pr-3 py-2 text-sm outline-none focus:border-green-400 focus:ring-1 focus:ring-green-200"
                />
              </div>
            </div>
          </div>
        </div>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        <button
          onClick={handleCreate}
          disabled={loading}
          className="mt-5 w-full bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl transition-colors"
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
    <div className="min-h-screen bg-gray-50" style={{ fontFamily: "'Georgia', serif" }}>
      {showAdmin && (
        <AdminModal onClose={() => setShowAdmin(false)} onCreate={handleCreate} />
      )}

      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🏓</span>
            <div>
              <h1 className="font-bold text-gray-900 text-lg leading-tight">Pickleball Hub</h1>
              <p className="text-xs text-gray-400">Find your next game</p>
            </div>
          </div>
          <button
            onClick={() => setShowAdmin(true)}
            className="bg-green-500 hover:bg-green-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors shadow-sm"
          >
            + New Game
          </button>
        </div>
        <div className="max-w-2xl mx-auto px-4 pb-3 flex gap-1">
          {["list", "calendar"].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors capitalize ${
                view === v ? "bg-green-500 text-white" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              }`}
            >
              {v === "list" ? "📋 List" : "📅 Calendar"}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading games...</div>
        ) : view === "list" ? (
          <>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4">Upcoming Games</h2>
            {sorted.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-16">No games yet. Create one with the button above.</div>
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
