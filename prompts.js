import { reportError } from './diagnostics.js';
// ═══════════════════════════════════════════
// PROMPTS — инъекция промптов для AI
// ═══════════════════════════════════════════

import { setExtensionPrompt, extension_prompts, extension_prompt_types, extension_prompt_roles } from '../../../../script.js';
import { extensionName } from './config.js';
import { getSettings, getPregnancyData, getPartnerData, getCycleDay, isTracked, getContraception, carrierName } from './state.js';
import { isOmegaverse, isAbo, hasMenstrualCycle, hasAnyTracking, canCarry, hasCycle, designationOf, cyclePhase, fertileInfo } from './omegaverse.js';
import { getUniverse, phaseAt, cycleLen } from './universe.js';
import { ensureRiskFields, dominantCause, presenceStrength, STAGE_NAMES } from './risk.js';
import { ensureFetusTypes, normType, sexKnowable, typeKnowable } from './sexlayer.js';
import { pregnancyIsKnown, getPostpartum, monthsTrying } from './pregnancy.js';
import { fertileWindow, conceptionStruggle } from './fertility.js';
import { getFlow, getHygieneState, realismPromptLine, hoursBetween } from './cycle-realism.js';
import { getPhaseInfo, calculateWeeksFromDates, detectChatLanguage } from './helpers.js';
import { babyAgeDays, getCareNeeds } from './baby-care.js';

// Требование языка для значений в тегах: детектим язык чата, чтобы модель
// не писала "High"/"Anxious" в русской истории.
function langRequirement() {
    const lang = detectChatLanguage();
    const langName = lang === 'ru' ? 'Russian' : 'English';
    let line = `ALL values inside the tag JSON must be written in ${langName} — the language of the story.`;
    if (lang === 'ru') line += ` Все текстовые значения, включая note, physical, mood и partner, пиши по-русски, обычными словами, без английских ярлыков и snake_case.`;
    return { lang, langName, line };
}

function sexToText(arr) {
    if (!arr || arr.length === 0) return '';
    return arr.map(s => s === 'M' ? 'boy' : 'girl').join(', ');
}

// ─── Блок правил вселенной A/B/O + текущие статусы носителей ───
// Компактно: 4 строки правил + по строке на носителя.
// ─── Строка статуса цикла носителя (обычный мир или омегаверс) ───
function carrierCycleLine(who, s) {
    if (!hasAnyTracking(s, who)) return '';
    if (!hasCycle(s, who)) return `${who}: general scene state, no cycle`;
    const c = who === 'char' ? getPartnerData() : getPregnancyData();
    const nm = who === 'char' ? '{{char}}' : '{{user}}';
    if (c.isPregnant) return pregnancyIsKnown(c, s) ? `${nm}: pregnancy; cycle paused` : `${nm}: cycle timing uncertain; use current scene evidence`;
    const pp = getPostpartum(c, getPregnancyData());
    if (pp && !pp.cycleReturned) return `${nm}: postpartum recovery; cycle paused`;
    const day = who === 'char' ? (c.cycleDay || 1) : getCycleDay();
    if (getUniverse(s).kind !== 'menstrual') {
        return `${nm}: ${cyclePhase(s, who, day, 'en').name}, cycle day ${day}/${cycleLen(c, s)}`;
    }
    return `${nm}: ${day > 28 ? `period delayed by ${day - 28} days` : `cycle day ${day}/28`} (${cyclePhase(s, who, day, 'en').name})`;
}

