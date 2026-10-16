let activeRequestId = null;
let pollTimer = null;

const form = document.getElementById("request-form");
const requestList = document.getElementById("request-list");
const statusCard = document.getElementById("status-card");
const donorCard = document.getElementById("donor-card");
const timelineCard = document.getElementById("timeline-card");

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
