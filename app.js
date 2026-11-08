(function(){
"use strict";

/* ---------- settings ---------- */
const CFG = window.PLATED_CONFIG || {};
const FB = CFG.firebase || {};
const FB_READY = !!(window.firebase && FB.apiKey && !/PASTE/.test(FB.apiKey) && FB.projectId && !/PASTE/.test(FB.projectId));
const HOUSE = CFG.household || "gigi";
const MODEL = CFG.claudeModel || "claude-sonnet-5-5";
const KEY_LS = "plated-claude-key";
const APP_VERSION = "13 · Nov 7";
const getKey = () => { try { return localStorage.getItem(KEY_LS) || ""; } catch(e){ return ""; } };
const setKey = v => { try { v ? localStorage.setItem(KEY_LS, v) : localStorage.removeItem(KEY_LS); } catch(e){} };

/* ---------- tiny DOM helper ---------- */
function h(tag, props){
  const el = document.createElement(tag);
  if (props) for (const k in props){
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
  return el;
}
function add(el, c){
  if (c == null || c === false) return;
  if (Array.isArray(c)) { c.forEach(x => add(el, x)); return; }
  el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
}
function put(el){ for (let i = 1; i < arguments.length; i++) add(el, arguments[i]); }
function grow(el){ el.style.height = "auto"; el.style.height = el.scrollHeight + 2 + "px"; }
const $ = s => document.querySelector(s);
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ---------- pans ---------- */
const PANS = [
  {k:"sq8",   label:"8×8 square",            shape:"rect",  a:8,   b:8},
  {k:"sq9",   label:"9×9 square",            shape:"rect",  a:9,   b:9},
  {k:"r7x11", label:"7×11 baking dish",      shape:"rect",  a:7,   b:11},
  {k:"r9x13", label:"9×13 baking dish",      shape:"rect",  a:9,   b:13},
  {k:"r10x15",label:"10×15 jelly-roll pan",  shape:"rect",  a:10,  b:15},
  {k:"half",  label:"12×17 half sheet",      shape:"rect",  a:12,  b:17},
  {k:"loaf8", label:"8½×4½ loaf pan",        shape:"rect",  a:4.5, b:8.5},
  {k:"loaf9", label:"9×5 loaf pan",          shape:"rect",  a:5,   b:9},
  {k:"rd8",   label:"8\" round",             shape:"round", a:8},
  {k:"rd9",   label:"9\" round or pie plate",shape:"round", a:9},
  {k:"rd10",  label:"10\" round or skillet", shape:"round", a:10},
  {k:"rd12",  label:"12\" skillet",          shape:"round", a:12}
];
const panByKey = k => PANS.find(p => p.k === k);
function areaOf(p){ if (!p || !p.a) return 0; return p.shape === "round" ? Math.PI * (p.a/2) ** 2 : p.a * (p.b || p.a); }
const trimNum = n => String(Math.round(n * 100) / 100);
function panName(p){
  if (!p) return "";
  const pre = p.k && p.k !== "custom" && panByKey(p.k);
  const base = pre ? pre.label : (p.shape === "round" ? `${trimNum(p.a)}" round` : `${trimNum(p.a)}×${trimNum(p.b || p.a)} pan`);
  return (p.count > 1 ? p.count + " × " : "") + base;
}
function panFromDims(d){
  if (!d || !d.width) return null;
  const shape = d.shape === "round" ? "round" : "rect";
  const a = +d.width, b = +(d.length || d.width);
  if (!(a > 0)) return null;
  if (shape === "round") { const m = PANS.find(p => p.shape === "round" && p.a === a); return m ? {k:m.k, shape, a, count:1} : {k:"custom", shape, a, count:1}; }
  const lo = Math.min(a,b), hi = Math.max(a,b);
  const m = PANS.find(p => p.shape === "rect" && Math.min(p.a,p.b) === lo && Math.max(p.a,p.b) === hi);
  return m ? {k:m.k, shape, a:m.a, b:m.b, count:1} : {k:"custom", shape, a:lo, b:hi, count:1};
}

/* ---------- ingredient parsing ---------- */
const FR = {"½":"1/2","⅓":"1/3","⅔":"2/3","¼":"1/4","¾":"3/4","⅛":"1/8","⅜":"3/8","⅝":"5/8","⅞":"7/8","⅕":"1/5","⅖":"2/5","⅙":"1/6","⅚":"5/6"};
function normFracs(s){
  return s.replace(/⁄/g, "/").replace(/(\d)?\s*([½⅓⅔¼¾⅛⅜⅝⅞⅕⅖⅙⅚])/g, (m, d, f) => (d ? d + " " : "") + FR[f]);
}
function num(t){
  t = t.trim(); let m;
  if ((m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3];
  if ((m = t.match(/^(\d+)\/(\d+)$/))) return m[1] / m[2];
  return parseFloat(t);
}
const NUMRE = "(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d*\\.\\d+|\\d+)";
const QTY_RE = new RegExp("^(" + NUMRE + ")(?:\\s*(?:-|–|to)\\s*(" + NUMRE + "))?\\s*");
const UNIT_ALIASES = {
  tsp:["teaspoons","teaspoon","tsps","tsp"], tbsp:["tablespoons","tablespoon","tbsps","tbsp","tbs","tbl"],
  cup:["cups","cup"], floz:["fluid ounces","fluid ounce","fl. oz.","fl oz"], pint:["pints","pint","pt"],
  quart:["quarts","quart","qt"], gallon:["gallons","gallon","gal"], ml:["milliliters","millilitres","milliliter","ml"],
  l:["liters","litres","liter","litre"], oz:["ounces","ounce","oz"], lb:["pounds","pound","lbs","lb"],
  g:["grams","gram","g"], kg:["kilograms","kilogram","kg"], pinch:["pinches","pinch"], dash:["dashes","dash"],
  clove:["cloves","clove"], can:["cans","can"], jar:["jars","jar"], stick:["sticks","stick"],
  pkg:["packages","package","packets","packet","pkgs","pkg","boxes","box","bags","bag"], slice:["slices","slice"],
  bunch:["bunches","bunch"], sprig:["sprigs","sprig"], head:["heads","head"], piece:["pieces","piece"]
};
const ALIAS_LIST = [];
for (const u in UNIT_ALIASES) UNIT_ALIASES[u].forEach(a => ALIAS_LIST.push([a, u]));
ALIAS_LIST.sort((x, y) => y[0].length - x[0].length);
function matchUnit(s){
  if (/^T\.?(?=\s)/.test(s)) return {unit:"tbsp", len:s.match(/^T\.?/)[0].length};
  if (/^t\.?(?=\s)/.test(s)) return {unit:"tsp", len:s.match(/^t\.?/)[0].length};
  if (/^c\.?(?=\s)/i.test(s)) return {unit:"cup", len:s.match(/^c\.?/i)[0].length};
  const low = s.toLowerCase();
  for (const [a, u] of ALIAS_LIST){
    if (low.startsWith(a)){
      const next = low.charAt(a.length);
      if (next === "" || next === " " || next === "," || next === "." || next === ")") return {unit:u, len:a.length + (next === "." ? 1 : 0)};
    }
  }
  return null;
}
const parseCache = new Map();
function parseLine(raw){
  if (parseCache.has(raw)) return parseCache.get(raw);
  let s = normFracs(String(raw).trim()).replace(/^[-–•*·▢☐□]\s*/, "");
  let out;
  if (!s) out = null;
  else if (/:\s*$/.test(s) && !/^\d/.test(s)) out = {header: s.replace(/:\s*$/, "")};
  else {
    let qty = null, qtyMax = null, unit = null, size = "";
    const m = s.match(QTY_RE);
    if (m){ qty = num(m[1]); if (m[2]) qtyMax = num(m[2]); s = s.slice(m[0].length); }
    const pm = s.match(/^\(([^)]*)\)\s*/);
    if (pm && qty != null){ size = pm[1]; s = s.slice(pm[0].length); }
    const um = qty != null ? matchUnit(s) : null;
    if (um){ unit = um.unit; s = s.slice(um.len).trim(); }
    s = s.replace(/^of\s+/i, "");
    let item = s, note = "";
    const ci = s.indexOf(",");
    if (ci > 0){ item = s.slice(0, ci).trim(); note = s.slice(ci + 1).trim(); }
    const tt = item.match(/^(.*?)\s+(to taste|as needed|for serving|for garnish|optional)$/i);
    if (tt){ item = tt[1]; note = note ? tt[2] + ", " + note : tt[2]; }
    out = {qty, qtyMax, unit, size, item: item.trim(), note};
  }
  parseCache.set(raw, out);
  return out;
}

/* ---------- amounts ---------- */
const VOL = {tsp:1, tbsp:3, cup:48, floz:6, pint:96, quart:192, gallon:768};
const KITCHEN_VOL = {tsp:1, tbsp:1, cup:1};
const WT = {oz:1, lb:16};
const FRACS = [[0,""],[1/8,"⅛"],[1/4,"¼"],[1/3,"⅓"],[3/8,"⅜"],[1/2,"½"],[5/8,"⅝"],[2/3,"⅔"],[3/4,"¾"],[7/8,"⅞"],[1,""]];
function nice(n){
  if (n >= 10){ const v = Math.round(n * 2) / 2; return {v, s: Math.floor(v) + (v % 1 ? "½" : "")}; }
  const w = Math.floor(n), f = n - w;
  let best = FRACS[0];
  for (const c of FRACS) if (Math.abs(f - c[0]) < Math.abs(f - best[0])) best = c;
  const whole = w + (best[0] === 1 ? 1 : 0);
  const v = whole + (best[0] === 1 ? 0 : best[0]);
  if (v === 0) return {v:1/8, s:"⅛"};
  return {v, s: (whole ? String(whole) : "") + best[1]};
}
const relErr = (a, b) => Math.abs(a - b) / b;
const LABEL = {tsp:["tsp","tsp"], tbsp:["tbsp","tbsp"], cup:["cup","cups"], floz:["fl oz","fl oz"], pint:["pint","pints"], quart:["quart","quarts"], gallon:["gallon","gallons"], ml:["ml","ml"], l:["L","L"], oz:["oz","oz"], lb:["lb","lb"], g:["g","g"], kg:["kg","kg"], pinch:["pinch","pinches"], dash:["dash","dashes"], clove:["clove","cloves"], can:["can","cans"], jar:["jar","jars"], stick:["stick","sticks"], pkg:["package","packages"], slice:["slice","slices"], bunch:["bunch","bunches"], sprig:["sprig","sprigs"], head:["head","heads"], piece:["piece","pieces"]};
const lab = (u, v) => LABEL[u] ? LABEL[u][v > 1 ? 1 : 0] : (u || "");
function fmtVolume(tsp){
  if (tsp >= 12){
    const cups = tsp / 48, n = nice(cups);
    if (relErr(n.v, cups) <= 0.05) return n.s + " " + lab("cup", n.v);
    const q = Math.floor(cups * 4) / 4, remT = (tsp - q * 48) / 3, t = nice(remT);
    return (q ? nice(q).s + " " + lab("cup", q) + " + " : "") + t.s + " tbsp";
  }
  if (tsp >= 3){
    const tb = tsp / 3, n = nice(tb);
    if (relErr(n.v, tb) <= 0.07) return n.s + " tbsp";
    const w = Math.floor(tb), r = nice(tsp - w * 3);
    return w + " tbsp + " + r.s + " tsp";
  }
  return nice(tsp).s + " tsp";
}
function fmtWeight(oz){
  if (oz >= 16){ const n = nice(oz / 16); return n.s + " lb"; }
  return nice(oz).s + " oz";
}
function fmtMetric(v, small, big){
  if (v >= 1000) return (Math.round(v / 100) / 10) + " " + big;
  return Math.round(v >= 100 ? v / 5 : v) * (v >= 100 ? 5 : 1) + " " + small;
}
const COUNTABLE = {"":1, can:1, jar:1, pkg:1, head:1, bunch:1};
function amountOf(p, factor){
  if (!p || p.qty == null || isNaN(p.qty)) return {text:"", hint:""};
  const q = p.qty * factor, size = p.size ? " (" + p.size + ")" : "";
  if (p.qtyMax != null){
    const a = nice(q), b = nice(p.qtyMax * factor);
    return {text: a.s + "–" + b.s + (p.unit ? " " + lab(p.unit, b.v) : "") + size, hint:""};
  }
  const u = p.unit || "";
  if (KITCHEN_VOL[u]) return {text: fmtVolume(q * VOL[u]), hint:""};
  if (WT[u]) return {text: fmtWeight(q * WT[u]), hint:""};
  if (u === "g" || u === "kg") return {text: fmtMetric(q * (u === "kg" ? 1000 : 1), "g", "kg"), hint:""};
  if (u === "ml" || u === "l") return {text: fmtMetric(q * (u === "l" ? 1000 : 1), "ml", "L"), hint:""};
  const n = nice(q);
  let hint = "";
  if (COUNTABLE[u] !== undefined && factor !== 1 && Math.abs(q - Math.round(q)) > 0.01 && Math.abs((q % 1) - 0.5) > 0.01) hint = "≈ " + Math.max(1, Math.round(q));
  return {text: n.s + (u ? " " + lab(u, n.v) : "") + size, hint};
}
function totalAmount(parts){
  let vol = 0, wt = 0, g = 0, ml = 0, loose = false;
  const other = {};
  for (const p of parts){
    if (p.qty == null || isNaN(p.qty)){ loose = true; continue; }
    const u = p.unit || "";
    if (VOL[u]) vol += p.qty * VOL[u];
    else if (WT[u]) wt += p.qty * WT[u];
    else if (u === "g" || u === "kg") g += p.qty * (u === "kg" ? 1000 : 1);
    else if (u === "ml" || u === "l") ml += p.qty * (u === "l" ? 1000 : 1);
    else other[u] = (other[u] || 0) + p.qty;
  }
  const out = [];
  if (vol) out.push(fmtVolume(vol));
  if (wt) out.push(fmtWeight(wt));
  if (g) out.push(fmtMetric(g, "g", "kg"));
  if (ml) out.push(fmtMetric(ml, "ml", "L"));
  for (const u in other){ const n = nice(other[u]); const r = Math.abs(other[u] - Math.round(other[u])) > 0.01 ? Math.ceil(other[u]) : null; out.push((r ? r : n.s) + (u ? " " + lab(u, r || n.v) : "")); }
  if (!out.length && loose) out.push("as needed");
  return out.join(" + ");
}

/* ---------- grocery helpers ---------- */
const DESCRIPTORS = /\b(fresh|freshly|large|medium|small|extra|finely|roughly|coarsely|thinly|chopped|diced|minced|sliced|softened|melted|cold|warm|room[- ]temperature|packed|divided|lightly|beaten|peeled|trimmed|rinsed|drained|halved|cubed|grated|zested|juiced)\b/gi;
function cleanName(item){
  return item.replace(/^\s*optional\s*:?\s*/i, "").replace(/\([^)]*\)/g, "").replace(DESCRIPTORS, "").replace(/\s{2,}/g, " ").replace(/^[\s,-]+|[\s,-]+$/g, "").trim() || item.trim();
}
function keyOf(item){
  const k = cleanName(item).toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const words = k.split(" "), last = words.pop() || "";
  let s = last;
  if (/ies$/.test(last) && last.length > 4) s = last.slice(0, -3) + "y";
  else if (/oes$/.test(last)) s = last.slice(0, -2);
  else if (/s$/.test(last) && !/ss$/.test(last) && last.length > 3) s = last.slice(0, -1);
  words.push(s);
  return words.join(" ");
}
const CATS = ["Produce","Meat & Seafood","Dairy & Eggs","Bakery & Bread","Pantry & Baking","Spices & Seasonings","Canned & Jarred","Frozen","Other"];
const CAT_RULES = [
  ["Canned & Jarred", /\b(broth|stock|enchilada sauce|tomato (sauce|paste)|diced tomatoes|crushed tomatoes|salsa|canned|black beans|kidney beans|pinto beans|cannellini|chickpeas|coconut milk|pasta sauce|marinara|pickles?|olives?|jam|peanut butter|evaporated milk|condensed milk)\b/],
  ["Frozen", /\b(frozen|ice cream)\b/],
  ["Spices & Seasonings", /\b(salt|black pepper|white pepper|peppercorns?|cumin|paprika|cinnamon|nutmeg|oregano|dried \w+|chili powder|cayenne|garlic powder|onion powder|bay lea(f|ves)|seasoning|turmeric|curry powder|allspice|red pepper flakes|vanilla|ground (ginger|cloves|coriander|mustard))\b/],
  ["Meat & Seafood", /\b(beef|chicken|pork|turkey|sausage|bacon|ham|lamb|shrimp|salmon|fish|tuna|cod|tilapia|steak|chorizo|meatballs?)\b/],
  ["Dairy & Eggs", /\b(butter|milk|cream|cheese|cheddar|mozzarella|parmesan|yogurt|eggs?|yolks?|buttermilk|half-and-half|ricotta)\b/],
  ["Produce", /\b(onions?|garlic|shallots?|lemons?|limes?|oranges?|apples?|bananas?|berries|strawberr\w*|blueberr\w*|tomato(es)?|potato(es)?|carrots?|celery|lettuce|spinach|kale|cilantro|parsley|basil|mint|thyme|rosemary|dill|scallions?|green onions?|ginger|jalape(ñ|n)os?|bell peppers?|zucchini|squash|mushrooms?|cucumbers?|avocados?|broccoli|cauliflower|cabbage|green beans|corn|peas|herbs?)\b/],
  ["Bakery & Bread", /\b(bread|tortillas?|buns?|rolls?|bagels?|pita|naan|baguette|croissants?)\b/],
  ["Pantry & Baking", /\b(flour|sugar|baking soda|baking powder|yeast|oil|vinegar|rice|pasta|spaghetti|noodles|oats|honey|maple syrup|chocolate|cocoa|chips|nuts|almonds|pecans|walnuts|breadcrumbs|panko|cornstarch|soy sauce|ketchup|mustard|mayonnaise|mayo|syrup|extract|raisins|cornmeal|sprinkles|cooking spray|marshmallows?)\b/]
];
function categorize(item){
  const s = item.toLowerCase();
  for (const [c, re] of CAT_RULES) if (re.test(s)) return c;
  return "Other";
}
const STAPLES = new Set(["water","ice","ice water","warm water","cold water","hot water","salt","kosher salt","sea salt","table salt","black pepper","pepper","ground black pepper","salt and pepper","salt and black pepper"]);
const isStaple = item => STAPLES.has(cleanName(item).toLowerCase().replace(/\s+/g, " "));
const STORES = {
  ht: {name:"Harris Teeter", url: q => "https://www.harristeeter.com/search?query=" + encodeURIComponent(q) + "&searchType=default_search"},
  wm: {name:"Walmart", url: q => "https://www.walmart.com/search?q=" + encodeURIComponent(q)}
};
const SOURCES = {web:"Website", card:"Recipe card", ai:"AI chat", typed:"Typed in"};

/* ---------- example recipes (loaded on request) ---------- */
const EXAMPLES = [
  {title:"Brown Butter Chocolate Chip Bars", source:"typed", example:true, servings:16, pan:{k:"sq8", shape:"rect", a:8, b:8, count:1},
   ingredients:[{line:"1/2 cup unsalted butter",category:"Dairy & Eggs"},{line:"3/4 cup packed light brown sugar",category:"Pantry & Baking"},{line:"1 large egg",category:"Dairy & Eggs"},{line:"1 tsp vanilla extract",category:"Spices & Seasonings"},{line:"1 cup all-purpose flour",category:"Pantry & Baking"},{line:"1/2 tsp baking soda",category:"Pantry & Baking"},{line:"1/4 tsp kosher salt",category:"Spices & Seasonings"},{line:"1 cup semisweet chocolate chips",category:"Pantry & Baking"}],
   steps:["Heat the oven to 350°F and line the pan with parchment.","Melt the butter in a light-colored pan over medium heat and cook, swirling, until it smells nutty and the bits on the bottom turn golden brown. Pour into a bowl and cool 10 minutes.","Whisk in the brown sugar, then the egg and vanilla, until glossy.","Stir in the flour, baking soda and salt, then fold in the chocolate chips.","Spread in the pan and bake 22–25 minutes, until the edges are golden and the center is just set. Cool before cutting."],
   notes:"Example recipe. Try scaling it to a 9×13 dish."},
  {title:"Weeknight Chicken Enchiladas", source:"web", example:true, servings:6, pan:{k:"r9x13", shape:"rect", a:9, b:13, count:1},
   ingredients:[{line:"1 1/2 lb boneless skinless chicken breasts",category:"Meat & Seafood"},{line:"2 (10 oz) cans red enchilada sauce",category:"Canned & Jarred"},{line:"8 flour tortillas (8-inch)",category:"Bakery & Bread"},{line:"2 cups shredded Mexican-blend cheese",category:"Dairy & Eggs"},{line:"1 small yellow onion, diced",category:"Produce"},{line:"2 cloves garlic, minced",category:"Produce"},{line:"1 tsp ground cumin",category:"Spices & Seasonings"},{line:"1/2 cup sour cream",category:"Dairy & Eggs"},{line:"1/4 cup chopped cilantro",category:"Produce"},{line:"Salt and pepper to taste",category:"Spices & Seasonings"}],
   steps:["Heat the oven to 375°F.","Simmer the chicken in one can of enchilada sauce, covered, for 15 minutes. Shred with two forks.","Soften the onion and garlic in a little oil, add the cumin, then stir in the chicken, sour cream and half the cheese. Season with salt and pepper.","Spread a thin layer of sauce in the dish. Fill and roll the tortillas and set them seam-side down.","Pour the remaining sauce over the top, sprinkle with the rest of the cheese, and bake 20 minutes until bubbling. Finish with cilantro."],
   notes:"Example recipe."},
  {title:"Lemon Garlic Green Beans", source:"ai", example:true, servings:4, pan:null,
   ingredients:[{line:"1 lb green beans, trimmed",category:"Produce"},{line:"2 tbsp olive oil",category:"Pantry & Baking"},{line:"3 cloves garlic, thinly sliced",category:"Produce"},{line:"1 lemon",category:"Produce"},{line:"1/2 tsp kosher salt",category:"Spices & Seasonings"}],
   steps:["Blanch the beans in salted boiling water for 3 minutes, then drain.","Warm the olive oil and garlic in a large skillet until the garlic is pale gold.","Add the beans and salt and toss for 2 minutes. Finish with the lemon's zest and a squeeze of juice."],
   notes:"Example recipe. Scale it by servings."}
];

/* ---------- state ---------- */
const S = {
  mode:"loading", user:null, authError:"", recipes:[], grocery:emptyGrocery(), loadedR:false, slow:false, dbError:"",
  view:"recipes", rid:null, q:"", scale:null, confirmDel:false, confirmClear:false,
  exportStyle:"names", sheet:null
};
function emptyGrocery(){ return {items:[], recipes:[], store:"ht"}; }

/* ---------- storage: this device only ---------- */
const LS_KEY = "plated-by-gigi-v1";
function lsRead(){ try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch(e){ return null; } }
function lsWrite(){ try { localStorage.setItem(LS_KEY, JSON.stringify({recipes:S.recipes, grocery:S.grocery, saved:S.saved || []})); } catch(e){} }
function startLocal(){
  S.mode = "local";
  const d = lsRead();
  if (d){ S.recipes = d.recipes || []; S.grocery = d.grocery || emptyGrocery(); S.saved = d.saved || []; }
  else { S.recipes = EXAMPLES.map((r, i) => ({...clone(r), id: uid(), createdAt: Date.now() - i, updatedAt: Date.now() - i})); lsWrite(); }
  S.loadedR = true;
  render();
}

/* ---------- storage: shared Firebase household ---------- */
let auth = null, fdb = null, unsubs = [], loadTimer = null;
const house = () => fdb.collection("households").doc(HOUSE);
function startFirebase(){
  try {
    firebase.initializeApp(FB);
    auth = firebase.auth();
    fdb = firebase.firestore();
    fdb.enablePersistence({synchronizeTabs:true}).catch(() => {});
  } catch(e){ S.mode = "gate"; S.authError = "Plated couldn't start Firebase. Check the settings in config.js."; render(); return; }
  auth.getRedirectResult().catch(e => { S.authError = authMessage(e); render(); });
  auth.onAuthStateChanged(u => {
    stopSubs();
    S.user = u;
    S.recipes = []; S.grocery = emptyGrocery(); S.saved = []; S.loadedR = false; S.dbError = "";
    if (!u){ S.mode = "gate"; render(); return; }
    S.mode = "db"; S.authError = "";
    subscribe();
    render();
  });
}
function stopSubs(){ unsubs.forEach(f => { try { f(); } catch(e){} }); unsubs = []; clearTimeout(loadTimer); }
function subscribe(){
  S.slow = false;
  loadTimer = setTimeout(() => { if (!S.loadedR){ S.slow = true; render(); } }, 10000);
  unsubs.push(house().collection("recipes").onSnapshot(snap => {
    S.recipes = snap.docs.map(d => Object.assign({id:d.id}, d.data()));
    S.loadedR = true;
    if (!snap.metadata.fromCache){ clearTimeout(loadTimer); S.slow = false; }
    render();
  }, dbFail));
  unsubs.push(house().collection("lists").doc("grocery").onSnapshot(snap => {
    S.grocery = snap.exists ? Object.assign(emptyGrocery(), snap.data()) : emptyGrocery();
    render();
  }, dbFail));
  unsubs.push(house().collection("lists").doc("saved").onSnapshot(snap => {
    S.saved = snap.exists && Array.isArray(snap.data().items) ? snap.data().items : [];
    render();
  }, dbFail));
}
function dbFail(err){
  clearTimeout(loadTimer);
  if (err && err.code === "permission-denied"){ stopSubs(); S.mode = "denied"; }
  else { S.loadedR = true; S.dbError = "The recipe box couldn't load. Reopen Plated to try again."; }
  render();
}
async function signIn(){
  S.authError = ""; render();
  const p = new firebase.auth.GoogleAuthProvider();
  p.setCustomParameters({prompt:"select_account"});
  try { await auth.signInWithPopup(p); }
  catch(e){
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment"){
      try { await auth.signInWithRedirect(p); } catch(e2){ S.authError = authMessage(e2); render(); }
    } else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request"){ S.authError = authMessage(e); render(); }
  }
}
function authMessage(e){
  const c = e && e.code;
  if (c === "auth/unauthorized-domain") return `Firebase doesn't allow sign-in from ${location.hostname} yet. In the Firebase console, open Authentication → Settings → Authorized domains and add ${location.hostname}.`;
  if (c === "auth/operation-not-allowed") return "Google sign-in isn't turned on. In the Firebase console, open Authentication → Sign-in method and enable Google.";
  if (c === "auth/network-request-failed") return "Couldn't reach Google. Check your connection and try again.";
  return "Sign-in didn't work" + (c ? " (" + c + ")" : "") + ". Try again.";
}
const signOut = () => { if (auth) auth.signOut(); closeSheet(); };

/* ---------- writes ---------- */
function saveRecipe(r){
  const body = clone(r); delete body.id;
  body.updatedAt = Date.now(); if (!body.createdAt) body.createdAt = body.updatedAt;
  if (S.mode === "db"){
    const ref = r.id ? house().collection("recipes").doc(r.id) : house().collection("recipes").doc();
    upsertLocal(Object.assign({id:ref.id}, body));
    ref.set(body).catch(e => toast(e.code === "permission-denied" ? "This account can't save to Plated." : "Couldn't save that recipe. Check your connection and try again."));
    return ref.id;
  }
  const id = r.id || uid();
  upsertLocal(Object.assign({id}, body)); lsWrite();
  return id;
}
function upsertLocal(r){ const i = S.recipes.findIndex(x => x.id === r.id); if (i >= 0) S.recipes[i] = r; else S.recipes.push(r); }
function deleteRecipe(id){
  S.recipes = S.recipes.filter(r => r.id !== id);
  if (S.grocery.recipes.some(x => x.rid === id)) saveGrocery(removeRecipeFromList(clone(S.grocery), id));
  if (S.mode === "db") house().collection("recipes").doc(id).delete().catch(() => toast("Couldn't delete that recipe. Try again."));
  else lsWrite();
}
function saveGrocery(g){
  S.grocery = g; render();
  if (S.mode === "db") house().collection("lists").doc("grocery").set(clone(g)).catch(() => toast("Couldn't save the grocery list. Check your connection."));
  else lsWrite();
}

/* ---------- grocery list ops ---------- */
function removeRecipeFromList(g, rid){
  g.items.forEach(it => { it.parts = (it.parts || []).filter(p => p.rid !== rid); });
  g.items = g.items.filter(it => it.manual || it.parts.length);
  g.recipes = g.recipes.filter(r => r.rid !== rid);
  return g;
}
function addRecipeToList(recipe, factor, label){
  const g = removeRecipeFromList(clone(S.grocery), recipe.id);
  for (const ing of recipe.ingredients || []){
    const p = parseLine(ing.line);
    if (!p || p.header || !p.item) continue;
    const key = keyOf(p.item);
    let it = g.items.find(x => x.key === key);
    if (!it){
      const optional = /^\s*optional\b|\(optional\)|,\s*optional\b/i.test(ing.line);
      it = {id: uid(), key, name: cap(cleanName(p.item)), category: CATS.includes(ing.category) ? ing.category : categorize(p.item), parts: [], status: isStaple(p.item) || optional ? "have" : "need", got:false};
      g.items.push(it);
    }
    it.parts.push({rid: recipe.id, title: recipe.title, qty: p.qty == null ? null : p.qty * factor, unit: p.unit || ""});
  }
  g.recipes.push({rid: recipe.id, title: recipe.title, factor, label});
  saveGrocery(g);
}
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/* ---------- toast ---------- */
let toastT;
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200); }

