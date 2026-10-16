// RaktSetu staff console. Plain DOM, no framework. Every server value that
// goes through innerHTML is passed through esc().

const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Polling re-renders every 2s; only touch the DOM when the markup changed,
// otherwise buttons get replaced under the pointer and clicks are lost.
const lastHTML = new WeakMap();
function setHTML(el, html) {
  if (lastHTML.get(el) === html) return;
  lastHTML.set(el, html);
  el.innerHTML = html;
}

const store = {
  get(key) { try { return localStorage.getItem(`raktsetu.${key}`) ?? ""; } catch { return ""; } },
  set(key, value) { try { localStorage.setItem(`raktsetu.${key}`, value); } catch {} },
};

// --- API ---------------------------------------------------------------------

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", "x-access-code": store.get("accessCode"), ...(options.headers ?? {}) },
  });
  if (res.status === 401) {
    $("access-card").hidden = false;
    $("access-code").focus();
    throw new Error("Enter the access code first.");
  }
  return res;
}

$("access-form").addEventListener("submit", (e) => {
  e.preventDefault();
  store.set("accessCode", $("access-code").value.trim());
  $("access-card").hidden = true;
  refreshRequestList();
});

// --- Hospital identity ---------------------------------------------------------

const HOSPITAL_FIELDS = { hospitalName: "hospital-name", contactPhone: "hospital-phone", requesterName: "hospital-requester" };

function requester() {
  const out = {};
  for (const [key, id] of Object.entries(HOSPITAL_FIELDS)) {
    const v = $(id).value.trim();
    if (v) out[key] = v;
  }
  return out.hospitalName && out.contactPhone ? out : null;
}

function showHospital(editing) {
  const r = requester();
  const collapsed = !editing && r;
  $("hospital-form").hidden = !!collapsed;
  $("hospital-summary").hidden = !collapsed;
  if (collapsed) {
    $("hospital-summary-name").textContent = r.hospitalName;
    $("hospital-summary-sub").textContent = [r.requesterName, r.contactPhone].filter(Boolean).join(" · ");
  }
}

for (const [key, id] of Object.entries(HOSPITAL_FIELDS)) $(id).value = store.get(key);
$("hospital-form").addEventListener("submit", (e) => {
  e.preventDefault();
  for (const [key, id] of Object.entries(HOSPITAL_FIELDS)) store.set(key, $(id).value.trim());
  showHospital(false);
});
$("hospital-edit").addEventListener("click", () => showHospital(true));
showHospital(false);

// Returns requester fields, or null after sending the user to fill them in.
function requireRequester() {
  const r = requester();
  if (r) return r;
  showHospital(true);
  $("hospital-card").scrollIntoView({ behavior: "smooth", block: "center" });
  $($("hospital-name").value.trim() ? "hospital-phone" : "hospital-name").focus();
  return null;
}

// --- Step 1: location and nearby preview --------------------------------------

let sharedLocation = null;
const BLOOD_GROUPS = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"];

async function useLocation(lat, lng, label) {
  sharedLocation = { lat, lng };
  $("location-status").textContent = label;
  try {
    const res = await api(`/nearby?lat=${lat}&lng=${lng}`);
    if (!res.ok) throw new Error("Couldn't load nearby data, try again.");
    const { searchedRadiusKm, bloodBanks, donorCountByGroup, totalDonors } = await res.json();
    $("nearby").hidden = false;
    $("nearby-donors-title").textContent = `${totalDonors} registered donor(s) within ${searchedRadiusKm} km`;
    $("nearby-pills").innerHTML = BLOOD_GROUPS.map((g) => `<span class="pill">${esc(g)} · ${esc(donorCountByGroup[g] ?? 0)}</span>`).join("");
    $("nearby-banks").innerHTML = bloodBanks.length
      ? bloodBanks
          .slice(0, 6)
          .map((b) => `<div class="row"><span>${esc(b.name)}</span><span class="sub">${esc(b.distanceKm)} km</span></div>`)
          .join("")
      : `<div class="empty">No blood banks within ${esc(searchedRadiusKm)} km. Donors are the only option here.</div>`;
    $("mcq-card").hidden = false;
    initDeck();
  } catch (err) {
    $("location-status").textContent = `${label} ${err.message}`;
  }
}

