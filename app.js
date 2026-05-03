/* ================================================================
   セラピスト別顧客分析 app.js  v2 — 集計データ対応版
   ================================================================ */

// ==================== STATE ====================
const state = {
    therapists: [],
    currentTherapist: 'all',
    data: {},
    charts: {},
    goodThreshold: 50,
    badThreshold: 30,
    period: '',
};

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

function loadCSVText(text, title) {
    const result = parseCSV(text);
    state.therapists = result.therapists;
    state.data = result.data;
    state.period = title || '';
    state.currentTherapist = 'all';

    document.getElementById('upload-section').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    document.getElementById('app-title').textContent = title || 'セラピスト別顧客分析';

    renderTabs();
    renderDashboard('all');
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
    // 先頭数行に日付パターン（M/D）があれば raw とみなす
    for (let i = 0; i < Math.min(5, rows.length); i++) {
        if (/^\d{1,2}\/\d{1,2}$/.test(String(rows[i]?.[0] ?? '').trim())) return 'raw';
    }
    return 'unknown';
}

// ==================== 生データ CSV パース（新規購入内訳） ====================
// 列: 日付(0), 名前(1), 年代(2), 性別(3), セラピスト(4), 症状(5), 問い合わせ媒体(6), 当日希望(7), 回数券(8)
// 年代: 数字 1桁 (例: 5 → '50代')
// 購入(1回券含まず): 回数券が 2 以上の整数のとき
function parseRawCSV(rows) {
    const therapistSet = new Set();
    const patientRows  = [];

    for (const row of rows) {
        if (!/^\d{1,2}\/\d{1,2}$/.test(String(row[0] ?? '').trim())) continue;
        const therapist = String(row[4] ?? '').trim();
        if (!therapist) continue;
        therapistSet.add(therapist);
        patientRows.push(row);
    }

    if (!patientRows.length) throw new Error('患者データが見つかりませんでした。日付(M/D形式)の列が1列目にあるか確認してください。');

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
        const ageNum = parseInt(ageRaw, 10);
        const age    = !isNaN(ageNum) && ageNum > 0 ? (ageNum * 10) + '代' : null;

        // 2回以上の回数券のみ「購入」とカウント（1回券・初回のみ除外）
        const kaikenInt  = parseInt(kaikenRaw, 10);
        const isPurchase = !isNaN(kaikenInt) && kaikenInt > 1;

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
    [['all', '🏠 全員まとめ（院合計）'], ...state.therapists.map(n => [n, n])].forEach(([key, label]) => {
        const btn = document.createElement('button');
        btn.className = 'tab' + (key === state.currentTherapist ? ' active' : '');
        btn.textContent = label;
        btn.addEventListener('click', () => {
            el.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            state.currentTherapist = key;
            renderDashboard(key);
        });
        el.appendChild(btn);
    });
}

// ==================== ダッシュボード ====================
function renderDashboard(key) {
    const d = key === 'all' ? state.data['院合計'] : state.data[key];
    if (!d) return;
    destroyCharts();
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

// 閾値スライダー
['good', 'bad'].forEach(type => {
    document.getElementById(`${type}-threshold`).addEventListener('input', function() {
        state[`${type}Threshold`] = +this.value;
        document.getElementById(`${type}-val`).textContent = this.value;
        if (!state.therapists.length) return;
        const d = state.currentTherapist === 'all' ? state.data['院合計'] : state.data[state.currentTherapist];
        if (d) { renderMediaRateChart(d); renderTable(d); }
    });
});

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
