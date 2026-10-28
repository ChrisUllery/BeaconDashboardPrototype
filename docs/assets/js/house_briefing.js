"use strict";

// Detailed prototype reports for the 10 Bucks County House races.
window.BeaconHouseBriefing = (() => {
    const historyUrl = "data/results/house_history_2024.json";
    const districts = new Set([18, 29, 31, 140, 141, 142, 143, 144, 145, 178]);
    const partyNames = {DEM: "Democrat", REP: "Republican", IND: "Independent", LIB: "Libertarian", FWD: "Forward Party", GRN: "Green"};
    const number = n => Number(n).toLocaleString("en-US");
    const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : "0.0%";
    const pp = (n, d) => `${(100 * n / d).toFixed(1)} percentage points`;
    const partyName = c => `${partyNames[c.party] || c.party} ${c.name}`;
    const count = obj => Object.values(obj).reduce((s, v) => s + Number(v), 0);
    const ordered = (votes, roster) => roster.map(c => ({...c, votes: Number(votes[c.party] || 0)}))
        .sort((a,b) => b.votes-a.votes || a.name.localeCompare(b.name));
    const niceName = str => String(str).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
        .replace(/\b0+(\d+)\b/g, (_, n) => String(Number(n)))
        .replace(/\bDist\b/g, "District");
    let cache = null;

    function loadHistory() {
        if (!cache) cache = fetch(historyUrl).then(r => {
            if (!r.ok) throw new Error(`${historyUrl}: HTTP ${r.status}`);
            return r.json();
        }).catch(error => { cache = null; throw error; });
        return cache;
    }

    function validCandidates(list, label) {
        if (!Array.isArray(list) || !list.length) throw new Error(`${label}: no named candidates`);
        const ids = new Set();
        for (const c of list) {
            if (!c.name || !c.party || !Number.isSafeInteger(Number(c.votes)) || Number(c.votes) <= 0)
                throw new Error(`${label}: invalid candidate or votes`);
            const id = `${c.party}|${c.name}`;
            if (ids.has(id)) throw new Error(`${label}: duplicate historical candidate`);
            ids.add(id);
        }
    }

    function checkedHistory(past, district, old) {
        const record = past && past.districts && past.districts[String(district)];
        if (!record || Number(record.district) !== district || Number(record.county_code) !== 9 ||
                !Array.isArray(record.elections) || record.elections.length !== 2) {
            throw new Error(`House ${district}: historical results missing or wrong county`);
        }
        const get = office => {
            const election = record.elections.find(e => Number(e.election_year) === 2024 && e.office === office);
            if (!election) throw new Error(`House ${district}: missing 2024 ${office} election`);
            validCandidates(election.candidates, `${district} ${office}`);
            return election;
        };
        const house = get("State House");
        const president = get("President");
        const normalize = list => list.filter(c => Number(c.votes) > 0)
            .map(c => `${c.party}|${c.name.toLowerCase()}|${Number(c.votes)}`).sort();
        if (JSON.stringify(normalize(house.candidates)) !== JSON.stringify(normalize(old.candidates))) {
            throw new Error(`House ${district}: 2024 historical votes disagree with the existing summary`);
        }
        if (!president.candidates.some(c => c.party === "DEM" && c.name.toLowerCase().includes("harris")) ||
                !president.candidates.some(c => c.party === "REP" && c.name.toLowerCase().includes("trump"))) {
            throw new Error(`House ${district}: cannot confirm major presidential candidates`);
        }
        return {house, president};
    }

    function currentSummary(roster, votes, label) {
        const total = count(votes);
        const list = ordered(votes, roster);
        if (!total) return `No candidate votes have been reported in ${label}.`;
        if (list.length === 1) {
            const a = list[0];
            return `${partyName(a)} has received ${number(a.votes)} reported votes in ${label}. No opposing candidate is listed in the prototype ballot.`;
        }
        const [a, b] = list;
        const other = list.slice(2).filter(c => c.votes > 0);
        let text;
        if (a.votes === b.votes) {
            text = `${partyName(a)} and ${partyName(b)} are tied in ${label} with ${number(a.votes)} votes (${pct(a.votes,total)}) apiece`;
        } else {
            const margin = a.votes - b.votes;
            text = `${partyName(a)} leads ${partyName(b)} in ${label}, ${number(a.votes)} votes (${pct(a.votes,total)}) to ${number(b.votes)} votes (${pct(b.votes,total)}), a margin of ${number(margin)} ${margin === 1 ? "vote" : "votes"} (${pp(margin,total)})`;
        }
        if (other.length) text += `. ${other.map(c => `${partyName(c)} has ${number(c.votes)} votes (${pct(c.votes,total)})`).join("; ")}`;
        return text + ".";
    }

    function pastHouse(candidates, label) {
        const sorted = [...candidates].sort((a,b) => b.votes - a.votes);
        const total = sorted.reduce((s,c) => s + Number(c.votes), 0);
        const [a,b] = sorted;
        if (!b) {
            return `In the 2024 election, ${partyName(a)} was the only named candidate in the available ${label} returns, receiving ${number(a.votes)} votes. Write-in votes are excluded from this historical breakdown.`;
        }
        const difference = a.votes - b.votes;
        let sentence = a.votes === b.votes
            ? `In the 2024 election, ${partyName(a)} and ${partyName(b)} received ${number(a.votes)} votes apiece in ${label}`
            : `In the 2024 election, ${partyName(a)} defeated ${partyName(b)} in ${label}, ${number(a.votes)} votes (${pct(a.votes,total)}) to ${number(b.votes)} votes (${pct(b.votes,total)}), a margin of ${number(difference)} ${difference === 1 ? "vote" : "votes"} (${pp(difference,total)})`;
        const other = sorted.slice(2);
        if (other.length) sentence += `. Other named candidates received ${other.map(c => `${number(c.votes)} votes for ${c.name} (${pct(c.votes,total)})`).join("; ")}`;
        return sentence + ".";
    }

    function pastPresident(candidates, district) {
        const sorted = [...candidates].sort((a,b) => b.votes-a.votes);
        const total = sorted.reduce((s,c) => s+Number(c.votes), 0);
        const [a,b] = sorted;
        if (!b || !total) throw new Error(`House ${district}: insufficient presidential history`);
        const lead = a.votes === b.votes ? "received the same number of votes" : "received the most votes";
        return `In the 2024 presidential election, ${a.name} ${lead} in precincts assigned to Pennsylvania House District ${district}, with ${number(a.votes)} votes (${pct(a.votes,total)}), compared with ${number(b.votes)} votes (${pct(b.votes,total)}) for ${b.name}.`;
    }

    function build(race, history, layerByKey, past) {
        const district = Number(race.district);
        if (!districts.has(district) || race.race_id !== `house_${district}` || race.office !== "STH" ||
                Number(history.year) !== 2024 || !Array.isArray(race.precincts) ||
                !Array.isArray(race.candidate_roster) || !race.candidate_roster.length ||
                !Array.isArray(race.coverage_counties) || race.coverage_counties.map(Number).join(",") !== "9") {
            throw new Error("Unexpected House race, county, or history");
        }
        const {house, president} = checkedHistory(past, district, history);
        const roster = race.candidate_roster;
        if (new Set(roster.map(c => c.party)).size !== roster.length) throw new Error(`House ${district}: duplicate parties in current roster`);
        const totals = Object.fromEntries(roster.map(c => [c.party, 0]));
        const leaders = new Map();
        const close = [];
        const used = new Set();
        let reporting = 0, counted = 0, ties = 0;
        for (const p of race.precincts) {
            const key = `${p.county_code}:${p.map_id}`;
            if (Number(p.county_code) !== 9 || used.has(key) || !layerByKey.has(key)) {
                throw new Error(`House ${district}: duplicate, missing, or non-Bucks precinct: ${key}`);
            }
            used.add(key);
            if (!p.reported) continue;
            reporting++;
            const votes = {};
            for (const c of roster) {
                const value = Number((p.votes || {})[c.party] || 0);
                if (!Number.isSafeInteger(value) || value < 0) throw new Error(`House ${district}: invalid votes in ${key}`);
                votes[c.party] = value;
                totals[c.party] += value;
            }
            const n = count(votes);
            if (!n) continue;
            counted++;
            if (roster.length < 2) continue; // An uncontested race has no precinct 'winner' comparison.
            const [a,b] = ordered(votes, roster);
            if (a.votes === b.votes) ties++;
            else leaders.set(a.name, (leaders.get(a.name) || 0) + 1);
            if (n >= 100) close.push({key, name: niceName(layerByKey.get(key).feature.properties.precinct_name || key),
                a, b, margin: a.votes - b.votes, fraction: (a.votes-b.votes)/n});
        }
        if (used.size !== Number(race.total_mapped_precincts) || reporting !== Number(race.reporting_precincts)) {
            throw new Error(`House ${district}: precinct count mismatch`);
        }
        const label = `Pennsylvania House District ${district}`;
        const sections = [
            {id: "current", title: "Tonight's results", text:
                `With ${number(reporting)} of ${number(used.size)} mapped precincts reporting (${pct(reporting,used.size)}), ${currentSummary(roster,totals,label)}`},
            {id: "house-2024", title: "2024 House election", text:
                pastHouse(house.candidates,label) + (history.matching_2024_precinct_scope === false
                    ? " The historical precinct coverage differs from the 2024 precinct map." : "")},
            {id: "president-2024", title: `2024 presidential election within District ${district}`, text:
                pastPresident(president.candidates,district)},
        ];
        let observations;
        if (!counted) {
            observations = "No precincts have reported candidate votes yet.";
        } else if (roster.length === 1) {
            observations = `${number(counted)} of the reporting precincts have recorded votes for ${roster[0].name}. No opposing candidate is listed, so precinct-level leads cannot be calculated.`;
        } else {
            const leadBits = [...leaders.entries()].sort((a,b) => b[1]-a[1]).map(([name,n]) => `${name} leads in ${number(n)}`);
            if (ties) leadBits.push(`${number(ties)} ${ties === 1 ? "precinct is" : "precincts are"} tied`);
            observations = `Of the ${number(counted)} precincts with reported votes, ${leadBits.join("; ")}.`;
            if (close.length) {
                close.sort((a,b) => a.fraction-b.fraction || a.key.localeCompare(b.key));
                const p = close[0];
                observations += p.margin === 0
                    ? ` The closest reported precinct with at least 100 votes counted is ${p.name} (Bucks County), where the top two candidates are tied at ${number(p.a.votes)} votes apiece.`
                    : ` The closest reported precinct with at least 100 votes counted is ${p.name} (Bucks County), where ${p.a.name} leads ${p.b.name} by ${number(p.margin)} ${p.margin === 1 ? "vote" : "votes"}, ${number(p.a.votes)} to ${number(p.b.votes)}.`;
            }
        }
        const remaining = used.size - reporting;
        if (remaining) observations += ` ${number(remaining)} mapped ${remaining === 1 ? "precinct has" : "precincts have"} not reported results.`;
        sections.push({id: "precincts", title: "Precinct observations", text: observations});
        return {race_id: race.race_id, simulated: true, sections};
    }

    const generate = async (race, history, layerByKey) => build(race, history, layerByKey, await loadHistory());
    const render = (container, briefing) => window.BeaconPa01Briefing.render(container, briefing);
    const copyText = briefing => window.BeaconPa01Briefing.copyText(briefing);
    return {build, generate, render, copyText};
})();