// ─── Шкала срока ───
// Беременность может длиться не 40 недель (короткий сеттинг, нечеловеческий вид).
// Без явного пересчёта модель описывает плод по реальным неделям: «4 недели —
// маковое зёрнышко», хотя 4 из 24 — это уже треть пути.
// ─── Реализм цикла ───
// Тело носителя как часть сцены: самочувствие по фазе, гигиена в месячные,
// сбои цикла. Держим коротко — это идёт в каждый ответ.
function realismBlock(s, p) {
    if (!s.realism || p.isPregnant || (s.menstruationEnabled === false && getCycleDay() <= 5)) return '';
    if (!hasMenstrualCycle(s, 'user') || !isTracked('user')) return '';
    const day = getCycleDay();
    const flow = getFlow(day);
    const hy = flow.factor > 0
        ? getHygieneState(p.hygieneType || 'pad', hoursBetween(p.hygieneChangedRpDate, p.rpDate), flow)
        : null;

    let b = `\n[BODY]\n`;
    b += `{{user}} right now: ${realismPromptLine(day, hy, { lang: 'en' })}.\n`;
    b += `Let this colour the scene — energy, patience, appetite, what she wants or avoids — without turning it into the plot.\n`;
    // Органичность: партнёр не телепат
    b += `Others know ONLY what is visible or told: a hand pressed to her back, painkillers, a hot-water bottle, a stain, her saying so. Nobody senses a phase or a fertile day.\n`;
    if (hy && (hy.overdue || hy.type.id === 'none')) {
        b += `If the scene allows, she would deal with it — stepping out, checking, asking for a spare. Play it plainly, no euphemisms and no drama.\n`;
    }
    b += `[CYCLE EVENT] Only if something in THIS reply would genuinely disrupt a cycle (severe stress, illness, starvation, long-haul travel, overtraining), add to RP_STATUS: "cycle_event":"stress|illness|starvation|travel|overtrain". Otherwise omit the field.\n`;
    return b;
}

// ─── Блок беременности партнёра ({{char}}) для промпта ───
export function getBasePrompt() {
    const s = getSettings(), p = getPregnancyData();
    if (!s.isEnabled) return '';
    const active = ['user', 'char'].filter(isTracked);
    if (!active.length && !p.hasBaby) return '';
    const uniDesc = {
        normal: 'NORMAL; ordinary ovulation, no omegaverse heat or rut',
        omegaverse: 'OMEGAVERSE; omega has heat, alpha has rut, beta has neither. The active phase is the estrus phase of a roughly monthly four-phase cycle (proestrus, estrus, metestrus, diestrus); there is no menstruation',
        ds: 'D/S; submissive has heat, dominant has hunt, roughly every three months for up to 5 days; no menstruation',
        beastmen: 'BEASTMEN; no cycle phases; a mating season of 3-4 days roughly every three months; litters of several offspring are normal; no menstruation',
    }[getUniverse(s).id];
    const isMens = getUniverse(s).kind === 'menstrual';
    let b = `[TRACKER] Universe: ${uniDesc}. Tracking: ${active.join(', ') || 'none'}. Carriers: ${active.filter(w => canCarry(s, w)).join(', ') || 'none'} (explicit choice; never infer from anatomy or A/B/O). ${isMens ? 'One 28-day cycle each.' : 'One cycle per carrier.'}\n`;
    if (p.rpDate) b += `RP clock: ${new Date(p.rpDate).toLocaleString('en-GB', {hour12:false})}. Advance only by time actually elapsed in the scene; do not skip to a due date.\n`;
    b += 'Identity: user={{user}} (player), char={{char}} (bot). RP_STATUS root describes ONLY user; partner describes ONLY char, regardless of narrator or pronouns. Never exchange their actions or body states. If uncertain, omit the field.\n';
    if (isAbo(s)) b += active.map(w => `${w}=${designationOf(s,w)}`).join(', ') + '.\n';
    b += active.map(w => carrierCycleLine(w, s)).join(' | ') + '\n';
    if (isMens && s.menstruationEnabled === false) b += 'Menstrual bleeding is disabled; days 1–11 are follicular. Keep ovulation/heat and the rest of the cycle. No menstrual hygiene reminders.\n';
    b += cycleScenePrompt(s) + (isMens ? realismBlock(s, p) : '') + riskBlock(s, p) + omegaBlock(s, p);
    if (isMens && s.menstruationEnabled !== false) {
        for (const who of active) {
            const c = who === 'char' ? getPartnerData() : p;
            const pp = getPostpartum(c, p);
            if (!canCarry(s, who) || c.isPregnant || c.cycleDay > 5 || (pp && !pp.cycleReturned)) continue;
            const h = getHygieneState(c.hygieneType || 'pad', hoursBetween(c.hygieneChangedRpDate, p.rpDate), getFlow(c.cycleDay));
            if (h.needsChange) b += `${who}: ${h.type.id === 'none' ? 'no menstrual hygiene product in use' : 'hygiene product needs changing now'}; follow observable scene cues.\n`;
        }
    }
    const pregnant = active.some(w => (w === 'char' ? getPartnerData() : p).isPregnant);
    if (pregnant) b += knowledgePrompt(s) + 'Known character appearance from the story/cards only: RP_STATUS looks:{hair,eyes} for user, partner.looks for char. Omit unknown traits.\n';
    for (const who of active) {
        const c = who === 'char' ? getPartnerData() : p;
        if (c.isPregnant || !canCarry(s, who)) continue;
        const suffix = who === 'char' ? ':CHAR' : '';
        b += `${who}: protection=${getContraception(who)}. Only actual internal semen release into this carrier in the current scene triggers <!-- [CONCEPTION_CHECK${suffix}] -->; exclude withdrawal, external/oral release, memories and intentions. With a condom, only if it fails.\n`;
    }
    if (isTracked('char')) b += compactPregnancy('char', s);
    if (isTracked('user') && s.tryingToConceive && !p.isPregnant) b += tryingBlock(s, p);
    const fields = c => c.isPregnant && pregnancyIsKnown(c, s)
        ? { mood: '...', symptoms: '...', fetus_count: c.fetusCount || 1, fetus_size: '...', note: '...' }
        : { libido: '...', mood: '...', physical: '...', note: '...' };
    const status = isTracked('user') && !p.hasBaby ? fields(p) : { note: '...' };
    status.subject = 'user';
    if (isTracked('char')) status.partner = { subject: 'char', ...fields(getPartnerData()) };
    if (p.hasBaby) status.babies = p.babies.map((c,i) => ({label:c.name || `Baby${i+1}`,mood:'...',sleep:'...',feeding:'...',diaper:'...',care_note:'...',milestone:null}));
    b += `At the end, output one HTML comment with current scene values (${langRequirement().langName}, 2–5 words per field; do not echo stale notes):\n<!-- [RP_STATUS:${JSON.stringify(status)}] -->\n`;
    b += langRequirement().line + '\n';
    if (p.hasBaby) b += 'Baby labels are identifiers, never rename them. Set milestone only for a new first achievement in this scene.\n';
    if (s.dateSource === 'chat') {
        b += 'Do not add an RP_DATE tag: the RP date is read from the date marker your reply already contains. Event markers occur once, only in the final reply, never in reasoning or visible prose.\n';
    } else {
        b += 'Last line: <!-- [RP_DATE:DD.MM.YYYY HH:MM] --> using current RP time. Event markers occur once, only in the final reply, never in reasoning or visible prose.\n';
    }
    return b;
}

