const DEBUG_ALLOW_UNLIMITED_VOTES = false;

const FORM_CONFIG = {
  actionUrl: "https://docs.google.com/forms/d/e/1FAIpQLSeTw6juBFX6O8Gj36nEBGT4qZr0umN68npEWk-_VunS1tfklw/formResponse",
  voteEntryId: "entry.1624209040",
};

const PUBLIC_VOTE_CSV_URL =
  "https://docs.google.com/spreadsheets/d/19ysacW9BHIClnXLdcB1YG69bDibNl-B8rN6uZMNeER8/gviz/tq?tqx=out:csv&gid=758188382";

// プレゼント応募用Googleフォーム。
// ローカルの ?mockSubmit=1 ではGoogleフォームへの送信をスキップして動作確認できる。
const ENTRY_FORM_CONFIG = {
  actionUrl: "https://docs.google.com/forms/d/e/1FAIpQLSeJ8Qd18ekkqsNROdhli-WHD9_sTyimTqmPPbNrIQkL_x-8Ng/formResponse",
  emailEntryId: "entry.433332909",
  nicknameEntryId: "entry.653911767",
  teamEntryId: "entry.1319819739",
  gengenTikTokEntryId: "entry.1222429065",
  toyodaYoutubeEntryId: "entry.1878028566",
};

const DEADLINE = new Date("2026-07-28T12:00:00+09:00");
const STORAGE_KEY = "monster-charity-match:last-vote-date";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
const modalStamp = document.querySelector("#modalStamp");
const modalTitle = document.querySelector("#modalTitle");
const modalLead = document.querySelector("#modalLead");
const entryForm = document.querySelector("#entryForm");
const entryFormStatus = document.querySelector("#entryFormStatus");
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

function setEntryFormStatus(message, isError = false) {
  if (!entryFormStatus) {
    return;
  }

  entryFormStatus.textContent = message;
  entryFormStatus.classList.toggle("is-visible", Boolean(message));
  entryFormStatus.classList.toggle("is-error", Boolean(message) && isError);
}

function setEntryFormDisabled(disabled) {
  if (!entryForm) {
    return;
  }

  entryForm.querySelectorAll("input, button").forEach((element) => {
    element.disabled = disabled;
  });
}

function isEntryConfigReady() {
  return Boolean(
    ENTRY_FORM_CONFIG.actionUrl &&
      ENTRY_FORM_CONFIG.emailEntryId &&
      ENTRY_FORM_CONFIG.nicknameEntryId &&
      ENTRY_FORM_CONFIG.teamEntryId &&
      ENTRY_FORM_CONFIG.gengenTikTokEntryId &&
      ENTRY_FORM_CONFIG.toyodaYoutubeEntryId
  );
}

function configureModal(team) {
  const closed = isPastDeadline();

  if (modalStamp) modalStamp.textContent = "投票完了";
  if (modalTitle) modalTitle.textContent = "応援投票ありがとうございました！";
  if (modalLead) {
    modalLead.textContent = closed
      ? "プレゼント抽選の応募受付は終了しました。"
      : "つづけて今日のプレゼント抽選に応募できます。毎日応募で当選確率アップ！";
  }

  if (entryForm) {
    entryForm.hidden = closed;

    if (!entryForm.hidden) {
      setEntryFormDisabled(false);
      setEntryFormStatus("");

      if (team) {
        const radio = entryForm.querySelector(`input[name="entryTeam"][value="${team}"]`);
        if (radio) {
          radio.checked = true;
        }
      }
    }
  }
}

async function submitEntry({ email, nickname, team, channels }) {
  if (isLocalMockSubmit) {
    return;
  }

  const formData = new FormData();
  formData.append(ENTRY_FORM_CONFIG.emailEntryId, email);
  formData.append(ENTRY_FORM_CONFIG.nicknameEntryId, nickname);
  formData.append(ENTRY_FORM_CONFIG.teamEntryId, team);
  if (channels.includes("gengen_tiktok")) {
    formData.append(ENTRY_FORM_CONFIG.gengenTikTokEntryId, "1");
  }
  if (channels.includes("toyoda_youtube")) {
    formData.append(ENTRY_FORM_CONFIG.toyodaYoutubeEntryId, "1");
  }

  await fetch(ENTRY_FORM_CONFIG.actionUrl, {
    method: "POST",
    mode: "no-cors",
    body: formData,
  });
}

async function handleEntrySubmit(event) {
  event.preventDefault();

  if (isPastDeadline()) {
    return;
  }

  const email = entryForm.querySelector("#entryEmail").value.trim();
  const nickname = entryForm.querySelector("#entryNickname").value.trim();
  const team = entryForm.querySelector('input[name="entryTeam"]:checked')?.value;
  const channels = [...entryForm.querySelectorAll('input[name="entryChannel"]:checked')].map(
    (input) => input.value
  );

  if (!email || !EMAIL_PATTERN.test(email)) {
    setEntryFormStatus("メールアドレスの形式をご確認ください。", true);
    return;
  }

  if (!nickname) {
    setEntryFormStatus("ニックネームを入力してください。", true);
    return;
  }

  if (!team) {
    setEntryFormStatus("応援した陣営を選択してください。", true);
    return;
  }

  if (!isEntryConfigReady() && !isLocalMockSubmit) {
    setEntryFormStatus("応募フォームは現在準備中です。公開までもうしばらくお待ちください。", true);
    return;
  }

  const submitButton = entryForm.querySelector(".entry-submit");
  const originalText = submitButton.textContent;
  setEntryFormDisabled(true);
  submitButton.textContent = "送信中";
  setEntryFormStatus("");

  try {
    await submitEntry({ email, nickname, team, channels });
    entryForm.hidden = true;
    if (modalLead) {
      modalLead.textContent = "本日の応募が完了しました！明日も投票＆応募で、さらに当選確率アップ！";
    }
  } catch {
    setEntryFormStatus("送信に失敗しました。通信環境をご確認のうえ、もう一度お試しください。", true);
    setEntryFormDisabled(false);
  } finally {
    submitButton.textContent = originalText;
  }
}

function openModal() {
  if (!modal) {
    return;
  }

  lastFocusedElement = document.activeElement;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  modal.querySelector(".modal-panel").scrollTop = 0;

  if (entryForm && !entryForm.hidden) {
    entryForm.querySelector("#entryEmail")?.focus();
  } else {
    modal.querySelector("button[data-close-modal]")?.focus();
  }
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
    configureModal(button.dataset.visibleTeam);
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

entryForm?.addEventListener("submit", handleEntrySubmit);

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
