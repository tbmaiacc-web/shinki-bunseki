/* ================================================================
   セラピスト別顧客分析 app.js  v2 — 集計データ対応版
   ================================================================ */

// ==================== STATE ====================
const state = {
    months: [],             // [{ period, therapists, data }]
    allTherapists: [],      // 全月のセラピスト名の和集合
    currentMonthIdx: 0,     // ダッシュボードで表示中の月のインデックス
    currentTherapist: 'all',
    totalTherapist: 'all',
    currentView: 'dashboard', // 'dashboard' | 'trend' | 'total'
    charts: {},
    goodThreshold: 50,
    badThreshold: 30,
};

const TREND_COLORS = [
    'rgba(79,70,229,0.85)',
    'rgba(16,185,129,0.85)',
    'rgba(245,158,11,0.85)',
    'rgba(236,72,153,0.85)',
    'rgba(59,130,246,0.85)',
    'rgba(139,92,246,0.85)',
    'rgba(239,68,68,0.85)',
];

const CHART_COLORS = {
    pink:   'rgba(236,72,153,0.85)',
    blue:   'rgba(59,130,246,0.85)',
    indigo: 'rgba(79,70,229,0.85)',
    indigoLight: 'rgba(79,70,229,0.25)',
    green:  'rgba(16,185,129,0.85)',
    purple: 'rgba(139,92,246,0.85)',
    purpleLight: 'rgba(139,92,246,0.25)',
    amber:  'rgba(245,158,11,0.85)',
    gray:   'rgba(156,163,175,0.85)',
};

// ==================== データ構造 ====================
function emptyData() {
    return {
        total:       { purchase: 0, treated: 0, rate: null },
        gender: {
            male:   { purchase: 0, treated: 0, rate: null },
            female: { purchase: 0, treated: 0, rate: null },
        },
        ageTotal:    {},
        ageByGender: { male: {}, female: {} },
        media:       { total: {}, male: {}, female: {} },
        symptoms:    {},
    };
}

// ==================== CSV アップロード ====================
document.getElementById('csv-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleFile(file);
});

document.getElementById('add-month-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleFile(file);
    e.target.value = '';
});

document.getElementById('add-month-btn').addEventListener('click', () => {
    document.getElementById('add-month-input').click();
});

const uploadArea = document.getElementById('upload-area');
uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
});

document.getElementById('sample-btn').addEventListener('click', () => loadCSVText(SAMPLE_CSV, '伊勢崎宮子院 2026年4月'));

document.getElementById('reset-btn').addEventListener('click', () => {
    destroyCharts();
    state.months = [];
    state.allTherapists = [];
    state.currentView = 'dashboard';
    state.currentMonthIdx = 0;
    state.currentTherapist = 'all';
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('upload-section').classList.remove('hidden');
    document.getElementById('csv-input').value = '';
});

function handleFile(file) {
    const name = file.name.replace(/\.csv$/i, '');

    function tryLoad(encoding) {
        const reader = new FileReader();
        reader.onload = e => {
            const text = e.target.result;
            // 文字化けチェック（?が多い場合は別エンコーディングで再試行）
            if (encoding === 'utf-8' && (text.includes('�') || /\?{5,}/.test(text))) {
                tryLoad('shift-jis');
                return;
            }
            try { loadCSVText(text, name); }
            catch (err) { alert('CSV読み込みエラー: ' + err.message); }
        };
        reader.readAsText(file, encoding);
    }
    tryLoad('utf-8');
}

// ファイル名から年*100+月 の数値を返す（ソート用）
function extractYearMonth(period) {
    const m = period.match(/(\d{4})年(\d{1,2})月/);
    if (m) return parseInt(m[1]) * 100 + parseInt(m[2]);
    return 0;
}

// ファイル名を省略表示用に整形
function abbreviatePeriod(period) {
    return period
        .replace(/帳簿\d{4}年/, '')
        .replace(/\s*[-－].*$/, '')
        .trim();
}

function loadCSVText(text, title) {
    const isFirst = state.months.length === 0;
    const result = parseCSV(text);
    const period = title || '';

    // 同じ period 名なら上書き、なければ push
    const existIdx = state.months.findIndex(m => m.period === period);
    if (existIdx >= 0) {
        state.months[existIdx] = { period, therapists: result.therapists, data: result.data };
    } else {
        state.months.push({ period, therapists: result.therapists, data: result.data });
    }

    // 年月でソート
    state.months.sort((a, b) => extractYearMonth(a.period) - extractYearMonth(b.period));

    // allTherapists を全月の和集合に更新
    const therapistSet = new Set();
    state.months.forEach(m => m.therapists.forEach(t => therapistSet.add(t)));
    state.allTherapists = [...therapistSet];

    // currentMonthIdx を追加した月のインデックスに更新（ソート後）
    const newIdx = state.months.findIndex(m => m.period === period);
    if (isFirst) {
        state.currentMonthIdx = 0;
        state.currentTherapist = 'all';
        state.currentView = 'dashboard';
    } else {
        state.currentMonthIdx = newIdx >= 0 ? newIdx : state.currentMonthIdx;
    }

    document.getElementById('app-title').textContent = 'セラピスト別顧客分析';
    document.getElementById('upload-section').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');

    renderMonthsBar();
    renderTabs();
    if (isFirst || state.currentView === 'dashboard') {
        showDashboard();
    } else if (state.currentView === 'trend') {
        showTrend();
    } else if (state.currentView === 'total') {
        showTotal();
    }
}

// ==================== 月チップバー ====================
function renderMonthsBar() {
    const bar = document.getElementById('months-bar');
    bar.innerHTML = '';
    state.months.forEach((m, i) => {
        const label = abbreviatePeriod(m.period);
        const chip = document.createElement('span');
        chip.className = 'month-chip' + (state.currentView === 'dashboard' && i === state.currentMonthIdx ? ' active' : '');

        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        labelSpan.addEventListener('click', () => {
            state.currentMonthIdx = i;
            state.currentView = 'dashboard';
            renderMonthsBar();
            renderTabs();
            showDashboard();
        });

        const removeBtn = document.createElement('span');
        removeBtn.className = 'chip-remove';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', e => {
            e.stopPropagation();
            state.months.splice(i, 1);
            // allTherapists 更新
            const ts = new Set();
            state.months.forEach(mm => mm.therapists.forEach(t => ts.add(t)));
            state.allTherapists = [...ts];

            if (state.months.length === 0) {
                destroyCharts();
                document.getElementById('dashboard').classList.add('hidden');
                document.getElementById('upload-section').classList.remove('hidden');
                document.getElementById('csv-input').value = '';
                return;
            }
            if (state.currentMonthIdx >= state.months.length) {
                state.currentMonthIdx = state.months.length - 1;
            }
            renderMonthsBar();
            renderTabs();
            if (state.currentView === 'trend') {
                showTrend();
            } else if (state.currentView === 'total') {
                showTotal();
            } else {
                showDashboard();
            }
        });

        chip.appendChild(labelSpan);
        chip.appendChild(removeBtn);
        bar.appendChild(chip);
    });
}