function compactPregnancy(who, s) {
    const p = getPregnancyData(), c = who === 'char' ? getPartnerData() : p;
    if (!isTracked(who) || !c.isPregnant) return '';
    const known = pregnancyIsKnown(c, s);
    const nm = who === 'char' ? '{{char}}' : '{{user}}';
    const suffix = who === 'char' ? ':CHAR' : '';
    const duration = s.pregnancyDuration || 40;
    const {weeks} = calculateWeeksFromDates(c.conceptionDate,p.rpDate,c.pregnancyWeeks);
    const pct = Math.round(weeks/duration*100);
    let b = `[${known ? nm + ' IS PREGNANT' : who + ' PRIVATE SIMULATION'}] ${weeks}/${duration} weeks (${pct}%), fetuses=${c.fetusCount||1}, sex=${c.fetusSexRevealed?sexToText(c.fetusSex):'unknown'}, health=${c.healthStatus||'normal'}. Cycle paused.\n`;
    if (c.fatherName) b += `Second parent: ${JSON.stringify(c.fatherName)}; preserve this identity for the children.\n`;
    if (getUniverse(s).twoLayer) b += sexLayerLine(s, c, who, pct / 100, known);
    b += 'BABY_TRAITS appearance must follow established parental descriptions and any explicit child description; do not invent hair/eye colours or unusual traits. If unknown, use an empty appearance array.\n';
    if (!known) b += 'Discovery not recorded: these are private simulation facts, not character knowledge. Follow actual tests/disclosures in the scene.\n';
    b += 'Tracker term and fetal count are authoritative; do not invent multiples or delivery. Due date alone never means a baby was born. An established discovery in this scene (examination or reliable in-world knowledge, including fantasy settings) confirming a different count: RP_STATUS fetus_count (1–4) and fetus_count_confirmed:true, in partner for char. The count must agree with discoveries in note and symptoms; wishes and guesses never change it.\n';
    if (duration !== 40) b += `Scale development and fetus_size to ${pct}% of full term, equivalent to about ${Math.round(pct*40/100)} human weeks.\n`;
    if (c.complications?.length) b += `Active complications: ${c.complications.filter(x=>!x.resolved).map(x=>x.type).join(', ')}.\n`;
    b += `Only completed delivery at or after the configured term, never contractions or plans: <!-- [BIRTH${suffix}] --> and <!-- [BABY_TRAITS:{"babies":[{"name":"","fatherName":"","personality":[],"appearance":[]}]}] --> with scene facts.\n`;
    b += 'Optional pregnancy status fields: libido, weight_gain, baby_activity, movements, swelling, braxton_hicks, fetal_position, recommendations; use only when relevant to the current term and scene.\n';
    if (!c.fetusSexRevealed) b += `Medical sex reveal: <!-- [SEX_REVEAL${suffix}] -->.\n`;
    if (who === 'user') b += 'Only confirmed loss/completed termination: <!-- [MISCARRIAGE] --> or <!-- [ABORTION] -->; never for a scare, plan, or together with BIRTH.\n';
    return b;
}

