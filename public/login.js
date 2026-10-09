document.getElementById("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fehler = document.getElementById("fehler");
  const knopf = e.target.querySelector("button");
  fehler.textContent = "";
  knopf.disabled = true;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passwort: document.getElementById("pw").value }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      fehler.textContent = d.fehler || "Anmeldung fehlgeschlagen";
      return;
    }
    const ziel = new URLSearchParams(location.search).get("ziel") || "/";
    location.href = ziel.startsWith("/") && !ziel.startsWith("//") ? ziel : "/";
  } catch {
    fehler.textContent = "Keine Verbindung. Bitte später erneut versuchen.";
  } finally {
    knopf.disabled = false;
  }
});
