// ═══════════════════════════════════════════
// UNIVERSE — вселенные как наборы правил и универсальный движок цикла.
// Чистые функции без зависимостей от Таверны (тестируются в node).
//
// Цикл любой вселенной это упорядоченный список фаз. Длина каждой фазы выбирается
// случайно из диапазона при начале цикла и хранится у носителя в c._cycleSpec.
// День цикла считается по-прежнему числом c.cycleDay (1 = первый день цикла).
// ═══════════════════════════════════════════

const ph = (key, name, nameEn, min, max, o = {}) => ({
    key, name, nameEn, min, max, fertility: 0.02, active: false, fill: false,
    color: '#999999', icon: 'fa-circle', ...o,
});

export const UNIVERSES = {
    // Обычный мир: менструальный цикл 28 дней (логика оригинального расширения).
    normal: {
        id: 'normal', label: 'Обычный мир', kind: 'menstrual',
        term: 38, twins: 3, triplets: 0.1, presence: 'off', menstruation: true,
    },
    // Омегаверс: ежемесячный цикл из четырёх фаз, без менструации.
    omegaverse: {
        id: 'omegaverse', label: 'Омегаверс', kind: 'phased', abo: true,
        term: 38, twins: 5, triplets: 0.3, presence: 'strong', menstruation: false,
        phases: [
            ph('proestrus', 'Проэструс', 'Proestrus', 3, 4, { fertility: 0.3, color: '#e8a0c8', icon: 'fa-hourglass-start' }),
            ph('estrus', 'Течка / гон', 'Heat / rut', 5, 6, { fertility: 1.65, active: true, color: '#ff6b6b', icon: 'fa-fire' }),
            ph('metestrus', 'Метаэструс', 'Metestrus', 3, 4, { fertility: 0.2, color: '#ffd43b', icon: 'fa-moon' }),
            ph('diestrus', 'Диэструс', 'Diestrus', 15, 18, { fertility: 0.02, color: '#66bb6a', icon: 'fa-seedling' }),
        ],
    },
    // Д/с: течка и гон раз в три месяца, до 5 дней, без менструации.
    ds: {
        id: 'ds', label: 'Д/с', kind: 'phased', abo: true, period: 90,
        term: 38, twins: 3, triplets: 0.1, presence: 'soft', menstruation: false,
        phases: [
            ph('prep', 'Подготовка', 'Preparation', 2, 3, { fertility: 0.3, color: '#e8a0c8', icon: 'fa-hourglass-start' }),
            ph('heat', 'Течка / гон', 'Heat / hunt', 3, 5, { fertility: 1.65, active: true, color: '#ff6b6b', icon: 'fa-fire' }),
            ph('post', 'Спад', 'Aftermath', 2, 3, { fertility: 0.2, color: '#ffd43b', icon: 'fa-moon' }),
            ph('rest', 'Покой', 'Rest', 0, 0, { fertility: 0.02, fill: true, color: '#66bb6a', icon: 'fa-seedling' }),
        ],
    },
    // Зверолюди: цикла нет, раз в три месяца брачный сезон на 3-4 дня.
    beastmen: {
        id: 'beastmen', label: 'Зверолюди', kind: 'phased', abo: false, period: 90, season: true,
        term: 32, twins: 0, triplets: 0, presence: 'soft', menstruation: false, litters: true,
        phases: [
            ph('rest', 'Покой', 'Rest', 0, 0, { fertility: 0.05, fill: true, color: '#66bb6a', icon: 'fa-seedling' }),
            ph('season', 'Брачный сезон', 'Mating season', 3, 4, { fertility: 1.65, active: true, color: '#ff6b6b', icon: 'fa-fire' }),
            ph('cool', 'Спад', 'Cooldown', 1, 2, { fertility: 0.1, color: '#ffd43b', icon: 'fa-moon' }),
        ],
    },
};

export const UNIVERSE_IDS = Object.keys(UNIVERSES);

export function getUniverse(s) {
    const id = s && typeof s === 'object' ? s.universe : s;
    return UNIVERSES[id] || UNIVERSES.normal;
}

const rnd = (min, max, rand = Math.random) => min + Math.floor(rand() * (max - min + 1));

// ─── Спецификация цикла носителя ───
export function rollSpec(uni, rand = Math.random) {
    const lens = uni.phases.map(p => (p.fill ? 0 : rnd(p.min, p.max, rand)));
    if (uni.period) {
        const used = lens.reduce((a, b) => a + b, 0);
        const i = uni.phases.findIndex(p => p.fill);
        if (i >= 0) lens[i] = Math.max(1, uni.period - used);
    }
    return { u: uni.id, lens, total: lens.reduce((a, b) => a + b, 0) };
}