/* ---------- routing ---------- */
function readHash(){
  const hsh = (location.hash || "").slice(1);
  if (hsh === "list") { S.view = "list"; S.rid = null; }
  else if (hsh.startsWith("r-")) {
    const id = hsh.slice(2);
    if (S.rid !== id){ S.rid = id; S.scale = null; S.confirmDel = false; }
    S.view = "recipe";
  }
  else { S.view = "recipes"; S.rid = null; }
}
function go(hsh){ if (location.hash !== "#" + hsh) location.hash = hsh; else { readHash(); render(); } window.scrollTo(0, 0); }
window.addEventListener("hashchange", () => { readHash(); render(); window.scrollTo(0, 0); });
$("#tab-recipes").addEventListener("click", () => go("recipes"));
$("#tab-list").addEventListener("click", () => go("list"));
$("#acct").addEventListener("click", () => openSettings());

/* ---------- render ---------- */
function keepFocus(fn){
  const a = document.activeElement, id = a && a.id;
  let sel = null; try { sel = id && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null; } catch(e){}
  fn();
  if (id){ const n = document.getElementById(id); if (n && n !== a){ n.focus({preventScroll:true}); if (sel) try { n.setSelectionRange(sel[0], sel[1]); } catch(e){} } }
}
function render(){
  wantWake(S.view === "recipe" && (S.mode === "db" || S.mode === "local") && S.recipes.some(x => x.id === S.rid));
  keepFocus(() => {
    const inApp = S.mode === "db" || S.mode === "local";
    $("#tabs").hidden = !inApp;
    const acct = $("#acct"); acct.hidden = !inApp;
    if (S.user){ const n = (S.user.displayName || S.user.email || "?").trim(); acct.textContent = n.charAt(0).toUpperCase(); }
    else acct.textContent = "⚙";
    $("#tab-recipes").setAttribute("aria-current", S.view !== "list" ? "page" : "false");
    $("#tab-list").setAttribute("aria-current", S.view === "list" ? "page" : "false");
    const need = S.grocery.items.filter(i => i.status === "need" && !i.got).length;
    const lc = $("#listcount"); lc.hidden = !need; lc.textContent = need;
    const app = $("#app"); app.textContent = "";
    if (S.mode === "loading") app.append(h("p", {class:"note"}, "Opening the recipe box…"));
    else if (S.mode === "gate") app.append(viewGate());
    else if (S.mode === "denied") app.append(viewDenied());
    else if (!S.loadedR) app.append(h("p", {class:"note"}, S.slow ? "The recipe box can't be reached yet. It will appear as soon as the connection catches up." : "Opening the recipe box…"));
    else if (S.view === "list") app.append(viewList());
    else if (S.view === "recipe") app.append(viewRecipe());
    else app.append(viewBox());
    renderSheet();
  });
  document.querySelectorAll("textarea.auto").forEach(grow);
}

