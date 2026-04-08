// Memory Pattern Detector v4
// Quick Scan : XOR-first boolean/bit detection. Green = bits set (0→1), Red = bits cleared (1→0).
// Mass Change: popcount(XOR) per address, cluster by address proximity, match expected count.

// ── State ────────────────────────────────────────────────────────────────────
let scanMode             = 'quick';
let dirFilter            = 'all';    // 'all' | 'set' | 'clear' | 'mixed'
let nonStandardBooleans  = false;
let originalFilename     = '';
let activeCategory       = null;
let categories           = {};
let parsedRows           = [];
let currentClusters      = [];  // stored for re-filtering without re-analysis

// ── Category definitions ──────────────────────────────────────────────────────
const CATS = [
    { id: 'bit',    label: 'Single Bit Flip', color: 'var(--c-bit)'    },
    { id: 'nibble', label: 'Nibble Boolean',  color: 'var(--c-nibble)' },
    { id: 'byte',   label: 'Byte Boolean',    color: 'var(--c-byte)'   },
    { id: 'word',   label: 'Word Boolean',    color: 'var(--c-word)'   },
    { id: 'dword',  label: 'DWord Boolean',   color: 'var(--c-dword)'  },
];

// ── Instructions ──────────────────────────────────────────────────────────────
const INSTRUCTIONS = {
    quick: {
        steps: [
            { n: 1, text: '<strong>New Search</strong> and the first <code>== Last Value</code> filter sets the <strong>Initial Values</strong>. Use this to initialize the address pool.' },
            { n: 2, text: 'Perform actions <strong>unrelated</strong> to your target. Re-scan <code>== Last Value</code> every few seconds to filter out noise.' },
            { n: 3, text: 'Trigger the event that should change your target fields.' },
            { n: 4, text: 'Search <code>!= Last Value</code> <strong>once</strong>.' },
            { n: 5, text: 'Perform actions <strong>unrelated</strong> to your target. Re-scan <code>== Last Value</code> every few seconds to filter out noise.' },
            { n: 6, text: '<strong>Ensure the state during export contains different Current Values than Initial Values</strong> for accurate results.' },
            { n: 7, hl: true, text: 'Load the exported CSV here and click Analyze.' },
        ],
        note: 'Every address in the export already changed. The detector classifies what kind of change occurred. <span style="color:var(--c-set)">Green</span> = bit set. <span style="color:var(--c-clear)">Red</span> = bit cleared. <span style="color:var(--c-swap)">Orange</span> = bit swap (equal exchange).',
    },
    mass: {
        steps: [
            { n: 1, text: '<strong>New Search</strong> and the first <code>== Last Value</code> filter sets the <strong>Initial Values</strong>. Use this to initialize the address pool.' },
            { n: 2, text: 'Perform actions <strong>unrelated</strong> to your target. Re-scan <code>== Last Value</code> every few seconds to filter out noise.' },
            { n: 3, text: 'Trigger the event the expected number of times (e.g. open 12 chests, unlock 7 abilities).' },
            { n: 4, text: 'Search <code>!= Last Value</code> <strong>once</strong>.' },
            { n: 5, text: 'Perform actions <strong>unrelated</strong> to your target. Re-scan <code>== Last Value</code> every few seconds to filter out noise.' },
            { n: 6, text: '<strong>Ensure the state during export contains different Current Values than Initial Values</strong> for accurate results.' },
            { n: 7, hl: true, text: 'Load the exported CSV, enter expected count ± tolerance, then Analyze.' },
        ],
        note: 'All bit flips across addresses in a cluster are summed (popcount of XOR). Clusters whose total matches your expected count ± tolerance are flagged. <span style="color:var(--c-set)">Green</span> = bits set. <span style="color:var(--c-clear)">Red</span> = bits cleared. <span style="color:var(--c-swap)">Orange</span> = bits swapped (equal exchange).',
    },
};

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    document.getElementById('nonStandardToggle').addEventListener('change', e => {
        nonStandardBooleans = e.target.checked;
    });

    document.querySelectorAll('.mode-btn').forEach(btn =>
        btn.addEventListener('click', () => {
            if (btn.dataset.mode === scanMode) return;
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            scanMode = btn.dataset.mode;
            onModeChange();
        })
    );

    document.querySelectorAll('.dir-filter-btn').forEach(btn =>
        btn.addEventListener('click', () => {
            document.querySelectorAll('.dir-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            dirFilter = btn.dataset.filter;
            if (scanMode === 'quick') {
                if (activeCategory) renderTable(activeCategory);
            } else {
                renderClusters();
            }
        })
    );

    const csvFile = document.getElementById('csvFile');
    csvFile.addEventListener('change', () => {
        if (!csvFile.files.length) return;
        originalFilename = csvFile.files[0].name;
        document.getElementById('fileName').textContent = csvFile.files[0].name;
        document.getElementById('fileBar').style.display = 'flex';
        document.getElementById('resultsShell').style.display = 'none';
    });

    const zone = document.getElementById('uploadZone');
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const file = Array.from(e.dataTransfer.files).find(f => f.name.endsWith('.csv'));
        if (!file) return;
        const dt = new DataTransfer();
        dt.items.add(file);
        csvFile.files = dt.files;
        csvFile.dispatchEvent(new Event('change'));
    });

    document.getElementById('analyzeBtn').addEventListener('click', analyze);
    document.getElementById('exportBtn').addEventListener('click',  exportCSV);

    onModeChange();
});