// ==================== CSV パース（フォーマット振り分け） ====================
function parseCSV(text) {
    const rows = Papa.parse(text, { skipEmptyLines: false }).data;
    if (rows.length < 2) throw new Error('データ行が不足しています');

    const fmt = detectFormat(rows);
    if (fmt === 'raw')        return parseRawCSV(rows);
    if (fmt === 'aggregated') return parseAggregatedCSV(rows);
    throw new Error('CSVフォーマットが認識できません。「詳細分析」シートまたは「新規購入内訳」シートのCSVをアップロードしてください。');
}

function detectFormat(rows) {
    const first = String(rows[0]?.[0] ?? '').trim();
    if (first === '詳細分析') return 'aggregated';
    if (first === '日付')    return 'raw';
    // 先頭数行に日付パターンがあれば raw とみなす（4/1 または 4月1日 または ４月１日）
    for (let i = 0; i < Math.min(5, rows.length); i++) {
        if (isDateCell(String(rows[i]?.[0] ?? '').trim())) return 'raw';
    }
    return 'unknown';
}

// 日付セル判定（4/1・4月1日・４月１日 いずれも対応）
function isDateCell(s) {
    const n = toHalfWidth(s);
    return /^\d{1,2}\/\d{1,2}$/.test(n) || /^\d{1,2}月\d{1,2}日$/.test(n);
}

// 全角英数字→半角変換
function toHalfWidth(s) {
    return s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
            .replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}

// ==================== 生データ CSV パース（新規購入内訳） ====================
// 列: 日付(0), 名前(1), 年代(2), 性別(3), セラピスト(4), 症状(5), 問い合わせ媒体(6), 当日希望(7), 回数券(8)
// 年代: 数字 1桁 (例: 5 → '50代')
// 購入(1回券含まず): 回数券が 2 以上の整数のとき
function parseRawCSV(rows) {
    const therapistSet = new Set();
    const patientRows  = [];

    for (const row of rows) {
        if (!isDateCell(String(row[0] ?? '').trim())) continue;
        const therapist = String(row[4] ?? '').trim();
        if (!therapist) continue;
        therapistSet.add(therapist);
        patientRows.push(row);
    }

    if (!patientRows.length) throw new Error('患者データが見つかりませんでした。日付列(4/1 または 4月1日 形式)が1列目にあるか確認してください。');

    const therapistList = [...therapistSet];
    const data = {};
    therapistList.forEach(t => { data[t] = emptyData(); });
    data['院合計'] = emptyData();

    for (const row of patientRows) {
        const therapist  = String(row[4] ?? '').trim();
        const genderRaw  = String(row[3] ?? '').trim();
        const ageRaw     = String(row[2] ?? '').trim();
        const symptom    = String(row[5] ?? '').trim();
        const media      = String(row[6] ?? '').trim();
        const kaikenRaw  = String(row[8] ?? '').trim();

        const gender = genderRaw === '男性' ? 'male' : genderRaw === '女性' ? 'female' : null;

        // 年代: 「50代」そのまま or 数字1桁「5」→「50代」に統一
        let age = null;
        if (/^\d+代$/.test(ageRaw)) {
            age = ageRaw; // 「50代」形式はそのまま
        } else {
            const ageNum = parseInt(toHalfWidth(ageRaw), 10);
            if (!isNaN(ageNum) && ageNum > 0) age = (ageNum <= 9 ? ageNum * 10 : ageNum) + '代';
        }

        // 2回以上の回数券のみ「購入」とカウント（1回券・初回のみ除外）
        // 対応形式: 「32」「8回券」「40回券」→ 数字部分を抽出
        const kaikenNum  = parseInt(toHalfWidth(kaikenRaw).replace(/回券.*/, ''), 10);
        const isPurchase = !isNaN(kaikenNum) && kaikenNum > 1;

        for (const key of [therapist, '院合計']) {
            const d = data[key];

            // 合計
            d.total.treated++;
            if (isPurchase) d.total.purchase++;

            // 性別
            if (gender) {
                d.gender[gender].treated++;
                if (isPurchase) d.gender[gender].purchase++;
            }

            // 年代（全体）
            if (age) {
                if (!d.ageTotal[age]) d.ageTotal[age] = { purchase: 0, treated: 0, rate: null };
                d.ageTotal[age].treated++;
                if (isPurchase) d.ageTotal[age].purchase++;
            }

            // 年代（性別別）
            if (age && gender) {
                if (!d.ageByGender[gender][age]) d.ageByGender[gender][age] = { purchase: 0, treated: 0, rate: null };
                d.ageByGender[gender][age].treated++;
                if (isPurchase) d.ageByGender[gender][age].purchase++;
            }

            // 媒体
            if (media) {
                const segs = ['total', ...(gender ? [gender] : [])];
                for (const seg of segs) {
                    if (!d.media[seg][media]) d.media[seg][media] = { purchase: 0, treated: 0, rate: null };
                    d.media[seg][media].treated++;
                    if (isPurchase) d.media[seg][media].purchase++;
                }
            }

            // 症状
            if (symptom) {
                if (!d.symptoms[symptom]) d.symptoms[symptom] = { purchase: 0, treated: 0, rate: null };
                d.symptoms[symptom].treated++;
                if (isPurchase) d.symptoms[symptom].purchase++;
            }
        }
    }

    // 購入率を計算
    function calcRates(obj) {
        Object.values(obj).forEach(c => {
            if (c.treated > 0) c.rate = Math.round(c.purchase / c.treated * 100);
        });
    }

    Object.values(data).forEach(d => {
        if (d.total.treated > 0) d.total.rate = Math.round(d.total.purchase / d.total.treated * 100);
        ['male', 'female'].forEach(g => {
            if (d.gender[g].treated > 0) d.gender[g].rate = Math.round(d.gender[g].purchase / d.gender[g].treated * 100);
        });
        calcRates(d.ageTotal);
        calcRates(d.ageByGender.male);
        calcRates(d.ageByGender.female);
        calcRates(d.media.total);
        calcRates(d.media.male);
        calcRates(d.media.female);
        calcRates(d.symptoms);
    });

    return { therapists: therapistList, data };
}

