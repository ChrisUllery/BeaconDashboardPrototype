"use strict";

// Multi-county governor election-night briefing.
// Current results are fictional and restricted to Bucks, Montgomery and Lehigh.
// Historical context comes from separately exported, checked official returns.
window.BeaconGovernorBriefing = (() => {
    const historicalUrl = "data/results/governor_county_history.json";
    const codes = [9, 46, 39]; // Reader-friendly Bucks, Montgomery, Lehigh order.
    const names = {9: "Bucks", 39: "Lehigh", 46: "Montgomery"};
    const partyNames = {DEM: "Democrat", REP: "Republican", LIB: "Libertarian", GRN: "Green", IND: "Independent"};
    let historicalPromise = null;
    const number = x => Number(x).toLocaleString("en-US");
    const percentage = (a, b) => b ? (100 * a / b).toFixed(1) + "%" : "0.0%";
    const points = (a, b) => b ? (100 * a / b).toFixed(1) + " percentage points" : "0.0 percentage points";
    const total = obj => Object.values(obj).reduce((n, x) => n + Number(x || 0), 0);
    const fullName = c => `${partyNames[c.party] || c.party} ${c.name}`;
    const ranked = (votes, roster) => roster.map(c => ({...c, votes: Number(votes[c.party] || 0)}))
        .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));

    async function loadHistorical() {
        if (!historicalPromise) {
            historicalPromise = fetch(historicalUrl).then(r => {
                if (!r.ok) throw new Error(`${historicalUrl}: HTTP ${r.status}`);
                return r.json();
            }).catch(error => { historicalPromise = null; throw error; });
        }
        return historicalPromise;
    }

    function sentence(roster, voteTotal, place) {
        if (!voteTotal) return `No candidate votes have been reported in ${place}.`;
        const [first, second] = roster;
        if (!second) return `${fullName(first)} has ${number(first.votes)} votes (${percentage(first.votes, voteTotal)}) in ${place}; no other candidate is listed.`;
        if (first.votes === second.votes) {
            return `${fullName(first)} and ${fullName(second)} are tied in ${place} with ${number(first.votes)} votes (${percentage(first.votes, voteTotal)}) apiece.`;
        }
        return `${fullName(first)} leads ${fullName(second)} in ${place}, ${number(first.votes)} votes (${percentage(first.votes, voteTotal)}) to ${number(second.votes)} votes (${percentage(second.votes, voteTotal)}), a margin of ${number(first.votes - second.votes)} votes (${points(first.votes - second.votes, voteTotal)}).`;
    }

    function validateElection(past, year, office) {
        const record = past.elections.find(e => Number(e.election_year) === year && e.office === office);
        if (!record || !Array.isArray(record.county_totals)) throw new Error(`Missing ${year} ${office} county context`);
        const countyMap = new Map(record.county_totals.map(c => [Number(c.county_code), c]));
        if (countyMap.size !== codes.length || !codes.every(c => countyMap.has(c))) {
            throw new Error(`${year} ${office}: county history does not cover exactly Bucks, Montgomery and Lehigh`);
        }
        for (const code of codes) {
            const list = countyMap.get(code).candidates;
            if (!Array.isArray(list) || list.length < 2 || list.some(c => !Number.isInteger(Number(c.votes)) || Number(c.votes) < 0)) {
                throw new Error(`${year} ${office}: incomplete county candidate totals for ${names[code]}`);
            }
        }
        return {record, countyMap};
    }

    function countyHistorySentence(countyMap, code, year) {
        const candidates = [...countyMap.get(code).candidates].sort((a, b) => Number(b.votes) - Number(a.votes));
        const voteTotal = candidates.reduce((n, c) => n + Number(c.votes), 0);
        if (!voteTotal) throw new Error(`${year} ${names[code]} history has no votes`);
        const [a, b] = candidates;
        if (Number(a.votes) === Number(b.votes)) return `${a.name} and ${b.name} tied in ${names[code]} County at ${percentage(Number(a.votes), voteTotal)} each.`;
        return `${a.name} carried ${names[code]} County with ${percentage(Number(a.votes), voteTotal)} of the vote, compared with ${percentage(Number(b.votes), voteTotal)} for ${b.name}.`;
    }

    function build(race, history, layerByKey, past) {
        if (race.race_id !== "governor" || race.office !== "GOV" || Number(history.year) !== 2022) {
            throw new Error("Expected simulated 2026 governor and 2022 governor historical summary");
        }
        if (!Array.isArray(race.precincts) || !Array.isArray(race.candidate_roster) || race.candidate_roster.length < 2) {
            throw new Error("Missing governor precincts or candidate roster");
        }
        const coverage = [...race.coverage_counties].map(Number).sort((a, b) => a - b);
        if (coverage.join(",") !== "9,39,46") throw new Error("Governor dashboard county coverage changed");
        const {record: gov2022, countyMap: govCounties} = validateElection(past, 2022, "Governor");
        const {countyMap: presidentCounties} = validateElection(past, 2024, "President");
        const statewide = new Map(gov2022.statewide_candidates.map(c => [`${c.party}:${c.name}`, Number(c.votes)]));
        const namedHistory = history.candidates.filter(c => Number(c.votes) > 0);
        if (statewide.size !== namedHistory.length) throw new Error("2022 statewide candidate rosters disagree");
        for (const candidate of namedHistory) {
            const key = `${candidate.party}:${candidate.name}`;
            if (!statewide.has(key) || statewide.get(key) !== Number(candidate.votes)) {
                throw new Error(`2022 historical totals disagree for ${key}`);
            }
        }

        const roster = race.candidate_roster;
        const countyResults = new Map(codes.map(code => [code, {
            reported: 0, mapped: 0, votes: Object.fromEntries(roster.map(c => [c.party, 0]))
        }]));
        const allVotes = Object.fromEntries(roster.map(c => [c.party, 0]));
        const used = new Set();
        const leaders = new Map();
        const closest = [];
        let reported = 0, counted = 0, tied = 0;
        for (const p of race.precincts) {
            const code = Number(p.county_code);
            const county = countyResults.get(code);
            if (!county) throw new Error(`Unexpected governor county ${code}`);
            const key = `${code}:${p.map_id}`;
            if (used.has(key) || !layerByKey.has(key)) throw new Error(`Missing or duplicate mapped precinct ${key}`);
            used.add(key);
            county.mapped++;
            if (!p.reported) continue;
            county.reported++;
            reported++;
            const votes = {};
            for (const candidate of roster) {
                const v = Number((p.votes || {})[candidate.party] || 0);
                if (!Number.isInteger(v) || v < 0) throw new Error(`Invalid ${candidate.party} votes for ${key}`);
                allVotes[candidate.party] += v;
                county.votes[candidate.party] += v;
                votes[candidate.party] = v;
            }
            const n = total(votes);
            if (!n) continue;
            counted++;
            const [a, b] = ranked(votes, roster);
            if (a.votes === b.votes) tied++;
            else leaders.set(a.name, (leaders.get(a.name) || 0) + 1);
            if (n >= 100) {
                const name = String(layerByKey.get(key).feature.properties.precinct_name || key);
                closest.push({key, name, county: names[code], a, b, difference: a.votes - b.votes,
                    fraction: (a.votes - b.votes) / n});
            }
        }
        if (used.size !== Number(race.total_mapped_precincts) || reported !== Number(race.reporting_precincts)) {
            throw new Error("Governor mapped/reporting totals do not reconcile");
        }
        const scope = "Bucks, Montgomery and Lehigh counties (not statewide)";
        const current = `With ${number(reported)} of ${number(used.size)} mapped precincts reporting (${percentage(reported, used.size)}), ${sentence(ranked(allVotes, roster), total(allVotes), scope)}`;
        const sections = [{id: "current", title: "Tonight's results: Three-county coverage", text: current}];
        for (const code of codes) {
            const c = countyResults.get(code);
            sections.push({id: `county-${code}`, title: `${names[code]} County: Tonight's results`,
                text: `With ${number(c.reported)} of ${number(c.mapped)} mapped precincts reporting (${percentage(c.reported, c.mapped)}), ${sentence(ranked(c.votes, roster), total(c.votes), names[code] + " County")}`});
        }

        const rankedHistory = [...history.candidates].sort((a, b) => Number(b.votes) - Number(a.votes));
        const [prevWinner, prevRunner] = rankedHistory;
        const stateTotal = rankedHistory.reduce((n, c) => n + Number(c.votes), 0);
        if (!stateTotal || !prevRunner) throw new Error("Incomplete 2022 statewide governor history");
        let historyText = `Statewide in 2022, ${fullName(prevWinner)} defeated ${fullName(prevRunner)}, ${number(prevWinner.votes)} votes (${percentage(prevWinner.votes, stateTotal)}) to ${number(prevRunner.votes)} votes (${percentage(prevRunner.votes, stateTotal)}).`;
        historyText += " " + codes.map(code => countyHistorySentence(govCounties, code, 2022)).join(" ");
        sections.push({id: "history-governor", title: "2022 governor election", text: historyText});
        const presidentText = `In the 2024 presidential election, ` +
            codes.map(code => countyHistorySentence(presidentCounties, code, 2024)).join(" ");
        // Separate 2024 context from 2022. Do not compare partial 2026 votes to either election.
        sections.push({id: "history-president", title: "2024 presidential election", text: presidentText});

        let precinctText;
        if (!counted) {
            precinctText = "No precincts have reported candidate votes yet.";
        } else {
            const breakdown = [...leaders.entries()].sort((a, b) => b[1] - a[1])
                .map(([name, count]) => `${name} leads in ${number(count)}`);
            if (tied) breakdown.push(`${number(tied)} ${tied === 1 ? "is" : "are"} tied`);
            precinctText = breakdown.length
                ? `Of the ${number(counted)} mapped precincts with reported votes, ${breakdown.join(", ")}.`
                : `All ${number(counted)} mapped precincts with reported votes are tied.`;
            if (closest.length) {
                closest.sort((a, b) => a.fraction - b.fraction || a.key.localeCompare(b.key));
                const p = closest[0];
                if (!p.difference) precinctText += ` In ${p.name} (${p.county} County), the top candidates are tied at ${number(p.a.votes)} votes each.`;
                else precinctText += ` The closest precinct with at least 100 votes counted is ${p.name} (${p.county} County), where ${p.a.name} leads ${p.b.name} by ${number(p.difference)} ${p.difference === 1 ? "vote" : "votes"}, ${number(p.a.votes)} to ${number(p.b.votes)}.`;
            }
        }
        const remaining = used.size - reported;
        precinctText += remaining === 1 ? " One mapped precinct has not reported results." : ` Another ${number(remaining)} mapped precincts have not reported results.`;
        sections.push({id: "precincts", title: "Precinct observations", text: precinctText});
        return {race_id: "governor", simulated: true, sections};
    }

    async function generate(race, history, layerByKey) {
        return build(race, history, layerByKey, await loadHistorical());
    }
    // Reuse the PA-01 briefing renderer and copy behavior for a consistent panel.
    const render = (container, briefing) => window.BeaconPa01Briefing.render(container, briefing);
    const copyText = briefing => window.BeaconPa01Briefing.copyText(briefing);
    return {build, generate, render, copyText};
})();
