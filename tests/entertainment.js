'use strict';

const assert = require('assert');
const E = require('../utils/entertainment.js');
const G = require('../utils/game-engine.js');
const D = require('../utils/game-data.js');

function ok(msg) { console.log('OK  ' + msg); }

// 校验筹码守恒：玩家 tokens 总和 + bank == 开局常量（每种颜色）
function bankPlusPlayers(state) {
  const out = {};
  D.ALL_TOKENS.forEach(function (g) {
    out[g] = state.bank[g];
    state.players.forEach(function (p) { out[g] += p.tokens[g]; });
  });
  return out;
}
function assertConserved(state, before, label) {
  const after = bankPlusPlayers(state);
  D.ALL_TOKENS.forEach(function (g) {
    assert.equal(after[g], before[g], label + ' · ' + g + ' 筹码守恒');
  });
}

/* ---------- 1. 增益定义与模式开关 ---------- */
{
  assert.equal(E.BUFFS.length, 3, '三个开局增益');
  assert.equal(E.SKILLS.length, 2, '两个主动技能');
  const s = G.createGame(2, D.mulberry32(1));
  assert.equal(E.isEntertainment(s), false, '标准局默认非娱乐模式');
  E.enable(s);
  assert.equal(E.isEntertainment(s), true, 'enable 后进入娱乐模式');
  E.enable(s);
  assert.deepEqual(s.entertainment.buffs, {}, '重复 enable 幂等');
  ok('模式开关 · 幂等 / 定义完整');
}

/* ---------- 2. 三种 buff 的效果与守恒 ---------- */
['rich', 'starter', 'goldrush'].forEach(function (buffId) {
  const s = G.createGame(4, D.mulberry32(7));
  E.enable(s);
  const before = bankPlusPlayers(s);
  const r = E.applyBuff(s, 0, buffId, D.mulberry32(99));
  assert.equal(r.ok, true, buffId + ' 施加成功');
  assert.equal(s.entertainment.buffs[0], buffId, buffId + ' 记录到席位');
  assertConserved(s, before, buffId);
  // 起手筹码不得超过 10
  assert(E.tokenTotal(s.players[0]) <= 10, buffId + ' 起手不超过 10 枚');
});
{
  // starter 必须真的加一张一级卡和对应声望
  const s = G.createGame(2, D.mulberry32(3));
  E.enable(s);
  const deckLen = s.decks[0].length, pts = s.players[0].points;
  E.applyBuff(s, 0, 'starter', Math.random);
  assert.equal(s.players[0].cards.length, 1, '起步获得 1 张卡');
  assert.equal(s.decks[0].length, deckLen - 1, '卡从一级牌堆扣除');
  assert(s.players[0].points > pts || s.players[0].cards[0].points === 0, '声望相应增加');
}
{
  // 富矿：银行不足时不超发
  const s = G.createGame(2, D.mulberry32(5));
  E.enable(s);
  D.GEMS.forEach(function (g) { s.bank[g] = 0; });
  const r = E.applyBuff(s, 0, 'rich', Math.random);
  assert.equal(r.ok, true, '银行空时富矿也返回成功');
  assert(E.tokenTotal(s.players[0]) === 0, '银行空时不超发筹码');
}
ok('开局增益 · 三效果 / 守恒 / 起手上限 / 缺货降级');

/* ---------- 3. buff 幂等与独占 ---------- */
{
  const s = G.createGame(2, D.mulberry32(11));
  E.enable(s);
  const before = bankPlusPlayers(s);
  E.applyBuff(s, 0, 'goldrush', Math.random);
  const r2 = E.applyBuff(s, 0, 'goldrush', Math.random);
  assert.equal(r2.ok, true, '重复选同一 buff 视为幂等');
  assert.equal(r2.repeat, true, '标记为重复');
  assertConserved(s, before, '重复施加');
  assert.equal(s.players[0].tokens.gold, 1, '黄金只加了一次');
  const r3 = E.applyBuff(s, 0, 'rich', Math.random);
  assert.equal(r3.ok, false, '一个席位不能同时拥有两个 buff');
}
ok('增益幂等 · 重复不叠加 / 互斥');

