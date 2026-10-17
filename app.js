/**
 * CricketPulse - Main Application Logic
 */

const CONFIG = {
  apiKey: "b5f09bfe-bac8-4f9d-95f4-caa26e0fcad4",
  endpoints: {
    currentMatches: "https://api.cricapi.com/v1/currentMatches",
    matches: "https://api.cricapi.com/v1/matches",
    matchInfo: "https://api.cricapi.com/v1/match_info",
    series: "https://api.cricapi.com/v1/series",
    seriesInfo: "https://api.cricapi.com/v1/series_info",
    players: "https://api.cricapi.com/v1/players",
    playerInfo: "https://api.cricapi.com/v1/players_info"
  },
  corsProxy: "https://api.allorigins.win/raw?url=",
  refreshIntervalSeconds: 45
};

// Application State
const state = {
  currentView: "current", // 'current' | 'fixtures' | 'series' | 'players'
  rawMatches: [],
  rawSeries: [],
  rawPlayers: [],
  filteredList: [],
  activeFilter: "all",
  searchQuery: "",
  timerCountdown: CONFIG.refreshIntervalSeconds,
  intervalId: null
};

// DOM Elements
const elements = {
  grid: document.getElementById("matches-grid"),
  statusBar: document.getElementById("status-bar"),
  timerDisplay: document.getElementById("auto-refresh-timer"),
  btnRefresh: document.getElementById("btn-manual-refresh"),
  searchInput: document.getElementById("search-input"),
  stageFilterGroup: document.getElementById("stage-filter-group"),
  filterTabs: document.querySelectorAll(".filter-tab"),
  viewTabs: document.querySelectorAll(".view-tab"),
  modal: document.getElementById("detail-modal"),
  modalBody: document.getElementById("modal-body"),
  modalClose: document.getElementById("btn-close-modal")
};

