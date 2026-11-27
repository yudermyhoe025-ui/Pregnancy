// ═══════════════════════════════════════════
// RISK — накопление риска беременности, присутствие партнёра, последствия.
// Чистые функции без зависимостей от Таверны (тестируются в node).
//
// У носителя есть шкала риска c.risk (0-100). Её двигают присутствие партнёра,
// просроченные осмотры, события из сюжета (травма, стресс, пренебрежение, забота)
// и естественное восстановление. Ступень (спокойно, предупреждение, осложнение,
// критично) определяется порогами. Режим последствий (off/mild/hard) задаёт,
// что из этого реально происходит.
// ═══════════════════════════════════════════

export const STAGE_NAMES = ['Спокойно', 'Предупреждение', 'Осложнение', 'Критично'];
export const THRESHOLDS = [0, 40, 70, 90];

export const EVENT_KINDS = {
    injury_light:  { risk: 8,   label: 'Лёгкая травма' },
    injury_medium: { risk: 20,  label: 'Средняя травма' },
    injury_heavy:  { risk: 40,  label: 'Тяжёлая травма' },
    stress:        { risk: 6,   label: 'Сильный стресс' },
    overwork:      { risk: 5,   label: 'Перегрузка' },
    neglect:       { risk: 8,   label: 'Пренебрежение рекомендациями' },
    nest_disturbed:{ risk: 6,   label: 'Нарушено гнездо' },
    care:          { risk: -8,  label: 'Забота и покой' },
    visit:         { risk: -20, label: 'Осмотр у врача' },
};

const CAUSE_FOR_KIND = {
    injury_light: 'injury', injury_medium: 'injury', injury_heavy: 'injury',
    stress: 'stress', overwork: 'stress', neglect: 'neglect', nest_disturbed: 'stress',
};

export const CAUSE_LABELS = {
    presence: 'нехватка присутствия партнёра', injury: 'травма', stress: 'стресс и перегрузка',
    neglect: 'пренебрежение рекомендациями', overdue: 'пропущенные осмотры',
};

const COMPLICATION_NAMES = {
    presence: 'Дефицит присутствия партнёра', injury: 'Последствия травмы', stress: 'Хронический стресс',
    neglect: 'Пренебрежение наблюдением', overdue: 'Пропущенные осмотры',
};

export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export function stageOf(level, prevStage = 0) {
    let st = 0;
    for (let i = THRESHOLDS.length - 1; i >= 0; i--) { if (level >= THRESHOLDS[i]) { st = i; break; } }
    // Гистерезис: вниз ступень снижается только когда уровень ушёл на 5 ниже порога.
    if (st < prevStage && level >= THRESHOLDS[prevStage] - 5) return prevStage;
    return st;
}

// Сила присутствия: настройка чата перекрывает значение вселенной.
export function presenceStrength(s, uni) {
    const o = s && s.presenceMode;
    if (o === 'strong' || o === 'soft' || o === 'off') return o;
    return (uni && uni.presence) || 'off';
}

// Скорость изменения риска от присутствия, баллов в сутки. Отрицательная: восстановление.
export function presenceRate(awayHours, strength, isAway) {
    if (strength === 'off') return 0;
    if (!isAway) return strength === 'strong' ? -3 : -1;
    const h = Math.max(0, awayHours);
    if (strength === 'strong') return h < 8 ? 0 : h < 24 ? 4 : h < 48 ? 10 : h < 96 ? 18 : 30;
    return h < 24 ? 0 : h < 72 ? 1 : h < 168 ? 3 : 6;
}

export function ensureRiskFields(c) {
    if (!c || typeof c !== 'object') return c;
    if (typeof c.risk !== 'number') c.risk = 0;
    if (typeof c.riskStage !== 'number') c.riskStage = 0;
    if (c.presenceState !== 'away') c.presenceState = 'present';
    if (typeof c.awayHours !== 'number') c.awayHours = 0;
    if (!c._riskCauses || typeof c._riskCauses !== 'object') c._riskCauses = {};
    if (typeof c._troubleDays !== 'number') c._troubleDays = 0;
    if (!Array.isArray(c.riskLog)) c.riskLog = [];
    return c;
}

export function dominantCause(c) {
    const m = (c && c._riskCauses) || {};
    let best = null, bv = 0.5;
    for (const k of Object.keys(m)) { if (m[k] > bv) { best = k; bv = m[k]; } }
    return best;
}

function addCause(c, cause, v) {
    if (!(v > 0) || !cause) return;
    c._riskCauses[cause] = (c._riskCauses[cause] || 0) + v;
}

function decayCauses(c, factor) {
    for (const k of Object.keys(c._riskCauses)) {
        c._riskCauses[k] *= factor;
        if (c._riskCauses[k] < 0.5) delete c._riskCauses[k];
    }
}