function onModeChange() {
    renderInstructions();
    document.getElementById('massOptions').style.display  = scanMode === 'mass' ? 'flex' : 'none';
    document.getElementById('resultsShell').style.display = 'none';
}

// ── Instructions ──────────────────────────────────────────────────────────────
function renderInstructions() {
    const cfg = INSTRUCTIONS[scanMode];
    document.getElementById('instructionsBody').innerHTML = `
        <div class="instr-steps">
            ${cfg.steps.map(s => `
                <div class="instr-step">
                    <div class="step-num ${s.hl ? 'highlight' : ''}">${s.n}</div>
                    <div class="step-text">${s.text}</div>
                </div>`).join('')}
        </div>
        <div class="instr-note">${cfg.note}</div>
    `;
}

// ── CSV parsing ───────────────────────────────────────────────────────────────
function parseCSV(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) throw new Error('CSV has no data rows');

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const col     = name => headers.indexOf(name);
    const addrI  = col('address');
    const valI   = col('value');
    const initI  = col('initialvalue');
    if (addrI < 0 || valI < 0 || initI < 0)
        throw new Error('Missing required columns: Address, Value, InitialValue');

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = splitCSVLine(lines[i]);
        if (cols.length <= Math.max(addrI, valI, initI)) continue;
        const vStr = cols[valI].trim();
        const pStr = cols[initI].trim();
        const val  = hexParse(vStr);
        const prev = hexParse(pStr);
        if (isNaN(val) || isNaN(prev)) continue;
        rows.push({
            address:       cols[addrI].trim(),
            value:         val,
            previousValue: prev,
            width:         inferWidth(vStr, pStr),
        });
    }
    return rows;
}

function splitCSVLine(line) {
    const cols = [];
    let cur = '', q = false;
    for (const ch of line) {
        if (ch === '"') { q = !q; }
        else if (ch === ',' && !q) { cols.push(cur); cur = ''; }
        else cur += ch;
    }
    cols.push(cur);
    return cols;
}

function inferWidth(vStr, pStr) {
    const hexLen = s => s.replace(/^0x/i, '').replace(/^0+/, '').length;
    // Use raw char length (including leading zeros) for the padded form
    const rawLen = s => s.replace(/^0x/i, '').length;
    const maxLen = Math.max(rawLen(vStr), rawLen(pStr));
    if (maxLen <= 2) return 8;
    if (maxLen <= 4) return 16;
    if (maxLen <= 6) return 24;
    return 32;
}

function hexParse(s) {
    s = (s || '').trim();
    return parseInt(/^0x/i.test(s) ? s : '0x' + s, 16);
}

