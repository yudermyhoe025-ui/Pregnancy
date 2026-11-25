import { reportError } from './diagnostics.js';
// ═══════════════════════════════════════════
// STATE — доступ к настройкам и данным
// ═══════════════════════════════════════════

import { extension_settings } from '../../../extensions.js';
import { extensionName, defaultPregnancyData, defaultPartnerData, LANG, PER_CHAT_KEYS, PER_CHAT_DEFAULTS } from './config.js';

// ──────────────────────────────────────────────────────────────────────
// Настройки: общие + наложение значений текущего чата.
// Ключи из PER_CHAT_KEYS читаются и пишутся в chatConfig[chatId]; всё остальное
// идёт в общий объект. Весь остальной код по-прежнему работает через getSettings().
// ──────────────────────────────────────────────────────────────────────
const PER_CHAT_SET = new Set(PER_CHAT_KEYS);
const MODES = ['user', 'char', 'both', 'none'];
let _transientCfg = {};      // чат без id: настройки живут только в памяти
const _proxies = new WeakMap();

export function getRawSettings() {
    return extension_settings[extensionName];
}

// Чат уже что-то делал: есть беременность, ребёнок, дата зачатия и т.п.
function hasActivity(p) {
    if (!p || typeof p !== 'object') return false;
    const q = (p.partner && typeof p.partner === 'object') ? p.partner : {};
    return !!(p.isPregnant || q.isPregnant || p.hasBaby
        || (Array.isArray(p.babies) && p.babies.length)
        || (Array.isArray(p.grownChildren) && p.grownChildren.length)
        || p.conceptionDate || q.conceptionDate || p.postpartum || q.postpartum || p.testTakenAt);
}

// Запись карты по id чата; если лежит под другой формой id, переносим под текущий.
function resolveEntry(map, chatId) {
    if (!map || typeof map !== 'object' || !chatId) return undefined;
    if (map[chatId]) return map[chatId];
    for (const alt of computeChatIdForms()) {
        if (alt !== chatId && map[alt]) {
            map[chatId] = map[alt];
            delete map[alt];
            break;
        }
    }
    return map[chatId];
}

// Настройки текущего чата без создания записи. null = чат ничего не настраивали.
function peekChatConfig(raw) {
    const chatId = getCurrentChatId();
    if (!chatId) return _transientCfg;
    if (!raw.chatConfig || typeof raw.chatConfig !== 'object') raw.chatConfig = {};
    let cfg = resolveEntry(raw.chatConfig, chatId);
    if (cfg) return cfg;

    // Чат из старой версии: данные есть, а своих настроек ещё нет. Замораживаем текущие
    // общие значения как настройки этого чата, чтобы дальше они не менялись из других чатов.
    const legacy = resolveEntry(raw.chatPregnancyData, chatId);
    if (legacy && hasActivity(legacy)) {
        cfg = {};
        for (const key of PER_CHAT_KEYS) {
            if (key.startsWith('_')) continue;
            if (raw[key] !== undefined) cfg[key] = raw[key];
        }
        cfg.isEnabled = raw.isEnabled !== false;
        raw.chatConfig[chatId] = cfg;
        return cfg;
    }
    return null;
}

// Настройки текущего чата для записи (создаёт запись при необходимости).
function ensureChatConfig(raw) {
    const cfg = peekChatConfig(raw);
    if (cfg) return cfg;
    const chatId = getCurrentChatId();
    if (!chatId) return _transientCfg;
    raw.chatConfig[chatId] = {};
    return raw.chatConfig[chatId];
}

function readPerChat(raw, key) {
    const cfg = peekChatConfig(raw);
    const own = (cfg && cfg[key] !== undefined) ? cfg[key] : undefined;
    if (key === 'carrierMode') {
        if (MODES.includes(own)) return own;
        const t = cfg && cfg.trackFor;
        return MODES.includes(t) ? t : PER_CHAT_DEFAULTS.carrierMode;
    }
    if (key === 'trackFor') {
        if (MODES.includes(own)) return own;
        const m = cfg && cfg.carrierMode;
        return MODES.includes(m) ? m : PER_CHAT_DEFAULTS.trackFor;
    }
    return own !== undefined ? own : PER_CHAT_DEFAULTS[key];
}