/* ---------- view: sign-in / setup ---------- */
const GOOGLE_G = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
function viewGate(){
  if (!FB_READY){
    return h("section", {class:"gate"},
      h("div", {class:"hd"}, h("h1", null, "Plated w/ GiGi"), h("p", null, "The shared recipe box isn't connected yet.")),
      h("div", {class:"gb"},
        h("p", null, "To share recipes and the grocery list between phones, Plated needs its Firebase settings. Paste them into ", h("code", null, "config.js"), " in the GitHub repo. The README has the full steps."),
        h("p", null, "You can still try everything now. Recipes made this way stay in this browser."),
        h("div", {class:"row"}, h("button", {class:"btn primary", type:"button", onclick:startLocal}, "Use on this device only"))));
  }
  return h("section", {class:"gate"},
    h("div", {class:"hd"}, h("h1", null, "Plated w/ GiGi"), h("p", null, "The family recipe box and grocery list.")),
    h("div", {class:"gb"},
      h("p", null, "Sign in with your Google account. Only the family accounts on the list can open the recipe box."),
      h("div", null, h("button", {class:"btn primary gbtn", type:"button", onclick:signIn}, h("span", {html:GOOGLE_G, style:"display:inline-flex;background:#fff;border-radius:50%;padding:3px"}), "Sign in with Google")),
      S.authError ? h("p", {class:"err"}, S.authError) : null));
}
function viewDenied(){
  const email = S.user && S.user.email;
  return h("section", {class:"gate"},
    h("div", {class:"hd"}, h("h1", null, "Not on the list"), h("p", null, email ? email + " can't open this recipe box." : "This account can't open this recipe box.")),
    h("div", {class:"gb"},
      h("p", null, "Sign in with one of the family's Google accounts. To add an account, put its email address in the Firestore rules in the Firebase console."),
      h("div", {class:"row"}, h("button", {class:"btn primary", type:"button", onclick:() => auth.signOut()}, "Use a different account"))));
}

/* ---------- view: recipe box ---------- */
function viewBox(){
  const f = document.createDocumentFragment();
  if (S.mode === "local") put(f, h("div", {class:"banner"}, "These recipes are saved in this browser only, not shared."));
  if (S.dbError) put(f, h("div", {class:"banner"}, S.dbError));
  const q = S.q.trim().toLowerCase();
  const list = S.recipes.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .filter(r => !q || (r.title || "").toLowerCase().includes(q) || (r.ingredients || []).some(i => i.line.toLowerCase().includes(q)));
  put(f, h("div", {class:"boxhead"},
    h("h1", null, "Recipe box"),
    S.recipes.length ? h("input", {class:"search", id:"q", type:"search", placeholder:"Search recipes or ingredients", value:S.q, "aria-label":"Search recipes", oninput:e => { S.q = e.target.value; render(); }}) : null,
    h("button", {class:"btn primary", type:"button", onclick:() => openSheet()}, "+ Add a recipe")
  ));
  if (!S.recipes.length){
    put(f, h("div", {class:"empty"},
      h("h2", null, "No recipes yet"),
      h("p", null, "Add one from a website, a photo of a handwritten card, or a chat with an AI. Or load three example recipes to see how scaling and the grocery list work. You can delete them anytime."),
      h("div", {class:"row"},
        h("button", {class:"btn primary", type:"button", onclick:() => openSheet()}, "Add a recipe"),
        h("button", {class:"btn", type:"button", onclick:loadExamples}, "Load example recipes"))
    ));
    return f;
  }
  const onList = new Set(S.grocery.recipes.map(r => r.rid));
  const grid = h("div", {class:"grid"});
  for (const r of list){
    const ings = (r.ingredients || []).filter(i => { const p = parseLine(i.line); return p && !p.header; }).length;
    put(grid, h("button", {class:"rcard", type:"button", onclick:() => go("r-" + r.id)},
      h("div", {class:"hd"},
        h("div", {class:"chips"}, h("span", {class:"chip"}, SOURCES[r.source] || "Recipe"), r.example ? h("span", {class:"chip ex"}, "Example") : null, onList.has(r.id) ? h("span", {class:"chip on"}, "On list") : null),
        h("div", {class:"tt"}, r.title || "Untitled recipe")),
      h("div", {class:"ruled"},
        h("div", null, [servesText(r) ? "Serves " + servesText(r) : "", timeText(r)].filter(Boolean).join(" · ") || " "),
        h("div", null, r.pan ? panName(r.pan) : "No pan size set"),
        h("div", null, ings + " ingredients · " + (r.steps || []).length + " steps"))
    ));
  }
  if (!q) put(grid, h("button", {class:"addcard", type:"button", onclick:() => openSheet()}, h("span", {class:"plus"}, "+"), "Add a recipe"));
  if (!list.length) put(f, h("p", {class:"note"}, "No recipes match “" + S.q + "”."));
  put(f, grid);
  return f;
}
function loadExamples(){
  EXAMPLES.forEach((ex, i) => saveRecipe(Object.assign(clone(ex), {createdAt: Date.now() - i})));
  render(); toast("Loaded 3 example recipes");
}

/* ---------- view: recipe ---------- */
function defaultScale(r){
  if (r.pan) return {mode:"pan", k:r.pan.k, shape:r.pan.shape, a:r.pan.a, b:r.pan.b, count:r.pan.count || 1, servings:r.servings || 4, mult:1};
  if (r.servings) return {mode:"servings", servings:r.servings, mult:1, k:"r9x13", count:1, shape:"rect", a:9, b:13};
  return {mode:"mult", mult:1, servings:4, k:"r9x13", count:1, shape:"rect", a:9, b:13};
}
function targetPan(sc){
  if (sc.k === "custom") return {k:"custom", shape:sc.shape, a:+sc.a || 0, b:+sc.b || 0, count:sc.count};
  return Object.assign({}, panByKey(sc.k), {count:sc.count});
}
function factorOf(r, sc){
  if (sc.mode === "pan" && r.pan){ const o = areaOf(r.pan) * (r.pan.count || 1), t = areaOf(targetPan(sc)) * sc.count; return o && t ? t / o : 1; }
  if (sc.mode === "servings" && r.servings) return (+sc.servings || r.servings) / r.servings;
  return +sc.mult > 0 ? +sc.mult : 1;
}
function servesText(r){ return r.serves || (r.servings ? String(r.servings) : ""); }
function timeText(r){ return r.totalTime || r.cookTime || ""; }
function fmtFactor(f){ const r = Math.round(f * 100) / 100; return "×" + (Number.isInteger(r) ? r : r.toFixed(2).replace(/0$/, "")); }
function viewRecipe(){
  const r = S.recipes.find(x => x.id === S.rid);
  const f = document.createDocumentFragment();
  put(f, h("div", {class:"back"}, h("button", {class:"btn ghost sm", type:"button", onclick:() => go("recipes")}, "← Recipe box")));
  if (!r){ put(f, h("div", {class:"empty"}, h("h2", null, "Recipe not found"), h("p", null, "It may have been deleted."), h("button", {class:"btn", type:"button", onclick:() => go("recipes")}, "Back to the recipe box"))); return f; }
  if (!S.scale) S.scale = defaultScale(r);
  const sc = S.scale, factor = factorOf(r, sc);
  const um = stepUses(r, factor);
  const onList = S.grocery.recipes.find(x => x.rid === r.id);
  const facts = [["Serves", servesText(r)], ["Prep", r.prepTime], ["Cook", r.cookTime], ["Total", r.totalTime], ["Pan", r.pan ? panName(r.pan) : ""]].filter(x => x[1]);
  const meta = h("div", null,
    facts.length ? h("dl", {class:"facts"}, facts.map(([k, v]) => h("div", null, h("dt", null, k), h("dd", null, String(v))))) : null,
    r.url ? h("div", {class:"meta", style:"margin-top:8px"}, h("a", {href:r.url, target:"_blank", rel:"noopener"}, "Source ↗")) : null);
  put(f, h("section", {class:"dhead"},
    h("div", {class:"hd"},
      h("div", {class:"chips"}, h("span", {class:"chip"}, SOURCES[r.source] || "Recipe"), r.example ? h("span", {class:"chip ex"}, "Example") : null),
      h("h1", null, r.title || "Untitled recipe"), meta),
    S.confirmDel
      ? h("div", {class:"actions"}, h("div", {class:"confirm"}, "Delete this recipe for both of you?",
          h("button", {class:"btn danger solid sm", type:"button", onclick:() => { const id = r.id; S.confirmDel = false; go("recipes"); deleteRecipe(id); toast("Recipe deleted"); }}, "Delete"),
          h("button", {class:"btn sm", type:"button", onclick:() => { S.confirmDel = false; render(); }}, "Keep it")))
      : h("div", {class:"actions"},
          h("button", {class:"btn primary", type:"button", onclick:() => {
            const label = fmtFactor(factor) + (sc.mode === "pan" && r.pan ? " · " + panName(targetPan(sc)) : sc.mode === "servings" ? " · serves " + sc.servings : "");
            addRecipeToList(r, factor, label); toast(onList ? "Grocery list updated" : "Added to the grocery list");
          }}, onList ? "Update grocery list (" + fmtFactor(factor) + ")" : "Add to grocery list (" + fmtFactor(factor) + ")"),
          onList ? h("button", {class:"btn", type:"button", onclick:() => go("list")}, "View list") : null,
          h("button", {class:"btn", type:"button", onclick:() => openSheet(r)}, "Edit"),
          h("button", {class:"btn ghost", type:"button", onclick:() => { S.confirmDel = true; render(); }}, "Delete"))
  ));
  const left = h("div", {class:"panel"}, h("h2", null, "Scale it"), scaler(r, sc, factor),
    h("div", {class:"ings"}, h("h2", null, "Ingredients" + (factor !== 1 ? " · " + fmtFactor(factor) : "")), ingList(r, factor, um)));
  const right = h("div", {class:"sect"}, h("h2", null, "Method"),
    (r.steps || []).length ? h("ol", {class:"steps"}, r.steps.map((t, i) => stepItem(t, i, r, um))) : h("p", {class:"note"}, "No steps saved. Tap Edit to add them."),
    r.notes ? h("div", {class:"notes"}, r.notes) : null);
  put(f, cookBar(r, um), h("div", {class:"cols"}, left, right));
  return f;
}
function stepItem(text, i, r, um){
  const st = getCook(r.id), done = st.steps.includes(i);
  const adds = (um.steps[i] || []);
  const started = st.ings.length || st.steps.length;
  let next = -1; for (let k = 0; k < (r.steps || []).length; k++) if (!st.steps.includes(k)){ next = k; break; }
  const m = String(text).match(/^([^:.!?]{2,50}):(?:\s+([\s\S]+))?$/);
  return checkRow("ck-s-" + i, started && i === next ? "current" : "", done, () => toggleCook(r.id, "steps", i),
    h("div", {class:"stxt"},
      m ? h("span", null, h("b", null, m[1] + ":"), m[2] ? " " + m[2] : null) : h("span", null, text),
      adds.length ? h("div", {class:"adds"}, h("span", {class:"addlbl"}, "Add"), adds.map(u => h("span", {class:"add"}, u.amt ? h("b", null, u.amt) : null, (u.amt ? " " : "") + u.name))) : null));
}
function cookBar(r, um){
  const st = getCook(r.id);
  const idx = (r.ingredients || []).map((x, i) => { const p = parseLine(x.line); return p && !p.header ? i : -1; }).filter(i => i >= 0);
  const nI = idx.length, nS = (r.steps || []).length, dI = idx.filter(i => ingDone(st, um, i)).length;
  const any = st.ings.length || st.steps.length || st.off.length;
  return h("div", {class:"cookbar"},
    h("span", {class:"cooktxt"}, any ? `${dI} of ${nI} ingredients · ${st.steps.length} of ${nS} steps done` : "Tap a step when it's done. Its ingredients cross off with it."),
    S.wake ? h("span", {class:"wake"}, "Screen stays on") : null,
    any ? h("button", {class:"btn ghost sm", type:"button", onclick:() => resetCook(r.id)}, "Start over") : null);
}
function scaler(r, sc, factor){
  const set = patch => { Object.assign(S.scale, patch); render(); };
  const modes = [["pan", "By pan"]]; if (r.servings) modes.push(["servings", "By servings"]); modes.push(["mult", "Multiply"]);
  const body = h("div", {class:"scalebody"});
  put(body, h("div", {class:"seg", role:"group", "aria-label":"Scale by"}, modes.map(([m, l]) => h("button", {type:"button", "aria-pressed": String(sc.mode === m), onclick:() => set({mode:m})}, l))));
  if (sc.mode === "pan"){
    if (!r.pan){
      put(body, h("p", {class:"note"}, "This recipe doesn't have its original pan size yet."), h("div", null, h("button", {class:"btn sm", type:"button", onclick:() => openSheet(r)}, "Set the original pan")));
    } else {
      const sel = h("select", {class:"in", id:"sc-pan", onchange:e => { const v = e.target.value; const p = panByKey(v); set(p ? {k:v, shape:p.shape, a:p.a, b:p.b} : {k:"custom"}); }},
        PANS.map(p => h("option", {value:p.k, selected: sc.k === p.k}, p.label)), h("option", {value:"custom", selected: sc.k === "custom"}, "Other size…"));
      const cnt = h("select", {class:"in", id:"sc-count", onchange:e => set({count:+e.target.value})}, [1,2,3,4].map(n => h("option", {value:n, selected: sc.count === n}, n === 1 ? "1 pan" : n + " pans")));
      put(body, h("div", {class:"inline"}, h("label", {class:"f", style:"flex:3 1 180px"}, "Your pan", sel), h("label", {class:"f", style:"flex:1 1 90px"}, "How many", cnt)));
      if (sc.k === "custom") put(body, customDims("sc", sc, set));
      const o = areaOf(r.pan) * (r.pan.count || 1), t = areaOf(targetPan(sc)) * sc.count;
      if (o && t) put(body, h("p", {class:"note"}, `${panName(targetPan(sc))} = ${Math.round(t)} sq in · original ${panName(r.pan)} = ${Math.round(o)} sq in. Batter depth stays the same, so start checking at the original bake time.`));
    }
  } else if (sc.mode === "servings"){
    put(body, h("div", {class:"stepper"},
      h("button", {class:"btn sm", type:"button", "aria-label":"Fewer servings", onclick:() => set({servings: Math.max(1, (+sc.servings || 1) - 1)})}, "−"),
      h("input", {class:"in", id:"sc-serv", type:"number", min:"1", step:"1", inputmode:"numeric", value:sc.servings, onchange:e => set({servings: Math.max(1, +e.target.value || r.servings)})}),
      h("button", {class:"btn sm", type:"button", "aria-label":"More servings", onclick:() => set({servings: (+sc.servings || 0) + 1})}, "+"),
      h("span", {class:"note"}, "servings (recipe makes " + servesText(r) + ")")));
  } else {
    put(body, h("div", {class:"seg", role:"group", "aria-label":"Multiplier"}, [0.5, 1, 1.5, 2, 3].map(m => h("button", {type:"button", "aria-pressed": String(+sc.mult === m), onclick:() => set({mult:m})}, m === 0.5 ? "½×" : m === 1.5 ? "1½×" : m + "×"))),
      h("label", {class:"f"}, "Or type any amount", h("input", {class:"in", id:"sc-mult", type:"number", min:"0.1", step:"0.05", inputmode:"decimal", value:sc.mult, onchange:e => set({mult: Math.max(0.05, +e.target.value || 1)})})));
  }
  put(body, h("div", {class:"factor"}, h("b", null, fmtFactor(factor)), h("span", null, factor === 1 ? "the recipe as written" : "of the recipe as written")));
  return body;
}
function customDims(prefix, o, set){
  return h("div", {class:"inline"},
    h("label", {class:"f"}, "Shape", h("select", {class:"in", id:prefix + "-shape", onchange:e => set({shape:e.target.value})},
      h("option", {value:"rect", selected:o.shape !== "round"}, "Square or rectangle"), h("option", {value:"round", selected:o.shape === "round"}, "Round"))),
    h("label", {class:"f"}, o.shape === "round" ? "Diameter (in)" : "Width (in)", h("input", {class:"in", id:prefix + "-a", type:"number", min:"1", step:"0.5", inputmode:"decimal", value:o.a || "", onchange:e => set({a:+e.target.value})})),
    o.shape === "round" ? null : h("label", {class:"f"}, "Length (in)", h("input", {class:"in", id:prefix + "-b", type:"number", min:"1", step:"0.5", inputmode:"decimal", value:o.b || "", onchange:e => set({b:+e.target.value})})));
}
function ingList(r, factor, um){
  const ul = h("ul", {class:"ilist"});
  const st = getCook(r.id);
  (r.ingredients || []).forEach((ing, i) => {
    const p = parseLine(ing.line);
    if (!p) return;
    if (p.header){ put(ul, h("li", {class:"hdr"}, p.header)); return; }
    const a = amountOf(p, factor), orig = factor !== 1 ? amountOf(p, 1).text : "";
    const ss = um.ingSteps[i] || [];
    put(ul, checkRow("ck-i-" + i, "ck", ingDone(st, um, i), () => toggleIng(r, um, i), [
      h("span", {class:"amt"}, a.text || "—", orig ? h("span", {class:"was"}, "was " + orig) : null),
      h("span", {class:"itxt"}, p.item, p.note ? h("span", {class:"inote"}, ", " + p.note) : null, a.hint ? h("span", {class:"hint"}, a.hint) : null,
        ss.length ? h("span", {class:"stepref", title:"Added in " + (ss.length > 1 ? "steps " : "step ") + ss.map(x => x + 1).join(", ")},
          ss.length > 1 ? "Steps " : "Step ", ss.map((si, j) => [j ? ", " : "", h("span", {class: st.steps.includes(si) ? "sdone" : ""}, String(si + 1))])) : null)]));
  });
  if (!ul.children.length) put(ul, h("li", null, h("span", null, "—"), h("span", {class:"note"}, "No ingredients saved.")));
  return ul;
}