/* ---------- 4. 窃取：转移守恒 / 黄金不可偷 / 次数上限 ---------- */
{
  const s = G.createGame(2, D.mulberry32(13));
  E.enable(s);
  s.players[1].tokens.red = 3;
  const before = bankPlusPlayers(s);
  const red0 = s.players[0].tokens.red, red1 = s.players[1].tokens.red;
  const r = E.applySkill(s, 0, 'steal', 1, D.mulberry32(1));
  assert.equal(r.ok, true, '窃取成功');
  assert.equal(s.players[0].tokens.red + s.players[1].tokens.red, red0 + red1, '两人红筹总数不变');
  assertConserved(s, before, '窃取');
  assert.equal(E.usedOf(s, 0, 'steal'), 1, '记录使用次数');
}
{
  const s = G.createGame(2, D.mulberry32(17));
  E.enable(s);
  s.players[1].tokens.white = 0; s.players[1].tokens.gold = 2;
  const r = E.applySkill(s, 0, 'steal', 1, Math.random);
  assert.equal(r.ok, false, '对手只有黄金时无法窃取');
  assert.equal(E.usedOf(s, 0, 'steal'), 0, '失败不扣次数');
}
{
  // 满 10 枚时拒绝窃取，避免 endTurn 带 11 枚破坏守恒
  const s = G.createGame(2, D.mulberry32(18));
  E.enable(s);
  D.GEMS.forEach(function (g) { s.players[0].tokens[g] = 2; }); // 10 枚
  s.players[1].tokens.red = 3;
  const r = G.performAction(s, { type: 'skill', skillId: 'steal', target: 1, rand: Math.random });
  assert.equal(r.ok, false, '满 10 枚时引擎拒绝窃取');
  assert.equal(s.players[0].tokens.red, 2, '未发生改变');
}
{
  const s = G.createGame(2, D.mulberry32(19));
  E.enable(s);
  s.players[1].tokens.blue = 9;
  for (let i = 0; i < E.maxUses('steal'); i++) {
    assert.equal(E.applySkill(s, 0, 'steal', 1, Math.random).ok, true, '第 ' + (i + 1) + ' 次窃取成功');
  }
  const r = E.applySkill(s, 0, 'steal', 1, Math.random);
  assert.equal(r.ok, false, '超过次数上限被拒');
  assert.equal(E.skillVM(s, 0).find(function (x) { return x.id === 'steal'; }).usable, false, 'VM 标记不可用');
}
ok('窃取 · 守恒 / 仅普通色 / 次数上限 / 失败不扣');

/* ---------- 5. 侦察只读 / 非法目标 / 待处理门禁 ---------- */
{
  const s = G.createGame(3, D.mulberry32(23));
  E.enable(s);
  s.players[2].reserved.push({ name: '测试卡' });
  const before = bankPlusPlayers(s);
  const r = E.applySkill(s, 0, 'scout', 2, Math.random);
  assert.equal(r.ok, true, '侦察成功');
  assert.deepEqual(r.info.names, ['测试卡'], '返回预留卡名称');
  assertConserved(s, before, '侦察');
  assert.equal(s.players[2].reserved.length, 1, '侦察不改动对手手牌');
  assert.equal(E.applySkill(s, 0, 'scout', 0, Math.random).ok, false, '不能侦察自己');
  assert.equal(E.applySkill(s, 0, 'scout', 99, Math.random).ok, false, '越界目标被拒');
}
{
  const s = G.createGame(2, D.mulberry32(29));
  E.enable(s);
  s.pendingDiscard = 1;
  assert.equal(E.canUseSkill(s, 0, 'steal').ok, false, '有待退筹码时禁止用技能');
  s.pendingDiscard = 0; s.pendingNoble = { seat: 0, options: [] };
  assert.equal(E.canUseSkill(s, 0, 'steal').ok, false, '待选贵族时禁止用技能');
}
ok('侦察与门禁 · 只读 / 目标校验 / 待处理阻塞');