$("locate-btn").addEventListener("click", () => {
  if (!navigator.geolocation) {
    $("location-status").textContent = "Location isn't available in this browser. Use the demo location or describe it in words.";
    return;
  }
  $("location-status").textContent = "Requesting location…";
  navigator.geolocation.getCurrentPosition(
    (pos) => useLocation(pos.coords.latitude, pos.coords.longitude, `Location shared (±${Math.round(pos.coords.accuracy)} m).`),
    (err) => ($("location-status").textContent = `Couldn't get location (${err.message}). Use the demo location or describe it in words.`),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});
$("demo-locate-btn").addEventListener("click", () => useLocation(19.1197, 72.8697, "Using demo location: Andheri, Mumbai."));

// --- Step 2: question deck ----------------------------------------------------
// Tap an answer to commit it (the card flies right). Drag right to commit the
// selected answer, drag left to go back a card. 1:1 drag tracking, release
// velocity decides a flick, otherwise the card springs back. The direction
// that can't commit rubber-bands instead of moving freely.

const QUESTIONS = [
  { key: "component", title: "What is needed", options: [["whole_blood", "Whole blood"], ["prbc", "Red cells (PRBC)"], ["platelets", "Platelets"], ["plasma", "Plasma (FFP)"]] },
  { key: "bloodGroup", title: "Patient's blood group", options: BLOOD_GROUPS.map((g) => [g, g]) },
  { key: "units", title: "Units needed", options: ["1", "2", "3", "4", "5", "6"].map((u) => [u, u]) },
  { key: "urgency", title: "How urgent", options: [["critical", "Critical"], ["urgent", "Urgent"], ["routine", "Routine"]] },
];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const answers = {};
let deckIndex = 0;

const labelFor = (key, value) => QUESTIONS.find((q) => q.key === key).options.find(([v]) => v === value)?.[1] ?? value;

function initDeck() {
  for (const q of QUESTIONS) delete answers[q.key];
  deckIndex = 0;
  renderDeck();
}

function renderDeck() {
  const deck = $("question-deck");
  deck.innerHTML = "";
  QUESTIONS.slice(deckIndex, deckIndex + 3).forEach((q, depth) => {
    const card = document.createElement("div");
    card.className = "question-card";
    card.style.transform = `translateY(${depth * 12}px) scale(${1 - depth * 0.04})`;
    card.style.opacity = String(1 - depth * 0.15);
    card.style.zIndex = String(10 - depth);
    card.style.pointerEvents = depth === 0 ? "auto" : "none";
    card.innerHTML = `<div class="q-title">${esc(q.title)}</div><div class="choice-row">${q.options
      .map(([v, l]) => `<button type="button" class="chip${answers[q.key] === v ? " selected" : ""}" data-value="${esc(v)}">${esc(l)}</button>`)
      .join("")}</div>`;
    deck.appendChild(card);
    if (depth === 0) wireCard(card, q);
  });
  const done = deckIndex >= QUESTIONS.length;
  deck.hidden = done;
  $("deck-back").hidden = deckIndex === 0;
  $("answer-chips").innerHTML = QUESTIONS.filter((q) => answers[q.key])
    .map((q) => `<span class="pill">${esc(labelFor(q.key, answers[q.key]))}${q.key === "units" ? " unit(s)" : ""}</span>`)
    .join("");
  $("mcq-complete").hidden = !done;
  if (done) {
    $("mcq-summary").textContent = `${labelFor("component", answers.component)} · ${answers.bloodGroup} · ${answers.units} unit(s) · ${labelFor("urgency", answers.urgency)}`;
  }
}

function go(delta) {
  deckIndex = Math.max(0, Math.min(QUESTIONS.length, deckIndex + delta));
  renderDeck();
}

function fling(card, direction, velocity, then) {
  if (reducedMotion) {
    card.style.transition = "opacity 160ms ease";
    card.style.opacity = "0";
    return setTimeout(then, 160);
  }
  const ms = Math.round(Math.max(160, Math.min(300, 60000 / Math.max(Math.abs(velocity), 400))));
  card.style.transition = `transform ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${ms}ms ease`;
  card.style.transform = `translateX(${direction * 600}px) rotate(${direction * 18}deg)`;
  card.style.opacity = "0";
  setTimeout(then, ms);
}

function wireCard(card, q) {
  card.querySelectorAll(".chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      answers[q.key] = chip.dataset.value;
      card.querySelectorAll(".chip").forEach((c) => c.classList.toggle("selected", c === chip));
      setTimeout(() => fling(card, 1, 900, () => go(1)), 90);
    }),
  );
  if (reducedMotion) return;

  let drag = null;
  card.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".chip")) return;
    card.setPointerCapture(e.pointerId);
    card.style.transition = "none";
    drag = { id: e.pointerId, startX: e.clientX, lastX: e.clientX, lastT: performance.now(), dx: 0, vx: 0 };
  });
  card.addEventListener("pointermove", (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const now = performance.now();
    drag.vx = ((e.clientX - drag.lastX) / Math.max(now - drag.lastT, 1)) * 1000;
    drag.lastX = e.clientX;
    drag.lastT = now;
    drag.dx = e.clientX - drag.startX;
    const blocked = (drag.dx > 0 && !answers[q.key]) || (drag.dx < 0 && deckIndex === 0);
    const dx = blocked ? drag.dx * 0.25 : drag.dx;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 20}deg)`;
  });
  const release = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const { dx, vx } = drag;
    drag = null;
    const flick = Math.abs(dx) > 100 || Math.abs(vx) > 600;
    if (flick && dx > 0 && answers[q.key]) return fling(card, 1, vx, () => go(1));
    if (flick && dx < 0 && deckIndex > 0) return fling(card, -1, vx, () => go(-1));
    card.style.transition = "transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)";
    card.style.transform = "translateX(0) rotate(0)";
  };
  card.addEventListener("pointerup", release);
  card.addEventListener("pointercancel", release);
}

$("deck-back").addEventListener("click", () => go(-1));

// --- Dispatch -------------------------------------------------------------------

async function submit(body, button, errorEl) {
  errorEl.textContent = "";
  const r = requireRequester();
  if (!r) return false;
  button.disabled = true;
  const label = button.textContent;
  button.textContent = "Dispatching…";
  try {
    const res = await api("/requests", { method: "POST", body: JSON.stringify({ ...body, ...r }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      errorEl.textContent = out.message || (out.error === "rate_limited" ? "Too many requests, wait a minute." : "Couldn't create the request.");
      return false;
    }
    watch(out.requestId);
    refreshRequestList();
    $("status-card").scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  } catch (err) {
    errorEl.textContent = err.message || "Network error, try again.";
    return false;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

$("mcq-submit").addEventListener("click", async (e) => {
  if (!sharedLocation || deckIndex < QUESTIONS.length) return;
  const target = $("mcq-target").value;
  const ok = await submit(
    {
      component: answers.component,
      bloodGroup: answers.bloodGroup,
      units: Number(answers.units),
      urgency: answers.urgency,
      lat: sharedLocation.lat,
      lng: sharedLocation.lng,
      ...(target ? { targetDonorAcceptances: Number(target) } : {}),
    },
    e.currentTarget,
    $("mcq-error"),
  );
  if (ok) {
    $("mcq-target").value = "";
    initDeck();
  }
});

$("request-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ok = await submit({ rawText: $("rawText").value.trim() }, e.currentTarget.querySelector("button"), $("freetext-error"));
  if (ok) $("rawText").value = "";
});

// --- Live request view ------------------------------------------------------------

const TERMINAL = new Set(["FULFILLED", "EXHAUSTED"]);
const COMPONENT_NAMES = Object.fromEntries(QUESTIONS[0].options);
let activeRequestId = null;
let pollTimer = null;
let countdown = null; // { at: epoch ms, radiusKm }

function watch(requestId) {
  activeRequestId = requestId;
  for (const id of ["status-card", "donor-card", "timeline-card"]) $(id).hidden = false;
  clearTimeout(pollTimer);
  poll();
}

async function poll() {
  const id = activeRequestId;
  try {
    const res = await api(`/requests/${encodeURIComponent(id)}/state`);
    if (res.ok && id === activeRequestId) {
      const state = await res.json();
      render(state);
      if (TERMINAL.has(state.request.status)) return refreshRequestList(); // finished: stop polling
    }
  } catch {}
  if (id === activeRequestId) pollTimer = setTimeout(poll, 2000);
}

function statusLabel(request) {
  if (request.status === "EXHAUSTED" && request.acceptedDonorIds?.length) return ["Partly covered", "partial"];
  const labels = {
    MATCHING: ["Searching", "active"],
    DISPATCHING: ["Searching", "active"],
    WAITING: ["Waiting for replies", "active"],
    FULFILLED: ["Covered", "ok"],
    EXHAUSTED: ["Not covered", "bad"],
  };
  return labels[request.status] ?? [request.status, "active"];
}

const section = (title, rows) => (rows.length ? `<div class="eyebrow">${esc(title)}</div>${rows.join("")}` : "");
const telLink = (phone, text) => (phone ? `<a class="sub" href="tel:${esc(phone.replace(/[^\d+]/g, ""))}">${esc(text ?? phone)}</a>` : "");

function render({ request, dispatches, events, donorsById }) {
  const [label, tone] = statusLabel(request);
  $("status-badge").textContent = label;
  $("status-badge").className = `badge ${tone}`;
  $("status-title").textContent = `${COMPONENT_NAMES[request.component ?? "whole_blood"]}, ${request.requiredBloodGroup} · ${request.unitsRequested} unit(s)`;
  $("status-sub").textContent = [request.hospitalName, `near ${request.locationText}`, request.urgency].filter(Boolean).join(" · ");

  countdown =
    !TERMINAL.has(request.status) && request.nextEscalationAt
      ? { at: new Date(request.nextEscalationAt).getTime(), radiusKm: request.currentRadiusKm }
      : null;
  tickCountdown();

  const donor = (id) => donorsById[id] ?? { name: "Unknown donor", bloodGroup: "?" };
  const banks = (request.bankReservations ?? []).map(
    (b) => `<div class="row"><span>${esc(b.name)} · ${esc(b.units)} unit(s) ${esc(b.bloodGroup)}</span>${telLink(b.phone, `${b.distanceKm} km · call`)}</div>`,
  );
  const coming = dispatches
    .filter((d) => d.status === "accepted")
    .map((d) => {
      const p = donor(d.donorId);
      const eta = d.etaMinutes != null ? `ETA ${d.etaMinutes} min` : "coming";
      return `<div class="row"><span>${esc(p.name)} · ${esc(p.bloodGroup)} · ${esc(eta)}</span>${telLink(p.phone)}</div>`;
    });
  const callBack = dispatches
    .filter((d) => d.status === "sent" && d.replyNeedsCall)
    .map((d) => {
      const p = donor(d.donorId);
      return `<div class="row"><span>${esc(p.name)}: "${esc(d.replyText)}"<br><span class="sub">${esc(d.replyNote)}</span></span>${telLink(p.phone, "call")}</div>`;
    });
  const waiting = dispatches.filter((d) => d.status === "sent").length;
  const declined = dispatches.filter((d) => d.status === "declined").length;
  const needed = request.donorsNeeded ?? request.targetDonorAcceptances;

  setHTML($("status-sections"), [
    section("Reserved from blood banks", banks),
    needed === 0 ? "" : section(`Donors coming (${coming.length} of ${needed})`, coming.length ? coming : ['<div class="empty">None yet.</div>']),
    section("Needs a call", callBack),
    dispatches.length ? `<div class="sub stats">${esc(dispatches.length)} messaged · ${esc(waiting)} waiting · ${esc(declined)} declined</div>` : "",
  ].join(""));

  const pending = dispatches.filter((d) => d.status === "sent");
  setHTML($("donor-list"), pending.length
    ? pending
        .map((d) => {
          const p = donor(d.donorId);
          return `<div class="bubble">
            <div class="bubble-head">${esc(p.name)} · ${esc(p.bloodGroup)}</div>
            <pre class="bubble-text">${esc(d.message)}</pre>
            <div class="actions">
              <a class="button-link" href="donor.html#${esc(d.dispatchId)}" target="_blank" rel="noopener">Open donor page</a>
              <button class="accept" data-dispatch="${esc(d.dispatchId)}" data-accept="true">Accept</button>
              <button class="decline" data-dispatch="${esc(d.dispatchId)}" data-accept="false">Decline</button>
            </div>
          </div>`;
        })
        .join("")
    : '<div class="empty">No messages waiting for a reply.</div>');

  setHTML($("timeline"), events
    .slice()
    .reverse()
    .map((e) => `<li><span>${esc(describeEvent(e))}</span><span class="sub">${esc(new Date(e.timestamp).toLocaleTimeString())}</span></li>`)
    .join(""));
}

$("donor-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-dispatch]");
  if (!btn) return;
  btn.closest(".bubble").querySelectorAll("button").forEach((b) => (b.disabled = true));
  await fetch(`/dispatches/${encodeURIComponent(btn.dataset.dispatch)}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accepted: btn.dataset.accept === "true" }),
  }).catch(() => {});
  clearTimeout(pollTimer);
  poll();
});

