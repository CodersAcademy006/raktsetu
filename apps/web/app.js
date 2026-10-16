let activeRequestId = null;
let pollTimer = null;
let sharedLocation = null; // { lat, lng }
const mcqAnswers = { bloodGroup: null, units: null, urgency: null };

const BLOOD_GROUPS = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"];
const UNIT_CHOICES = [1, 2, 3, 4];
const URGENCY_CHOICES = [
  { value: "critical", label: "Critical" },
  { value: "urgent", label: "Urgent" },
  { value: "routine", label: "Routine" },
];

const form = document.getElementById("request-form");
const requestList = document.getElementById("request-list");
const statusCard = document.getElementById("status-card");
const donorCard = document.getElementById("donor-card");
const timelineCard = document.getElementById("timeline-card");

// --- Step 1: location + nearby preview -------------------------------------

const QUESTIONS = [
  { key: "bloodGroup", title: "Blood group needed", options: BLOOD_GROUPS.map((v) => ({ value: v, label: v })) },
  { key: "units", title: "Units needed", options: UNIT_CHOICES.map((v) => ({ value: String(v), label: String(v) })) },
  { key: "urgency", title: "Urgency", options: URGENCY_CHOICES },
];
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// --- Tinder-style question deck ---------------------------------------------
// Direct 1:1 drag tracking, velocity carried into the release so a fast flick
// commits even on a short drag, a critically-damped spring-back when the
// drag doesn't clear the threshold. See apple-design skill: response,
// direct manipulation, momentum.

let deckQueue = [];

function initQuestionDeck() {
  mcqAnswers.bloodGroup = null;
  mcqAnswers.units = null;
  mcqAnswers.urgency = null;
  deckQueue = [...QUESTIONS];
  document.getElementById("mcq-complete").hidden = true;
  renderDeck();
}

function renderDeck() {
  const deck = document.getElementById("question-deck");
  deck.innerHTML = "";
  deckQueue.slice(0, 3).forEach((q, depth) => {
    const card = document.createElement("div");
    card.className = "question-card";
    card.style.transition = "transform 280ms cubic-bezier(0.2,0.8,0.2,1), opacity 280ms";
    card.style.transform = `translateY(${depth * 14}px) scale(${1 - depth * 0.04})`;
    card.style.opacity = depth === 2 ? "0.75" : depth === 1 ? "0.9" : "1";
    card.style.zIndex = String(10 - depth);
    card.style.pointerEvents = depth === 0 ? "auto" : "none";
    card.innerHTML = `<div class="q-title">${q.title}</div><div class="choice-row">${q.options
      .map((o) => `<button type="button" class="chip" data-value="${o.value}">${o.label}</button>`)
      .join("")}</div>`;
    deck.appendChild(card);
    if (depth === 0) wireTopCard(card, q);
  });
  if (deckQueue.length === 0) {
    document.getElementById("mcq-complete").hidden = false;
  }
}

function wireTopCard(card, question) {
  card.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      card.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
      mcqAnswers[question.key] = chip.dataset.value;
      if (prefersReducedMotion) {
        card.style.transition = "opacity 180ms ease";
        card.style.opacity = "0";
        setTimeout(advanceDeck, 180);
      } else {
        setTimeout(() => flingAway(card, 1, 900), 120);
      }
    });
  });

  if (prefersReducedMotion) return; // no drag gesture under reduced motion

  let drag = null;
  card.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".chip")) return;
    card.setPointerCapture(e.pointerId);
    card.style.transition = "none";
    drag = { startX: e.clientX, lastX: e.clientX, lastT: performance.now(), dx: 0, vx: 0, pointerId: e.pointerId };
  });
  card.addEventListener("pointermove", (e) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const now = performance.now();
    const dt = Math.max(now - drag.lastT, 1);
    drag.vx = ((e.clientX - drag.lastX) / dt) * 1000; // px/s
    drag.lastX = e.clientX;
    drag.lastT = now;
    drag.dx = e.clientX - drag.startX;
    card.style.transform = `translateX(${drag.dx}px) rotate(${drag.dx / 18}deg)`;
  });
  const release = (e) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const { dx, vx } = drag;
    drag = null;
    const hasAnswer = !!mcqAnswers[question.key];
    const commits = hasAnswer && (Math.abs(dx) > 110 || Math.abs(vx) > 600);
    if (commits) {
      flingAway(card, dx >= 0 ? 1 : -1, vx);
    } else {
      card.style.transition = "transform 280ms cubic-bezier(0.2,0.8,0.2,1)";
      card.style.transform = "translateX(0) rotate(0)";
    }
  };
  card.addEventListener("pointerup", release);
  card.addEventListener("pointercancel", release);
}

