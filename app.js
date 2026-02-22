// ===== Storage keys =====
const CREDS_KEY = "mp_creds_v3";
const RUNS_KEY = "mp_runs_v3";
const SESSION_KEY = "mp_session_v3";

// ===== Helpers =====
function $(id) { return document.getElementById(id); }

function nowLocalDatetimeValue() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function loadCreds() {
  const raw = localStorage.getItem(CREDS_KEY);
  return raw ? JSON.parse(raw) : null;
}
function saveCreds(username, passHashHex) {
  localStorage.setItem(CREDS_KEY, JSON.stringify({ username, passHashHex }));
}

function loadRuns() {
  const raw = localStorage.getItem(RUNS_KEY);
  return raw ? JSON.parse(raw) : [];
}
function saveRuns(runs) {
  localStorage.setItem(RUNS_KEY, JSON.stringify(runs));
}

function setSession(isLoggedIn) {
  sessionStorage.setItem(SESSION_KEY, isLoggedIn ? "1" : "0");
}
function getSession() {
  return sessionStorage.getItem(SESSION_KEY) === "1";
}

async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
}

function show(sectionId) {
  $("loginSection").classList.add("hidden");
  $("appSection").classList.add("hidden");
  $(sectionId).classList.remove("hidden");
}

function clampInt(n, min, max) {
  n = Number.isFinite(n) ? Math.floor(n) : 0;
  return Math.max(min, Math.min(max, n));
}

function floorNonNeg(n) {
  n = Number(n || 0);
  return n > 0 ? Math.floor(n) : 0;
}

// ===== Actions list =====
const ACTIONS = [
  "i. Wheel & axle raises 50g ≥15cm",
  "ii. Remove wedge so golf ball rolls ≥20cm",
  "iii. Screw moves object 5cm horizontally",
  "iv. Inclined plane raises 100g object ≥10cm",
  "v. 2nd + 3rd class lever raises object 15cm",
  "vi. Pulley (IMA=2) raises object ≥15cm",
  "vii. Marble knocks 5 dominoes; last moves marble",
  "viii. 1st class lever launches ping pong ball out/top and back",
  "ix. Marble chain of 5; last moves ≥15cm",
  "x. Water raises golf ball ≥5cm then rolls out",
  "xi. Paddlewheel raises 50g object ≥5cm",
  "xii. Archimedes screw raises marble 20cm"
];

function renderActions() {
  const wrap = $("actionsWrap");
  wrap.innerHTML = "";
  ACTIONS.forEach((label, i) => {
    const div = document.createElement("div");
    div.innerHTML = `
      <label>${label} (+50)</label>
      <select id="act_${i}">
        <option value="no">No</option>
        <option value="yes">Yes</option>
      </select>
    `;
    wrap.appendChild(div);
  });
}

function yn(selectId) {
  return $(selectId).value === "yes";
}

// ===== Scoring pieces (based on rules) =====

// Setup: +50 if <=30; if state/nationals: +75 if <=15 else +50 if <=30
function computeSetupPoints() {
  const level = $("tournamentLevel").value;
  const minutes = Number($("setupMinutes").value || 0);

  if (level === "state") {
    if (minutes <= 15) return 75;
    if (minutes <= 30) return 50;
    return 0;
  }
  // regional/invitational
  return minutes <= 30 ? 50 : 0;
}

function computeASLPoints() {
  let pts = 0;
  pts += yn("aslCopies") ? 25 : 0;
  pts += yn("aslFormat") ? 25 : 0;
  pts += yn("aslAccurate") ? 25 : 0;
  pts += yn("aslLabels") ? 25 : 0;
  return pts;
}

function computeStartEndPoints() {
  let pts = 0;
  pts += yn("startAction") ? 100 : 0;
  pts += yn("bell") ? 100 : 0;
  return pts;
}

function computeActionsPoints() {
  let pts = 0;
  for (let i = 0; i < 12; i++) {
    pts += (document.getElementById(`act_${i}`).value === "yes") ? 50 : 0;
  }
  return pts;
}

