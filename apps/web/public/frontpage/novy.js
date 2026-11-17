(() => {
  const TYPO = {
    "gmil.com": "gmail.com",
    "gmal.com": "gmail.com",
    "gmail.cz": "gmail.com",
    "gmali.com": "gmail.com",
    "gamil.com": "gmail.com",
    "sezam.cz": "seznam.cz",
    "senam.cz": "seznam.cz",
    "seznam.com": "seznam.cz",
    "sezmam.cz": "seznam.cz",
    "emial.cz": "email.cz",
    "centrum.cs": "centrum.cz",
    "centrun.cz": "centrum.cz",
    "hotmail.co": "hotmail.com",
    "hotmial.com": "hotmail.com",
    "outlok.com": "outlook.com",
  };
  const STREETS = [
    {
      m: "karlovo nam",
      o: [
        { s: "Karlovo náměstí 19/13", c: "Praha 2", z: "120 00" },
        { s: "Karlovo náměstí 19/5", c: "Praha 2", z: "120 00" },
      ],
    },
    {
      m: "vaclavske nam",
      o: [
        { s: "Václavské náměstí 846/1", c: "Praha 1", z: "110 00" },
        { s: "Václavské náměstí 1282/51", c: "Praha 1", z: "110 00" },
      ],
    },
    {
      m: "masarykova",
      o: [
        { s: "Masarykova 427/12", c: "Brno", z: "602 00" },
        { s: "Masarykova 12", c: "Rudná", z: "252 19" },
      ],
    },
    {
      m: "moskevska",
      o: [
        { s: "Moskevská 1842", c: "Kladno", z: "272 04" },
        { s: "Moskevská 1842/8", c: "Praha 10", z: "101 00" },
      ],
    },
  ];
  const INITIAL = {
    email: "jan.novak@gmil.com",
    phone: "777123456",
    street: "Karlovo nám 19",
    city: "Praha",
    zip: "",
  };

  const I18N = {
    cs: {
      typo: "Překlep v doméně",
      emailOk: "Doména přijímá poštu",
      none: "Zatím bez připomínek",
      waiting: "Čeká na vstup",
      phoneAuto: "Sjednotí se automaticky",
      phoneDone: "Sjednocen formát",
      phoneValid: "Platné české číslo",
      addrIncomplete: "Neúplná adresa",
      addrOk: "Adresní místo existuje",
      allOk: "Vše potvrzeno",
      one: "1 návrh k potvrzení",
      many: (n) => `${n} návrhy k potvrzení`,
    },
    en: {
      typo: "Typo in the domain",
      emailOk: "Domain accepts mail",
      none: "No remarks yet",
      waiting: "Waiting for input",
      phoneAuto: "Will be normalized automatically",
      phoneDone: "Format normalized",
      phoneValid: "Valid Czech number",
      addrIncomplete: "Incomplete address",
      addrOk: "Address point exists",
      allOk: "All confirmed",
      one: "1 suggestion to confirm",
      many: (n) => `${n} suggestions to confirm`,
    },
  };
  const T = I18N[(document.documentElement.lang || "cs").slice(0, 2)] || I18N.cs;
  const $ = (id) => document.getElementById(id);
  const reel = $("showreel");
  if (reel) {
    const frame = reel.parentElement;
    const play = () => {
      reel.play();
    };
    $("showreel-play").addEventListener("click", play);
    reel.addEventListener("play", () => {
      reel.controls = true;
      frame.classList.add("is-playing");
    });
    reel.addEventListener("ended", () => frame.classList.remove("is-playing"));
  }
  // Example cards: hover/focus flips them via CSS; a tap toggles them on touch screens.
  for (const card of document.querySelectorAll(".fix")) {
    card.addEventListener("click", () => card.classList.toggle("is-on"));
  }
  const fold = (s) =>
    (s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[.,]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const email = $("f-email");
  const phone = $("f-phone");
  const street = $("f-street");
  const city = $("f-city");
  const zip = $("f-zip");
  if (!email) return;

  const rowEmail = $("row-email");
  const rowPhone = $("row-phone");
  const rowAddr = $("row-addr");
  let emailDone = false;
  let addrDone = false;
  const timers = {};
  const versions = { email: 0, address: 0 };

  function setRow(row, state, status) {
    row.classList.remove("is-suggest", "is-ok");
    if (state) row.classList.add(state);
    row.querySelector(".fstatus").textContent = status;
  }
  function count() {
    const n =
      (rowEmail.classList.contains("is-suggest") ? 1 : 0) +
      (rowAddr.classList.contains("is-suggest") ? 1 : 0);
    $("f-count").textContent = n === 0 ? T.allOk : n === 1 ? T.one : T.many(n);
  }

  // Live lookups go to the anonymous demo route with a server-side key. Failures and
  // late replies never touch the field: a suggestion is only shown, never applied.
  function live(kind, route, body, onResult) {
    clearTimeout(timers[kind]);
    const version = ++versions[kind];
    timers[kind] = setTimeout(async () => {
      try {
        const headers = { "Content-Type": "application/json" };
        if (typeof crypto !== "undefined" && crypto.randomUUID) {
          headers["Idempotency-Key"] = crypto.randomUUID();
        }
        const response = await fetch(`/public-demo/v1/${route}`, {
          method: "POST",
          credentials: "omit",
          cache: "no-store",
          headers,
          body: JSON.stringify(body),
          signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(5000) : undefined,
        });
        if (version !== versions[kind] || !response.ok) return;
        const result = await response.json();
        if (version !== versions[kind]) return;
        onResult(result);
      } catch {
        // fail open: the typed value stays as it is
      }
    }, 400);
  }

  function showEmailSuggestion(proposal) {
    const box = $("s-email");
    $("s-email-val").textContent = proposal;
    box.dataset.value = proposal;
    box.hidden = false;
    setRow(rowEmail, "is-suggest", T.typo);
    count();
  }
  function checkEmail() {
    const v = email.value.trim();
    const at = v.indexOf("@");
    const domain = at > -1 ? v.slice(at + 1).toLowerCase() : "";
    const fix = TYPO[domain];
    versions.email++;
    clearTimeout(timers.email);
    if (!emailDone && fix) {
      showEmailSuggestion(v.slice(0, at + 1) + fix);
      return;
    }
    $("s-email").hidden = true;
    if (emailDone && at > 0) setRow(rowEmail, "is-ok", T.emailOk);
    else setRow(rowEmail, "", v ? T.none : T.waiting);
    count();
    if (!emailDone && at > 0 && domain.includes(".")) {
      live("email", "emails/validate", { email: v, policy: "assist" }, (result) => {
        if (email.value.trim() !== v) return;
        if (typeof result.suggestion === "string" && result.suggestion !== v) {
          showEmailSuggestion(result.suggestion);
        }
      });
    }
  }

  function checkPhone(commit) {
    const v = phone.value.trim();
    let d = v.replace(/\D/g, "");
    if (d.length === 14 && d.indexOf("00420") === 0) d = d.slice(5);
    if (d.length === 12 && d.indexOf("420") === 0) d = d.slice(3);
    const f = d.length === 9 ? d.replace(/(\d{3})(\d{3})(\d{3})/, "+420 $1 $2 $3") : "";
    if (f && f !== v) {
      if (commit) {
        phone.value = f;
        setRow(rowPhone, "is-ok", T.phoneDone);
      } else {
        setRow(rowPhone, "", T.phoneAuto);
      }
    } else if (f) {
      setRow(rowPhone, "is-ok", T.phoneValid);
    } else {
      setRow(rowPhone, "", v ? T.none : T.waiting);
    }
  }

  function renderAddressOptions(options, source) {
    const list = $("s-addr-list");
    list.replaceChildren();
    for (const o of options) {
      const b = document.createElement("button");
      b.type = "button";
      const label = document.createElement("span");
      label.textContent = o.s;
      const detail = document.createElement("small");
      detail.textContent = o.z || o.c ? `${o.z} ${o.c}`.trim() : source;
      b.append(label, detail);
      b.addEventListener("click", () => {
        street.value = o.s;
        if (o.c) city.value = o.c;
        if (o.z) zip.value = o.z;
        addrDone = true;
        checkAddr();
      });
      list.append(b);
    }
    $("s-addr").hidden = options.length === 0;
    if (options.length) setRow(rowAddr, "is-suggest", T.addrIncomplete);
    count();
  }
  function checkAddr() {
    const f = fold(street.value);
    const hit = STREETS.find((entry) => f && f.indexOf(entry.m) === 0);
    versions.address++;
    clearTimeout(timers.address);
    if (!addrDone && hit) {
      renderAddressOptions(hit.o, "RÚIAN");
      return;
    }
    renderAddressOptions([], "RÚIAN");
    if (addrDone) setRow(rowAddr, "is-ok", T.addrOk);
    else setRow(rowAddr, "", street.value ? T.none : T.waiting);
    count();
    if (!addrDone && f.length >= 4) {
      const typed = street.value;
      live(
        "address",
        "addresses/autocomplete",
        { query: typed, country: "CZ", limit: 3 },
        (result) => {
          if (street.value !== typed) return;
          const options = Array.isArray(result.suggestions) ? result.suggestions : [];
          renderAddressOptions(
            options
              .filter((s) => typeof s.label === "string")
              .slice(0, 3)
              .map((s) => ({ s: s.label, c: "", z: "" })),
            "RÚIAN",
          );
        },
      );
    }
  }

  email.addEventListener("input", () => {
    emailDone = false;
    checkEmail();
  });
  $("s-email-use").addEventListener("click", () => {
    email.value = $("s-email").dataset.value;
    emailDone = true;
    checkEmail();
  });
  $("s-email-keep").addEventListener("click", () => {
    emailDone = true;
    checkEmail();
  });
  phone.addEventListener("input", () => checkPhone(false));
  phone.addEventListener("blur", () => checkPhone(true));
  street.addEventListener("input", () => {
    addrDone = false;
    checkAddr();
  });
  $("f-reset").addEventListener("click", () => {
    email.value = INITIAL.email;
    phone.value = INITIAL.phone;
    street.value = INITIAL.street;
    city.value = INITIAL.city;
    zip.value = INITIAL.zip;
    emailDone = false;
    addrDone = false;
    checkEmail();
    checkPhone(false);
    checkAddr();
  });

  checkEmail();
  checkPhone(false);
  checkAddr();
})();
