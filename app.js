/**
 * CricketPulse - Main Application Logic
 */

const CONFIG = {
  apiKey: "b5f09bfe-bac8-4f9d-95f4-caa26e0fcad4",
  endpoints: [
    "https://api.cricapi.com/v1/cricScore",
    "https://api.cricapi.com/v1/matches"
  ],
  corsProxy: "https://api.allorigins.win/raw?url=",
  refreshIntervalSeconds: 45
};

// Application State
const state = {
  rawMatches: [],
  filteredMatches: [],
  activeFilter: "all",
  searchQuery: "",
  timerCountdown: CONFIG.refreshIntervalSeconds,
  intervalId: null
};

// DOM References
const elements = {
  grid: document.getElementById("matches-grid"),
  statusBar: document.getElementById("status-bar"),
  timerDisplay: document.getElementById("auto-refresh-timer"),
  btnRefresh: document.getElementById("btn-manual-refresh"),
  searchInput: document.getElementById("search-input"),
  filterTabs: document.querySelectorAll(".filter-tab"),
  modal: document.getElementById("detail-modal"),
  modalBody: document.getElementById("modal-body"),
  modalClose: document.getElementById("btn-close-modal")
};

// Helper: Escape untrusted text
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

// Show alert banner
function setStatus(message, isAlert = false) {
  if (!message) {
    elements.statusBar.className = "status-bar hidden";
    elements.statusBar.textContent = "";
    return;
  }
  elements.statusBar.className = `status-bar ${isAlert ? "alert" : ""}`;
  elements.statusBar.textContent = message;
}

// Network Request with automatic proxy fallback
async function fetchWithFallback(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
    return await res.json();
  } catch (directErr) {
    // If running under file:// or meeting strict local CORS, attempt proxy
    const proxied = `${CONFIG.corsProxy}${encodeURIComponent(url)}`;
    const proxyRes = await fetch(proxied);
    return await proxyRes.json();
  }
}

// Fetch matches from primary or secondary CricAPI endpoint
async function loadMatchData() {
  setStatus(null);

  try {
    // 1. Try cricScore endpoint
    let url = `${CONFIG.endpoints[0]}?apikey=${CONFIG.apiKey}`;
    let json = await fetchWithFallback(url);

    // 2. If cricScore is empty or failed, fallback to matches endpoint
    if (!json || json.status !== "success" || !Array.isArray(json.data) || json.data.length === 0) {
      url = `${CONFIG.endpoints[1]}?apikey=${CONFIG.apiKey}&offset=0`;
      json = await fetchWithFallback(url);
    }

    if (json.status !== "success") {
      throw new Error(json.message || "Failed to retrieve scores from CricAPI.");
    }

    state.rawMatches = normalizeMatches(json.data || []);
    applyFilters();
  } catch (err) {
    setStatus(`Connection Notice: ${err.message}`, true);
    elements.grid.innerHTML = `
      <div class="empty-state">
        <p>Unable to load match data right now.</p>
        <p style="font-size: 0.8rem; margin-top: 6px;">Check console logs or verify your daily API call count on CricAPI.</p>
      </div>`;
  }
}

// Unify varying schemas between CricAPI endpoints
function normalizeMatches(list) {
  return list.map((item, index) => {
    const isLive = item.ms === "live" || (item.matchStarted && !item.matchEnded);
    const isCompleted = item.ms === "result" || item.matchEnded;
    
    let stage = "upcoming";
    if (isLive) stage = "live";
    else if (isCompleted) stage = "completed";

    return {
      id: item.id || `match-${index}`,
      format: (item.matchType || "Cricket").toUpperCase(),
      stage: stage,
      team1: item.t1 || (item.teams && item.teams[0]) || "Team 1",
      team2: item.t2 || (item.teams && item.teams[1]) || "Team 2",
      crest1: item.t1img || "",
      crest2: item.t2img || "",
      score1: item.t1s || (item.score && item.score[0] ? `${item.score[0].r}/${item.score[0].w} (${item.score[0].o} ov)` : "-"),
      score2: item.t2s || (item.score && item.score[1] ? `${item.score[1].r}/${item.score[1].w} (${item.score[1].o} ov)` : "-"),
      status: item.status || "Scheduled",
      dateTimeGMT: item.dateTimeGMT || ""
    };
  });
}