// ── XOR classification ────────────────────────────────────────────────────────
//
// Standard (default): boolean = 0↔1 or 0↔max per unit
// Non-Standard ON:    boolean = 0↔any-non-zero or max↔any-non-max per unit
// All granularities checked independently and simultaneously.
// 'bit': only when exactly ONE bit changed in the entire value.
//
// Helper: does (a, b) qualify as a boolean pair for a unit with given max?
function isBoolPair(a, b, max) {
    if (nonStandardBooleans) {
        return (a === 0 && b !== 0) || (a !== 0 && b === 0) ||
               (a === max && b !== max) || (a !== max && b === max);
    }
    return (a === 0 && (b === 1 || b === max)) ||
           (b === 0 && (a === 1 || a === max));
}

function classify(prev, curr, width) {
    const mask = widthMask(width);
    const xor  = ((prev ^ curr) >>> 0) & mask;
    const out  = { xor, matches: { bit: [], nibble: [], byte: [], word: [], dword: [] } };
    if (xor === 0) return out;

    // ── Single bit flip ──
    if ((xor & (xor - 1)) === 0) {
        const pos = Math.log2(xor);
        out.matches.bit.push({
            detail: `bit ${pos}: ${(prev >>> pos) & 1}→${(curr >>> pos) & 1}`,
            dir: ((curr >>> pos) & 1) === 1 ? 'set' : 'clear',
        });
    }

    // ── Bit swap: exactly one bit turned ON and one turned OFF ──
    // Signature of a single state-change flag (e.g. quest slot advancing)
    if (popcount(xor) === 2) {
        const bitsOn  = (curr & xor) >>> 0;   // bits that are now 1 (were 0)
        const bitsOff = (prev & xor) >>> 0;   // bits that are now 0 (were 1)
        if (popcount(bitsOn) === 1 && popcount(bitsOff) === 1) {
            const posOn  = Math.log2(bitsOn);
            const posOff = Math.log2(bitsOff);
            out.matches.bit.push({
                detail: `bit ${posOff}↓ bit ${posOn}↑ (±1 state)`,
                dir: 'swap',
            });
        }
    }

    // ── Nibble ──
    for (let i = 0; i < width / 4; i++) {
        const nP = (prev >>> (i * 4)) & 0xF;
        const nC = (curr >>> (i * 4)) & 0xF;
        if (nP === nC || !isBoolPair(nP, nC, 0xF)) continue;
        out.matches.nibble.push({
            detail: `nibble ${i}: 0x${nP.toString(16).toUpperCase()}→0x${nC.toString(16).toUpperCase()}`,
            dir: nC > nP ? 'set' : 'clear',
        });
    }

    // ── Byte ──
    for (let i = 0; i < width / 8; i++) {
        const bP = (prev >>> (i * 8)) & 0xFF;
        const bC = (curr >>> (i * 8)) & 0xFF;
        if (bP === bC || !isBoolPair(bP, bC, 0xFF)) continue;
        out.matches.byte.push({
            detail: `byte ${i}: 0x${bP.toString(16).padStart(2,'0').toUpperCase()}→0x${bC.toString(16).padStart(2,'0').toUpperCase()}`,
            dir: bC > bP ? 'set' : 'clear',
        });
    }

    // ── Word ──
    if (width >= 16) {
        for (let i = 0; i < width / 16; i++) {
            const wP = (prev >>> (i * 16)) & 0xFFFF;
            const wC = (curr >>> (i * 16)) & 0xFFFF;
            if (wP === wC || !isBoolPair(wP, wC, 0xFFFF)) continue;
            out.matches.word.push({
                detail: `word ${i}: 0x${wP.toString(16).padStart(4,'0').toUpperCase()}→0x${wC.toString(16).padStart(4,'0').toUpperCase()}`,
                dir: wC > wP ? 'set' : 'clear',
            });
        }
    }

    // ── DWord ──
    if (width === 32) {
        const pU = prev >>> 0, cU = curr >>> 0;
        if (isBoolPair(pU, cU, 0xFFFFFFFF))
            out.matches.dword.push({
                detail: `0x${pU.toString(16).padStart(8,'0').toUpperCase()}→0x${cU.toString(16).padStart(8,'0').toUpperCase()}`,
                dir: cU > pU ? 'set' : 'clear',
            });
    }

    return out;
}

