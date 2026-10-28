"use strict";

// Senate 16: separate current, Bucks, Lehigh, 2022 Senate, 2024 presidential,
// and precinct observations. Only fictional 2026 votes; historical votes are real.
window.BeaconSenate16Briefing = (() => {
    const dataUrl = "data/results/senate16_county_history.json";
    const counties = [{code: 9, name: "Bucks"}, {code: 39, name: "Lehigh"}];
    const partyNames = {DEM: "Democrat", REP: "Republican", LIB: "Libertarian", IND: "Independent", FWD: "Forward"};
    let historicalPromise = null;
    const fmt = x => Number(x).toLocaleString("en-US");
    const percent = (numerator, denominator) => denominator ? (100 * numerator / denominator).toFixed(1) + "%" : "0.0%";
    const points = (numerator, denominator) => denominator ? (100 * numerator / denominator).toFixed(1) + " percentage points" : "0.0 percentage points";
    const total = obj => Object.values(obj).reduce((sum, x) => sum + Number(x || 0), 0);
    const fullname = c => `${partyNames[c.party] || c.party} ${c.name}`;
    const ranked = (votes, roster) => roster.map(c => ({...c, votes: Number(votes[c.party] || 0)}))
        .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
    const label = code => `the Senate District 16 portion of ${counties.find(c => c.code === code).name} County`;
    const publicationName = str => String(str).toLowerCase().replace(/\b[a-z]/g, s => s.toUpperCase())
        .replace(/\b0+(\d+)\b/g, (_, number) => String(Number(number)));

    async function loadHistorical() {
        if (!historicalPromise) {
            historicalPromise = fetch(dataUrl).then(response => {
                if (!response.ok) throw new Error(`${dataUrl}: HTTP ${response.status}`);
                return response.json();
            }).catch(error => { historicalPromise = null; throw error; });
        }
        return historicalPromise;
    }

    function statement(candidates, voteTotal, place) {
        if (!voteTotal) return `No candidate votes have been reported in ${place}.`;
        const [a, b] = candidates;
        if (!b) return `${fullname(a)} has ${fmt(a.votes)} votes (${percent(a.votes, voteTotal)}) in ${place}; no opposing candidate is listed.`;
        if (a.votes === b.votes) return `${fullname(a)} and ${fullname(b)} are tied in ${place} with ${fmt(a.votes)} votes (${percent(a.votes, voteTotal)}) apiece.`;
        return `${fullname(a)} leads ${fullname(b)} in ${place}, ${fmt(a.votes)} votes (${percent(a.votes, voteTotal)}) to ${fmt(b.votes)} votes (${percent(b.votes, voteTotal)}), a margin of ${fmt(a.votes - b.votes)} ${a.votes - b.votes === 1 ? "vote" : "votes"} (${points(a.votes - b.votes, voteTotal)}).`;
    }

    function checkHistory(past, year, office) {
        if (!past || Number(past.district) !== 16 || !Array.isArray(past.elections)) {
            throw new Error("Senate 16 historical export missing or wrong district");
        }
        const election = past.elections.find(e => Number(e.election_year) === year && e.office === office && Number(e.district) === 16);
        if (!election || !Array.isArray(election.candidates) || !Array.isArray(election.county_totals)) {
            throw new Error(`Missing ${year} ${office} District 16 history`);
        }
        const byCounty = new Map(election.county_totals.map(c => [Number(c.county_code), c.candidates]));
        if (byCounty.size !== 2 || counties.some(c => !byCounty.has(c.code))) throw new Error(`${year}: incomplete District 16 county portions`);
        const districtCandidates = new Map(election.candidates.map(c => [`${c.party}:${c.name.toLowerCase()}`, c]));
        if (districtCandidates.size < 2) throw new Error(`${year}: missing district candidates`);
        for (const [key, candidate] of districtCandidates) {
            const n = Number(candidate.votes);
            if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${year}: invalid district vote count`);
            let sum = 0;
            for (const {code} of counties) {
                const matches = byCounty.get(code).filter(c => `${c.party}:${c.name.toLowerCase()}` === key);
                if (matches.length > 1 || (matches.length && !Number.isSafeInteger(Number(matches[0].votes)))) {
                    throw new Error(`${year}: invalid or duplicate candidate in county ${code}: ${key}`);
                }
                sum += matches.length ? Number(matches[0].votes) : 0;
            }
            if (sum !== n) throw new Error(`${year}: county totals do not reconcile for ${candidate.name}`);
        }
        return {election, byCounty};
    }

    function historicSentence(list, place, fullDetails = false) {
        const sorted = [...list].map(c => ({...c, votes: Number(c.votes)})).sort((a, b) => b.votes - a.votes);
        const [a, b] = sorted;
        const n = sorted.reduce((sum, c) => sum + c.votes, 0);
        if (!a || !b || !n) throw new Error(`Missing historic candidate results in ${place}`);
        if (a.votes === b.votes) return `${a.name} and ${b.name} tied in ${place} at ${percent(a.votes, n)} each.`;
        if (fullDetails) return `${a.name} defeated ${b.name} in ${place}, ${fmt(a.votes)} votes (${percent(a.votes, n)}) to ${fmt(b.votes)} votes (${percent(b.votes, n)}), a margin of ${fmt(a.votes - b.votes)} ${a.votes - b.votes === 1 ? "vote" : "votes"} (${points(a.votes - b.votes, n)}).`;
        return `${a.name} carried ${place} with ${percent(a.votes, n)} of the vote, compared with ${percent(b.votes, n)} for ${b.name}.`;
    }

    function build(race, history, layerByKey, past) {
        if (race.race_id !== "senate_16" || race.office !== "STS" || Number(race.district) !== 16 || Number(history.year) !== 2022) {
            throw new Error("Expected 2026 mock Senate 16 and its 2022 Senate historical summary");
        }
        if (!Array.isArray(race.precincts) || !Array.isArray(race.candidate_roster) || race.candidate_roster.length < 2) {
            throw new Error("Incomplete Senate 16 precincts or candidate list");
        }
        if (race.coverage_counties.map(Number).sort((a,b) => a-b).join(",") !== "9,39") {
            throw new Error("Senate 16 county coverage changed");
        }
        const senate = checkHistory(past, 2022, "State Senate");
        const president = checkHistory(past, 2024, "President");
        const prior = new Map(history.candidates.map(c => [`${c.party}:${c.name.toLowerCase()}`, Number(c.votes)]));
        const previous = senate.election.candidates;
        if (prior.size !== previous.length || previous.some(c => prior.get(`${c.party}:${c.name.toLowerCase()}`) !== Number(c.votes))) {
            throw new Error("2022 Senate 16 historical summary and official county data disagree");
        }
        const roster = race.candidate_roster;
        const countyResults = new Map(counties.map(c => [c.code, {
            mapped: 0, reporting: 0, votes: Object.fromEntries(roster.map(p => [p.party, 0]))
        }]));
        const results = Object.fromEntries(roster.map(p => [p.party, 0]));
        const precinctLeaders = new Map();
        const closest = [];
        const used = new Set();
        let reporting = 0, counted = 0, tied = 0;
        for (const p of race.precincts) {
            const code = Number(p.county_code);
            const county = countyResults.get(code);
            if (!county) throw new Error(`Unexpected county ${code}`);
            const key = `${code}:${p.map_id}`;
            if (used.has(key) || !layerByKey.has(key)) throw new Error(`Duplicate or missing precinct geometry: ${key}`);
            used.add(key);
            county.mapped++;
            if (!p.reported) continue;
            county.reporting++;
            reporting++;
            const votes = {};
            for (const candidate of roster) {
                const value = Number((p.votes || {})[candidate.party] || 0);
                if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid precinct votes ${key}`);
                votes[candidate.party] = value;
                county.votes[candidate.party] += value;
                results[candidate.party] += value;
            }
            const n = total(votes);
            if (!n) continue;
            counted++;
            const [a, b] = ranked(votes, roster);
            if (a.votes === b.votes) tied++;
            else precinctLeaders.set(a.name, (precinctLeaders.get(a.name) || 0) + 1);
            if (n >= 100) closest.push({key, name: publicationName(layerByKey.get(key).feature.properties.precinct_name || key),
                county: counties.find(c => c.code === code).name, a, b, difference: a.votes - b.votes,
                relative: (a.votes - b.votes) / n});
        }
        if (used.size !== Number(race.total_mapped_precincts) || reporting !== Number(race.reporting_precincts)) {
            throw new Error("Senate 16 mapped precinct count or reporting totals do not reconcile");
        }
        const sections = [];
        sections.push({id: "current", title: "Tonight's results", text:
            `With ${fmt(reporting)} of ${fmt(used.size)} mapped precincts reporting (${percent(reporting, used.size)}), ` +
            statement(ranked(results, roster), total(results), "Pennsylvania Senate District 16")});
        for (const {code, name} of counties) {
            const c = countyResults.get(code);
            sections.push({id: `county-${code}`, title: `${name} County: Tonight's results`, text:
                `With ${fmt(c.reporting)} of ${fmt(c.mapped)} mapped precincts reporting (${percent(c.reporting, c.mapped)}), ` +
                statement(ranked(c.votes, roster), total(c.votes), label(code))});
        }
        let senateText = `In the 2022 Pennsylvania Senate District 16 election, ` +
            historicSentence(previous, "the district", true);
        senateText += " " + counties.map(c => historicSentence(senate.byCounty.get(c.code), label(c.code))).join(" ");
        if (history.matching_2024_precinct_scope === false) {
            senateText += " The historical precinct coverage does not exactly match the district's 2024 precinct map.";
        }
        sections.push({id: "senate-2022", title: "2022 Senate election", text: senateText});
        sections.push({id: "president-2024", title: "2024 presidential election within District 16", text:
            "In the 2024 presidential election, among precincts assigned to Senate District 16, " +
            historicSentence(president.election.candidates, "the district", true) + " " +
            counties.map(c => historicSentence(president.byCounty.get(c.code), label(c.code))).join(" ")});

        let precinctText;
        if (!counted) {
            precinctText = "No precincts have reported candidate votes yet.";
        } else {
            const leaderCounts = [...precinctLeaders.entries()].sort((a, b) => b[1] - a[1]);
            const detail = leaderCounts.map(([name, n]) => `${name} leads in ${fmt(n)}`);
            if (tied) detail.push(`${fmt(tied)} ${tied === 1 ? "is" : "are"} tied`);
            precinctText = `Of the ${fmt(counted)} precincts with reported votes, ${detail.join(" and ")}.`;
            if (closest.length) {
                closest.sort((a, b) => a.relative - b.relative || a.key.localeCompare(b.key));
                const p = closest[0];
                if (p.difference === 0) {
                    precinctText += ` In ${p.name} (${p.county} County), the candidates are tied at ${fmt(p.a.votes)} votes each.`;
                } else {
                    precinctText += ` The closest reported precinct with at least 100 votes counted is ${p.name} (${p.county} County), where ${p.a.name} leads ${p.b.name} by ${fmt(p.difference)} ${p.difference === 1 ? "vote" : "votes"}, ${fmt(p.a.votes)} to ${fmt(p.b.votes)}.`;
                }
            }
        }
        const missing = used.size - reporting;
        if (missing) precinctText += ` ${fmt(missing)} mapped ${missing === 1 ? "precinct has" : "precincts have"} not reported results.`;
        sections.push({id: "precincts", title: "Precinct observations", text: precinctText});
        return {race_id: "senate_16", simulated: true, sections};
    }

    async function generate(race, history, layerByKey) {
        return build(race, history, layerByKey, await loadHistorical());
    }
    const copyText = briefing => "SIMULATED 2026 RESULTS - NOT ACTUAL ELECTION RETURNS.\n\n" +
        briefing.sections.map(s => s.text).join("\n\n");
    function render(container, briefing) {
        container.replaceChildren();
        container.classList.add("briefing-mode");
        const warning = document.createElement("p");
        warning.className = "briefing-warning";
        warning.textContent = "SIMULATED 2026 RESULTS - NOT ACTUAL ELECTION RETURNS";
        container.appendChild(warning);
        for (const section of briefing.sections) {
            const wrapper = document.createElement("section");
            wrapper.className = "briefing-section";
            const header = document.createElement("div");
            header.className = "briefing-section-header";
            const heading = document.createElement("h4");
            heading.textContent = section.title;
            const copyButton = document.createElement("button");
            copyButton.type = "button";
            copyButton.className = "briefing-copy-one";
            copyButton.textContent = "Copy paragraph";
            copyButton.addEventListener("click", async () => {
                try { await navigator.clipboard.writeText(section.text); copyButton.textContent = "Copied"; }
                catch (error) { console.error("Unable to copy paragraph", error); copyButton.textContent = "Copy unavailable"; }
            });
            const p = document.createElement("p");
            p.textContent = section.text;
            header.append(heading, copyButton);
            wrapper.append(header, p);
            container.appendChild(wrapper);
        }
    }
    return {build, generate, render, copyText};
})();