/* ---------- 6. 技能走引擎 endTurn 消耗整回合 ---------- */
{
  // 模拟页面接入：applySkill 改数据 -> E.performAction({type:'pass'}) 结束回合
  // （真实接入里 pass 会换成 skill 分支，这里验证「技能+结束回合」的组合语义）
  const s = G.createGame(2, D.mulberry32(31));
  E.enable(s);
  s.players[1].tokens.green = 5;
  const cur = s.current, turn = s.turnCount;
  E.applySkill(s, cur, 'steal', 1 - cur, Math.random);
  const r = G.performAction(s, { type: 'pass' });
  assert.equal(r.ended, true, '技能后 pass 正常结束回合');
  assert.equal(s.current, 1 - cur, '回合切换到对手');
  assert.equal(s.turnCount, turn + 1, '回合数 +1');
}
{
  // 直接走引擎 {type:'skill'} 分支：一步完成「改数据 + 结束回合」
  const s = G.createGame(2, D.mulberry32(37));
  E.enable(s);
  s.players[1].tokens.green = 6;
  const cur = s.current, turn = s.turnCount;
  const before = bankPlusPlayers(s);
  const r = G.performAction(s, { type: 'skill', skillId: 'steal', target: 1 - cur, rand: D.mulberry32(2) });
  assert.equal(r.ok, true, '引擎 skill 分支执行成功');
  assert.equal(r.ended, true, '技能直接结束回合');
  assert.equal(s.current, 1 - cur, '技能后切换到对手');
  assert.equal(s.turnCount, turn + 1, '技能消耗一个回合');
  assert.equal(E.usedOf(s, cur, 'steal'), 1, '引擎分支内扣了次数');
  assertConserved(s, before, '引擎 skill 分支');
  // 标准局不认识娱乐技能
  const std = G.createGame(2, D.mulberry32(41));
  const r2 = G.performAction(std, { type: 'skill', skillId: 'steal', target: 1 });
  assert.equal(r2.ok, false, '标准局拒绝 skill');
}
ok('回合语义 · 技能消耗整回合 / 引擎分支 / 正常切换');

/* ---------- 7. 随机娱乐对战 60 局：引擎不崩、守恒、可终局 ---------- */
{
  let finished = 0;
  for (let seed = 0; seed < 60; seed++) {
    const rand = D.mulberry32(1000 + seed);
    const s = G.createGame(4, rand);
    E.enable(s);
    const before = bankPlusPlayers(s);
    // 每席随机选一个 buff
    s.players.forEach(function (_, i) {
      const b = E.BUFFS[randIndex(rand, E.BUFFS.length)].id;
      E.applyBuff(s, i, b, rand);
    });
    // 跑完整局：AI 决策 + 偶尔插技能（技能后按规则 pass 结束回合）
    let guard = 0;
    while (!s.gameOver && guard++ < 5000) {
      if (s.pendingDiscard > 0) { G.performAction(s, { type: 'discard', gems: pickDiscard(s) }); continue; }
      if (s.pendingNoble) { G.performAction(s, { type: 'chooseNoble', id: s.pendingNoble.options[0] }); continue; }
      if (E.canUseSkill(s, s.current, 'steal').ok && rand() < 0.03) {
        const foes = E.targetVM(s, s.current).filter(function (t) { return t.selectable; });
        if (foes.length) {
          const sk = E.applySkill(s, s.current, 'steal', foes[randIndex(rand, foes.length)].seat, rand);
          if (sk.ok) { G.performAction(s, { type: 'pass' }); continue; }
        }
      }
      const act = require('../utils/ai.js').chooseAction(s);
      if (act.type === 'discard' && (!act.gems || !act.gems.length)) { G.performAction(s, { type: 'pass' }); }
      else G.performAction(s, act);
    }
    assert(s.gameOver, '第 ' + seed + ' 局可正常终局');
    assertConserved(s, before, '第 ' + seed + ' 局终局');
    finished++;
  }
  assert.equal(finished, 60, '60 局全部终局');
}
function randIndex(rand, n) { return Math.floor(rand() * n) % n; }
function pickDiscard(s) {
  const p = s.players[s.current], gems = [];
  for (let i = 0; i < p.tokens.gold && gems.length < s.pendingDiscard; i++) gems.push('gold');
  D.GEMS.forEach(function (g) {
    for (let i = 0; i < p.tokens[g] && gems.length < s.pendingDiscard; i++) gems.push(g);
  });
  return gems.slice(0, s.pendingDiscard);
}
ok('随机对战 · 60 局终局 / 全程筹码守恒');

console.log('ALL ENTERTAINMENT TESTS PASS');
