"use strict";

// Editor gallery for the independent, map-only Leaflet viewer.
// It never loads the full dashboard or changes any election data.
(() => {
    const PUBLISHED_MAP_URL = "https://chrisullery.github.io/BeaconDashboardPrototype/map-viewer/";
    const LOCAL_MAP_URL = new URL("../map-viewer/", document.baseURI);
    const DATA_URL = "../data/results/mock_2026_results.json";
    const EMBED_HEIGHT = 680;
    const COUNTIES = {9: "Bucks", 39: "Lehigh", 46: "Montgomery"};
    const GROUPS = [
        {office: "GOV", name: "Governor"},
        {office: "USC", name: "U.S. Congress"},
        {office: "STS", name: "Pennsylvania Senate"},
        {office: "STH", name: "Pennsylvania House"}
    ];

    const shell = document.querySelector("#map-race-sections");
    const pageStatus = document.querySelector("#page-status");
    let currentlyOpen = null;
    const master = document.querySelector("#master-map-embed");
    let masterOpen = false;

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, character => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[character]);
    }

    function ordinal(value) {
        const n = Number(value);
        const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th"
            : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
        return n + suffix;
    }

    function raceName(race) {
        if (race.office === "GOV") return "Pennsylvania Governor";
        if (race.office === "USC") return `Pennsylvania's ${ordinal(race.district)} Congressional District`;
        if (race.office === "STS") return `Pennsylvania Senate District ${race.district}`;
        if (race.office === "STH") return `Pennsylvania House District ${race.district}`;
        return race.race_id;
    }

    function coverageLabel(race) {
        // The governor map embed intentionally reports only Bucks County.
        if (race.office === "GOV") return "Bucks County only";
        const names = race.coverage_counties.map(code => COUNTIES[code] || `County ${code}`);
        if (names.length === 1) return names[0] + " County";
        if (names.length === 2) return names.join(" and ") + " counties";
        return names.slice(0, -1).join(", ") + " and " + names.at(-1) + " counties";
    }

    function mapUrl(baseUrl, raceId, view) {
        const url = new URL(baseUrl);
        url.search = "";
        url.hash = "";
        url.searchParams.set("race", raceId);
        url.searchParams.set("view", view);
        // The independent map viewer always limits the governor race to Bucks.
        return url.href;
    }

    function iframeCode(raceId, raceLabel, view) {
        const url = escapeHtml(mapUrl(PUBLISHED_MAP_URL, raceId, view));
        const title = escapeHtml(`The Beacon simulated 2026 election map: ${raceLabel}`);
        return `<iframe src="${url}" title="${title}" width="100%" height="${EMBED_HEIGHT}" style="border:0;max-width:100%;" loading="lazy"></iframe>`;
    }

    function masterUrl(base) {
        const url = new URL(base);
        url.search = "";
        url.hash = "";
        url.searchParams.set("all", "1");
        url.searchParams.set("race", "pa01");
        url.searchParams.set("view", "precinct");
        return url.href;
    }
    function closeMasterPreview() {
        const preview = master.querySelector("#master-preview");
        preview.replaceChildren();
        preview.hidden = true;
        masterOpen = false;
        const button = master.querySelector("#master-preview-button");
        button.textContent = "Preview interactive map";
        button.setAttribute("aria-expanded", "false");
    }
    function toggleMasterPreview() {
        if (masterOpen) { closeMasterPreview(); return; }
        if (currentlyOpen) closePreview(currentlyOpen);
        const preview = master.querySelector("#master-preview");
        const hint = document.createElement("p");
        hint.className = "race-entry__preview-hint";
        hint.textContent = "Try switching races, then use the map on a narrow screen to check the mobile layout.";
        const iframe = document.createElement("iframe");
        iframe.src = masterUrl(LOCAL_MAP_URL);
        iframe.title = "All 15 race maps: interactive preview";
        iframe.loading = "lazy";
        preview.replaceChildren(hint, iframe);
        preview.hidden = false;
        masterOpen = true;
        const button = master.querySelector("#master-preview-button");
        button.textContent = "Hide preview";
        button.setAttribute("aria-expanded", "true");
    }
    function initializeMaster() {
        const iframeUrl = escapeHtml(masterUrl(PUBLISHED_MAP_URL));
        master.querySelector("#master-code").value = `<iframe src="${iframeUrl}" title="The Beacon 2026 interactive election maps for all tracked races" width="100%" height="680" style="border:0;max-width:100%;" loading="lazy"></iframe>`;
        master.querySelector("#master-open").href = masterUrl(LOCAL_MAP_URL);
        master.querySelector("#master-preview-button").addEventListener("click",toggleMasterPreview);
        master.querySelector("#master-copy").addEventListener("click",async()=>{
            const code = master.querySelector("#master-code");
            const feedback = master.querySelector("#master-feedback");
            try {
                if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
                await navigator.clipboard.writeText(code.value);
                feedback.textContent = "All-races iframe HTML copied. Paste into a WordPress Custom HTML block.";
            } catch (_error) {
                code.focus(); code.select();
                feedback.textContent = "Clipboard access unavailable. Copy the selected HTML manually.";
            }
        });
    }

    function racePanel(race) {
        const id = escapeHtml(race.race_id);
        const name = escapeHtml(raceName(race));
        const countyView = race.office !== "GOV" && race.coverage_counties.length > 1
            ? '<option value="county">County results</option>' : "";
        const governorNote = race.office === "GOV"
            ? '<p class="race-entry__note">Bucks County precincts only. This is not a statewide governor map and does not include Montgomery or Lehigh governor results.</p>' : "";
        return `<article class="race-entry" data-race-id="${id}">
            <div class="race-entry__heading">
                <h3>${name}</h3>
                <p>${escapeHtml(coverageLabel(race))}</p>
            </div>
            ${governorNote}
            <div class="race-entry__controls">
                <label>Map geography
                    <select class="race-entry__view" aria-label="Map geography for ${name}">
                        <option value="precinct" selected>Precinct results</option>
                        ${countyView}
                        <option value="race">${race.office === "GOV" ? "Bucks County overview" : "District overview"}</option>
                    </select>
                </label>
                <div class="race-entry__buttons">
                    <button class="action-button action-button--primary race-entry__copy" type="button">Copy iframe code</button>
                    <button class="action-button race-entry__preview-button" type="button" aria-expanded="false">Preview map</button>
                    <a class="race-entry__open" target="_blank" rel="noopener noreferrer" href="#">Open standalone map</a>
                </div>
            </div>
            <label class="race-entry__code-label">Iframe HTML
                <textarea class="race-entry__code" rows="3" readonly spellcheck="false" aria-label="Iframe HTML for ${name}"></textarea>
            </label>
            <span class="race-entry__feedback" role="status" aria-live="polite"></span>
            <div class="race-entry__preview" hidden></div>
        </article>`;
    }

    function closePreview(article) {
        if (!article) return;
        const preview = article.querySelector(".race-entry__preview");
        preview.replaceChildren(); // Unload the iframe and its Leaflet map.
        preview.hidden = true;
        const button = article.querySelector(".race-entry__preview-button");
        button.textContent = "Preview map";
        button.setAttribute("aria-expanded", "false");
        if (currentlyOpen === article) currentlyOpen = null;
    }

    function refreshPanel(article) {
        const raceId = article.dataset.raceId;
        const raceLabel = article.querySelector("h3").textContent;
        const view = article.querySelector(".race-entry__view").value;
        article.querySelector(".race-entry__code").value = iframeCode(raceId, raceLabel, view);
        const local = mapUrl(LOCAL_MAP_URL, raceId, view);
        article.querySelector(".race-entry__open").href = local;
        if (currentlyOpen === article) {
            const iframe = article.querySelector(".race-entry__preview iframe");
            if (iframe) iframe.src = local;
        }
    }

    function togglePreview(article) {
        if (currentlyOpen === article) {
            closePreview(article);
            return;
        }
        if (currentlyOpen) closePreview(currentlyOpen);
        if (masterOpen) closeMasterPreview();
        currentlyOpen = article;
        const label = article.querySelector("h3").textContent;
        const raceId = article.dataset.raceId;
        const view = article.querySelector(".race-entry__view").value;
        const preview = article.querySelector(".race-entry__preview");
        const hint = document.createElement("p");
        hint.className = "race-entry__preview-hint";
        hint.textContent = "Map-only preview. Pan, zoom, or click a precinct for results.";
        const iframe = document.createElement("iframe");
        iframe.src = mapUrl(LOCAL_MAP_URL, raceId, view);
        iframe.title = `Map preview: ${label}`;
        iframe.loading = "lazy";
        preview.replaceChildren(hint, iframe);
        preview.hidden = false;
        const button = article.querySelector(".race-entry__preview-button");
        button.textContent = "Hide preview";
        button.setAttribute("aria-expanded", "true");
    }

    async function copyIframe(article) {
        const code = article.querySelector(".race-entry__code");
        const feedback = article.querySelector(".race-entry__feedback");
        try {
            if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
            await navigator.clipboard.writeText(code.value);
            feedback.textContent = "Iframe HTML copied. Paste it into a WordPress Custom HTML block.";
        } catch (error) {
            code.focus();
            code.select();
            feedback.textContent = "Clipboard access unavailable. Copy the selected iframe HTML manually.";
        }
    }

    shell.addEventListener("change", event => {
        if (!event.target.matches(".race-entry__view")) return;
        const article = event.target.closest(".race-entry");
        refreshPanel(article);
        article.querySelector(".race-entry__feedback").textContent = "";
    });

    shell.addEventListener("click", event => {
        const button = event.target.closest("button");
        if (!button) return;
        const article = button.closest(".race-entry");
        if (!article) return;
        if (button.classList.contains("race-entry__copy")) void copyIframe(article);
        if (button.classList.contains("race-entry__preview-button")) togglePreview(article);
    });

    async function initialize() {
        try {
            const response = await fetch(DATA_URL, {cache: "no-store"});
            if (!response.ok) throw new Error(`Election race data returned HTTP ${response.status}`);
            const payload = await response.json();
            if (!Array.isArray(payload.races)) throw new Error("Election race list is missing");
            if (payload.status && !String(payload.status).includes("SIMULATED")) {
                throw new Error("This editor page is configured for the simulated 2026 dataset only");
            }
            const html = GROUPS.map(group => {
                const items = payload.races.filter(race => race.office === group.office);
                if (!items.length) return "";
                return `<section class="race-group">
                    <div class="race-group__heading">
                        <h2>${escapeHtml(group.name)}</h2>
                        <span>${items.length} ${items.length === 1 ? "race" : "races"}</span>
                    </div>
                    <div class="race-group__cards">${items.map(racePanel).join("")}</div>
                </section>`;
            }).join("");
            if (!payload.races.length) throw new Error("No races found");
            shell.innerHTML = html;
            shell.querySelectorAll(".race-entry").forEach(refreshPanel);
            pageStatus.textContent = `${payload.races.length} map embeds available. Preview maps on demand, or copy iframe code directly.`;
        } catch (error) {
            console.error("Could not load Beacon map embed gallery:", error);
            pageStatus.textContent = `Unable to load race maps: ${error.message}`;
        }
    }

    initializeMaster();
    void initialize();
})();
