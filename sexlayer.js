// ═══════════════════════════════════════════
// SEXLAYER — два слоя пола: истинный пол (по гениталиям, роль) и внешний тип XX/XY.
// Чистые функции (тестируются в node).
// ═══════════════════════════════════════════

// Тип внешности ребёнка: у двух XX-родителей только XX, в остальных случаях 50 на 50.
export function rollTypes(count, a, b, rand = Math.random) {
    const out = [];
    for (let i = 0; i < Math.max(1, count); i++) {
        out.push(a === 'XX' && b === 'XX' ? 'XX' : (rand() < 0.5 ? 'XX' : 'XY'));
    }
    return out;
}

// Типы бросаются один раз на беременность и хранятся; пересчитываются, если сменилась беременность или число плодов.
export function ensureFetusTypes(c, a, b, rand = Math.random) {
    const count = Math.max(1, parseInt(c.fetusCount) || 1);
    const key = `${c.conceptionDate || ''}:${count}`;
    if (!Array.isArray(c.fetusType) || c._fetusTypeKey !== key || c.fetusType.length !== count) {
        c.fetusType = rollTypes(count, a, b, rand);
        c._fetusTypeKey = key;
    }
    return c.fetusType;
}

// Истинный пол виден на обычном УЗИ примерно с 40% срока; внешний тип надёжно виден только при экспертном осмотре к концу срока.
export const sexKnowable = (progress) => progress >= 0.4;
export const typeKnowable = (progress) => progress >= 0.85;
export function normType(v) { return v === 'XY' ? 'XY' : 'XX'; }