function widthMask(w) {
    if (w >= 32) return 0xFFFFFFFF;
    return ((1 << w) - 1) >>> 0;
}

// ── Popcount ──────────────────────────────────────────────────────────────────
function popcount(v) {
    v = v >>> 0;
    v -= (v >>> 1) & 0x55555555;
    v  = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    v  = (v + (v >>> 4)) & 0x0f0f0f0f;
    return (Math.imul(v, 0x01010101) >>> 24);
}

// ── Main analysis ─────────────────────────────────────────────────────────────
async function analyze() {
    const files = document.getElementById('csvFile').files;
    if (!files.length) return;
    setStatus('Parsing…');

    try {
        const text = await files[0].text();
        const rows = parseCSV(text);

        parsedRows = [];
        for (const row of rows) {
            const val  = row.value         >>> 0;
            const prev = row.previousValue >>> 0;
            if (val === prev) continue;
            const { xor, matches } = classify(prev, val, row.width);
            parsedRows.push({ ...row, value: val, previousValue: prev, xor, matches });
        }

        if (scanMode === 'quick') runQuickScan();
        else                      runMassScan();

        document.getElementById('resultsShell').style.display = 'flex';

    } catch (err) {
        setStatus(err.message, true);
        console.error(err);
    }
}

// ── Quick Scan ────────────────────────────────────────────────────────────────
function runQuickScan() {
    categories = { bit: [], nibble: [], byte: [], word: [], dword: [] };

    for (const row of parsedRows) {
        for (const cat of CATS) {
            const arr = row.matches[cat.id];
            if (!arr || arr.length === 0) continue;
            // 'bit' category: single flip (arr.length===1) OR a pure bit-swap (one swap entry)
            if (cat.id === 'bit') {
                const swaps  = arr.filter(m => m.dir === 'swap');
                const flips  = arr.filter(m => m.dir !== 'swap');
                // Single flip only — no swap
                if (flips.length === 1 && swaps.length === 0) {
                    categories.bit.push({ ...row, detail: flips[0].detail, dir: flips[0].dir, allMatches: flips });
                }
                // Swap only — no other bit changes
                if (swaps.length === 1 && flips.length === 0) {
                    categories.bit.push({ ...row, detail: swaps[0].detail, dir: 'swap', allMatches: swaps });
                }
                continue;
            }
            categories[cat.id].push({
                ...row,
                detail: arr.map(m => m.detail).join(' · '),
                dir: arr.every(m => m.dir === arr[0].dir) ? arr[0].dir : 'mixed',
                allMatches: arr,
            });
        }
    }

    const totalMatched = new Set(
        parsedRows.filter(r => CATS.some(c => r.matches[c.id]?.length > 0)).map(r => r.address)
    ).size;

    setStatus(`${parsedRows.length.toLocaleString()} changed addresses · ${totalMatched.toLocaleString()} with pattern matches`);

    document.getElementById('quickResults').style.display = 'block';
    document.getElementById('massResults').style.display  = 'none';

    renderSummary();
    const first = CATS.find(c => categories[c.id].length > 0);
    if (first) selectCategory(first.id);
    else       renderTable(null);
}

