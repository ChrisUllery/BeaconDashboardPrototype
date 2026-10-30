"use strict";

// Standalone Beacon election map embeds. "all=1" adds compact race/geography controls.
// Individual race URLs continue to display only the map and legend.
// The map uses shared geographic and simulated election data, never the dashboard UI.
(() => {
    const ROOT = "../data/";
    const COUNTY = {9:"Bucks",39:"Lehigh",46:"Montgomery"};
    const GROUPS = [["GOV","Governor"],["USC","U.S. Congress"],["STS","Pennsylvania Senate"],["STH","Pennsylvania House"]];
    const params = new URLSearchParams(location.search);
    const allRacesMode = params.get("all") === "1";
    const initialRace = params.get("race") || "pa01";
    const OVERVIEW_OPTIONS = {all_senate: "STS", all_house: "STH"};
    const initialView = params.get("view") || "precinct";
    const $ = selector => document.querySelector(selector);
    const status = $("#map-status");
    const legend = $("#map-legend");
    const backButton = $("#return-to-overview");
    const controls = $("#map-controls");
    const raceSelect = $("#map-race-select");
    const viewSelect = $("#map-view-select");
    const number = n => Number(n).toLocaleString("en-US");
    const esc = text => String(text).replace(/[&<>"']/g, a => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[a]);
    const total = votes => Object.values(votes).reduce((sum,v) => sum + Number(v || 0),0);
    const pct = (a,b) => b ? `${(100*a/b).toFixed(1)}%` : "0.0%";
    const precinctKey = p => `${p.county_code}:${p.map_id}`;
    const countyName = code => COUNTY[code] || `County ${code}`;

    function raceName(race) {
        if (race.office === "GOV") return "Pennsylvania Governor (Bucks County)";
        if (race.office === "USC") return `U.S. House PA-${String(race.district).padStart(2,"0")}`;
        if (race.office === "STS") return `PA Senate District ${race.district}`;
        if (race.office === "STH") return `PA House District ${race.district}`;
        return race.race_id;
    }
    function sidesOf(race) {
        const parties = race.candidate_roster.map(c => c.party);
        if (parties.length < 2) return parties[0] === "DEM" || parties[0] === "REP" ? {left:"DEM",right:"REP"} : null;
        const right = parties.includes("REP") ? "REP" : parties[1];
        return {left:parties.includes("DEM") ? "DEM" : parties.find(p => p !== right),right};
    }
    function voteMargin(votes,sides) {
        const n = total(votes);
        return n && sides ? 100*(Number(votes[sides.right]||0)-Number(votes[sides.left]||0))/n : null;
    }
    function fillColor(v,hasVotes) {
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
    function emptyVotes(roster) {return Object.fromEntries(roster.map(c => [c.party,0]));}
    function aggregate(precincts,roster) {
        const result = {total:precincts.length,reported:0,votes:emptyVotes(roster)};
        for (const p of precincts) {
            if (!p.reported) continue;
            result.reported++;
            for (const party of Object.keys(result.votes)) result.votes[party] += Number(p.votes[party]||0);
        }
        return result;
    }
    function popup(title,county,a,roster,extra="") {
        const n = total(a.votes);
        const rows = n ? roster.map(c => ({...c,votes:Number(a.votes[c.party]||0)}))
            .sort((x,y) => y.votes-x.votes || x.name.localeCompare(y.name))
            .map(c => `<div>${esc(c.name)} (${esc(c.party)}): <b>${number(c.votes)} (${pct(c.votes,n)})</b></div>`).join("")
            : "No reported votes yet.";
        return `<div class="precinct-popup"><strong>${esc(title)}</strong>${county?`<div>${esc(county)} County</div>`:""}`+
            `<div>${rows}</div><div class="counted">${number(a.reported)} of ${number(a.total)} precincts reporting${extra}</div></div>`;
    }
    function hatchPattern() {
        const canvas = document.createElement("canvas");
        canvas.width=canvas.height=10;
        const ctx=canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas is unavailable");
        ctx.fillStyle="#d7dce1";ctx.fillRect(0,0,10,10);
        ctx.strokeStyle="#808c98";ctx.lineWidth=1.4;ctx.beginPath();
        ctx.moveTo(0,0);ctx.lineTo(10,10);ctx.moveTo(-10,0);ctx.lineTo(0,10);ctx.moveTo(10,0);ctx.lineTo(20,10);ctx.stroke();
        return ctx.createPattern(canvas,"repeat");
    }
    async function loadJSON(url) {
        const response=await fetch(url);
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        return response.json();
    }
    function setViewOptions(race, selected="precinct") {
        if (!allRacesMode) return;
        const includeCounty=race.office!=="GOV" && race.coverage_counties.length>1;
        viewSelect.innerHTML='<option value="precinct">Precinct results</option>'+
            (includeCounty?'<option value="county">County results</option>':"")+
            `<option value="race">${race.office==="GOV"?"Bucks County":"District"} overview</option>`;
        viewSelect.value=selected;
    }
    function setLegend(race,sides,view) {
        if (sides) {
            legend.innerHTML=`<strong class="legend-title">${esc(sides.left)} vs. ${esc(sides.right)} vote margin</strong>`+
                `<div class="legend-bar"></div><div class="legend-labels"><span>${esc(sides.left)} +50</span><span>0</span><span>${esc(sides.right)} +50</span></div>`+
                `<div class="legend-foot"></div>`;
        } else {
            legend.innerHTML='<strong class="legend-title">Precinct reporting</strong><div class="legend-foot"></div>';
        }
        legend.querySelector(".legend-foot").innerHTML=view==="precinct"
            ? '<span class="legend-not-reported"></span> Hatched precincts have not reported'
            : 'Gray means no reported votes';
        legend.hidden=false;
    }

    async function start() {
        if (!window.L) throw new Error("Leaflet did not load");
        const [results,geometry,boundaries]=await Promise.all([
            loadJSON(ROOT+"results/mock_2026_results.json"),
            loadJSON(ROOT+"maps/precincts_2024.geojson"),
            loadJSON(ROOT+"maps/aggregated_boundaries_2024.geojson")
        ]);
        if (results.status && !String(results.status).includes("SIMULATED")) throw new Error("Expected simulated election data");
        if (!Array.isArray(results.races)||!Array.isArray(geometry.features)||!Array.isArray(boundaries.features)) throw new Error("Incomplete map files");
        const races=new Map(results.races.map(r => [r.race_id,r]));
        const geometries=new Map(geometry.features.map(f => [precinctKey(f.properties),f]));
        const boundMap=new Map(boundaries.features.map(f => {
            const p=f.properties;
            return [`${p.race_id}|${p.level}|${p.county_code||""}`,f];
        }));
        const map=L.map("election-map",{preferCanvas:true,scrollWheelZoom:false,zoomSnap:0.1,zoomDelta:0.5});
        const renderer=L.canvas({padding:0.2});
        const hatch=hatchPattern();
        let activeLayer=null;
        let backAction=null;
        let raceNow=null;
        let changeView=null;
        backButton.addEventListener("click",()=>{if(backAction)backAction();});

        if (allRacesMode) {
            document.body.classList.add("all-races");
            controls.hidden=false;
            raceSelect.innerHTML=GROUPS.map(([office,label])=>{
                const subset=results.races.filter(r=>r.office===office);
                const overview = office==="STS" ? '<option value="all_senate">All tracked Senate races</option>'
                    : office==="STH" ? '<option value="all_house">All tracked House races</option>' : "";
                return `<optgroup label="${esc(label)}">${overview}${subset.map(r=>`<option value="${esc(r.race_id)}">${esc(raceName(r))}</option>`).join("")}</optgroup>`;
            }).join("");
        }

        function renderRace(id, preferredView="precinct") {
            const race=races.get(id);
            if (!race) throw new Error(`Unknown race: ${id}`);
            const governor=race.office==="GOV";
            // Critical reporting scope: governor returns are restricted to Bucks County.
            const precincts=governor ? race.precincts.filter(p=>Number(p.county_code)===9) : race.precincts;
            const byKey=new Map(precincts.map(p=>[precinctKey(p),p]));
            if (!precincts.length||byKey.size!==precincts.length) throw new Error(`Invalid precincts for ${id}`);
            if (governor&&precincts.length!==304) throw new Error("Governor Bucks coverage should have 304 precincts");
            const features=precincts.map(p=>geometries.get(precinctKey(p)));
            if (features.some(f=>!f)) throw new Error(`Some ${id} precinct boundaries are missing`);
            const sides=sidesOf(race);
            if (activeLayer) {map.removeLayer(activeLayer); activeLayer=null;}
            map.closePopup();
            let view=preferredView;
            if (!["race","county","precinct"].includes(view)) view="precinct";
            if (view==="county"&&(governor||race.coverage_counties.length<2)) view="precinct";
            let homeView=view;
            raceNow=id;
            backButton.textContent="Back to overview";
            document.title=`${raceName(race)} election map | The Beacon`;
            if (allRacesMode) {raceSelect.value=id;viewSelect.disabled=false;setViewOptions(race,view);}

            const precinctLayer=L.geoJSON({type:"FeatureCollection",features}, {
                renderer,
                style:f=>{
                    const p=byKey.get(precinctKey(f.properties));
                    return {color:"#2b2b2b",weight:0.9,fillOpacity:0.78,
                        fillColor:p.reported?fillColor(voteMargin(p.votes,sides),total(p.votes)>0):hatch};
                },
                onEachFeature:(f,layer)=>{
                    const p=byKey.get(precinctKey(f.properties));
                    const a={total:1,reported:p.reported?1:0,votes:p.reported?p.votes:emptyVotes(race.candidate_roster)};
                    layer.bindPopup(popup(f.properties.precinct_name||precinctKey(p),countyName(p.county_code),a,race.candidate_roster));
                    layer.on("mouseover",()=>layer.setStyle({color:"#111",weight:2,fillOpacity:0.9}));
                    layer.on("mouseout",()=>precinctLayer.resetStyle(layer));
                }
            });
            function boundary(level,code="") {return boundMap.get(`${race.race_id}|${level}|${code}`);}
            function aggregateLayer(feature,subset,label,county="") {
                if (!feature) throw new Error(`Missing ${label} boundary`);
                const a=aggregate(subset,race.candidate_roster);
                const layer=L.geoJSON(feature, {
                    renderer,
                    style:{color:"#253744",weight:1.7,fillOpacity:0.78,
                        fillColor:fillColor(voteMargin(a.votes,sides),a.reported>0&&total(a.votes)>0)},
                    onEachFeature:(_feature,shape)=>{
                        shape.bindPopup(popup(label,county,a,race.candidate_roster,". Click to view precincts."));
                        shape.on("mouseover",()=>shape.setStyle({color:"#111",weight:3,fillOpacity:0.9}));
                        shape.on("mouseout",()=>layer.resetStyle(shape));
                        shape.on("click",()=>show("precinct",true));
                    }
                });
                return layer;
            }
            const countyLayers=L.featureGroup();
            if (!governor&&race.coverage_counties.length>1) {
                for(const c of race.coverage_counties) {
                    const subset=precincts.filter(p=>Number(p.county_code)===Number(c));
                    countyLayers.addLayer(aggregateLayer(boundary("county",c),subset,`${countyName(c)} County (district portion)`,countyName(c)));
                }
            }
            const region=governor?boundary("county",9):boundary("race");
            const overview=aggregateLayer(region,precincts,governor?"Bucks County governor results":"Entire district results",governor?"Bucks":"");

            function show(next,drill=false) {
                if (raceNow!==id) return;
                if (activeLayer) map.removeLayer(activeLayer);
                view=next;
                activeLayer=next==="precinct"?precinctLayer:next==="county"?countyLayers:overview;
                activeLayer.addTo(map);
                if (!activeLayer.getLayers().length) throw new Error(`No map features for ${id}`);
                map.invalidateSize();
                map.fitBounds(activeLayer.getBounds(),{padding:[14,14],animate:false,maxZoom:12});
                backButton.hidden=!(drill||view!==homeView);
                backAction=()=>show(homeView);
                if (allRacesMode) viewSelect.value=next;
                setLegend(race,sides,next);
            }
            changeView=next=>{homeView=next;show(next);};
            show(view);
            status.hidden=true;
        }

        // Two district-level overview maps from the original dashboard.
        // These exist only in the featured all-races embed; individual embeds stay map-only.
        function renderGroup(office) {
            const selected=results.races.filter(r=>r.office===office);
            if (!selected.length) throw new Error(`No tracked districts for ${office}`);
            const selectedOption=office==="STS" ? "all_senate" : "all_house";
            if (activeLayer) {map.removeLayer(activeLayer);activeLayer=null;}
            map.closePopup();
            const layers=L.featureGroup();
            for (const race of selected) {
                const feature=boundMap.get(`${race.race_id}|race|`);
                if (!feature) throw new Error(`Missing district boundary for ${race.race_id}`);
                const a=aggregate(race.precincts,race.candidate_roster);
                const sides=sidesOf(race);
                const label=raceName(race);
                const shapeGroup=L.geoJSON(feature,{
                    renderer,
                    style:{color:"#253744",weight:1.7,fillOpacity:0.78,
                        fillColor:fillColor(voteMargin(a.votes,sides),a.reported>0&&total(a.votes)>0)},
                    onEachFeature:(_feature,shape)=>{
                        // Hover shows a summary; clicking drills to that race's precincts.
                        if (typeof shape.bindTooltip==="function") {
                            shape.bindTooltip(popup(label,"",a,race.candidate_roster),{sticky:true,direction:"top"});
                        }
                        shape.on("mouseover",()=>shape.setStyle({color:"#111",weight:3,fillOpacity:0.9}));
                        shape.on("mouseout",()=>shapeGroup.resetStyle(shape));
                        shape.on("click",()=>{
                            renderRace(race.race_id,"precinct");
                            backButton.hidden=false;
                            backButton.textContent=office==="STS" ? "Back to Senate overview" : "Back to House overview";
                            backAction=()=>renderGroup(office);
                        });
                    }
                });
                layers.addLayer(shapeGroup);
            }
            activeLayer=layers;
            raceNow=selectedOption;
            document.title=office==="STS" ? "Pennsylvania Senate races map | The Beacon" : "Pennsylvania House races map | The Beacon";
            raceSelect.value=selectedOption;
            viewSelect.innerHTML='<option value="race">District overview</option>';
            viewSelect.value="race";
            viewSelect.disabled=true;
            changeView=null;
            layers.addTo(map);
            map.invalidateSize();
            map.fitBounds(layers.getBounds(),{padding:[14,14],animate:false,maxZoom:12});
            backButton.hidden=true;
            backButton.textContent="Back to overview";
            backAction=null;
            // Districts can have different party combinations, including uncontested races.
            legend.innerHTML='<strong class="legend-title">District vote margins</strong>'+
                '<div class="legend-bar"></div><div class="legend-labels"><span>Other / DEM lead</span><span>0</span><span>REP lead</span></div>'+
                '<div class="legend-foot">Teal = one listed candidate. Click a district for precinct results.</div>';
            legend.hidden=false;
            status.hidden=true;
        }

        if (allRacesMode) {
            raceSelect.addEventListener("change",()=>{
                try {
                    const office=OVERVIEW_OPTIONS[raceSelect.value];
                    if (office) renderGroup(office);
                    else renderRace(raceSelect.value,"precinct");
                    status.hidden=true;
                } catch(error){status.textContent=error.message;status.hidden=false;}
            });
            viewSelect.addEventListener("change",()=>{
                try {if(changeView) changeView(viewSelect.value);}
                catch(error){status.textContent=error.message;status.hidden=false;}
            });
        }
        if (allRacesMode && OVERVIEW_OPTIONS[initialRace]) renderGroup(OVERVIEW_OPTIONS[initialRace]);
        else renderRace(races.has(initialRace)?initialRace:"pa01",initialView);

        // Contextual basemap only: preserve roads but avoid dozens of overlapping labels.
        // Place names are shown sparingly, and only after a reader zooms in.
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
                // These place labels are orientation aids, not an additional data layer.
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
    start().catch(error=>{
        console.error("Beacon map error:",error);
        status.textContent=`Unable to display election map: ${error.message}`;
        status.hidden=false;
    });
})();
