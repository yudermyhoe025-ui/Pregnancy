// Compatibility API. One cycle per explicitly selected carrier; no sex/role inference.
import { getPhaseInfo, getCycleModifier } from './helpers.js';
import { fertileWindow } from './fertility.js';
import { getUniverse, phaseAt, phaseName, phaseFertility, daysToActive } from './universe.js';
import { getCarrier } from './state.js';
export function isOmegaverse(s) { return s?.universe === 'omegaverse'; }
export function isAbo(s) { return !!getUniverse(s).abo; }
export function isPhased(s) { return getUniverse(s).kind === 'phased'; }
export function carrierMode(s) {
    if (['user', 'char', 'both', 'none'].includes(s?.carrierMode)) return s.carrierMode;
    return ['user', 'char', 'both', 'none'].includes(s?.trackFor) ? s.trackFor : 'user';
}
export function canCarry(s, who) { const m = carrierMode(s); return (who === 'user' || who === 'char') && (m === 'both' || m === who); }
// Менструация есть только в обычном мире.
export function hasMenstrualCycle(s, who) { return getUniverse(s).kind === 'menstrual' && canCarry(s, who); }
export function hasAnyTracking(s, who) { const mode = s?.trackFor || 'user'; return mode === 'both' || mode === who; }
export function designationOf(s, who) {
    const role = who === 'char' ? s?.charDesignation : s?.userDesignation;
    return ['alpha','beta','omega'].includes(role) ? role : who === 'char' ? 'alpha' : 'omega';
}
// Есть ли у персонажа цикл (течка, гон или сезон). Беты и нейтралы его не имеют, зверолюди имеют все.
export function hasCycle(s, who) {
    if (canCarry(s, who)) return true;
    const uni = getUniverse(s);
    if (uni.kind !== 'phased') return false;
    return uni.id === 'beastmen' || designationOf(s, who) !== 'beta';
}
export function roleLabel(s, who) {
    const id = getUniverse(s).id;
    const maps = {
        omegaverse: { alpha: 'Альфа', beta: 'Бета', omega: 'Омега' },
        ds: { alpha: 'Доминант', beta: 'Нейтрал', omega: 'Сабмиссив' },
        beastmen: { alpha: 'Самец', beta: 'Самец', omega: 'Самка' },
    };
    return (maps[id] || maps.omegaverse)[designationOf(s, who)];
}
export function cyclePhase(s, who, day, lang = 'ru') {
    const uni = getUniverse(s), en = lang === 'en', carrier = canCarry(s, who);
    if (uni.kind === 'phased') {
        const c = getCarrier(who);
        const pa = phaseAt(c, uni, day);
        return { name: phaseName(uni, pa.def, designationOf(s, who), lang), icon: pa.def.icon, color: pa.def.color, key: pa.def.key, active: pa.def.active };
    }
    const info = getPhaseInfo(day, lang, false, s?.menstruationEnabled !== false && carrier);
    return carrier ? info : { ...info, name: en ? 'State' : 'Состояние', color: '#999999' };
}
// Множитель шанса зачатия на текущий день цикла.
export function fertilityMod(s, who, c, day) {
    const uni = getUniverse(s);
    if (uni.kind === 'menstrual') return canCarry(s, who) ? getCycleModifier(day) : 1;
    return phaseFertility(c, uni, day);
}
// Фертильное окно для режима «планируем»: { fertile, peak, label, daysToPeak }
export function fertileInfo(s, c, day) {
    const uni = getUniverse(s);
    if (uni.kind === 'menstrual') return fertileWindow(day, 28);
    const pa = phaseAt(c, uni, day);
    const fertile = pa.def.active;
    return { fertile, peak: fertile && pa.progress >= 0.3 && pa.progress <= 0.8, label: fertile ? pa.def.name : 'Низкая фертильность',
             daysToPeak: fertile ? 0 : daysToActive(c, uni, day) };
}
export function sexOf(s, who) { return who === 'char' ? s?.charSex : s?.userSex; }
export function getCfg() { return { heatCycleLength: 28, heatDuration: 5, rutCycleLength: 28, rutDuration: 0 }; }
export function getHeatPhase(day) {
    const d = Math.max(1, Math.trunc(Number(day)) || 1);
    const info = getPhaseInfo(d, 'ru', true);
    const heat = d >= 12 && d <= 16;
    return { phase: heat ? 'heat' : d > 28 ? 'delayed' : 'normal', day: d, len: 28,
        label: info.name + (heat ? ` · ${d - 11}/5 дн.` : ''),
        sub: d > 28 ? `Задержка ${d - 28} дн.` : `день ${d} из 28`,
        labelEn: getPhaseInfo(d, 'en', true).name + ` (cycle day ${d}/28)`, fertility: 1 };
}
export function getRutPhase(day) { const phase = getHeatPhase(day); return { ...phase, phase: phase.phase === 'heat' ? 'rut' : phase.phase, inRut: phase.phase === 'heat', potency: phase.phase === 'heat' ? 1.5 : 1 }; }
export function carrierAboStatus(carrier, desig, s) {
    if (carrier?.isPregnant) return { kind:'cycle', phase:'paused', label:'Цикл приостановлен', labelEn:'cycle paused', fertility:0 };
    const day = Math.max(1, parseInt(carrier?.cycleDay) || 1), active = day >= 12 && day <= 16;
    const phase = desig === 'omega' && active ? 'heat' : desig === 'alpha' && active ? 'rut' : 'normal';
    return { kind:desig, phase, day, len:28, inRut:phase==='rut', fertility:1, label:phase==='heat'?'Течка':phase==='rut'?'Гон':desig==='alpha'?'Вне гона':desig==='omega'?'Между течками':'Бета' };
}
export function advanceAboCycles() { return []; }