// ==================== 集計データ CSV パース（詳細分析） ====================
function parseAggregatedCSV(rows) {
    if (rows.length < 3) throw new Error('データ行が不足しています');

    // Row0: セラピスト名ヘッダー
    const header0 = rows[0] || [];
    const groups = [];

    for (let col = 0; col < header0.length; col++) {
        const val = String(header0[col] || '').trim();
        if (!val || val === '詳細分析' || val === '1回券含まず') continue;
        if (val === '院合計') {
            groups.push({ name: '院合計', startCol: col, isClinic: true });
            break;
        }
        groups.push({ name: val, startCol: col, isClinic: false });
    }

    // 各グループ: 購入数=col, 対応数=col+1, 購入率(1回含まず)=col+2
    groups.forEach(g => {
        g.purchaseCol = g.startCol;
        g.treatedCol  = g.startCol + 1;
        g.rateCol     = g.startCol + 2;
    });

    const data = {};
    groups.forEach(g => { data[g.name] = emptyData(); });

    let section = 'init'; // 'male' | 'female' | 'total' | 'symptoms'

    for (let i = 2; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        const raw = String(row[0] || '').trim();
        if (!raw) continue;
        const label = raw.replace(/\s+/g, ' ');

        if (/性別.*男性/.test(label)) {
            section = 'male';
            groups.forEach(g => { data[g.name].gender.male = cell(row, g); });

        } else if (/性別.*女性/.test(label)) {
            section = 'female';
            groups.forEach(g => { data[g.name].gender.female = cell(row, g); });

        } else if (label === '総合計') {
            section = 'total';
            groups.forEach(g => { data[g.name].total = cell(row, g); });

        } else if (/年代/.test(label)) {
            const age = label.replace(/年代\s*/, '').trim();
            groups.forEach(g => {
                const c = cell(row, g);
                if (c.treated === 0 && c.purchase === 0) return;
                if (section === 'male')        data[g.name].ageByGender.male[age] = c;
                else if (section === 'female') data[g.name].ageByGender.female[age] = c;
                else if (section === 'total')  data[g.name].ageTotal[age] = c;
            });

        } else if (['HPB', 'HP等', '当日予約の方'].includes(label)) {
            groups.forEach(g => {
                const c = cell(row, g);
                if (section === 'male')        data[g.name].media.male[label] = c;
                else if (section === 'female') data[g.name].media.female[label] = c;
                else if (section === 'total')  data[g.name].media.total[label] = c;
            });
            if (section === 'total' && label === '当日予約の方') section = 'symptoms';

        } else if (section === 'symptoms') {
            groups.forEach(g => {
                const c = cell(row, g);
                if (c.treated > 0 || c.purchase > 0) data[g.name].symptoms[raw] = c;
            });
        }
    }

    return { therapists: groups.filter(g => !g.isClinic).map(g => g.name), data };
}

function cell(row, g) {
    const purchase = toInt(row[g.purchaseCol]);
    const treated  = toInt(row[g.treatedCol]);
    const rStr     = String(row[g.rateCol] || '').trim();
    let rate = null;
    if (rStr && rStr !== '#DIV/0!') {
        const n = parseFloat(rStr.replace('%', ''));
        if (!isNaN(n)) rate = Math.round(n);
    }
    if (rate === null && treated > 0) rate = Math.round(purchase / treated * 100);
    return { purchase, treated, rate };
}

function toInt(v) { const n = parseInt(String(v || '').trim()); return isNaN(n) ? 0 : n; }

// ==================== タブ ====================
function renderTabs() {
    const el = document.getElementById('tabs');
    el.innerHTML = '';

    const entries = [['all', '🏠 全員まとめ（院合計）'], ...state.allTherapists.map(n => [n, n])];
    if (state.months.length >= 2) entries.push(['__total__', '📊 全期間']);
    if (state.months.length >= 2) entries.push(['__trend__', '📈 推移']);

    entries.forEach(([key, label]) => {
        const btn = document.createElement('button');
        const isActive = key === '__trend__'  ? state.currentView === 'trend'
                       : key === '__total__'  ? state.currentView === 'total'
                       : state.currentView === 'dashboard' && key === state.currentTherapist;
        btn.className = 'tab' + (isActive ? ' active' : '');
        btn.textContent = label;
        btn.addEventListener('click', () => {
            el.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            if (key === '__total__') {
                state.currentView = 'total';
                renderMonthsBar();
                showTotal();
            } else if (key === '__trend__') {
                state.currentView = 'trend';
                renderMonthsBar();
                showTrend();
            } else {
                state.currentView = 'dashboard';
                state.currentTherapist = key;
                renderMonthsBar();
                showDashboard();
            }
        });
        el.appendChild(btn);
    });
}

function showDashboard() {
    document.getElementById('dashboard-main').classList.remove('hidden');
    document.getElementById('trend-main').classList.add('hidden');
    document.getElementById('total-main').classList.add('hidden');
    renderDashboard(state.currentTherapist);
}

function showTrend() {
    document.getElementById('dashboard-main').classList.add('hidden');
    document.getElementById('trend-main').classList.remove('hidden');
    document.getElementById('total-main').classList.add('hidden');
    renderTrendView();
}

function showTotal() {
    document.getElementById('dashboard-main').classList.add('hidden');
    document.getElementById('trend-main').classList.add('hidden');
    document.getElementById('total-main').classList.remove('hidden');
    renderTotalView(state.totalTherapist);
}

// ==================== ダッシュボード ====================
function renderDashboard(key) {
    const month = state.months[state.currentMonthIdx];
    if (!month) return;

    const dataKey = key === 'all' ? '院合計' : key;
    const d = month.data[dataKey];

    destroyCharts();

    if (!d) {
        document.getElementById('stats-bar').innerHTML = '<p style="color:#94A3B8;padding:16px;">この月にデータがありません</p>';
        document.getElementById('segment-table').innerHTML = '';
        ['chart-age', 'chart-gender', 'chart-symptoms', 'chart-sameday', 'chart-media'].forEach(noData);
        return;
    }

    renderStats(d, key);
    renderAgeChart(d);
    renderGenderChart(d);
    renderSymptomsChart(d);
    renderMediaRateChart(d);
    renderMediaDistChart(d);
    renderTable(d);
}