function computeSortingPoints() {
  const correct = clampInt(Number($("sortCorrect").value || 0), 0, 30);
  const wrong = clampInt(Number($("sortWrong").value || 0), 0, 30);
  const perfect = clampInt(Number($("sortPerfect").value || 0), 0, 3);
  return (10 * correct) + (50 * perfect) - (10 * wrong);
}

// Time points: +2 per full second up to Target; if actual >= 2*target => 0
function computeTimePoints(targetSec, actualSec) {
  if (actualSec >= 2 * targetSec) return 0;
  const sec = Math.min(floorNonNeg(actualSec), floorNonNeg(targetSec));
  return 2 * sec;
}

// Overtime penalty: −2 per full second past Target up to 2×Target
function computeOvertimePenalty(targetSec, actualSec) {
  const t = floorNonNeg(targetSec);
  const a = floorNonNeg(actualSec);
  const maxA = 2 * t;
  const capped = Math.min(a, maxA);
  const overtime = Math.max(0, capped - t);
  return 2 * overtime; // penalty points (positive number to subtract)
}

// Sand bonus: +1 per full second before Target if initiated
function computeSandBonus(targetSec) {
  if (!yn("sandInitiated")) return 0;
  const s = clampInt(Number($("sandSecondsBeforeTarget").value || 0), 0, 10_000);
  return Math.min(s, floorNonNeg(targetSec)); // can’t exceed target seconds
}

// Dimension “under-size” bonus: 0.1 per 0.1cm under, max 30 per dimension
function dimBonusOne(dimCm) {
  const under = 80.0 - Number(dimCm || 0);
  if (under <= 0) return 0;
  const roundedDownToTenth = Math.floor(under * 10) / 10; // 0.1cm steps
  return Math.min(30, roundedDownToTenth);
}
function computeDimensionBonus() {
  if ($("dimBonusOn").value !== "yes") return 0;
  return dimBonusOne($("dimL").value) + dimBonusOne($("dimW").value) + dimBonusOne($("dimH").value);
}

// Dimension over-limit penalties: −25 per dimension > 80
function computeDimOverPenalty() {
  const L = Number($("dimL").value || 0);
  const W = Number($("dimW").value || 0);
  const H = Number($("dimH").value || 0);
  let count = 0;
  if (L > 80.0) count++;
  if (W > 80.0) count++;
  if (H > 80.0) count++;
  return 25 * count;
}

function computeOtherPenalties() {
  let p = 0;
  // walls not open/transparent => -25
  if ($("wallsOk").value === "no") p += 25;
  // leaving device => -50
  if (yn("leftDevice")) p += 50;
  // adjustments => -25 each up to 3
  const adj = clampInt(Number($("adjustments").value || 0), 0, 3);
  p += 25 * adj;
  return p;
}

function computeNoAdjustBonus() {
  const adj = clampInt(Number($("adjustments").value || 0), 0, 3);
  return adj === 0 ? 75 : 0;
}

// Main compute
function computeAll() {
  const target = floorNonNeg($("targetTime").value);
  let actual = floorNonNeg($("actualTime").value);

  const adj = clampInt(Number($("adjustments").value || 0), 0, 3);
  const failedAfterThird = ($("failedAfterThird").value === "yes");
  if (adj === 3 && failedAfterThird) {
    actual = 2 * target; // rule: scoring stops & operation time becomes 2×Target
  }

  const setupPts = computeSetupPoints();
  const aslPts = computeASLPoints();
  const startEndPts = computeStartEndPoints();
  const actionsPts = computeActionsPoints();
  const sortingPts = computeSortingPoints();
  const timePts = computeTimePoints(target, actual);
  const sandBonus = computeSandBonus(target);
  const dimBonus = computeDimensionBonus();
  const noAdjBonus = computeNoAdjustBonus();

  const baseScore =
    setupPts + aslPts + startEndPts + actionsPts +
    sortingPts + timePts + sandBonus + dimBonus + noAdjBonus;

  const penalties =
    computeOvertimePenalty(target, actual) +
    computeDimOverPenalty() +
    computeOtherPenalties();

  const total = baseScore - penalties;

  return {
    target, actual,
    baseScore,
    penalties,
    total,
    breakdown: {
      setupPts, aslPts, startEndPts, actionsPts, sortingPts, timePts, sandBonus, dimBonus, noAdjBonus,
      overtimePenalty: computeOvertimePenalty(target, actual),
      dimOverPenalty: computeDimOverPenalty(),
      otherPenalties: computeOtherPenalties()
    }
  };
}

