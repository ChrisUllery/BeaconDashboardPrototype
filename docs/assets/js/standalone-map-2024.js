"use strict";

// Unified historical / current election explorer. The 2026 dashboard is not modified.
(() => {
    const ROOT = "../data/";
    const COUNTY = {9: "Bucks", 39: "Lehigh", 46: "Montgomery"};
    const GROUPS = [["GOV", "Governor"], ["USC", "U.S. Congress"],
        ["STS", "Pennsylvania Senate"], ["STH", "Pennsylvania House"]];
    const params = new URLSearchParams(location.search);
    const initialRace = params.get("race") || "pa01";
    const initialView = params.get("view") || "precinct";
    const initialYear = params.get("year") === "2026" ? "2026" : "2024";
    const OVERVIEW_OPTIONS = {all_house: "STH", all_senate: "STS"};
    const $ = selector => document.querySelector(selector);
    const status = $("#map-status");
    const legend = $("#map-legend");
    const backButton = $("#return-to-overview");
    const controls = $("#map-controls");
    const yearSelect = $("#election-year-select");
    const raceSelect = $("#map-race-select");
    const viewSelect = $("#map-view-select");
    const table = $("#results-table");
    const yearLabel = $(".simulated-label");
    const number = n => Number(n).toLocaleString("en-US");
    const esc = value => String(value).replace(/[&<>"']/g,
        a => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[a]);
    const total = votes => Object.values(votes || {}).reduce((sum, v) => sum + Number(v || 0), 0);
    const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)}%` : "0.0%";
    const precinctKey = p => `${Number(p.county_code)}:${String(p.map_id)}`;
    const countyName = code => COUNTY[Number(code)] || `County ${code}`;
    const isStatewide = race => !["USC", "STS", "STH"].includes(race.office);
    // Statewide elections display Bucks County only. Districts retain full cross-county coverage.
    const visiblePrecincts = race => isStatewide(race)
        ? race.precincts.filter(p => Number(p.county_code) === 9) : race.precincts;

    function raceName(race) {
        if (race.office === "GOV") return "Pennsylvania Governor (Bucks County)";
        if (race.office === "USC") return `U.S. House PA-${String(race.district).padStart(2, "0")}`;
        if (race.office === "STS") return `PA Senate District ${race.district}`;
        if (race.office === "STH") return `PA House District ${race.district}`;
        return race.race_id;
    }
    function sidesOf(race) {
        const parties = race.candidate_roster.map(c => c.party);
        if (parties.length < 2) return parties[0] === "DEM" || parties[0] === "REP"
            ? {left:"DEM", right:"REP"} : null;
        const right = parties.includes("REP") ? "REP" : parties[1];
        return {left: parties.includes("DEM") ? "DEM" : parties.find(p => p !== right), right};
    }
    function voteMargin(votes, sides) {
        const n = total(votes);
        return n && sides ? 100 * (Number(votes[sides.right] || 0) - Number(votes[sides.left] || 0)) / n : null;
    }
    function fillColor(v, hasVotes) {
        if (!hasVotes) return "#d7dce1";
        if (v === null) return "#79b7ad";
        if (v >= 35) return "#b2182b";
        if (v >= 20) return "#d6604d";
        if (v >= 10) return "#f4a582";
        if (v > 0) return "#fddbc7";
        if (v === 0) return "#f7f7f7";
        if (v > -10) return "#d1e5f0";
        if (v > -20) return "#92c5de";
        if (v > -35) return "#4393c3";
        return "#2166ac";
    }
    function emptyVotes(roster) { return Object.fromEntries(roster.map(c => [c.party, 0])); }
    function aggregate(precincts, roster) {
        const result = {votes: emptyVotes(roster)};
        for (const p of precincts) {
            for (const [party, n] of Object.entries(p.votes || {})) {
                result.votes[party] = (result.votes[party] || 0) + Number(n || 0);
            }
        }
        return result;
    }
    function popup(title, county, a, roster) {
        const n = total(a.votes);
        const rows = n ? roster.map(c => ({...c, votes: Number(a.votes[c.party] || 0)}))
            .sort((x, y) => y.votes - x.votes || x.name.localeCompare(y.name))
            .map(c => `<div>${esc(c.name)} (${esc(c.party)}): <b>${number(c.votes)} (${pct(c.votes, n)})</b></div>`)
            .join("") : "No candidate votes available.";
        return `<div class="precinct-popup"><strong>${esc(title)}</strong>${county ? `<div>${esc(county)} County</div>` : ""}<div>${rows}</div></div>`;
    }
    function hatchPattern() {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 10;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.fillStyle = "#d7dce1"; ctx.fillRect(0, 0, 10, 10);
        ctx.strokeStyle = "#808c98"; ctx.lineWidth = 1.4; ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(10, 10); ctx.moveTo(-10, 0); ctx.lineTo(0, 10);
        ctx.moveTo(10, 0); ctx.lineTo(20, 10); ctx.stroke();
        return ctx.createPattern(canvas, "repeat");
    }
    async function loadJSON(url) {
        const response = await fetch(url, {cache:"no-store"});
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        return response.json();
    }

    async function start() {
        if (!window.L) throw new Error("Leaflet did not load");
        if (!yearSelect || !raceSelect || !viewSelect || !table || !yearLabel) {
            throw new Error("Explorer controls are missing from the HTML");
        }
        const [data2024, data2026, geometry, boundaries] = await Promise.all([
            loadJSON(ROOT + "results/bucks_2024_district_results.json"),
            loadJSON(ROOT + "results/mock_2026_results.json"),
            loadJSON(ROOT + "maps/precincts_2024.geojson"),
            loadJSON(ROOT + "maps/aggregated_boundaries_2024.geojson")
        ]);
        if (Number(data2024.election_year) !== 2024 || data2024.races?.length !== 11)
            throw new Error("Unexpected 2024 district results dataset");
        if (!Array.isArray(data2026.races) || !String(data2026.status).includes("UNOFFICIAL 2026"))
            throw new Error("Expected unofficial 2026 results dataset");
        if (!Array.isArray(geometry.features) || !Array.isArray(boundaries.features))
            throw new Error("Missing election map geometry");
        const datasets = {"2024":data2024, "2026":data2026};
        const geometries = new Map(geometry.features.map(f => [precinctKey(f.properties), f]));
        const boundMap = new Map(boundaries.features.map(f => {
            const p = f.properties;
            return [`${p.race_id}|${p.level}|${p.county_code || ""}`, f];
        }));
        const map = L.map("election-map", {preferCanvas:true,scrollWheelZoom:false,zoomSnap:0.1,zoomDelta:0.5});
        const renderer = L.canvas({padding:0.2});
        const hatch = hatchPattern();
        let currentYear = initialYear;
        let activeLayer = null;
        let activeRace = null;
        let activeView = "precinct";
        if (backButton) backButton.hidden = true; // Only dropdowns change geography.
        controls.hidden = false;
        document.body.classList.add("all-races");

        function setLegend(race, sides, view) {
            if (sides) {
                legend.innerHTML = `<strong class="legend-title">${esc(sides.left)} vs. ${esc(sides.right)} vote margin</strong>` +
                    `<div class="legend-bar"></div><div class="legend-labels"><span>${esc(sides.left)} +50</span><span>0</span><span>${esc(sides.right)} +50</span></div><div class="legend-foot"></div>`;
            } else {
                legend.innerHTML = '<strong class="legend-title">Candidate results</strong><div class="legend-foot"></div>';
            }
            legend.querySelector(".legend-foot").textContent = currentYear === "2026"
                ? "Gray or hatched: no candidate votes available. Unofficial, partial returns."
                : "Gray or hatched: no candidate votes available.";
            legend.hidden = false;
        }

        function setRaceOptions() {
            const dataset = datasets[currentYear];
            raceSelect.innerHTML = GROUPS.map(([office, label]) => {
                const subset = dataset.races.filter(r => r.office === office);
                if (!subset.length) return "";
                const overview = (office === "STS" && subset.length > 1)
                    ? '<option value="all_senate">All tracked Senate races</option>'
                    : (office === "STH" && subset.length > 1)
                        ? '<option value="all_house">All tracked House races</option>' : "";
                return `<optgroup label="${esc(label)}">${overview}${subset.map(r =>
                    `<option value="${esc(r.race_id)}">${esc(raceName(r))}</option>`).join("")}</optgroup>`;
            }).join("");
        }
        function setViewOptions(race, selected = "precinct") {
            const county = !isStatewide(race) && new Set(visiblePrecincts(race).map(p => Number(p.county_code))).size > 1;
            viewSelect.innerHTML = '<option value="precinct">Precinct results</option>' +
                (county ? '<option value="county">County results</option>' : "") +
                `<option value="race">${isStatewide(race) ? "Bucks County" : "District"} overview</option>`;
            viewSelect.value = [...viewSelect.options].some(o => o.value === selected) ? selected : "precinct";
            viewSelect.disabled = false;
            return viewSelect.value;
        }
        function updateTable(selectedRaces, level) {
            const columns = level === "precinct"
                ? ["County", "Precinct", "Candidate name", "Candidate party", "Total votes"]
                : [level === "county" ? "County" : "District", "Candidate name", "Candidate party", "Total votes"];
            const groups = new Map();
            for (const race of selectedRaces) {
                for (const p of visiblePrecincts(race)) {
                    const county = `${countyName(p.county_code)} County`;
                    const feature = geometries.get(precinctKey(p));
                    const precinct = feature?.properties?.precinct_name || precinctKey(p);
                    const scope = level === "precinct" ? precinctKey(p)
                        : level === "county" ? String(p.county_code) : race.race_id;
                    const key = `${race.race_id}|${scope}`;
                    if (!groups.has(key)) {
                        groups.set(key, {race, county,
                            label: level === "precinct" ? precinct : level === "county"
                                ? `${county} (district portion)` : isStatewide(race)
                                    ? "Bucks County" : raceName(race), votes:emptyVotes(race.candidate_roster)});
                    }
                    const group = groups.get(key);
                    for (const [party, votes] of Object.entries(p.votes || {})) {
                        group.votes[party] = (group.votes[party] || 0) + Number(votes || 0);
                    }
                }
            }
            table.tHead.innerHTML = `<tr>${columns.map(c => `<th scope="col">${esc(c)}</th>`).join("")}</tr>`;
            const rows = [];
            for (const group of groups.values()) {
                const candidates = [...group.race.candidate_roster].sort((a, b) =>
                    (group.votes[b.party] || 0) - (group.votes[a.party] || 0));
                const hasVotes = total(group.votes) > 0;
                for (const candidate of candidates) {
                    const geography = level === "precinct" ? [group.county, group.label] : [group.label];
                    const fields = [...geography, candidate.name, candidate.party];
                    rows.push(`<tr>${fields.map(v => `<td>${esc(v)}</td>`).join("")}` +
                        `<td class="vote-count">${hasVotes ? number(group.votes[candidate.party] || 0) : ""}</td></tr>`);
                }
            }
            table.tBodies[0].innerHTML = rows.join("") ||
                `<tr><td colspan="${columns.length}">No results available.</td></tr>`;
            table.createCaption().textContent = selectedRaces.length === 1
                ? `${currentYear} ${raceName(selectedRaces[0])}: ${level} results${currentYear === "2026" ? " (unofficial, partial)" : ""}`
                : `${currentYear} ${selectedRaces[0].office === "STS" ? "Senate" : "House"} districts: overview${currentYear === "2026" ? " (unofficial, partial)" : ""}`;
        }
        function removeActiveLayer() {
            if (activeLayer) map.removeLayer(activeLayer);
            activeLayer = null;
            map.closePopup();
        }
        function renderRace(id, preferredView = "precinct") {
            const race = datasets[currentYear].races.find(r => r.race_id === id);
            if (!race) throw new Error(`Unknown ${currentYear} race: ${id}`);
            const precincts = visiblePrecincts(race);
            const byKey = new Map(precincts.map(p => [precinctKey(p), p]));
            if (!precincts.length || byKey.size !== precincts.length)
                throw new Error(`Invalid precinct identifiers for ${id}`);
            const features = precincts.map(p => geometries.get(precinctKey(p)));
            if (features.some(f => !f)) throw new Error(`Missing ${id} precinct boundaries`);
            const sides = sidesOf(race);
            removeActiveLayer();
            activeRace = id;
            raceSelect.value = id;
            activeView = setViewOptions(race, preferredView);
            const precinctLayer = L.geoJSON({type:"FeatureCollection",features}, {
                renderer,
                style: f => {
                    const p = byKey.get(precinctKey(f.properties));
                    const votes = p.votes || {};
                    return {color:"#2b2b2b",weight:0.9,fillOpacity:0.78,
                        fillColor: total(votes) > 0 ? fillColor(voteMargin(votes,sides),true) : hatch};
                },
                onEachFeature: (f, layer) => {
                    const p = byKey.get(precinctKey(f.properties));
                    const content = popup(f.properties.precinct_name || precinctKey(p), countyName(p.county_code),
                        {votes:p.votes || {}}, race.candidate_roster);
                    layer.bindPopup(content);
                    layer.bindTooltip(content, {sticky:true,direction:"top"});
                    layer.on("mouseover", () => layer.setStyle({color:"#111",weight:2,fillOpacity:0.9}));
                    layer.on("mouseout", () => precinctLayer.resetStyle(layer));
                }
            });
            function boundary(level, code = "") {
                return boundMap.get(`${race.race_id}|${level}|${code}`);
            }
            function aggregateLayer(feature, subset, label, county = "") {
                if (!feature) throw new Error(`Missing ${label} boundary`);
                const a = aggregate(subset, race.candidate_roster);
                const layer = L.geoJSON(feature, {
                    renderer,
                    style: {color:"#253744",weight:1.7,fillOpacity:0.78,
                        fillColor:fillColor(voteMargin(a.votes,sides),total(a.votes)>0)},
                    onEachFeature: (_feature, shape) => {
                        shape.bindTooltip(popup(label,county,a,race.candidate_roster), {sticky:true,direction:"top"});
                        shape.on("mouseover", () => shape.setStyle({color:"#111",weight:3,fillOpacity:0.9}));
                        shape.on("mouseout", () => layer.resetStyle(shape));
                    }
                });
                return layer;
            }
            const countyLayers = L.featureGroup();
            if (!isStatewide(race) && new Set(precincts.map(p => Number(p.county_code))).size > 1) {
                for (const code of [...new Set(precincts.map(p => Number(p.county_code)))]) {
                    const subset = precincts.filter(p => Number(p.county_code) === code);
                    countyLayers.addLayer(aggregateLayer(boundary("county", code), subset,
                        `${countyName(code)} County (district portion)`, countyName(code)));
                }
            }
            const region = isStatewide(race) ? boundary("county", 9) : boundary("race");
            const overview = aggregateLayer(region,precincts,
                isStatewide(race) ? "Bucks County results" : "Entire district results",
                isStatewide(race) ? "Bucks" : "");
            activeLayer = activeView === "precinct" ? precinctLayer
                : activeView === "county" ? countyLayers : overview;
            activeLayer.addTo(map);
            if (!activeLayer.getLayers().length) throw new Error(`No features for ${id}`);
            map.invalidateSize();
            map.fitBounds(activeLayer.getBounds(), {padding:[14,14],animate:false,maxZoom:12});
            if (backButton) backButton.hidden = true;
            setLegend(race, sides, activeView);
            updateTable([race], activeView);
            document.title = `${currentYear} ${raceName(race)} election results | The Beacon`;
            status.hidden = true;
        }
        function renderGroup(office) {
            const selected = datasets[currentYear].races.filter(r => r.office === office);
            if (!selected.length) throw new Error(`No ${currentYear} races for ${office}`);
            const selectedOption = office === "STS" ? "all_senate" : "all_house";
            removeActiveLayer();
            const layers = L.featureGroup();
            for (const race of selected) {
                const feature = boundMap.get(`${race.race_id}|race|`);
                if (!feature) throw new Error(`Missing district boundary for ${race.race_id}`);
                const a = aggregate(visiblePrecincts(race),race.candidate_roster);
                const sides = sidesOf(race);
                const label = raceName(race);
                const shapeGroup = L.geoJSON(feature, {
                    renderer,
                    style: {color:"#253744",weight:1.7,fillOpacity:0.78,
                        fillColor:fillColor(voteMargin(a.votes,sides),total(a.votes)>0)},
                    onEachFeature: (_f, shape) => {
                        shape.bindTooltip(popup(label,"",a,race.candidate_roster), {sticky:true,direction:"top"});
                        shape.on("mouseover", () => shape.setStyle({color:"#111",weight:3,fillOpacity:0.9}));
                        shape.on("mouseout", () => shapeGroup.resetStyle(shape));
                    }
                });
                layers.addLayer(shapeGroup);
            }
            activeLayer = layers;
            activeRace = selectedOption;
            activeView = "race";
            raceSelect.value = selectedOption;
            viewSelect.innerHTML = '<option value="race">District overview</option>';
            viewSelect.value = "race";
            viewSelect.disabled = true;
            layers.addTo(map);
            map.invalidateSize();
            map.fitBounds(layers.getBounds(), {padding:[14,14],animate:false,maxZoom:12});
            if (backButton) backButton.hidden = true;
            updateTable(selected,"race");
            legend.innerHTML = '<strong class="legend-title">District vote margins</strong>' +
                '<div class="legend-bar"></div><div class="legend-labels"><span>DEM lead</span><span>0</span><span>REP lead</span></div>' +
                `<div class="legend-foot">Teal indicates a race without both major parties. ${currentYear === "2026" ? "Unofficial, partial returns." : ""}</div>`;
            legend.hidden = false;
            document.title = `${currentYear} Pennsylvania ${office === "STS" ? "Senate" : "House"} races | The Beacon`;
            status.hidden = true;
        }
        function chooseRace(id, view = "precinct") {
            if (OVERVIEW_OPTIONS[id]) renderGroup(OVERVIEW_OPTIONS[id]);
            else renderRace(id, view);
        }
        function setYear(year, preferredRace = "pa01", preferredView = "precinct") {
            if (!datasets[year]) throw new Error(`Unsupported election year: ${year}`);
            currentYear = year;
            yearSelect.value = year;
            yearLabel.textContent = year === "2026"
                ? "UNOFFICIAL 2026 RESULTS: PARTIAL RETURNS"
                : "2024 GENERAL ELECTION RESULTS";
            setRaceOptions();
            const requested = preferredRace && [...raceSelect.options].some(o => o.value === preferredRace)
                ? preferredRace : [...raceSelect.options].some(o => o.value === "pa01")
                    ? "pa01" : raceSelect.options[0]?.value;
            if (!requested) throw new Error(`No races available in ${year}`);
            chooseRace(requested, preferredView);
        }
        yearSelect.addEventListener("change", () => {
            try {setYear(yearSelect.value, activeRace, activeView);}
            catch (error) {status.textContent=error.message; status.hidden=false;}
        });
        raceSelect.addEventListener("change", () => {
            try {chooseRace(raceSelect.value, "precinct");}
            catch (error) {status.textContent=error.message; status.hidden=false;}
        });
        viewSelect.addEventListener("change", () => {
            try {if (!OVERVIEW_OPTIONS[activeRace]) chooseRace(activeRace, viewSelect.value);}
            catch (error) {status.textContent=error.message; status.hidden=false;}
        });
        setYear(initialYear, initialRace, initialView);

        // Optional contextual basemap from the original 2024 viewer.
        const roadPane=map.createPane("beaconRoadsPane");
        roadPane.style.zIndex="350";
        roadPane.style.pointerEvents="none";
        roadPane.style.opacity="0.25";
        const townPane=map.createPane("beaconTownPane");
        townPane.style.zIndex="625";
        townPane.style.pointerEvents="none";
        void Promise.all([loadJSON(ROOT+"basemap/roads.geojson"),loadJSON(ROOT+"basemap/places.geojson")])
            .then(([roads,places])=>{
                L.geoJSON(roads,{pane:"beaconRoadsPane",interactive:false,style:f=>{
                    const cls=f.properties.road_class;
                    return {color:"#526575",weight:cls==="major"?2.6:cls==="state"?1.7:1,
                        opacity:cls==="major"?0.7:0.45,lineCap:"round",lineJoin:"round"};
                }}).addTo(map);
                const allowed=new Set(["Doylestown","Levittown","Quakertown","Allentown","Bethlehem","Lansdale","Norristown","Bristol","Newtown","Coopersburg"]);
                const towns=L.layerGroup();
                L.geoJSON(places, {
                    filter:f=>Boolean(f.properties.priority)&&allowed.has(String(f.properties.NAME||"")),
                    pointToLayer:(f,latlng)=>L.marker(latlng,{
                        pane:"beaconTownPane",interactive:false,keyboard:false,
                        icon:L.divIcon({className:"beacon-town-marker",html:`<span class="beacon-town-text">${esc(f.properties.NAME)}</span>`,iconSize:[0,0],iconAnchor:[0,0]})
                    }),onEachFeature:(_f,layer)=>towns.addLayer(layer)
                });
                function updateLabels() {
                    const phone=window.innerWidth<=480;
                    const visible=map.getZoom()>=(phone?11.5:10.5);
                    if (visible) {if(!map.hasLayer(towns)) towns.addTo(map);}
                    else if (map.hasLayer(towns)) map.removeLayer(towns);
                }
                map.on("zoomend",updateLabels);
                window.addEventListener("resize",()=>{map.invalidateSize();updateLabels();});
                updateLabels();
                map.attributionControl.addAttribution('Roads and places: <a href="https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html" target="_blank" rel="noopener">U.S. Census Bureau TIGER/Line 2025</a>');
            }).catch(e=>console.warn("Optional basemap unavailable",e));
    }
    start().catch(error => {
        console.error("Beacon explorer error:",error);
        status.textContent=`Unable to display election map: ${error.message}`;
        status.hidden=false;
    });
})();
