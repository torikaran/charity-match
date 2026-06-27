const DEBUG_ALLOW_UNLIMITED_VOTES = false;

const FORM_CONFIG = {
  actionUrl: "https://docs.google.com/forms/d/e/1FAIpQLSeTw6juBFX6O8Gj36nEBGT4qZr0umN68npEWk-_VunS1tfklw/formResponse",
  voteEntryId: "entry.1624209040",
};

const PUBLIC_VOTE_CSV_URL =
  "https://docs.google.com/spreadsheets/d/19ysacW9BHIClnXLdcB1YG69bDibNl-B8rN6uZMNeER8/gviz/tq?tqx=out:csv&gid=758188382";

const DEADLINE = new Date("2026-07-26T23:59:59+09:00");
const STORAGE_KEY = "monster-charity-match:last-vote-date";
const JST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const voteButtons = [...document.querySelectorAll(".vote-button")];
const voteStatus = document.querySelector("#voteStatus");
const supportTotal = document.querySelector("#supportTotal");
const supportMeterFill = document.querySelector("#supportMeterFill");
const modal = document.querySelector("#thanksModal");
let lastFocusedElement = null;

const params = new URLSearchParams(window.location.search);
const debugOverride = params.get("debugVotes");
const isDailyLimitDisabled =
  debugOverride === "unlimited" ||
  (DEBUG_ALLOW_UNLIMITED_VOTES && debugOverride !== "daily");
const isLocalMockSubmit =
  params.get("mockSubmit") === "1" &&
  (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");

function todayInJapan() {
  return JST_DATE_FORMATTER.format(new Date());
}

function isPastDeadline() {
  return Date.now() > DEADLINE.getTime();
}

function readLastVoteDate() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLastVoteDate() {
  if (isDailyLimitDisabled) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, todayInJapan());
  } catch {
    /* localStorage can be unavailable in private browsing. */
  }
}

function hasVotedToday() {
  if (isDailyLimitDisabled) {
    return false;
  }

  return readLastVoteDate() === todayInJapan();
}

function setStatus(message) {
  if (!voteStatus) {
    return;
  }

  voteStatus.textContent = message;
  voteStatus.classList.toggle("is-visible", Boolean(message));
}

function setButtonsDisabled(disabled) {
  voteButtons.forEach((button) => {
    button.disabled = disabled;
  });
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let cell = "";
  let insideQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const nextChar = csv[index + 1];

    if (char === "\"" && insideQuotes && nextChar === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === "," && !insideQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some(Boolean)) {
    rows.push(row);
  }

  return rows;
}

function getMeterTarget(total) {
  if (total >= 500) {
    return 500;
  }

  if (total >= 200) {
    return 500;
  }

  if (total >= 50) {
    return 200;
  }

  return 50;
}

function updateSupportMeter(total) {
  if (!supportTotal || !supportMeterFill) {
    return;
  }

  const target = getMeterTarget(total);
  const percentage = Math.min(100, Math.max(6, (total / target) * 100));

  supportTotal.textContent = String(total);
  supportMeterFill.style.width = `${percentage}%`;
}

async function refreshSupportMeter() {
  if (!supportTotal || !supportMeterFill) {
    return;
  }

  try {
    const response = await fetch(PUBLIC_VOTE_CSV_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to fetch vote CSV");
    }

    const rows = parseCsv(await response.text());
    const total = Number(rows[1]?.[1] ?? 0);

    if (!Number.isFinite(total)) {
      throw new Error("Invalid vote count");
    }

    updateSupportMeter(total);
  } catch {
    /* Keep the previous meter value when Google Sheets is temporarily unavailable. */
  }
}

function refreshVoteState() {
  if (isPastDeadline()) {
    setButtonsDisabled(true);
    setStatus("事前応援投票の受付は終了しました。");
    return;
  }

  if (hasVotedToday()) {
    setButtonsDisabled(true);
    setStatus("本日の応援投票は完了しています。");
    return;
  }

  setButtonsDisabled(false);
  setStatus("");
}

async function submitVote(value) {
  if (isLocalMockSubmit) {
    return;
  }

  const formData = new FormData();
  formData.append(FORM_CONFIG.voteEntryId, value);

  await fetch(FORM_CONFIG.actionUrl, {
    method: "POST",
    mode: "no-cors",
    body: formData,
  });
}

function openModal() {
  if (!modal) {
    return;
  }

  lastFocusedElement = document.activeElement;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  modal.querySelector("button[data-close-modal]")?.focus();
}

function closeModal() {
  if (!modal) {
    return;
  }

  modal.hidden = true;
  document.body.style.overflow = "";
  lastFocusedElement?.focus?.();
}

async function handleVote(event) {
  const button = event.currentTarget;
  const submittedValue = button.dataset.submitValue;
  const originalText = button.textContent;

  if (!submittedValue) {
    return;
  }

  if (isPastDeadline()) {
    refreshVoteState();
    return;
  }

  if (hasVotedToday()) {
    refreshVoteState();
    return;
  }

  button.classList.add("is-loading");
  button.textContent = "送信中";
  setButtonsDisabled(true);
  setStatus("");

  try {
    await submitVote(submittedValue);
    writeLastVoteDate();
    refreshSupportMeter();
    openModal();
  } catch {
    setStatus("送信に失敗しました。通信環境を確認して、もう一度お試しください。");
  } finally {
    button.classList.remove("is-loading");
    button.textContent = originalText;
    refreshVoteState();
  }
}

voteButtons.forEach((button) => {
  button.addEventListener("click", handleVote);
});

modal?.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-modal]")) {
    closeModal();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modal && !modal.hidden) {
    closeModal();
  }
});

refreshVoteState();
refreshSupportMeter();