function pushLog(c, text, rp) {
    c.riskLog.push({ t: text, rp: rp || null });
    if (c.riskLog.length > 12) c.riskLog.splice(0, c.riskLog.length - 12);
}

// Осложнения, порождённые риском: одно активное на носителя.
function syncComplication(c, stage, cause, week, rp) {
    if (!Array.isArray(c.complications)) c.complications = [];
    const active = c.complications.find(x => x && x.source === 'risk' && !x.resolved);
    if (stage >= 2) {
        const sev = stage >= 3 ? 'critical' : 'warning';
        if (!active) {
            const type = COMPLICATION_NAMES[cause] || 'Перенапряжение организма';
            c.complications.push({ week: week || 0, type, severity: sev, description: type, rpDate: rp || null,
                date: new Date().toISOString(), resolved: false, source: 'risk' });
            return true;
        }
        if (active.severity !== sev) { active.severity = sev; return true; }
        return false;
    }
    if (active) { active.resolved = true; return true; }
    return false;
}

function setHealth(c, stage) {
    const hasOther = (c.complications || []).some(x => x && !x.resolved && x.source !== 'risk');
    if (stage >= 3) c.healthStatus = 'critical';
    else if (stage >= 1) { if (c.healthStatus === 'normal' || !c.healthStatus) c.healthStatus = 'warning'; }
    else if (!hasOther && (c.healthStatus === 'warning' || c.healthStatus === 'critical')) c.healthStatus = 'normal';
}

// Пересчитать ступень без хода времени (после события или ручной правки).
export function refreshStage(c, o = {}) {
    ensureRiskFields(c);
    const from = c.riskStage;
    if (!c.isPregnant || o.mode === 'off') return { changed: false, stageFrom: from, stageTo: from };
    c.riskStage = stageOf(c.risk, c.riskStage);
    const cause = dominantCause(c);
    syncComplication(c, c.riskStage, cause, o.week, o.rp);
    setHealth(c, c.riskStage);
    if (o.mode === 'mild' && from < 3 && c.riskStage >= 3 && !c._pendingEvent) setPending(c, 'hospitalization', cause, o);
    return { changed: from !== c.riskStage, stageFrom: from, stageTo: c.riskStage };
}

// Влияние события из сюжета или кнопки. Возвращает { delta } или null.
export function applyEvent(c, kind, o = {}) {
    ensureRiskFields(c);
    const ev = EVENT_KINDS[kind];
    if (!ev) return null;
    const mode = o.mode || 'mild';
    if (mode === 'off') return null;
    let delta = ev.risk;
    // В мягком режиме положительные удары смягчены.
    if (delta > 0 && mode === 'mild') delta = Math.round(delta * 0.6);
    c.risk = clamp(c.risk + delta, 0, 100);
    if (delta > 0) addCause(c, CAUSE_FOR_KIND[kind], delta);
    else decayCauses(c, 0.7);
    if (kind.startsWith('injury')) c._lastInjury = { sev: kind.slice(7), rp: o.rp || null, ms: o.nowMs || null };
    pushLog(c, ev.label, o.rp);
    const rand = o.rand || Math.random;
    // Зверолюди: единственная причина потери это прямая травма.
    if (mode === 'hard' && o.litters && kind === 'injury_heavy' && c.isPregnant && !c._pendingEvent && rand() < 0.4) {
        setPending(c, 'loss', 'injury', o);
    }
    return { delta };
}

function setPending(c, type, cause, o) {
    c._pendingEvent = { type, cause, sinceMs: o.nowMs || 0, rp: o.rp || null };
    pushLog(c, type === 'loss' ? 'Потеря беременности' : type === 'preterm_labor' ? 'Начались преждевременные роды' : 'Госпитализация', o.rp);
}

