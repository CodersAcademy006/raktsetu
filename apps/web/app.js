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

function renderChips(containerId, values, labelFor, answerKey) {
  const container = document.getElementById(containerId);
  container.innerHTML = values
    .map((v) => `<button type="button" class="chip" data-value="${typeof v === "object" ? v.value : v}">${labelFor(v)}</button>`)
    .join("");
  container.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      container.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
      mcqAnswers[answerKey] = chip.dataset.value;
      updateMcqSubmitState();
    });
  });
}

function updateMcqSubmitState() {
  const ready = mcqAnswers.bloodGroup && mcqAnswers.units && mcqAnswers.urgency;
  document.getElementById("mcq-submit").disabled = !ready;
}

renderChips("bloodgroup-choices", BLOOD_GROUPS, (v) => v, "bloodGroup");
renderChips("units-choices", UNIT_CHOICES, (v) => `${v}`, "units");
renderChips("urgency-choices", URGENCY_CHOICES, (v) => v.label, "urgency");

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
      await loadNearby();
      document.getElementById("mcq-card").hidden = false;
    },
    (err) => {
      statusEl.textContent = `Couldn't get your location (${err.message}). You can still use the free-text form below.`;
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

document.getElementById("demo-locate-btn").addEventListener("click", async () => {
  sharedLocation = { lat: 19.1197, lng: 72.8697 }; // Andheri, Mumbai -- matches the seeded demo data
  document.getElementById("location-status").textContent = "Using demo location (Andheri, Mumbai).";
  await loadNearby();
  document.getElementById("mcq-card").hidden = false;
});

async function loadNearby() {
  const { lat, lng } = sharedLocation;
  const res = await fetch(`/nearby?lat=${lat}&lng=${lng}`);
  if (!res.ok) return;
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

document.getElementById("mcq-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!sharedLocation) return;
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