function sanitize(str) {
  if (!str) return "";
  return String(str).replace(/[&<>'"]/g, tag => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[tag] || tag));
}

function setStatus(message, isAlert = false) {
  if (!message) {
    elements.statusBar.className = "status-bar hidden";
    elements.statusBar.textContent = "";
    return;
  }
  elements.statusBar.className = `status-bar ${isAlert ? "alert" : ""}`;
  elements.statusBar.textContent = message;
}

async function fetchWithFallback(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (directErr) {
    const proxied = `${CONFIG.corsProxy}${encodeURIComponent(url)}`;
    const proxyRes = await fetch(proxied);
    return await proxyRes.json();
  }
}

function formatInningsScore(scoreArray, teamName) {
  if (!Array.isArray(scoreArray) || scoreArray.length === 0) return "-";
  const innings = scoreArray.filter(s => 
    s.inning && teamName && s.inning.toLowerCase().includes(teamName.toLowerCase())
  );
  const target = innings.length > 0 ? innings : scoreArray;
  return target.map(s => `${s.r}/${s.w} (${s.o} ov)`).join(" & ");
}

function normalizeMatches(list) {
  return list.map((item, index) => {
    const team1 = item.teams?.[0] || item.t1 || "Team 1";
    const team2 = item.teams?.[1] || item.t2 || "Team 2";
    const crest1 = item.teamInfo?.[0]?.img || item.t1img || "";
    const crest2 = item.teamInfo?.[1]?.img || item.t2img || "";

    const isLive = item.ms === "live" || (item.matchStarted && !item.matchEnded);
    const isCompleted = item.ms === "result" || item.matchEnded;
    
    let stage = "upcoming";
    if (isLive) stage = "live";
    else if (isCompleted) stage = "completed";

    let score1 = "-";
    let score2 = "-";
    if (item.score && Array.isArray(item.score)) {
      score1 = formatInningsScore(item.score, team1);
      score2 = formatInningsScore(item.score, team2);
    } else {
      score1 = item.t1s || "-";
      score2 = item.t2s || "-";
    }

    return {
      id: item.id || `match-${index}`,
      format: (item.matchType || "Cricket").toUpperCase(),
      stage: stage,
      team1: team1,
      team2: team2,
      crest1: crest1,
      crest2: crest2,
      score1: score1,
      score2: score2,
      status: item.status || "Scheduled",
      venue: item.venue || "",
      date: item.date || item.dateTimeGMT || ""
    };
  });
}

// 1. Matches Loader (Current Matches / All Fixtures)
async function loadMatches(endpointUrl) {
  setStatus(null);
  elements.grid.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Fetching matches...</p></div>';

  try {
    const json = await fetchWithFallback(`${endpointUrl}?apikey=${CONFIG.apiKey}&offset=0`);
    if (json.status !== "success") {
      throw new Error(json.message || "Failed to load matches.");
    }
    state.rawMatches = normalizeMatches(json.data || []);
    applyFilters();
  } catch (err) {
    setStatus(`Notice: ${err.message}`, true);
    elements.grid.innerHTML = `<div class="empty-state"><p>Could not load matches: ${sanitize(err.message)}</p></div>`;
  }
}

// 2. Series & Tournaments Loader (/v1/series)
async function loadSeries(searchQuery = "") {
  setStatus(null);
  elements.grid.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Fetching cricket series & tournaments...</p></div>';

  try {
    let url = `${CONFIG.endpoints.series}?apikey=${CONFIG.apiKey}&offset=0`;
    if (searchQuery.trim()) {
      url += `&search=${encodeURIComponent(searchQuery.trim())}`;
    }

    const json = await fetchWithFallback(url);
    if (json.status !== "success") {
      throw new Error(json.message || "Failed to load series.");
    }

    state.rawSeries = json.data || [];
    applyFilters();
  } catch (err) {
    setStatus(`Notice: ${err.message}`, true);
    elements.grid.innerHTML = `<div class="empty-state"><p>Could not load series: ${sanitize(err.message)}</p></div>`;
  }
}

// 3. Players Directory Loader (/v1/players)
async function loadPlayers() {
  setStatus(null);
  elements.grid.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Fetching players directory...</p></div>';

  try {
    const json = await fetchWithFallback(`${CONFIG.endpoints.players}?apikey=${CONFIG.apiKey}&offset=0`);
    if (json.status !== "success") {
      throw new Error(json.message || "Failed to load players.");
    }
    state.rawPlayers = json.data || [];
    applyFilters();
  } catch (err) {
    setStatus(`Notice: ${err.message}`, true);
    elements.grid.innerHTML = `<div class="empty-state"><p>Could not load players: ${sanitize(err.message)}</p></div>`;
  }
}

// 4. Match Scorecard Modal Detail (/v1/match_info)
async function fetchMatchDetail(matchId, fallbackMatch) {
  openModal('<div class="spinner"></div><p style="text-align:center;margin-top:10px;">Fetching detailed scorecard...</p>');

  try {
    const json = await fetchWithFallback(`${CONFIG.endpoints.matchInfo}?apikey=${CONFIG.apiKey}&id=${matchId}`);
    if (json.status === "success" && json.data) {
      renderMatchModalContent(json.data);
    } else {
      renderMatchModalContent(fallbackMatch);
    }
  } catch (err) {
    renderMatchModalContent(fallbackMatch);
  }
}

// 5. Player Profile Modal Detail (/v1/players_info)
async function fetchPlayerDetail(playerId, playerName) {
  openModal('<div class="spinner"></div><p style="text-align:center;margin-top:10px;">Fetching player profile & stats...</p>');

  try {
    const json = await fetchWithFallback(`${CONFIG.endpoints.playerInfo}?apikey=${CONFIG.apiKey}&id=${playerId}`);
    if (json.status === "success" && json.data) {
      renderPlayerModalContent(json.data);
    } else {
      openModal(`<h3>${sanitize(playerName)}</h3><p style="color:var(--text-dim);margin-top:8px;">Detailed stats are currently unavailable.</p>`);
    }
  } catch (err) {
    openModal(`<h3>${sanitize(playerName)}</h3><p style="color:var(--text-dim);margin-top:8px;">Failed to load player stats.</p>`);
  }
}

// Filter and Render Pipeline
function applyFilters() {
  const query = state.searchQuery.trim().toLowerCase();

  if (state.currentView === "players") {
    state.filteredList = state.rawPlayers.filter(p => 
      !query || (p.name && p.name.toLowerCase().includes(query)) || (p.country && p.country.toLowerCase().includes(query))
    );
    renderPlayerCards();
  } else if (state.currentView === "series") {
    state.filteredList = state.rawSeries.filter(s =>
      !query || (s.name && s.name.toLowerCase().includes(query))
    );
    renderSeriesCards();
  } else {
    state.filteredList = state.rawMatches.filter(m => {
      const stageMatch = state.activeFilter === "all" || m.stage === state.activeFilter;
      const queryMatch = !query || m.team1.toLowerCase().includes(query) || m.team2.toLowerCase().includes(query);
      return stageMatch && queryMatch;
    });
    renderMatchCards();
  }
}

function renderMatchCards() {
  if (state.filteredList.length === 0) {
    elements.grid.innerHTML = '<div class="empty-state"><p>No matches found matching criteria.</p></div>';
    return;
  }

  elements.grid.innerHTML = "";
  state.filteredList.forEach(match => {
    const card = document.createElement("article");
    card.className = "match-card";
    const badgeClass = match.stage === "live" ? "badge-live" : match.stage === "completed" ? "badge-completed" : "badge-upcoming";

    card.innerHTML = `
      <div>
        <div class="card-header">
          <span class="match-format">${sanitize(match.format)}</span>
          <span class="status-badge ${badgeClass}">${match.stage}</span>
        </div>
        <div class="teams-list">
          <div class="team-entry">
            <div class="team-info">
              ${match.crest1 ? `<img class="team-crest" src="${sanitize(match.crest1)}" alt="" onerror="this.style.display='none'">` : ""}
              <span>${sanitize(match.team1)}</span>
            </div>
            <div class="team-score">${sanitize(match.score1)}</div>
          </div>
          <div class="team-entry">
            <div class="team-info">
              ${match.crest2 ? `<img class="team-crest" src="${sanitize(match.crest2)}" alt="" onerror="this.style.display='none'">` : ""}
              <span>${sanitize(match.team2)}</span>
            </div>
            <div class="team-score">${sanitize(match.score2)}</div>
          </div>
        </div>
      </div>
      <footer class="card-footer">${sanitize(match.status)}</footer>
    `;

    card.addEventListener("click", () => fetchMatchDetail(match.id, match));
    elements.grid.appendChild(card);
  });
}

function renderSeriesCards() {
  if (state.filteredList.length === 0) {
    elements.grid.innerHTML = '<div class="empty-state"><p>No tournaments or series found.</p></div>';
    return;
  }

  elements.grid.innerHTML = "";
  state.filteredList.forEach(series => {
    const card = document.createElement("article");
    card.className = "series-card";

    card.innerHTML = `
      <div>
        <div class="card-header">
          <span class="match-format">SERIES / TOURNAMENT</span>
          <span class="status-badge badge-upcoming">${series.matches || 0} MATCHES</span>
        </div>
        <h4>${sanitize(series.name || "Cricket Tournament")}</h4>
        <div class="series-stat-row">
          <span class="series-pill">ODI: ${series.odi || 0}</span>
          <span class="series-pill">T20: ${series.t20 || 0}</span>
          <span class="series-pill">Test: ${series.test || 0}</span>
        </div>
      </div>
      <footer class="card-footer">
        📅 ${sanitize(series.startDate || "TBD")} to ${sanitize(series.endDate || "TBD")}
      </footer>
    `;

    card.addEventListener("click", () => openSeriesModal(series));
    elements.grid.appendChild(card);
  });
}

function renderPlayerCards() {
  if (state.filteredList.length === 0) {
    elements.grid.innerHTML = '<div class="empty-state"><p>No players found.</p></div>';
    return;
  }

  elements.grid.innerHTML = "";
  state.filteredList.forEach(player => {
    const card = document.createElement("div");
    card.className = "player-card";
    card.innerHTML = `
      <div class="player-avatar">👤</div>
      <div class="player-info">
        <h4>${sanitize(player.name || "Unknown Player")}</h4>
        <p>${sanitize(player.country || "International")}</p>
      </div>
    `;

    card.addEventListener("click", () => fetchPlayerDetail(player.id, player.name));
    elements.grid.appendChild(card);
  });
}

// Modal Builders
function renderMatchModalContent(m) {
  const t1 = m.team1 || (m.teams && m.teams[0]) || "Team 1";
  const t2 = m.team2 || (m.teams && m.teams[1]) || "Team 2";
  const format = (m.format || m.matchType || "Cricket").toUpperCase();
  const status = m.status || "In progress";

  let scoresHtml = "";
  if (Array.isArray(m.score) && m.score.length > 0) {
    scoresHtml = m.score.map(s => `
      <div style="display:flex; justify-content:space-between; margin-bottom: 6px;">
        <span>${sanitize(s.inning)}</span>
        <strong style="color:#38bdf8;">${s.r}/${s.w} (${s.o} ov)</strong>
      </div>
    `).join("");
  } else {
    scoresHtml = `
      <div style="display:flex; justify-content:space-between; margin-bottom: 6px;">
        <span>${sanitize(t1)}</span><strong style="color:#38bdf8;">${sanitize(m.score1 || "-")}</strong>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span>${sanitize(t2)}</span><strong style="color:#38bdf8;">${sanitize(m.score2 || "-")}</strong>
      </div>
    `;
  }

  openModal(`
    <h3 style="font-size: 1.2rem; margin-bottom: 4px;">${sanitize(t1)} vs ${sanitize(t2)}</h3>
    <p style="color: var(--text-dim); font-size: 0.85rem; margin-bottom: 14px;">${sanitize(format)} Match</p>
    
    <div style="background: #0f172a; padding: 14px; border-radius: 8px; margin-bottom: 16px;">
      ${scoresHtml}
    </div>

    <p style="font-size: 0.9rem; line-height: 1.4;"><strong>Status:</strong> ${sanitize(status)}</p>
    ${m.venue ? `<p style="font-size: 0.85rem; color: var(--text-dim); margin-top: 8px;"><strong>Venue:</strong> ${sanitize(m.venue)}</p>` : ""}
    ${m.date || m.dateTimeGMT ? `<p style="font-size: 0.8rem; color: var(--text-dim); margin-top: 4px;"><strong>Date:</strong> ${sanitize(m.date || m.dateTimeGMT)}</p>` : ""}
  `);
}

function openSeriesModal(series) {
  openModal(`
    <h3 style="font-size: 1.25rem; margin-bottom: 6px;">${sanitize(series.name)}</h3>
    <p style="color: var(--text-dim); font-size: 0.85rem; margin-bottom: 16px;">
      ${sanitize(series.startDate || "N/A")} — ${sanitize(series.endDate || "N/A")}
    </p>

    <div class="modal-stat-grid">
      <div class="modal-stat-item">
        <strong>Total Matches</strong>
        <span>${series.matches || 0}</span>
      </div>
      <div class="modal-stat-item">
        <strong>ODI Matches</strong>
        <span>${series.odi || 0}</span>
      </div>
      <div class="modal-stat-item">
        <strong>T20 Matches</strong>
        <span>${series.t20 || 0}</span>
      </div>
      <div class="modal-stat-item">
        <strong>Test Matches</strong>
        <span>${series.test || 0}</span>
      </div>
      <div class="modal-stat-item">
        <strong>Squads Announced</strong>
        <span>${series.squads || 0}</span>
      </div>
    </div>
  `);
}

function renderPlayerModalContent(p) {
  openModal(`
    <div style="display:flex; align-items:center; gap:16px; margin-bottom:16px;">
      ${p.playerImg ? `<img src="${sanitize(p.playerImg)}" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover;">` : '<div class="player-avatar" style="width:64px;height:64px;">👤</div>'}
      <div>
        <h3 style="font-size: 1.25rem;">${sanitize(p.name)}</h3>
        <p style="color: var(--text-dim); font-size: 0.85rem;">${sanitize(p.country || "Cricket Player")}</p>
      </div>
    </div>

    <div class="modal-stat-grid">
      <div class="modal-stat-item">
        <strong>Role</strong>
        <span>${sanitize(p.role || "N/A")}</span>
      </div>
      <div class="modal-stat-item">
        <strong>Batting Style</strong>
        <span>${sanitize(p.battingStyle || "N/A")}</span>
      </div>
      <div class="modal-stat-item">
        <strong>Bowling Style</strong>
        <span>${sanitize(p.bowlingStyle || "N/A")}</span>
      </div>
      <div class="modal-stat-item">
        <strong>Date of Birth</strong>
        <span>${sanitize(p.dateOfBirth ? p.dateOfBirth.split("T")[0] : "N/A")}</span>
      </div>
    </div>
  `);
}

function openModal(html) {
  elements.modalBody.innerHTML = html;
  elements.modal.classList.remove("hidden");
}

function closeModal() {
  elements.modal.classList.add("hidden");
}

function startAutoRefresh() {
  if (state.intervalId) clearInterval(state.intervalId);
  state.timerCountdown = CONFIG.refreshIntervalSeconds;
  updateTimerUI();

  state.intervalId = setInterval(() => {
    state.timerCountdown--;
    if (state.timerCountdown <= 0) {
      state.timerCountdown = CONFIG.refreshIntervalSeconds;
      refreshCurrentView();
    }
    updateTimerUI();
  }, 1000);
}

function updateTimerUI() {
  elements.timerDisplay.textContent = `Refreshing in: ${state.timerCountdown}s`;
}

function refreshCurrentView() {
  if (state.currentView === "current") {
    loadMatches(CONFIG.endpoints.currentMatches);
  } else if (state.currentView === "fixtures") {
    loadMatches(CONFIG.endpoints.matches);
  } else if (state.currentView === "series") {
    loadSeries(state.searchQuery);
  } else if (state.currentView === "players") {
    loadPlayers();
  }
}

let searchDebounceTimer = null;

function initEvents() {
  elements.btnRefresh.addEventListener("click", () => {
    refreshCurrentView();
    startAutoRefresh();
  });

  elements.searchInput.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    
    // For series, query the API search param with a debounce
    if (state.currentView === "series") {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        loadSeries(state.searchQuery);
      }, 500);
    } else {
      applyFilters();
    }
  });

  elements.viewTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      elements.viewTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      state.currentView = tab.getAttribute("data-view");

      // Hide stage filter (Live / Upcoming / Completed) for Series and Players
      if (state.currentView === "players" || state.currentView === "series") {
        elements.stageFilterGroup.classList.add("hidden");
      } else {
        elements.stageFilterGroup.classList.remove("hidden");
      }

      refreshCurrentView();
    });
  });

  elements.filterTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      elements.filterTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      state.activeFilter = tab.getAttribute("data-filter");
      applyFilters();
    });
  });

  elements.modalClose.addEventListener("click", closeModal);
  elements.modal.addEventListener("click", (e) => {
    if (e.target === elements.modal) closeModal();
  });
}

function init() {
  initEvents();
  loadMatches(CONFIG.endpoints.currentMatches);
  startAutoRefresh();
}

init();