// ── Mass Change ───────────────────────────────────────────────────────────────
function runMassScan() {
    const expected  = parseInt(document.getElementById('expectedCount').value) || 1;
    const tolerance = parseInt(document.getElementById('tolerance').value)     || 0;
    const radius    = parseInt(document.getElementById('clusterRadius').value) || 256;

    const changed = [...parsedRows]
        .sort((a, b) => addrNum(a.address) - addrNum(b.address));

    // Greedy cluster: extend while next address is within radius of cluster's FIRST address
    const clusters = [];
    let i = 0;
    while (i < changed.length) {
        const base    = addrNum(changed[i].address);
        const cluster = [changed[i]];
        let j = i + 1;
        while (j < changed.length && addrNum(changed[j].address) - base <= radius) {
            cluster.push(changed[j]);
            j++;
        }

        let bitsSet = 0, bitsCleared = 0;
        for (const r of cluster) {
            const mask = widthMask(r.width);
            bitsSet     += popcount(( r.value            & ~r.previousValue) & mask);
            bitsCleared += popcount((r.previousValue & ~r.value)             & mask);
        }

        clusters.push({ rows: cluster, bitsSet, bitsCleared, total: bitsSet + bitsCleared, expected, tolerance });
        i = j;
    }

    // Tolerance=0: exact only. Otherwise floor at 2.
    const lo = tolerance === 0 ? expected : Math.max(2, expected - tolerance);
    const hi = expected + tolerance;

    const matchFn = c => (c.bitsSet >= lo && c.bitsSet <= hi) ||
                         (c.bitsCleared >= lo && c.bitsCleared <= hi);
    const matching = clusters.filter(matchFn);

    setStatus(
        `${changed.length.toLocaleString()} changed addresses · ${clusters.length} clusters · ` +
        `${matching.length} match${matching.length !== 1 ? 'es' : ''} (target ${expected}${tolerance > 0 ? ` ± ${tolerance}` : ''})`
    );

    document.getElementById('quickResults').style.display = 'none';
    document.getElementById('massResults').style.display  = 'block';
    document.getElementById('massResultMeta').textContent =
        `${clusters.length} clusters · target ${expected}${tolerance > 0 ? ` ± ${tolerance}` : ''} · range ${lo}–${hi}`;

    currentClusters = clusters;
    renderClusters();
}

