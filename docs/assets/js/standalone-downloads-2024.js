"use strict";

// Exports always follow the active year, race, and geography in the explorer.
(() => {
    const ROOT = "../data/";
    const COUNTY = {9:"Bucks",39:"Lehigh",46:"Montgomery"};
    const buttonLabels = [
        "Blank GeoJSON for selected map",
        "Results CSV for selected race",
        "Results GeoJSON for selected race",
        "All races, precinct-level CSV",
        "All available precinct boundaries"
    ];
    const list = document.querySelector(".download-list");
    if (!list) return;
    const placeholders = [...list.children];
    if (placeholders.length !== 5) {
        console.error("Expected five download placeholders; found", placeholders.length);
        return;
    }
    const buttons = placeholders.map((old, i) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "download-action";
        button.textContent = buttonLabels[i];
        button.disabled = true;
        old.replaceWith(button);
        return button;
    });
    const message = document.createElement("p");
    message.className = "download-status";
    message.setAttribute("role", "status");
    message.textContent = "Preparing downloads...";
    list.appendChild(message);
    const key = p => `${Number(p.county_code)}:${String(p.map_id)}`;
    const countyName = code => `${COUNTY[Number(code)] || `County ${code}`} County`;
    const filePart = s => String(s).replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();
    const isStatewide = race => !["USC","STS","STH"].includes(race.office);
    const visiblePrecincts = race => isStatewide(race)
        ? race.precincts.filter(p => Number(p.county_code) === 9) : race.precincts;
    function sumVotes(precincts) {
        const votes = {};
        for (const p of precincts) {
            for (const [party, n] of Object.entries(p.votes || {})) {
                votes[party] = (votes[party] || 0) + Number(n || 0);
            }
        }
        return votes;
    }
    const sum = votes => Object.values(votes).reduce((a,b) => a + b, 0);
    const raceLabel = race => race.office === "USC"
        ? `U.S. House PA-${String(race.district).padStart(2,"0")}`
        : race.office === "STH" ? `PA House District ${race.district}`
        : race.office === "STS" ? `PA Senate District ${race.district}`
        : race.office === "GOV" ? "Governor (Bucks County)" : race.race_id;
    function downloadFile(filename, content, mime) {
        const blob = new Blob([content], {type:mime});
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    function csvCell(value) {
        let s = value == null ? "" : String(value);
        if (/^[\s]*[=+@\-]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s.trim())) s = "'" + s;
        return `"${s.replace(/"/g,'""')}"`;
    }
    function toCSV(rows, columns) {
        return [columns.map(c => csvCell(c[0])).join(","),
            ...rows.map(row => columns.map(c => csvCell(row[c[1]])).join(","))].join("\r\n") + "\r\n";
    }
    const geoJSON = features => JSON.stringify({type:"FeatureCollection",features},null,2);
    Promise.all([
        fetch(ROOT+"results/bucks_2024_district_results.json"),
        fetch(ROOT+"results/mock_2026_results.json"),
        fetch(ROOT+"maps/precincts_2024.geojson"),
        fetch(ROOT+"maps/aggregated_boundaries_2024.geojson")
    ].map(async responsePromise => {
        const response = await responsePromise;
        if (!response.ok) throw new Error(`${response.url}: HTTP ${response.status}`);
        return response.json();
    })).then(([data2024,data2026,geometry,boundaries]) => {
        if (Number(data2024.election_year) !== 2024 || !Array.isArray(data2026.races))
            throw new Error("Unexpected election results files");
        const datasets = {"2024":data2024,"2026":data2026};
        const geometryByKey = new Map(geometry.features.map(f => [key(f.properties),f]));
        const boundariesByKey = new Map(boundaries.features.map(f => {
            const p = f.properties;
            return [`${p.race_id}|${p.level}|${p.county_code || ""}`,f];
        }));
        const selectedYear = () => document.querySelector("#election-year-select")?.value || "2024";
        const currentDataset = () => {
            const year = selectedYear();
            if (!datasets[year]) throw new Error(`Unknown election year: ${year}`);
            return {year, results:datasets[year]};
        };
        function selection() {
            const {year, results} = currentDataset();
            const raceId = document.querySelector("#map-race-select")?.value || "pa01";
            const view = document.querySelector("#map-view-select")?.value || "precinct";
            if (raceId === "all_house" || raceId === "all_senate") {
                const office = raceId === "all_house" ? "STH" : "STS";
                const races = results.races.filter(r => r.office === office);
                if (!races.length) throw new Error(`No ${year} ${office} races available`);
                return {year, raceId, level:"race", races};
            }
            const race = results.races.find(r => r.race_id === raceId);
            if (!race) throw new Error(`Unknown ${year} race: ${raceId}`);
            return {year, raceId, level:view, races:[race]};
        }
        function unit(race,level,subset,feature,name,countyCode=null,mapId=null) {
            if (!feature?.geometry) throw new Error(`Missing geometry for ${race.race_id}: ${name}`);
            return {race,level,name,countyCode,mapId,geometry:feature.geometry,votes:sumVotes(subset)};
        }
        function unitsForRace(race,level) {
            const precincts = visiblePrecincts(race);
            if (level === "precinct") {
                return precincts.map(p => {
                    const feature = geometryByKey.get(key(p));
                    const name = feature?.properties?.precinct_name || key(p);
                    return unit(race,"precinct",[p],feature,name,Number(p.county_code),String(p.map_id));
                });
            }
            if (level === "county") {
                const codes = [...new Set(precincts.map(p => Number(p.county_code)))].sort((a,b) => a-b);
                return codes.map(code => unit(race,"county",precincts.filter(p => Number(p.county_code) === code),
                    boundariesByKey.get(`${race.race_id}|county|${code}`),
                    `${countyName(code)} (district portion)`,code));
            }
            if (level === "race") {
                if (isStatewide(race)) return [unit(race,"race",precincts,
                    boundariesByKey.get(`${race.race_id}|county|9`),"Bucks County",9)];
                return [unit(race,"race",precincts,
                    boundariesByKey.get(`${race.race_id}|race|`),raceLabel(race))];
            }
            throw new Error(`Unknown geographic level: ${level}`);
        }
        const selectedUnits = () => {
            const s = selection();
            return {...s,units:s.races.flatMap(r => unitsForRace(r,s.level))};
        };
        function blankFeature(u) {
            return {type:"Feature",geometry:u.geometry,properties:{
                race_id:u.race.race_id, geography:u.level,
                county_code:u.countyCode,map_id:u.mapId,name:u.name
            }};
        }
        function resultsFeature(u,year) {
            const n = sum(u.votes);
            const props = {...blankFeature(u).properties,
                election_year:Number(year),
                result_status:year === "2026" ? "UNOFFICIAL PARTIAL" : "2024 HISTORICAL",
                total_votes:n > 0 ? n : null};
            for (const c of u.race.candidate_roster) {
                props[`candidate_${c.party}`] = c.name;
                props[`votes_${c.party}`] = n > 0 ? (u.votes[c.party] || 0) : null;
            }
            for (const [party,votes] of Object.entries(u.votes)) {
                if (!Object.hasOwn(props,`votes_${party}`)) props[`votes_${party}`] = n > 0 ? votes : null;
            }
            return {type:"Feature",geometry:u.geometry,properties:props};
        }
        function rowsFromUnits(units,year) {
            const rows = [];
            for (const u of units) {
                const n = sum(u.votes);
                for (const c of u.race.candidate_roster) {
                    rows.push({election_year:year,
                        result_status: year === "2026" ? "UNOFFICIAL PARTIAL" : "2024 HISTORICAL",
                        race_id:u.race.race_id,office:u.race.office,district:u.race.district,
                        geography:u.level,county:u.countyCode == null ? "" : countyName(u.countyCode),
                        geographic_name:u.name,map_id:u.mapId || "",candidate_name:c.name,
                        candidate_party:c.party,total_votes:n > 0 ? (u.votes[c.party] || 0) : ""});
                }
            }
            return rows;
        }
        const columns = [
            ["Election year","election_year"],["Result status","result_status"],
            ["Race ID","race_id"],["Office","office"],["District","district"],
            ["Geography","geography"],["County","county"],
            ["Geographic name","geographic_name"],["Map ID","map_id"],
            ["Candidate name","candidate_name"],["Candidate party","candidate_party"],
            ["Total votes","total_votes"]
        ];
        function exportSelected(type) {
            const s = selectedUnits();
            const prefix = `${s.year}_${filePart(s.raceId)}_${filePart(s.level)}`;
            if (type === "blank") {
                downloadFile(`${prefix}_blank.geojson`,geoJSON(s.units.map(blankFeature)),
                    "application/geo+json;charset=utf-8");
            } else if (type === "csv") {
                downloadFile(`${prefix}_results.csv`,toCSV(rowsFromUnits(s.units,s.year),columns),
                    "text/csv;charset=utf-8");
            } else if (type === "geojson") {
                downloadFile(`${prefix}_results.geojson`,
                    geoJSON(s.units.map(u => resultsFeature(u,s.year))),
                    "application/geo+json;charset=utf-8");
            }
        }
        function exportAllCSV() {
            const {year,results} = currentDataset();
            const units = results.races.flatMap(r => unitsForRace(r,"precinct"));
            downloadFile(`${year}_all_bucks_area_races_precinct_results.csv`,
                toCSV(rowsFromUnits(units,year),columns),"text/csv;charset=utf-8");
        }
        function exportAllBlank() {
            const {year,results} = currentDataset();
            const unique = new Map();
            for (const race of results.races) {
                for (const p of visiblePrecincts(race)) {
                    const k = key(p);
                    if (unique.has(k)) continue;
                    const feature = geometryByKey.get(k);
                    if (!feature) throw new Error(`Missing boundary for ${k}`);
                    unique.set(k,{type:"Feature",geometry:feature.geometry,
                        properties:{county_code:Number(p.county_code),map_id:String(p.map_id),
                            precinct_name:feature.properties.precinct_name || k}});
                }
            }
            downloadFile(`${year}_all_available_precincts_blank.geojson`,
                geoJSON([...unique.values()]),"application/geo+json;charset=utf-8");
        }
        const actions = [()=>exportSelected("blank"),()=>exportSelected("csv"),
            ()=>exportSelected("geojson"),exportAllCSV,exportAllBlank];
        buttons.forEach((button,i) => {
            button.disabled = false;
            button.addEventListener("click",() => {
                try {
                    actions[i]();
                    message.textContent = `Prepared ${selectedYear()} file: ${buttonLabels[i]}`;
                } catch (error) {
                    console.error("Election explorer download error",error);
                    message.textContent = `Download failed: ${error.message}`;
                }
            });
        });
        function updateMessage() {
            message.textContent = selectedYear() === "2026"
                ? "2026 exports are unofficial and partial. Unavailable totals are blank."
                : "2024 files ready to download.";
        }
        document.querySelector("#election-year-select")?.addEventListener("change",updateMessage);
        updateMessage();
    }).catch(error => {
        console.error("Election explorer downloads unavailable",error);
        message.textContent = `Downloads unavailable: ${error.message}`;
    });
})();
