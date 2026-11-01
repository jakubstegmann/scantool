// =====================================================================
//  KĽÚČOVÉ SLOVÁ – TU UPRAVUJTE, AK APLIKÁCIA NEČÍTA FAKTÚRY SPRÁVNE
// =====================================================================
//  • Veľkosť písmen a diakritika sa pri hľadaní ignorujú
//    ("Číslo faktúry" == "cislo FAKTURY").
//  • Nové slovo stačí pridať ako ďalší riadok v úvodzovkách a s čiarkou na konci.
//  • Poradie v zozname nie je dôležité (dlhšie výrazy sa skúšajú skôr).
// =====================================================================
const KEYWORDS = {

  // Presné označenia čísla faktúry (najvyššia priorita).
  invoiceNumberLabels: [
    // slovensky / česky
    "číslo faktúry", "číslo faktury",
    "faktúra č", "faktura č",
    "faktúra číslo", "faktura číslo",
    "faktúra nr", "faktura nr",
    "daňový doklad č", "daňový doklad číslo",
    "doklad č", "doklad číslo", "číslo dokladu",
    // anglicky
    "invoice no", "invoice number", "invoice nr", "invoice #", "inv. no", "inv no",
    // maďarsky
    "számla sorszáma", "számlaszám", "számla száma", "bizonylatszám", "sorszám",
    // nemecky
    "rechnungsnummer", "rechnung nr", "rechnungs-nr",
  ],

  // Všeobecné slová (nižšia priorita): číslo sa berie len ak stojí hneď za nimi,
  // napr. „FAKTÚRA 2024001“.
  invoiceNumberGenericLabels: [
    "faktúra", "faktura", "invoice", "daňový doklad", "danovy doklad",
    "doklad", "számla", "rechnung",
  ],

  // Záložná možnosť, ak sa číslo faktúry nenašlo.
  variableSymbolLabels: [
    "variabilný symbol", "variabilní symbol", "variabilny symbol",
    "var. symbol", "var.symbol", "variable symbol", "vs",
  ],

  // Slová, za ktorými nasleduje dodávateľ.
  supplierLabels: [
    "dodávateľ", "dodavatel", "dodávatel",
    "predávajúci", "predavajuci", "prodávající", "prodavajici",
    "supplier", "vendor", "seller",
    "szállító", "eladó",
    "lieferant", "verkäufer",
  ],

  // Slová označujúce odberateľa – tam dodávateľ končí.
  buyerLabels: [
    "odberateľ", "odběratel", "odberatel",
    "kupujúci", "kupující", "zákazník", "zakaznik",
    "príjemca", "prijemca", "objednávateľ", "objednavatel",
    "customer", "buyer", "bill to",
    "vevő", "vevo", "megrendelő",
    "käufer", "kunde", "abnehmer",
  ],

  // Označenia IČO (pomáhajú nájsť blok s dodávateľom).
  companyIdLabels: ["ičo", "ič", "ico", "adószám", "adoszam"],

  // Typické koncovky názvov firiem (regulárne výrazy; text je už bez diakritiky a malými písmenami).
  companySuffixPatterns: [
    "(?<![\\p{L}])s\\.?\\s?r\\.?\\s?o\\.?(?![\\p{L}])",      // s.r.o., s. r. o., sro
    "(?<![\\p{L}])a\\.\\s?s\\.?(?![\\p{L}])",                 // a.s., a. s.
    "(?<![\\p{L}])spol\\.",                                    // spol. s r.o.
    "(?<![\\p{L}])k\\.\\s?s\\.?(?![\\p{L}])",                 // k.s.
    "(?<![\\p{L}])v\\.\\s?o\\.\\s?s\\.?",                     // v.o.s.
    "(?<![\\p{L}])s\\.\\s?p\\.",                               // š.p., s.p.
    "(?<![\\p{L}])(kft|zrt|nyrt|gmbh|ltd|inc|llc)\\.?(?![\\p{L}])",
    "(?<![\\p{L}])bt\\.",                                      // Bt.
  ],

  // Za týmito slovami sa názov firmy „odreže“ (IČO, adresa a pod.).
  supplierStopMarkers: [
    "ičo", "ič", "dič", "ič dph", "ic dph", "sídlo", "se sídlem", "so sídlom",
    "adószám", "adoszam", "tel", "iban",
  ],

  // Riadky začínajúce týmito slovami nie sú názov firmy.
  notANamePrefixes: [
    "ičo", "ič", "dič", "ič dph", "ic dph", "tel", "telefón", "telefon", "e-mail", "email",
    "www", "iban", "swift", "bic", "banka", "bank", "adresa", "ulica", "sídlo",
    "dátum", "datum", "číslo", "cislo", "faktúra", "faktura", "variabilný", "variabilni",
    "konštantný", "konstantny", "forma úhrady", "splatnosť", "splatnost",
  ],

  // „Vypĺňacie“ slová okolo čísla faktúry, ktoré sa pri čítaní hodnoty preskakujú.
  numberNoiseWords: [
    "c", "cis", "cislo", "no", "nr", "n", "num", "number",
    "faktura", "faktury", "invoice", "inv", "doklad", "dokladu", "danovy",
    "szamla", "sorszama", "szama", "sz", "rechnung",
  ],
};