function renderClusters() {
    const container = document.getElementById('clusterList');
    container.innerHTML = '';

    if (!currentClusters.length) return;

    // Read expected/tolerance from the stored cluster metadata
    const { expected, tolerance } = currentClusters[0];
    const lo = tolerance === 0 ? expected : Math.max(2, expected - tolerance);
    const hi = expected + tolerance;

    // Range match: bitsSet OR bitsCleared in [lo, hi]
    const inRange = c => (c.bitsSet >= lo && c.bitsSet <= hi) ||
                         (c.bitsCleared >= lo && c.bitsCleared <= hi);

    // Direction filter for mass scan:
    //   all    — any in-range cluster
    //   set    — bitsSet in range, no cleared bits
    //   clear  — bitsCleared in range, no set bits
    //   mixed  — both bitsSet > 0 AND bitsCleared > 0, and either in range
    function passDirFilter(c) {
        if (!inRange(c)) return false;
        switch (dirFilter) {
            case 'all':   return true;
            case 'set':   return c.bitsSet >= lo && c.bitsSet <= hi && c.bitsCleared === 0;
            case 'clear': return c.bitsCleared >= lo && c.bitsCleared <= hi && c.bitsSet === 0;
            case 'mixed': return c.bitsSet > 0 && c.bitsCleared > 0;
        }
        return true;
    }

    const scored = [...currentClusters].sort((a, b) => {
        const da = Math.min(Math.abs(a.bitsSet - expected), Math.abs(a.bitsCleared - expected));
        const db = Math.min(Math.abs(b.bitsSet - expected), Math.abs(b.bitsCleared - expected));
        return da - db;
    });

    const matching  = scored.filter(passDirFilter);
    // Near: only show when tolerance > 0 AND direction filter is 'all'
    const nearLimit = (tolerance > 0 && dirFilter === 'all') ? 5 : 0;
    const nonMatch  = scored.filter(c => inRange(c) && !passDirFilter(c)).slice(0, nearLimit)
        .concat(tolerance > 0 ? scored.filter(c => !inRange(c)).slice(0, Math.max(0, nearLimit - scored.filter(c2 => inRange(c2) && !passDirFilter(c2)).length)) : []);

    const toRender  = [...matching, ...scored.filter(c => !passDirFilter(c)).slice(0, nearLimit)];

    if (!matching.length) {
        const best = scored.find(inRange) ?? scored[0];
        container.innerHTML = `
            <div class="empty-message">
                No clusters matched filter.<br>
                ${tolerance === 0
                    ? `Exact match for ${expected}: ${scored.filter(c => c.bitsSet === expected || c.bitsCleared === expected).length} found.`
                    : `Best: <strong>${best?.bitsSet ?? 0}</strong> set / <strong>${best?.bitsCleared ?? 0}</strong> cleared at ${best ? escHtml(best.rows[0].address) : '—'}`
                }
            </div>`;
    }

    // Render matched clusters first, then near-misses (only if tolerance > 0 and filter is 'all')
    const matchedSet = new Set(matching);
    const nearClusters = tolerance > 0 && dirFilter === 'all'
        ? scored.filter(c => !passDirFilter(c) && inRange(c)).slice(0, 5)
        : [];

    [...matching, ...nearClusters].forEach(cluster => {
        const isMatch   = matchedSet.has(cluster);
        const addrFirst = cluster.rows[0].address;
        const addrLast  = cluster.rows[cluster.rows.length - 1].address;
        const span      = addrNum(addrLast) - addrNum(addrFirst);

        const rowsHtml = cluster.rows.map(r => {
            const mask       = widthMask(r.width);
            const nSet       = popcount(( r.value            & ~r.previousValue) & mask);
            const nClr       = popcount((r.previousValue & ~r.value)             & mask);
            const badgesHtml = CATS.flatMap(cat => (r.matches[cat.id] || []).map(m =>
                `<span class="badge badge-${m.dir}">${escHtml(m.detail)}</span>`
            )).join(' ');
            const countHtml  = [
                nSet > 0 ? `<span style="color:var(--c-set)">+${nSet}</span>`   : '',
                nClr > 0 ? `<span style="color:var(--c-clear)">-${nClr}</span>` : '',
            ].filter(Boolean).join(' ');
            const isSwap = r.matches.bit?.some(m => m.dir === 'swap');

            return `
                <tr${isSwap ? ' class="row-swap"' : ''}>
                    <td class="addr-cell">${escHtml(r.address)}</td>
                    <td class="val-cell">${fmtHex(r.value, r.width)}</td>
                    <td class="val-cell">${fmtHex(r.previousValue, r.width)}</td>
                    <td class="xor-cell">${fmtHex(r.xor, r.width)}</td>
                    <td>${countHtml}</td>
                    <td>${badgesHtml || '<span style="color:var(--dim)">—</span>'}</td>
                </tr>`;
        }).join('');

        const card = document.createElement('div');
        card.className = `cluster-card ${isMatch ? 'match' : 'near-miss'}`;
        card.innerHTML = `
            <div class="cluster-header">
                <span class="cluster-match-badge ${isMatch ? 'match' : 'near'}">${isMatch ? '✓ Match' : '≈ Near'}</span>
                <span class="cluster-count">${cluster.rows.length} addr</span>
                <span class="cluster-count-detail">
                    <span style="color:var(--c-set)">↑${cluster.bitsSet}</span>
                    <span style="color:var(--c-clear)">↓${cluster.bitsCleared}</span>
                    bits
                </span>
                <span class="cluster-range">${escHtml(addrFirst)}${cluster.rows.length > 1 ? ` … ${escHtml(addrLast)}` : ''}</span>
                <span class="cluster-span">${span > 0 ? `${span}B span` : 'single addr'}</span>
                <span class="cluster-chevron">▶</span>
            </div>
            <div class="cluster-body">
                <table class="context-table">
                    <thead><tr>
                        <th>Address</th><th>Current</th><th>Initial</th>
                        <th>XOR</th><th>Bits ↑↓</th><th>Pattern</th>
                    </tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>`;

        card.querySelector('.cluster-header').addEventListener('click', () => card.classList.toggle('open'));
        container.appendChild(card);
    });

    if (tolerance > 0 && dirFilter === 'all' && scored.filter(c => !inRange(c)).length > 5) {
        const note = document.createElement('div');
        note.className = 'empty-message';
        note.textContent = `${scored.filter(c => !inRange(c)).length - 5} additional non-matching clusters not shown.`;
        container.appendChild(note);
    }
}

