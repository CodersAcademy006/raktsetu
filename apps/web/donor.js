// Donor page: the dispatch id lives in the URL fragment (never sent to the
// server in logs or referrers) and is the only credential needed to reply.
const dispatchId = decodeURIComponent(location.hash.slice(1));
const $ = (id) => document.getElementById(id);

const RESULTS = {
  accepted: ["Thank you. They're expecting you.", "Head to the hospital now and show this message at the blood bank desk."],
  declined: ["Thanks for letting us know.", "The hospital will reach other donors. You can still call them if things change."],
  expired: ["No longer needed. Thank you.", "This request has been covered. We'll reach you again when someone near you needs blood."],
  unclear: ["Reply received.", "The hospital will call you to confirm."],
  notfound: ["Link not recognised.", "This request link is invalid. Please check the message you received."],
};

function showResult(kind, note) {
  $("donor-actions").hidden = true;
  $("donor-result").hidden = false;
  $("d-result-title").textContent = RESULTS[kind][0];
  $("d-result-body").textContent = note ? `${RESULTS[kind][1]} (${note})` : RESULTS[kind][1];
}

async function load() {
  const res = dispatchId ? await fetch(`/dispatches/${encodeURIComponent(dispatchId)}`) : null;
  $("donor-loading").hidden = true;
  if (!res || !res.ok) return showResult("notfound");
  const d = await res.json();

  $("donor-request").hidden = false;
  $("d-hello").textContent = d.donorName ? `Hi ${d.donorName}, a patient near you needs blood you can give.` : "A patient near you needs blood you can give.";
  $("d-need").textContent = d.need;
  $("d-units").textContent = String(d.units);
  $("d-urgency").textContent = d.urgency;
  $("d-where").textContent = `${d.hospitalName}, near ${d.locationText}`;
  $("d-map").href = d.mapsUrl;
  $("d-call").href = `tel:${d.contactPhone.replace(/[^\d+]/g, "")}`;

  if (d.status !== "sent") return showResult(d.status === "accepted" || d.status === "declined" ? d.status : "expired");
  if (d.replyNote) return showResult("unclear", d.replyNote);
  $("donor-actions").hidden = false;
}

async function reply(body, button) {
  document.querySelectorAll("#donor-actions button").forEach((b) => (b.disabled = true));
  const original = button.textContent;
  button.textContent = "Sending…";
  try {
    const res = await fetch(`/dispatches/${encodeURIComponent(dispatchId)}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (res.status === 409) return showResult(out.error === "request_closed" ? "expired" : out.status ?? "expired");
    if (!res.ok) throw new Error(out.error || res.status);
    showResult(out.status, out.note);
  } catch {
    button.textContent = original;
    document.querySelectorAll("#donor-actions button").forEach((b) => (b.disabled = false));
    $("d-result-title").textContent = "";
    alertInline("Couldn't send. Check your connection and try again, or call the hospital.");
  }
}

function alertInline(text) {
  let el = $("d-error");
  if (!el) {
    el = document.createElement("p");
    el.id = "d-error";
    el.className = "error";
    $("donor-actions").prepend(el);
  }
  el.textContent = text;
}

$("d-accept").addEventListener("click", (e) => reply({ accepted: true }, e.currentTarget));
$("d-decline").addEventListener("click", (e) => reply({ accepted: false }, e.currentTarget));
$("d-text-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("d-text").value.trim();
  if (text) reply({ text }, e.currentTarget.querySelector("button"));
});

load();

// A different request opened in the same tab only changes the fragment.
window.addEventListener("hashchange", () => location.reload());