// Течение времени. o: { hours, strength, mode, fetusCount, litters, overdue, progress, rand, nowMs, rp, week }
// Возвращает { changed, stageFrom, stageTo }.
export function riskTick(c, o) {
    ensureRiskFields(c);
    const mode = o.mode || 'mild';
    const from = c.riskStage;
    if (!c.isPregnant || mode === 'off') {
        const had = c.risk !== 0 || c.riskStage !== 0 || !!c._pendingEvent;
        c.risk = 0; c.riskStage = 0; c._troubleDays = 0; c._pendingEvent = null; c._riskCauses = {};
        if (had) syncComplication(c, 0, null, 0, o.rp);
        return { changed: had, stageFrom: from, stageTo: 0 };
    }
    const hours = Math.max(0, Number(o.hours) || 0);
    if (hours === 0) return { changed: false, stageFrom: from, stageTo: from };
    const days = hours / 24;
    const rand = o.rand || Math.random;
    let delta = 0;

    // Присутствие партнёра
    const isAway = c.presenceState === 'away';
    c.awayHours = isAway ? c.awayHours + hours : 0;
    const prate = presenceRate(c.awayHours, o.strength, isAway);
    delta += prate * days;
    if (prate > 0) addCause(c, 'presence', prate * days);

    // Теневая течка без партнёра рядом
    if (o.shadow && isAway) { delta += 8 * days; addCause(c, 'presence', 8 * days); }

    // Просроченные осмотры
    if (o.overdue) { delta += 1.5 * days; addCause(c, 'overdue', 1.5 * days); }

    // Восстановление без источников нагрузки
    if (delta <= 0) { delta -= 1.5 * days; decayCauses(c, Math.pow(0.9, days)); }

    // Многоплодие повышает нагрузку (у зверолюдей помёт это норма)
    if (delta > 0 && !o.litters && (o.fetusCount || 1) > 1) delta *= 1 + 0.1 * (o.fetusCount - 1);
    if (delta > 0 && mode === 'mild') delta *= 0.7;

    c.risk = clamp(c.risk + delta, 0, 100);
    c.riskStage = stageOf(c.risk, c.riskStage);

    if (c.riskStage >= 2) c._troubleDays += days; else c._troubleDays = 0;
    const cause = dominantCause(c);
    syncComplication(c, c.riskStage, cause, o.week, o.rp);
    setHealth(c, c.riskStage);

    // Серьёзные события
    if (!c._pendingEvent) {
        if (mode === 'hard' && c.riskStage >= 3 && c._troubleDays >= 2) {
            const pr = 1 - Math.pow(1 - 0.15, Math.max(days, 1 / 24));
            if (rand() < pr) {
                const progress = o.progress || 0;
                if (progress >= 0.65) setPending(c, 'preterm_labor', cause, o);
                else if (!o.litters || (c._lastInjury && c._lastInjury.sev === 'heavy')) setPending(c, 'loss', cause, o);
            }
        } else if (mode === 'mild' && from < 3 && c.riskStage >= 3) {
            setPending(c, 'hospitalization', cause, o);
        }
    }
    // Событие не висит вечно
    if (c._pendingEvent && o.nowMs && c._pendingEvent.sinceMs && o.nowMs - c._pendingEvent.sinceMs > 72 * 3600000) {
        c._pendingEvent = null;
    }
    return { changed: c.riskStage !== from, stageFrom: from, stageTo: c.riskStage };
}

// Дней просрочки планового осмотра (0 = в графике). Осмотр раз в шестую часть срока.
export function overdueDays(c, rpMs, termWeeks) {
    if (!c || !c.isPregnant || !c.pregnancyKnown) return 0;
    const lastMs = c.lastDoctorVisitRpDate ? Date.parse(c.lastDoctorVisitRpDate) : (c.conceptionDate ? Date.parse(c.conceptionDate) : NaN);
    if (!Number.isFinite(lastMs) || !Number.isFinite(rpMs)) return 0;
    const interval = (termWeeks * 7) / 6;
    const since = (rpMs - lastMs) / 86400000;
    return since > interval ? since - interval : 0;
}

// Разбор тегов присутствия и событий из текста ответа.
export function parseRiskTags(text) {
    const out = { presence: [], events: [] };
    if (!text) return out;
    const pres = /\[PRESENCE:(user|char):(present|away)\]/gi;
    for (const m of String(text).matchAll(pres)) out.presence.push({ who: m[1].toLowerCase(), state: m[2].toLowerCase() });
    const ev = /\[RISK_EVENT:(user|char):([a-z_]+?)(?::(light|medium|heavy))?\]/gi;
    for (const m of String(text).matchAll(ev)) {
        let kind = m[2].toLowerCase();
        if (kind === 'injury') kind = 'injury_' + (m[3] ? m[3].toLowerCase() : 'medium');
        if (EVENT_KINDS[kind]) out.events.push({ who: m[1].toLowerCase(), kind });
    }
    return out;
}

// Омегаверс: выжигание чужой метки и теневые течки. Возвращает true, если состояние изменилось.
export function omegaTick(c, o) {
    ensureRiskFields(c);
    if (!c.isPregnant) return false;
    const progress = clamp(o.progress || 0, 0, 1);
    const days = Math.max(0, (Number(o.hours) || 0) / 24);
    const rand = o.rand || Math.random;
    let changed = false;
    if (c.markedBy) {
        const burn = Math.max(c._markBurn || 0, progress);
        if (burn !== c._markBurn) { c._markBurn = burn; changed = true; }
    }
    const base = progress < 1 / 3 ? 0.03 : progress < 2 / 3 ? 0.08 : 0.25;
    const pr = 1 - Math.pow(1 - base, days);
    if (!((c._shadowUntil || 0) > (o.nowMs || 0)) && days > 0 && rand() < pr) {
        c._shadowUntil = (o.nowMs || 0) + (2 + Math.floor(rand() * 5)) * 3600000;
        pushLog(c, 'Теневая течка', o.rp);
        changed = true;
    }
    return changed;
}