function flingAway(card, direction, velocity) {
  const duration = Math.max(160, Math.min(320, 60000 / Math.max(Math.abs(velocity), 400)));
  card.style.transition = `transform ${duration}ms cubic-bezier(0.2,0.8,0.2,1), opacity ${duration}ms ease`;
  card.style.transform = `translateX(${direction * 900}px) rotate(${direction * 24}deg)`;
  card.style.opacity = "0";
  setTimeout(advanceDeck, duration);
}

function advanceDeck() {
  deckQueue.shift();
  renderDeck();
}

document.getElementById("locate-btn").addEventListener("click", () => {
  const statusEl = document.getElementById("location-status");
  if (!navigator.geolocation) {
    statusEl.textContent = "Geolocation isn't available in this browser.";
    return;
  }
  statusEl.textContent = "Requesting location…";
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      sharedLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      statusEl.textContent = `Location shared (±${Math.round(pos.coords.accuracy)}m accuracy).`;
      try {
        await loadNearby();
        document.getElementById("mcq-card").hidden = false;
        initQuestionDeck();
      } catch {
        statusEl.textContent += " Couldn't reach the server for nearby data — try again in a moment.";
      }
    },
    (err) => {
      statusEl.textContent = `Couldn't get your location (${err.message}). You can still use the free-text form below.`;
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

document.getElementById("demo-locate-btn").addEventListener("click", async () => {
  sharedLocation = { lat: 19.1197, lng: 72.8697 }; // Andheri, Mumbai -- matches the seeded demo data
  const statusEl = document.getElementById("location-status");
  statusEl.textContent = "Using demo location (Andheri, Mumbai).";
  try {
    await loadNearby();
    document.getElementById("mcq-card").hidden = false;
    initQuestionDeck();
  } catch {
    statusEl.textContent += " Couldn't reach the server for nearby data — try again in a moment.";
  }
});

async function loadNearby() {
  const { lat, lng } = sharedLocation;
  const res = await fetch(`/nearby?lat=${lat}&lng=${lng}`);
  if (!res.ok) throw new Error(`nearby fetch failed: ${res.status}`);
  const { searchedRadiusKm, bloodBanks, donorCountByGroup, totalDonors } = await res.json();

  const nearbyCard = document.getElementById("nearby-card");
  nearbyCard.hidden = false;

  const pills = BLOOD_GROUPS.map(
    (g) => `<span class="group-pill">${g} · ${donorCountByGroup[g] ?? 0}</span>`,
  ).join("");

  const bankRows =
    bloodBanks.length === 0
      ? `<div class="empty">No blood banks within ${searchedRadiusKm}km — this is exactly the gap the donor network exists for.</div>`
      : bloodBanks
          .map(
            (b) => `<div class="nearby-row"><span>${b.name}</span><span class="sub">${b.distanceKm} km</span></div>`,
          )
          .join("");

  document.getElementById("nearby-summary").innerHTML = `
    <div class="sub" style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.03em;color:var(--ink-dim);margin-bottom:6px;">
      ${totalDonors} potential donor(s) within ${searchedRadiusKm}km
    </div>
    <div style="margin-bottom:12px;">${pills}</div>
    <div class="sub" style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.03em;color:var(--ink-dim);margin-bottom:6px;">Blood banks</div>
    ${bankRows}`;
}

document.getElementById("mcq-submit").addEventListener("click", async () => {
  if (!sharedLocation || !mcqAnswers.bloodGroup || !mcqAnswers.units || !mcqAnswers.urgency) return;
  const targetRaw = document.getElementById("mcq-target").value;
  const submitBtn = document.getElementById("mcq-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "Dispatching…";

  try {
    const res = await fetch("/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bloodGroup: mcqAnswers.bloodGroup,
        units: Number(mcqAnswers.units),
        urgency: mcqAnswers.urgency,
        lat: sharedLocation.lat,
        lng: sharedLocation.lng,
        ...(targetRaw ? { targetDonorAcceptances: Number(targetRaw) } : {}),
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      alert(body.message || body.error || "Could not create request");
      return;
    }
    activeRequestId = body.requestId;
    startPolling();
    refreshRequestList();
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Dispatch";
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const rawText = document.getElementById("rawText").value.trim();
  const targetRaw = document.getElementById("target").value;
  const submitBtn = form.querySelector("button");
  submitBtn.disabled = true;
  submitBtn.textContent = "Dispatching…";

  try {
    const res = await fetch("/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawText,
        ...(targetRaw ? { targetDonorAcceptances: Number(targetRaw) } : {}),
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      alert(body.message || body.error || "Could not create request");
      return;
    }
    activeRequestId = body.requestId;
    form.reset();
    startPolling();
    refreshRequestList();
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Dispatch";
  }
});

async function refreshRequestList() {
  const res = await fetch("/requests");
  const all = await res.json();
  if (all.length === 0) {
    requestList.className = "empty";
    requestList.textContent = "None yet.";
    return;
  }
  requestList.className = "";
  requestList.innerHTML = all
    .map(
      (r) => `<div class="dispatch-row" data-id="${r.requestId}" style="cursor:pointer">
        <div class="meta">
          <div class="name">${r.requiredBloodGroup} · ${r.unitsRequested} unit(s) · ${r.locationText}</div>
          <div class="sub">${r.urgency} · ${new Date(r.createdAt).toLocaleTimeString()}</div>
        </div>
        <span class="badge ${r.status}">${r.status}</span>
      </div>`,
    )
    .join("");
  requestList.querySelectorAll("[data-id]").forEach((el) => {
    el.addEventListener("click", () => {
      activeRequestId = el.dataset.id;
      startPolling();
    });
  });
}

function startPolling() {
  statusCard.hidden = false;
  donorCard.hidden = false;
  timelineCard.hidden = false;
  if (pollTimer) clearInterval(pollTimer);
  poll();
  pollTimer = setInterval(poll, 1000);
}

async function poll() {
  if (!activeRequestId) return;
  const res = await fetch(`/requests/${activeRequestId}/state`);
  if (!res.ok) return;
  const { request, dispatches, events, donorsById } = await res.json();
  render(request, dispatches, events, donorsById);
  refreshRequestList();
}

function render(request, dispatches, events, donorsById) {
  document.getElementById("status-summary").innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <div>
        <div style="font-weight:650;">${request.requiredBloodGroup} needed near ${request.locationText}</div>
        <div class="sub" style="color:var(--ink-dim);font-size:0.82rem;">
          ${request.unitsRequested} unit(s) · target ${request.targetDonorAcceptances} donor(s) ·
          radius ${request.currentRadiusKm ? request.currentRadiusKm + " km" : "—"}
        </div>
      </div>
      <span class="badge ${request.status}">${request.status}</span>
    </div>`;

  const byBatch = {};
  for (const d of dispatches) {
    (byBatch[d.batchNo] ??= []).push(d);
  }

  document.getElementById("dispatch-list").innerHTML =
    Object.keys(byBatch).length === 0
      ? '<div class="empty">No donors contacted yet.</div>'
      : Object.entries(byBatch)
          .map(
            ([batchNo, rows]) => `
        <div style="margin-top:8px;">
          <div class="sub" style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.03em;color:var(--ink-dim);margin-bottom:4px;">Batch ${batchNo}</div>
          ${rows
            .map((d) => {
              const donor = donorsById[d.donorId] ?? { name: "Unknown", bloodGroup: "?" };
              return `<div class="dispatch-row">
                <div class="meta">
                  <div class="name">${donor.name} · ${donor.bloodGroup}</div>
                  <div class="sub">${d.status}</div>
                </div>
              </div>`;
            })
            .join("")}
        </div>`,
          )
          .join("");

  const pending = dispatches.filter((d) => d.status === "sent");
  document.getElementById("donor-list").innerHTML =
    pending.length === 0
      ? '<div class="empty">No pending replies.</div>'
      : pending
          .map((d) => {
            const donor = donorsById[d.donorId] ?? { name: "Unknown", bloodGroup: "?" };
            return `<div class="bubble">
              <div style="font-weight:600;margin-bottom:4px;">${donor.name} (${donor.bloodGroup})</div>
              <div style="margin-bottom:8px;">${d.message}</div>
              <div class="actions">
                <button class="accept" data-donor="${d.donorId}" data-accept="true">Accept</button>
                <button class="decline" data-donor="${d.donorId}" data-accept="false">Decline</button>
              </div>
            </div>`;
          })
          .join("");

  document.querySelectorAll("#donor-list button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.closest(".bubble").querySelectorAll("button").forEach((b) => (b.disabled = true));
      await fetch(`/requests/${activeRequestId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ donorId: btn.dataset.donor, accepted: btn.dataset.accept === "true" }),
      });
      poll();
    });
  });

  document.getElementById("timeline").innerHTML = events
    .slice()
    .reverse()
    .map(
      (e) => `<li><span class="type">${e.type}</span><span>${new Date(e.timestamp).toLocaleTimeString()}</span></li>`,
    )
    .join("");
}

refreshRequestList();
