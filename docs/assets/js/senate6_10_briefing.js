"use strict";

// Separate Bucks-only Senate District 6/10 briefing, using existing mock votes
// and separately checked official 2022/2024 district-history aggregates.
window.BeaconSenateBucksBriefing = (() => {
    const url = "data/results/senate6_10_history.json";
    const partyNames = {DEM: "Democrat", REP: "Republican", IND: "Independent", LIB: "Libertarian", GRN: "Green"};
    let cache = null;
    const number = n => Number(n).toLocaleString("en-US");
    const percent = (n, d) => d ? `${(100*n/d).toFixed(1)}%` : "0.0%";
    const points = (n, d) => d ? `${(100*n/d).toFixed(1)} percentage points` : "0.0 percentage points";
    const fullname = c => `${partyNames[c.party] || c.party} ${c.name}`;
    const totalVotes = o => Object.values(o).reduce((s, v) => s + Number(v), 0);
    const ranked = (votes, roster) => roster.map(c => ({...c, votes: Number(votes[c.party] || 0)}))
        .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
    const niceName = str => String(str).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
        .replace(/\b0+(\d+)\b/g, (_, n) => String(Number(n)))
        .replace(/\bDist\b/g, "District");

    function getHistory() {
        if (!cache) cache = fetch(url).then(r => {
            if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
            return r.json();
        }).catch(e => { cache = null; throw e; });
        return cache;
    }

    function verifyPast(past, district, history) {
        const record = past && past.districts && past.districts[String(district)];
        if (!record || Number(record.district) !== district || Number(record.county_code) !== 9 ||
                !Array.isArray(record.elections) || record.elections.length !== 2) {
            throw new Error(`Senate ${district} district history missing or has unexpected geographic scope`);
        }
        const getElection = (year, office) => {
            const e = record.elections.find(x => x.election_year === year && x.office === office);
            if (!e || !Array.isArray(e.candidates) || e.candidates.length < 2) throw new Error(`Senate ${district}: incomplete ${year} ${office} history`);
            const parties = new Set();
            for (const c of e.candidates) {
                if (!c.name || !c.party || !Number.isSafeInteger(Number(c.votes)) || Number(c.votes) <= 0) throw new Error(`Senate ${district}: invalid ${year} candidate`);
                if ((c.party === "DEM" || c.party === "REP") && parties.has(c.party)) throw new Error(`Senate ${district}: duplicate ${year} party`);
                parties.add(c.party);
            }
            if (!parties.has("DEM") || !parties.has("REP")) throw new Error(`Senate ${district}: missing major-party ${year} candidate`);
            return e;
        };
        const senate = getElection(2022, "State Senate");
        const president = getElection(2024, "President");
        const prior = [...history.candidates].filter(c => Number(c.votes) > 0)
            .map(c => `${c.party}|${String(c.name).toLowerCase()}|${Number(c.votes)}`).sort();
        const checked = senate.candidates.map(c => `${c.party}|${c.name.toLowerCase()}|${Number(c.votes)}`).sort();
        if (JSON.stringify(prior) !== JSON.stringify(checked)) {
            throw new Error(`Senate ${district}: 2022 official vote totals disagree with historical summary`);
        }
        return {senate, president};
    }

    function liveSummary(roster, all, label) {
        const n = totalVotes(all), [a, b] = ranked(all, roster);
        if (!n) return `No candidate votes have been reported in ${label}.`;
        if (!b) return `${fullname(a)} has ${number(a.votes)} votes (${percent(a.votes,n)}) in ${label}; no opposing candidate is listed.`;
        if (a.votes === b.votes) return `${fullname(a)} and ${fullname(b)} are tied in ${label} with ${number(a.votes)} votes (${percent(a.votes,n)}) apiece.`;
        const margin = a.votes - b.votes;
        return `${fullname(a)} leads ${fullname(b)} in ${label}, ${number(a.votes)} votes (${percent(a.votes,n)}) to ${number(b.votes)} votes (${percent(b.votes,n)}), a margin of ${number(margin)} ${margin === 1 ? "vote" : "votes"} (${points(margin,n)}).`;
    }

    function pastSummary(list, label, asPresidential = false) {
        const ordered = [...list].map(c => ({...c, votes: Number(c.votes)})).sort((a,b) => b.votes-a.votes);
        const [a,b] = ordered;
        const n = ordered.reduce((s,c) => s+c.votes, 0);
        if (!a || !b || !n) throw new Error(`Insufficient ${label} historical votes`);
        if (asPresidential) {
            const first = a.votes === b.votes ? "received the same share" : "received the most votes";
            return `${a.name} ${first} in precincts assigned to ${label}, with ${number(a.votes)} votes (${percent(a.votes,n)}), compared with ${number(b.votes)} votes (${percent(b.votes,n)}) for ${b.name}.`;
        }
        if (a.votes === b.votes) return `${fullname(a)} and ${fullname(b)} tied in ${label} with ${number(a.votes)} votes apiece (${percent(a.votes,n)}).`;
        const margin = a.votes - b.votes;
        return `${fullname(a)} defeated ${fullname(b)} in ${label}, ${number(a.votes)} votes (${percent(a.votes,n)}) to ${number(b.votes)} votes (${percent(b.votes,n)}), a margin of ${number(margin)} ${margin === 1 ? "vote" : "votes"} (${points(margin,n)}).`;
    }

    function build(race, history, layerByKey, past) {
        const district = Number(race.district);
        if (![6,10].includes(district) || race.race_id !== `senate_${district}` || race.office !== "STS" ||
                Number(history.year) !== 2022) throw new Error("Expected mock 2026 Bucks Senate 6 or 10 and 2022 history");
        if (!Array.isArray(race.candidate_roster) || race.candidate_roster.length < 2 ||
                !Array.isArray(race.precincts) || race.coverage_counties.map(Number).join(",") !== "9") {
            throw new Error(`Senate ${district}: invalid precinct or candidate coverage`);
        }
        const {senate, president} = verifyPast(past, district, history);
        const roster = race.candidate_roster;
        if (new Set(roster.map(c => c.party)).size !== roster.length) throw new Error("Candidate roster contains duplicate parties");
        const votes = Object.fromEntries(roster.map(c => [c.party, 0]));
        const winningPrecincts = new Map();
        const used = new Set();
        const close = [];
        let reporting = 0, counted = 0, ties = 0;
        for (const p of race.precincts) {
            if (Number(p.county_code) !== 9) throw new Error(`Senate ${district}: mapped area outside Bucks County`);
            const key = `9:${p.map_id}`;
            if (used.has(key) || !layerByKey.has(key)) throw new Error(`Senate ${district}: duplicate or missing geometry for ${key}`);
            used.add(key);
            if (!p.reported) continue;
            reporting++;
            const local = {};
            for (const c of roster) {
                const v = Number((p.votes || {})[c.party] || 0);
                if (!Number.isSafeInteger(v) || v < 0) throw new Error(`Senate ${district}: invalid ${key} votes for ${c.party}`);
                votes[c.party] += v;
                local[c.party] = v;
            }
            const n = totalVotes(local);
            if (!n) continue;
            counted++;
            const [a,b] = ranked(local, roster);
            if (a.votes === b.votes) ties++;
            else winningPrecincts.set(a.name, (winningPrecincts.get(a.name) || 0) + 1);
            if (n >= 100 && b) close.push({key, name: niceName(layerByKey.get(key).feature.properties.precinct_name || key),
                a,b, margin: a.votes-b.votes, fraction: (a.votes-b.votes)/n});
        }
        if (used.size !== Number(race.total_mapped_precincts) || reporting !== Number(race.reporting_precincts)) {
            throw new Error(`Senate ${district}: mapped or reporting precinct totals disagree`);
        }
        const label = `Pennsylvania Senate District ${district}`;
        const sections = [
            {id: "current", title: "Tonight's results", text:
                `With ${number(reporting)} of ${number(used.size)} mapped precincts reporting (${percent(reporting,used.size)}), ` + liveSummary(roster, votes, label)},
            {id: "senate-2022", title: "2022 Senate election", text:
                `In the 2022 election, ${pastSummary(senate.candidates, label)}${history.matching_2024_precinct_scope === false ? " The district's historical precinct coverage differs from its 2024 precinct map." : ""}`},
            {id: "president-2024", title: `2024 presidential election within District ${district}`, text:
                `In the 2024 presidential election, ${pastSummary(president.candidates, label, true)}`},
        ];
        let precinctText;
        if (!counted) {
            precinctText = "No precincts have reported candidate votes yet.";
        } else {
            const leading = [...winningPrecincts.entries()].sort((a,b) => b[1]-a[1])
                .map(([name,n]) => `${name} leads in ${number(n)}`);
            if (ties) leading.push(`${number(ties)} ${ties === 1 ? "precinct is" : "precincts are"} tied`);
            precinctText = `Of the ${number(counted)} precincts with reported votes, ${leading.join("; ")}.`;
            if (close.length) {
                close.sort((a,b) => a.fraction - b.fraction || a.key.localeCompare(b.key));
                const p = close[0];
                precinctText += p.margin === 0
                    ? ` The closest reported precinct with at least 100 votes counted is ${p.name} (Bucks County), where the candidates are tied at ${number(p.a.votes)} votes apiece.`
                    : ` The closest reported precinct with at least 100 votes counted is ${p.name} (Bucks County), where ${p.a.name} leads ${p.b.name} by ${number(p.margin)} ${p.margin === 1 ? "vote" : "votes"}, ${number(p.a.votes)} to ${number(p.b.votes)}.`;
            }
        }
        const pending = used.size - reporting;
        if (pending) precinctText += ` ${number(pending)} mapped ${pending === 1 ? "precinct has" : "precincts have"} not reported results.`;
        sections.push({id: "precincts", title: "Precinct observations", text: precinctText});
        return {race_id: race.race_id, simulated: true, sections};
    }

    const generate = async (race, history, layerByKey) => build(race, history, layerByKey, await getHistory());
    const render = (container, briefing) => window.BeaconPa01Briefing.render(container, briefing);
    const copyText = briefing => window.BeaconPa01Briefing.copyText(briefing);
    return {build, generate, render, copyText};
})();