/* ---------- which ingredients go in which step ---------- */
const MATCH_STOP = new Set(["of","and","or","the","a","an","to","for","with","in","into","on","fresh","freshly","ground","large","small","medium","unsalted","salted","packed","light","dark","extra","virgin","boneless","skinless","shredded","grated","chopped","minced","diced","sliced","dry","dried","whole","plain","all","purpose","cold","warm","softened","melted","kosher","sea","fine","coarse","good","quality","about","some","your","each","more","few","optional","store","bought","homemade","package","packages","can","cans","jar","bag","box","cup","cups","tbsp","tsp","tablespoon","teaspoon","oz","lb","pound","ounce","gram","g","inch"]);
const GENERIC = new Set(["sauce","oil","juice","powder","extract","stock","broth","water","seasoning","mix","paste","cheese","pepper","leave","leaf","zest","spice","cream","milk","flake","seed","chip","piece","stick","clove","sprig","bunch","head"]);
// Words that describe an ingredient rather than name it; never matched on their own ("golden brown" isn't brown sugar)
const MODIFIER = new Set(["brown","white","red","green","yellow","black","golden","sweet","hot","sour","heavy","baking","mexican","italian","greek","blend","sharp","mild","semisweet","bittersweet","whole","wheat","long","grain","short","flat","powdered","confectioner","granulated","cream","sauce","smoked","roasted","toasted","crushed","frozen","canned","raw","cooked","lean","firm","soft","thick","thin","boiling","ice","stick","fat","low","free","reduced","sodium","seedless","ripe","baby","french","english"]);
function sing(w){
  if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + "y";
  if (/(ches|shes|sses|xes|oes)$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w) && !/(ss|us|is)$/.test(w) && w.length > 3) return w.slice(0, -1);
  return w;
}
const normWords = t => String(t).toLowerCase().replace(/[‘’']/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).map(sing);
function ingPhrases(item){
  const best = new Map();
  const addP = (ph, sc, single) => { const o = best.get(ph); if (!o || o.s < sc) best.set(ph, {p:ph, s:sc, single:!!single}); };
  for (const alt of cleanName(item).split(/\bor\b|\//i)){
    const ws = normWords(alt).filter(w => !MATCH_STOP.has(w) && !/^\d/.test(w));
    if (!ws.length) continue;
    addP(ws.join(" "), 3);
    if (ws.length > 2) addP(ws.slice(-2).join(" "), 2);
    if (ws.length > 1) addP(ws[ws.length - 1], 1.5);
    ws.forEach(w => addP(w, 1, true));
  }
  return [...best.values()];
}
function hintBefore(toks, ti){
  const pre = toks.slice(Math.max(0, ti - 5), ti).join(" ");
  if (/\b(remaining|rest|other half|second half|leftover|reserved)\b/.test(pre)) return {rest:true};
  if (/\btwo third/.test(pre)) return {frac:2/3};
  if (/\bthird\b/.test(pre)) return {frac:1/3};
  if (/\bthree quarter/.test(pre)) return {frac:3/4};
  if (/\bquarter\b/.test(pre)) return {frac:1/4};
  if (/\bhalf\b/.test(pre)) return {frac:1/2};
  return {};
}
function matchText(text, info){
  const toks = normWords(text), content = [];
  toks.forEach((w, i) => { if (!MATCH_STOP.has(w)) content.push({w, i}); });
  const cands = [];
  info.forEach((inf, k) => {
    if (!inf) return;
    for (const ph of inf.phrases){
      if (ph.single && !inf.unique.has(ph.p)) continue;
      const pw = ph.p.split(" ");
      for (let j = 0; j + pw.length <= content.length; j++){
        let ok = true;
        for (let q = 0; q < pw.length; q++) if (content[j + q].w !== pw[q]){ ok = false; break; }
        if (ok) cands.push({k, s:ph.s + pw.length * 0.01, from:j, to:j + pw.length - 1, ti:content[j].i});
      }
    }
  });
  cands.sort((a, b) => b.s - a.s || a.from - b.from);
  const taken = [], res = new Map();
  for (const c of cands){
    const clash = taken.find(t => !(c.to < t.from || c.from > t.to));
    if (clash && !(clash.s === c.s && clash.from === c.from && clash.to === c.to)) continue;
    taken.push(c);
    if (!res.has(c.k)) res.set(c.k, {k:c.k, s:c.s, g:c.from + ":" + c.to, hint:hintBefore(toks, c.ti)});
  }
  return [...res.values()];
}
function ingInfo(ings){
  const parsed = ings.map(i => parseLine(i.line));
  const info = parsed.map(p => p && !p.header && p.item ? {phrases:ingPhrases(p.item)} : null);
  // A word is "unique" when only one ingredient name has it; the same name listed twice (vanilla in dough and frosting) still counts once
  const wc = {};
  info.forEach((inf, i) => { if (!inf) return; const name = normWords(cleanName(parsed[i].item)).join(" ");
    inf.phrases.filter(x => x.single).forEach(x => { (wc[x.p] = wc[x.p] || new Set()).add(name); }); });
  info.forEach(inf => { if (inf) inf.unique = new Set(inf.phrases.filter(x => x.single && wc[x.p].size === 1 && x.p.length > 3 && !GENERIC.has(x.p) && !MODIFIER.has(x.p)).map(x => x.p)); });
  const grp = []; let g = 0;
  parsed.forEach((p, i) => { if (p && p.header) g++; grp[i] = g; });
  return {parsed, info, grp};
}
const scaleP = (p, f) => Object.assign({}, p, {qty: p.qty == null ? null : p.qty * f, qtyMax: p.qtyMax == null ? null : p.qtyMax * f});
// For each step: the ingredients it adds and how much. Uses the recipe's own "Adds" lines when it has them, else reads the step text.
function stepUses(r, factor){
  const ings = r.ingredients || [], steps = r.steps || [];
  const {parsed, info, grp} = ingInfo(ings);
  const per = steps.map(() => []), ingSteps = {};
  const explicit = Array.isArray(r.uses) && r.uses.some(u => u && String(u).trim());
  // Ingredients that read the same (dough butter, filling butter, frosting butter): pick by matching amount,
  // then the ingredient group (dough / filling / frosting) the rest of the step comes from, then one not used yet.
  const used = new Set();
  const qtyMatch = (m, want) => { const p = parsed[m.k]; return p && p.qty != null && Math.abs(p.qty - want.qty) < 1e-6 && (p.unit || "") === (want.unit || ""); };
  const resolveStep = items => {
    const chosen = items.map(it => it.cands.length === 1 ? it.cands[0] : null);
    const counts = {};
    chosen.forEach(m => { if (m) counts[grp[m.k]] = (counts[grp[m.k]] || 0) + 1; });
    const fav = Object.keys(counts).sort((x, y) => counts[y] - counts[x])[0];
    items.forEach((it, j) => {
      if (chosen[j] || !it.cands.length) return;
      let pool = it.cands;
      if (it.want && it.want.qty != null){ const same = pool.filter(m => qtyMatch(m, it.want)); if (same.length) pool = same; }
      if (fav != null){ const inGrp = pool.filter(m => String(grp[m.k]) === fav); if (inGrp.length) pool = inGrp; }
      const fresh = pool.filter(m => !used.has(m.k)); if (fresh.length) pool = fresh;
      chosen[j] = pool[0];
    });
    chosen.forEach(m => { if (m) used.add(m.k); });
    return chosen;
  };
  if (explicit){
    steps.forEach((_, si) => {
      const items = String(r.uses[si] || "").split(/\s*;\s*/).map(x => x.trim()).filter(x => x && !/^(none|nothing|-|—)$/i.test(x)).map(u => {
        const pu = parseLine(u) || {item:u};
        const m = matchText(pu.item || u, info);
        return {raw:u, want:pu, cands: m.length ? m.filter(x => x.g === m[0].g && x.s === m[0].s) : []};
      });
      resolveStep(items).forEach((pick, j) => per[si].push({k: pick ? pick.k : -1, use:items[j].want, raw:items[j].raw}));
    });
  } else {
    const occ = {};
    steps.forEach((t, si) => {
      const groups = new Map();
      matchText(t, info).forEach(m => { if (!groups.has(m.g)) groups.set(m.g, []); groups.get(m.g).push(m); });
      const seen = new Set();
      resolveStep([...groups.values()].map(c => ({cands:c}))).forEach(m => {
        if (!m || seen.has(m.k)) return;
        seen.add(m.k);
        (occ[m.k] = occ[m.k] || []).push({si, hint:m.hint});
      });
    });
    for (const key in occ){
      const k = +key, list = occ[key];
      const divided = /\bdivided\b/i.test(ings[k].line);
      const hinted = list.some(o => o.hint.frac || o.hint.rest);
      const keep = hinted || divided ? list : [list[0]];
      const fracSum = keep.reduce((a, o) => a + (o.hint.frac || 0), 0);
      const rests = keep.filter(o => o.hint.rest), plain = keep.filter(o => !o.hint.frac && !o.hint.rest);
      keep.forEach(o => {
        let f = null;
        if (keep.length === 1) f = 1;
        else if (o.hint.frac) f = o.hint.frac;
        else if (o.hint.rest && !plain.length) f = Math.max(0, 1 - fracSum) / rests.length;
        else if (!o.hint.rest && hinted && !rests.length) f = Math.max(0, 1 - fracSum) / plain.length;
        per[o.si].push({k, frac:f, rest: !!o.hint.rest});
      });
    }
  }
  per.forEach((list, si) => {
    list.sort((a, b) => (a.k < 0 ? 999 : a.k) - (b.k < 0 ? 999 : b.k));
    list.forEach(u => { if (u.k >= 0) (ingSteps[u.k] = ingSteps[u.k] || []).includes(si) || ingSteps[u.k].push(si); });
  });
  const label = (u, si) => {
    if (u.use){
      if (u.use.qty != null) return {amt: amountOf(u.use, factor).text, name: u.use.item};
      const p = u.k >= 0 ? parsed[u.k] : null;
      if (p && p.qty != null && ingSteps[u.k].length === 1) return {amt: amountOf(p, factor).text, name: u.use.item || p.item};
      return {amt:"", name: u.raw};
    }
    const p = parsed[u.k];
    if (u.frac == null) return {amt: u.rest ? "remaining" : "some", name:p.item};
    if (p.qty == null) return {amt:"", name:p.item};
    return {amt: amountOf(scaleP(p, u.frac), factor).text, name:p.item};
  };
  return {steps: per.map((list, si) => list.map(u => Object.assign({k:u.k}, label(u, si)))), ingSteps, explicit};
}
// The "Adds" text for each step, as the review screen shows it
function usesStrings(ingredients, steps){
  const m = stepUses({ingredients, steps}, 1);
  return m.steps.map(list => list.map(u => (u.amt ? u.amt + " " : "") + u.name).join("; "));
}

/* ---------- cooking checks: kept on this phone only, cleared after 6 hours ---------- */
const COOK_TTL = 6 * 3600 * 1000, cookMem = {};
function getCook(rid){
  const m = cookMem[rid];
  if (m && (!m.at || Date.now() - m.at < COOK_TTL)) return m;
  let st = {ings:[], steps:[], off:[], at:0};
  try { const v = JSON.parse(localStorage.getItem("plated-cook-" + rid) || "null"); if (v && Date.now() - (v.at || 0) < COOK_TTL) st = {ings:v.ings || [], steps:v.steps || [], off:v.off || [], at:v.at}; } catch(e){}
  return (cookMem[rid] = st);
}
function saveCook(rid, st){
  st.at = Date.now(); cookMem[rid] = st;
  st.off = st.off || [];
  try { if (!st.ings.length && !st.steps.length && !st.off.length) localStorage.removeItem("plated-cook-" + rid); else localStorage.setItem("plated-cook-" + rid, JSON.stringify(st)); } catch(e){}
}
function toggleCook(rid, kind, i){
  const st = getCook(rid), a = st[kind], k = a.indexOf(i);
  if (k >= 0) a.splice(k, 1); else a.push(i);
  saveCook(rid, st); wantWake(true); render();
}
function resetCook(rid){ saveCook(rid, {ings:[], steps:[], off:[]}); render(); }
// An ingredient is crossed out when tapped, or once every step that uses it is done (a tap can undo either)
function ingDone(st, um, i){
  if (st.off.includes(i)) return false;
  const ss = um.ingSteps[i];
  return st.ings.includes(i) || !!(ss && ss.length && ss.every(si => st.steps.includes(si)));
}
function toggleIng(r, um, i){
  const st = getCook(r.id), rm = (a, v) => { const k = a.indexOf(v); if (k >= 0) a.splice(k, 1); };
  if (ingDone(st, um, i)){ rm(st.ings, i); if (ingDone(st, um, i)) st.off.push(i); }
  else { rm(st.off, i); if (!ingDone(st, um, i)) st.ings.push(i); }
  saveCook(r.id, st); wantWake(true); render();
}
function checkRow(id, cls, on, onToggle, kids){
  return h("li", {id, class: cls + (on ? " done" : ""), role:"checkbox", tabindex:"0", "aria-checked": String(on),
    onclick:onToggle, onkeydown:e => { if (e.key === " " || e.key === "Enter"){ e.preventDefault(); onToggle(); } }}, kids);
}
let wakeLock = null, wakePending = false, wakeWanted = false;
async function wantWake(on){
  wakeWanted = on;
  if (!("wakeLock" in navigator)) return;
  if (on && !wakeLock && !wakePending && document.visibilityState === "visible"){
    wakePending = true;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; if (S.wake){ S.wake = false; if (S.view === "recipe") render(); } });
      if (!wakeWanted){ wakeLock.release(); return; }
      S.wake = true; render();
    } catch(e){ S.wake = false; }
    finally { wakePending = false; }
  } else if (!on && wakeLock){ const l = wakeLock; wakeLock = null; S.wake = false; try { await l.release(); } catch(e){} }
}
document.addEventListener("visibilitychange", () => { if (wakeWanted && document.visibilityState === "visible") wantWake(true); });