function describeEvent({ type, metadata: m = {} }) {
  switch (type) {
    case "BANKS_CHECKED":
      return m.reservedUnits ? `Reserved ${m.reservedUnits} unit(s) from ${m.banks} nearby bank(s)` : "No matching stock at nearby banks";
    case "RADIUS_EXPANDED":
      return `Searching donors within ${m.radiusKm} km`;
    case "BATCH_DISPATCHED_SIMULATED":
      return `Batch ${m.batchNo}: messaged ${m.donorIds?.length ?? 0} donor(s)${m.messageSource === "gemma" ? ", wording by Gemma" : ""}`;
    case "DONORS_STOOD_DOWN":
      return `Told ${m.count} pending donor(s) they're no longer needed`;
    case "REQUEST_COMPLETED":
      return "Request covered";
    case "REQUEST_EXHAUSTED":
      return "No more eligible donors within 50 km";
    default:
      return type;
  }
}

function tickCountdown() {
  const el = $("countdown");
  if (!countdown) return (el.hidden = true);
  const s = Math.max(0, Math.ceil((countdown.at - Date.now()) / 1000));
  el.hidden = false;
  el.textContent = s > 0 ? `Searching within ${countdown.radiusKm} km · next batch or wider search in ${s}s` : "Moving to the next batch…";
}
setInterval(tickCountdown, 1000);

// --- Recent requests ----------------------------------------------------------------

async function refreshRequestList() {
  try {
    const res = await api("/requests");
    if (!res.ok) return;
    const all = await res.json();
    const list = $("request-list");
    list.className = all.length ? "" : "empty";
    setHTML(list, all.length
      ? all
          .slice(0, 15)
          .map((r) => {
            const [label, tone] = statusLabel(r);
            return `<button type="button" class="row request-row" data-id="${esc(r.requestId)}">
              <span>${esc(r.requiredBloodGroup)} · ${esc(r.unitsRequested)} unit(s) · ${esc(r.locationText)}<br><span class="sub">${esc(r.hospitalName ?? "")} · ${esc(new Date(r.createdAt).toLocaleTimeString())}</span></span>
              <span class="badge ${tone}">${esc(label)}</span>
            </button>`;
          })
          .join("")
      : "None yet.");
  } catch {}
}

$("request-list").addEventListener("click", (e) => {
  const row = e.target.closest("[data-id]");
  if (row) watch(row.dataset.id);
});

refreshRequestList();
setInterval(refreshRequestList, 10000);