// ── Category pills + table ────────────────────────────────────────────────────
function renderSummary() {
    const strip = document.getElementById('summaryStrip');
    strip.innerHTML = '';
    CATS.forEach(cat => {
        const count = categories[cat.id].length;
        const pill  = document.createElement('button');
        pill.className = `cat-pill${count === 0 ? ' empty' : ''}`;
        pill.dataset.catId = cat.id;
        pill.style.setProperty('--pill-color', cat.color);
        pill.innerHTML = `
            <div class="cat-dot"></div>
            <div class="cat-info">
                <span class="cat-count">${count.toLocaleString()}</span>
                <span class="cat-label">${cat.label}</span>
            </div>`;
        if (count > 0) pill.addEventListener('click', () => selectCategory(cat.id));
        strip.appendChild(pill);
    });
}

function selectCategory(catId) {
    activeCategory = catId;
    document.querySelectorAll('.cat-pill').forEach(p =>
        p.classList.toggle('active', p.dataset.catId === catId)
    );
    renderTable(catId);
}

function renderTable(catId) {
    const tbody = document.getElementById('tableBody');
    const meta  = document.getElementById('tableMeta');
    tbody.innerHTML = '';

    if (!catId || !categories[catId]?.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-message">No matches in this category</td></tr>`;
        meta.textContent = '';
        return;
    }

    const cat  = CATS.find(c => c.id === catId);
    const rows = categories[catId].filter(r => {
        if (dirFilter === 'all')   return true;
        if (dirFilter === 'mixed') return r.dir === 'swap';
        if (r.dir === 'mixed') return r.allMatches.some(m => m.dir === dirFilter);
        return r.dir === dirFilter;
    });
    meta.textContent = `${rows.length.toLocaleString()} addresses · ${cat.label}`;

    rows.forEach(row => {
        const tr = document.createElement('tr');
        if (row.dir === 'swap') tr.classList.add('row-swap');
        const badgesHtml = (row.allMatches || [{ detail: row.detail, dir: row.dir }])
            .filter(m => dirFilter === 'all' || dirFilter === 'mixed' || m.dir === dirFilter)
            .map(m => `<span class="badge badge-${m.dir}">${escHtml(m.detail)}</span>`)
            .join(' ');
        tr.innerHTML = `
            <td class="addr-cell">${escHtml(row.address)}</td>
            <td class="val-cell">${fmtHex(row.value, row.width)}</td>
            <td class="val-cell">${fmtHex(row.previousValue, row.width)}</td>
            <td class="xor-cell">${fmtHex(row.xor, row.width)}</td>
            <td>${badgesHtml}</td>`;
        tbody.appendChild(tr);
    });
}

// ── Export ────────────────────────────────────────────────────────────────────
function exportCSV() {
    if (!activeCategory || !categories[activeCategory]?.length) return;
    const cat  = CATS.find(c => c.id === activeCategory);
    const rows = categories[activeCategory];
    let csv = 'Address,Current,Initial,XOR,Direction,Detail\n';
    rows.forEach(r => {
        csv += `${r.address},${fmtHex(r.value,r.width)},${fmtHex(r.previousValue,r.width)},${fmtHex(r.xor,r.width)},${r.dir},"${r.detail}"\n`;
    });
    dl(csv, originalFilename.replace(/\.csv$/i, '') + `_${cat.id}.csv`, 'text/plain;charset=utf-8');
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function addrNum(s) {
    const t = (s || '').trim();
    return parseInt(/^0x/i.test(t) ? t : '0x' + t, 16);
}

function fmtHex(v, width) {
    const pad = width ? Math.ceil(width / 4) : 8;
    return '0x' + (v >>> 0).toString(16).toUpperCase().padStart(pad, '0');
}

function setStatus(msg, isError = false) {
    const bar = document.getElementById('statusBar');
    bar.style.display = 'block';
    bar.className = `status-bar${isError ? ' error' : ''}`;
    document.getElementById('statusText').textContent = msg;
}

function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
}

function dl(content, filename, type) {
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([content], { type })),
        download: filename,
    });
    a.click();
    URL.revokeObjectURL(a.href);
}