function updateTotalPreview() {
  const res = computeAll();
  $("totalScore").value = String(res.total);
  $("penaltyPoints").value = String(res.penalties);

  const adj = clampInt(Number($("adjustments").value || 0), 0, 3);
  $("noAdjustBonusDisplay").value = (adj === 0) ? "Yes (+75)" : "No (+0)";
}

// ===== Table rendering & sorting =====
function safeText(s) {
  return String(s ?? "").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function sortRuns(runs) {
  const mode = $("sortMode").value;
  const arr = [...runs];

  const byDate = (a,b) => new Date(a.occurredAt) - new Date(b.occurredAt);
  const byScore = (a,b) => (a.totalScore || 0) - (b.totalScore || 0);

  if (mode === "date_asc") arr.sort(byDate);
  else if (mode === "date_desc") arr.sort((a,b)=>byDate(b,a));
  else if (mode === "score_asc") arr.sort(byScore);
  else if (mode === "score_desc") arr.sort((a,b)=>byScore(b,a));

  return arr;
}

function renderTable() {
  const runs = sortRuns(loadRuns());
  const tbody = $("runsTable").querySelector("tbody");
  tbody.innerHTML = "";

  for (const r of runs) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(r.occurredAt).toLocaleString()}</td>
      <td><b>${r.totalScore}</b></td>
      <td>${r.penalties}</td>
      <td>${r.actualTime}s / ${r.targetTime}s</td>
      <td>${r.dimL}/${r.dimW}/${r.dimH}</td>
      <td>${safeText(r.notes || "")}</td>
      <td><button data-del="${r.id}" class="secondary">Delete</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-del");
      const next = loadRuns().filter(r => r.id !== id);
      saveRuns(next);
      renderTable();
    });
  });
}

// ===== CSV export =====
function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
  return s;
}

function exportCSV() {
  const runs = sortRuns(loadRuns());

  const header = [
    "Run ID","Occurred At","Notes",
    "TargetTime","ActualTime","TournamentLevel","SetupMinutes",
    "ASL_Copies","ASL_Format","ASL_Accurate","ASL_Labels",
    "StartAction","Bell",
    ...Array.from({length:12}, (_,i)=>`Action_${i+1}`),
    "SortCorrect","SortWrong","SortPerfect",
    "SandSecondsBeforeTarget","SandInitiated",
    "DimL","DimW","DimH","DimBonusOn",
    "WallsOk","LeftDevice","Adjustments","FailedAfterThird",
    "BaseScore","PenaltyPoints","TotalScore"
  ];

  const lines = [
    header.join(","),
    ...runs.map(r => {
      const row = [
        r.id, r.occurredAt, r.notes || "",
        r.targetTime, r.actualTime, r.tournamentLevel, r.setupMinutes,
        r.aslCopies, r.aslFormat, r.aslAccurate, r.aslLabels,
        r.startAction, r.bell,
        ...(r.actions || Array(12).fill("no")),
        r.sortCorrect, r.sortWrong, r.sortPerfect,
        r.sandSecondsBeforeTarget, r.sandInitiated,
        r.dimL, r.dimW, r.dimH, r.dimBonusOn,
        r.wallsOk, r.leftDevice, r.adjustments, r.failedAfterThird,
        r.baseScore, r.penalties, r.totalScore
      ];
      return row.map(csvEscape).join(",");
    })
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "mission-possible-runs.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ===== Wiring =====
function wireUpdates() {
  const inputs = [
    "targetTime","actualTime","tournamentLevel","setupMinutes",
    "sandSecondsBeforeTarget","sandInitiated",
    "aslCopies","aslFormat","aslAccurate","aslLabels",
    "startAction","bell",
    "sortCorrect","sortWrong","sortPerfect",
    "dimL","dimW","dimH","dimBonusOn",
    "wallsOk","leftDevice","adjustments","failedAfterThird",
    "sortMode"
  ];

  inputs.forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => { updateTotalPreview(); });
    el.addEventListener("change", () => { updateTotalPreview(); });
  });

  $("sortMode").addEventListener("change", renderTable);

  for (let i = 0; i < 12; i++) {
    $(`act_${i}`).addEventListener("change", updateTotalPreview);
  }
}