/* ---------- view: grocery ---------- */
function viewList(){
  const g = S.grocery, f = document.createDocumentFragment();
  const need = g.items.filter(i => i.status === "need"), have = g.items.filter(i => i.status === "have");
  const got = need.filter(i => i.got).length;
  put(f, h("div", {class:"ghead"}, h("h1", null, "Grocery list"),
    g.items.length ? h("span", {class:"sum"}, `${need.length} to buy${got ? " · " + got + " in cart" : ""} · ${have.length} on hand`) : null));
  if (!g.items.length){
    put(f, h("div", {class:"empty"}, h("h2", null, "The list is empty"),
      h("p", null, "Open a recipe, scale it to your pan, and tap Add to grocery list. Ingredients from every recipe you add are combined here so you can check what you already have."),
      h("div", {class:"row"}, h("button", {class:"btn primary", type:"button", onclick:() => go("recipes")}, "Go to recipes"))),
      savedBox(), addItemRow());
    return f;
  }
  const main = h("div", null);
  put(main, savedBox());
  if (g.recipes.length) put(main, h("div", {class:"rchips"}, g.recipes.map(rc => h("span", {class:"rchip"},
    h("span", null, rc.title), h("small", null, rc.label || fmtFactor(rc.factor)),
    h("button", {class:"x", type:"button", "aria-label":"Remove " + rc.title + " from the list", onclick:() => { saveGrocery(removeRecipeFromList(clone(S.grocery), rc.rid)); toast("Removed " + rc.title); }}, "×")))));
  put(main, h("p", {class:"note", style:"margin:0 0 14px"}, "Confirm each item: Need puts it on the export, Have leaves it off. Tick the box when it's in your cart."));
  for (const c of CATS){
    const items = g.items.filter(i => (i.category || "Other") === c).sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "need" ? -1 : 1));
    if (!items.length) continue;
    put(main, h("section", {class:"dept"}, h("h3", null, c), h("ul", {class:"gl"}, items.map(groceryRow))));
  }
  put(main, addItemRow());
  put(main, S.confirmClear
    ? h("div", {class:"confirm"}, "Clear the whole list for both of you?",
        h("button", {class:"btn danger solid sm", type:"button", onclick:() => { S.confirmClear = false; saveGrocery(Object.assign(emptyGrocery(), {store:S.grocery.store})); toast("List cleared"); }}, "Clear list"),
        h("button", {class:"btn sm", type:"button", onclick:() => { S.confirmClear = false; render(); }}, "Cancel"))
    : h("div", {class:"row"},
        got ? h("button", {class:"btn sm", type:"button", onclick:() => { const n = clone(S.grocery); n.items = n.items.filter(i => !(i.status === "need" && i.got)); saveGrocery(n); }}, "Remove items in cart") : null,
        h("button", {class:"btn ghost sm", type:"button", onclick:() => { S.confirmClear = true; render(); }}, "Clear list")));
  put(f, h("div", {class:"gtop"}, main, exportPanel(need)));
  return f;
}
function updItem(id, patch){ const g = clone(S.grocery); const it = g.items.find(i => i.id === id); if (it) Object.assign(it, patch); saveGrocery(g); }
function groceryRow(it){
  const amt = totalAmount(it.parts || []);
  const from = [...new Set((it.parts || []).map(p => p.title).filter(Boolean))];
  const store = STORES[S.grocery.store] || STORES.ht;
  return h("li", {class:(it.status === "have" ? "have" : "") + (it.status === "need" && it.got ? " got" : "")},
    it.status === "need"
      ? h("input", {class:"cart", type:"checkbox", id:"got-" + it.id, checked: !!it.got, "aria-label":"In cart: " + it.name, onchange:e => updItem(it.id, {got: e.target.checked})})
      : h("span", {style:"width:22px"}),
    h("div", {style:"min-width:0"},
      h("div", {class:"nm"}, it.name),
      h("div", {class:"sub"}, [amt, from.length ? "for " + from.join(", ") : (it.manual ? "added by hand" : "")].filter(Boolean).join(" · "),
        it.status === "need" ? h("span", null, " · ", h("a", {class:"find", href: store.url(searchTerm(it)), target:"_blank", rel:"noopener"}, "Find at " + store.name + " ↗")) : null)),
    h("div", {class:"row", style:"gap:6px;flex-wrap:nowrap"},
      h("button", {class:"star" + (isSaved(it.key) ? " on" : ""), type:"button", "aria-pressed": String(isSaved(it.key)),
        "aria-label": (isSaved(it.key) ? "Remove " + it.name + " from saved items" : "Save " + it.name + " for next time"), onclick:() => toggleSaved(it)}, isSaved(it.key) ? "★" : "☆"),
      h("div", {class:"tog", role:"group", "aria-label":"Do you need " + it.name + "?"},
        h("button", {type:"button", class:"need", "aria-pressed": String(it.status === "need"), onclick:() => updItem(it.id, {status:"need"})}, "Need"),
        h("button", {type:"button", class:"have", "aria-pressed": String(it.status === "have"), onclick:() => updItem(it.id, {status:"have", got:false})}, "Have")),
      it.manual ? h("button", {class:"x", type:"button", "aria-label":"Remove " + it.name, onclick:() => { const g = clone(S.grocery); g.items = g.items.filter(i => i.id !== it.id); saveGrocery(g); }}, "×") : null));
}
const searchTerm = it => cleanName(it.name).toLowerCase();
// Add a typed line ("2 lb bananas", "paper towels") to a copy of the list
function addLineTo(g, v, category){
  const p = parseLine(v) || {item:v};
  const key = keyOf(p.item || v);
  const it = g.items.find(i => i.key === key);
  if (it){ it.status = "need"; it.got = false; it.manual = true; if (p.qty != null) it.parts.push({rid:"manual", title:"", qty:p.qty, unit:p.unit || ""}); }
  else g.items.push({id:uid(), key, name:cap(cleanName(p.item || v)), category: category || categorize(p.item || v), parts: p.qty != null ? [{rid:"manual", title:"", qty:p.qty, unit:p.unit || ""}] : [], status:"need", got:false, manual:true});
  return key;
}
/* ---------- saved items: things you buy often, one tap to put back on the list ---------- */
const savedList = () => S.saved || [];
const isSaved = key => savedList().some(x => x.key === key);
function saveSaved(arr){
  S.saved = arr; render();
  if (S.mode === "db") house().collection("lists").doc("saved").set({items: clone(arr)}).catch(() => toast("Couldn't save that. Check your connection."));
  else lsWrite();
}
function toggleSaved(it){
  if (isSaved(it.key)){ saveSaved(savedList().filter(x => x.key !== it.key)); toast("Removed from saved items"); return; }
  const manualAmt = totalAmount((it.parts || []).filter(p => p.rid === "manual"));
  const line = (manualAmt && manualAmt !== "as needed" ? manualAmt + " " : "") + it.name;
  saveSaved(savedList().concat([{key:it.key, name:it.name, line, category:it.category || "Other"}]));
  toast("Saved " + it.name + " for next time");
}
const onListNow = key => S.grocery.items.some(i => i.key === key && i.status === "need" && !i.got);
function addSaved(items){
  const todo = items.filter(x => !onListNow(x.key));
  if (!todo.length){ toast(items.length > 1 ? "Everything saved is already on the list" : "Already on the list"); return; }
  const g = clone(S.grocery);
  todo.forEach(x => addLineTo(g, x.line || x.name, x.category));
  saveGrocery(g);
  toast(todo.length > 1 ? "Added " + todo.length + " saved items" : "Added " + todo[0].name);
}
function savedBox(){
  const list = savedList().slice().sort((a, b) => CATS.indexOf(a.category) - CATS.indexOf(b.category) || a.name.localeCompare(b.name));
  return h("section", {class:"savedbox", "aria-label":"Saved items"},
    h("div", {class:"lblrow"},
      h("h3", null, "Saved items", list.length ? h("span", {class:"scount"}, String(list.length)) : null),
      list.length ? h("div", {class:"row", style:"gap:6px"},
        S.editSaved ? null : h("button", {class:"btn sm", type:"button", onclick:() => addSaved(list)}, "Add all"),
        h("button", {class:"btn ghost sm", type:"button", "aria-pressed": String(!!S.editSaved), onclick:() => { S.editSaved = !S.editSaved; render(); }}, S.editSaved ? "Done" : "Edit")) : null),
    list.length
      ? h("div", {class:"schips"}, list.map(x => {
          const on = onListNow(x.key);
          return S.editSaved
            ? h("span", {class:"schip editing"}, h("span", null, x.line || x.name),
                h("button", {class:"x", type:"button", "aria-label":"Remove " + x.name + " from saved items", onclick:() => saveSaved(savedList().filter(y => y.key !== x.key))}, "×"))
            : h("button", {class:"schip" + (on ? " on" : ""), type:"button", "aria-pressed": String(on), title: on ? "Already on the list" : "Add to the list",
                onclick:() => addSaved([x])}, h("span", {class:"sicon", "aria-hidden":"true"}, on ? "✓" : "+"), h("span", null, x.line || x.name));
        }))
      : h("p", {class:"note", style:"margin:0"}, "Tap the ☆ on any item to save it here. Next time, one tap puts it back on the list."));
}
function addItemRow(){
  const submit = e => {
    e.preventDefault();
    const inp = $("#additem"), v = inp.value.trim(); if (!v) return;
    const g = clone(S.grocery), key = addLineTo(g, v);
    if (S.saveTyped && !isSaved(key)){
      const it = g.items.find(i => i.key === key);
      S.saved = savedList().concat([{key, name: it.name, line: v, category: it.category}]);
      if (S.mode === "db") house().collection("lists").doc("saved").set({items: clone(S.saved)}).catch(() => {});
    }
    inp.value = ""; saveGrocery(g);
  };
  return h("form", {class:"addrow", onsubmit:submit},
    h("label", {class:"sr", for:"additem"}, "Add an item"),
    h("input", {class:"in", id:"additem", placeholder:"Add an item, e.g. 2 lb bananas or paper towels", autocomplete:"off"}),
    h("button", {class:"btn", type:"submit"}, "Add"),
    h("label", {class:"savechk"}, h("input", {type:"checkbox", id:"savetyped", checked: !!S.saveTyped, onchange:e => { S.saveTyped = e.target.checked; }}), "Also save for next time"));
}
function exportLines(need, style){
  const lines = [];
  for (const c of CATS){
    const items = need.filter(i => (i.category || "Other") === c);
    if (!items.length) continue;
    if (style === "amounts"){ if (lines.length) lines.push(""); lines.push(c.toUpperCase()); }
    for (const it of items.sort((a, b) => a.name.localeCompare(b.name))){
      const amt = totalAmount(it.parts || []);
      lines.push(style === "amounts" ? "• " + it.name + (amt && amt !== "as needed" ? " — " + amt : "") : searchTerm(it));
    }
  }
  return lines.join("\n");
}
function csvOf(need, storeName){
  const esc = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const rows = [["Store","Department","Item","Amount needed","Search term","Recipes"]];
  for (const c of CATS) for (const it of need.filter(i => (i.category || "Other") === c))
    rows.push([storeName, c, it.name, totalAmount(it.parts || []), searchTerm(it), [...new Set((it.parts || []).map(p => p.title).filter(Boolean))].join("; ")]);
  return rows.map(r => r.map(esc).join(",")).join("\r\n");
}
function downloadFile(name, text, type){
  const url = URL.createObjectURL(new Blob([text], {type}));
  const a = h("a", {href:url, download:name}); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exportPanel(needAll){
  const g = S.grocery, store = STORES[g.store] || STORES.ht;
  const need = needAll.filter(i => !i.got);
  const text = exportLines(need, S.exportStyle);
  const ta = h("textarea", {class:"in", id:"exporttext", readonly:true, rows:"9", "aria-label":"List to copy"}, text);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast("Copied " + need.length + " items for " + store.name); }
    catch(e){ ta.focus(); ta.select(); toast("Press Ctrl/⌘+C to copy the selected list"); }
  };
  const share = async () => { try { await navigator.share({title:"Grocery list", text}); } catch(e){} };
  const date = new Date().toISOString().slice(0, 10), slug = g.store === "wm" ? "walmart" : "harris-teeter";
  return h("aside", {class:"side"},
    h("div", {class:"panel"},
      h("h2", null, "Send to a store"),
      h("div", {class:"seg", role:"group", "aria-label":"Store", style:"margin-bottom:12px"},
        Object.entries(STORES).map(([k, s]) => h("button", {type:"button", "aria-pressed": String(g.store === k), onclick:() => saveGrocery(Object.assign(clone(S.grocery), {store:k}))}, s.name))),
      h("div", {class:"seg", role:"group", "aria-label":"List style", style:"margin-bottom:10px"},
        h("button", {type:"button", "aria-pressed": String(S.exportStyle === "names"), onclick:() => { S.exportStyle = "names"; render(); }}, "Search terms"),
        h("button", {type:"button", "aria-pressed": String(S.exportStyle === "amounts"), onclick:() => { S.exportStyle = "amounts"; render(); }}, "With amounts")),
      need.length ? ta : h("p", {class:"note"}, "Nothing left to buy. Items marked Have or already in your cart stay off the export."),
      h("div", {class:"row", style:"margin-top:10px"},
        h("button", {class:"btn primary", type:"button", disabled: !need.length, onclick:copy}, "Copy list"),
        navigator.share ? h("button", {class:"btn", type:"button", disabled: !need.length, onclick:share}, "Share") : null,
        h("button", {class:"btn", type:"button", disabled: !need.length, onclick:() => downloadFile(`plated-list-${slug}-${date}.csv`, csvOf(need, store.name), "text/csv")}, "Save .csv"),
        h("button", {class:"btn", type:"button", disabled: !need.length, onclick:() => downloadFile(`plated-list-${slug}-${date}.txt`, text, "text/plain")}, "Save .txt"))),
    h("div", {class:"panel"},
      h("h2", null, "Getting it into " + store.name),
      h("ol", {class:"how"},
        h("li", null, `Tap Find at ${store.name} on any item. On your phone it opens ${store.name}'s search for that item, ready to add to your cart.`),
        h("li", null, "Or copy the Search terms list and paste it into a note so you can work down it in the app."),
        h("li", null, "Tick each item here as it goes in the cart. The other phone sees it right away.")),
      h("p", {class:"note", style:"margin-top:8px"}, "Neither store's app accepts an imported list file, so Plated hands off one item at a time through each store's own search.")));
}

/* ---------- Claude (reads cards and pasted recipes) ---------- */
async function imageToBase64(file){
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej({code:"image"}); i.src = url; });
    const sc = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85).split(",")[1];
  } finally { URL.revokeObjectURL(url); }
}
async function claudeJSON(prompt, files, signal){
  const content = [];
  for (const f of files || []) content.push({type:"image", source:{type:"base64", media_type:"image/jpeg", data: await imageToBase64(f)}});
  content.push({type:"text", text:prompt});
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST", signal,
      headers:{"content-type":"application/json", "x-api-key":getKey(), "anthropic-version":"2023-06-01", "anthropic-dangerous-direct-browser-access":"true"},
      body: JSON.stringify({model:MODEL, max_tokens:4096, messages:[{role:"user", content}]})
    });
  } catch(e){ throw {code: e && e.name === "AbortError" ? "cancelled" : "network"}; }
  const j = await res.json().catch(() => ({}));
  if (!res.ok){
    const msg = (j.error && j.error.message) || "";
    throw {code: res.status === 401 ? "bad_key" : res.status === 429 ? "busy" : /credit/i.test(msg) ? "credit" : res.status >= 500 ? "overloaded" : "api", detail: msg};
  }
  const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try { return JSON.parse(raw); } catch(e){ throw {code:"invalid_json"}; }
}
const CLAUDE_COPY = {
  bad_key:"That Claude API key didn't work. Check it in Settings.",
  busy:"Claude is busy or the API account hit its rate limit. Try again in a minute.",
  credit:"The Anthropic API account is out of credit. Add credit at console.anthropic.com, then try again.",
  overloaded:"Claude is overloaded right now. Try again shortly.",
  network:"Couldn't reach Claude. Check your connection and try again.",
  image:"That photo couldn't be opened. Try a JPG or PNG photo.",
  invalid_json:"The recipe came back garbled. Try again.",
  api:"Claude couldn't read that. Try again, or paste just the recipe part."
};

/* ---------- settings sheet ---------- */
function openSettings(){ S.sheet = {step:"settings", keyDraft:getKey()}; render(); }