export function ensureSpec(c, uni) {
    const sp = c && c._cycleSpec;
    if (sp && sp.u === uni.id && Array.isArray(sp.lens) && sp.lens.length === uni.phases.length && sp.total > 0) return sp;
    if (!c) return rollSpec(uni);
    c._cycleSpec = rollSpec(uni);
    return c._cycleSpec;
}

// Длина текущего цикла в днях.
export function cycleLen(c, s) {
    const uni = getUniverse(s);
    if (uni.kind === 'menstrual') return 28 + Math.max(0, parseInt(c && c._cycleShift) || 0);
    return ensureSpec(c, uni).total;
}

// Фаза на день цикла: { def, idx, dayInPhase, len, progress }
export function phaseAt(c, uni, day) {
    const sp = ensureSpec(c, uni);
    let d = Math.max(1, parseInt(day) || 1);
    if (d > sp.total) d = sp.total;
    let acc = 0;
    for (let i = 0; i < uni.phases.length; i++) {
        const len = sp.lens[i];
        if (d <= acc + len) {
            const dayInPhase = d - acc;
            return { def: uni.phases[i], idx: i, dayInPhase, len, progress: len > 0 ? dayInPhase / len : 0 };
        }
        acc += len;
    }
    const last = uni.phases.length - 1;
    return { def: uni.phases[last], idx: last, dayInPhase: sp.lens[last], len: sp.lens[last], progress: 1 };
}

// Новый день цикла через delta дней; на границе цикла длины фаз перебрасываются.
export function advanceCycleDay(c, s, day, delta, rand = Math.random) {
    const uni = getUniverse(s);
    const d0 = Math.max(1, parseInt(day) || 1);
    const n = Math.max(0, parseInt(delta) || 0);
    if (uni.kind === 'menstrual') return ((d0 - 1 + n) % 28) + 1;
    let sp = ensureSpec(c, uni);
    let d = d0 + n, guard = 0;
    while (d > sp.total && guard++ < 400) {
        d -= sp.total;
        sp = c._cycleSpec = rollSpec(uni, rand);
    }
    return Math.max(1, Math.min(d, sp.total));
}

// Вселенную сменили: старые фазы и день цикла больше не подходят.
export function resetCycleForUniverse(c, s) {
    if (!c) return;
    const uni = getUniverse(s);
    delete c._cycleSpec;
    c._cycleShift = 0;
    const total = uni.kind === 'menstrual' ? 28 : ensureSpec(c, uni).total;
    c.cycleDay = Math.max(1, Math.min(total, parseInt(c.cycleDay) || 1));
}

// Название фазы с учётом роли (течка у омеги/саба, гон у альфы/дома).
export function phaseName(uni, def, role, lang = 'ru') {
    const en = lang === 'en';
    if (def.active && uni.abo) {
        if (role === 'alpha') return en ? (uni.id === 'ds' ? 'Hunt' : 'Rut') : 'Гон';
        return en ? 'Heat' : 'Течка';
    }
    return en ? def.nameEn : def.name;
}

// Множитель шанса зачатия по фазе (для не-менструальных вселенных).
export function phaseFertility(c, uni, day) {
    return phaseAt(c, uni, day).def.fertility;
}

// Сколько дней до начала ближайшей активной фазы (0 = она идёт сейчас).
export function daysToActive(c, uni, day) {
    const sp = ensureSpec(c, uni);
    const cur = phaseAt(c, uni, day);
    if (cur.def.active) return 0;
    let start = 0;
    for (let i = 0; i < uni.phases.length; i++) {
        if (uni.phases[i].active) break;
        start += sp.lens[i];
    }
    const d = Math.max(1, parseInt(day) || 1);
    return start + 1 > d ? start + 1 - d : sp.total - d + start + 1;
}

// Размер помёта у зверолюдей. size: 'small' (150-160 см) | 'large'. Один детёныш реже двух.
export function rollLitter(size = 'small', rand = Math.random) {
    const table = size === 'large'
        ? [[1, 0.35], [2, 0.5], [3, 0.15]]
        : [[1, 0.10], [2, 0.45], [3, 0.35], [4, 0.10]];
    let r = rand(), acc = 0;
    for (const [n, p] of table) { acc += p; if (r < acc) return n; }
    return table[table.length - 1][0];
}
