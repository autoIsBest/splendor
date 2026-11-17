'use strict';

/**
 * 娱乐模式数据层（纯 JS，无 wx / 无网络依赖，可 Node 自测）
 * ------------------------------------------------------------------
 * 设计边界（很重要，改动前先读）：
 * 1. 本模块只负责「娱乐模式专属的初始加成与主动技能」的数据与校验，
 *    不碰标准规则，也不直接改回合流程 —— 技能执行后由调用方走引擎的
 *    endTurn 结束整个回合（用户明确选择：技能消耗整回合）。
 * 2. 所有对 state 的修改都就地完成，与 game-engine 的约定一致；
 *    筹码守恒遵循同一铁律：玩家 tokens 的增量 == 银行 bank 的减量，
 *     「窃取」是玩家之间转移，银行不动，总量守恒。
 * 3. buff 开局一次性施加，之后不再生效；技能每席每局有次数上限，
 *    计数写在 state.entertainment.used[seat][skillId]，随快照全端同步。
 * 4. 所有随机都走注入的 rand（默认 Math.random），便于测试复现。
 */

const D = require('./game-data.js');
const GEMS = D.GEMS;          // 5 种普通色，不含黄金
const ALL_TOKENS = D.ALL_TOKENS;

/** 开局可选 buff（每人 1 个）。effect 由 applyBuff 按 id 分派。 */
const BUFFS = [
  { id: 'rich', name: '富矿', icon: '💰', desc: '开局额外获得 2 枚随机普通筹码' },
  { id: 'starter', name: '起步', icon: '🃏', desc: '开局免费获得 1 张一级发展卡（含声望与折扣）' },
  { id: 'goldrush', name: '黄金运', icon: '🏆', desc: '开局额外获得 1 枚黄金筹码' }
];

/** 主动技能。每次使用消耗整个回合，次数按局计。 */
const SKILLS = [
  { id: 'steal', name: '窃取', icon: '🖐️', desc: '从一名对手手中夺取 1 枚普通筹码（不消耗银行）', uses: 2 },
  { id: 'scout', name: '侦察', icon: '🔭', desc: '查看一名对手的预留手牌，不改动任何筹码', uses: 2 }
];

const MODE_KEY = 'entertainment';