/* ---------- add / edit sheet ---------- */
const ICONS = {
  web:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.6 5.7 3.6 9s-1.1 6.3-3.6 9c-2.5-2.7-3.6-5.7-3.6-9S9.5 5.7 12 3z"/></svg>',
  card:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M6 9h12M6 12.5h9M6 16h6"/></svg>',
  ai:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg>',
  typed:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>'
};
function openSheet(recipe){
  if (recipe) S.sheet = {step:"review", kind:recipe.source || "typed", editingId:recipe.id, draft:draftFrom(recipe), files:[], previews:[]};
  else S.sheet = {step:"choose", kind:null, files:[], previews:[], text:"", url:"", draft:null};
  render();
  setTimeout(() => { const b = document.querySelector(".sheet .sb button, .sheet .sb input"); if (b) b.focus(); }, 0);
}
function closeSheet(){ if (S.sheet && S.sheet.ctl) S.sheet.ctl.abort(); ((S.sheet && S.sheet.previews) || []).forEach(u => URL.revokeObjectURL(u)); S.sheet = null; render(); }
function draftFrom(r){
  const ings = (r.ingredients || []).map(i => i.line), steps = (r.steps || []).slice();
  return {title:r.title || "", serves: servesText(r), prepTime:r.prepTime || "", cookTime:r.cookTime || "", totalTime:r.totalTime || "",
    pan: r.pan ? clone(r.pan) : null, ings: ings.length ? ings : [""], steps: steps.length ? steps : [""],
    uses: steps.length ? (Array.isArray(r.uses) && r.uses.some(u => u) ? steps.map((_, i) => r.uses[i] || "") : usesStrings(r.ingredients || [], steps)) : [""],
    notes:r.notes || "", url:r.url || "", cats:Object.fromEntries((r.ingredients || []).map(i => [i.line.trim(), i.category])), example: !!r.example, createdAt:r.createdAt};
}
function blankDraft(){ return {title:"", serves:"", prepTime:"", cookTime:"", totalTime:"", pan:null, ings:["", "", ""], steps:[""], uses:[""], notes:"", url:"", cats:{}}; }
function renderSheet(){
  const root = $("#sheetroot"); root.textContent = "";
  const sh = S.sheet; if (!sh) return;
  const titles = {settings:"Settings", choose:"Add a recipe", input:{web:"From a website", card:"From a recipe card", ai:"From Claude or ChatGPT"}[sh.kind], review: sh.editingId ? "Edit recipe" : "Check the recipe"};
  const body = h("div", {class:"sb"}), foot = h("div", {class:"sf"});
  if (sh.step === "settings") settingsStep(sh, body, foot);
  else if (sh.step === "choose"){
    const kinds = [
      ["ai", "Claude or ChatGPT", "Best results. Works with links, card photos and chats."],
      ["web", "Website", "Paste the recipe text from any recipe page."],
      ["card", "Recipe card", "Copy the card's words with iPhone Live Text and paste them."],
      ["typed", "Type it in", "Write the ingredients and steps yourself."]];
    put(body, h("div", {class:"kinds"}, kinds.map(([k, t, d]) => h("button", {class:"kind", type:"button", onclick:() => {
      if (k === "typed"){ sh.kind = "typed"; sh.step = "review"; sh.draft = blankDraft(); }
      else { sh.kind = k; sh.step = "input"; sh.error = null; }
      render();
    }}, h("span", {html:ICONS[k]}), h("b", null, t), h("span", null, d)))));
    put(foot, h("button", {class:"btn", type:"button", onclick:closeSheet}, "Cancel"));
  } else if (sh.step === "input") inputStep(sh, body, foot);
  else reviewStep(sh, body, foot);
  const scrim = h("div", {class:"scrim", onclick:e => { if (e.target === scrim && !sh.busy) closeSheet(); }, onkeydown:e => { if (e.key === "Escape" && !sh.busy) closeSheet(); }},
    h("div", {class:"sheet", role:"dialog", "aria-modal":"true", "aria-labelledby":"sheet-title"},
      h("div", {class:"sh"}, h("h2", {id:"sheet-title"}, titles[sh.step] || "Add a recipe"), h("button", {class:"x", type:"button", "aria-label":"Close", onclick:closeSheet}, "×")),
      body, foot));
  put(root, scrim);
}
function settingsStep(sh, body, foot){
  if (S.user) put(body, h("div", {class:"kv"}, h("b", null, "Signed in"), h("span", null, (S.user.displayName ? S.user.displayName + " · " : "") + (S.user.email || ""))),
    h("p", {class:"note"}, "Everyone signed in to Plated shares one recipe box and grocery list."));
  else put(body, h("div", {class:"kv"}, h("b", null, "This device only"), h("span", {class:"note"}, "Recipes here aren't shared. Connect Firebase in config.js to share them.")));
  put(body, 
    h("div", {class:"kv"}, h("b", null, "Claude API key"),
      h("span", {class:"note"}, "Lets Plated read recipe card photos and messy recipe pages. Billed to an Anthropic API account (console.anthropic.com), separate from a Claude subscription. The key is saved on this device only; it is never put in the shared recipe box or on GitHub.")),
    h("input", {class:"in", id:"set-key", type:"password", autocomplete:"off", placeholder:"sk-ant-…", value: sh.keyDraft || "", oninput:e => { sh.keyDraft = e.target.value; }}),
    getKey() ? h("p", {class:"note"}, "A key is saved on this device.") : h("p", {class:"note"}, "No key yet. Without one, pasted recipes are split by Plated itself and card photos can't be read."),
    h("p", {class:"note"}, "Plated version " + APP_VERSION));
  put(foot, 
    S.user ? h("button", {class:"btn ghost", type:"button", onclick:signOut, style:"margin-right:auto"}, "Sign out") : null,
    getKey() ? h("button", {class:"btn", type:"button", onclick:() => { setKey(""); sh.keyDraft = ""; toast("Key removed from this device"); render(); }}, "Remove key") : null,
    h("button", {class:"btn primary", type:"button", onclick:() => { const v = (sh.keyDraft || "").trim(); setKey(v); toast(v ? "Key saved on this device" : "Settings saved"); closeSheet(); }}, "Save"));
}
function copyText(text, ok){
  const fallback = () => { const ta = document.getElementById("prompt-text"); if (ta){ ta.hidden = false; ta.focus(); ta.select(); } toast("Select the prompt and tap Copy"); };
  try { navigator.clipboard.writeText(text).then(() => toast(ok), fallback); } catch(e){ fallback(); }
}
function promptPanel(sh){
  return h("section", {class:"aiprompt"},
    h("h3", null, "Best results: use the Plated prompt"),
    h("ol", {class:"how"},
      h("li", null, "Tap Copy the Plated prompt."),
      h("li", null, "In Claude or ChatGPT, paste it and add the recipe: a website link, a photo of a recipe card, pasted text, or just send it in the chat where you made the recipe."),
      h("li", null, "Tap the copy button under its answer, come back, and paste it below.")),
    h("div", {class:"row"},
      h("button", {class:"btn primary sm", type:"button", onclick:() => copyText(PLATED_PROMPT, "Prompt copied. Paste it into Claude or ChatGPT.")}, "Copy the Plated prompt"),
      h("button", {class:"btn ghost sm", type:"button", "aria-expanded": String(!!sh.showPrompt), onclick:() => { sh.showPrompt = !sh.showPrompt; render(); }}, sh.showPrompt ? "Hide prompt" : "See the prompt")),
    h("textarea", {class:"in prompt-text", id:"prompt-text", readonly:true, rows:"12", hidden: !sh.showPrompt, "aria-label":"The Plated prompt"}, PLATED_PROMPT));
}
function pasteButton(sh){
  return h("button", {class:"btn sm", type:"button", onclick:async () => {
    try { const t = await navigator.clipboard.readText(); if (t && t.trim()){ sh.text = t; sh.error = null; render(); return; } } catch(e){}
    const ta = document.getElementById("in-text"); if (ta) ta.focus();
    toast("Press and hold in the box, then tap Paste");
  }}, "Paste");
}
function aiTip(sh, text){
  return h("div", {class:"tip"}, h("span", null, text), h("button", {class:"btn ghost sm", type:"button", onclick:() => { sh.kind = "ai"; sh.error = null; render(); }}, "Use the Plated prompt"));
}
function inputStep(sh, body, foot){
  const hasKey = !!getKey();
  if (sh.kind === "web") put(body, h("label", {class:"f"}, "Recipe page link (optional, saved as the source)", h("input", {class:"in", id:"in-url", type:"url", placeholder:"https://", value:sh.url || "", oninput:e => { sh.url = e.target.value; }})));
  if (sh.kind === "card" && !sh.usePhoto){
    put(body, 
      h("ol", {class:"how"},
        h("li", null, "Take a photo of the card, or just point the Camera at it."),
        h("li", null, "Tap the Live Text button (the square with lines) in the corner of the photo or camera view."),
        h("li", null, "Tap Select All, then Copy. Do the back of the card too if it has more."),
        h("li", null, "Paste everything below and tap Read the recipe.")),
      aiTip(sh, "Messy handwriting? Send a photo of the card to Claude or ChatGPT with the Plated prompt instead."),
      h("label", {class:"f"}, h("span", {class:"lblrow"}, "Paste the card's text", pasteButton(sh)),
        h("textarea", {class:"in", id:"in-text", rows:"10", placeholder:"Grandma's Pound Cake\n2 cups sugar\n1 cup butter\n5 eggs\n…\nCream butter and sugar…", oninput:e => { sh.text = e.target.value; }}, sh.text || "")),
      h("p", {class:"note"}, "Plated sorts the lines into ingredients and steps. Check them on the next screen, especially any words Live Text misread."));
    if (hasKey) put(body, h("p", {class:"note"}, h("button", {class:"btn ghost sm", type:"button", onclick:() => { sh.usePhoto = true; sh.error = null; render(); }}, "Upload a photo instead (uses your Claude key)")));
  } else if (sh.kind === "card"){
    const pick = files => {
      const list = [...files].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)).slice(0, 4);
      if (!list.length){ sh.error = "Choose a photo of the card."; render(); return; }
      sh.previews.forEach(u => URL.revokeObjectURL(u));
      sh.files = list; sh.previews = list.map(f => URL.createObjectURL(f)); sh.error = null; render();
    };
    const drop = h("label", {class:"drop", ondragover:e => { e.preventDefault(); drop.classList.add("over"); }, ondragleave:() => drop.classList.remove("over"), ondrop:e => { e.preventDefault(); pick(e.dataTransfer.files); }},
      h("b", null, "Add photos of the card"), h("div", null, "Take a photo or pick one. Front and back are fine, up to 4."),
      h("input", {type:"file", id:"in-files", accept:"image/*", multiple:true, onchange:e => pick(e.target.files)}));
    put(body, drop);
    if (sh.previews.length) put(body, h("div", {class:"thumbs"}, sh.previews.map((u, i) => h("img", {src:u, alt:"Card photo " + (i + 1)}))));
  } else {
    if (sh.kind === "ai") put(body, promptPanel(sh));
    if (sh.kind === "web") put(body, aiTip(sh, "Easiest: paste the page's link into Claude or ChatGPT with the Plated prompt, then bring the answer back here."));
    put(body, h("label", {class:"f"}, h("span", {class:"lblrow"}, sh.kind === "ai" ? "Paste the answer" : "Paste the recipe from the page", pasteButton(sh)),
      h("textarea", {class:"in", id:"in-text", rows:"10", placeholder: sh.kind === "ai" ? "PLATED RECIPE\nTitle: …\n\nOr paste any chat that has a recipe in it." : "On the recipe page, select from the title through the last step, copy, and paste here. Extra text like ads or comments is fine.", oninput:e => { sh.text = e.target.value; }}, sh.text || "")));
    put(body, h("p", {class:"note"}, sh.kind === "ai" ? "Answers in the Plated format fill in exactly. Other chats are sorted as well as Plated can; check them on the next screen." : "Plated sorts the text into ingredients and steps. Check them on the next screen."));
  }
  if (sh.error) put(body, h("p", {class:"err"}, sh.error));
  if (sh.busy) put(body, h("div", {class:"busy"}, h("span", {class:"dot"}), sh.kind === "card" ? "Reading the card… this can take up to a minute." : "Reading the recipe…"));
  put(foot, 
    sh.busy ? h("button", {class:"btn", type:"button", onclick:() => sh.ctl && sh.ctl.abort()}, "Stop") : h("button", {class:"btn", type:"button", onclick:() => { sh.step = "choose"; sh.error = null; render(); }}, "Back"),
    h("button", {class:"btn primary", type:"button", disabled: sh.busy, onclick:() => runExtract(sh)}, sh.kind === "card" && sh.usePhoto ? "Read the card" : "Read the recipe"));
}
function extractPrompt(kind, text){
  const what = kind === "card" ? "the attached photo(s) of a recipe card (handwritten or printed)" : kind === "cardtext" ? "text copied from a photo of a recipe card with phone text recognition, which may have line breaks in odd places and a few misread words" : kind === "ai" ? "a conversation with an AI assistant. Use the final version of the recipe the conversation settled on" : "text copied from a recipe web page, which may include ads, stories and comments to ignore";
  return `Extract one recipe from ${what}.
Reply with only a JSON object in exactly this shape:
{"title": string, "servings": string like "4" or "2–3" or "", "prepTime": string, "cookTime": string, "totalTime": string, "pan": {"shape": "rect" or "round", "width": number, "length": number} or null, "ingredients": [{"line": string, "category": string}], "steps": [string], "uses": [string], "notes": string}
Rules:
- "title": the recipe's name. If none is given, write a short descriptive name in title case (2–6 words).
- "prepTime", "cookTime", "totalTime": short text like "15 min" or "1 hr 10 min" when stated or clearly implied, else "". A single overall time ("about 25 minutes") goes in "totalTime".
- "pan": only when the recipe names a baking pan or dish size, in inches. For a round pan, width = diameter and length = diameter. A loaf pan is "rect".
- "ingredients[].line": one ingredient each, written like "2 1/2 cups all-purpose flour, sifted" with the quantity first, then the unit, then the item, then any prep after a comma. Use plain fractions like 1/2 (not ½). Keep amounts exactly as written. For a section heading such as "For the frosting", use a line ending with a colon and category "Other".
- "category": one of ${CATS.map(c => '"' + c + '"').join(", ")}.
- "steps": the method in order, one step per item, without step numbers.
- "uses": one string per step, in the same order as "steps": the ingredients added in that step with the amount used in that step, separated by semicolons ("1/2 cup unsalted butter; 1 large egg"), or "" if the step adds nothing. Split an ingredient's amount across steps when the recipe uses it in parts.
- "notes": intro tips, variations, substitutions, storage and source credits worth keeping, as short paragraphs separated by a blank line, else "". Never put these in "steps". Leave out greetings and sign-offs.
- If handwriting is hard to read, give your best reading and put "(?)" right after the uncertain word.
- If there is no recipe, reply {"error": "no recipe"}.` + (text ? "\n\nHere is the content:\n<<<\n" + text.slice(0, 60000) + "\n>>>" : "");
}
async function runExtract(sh){
  sh.error = null;
  const photo = sh.kind === "card" && sh.usePhoto;
  if (photo && !sh.files.length){ sh.error = "Add a photo of the card first."; render(); return; }
  if (!photo && !(sh.text || "").trim()){ sh.error = sh.kind === "card" ? "Paste the card's text first." : "Paste the recipe text first."; render(); return; }
  let text = "";
  try {
    text = photo ? "" : unflatten(sh.text);
    if (!photo && isPlated(text)){
      const d = parsePlated(text);
      // A Plated header but nothing usable under it: let the general splitter have a go
      if (d.ingredients.length || d.steps.length){ applyDraft(sh, d); return; }
    }
    if (!getKey()){ applyDraft(sh, localExtract(text)); return; }
  } catch(err){
    console.error(err);
    sh.error = "Plated couldn't read that paste (" + ((err && err.message) || err) + "). Send a screenshot of this to Tyler, or tap Back and try Typed in.";
    render(); return;
  }
  sh.busy = true; sh.ctl = new AbortController(); render();
  try {
    const data = await claudeJSON(extractPrompt(photo ? "card" : sh.kind === "card" ? "cardtext" : sh.kind, text), photo ? sh.files : [], sh.ctl.signal);
    sh.busy = false;
    if (!data || data.error || !Array.isArray(data.ingredients)){ sh.error = "No recipe found there. Check that the ingredients and steps are included."; render(); return; }
    applyDraft(sh, data);
  } catch(e){
    sh.busy = false;
    if (e && e.code === "cancelled"){ render(); return; }
    sh.error = CLAUDE_COPY[e && e.code] || CLAUDE_COPY.api;
    render();
  }
}
function applyDraft(sh, data){
  const ings = (data.ingredients || []).map(i => typeof i === "string" ? {line:i, category:""} : {line:String(i.line || "").trim(), category:i.category}).filter(i => i.line);
  const steps = (data.steps || []).map(s => String(s).trim()).filter(Boolean);
  const str = v => v == null ? "" : String(v).trim();
  sh.draft = {
    title: str(data.title), serves: str(data.serves || data.servings).replace(/\s*(?:-|to)\s*/, "–"),
    prepTime: str(data.prepTime), cookTime: str(data.cookTime), totalTime: str(data.totalTime),
    pan: panFromDims(data.pan), ings: ings.length ? ings.map(i => i.line) : [""], steps: steps.length ? steps : [""],
    uses: !steps.length ? [""] : Array.isArray(data.uses) && data.uses.some(u => u && String(u).trim()) ? steps.map((_, i) => str(data.uses[i])) : usesStrings(ings, steps),
    notes: str(data.notes), url: sh.url || "", cats: Object.fromEntries(ings.map(i => [i.line, i.category]))
  };
  sh.step = "review"; render();
}
/* The Plated prompt: Claude or ChatGPT answer in a fixed format that Plated reads exactly */
const PLATED_PROMPT = `Turn the recipe into this exact plain-text format for my recipe app, Plated. Reply with only the filled-in format: no intro, no closing remarks, no bold, no tables, no code block.

PLATED RECIPE
Title:
Serves:
Prep time:
Cook time:
Total time:
Pan:

Ingredients:
-

Steps:
1.
   Adds:

Notes:
-

Rules:
- Title: the recipe's name. Make up a short one if it has none.
- Serves: a number or range, like 4 or 2–3.
- Times: like 15 min or 1 hr 10 min. Leave blank if unknown.
- Pan: the baking pan or dish if it uses one, like 9x13 dish, 8x8 square, 9 inch round or 9x5 loaf pan. Otherwise write none.
- Ingredients: one per line, amount first, then unit, then item, then prep after a comma (2 1/2 cups all-purpose flour, sifted). Use plain fractions like 1/2. For a group, put a line like "For the sauce:" before its ingredients.
- Steps: one numbered step per action, each a sentence or short paragraph. No sub-bullets: fold any sub-points into the step.
- Adds: under every step, a line starting "Adds:" listing each ingredient added in that step with the amount used in that step, separated by semicolons (Adds: 1/2 cup unsalted butter; 1 large egg). If an ingredient is split across steps, give each step its own share (1/2 cup cheese in one step, the other 1/2 cup in a later one). Write "Adds: none" for a step that adds nothing.
- Notes: tips, swaps, variations and storage, one per line. Write none if there aren't any.
- Keep every amount exactly as in the original. For a handwritten card, put (?) after any word you can't read for sure.

The recipe: use the one from this conversation, or the link, text or photo I add below.`;
// Some copy and paste routes on iPhone drop every line break. Put them back before reading the recipe.
function unflatten(t){
  t = String(t || "").replace(/\r\n?|[\u2028\u2029\u0085]/g, "\n");
  const lines = t.split("\n").filter(x => x.trim()).length;
  if (lines >= 8 || t.length < 200) return t;
  let next = 1;
  return t
    .replace(/\s*\b(PLATED RECIPE)\b\s*/, "\n$1\n")
    .replace(/\s+(?=(?:Title|Name|Serves|Servings|Yield|Prep time|Cook time|Total time|Pan)\s*:)/g, "\n")
    .replace(/\s+(?=(?:Ingredients|INGREDIENTS|Steps|STEPS|Instructions|INSTRUCTIONS|Directions|DIRECTIONS|Method|Notes|NOTES|Tips)\s*:?\s)/g, "\n")
    .replace(/(\n(?:Ingredients|INGREDIENTS|Steps|STEPS|Instructions|INSTRUCTIONS|Directions|DIRECTIONS|Method|Notes|NOTES|Tips)\s*:?)\s+/g, "$1\n")
    .replace(/\s+(?=Adds\s*:)/g, "\n   ")
    .replace(/\s+[-–•*▢]\s+(?=\S)/g, "\n- ")
    .replace(/\s+(?=For (?:the )?[A-Za-z][^:\n.]{1,40}:)/g, "\n")
    .replace(/(^|\s+)(\d{1,2})([.)])\s+(?=[A-Z])/g, (m, sp, n, d) => { if (+n === next){ next++; return "\n" + n + d + " "; } return m; })
    .replace(/\n{2,}/g, "\n").trim();
}
// Chat bots decorate headings with emoji ("🛒 Ingredients"); strip them before reading a line
const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{1F1E6}-\u{1F1FF}\uFE0F\u200D\u20E3]/gu;
const deEmoji = t => String(t).replace(EMOJI_RE, "").replace(/[ \t\u00A0]{2,}/g, " ").replace(/^[ \t\u00A0]+|[ \t\u00A0]+$/gm, "").trim();
const SIGNOFF = /^(enjoy|bon app|happy (cooking|baking|eating)|let me know|i hope|hope you|would you like|want me to|feel free to ask|if you('d| would) like|good luck|(want|need|do you want|would you want|should i|shall i|can i|i can also)\b.*\?\s*$)/i;
const NOTES_HEAD = /^(notes?|tips?|chef'?s (notes?|tips?)|variations?|substitutions?|swaps?|serving suggestions?|storage|storing|make[- ]ahead|optional add[- ]ins|extras|faqs?|notes? (&|and) tips?|tips? (&|and) (variations?|tricks|notes?)|variations? (&|and) (tips?|swaps?))$/;
// "| 3/4 cup | olive oil |" → "3/4 cup olive oil"; header and divider rows are dropped
function tableRowToLine(l){
  if (!/^\s*\|.*\|\s*$/.test(l)) return null;
  const cells = l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.replace(/\*\*|__|`/g, "").trim()).filter(Boolean);
  if (!cells.length || cells.every(c => /^:?-{2,}:?$/.test(c))) return "";
  if (cells.some(c => /^(ingredients?|amounts?|quantity|qty|measure(ment)?s?|item|notes?)$/i.test(c)) && !cells.some(c => /\d/.test(c))) return "";
  const amt = cells.find(c => QTY_RE.test(normFracs(c))), rest = cells.filter(c => c !== amt);
  return deEmoji(amt ? [amt].concat(rest.slice(0, 1)).join(" ") + (rest.length > 1 ? ", " + rest.slice(1).join(", ") : "") : cells.join(", "));
}
function stripMd(t){
  return String(t || "").replace(/[\u2018\u2019]/g, "'").replace(/^\s*```\w*\s*$/gm, "").replace(/\*\*|__|`/g, "").replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/(^|[\s(])[*_](?=\S)([^*_\n]*?\S)[*_](?=$|[\s.,;:!?)])/gm, "$1$2")   // *italic* and _italic_
    .replace(/\\([\\`*_{}\[\]()#+\-.!>|~])/g, "$1");                              // markdown escapes like 1\. or \-
}
function isPlated(t){
  const s = deEmoji(stripMd(t));
  return /^\s*plated recipe\s*$/im.test(s) || (/^\s*title\s*:/im.test(s) && /^\s*ingredients\s*:\s*$/im.test(s) && /^\s*steps\s*:\s*$/im.test(s));
}
function panFromText(v){
  v = String(v || "").toLowerCase().trim();
  if (!v || /^(none|n\/a|no|-|—|no pan)$/.test(v)) return null;
  let m = v.match(/(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)/);
  if (m) return {shape:"rect", width:+m[1], length:+m[2]};
  m = v.match(/(\d+(?:\.\d+)?)\s*-?\s*(?:inch|in\.?|")?\s*(?:round|pie|skillet|springform|tube|bundt|cake|cast)/);
  if (m) return {shape:"round", width:+m[1], length:+m[1]};
  m = v.match(/(\d+(?:\.\d+)?)\s*-?\s*(?:inch|in\.?|")?\s*square/);
  if (m) return {shape:"rect", width:+m[1], length:+m[1]};
  if (/loaf/.test(v)) return {shape:"rect", width:5, length:9};
  return null;
}
function parsePlated(text){
  const out = {title:"", serves:"", prepTime:"", cookTime:"", totalTime:"", pan:null, ingredients:[], steps:[], notes:""};
  const stepLines = [], notes = [];
  const blank = v => /^(\[.*\]|n\/a|none|unknown|—|-|blank)?$/i.test(v.trim());
  let sec = null;
  // If the whole chat was copied, the prompt's blank template comes first: read only the last PLATED RECIPE block
  let body = stripMd(text);
  const marks = [...body.matchAll(/^\s*plated recipe\s*$/gim)];
  if (marks.length > 1) body = body.slice(marks[marks.length - 1].index);
  for (const raw of body.split(/\r?\n/)){
    const l = deEmoji(raw.trim());
    if (!l || /^plated recipe$/i.test(l)) continue;
    if (SIGNOFF.test(l) || /^(here('s| is)|sure|absolutely|of course|certainly)\b.{0,80}(plated|format|recipe)[^.]*[:.!]?$/i.test(l)) continue;
    const hdr = l.toLowerCase().replace(/[:\s]+$/, "");
    if (/^ingredients?$/.test(hdr)){ sec = "ings"; continue; }
    if (/^(steps|instructions|directions|method)$/.test(hdr)){ sec = "steps"; continue; }
    if (NOTES_HEAD.test(hdr)){ sec = "notes"; continue; }
    if (/^rules$/.test(hdr)){ sec = "skip"; continue; }
    if (sec === "skip") continue;
    const f = !sec && l.match(/^(title|name|serves|servings|yield|prep(?:\s*time)?|cook(?:\s*time)?|bake(?:\s*time)?|total(?:\s*time)?|pan)\s*:\s*(.*)$/i);
    if (f){
      const k = f[1].toLowerCase(), v = f[2].trim();
      if (/^(title|name)/.test(k)) out.title = blank(v) ? "" : v;
      else if (/^(serves|servings|yield)/.test(k)) out.serves = blank(v) ? "" : (findServings("serves " + v) || v);
      else if (/^prep/.test(k)) out.prepTime = blank(v) ? "" : normTime(v);
      else if (/^(cook|bake)/.test(k)) out.cookTime = blank(v) ? "" : normTime(v);
      else if (/^total/.test(k)) out.totalTime = blank(v) ? "" : normTime(v);
      else if (k === "pan") out.pan = panFromText(v);
      continue;
    }
    if (sec === "ings"){ const v = l.replace(/^[-–•*·]\s*/, "").trim(); if (v && !blank(v)) out.ingredients.push({line:v, category:""}); }
    else if (sec === "steps") stepLines.push(l);
    else if (sec === "notes"){ const v = l.replace(/^[-–•*·]\s*/, "").trim(); if (v && !blank(v)) notes.push(v); }
  }
  out.uses = [];
  // "1. Whisk the flour and milk. Adds: 1 cup flour" → step text and its Adds line
  const lines2 = [];
  stepLines.forEach(l => { const m = l.match(/^(.*?\S)\s+(adds?\s*:\s*.*)$/i); if (m && !/^[-–•*·]?\s*adds?\s*:/i.test(l)) lines2.push(m[1], m[2]); else lines2.push(l); });
  const numbered = lines2.some(l => /^(step\s*)?\d+[.):]\s*/i.test(l));
  for (const l of lines2){
    const ad = l.replace(/^[-–•*·]\s*/, "").match(/^(?:adds?|uses?|add in|ingredients?)\s*:\s*(.*)$/i);
    if (ad){ if (out.steps.length) out.uses[out.steps.length - 1] = blank(ad[1]) || /^none$/i.test(ad[1].trim()) ? "" : ad[1].trim(); continue; }
    const num = l.match(/^(?:step\s*)?\d+[.):]\s*(.*)$/i);
    const v = (num ? num[1] : l.replace(/^[-–•*·]\s*/, "")).trim();
    if (!v || blank(v)) continue;
    if (!num && /^(serves|makes|yield)\b/i.test(v)) continue;
    if (!numbered || num || !out.steps.length) out.steps.push(v);
    else out.steps[out.steps.length - 1] = joinStep(out.steps[out.steps.length - 1], v);
  }
  out.uses = out.steps.map((_, i) => out.uses[i] || "");
  out.notes = notes.join("\n\n");
  return out;
}

/* Built-in splitter, used when there's no Claude key */
const STEP_VERB = /^(cream|mix|stir|bake|combine|add|beat|whisk|pour|preheat|heat|cook|place|put|fold|blend|sift|grease|melt|let|cool|chill|serve|bring|simmer|boil|cut|chop|spread|roll|cover|remove|season|sprinkle|top|layer|drain|transfer|line|turn|reduce|fry|saut(e|é)|brown|knead|adjust|taste|toss|slice|dice|mince|garnish|finish|return|meanwhile|once|when|after|while|in a|in another)\b/i;
const NOTE_START = /^(if (?!using\b)|tips?\b|notes?\b|variations?\b|swaps?\b|substitut|make[- ]ahead|leftovers?\b|storage\b|to store\b|store (it|leftovers)\b|serving suggestions?\b|serve (it )?with\b|pair (it )?with\b|for (a|an|extra|more|added|less|a lighter|a spicier)\b|to make (it|this)\b|want\b|craving\b|you can also\b|feel free\b|bonus\b|shortcut\b|optional:)/i;
const CHATTY = /^(sure|here('s| is| are)|okay|ok\b|great|absolutely|of course|certainly|enjoy|let me know|i hope|hope you|happy (cooking|baking)|would you like|want me to|good luck|bon app)/i;
const DUR = "(\\d+(?:[½¼¾]|\\.\\d+)?(?:\\s*(?:–|-|to)\\s*\\d+)?\\s*(?:minutes?|mins?|hours?|hrs?)(?:\\s*(?:and\\s*)?\\d+\\s*(?:minutes?|mins?))?)";
function normTime(t){ return t.replace(/\bminutes?\b|\bmins\b/gi, "min").replace(/\bhours?\b|\bhrs\b/gi, "hr").replace(/\s*(?:-|to)\s*(?=\d)/, "–").replace(/\s+/g, " ").trim(); }
function findTimes(all, intro){
  const grab = (re, txt) => { const m = (txt || all).match(re); return m ? normTime(m[1]) : ""; };
  const t = {
    prep: grab(new RegExp("\\bprep(?:aration)?(?:\\s*time)?\\s*[:\\-–]?\\s*(?:about\\s*)?" + DUR, "i")),
    cook: grab(new RegExp("\\b(?:cook(?:ing)?|bake|baking)(?:\\s*time\\s*[:\\-–]?|\\s*:)\\s*(?:about\\s*)?" + DUR, "i")),
    total: grab(new RegExp("\\btotal(?:\\s*time)?\\s*[:\\-–]?\\s*(?:about\\s*)?" + DUR, "i"))
  };
  if (!t.total && !t.cook) t.total = grab(new RegExp("\\b(?:about|around|roughly|takes|ready in|in about|in under|under|just)\\s+" + DUR, "i"), intro);
  if (t.total && /^\d/.test(t.total) && /^(about|around|roughly)/i.test(((intro || "").match(new RegExp("\\b(about|around|roughly)\\s+" + DUR, "i")) || [""])[0])) t.total = "About " + t.total;
  return t;
}
function findServings(txt){
  const m = txt.match(/\b(?:serves|servings?|yields?|makes|feeds)\b\s*[:\-–]?\s*(?:about\s*|around\s*|up to\s*)?(\d+(?:\s*(?:–|-|to)\s*\d+)?)(?!\s*(?:\/|cups?|c\.|tbsp|tablespoons?|tsp|teaspoons?|quarts?|qt|pints?|oz|ounces?|fl|lbs?|pounds?|liters?|litres?|ml|gallons?|grams?|g\b))/i);
  return m ? m[1].replace(/\s*(?:–|-|to)\s*/, "–") : "";
}
const SMALL_WORDS = new Set(["a","an","and","or","with","of","the","in","on","for","to","over","at","from","by","&"]);
function titleCase(t){ return t.split(/\s+/).map((w, i) => i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)).join(" "); }
function titleFromSentence(sentence){
  const res = [
    /\b(?:i'?d|i would|i'?ll|let'?s|we could|you could|you can) (?:make|go with|try|suggest|whip up|cook up|do)\s+(.+)/i,
    /\b(?:how about|why not try|why not make|try making|try)\s+(.+)/i,
    /\brecipe for\s+(.+)/i,
    /^(?:make|making)\s+(.+)/i
  ];
  for (const re of res){
    const m = sentence.match(re); if (!m) continue;
    let t = m[1].split(/[!.:;?]|,\s(?:which|it|and it|so)\b|\s[–—]\s/)[0]
      .replace(/^(a|an|some|this|my|the|your|a quick|an easy|a simple|a cozy)\s+/i, "")
      .replace(/\s+(tonight|today|this week|for dinner|for lunch|for breakfast)$/i, "").trim();
    if (!t || t.length < 3 || /\b(recipe|you|something|it)\b/i.test(t) || t.split(/\s+/).length > 9) continue;
    return titleCase(t);
  }
  return "";
}
const sentencesOf = txt => txt.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).map(x => x.trim()).filter(Boolean);
function joinStep(last, add){
  if (/:$/.test(last) || /[.!?;]$/.test(last)) return last + " " + add;
  return last + (last.length <= 45 ? ": " : ". ") + add;
}
function localExtract(text){
  const BULLET = /^[-–•*·▢☐□✓✔]\s*/;
  const src = String(text || "").replace(/[‘’]/g, "'");
  let title = "", mdTitle = "", mode = null, group = false;
  const ings = [], steps = [], notes = [], intro = [], meta = [];
  for (let rawLine of src.split(/\r?\n/)){
    if (/^\s*```/.test(rawLine)) continue;
    const tableLine = tableRowToLine(rawLine);
    if (tableLine !== null){ if (tableLine){ if (!mode || mode === "i") { mode = "i"; ings.push(tableLine); } else if (mode === "s") steps.push(tableLine); } continue; }
    if (rawLine.trim() && !deEmoji(rawLine.replace(/[#*_>`\-–•]/g, "")).trim()) continue;
    rawLine = rawLine.replace(/(\*\*|__)([^*_:]{2,50})(\*\*|__)\s*[–—-]\s+/, "$1$2:$3 ");
    const isHeading = /^\s*#{1,6}\s/.test(rawLine) || /^\s*(\*\*|__)[^*_]+(\*\*|__)\s*:?\s*$/.test(rawLine);
    const boldOnly = /^\s*(?:(?:step\s*)?\d+[.):]\s*)?(\*\*|__)[^*_]+(\*\*|__)\s*:?\s*$/i.test(rawLine);
    const rawBullet = /^\s*[-–•*·]\s+/.test(rawLine) && !/^\s*\*\*/.test(rawLine);
    const rawIndent = /^(\s{2,}|\t)\S/.test(rawLine);
    const l = deEmoji(rawLine.replace(/^\s*>+\s?/, "").replace(/^\s*#{1,6}\s*/, "").replace(/\*\*|__|`/g, ""));
    if (!l || /^[-*_=]{3,}$/.test(l)) continue;
    const low = l.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").replace(/[:\s.]+$/, "");
    if (/^(the )?ingredients?( list)?$|^(what )?you('ll| will)? need$|^shopping list$/.test(low)){ mode = "i"; continue; }
    if (/^(instructions|directions|method|preparation|steps|procedure|to make|how to make( it)?|how to)$/.test(low)){ mode = "s"; continue; }
    if (NOTES_HEAD.test(low)){ mode = "n"; continue; }
    if (/^(serves|servings?|makes|yields?|feeds)\b/i.test(l) && l.length < 60 && !QTY_RE.test(l)){ meta.push(l); continue; }
    if (SIGNOFF.test(l)) continue;
    if (/^(serves|servings?|yields?|makes|prep(aration)?( time)?|cook(ing)? time|bake time|total( time)?|time|active time)\s*[:\-–]/i.test(l) && l.length < 80){ meta.push(l); continue; }
    if (CHATTY.test(l)){ if (!ings.length && !steps.length) intro.push({text:l, chatty:true}); continue; }
    if (isHeading && !mode && !mdTitle && !/:$/.test(l) && !ings.length){ mdTitle = l; continue; }
    const bare = l.replace(BULLET, "");
    const rawNumbered = /^(step\s*)?\d+[.):]\s*\S/i.test(l) && !QTY_RE.test(normFracs(l.replace(/^(step\s*)?\d+[.):]\s*/i, "")).replace(/^\d+[.):]/, "x")) || /^step\s*\d+/i.test(l);
    const stepLike = /^(step\s*)?\d+[.):]\s+\D/i.test(bare);
    const looksIng = !stepLike && QTY_RE.test(normFracs(bare)) && bare.length < 120 && !/[.!?]$/.test(bare);
    const sentence = (bare.length > 50 && /[.!?]$/.test(bare)) || /,$/.test(bare) || STEP_VERB.test(bare);
    const lastStep = steps[steps.length - 1];
    if (mode === "n"){ notes.push(bare); continue; }
    if (mode === "i" && /^(notes?|tips?)\s*:/i.test(bare)){ notes.push(bare); continue; }
    if (mode === "i" && (isHeading || boldOnly) && !QTY_RE.test(normFracs(bare))){ ings.push(bare.replace(/:?\s*$/, ":")); continue; }
    if (mode === "i" && !sentence && !stepLike){ ings.push(bare); continue; }
    if (steps.length && NOTE_START.test(bare)){ mode = "n"; notes.push(bare); continue; }
    if (!mode && !ings.length && !steps.length && !looksIng){
      if (!title && !mdTitle && l.length < 70 && !/[.!?]$/.test(l)) title = l.replace(/:$/, "");
      else intro.push({text:l});
      continue;
    }
    if (!mode && looksIng && !steps.length){ ings.push(bare); continue; }
    if (!mode && ings.length && !steps.length && bare.length <= 40 && !/[.!?,]$/.test(bare) && !stepLike && !STEP_VERB.test(bare)){ ings.push(bare); continue; }
    const clean = bare.replace(/^step\s*\d+\s*[.):]?\s*|^\d+[.):]\s*/i, "");
    if (mode === "i") mode = "s";
    // A bold or heading line inside the method starts a step; bullets under it (or under a numbered step) join it
    if ((isHeading || boldOnly || (rawNumbered && /:$/.test(clean))) && clean.length <= 60){ steps.push(clean.replace(/:?\s*$/, ":")); group = true; continue; }
    if (rawNumbered){ steps.push(clean); group = true; continue; }
    if ((rawBullet || rawIndent) && group && lastStep){ steps[steps.length - 1] = joinStep(lastStep, clean); continue; }
    if (rawBullet){ steps.push(clean); group = false; continue; }
    if (lastStep && !stepLike && !/[.!?:)]$/.test(lastStep)) steps[steps.length - 1] = lastStep + " " + clean;
    else steps.push(clean);
  }
  // Name: a heading, else a short first line, else read it from the intro ("I'd make creamy orzo…")
  let name = mdTitle || title, nameSentence = "";
  if (!name) for (const x of intro){ for (const sn of sentencesOf(x.text)){ const t = titleFromSentence(sn); if (t){ name = t; nameSentence = sn; break; } } if (name) break; }
  const introText = intro.map(x => x.text).join(" ");
  const metaText = meta.join("\n");
  const serves = findServings(metaText) || findServings(introText) || findServings(src.split(/\n/).filter(x => x.length < 80).join("\n"));
  const times = findTimes(metaText + "\n" + introText + "\n" + src, introText);
  // Intro tips go to notes; greetings, the name sentence and time/serving sentences don't
  const introNotes = [];
  for (const x of intro){
    if (x.chatty) continue;
    for (const sn of sentencesOf(x.text)){
      if (sn === nameSentence) continue;
      if (/\b(serves|servings?|feeds|minutes?|mins?|hours?|hrs?)\b/i.test(sn) && sn.length < 70) continue;
      introNotes.push(sn);
    }
  }
  const allNotes = (introNotes.length ? [introNotes.join(" ")] : []).concat(notes);
  const pm = src.match(/(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)[\s-]*(?:inch|in\.?|")?\s*(?:pan|dish|baking)/i) || src.match(/(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)[\s-]*(?:inch|in\.?|")/i);
  const rm = src.match(/(\d+)[\s-]*(?:inch|in\.?|")\s*(?:round|cake pan|pie|skillet|springform|tube|bundt)/i);
  return {title: deEmoji(name).replace(/^recipe:\s*/i, "").replace(/\s*\((?:makes|serves|yields?|for)\b[^)]*\)\s*$/i, "").trim(), serves, prepTime: times.prep, cookTime: times.cook, totalTime: times.total,
    pan: pm ? {shape:"rect", width:+pm[1], length:+pm[2]} : rm ? {shape:"round", width:+rm[1], length:+rm[1]} : null,
    ingredients: ings.map(l => ({line:l, category:""})), steps, notes: allNotes.join("\n\n")};
}
function listEditor(kind, arr, pair){
  const isStep = kind === "steps";
  const sp = (i, del, ...items) => { if (pair){ while (pair.length < arr.length) pair.push(""); pair.splice(i, del, ...items.map(() => "")); } arr.splice(i, del, ...items); };
  const focusRow = i => setTimeout(() => { const el = document.getElementById("d-" + kind + "-" + i); if (el){ el.focus(); grow(el); } }, 0);
  const wrap = h("div", {class:"ledit"});
  arr.forEach((v, i) => {
    put(wrap, h("div", {class:"lrow"},
      h("span", {class: isStep ? "lnum" : "lnum bul", "aria-hidden":"true"}, isStep ? String(i + 1) : "•"),
      h("div", {class:"lcell"},
        h("textarea", {class:"in auto", id:"d-" + kind + "-" + i, rows:"1", "aria-label": (isStep ? "Step " : "Ingredient ") + (i + 1),
          placeholder: isStep ? (i === 0 ? "Heat the oven to 350°F." : "Next step") : (i === 0 ? "2 cups all-purpose flour" : i === 1 ? "1 tsp baking soda" : "Next ingredient"),
          oninput:e => { arr[i] = e.target.value; grow(e.target); },
          onkeydown:e => {
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); const el = e.target, at = el.selectionStart;
              arr[i] = el.value.slice(0, at).trimEnd(); sp(i + 1, 0, el.value.slice(at).trimStart()); render(); focusRow(i + 1); }
            else if (e.key === "Backspace" && e.target.value === "" && arr.length > 1){ e.preventDefault(); sp(i, 1); render(); focusRow(Math.max(0, i - 1)); }
          },
          onpaste:e => {
            const t = (e.clipboardData && e.clipboardData.getData("text")) || "";
            if (!/\n/.test(t.trim())) return;
            e.preventDefault();
            const parts = isStep ? t.split(/\n\s*\n|\n(?=\s*(?:step\s*)?\d+[.)]\s)/i) : t.split(/\r?\n/);
            const clean = parts.map(x => x.replace(/\s*\n\s*/g, " ").replace(/^[-–•*·▢☐□]\s*/, "").replace(/^(step\s*)?\d+[.):]\s*/i, "").trim()).filter(Boolean);
            if (!clean.length) return;
            const keepFirst = !!arr[i].trim();
            if (keepFirst) sp(i + 1, 0, ...clean); else sp(i, 1, ...clean);
            render(); focusRow(i + clean.length - (keepFirst ? 0 : 1));
          }}, v),
        isStep && pair ? h("label", {class:"useslbl"}, h("span", null, "Adds"),
          h("textarea", {class:"in uses auto", id:"d-uses-" + i, rows:"1", placeholder:"What goes in at this step, e.g. 1/2 cup butter; 2 eggs", oninput:e => { pair[i] = e.target.value.replace(/\n/g, " "); grow(e.target); }, onkeydown:e => { if (e.key === "Enter") e.preventDefault(); }}, pair[i] || "")) : null),
      h("button", {class:"x", type:"button", "aria-label":"Remove " + (isStep ? "step " : "ingredient ") + (i + 1), onclick:() => { sp(i, 1); if (!arr.length){ arr.push(""); if (pair) pair.push(""); } render(); }}, "×")));
  });
  put(wrap, h("button", {class:"btn ghost sm addline", type:"button", onclick:() => { sp(arr.length, 0, ""); render(); focusRow(arr.length - 1); }}, isStep ? "+ Add a step" : "+ Add an ingredient"));
  return wrap;
}
function reviewStep(sh, body, foot){
  const d = sh.draft;
  if (sh.kind !== "typed" && !sh.editingId) put(body, h("p", {class:"note", style:"margin:0"}, "Check everything against the original before saving" + (sh.kind === "card" ? ", especially words Live Text may have misread." : ".")));
  const panSel = h("select", {class:"in", id:"d-pan", onchange:e => {
    const v = e.target.value, p = panByKey(v), count = (d.pan && d.pan.count) || 1;
    d.pan = v === "" ? null : p ? {k:v, shape:p.shape, a:p.a, b:p.b, count} : {k:"custom", shape:"rect", a:"", b:"", count};
    render();
  }}, h("option", {value:"", selected:!d.pan}, "No pan (scale by servings)"), PANS.map(p => h("option", {value:p.k, selected: d.pan && d.pan.k === p.k}, p.label)), h("option", {value:"custom", selected: d.pan && d.pan.k === "custom"}, "Other size…"));
  const timeField = (key, label) => h("label", {class:"f", style:"flex:1 1 90px"}, label, h("input", {class:"in", id:"d-" + key, value:d[key], placeholder:"— min", oninput:e => { d[key] = e.target.value; }}));
  put(body,
    h("section", {class:"details", "aria-label":"Recipe details"},
      h("label", {class:"f"}, "Recipe name", h("textarea", {class:"in auto", id:"d-title", rows:"1", placeholder:"Grandma's pound cake", oninput:e => { d.title = e.target.value.replace(/\n/g, " "); grow(e.target); }, onkeydown:e => { if (e.key === "Enter") e.preventDefault(); }}, d.title)),
      h("div", {class:"inline"},
        h("label", {class:"f", style:"flex:1 1 90px"}, "Serves", h("input", {class:"in", id:"d-serves", value:d.serves, inputmode:"text", placeholder:"4", oninput:e => { d.serves = e.target.value; }})),
        timeField("prepTime", "Prep time"), timeField("cookTime", "Cook time"), timeField("totalTime", "Total time")),
      h("div", {class:"inline"},
        h("label", {class:"f", style:"flex:3 1 220px"}, "Original pan", panSel),
        d.pan ? h("label", {class:"f", style:"flex:1 1 90px"}, "Pans", h("select", {class:"in", id:"d-count", onchange:e => { d.pan.count = +e.target.value; }}, [1,2,3,4].map(n => h("option", {value:n, selected:(d.pan.count || 1) === n}, String(n))))) : null),
      d.pan && d.pan.k === "custom" ? customDims("d", d.pan, patch => { Object.assign(d.pan, patch); render(); }) : null),
    h("section", {class:"rsec"}, h("h3", null, "Ingredients"), h("p", {class:"note", style:"margin:-4px 0 0"}, "One per row. Return adds a row; a heading like “For the glaze:” ends with a colon."), listEditor("ings", d.ings)),
    h("section", {class:"rsec"},
      h("div", {class:"lblrow"}, h("h3", null, "Steps"),
        h("button", {class:"btn ghost sm", type:"button", onclick:() => {
          d.uses = usesStrings(d.ings.filter(x => x.trim()).map(line => ({line})), d.steps); render(); toast("Ingredients matched to steps. Check the Adds lines.");
        }}, "Match ingredients to steps")),
      h("p", {class:"note", style:"margin:-4px 0 0"}, "Each step's Adds line lists what goes in at that step, so nothing gets added too early."),
      listEditor("steps", d.steps, d.uses || (d.uses = d.steps.map(() => "")))),
    h("section", {class:"rsec"}, h("h3", null, "Notes"), h("textarea", {class:"in auto", id:"d-notes", rows:"2", placeholder:"Tips, swaps, variations", "aria-label":"Notes", oninput:e => { d.notes = e.target.value; grow(e.target); }}, d.notes)),
    h("label", {class:"f"}, "Source link", h("input", {class:"in", id:"d-url", type:"url", placeholder:"https://", value:d.url, oninput:e => { d.url = e.target.value; }})));
  if (sh.error) put(body, h("p", {class:"err"}, sh.error));
  put(foot,
    h("button", {class:"btn", type:"button", onclick: sh.editingId ? closeSheet : () => { sh.step = sh.kind === "typed" ? "choose" : "input"; render(); }}, sh.editingId ? "Cancel" : "Back"),
    h("button", {class:"btn primary", type:"button", onclick:() => {
      if (!d.title.trim()){ sh.error = "Give the recipe a name."; render(); document.getElementById("d-title").focus(); return; }
      const lines = d.ings.flatMap(x => String(x).split(/\r?\n/)).map(l => l.trim()).filter(Boolean);
      if (!lines.length){ sh.error = "Add at least one ingredient."; render(); return; }
      if (d.pan && d.pan.k === "custom" && !(+d.pan.a > 0 && (d.pan.shape === "round" || +d.pan.b > 0))){ sh.error = "Enter the pan's size in inches, or pick No pan."; render(); return; }
      const ingredients = lines.map(l => { const p = parseLine(l); const c = d.cats[l]; return {line:l, category: CATS.includes(c) ? c : (p && p.header ? "Other" : categorize((p && p.item) || l))}; });
      const pairs = d.steps.map((x, i) => ({t: String(x).replace(/\s*\n\s*/g, " ").replace(/^(step\s*)?\d+[.):]\s*/i, "").trim(), u: String((d.uses || [])[i] || "").trim()})).filter(x => x.t);
      const steps = pairs.map(x => x.t), uses = pairs.map(x => x.u);
      const pan = d.pan ? (d.pan.k === "custom" ? {k:"custom", shape:d.pan.shape, a:+d.pan.a, b: d.pan.shape === "round" ? +d.pan.a : +d.pan.b, count:d.pan.count || 1} : Object.assign({}, d.pan, {count:d.pan.count || 1})) : null;
      const serves = d.serves.trim().replace(/^serves\s*/i, ""), sm = serves.match(/\d+(?:\.\d+)?/);
      const rec = {title:d.title.trim(), source: sh.kind, serves, servings: sm ? +sm[0] : null,
        prepTime:d.prepTime.trim(), cookTime:d.cookTime.trim(), totalTime:d.totalTime.trim(), pan, ingredients, steps, uses: uses.some(Boolean) ? uses : [], notes:d.notes.trim(), url:d.url.trim()};
      if (sh.editingId){ rec.id = sh.editingId; if (d.createdAt) rec.createdAt = d.createdAt; if (d.example) rec.example = true; }
      const id = saveRecipe(rec), editing = !!sh.editingId;
      closeSheet(); S.scale = null;
      go("r-" + id); toast(editing ? "Recipe updated" : "Recipe saved");
    }}, sh.editingId ? "Save changes" : "Save recipe"));
}

/* ---------- start ---------- */
readHash();
if (FB_READY) startFirebase();
else { S.mode = "gate"; render(); }
})();
