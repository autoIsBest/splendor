'use strict';

/**
 * 联机对局的「重开投票」——纯数据层，零依赖。
 *
 * 为什么放在牌局快照里（state.resetVote）而不是房间表：
 *   对局中各设备只轮询 splendor_games 快照（1.6s），房间行只在 lobby 态
 *   轮询。投票状态随快照走才能被所有端看见，且复用 pushCloudState 的
 *   CAS 写入，零表结构变更 —— 与 state.gameId / state.startSeat 同一套做法。
 *   performAction 是原地改 state 的既有字段，不会抹掉这个附加字段。
 *
 * 产品规则（与用户确认）：
 *   · 仅房主可发起，发起即自动算一张赞成票
 *   · 其余「在场真人」全部同意才通过；任一不同意立即否决，房主可重新发起
 *   · 机器人 / 空席 / 主动托管（人不在，投不了）不计票、也不需要投票
 *   · 投票绑定 gameId，换局后旧投票自然失效
 *   · 通过后由房主执行 backToLobby，所有人回大厅重新准备
 *
 * 这个模块只管数据，不碰 UI、不碰 uid 展示：昵称过滤与号位换算由页面层
 * 的 displayName / E.seatNoOf 统一处理，避免出现第二个展示口径。
 */

/** 可投票席位：在场真人，排除机器人 / 空席 / 主动托管。按席位顺序返回。 */
function votersOf(state) {
  const players = (state && state.players) || [];
  const out = [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p || p.isAI || p.autoPlay || p.joined === false || !p.uid) continue;
    out.push({ uid: String(p.uid), seat: i });
  }
  return out;
}

/** 本机是否属于可投票席位 */
function isVoter(state, uid) {
  const key = String(uid || '');
  if (!key) return false;
  return votersOf(state).some(function (v) { return v.uid === key; });
}

/** 统计票数。pending 包含「尚未投票」与「名单里查无此人」两种，UI 都显示等待。 */
function tally(vote, voters) {
  const list = voters || [];
  const votes = (vote && vote.votes) || {};
  let agreed = 0;
  let rejected = 0;
  let pending = 0;
  for (let i = 0; i < list.length; i++) {
    const val = votes[list[i].uid];
    if (val === true) agreed++;
    else if (val === false) rejected++;
    else pending++;
  }
  return {
    total: list.length,
    agreed: agreed,
    rejected: rejected,
    pending: pending,
    allAgreed: list.length > 0 && agreed === list.length
  };
}

/**
 * 房主发起一次投票。发起人不在可投票名单里时返回 null（例如非房主、
 * 或房主自己开了托管）。只有房主一个真人时无人需要附议，直接标记通过。
 */
function newVote(state, opts) {
  const o = opts || {};
  const byUid = String(o.byUid || '');
  const voters = votersOf(state);
  const me = voters.filter(function (v) { return v.uid === byUid; })[0];
  if (!me) return null;
  const now = Number(o.now) || Date.now();
  const vote = {
    id: String(o.id || ('v' + now)),
    gameId: String((state && state.gameId) || ''),
    byUid: byUid,
    bySeat: me.seat,
    byName: String(o.byName || ''),
    at: now,
    votes: {},
    status: 'open',
    rejectedBy: ''
  };
  vote.votes[byUid] = true;
  // 无其余真人可附议：空集视为一致同意，发起即通过
  if (tally(vote, voters).allAgreed) vote.status = 'passed';
  return vote;
}

/**
 * 投一张票，就地改 vote。返回 true 表示确实改动了状态，调用方据此决定
 * 要不要把新快照推上云 —— 重复点 / 名单外的人 / 已结束的投票都不写库。
 */
function cast(vote, state, uid, name, agree) {
  if (!vote || vote.status !== 'open' || !vote.votes) return false;
  const key = String(uid || '');
  if (!key || Object.prototype.hasOwnProperty.call(vote.votes, key)) return false;
  const voters = votersOf(state);
  if (!voters.some(function (v) { return v.uid === key; })) return false;
  vote.votes[key] = !!agree;
  if (!agree) {
    vote.status = 'rejected';
    vote.rejectedBy = String(name || '有玩家');
  } else if (tally(vote, voters).allAgreed) {
    vote.status = 'passed';
  }
  return true;
}

/** 仅房主能发起；进行中的投票不允许重复发起，被否决 / 已通过后可以再来一次。 */
function canStart(vote, isHost) {
  if (!isHost) return false;
  if (!vote) return true;
  return vote.status !== 'open';
}

/** 投票是否仍属于当前这一局。老快照没有 gameId 时按「仍在 state 上」放行。 */
function isCurrent(vote, state) {
  if (!vote) return false;
  const gid = String((state && state.gameId) || '');
  return !vote.gameId || !gid || vote.gameId === gid;
}

module.exports = {
  votersOf: votersOf,
  isVoter: isVoter,
  tally: tally,
  newVote: newVote,
  cast: cast,
  canStart: canStart,
  isCurrent: isCurrent
};