function wrapSettings(raw) {
    if (_proxies.has(raw)) return _proxies.get(raw);
    const proxy = new Proxy(raw, {
        get(target, key, receiver) {
            if (typeof key === 'string') {
                if (PER_CHAT_SET.has(key)) return readPerChat(target, key);
                if (key === 'debugKeepTags') return false;
            }
            return Reflect.get(target, key, receiver);
        },
        set(target, key, value) {
            if (typeof key === 'string' && PER_CHAT_SET.has(key)) {
                ensureChatConfig(target)[key] = value;
                return true;
            }
            target[key] = value;
            return true;
        },
        has(target, key) {
            return (typeof key === 'string' && PER_CHAT_SET.has(key)) || Reflect.has(target, key);
        },
        deleteProperty(target, key) {
            if (typeof key === 'string' && PER_CHAT_SET.has(key)) {
                const cfg = peekChatConfig(target);
                if (cfg) delete cfg[key];
                return true;
            }
            return Reflect.deleteProperty(target, key);
        },
    });
    _proxies.set(raw, proxy);
    return proxy;
}

export function getSettings() {
    const raw = getRawSettings();
    return raw ? wrapSettings(raw) : raw;
}

// Включено ли расширение в текущем чате.
export function isChatEnabled() {
    return !!getSettings()?.isEnabled;
}

function cloneDefault(value) {
    return (value && typeof value === 'object') ? structuredClone(value) : value;
}

function fillMissing(target, defaults) {
    if (!target || typeof target !== 'object') return;
    for (const key in defaults) {
        if (target[key] === undefined) target[key] = cloneDefault(defaults[key]);
    }
}

function legacyBabyFromRoot(p, index, count) {
    const sexList = Array.isArray(p.babySex) ? p.babySex : [];
    return {
        name: index === 0 ? (p.babyName || '') : '',
        sex: sexList[index] || sexList[0] || 'M',
        health: p.babyHealth || 'normal',
        mood: p.babyMood || 'спокойный',
        sleep: p.babySleep || 'спит',
        diaperClean: p.babyDiaperClean !== false,
        teething: !!p.babyTeething,
        colicky: !!p.babyColicky,
        feedingType: p.babyFeedingType || '',
        milestones: index === 0 && Array.isArray(p.babyMilestones) ? structuredClone(p.babyMilestones) : [],
        personality: [],
        appearance: [],
        birthRpDate: p.babyBirthRpDate || p.rpDate || null,
        age: p.babyAge || 'новорождённый',
    };
}

// babies[] is the canonical active-child state. Legacy singular fields remain as
// compatibility mirrors for old UI/prompts/saves and are rebuilt from babies[].
export function syncBabyLegacyFields(p = getPregnancyData()) {
    if (!p || typeof p !== 'object') return p;
    if (!Array.isArray(p.babies)) p.babies = [];
    if (!Array.isArray(p.grownChildren)) p.grownChildren = [];

    // Upgrade old saves that only had babyName/babyCount/etc.
    if (p.babies.length === 0 && p.hasBaby) {
        const legacyCount = Math.max(1, parseInt(p.babyCount) || (Array.isArray(p.babySex) ? p.babySex.length : 0) || 1);
        for (let i = 0; i < legacyCount; i++) p.babies.push(legacyBabyFromRoot(p, i, legacyCount));
    }

    p.babies = p.babies.filter(b => b && typeof b === 'object');
    if (p.babies.length === 0) {
        p.hasBaby = false;
        p.babyCount = 0;
        p.babyName = '';
        p.babySex = [];
        p.babyBirthRpDate = null;
        return p;
    }

    p.hasBaby = true;
    p.babyCount = p.babies.length;
    p.babySex = p.babies.map(b => b.sex || '?');
    const primary = p.babies[0];
    p.babyName = primary.name || '';
    p.babyHealth = primary.health || 'normal';
    p.babyMood = primary.mood || '';
    p.babySleep = primary.sleep || '';
    p.babyDiaperClean = primary.diaperClean !== false;
    p.babyTeething = !!primary.teething;
    p.babyColicky = !!primary.colicky;
    p.babyFeedingType = primary.feedingType || '';
    p.babyMilestones = Array.isArray(primary.milestones) ? primary.milestones : [];
    p.babyAge = primary.age || p.babyAge || '';
    p.babyBirthRpDate = primary.birthRpDate || null;
    return p;
}

export function migratePregnancyData(p, s = getSettings()) {
    if (!p || typeof p !== 'object') return p;
    fillMissing(p, defaultPregnancyData);
    if (!p.partner || typeof p.partner !== 'object') p.partner = structuredClone(defaultPartnerData);
    fillMissing(p.partner, defaultPartnerData);
    syncBabyLegacyFields(p);
    return p;
}

export function getContraception(who = 'user') {
    const s = getSettings();
    if (!s) return 'none';
    const legacy = s.contraception || 'none';
    if (s.contraceptionUser === undefined || s.contraceptionUser === null) s.contraceptionUser = legacy;
    if (s.contraceptionChar === undefined || s.contraceptionChar === null) s.contraceptionChar = legacy;
    return who === 'char' ? (s.contraceptionChar || 'none') : (s.contraceptionUser || 'none');
}