// Filter and Search Pipeline
function applyFilters() {
  const query = state.searchQuery.trim().toLowerCase();

  state.filteredMatches = state.rawMatches.filter(m => {
    // Stage check
    const matchesFilter = state.activeFilter === "all" || m.stage === state.activeFilter;
    // Query check
    const matchesQuery = !query || 
      m.team1.toLowerCase().includes(query) || 
      m.team2.toLowerCase().includes(query);

    return matchesFilter && matchesQuery;
  });

  renderCards();
}

// Render cards into grid
function renderCards() {
  if (state.filteredMatches.length === 0) {
    elements.grid.innerHTML = `
      <div class="empty-state">
        <p>No matches found matching current filters.</p>
      </div>`;
    return;
  }

  elements.grid.innerHTML = "";

  state.filteredMatches.forEach(match => {
    const card = document.createElement("article");
    card.className = "match-card";
    
    const badgeClass = 
      match.stage === "live" ? "badge-live" : 
      match.stage === "completed" ? "badge-completed" : "badge-upcoming";

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

    card.addEventListener("click", () => openDetailModal(match));
    elements.grid.appendChild(card);
  });
}

// Modal Detail View
function openDetailModal(match) {
  elements.modalBody.innerHTML = `
    <h3 style="font-size: 1.2rem; margin-bottom: 6px;">${sanitize(match.team1)} vs ${sanitize(match.team2)}</h3>
    <p style="color: var(--text-dim); font-size: 0.85rem; margin-bottom: 16px;">Format: ${sanitize(match.format)}</p>
    
    <div style="background: #0f172a; padding: 14px; border-radius: 8px; margin-bottom: 16px;">
      <div style="display:flex; justify-content:space-between; margin-bottom: 8px;">
        <strong>${sanitize(match.team1)}</strong>
        <span style="color:#38bdf8;">${sanitize(match.score1)}</span>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <strong>${sanitize(match.team2)}</strong>
        <span style="color:#38bdf8;">${sanitize(match.score2)}</span>
      </div>
    </div>

    <p style="font-size: 0.9rem; line-height: 1.4;"><strong>Status:</strong> ${sanitize(match.status)}</p>
    ${match.dateTimeGMT ? `<p style="font-size: 0.8rem; color: var(--text-dim); margin-top: 8px;">Date (GMT): ${sanitize(match.dateTimeGMT)}</p>` : ""}
  `;
  elements.modal.classList.remove("hidden");
}

function closeModal() {
  elements.modal.classList.add("hidden");
}

// Timer Logic
function startAutoRefresh() {
  if (state.intervalId) clearInterval(state.intervalId);

  state.timerCountdown = CONFIG.refreshIntervalSeconds;
  updateTimerUI();

  state.intervalId = setInterval(() => {
    state.timerCountdown--;
    if (state.timerCountdown <= 0) {
      state.timerCountdown = CONFIG.refreshIntervalSeconds;
      loadMatchData();
    }
    updateTimerUI();
  }, 1000);
}

function updateTimerUI() {
  elements.timerDisplay.textContent = `Refreshing in: ${state.timerCountdown}s`;
}

// Event Bindings
function initEvents() {
  elements.btnRefresh.addEventListener("click", () => {
    loadMatchData();
    startAutoRefresh();
  });

  elements.searchInput.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    applyFilters();
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

// Bootstrap
function init() {
  initEvents();
  loadMatchData();
  startAutoRefresh();
}

init();