// ==================== サマリーバー ====================
function renderStats(d, key) {
    const t = d.total;
    const m = d.gender.male.treated;
    const f = d.gender.female.treated;
    const gTotal = (m + f) || 1;

    const stats = [
        { label: '対応数（新規）', value: t.treated + '人', sub: '' },
        { label: '購入数', value: t.purchase + '人', sub: '' },
        { label: '購入率（1回券含まず）', value: t.rate !== null ? t.rate + '%' : '-', sub: '' },
        { label: '男性', value: m + '人', sub: Math.round(m / gTotal * 100) + '%' },
        { label: '女性', value: f + '人', sub: Math.round(f / gTotal * 100) + '%' },
    ];

    const topMedia = Object.entries(d.media.total).sort((a, b) => b[1].treated - a[1].treated)[0];
    if (topMedia) stats.push({ label: '最多集客媒体', value: topMedia[0], sub: topMedia[1].treated + '人' });

    document.getElementById('stats-bar').innerHTML = stats.map(s => `
        <div class="stat-card">
            <div class="stat-label">${s.label}</div>
            <div class="stat-value">${s.value}</div>
            ${s.sub ? `<div class="stat-sub">${s.sub}</div>` : ''}
        </div>`).join('');
}

// ==================== チャート ====================
function destroyCharts() {
    Object.values(state.charts).forEach(c => { try { c.destroy(); } catch(e){} });
    state.charts = {};
}

function makeChart(id, config) {
    // canvas を毎回作り直して確実にクリーンな状態にする
    const wrap = document.getElementById(id)?.parentElement;
    if (!wrap) return;
    wrap.innerHTML = `<canvas id="${id}"></canvas>`;
    state.charts[id] = new Chart(document.getElementById(id), config);
}

function noData(id) {
    const wrap = document.getElementById(id)?.parentElement;
    if (wrap) wrap.innerHTML = '<div class="no-data"><span>📭</span>データなし</div>';
}

// 年代分布
function renderAgeChart(d) {
    const ORDER = ['10代', '20代', '30代', '40代', '50代', '60代', '70代', '80代', '90代'];
    const rows  = ORDER.filter(a => d.ageTotal[a]?.treated > 0);
    if (!rows.length) { noData('chart-age'); return; }

    makeChart('chart-age', {
        type: 'bar',
        data: {
            labels: rows,
            datasets: [
                { label: '対応数', data: rows.map(a => d.ageTotal[a].treated),  backgroundColor: CHART_COLORS.indigoLight, borderRadius: 4 },
                { label: '購入数', data: rows.map(a => d.ageTotal[a].purchase), backgroundColor: CHART_COLORS.indigo,      borderRadius: 4 },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
        },
    });
}

// 性別分布
function renderGenderChart(d) {
    const m = d.gender.male.treated, f = d.gender.female.treated;
    if (m + f === 0) { noData('chart-gender'); return; }

    makeChart('chart-gender', {
        type: 'doughnut',
        data: {
            labels: [`女性 ${f}人`, `男性 ${m}人`],
            datasets: [{ data: [f, m], backgroundColor: [CHART_COLORS.pink, CHART_COLORS.blue], borderWidth: 3, borderColor: '#fff' }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } },
            cutout: '62%',
        },
    });
}

// 症状別
function renderSymptomsChart(d) {
    const sorted = Object.entries(d.symptoms)
        .filter(([, v]) => v.treated > 0)
        .sort((a, b) => b[1].treated - a[1].treated)
        .slice(0, 12);
    if (!sorted.length) { noData('chart-symptoms'); return; }

    makeChart('chart-symptoms', {
        type: 'bar',
        data: {
            labels: sorted.map(([k]) => k),
            datasets: [
                { label: '対応数', data: sorted.map(([, v]) => v.treated),  backgroundColor: CHART_COLORS.purpleLight, borderRadius: 3 },
                { label: '購入数', data: sorted.map(([, v]) => v.purchase), backgroundColor: CHART_COLORS.purple,      borderRadius: 3 },
            ],
        },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } },
            scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } },
        },
    });
}

// 媒体別 購入率（棒グラフ）
function renderMediaRateChart(d) {
    const media  = d.media.total;
    const labels = Object.keys(media).filter(k => media[k].treated > 0);
    if (!labels.length) { noData('chart-sameday'); return; }

    const rates  = labels.map(k => media[k].rate ?? 0);
    const colors = labels.map(r =>
        r >= state.goodThreshold ? CHART_COLORS.green :
        r <= state.badThreshold  ? 'rgba(239,68,68,0.8)' : CHART_COLORS.amber
    );

    makeChart('chart-sameday', {
        type: 'bar',
        data: {
            labels,
            datasets: [{ label: '購入率 (%)', data: rates, backgroundColor: colors, borderRadius: 6 }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } },
        },
    });
}

// 媒体別 対応数（ドーナツ）
function renderMediaDistChart(d) {
    const media  = d.media.total;
    const labels = Object.keys(media).filter(k => media[k].treated > 0);
    if (!labels.length) { noData('chart-media'); return; }

    const counts = labels.map(k => media[k].treated);
    const colors = labels.map(l =>
        l.includes('HPB') ? CHART_COLORS.purple :
        l.includes('HP')  ? CHART_COLORS.green  : CHART_COLORS.amber
    );

    makeChart('chart-media', {
        type: 'doughnut',
        data: {
            labels: labels.map((l, i) => `${l} ${counts[i]}人`),
            datasets: [{ data: counts, backgroundColor: colors, borderWidth: 3, borderColor: '#fff' }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } },
            cutout: '62%',
        },
    });
}