export function getPregnancyPrompt() {
    const s = getSettings(), p = getPregnancyData();
    if (!s.isEnabled) return '';
    let b = compactPregnancy('user', s);
    if (p.hasBaby) b += postpartumBlock(p) + birthdayBlock(p) + compactFamily(p);
    return b;
}

function compactFamily(p) {
    let b = '[CHILDREN] Use age-appropriate behaviour and current scene needs.\n';
    for (const [i,c] of (p.babies || []).entries()) {
        const age = babyAgeDays(c,p);
        b += `${c.name||`Baby${i+1}`}: age=${age??'?'} days, health=${c.health||'normal'}, mood=${c.mood||'?'}, sleep=${c.sleep||'?'}, feeding=${c.feedingType||'?'}, diaper=${c.diaperClean===false?'needs changing':'clean'}.\n`;
        if (c.personality?.length) b += `Personality: ${c.personality.join(', ')}. `;
        if (c.appearance?.length) b += `Appearance: ${c.appearance.join(', ')}. `;
        const needs = getCareNeeds(age,p.rpTime,c);
        b += `Care now: ${[needs.feeding,needs.sleep,needs.diaper,needs.careNote].filter(Boolean).join('; ')}.\n`;
        const recent = (c.milestones||[]).slice(-3).map(x=>x.text).filter(Boolean);
        if (recent.length) b += `Already achieved: ${recent.join('; ')}.\n`;
    }
    if (p.grownChildren?.length) b += 'Older children: ' + p.grownChildren.map(c=>`${c.name||'unnamed'} (${babyAgeDays(c,p)??'?'} days)`).join('; ') + '.\n';
    return b;
}

