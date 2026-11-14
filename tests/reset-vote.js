'use strict';

/** 重开投票纯数据层专项：票权、发起门禁、同意/否决、换局失效 */
const assert = require('assert');
const ROOT = require('path').resolve(__dirname, '..');
const V = require(ROOT + '/utils/reset-vote.js');

function state(players, gid) {
  return { gameId: gid || 'g1', players: players, startSeat: 0, current: 0, turnCount: 0 };
}
function human(uid, extra) {
  return Object.assign({
    uid: uid, name: uid, nickname: uid,
    isAI: false, joined: true, autoPlay: false, type: 'remote'
  }, extra || {});
}
function bot() {
  return { uid: '', name: '机器人', isAI: true, joined: true, autoPlay: false, type: 'bot' };
}
function room3() {
  return state([human('host'), human('a'), human('b')]);
}

/* ---------- 票权：只有「在场真人」 ---------- */
{
  const s = state([
    human('host'), human('a'), bot(),
    human('b', { autoPlay: true }),   // 主动托管：人不在，投不了
    human('c', { joined: false })     // 空席
  ]);
  const voters = V.votersOf(s);
  assert.deepStrictEqual(voters.map(function (v) { return v.uid; }), ['host', 'a'],
    '只统计在场真人，排除机器人 / 托管 / 空席');
  assert(voters[0].seat === 0 && voters[1].seat === 1, '保留席位索引供展示层换算号位');
  assert(V.isVoter(s, 'a') === true, '在场真人有票权');
  assert(V.isVoter(s, 'b') === false && V.isVoter(s, 'c') === false, '托管 / 空席无票权');
  assert(V.isVoter(s, '') === false, '空 uid 无票权');
}

/* ---------- 发起：房主自动赞成、门禁、单人局直接通过 ---------- */
{
  const s = room3();
  const v = V.newVote(s, { byUid: 'host', byName: '房主', id: 'v1', now: 1000 });
  assert(v && v.status === 'open', '三人局发起后等其余真人附议');
  assert(v.votes.host === true, '发起即自动算一张赞成票');
  assert(v.gameId === 'g1' && v.id === 'v1' && v.bySeat === 0 && v.byName === '房主',
    '投票绑定本局、发起人席位与展示名');
  assert(V.tally(v, V.votersOf(s)).agreed === 1, '初始票数 1');
  assert(V.newVote(s, { byUid: 'nobody' }) === null, '发起人不在票权名单里时不生成投票');

  assert(V.canStart(null, false) === false, '非房主不能发起');
  assert(V.canStart(null, true) === true, '房主可发起');
  assert(V.canStart(v, true) === false, '进行中的投票不能重复发起');
  v.status = 'rejected';
  assert(V.canStart(v, true) === true, '被否决后房主可重新发起');
}
{
  const s = state([human('host'), bot()]);
  const v = V.newVote(s, { byUid: 'host', now: 1 });
  assert(v.status === 'passed', '无其余真人时发起即通过（空集视为一致同意）');
}

/* ---------- 投票：全员同意 / 任一否决 / 重复与越界 ---------- */
{
  const s = room3();
  const v = V.newVote(s, { byUid: 'host', now: 1 });
  assert(V.cast(v, s, 'a', '甲', true) === true, '同意生效');
  assert(v.status === 'open', '仍有人未投时保持 open');
  assert(V.cast(v, s, 'a', '甲', true) === false, '同一人重复投票不改动状态');
  assert(V.cast(v, s, 'nobody', 'X', true) === false, '名单外的人不能投票');
  assert(V.cast(v, s, '', 'X', true) === false, '空 uid 不能投票');
  assert(V.cast(v, s, 'b', '乙', true) === true, '最后一票生效');
  assert(v.status === 'passed', '其余真人全部同意 → passed');
  const t = V.tally(v, V.votersOf(s));
  assert(t.total === 3 && t.agreed === 3 && t.pending === 0 && t.allAgreed === true,
    '统计与全同意判定一致');
  assert(V.cast(v, s, 'b', '乙', false) === false, '已结束的投票不再接受改动');
}
{
  const s = room3();
  const v = V.newVote(s, { byUid: 'host', now: 1 });
  assert(V.cast(v, s, 'a', '甲', false) === true, '不同意生效');
  assert(v.status === 'rejected' && v.rejectedBy === '甲',
    '任一真人不同意立即否决，并记录否决者供展示');
  assert(V.cast(v, s, 'b', '乙', true) === false, '否决后不能再投同意票');
}

/* ---------- 换局失效：gameId 是投票的生命周期边界 ---------- */
{
  const v = V.newVote(room3(), { byUid: 'host', now: 1, id: 'old' });
  assert(V.isCurrent(v, state([human('host')], 'g1')) === true, '同局投票有效');
  assert(V.isCurrent(v, state([human('host')], 'g2')) === false, '换局后旧投票失效');
  assert(V.isCurrent(null, room3()) === false, '无投票时返回 false');
  const legacy = V.newVote(state([human('host'), human('a')], ''), { byUid: 'host', now: 1 });
  assert(V.isCurrent(legacy, room3()) === true, '老快照没有 gameId 时按「仍在 state 上」放行');
}

console.log('ALL RESET VOTE CHECKS PASSED');