// ==================== 購入率テーブル ====================
function renderTable(d) {
    const el   = document.getElementById('segment-table');
    const good = state.goodThreshold;
    const bad  = state.badThreshold;

    const AGE_ORDER = ['10代', '20代', '30代', '40代', '50代', '60代', '70代', '80代', '90代'];
    const MEDIA_ORDER = ['HPB', 'HP等', '当日予約の方'];

    const sections = [
        { title: '年代別（全体）',    data: d.ageTotal,           order: AGE_ORDER },
        { title: '年代別（男性）',    data: d.ageByGender.male,   order: AGE_ORDER },
        { title: '年代別（女性）',    data: d.ageByGender.female, order: AGE_ORDER },
        { title: '集客媒体別（全体）', data: d.media.total,        order: MEDIA_ORDER },
        { title: '集客媒体別（男性）', data: d.media.male,         order: MEDIA_ORDER },
        { title: '集客媒体別（女性）', data: d.media.female,       order: MEDIA_ORDER },
        { title: '症状別',           data: d.symptoms,           order: null },
    ];

    const rendered = sections
        .map(s => {
            const rows = s.order
                ? s.order.filter(k => s.data[k]?.treated > 0).map(k => [k, s.data[k]])
                : Object.entries(s.data).filter(([, v]) => v.treated > 0).sort((a, b) => b[1].treated - a[1].treated);
            return rows.length ? tableBlock(s.title, rows, good, bad) : '';
        })
        .filter(Boolean);

    el.innerHTML = rendered.length
        ? `<div class="segment-groups">${rendered.join('')}</div>`
        : '<p class="no-data-text">表示できるデータがありません</p>';
}

function tableBlock(title, rows, good, bad) {
    const trs = rows.map(([cat, c]) => {
        const r   = c.rate;
        const cls = r !== null ? (r >= good ? 'row-good' : r <= bad ? 'row-bad' : '') : '';
        const badge = r !== null
            ? r >= good ? '<span class="badge-good">得意</span>'
            : r <= bad  ? '<span class="badge-bad">苦手</span>'
            : '<span class="badge-neutral">中間</span>'
            : '<span class="badge-neutral">-</span>';
        const color = r !== null
            ? (r >= good ? '#10B981' : r <= bad ? '#EF4444' : '#94A3B8') : '#CBD5E1';
        const pct = r !== null ? r : 0;

        return `<tr class="${cls}">
            <td>${cat}</td>
            <td class="num">${c.purchase}<span class="of-total">/${c.treated}</span></td>
            <td>
                <div class="rate-cell">
                    <div class="rate-bar-wrap">
                        <div class="rate-bar"><div class="rate-bar-fill" style="width:${pct}%;background:${color}"></div></div>
                        <span class="rate-num" style="color:${color}">${r !== null ? r + '%' : '-'}</span>
                    </div>
                    ${badge}
                </div>
            </td>
        </tr>`;
    }).join('');

    return `<div class="segment-group">
        <h4>${title}</h4>
        <table>
            <thead><tr><th>カテゴリ</th><th class="num">購入/対応</th><th>購入率・判定</th></tr></thead>
            <tbody>${trs}</tbody>
        </table>
    </div>`;
}

// ==================== トレンドビュー ====================

// カテゴリ別購入率の折れ線グラフ共通ヘルパー
function makeCategoryLineChart(id, rows, monthLabels, maxLines) {
    const data = maxLines ? rows.slice(0, maxLines) : rows;
    if (!data.length) { noData(id); return; }

    const datasets = data.map((row, i) => ({
        label: row.cat,
        data: row.monthRates,
        borderColor: TREND_COLORS[i % TREND_COLORS.length],
        backgroundColor: TREND_COLORS[i % TREND_COLORS.length],
        spanGaps: true,
        pointRadius: 5,
        tension: 0.3,
        fill: false,
        borderWidth: 2,
    }));

    makeChart(id, {
        type: 'line',
        data: { labels: monthLabels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } },
            scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } },
        },
    });
}

function renderTrendView() {
    destroyCharts();

    const months = state.months;
    const labels = months.map(m => abbreviatePeriod(m.period));
    const names = ['院合計', ...state.allTherapists];

    // 1. 購入率の推移
    const rateDatasets = names.map((name, i) => ({
        label: name === '院合計' ? '院合計' : name,
        data: months.map(m => m.data[name]?.total.rate ?? null),
        borderColor: TREND_COLORS[i % TREND_COLORS.length],
        backgroundColor: TREND_COLORS[i % TREND_COLORS.length],
        spanGaps: true,
        pointRadius: 5,
        tension: 0.3,
        fill: false,
    }));

    makeChart('chart-trend-rate', {
        type: 'line',
        data: { labels, datasets: rateDatasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } },
            scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } },
        },
    });

    // 2. 対応数の推移
    const countDatasets = names.map((name, i) => ({
        label: name === '院合計' ? '院合計' : name,
        data: months.map(m => m.data[name]?.total.treated ?? 0),
        backgroundColor: TREND_COLORS[i % TREND_COLORS.length],
        borderRadius: 4,
    }));

    makeChart('chart-trend-count', {
        type: 'bar',
        data: { labels, datasets: countDatasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
        },
    });

    // 3. 症状別 対応数 TOP5（全月・全セラピスト合算）
    const symptomTotals = {};
    months.forEach(m => {
        Object.values(m.data).forEach(d => {
            Object.entries(d.symptoms || {}).forEach(([sym, v]) => {
                symptomTotals[sym] = (symptomTotals[sym] || 0) + (v.treated || 0);
            });
        });
    });
    const top5Symptoms = Object.entries(symptomTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([sym]) => sym);

    const symptomDatasets = top5Symptoms.map((sym, i) => ({
        label: sym,
        data: months.map(m => {
            let total = 0;
            Object.values(m.data).forEach(d => {
                total += d.symptoms?.[sym]?.treated ?? 0;
            });
            return total;
        }),
        backgroundColor: TREND_COLORS[i % TREND_COLORS.length],
        borderRadius: 2,
    }));

    makeChart('chart-trend-symptoms', {
        type: 'bar',
        data: { labels, datasets: symptomDatasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } },
            scales: {
                x: { stacked: true },
                y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } },
            },
        },
    });

    // trend-summary テーブル
    const summaryEl = document.getElementById('trend-summary');
    const rows = months.map(m => {
        const clinic = m.data['院合計'];
        const therapistCells = m.therapists.map(t => {
            const td = m.data[t];
            return `${t}: ${td?.total.treated ?? 0}人 / ${td?.total.rate !== null && td?.total.rate !== undefined ? td.total.rate + '%' : '-'}`;
        }).join('<br>');
        return `<tr>
            <td>${abbreviatePeriod(m.period)}</td>
            <td>${clinic?.total.treated ?? 0}人</td>
            <td>${clinic?.total.purchase ?? 0}人</td>
            <td>${clinic?.total.rate !== null && clinic?.total.rate !== undefined ? clinic.total.rate + '%' : '-'}</td>
            <td style="font-size:0.82rem;line-height:1.6;">${therapistCells}</td>
        </tr>`;
    }).join('');

    summaryEl.innerHTML = `
        <div class="segment-section" style="margin-top:16px">
            <h2 style="font-size:1rem;font-weight:700;color:#1E293B;margin-bottom:16px;">月別サマリー</h2>
            <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
                <thead style="background:#F8FAFC;color:#64748B;font-weight:600;">
                    <tr>
                        <th style="padding:8px;text-align:left;border-bottom:1px solid #E2E8F0;">期間</th>
                        <th style="padding:8px;text-align:right;border-bottom:1px solid #E2E8F0;">対応数</th>
                        <th style="padding:8px;text-align:right;border-bottom:1px solid #E2E8F0;">購入数</th>
                        <th style="padding:8px;text-align:right;border-bottom:1px solid #E2E8F0;">購入率</th>
                        <th style="padding:8px;text-align:left;border-bottom:1px solid #E2E8F0;">セラピスト別</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            </div>
        </div>`;

    // ---- カテゴリ別 購入率推移（折れ線グラフ）----
    const td = buildTrendData('院合計');
    makeCategoryLineChart('chart-trend-gender-rate',    td.gender,              labels);
    makeCategoryLineChart('chart-trend-media-rate',     td.media,               labels);
    makeCategoryLineChart('chart-trend-age-rate',       td.ages,                labels);
    makeCategoryLineChart('chart-trend-age-male-rate',  td.agesMale,            labels);
    makeCategoryLineChart('chart-trend-age-female-rate',td.agesFemale,          labels);
    makeCategoryLineChart('chart-trend-symptom-rate',   td.symptoms.slice(0,5), labels);
}