// ──────────────────────────────────────────────────────────────────────
// Управление chatId с кэшем.
// ──────────────────────────────────────────────────────────────────────
let _cachedChatId = null;

export function resetChatIdCache() {
    _cachedChatId = null;
}

// Все формы id текущего чата в порядке приоритета:
// uuid:<integrity> > file:<file_name> > hash:<chat_id_hash> > нормализованный ctx.chatId.
// getPregnancyData() ищет данные по всем формам и переносит под каноничный ключ.
export function computeChatIdForms() {
    const forms = [];
    try {
        const ctx = (typeof SillyTavern?.getContext === 'function')
            ? SillyTavern.getContext()
            : null;
        if (!ctx) return forms;

        const meta = ctx.chatMetadata || ctx.chat_metadata
                  || (typeof window !== 'undefined' ? window.chat_metadata : null);
        if (meta) {
            const integrity = meta.integrity;
            if ((typeof integrity === 'string' && integrity.length > 0) || typeof integrity === 'number') {
                forms.push(`uuid:${String(integrity)}`);
            }
            const fname = meta.file_name || meta.fileName;
            if (typeof fname === 'string' && fname.length > 0) {
                forms.push(`file:${fname}`);
            }
            let hash = meta.chat_id_hash;
            if (hash === undefined || hash === null) hash = meta.chatIdHash;
            if (hash !== undefined && hash !== null && hash !== '') {
                forms.push(`hash:${String(hash)}`);
            }
        }

        const directId = ctx.chatId;
        if ((typeof directId === 'string' && directId.trim().length > 0) || typeof directId === 'number') {
            // Normalize common human-readable form like "Name - 2026-05-28@11h08m17s150ms"
            // by trimming only the high-resolution millisecond suffix.
            let s = String(directId).trim();
            s = s.replace(/\s-\s(\d{4}-\d{2}-\d{2}@\d{2}h\d{2}m\d{2}s)\d*ms$/, ' - $1');
            s = s.replace(/\s@(\d{4}-\d{2}-\d{2}@\d{2}h\d{2}m\d{2}s)\d*ms$/, ' @$1');
            forms.push(s);
        }
    } catch (e) { /* ignore */ }
    return forms;
}

export function getCurrentChatId() {
    if (_cachedChatId) return _cachedChatId;

    try {
        const forms = computeChatIdForms();
        const resolved = forms.length > 0 ? forms[0] : null;

        if (resolved) {
            _cachedChatId = resolved;
            return resolved;
        }

        return null;
    } catch (e) {
        return null;
    }
}

export function getChat() {
    try {
        const context = typeof SillyTavern?.getContext === 'function'
            ? SillyTavern.getContext()
            : window;
        return context?.chat || [];
    } catch (e) {
        return [];
    }
}

// ──────────────────────────────────────────────────────────────────────
// Fallback объект — временное хранилище, когда chatId не определён.
// В постоянное хранилище НЕ мигрирует: изменения теряются на CHAT_CHANGED.
// ──────────────────────────────────────────────────────────────────────
let _fallback = null;

function getFallback() {
    if (!_fallback) _fallback = structuredClone(defaultPregnancyData);
    return _fallback;
}

export function resetFallback() {
    _fallback = null;
    _transientCfg = {};
}

export function getPregnancyData() {
    const raw = getRawSettings();
    const chatId = getCurrentChatId();

    if (!raw.chatPregnancyData) {
        raw.chatPregnancyData = {};
    }

    // Нет chatId → fallback объект. ИЗМЕНЕНИЯ В НЁМ НЕ ПЕРЕЕЗЖАЮТ В ПОСТОЯННОЕ ХРАНИЛИЩЕ.
    // Это намеренно: предотвращает утечку данных между чатами в момент перехода.
    if (!chatId) {
        return getFallback();
    }

    // Данные под каноничным ключом или под альтернативными формами id (с переносом)
    let existing = resolveEntry(raw.chatPregnancyData, chatId);

    // В выключенном чате без данных запись не создаём: не раздуваем настройки
    // записями для чатов, где расширение не используется.
    if (!existing && !isChatEnabled()) {
        return getFallback();
    }

    // Новый чат — создаём чистый объект (fallback не мигрируем)
    if (!existing) {
        const fresh = structuredClone(defaultPregnancyData);
        // Каждый новый чат стартует в случайной фазе цикла, а не всегда с 1-го дня
        fresh.cycleDay = 1 + Math.floor(Math.random() * 28);
        fresh.lastCycleUpdate = Date.now();
        fresh.partner = structuredClone(defaultPartnerData);
        fresh.partner.cycleDay = 1 + Math.floor(Math.random() * 28);
        raw.chatPregnancyData[chatId] = fresh;
        existing = fresh;
    }

    migratePregnancyData(existing, getSettings());
    return existing;
}

