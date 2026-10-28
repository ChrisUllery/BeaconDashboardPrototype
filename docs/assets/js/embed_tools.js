"use strict";

// Publishing-tool iframe generator and lightweight map-only display mode.
// Embeds use the SAME dashboard and data files, not a separate map copy.
(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("embed") === "1") document.body.classList.add("beacon-embed");

    const raceField = document.getElementById("race-select");
    const viewField = document.getElementById("geography-select");
    const output = document.getElementById("embed-code");
    const heightField = document.getElementById("embed-height");
    const preview = document.getElementById("embed-preview");
    const copy = document.getElementById("copy-embed");
    const notice = document.getElementById("embed-publishing-note");

    function embedUrl() {
        const url = new URL(window.location.href);
        url.search = "";
        url.hash = "";
        url.searchParams.set("embed", "1");
        url.searchParams.set("race", raceField.value || "pa01");
        url.searchParams.set("view", viewField.value || "race");
        return url.href;
    }

    function height() {
        const value = Math.round(Number(heightField.value));
        return Number.isFinite(value) ? Math.max(400, Math.min(1200, value)) : 680;
    }

    function refresh() {
        // The selectors are populated asynchronously by map.js.
        if (!output || !raceField || !viewField || !raceField.value) return;
        const url = embedUrl();
        const title = "The Beacon simulated election results map";
        output.value = `<iframe src="${url.replaceAll("&", "&amp;")}" title="${title}" width="100%" height="${height()}" style="border:0;max-width:100%;" loading="lazy"></iframe>`;
        preview.href = url;
    }

    window.BeaconEmbedTools = {refresh};
    if (!output) return;

    // The code generated on localhost is a preview, not a publishable embed.
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
        || window.location.protocol === "file:";
    notice.textContent = local
        ? "Local preview only. After GitHub Pages is live, open the published dashboard and copy the iframe code there."
        : "This iframe loads the live map from this site's URL. The published map includes simulated 2026 returns.";

    heightField.addEventListener("input", refresh);
    raceField.addEventListener("change", refresh);
    viewField.addEventListener("change", refresh);

    copy.addEventListener("click", async () => {
        refresh();
        if (!output.value) return;
        try {
            await navigator.clipboard.writeText(output.value);
            copy.textContent = "Copied!";
        } catch (error) {
            output.focus();
            output.select();
            copy.textContent = "Select and copy the code";
        }
        window.setTimeout(() => { copy.textContent = "Copy iframe code"; }, 2000);
    });
    refresh();
})();