// 閾値スライダー（月次ダッシュボード用）
['good', 'bad'].forEach(type => {
    document.getElementById(`${type}-threshold`).addEventListener('input', function() {
        state[`${type}Threshold`] = +this.value;
        document.getElementById(`${type}-val`).textContent = this.value;
        if (!state.months.length) return;
        const month = state.months[state.currentMonthIdx];
        if (!month) return;
        const dataKey = state.currentTherapist === 'all' ? '院合計' : state.currentTherapist;
        const d = month.data[dataKey];
        if (d) { renderMediaRateChart(d); renderTable(d); }
    });
});

// 閾値スライダー（全期間ページ用）
['good', 'bad'].forEach(type => {
    document.getElementById(`${type}-threshold2`).addEventListener('input', function() {
        state[`${type}Threshold`] = +this.value;
        // 両スライダーを同期
        document.getElementById(`${type}-threshold`).value = this.value;
        document.getElementById(`${type}-val`).textContent = this.value;
        document.getElementById(`${type}-val2`).textContent = this.value;
        if (state.currentView === 'total') renderTotalView(state.totalTherapist);
    });
});

// ==================== 全期間トータルページ ====================

// 全月のデータを集計して emptyData 構造で返す
function aggregateMonths(dataKey) {
    const agg = emptyData();
    const calcRate = c => { if (c.treated > 0) c.rate = Math.round(c.purchase / c.treated * 100); };

    for (const month of state.months) {
        const d = month.data[dataKey];
        if (!d) continue;

        agg.total.purchase += d.total.purchase;
        agg.total.treated  += d.total.treated;

        ['male', 'female'].forEach(g => {
            agg.gender[g].purchase += d.gender[g].purchase;
            agg.gender[g].treated  += d.gender[g].treated;
        });

        Object.entries(d.ageTotal).forEach(([a, c]) => {
            if (!agg.ageTotal[a]) agg.ageTotal[a] = { purchase: 0, treated: 0, rate: null };
            agg.ageTotal[a].purchase += c.purchase;
            agg.ageTotal[a].treated  += c.treated;
        });

        ['male', 'female'].forEach(g => {
            Object.entries(d.ageByGender[g]).forEach(([a, c]) => {
                if (!agg.ageByGender[g][a]) agg.ageByGender[g][a] = { purchase: 0, treated: 0, rate: null };
                agg.ageByGender[g][a].purchase += c.purchase;
                agg.ageByGender[g][a].treated  += c.treated;
            });
        });

        ['total', 'male', 'female'].forEach(seg => {
            Object.entries(d.media[seg]).forEach(([k, c]) => {
                if (!agg.media[seg][k]) agg.media[seg][k] = { purchase: 0, treated: 0, rate: null };
                agg.media[seg][k].purchase += c.purchase;
                agg.media[seg][k].treated  += c.treated;
            });
        });

        Object.entries(d.symptoms).forEach(([s, c]) => {
            if (!agg.symptoms[s]) agg.symptoms[s] = { purchase: 0, treated: 0, rate: null };
            agg.symptoms[s].purchase += c.purchase;
            agg.symptoms[s].treated  += c.treated;
        });
    }

    calcRate(agg.total);
    ['male', 'female'].forEach(g => calcRate(agg.gender[g]));
    Object.values(agg.ageTotal).forEach(calcRate);
    Object.values(agg.ageByGender.male).forEach(calcRate);
    Object.values(agg.ageByGender.female).forEach(calcRate);
    ['total', 'male', 'female'].forEach(seg => Object.values(agg.media[seg]).forEach(calcRate));
    Object.values(agg.symptoms).forEach(calcRate);

    return agg;
}

