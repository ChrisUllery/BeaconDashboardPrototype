"use strict";

// Standalone editor-facing preview of the 15 simulated 2026 race results cards.
// Uses the same results JSON as the existing map dashboard, without Leaflet.
// All language is template-based. No candidate is declared a winner based on a lead.
(() => {
    const DATA_URL = "../data/results/mock_2026_results.json";
    const HISTORY_URL = "../data/results/historical_race_summaries.json";
    // Checked historical returns for the two districts that cross county lines.
    // Only the editorial introduction uses these files; embedded cards do not.
    const HISTORICAL_COUNTY_FILES = {
        pa01: {
            url: "../data/results/pa01_2024.json",
            counties: [{code: 9, name: "Bucks"}, {code: 46, name: "Montgomery"}]
        },
        pa01_2022: {
            url: "../data/results/pa01_2022.json",
            counties: [{code: 9, name: "Bucks"}, {code: 46, name: "Montgomery"}]
        },
        senate_16: {
            url: "../data/results/senate16_county_history.json",
            counties: [{code: 9, name: "Bucks"}, {code: 39, name: "Lehigh"}]
        }
    };
    const PLACEHOLDER_URL = "../assets/images/candidate-placeholder.svg";
    // Approved, manually cropped photos. Exact race ID and candidate name are required.
    // Originals and local crop overrides are not used by the published page.
    const CANDIDATE_PHOTOS = {
        "governor": {
                "Josh Shapiro": "governor__josh-shapiro.png",
                "Stacy Garrity": "governor__stacy-garrity.png",
                "Ken Krawchuk": "governor__ken-krawchuk.png"
        },
        "pa01": {
                "Bob Harvie": "pa01__bob-harvie.png",
                "Brian Fitzpatrick": "pa01__brian-fitzpatrick.png"
        },
        "senate_6": {
                "Eileen Hartnett Albillar": "senate_6__eileen-hartnett-albillar.png",
                "Frank Farry": "senate_6__frank-farry.png"
        },
        "senate_10": {
                "Steve Santarsiero": "senate_10__steve-santarsiero.png",
                "Greg Bankos": "senate_10__greg-bankos.png"
        },
        "senate_16": {
                "Mark Pinsley": "senate_16__mark-pinsley.png",
                "Jarrett Coleman": "senate_16__jarrett-coleman.png"
        },
        "house_18": {
                "Bryan Allen": "house_18__bryan-allen.png",
                "K.C. Tomlinson": "house_18__k-c-tomlinson.png"
        },
        "house_29": {
                "Tim Brennan": "house_29__tim-brennan.png",
                "Sean Duffy": "house_29__sean-duffy.png"
        },
        "house_31": {
                "Perry Warren": "house_31__perry-warren.png"
        },
        "house_140": {
                "Jim Prokopiak": "house_140__jim-prokopiak.png",
                "Michael J. Gettis": "house_140__michael-j-gettis.png"
        },
        "house_141": {
                "Tina Davis": "house_141__tina-davis.png",
                "Ken Velez": "house_141__ken-velez.png"
        },
        "house_142": {
                "Kristin Egan": "house_142__kristin-egan.png",
                "Joe Hogan": "house_142__joe-hogan.png"
        },
        "house_143": {
                "Tim Hayes": "house_143__tim-hayes.png",
                "Shelby Labs": "house_143__shelby-labs.png",
                "Chris Gambino": "house_143__chris-gambino.png"
        },
        "house_144": {
                "Brian Munroe": "house_144__brian-munroe.png",
                "Mike Murphy": "house_144__mike-murphy.png"
        },
        "house_145": {
                "Craig Staats": "house_145__craig-staats.png",
                "Rebecca Prendergast": "house_145__rebecca-prendergast.png"
        },
        "house_178": {
                "Monica Weninger": "house_178__monica-weninger.png",
                "Kristin Marcell": "house_178__kristin-marcell.png"
        }
};
    const CHECK_INTERVAL_MS = 120000;
    const BUCKS_COUNTY_CODE = 9; // Governor card only; the main map remains regional.
    // Editor gallery: one copyable embed per race. Embedded mode loads just one card.
    const query = new URLSearchParams(window.location.search);
    const embedMode = query.get("embed") === "1";
    const embeddedRaceId = query.get("race");
    const PUBLISHED_CARDS_URL = "https://chrisullery.github.io/BeaconDashboardPrototype/results-cards/";
    const PARTIES = {
        DEM: {name: "Democrat", abbreviation: "D", color: "#4879b9"},
        REP: {name: "Republican", abbreviation: "R", color: "#be5656"},
        LIB: {name: "Libertarian", abbreviation: "L", color: "#888888"},
        IND: {name: "Independent", abbreviation: "I", color: "#18857b"},
        FWD: {name: "Forward", abbreviation: "F", color: "#18857b"},
        GRN: {name: "Green", abbreviation: "G", color: "#509450"}
    };
    // Explicit aliases for the same person in the current mock roster and
    // earlier official election returns. No fuzzy or party-only matching.
    const HISTORICAL_NAME_ALIASES = {
        governor: {"Josh Shapiro": "Joshua Shapiro"},
        senate_10: {"Steve Santarsiero": "Steven Santarsiero"},
        house_18: {"K.C. Tomlinson": "Kathleen Tomlinson"},
        house_29: {"Tim Brennan": "Timothy Brennan"},
        house_140: {"Jim Prokopiak": "James Prokopiak"},
        house_142: {"Joe Hogan": "Joseph Hogan"}
    };
    const GROUPS = [
        {office: "GOV", title: "Governor"},
        {office: "USC", title: "U.S. Congress"},
        {office: "STS", title: "Pennsylvania Senate"},
        {office: "STH", title: "Pennsylvania House"}
    ];
    // Editor-only WordPress article introduction. These are templates for Nov. 3,
    // not a claim that the prototype has actual 2026 votes. Never in iframe cards.
    const ARTICLE_OPENINGS = {
        before: [
            "It's Election Day in Pennsylvania, where voters are choosing a governor, members of Congress and state lawmakers on Tuesday, Nov. 3. Polls close at 8 p.m., after which counties will begin reporting unofficial election results.",
            "Democratic Gov. Josh Shapiro faces Republican Stacy Garrity and Libertarian Ken Krawchuk in the governor's race. In Pennsylvania's 1st Congressional District, Republican incumbent Brian Fitzpatrick faces Democrat Bob Harvie. Republican state Sen. Jarrett Coleman faces Democrat Mark Pinsley in a rematch for the 16th Senate District, which includes portions of Bucks and Lehigh counties. Voters across the region are also deciding two other Pennsylvania Senate contests and 10 Pennsylvania House races tracked by The Bucks County Beacon.",
            "The Bucks County Beacon will provide live election results and updates using returns from Bucks, Montgomery and Lehigh counties. Results will be updated as votes are counted, and some races may remain undecided on election night."
        ],
        after: [
            "Polls closed at 8 p.m. Tuesday, Nov. 3, across Pennsylvania, allowing counties to begin reporting unofficial results in races for governor, Congress and the state Legislature.",
            "Democratic Gov. Josh Shapiro faces Republican Stacy Garrity and Libertarian Ken Krawchuk in the governor's race. In Pennsylvania's 1st Congressional District, Republican incumbent Brian Fitzpatrick faces Democrat Bob Harvie. Republican state Sen. Jarrett Coleman faces Democrat Mark Pinsley in a rematch for the 16th Senate District, which includes portions of Bucks and Lehigh counties. Voters across the region are also deciding two other Pennsylvania Senate contests and 10 Pennsylvania House races tracked by The Bucks County Beacon.",
            "The Bucks County Beacon is providing live election results and updates using returns from Bucks, Montgomery and Lehigh counties. Vote totals are unofficial and may change as more ballots are counted. Some races may remain undecided on election night."
        ]
    };
    let selectedArticleOpening = "before";

    function setArticleOpening(mode) {
        if (!Object.prototype.hasOwnProperty.call(ARTICLE_OPENINGS, mode)) return;
        selectedArticleOpening = mode;
        const section = document.querySelector("#article-opening");
        if (!section) return;
        section.querySelector("#article-opening-preview").innerHTML = ARTICLE_OPENINGS[mode]
            .map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join("");
        section.querySelectorAll("[data-opening-mode]").forEach(button => {
            const selected = button.dataset.openingMode === mode;
            button.setAttribute("aria-pressed", String(selected));
            button.classList.toggle("is-selected", selected);
        });
        section.querySelector("#article-opening-feedback").textContent = "";
        section.querySelector(".article-opening__manual-copy")?.remove();
        const fullArticleFeedback = document.querySelector("#complete-article-feedback");
        if (fullArticleFeedback && !document.querySelector("#copy-complete-article")?.disabled) {
            fullArticleFeedback.textContent = "Ready: all 15 races will use the selected introduction.";
        }
        document.querySelector("#how-to-use .how-to-use__manual-code")?.remove();
    }

    async function copyArticleOpening() {
        const section = document.querySelector("#article-opening");
        if (!section) return;
        const paragraphs = ARTICLE_OPENINGS[selectedArticleOpening];
        const plain = paragraphs.join("\n\n");
        const rich = paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join("");
        const feedback = section.querySelector("#article-opening-feedback");
        try {
            if (window.ClipboardItem && navigator.clipboard?.write) {
                await navigator.clipboard.write([new ClipboardItem({
                    "text/html": new Blob([rich], {type: "text/html"}),
                    "text/plain": new Blob([plain], {type: "text/plain"})
                })]);
                feedback.textContent = "Introduction copied with paragraph formatting.";
            } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(plain);
                feedback.textContent = "Introduction copied as plain text.";
            } else {
                throw new Error("Clipboard unavailable");
            }
        } catch (error) {
            section.querySelector(".article-opening__manual-copy")?.remove();
            const area = document.createElement("textarea");
            area.className = "article-opening__manual-copy";
            area.readOnly = true;
            area.setAttribute("aria-label", "Article introduction to copy manually");
            area.value = plain;
            section.appendChild(area);
            area.focus();
            area.select();
            feedback.textContent = "Select and copy the text shown below.";
        }
    }

    const number = value => Number(value).toLocaleString("en-US");
    const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
    const share = (votes, total) => total > 0 ? (votes * 100 / total).toFixed(1) + "%" : "0.0%";
    const roundedPercent = (votes, total) => total > 0 ? Math.round(votes * 100 / total) : 0;
    const partyName = code => PARTIES[code]?.name || code;
    const fullName = candidate => `${partyName(candidate.party)} ${candidate.name}`;

    function ordinal(value) {
        const n = Number(value);
        const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th"
            : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
        return `${n}${suffix}`;
    }

    function titleFor(race) {
        if (race.office === "GOV") return "Pennsylvania Governor";
        if (race.office === "USC") return `Pennsylvania's ${ordinal(race.district)} Congressional District`;
        if (race.office === "STS") return `Pennsylvania Senate District ${race.district}`;
        if (race.office === "STH") return `Pennsylvania House District ${race.district}`;
        return race.race_id;
    }

    function summarizeRace(race) {
        if (!Array.isArray(race.candidate_roster) || race.candidate_roster.length < 1 || !Array.isArray(race.precincts)) {
            throw new Error(`Invalid candidate or precinct data for ${race.race_id}`);
        }
        if (race.precincts.length !== race.total_mapped_precincts) {
            throw new Error(`Precinct count mismatch for ${race.race_id}`);
        }
        // The governor card is Bucks County only. All other races use their full
        // tracked district. Keep the original governor map/JSON untouched.
        const precincts = race.office === "GOV"
            ? race.precincts.filter(p => Number(p.county_code) === BUCKS_COUNTY_CODE)
            : race.precincts;
        if (!precincts.length) throw new Error(`No voting precincts in selected scope: ${race.race_id}`);
        const totals = new Map();
        race.candidate_roster.forEach(candidate => {
            if (totals.has(candidate.party)) throw new Error(`Duplicate party for ${race.race_id}: ${candidate.party}`);
            totals.set(candidate.party, 0);
        });
        let reported = 0;
        for (const precinct of precincts) {
            if (!precinct.reported) continue;
            reported += 1;
            for (const [party, value] of Object.entries(precinct.votes || {})) {
                if (!totals.has(party) || !Number.isSafeInteger(value) || value < 0) {
                    throw new Error(`Invalid candidate votes in ${race.race_id}`);
                }
                totals.set(party, totals.get(party) + value);
            }
        }
        const candidates = race.candidate_roster.map((candidate, index) => ({
            name: candidate.name,
            party: candidate.party,
            votes: totals.get(candidate.party),
            sourceOrder: index
        }));
        // Original roster order is the deterministic tiebreaker; ties are still described as ties.
        candidates.sort((a, b) => b.votes - a.votes || a.sourceOrder - b.sourceOrder);
        const totalVotes = candidates.reduce((sum, candidate) => sum + candidate.votes, 0);
        return {candidates, reported, precinctCount: precincts.length, totalVotes};
    }

    function missingChallenger(candidate) {
        if (candidate.party === "DEM") return {name: "No Republican challenger", party: "REP"};
        if (candidate.party === "REP") return {name: "No Democratic challenger", party: "DEM"};
        return {name: "No major-party challenger", party: "OTHER"};
    }

    function candidateMarkup(candidate, totalVotes, raceId, vacant = false) {
        const info = PARTIES[candidate.party] || {name: candidate.party, abbreviation: candidate.party, color: "#8d98a3"};
        const filename = vacant ? null : CANDIDATE_PHOTOS[raceId]?.[candidate.name];
        const imageUrl = filename ? `../assets/images/candidates/${filename}` : PLACEHOLDER_URL;
        const photoAlt = vacant ? "" : filename ? `Portrait of ${candidate.name}` : "Generic candidate silhouette";
        const label = vacant ? candidate.name : `${candidate.name} (${info.abbreviation})`;
        const image = `<span class="candidate-row__avatar"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(photoAlt)}" width="90" height="90" loading="lazy" decoding="async"></span>`;
        return `<div class="candidate-row${vacant ? " candidate-row--vacant" : ""}">
            <div class="candidate-row__person" style="--party-color:${info.color}">
                <div class="candidate-row__portrait">${image}</div>
                <div class="candidate-row__name">${escapeHtml(label)}</div>
            </div>
            <div class="candidate-row__percentage">${vacant ? "—" : share(candidate.votes, totalVotes)}</div>
            <div class="candidate-row__votes">${vacant ? "—" : number(candidate.votes)}</div>
        </div>`;
    }

    function resultsSentence(race, data) {
        const {candidates, reported, precinctCount, totalVotes} = data;
        const where = race.office === "GOV" ? "the governor's race in Bucks County" : titleFor(race);
        const start = `With ${roundedPercent(reported, precinctCount)}% of voting precincts reporting in, `;
        const ending = reported < precinctCount
            ? "Ballots are still being tallied."
            : "All voting precincts have reported.";
        if (!totalVotes) return `No candidate votes have been reported yet in ${where}. ${roundedPercent(reported, precinctCount)}% of voting precincts are reporting.`;
        if (candidates.length === 1) {
            const only = candidates[0];
            const opponent = missingChallenger(only);
            return `${start}${fullName(only)} has received ${number(only.votes)} votes in ${where} with ${opponent.name.toLowerCase()}. ${ending}`;
        }
        const [first, second] = candidates;
        if (first.votes === second.votes) {
            return `${start}${fullName(first)} and ${fullName(second)} are tied for the lead in ${where}, each with ${roundedPercent(first.votes, totalVotes)}% of ${number(totalVotes)} votes. ${ending}`;
        }
        return `${start}${fullName(first)} leads ${fullName(second)} in ${where} in a ${roundedPercent(first.votes, totalVotes)}-${roundedPercent(second.votes, totalVotes)} split of ${number(totalVotes)} votes. ${ending}`;
    }

    // These two races cross county lines. Provide an additional paragraph
    // summarizing only the voting precincts belonging to each district.
    // Keep the governor and all other races unchanged.
    const COUNTY_BREAKDOWN_RACES = {
        pa01: [
            {code: 9, name: "Bucks"},
            {code: 46, name: "Montgomery"}
        ],
        senate_16: [
            {code: 9, name: "Bucks"},
            {code: 39, name: "Lehigh"}
        ]
    };

    function countyBreakdownSentence(race, county) {
        const precincts = race.precincts.filter(p => Number(p.county_code) === county.code);
        if (!precincts.length) throw new Error(`Missing ${county.name} district precincts for ${race.race_id}`);
        // Reuse the same tallying and validation as the full-race card.
        const data = summarizeRace({...race, precincts, total_mapped_precincts: precincts.length});
        const place = `the ${county.name} County portion of the district`;
        const reportedPercent = roundedPercent(data.reported, data.precinctCount);
        if (!data.totalVotes) {
            return `No candidate votes have been reported in ${place}; ${reportedPercent}% of voting precincts are reporting.`;
        }
        const [first, second] = data.candidates;
        if (!second) {
            return `In ${place}, ${familyName(first.name)} has received ${number(first.votes)} votes, with ${reportedPercent}% of voting precincts reporting.`;
        }
        if (first.votes === second.votes) {
            return `In ${place}, ${familyName(first.name)} and ${familyName(second.name)} are tied with ${number(first.votes)} votes each, with ${reportedPercent}% of voting precincts reporting.`;
        }
        return `In ${place}, ${familyName(first.name)} leads ${familyName(second.name)} in a ${roundedPercent(first.votes, data.totalVotes)}-${roundedPercent(second.votes, data.totalVotes)} split of ${number(data.totalVotes)} votes, with ${reportedPercent}% of voting precincts reporting.`;
    }

    function countyBreakdownParagraph(race) {
        const counties = COUNTY_BREAKDOWN_RACES[race.race_id];
        return counties ? counties.map(county => countyBreakdownSentence(race, county)).join(" ") : null;
    }

    function matchPastCandidate(candidate, history, raceId) {
        const alias = HISTORICAL_NAME_ALIASES[raceId]?.[candidate.name] || candidate.name;
        const normalize = name => String(name).toLowerCase().replace(/[^a-z0-9]/g, "");
        return (history.candidates || []).find(past =>
            past.party === candidate.party && normalize(past.name) === normalize(alias)) || null;
    }

    // Names in the 2026 roster and historical exports are not always identical.
    // matchPastCandidate uses explicit, race-specific aliases before comparison.
    // A surname is used ONLY when that person was already named in the first
    // sentence. Keep complete first references for historical-only opponents.
    const FAMILY_NAME_EXCEPTIONS = {
        "Eileen Hartnett Albillar": "Hartnett Albillar"
    };
    function familyName(name) {
        if (FAMILY_NAME_EXCEPTIONS[name]) return FAMILY_NAME_EXCEPTIONS[name];
        const parts = String(name).trim().split(/\s+/);
        const suffixes = new Set(["Jr.", "Jr", "Sr.", "Sr", "II", "III", "IV", "V"]);
        let position = parts.length - 1;
        while (position > 0 && suffixes.has(parts[position])) position--;
        return parts[position];
    }
    function historicalPersonReference(pastCandidate, race, history) {
        const previouslyNamed = race.candidate_roster.find(candidate =>
            matchPastCandidate(candidate, history, race.race_id) === pastCandidate);
        return previouslyNamed ? familyName(previouslyNamed.name) : fullName(pastCandidate);
    }

    function listInProse(items) {
        if (items.length < 2) return items.join("");
        if (items.length === 2) return `${items[0]} and ${items[1]}`;
        return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
    }

    // Historical county context for PA-01 and Senate District 16.
    // - Only use the exact previous election for the district.
    // - Reconcile candidate totals across both county portions against the
    //   race-wide historical summary before generating any editorial copy.
    // - Include BOTH county portions whether or not the winners differed.
    // - Percentages use all named candidates, not a two-party denominator.
    function historicalCountyBreakdown(race, history, source) {
        const config = HISTORICAL_COUNTY_FILES[race.race_id];
        if (!config || !source) return "";
        const election = race.race_id === "senate_16"
            ? source.elections?.find(e => Number(e.election_year) === Number(history.year)
                && e.office === "State Senate" && Number(e.district) === Number(race.district))
            : source;
        if (!election || Number(election.election_year) !== Number(history.year)
            || !Array.isArray(election.county_totals)) return "";

        const byCounty = new Map(election.county_totals.map(row => [Number(row.county_code), row]));
        if (byCounty.size !== config.counties.length) return "";
        const pastCandidates = history.candidates || [];
        if (pastCandidates.length < 2) return "";
        const expected = new Map(pastCandidates.map(c => [c.party, Number(c.votes)]));
        if (expected.size !== pastCandidates.length) return "";
        const combined = new Map([...expected.keys()].map(party => [party, 0]));
        const countyResults = [];

        for (const county of config.counties) {
            const row = byCounty.get(county.code);
            if (!row) return "";
            const entries = Array.isArray(row.candidates)
                ? row.candidates.map(c => ({party: c.party, votes: Number(c.votes)}))
                : Object.entries(row.votes || {}).map(([party, votes]) => ({party, votes: Number(votes)}));
            if (entries.length !== expected.size) return "";
            const parties = new Set();
            const ranked = [];
            for (const entry of entries) {
                if (parties.has(entry.party) || !expected.has(entry.party)
                    || !Number.isSafeInteger(entry.votes) || entry.votes < 0) return "";
                parties.add(entry.party);
                combined.set(entry.party, combined.get(entry.party) + entry.votes);
                ranked.push({...entry, candidate: pastCandidates.find(c => c.party === entry.party)});
            }
            const total = ranked.reduce((sum, c) => sum + c.votes, 0);
            if (total === 0) return "";
            ranked.sort((a, b) => b.votes - a.votes || a.party.localeCompare(b.party));
            if (ranked[0].votes === ranked[1].votes) return "";
            countyResults.push({county, ranked, total});
        }
        if ([...expected].some(([party, votes]) => combined.get(party) !== votes)) {
            console.warn(`Historical county figures do not reconcile for ${race.race_id}`);
            return "";
        }

        // The preceding historical sentence already introduced the race's
        // winner and runner-up. Refer to them by surname in this sentence.
        const introduced = [...pastCandidates]
            .sort((a, b) => Number(b.votes) - Number(a.votes))
            .slice(0, 2);
        const reference = candidate => introduced.includes(candidate)
            ? familyName(candidate.name) : fullName(candidate);
        const portion = ({county, ranked, total}) => {
            const [first, second] = ranked;
            return `the ${county.name} County portion of the district in a ` +
                `${roundedPercent(first.votes, total)}-${roundedPercent(second.votes, total)} ` +
                `split of ${number(total)} votes`;
        };
        const [first, second] = countyResults;
        const firstWinner = first.ranked[0].candidate;
        const secondWinner = second.ranked[0].candidate;
        if (firstWinner.party === secondWinner.party) {
            // Avoid saying the same surname twice if one candidate carried both.
            const secondPortion = portion(second).replace(' County portion of the district', ' County portion');
            return `${reference(firstWinner)} carried ${portion(first)} and ${secondPortion}.`;
        }
        return `${reference(firstWinner)} carried ${portion(first)}, while ` +
            `${reference(secondWinner)} carried ${portion(second)}.`;
    }

    // PA-01 has two earlier elections with complete district and county totals.
    // The 2024 summary introduces both past candidates, so surnames suffice here.
    // If the 2022 data or candidate identity check fails, do not invent context.
    function pa01History2022(race, history, source) {
        if (race.race_id !== "pa01" || Number(history.year) !== 2024 ||
            Number(source?.election_year) !== 2022 || !Array.isArray(source.candidates)) return "";
        const oldCandidates = source.candidates.map(candidate => {
            const matched = history.candidates.find(h => h.party === candidate.party &&
                familyName(h.name).toLowerCase() === String(candidate.last_name).trim().toLowerCase());
            const votes = Number(candidate.total_votes);
            if (!matched || !Number.isSafeInteger(votes) || votes < 0) return null;
            return {...matched, votes};
        });
        if (oldCandidates.some(c => !c) || oldCandidates.length !== history.candidates.length ||
            new Set(oldCandidates.map(c => c.party)).size !== oldCandidates.length) return "";
        const older = {race_id: race.race_id, year: 2022, candidates: oldCandidates};
        const countyText = historicalCountyBreakdown(race, older, source);
        if (!countyText) return "";
        const ranked = [...oldCandidates].sort((a, b) => b.votes - a.votes);
        const [winner, runnerUp] = ranked;
        if (!runnerUp || winner.votes <= runnerUp.votes) return "";
        const total = oldCandidates.reduce((sum, c) => sum + c.votes, 0);
        return `In the 2022 election for this seat, ${familyName(winner.name)} defeated ` +
            `${familyName(runnerUp.name)} in a ${roundedPercent(winner.votes, total)}-` +
            `${roundedPercent(runnerUp.votes, total)} split of ${number(total)} votes. ${countyText}`;
    }

    function introFor(race, history, countyHistory = null, earlierHistory = null) {
        if (!history || history.race_id !== race.race_id || !Array.isArray(history.candidates)) {
            return null;
        }
        // The historical winner is the top vote-getter in the most recent
        // election available for this race, not the current simulated leader.
        const past = [...history.candidates].sort((a, b) => Number(b.votes) - Number(a.votes));
        const winner = past[0], runnerUp = past[1];
        if (!winner || !runnerUp || !(Number(winner.votes) > Number(runnerUp.votes))) return null;
        const returningWinner = race.candidate_roster.find(candidate =>
            matchPastCandidate(candidate, history, race.race_id) === winner);
        const candidates = returningWinner
            ? [returningWinner, ...race.candidate_roster.filter(c => c !== returningWinner)]
            : race.candidate_roster;
        const name = titleFor(race);
        const raceLocation = race.office === "GOV" ? "the Pennsylvania governor's race" : name;
        let opening;
        if (candidates.length === 1) {
            const only = candidates[0];
            const missing = missingChallenger(only).name.replace(/^No /, "no ");
            opening = `${returningWinner ? "Incumbent " : ""}${fullName(only)} is running in ${raceLocation} with ${missing}.`;
        } else if (returningWinner) {
            opening = `Incumbent ${fullName(returningWinner)} faces ${listInProse(candidates.slice(1).map(fullName))} in ${raceLocation}.`;
        } else {
            opening = `${listInProse(candidates.map(fullName))} are competing in ${raceLocation}.`;
        }
        // Historical share uses all named candidates, not just the two leaders.
        // The source file excludes write-in votes; do not imply exact statewide
        // turnout beyond the available candidate totals.
        const historicalVoteTotal = past.reduce((sum, candidate) => sum + Number(candidate.votes || 0), 0);
        if (!Number.isSafeInteger(historicalVoteTotal) || historicalVoteTotal <= 0) return null;
        // Round the winner and runner-up shares independently against ALL
        // named-candidate votes. In multiparty races, the two shares may not
        // add to 100. Never calculate this as a forced two-party split.
        const winnerPercent = roundedPercent(Number(winner.votes), historicalVoteTotal);
        const runnerUpPercent = roundedPercent(Number(runnerUp.votes), historicalVoteTotal);
        // AP-style numerals: exact counts under 1 million, approximately X.X
        // million for larger totals. Write-ins aren't in this historical file.
        const voteDescription = historicalVoteTotal >= 1000000
            ? `about ${(historicalVoteTotal / 1000000).toFixed(1).replace(/\.0$/, "")} million votes`
            : `${number(historicalVoteTotal)} votes`;
        const pastWinner = historicalPersonReference(winner, race, history);
        const pastRunnerUp = historicalPersonReference(runnerUp, race, history);
        const previousElection = race.office === "GOV"
            ? `the ${history.year} statewide election`
            : `the ${history.year} election for this seat`;
        const prior = `In ${previousElection}, ${pastWinner} defeated ${pastRunnerUp} in a ${winnerPercent}-${runnerUpPercent} split of ${voteDescription}${race.office === "GOV" ? " across Pennsylvania" : ""}.`;
        const countyBreakdown = historicalCountyBreakdown(race, history, countyHistory);
        const historicalParagraph = `${prior}${countyBreakdown ? " " + countyBreakdown : ""}`;
        const paragraphs = [opening.replace(/\.$/, " on Election Day."), historicalParagraph];
        const earlierParagraph = pa01History2022(race, history, earlierHistory);
        if (earlierParagraph) paragraphs.push(earlierParagraph);
        // Final editorial transition is copied with the introduction, never
        // included in the standalone result-card iframe.
        paragraphs.push(race.office === "GOV"
            ? "See Bucks County's current election results below."
            : "See current election results below.");
        return {heading: name, paragraphs};
    }

    function editorIntroMarkup(race, history, countyHistory, earlierHistory) {
        const intro = introFor(race, history, countyHistory, earlierHistory);
        const heading = escapeHtml(titleFor(race));
        const paragraphs = intro
            ? intro.paragraphs
            : ["Historical results unavailable for this race. Verify the history file before generating copy."];
        return `<section class="race-entry__editor-intro" aria-label="Editorial introduction for ${heading}">
            <h3 class="race-entry__title">${heading}</h3>
            ${paragraphs.map(paragraph => `<p class="race-entry__intro-text">${escapeHtml(paragraph)}</p>`).join("")}
            <div class="race-entry__intro-actions">
                <button type="button" class="copy-intro" ${intro ? "" : "disabled"}>Copy heading and introduction</button>
                <span class="intro-feedback" role="status" aria-live="polite"></span>
            </div>
        </section>`;
    }

    function cardUrl(raceId, published = false) {
        const url = new URL(published ? PUBLISHED_CARDS_URL : window.location.href);
        url.search = "";
        url.hash = "";
        url.searchParams.set("embed", "1");
        url.searchParams.set("race", raceId);
        return url.href;
    }

    function iframeMarkup(race) {
        // A fixed, generous height avoids clipping in cross-origin iframes on
        // WordPress. Third-party candidates each get a full additional row.
        // Reserve extra space for the two-county paragraph at narrow widths.
        const height = Math.max(2, race.candidate_roster.length) * 163 + 255
            + (COUNTY_BREAKDOWN_RACES[race.race_id] ? 175 : 0);
        const url = cardUrl(race.race_id, true).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
        const label = escapeHtml(`Simulated 2026 election results: ${titleFor(race)}`);
        return `<iframe src="${url}" title="${label}" width="100%" height="${height}" loading="lazy" style="display:block;width:100%;max-width:650px;border:0;"></iframe>`;
    }

    function completeArticleHtml() {
        if (!lastPayload || !Array.isArray(lastPayload.races) || lastPayload.races.length !== 15) {
            throw new Error("The 15 race cards have not finished loading");
        }
        const groups = [...document.querySelectorAll("#race-sections .race-group")];
        const entries = groups.flatMap(group => [...group.querySelectorAll(".race-entry")]);
        if (entries.length !== lastPayload.races.length || entries.some(entry => entry.querySelector(".copy-intro:disabled"))) {
            throw new Error("One or more race introductions are incomplete");
        }
        const racesById = new Map(lastPayload.races.map(race => [race.race_id, race]));
        const output = ARTICLE_OPENINGS[selectedArticleOpening]
            .map(paragraph => `<p>${escapeHtml(paragraph)}</p>`);
        // Preserve the same ordering and wording editors see in the gallery.
        for (const group of groups) {
            const groupHeading = group.querySelector(".race-group__heading h2");
            if (!groupHeading) throw new Error("A race group heading is missing");
            output.push(`<h2>${escapeHtml(groupHeading.textContent)}</h2>`);
            for (const entry of group.querySelectorAll(".race-entry")) {
                const heading = entry.querySelector(".race-entry__editor-intro h3");
                const card = entry.querySelector(".race-card[data-race-id]");
                const race = racesById.get(card?.dataset.raceId);
                if (!heading || !race) throw new Error("A race heading or embed is missing");
                output.push(`<h3>${escapeHtml(heading.textContent)}</h3>`);
                for (const paragraph of entry.querySelectorAll(".race-entry__intro-text")) {
                    output.push(`<p>${escapeHtml(paragraph.textContent)}</p>`);
                }
                output.push(iframeMarkup(race));
            }
        }
        return output.join("\n\n");
    }

    async function copyCompleteArticle() {
        const section = document.querySelector("#how-to-use");
        const feedback = document.querySelector("#complete-article-feedback");
        let html;
        try {
            html = completeArticleHtml();
        } catch (error) {
            feedback.textContent = `Cannot copy full article: ${error.message}.`;
            return;
        }
        try {
            if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
            await navigator.clipboard.writeText(html);
            feedback.textContent = "Full article HTML copied. Paste into one WordPress Custom HTML block.";
            section.querySelector(".how-to-use__manual-code")?.remove();
        } catch (error) {
            section.querySelector(".how-to-use__manual-code")?.remove();
            const area = document.createElement("textarea");
            area.className = "how-to-use__manual-code";
            area.readOnly = true;
            area.setAttribute("aria-label", "Full WordPress article HTML to copy manually");
            area.value = html;
            section.querySelector(".how-to-use__master-actions").appendChild(area);
            area.focus();
            area.select();
            feedback.textContent = "Clipboard unavailable. Select and copy the HTML below into one Custom HTML block.";
        }
    }

    function cardMarkup(race, withTools = true, history = null, countyHistory = null, earlierHistory = null) {
        const data = summarizeRace(race);
        const rows = data.candidates.map(candidate => candidateMarkup(candidate, data.totalVotes, race.race_id));
        if (data.candidates.length === 1) rows.push(candidateMarkup(missingChallenger(data.candidates[0]), data.totalVotes, race.race_id, true));
        const title = escapeHtml(titleFor(race));
        const countyParagraph = countyBreakdownParagraph(race);
        return `<div class="race-entry">
            ${withTools ? editorIntroMarkup(race, history, countyHistory, earlierHistory) : `<h3 class="race-entry__title">${title}</h3>`}
            <article class="race-card" data-race-id="${escapeHtml(race.race_id)}" aria-label="${title} results">
                <div class="race-card__column-heads" aria-hidden="true"><span></span><span>Vote share</span><span>Total votes</span></div>
                <div class="race-card__candidates">${rows.join("")}</div>
                <div class="race-card__summary"><span class="race-card__summary-label">Current results</span><p>${escapeHtml(resultsSentence(race, data))}</p>${countyParagraph ? `<p>${escapeHtml(countyParagraph)}</p>` : ""}</div>
            </article>
            ${withTools ? `<div class="race-entry__embed-tools">
                <button type="button" class="copy-iframe" data-race-id="${escapeHtml(race.race_id)}">Copy iframe code</button>
                <a href="${escapeHtml(cardUrl(race.race_id))}" target="_blank" rel="noopener noreferrer">Preview embed</a>
                <span class="embed-feedback" role="status" aria-live="polite"></span>
            </div>` : ""}
        </div>`;
    }

    function renderPage(payload, histories = new Map(), countyHistories = new Map()) {
        if (!Array.isArray(payload.races) || !String(payload.status || "").includes("SIMULATED")) {
            throw new Error("Expected simulated election data with a races array");
        }
        const ids = new Set();
        for (const race of payload.races) {
            if (ids.has(race.race_id)) throw new Error(`Duplicate race: ${race.race_id}`);
            ids.add(race.race_id);
        }
        if (embedMode) {
            const race = payload.races.find(item => item.race_id === embeddedRaceId);
            if (!race) throw new Error(`Unknown race for iframe: ${embeddedRaceId || "(none)"}`);
            document.querySelector("#race-sections").innerHTML = cardMarkup(race, false)
                + `<p class="embedded-demo-notice">SIMULATED 2026 RESULTS — NOT ACTUAL ELECTION RETURNS</p>`;
            document.querySelector("#page-status").textContent = "";
            return;
        }
        const html = GROUPS.map(group => {
            const races = payload.races.filter(r => r.office === group.office)
                .sort((a, b) => Number(a.district || 0) - Number(b.district || 0));
            if (!races.length) return "";
            return `<section class="race-group" aria-label="${escapeHtml(group.title)} results">
                <div class="race-group__heading"><h2>${escapeHtml(group.title)}</h2><span>${races.length} ${races.length === 1 ? "race" : "races"}</span></div>
                <div class="race-group__cards">${races.map(race => cardMarkup(race, true, histories.get(race.race_id), countyHistories.get(race.race_id),
                    race.race_id === "pa01" ? countyHistories.get("pa01_2022") : null)).join("")}</div>
            </section>`;
        }).join("");
        const recognized = payload.races.filter(race => GROUPS.some(group => group.office === race.office));
        if (recognized.length !== payload.races.length) throw new Error("Unknown election office in results data");
        document.querySelector("#race-sections").innerHTML = html;
        const incompleteIntroductions = document.querySelectorAll("#race-sections .copy-intro:disabled").length;
        const fullArticleButton = document.querySelector("#copy-complete-article");
        const fullArticleFeedback = document.querySelector("#complete-article-feedback");
        fullArticleButton.disabled = incompleteIntroductions > 0 || payload.races.length !== 15;
        fullArticleFeedback.textContent = incompleteIntroductions
            ? `${incompleteIntroductions} historical introductions unavailable. Check the source files before copying all.`
            : payload.races.length !== 15
                ? "Expected 15 races. Check the results data before copying all."
                : "Ready: all 15 race sections and embeds.";
        document.querySelector("#page-status").textContent = `${number(payload.races.length)} race cards loaded. Simulated results are checked every two minutes. Embed codes will work after this page is published to GitHub Pages.`;
    }

    let previousJson = null;
    let lastPayload = null;
    let historyPromise = null;
    function loadHistory() {
        if (!historyPromise) {
            historyPromise = fetch(HISTORY_URL, {cache: "no-store"}).then(response => {
                if (!response.ok) throw new Error(`${HISTORY_URL}: HTTP ${response.status}`);
                return response.json();
            }).then(data => {
                if (!Array.isArray(data.races)) throw new Error("Invalid historical summaries");
                return new Map(data.races.map(race => [race.race_id, race]));
            }).catch(error => {
                console.error("Historical introduction data unavailable:", error);
                return new Map();
            });
        }
        return historyPromise;
    }
    let countyHistoryPromise = null;
    function loadCountyHistories() {
        if (!countyHistoryPromise) {
            countyHistoryPromise = Promise.all(Object.entries(HISTORICAL_COUNTY_FILES).map(async ([raceId, config]) => {
                try {
                    const response = await fetch(config.url);
                    if (!response.ok) throw new Error(`${config.url}: HTTP ${response.status}`);
                    return [raceId, await response.json()];
                } catch (error) {
                    // One missing older election should not hide the other
                    // verified county summaries or their 2024 introductions.
                    console.warn(`Historical county data unavailable for ${raceId}:`, error);
                    return null;
                }
            })).then(entries => new Map(entries.filter(Boolean)));
        }
        return countyHistoryPromise;
    }
    let loading = false;
    async function refresh() {
        if (loading) return;
        loading = true;
        try {
            const response = await fetch(DATA_URL, {cache: "no-store"});
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const raw = await response.text();
            if (raw !== previousJson) {
                const parsed = JSON.parse(raw);
                const [histories, countyHistories] = embedMode
                    ? [new Map(), new Map()]
                    : await Promise.all([loadHistory(), loadCountyHistories()]);
                renderPage(parsed, histories, countyHistories);
                lastPayload = parsed;
                previousJson = raw;
            }
        } catch (error) {
            console.error("Unable to update election cards", error);
            if (embedMode) document.body.classList.add("embed-load-error");
            document.querySelector("#page-status").textContent = `Unable to load or update race cards: ${error.message}`;
        } finally {
            loading = false;
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        if (embedMode) {
            document.body.classList.add("beacon-card-embed");
            document.querySelector("#article-opening")?.remove();
            document.querySelector("#how-to-use")?.remove();
        } else {
            setArticleOpening(selectedArticleOpening);
            document.querySelector("#copy-complete-article").addEventListener("click", copyCompleteArticle);
            document.querySelector("#article-opening").addEventListener("click", event => {
                const mode = event.target.closest("[data-opening-mode]")?.dataset.openingMode;
                if (mode) setArticleOpening(mode);
                if (event.target.closest("#copy-article-opening")) copyArticleOpening();
            });
        }
        // Event delegation survives the two-minute live-results redraw.
        document.querySelector("#race-sections").addEventListener("click", async event => {
            if (embedMode) return;
            const introButton = event.target.closest(".copy-intro");
            if (introButton) {
                const section = introButton.closest(".race-entry__editor-intro");
                const heading = section.querySelector("h3").textContent;
                const paragraphs = [...section.querySelectorAll(".race-entry__intro-text")]
                    .map(element => element.textContent);
                const plain = `${heading}\n\n${paragraphs.join("\n\n")}`;
                // Preserve the H3 and each distinct paragraph in WordPress.
                const rich = `<h3>${escapeHtml(heading)}</h3>` +
                    paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join("");
                const feedback = section.querySelector(".intro-feedback");
                try {
                    if (window.ClipboardItem && navigator.clipboard?.write) {
                        await navigator.clipboard.write([new ClipboardItem({
                            "text/html": new Blob([rich], {type: "text/html"}),
                            "text/plain": new Blob([plain], {type: "text/plain"})
                        })]);
                        feedback.textContent = "Heading and introduction copied with formatting.";
                    } else if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(plain);
                        feedback.textContent = "Text copied. Apply H3 formatting after pasting.";
                    } else {
                        throw new Error("Clipboard unavailable");
                    }
                } catch (error) {
                    section.querySelector(".intro-manual-copy")?.remove();
                    const area = document.createElement("textarea");
                    area.className = "intro-manual-copy";
                    area.setAttribute("aria-label", "Introduction text to copy manually");
                    area.readOnly = true;
                    area.value = plain;
                    section.appendChild(area);
                    area.focus();
                    area.select();
                    feedback.textContent = "Select and copy the text shown below.";
                }
                return;
            }
            const button = event.target.closest(".copy-iframe");
            if (!button) return;
            const raceId = button.dataset.raceId;
            const matching = (lastPayload?.races || []).find(race => race.race_id === raceId);
            if (!matching) return;
            const textToCopy = iframeMarkup(matching);
            const feedback = button.parentElement.querySelector(".embed-feedback");
            try {
                await navigator.clipboard.writeText(textToCopy);
                feedback.textContent = "Iframe code copied.";
            } catch (error) {
                // Clipboard may be blocked on an insecure local host.
                // Present selectable markup instead of silently failing.
                button.parentElement.querySelector(".embed-manual-code")?.remove();
                const area = document.createElement("textarea");
                area.className = "embed-manual-code";
                area.readOnly = true;
                area.setAttribute("aria-label", "Iframe embed code to copy manually");
                area.value = textToCopy;
                button.parentElement.appendChild(area);
                area.focus();
                area.select();
                feedback.textContent = "Select and copy the code shown below.";
            }
        });
        refresh();
        window.setInterval(() => {
            if (document.visibilityState === "visible") refresh();
        }, CHECK_INTERVAL_MS);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") refresh();
        });
    });
})();
