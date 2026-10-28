"use strict";

// Beacon 2026 demonstration dashboard.
// Historical totals are real. All 2026 vote totals are SIMULATED, not live returns.
document.addEventListener("DOMContentLoaded", async () => {
    const COUNTY = {9: "Bucks", 39: "Lehigh", 46: "Montgomery"};
    const PARTY = {
        DEM: "Democrat", REP: "Republican", LIB: "Libertarian",
        IND: "Independent", FWD: "Forward", GRN: "Green"
    };
    const PARTY_COLOR = {
        DEM: "#4879b9", REP: "#be5656", LIB: "#888888",
        IND: "#18857b", FWD: "#18857b", GRN: "#509450"
    };
    const qs = selector => document.querySelector(selector);
    const formatNumber = value => Number(value).toLocaleString("en-US");
    const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);
    const share = (votes, total) => total > 0 ? (100 * votes / total) : 0;
    const percent = (votes, total) => `${share(votes, total).toFixed(1)}%`;
    const longParty = code => PARTY[code] || code;
    const labelName = candidate => `${longParty(candidate.party)} ${candidate.name}`;
    const countTotal = votes => Object.values(votes).reduce((s, n) => s + Number(n || 0), 0);
    const raceName = race => {
        if (race.office === "GOV") return "Pennsylvania Governor";
        if (race.office === "USC") return `U.S. House, PA-${String(race.district).padStart(2, "0")}`;
        if (race.office === "STS") return `PA Senate District ${race.district}`;
        if (race.office === "STH") return `PA House District ${race.district}`;
        return race.race_id;
    };
    const raceGroup = office => ({GOV: "Governor", USC: "U.S. Congress", STS: "PA Senate", STH: "PA House"})[office] || "Other";
    const countyList = race => race.coverage_counties.map(code => COUNTY[code] || `County ${code}`).join(", ");

    // One Leaflet map and one collection of polygon objects for every 2026 race.
    const map = L.map("precinct-map", {
        preferCanvas: true, scrollWheelZoom: false,
        zoomSnap: 0.1, zoomDelta: 0.5
    });
    // BEGIN SELF-HOSTED CENSUS BASEMAP
    // Geographic files are hosted with the dashboard, not an external tile service.
    const roadPane = map.createPane("beaconRoadsPane");
    roadPane.style.zIndex = "350"; // Precinct polygons are in the default 400 pane.
    roadPane.style.pointerEvents = "none";
    roadPane.style.opacity = "0.4";

    const townPane = map.createPane("beaconTownPane");
    townPane.style.zIndex = "625"; // Labels above precincts, below tooltips.
    townPane.style.pointerEvents = "none";

    async function loadCensusBasemap() {
        const get = async url => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
            return response.json();
        };
        const [roads, places] = await Promise.all([
            get("data/basemap/roads.geojson"),
            get("data/basemap/places.geojson")
        ]);

        L.geoJSON(roads, {
            pane: "beaconRoadsPane",
            interactive: false,
            style: feature => {
                const cls = feature.properties.road_class;
                return {
                    color: "#253a4a",
                    weight: cls === "major" ? 4 : cls === "state" ? 2.6 : 1.8,
                    opacity: cls === "major" ? 0.95 : 0.75,
                    lineCap: "round",
                    lineJoin: "round"
                };
            }
        }).addTo(map);

        const priorityTowns = L.layerGroup();
        const smallerTowns = L.layerGroup();
        L.geoJSON(places, {
            pointToLayer: (feature, latlng) => {
                const priority = Boolean(feature.properties.priority);
                const name = escapeHtml(feature.properties.NAME || "");
                return L.marker(latlng, {
                    pane: "beaconTownPane",
                    interactive: false,
                    keyboard: false,
                    icon: L.divIcon({
                        className: "beacon-town-marker",
                        html: `<span class="beacon-town-text${priority ? "" : " smaller"}">${name}</span>`,
                        iconSize: [0, 0],
                        iconAnchor: [0, 0]
                    })
                });
            },
            onEachFeature: (feature, layer) => {
                (feature.properties.priority ? priorityTowns : smallerTowns)
                    .addLayer(layer);
            }
        });

        function updateTownLabels() {
            // Limit crowding when all districts are on screen.
            const zoom = map.getZoom();
            if (zoom >= 9) map.addLayer(priorityTowns);
            else map.removeLayer(priorityTowns);
            if (zoom >= 12) map.addLayer(smallerTowns);
            else map.removeLayer(smallerTowns);
        }
        map.on("zoomend", updateTownLabels);
        updateTownLabels();
        map.attributionControl.addAttribution(
            'Roads and place names: <a href="https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html">U.S. Census Bureau TIGER/Line 2025</a>'
        );
        console.log(`Local basemap loaded: ${roads.features.length} roads, ${places.features.length} town labels.`);
    }
    loadCensusBasemap().catch(error => {
        // Election results still work when basemap files are missing.
        console.warn("Local Census basemap unavailable:", error);
    });
    // END SELF-HOSTED CENSUS BASEMAP

    const mapContainer = map.getContainer();
    const visiblePrecincts = L.featureGroup().addTo(map);
    const visibleBoundaries = L.featureGroup().addTo(map);
    const boundaryByKey = new Map();
    const layerByKey = new Map();
    const hoverCard = document.createElement("div");
    hoverCard.className = "precinct-hover-card";
    hoverCard.hidden = true;
    mapContainer.appendChild(hoverCard);

    const mapStatus = qs("#map-status");
    let currentRace = null;
    let currentHistory = null;
    let activePrecincts = new Map();
    let chosenLayer = null;
    let currentCopy = "";
    let currentView = "precinct";
    let groupedRaces = null;
    let racesById = new Map();
    let historiesById = new Map();

    function hideHover() { hoverCard.hidden = true; }

    // Keep the complete hover card inside the map, including at every zoom level.
    function showHover(event, html) {
        if (!event.originalEvent || event.originalEvent.clientX === undefined) return;
        const rect = mapContainer.getBoundingClientRect();
        const x = event.originalEvent.clientX - rect.left;
        const y = event.originalEvent.clientY - rect.top;
        const gap = 14, inset = 8;
        hoverCard.innerHTML = html;
        hoverCard.hidden = false;
        hoverCard.style.visibility = "hidden";
        const width = hoverCard.offsetWidth, height = hoverCard.offsetHeight;
        let left = x + gap;
        let top = y - height - gap;
        if (left + width > rect.width - inset) left = x - width - gap;
        if (top < inset) top = y + gap;
        left = Math.max(inset, Math.min(left, rect.width - width - inset));
        top = Math.max(inset, Math.min(top, rect.height - height - inset));
        hoverCard.style.left = `${left}px`;
        hoverCard.style.top = `${top}px`;
        hoverCard.style.visibility = "visible";
    }

    function leadingCandidates(race) {
        const totals = Object.fromEntries(race.candidate_roster.map(c => [c.party, 0]));
        const countyTotals = new Map();
        for (const precinct of race.precincts) {
            if (!countyTotals.has(precinct.county_code)) {
                countyTotals.set(precinct.county_code, {
                    reporting: 0, total: 0,
                    votes: Object.fromEntries(race.candidate_roster.map(c => [c.party, 0]))
                });
            }
            const county = countyTotals.get(precinct.county_code);
            county.total += 1;
            if (!precinct.reported) continue;
            county.reporting += 1;
            for (const [party, count] of Object.entries(precinct.votes)) {
                if (!(party in totals)) throw new Error(`Unexpected party ${party} in ${race.race_id}`);
                totals[party] += Number(count);
                county.votes[party] += Number(count);
            }
        }
        const candidates = race.candidate_roster.map(c => ({
            ...c, votes: totals[c.party] || 0
        })).sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
        return {candidates, totalVotes: countTotal(totals), countyTotals};
    }

    // Map colors show R-minus-D share of ALL listed candidate votes when both run.
    // In R-vs-independent races, the non-R candidate uses the left end of the scale.
    function mapParties(race) {
        const partyCodes = race.candidate_roster.map(c => c.party);
        if (partyCodes.length < 2) return (partyCodes[0] === "DEM" || partyCodes[0] === "REP") ? {left: "DEM", right: "REP"} : null;
        const right = partyCodes.includes("REP") ? "REP" : partyCodes[1];
        const left = partyCodes.includes("DEM") ? "DEM"
            : partyCodes.find(p => p !== right);
        return {left, right};
    }

    function margin(votes, race = currentRace) {
        const pair = race ? mapParties(race) : null;
        const total = countTotal(votes);
        return pair && total > 0
            ? (Number(votes[pair.right] || 0) - Number(votes[pair.left] || 0)) / total * 100
            : null;
    }

    function precinctColor(value, hasResults) {
        if (!hasResults) return "#d7dce1";
        if (value === null) return "#79b7ad"; // One listed candidate.
        if (value >= 35) return "#b2182b";
        if (value >= 20) return "#d6604d";
        if (value >= 10) return "#f4a582";
        if (value > 0) return "#fddbc7";
        if (value === 0) return "#f7f7f7";
        if (value > -10) return "#d1e5f0";
        if (value > -20) return "#92c5de";
        if (value > -35) return "#4393c3";
        return "#2166ac";
    }

    // Repeating diagonal hatching for unreported precincts only.
    // Leaflet Canvas clips this texture to each precinct's actual geometry.
    const hatchTile = document.createElement("canvas");
    hatchTile.width = 10;
    hatchTile.height = 10;
    const hatchCtx = hatchTile.getContext("2d");
    if (!hatchCtx) throw new Error("Canvas rendering is unavailable.");
    hatchCtx.fillStyle = "#d7dce1";
    hatchCtx.fillRect(0, 0, 10, 10);
    hatchCtx.strokeStyle = "#808c98";
    hatchCtx.lineWidth = 1.4;
    hatchCtx.beginPath();
    hatchCtx.moveTo(0, 0);
    hatchCtx.lineTo(10, 10);
    hatchCtx.moveTo(-10, 0);
    hatchCtx.lineTo(0, 10);
    hatchCtx.moveTo(10, 0);
    hatchCtx.lineTo(20, 10);
    hatchCtx.stroke();
    const unreportedPrecinctHatch = hatchCtx.createPattern(hatchTile, "repeat");
    if (!unreportedPrecinctHatch) throw new Error("Unable to create precinct hatching.");

    // Precinct events and borders are used only in the precinct-level view.
    function normalStyle(layer) {
        const precinct = activePrecincts.get(layer._beaconKey);
        return {
            fillColor: precinct && !precinct.reported
                ? unreportedPrecinctHatch
                : precinctColor(precinct ? margin(precinct.votes) : null,
                    Boolean(precinct && precinct.reported && countTotal(precinct.votes) > 0)),
            fillOpacity: 0.78,
            color: "#2b2b2b",
            weight: 0.9
        };
    }

    function popupFor(layer) {
        const precinct = activePrecincts.get(layer._beaconKey);
        if (!precinct) return "";
        const mapProps = layer.feature.properties;
        const total = precinct.reported ? countTotal(precinct.votes) : 0;
        const rows = currentRace.candidate_roster.map(c => {
            const votes = Number(precinct.votes[c.party] || 0);
            return `<div>${escapeHtml(c.name)} (${escapeHtml(c.party)}):
                <b>${formatNumber(votes)} (${percent(votes, total)})</b></div>`;
        }).join("");
        const status = precinct.reported ? `${formatNumber(total)} counted votes` : "Awaiting precinct results";
        return `<div class="precinct-popup">
            <strong>${escapeHtml(mapProps.precinct_name)}</strong>
            <div>${escapeHtml(COUNTY[mapProps.county_code] || "Unknown")} County</div>
            <hr>${precinct.reported ? rows : "No reported results yet."}
            <hr><strong>${status}</strong>
        </div>`;
    }

    function wirePolygon(feature, layer) {
        const p = feature.properties;
        const key = `${p.county_code}:${p.map_id}`;
        if (layerByKey.has(key)) throw new Error(`Repeated geographic precinct key: ${key}`);
        layer._beaconKey = key;
        layerByKey.set(key, layer);
        layer.on("mouseover", event => {
            if (currentView !== "precinct" || !activePrecincts.has(key)) return;
            layer.setStyle({weight: 2.2, color: "#000000", fillOpacity: 1});
            layer.bringToFront();
            if (chosenLayer !== layer) showHover(event, popupFor(layer));
        });
        layer.on("mousemove", event => {
            if (currentView === "precinct" && chosenLayer !== layer && activePrecincts.has(key)) {
                showHover(event, popupFor(layer));
            }
        });
        layer.on("mouseout", () => {
            if (currentView === "precinct" && activePrecincts.has(key)) layer.setStyle(normalStyle(layer));
            hideHover();
        });
        layer.on("click", () => {
            if (currentView !== "precinct" || !activePrecincts.has(key)) return;
            hideHover();
            layer.bindPopup(popupFor(layer), {maxWidth: 340, autoPan: true, closeButton: true});
            layer.openPopup();
        });
        layer.on("popupopen", () => { chosenLayer = layer; hideHover(); });
        layer.on("popupclose", () => { if (chosenLayer === layer) chosenLayer = null; });
    }

    // Each overview feature is a true union of its precincts, built once in Python.
    // Hovering highlights the whole county portion or district, never a precinct.
    function boundaryKey(raceId, level, countyCode = null) {
        return level === "county"
            ? `${raceId}|county|${countyCode}` : `${raceId}|race`;
    }

    function drawBoundary(race, level, aggregate, label, countyCode = null) {
        const geo = boundaryByKey.get(boundaryKey(race.race_id, level, countyCode));
        if (!geo) throw new Error(`Missing merged ${level} geometry for ${race.race_id}`);
        const totalVotes = countTotal(aggregate.votes);
        const ordered = race.candidate_roster.map(c => ({...c, votes: Number(aggregate.votes[c.party] || 0)}))
            .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
        const first = ordered[0], second = ordered[1];
        const line = totalVotes && first
            ? `${escapeHtml(first.name)} (${escapeHtml(first.party)}) leads with ${formatNumber(first.votes)} votes (${percent(first.votes, totalVotes)}).`
            : "No votes reported yet.";
        const lead = totalVotes && second
            ? `<div>Lead: ${formatNumber(first.votes - second.votes)} votes (${share(first.votes - second.votes, totalVotes).toFixed(1)} points)</div>`
            : "";
        let destination = "precinct";
        if (level === "race" && race.coverage_counties.length > 1) destination = "county";
        const action = destination === "county" ? "Click to view county results" : "Click to view precinct results";
        const details = `<div class="precinct-popup"><strong>${escapeHtml(label)}</strong><hr>${line}
            <div>${formatNumber(aggregate.reported)} of ${formatNumber(aggregate.total)} precincts reporting</div>
            ${lead}<hr><strong>${action}</strong></div>`;
        const baseStyle = {
            fillColor: precinctColor(margin(aggregate.votes, race), aggregate.reported > 0 && totalVotes > 0),
            fillOpacity: 0.78,
            color: "#253744",
            weight: 1.7
        };
        const boundaryLayer = L.geoJSON(geo, {
            style: baseStyle,
            onEachFeature: (feature, polygon) => {
                polygon.on("mouseover", event => {
                    polygon.setStyle({color: "#000000", weight: 3.2, fillOpacity: 0.9});
                    polygon.bringToFront();
                    showHover(event, details);
                });
                polygon.on("mousemove", event => showHover(event, details));
                polygon.on("mouseout", () => {
                    polygon.setStyle(baseStyle);
                    hideHover();
                });
                polygon.on("click", () => {
                    hideHover();
                    if (groupedRaces) {
                        activateRace(race, historiesById.get(race.race_id), "precinct");
                    } else {
                        activateRace(race, currentHistory, destination);
                    }
                });
            }
        });
        visibleBoundaries.addLayer(boundaryLayer);
    }

    function fitVisibleLayers() {
        const showing = currentView === "precinct" ? visiblePrecincts : visibleBoundaries;
        if (!showing.getLayers().length) throw new Error("No geographic features selected");
        map.invalidateSize();
        map.fitBounds(showing.getBounds(), {padding: [15, 15], animate: false});
        updateLegend();
    }

    function updateLegend() {
        const legend = qs("#map-legend");
        const legendRace = currentRace || (groupedRaces && groupedRaces[0]);
        const pair = legendRace ? mapParties(legendRace) : null;
        if (!pair) {
            legend.innerHTML = `<strong>Precinct reporting</strong>
                <div class="legend-special"><span><i style="background:#79b7ad"></i>Votes reported</span>
                <span><i style="background:#d7dce1"></i>Not reported</span></div>`;
            return;
        }
        legend.innerHTML = `<strong>${escapeHtml(pair.left)} vs. ${escapeHtml(pair.right)} vote margin</strong>
            <div class="margin-legend-bar"></div>
            <div class="margin-legend-labels"><span>${escapeHtml(pair.left)} +50</span>
            <span>0</span><span>${escapeHtml(pair.right)} +50</span></div>
            <small>Percentage points of all listed candidate votes; ${currentView === "precinct" ? "hatched = not reported" : "gray = no results"}</small>`;
    }

    function historicalInfo(history) {
        const candidates = history.candidates || [];
        const total = candidates.reduce((sum, c) => sum + Number(c.votes || 0), 0);
        const ranked = [...candidates].sort((a, b) => b.votes - a.votes);
        const leader = ranked[0];
        const runnerUp = ranked[1];
        const historyMargin = leader && runnerUp ? leader.votes - runnerUp.votes : null;
        const historyPoints = leader && runnerUp ? share(historyMargin, total) : null;
        return {total, ranked, leader, runnerUp, historyMargin, historyPoints};
    }

    function makeGeneratedCopy(race, history, summary) {
        const n = race.total_mapped_precincts;
        const reported = race.precincts.filter(p => p.reported).length;
        const pctReporting = percent(reported, n);
        const ordered = summary.candidates;
        const a = ordered[0], b = ordered[1];
        const isGovernor = race.office === "GOV";
        const name = raceName(race);
        const coverage = isGovernor
            ? `in the tracked counties of ${countyList(race)} (not statewide)`
            : `in ${name}`;

        let current;
        if (!summary.totalVotes) {
            current = `No simulated votes have been reported yet ${coverage}.`;
        } else if (!b) {
            current = `${labelName(a)} has ${formatNumber(a.votes)} votes (${percent(a.votes, summary.totalVotes)}) ${coverage}. No other named candidate is included in this demonstration.`;
        } else if (a.votes === b.votes) {
            current = `${labelName(a)} and ${labelName(b)} are tied with ${formatNumber(a.votes)} votes (${percent(a.votes, summary.totalVotes)}) each ${coverage}.`;
        } else {
            const points = share(a.votes - b.votes, summary.totalVotes);
            current = `${labelName(a)} leads ${labelName(b)} ${coverage}, ${formatNumber(a.votes)} votes (${percent(a.votes, summary.totalVotes)}) to ${formatNumber(b.votes)} votes (${percent(b.votes, summary.totalVotes)}). ${a.name} leads by ${formatNumber(a.votes - b.votes)} votes, or ${points.toFixed(1)} percentage points.`;
            if (ordered.length > 2) {
                const others = ordered.slice(2).map(c => `${c.name}: ${formatNumber(c.votes)} (${percent(c.votes, summary.totalVotes)})`).join("; ");
                current += ` Other listed candidates: ${others}.`;
            }
        }

        const past = historicalInfo(history);
        let comparison;
        if (past.leader && past.runnerUp) {
            comparison = `In ${history.year}, ${labelName(past.leader)} defeated ${labelName(past.runnerUp)}, ${formatNumber(past.leader.votes)} votes (${percent(past.leader.votes, past.total)}) to ${formatNumber(past.runnerUp.votes)} votes (${percent(past.runnerUp.votes, past.total)}), a margin of ${formatNumber(past.historyMargin)} votes, or ${past.historyPoints.toFixed(1)} percentage points.`;
        } else if (past.leader) {
            comparison = `In ${history.year}, ${labelName(past.leader)} was the only named candidate in the historical summary, with ${formatNumber(past.leader.votes)} votes.`;
        } else {
            comparison = `A historical comparison for ${history.year} is not available.`;
        }
        if (isGovernor) comparison += " The historical result is statewide; the current demonstration covers only three counties.";
        if (!history.matching_2024_precinct_scope && !isGovernor) {
            comparison += " Historical and 2024 precinct district coverage differ, so precinct-level comparisons require verification.";
        }
        return `SIMULATED 2026 RESULTS - NOT ACTUAL ELECTION RETURNS.\n\nWith ${formatNumber(reported)} of ${formatNumber(n)} mapped precincts reporting (${pctReporting}), ${current}\n\n${comparison}`;
    }

    function updatePanel(race, history) {
        qs(".map-panel .panel-heading h2").textContent = currentView === "precinct"
            ? "Precinct Results Map"
            : currentView === "county" ? "County Results Map"
            : race.office === "GOV" ? "Tracked Region Results Map" : "Entire District Results Map";
        qs(".candidate-grid").hidden = false;
        qs(".results-bar").hidden = false;
        qs("#county-panel").hidden = false;
        qs("#overview-results").hidden = true;
        qs("#historical-comparison").hidden = false;
        qs("#generator-section").hidden = false;
        const summary = leadingCandidates(race);
        const reported = race.precincts.filter(p => p.reported).length;
        const totalPrecincts = race.total_mapped_precincts;
        const votes = summary.totalVotes;
        qs(".section-heading .eyebrow").textContent = raceGroup(race.office);
        qs(".section-heading h1").textContent = `${raceName(race)} Results`;
        qs(".section-heading .section-note").textContent =
            `Nov. 3, 2026 general election | Simulated returns | ${countyList(race)}`;
        qs(".demo-badge").textContent = "2026 SIMULATED DEMO";
        qs(".status-strip").innerHTML = `
            <span><strong>${formatNumber(reported)} of ${formatNumber(totalPrecincts)}</strong> mapped precincts reporting (${percent(reported, totalPrecincts)})</span>
            <span>${formatNumber(votes)} simulated votes</span>
            ${race.office === "GOV" ? "<span>THREE COUNTIES ONLY, NOT STATEWIDE</span>" : ""}`;

        qs(".candidate-grid").innerHTML = summary.candidates.map(c => `
            <div class="candidate-card" style="border-top-color:${PARTY_COLOR[c.party] || "#888888"}">
                <span class="party-label">${escapeHtml(longParty(c.party))}</span>
                <h3>${escapeHtml(c.name)}</h3>
                <div class="vote-number">${formatNumber(c.votes)}</div>
                <div class="vote-percent">${percent(c.votes, votes)}</div>
            </div>`).join("");
        qs(".results-bar").innerHTML = summary.candidates.map(c => `
            <div style="width:${share(c.votes, votes)}%; background:${PARTY_COLOR[c.party] || "#888888"}"></div>
        `).join("");

        const orderedParties = summary.candidates;
        qs("#county-results thead").innerHTML = `<tr><th>County</th><th>Precincts</th>
            ${orderedParties.map(c => `<th>${escapeHtml(c.name)}</th>`).join("")}</tr>`;
        qs("#county-results tbody").innerHTML = [...summary.countyTotals.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([code, county]) => {
                const totalCounty = countTotal(county.votes);
                return `<tr><td>${escapeHtml(COUNTY[code] || String(code))}</td>
                    <td>${county.reporting}/${county.total}</td>
                    ${orderedParties.map(c => `<td>${formatNumber(county.votes[c.party] || 0)}
                        <small class="county-vote-share">${percent(county.votes[c.party] || 0, totalCounty)}</small></td>`).join("")}</tr>`;
            }).join("");

        qs(".map-panel .small-tag").textContent = "SIMULATED 2026 RESULTS";
        qs("#map-status").textContent = `${formatNumber(totalPrecincts)} precinct polygons | ${formatNumber(reported)} reporting | Hover for details, click to keep open`;

        const past = historicalInfo(history);
        qs("#history-context").textContent = `${history.year} general election | ${history.scope}`;
        qs("#history-results").innerHTML = past.ranked.map(c => `
            <div class="history-row"><span>${escapeHtml(c.name)} (${escapeHtml(c.party)})
            <small>${percent(c.votes, past.total)}</small></span>
            <strong>${formatNumber(c.votes)}</strong></div>`).join("");
        const warnings = [];
        if (race.office === "GOV") warnings.push("The 2022 baseline is statewide; simulated 2026 votes cover Bucks, Lehigh and Montgomery only.");
        if (race.office !== "GOV" && !history.matching_2024_precinct_scope) warnings.push("The historical district's precinct coverage differs from the 2024 map. Precinct-to-precinct comparisons are not validated.");
        warnings.push("2026 precinct and district assignments still require independent confirmation.");
        qs("#history-note").textContent = warnings.join(" ");

        currentCopy = makeGeneratedCopy(race, history, summary);
        qs("#generated-copy").textContent = currentCopy;
        qs("#generated-copy").classList.remove("briefing-mode");
        qs("#copy-generated").disabled = false;

        // Expand PA-01 into four independent, data-validated paragraphs.
        // Keep the old basic summary as a fallback on any data mismatch.
        if (race.office === "STH") {
            window.BeaconHouseBriefing.generate(race, history, layerByKey)
                .then(briefing => {
                    if (currentRace !== race) return;
                    window.BeaconHouseBriefing.render(qs("#generated-copy"), briefing);
                    currentCopy = window.BeaconHouseBriefing.copyText(briefing);
                })
                .catch(error => {
                    console.error("Detailed House briefing unavailable:", error);
                    if (currentRace !== race) return;
                    const p = document.createElement("p");
                    p.className = "briefing-error";
                    p.textContent = "Detailed House briefing unavailable; basic summary shown. Check the 2024 House history export and browser console.";
                    qs("#generated-copy").appendChild(p);
                });
        } else if (race.race_id === "senate_6" || race.race_id === "senate_10") {
            window.BeaconSenateBucksBriefing.generate(race, history, layerByKey)
                .then(briefing => {
                    if (currentRace !== race) return;
                    window.BeaconSenateBucksBriefing.render(qs("#generated-copy"), briefing);
                    currentCopy = window.BeaconSenateBucksBriefing.copyText(briefing);
                })
                .catch(error => {
                    console.error("Detailed Bucks Senate briefing unavailable:", error);
                    if (currentRace !== race) return;
                    const p = document.createElement("p");
                    p.className = "briefing-error";
                    p.textContent = "Detailed Senate briefing unavailable; basic summary shown. Check the district history export and browser console.";
                    qs("#generated-copy").appendChild(p);
                });
        } else if (race.race_id === "senate_16") {
            window.BeaconSenate16Briefing.generate(race, history, layerByKey)
                .then(briefing => {
                    if (currentRace !== race) return;
                    window.BeaconSenate16Briefing.render(qs("#generated-copy"), briefing);
                    currentCopy = window.BeaconSenate16Briefing.copyText(briefing);
                })
                .catch(error => {
                    console.error("Detailed Senate 16 briefing unavailable:", error);
                    if (currentRace !== race) return;
                    const message = document.createElement("p");
                    message.className = "briefing-error";
                    message.textContent = "Senate 16 detailed briefing unavailable; basic summary shown. Check the historical export and browser console.";
                    qs("#generated-copy").appendChild(message);
                });
        } else if (race.race_id === "governor") {
            window.BeaconGovernorBriefing.generate(race, history, layerByKey)
                .then(briefing => {
                    if (currentRace !== race) return;
                    window.BeaconGovernorBriefing.render(qs("#generated-copy"), briefing);
                    currentCopy = window.BeaconGovernorBriefing.copyText(briefing);
                })
                .catch(error => {
                    console.error("Detailed governor briefing unavailable:", error);
                    if (currentRace !== race) return;
                    const message = document.createElement("p");
                    message.className = "briefing-error";
                    message.textContent = "Governor county briefing unavailable; basic summary shown. Check the exported historical county data and browser console.";
                    qs("#generated-copy").appendChild(message);
                });
        } else if (race.race_id === "pa01") {
            window.BeaconPa01Briefing.generate(race, history, layerByKey)
                .then(briefing => {
                    if (currentRace !== race) return;
                    window.BeaconPa01Briefing.render(qs("#generated-copy"), briefing);
                    currentCopy = window.BeaconPa01Briefing.copyText(briefing);
                })
                .catch(error => {
                    console.error("Detailed PA-01 briefing unavailable:", error);
                    if (currentRace !== race) return;
                    const message = document.createElement("p");
                    message.className = "briefing-error";
                    message.textContent = "Detailed PA-01 briefing unavailable; basic summary shown. Check the data and browser console.";
                    qs("#generated-copy").appendChild(message);
                });
        }
    }

    function resetMap() {
        hideHover();
        map.closePopup();
        chosenLayer = null;
        visiblePrecincts.clearLayers();
        visibleBoundaries.clearLayers();
        activePrecincts = new Map();
    }

    function showLayers(keys) {
        for (const key of keys) {
            const layer = layerByKey.get(key);
            if (!layer) throw new Error(`2024 map polygon unavailable for ${key}`);
            layer.setStyle(normalStyle(layer));
            visiblePrecincts.addLayer(layer);
        }
        fitVisibleLayers();
    }

    function createOverview(race, groupKey) {
        const aggregates = new Map();
        const summaries = leadingCandidates(race);
        for (const precinct of race.precincts) {
            const group = groupKey(precinct);
            if (!aggregates.has(group)) {
                aggregates.set(group, {votes: {}, reported: 0, total: 0});
            }
            const target = aggregates.get(group);
            target.total += 1;
            if (!precinct.reported) continue;
            target.reported += 1;
            for (const [party, count] of Object.entries(precinct.votes)) {
                target.votes[party] = (target.votes[party] || 0) + Number(count);
            }
        }
        return {aggregates, summaries};
    }

    function switchGeographyHint(allRaces) {
        const field = qs("#geography-select");
        if (allRaces) {
            field.innerHTML = '<option value="race">District overview</option>';
            field.value = "race";
            field.disabled = true;
            qs("#geography-hint").textContent =
                "Click a whole district or choose a row in the table to drill down to precincts.";
            return;
        }
        field.disabled = false;
        const governor = currentRace.office === "GOV";
        const multipleCounties = currentRace.coverage_counties.length > 1;
        const wholeName = governor ? "Tracked region overview" : "Entire district overview";
        field.innerHTML = `<option value="race">${wholeName}</option>` +
            (multipleCounties ? '<option value="county">County results</option>' : '') +
            '<option value="precinct">Precinct results</option>';
        field.value = currentView;
        qs("#geography-hint").textContent = currentView === "precinct"
            ? "Click a precinct for results; diagonal hatching means not reported."
            : currentView === "county"
                ? "Hover to highlight an entire county portion. Click for precincts."
                : governor
                    ? "Three-county tracked region, not Pennsylvania statewide."
                    : "Hover to highlight the entire district. Click to drill down.";
    }

    function activateRace(race, history, mode = "race") {
        const upcoming = new Map(race.precincts.map(p => [`${p.county_code}:${p.map_id}`, p]));
        if (upcoming.size !== race.total_mapped_precincts) {
            throw new Error(`${race.race_id}: duplicate or missing precinct identifiers`);
        }
        resetMap();
        groupedRaces = null;
        currentRace = race;
        currentHistory = history;
        currentView = mode;
        activePrecincts = upcoming;

        if (mode === "precinct") {
            showLayers(upcoming.keys());
        } else if (mode === "county") {
            const {aggregates} = createOverview(race, p => String(p.county_code));
            for (const [county, agg] of aggregates) {
                const code = Number(county);
                drawBoundary(race, "county", agg, `${COUNTY[code] || county} County (tracked portion)`, code);
            }
            fitVisibleLayers();
        } else if (mode === "race") {
            const {aggregates} = createOverview(race, () => race.race_id);
            drawBoundary(race, "race", aggregates.get(race.race_id),
                race.office === "GOV" ? "Governor: tracked three-county region" : raceName(race));
            fitVisibleLayers();
        } else {
            throw new Error(`Unsupported geography view: ${mode}`);
        }
        updatePanel(race, history);
        qs("#race-select").value = race.race_id;
        switchGeographyHint(false);
        window.BeaconEmbedTools?.refresh();
    }

    function activateGroup(office) {
        const races = [...racesById.values()].filter(r => r.office === office);
        if (!races.length) throw new Error(`No tracked races for ${office}`);
        resetMap();
        groupedRaces = races;
        currentRace = null;
        currentHistory = null;
        currentView = "race";
        const districtRows = [];
        for (const race of races) {
            const {aggregates, summaries} = createOverview(race, () => race.race_id);
            const aggregate = aggregates.get(race.race_id);
            const winner = summaries.candidates[0];
            const second = summaries.candidates[1];
            const lead = second ? winner.votes - second.votes : 0;
            districtRows.push({race, aggregate, summaries, lead});
            for (const precinct of race.precincts) {
                const key = `${precinct.county_code}:${precinct.map_id}`;
                if (activePrecincts.has(key)) throw new Error(`Overlapping tracked districts at ${key}`);
                activePrecincts.set(key, precinct);
            }
            drawBoundary(race, "race", aggregate, raceName(race));
        }
        fitVisibleLayers();
        const house = office === "STH";
        qs(".section-heading .eyebrow").textContent = house ? "PA HOUSE" : "PA SENATE";
        qs(".section-heading h1").textContent = house
            ? "All Tracked Pennsylvania House Races" : "All Tracked Pennsylvania Senate Races";
        qs(".section-heading .section-note").textContent =
            "Nov. 3, 2026 general election | Simulated returns | Regional tracked districts";
        const n = districtRows.reduce((s,r) => s + r.aggregate.total,0);
        const reported = districtRows.reduce((s,r) => s + r.aggregate.reported,0);
        qs(".status-strip").innerHTML = `<span><strong>${races.length}</strong> tracked districts</span>
            <span>${formatNumber(reported)} of ${formatNumber(n)} mapped precincts reporting (${percent(reported,n)})</span>
            <span>SIMULATED, NOT STATEWIDE COVERAGE</span>`;
        qs(".candidate-grid").hidden = true;
        qs(".results-bar").hidden = true;
        qs("#county-panel").hidden = true;
        qs("#historical-comparison").hidden = true;
        qs("#generator-section").hidden = true;
        qs("#overview-results").hidden = false;
        qs(".map-panel .panel-heading h2").textContent = "District Results Map";
        qs("#map-status").textContent =
            `${races.length} tracked districts | ${formatNumber(reported)} of ${formatNumber(n)} precincts reporting | Click a district to drill down`;
        qs("#overview-table tbody").innerHTML = districtRows.map(({race, aggregate, summaries, lead}) => {
            const first = summaries.candidates[0], runnerUp = summaries.candidates[1];
            const points = runnerUp ? share(lead, summaries.totalVotes).toFixed(1) : "N/A";
            return `<tr><td><button type="button" class="overview-race-link" data-race-id="${escapeHtml(race.race_id)}">${escapeHtml(raceName(race))}</button></td>
                <td>${first ? escapeHtml(first.name) : "N/A"}</td>
                <td>${first && summaries.totalVotes ? percent(first.votes,summaries.totalVotes) : "No votes"}</td>
                <td>${runnerUp ? `${formatNumber(lead)} votes (${points} pts)` : "Uncontested"}</td>
                <td>${formatNumber(aggregate.reported)}/${formatNumber(aggregate.total)}</td></tr>`;
        }).join("");
        for (const button of qs("#overview-table").querySelectorAll(".overview-race-link")) {
            button.addEventListener("click", () => {
                const race = racesById.get(button.dataset.raceId);
                activateRace(race, historiesById.get(race.race_id), "precinct");
            });
        }
        qs("#race-select").value = house ? "all_house" : "all_senate";
        switchGeographyHint(true);
        window.BeaconEmbedTools?.refresh();
    }

    function buildNavigation(races, histories) {
        racesById = new Map(races.map(r => [r.race_id, r]));
        historiesById = histories;
        const menu = qs("#race-select");
        const groups = [
            ["Governor", "GOV"], ["U.S. Congress", "USC"],
            ["Pennsylvania Senate", "STS"], ["Pennsylvania House", "STH"]
        ];
        menu.innerHTML = groups.map(([label, office]) => {
            const items = races.filter(r => r.office === office);
            if (!items.length) return "";
            const overview = office === "STS" || office === "STH"
                ? `<option value="all_${office === "STS" ? "senate" : "house"}">All tracked ${office === "STS" ? "Senate" : "House"} races</option>` : "";
            return `<optgroup label="${escapeHtml(label)}">${overview}${items.map(r =>
                `<option value="${escapeHtml(r.race_id)}">${escapeHtml(raceName(r))}</option>`
            ).join("")}</optgroup>`;
        }).join("");
        menu.addEventListener("change", () => {
            try {
                if (menu.value === "all_senate") activateGroup("STS");
                else if (menu.value === "all_house") activateGroup("STH");
                else {
                    const race = racesById.get(menu.value);
                    activateRace(race, historiesById.get(race.race_id), "race");
                }
            } catch (error) { console.error(error); mapStatus.textContent = `Dashboard error: ${error.message}`; }
        });
        qs("#geography-select").addEventListener("change", event => {
            if (!currentRace) return;
            try { activateRace(currentRace, currentHistory, event.target.value); }
            catch (error) { console.error(error); mapStatus.textContent = `Dashboard error: ${error.message}`; }
        });
    }

    const legend = document.createElement("div");
    legend.className = "margin-legend";
    legend.id = "map-legend";
    mapContainer.insertAdjacentElement("afterend", legend);
    map.on("dragstart", hideHover);

    qs("#copy-generated").addEventListener("click", async () => {
        if (!currentCopy) return;
        const button = qs("#copy-generated");
        try {
            await navigator.clipboard.writeText(currentCopy);
            button.textContent = "Copied";
        } catch (error) {
            console.error("Clipboard unavailable:", error);
            button.textContent = "Select text to copy";
        }
        setTimeout(() => { button.textContent = "Copy summary"; }, 1600);
    });

    try {
        const load = async path => {
            const response = await fetch(path);
            if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
            return response.json();
        };
        const [geo, mock, history, boundaries] = await Promise.all([
            load("data/maps/precincts_2024.geojson"),
            load("data/results/mock_2026_results.json"),
            load("data/results/historical_race_summaries.json"),
            load("data/maps/aggregated_boundaries_2024.geojson")
        ]);
        if (geo.type !== "FeatureCollection" || !Array.isArray(geo.features)) {
            throw new Error("Unexpected precinct map format");
        }
        if (!Array.isArray(mock.races) || !Array.isArray(history.races)) {
            throw new Error("Unexpected race data format");
        }
        if (mock.status && !String(mock.status).includes("SIMULATED")) {
            throw new Error("This dashboard is configured for simulated data only");
        }
        if (boundaries.type !== "FeatureCollection" || !Array.isArray(boundaries.features)) {
            throw new Error("Missing or malformed merged boundary GeoJSON");
        }
        for (const f of boundaries.features) {
            const p = f.properties;
            const k = boundaryKey(p.race_id, p.level, p.county_code);
            if (boundaryByKey.has(k)) throw new Error(`Duplicate boundary ${k}`);
            boundaryByKey.set(k, f);
        }
        // Create all polygons once, keep them for every subsequent race selection.
        L.geoJSON(geo, {
            style: {fillColor: "#d7dce1", color: "#2b2b2b", weight: 0.9, fillOpacity: 0.78},
            onEachFeature: wirePolygon
        });
        const histories = new Map(history.races.map(h => [h.race_id, h]));
        for (const race of mock.races) {
            if (!histories.has(race.race_id)) throw new Error(`Missing historical summary for ${race.race_id}`);
        }
        buildNavigation(mock.races, histories);
        const initialParams = new URLSearchParams(window.location.search);
        const requestedRace = initialParams.get("race");
        const requestedView = initialParams.get("view");
        if (initialParams.get("embed") === "1" && requestedRace === "all_senate") {
            activateGroup("STS");
        } else if (initialParams.get("embed") === "1" && requestedRace === "all_house") {
            activateGroup("STH");
        } else {
            const initiallySelected = (initialParams.get("embed") === "1" && racesById.get(requestedRace))
                || mock.races.find(r => r.race_id === "pa01") || mock.races[0];
            if (!initiallySelected) throw new Error("No races available");
            const supportedView = requestedView === "precinct" || requestedView === "county" || requestedView === "race"
                ? requestedView : "race";
            const mode = supportedView === "county" && initiallySelected.coverage_counties.length < 2
                ? "race" : supportedView;
            activateRace(initiallySelected, histories.get(initiallySelected.race_id),
                initialParams.get("embed") === "1" ? mode : "race");
        }
    } catch (error) {
        console.error("Beacon dashboard failed:", error);
        mapStatus.textContent = `Unable to load election dashboard: ${error.message}`;
        qs("#race-select").innerHTML = `<option>Unable to load races</option>`;
        qs("#generated-copy").textContent = "No results available.";
    }
});