// 各カテゴリの月別購入率配列を構築
function buildTrendData(dataKey) {
    const AGE_ORDER = ['10代', '20代', '30代', '40代', '50代', '60代', '70代', '80代', '90代'];
    const allAges = new Set(), allSymptoms = new Set(), allMedia = new Set();

    state.months.forEach(m => {
        const d = m.data[dataKey];
        if (!d) return;
        Object.keys(d.ageTotal).filter(a => d.ageTotal[a].treated > 0).forEach(a => allAges.add(a));
        Object.keys(d.symptoms).filter(s => d.symptoms[s].treated > 0).forEach(s => allSymptoms.add(s));
        Object.keys(d.media.total).filter(k => d.media.total[k].treated > 0).forEach(k => allMedia.add(k));
    });

    const ages = AGE_ORDER.filter(a => allAges.has(a));

    // 症状は全期間の対応数合計で降順ソート
    const symTotals = {};
    state.months.forEach(m => {
        const d = m.data[dataKey];
        if (!d) return;
        Object.entries(d.symptoms).forEach(([s, c]) => { symTotals[s] = (symTotals[s] || 0) + c.treated; });
    });
    const symptoms = [...allSymptoms].sort((a, b) => (symTotals[b] || 0) - (symTotals[a] || 0));
    const media = [...allMedia];

    function buildRows(cats, getter) {
        return cats.map(cat => {
            let totalPurchase = 0, totalTreated = 0;
            const monthRates = state.months.map(m => {
                const d = m.data[dataKey];
                const c = d ? getter(d, cat) : null;
                if (c && c.treated > 0) {
                    totalPurchase += c.purchase;
                    totalTreated  += c.treated;
                    return c.rate;
                }
                return null;
            });
            const totalRate = totalTreated > 0 ? Math.round(totalPurchase / totalTreated * 100) : null;
            return { cat, monthRates, totalPurchase, totalTreated, totalRate };
        }).filter(r => r.totalTreated > 0);
    }

    // 性別（男性・女性を行として扱う）
    const genderRows = [['男性', 'male'], ['女性', 'female']].map(([label, key]) => {
        let totalPurchase = 0, totalTreated = 0;
        const monthRates = state.months.map(m => {
            const d = m.data[dataKey];
            if (!d) return null;
            const c = d.gender[key];
            if (c.treated > 0) { totalPurchase += c.purchase; totalTreated += c.treated; return c.rate; }
            return null;
        });
        const totalRate = totalTreated > 0 ? Math.round(totalPurchase / totalTreated * 100) : null;
        return { cat: label, monthRates, totalPurchase, totalTreated, totalRate };
    }).filter(r => r.totalTreated > 0);

    return {
        gender:     genderRows,
        ages:       buildRows(ages,     (d, cat) => d.ageTotal[cat]),
        agesMale:   buildRows(ages,     (d, cat) => d.ageByGender.male[cat]),
        agesFemale: buildRows(ages,     (d, cat) => d.ageByGender.female[cat]),
        symptoms:   buildRows(symptoms, (d, cat) => d.symptoms[cat]),
        media:      buildRows(media,    (d, cat) => d.media.total[cat]),
    };
}

// 月別購入率推移テーブルのHTML生成
function trendTableBlock(title, rows, monthLabels) {
    if (!rows.length) return '';
    const good = state.goodThreshold, bad = state.badThreshold;

    const headerCols = ['カテゴリ', ...monthLabels, '全期間', '判定'].map((h, i) => {
        const cls = i === monthLabels.length + 1 ? ' class="trend-total-col"' : '';
        return `<th${cls}>${h}</th>`;
    }).join('');

    const trs = rows.map(({ cat, monthRates, totalPurchase, totalTreated, totalRate }) => {
        const cls = totalRate !== null ? (totalRate >= good ? 'row-good' : totalRate <= bad ? 'row-bad' : '') : '';

        const monthCells = monthRates.map(r => {
            if (r === null) return '<td class="trend-null">-</td>';
            const color = r >= good ? '#10B981' : r <= bad ? '#EF4444' : '#64748B';
            return `<td style="color:${color};font-weight:600">${r}%</td>`;
        }).join('');

        const totalColor = totalRate !== null ? (totalRate >= good ? '#10B981' : totalRate <= bad ? '#EF4444' : '#64748B') : '#94A3B8';
        const badge = totalRate !== null
            ? (totalRate >= good ? '<span class="badge-good">得意</span>' : totalRate <= bad ? '<span class="badge-bad">苦手</span>' : '<span class="badge-neutral">中間</span>')
            : '<span class="badge-neutral">-</span>';

        return `<tr class="${cls}">
            <td>${cat}</td>
            ${monthCells}
            <td class="trend-total-col" style="color:${totalColor}">${totalRate !== null ? totalRate + '%' : '-'}<br><span class="of-total">${totalPurchase}/${totalTreated}</span></td>
            <td>${badge}</td>
        </tr>`;
    }).join('');

    return `<div class="trend-table-wrap">
        <h4 style="font-size:0.82rem;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;">${title}</h4>
        <table><thead><tr>${headerCols}</tr></thead><tbody>${trs}</tbody></table>
    </div>`;
}

// 全期間ページ描画
function renderTotalView(therapistKey) {
    state.totalTherapist = therapistKey;
    const dataKey = therapistKey === 'all' ? '院合計' : therapistKey;
    const agg = aggregateMonths(dataKey);
    const monthLabels = state.months.map(m => abbreviatePeriod(m.period));

    // セラピスト選択ボタン
    const tTabs = document.getElementById('total-therapist-tabs');
    const options = ['all', ...state.allTherapists];
    tTabs.innerHTML = options.map(t => `
        <button class="total-therapist-btn${t === therapistKey ? ' active' : ''}" data-key="${t}">
            ${t === 'all' ? '院合計' : t}
        </button>`).join('');
    tTabs.querySelectorAll('.total-therapist-btn').forEach(btn => {
        btn.addEventListener('click', () => renderTotalView(btn.dataset.key));
    });

    // サマリーバー
    const t = agg.total;
    const m = agg.gender.male.treated, f = agg.gender.female.treated;
    const gTotal = (m + f) || 1;
    document.getElementById('total-stats-bar').innerHTML = [
        { label: '累計対応数（全期間）', value: t.treated + '人' },
        { label: '累計購入数',           value: t.purchase + '人' },
        { label: '全期間 購入率',         value: t.rate !== null ? t.rate + '%' : '-' },
        { label: '月平均対応数',          value: Math.round(t.treated / (state.months.length || 1)) + '人' },
        { label: '男性',                  value: m + '人', sub: Math.round(m / gTotal * 100) + '%' },
        { label: '女性',                  value: f + '人', sub: Math.round(f / gTotal * 100) + '%' },
    ].map(s => `<div class="stat-card">
        <div class="stat-label">${s.label}</div>
        <div class="stat-value">${s.value}</div>
        ${s.sub ? `<div class="stat-sub">${s.sub}</div>` : ''}
    </div>`).join('');

    // 推移テーブル
    const td = buildTrendData(dataKey);
    document.getElementById('total-trend-tables').innerHTML = [
        trendTableBlock('性別 購入率推移',         td.gender,     monthLabels),
        trendTableBlock('年代別 購入率推移（全体）', td.ages,       monthLabels),
        trendTableBlock('年代別 購入率推移（男性）', td.agesMale,   monthLabels),
        trendTableBlock('年代別 購入率推移（女性）', td.agesFemale, monthLabels),
        trendTableBlock('症状別 購入率推移',         td.symptoms,   monthLabels),
        trendTableBlock('媒体別 購入率推移',         td.media,      monthLabels),
    ].filter(Boolean).join('');
}