// ===== Login handlers =====
$("setCredsBtn").addEventListener("click", async () => {
  const u = $("username").value.trim();
  const p = $("password").value;
  if (!u || !p) {
    $("loginMsg").textContent = "Enter a username and password first.";
    return;
  }
  const hash = await sha256Hex(p);
  saveCreds(u, hash);
  $("loginMsg").textContent = "Login saved. Now press Log in.";
});

$("loginBtn").addEventListener("click", async () => {
  const creds = loadCreds();
  if (!creds) {
    $("loginMsg").textContent = "No login set yet. Enter username/password and click Set/Change Login.";
    return;
  }

  const u = $("username").value.trim();
  const p = $("password").value;

  const hash = await sha256Hex(p);
  if (u === creds.username && hash === creds.passHashHex) {
    setSession(true);
    initApp();
    show("appSection");
    $("loginMsg").textContent = "";
  } else {
    $("loginMsg").textContent = "Wrong username or password.";
  }
});

$("logoutBtn").addEventListener("click", () => {
  setSession(false);
  $("password").value = "";
  show("loginSection");
});

// ===== App handlers =====
$("exportBtn").addEventListener("click", exportCSV);

$("addRunBtn").addEventListener("click", () => {
  const occurredAt = $("occurredAt").value;
  if (!occurredAt) {
    $("appMsg").textContent = "Please set the date/time.";
    return;
  }

  const res = computeAll();

  const run = {
    id: uuid(),
    occurredAt: new Date(occurredAt).toISOString(),
    notes: $("notes").value.trim(),

    targetTime: res.target,
    actualTime: res.actual,
    tournamentLevel: $("tournamentLevel").value,
    setupMinutes: Number($("setupMinutes").value || 0),

    sandSecondsBeforeTarget: clampInt(Number($("sandSecondsBeforeTarget").value || 0), 0, 100000),
    sandInitiated: $("sandInitiated").value,

    aslCopies: $("aslCopies").value,
    aslFormat: $("aslFormat").value,
    aslAccurate: $("aslAccurate").value,
    aslLabels: $("aslLabels").value,
    startAction: $("startAction").value,
    bell: $("bell").value,

    actions: Array.from({ length: 12 }, (_, i) => $(`act_${i}`).value),

    sortCorrect: clampInt(Number($("sortCorrect").value || 0), 0, 30),
    sortWrong: clampInt(Number($("sortWrong").value || 0), 0, 30),
    sortPerfect: clampInt(Number($("sortPerfect").value || 0), 0, 3),

    dimL: Number($("dimL").value || 0),
    dimW: Number($("dimW").value || 0),
    dimH: Number($("dimH").value || 0),
    dimBonusOn: $("dimBonusOn").value,

    wallsOk: $("wallsOk").value,
    leftDevice: $("leftDevice").value,
    adjustments: clampInt(Number($("adjustments").value || 0), 0, 3),
    failedAfterThird: $("failedAfterThird").value,

    baseScore: res.baseScore,
    penalties: res.penalties,
    totalScore: res.total,
    breakdown: res.breakdown
  };

  const runs = loadRuns();
  runs.push(run);
  saveRuns(runs);

  $("appMsg").textContent = "Saved!";
  $("notes").value = "";
  renderTable();
});

// ===== Init =====
function initApp() {
  $("occurredAt").value = nowLocalDatetimeValue();

  renderActions();
  wireUpdates();
  updateTotalPreview();
  renderTable();

  $("appMsg").textContent = "";
}

// Auto-show correct screen
if (getSession()) {
  initApp();
  show("appSection");
} else {
  show("loginSection");
}