// =====================================================================
//  PARSER
// =====================================================================

/** Zjednotí text (malé písmená, bez diakritiky) – znak po znaku, takže indexy zostanú rovnaké. */
function fold(s) {
  return Array.from(s).map(ch => {
    const f = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    return f.length ? Array.from(f)[0] : ch;
  });
}
const foldedString = s => fold(s).join("");
const isLetter = ch => /\p{L}/u.test(ch);
const isNumber = ch => /\p{N}/u.test(ch);
const normalizeSpaces = s => s.split(/\s+/).filter(Boolean).join(" ");
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function makeCell(text) {
  return { text, chars: Array.from(text), folded: fold(text) };
}

function makeLines(text) {
  return text.normalize("NFC").split(/\r?\n/)
    .map(raw => raw.split("\t").map(normalizeSpaces).filter(x => x).map(makeCell))
    .filter(cells => cells.length > 0);
}

/** Nájde label v riadku ako samostatné slovo/frázu. Vráti {start,end} (indexy znakov) alebo null. */
function findLabel(label, line) {
  if (!label.length || line.length < label.length) return null;
  for (let i = 0; i + label.length <= line.length; i++) {
    if (line[i] !== label[0]) continue;
    let same = true;
    for (let k = 1; k < label.length; k++) if (line[i + k] !== label[k]) { same = false; break; }
    if (!same) continue;
    const end = i + label.length;
    const beforeOK = i === 0 || !(isLetter(line[i - 1]) || isNumber(line[i - 1]));
    const afterOK = end >= line.length || !isLetter(line[end]);
    if (beforeOK && afterOK) return { start: i, end };
  }
  return null;
}

// ---------- Číslo faktúry ----------

