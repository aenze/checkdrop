(() => {
  const current = document.currentScript;
  const key = current?.getAttribute("data-checkdrop-wordpress-site");
  if (!key || !/^cdp_site_[A-Za-z0-9-]{3,80}$/.test(key)) return;
  // The Checkdrop installation serving the script; the hosted service unless the site sets its own.
  let server = "https://api.checkdrop.dev";
  const configured = current?.getAttribute("data-checkdrop-wordpress-server");
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) return;
      server = url.origin;
    } catch {
      return;
    }
  }
  // A manually inserted script wins. Never inject a second integration into the same page.
  if (document.querySelector("script[data-checkdrop-site]")) return;
  const embed = document.createElement("script");
  embed.src = `${server}/v1/embed.js`;
  embed.async = true;
  embed.setAttribute("data-checkdrop-site", key);
  document.head.appendChild(embed);
})();