let legacySlotsCleared = false;
export function updatePromptInjection() {
    try {
        if (!legacySlotsCleared) {
            setExtensionPrompt(extensionName + '_sys', '', extension_prompt_types.IN_PROMPT, 0);
            setExtensionPrompt(extensionName + '_scan', '', extension_prompt_types.IN_PROMPT, 0);
            legacySlotsCleared = true;
        }
        const core = getBasePrompt() + getPregnancyPrompt();
        // SillyTavern replaces this registry on clearChat(). A local text cache
        // cannot tell whether our instruction is still installed in the host.
        const installed = extension_prompts[extensionName];
        if (installed?.value === core
            && installed.position === extension_prompt_types.IN_CHAT
            && installed.depth === 0
            && installed.role === extension_prompt_roles.SYSTEM) return;
        setExtensionPrompt(extensionName, core, extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
    } catch (error) {
        reportError('[Reproductive] updatePromptInjection error:', error);
    }
}

// ─── Скрытая беременность: модель знает только симптомы, не факт ───
function knowledgePrompt(s) {
    let b = `Hidden pregnancy: ${s.hiddenPregnancy === false ? 'OFF. No concealment rule applies.' : 'ON; avoid unsupported discoveries.'} Current scene tests/disclosures override missing tracker records; never force ignorance.\n`;
    for (const who of ['user','char']) {
        const c = who === 'char' ? getPartnerData() : getPregnancyData();
        if (isTracked(who) && c.isPregnant) b += `${who}: discovery recorded=${!!c.pregnancyKnown}, test=${c.lastTestResult||'not recorded'}.\n`;
    }
    return b + 'Actual discovery: add "pregnancy_known":true to RP_STATUS (nested in partner for char). Actual test: "test_result":"positive|faint|negative". Missing records do not establish who knows or was told.\n';
}

// ─── Самочувствие носителя: накопленный риск, присутствие партнёра, обязательные события ───
const RISK_SIGNS = {
    presence_strong: ['unease, restlessness, faint nausea easily mistaken for morning sickness, light sleep', 'insomnia, trembling hands, nausea, poor appetite, clinging to the partner\'s scent and belongings', 'fever, refusing food, fainting spells, labor-like cramps'],
    presence_soft: ['low mood, restlessness, seeking attention and closeness', 'withdrawn, tired, poor appetite, tension', 'exhausted, dizzy, cramps'],
    injury: ['localized soreness', 'pain, spotting', 'severe pain and bleeding'],
    stress: ['tension headaches, poor sleep', 'dizziness, palpitations, cramps', 'severe cramps, faintness'],
    neglect: ['vague worry about ignored advice', 'untreated symptoms getting worse', 'acute symptoms needing urgent care'],
    overdue: ['vague worry about missed check-ups', 'untreated symptoms getting worse', 'acute symptoms needing urgent care'],
};
const CAUSE_EN = { presence: 'lack of the partner\'s presence', injury: 'injury', stress: 'stress and overexertion', neglect: 'ignored medical advice', overdue: 'missed check-ups' };

function riskBlock(s, p) {
    const mode = s.consequenceMode || 'mild';
    if (mode === 'off') return '';
    const uni = getUniverse(s);
    const strength = presenceStrength(s, uni);
    let b = '', any = false;
    for (const who of ['user', 'char']) {
        if (!isTracked(who)) continue;
        const c = who === 'char' ? getPartnerData() : p;
        if (!c.isPregnant) continue;
        ensureRiskFields(c);
        any = true;
        const nm = who === 'char' ? '{{char}}' : '{{user}}';
        const stage = c.riskStage || 0;
        const cause = dominantCause(c);
        if (stage >= 1 && cause) {
            const key = cause === 'presence' ? (strength === 'strong' ? 'presence_strong' : 'presence_soft') : cause;
            const sign = (RISK_SIGNS[key] || RISK_SIGNS.stress)[Math.min(stage, 3) - 1];
            b += `${nm}: strain level "${STAGE_NAMES[stage]}" caused by ${CAUSE_EN[cause] || cause}. Show matching signs in the scene: ${sign}. Never state numbers or levels.\n`;
        }
        if (strength !== 'off' && c.presenceState === 'away') b += `${nm}: the partner is away (about ${Math.round(c.awayHours || 0)}h).\n`;
        const ev = c._pendingEvent;
        if (ev && mode !== 'off') {
            if (ev.type === 'preterm_labor') b += `${nm}: REQUIRED EVENT: preterm labor begins in this reply. Narrate it; write the BIRTH tag only when the birth actually happens in the scene.\n`;
            else if (ev.type === 'loss') b += `${nm}: REQUIRED EVENT: the pregnancy is lost. Narrate with care; add <!-- [MISCARRIAGE] --> only once the loss is confirmed in the scene.\n`;
            else b += `${nm}: REQUIRED EVENT: the condition now needs hospital care or strict bed rest; narrate it.\n`;
        }
    }
    if (!any) return '';
    b += 'When the scene shows a partner leaving or arriving add <!-- [PRESENCE:user:away] --> or <!-- [PRESENCE:char:present] --> (the carrier named is the one whose partner moves). For something that actually happened to a pregnant carrier in this reply add <!-- [RISK_EVENT:user:injury:light|medium|heavy] -->, or stress, overwork, neglect (ignored medical advice), care (rest and care). One tag per event, never for plans or hypotheticals.\n';
    return '[WELLBEING]\n' + b;
}

// Два слоя пола: истинный пол (гениталии, роль) и внешний тип XX/XY. Значения уже брошены трекером.
function sexLayerLine(s, c, who, progress, known) {
    const own = normType(who === 'char' ? s.charType : s.userType);
    const other = normType(who === 'char' ? s.userType : s.charType);
    const types = ensureFetusTypes(c, own, other);
    const sexes = (c.fetusSex && c.fetusSex.length) ? c.fetusSex : [];
    let b = 'Sex has two independent layers: true sex (genitals, determines role and anatomy) and appearance type XX (more feminine looking) or XY (more masculine looking); appearance never changes anatomy. ';
    if (!known) return b + 'Neither is known to the characters yet.\\n';
    if (sexKnowable(progress) && sexes.length) b += `True sex can be seen on an ordinary ultrasound now; preset per fetus in order: ${sexes.join(',')} (use exactly these if revealed). `;
    else b += 'True sex cannot be seen yet. ';
    if (typeKnowable(progress)) b += `Appearance type is visible only to an expert examiner now; preset per fetus in order: ${types.join(',')}.`;
    else b += 'Appearance type cannot be determined before late term or birth; at birth state both layers.';
    return b + '\\n';
}

// Омегаверс: беременность, запах, гнездование, железы, теневые течки, метки, роды.
function omegaBlock(s, p) {
    if (getUniverse(s).id !== 'omegaverse' || (s.consequenceMode || 'mild') === 'off') return '';
    const duration = s.pregnancyDuration || 40;
    const lines = [];
    for (const who of ['user', 'char']) {
        if (!isTracked(who)) continue;
        const c = who === 'char' ? getPartnerData() : p;
        if (!c.isPregnant) continue;
        ensureRiskFields(c);
        const nm = who === 'char' ? '{{char}}' : '{{user}}';
        const { weeks } = calculateWeeksFromDates(c.conceptionDate, p.rpDate, c.pregnancyWeeks);
        const pr = Math.max(0, Math.min(1, weeks / duration));
        const nowMs = p.rpDate ? Date.parse(p.rpDate) : 0;
        const parts = [];
        parts.push(pr < 1 / 3 ? 'scent shifts sharper and anxious (modify the existing base scent, never replace it)'
            : pr < 2 / 3 ? 'scent deepens and sweetens (modify the existing base scent)' : 'scent is heady and almost impossible to hide (modify the existing base scent)');
        if (pr >= 0.12) parts.push(`nesting urge ${pr < 0.4 ? 'mild' : pr < 0.75 ? 'strong' : 'all-consuming'}: gathers the partner's scented items, guards the nest, upset when it is disturbed${pr >= 0.75 ? ', rarely leaves home' : ''}`);
        if (pr >= 1 / 3) parts.push('scent glands at neck and wrists swell and leak; the partner\'s touch there soothes');
        if (pr >= 0.85) parts.push('pre-milk leaks when the partner is near or in strong emotion');
        if ((c._shadowUntil || 0) > nowMs) parts.push('SHADOW HEAT NOW: clingy, aroused, needs the partner\'s scent and touch for relief; the partner being away makes it hard');
        if (c.markedBy) {
            const father = (c.fatherName || (who === 'user' ? carrierName('char') : carrierName('user'))).trim().toLowerCase();
            if (father !== String(c.markedBy).trim().toLowerCase()) {
                const burn = c._markBurn || 0;
                if (burn < 1 / 3) parts.push(`the old mark from ${c.markedBy} burns and itches as the child's pheromones push it out`);
                else if (burn < 2 / 3) parts.push(`the old mark from ${c.markedBy} is visibly closing without a scar, pain dulling and retreating from the glands`);
                else if (burn < 0.9) parts.push(`the old mark from ${c.markedBy} is almost gone`);
            }
        }
        if (pr >= 0.9) parts.push(`labor: the partner's presence shortens it and calms contractions, absence makes it longer and harder${c.presenceState === 'away' ? ' (the partner is away now)' : ''}`);
        lines.push(`${nm}: ${parts.join('; ')}.`);
    }
    return lines.length ? '[OMEGAVERSE PREGNANCY] Show only what the scene supports.\n' + lines.join('\n') + '\n' : '';
}

// ─── Режим «планируем» + сложности с зачатием ───
function tryingBlock(s, p) {
    if (!s.tryingToConceive || p.isPregnant) return '';
    const w = fertileInfo(s, getPregnancyData(), getCycleDay());
    const months = monthsTrying(p);
    const struggle = conceptionStruggle(months);

    let b = `\n[TRYING TO CONCEIVE]\n`;
    b += `{{user}} and her partner are actively trying for a baby. `;
    b += w.fertile
        ? `RIGHT NOW is her fertile window${w.peak ? ' — ovulation peak, the best possible timing' : ''}. She knows it and may initiate.\n`
        : `Not a fertile day — her next fertile window is in about ${w.daysToPeak} day(s).\n`;
    if (months > 0) b += `They have been trying for ${months} month(s).\n`;
    if (struggle) {
        b += `${struggle.label}. This weighs on her — play the quiet strain: hope each cycle, disappointment when her period comes, tension between the partners, thoughts about seeing a doctor.\n`;
    }
    return b;
}

// ─── Послеродовое восстановление ───
function postpartumBlock(p) {
    const pp = getPostpartum(p, p);
    if (!pp) return '';
    let b = `\n[POSTPARTUM — ${pp.days} days since birth]\n`;
    if (pp.healing) b += `Recovery: ${pp.healing}. `;
    if (pp.lochia) b += `Bleeding (lochia) still present. `;
    b += pp.lactating ? `She is breastfeeding: engorgement, leaking, night feeds, milk letdown when the baby cries.` : `She is not breastfeeding.`;
    b += `\n`;
    b += pp.cycleReturned
        ? `Her cycle has returned — she can conceive again.\n`
        : `Her cycle has NOT returned yet${pp.lactating ? ' (lactational amenorrhea)' : ''} — conception is very unlikely for now.\n`;
    if (pp.days < 42) b += `Sex is still physically uncomfortable or off the table; she tires fast and may feel touched-out.\n`;
    return b;
}

// ─── Дни рождения детей по RP-дате ───
function birthdayBlock(p) {
    if (!p.rpDate || !Array.isArray(p.babies)) return '';
    const now = new Date(p.rpDate);
    if (isNaN(now.getTime())) return '';
    const lines = [];
    const all = [...(p.babies || []), ...(p.grownChildren || [])];
    for (const k of all) {
        if (!k.birthRpDate) continue;
        const b = new Date(k.birthRpDate);
        if (isNaN(b.getTime())) continue;
        const years = now.getFullYear() - b.getFullYear();
        if (years < 1) continue;
        const sameDay = now.getDate() === b.getDate() && now.getMonth() === b.getMonth();
        if (sameDay) {
            lines.push(`TODAY is ${k.name || 'the child'}'s birthday — turning ${years}. The family would celebrate.`);
            continue;
        }
        const next = new Date(now.getFullYear(), b.getMonth(), b.getDate());
        if (next < now) next.setFullYear(now.getFullYear() + 1);
        const days = Math.round((next - now) / 86400000);
        if (days > 0 && days <= 3) {
            lines.push(`${k.name || 'A child'}'s birthday is in ${days} day(s) — turning ${years + (next.getFullYear() > now.getFullYear() ? 1 : 0)}.`);
        }
    }
    return lines.length ? `\n[BIRTHDAYS]\n${lines.join('\n')}\n` : '';
}

// Baseline scene continuity applies even when optional hygiene realism is off.
function cycleScenePrompt(s) {
    let b = '';
    for (const who of ['user','char']) {
        if (!isTracked(who) || !hasCycle(s, who)) continue;
        const c = who === 'char' ? getPartnerData() : getPregnancyData();
        const pp = getPostpartum(c,getPregnancyData());
        if (c.isPregnant || (pp && !pp.cycleReturned)) continue;
        const d = who === 'char' ? c.cycleDay || 1 : getCycleDay();
        const uni = getUniverse(s);
        if (uni.kind === 'menstrual' && d <= 5 && canCarry(s, who) && s.menstruationEnabled !== false) b += `${who}: active MENSTRUATION. Account for observable blood/hygiene/discomfort during intimacy; react naturally, check comfort without deciding for the player. No telepathic knowledge away from observable signs.\n`;
        else if (uni.kind === 'phased' && phaseAt(c, uni, d).def.active && (uni.id === 'beastmen' || designationOf(s,who) !== 'beta')) {
            if (uni.id === 'beastmen') b += `${who}: mating season now; heightened need for closeness with their human, behaviour follows their species (cat types clingy and selective, dog types overexcited with lowered inhibitions; wild individuals more intense); reflect scene-supported signs, no forced actions.\n`;
            else b += `${who}: ${designationOf(s,who) === 'alpha' ? (uni.id === 'ds' ? 'hunt' : 'rut') : 'heat'} now; reflect scene-supported signs, no forced actions.\n`;
        }
        else b += `${who}: no active heat or menstruation.\n`;
    }
    return b ? b + 'Keep narration and status consistent with this phase and current scene.\n' : '';
}