function byId(list, id) {
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function isEntertainment(state) {
  return !!(state && state.mode === MODE_KEY);
}

/** 在 state 上初始化娱乐模式字段（幂等，老快照缺字段时能补）。 */
function ensureState(state) {
  if (!state) return state;
  if (state.mode !== MODE_KEY) state.mode = MODE_KEY;
  if (!state.entertainment || typeof state.entertainment !== 'object') {
    state.entertainment = {};
  }
  if (!state.entertainment.buffs || typeof state.entertainment.buffs !== 'object') {
    state.entertainment.buffs = {};
  }
  if (!state.entertainment.used || typeof state.entertainment.used !== 'object') {
    state.entertainment.used = {};
  }
  return state;
}

/** 把标准对局切换成娱乐模式；不清空既有 players / bank。 */
function enable(state) {
  return ensureState(state);
}

function randIndex(rand, n) {
  const r = (typeof rand === 'function' ? rand : Math.random)();
  const i = Math.floor(Number(r) * n);
  return (i >= 0 && i < n) ? i : 0;
}

/**
 * 开局施加 buff。返回 {ok, error, detail}。
 * 只改资源与牌，不改 current / turnCount / bank 之外的一切。
 */
function applyBuff(state, seat, buffId, rand) {
  if (!isEntertainment(state)) return { ok: false, error: '当前不是娱乐模式' };
  const p = state.players && state.players[seat];
  if (!p) return { ok: false, error: '无效的席位' };
  const buff = byId(BUFFS, buffId);
  if (!buff) return { ok: false, error: '无效的增益' };
  const ent = ensureState(state).entertainment;
  // 幂等：同一席位重复施加同一 buff 不再发资源，避免轮询/重入重复加成
  if (ent.buffs[seat] === buffId) return { ok: true, detail: '已拥有该增益', repeat: true };
  // 一个席位只能有一个 buff；换 buff 前先回滚旧的（保证存档重开一致）
  if (ent.buffs[seat]) return { ok: false, error: '该席位已选择增益' };

  let detail = '';
  if (buffId === 'rich') {
    // 从银行拿 2 枚普通筹码：只从有余量的颜色里随机，且不超过玩家 10 枚上限
    const room = 10 - tokenTotal(p);
    let n = Math.min(2, room);
    for (let k = 0; k < n; k++) {
      const avail = GEMS.filter(function (g) { return state.bank[g] > 0; });
      if (!avail.length) break;
      const g = avail[randIndex(rand, avail.length)];
      state.bank[g] -= 1;
      p.tokens[g] += 1;
    }
    detail = '获得 ' + n + ' 枚随机筹码';
  } else if (buffId === 'starter') {
    if (!state.decks || !state.decks[0] || !state.decks[0].length) {
      return { ok: false, error: '一级牌库已空，无法获得起始卡' };
    }
    const card = state.decks[0].pop();
    p.cards.push(card);
    p.points += card.points;              // 声望即时计入（开局无贵族，直接加即可）
    detail = '获得发展卡「' + card.name + '」';
  } else if (buffId === 'goldrush') {
    if (state.bank.gold <= 0) return { ok: false, error: '黄金已无剩余' };
    state.bank.gold -= 1;
    p.tokens.gold += 1;
    detail = '获得 1 枚黄金';
  }

  ent.buffs[seat] = buffId;
  return { ok: true, detail: detail };
}

function tokenTotal(player) {
  let t = 0;
  for (let i = 0; i < ALL_TOKENS.length; i++) t += player.tokens[ALL_TOKENS[i]] || 0;
  return t;
}

function usedOf(state, seat, skillId) {
  const ent = state && state.entertainment;
  if (!ent || !ent.used || !ent.used[seat]) return 0;
  return Number(ent.used[seat][skillId]) || 0;
}

function maxUses(skillId) {
  const s = byId(SKILLS, skillId);
  return s ? s.uses : 0;
}

/** 技能是否可用（只校验次数与基本前提，目标合法性由 applySkill 校验）。 */
function canUseSkill(state, seat, skillId) {
  if (!isEntertainment(state) || state.gameOver) return { ok: false, error: '当前不可使用技能' };
  const skill = byId(SKILLS, skillId);
  if (!skill) return { ok: false, error: '无效的技能' };
  const p = state.players && state.players[seat];
  if (!p) return { ok: false, error: '无效的席位' };
  if (state.pendingDiscard > 0 || state.pendingNoble) {
    return { ok: false, error: '请先完成当前待处理事项' };
  }
  if (usedOf(state, seat, skillId) >= maxUses(skillId)) {
    return { ok: false, error: '该技能本局次数已用完' };
  }
  return { ok: true };
}

/**
 * 执行主动技能（只改数据，不结束回合 —— 结束回合由引擎调用方负责）。
 * 返回 { ok, error, message, info, endedByCaller }
 */
function applySkill(state, seat, skillId, targetSeat, rand) {
  const chk = canUseSkill(state, seat, skillId);
  if (!chk.ok) return chk;
  const me = state.players[seat];
  const target = state.players[targetSeat];
  if (!target || targetSeat === seat || !target.joined) {
    return { ok: false, error: '请选择一名有效的对手' };
  }

  let info = null;
  if (skillId === 'steal') {
    // 回合结束筹码不得超过 10：窃取让自己 +1，若已满 10 枚则拒绝，
    // 否则技能后 endTurn 会带着 11 枚破坏守恒铁律，还得额外走退还流程。
    if (tokenTotal(me) >= 10) return { ok: false, error: '你已有 10 枚筹码，无法再窃取' };
    // 只偷普通色，黄金不可偷；无普通筹码则失败且不扣次数
    const avail = GEMS.filter(function (g) { return (target.tokens[g] || 0) > 0; });
    if (!avail.length) return { ok: false, error: '该对手没有可窃取的普通筹码' };
    const g = avail[randIndex(rand, avail.length)];
    target.tokens[g] -= 1;
    me.tokens[g] += 1;
    info = { gem: g };
  } else if (skillId === 'scout') {
    // 侦察只读不改，返回对手预留卡的名称列表供 UI 展示
    const names = [];
    for (let i = 0; i < target.reserved.length; i++) {
      names.push(target.reserved[i].name || '发展卡');
    }
    info = { names: names };
  }

  if (!state.entertainment.used[seat]) state.entertainment.used[seat] = {};
  state.entertainment.used[seat][skillId] = usedOf(state, seat, skillId) + 1;
  const skill = byId(SKILLS, skillId);
  let message = me.name + ' 使用「' + skill.name + '」';
  if (skillId === 'steal') message += ' · 从 ' + target.name + ' 处夺得 1 枚' + gemName(info.gem);
  else message += ' · 侦察 ' + target.name + ' 的预留手牌';

  return { ok: true, message: message, info: info, endedByCaller: true };
}

const GEM_CN = { white: '白', blue: '蓝', green: '绿', red: '红', black: '黑', gold: '黄金' };
function gemName(g) { return GEM_CN[g] || g; }

/** 生成给 UI 用的技能列表（含剩余次数与可用性）。 */
function skillVM(state, seat) {
  return SKILLS.map(function (s) {
    const left = maxUses(s.id) - usedOf(state, seat, s.id);
    const chk = canUseSkill(state, seat, s.id);
    return {
      id: s.id, name: s.name, icon: s.icon, desc: s.desc,
      left: Math.max(0, left), usable: left > 0 && chk.ok
    };
  });
}

/** 生成可选目标列表（真人与机器人皆可作为窃取/侦察对象）。 */
function targetVM(state, seat) {
  if (!state || !state.players) return [];
  return state.players.map(function (p, i) {
    return {
      seat: i,
      name: p.name,
      isSelf: i === seat,
      joined: !!p.joined,
      selectable: i !== seat && !!p.joined
    };
  });
}

module.exports = {
  MODE_KEY: MODE_KEY,
  BUFFS: BUFFS,
  SKILLS: SKILLS,
  isEntertainment: isEntertainment,
  enable: enable,
  ensureState: ensureState,
  applyBuff: applyBuff,
  canUseSkill: canUseSkill,
  applySkill: applySkill,
  skillVM: skillVM,
  targetVM: targetVM,
  usedOf: usedOf,
  maxUses: maxUses,
  tokenTotal: tokenTotal
};
