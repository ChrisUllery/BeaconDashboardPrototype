"use strict";

// PA-01 newsroom briefing: current votes, county results, 2024 comparison,
// and precinct observations. This uses the already loaded precinct layers.
// The historical county data is cached after a single small JSON request.
window.BeaconPa01Briefing = (() => {
    const historicalUrl = "data/results/pa01_2024.json";
    const counties = {9: "Bucks", 46: "Montgomery"};
    const parties = {REP: "Republican", DEM: "Democrat", LIB: "Libertarian", IND: "Independent"};
    let historicalPromise = null;

    function number(n) { return Number(n).toLocaleString("en-US"); }
    function percentage(n, d) { return d ? (100 * n / d).toFixed(1) + "%" : "0.0%"; }
    function marginPoints(n, d) { return d ? (100 * n / d).toFixed(1) : "0.0"; }
    function total(votes) { return Object.values(votes).reduce((n, v) => n + Number(v || 0), 0); }
    function fullname(c) { return `${parties[c.party] || c.party} ${c.name}`; }
    function countyLabel(code) {
        return Number(code) === 46 ? "the PA-01 portion of Montgomery County" : "Bucks County";
    }
    function ranked(votes, roster) {
        return roster.map(c => ({...c, votes: Number(votes[c.party] || 0)}))
            .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
    }
    function currentSentence(candidates, voteTotal, scope) {
        if (!voteTotal) return `No votes have been reported in ${scope}.`;
        if (candidates.length < 2) {
            const a = candidates[0];
            return `${fullname(a)} has ${number(a.votes)} votes (${percentage(a.votes, voteTotal)}) in ${scope}.`;
        }
        const [a, b] = candidates;
        if (a.votes === b.votes) {
            return `${fullname(a)} and ${fullname(b)} are tied in ${scope}, with ${number(a.votes)} votes (${percentage(a.votes, voteTotal)}) each.`;
        }
        return `${fullname(a)} leads ${fullname(b)} in ${scope}, ${number(a.votes)} votes (${percentage(a.votes, voteTotal)}) to ${number(b.votes)} votes (${percentage(b.votes, voteTotal)}), a margin of ${number(a.votes - b.votes)} votes (${marginPoints(a.votes - b.votes, voteTotal)} percentage points).`;
    }

    async function loadHistorical() {
        if (!historicalPromise) {
            historicalPromise = fetch(historicalUrl).then(r => {
                if (!r.ok) throw new Error(`${historicalUrl}: HTTP ${r.status}`);
                return r.json();
            }).catch(error => {
                historicalPromise = null;
                throw error;
            });
        }
        return historicalPromise;
    }

    function build(race, history, layerByKey, past) {
        if (race.race_id !== "pa01" || history.year !== 2024 || past.election_year !== 2024) {
            throw new Error("Expected 2026 PA-01 and 2024 congressional history.");
        }
        if (!Array.isArray(race.precincts) || !Array.isArray(race.candidate_roster)) {
            throw new Error("Unexpected PA-01 data structure.");
        }
        const codes = race.coverage_counties.map(Number).sort((a, b) => a - b);
        if (codes.join(",") !== "9,46") throw new Error("PA-01 county coverage changed.");
        const roster = race.candidate_roster;
        const totals = Object.fromEntries(roster.map(c => [c.party, 0]));
        const byCounty = new Map(codes.map(code => [code, {
            reported: 0, mapped: 0,
            votes: Object.fromEntries(roster.map(c => [c.party, 0]))
        }]));
        const seen = new Set();
        let reporting = 0, counted = 0, tied = 0;
        const precinctLeads = new Map();
        const closest = [];

        for (const precinct of race.precincts) {
            const code = Number(precinct.county_code);
            const county = byCounty.get(code);
            if (!county) throw new Error(`Unexpected county ${code} in PA-01 results.`);
            const key = `${code}:${precinct.map_id}`;
            if (seen.has(key)) throw new Error(`Duplicate precinct in PA-01: ${key}`);
            if (!layerByKey.has(key)) throw new Error(`No map polygon for ${key}`);
            seen.add(key);
            county.mapped += 1;
            if (!precinct.reported) continue;
            reporting += 1;
            county.reported += 1;
            const votes = precinct.votes || {};
            for (const candidate of roster) {
                const value = Number(votes[candidate.party] || 0);
                if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid reported votes for ${key}`);
                totals[candidate.party] += value;
                county.votes[candidate.party] += value;
            }
            const localTotal = roster.reduce((sum, c) => sum + Number(votes[c.party] || 0), 0);
            if (!localTotal || roster.length < 2) continue;
            counted += 1;
            const [first, second] = ranked(votes, roster);
            if (first.votes === second.votes) tied += 1;
            else precinctLeads.set(first.name, (precinctLeads.get(first.name) || 0) + 1);
            if (localTotal >= 100) {
                const props = layerByKey.get(key).feature.properties;
                closest.push({
                    name: String(props.precinct_name || key), county: counties[code],
                    first, second, total: localTotal,
                    difference: first.votes - second.votes,
                    fraction: (first.votes - second.votes) / localTotal,
                    key
                });
            }
        }
        if (seen.size !== Number(race.total_mapped_precincts) || reporting !== Number(race.reporting_precincts)) {
            throw new Error("PA-01 geographic/reporting precinct totals do not reconcile.");
        }
        const candidates = ranked(totals, roster);
        const voteTotal = total(totals);
        const current = `With ${number(reporting)} of ${number(seen.size)} mapped precincts reporting (${percentage(reporting, seen.size)}), ${currentSentence(candidates, voteTotal, "Pennsylvania's 1st Congressional District")}`;

        const countyText = codes.map(code => {
            const c = byCounty.get(code);
            const localTotal = total(c.votes);
            return `With ${number(c.reported)} of ${number(c.mapped)} mapped precincts reporting (${percentage(c.reported, c.mapped)}), ${currentSentence(ranked(c.votes, roster), localTotal, countyLabel(code))}`;
        }).join(" ");

        const pastCounties = new Map(past.county_totals.map(c => [Number(c.county_code), c.votes]));
        if (pastCounties.size !== 2 || !codes.every(code => pastCounties.has(code))) {
            throw new Error("2024 PA-01 county history is incomplete.");
        }
        const historical = [...history.candidates].map(c => ({...c, votes: Number(c.votes)}))
            .sort((a, b) => b.votes - a.votes);
        if (historical.length < 2) throw new Error("The 2024 historical candidate list is incomplete.");
        for (const candidate of historical) {
            const fromCounties = codes.reduce((sum, code) => sum + Number(pastCounties.get(code)[candidate.party] || 0), 0);
            if (fromCounties !== candidate.votes) {
                throw new Error(`2024 ${candidate.party} county votes (${fromCounties}) do not match full district votes (${candidate.votes}).`);
            }
        }
        const [winner, runnerUp] = historical;
        const historicalTotal = historical.reduce((sum, c) => sum + c.votes, 0);
        let historyText = `In 2024, ${fullname(winner)} defeated ${fullname(runnerUp)}, ${number(winner.votes)} votes (${percentage(winner.votes, historicalTotal)}) to ${number(runnerUp.votes)} votes (${percentage(runnerUp.votes, historicalTotal)}), a margin of ${number(winner.votes - runnerUp.votes)} votes (${marginPoints(winner.votes - runnerUp.votes, historicalTotal)} percentage points).`;
        for (const code of codes) {
            const countyVotes = pastCounties.get(code);
            const localTotal = total(countyVotes);
            const [countyWinner, countyRunner] = ranked(countyVotes, historical);
            if (localTotal > 0) {
                const verb = countyWinner.votes === countyRunner.votes ? "tied" : "defeated";
                historyText += ` In ${countyLabel(code)}, ${countyWinner.name} ${verb} ${countyRunner.name}, ${percentage(countyWinner.votes, localTotal)} to ${percentage(countyRunner.votes, localTotal)}.`;
            }
        }

        let precinctText;
        if (!counted) {
            precinctText = "No precincts have reported candidate votes yet.";
        } else {
            const observations = [...precinctLeads.entries()].sort((a, b) => b[1] - a[1])
                .map(([name, count]) => `${name} leads in ${number(count)}`);
            if (tied) observations.push(`${number(tied)} ${tied === 1 ? "is" : "are"} tied`);
            precinctText = observations.length
                ? `Among ${number(counted)} precincts with reported votes, ${observations.join(", ")}.`
                : `All ${number(counted)} precincts with reported votes are tied.`;
            if (closest.length) {
                closest.sort((a, b) => a.fraction - b.fraction || a.key.localeCompare(b.key));
                const c = closest[0];
                if (c.difference === 0) {
                    precinctText += ` In ${c.name} (${c.county} County), the candidates are tied with ${number(c.first.votes)} votes each.`;
                } else {
                    precinctText += ` In the closest reported precinct with at least 100 votes counted, ${c.name} (${c.county} County), ${c.first.name} leads ${c.second.name} by ${number(c.difference)} ${c.difference === 1 ? "vote" : "votes"}, ${number(c.first.votes)} to ${number(c.second.votes)}.`;
                }
            }
        }
        const outstanding = seen.size - reporting;
        precinctText += outstanding === 1
            ? " One mapped precinct has not reported results."
            : ` Another ${number(outstanding)} mapped precincts have not reported results.`;

        return {race_id: "pa01", simulated: true, historical_year: 2024, sections: [
            {id: "current", title: "Tonight's results", text: current},
            {id: "counties", title: "Results by county", text: countyText},
            {id: "history", title: "2024 election", text: historyText},
            {id: "precincts", title: "Precinct observations", text: precinctText}
        ]};
    }

    async function generate(race, history, layerByKey) {
        return build(race, history, layerByKey, await loadHistorical());
    }

    function copyText(briefing) {
        return "SIMULATED 2026 RESULTS - NOT ACTUAL ELECTION RETURNS.\n\n" +
            briefing.sections.map(s => s.text).join("\n\n");
    }

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
                try {
                    await navigator.clipboard.writeText(section.text);
                    copyButton.textContent = "Copied";
                } catch (error) {
                    console.error("Unable to copy paragraph", error);
                    copyButton.textContent = "Copy unavailable";
                }
            });
            const p = document.createElement("p");
            p.textContent = section.text;
            header.append(heading, copyButton);
            wrapper.append(header, p);
            container.appendChild(wrapper);
        }
    }

    return {build, generate, copyText, render};
})();