const TOKEN_TRIM = /^[:;,#()\[\]"'“”„|\/–—\-.]+|[:;,#()\[\]"'“”„|\/–—\-.]+$/g;
const trimToken = s => s.replace(TOKEN_TRIM, "");
const NOISE = new Set(KEYWORDS.numberNoiseWords);

function isOnlyNoise(text) {
  for (const raw of text.split(/\s+/)) {
    const t = trimToken(raw);
    if (!t) continue;
    if (NOISE.has(foldedString(t))) continue;
    return false;
  }
  return true;
}

function isDate(s) {
  return [
    /^\d{1,2}\.\s?\d{1,2}\.\s?(\d{2}|\d{4})?\.?$/,
    /^\d{4}-\d{2}-\d{2}$/,
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
  ].some(re => re.test(s));
}

/** Prvý „podobný číslu faktúry“ token (obsahuje číslicu, nie je to dátum). */
function firstNumberToken(text) {
  const tokens = text.split(/\s+/).filter(Boolean).slice(0, 6);
  for (const raw of tokens) {
    let t = trimToken(raw);
    if (!t) continue;

    // „č.2024001“, „No:123“ – odstráň prilepenú predponu
    const f = fold(t).join("");
    for (const p of ["c.", "c:", "no.", "no:", "nr.", "nr:", "cislo:", "cislo."]) {
      if (f.length > p.length && f.startsWith(p)) {
        t = trimToken(Array.from(t).slice(p.length).join(""));
        break;
      }
    }
    if (!t) continue;
    if (NOISE.has(foldedString(t))) continue;
    if (isDate(raw)) return null;

    const hasDigit = Array.from(t).some(isNumber);
    if (!hasDigit) return null;                    // obyčajné slovo → hodnota tu nie je
    const len = Array.from(t).length;
    if (len >= 2 && len <= 30) return t;
    return null;
  }
  return null;
}

function scan(lines, labels, allowBelow) {
  const folded = labels.map(fold).sort((a, b) => b.length - a.length);
  for (let li = 0; li < lines.length; li++) {
    for (let ci = 0; ci < lines[li].length; ci++) {
      const cell = lines[li][ci];
      for (const label of folded) {
        const r = findLabel(label, cell.folded);
        if (!r) continue;
        const remainder = cell.chars.slice(r.end).join("");

        // 1) hodnota hneď za kľúčovým slovom: „Faktúra č.: 2024001“
        let v = firstNumberToken(remainder);
        if (v) return v;
        if (!isOnlyNoise(remainder)) continue;

        // 2) hodnota v susednej bunke v tom istom riadku: „Číslo faktúry | 2024001“
        if (ci + 1 < lines[li].length) {
          const next = lines[li][ci + 1];
          if (next.text.split(" ").length <= 3) {
            v = firstNumberToken(next.text);
            if (v) return v;
          }
        }
        // 3) hodnota pod nadpisom stĺpca
        if (allowBelow && li + 1 < lines.length) {
          const row = lines[li + 1];
          v = firstNumberToken(row[Math.min(ci, row.length - 1)].text);
          if (v) return v;
        }
      }
    }
  }
  return null;
}

/**
 * Poradie: pravidlá naučené pre konkrétneho dodávateľa → vstavané presné označenia →
 * všeobecne naučené označenia → všeobecné slová → variabilný symbol.
 */
function findInvoiceNumber(lines, learned, supplier) {
  const tryScan = labels => (labels && labels.length ? scan(lines, labels, true) : null);
  const key = squash(supplier || "");
  return tryScan(learned && key ? learned.numberLabels[key] : null)
    || scan(lines, KEYWORDS.invoiceNumberLabels, true)
    || tryScan(learned && learned.globalLabels)
    || scan(lines, KEYWORDS.invoiceNumberGenericLabels, false)
    || scan(lines, KEYWORDS.variableSymbolLabels, true);
}

// ---------- Dodávateľ ----------

const SUFFIX_RES = KEYWORDS.companySuffixPatterns.map(p => new RegExp(p, "u"));
const hasCompanySuffix = text => { const f = foldedString(text); return SUFFIX_RES.some(re => re.test(f)); };

const SEPARATORS = /^[,;:|\/–—\-\s]+|[,;:|\/–—\-\s]+$/g;
const trimSeparators = s => s.replace(SEPARATORS, "");

function cleanSupplier(s) {
  let t = normalizeSpaces(trimSeparators(s));
  if (Array.from(t).length > 70) t = trimSeparators(Array.from(t).slice(0, 70).join(""));
  return t;
}

const BUYER_FOLDED = KEYWORDS.buyerLabels.map(fold);
const containsBuyerLabel = cell => BUYER_FOLDED.some(b => findLabel(b, cell.folded) !== null);

const STOP_RE = new RegExp(
  "(?<![\\p{L}\\p{N}])(" +
  KEYWORDS.supplierStopMarkers.concat(KEYWORDS.buyerLabels).map(m => escapeRegExp(foldedString(m))).join("|") +
  ")(?![\\p{L}\\p{N}])", "u");

/** Odreže text od prvého výskytu IČO / sídlo / odberateľ … */
function cutAtStopMarkers(text) {
  const m = STOP_RE.exec(foldedString(text));
  if (!m) return text;
  const offset = Array.from(foldedString(text).slice(0, m.index)).length;
  return Array.from(text).slice(0, offset).join("").trim();
}

const NOT_NAME_FOLDED = KEYWORDS.notANamePrefixes.map(fold).concat(BUYER_FOLDED);

function isPlausibleName(text) {
  const t = text.trim();
  const chars = Array.from(t);
  if (!chars.length || !isLetter(chars[0]) || chars.length > 80) return false;
  if (chars.filter(isLetter).length < 3) return false;
  const f = fold(t);
  const fs = f.join("");
  if (fs.includes("@") || fs.includes("www.")) return false;
  for (const p of NOT_NAME_FOLDED) {
    const r = findLabel(p, f);
    if (r && r.start === 0) return false;
  }
  return true;
}

function supplierNear(lines, li, ci, labelEnd) {
  const cell = lines[li][ci];
  let rest = cell.chars.slice(labelEnd).join("");
  const hadColon = rest.trim().startsWith(":");
  rest = cutAtStopMarkers(trimSeparators(rest));

  // 1) názov hneď za kľúčovým slovom
  if (rest && (hasCompanySuffix(rest) || (hadColon && isPlausibleName(rest)))) return cleanSupplier(rest);

  // 2) názov v susednej bunke toho istého riadku
  if (!rest && ci + 1 < lines[li].length) {
    const next = lines[li][ci + 1];
    if (!containsBuyerLabel(next) && hasCompanySuffix(next.text)) return cleanSupplier(cutAtStopMarkers(next.text));
  }
  // 3) nasledujúce riadky (stĺpec s rovnakým poradím ako kľúčové slovo)
  let firstPlausible = null;
  for (let k = 1; k <= 6; k++) {
    if (li + k >= lines.length) break;
    const row = lines[li + k];
    const target = row[Math.min(ci, row.length - 1)];
    if (containsBuyerLabel(target)) break;
    const text = cutAtStopMarkers(target.text);
    if (hasCompanySuffix(text)) return cleanSupplier(text);
    if (firstPlausible === null && isPlausibleName(text)) firstPlausible = text;
  }
  return firstPlausible === null ? null : cleanSupplier(firstPlausible);
}

function findSupplier(lines) {
  const labels = KEYWORDS.supplierLabels.map(fold).sort((a, b) => b.length - a.length);
  for (let li = 0; li < lines.length; li++) {
    for (let ci = 0; ci < lines[li].length; ci++) {
      for (const label of labels) {
        const r = findLabel(label, lines[li][ci].folded);
        if (!r) continue;
        const s = supplierNear(lines, li, ci, r.end);
        if (s) return s;
      }
    }
  }
  return null;
}

function companyIn(row, maxCol) {
  // maxCol > 0: stĺpce od odberateľského stĺpca doprava sa ignorujú
  const cells = maxCol > 0 ? row.slice(0, maxCol) : row;
  const cell = cells.find(c => hasCompanySuffix(c.text) && !containsBuyerLabel(c));
  if (!cell) return null;
  const name = cleanSupplier(cutAtStopMarkers(cell.text));
  return name || null;
}

/** Ak chýba kľúčové slovo „Dodávateľ“: prvá firma s koncovkou, najlepšie pri prvom IČO. */
function fallbackSupplier(lines) {
  let limit = Math.min(lines.length, 30);
  const b = lines.findIndex(row => row.some(containsBuyerLabel));
  if (b > 2) limit = Math.min(limit, b);
  const head = lines.slice(0, limit);

  // v ktorom stĺpci stojí slovo „Odberateľ“ (dodávateľ je vtedy naľavo od neho)
  let buyerCol = -1;
  for (const row of lines) {
    const k = row.findIndex(containsBuyerLabel);
    if (k >= 0) { buyerCol = k; break; }
  }

  const idLabels = KEYWORDS.companyIdLabels.map(fold);
  const icoRow = head.findIndex(row => row.some(c => idLabels.some(l => findLabel(l, c.folded) !== null)));
  if (icoRow >= 0) {
    for (let j = icoRow; j >= Math.max(0, icoRow - 5); j--) {
      const s = companyIn(head[j], buyerCol);
      if (s) return s;
    }
  }
  for (const row of head) {
    const s = companyIn(row, buyerCol);
    if (s) return s;
  }
  return null;
}

// =====================================================================
//  UČENIE Z OPRÁV
//  Keď používateľ opraví údaj a potvrdí ho (premenovaním), zapamätá sa:
//   • dodávateľ – ak jeho názov stojí v texte faktúry, nabudúce sa nájde priamo podľa názvu;
//   • oprava názvu – ak rozpoznaný názov bol len mierne iný ("Slovak Telekom, a.s." → "Telekom");
//   • označenie čísla faktúry – slová pri čísle (napr. "Ev. č. dokladu"), pre daného dodávateľa;
//     ak sa rovnaké označenie naučí pri 2 rôznych dodávateľoch, platí pre všetkých.
// =====================================================================

/** Bez diakritiky, malé písmená, všetko okrem písmen a čísel nahradené jednou medzerou. */
function squash(s) {
  return foldedString(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function emptyLearned() {
  return { suppliers: [], aliases: {}, numberLabels: {}, globalLabels: [], numberShapes: {} };
}

/** Doplní chýbajúce časti (aj ak je uložený starší alebo poškodený formát). */
function normalizeLearned(obj) {
  const l = emptyLearned();
  if (!obj || typeof obj !== "object") return l;
  if (Array.isArray(obj.suppliers)) l.suppliers = obj.suppliers.filter(s => typeof s === "string" && s);
  if (obj.aliases && typeof obj.aliases === "object") l.aliases = obj.aliases;
  if (obj.numberLabels && typeof obj.numberLabels === "object") l.numberLabels = obj.numberLabels;
  if (Array.isArray(obj.globalLabels)) l.globalLabels = obj.globalLabels.filter(s => typeof s === "string" && s);
  if (obj.numberShapes && typeof obj.numberShapes === "object") l.numberShapes = obj.numberShapes;
  return l;
}

function learnedStats(l) {
  return {
    suppliers: l.suppliers.length,
    aliases: Object.keys(l.aliases).length,
    labels: Object.values(l.numberLabels).reduce((n, a) => n + a.length, 0) + l.globalLabels.length,
    shapes: Object.values(l.numberShapes).reduce((n, a) => n + a.length, 0),
  };
}

// ---------- tvar čísla faktúry (napr. "FV-2024-001" → "AA-9999-999") ----------

/** Číslica → "9", písmeno → "A", ostatné znaky ostanú. */
const shapeOf = s => Array.from(s).map(ch => isNumber(ch) ? "9" : isLetter(ch) ? "A" : ch).join("");

// Znaky, ktoré OCR často zamieňa (písmeno ↔ číslica)
const TO_DIGIT = { O: "0", o: "0", Q: "0", D: "0", l: "1", I: "1", i: "1", "|": "1", S: "5", s: "5", B: "8", Z: "2", z: "2", G: "6" };
const TO_LETTER = { "0": "O", "1": "I", "5": "S", "8": "B", "2": "Z", "6": "G" };

/** Zjednotí zamieňané znaky, aby sa dali porovnať dve podobné čítania toho istého čísla. */
const canon = s => Array.from(s).map(ch => TO_DIGIT[ch] || ch.toUpperCase()).join("");

/** Opraví OCR zámeny podľa tvaru (na mieste číslice je písmeno O → 0 a pod.), alebo vráti null. */
function repairByShape(token, shape) {
  const chars = Array.from(token), sh = Array.from(shape);
  if (chars.length !== sh.length) return null;
  const out = [];
  for (let i = 0; i < sh.length; i++) {
    let c = chars[i];
    if (sh[i] === "9") { if (!isNumber(c)) c = TO_DIGIT[c]; }
    else if (sh[i] === "A") { if (!isLetter(c)) c = TO_LETTER[c]; }
    else if (c !== sh[i]) c = undefined;
    if (c === undefined) return null;
    out.push(c);
  }
  return out.join("");
}

/** Ak číslo nezodpovedá žiadnemu naučenému tvaru dodávateľa, skúsi ho opraviť podľa OCR zámen. */
function fixNumberByShape(number, shapes) {
  if (!number || !shapes || !shapes.length) return number;
  const sh = shapeOf(number);
  if (shapes.includes(sh)) return number;
  for (const s of shapes) { const r = repairByShape(number, s); if (r) return r; }
  return number;
}

/** Číslo v texte podľa naučeného tvaru (len tvary s písmenom/oddeľovačom – samé číslice by sa pletli s IČO a pod.). */
function findNumberByShape(lines, shapes) {
  for (const s of (shapes || [])) {
    if (!/[^9]/.test(s)) continue;
    for (const row of lines) for (const cell of row) for (const raw of cell.text.split(/\s+/)) {
      const t = trimToken(raw);
      if (t && shapeOf(t) === s && !isDate(t)) return t;
    }
  }
  return null;
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Sú dva (už "squashnuté") názvy dosť podobné na to, aby šlo o ten istý dodávateľ? */
function similarNames(a, b) {
  if (!a || !b) return false;
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return true;
  return editDistance(a, b) <= Math.max(2, Math.floor(0.2 * Math.max(a.length, b.length)));
}

/** Je (squashnutý) názov v (squashnutom) texte ako samostatné slová? */
const containsName = (squashedText, squashedName) =>
  squashedName.length >= 4 && (" " + squashedText + " ").includes(" " + squashedName + " ");

/** Zapamätaný dodávateľ, ktorého názov je v texte (najdlhší zhodný). */
function findKnownSupplier(text, learned) {
  if (!learned || !learned.suppliers.length) return null;
  const st = squash(text);
  let best = null;
  for (const name of learned.suppliers) {
    if (containsName(st, squash(name)) && (best === null || squash(name).length > squash(best).length)) best = name;
  }
  return best;
}

function applyAlias(supplier, learned) {
  if (!supplier || !learned) return supplier;
  return learned.aliases[squash(supplier)] || supplier;
}

/** Zoznam slov, ktoré sa dajú použiť ako označenie čísla (bez čísel a oddeľovačov), alebo null. */
function cleanLabel(text) {
  let t = text.replace(/[\s:;#.\-–—|\/]+$/u, "");
  const words = t.split(/\s+/).filter(Boolean);
  let lastDigit = -1;
  words.forEach((w, i) => { if (Array.from(w).some(isNumber)) lastDigit = i; });
  const label = words.slice(Math.max(lastDigit + 1, words.length - 3)).join(" ").replace(/^[:;#.\-–—|\/\s]+/u, "");
  if (Array.from(label).filter(isLetter).length < 3 || Array.from(label).length > 40) return null;
  if (BUYER_FOLDED.some(b => findLabel(b, fold(label)) !== null)) return null;
  return label;
}

function indexOfSeq(hay, needle) {
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let same = true;
    for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) { same = false; break; }
    if (same) return i;
  }
  return -1;
}

/** Nájde v texte opravené číslo a odvodí z jeho okolia označenie ("Ev. č. dokladu"). */
function deriveNumberLabel(lines, number) {
  const needle = fold(number);

  // Z miesta v bunke (idx = začiatok čísla) odvodí označenie a overí ho na tomto texte.
  const labelAt = (li, ci, idx) => {
    const cell = lines[li][ci];
    const candidates = [cell.chars.slice(0, idx).join("")];                       // "Faktúra č. 123"
    if (ci > 0) candidates.push(lines[li][ci - 1].text);                           // "Číslo | 123"
    if (li > 0 && ci < lines[li - 1].length) candidates.push(lines[li - 1][ci].text); // hlavička stĺpca
    for (const c of candidates) {
      const label = cleanLabel(c);
      if (!label) continue;
      const found = scan(lines, [label], true);
      if (found && canon(found) === canon(number)) return label;
    }
    return null;
  };

  // 1) presná zhoda
  for (let li = 0; li < lines.length; li++) {
    for (let ci = 0; ci < lines[li].length; ci++) {
      const cell = lines[li][ci];
      const idx = indexOfSeq(cell.folded, needle);
      if (idx < 0) continue;
      const end = idx + needle.length;
      if (idx > 0 && (isLetter(cell.folded[idx - 1]) || isNumber(cell.folded[idx - 1]))) continue;
      if (end < cell.folded.length && (isLetter(cell.folded[end]) || isNumber(cell.folded[end]))) continue;
      const label = labelAt(li, ci, idx);
      if (label) return label;
    }
  }

  // 2) zhoda s toleranciou na OCR zámeny (O↔0, l↔1, S↔5 …): používateľ opravil číslo,
  //    ktoré OCR prečítalo trochu inak
  const target = canon(number);
  for (let li = 0; li < lines.length; li++) {
    for (let ci = 0; ci < lines[li].length; ci++) {
      const cell = lines[li][ci];
      let start = -1;
      for (let i = 0; i <= cell.chars.length; i++) {
        const space = i === cell.chars.length || /\s/.test(cell.chars[i]);
        if (!space) { if (start < 0) start = i; continue; }
        if (start >= 0) {
          const tok = trimToken(cell.chars.slice(start, i).join(""));
          if (tok && canon(tok) === target) {
            const label = labelAt(li, ci, start);
            if (label) return label;
          }
          start = -1;
        }
      }
    }
  }
  return null;
}

/**
 * Naučí sa z jedného potvrdeného riadku.
 *  text  – rozpoznaný text faktúry
 *  final – údaje, ktoré používateľ potvrdil  { number, supplier }
 *  auto  – údaje, ktoré našiel program       { number, supplier }
 * Vráti { supplier, alias, label, shape } (bool) podľa toho, čo sa nové naučilo.
 */
function learnFromCorrection(learned, text, final, auto) {
  const res = { supplier: false, alias: false, label: false, shape: false };
  const fSup = (final.supplier || "").trim(), aSup = (auto.supplier || "").trim();
  const fNum = (final.number || "").trim(), aNum = (auto.number || "").trim();

  if (fSup && squash(fSup) !== squash(aSup)) {
    const fKey = squash(fSup), aKey = squash(aSup);
    if (aKey && similarNames(aKey, fKey) && learned.aliases[aKey] !== fSup) {
      learned.aliases[aKey] = fSup; res.alias = true;
    }
    if (containsName(squash(text), fKey) && !learned.suppliers.some(s => squash(s) === fKey)) {
      learned.suppliers.push(fSup); res.supplier = true;
    }
  }

  if (fNum && fNum !== aNum) {
    // tvar čísla (len ak je známy dodávateľ) – slúži na opravu OCR zámen a ako záložné hľadanie
    const supKey0 = squash(fSup);
    if (supKey0) {
      const shapes = learned.numberShapes[supKey0] || (learned.numberShapes[supKey0] = []);
      const sh = shapeOf(fNum);
      if (!shapes.includes(sh)) { shapes.push(sh); if (shapes.length > 6) shapes.shift(); res.shape = true; }
    }

    const label = deriveNumberLabel(makeLines(text), fNum);
    if (label) {
      const lk = squash(label), supKey = squash(fSup);
      if (!supKey) {
        if (!learned.globalLabels.some(l => squash(l) === lk)) { learned.globalLabels.push(label); res.label = true; }
      } else {
        const list = learned.numberLabels[supKey] || (learned.numberLabels[supKey] = []);
        if (!list.some(l => squash(l) === lk)) { list.push(label); res.label = true; }
        const users = Object.values(learned.numberLabels).filter(a => a.some(l => squash(l) === lk)).length;
        if (users >= 2 && !learned.globalLabels.some(l => squash(l) === lk)) learned.globalLabels.push(label);
      }
    }
  }
  return res;
}

/** Vstup: rozpoznaný text (bunky v riadku oddelené tabulátorom), voliteľne naučené údaje. */
function parseInvoice(text, learned) {
  const lines = makeLines(text);
  const supplier = findKnownSupplier(text, learned)
    || applyAlias(findSupplier(lines) || fallbackSupplier(lines) || "", learned);
  const shapes = learned && supplier ? learned.numberShapes[squash(supplier)] : null;
  let number = findInvoiceNumber(lines, learned, supplier);
  if (number) number = fixNumberByShape(number, shapes);
  else number = findNumberByShape(lines, shapes);
  return { number: number || "", supplier };
}

if (typeof module !== "undefined") {
  module.exports = { parseInvoice, KEYWORDS, emptyLearned, normalizeLearned, learnedStats, learnFromCorrection };
}