// ==================== サンプルデータ ====================
const SAMPLE_CSV = `詳細分析,清家,,1回券含まず,富澤,,1回券含まず,,,1回券含まず,院合計,,1回券含まず,,
,購入数,対応数,購入率,購入数,対応数,購入率,購入数,対応数,購入率,購入数,対応数,院購入率,来院分布,
性別　男性,2,5,40%,3,8,38%,0,0,#DIV/0!,5,13,38%,54%,男性/合計
年代　 10代,,,#DIV/0!,,,,,,,,,,,年代/男性合計
年代　 20代,,,#DIV/0!,2,3,67%,,,#DIV/0!,2,3,67%,23%,
年代　 30代,0,2,0%,0,2,0%,,,#DIV/0!,0,4,0%,31%,
年代　 40代,0,1,0%,1,2,50%,,,#DIV/0!,1,3,33%,23%,
年代　 50代,1,1,100%,,,#DIV/0!,,,#DIV/0!,1,1,100%,8%,
年代　 60代,,,#DIV/0!,,,,,,#DIV/0!,0,0,#DIV/0!,0%,
年代　 70代,,,#DIV/0!,0,1,0%,,,#DIV/0!,0,1,0%,8%,
年代　 80代,1,1,100%,,,,,,,,,,,
年代　 90代,,,,,,,,,,,,,,
HPB,,,#DIV/0!,1,1,#DIV/0!,,,#DIV/0!,1,1,100%,,
HP等,3,5,60%,2,7,29%,,,#DIV/0!,5,12,42%,,
当日予約の方,,,#DIV/0!,1,4,25%,,,#DIV/0!,1,4,25%,,
性別　女性,2,6,33%,1,5,20%,0,0,#DIV/0!,3,11,27%,46%,女性/合計
年代　 10代,,,#DIV/0!,,,,,,,0,0,#DIV/0!,0%,年代/女性合計
年代　 20代,,,#DIV/0!,0,1,0%,,,#DIV/0!,0,1,0%,9%,
年代　 30代,0,1,0%,0,2,0%,,,#DIV/0!,0,3,0%,27%,
年代　 40代,,,#DIV/0!,0,1,0%,,,#DIV/0!,0,1,0%,9%,
年代　 50代,0,3,0%,1,1,100%,,,#DIV/0!,1,4,25%,36%,
年代　 60代,1,1,100%,,,#DIV/0!,,,,,,#DIV/0!,0%,
年代　 70代,1,1,100%,,,#DIV/0!,,,,,,#DIV/0!,0%,
年代　 80代,,,,,,,,,,,,,,
年代　 90代,,,,,,,,,,,,,,
HPB,1,2,50%,1,4,25%,,,#DIV/0!,2,6,33%,,
HP等,1,3,33%,0,1,0%,,,#DIV/0!,1,4,25%,,
当日予約の方,0,3,0%,1,3,33%,,,#DIV/0!,1,6,17%,,
総合計,4,11,36%,4,13,31%,0,0,#DIV/0!,8,24,33%,,
年代　 10代,0,0,,,,,,,,1,1,100%,4%,年代比率
年代　 20代,0,0,#DIV/0!,2,4,50%,0,0,#DIV/0!,2,4,50%,17%,
年代　 30代,0,3,0%,0,4,0%,0,0,#DIV/0!,0,7,0%,29%,
年代　 40代,0,1,0%,1,3,33%,0,0,#DIV/0!,1,4,25%,17%,
年代　 50代,1,4,25%,1,1,100%,0,0,#DIV/0!,2,5,40%,21%,
年代　 60代,,,,0,0,#DIV/0!,0,0,#DIV/0!,0,0,#DIV/0!,0%,
年代　 70代,1,1,100%,0,1,0%,0,0,#DIV/0!,1,2,50%,8%,
年代　 80代,,,,,,,,,,,,,0,
年代　 90代,,,,,,,,,,,,,,
HPB,1,2,50%,2,5,40%,0,0,#DIV/0!,3,7,43%,,
HP等,4,8,50%,2,5,40%,0,0,#DIV/0!,6,13,46%,,
当日予約の方,0,3,0%,2,7,29%,0,0,#DIV/0!,2,10,20%,,
腰痛(ヘルニア、すべり症、狭窄症）,2,3,67%,2,6,33%,,,#DIV/0!,1,4,25%,17%,院内症例割合
座骨神経痛,1,2,50%,,,#DIV/0!,,,#DIV/0!,1,2,50%,8%,
股関節痛,,,#DIV/0!,0,1,#DIV/0!,,,#DIV/0!,0,1,0%,4%,
膝関節痛,,,#DIV/0!,0,1,0%,,,#DIV/0!,2,2,100%,8%,
足首痛（アキレス腱、足底、踵痛）,,,#DIV/0!,1,1,#DIV/0!,,,#DIV/0!,1,1,#DIV/0!,4%,
首・肩こり,0,1,0%,0,1,0%,,,#DIV/0!,0,2,0%,8%,
頭痛,,,#DIV/0!,0,1,#DIV/0!,,,#DIV/0!,,,#DIV/0!,0%,
肩関節痛(四十肩・五十肩),0,1,0%,,,#DIV/0!,,,#DIV/0!,2,2,100%,8%,
肘痛,,,#DIV/0!,,,#DIV/0!,,,#DIV/0!,,,#DIV/0!,0%,
手首痛（腱鞘炎など）,1,1,#DIV/0!,,,#DIV/0!,,,#DIV/0!,0,1,0%,4%,
顎関節症,0,1,0%,,,#DIV/0!,,,#DIV/0!,,,#DIV/0!,0%,
姿勢関連,1,1,100%,0,1,0%,,,#DIV/0!,,,#DIV/0!,0%,
めまい,0,1,#DIV/0!,,,#DIV/0!,,,#DIV/0!,,,#DIV/0!,0%,
不眠,,,#DIV/0!,,,#DIV/0!,,,#DIV/0!,,,#DIV/0!,0%,
PMS・月経前症候群,,,#DIV/0!,,,#DIV/0!,,,#DIV/0!,0,1,0%,4%,
耳鳴り,,,#DIV/0!,,,#DIV/0!,,,#DIV/0!,,,#DIV/0!,0%,
脳梗塞後遺症,,,#DIV/0!,,,#DIV/0!,,,#DIV/0!,,,#DIV/0!,0%,
その他,,,#DIV/0!,1,1,100%,,,#DIV/0!,1,1,100%,4%,
,,11,,,13,,,,,,,,,`;
