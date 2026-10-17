// A self-contained HTML report. No external requests: styles, script and data are inline.
import type { Analysis } from "./dataset.js";

export interface ReportMeta { facility?: string; generatedAt: string }

/** JSON that is safe inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderReport(a: Analysis, meta: ReportMeta): string {
  const data = {
    facility: meta.facility ?? "", generatedAt: meta.generatedAt, dataDate: a.data_date, range: a.date_range,
    mondays: a.week_mondays, usual: a.usual_weeks, last3: a.last3_weeks, dataWeekCounted: a.data_week_counted,
    thresholds: a.thresholds, counts: a.counts, holds: a.hold_export_loaded, memberships: a.membership_export_loaded,
    gaps: a.gaps_between_files,
    members: a.slipping.map((m) => ({ code: m.code, name: m.name, id: m.client_id, location: m.location, weeks: m.weeks,
      usual: m.usual_per_week, last3: m.last3_per_week, last3Weeks: m.last3_weeks, lastVisit: m.last_visit,
      attended: m.weeks_attended_of_8 })),
  };
  const title = meta.facility ? `Regulars slipping · ${escapeHtml(meta.facility)}` : "Regulars slipping";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#list">Skip to the list</a>
<header class="top">
  <div class="wrap">
    <div class="eyebrow">Attendance trends</div>
    <h1 id="title">Regulars slipping</h1>
    <p class="meta" id="meta"></p>
    <p class="local"><svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path d="M8 1 2 3.5v4C2 11 4.6 14 8 15c3.4-1 6-4 6-7.5v-4L8 1Z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
      Built on this computer from your exports. Nothing was uploaded, and this page makes no network requests.</p>
  </div>
</header>
<main class="wrap">
  <section aria-label="Summary" class="cards" id="cards"></section>
  <section class="rule" aria-label="How members are picked">
    <details>
      <summary>How this list is picked</summary>
      <div id="rule"></div>
    </details>
  </section>
  <div id="warnings"></div>
  <section class="workspace">
    <div class="listcol">
      <div class="controls" role="search">
        <label class="field grow"><span>Search</span>
          <input id="q" type="search" placeholder="Name, client ID or code" autocomplete="off"></label>
        <label class="field" id="locfield"><span>Location</span><select id="loc"><option value="">All locations</option></select></label>
        <label class="field"><span>Sort by</span>
          <select id="sort">
            <option value="drop">Biggest drop</option>
            <option value="name">Name</option>
            <option value="usual">Usual per week</option>
            <option value="last3">Last 3 weeks</option>
            <option value="lastVisit">Last visit</option>
            <option value="attended">Weeks attended</option>
          </select></label>
      </div>
      <p class="count" id="count" aria-live="polite"></p>
      <div class="tablewrap">
        <table id="list" aria-describedby="count">
          <thead><tr>
            <th scope="col" data-sort="name"><button type="button">Name</button></th>
            <th scope="col" data-sort="usual" class="num"><button type="button">Usual / wk</button></th>
            <th scope="col" data-sort="last3" class="num"><button type="button">Last 3 wks</button></th>
            <th scope="col" data-sort="lastVisit"><button type="button">Last visit</button></th>
            <th scope="col" data-sort="attended" class="num"><button type="button">Weeks of 8</button></th>
            <th scope="col" class="chartcol">12 weeks</th>
          </tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
      <p class="empty" id="empty" hidden>No one matches. Clear the search or pick another location.</p>
    </div>
    <aside class="detail" id="detail" aria-live="polite" aria-label="Member detail">
      <p class="hint">Pick someone in the list to see their 12 weeks.</p>
    </aside>
  </section>
  <footer class="foot">
    <p id="foot"></p>
    <p>Unofficial tool, not affiliated with Mindbody. Read the list as a prompt for a friendly check-in, not a verdict.</p>
  </footer>
</main>
<script id="data" type="application/json">${scriptJson(data)}</script>
<script>${JS}</script>
</body>
</html>
`;
}

const CSS = String.raw`
:root{
  --bg:#f6f7f9;--surface:#ffffff;--surface-2:#f0f2f5;--text:#1b1f24;--muted:#57606a;--line:#d8dde3;
  --accent:#2f5d8a;--accent-soft:#e3ecf5;--bar:#9aa7b4;--bar-recent:#b4541f;--usual:#1b1f24;--focus:#1f6feb;
  --warn-bg:#fff6e5;--warn-line:#e7c27a;--warn-text:#6b4a0c;
  color-scheme:light dark;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#111418;--surface:#181c21;--surface-2:#1f242a;--text:#e6e9ed;--muted:#a3adb8;--line:#2f363e;
  --accent:#8bb4dc;--accent-soft:#1f2c3a;--bar:#5f6b77;--bar-recent:#f0956a;--usual:#e6e9ed;--focus:#79b8ff;
  --warn-bg:#2a2214;--warn-line:#6b5426;--warn-text:#f0d9a6;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:0 16px}
.skip{position:absolute;left:-999px;top:8px;background:var(--surface);color:var(--text);padding:8px 12px;border-radius:6px;z-index:10}
.skip:focus{left:8px}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.top{background:var(--surface);border-bottom:1px solid var(--line);padding:24px 0 18px;margin-bottom:20px}
.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600}
h1{margin:2px 0 4px;font-size:26px;line-height:1.2;font-weight:650}
.meta{margin:0;color:var(--muted)}
.local{display:flex;gap:6px;align-items:center;margin:10px 0 0;font-size:13px;color:var(--muted)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.card .n{font-size:26px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.1}
.card .l{color:var(--muted);font-size:13px}
.card.key{border-color:var(--accent);background:var(--accent-soft)}
.rule details{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin-bottom:16px}
.rule summary{cursor:pointer;font-weight:600}
.rule ul{margin:8px 0 4px;padding-left:20px}
.warn{background:var(--warn-bg);border:1px solid var(--warn-line);color:var(--warn-text);border-radius:10px;padding:10px 14px;margin-bottom:16px}
.workspace{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;align-items:start}
.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:8px}
.field{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted);flex:0 1 170px;min-width:0}
.field.grow{flex:1 1 220px}
.field input,.field select{width:100%}
input,select{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-height:40px}
.count{margin:4px 0 8px;color:var(--muted);font-size:13px}
.tablewrap{background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600;background:var(--surface-2)}
th button{all:unset;cursor:pointer;display:inline-flex;gap:4px;align-items:center}
th button:focus-visible{outline:3px solid var(--focus);outline-offset:2px;border-radius:3px}
th[aria-sort="ascending"] button::after{content:"\25B2";font-size:9px}
th[aria-sort="descending"] button::after{content:"\25BC";font-size:9px}
.num{text-align:right}
tbody tr{cursor:pointer}
tbody tr:hover{background:var(--surface-2)}
tbody tr[aria-selected="true"]{background:var(--accent-soft)}
tbody tr:last-child td{border-bottom:0}
.name{font-weight:600}
.sub{display:block;color:var(--muted);font-size:12px;font-weight:400}
.down{color:var(--bar-recent);font-weight:600}
.chartcol{width:150px}
svg.spark{display:block}
.empty{padding:16px;color:var(--muted)}
.detail{position:sticky;top:16px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:16px}
.detail h2{margin:0 0 2px;font-size:19px}
.detail .hint{color:var(--muted);margin:0}
.detail dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:12px 0 0;font-size:14px}
.detail dt{color:var(--muted)}
.detail dd{margin:0;font-variant-numeric:tabular-nums}
.detail .says{margin:10px 0 0}
.legend{display:flex;gap:14px;font-size:12px;color:var(--muted);margin-top:6px;flex-wrap:wrap}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.legend .dash{width:16px;height:0;border-top:2px dashed var(--usual);border-radius:0;vertical-align:3px}
.foot{color:var(--muted);font-size:13px;margin:24px 0 40px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:900px){.workspace{grid-template-columns:minmax(0,1fr)}.detail{position:static}}
@media (max-width:560px){.chartcol,td.chart{display:none}h1{font-size:22px}.field{flex:1 1 100%}th,td{padding:8px}}
@media print{
  :root{--bg:#fff;--surface:#fff;--surface-2:#fff;--text:#000;--muted:#333;--line:#bbb;--accent-soft:#fff}
  .skip,.controls,.detail,.rule summary::marker{display:none}
  .workspace{display:block}.top{border:0;padding-top:0}
  .rule details{border:0;padding:0}.rule details>*{display:block}
  .tablewrap{overflow:visible;border:0}
  tbody tr{break-inside:avoid}
  tbody tr[aria-selected="true"]{background:none}
}
`;

const JS = String.raw`
(function(){
"use strict";
var D=JSON.parse(document.getElementById("data").textContent);
var $=function(id){return document.getElementById(id)};
var SVGNS="http://www.w3.org/2000/svg";
var fmtDay=function(s){if(!s)return"—";var d=new Date(s+"T00:00:00Z");return d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"})};
var shortDay=function(s){var d=new Date(s+"T00:00:00Z");return d.toLocaleDateString(undefined,{month:"short",day:"numeric",timeZone:"UTC"})};
var one=function(n){return (Math.round(n*10)/10).toFixed(1)};
var el=function(tag,attrs,text){var e=document.createElement(tag);if(attrs)for(var k in attrs)e.setAttribute(k,attrs[k]);if(text!=null)e.textContent=text;return e};
var end=D.dataWeekCounted?11:10;

if(D.facility){$("title").textContent="Regulars slipping · "+D.facility}
$("meta").textContent="Visits "+fmtDay(D.range.from)+" to "+fmtDay(D.range.to)+" · Data date "+fmtDay(D.dataDate);

var C=D.counts;
var excluded=C.excluded_on_hold+C.excluded_not_active+C.excluded_test_accounts;
[["Slipping regulars",C.slipping,true],["Regulars",C.regulars],["Members with visits",C.members],
 ["Left out (hold, inactive, test)",excluded],["Too little history",C.not_enough_history]].forEach(function(c){
  var d=el("div",{"class":"card"+(c[2]?" key":"")});d.appendChild(el("div",{"class":"n"},String(c[1])));d.appendChild(el("div",{"class":"l"},c[0]));$("cards").appendChild(d)});

var T=D.thresholds,pct=Math.round(T.dropRatio*100);
var ul=el("ul");
["Usual weeks: "+fmtDay(D.usual.from)+" to "+fmtDay(D.usual.to)+" (8 weeks). Last 3 weeks: "+fmtDay(D.last3.from)+" to "+fmtDay(D.last3.to)+".",
 "A regular came in at least "+T.minWeeksAttended+" of those 8 weeks and averaged "+T.minUsualPerWeek+" or more days a week. Each day with a sign-in counts once; no-shows and late cancels do not count.",
 "Slipping means the last 3 weeks averaged "+pct+"% of usual or less, and the latest week alone was also "+pct+"% of usual or less.",
 D.dataWeekCounted?"The data date is a weekend, so its week counts as the latest week.":"The data date is a weekday, so its week is not counted yet; the last 3 weeks end the week before.",
 "Weeks before the exports begin are unknown, so members who would need them are left out rather than flagged.",
 (D.holds?"Members on hold (from the Autopay Detail export) are left out. ":"No hold export was loaded, so members on hold may appear. ")+
 (D.memberships?"Only active members (from the membership export) are included. ":"No membership export was loaded, so non-members may appear. ")+"Names starting with \"Test\" are left out."
].forEach(function(t){ul.appendChild(el("li",null,t))});
$("rule").appendChild(ul);

if(D.gaps&&D.gaps.length){var w=el("div",{"class":"warn",role:"note"});w.textContent="Your exports have a gap ("+D.gaps.map(function(g){return fmtDay(g.from)+" to "+fmtDay(g.to)}).join("; ")+"). Missing weeks read as no visits, so check that every month was exported.";$("warnings").appendChild(w)}

var locs={};D.members.forEach(function(m){if(m.location)locs[m.location]=1});
var locNames=Object.keys(locs).sort();
if(locNames.length<2){$("locfield").hidden=true}
locNames.forEach(function(l){$("loc").appendChild(el("option",{value:l},l))});

function chart(m,w,h,big){
  var svg=document.createElementNS(SVGNS,"svg");svg.setAttribute("viewBox","0 0 "+w+" "+h);svg.setAttribute("width",w);svg.setAttribute("height",h);svg.setAttribute("class","spark");
  svg.setAttribute("role","img");
  var label="Days attended per week, oldest first: "+m.weeks.map(function(v){return v==null?"unknown":v}).join(", ")+". Usual "+one(m.usual)+" a week.";
  svg.setAttribute("aria-label",label);
  var bottom=big?h-18:h-2,top=4,max=Math.max(m.usual,1);m.weeks.forEach(function(v){if(v!=null&&v>max)max=v});max*=1.15;
  var gap=big?6:3,bw=(w-gap*11)/12,y=function(v){return bottom-(v/max)*(bottom-top)};
  m.weeks.forEach(function(v,i){
    var x=i*(bw+gap),recent=i>=end-2&&i<=end;
    if(v==null){var u=document.createElementNS(SVGNS,"rect");u.setAttribute("x",x);u.setAttribute("y",bottom-2);u.setAttribute("width",bw);u.setAttribute("height",2);u.setAttribute("fill","var(--line)");svg.appendChild(u);return}
    var r=document.createElementNS(SVGNS,"rect");var hh=Math.max(v>0?2:1,bottom-y(v));
    r.setAttribute("x",x);r.setAttribute("y",bottom-hh);r.setAttribute("width",bw);r.setAttribute("height",hh);r.setAttribute("rx",big?2:1);
    r.setAttribute("fill",recent?"var(--bar-recent)":"var(--bar)");if(i>end||i<end-10)r.setAttribute("opacity","0.35");svg.appendChild(r);
    if(big){var t=document.createElementNS(SVGNS,"text");t.setAttribute("x",x+bw/2);t.setAttribute("y",h-4);t.setAttribute("text-anchor","middle");t.setAttribute("font-size","9");t.setAttribute("fill","var(--muted)");t.textContent=String(v);svg.appendChild(t)}
  });
  var line=document.createElementNS(SVGNS,"line");line.setAttribute("x1",0);line.setAttribute("x2",w);line.setAttribute("y1",y(m.usual));line.setAttribute("y2",y(m.usual));
  line.setAttribute("stroke","var(--usual)");line.setAttribute("stroke-width",big?1.5:1);line.setAttribute("stroke-dasharray",big?"5 4":"3 3");svg.appendChild(line);
  return svg;
}

var state={q:"",loc:"",sort:"drop",dir:-1,selected:null};
var defaultDir={drop:-1,name:1,usual:-1,last3:1,lastVisit:1,attended:-1};
function key(m,s){return s==="drop"?m.usual-m.last3:s==="name"?m.name.toLowerCase():s==="lastVisit"?(m.lastVisit||""):m[s]}
function visible(){
  var q=state.q.trim().toLowerCase();
  return D.members.filter(function(m){
    if(state.loc&&m.location!==state.loc)return false;
    return !q||m.name.toLowerCase().indexOf(q)>=0||String(m.id).toLowerCase().indexOf(q)>=0||m.code.toLowerCase().indexOf(q)>=0;
  }).sort(function(a,b){var x=key(a,state.sort),y=key(b,state.sort);return (x<y?-1:x>y?1:0)*state.dir||a.name.localeCompare(b.name)});
}
function render(){
  var list=visible(),body=$("rows");body.textContent="";
  list.forEach(function(m){
    var tr=el("tr",{tabindex:"0","aria-selected":String(state.selected===m.code),"data-code":m.code});
    var td=el("td");td.appendChild(el("span",{"class":"name"},m.name));if(m.location&&locNames.length>1)td.appendChild(el("span",{"class":"sub"},m.location));tr.appendChild(td);
    tr.appendChild(el("td",{"class":"num"},one(m.usual)));
    tr.appendChild(el("td",{"class":"num down"},one(m.last3)));
    tr.appendChild(el("td",null,fmtDay(m.lastVisit)));
    tr.appendChild(el("td",{"class":"num"},m.attended+" of 8"));
    var c=el("td",{"class":"chart"});c.appendChild(chart(m,140,30,false));tr.appendChild(c);
    tr.addEventListener("click",function(){select(m.code)});
    tr.addEventListener("keydown",function(e){
      if(e.key==="Enter"||e.key===" "){e.preventDefault();select(m.code)}
      else if(e.key==="ArrowDown"&&tr.nextElementSibling){e.preventDefault();tr.nextElementSibling.focus()}
      else if(e.key==="ArrowUp"&&tr.previousElementSibling){e.preventDefault();tr.previousElementSibling.focus()}
    });
    body.appendChild(tr);
  });
  $("count").textContent=list.length===D.members.length?list.length+" slipping regular"+(list.length===1?"":"s"):"Showing "+list.length+" of "+D.members.length;
  $("empty").hidden=list.length>0||D.members.length===0;
  if(D.members.length===0){$("empty").hidden=false;$("empty").textContent="No regulars are slipping in this data."}
  document.querySelectorAll("th[data-sort]").forEach(function(th){
    th.setAttribute("aria-sort",th.getAttribute("data-sort")===state.sort?(state.dir>0?"ascending":"descending"):"none")});
}
function select(code){
  state.selected=code;var m=D.members.find(function(x){return x.code===code});var d=$("detail");d.textContent="";
  document.querySelectorAll("#rows tr").forEach(function(tr){tr.setAttribute("aria-selected",String(tr.getAttribute("data-code")===code))});
  if(!m)return;
  d.appendChild(el("h2",null,m.name));
  var share=m.usual>0?Math.round(m.last3/m.usual*100):0;
  d.appendChild(el("p",{"class":"says"},"Usually "+one(m.usual)+" days a week. The last 3 weeks averaged "+one(m.last3)+" ("+share+"% of usual). Last visit "+fmtDay(m.lastVisit)+"."));
  d.appendChild(chart(m,300,130,true));
  var lg=el("div",{"class":"legend"});
  var a=el("span");a.appendChild(el("i",{style:"background:var(--bar)"}));a.appendChild(document.createTextNode("Usual weeks"));lg.appendChild(a);
  var b=el("span");b.appendChild(el("i",{style:"background:var(--bar-recent)"}));b.appendChild(document.createTextNode("Last 3 weeks"));lg.appendChild(b);
  var c=el("span");c.appendChild(el("i",{"class":"dash"}));c.appendChild(document.createTextNode("Usual rate"));lg.appendChild(c);
  d.appendChild(lg);
  var dl=el("dl");
  [["Weeks attended",m.attended+" of 8"],["Last 3 weeks",m.last3Weeks.join(", ")+" days"],["Client ID",m.id||"—"],["Location",m.location||"—"],["Code",m.code],
   ["Weeks shown","From the week of "+shortDay(D.mondays[0])+" to the week of "+shortDay(D.mondays[11])+". Faded bars are outside the 11 weeks compared."]].forEach(function(r){dl.appendChild(el("dt",null,r[0]));dl.appendChild(el("dd",null,r[1]))});
  d.appendChild(dl);
}
$("q").addEventListener("input",function(e){state.q=e.target.value;render()});
$("loc").addEventListener("change",function(e){state.loc=e.target.value;render()});
$("sort").addEventListener("change",function(e){state.sort=e.target.value;state.dir=defaultDir[state.sort];render()});
document.querySelectorAll("th[data-sort] button").forEach(function(btn){btn.addEventListener("click",function(){
  var s=btn.parentElement.getAttribute("data-sort");if(state.sort===s)state.dir=-state.dir;else{state.sort=s;state.dir=defaultDir[s]}$("sort").value=s;render()})});
$("foot").textContent="Generated "+new Date(D.generatedAt).toLocaleString()+". Thresholds: "+T.minWeeksAttended+" of 8 weeks, "+T.minUsualPerWeek+"+ a week, drop to "+pct+"% or less.";
window.addEventListener("beforeprint",function(){document.querySelector(".rule details").open=true});
render();
if(D.members[0]&&window.matchMedia("(min-width: 901px)").matches)select(visible()[0].code);
})();
`;