// ──────────────────────────────────────────────────────────────────────
// Носители (s.trackFor = user | char | both): юзер — в корне p, персонаж — в p.partner.
// Дети (babies/grownChildren) общие и лежат в корне — семья одна.
// ──────────────────────────────────────────────────────────────────────
export function getPartnerData() {
    const p = getPregnancyData();
    if (!p.partner || typeof p.partner !== 'object') p.partner = structuredClone(defaultPartnerData);
    fillMissing(p.partner, defaultPartnerData);
    return p.partner;
}

// Данные носителя по ключу: 'user' → p, 'char' → p.partner
export function getCarrier(who) {
    return who === 'char' ? getPartnerData() : getPregnancyData();
}

// Список активных носителей: [{ who, data }]
export function getCarriers() {
    const s = getSettings();
    const mode = s?.trackFor || 'user';
    const list = [];
    if (mode === 'user' || mode === 'both') list.push({ who: 'user', data: getPregnancyData() });
    if (mode === 'char' || mode === 'both') list.push({ who: 'char', data: getPartnerData() });

    return list;
}

// Имя носителя для UI/промпта
export function carrierName(who) {
    try {
        const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
        if (who === 'char') return ctx?.name2 || 'Персонаж';
        return ctx?.name1 || 'Ты';
    } catch (e) {
        return who === 'char' ? 'Персонаж' : 'Ты';
    }
}

// Подставляет имена вместо макросов {{user}} / {{char}} (и старых <USER> / <BOT>).
// Нужен для полей, куда имя вводят руками, например «второй родитель».
export function resolveNameMacros(text) {
    const src = String(text ?? '');
    if (!src.includes('{{') && !/<\s*(user|bot)\s*>/i.test(src)) return src;
    const user = carrierName('user');
    const char = carrierName('char');
    return src
        .replace(/\{\{\s*user\s*\}\}|<\s*user\s*>/gi, user)
        .replace(/\{\{\s*char\s*\}\}|<\s*bot\s*>/gi, char);
}

// Отслеживается ли носитель
export function isTracked(who) { const mode = getSettings()?.trackFor || 'user'; return mode === 'both' || mode === who; }

export function L(key) {
    try {
        const s = getSettings();
        const lang = s?.language || 'ru';
        const keys = key.split('.');
        let result = LANG[lang];
        for (const k of keys) {
            result = result?.[k];
        }
        return result || key;
    } catch (e) {
        reportError('[Reproductive] L() error:', key, e);
        return key;
    }
}

// ─── Cycle day accessors (per-chat) ───
export function getCycleDay() {
    const p = getPregnancyData();
    if (typeof p.cycleDay === 'number' && p.cycleDay >= 1 && p.cycleDay <= 28 + Math.max(0, parseInt(p._cycleShift) || 0)) {
        return p.cycleDay;
    }
    const s = getSettings();
    const globalCycle = (typeof s.cycleDay === 'number' && s.cycleDay >= 1 && s.cycleDay <= 28) ? s.cycleDay : 1;
    p.cycleDay = globalCycle;
    if (!p.lastCycleUpdate && s.lastCycleUpdate) p.lastCycleUpdate = s.lastCycleUpdate;
    return p.cycleDay;
}

export function setCycleDay(day, updateTimestamp = true, isUserAction = false) {
    const p = getPregnancyData();
    // При сбое цикла (реализм) текущий цикл растянут — день может уйти за 28,
    // это и есть задержка. Без сбоя потолок обычный.
    const maxDay = 28 + Math.max(0, parseInt(p._cycleShift) || 0);
    const d = Math.max(1, Math.min(maxDay, parseInt(day) || 1));
    p.cycleDay = d;
    if (updateTimestamp) p.lastCycleUpdate = Date.now();
    if (isUserAction) {
        p._dynamic = {};
        // Метка ручной установки цикла — защита от auto-advance в advanceTime
        // (бот-ответ с новым RP_DATE не должен затирать день, выставленный юзером)
        p._userSetCycleAt = Date.now();
    }
    return d;
}

// A stale CYCLE_DAY tag from the regenerated reply cannot override a manual edit.
export function isManualCycleProtected(who = 'user') {
    const c = who === 'char' ? getPartnerData() : getPregnancyData();
    const position = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext().chat?.length || 0 : 0;
    return Number.isInteger(c._manualCyclePosition) && position <= c._manualCyclePosition;
}
