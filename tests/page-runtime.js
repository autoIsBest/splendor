'use strict';
const ROOT = require('path').resolve(__dirname, '..');
const U = require(ROOT + '/utils/user.js');
let captured = null;
global.Page = function (cfg) { captured = cfg; };
global.wx = {
  getWindowInfo: function () { return { windowWidth: 812, windowHeight: 375 }; },
  showModal: function (opt) { opt.success({ confirm: true }); }
};
let nextTimerId = 1;
let timers = [];
global.setTimeout = function (fn) {
  const t = { id: nextTimerId++, fn: fn, active: true };
  timers.push(t);
  return t.id;
};
global.clearTimeout = function (id) {
  timers.forEach(function (t) { if (t.id === id) t.active = false; });
};
// 页面用 setInterval 做云端轮询 / 在线人数心跳。这里必须一起 mock：
// 否则一旦某个断言失败、流程没走到 onUnload()，Node 真实的 interval
// 会让进程永不退出（表现为测试「挂死」而不是打印 FAIL）。
const intervals = [];
global.setInterval = function (fn) {
  const t = { id: nextTimerId++, fn: fn, active: true };
  intervals.push(t);
  return t.id;
};
global.clearInterval = function (id) {
  intervals.forEach(function (t) { if (t.id === id) t.active = false; });
};
function drain(max) {
  let n = 0;
  while (n < max) {
    const t = timers.find(function (x) { return x.active; });
    if (!t) break;
    t.active = false;
    t.fn();
    n += 1;
  }
  return n;
}

require(ROOT + '/pages/index/index.js');
if (!captured) throw new Error('Page() 未被调用');
const page = captured;
page.setData = function (obj) { Object.assign(page.data, obj); };

function assert(c, msg) { if (!c) throw new Error('FAIL: ' + msg); }

page.onLoad();
assert(page.data.stageScale > 0, 'stageScale 计算');
assert(Math.abs(page.data.stageScale - Math.min(812 / 1080, 375 / 560)) < 1e-9, 'scale 为等比缩放');
assert(page.data.screen === 'home', '默认进入首页入口界面');
assert(page.data.home.soloCount === 2, '人机对战默认 2 人');
assert(page.data.home.roomCount === 3, '邀请好友默认 3 人');
assert(page.data.home.soloCounts.length === 3, '首页提供 2/3/4 人选项');
assert(page.data.rows.length === 0, '首页不渲染牌桌');
console.log('OK  入口界面 · 人机对战 / 邀请好友 / 加入房间');

// 场景大厅：设置 / 建房 / 加入按需打开，取消不会创建牌局或房间。
assert(page.data.home.dialog === '', '首屏不展开配置表单');
page.onOpenHomeDialog({ currentTarget: { dataset: { kind: 'create' } } });
assert(page.data.home.dialog === 'create' && !page.room && !page.state, '打开建房设置不应提前创建房间');
page.onSelectTurnLimit({ currentTarget: { dataset: { value: 90 } } });
assert(page.data.home.turnLimit === 90 && page.ui.toast === '', '计时选择应生效且不重复提示');
page.onCloseHomeDialog();
assert(page.data.home.dialog === '' && !page.room && !page.state, '取消建房应停留在首页');
assert(page.data.home.turnLimit === 0, '取消建房应恢复原来的计时设置');
page.onSelectTurnLimit({ currentTarget: { dataset: { value: 0 } } });
page.onOpenHomeDialog({ currentTarget: { dataset: { kind: 'join' } } });
page.onJoinFromHome();
assert(page.data.home.notice.indexOf('6 位') >= 0, '加入失败应保留输入旁的错误反馈');
page.onCloseHomeDialog();
assert(page.data.home.notice === '', '取消加入不遗留错误提示');
// 三态文案：预览 / 云服务初始化失败都必须说清原因，不能笼统说「离线」。
assert(page.data.home.cloudState === 'preview', '无 wx 环境应标记为预览');
assert(page.data.home.cloudHint.indexOf('浏览器预览') >= 0, '预览环境应如实说明');
// 在线人数：查到之前必须显示「—」，不能谎报 0（0 会被读成「一个人都没有」）
assert(page.data.home.onlineReady === false, '首屏尚未查到在线人数');
assert(page.data.home.onlineText === '—', '未就绪时应显示「—」而不是 0');
{
  // 拿到数据后应显示真实数字，并带上「人在线」语义
  page.ui.onlineCount = 12;
  page.ui.onlineReady = true;
  page.refresh('');
  assert(page.data.home.onlineText === '12', '有数据时应显示真实人数');
  assert(page.data.home.online === 12, '数值字段应与文本一致');
  // 真的 0 人在线（只剩自己也会是 1，这里测边界）也要显示 0 而不是「—」
  page.ui.onlineCount = 0;
  page.refresh('');
  assert(page.data.home.onlineText === '0', '已查到但为 0 时应显示 0');
  page.ui.onlineCount = undefined;
  page.ui.onlineReady = false;
  page.refresh('');
}
page.onOpenHomeDialog({ currentTarget: { dataset: { kind: 'create' } } });
assert(page.data.home.cloudHint.length > 0, '预览环境建房应给出限制说明');
page.onCloseHomeDialog();
page.onOpenHomeDialog({ currentTarget: { dataset: { kind: 'solo' } } });

// 快速开始必须能选人数：首屏点「快速开始」只打开人数弹层，不直接开局
{
  page.onCloseHomeDialog();
  page.onQuickStart();
  assert(page.ui.screen === 'home', '快速开始先停在首页，不直接开局：' + page.ui.screen);
  assert(page.data.home.dialog === 'quick', '快速开始应打开人数弹层');
  assert(page.data.home.soloCounts.length === 3, '人数弹层应提供 2/3/4 三档');
  // 弹层里不应混入与人数无关的云能力提示
  assert(page.data.home.cloudHint.indexOf('浏览器预览') >= 0, '预览环境仍应有云提示字段');
  page.onCloseHomeDialog();
  assert(page.data.home.dialog === '', '取消人数弹层应关闭');
  assert(page.ui.screen === 'home', '取消后仍留在首页');
}
console.log('OK  快速开始 · 先选人数再开局');

// 人机对战退出＝放弃：回大厅且不记战绩
{
  page.onPickSoloSeats({ currentTarget: { dataset: { n: 3 } } });
  assert(page.data.screen === 'game', '选人数后直接开局');
  assert(page.data.playerCount === 3, '应按所选人数开局：' + page.data.playerCount);
  const recBefore = U.getRecords().length;
  page.onQuitGame();
  assert(page.ui.screen === 'home', '人机局退出后回到大厅');
  assert(page.state === null, '放弃后不应残留牌局状态');
  assert(U.getRecords().length === recBefore, '中途放弃不计入战绩');
  // 复位人数，避免影响后续用例（后面按 2 人局断言贵族张数）
  page.ui.soloCount = 2;
  page.onStartSolo();
}

// 进入人机对战
page.onStartSolo();
assert(page.ui.homeDialog === '', '开局时应清理首页设置弹层');
assert(page.data.screen === 'game', '人机对战进入牌桌');
assert(page.data.rows.length === 3, '3 行明牌');
page.data.rows.forEach(function (r) { assert(r.cards.length === 4, '每行 4 张卡'); });
assert(page.data.bankPiles.length === 6, '6 种筹码堆');
assert(page.data.nobles.length === 3, '3 张贵族');
assert(page.data.decks.length === 3, '3 个牌库');
assert(page.data.isMyTurn === true, '首回合为玩家');
assert(page.data.gameOver === false, '开局未结束');
console.log('OK  页面初始化 · 视图模型结构完整');

// 四色成本卡（官方牌组里的 1/1/1/1 与三级 3/3/3/5）必须带 is-dense，
// 否则市场格 92×112 里 21px 圆章会折成第二列压住卡名
let sawDense = 0;
for (let round = 0; round < 10 && sawDense === 0; round++) {
  if (round > 0) page.onStartSolo();
  page.data.rows.forEach(function (r) {
    r.cards.forEach(function (c) {
      if (!c.costs) return;
      assert(c.costDense === (c.costs.length >= 4), '四色成本标记应与成本数量一致：' + c.name + ' costs=' + c.costs.length);
      assert(c.costs.length <= 4, '官方卡最多 4 色成本：' + c.name);
      if (c.costDense) sawDense += 1;
    });
  });
}
assert(sawDense > 0, '10 次发牌里应至少出现一张四色成本卡');
console.log('OK  四色成本卡 · 10 次发牌命中 ' + sawDense + ' 张，均带 is-dense');

// 成本气泡 = 卡面印刷成本（不随持有筹码变化）；买得起与否改用光环表达
page.onStartSolo();
const GEM_KEYS = ['white', 'blue', 'green', 'red', 'black'];
// rows[2] 是近端一级行，对应 state.board[0]（引擎里 lv 0 = 一级）
const probeCard = page.state.board[0][0];
const printed = {};
let printedTotal = 0;
GEM_KEYS.forEach(function (g) { printed[g] = probeCard.cost[g] || 0; printedTotal += printed[g]; });
assert(printedTotal > 0, '一级首张卡应有成本');
const gapGem = GEM_KEYS.filter(function (g) { return printed[g] === 0; })[0];
assert(gapGem, '任一张卡最多 4 色成本，应至少缺 1 色以便构造缺口');

function boardCardVM() { return page.data.rows[2].cards[0]; }
function costSignature(vm) { return (vm.costs || []).map(function (c) { return c.key + c.display; }).join(','); }

// ① 筹码恰好够：绿光，且气泡仍是印刷值
page.state.players[0].tokens = Object.assign({ gold: 0 }, printed);
page.refresh('');
let vm = boardCardVM();
assert(vm.buyState === 'direct' && vm.buyClass === 'is-buyable', '筹码够时应为绿光直购，实际 ' + vm.buyState);
assert(vm.costs.every(function (c) { return c.display === String(printed[c.key]); }), '筹码够时气泡应为印刷成本');
const sigDirect = costSignature(vm);

// ② 差 1 枚、用黄金补：金光，气泡数字不能变成缺口值
const giveGem = GEM_KEYS.filter(function (g) { return printed[g] > 0; })[0];
page.state.players[0].tokens[giveGem] -= 1;
page.state.players[0].tokens.gold = 1;
page.refresh('');
vm = boardCardVM();
assert(vm.buyState === 'gold' && vm.buyClass === 'is-gold-buy', '需动用黄金时应为金光，实际 ' + vm.buyState);
assert(vm.goldPay === 1, '缺口 1 枚应由黄金补足，实际 ' + vm.goldPay);
assert(costSignature(vm) === sigDirect, '气泡不应随筹码缺口变化（仍是印刷成本）');
assert(costSignature(vm).indexOf('✓') < 0, '成本气泡不应再出现打勾抵扣');

// ③ 连黄金都不够：无光环，气泡依旧
page.state.players[0].tokens.gold = 0;
page.refresh('');
vm = boardCardVM();
assert(vm.buyState === 'no' && vm.buyClass === '', '买不起时不应有光环，实际 ' + vm.buyState);
assert(costSignature(vm) === sigDirect, '买不起时气泡仍为印刷成本');
console.log('OK  卡面成本恒定 · 绿光/金光/无光三态判定正确');

// 预留卡直接铺在桌面左侧：卡面同款 + 空位补槽 + 成本同为印刷值
// 从牌库顶取两张（不动市场），断言完再放回，避免影响后续用例
const deckA = page.state.decks[0];
const deckB = page.state.decks[1];
const probeReserved = [deckA.pop(), deckB.pop()];
page.state.players[0].reserved = probeReserved.filter(Boolean);
page.refresh('');
assert(page.data.reservedCards.length === 2, '两张预留卡应铺到桌面左侧');
assert(page.data.emptyReservedSlots.length === 1, '3 个预留位应补 1 个空槽');
page.data.reservedCards.forEach(function (c) {
  assert(c.photoClass && c.costs.length > 0, '预留卡应带完整卡面数据：' + c.name);
  assert(c.tiltStyle.indexOf('perspective') > 0, '预留卡应带 2.5D 摆放姿态');
  c.costs.forEach(function (x) {
    assert(/^\d+$/.test(x.display), '预留卡成本气泡应为纯数字（印刷值）：' + x.display);
  });
});
assert(page.data.reservedCards[0].index === 0 && page.data.reservedCards[1].index === 1, '预留卡应带可点击的下标');
console.log('OK  预留卡上桌 · 2 张就位 + 1 个空槽');

// 复原牌库与预留位，后续用例按原状态继续
page.state.players[0].reserved = [];
probeReserved.forEach(function (c, i) { (i === 0 ? deckA : deckB).push(c); });
page.refresh('');

// 工作台：红利行固定 5 色，与筹码行逐列同色
assert(page.data.me.discountCells.length === 5, '红利行应固定 5 色');
assert(page.data.me.tokens.length === 6, '筹码行应为 5 色 + 黄金');
page.data.me.discountCells.forEach(function (cell, i) {
  assert(cell.key === page.data.me.tokens[i].key, '第 ' + i + ' 列红利与筹码应同色：' + cell.key + ' vs ' + page.data.me.tokens[i].key);
  assert(cell.num >= 0 && cell.zero === (cell.num === 0), '红利格应如实反映数量与零值');
});
console.log('OK  工作台红利/筹码逐列对齐（白蓝绿红黑 + 黄金）');

// 逐个模拟事件处理方法
function tap(method, dataset) {
  page[method]({ currentTarget: { dataset: dataset } });
}

// 选篮门禁：只选 1 枚 / 2 个不同色时误触确认不得结束回合
{
  const bankStart = page.state.bank.white;
  const turnStart = page.state.current;
  tap('onTapPile', { key: 'white' });
  assert(page.data.selectionCount === 1, '选中 1 枚筹码');
  assert(page.data.canConfirm === false, '只选 1 枚不可确认');
  assert(page.data.bankPiles[0].showMinus === true, '已选筹码堆应显示「-」按钮');
  assert(page.data.bankPiles[0].picked === 1, '筹码堆应记录已选数量');
  page.onConfirmTake();
  assert(page.state.current === turnStart, '未凑满时误触确认不应结束回合');
  assert(page.state.bank.white === bankStart, '未凑满时不应扣银行筹码');
  assert(page.ui.selectedGems.length === 1, '误触确认不应清空选篮');
  tap('onTapPile', { key: 'blue' });
  assert(page.data.canConfirm === false, '选 2 个不同色不可确认');
  assert(page.data.hintText.indexOf('再选 1 种不同色') > 0, '提示应引导再选 1 色');
  // 「-」只放回该色 1 枚，不影响另一色，也不动银行
  tap('onRemovePile', { key: 'white' });
  assert(page.ui.selectedGems.join(',') === 'blue', '「-」应只放回 1 枚指定色');
  assert(page.data.bankPiles[0].showMinus === false, '放回后该堆不再显示「-」');
  assert(page.state.bank.white === bankStart, '放回只改选篮，不动银行');
  // 同色 2 枚（库存 ≥4）也能凑成合法组合
  page.onCancelSelection();
  tap('onTapPile', { key: 'white' });
  tap('onTapPile', { key: 'white' });
  assert(page.data.canConfirm === true, '同色 2 枚可确认');
  assert(page.data.bankPiles[0].pickedMany === true, '同色 2 枚应显示 ×2 角标');
  tap('onRemovePile', { key: 'white' });
  assert(page.ui.selectedGems.length === 1, '同色时「-」只放回 1 枚');
  page.onCancelSelection();
  assert(page.data.canConfirm === false, '清空后不可确认');
}
console.log('OK  拿筹码门禁 · 「-」逐枚放回 · 同色 2 枚');

// 待确认摘要：拿取 / 购买 / 预留 三种上下文各说清「本次变化 + 确认后总量」
{
  const pk = page.data.pick;
  assert(pk.mode === 'take' && pk.label.indexOf('确认拿取') === 0, '默认上下文是拿取');
  assert(pk.fromText === String(page.data.me.totalTokens), '摘要起点＝当前持有量');
  assert(pk.toText === String(Number(pk.fromText) + page.ui.selectedGems.length), '终值＝当前 + 本次拿取');
  assert(pk.delta === page.ui.selectedGems.length, '增量与选篮一致');
  // 逐色 +n 标记只标本次增加，不覆盖已有数量
  const gainSum = pk.gain.reduce(function (a, c) { return a + c.gain; }, 0);
  assert(gainSum === page.ui.selectedGems.length, '+n 标记合计应等于本次拿取数');
  pk.gain.forEach(function (c) { assert(c.show === (c.gain > 0), '+n 只在有增量时显示：' + c.key); });
}
console.log('OK  待确认摘要 · 本次拿取 / +n 增量 / 确认后总量');

// 购买上下文：扣除永久折扣后的实付 + 黄金替代
{
  page.onCancelSelection();
  const st2 = page.state;
  // 给足筹码，确保至少一张卡买得起；打开详情后摘要应切换为购买
  st2.players[0].tokens = { white: 7, blue: 7, green: 7, red: 7, black: 7, gold: 2 };
  page.refresh('');
  let opened = false;
  for (let lv = 0; lv < 3 && !opened; lv++) {
    for (let i = 0; i < 4 && !opened; i++) {
      if (!st2.board[lv][i]) continue;
      tap('onTapCard', { lv: lv, index: i });
      if (page.data.pick.mode === 'buy') opened = true;
      else page.onCloseDetail();
    }
  }
  assert(opened, '买得起时摘要应切到购买上下文');
  const bp = page.data.pick;
  assert(bp.label === '购买此卡', '主按钮文案应为购买此卡');
  assert(bp.delta < 0 && bp.toText === String(Number(bp.fromText) + bp.delta), '购买应表达为持有量减少');
  assert(bp.items.length > 0 && bp.items.every(function (it) { return it.negative === true; }), '逐色实付应标为扣减');
  assert(bp.goldLine === '' || bp.goldLine.indexOf('黄金') >= 0, '有黄金替代时要显式说明');
  page.onCloseDetail();
}
console.log('OK  待确认摘要 · 购买实付 / 黄金替代 / 持有量减少');

// 预留上下文：名额与黄金变化
{
  const st3 = page.state;
  st3.players[0].reserved = [];
  page.onCancelSelection();
  let opened = false;
  for (let i = 0; i < 4 && !opened; i++) {
    if (!st3.board[0][i]) continue;
    tap('onTapCard', { lv: 0, index: i });
    if (page.data.pick.mode === 'reserve') opened = true;
    else page.onCloseDetail();
  }
  if (!opened) {
    // 买得起时摘要优先给购买；把筹码清空即可让它落到预留
    st3.players[0].tokens = { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
    page.refresh('');
    for (let i = 0; i < 4 && !opened; i++) {
      if (!st3.board[0][i]) continue;
      tap('onTapCard', { lv: 0, index: i });
      if (page.data.pick.mode === 'reserve') opened = true;
      else page.onCloseDetail();
    }
  }
  assert(opened, '可预留时摘要应切到预留上下文');
  const rp = page.data.pick;
  assert(rp.label === '确认预留', '主按钮文案应为确认预留');
  assert(rp.title.indexOf('/3') > 0, '预留摘要要写明名额进度');
  page.onCloseDetail();
  page.onCancelSelection();
}
console.log('OK  待确认摘要 · 预留名额 / 黄金变化');

// 「跳过」是规则兜底：正常局面不出现
assert(page.data.canPass === false, '有合法动作时不应出现「跳过」');
{
  const s4 = page.state;
  // 先存后复原：这段只是验证门禁，不能破坏后续用例的银行与牌面
  const keepBank = JSON.parse(JSON.stringify(s4.bank));
  const keepBoard = s4.board.map(function (r) { return r.slice(); });
  const keepDecks = s4.decks.map(function (d) { return d.slice(); });
  const keepReserved = s4.players[0].reserved.slice();
  const keepTokens = JSON.parse(JSON.stringify(s4.players[0].tokens));
  s4.bank = { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
  s4.board = [[null, null, null, null], [null, null, null, null], [null, null, null, null]];
  s4.decks = [[], [], []];
  s4.players[0].reserved = [];
  s4.players[0].tokens = { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
  page.refresh('');
  assert(page.data.canPass === true, '无任何合法动作时才出现「跳过」');
  s4.bank = keepBank;
  s4.board = keepBoard;
  s4.decks = keepDecks;
  s4.players[0].reserved = keepReserved;
  s4.players[0].tokens = keepTokens;
  page.refresh('');
}
console.log('OK  跳过按钮由规则决定 · 无解时才出现');

// 点选 3 个不同色筹码并确认
['white', 'blue', 'green'].forEach(function (k) { tap('onTapPile', { key: k }); });
assert(page.data.selectionCount === 3, '选中 3 枚筹码');
assert(page.data.canConfirm === true, '可确认');
page.onConfirmTake();
assert(page.data.selectionCount === 0, '确认后清空选择');
assert(page.state.current === 1, '轮到 AI');
const aiSteps = drain(80);
assert(aiSteps > 0, 'AI 回合被执行');
assert(page.state.current === 0, 'AI 行动后回到玩家');
console.log('OK  拿筹码 → AI 回合 → 回到玩家 (' + aiSteps + ' 次 AI 动作)');

// 卡牌详情
tap('onTapCard', { lv: 0, index: 0 });
assert(page.data.detail !== null, '详情弹层打开');
assert(page.data.detail.card !== undefined, '详情含卡片视图数据');
assert(page.data.detail.costLines !== undefined, '详情含成本明细');
page.onCloseDetail();
assert(page.data.detail === null, '详情关闭');
console.log('OK  卡牌详情弹层');

// 规则与预留卡弹层
page.onShowRules();
assert(page.data.showRules === true, '规则弹层打开');
page.onCloseRules();
page.onShowReserved();
assert(page.data.showReserved === true, '预留卡弹层打开');
page.onCloseReserved();
console.log('OK  规则 / 预留卡弹层');

/* ---------- 好友体系：弹层 / 列表渲染 / 邀请可点条件 ---------- */
{
  // 注意：不要在这里 onLeaveRoom() —— 它会清空 page.state，
  // 后面「预留牌库」用例还要读 page.state.decks。好友弹层与牌局状态无关。
  page.onOpenFriends();
  assert(page.data.showFriends === true, '好友弹层应能打开');
  const fp = page.data.friendsPanel;
  assert(fp, '应有好友视图模型');
  assert(fp.ready === false, '预览环境无云端，好友列表应为未就绪');
  assert(fp.empty === true, '无好友时列表为空');
  assert(typeof fp.myId === 'string' && fp.myId.length > 0, '必须展示自己的账号 ID 供好友互加');
  // 大厅里没有房间 → 不能邀请，界面要给说明而不是灰按钮
  assert(fp.canInvite === false, '大厅未建房时不可邀请');
  page.onCloseFriends();
  assert(page.data.showFriends === false, '关闭后弹层收起');

  // 构造两位好友：一个在线、一个离线，验证按钮态分流
  page.ui.friends = [
    { uid: 'friend-online-001', nickname: '在线甲', avatar: 'a1' },
    { uid: 'friend-offline-002', nickname: '离线乙', avatar: 'a2' }
  ];
  page.ui.onlineUids = { 'friend-online-001': true };
  page.ui.friendsReady = true;
  page.ui.friendInviteCode = '';      // 先在大厅
  page.refresh('');
  let rows = page.data.friendsPanel.list;
  assert(rows.length === 2, '两位好友应各占一行');
  assert(rows[0].online === true && rows[0].statusText === '在线', '在线好友应标在线');
  assert(rows[1].online === false && rows[1].statusText === '离线', '离线好友应标离线');
  assert(rows[0].canInvite === false, '大厅里没有房间号，在线也不能邀请');
  assert(page.data.friendsPanel.onlineCount === 1, '在线数应为 1');

  // 进入房间后带上房间号 → 在线好友可邀请，离线仍不可
  page.ui.friendInviteCode = 'ABC234';
  page.refresh('');
  rows = page.data.friendsPanel.list;
  assert(rows[0].canInvite === true, '房间里在线好友应可邀请');
  assert(rows[1].canInvite === false, '离线好友不可邀请（点了也收不到）');
  console.log('OK  好友弹层 · 列表 / 在线态 / 邀请可点条件');
}

/* ---------- 邀请提醒：展示、接受、忽略 ---------- */
{
  page.ui.invites = [
    { id: 'iv-1', fromUid: 'friend-online-001', fromName: '在线甲', roomCode: 'ABC234', at: '' },
    { id: 'iv-2', fromUid: 'friend-offline-002', fromName: '离线乙', roomCode: 'XYZ789', at: '' }
  ];
  page.refresh('');
  const ip = page.data.invitePop;
  assert(ip !== null, '有待处理邀请时应弹提醒');
  assert(ip.fromName === '在线甲', '提醒里应写邀请人昵称');
  assert(ip.roomCode === 'ABC234', '提醒里应写房间号');
  assert(ip.more === 1 && ip.moreText.indexOf('另有 1 条') >= 0, '多条邀请应给出剩余数量');

  // 忽略第一条：应让位给下一条而不是整块消失
  page.onDeclineInvite();
  assert(page.data.invitePop !== null, '忽略一条后仍有下一条');
  assert(page.data.invitePop.fromName === '离线乙', '应轮到第二条');
  page.onDeclineInvite();
  assert(page.data.invitePop === null, '全部处理完提醒应消失');
  page.ui.inviteNotice = '';
  page.refresh('');
  console.log('OK  邀请提醒 · 昵称/房间号/剩余条数 + 逐条忽略');
}

// 预留牌库（showModal 自动确认）
const before = page.state.decks[0].length;
tap('onTapDeck', { lv: 0 });
assert(page.state.decks[0].length === before - 1, '盲抽预留消耗 1 张牌');
assert(page.state.players[0].reserved.length === 1, '预留卡 +1');
drain(80);
console.log('OK  盲抽预留牌库顶');

// 退还筹码路径：官方规则允许同色退多枚，攒批后一次性确认
const s = page.state;
s.current = 0;
s.pendingDiscard = 0;
s.players[0].tokens = { white: 3, blue: 3, green: 2, red: 2, black: 2, gold: 1 };
s.bank = { white: 1, blue: 1, green: 2, red: 2, black: 2, gold: 4 };
s.pendingDiscard = 3;
page.refresh('');
assert(page.data.needDiscard === true, '退还模式开启');
assert(page.data.pick.mode === 'discard', '退还时主按钮切到归还上下文');
assert(page.data.canConfirm === false, '未选够不可确认');
tap('onTapMyToken', { key: 'white' });
assert(s.pendingDiscard === 3, '点筹码只入退还篮，不立即提交');
assert(page.data.discardPlanCount === 1, '退还篮记 1 枚');
assert(page.data.canConfirm === false, '还差 2 枚不可确认');
// 规则修复点：再点同色必须「累加」而不是「撤回」
tap('onTapMyToken', { key: 'white' });
assert(page.data.discardPlanCount === 2, '再点同一色应累加 1 枚，不能当撤回');
assert(page.data.me.res.tokens[0].pickedCount === 2, '筹码角标应显示已选 2 枚');
assert(page.data.me.res.tokens[0].key === 'white', '角标挂在正确的颜色上');
// 撤回改由筹码上的「−」按钮逐枚承担
tap('onRemoveDiscardPlan', { key: 'white' });
assert(page.data.discardPlanCount === 1, '「−」按钮撤回 1 枚');
assert(page.data.me.res.tokens[0].pickedCount === 1, '撤回后角标同步');
// 攒够 3 枚：白 2 + 蓝 1（含同色多枚）
tap('onTapMyToken', { key: 'white' });
tap('onTapMyToken', { key: 'blue' });
assert(page.data.discardPlanCount === 3, '攒够 3 枚');
assert(page.data.canConfirm === true, '攒够才可确认');
const whiteBefore = s.players[0].tokens.white;
const blueBefore = s.players[0].tokens.blue;
page.onConfirmTake();
assert(s.pendingDiscard === 0, '确认后完成退还');
assert(s.players[0].tokens.white === whiteBefore - 2, '同色 2 枚一次性退还成功');
assert(s.players[0].tokens.blue === blueBefore - 1, '另一色 1 枚退还成功');
assert(s.bank.white === 3, '退回银行的白色筹码数量正确');
assert(page.data.pick.mode !== 'discard', '退还完成后主按钮回到拿取');
drain(80);
console.log('OK  超额筹码攒批退还 · 同色可退多枚 · 「−」逐枚撤回 · 一次确认');

// 重开后完整跑一局：玩家始终执行「买得起就买，否则拿 3 枚」
page.onRestart();
let guard = 0;
while (!page.state.gameOver && guard < 300) {
  if (page.state.current !== 0) { drain(80); continue; }
  const s2 = page.state;
  // 同时满足多张贵族时真实 UI 会弹选择层；模拟脚本直接选第一张，否则所有动作都会被门禁拒绝
  if (s2.pendingNoble && s2.pendingNoble.seat === 0) {
    page.applyPlayerAction({ type: 'chooseNoble', id: s2.pendingNoble.options[0] });
    drain(80);
    guard += 1;
    continue;
  }
  const E = require(ROOT + '/utils/game-engine.js');
  // 随机牌序可能同时满足多张贵族；和退还筹码一样，模拟真实 UI
  // 先完成强制选择，否则后续买卡 / 拿筹码会一直被引擎拒绝。
  if (s2.pendingNoble) {
    tap('onChooseNoble', { id: s2.pendingNoble.options[0] });
    assert(!page.state.pendingNoble, '完整对局应能完成贵族挑选');
    drain(80);
    guard += 1;
    continue;
  }
  let bought = false;
  // 真实 UI 在 pendingDiscard 时只开放「退还」入口（onTapCard/onTapPile/onPass 均有保护），
  // 模拟脚本也必须先处理退还，否则会提交被引擎拒绝的买卡动作而误判为已行动。
  if (s2.pendingDiscard === 0) {
    for (let lv = 0; lv < 3 && !bought; lv++) {
      for (let i = 0; i < 4; i++) {
        if (s2.board[lv][i] && E.canBuy(s2, 0, s2.board[lv][i])) {
          bought = page.applyPlayerAction({ type: 'buyBoard', lv: lv, index: i });
          break;
        }
      }
    }
  }
  if (!bought) {
    const s3 = page.state;
    let acted = false;
    if (s3.pendingDiscard > 0) {
      // 超出 10 枚时按真实 UI 逐枚退还，直到解除待退还状态
      const keys = Object.keys(s3.players[0].tokens);
      for (let k = 0; k < keys.length && page.state.pendingDiscard > 0; k++) {
        while (page.state.pendingDiscard > 0 && page.state.players[0].tokens[keys[k]] > 0) {
          if (!page.applyPlayerAction({ type: 'discard', gems: [keys[k]] })) break;
        }
      }
      acted = page.state.pendingDiscard === 0;
    } else {
      const avail = E.availableGems(s3).slice(0, 3);
      acted = page.applyPlayerAction(avail.length ? { type: 'take', gems: avail } : { type: 'pass' });
    }
    // 动作被规则拒绝时（例如满 10 枚仍尝试拿取），真实玩家可点「跳过」
    if (!acted) page.applyPlayerAction({ type: 'pass' });
  }
  assert(page.data.rows.length === 3, '每步视图模型完整');
  drain(80);
  guard += 1;
}
assert(page.state.gameOver, '完整对局能结束 (guard=' + guard +
  ', current=' + page.state.current +
  ', pendingNoble=' + !!page.state.pendingNoble +
  ', pendingDiscard=' + page.state.pendingDiscard +
  ', bank=' + JSON.stringify(page.state.bank) +
  ', points=' + page.state.players.map(function (p) { return p.points; }).join('/') + ')');
assert(page.data.gameOver === true, '结算弹层状态');
assert(page.data.resultTitle.length > 0, '结算标题');

/* ---------- 结算自动落战绩（幂等） ---------- */
const recs = U.getRecords();
assert(recs.length === 1, '结算应自动落一条战绩，实际 ' + recs.length);
assert(recs[0].mode === 'solo', '人机局战绩应标记 solo');
assert(recs[0].playerCount === page.state.players.length, '战绩人数应与牌局一致');
assert(recs[0].score === page.state.players[0].points, '战绩声望应取本机席位');
assert(recs[0].win === (page.state.winner === 0), '胜负应与引擎判定一致');
assert(recs[0].rank >= 1 && recs[0].rank <= page.state.players.length, '名次应在席位范围内');
const recCount = U.getRecords().length;
page.refresh('');
page.refresh('');
assert(U.getRecords().length === recCount, '重复刷新不应重复记账（结算弹层会反复重绘）');
assert(page.data.home.stats.total === recCount, '回到大厅时战绩统计应已包含本局');
console.log('OK  结算落战绩 · ' + recs[0].rank + ' 名 / ' + recs[0].score + ' 声望 · 重复刷新不重复记账');
console.log('OK  完整对局跑通 · ' + page.data.resultTitle + ' · ' + page.data.resultDetail);

/* ---------- 入口 → 房间 → 准备 → 房主开始 ---------- */
page.onLeaveRoom();
assert(page.data.screen === 'home', '离开牌局回到首页');

page.onCreateRoom();
assert(page.data.screen === 'room', '创建房间进入房间界面');
assert(page.data.roomScreen.seats.length === 3, '默认 3 个席位');
assert(page.data.roomScreen.joinedHumans === 1, '只有房主已加入');
assert(page.data.roomScreen.canStart === false, '空席未就绪时房主不能开始');
assert(page.data.roomScreen.isHost === true, '房主视角');

tap('onRoomToggleBot', { index: 1 });
tap('onRoomToggleBot', { index: 2 });
assert(page.data.roomScreen.botCount === 2, '两个席位转为机器人');
assert(page.data.roomScreen.canStart === true, '机器人席位就绪后房主可开始');
assert(page.data.roomScreen.readyCount === 3, '全员就绪计数正确');

// 未就绪时先撤掉一个机器人，验证开始被拦
tap('onRoomToggleBot', { index: 2 });
assert(page.data.roomScreen.canStart === false, '存在空席时不能开始');
page.onRoomStart();
assert(page.data.screen === 'room', '未就绪时开始被拦下');
tap('onRoomToggleBot', { index: 2 });
assert(page.data.roomScreen.canStart === true, '补回机器人后恢复可开始');

page.onRoomStart();
assert(page.data.screen === 'game', '房主开始后进入牌桌');
assert(page.state.players.length === 3, '3 人牌局');
assert(page.state.players[1].isAI === true, '机器人席位由 AI 托管');
drain(80);
console.log('OK  房间准备流 · 空席拦截 / 机器人就绪 / 房主开局');

page.onLeaveRoom();
assert(page.data.screen === 'home', '离开房间回到首页');
assert(page.room === null, '房间引用已释放');

/* ---------- 真人入席 → 点准备 → 全员就绪房主才可开始 ---------- */
page.onCreateRoom();
assert(page.data.screen === 'room', '重新建房回到房间界面');
assert(page.data.roomScreen.statusText === '已加入 1 人 · 已准备 1/3', '开局只有房主已就绪');

// 好友凭房间号入席，尚未点准备
page.room.seats[1] = Object.assign({}, page.room.seats[1], {
  joined: true, uid: 'guest-a', name: '群友甲', nickname: '群友甲', ready: false
});
page.refresh('');
assert(page.data.roomScreen.joinedHumans === 2, '房主端实时看到已加入 2 人');
assert(page.data.roomScreen.statusText === '已加入 2 人 · 已准备 1/3', '状态行随入席更新');
assert(page.data.roomScreen.waitingReady === 1, '统计到 1 人未准备');
assert(page.data.roomScreen.tip === '还有 1 位玩家未准备', '提示差几位未准备');
assert(page.data.roomScreen.canStart === false, '有人未准备时房主不能开始');
assert(page.data.roomScreen.startLabel === '等待玩家准备', '开始按钮保持等待态');
assert(page.data.roomScreen.seats[1].stateText === '未准备', '席位状态为未准备');
assert(page.data.roomScreen.seats[1].joined === true, '席位标记为已入席');
assert(page.data.roomScreen.seats[1].canToggleBot === false, '已入席席位不能再改机器人');
assert(page.data.roomScreen.emptyCount === 1, '仍剩 1 个空席');
assert(page.data.roomScreen.seats[2].canToggleBot === true, '空席对房主开放「设为机器人」');
assert(page.data.roomScreen.seats[0].canToggleBot === false, '自己的席位没有改机器人按钮');

// 好友点准备
page.mySeat = 1;
page.refresh('');
assert(page.data.roomScreen.seats[1].isSelf === true, '好友定位到 2 号席');
assert(page.data.roomScreen.seats[1].label.indexOf('你') > 0, '席位标注「你」');
assert(page.data.roomScreen.seats[1].canReady === true, '好友可自己点准备');
page.onRoomToggleReady();
assert(page.data.roomScreen.seats[1].ready === true, '好友准备成功');
assert(page.data.roomScreen.readyCount === 2, '准备数 +1');
assert(page.data.roomScreen.waitingReady === 0, '无人待准备');
assert(page.data.roomScreen.tip.indexOf('还有 1 个空席位') === 0, '提示改为空席缺口');
assert(page.data.roomScreen.canStart === false, '空席未补满时仍不能开始');
assert(page.data.roomScreen.startLabel === '已准备 · 等房主开始', '好友侧显示等待房主');
assert(page.data.roomScreen.seats[2].canToggleBot === false, '非房主不能把空席改机器人');

// 好友取消准备 → 房主端回到「有人未准备」
page.onRoomToggleReady();
assert(page.data.roomScreen.myReady === false, '好友取消准备');
assert(page.data.roomScreen.readyLabel === '准备', '按钮文案回到「准备」');
page.mySeat = 0;
page.refresh('');
assert(page.data.roomScreen.canStart === false, '取消准备后房主不能开始');
assert(page.data.roomScreen.tip === '还有 1 位玩家未准备', '房主端重新提示未准备');
assert(page.data.roomScreen.seats[1].stateText === '未准备', '席位回到未准备');

// 好友重新准备 + 房主把空席补成机器人 → 全员就绪
page.mySeat = 1;
page.onRoomToggleReady();
page.mySeat = 0;
tap('onRoomToggleBot', { index: 2 });
assert(page.data.roomScreen.botCount === 1, '空席补入机器人');
assert(page.data.roomScreen.readyCount === 3, '全员准备 3/3');
assert(page.data.roomScreen.tip === '全员已就绪，房主可以开始牌局', '就绪后提示可开局');
assert(page.data.roomScreen.canStart === true, '全员准备后房主才可开始');
assert(page.data.roomScreen.startLabel === '开始牌局', '按钮转为「开始牌局」');

page.onRoomStart();
assert(page.data.screen === 'game', '房主开局进入牌桌');
assert(page.state.players.length === 3, '按房间人数开出 3 人局');
assert(page.state.players[1].name === '群友甲', '真人席位用昵称入局');
assert(page.state.players[1].isAI === false, '真人席位不托管');
assert(page.state.players[2].isAI === true, '机器人席位 AI 托管');
drain(80);
console.log('OK  真人入席准备流 · 人数/准备实时变化 · 全员就绪房主才可开局');

/* ---------- 3/4 人局贵族牌：改双列，避免被工作台挡住 ---------- */
assert(page.data.nobles.length === 4, '3 人局应有 4 张贵族');
assert(page.data.noblesCompact === true, '4 张贵族应切到紧凑双列');
page.onLeaveRoom();
page.onSelectSoloCount({ currentTarget: { dataset: { n: 2 } } });
page.onStartSolo();
assert(page.data.nobles.length === 3, '2 人局 3 张贵族');
assert(page.data.noblesCompact === false, '3 张贵族仍用单列');
console.log('OK  贵族牌排布 · 2 人单列 / 3-4 人紧凑双列');

/* ---------- 预留卡详情：按卡面展示成本与声望 ---------- */
tap('onTapCard', { lv: 0, index: 0 });
page.onReserveFromDetail();
assert(page.state.players[0].reserved.length === 1, '预留成功');
page.ui.showPlayerDetail = true;
page.ui.detailSeat = 0;
page.refresh('');
const pd = page.data.playerDetail;
assert(pd.reservedCards.length === 1, '详情列出预留卡');
const rc = pd.reservedCards[0];
const rawCard = page.state.players[0].reserved[0];
assert(rc.costs.length > 0, '预留卡应带成本气泡');
assert(rc.costs.every(function (c) { return c.display === String(rawCard.cost[c.key]); }),
  '气泡数量应等于卡面印刷成本');
assert(rc.pointsLabel.indexOf('声望') >= 0, '预留卡应显示声望');
assert(rc.name === rawCard.name, '预留卡名称一致');
assert(pd.columns.length === 6, '详情弹层也应固定 6 列分组');
assert(pd.columns[5].bonus === '—' && pd.columns[5].token === String(page.state.players[0].tokens.gold || 0),
  '黄金列无红利但有筹码');
pd.columns.forEach(function (c) {
  assert(c.token === String(page.state.players[0].tokens[c.key] || 0), '详情筹码列应与持有量一致: ' + c.key);
});
page.ui.showPlayerDetail = false;
page.refresh('');
console.log('OK  预留卡详情 · 卡面成本气泡 / 声望 / 名称');

/* ---------- 预留卡「买得起就显示购买」：本轮 bug 回归 ---------- */
{
  const st = page.state;
  st.current = 0;
  st.pendingDiscard = 0;
  st.pendingNoble = null;
  // 造一张只吃蓝筹码的预留卡，确保只要蓝筹码够就能买
  const buyable = { gem: 'blue', points: 1, cost: { white: 0, blue: 4, green: 0, red: 0, black: 0 }, name: '暗河渡口', level: 1, art: 0 };
  st.players[0].reserved = [buyable];
  st.players[0].tokens = { white: 0, blue: 5, green: 0, red: 0, black: 0, gold: 0 };
  page.refresh('');

  page.onTapReservedCard({ currentTarget: { dataset: { index: 0 } } });
  const d = page.data.detail;
  assert(d && d.kind === 'reserved', '点击预留卡应打开详情');
  assert(d.canBuy === true, '筹码够时预留卡应判定为可购买');
  assert(d.canAct === true, '轮到自己且无待处理时应可操作');
  assert(d.buyLabel.indexOf('购买此卡') === 0, '预留卡可购买时按钮文案必须是「购买此卡」：' + d.buyLabel);
  assert(d.buyLabel.indexOf('实付') > 0, '购买按钮应带实付枚数：' + d.buyLabel);
  // 主按钮必须同步成购买 —— 上一版会落到预留分支，显示灰色的「确认预留」
  assert(page.data.pick.mode === 'buy', '主按钮上下文应为购买：' + page.data.pick.mode);
  assert(page.data.pick.label === '购买此卡', '主按钮文案应为购买此卡：' + page.data.pick.label);
  assert(page.data.pick.canSubmit === true, '买得起时必须允许提交');
  assert(page.data.canConfirm === true, '主按钮应可点');

  // 真点一次，确认走的是 buyReserved 而不是预留
  const before = st.players[0].reserved.length;
  page.onBuyFromDetail();
  assert(st.players[0].reserved.length === before - 1, '购买预留卡后应移出预留区');
  assert(st.players[0].cards.length === 1, '购买后应进入已购卡牌');
  assert(st.players[0].tokens.blue === 1, '应扣掉 4 枚蓝筹码：剩 ' + st.players[0].tokens.blue);
  console.log('OK  预留卡可购买 · 弹层给购买按钮 / 主按钮同步 / 实际扣除筹码');
}

/* ---------- 预留卡买不起：不能给出会失败的主操作 ---------- */
{
  const st = page.state;
  st.current = 0;
  st.pendingDiscard = 0;
  st.pendingNoble = null;
  const pricey = { gem: 'red', points: 5, cost: { white: 0, blue: 0, green: 0, red: 4, black: 4 }, name: '昂贵预留卡', level: 3, art: 1 };
  st.players[0].reserved = [pricey];
  st.players[0].tokens = { white: 0, blue: 0, green: 0, red: 1, black: 0, gold: 0 };
  page.refresh('');

  page.onTapReservedCard({ currentTarget: { dataset: { index: 0 } } });
  const d = page.data.detail;
  assert(d.canBuy === false, '筹码不足时不应判定可购买');
  assert(d.kind === 'reserved', '仍是预留卡详情');
  // 关键：不能掉进「预留」分支 —— 已经在预留区的卡再预留一次没有意义
  assert(page.data.pick.mode === 'buy', '买不起的预留卡仍应保持购买语义：' + page.data.pick.mode);
  assert(page.data.pick.canSubmit === false, '买不起时主按钮必须不可提交');
  assert(page.data.pick.reason.length > 0, '买不起时须说明原因：' + page.data.pick.reason);
  assert(page.data.pick.reason.indexOf('差') > 0 || page.data.pick.reason.indexOf('不足') > 0,
    '原因应说明还差多少：' + page.data.pick.reason);
  assert(d.actionNote.indexOf('筹码不足') >= 0, '弹层说明应提示筹码不足：' + d.actionNote);
  page.onCloseDetail();
  console.log('OK  预留卡买不起 · 保持购买语义 / 不可提交 / 说明缺口');
}

/* ---------- 房间默认无机器人；点空席即可安排 ---------- */
page.onLeaveRoom();
page.onCreateRoom();
assert(page.data.roomScreen.botCount === 0, '新开的房间默认不加机器人');
assert(page.data.roomScreen.seats[1].canToggleBot === true, '空席提供「设为机器人」');
tap('onRoomSeatTap', { index: 2 });
assert(page.data.roomScreen.botCount === 1, '点空席即可加入机器人');
assert(page.data.roomScreen.seats[2].seatAction === '取消机器人', '机器人席位可撤回');
tap('onRoomSeatTap', { index: 2 });
assert(page.data.roomScreen.botCount === 0, '再点一次即撤回机器人');
page.room.seats[1] = Object.assign({}, page.room.seats[1], {
  joined: true, uid: 'guest-b', name: '好友乙', nickname: '好友乙'
});
page.refresh('');
tap('onRoomSeatTap', { index: 1 });
assert(page.data.roomScreen.botCount === 0, '已入席的好友不会被改成机器人');
assert(page.data.roomScreen.notice.indexOf('已有好友') >= 0, '给出「已有好友」提示');
page.onLeaveRoom();
console.log('OK  席位交互 · 默认无机器人 / 点空席加入 / 再点撤回 / 好友席位保护');

/* ---------- 断线提示进入视图模型 ---------- */
page.ui.netNotice = '网络中断 · 正在重连…';
page.refresh('');
assert(page.data.netNotice.indexOf('网络中断') >= 0, '断线提示应进入视图模型');
page.ui.netNotice = '';
page.refresh('');
assert(page.data.netNotice === '', '恢复后提示应清除');
console.log('OK  断线重连提示 · 状态行可承载 / 可清除');

/* ---------- 冷启动重连：有会话时 onShow 自动回到房间 ---------- */
const RS = require(ROOT + '/utils/room.js');
const origHasCloud = RS.hasCloud;
const origJoin = RS.cloudJoinRoom;
RS.hasCloud = function () { return true; };
let joinCalls = 0;
RS.cloudJoinRoom = function () { joinCalls += 1; return new Promise(function () {}); };
RS.saveSession({ code: 'ABC123', seat: 1, screen: 'room', at: Date.now() });
page.onShow();
assert(joinCalls === 1, '有会话时 onShow 应自动发起一次入席');
assert(page.ui.homeNotice.indexOf('ABC123') >= 0, '应提示正在回到原房间');
assert(page._resuming === true, '重连过程中应处于 resuming 状态');
// 无会话时不应打扰用户
RS.clearSession();
page._resuming = false;
page._joining = false;
joinCalls = 0;
page.onShow();
assert(joinCalls === 0, '没有会话时 onShow 不应发起入席');
RS.cloudJoinRoom = origJoin;
RS.hasCloud = origHasCloud;
console.log('OK  冷启动重连 · 有会话自动入席 / 无会话静默');

/* ---------- 号位标注：牌桌每个席位都要能对上是几号 ---------- */
page.mode = 'room';
page.mySeat = 0;
page.openRoom();
page.room.seats[0] = Object.assign({}, page.room.seats[0], { name: '房主甲', nickname: '房主甲', uid: 'host-a' });
page.room.seats[1] = Object.assign({}, page.room.seats[1], {
  joined: true, uid: 'guest-b', name: '好友乙', nickname: '好友乙', ready: true
});
page.room.seats[2] = Object.assign({}, page.room.seats[2], {
  joined: true, uid: 'guest-c', name: '好友丙', nickname: '好友丙', ready: true
});
// 以 2 号位（好友视角）看大厅
page.mySeat = 1;
page.refresh('');
assert(page.data.roomScreen.seats[0].seatNo === 1 && page.data.roomScreen.seats[2].seatNo === 3, '大厅席位要带号位序号');
assert(page.data.roomScreen.seats[0].initial === '房', '无头像时用昵称首字占位，而不是号位数字');
page.onRoomStart();   // 非房主不能开局，先切回房主
assert(page.ui.screen === 'room', '非房主不能开局');
page.mySeat = 0;
page.refresh('');
page.onRoomStart();
assert(page.ui.screen === 'game', '全员就绪后房主可开局');
// 本用例只验「号位标注」口径，把本局 1 号位锚点钉回索引 0 保持确定性；
// 随机抽出 1 号位后的编号与终局由下面的专项用例覆盖。
page.state.startSeat = 0;
page.state.current = 0;
page.refresh('');
assert(page.data.meSeatLabel === '1 号位', '本机工作台标注自己的号位');
assert(page.data.rivals.length === 2, '其余席位进入顶部条');
assert(page.data.rivals[0].seatNo === 2 && page.data.rivals[1].seatNo === 3, '对手席位条带号位');
assert(page.data.rivals[0].seatLabel === '2 号位', '副标题用「n 号位」表述');
// 开局先手已改为随机（不再恒为房主），本用例只验「号位标注」口径，
// 所以把 current 钉回 1 号位再做断言；先手随机性由下面的专项用例覆盖。
page.state.current = 0;
page.refresh('');
assert(page.data.statusText.indexOf('你的回合 · 1 号位') === 0, '回合状态行含号位：' + page.data.statusText);
assert(page.data.statusLong === false, '自己的状态行用大字号，不降档');
page.mySeat = 1;
page.refresh('');
assert(page.data.statusText.indexOf('1 号位') >= 0, '看别人回合时也标号位：' + page.data.statusText);
assert(page.data.statusLong === true, '别人的状态行更长，降档保住单行：' + page.data.statusText);
page.mySeat = 0;
page.refresh('');
console.log('OK  号位标注 · 席位条 / 工作台 / 状态行同一口径');

/* ---------- 随机 1 号位：不能恒为房主，号位编号与起始/末位必须自洽 ---------- */
{
  const E2 = require(ROOT + '/utils/game-engine.js');
  const R2 = require(ROOT + '/utils/room.js');

  // 分布：4 人局每个席位都应有机会抽到 1 号位
  const seen = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 2000; i++) seen[R2.randomFirstSeat(4)] += 1;
  const each = Object.keys(seen).filter(function (k) { return seen[k] > 300; });
  assert(each.length === 4, '4 人局四个席位都应能抽到 1 号位：' + JSON.stringify(seen));

  // 边界：单人 / 非法人数回退 0，绝不返回越界值
  assert(R2.randomFirstSeat(1) === 0, '单人局 1 号位恒为索引 0');
  assert(R2.randomFirstSeat(0) === 0, '人数为 0 时回退 0');
  assert(R2.randomFirstSeat(-3) === 0, '负数人数回退 0');

  // 引擎只改行动起点，不动 players 排列（席位索引是身份锚点）
  const seats = [{ name: 'A', uid: 'a' }, { name: 'B', uid: 'b' }, { name: 'C', uid: 'c' }];
  const g = E2.createGame({ playerCount: 3, seats: seats, firstSeat: 2 });
  assert(g.current === 2, '引擎接受 firstSeat 作为行动起点');
  assert(g.startSeat === 2, '起始席位写进 state，随快照下发给所有端');
  assert(g.players.length === 3, '人数不变');
  assert(g.players[0].name === 'A' && g.players[2].name === 'C', '席位顺序不被打乱，重连仍能按 uid 认回');
  // 号位从抽中的人起顺延：索引 2 = 1 号位 → 0 = 2 号位 → 1 = 3 号位（末位）
  assert(E2.seatNoOf(g, 2) === 1, '抽中的席位恒为 1 号位');
  assert(E2.seatNoOf(g, 0) === 2 && E2.seatNoOf(g, 1) === 3, '其余席沿座次顺延编号');
  assert(E2.seatNoOf(g, 1) === g.players.length, '末位号位 = 人数，终局在此收尾');
  assert(E2.createGame({ playerCount: 3, seats: seats }).current === 0, '不传 firstSeat 时仍是 0（人机局默认本机先手）');
  assert(E2.createGame({ playerCount: 3, seats: seats }).startSeat === 0, '人机局 1 号位锚点默认 0');
  assert(E2.createGame({ playerCount: 3, seats: seats, firstSeat: 99 }).current === 0, '越界 firstSeat 安全回退 0');
  // 老快照没有 startSeat：号位退回数组下标口径，不能整屏显示 1 号位
  const legacy = { players: [{}, {}, {}] };
  assert(E2.seatNoOf(legacy, 1) === 2, '缺 startSeat 的老快照按旧口径显示');

  // 页面级：房主开局后 current 落在合法范围，且补丁能带出「先手是谁」
  page.mode = 'room';
  page.mySeat = 0;
  page.openRoom();
  page.room.seats[0] = Object.assign({}, page.room.seats[0], { name: '房主甲', nickname: '房主甲', uid: 'host-a' });
  page.room.seats[1] = Object.assign({}, page.room.seats[1], { joined: true, uid: 'guest-b', name: '好友乙', nickname: '好友乙', ready: true });
  page.room.seats[2] = Object.assign({}, page.room.seats[2], { joined: true, uid: 'guest-c', name: '好友丙', nickname: '好友丙', ready: true });
  page.refresh('');
  page.onRoomStart();
  assert(page.ui.screen === 'game', '房主可开局');
  const cur = page.state.current;
  assert(cur >= 0 && cur < page.state.players.length, '1 号位席位在合法范围内：' + cur);
  assert(page.state.players.length === 3, '开局人数正确');
  assert(page.state.current === cur, '起始席位在开局后不再变动');
  assert(page.state.startSeat === cur, '1 号位锚点与起始行动者一致，随快照下发全场同口径');
  assert(JSON.parse(JSON.stringify(page.state)).startSeat === cur,
    'startSeat 必须随牌局快照 JSON 下发，不能只留在内存里（各端会各自编号）');
  // 房主（mySeat=0）未必是 1 号位，所有展示都必须按本局锚点换算
  const myNo = E2.seatNoOf(page.state, 0);
  assert(page.data.meSeatLabel === myNo + ' 号位', '工作台按本局号位显示自己：' + page.data.meSeatLabel);
  assert(page.data.seats[0].seatLabel === myNo + ' 号位', '席位条徽章按本局锚点标号位');
  assert(page.data.statusText.indexOf(E2.seatNoOf(page.state, cur) + ' 号位') >= 0,
    '状态行标当前行动者的本局号位：' + page.data.statusText);
  const firstFlags = page.data.seats.filter(function (x) { return x.isFirst; });
  assert(firstFlags.length === 1 && firstFlags[0].index === cur, '「先」徽章只贴本局 1 号位');
  assert(E2.seatNoOf(page.state, cur) === 1, '起始行动者恒显示为 1 号位');

  console.log('OK  随机 1 号位 · 分布覆盖四席 / 编号顺延 / 越界回退 / 席位顺序不变');
}

/* ---------- 悬浮菜单：避开微信胶囊、清晰标签、支持拖拽与边界钳制 ---------- */
{
  page.mode = 'room';
  page.mySeat = 0;
  page.ui.screen = 'game';
  page.refresh('');
  assert(page.data.menuOpen === false, '悬浮菜单默认收起停靠，不遮挡牌桌');
  assert(page.data.menuToggleLabel === '菜单', '收起态按钮应明确标出「菜单」：' + page.data.menuToggleLabel);
  assert(page.data.menuY >= 400, '默认停靠在底部安全区，避开微信右上角胶囊：y=' + page.data.menuY);
  assert(page.data.menuDirClass.indexOf('open-left') >= 0 && page.data.menuDirClass.indexOf('open-up') >= 0,
    '默认右下角停靠应向左上方展开');

  page.onToggleMenu();
  assert(page.data.menuOpen === true, '点击「菜单」应展开悬浮窗');
  assert(page.data.menuToggleLabel === '收起', '展开态按钮应显示「收起」：' + page.data.menuToggleLabel);

  // 拖拽：从右下角拖向左上角并验证边界钳制与展开方向自适应
  page.onMenuTouchStart({ touches: [{ clientX: 900, clientY: 500 }] });
  page.onMenuTouchMove({ touches: [{ clientX: 100, clientY: 50 }] });
  page.onMenuTouchEnd();
  assert(page.data.menuX < 540 && page.data.menuY < 260, '拖拽后菜单应移动到左上半区');
  assert(page.data.menuDirClass.indexOf('open-right') >= 0 && page.data.menuDirClass.indexOf('open-down') >= 0,
    '拖到左上方后展开方向应自动切为向右下：' + page.data.menuDirClass);

  // 拖拽结束后的残余点击不应误触发收起/展开
  const openAfterDrag = page.data.menuOpen;
  page.onToggleMenu();
  assert(page.data.menuOpen === openAfterDrag, '刚结束拖拽时的残余 tap 不应误切换菜单');
  page._menuSuppressTapUntil = 0;

  // 越界拖拽应钳制在舞台内
  page.onMenuTouchStart({ touches: [{ clientX: 100, clientY: 100 }] });
  page.onMenuTouchMove({ touches: [{ clientX: -2000, clientY: -2000 }] });
  page.onMenuTouchEnd();
  assert(page.data.menuX >= 10 && page.data.menuY >= 10, '越界拖拽必须被钳制在舞台内');

  // 复原默认位置与收起态
  page.ui.menuX = 1018;
  page.ui.menuY = 442;
  page._menuSuppressTapUntil = 0;
  page.onCloseMenu();
  assert(page.data.menuOpen === false, '可以收起菜单悬浮窗');

  // 点击自己头像直接触发个人资料；点击其他玩家头像触发玩家详情
  page.ui.screen = 'game';
  page.refresh('');
  page.onTapMyPortrait();
  assert(page.data.showProfile === true, '点击自己头像应直接打开个人资料');
  page.onCloseProfile();
  page.onTapPlayer({ currentTarget: { dataset: { index: 1 } } });
  assert(page.data.showPlayerDetail === true, '点击其他玩家头像应打开玩家详情');
  page.onClosePlayerDetail();

  // 非牌桌屏不应响应
  page.ui.screen = 'home';
  page.refresh('');
  page.onToggleMenu();
  assert(page.data.menuOpen === false, '非牌桌屏不响应菜单开关');

  console.log('OK  悬浮菜单 · 胶囊避让 / 中文标签 / 拖拽与方向自适应 / 非牌桌不响应');
}

/* ---------- 回合计时：建房选定 / 大厅可改 / 超时托管 ---------- */
const RT = require(ROOT + '/utils/room.js');
assert(RT.TURN_LIMITS.some(function (m) { return m.value === 10; }) &&
       RT.TURN_LIMITS.some(function (m) { return m.value === 30; }), '计时白名单应含 10 / 30 秒快棋档');
assert(RT.normTurnLimit(10) === 10 && RT.normTurnLimit(30) === 30, '新增档位应通过白名单归一化');
page.onLeaveRoom();
page.mode = 'room';
page.mySeat = 0;
page.ui.turnLimit = 90;
page.openRoom();
assert(page.room.turnLimit === 90, '建房时带上的计时应写入房间');
assert(page.data.roomScreen.turnLimitText === '90 秒', '大厅显示当前计时');
page.onRoomTurnLimit({ currentTarget: { dataset: { value: '10' } } });
assert(page.room.turnLimit === 10, '房主可选 10 秒快棋档');
page.onRoomTurnLimit({ currentTarget: { dataset: { value: '30' } } });
assert(page.room.turnLimit === 30, '房主可选 30 秒快棋档');
page.onRoomTurnLimit({ currentTarget: { dataset: { value: '120' } } });
assert(page.room.turnLimit === 120, '房主可在大厅改计时');
page.onRoomTurnLimit({ currentTarget: { dataset: { value: '45' } } });
assert(page.room.turnLimit === 120, '非法计时值应被忽略（白名单之外）');
page.onRoomTurnLimit({ currentTarget: { dataset: { value: '0' } } });
assert(page.room.turnLimit === 0 && page.data.roomScreen.turnLimitText === '不限时', '可切到不限时');
page.onRoomTurnLimit({ currentTarget: { dataset: { value: '60' } } });

page.beginRoomGame();
// 开局先手已随机；本用例验的是「轮到自己时的提醒与倒计时」，
// 所以把先手钉回房主 0 号席，避免随机性让用例本身变得不确定。
page.state.current = 0;
page.resetTurnUI();
page.refresh('');
assert(page.state.turnLimit === 60, '开局快照要带上限时，其他设备据此显示');
assert(page.data.turnClock.on === true, '限时局应显示倒计时');
assert(page.data.turnClock.text === '1:00', '开局显示满额：' + page.data.turnClock.text);
assert(page.data.turnClock.pct === 100, '进度条从满格开始');
assert(page.data.turnFlash && page.data.turnFlash.mine === true, '轮到自己时弹全屏提醒');
assert(page.data.turnFlash.title.indexOf('轮到你') === 0, '提醒文案：' + page.data.turnFlash.title);

// 时钟推进：把 Date.now 拨到 45 秒后，剩余应同步下降
const realNow = Date.now;
let fakeNow = realNow();
Date.now = function () { return fakeNow; };
fakeNow += 50000;
// 倒计时只推 turnClock 这一块：整页 setData 每秒一次会把 250+ 字段全量重推
const origSetData = page.setData;
let tickKeys = null;
page.setData = function (obj) { tickKeys = Object.keys(obj); origSetData(obj); };
page.tickClock();
page.setData = origSetData;
assert(tickKeys && tickKeys.length === 1 && tickKeys[0] === 'turnClock', '倒计时只 setData 计时块，不整页重推：' + JSON.stringify(tickKeys));
assert(page.data.turnClock.text === '0:10', '50 秒后应剩 10 秒：' + page.data.turnClock.text);
assert(page.data.turnClock.urgent === true, '最后 10 秒内转紧急态');
// 再多 16 秒：超时托管，牌局必须继续推进
const beforeTurn = page.state.turnCount;
fakeNow += 16000;
page.tickClock();
assert(page.state.turnCount > beforeTurn, '超时后应自动代打一手，牌局不卡死');
assert(page.state.current !== 0 || page.state.turnCount > beforeTurn, '代打后换手');
Date.now = realNow;

// 不限时局不跑倒计时
page.onRoomTurnLimit({ currentTarget: { dataset: { value: '0' } } });
page.beginRoomGame();
assert(page.data.turnClock.on === false, '不限时局不显示倒计时');
assert(page.data.turnClock.text === '—', '不限时显示占位符');
console.log('OK  回合计时 · 10/30/60/90/120/不限时 + 超时托管');

/* ---------- 超时强制托管：整个回合打完，含退还筹码 ---------- */
// 单独开一局人机，避免房间局的云端标志把 runForcedTurn 短路掉
page.onLeaveRoom();
page.startLocalGame();
{
  const AI = require(ROOT + '/utils/ai.js');
  const s = page.state;
  page.ui.screen = 'game';
  page.mySeat = 0;
  s.current = 0;
  s.turnLimit = 10;
  s.players[0].tokens = { white: 4, blue: 4, green: 4, red: 0, black: 0, gold: 2 };
  s.pendingDiscard = 3;
  s.pendingNoble = null;
  page._turnKey = page.turnKeyOf(s);
  page._turnStartAt = Date.now() - 20000;
  page._timeoutFired = false;

  const act = AI.chooseAction(s);
  assert(act.type === 'discard' && act.gems.length === 3, '退还阶段 AI 应给出完整退还方案');
  s.pendingDiscard = 20;
  const partial = AI.chooseAction(s);
  assert(partial.type === 'discard' && partial.gems.length > 0,
    '可退数量不足整批时也应先退一部分，不能退回 pass 把回合卡死');
  s.pendingDiscard = 3;

  const turnBefore = s.turnCount;
  page.onTurnTimeout();
  assert(s.pendingDiscard === 0, '退筹码阶段超时应被强制退完');
  assert(s.turnCount > turnBefore, '强制托管必须真正结束回合，而不是只代打一手');
  assert(page.ui.selectedGems.length === 0 && page.ui.discardPlan.length === 0,
    '强制托管应清空玩家未提交的选择篮');
}
console.log('OK  超时强制托管 · 退还筹码一次退完并结束回合');

/* ---------- 局内快捷聊天：面板 / 白名单 / 气泡 / 大表情 ---------- */
{
  // 上面的用例清空过 ui.bots，startLocalGame 造出的是两个真人席位；
  // 显式留一个机器人席位，才能验证「机器人回应」这条路径。
  page.state.players[1].isAI = true;
  page.ui.screen = 'game';
  // 聊天面板有防误触窗口（切 tab / 进选目标后极短时间内不接收点选）。
  // 用例里的连续调用是「零间隔连点」，必须先推进时间才等价于真人的两次点击。
  const C2 = require(ROOT + '/utils/chat.js');
  const realNowChat = Date.now;
  let chatNow = realNowChat();
  Date.now = function () { return chatNow; };
  function dwell(ms) { chatNow += (ms || 0); }

  page.onToggleChatPanel();
  assert(page.data.chat.open === true, '应能打开快捷聊天面板');
  assert(page.data.chat.texts.length >= 8 && page.data.chat.emojis.length >= 8, '面板应带预设短语与表情');
  page.onSwitchChatTab({ currentTarget: { dataset: { tab: 'emoji' } } });
  assert(page.data.chat.isEmoji === true && page.data.chat.isText === false, '两个 tab 互斥切换');

  // 防误触 ①：切完 tab 紧接着的那一下必须被拦下（真机上手指还没抬起）
  const beforeLock = page.ui.chatMessages.length;
  page.onSendQuickChat({ currentTarget: { dataset: { kind: 'emoji', id: 'e9' } } });
  assert(page.ui.chatMessages.length === beforeLock && page.ui.chatPendingEmoji === null,
    '切 tab 后的余波点击必须被防误触窗口拦下');
  assert(page.data.chat.tabLocked === true, 'VM 应暴露切 tab 的防误触锁');
  dwell(C2.TAB_DWELL_MS + 40);
  page.refresh('');
  assert(page.data.chat.tabLocked === false, '窗口过后锁应自动释放');

  // 表情改两步：选表情 → 选目标玩家 → 飞到目标头像上
  const beforeEmoji = page.ui.chatMessages.length;
  page.onSendQuickChat({ currentTarget: { dataset: { kind: 'emoji', id: 'e9' } } });
  assert(page.data.chat.isTarget === true, '表情应先进入「选择目标玩家」阶段');
  assert(page.data.chat.open === true, '选目标时面板保持打开');
  assert(page.data.chat.targets.length === page.state.players.length, '目标列表覆盖全部席位');
  assert(page.ui.chatMessages.length === beforeEmoji, '未选目标前不得发出消息');

  // 防误触 ②：连点两下表情时，第二下不得直接把表情投出去
  page.onPickChatTarget({ currentTarget: { dataset: { seat: 1 } } });
  assert(page.ui.chatMessages.length === beforeEmoji && page.data.chat.open === true,
    '进入选目标后的余波点击不得把表情投出去');
  assert(page.data.chat.targetLocked === true, 'VM 应暴露选目标的防误触锁');
  dwell(C2.TARGET_DWELL_MS + 40);

  page.onPickChatTarget({ currentTarget: { dataset: { seat: 99 } } });
  assert(page.ui.chatMessages.length === beforeEmoji, '越界席位不得发送');
  const realPending = page.ui.chatPendingEmoji;
  page.ui.chatPendingEmoji = { id: 'e9', icon: '💀', label: '伪造', tone: 'tomato', aim: 'throw' };
  page.onPickChatTarget({ currentTarget: { dataset: { seat: 1 } } });
  assert(page.ui.chatMessages.length === beforeEmoji, '伪造 preset 不得通过二次白名单校验');
  page.ui.chatPendingEmoji = realPending;
  page.onCancelChatTarget();
  assert(page.data.chat.isPick === true, '取消后回到选表情');
  page.onSendQuickChat({ currentTarget: { dataset: { kind: 'emoji', id: 'e9' } } });
  // 重新选表情会重置选目标窗口，等它过期再点目标
  dwell(C2.TARGET_DWELL_MS + 40);
  page.onPickChatTarget({ currentTarget: { dataset: { seat: 1 } } });
  assert(page.data.chat.open === false, '选定目标后面板应自动收起');
  assert(page.ui.chatMessages.length === beforeEmoji + 1, '定向表情应进入本机队列');
  const sent = page.ui.chatMessages[page.ui.chatMessages.length - 1];
  assert(sent.targetSeat === 1 && sent.tone === 'tomato', '消息应带目标席位与 tone');
  assert(page.data.chat.bubbles.some(function (b) { return b.isEmoji; }), '应渲染表情气泡');
  assert(page.data.chat.projectiles.length === 1, '表情应触发定向命中动画');
  const proj = page.data.chat.projectiles[0];
  assert(proj.isThrow === true && proj.isGift === false, '西红柿属于投掷类');
  assert(proj.motionStyle.indexOf('--dx:') === 0 && proj.targetStyle.indexOf('left:') === 0,
    '动画必须带起点、位移与目标坐标');
  const before = page.ui.chatMessages.length;
  page.onSendQuickChat({ currentTarget: { dataset: { kind: 'text', id: '自由输入违规内容' } } });
  page.onSendQuickChat({ currentTarget: { dataset: { kind: 'bogus', id: 't1' } } });
  assert(page.ui.chatMessages.length === before, '伪造 id / 非法 kind 必须被整条丢弃');
  page.onSendQuickChat({ currentTarget: { dataset: { kind: 'text', id: 't1' } } });
  assert(page.ui.chatMessages.length === before + 1, '合法快捷语应能发送');

  // 人机局机器人回表情只能进气泡，不能抢占玩家刚发出的全屏大表情：
  // 大表情动画 1600ms、机器人 700ms 就回，一旦也调 showChatFly 会把玩家动画掐掉。
  const botTask = timers.find(function (t) { return t.id === page._chatBotTimer && t.active; });
  assert(botTask, '人机局应安排机器人回应');
  const projCount = page.data.chat.projectiles.length;
  const msgCount = page.ui.chatMessages.length;
  botTask.active = false;
  botTask.fn();
  assert(page.ui.chatMessages.length === msgCount + 1, '机器人回应应进入消息队列');
  assert(page.data.chat.projectiles.length === projCount, '机器人回应不得抢占玩家的定向动画');

  // 真机「云已开通，但这一局是人机」：机器人照样要回，且不能往 room_code='local' 投递。
  // 用 hasCloud() 判断「是否联机局」是错的，它只表示云服务可用。
  const RS2 = require(ROOT + '/utils/room.js');
  const savedHasCloud = RS2.hasCloud;
  RS2.hasCloud = function () { return true; };
  page._cloudCode = '';
  const soloCount = page.ui.chatMessages.length;
  page.onSendQuickChat({ currentTarget: { dataset: { kind: 'text', id: 't2' } } });
  assert(page.ui.chatMessages.length === soloCount + 1, '云可用时人机局消息仍应本地可见');
  assert(timers.some(function (t) { return t.id === page._chatBotTimer && t.active; }),
    '云可用时人机局机器人仍应安排回应');
  RS2.hasCloud = savedHasCloud;

  page.onToggleChatPanel();
  assert(page.data.chat.open === true, '面板可再次打开');
  // 打开面板同样算一次内容刷新，落点前的余波点击不该发出消息
  dwell(C2.TAB_DWELL_MS + 40);
  page.onCloseChatPanel();
  assert(page.data.chat.open === false, '面板可关闭');
  Date.now = realNowChat;
}
// 本段产生的气泡 TTL / 机器人回应 / 换手提醒定时器全部作废，
// 避免后续「对手动作回放」用例 drain() 时被这些残留任务污染
timers.length = 0;
console.log('OK  局内快捷聊天 · 面板 / 白名单 / 气泡 / 大表情');

/* ---------- 对手动作回放：把 action 写进快照，其他设备重放 ---------- */
page.onLeaveRoom();
page.startLocalGame();
const st0 = page.state;
const movedCard = st0.board[2][0];
st0.board[2][0] = null;
const fakeAction = {
  id: 'a1-test', seat: 1, type: 'buyBoard', lv: 2, index: 0,
  card: { id: movedCard.id, level: movedCard.level, gem: movedCard.gem, points: movedCard.points, cost: movedCard.cost, name: movedCard.name, art: movedCard.art }
};
st0.lastAction = fakeAction;
page.mySeat = 0;
page.ui.showcase = null;
page._seenActionId = '';
page.replayRemoteAction(st0);
assert(page.ui.showcase && page.ui.showcase.mode === 'buy', '对手购卡要能重放展演');
assert(page.ui.showcase.card.name === movedCard.name, '重放用的是快照里的卡面，不依赖当前牌桌：' + page.ui.showcase.card.name);
assert(page.ui.showcase.remote === true, '重放的展演带 remote 标记');
page.ui.showcase = null;
page.replayRemoteAction(st0);
assert(page.ui.showcase === null, '同一快照只播一次');
st0.lastAction = { id: 'a1-blind', seat: 1, type: 'reserveDeck', lv: 0 };
page.replayRemoteAction(st0);
assert(page.ui.showcase && page.ui.showcase.blindBack === true, '盲抽预留对别人只显示牌背，不泄露牌面');
page.mySeat = 1;
st0.lastAction = { id: 'a0-own', seat: 0, type: 'take', gems: ['red', 'blue', 'white'] };
page._seenActionId = '';
page.ui.showcase = null;
page.replayRemoteAction(st0);
assert(page.ui.showcase && page.ui.showcase.mode === 'take', '取筹码动作也能重放');

// 自己做完动作时写进快照，供别人回放
page.mySeat = 1;
st0.current = 1;
st0.pendingDiscard = 0;
page.applyPlayerAction({ type: 'take', gems: ['red', 'blue', 'white'] });
assert(st0.lastAction && st0.lastAction.type === 'take', '本机动作也要写进快照');
assert(st0.lastAction.seat === 1, 'lastAction 记录发生座位');
assert(st0.lastAction.id === page._seenActionId, '自己的动作不该再被自己的轮询重放');
page.mySeat = 0;
console.log('OK  联机动作回放 · 购卡 / 盲抽 / 拿筹码 + 本机动作不重放');

/* ---------- 对手席位卡：红利（流派）/ 筹码（购买力）/ 预购数 ---------- */
page.ui.playerCount = 4;
page.ui.bots = [1, 2, 3];
page.startLocalGame();
page.mySeat = 0;
assert(page.data.rivals.length === 3, '4 人局应有 3 张对手席位卡');
page.data.rivals.forEach(function (r, i) {
  const p = page.state.players[r.index];
  assert(r.bonusCells.length === 5, '席位卡应固定 5 格红利');
  const bonusSum = r.bonusCells.reduce(function (a, c) { return a + c.num; }, 0);
  assert(bonusSum === p.cards.length, '红利合计应等于发展卡数（' + bonusSum + ' vs ' + p.cards.length + '）');
  r.bonusCells.forEach(function (c) {
    assert(c.num === (p.cards.filter(function (card) { return card.gem === c.key; }).length),
      '红利格应与该色卡数一致: ' + c.key);
  });
  assert(r.tokenCells.length === 6, '席位卡筹码应 5 宝石 + 黄金共 6 格');
  assert(r.tokenCells[5].isGold === true, '最后一格应为黄金');
  r.tokenCells.forEach(function (c) { assert(c.num === (p.tokens[c.key] || 0), '筹码格应与持有量一致: ' + c.key); });
  assert(r.reservedCount === p.reserved.length, '预购数应与预留卡数一致');
});
assert(page.data.rivals[0].bonusCells[0].zero === true, '开局零红利应淡显');
// 声望达到终局线后必须显示真实值，不能截断在 15
{
  const keep = page.state.players[1].points;
  page.state.players[1].points = 21;
  page.refresh('');
  const r1 = page.data.rivals[0];
  assert(r1.pointsText === '21', '声望超过 15 不得截断：' + r1.pointsText);
  assert(r1.pointsReached === true, '达到终局线应标记 reached');
  page.state.players[1].points = keep;
  page.refresh('');
}
console.log('OK  对手席位卡 · 红利 / 筹码 / 预购概览与真实状态一致');

/* ---------- 对手卡三行结构：五色折扣 / 五色筹码 + 黄金 / 零值仍可读 ---------- */
const gridState = page.state;
gridState.players[1].cards = [];
for (let ci = 0; ci < 12; ci++) {
  gridState.players[1].cards.push({ gem: 'white', points: 0, cost: {}, name: 'x', level: 1, art: ci });
}
gridState.players[1].tokens = { white: 10, blue: 0, green: 3, red: 0, black: 1, gold: 2 };
page.refresh('');
const rival0 = page.data.rivals[0];
const discRow = rival0.rows.discRow;
const tokenRow = rival0.rows.tokenRow;
assert(discRow.length === 5, '折扣行应固定 5 色');
assert(tokenRow.length === 6 && tokenRow[5].isGold === true, '筹码行应为 5 色 + 黄金末位');
assert(discRow[0].key === 'white' && tokenRow[0].key === 'white', '两行同序，白起');
assert(discRow.map(function (c) { return c.key; }).join(',') === 'white,blue,green,red,black', '折扣行顺序：白蓝绿红黑');
assert(tokenRow.map(function (c) { return c.key; }).join(',') === 'white,blue,green,red,black,gold', '筹码行顺序：五色 + 黄金');
assert(discRow[0].numText === '12' && discRow[0].wide === true, '折扣两位数应降一档');
assert(tokenRow[0].numText === '10' && tokenRow[0].wide === true, '筹码两位数应降一档');
// 零值必须仍然渲染 0（不再隐藏），只降权
assert(tokenRow[1].numText === '0' && tokenRow[1].zero === true, '零值筹码应显示 0 并标记 zero');
assert(discRow[2].numText === '0' && discRow[2].zero === true, '零值折扣同样显示 0');
assert(discRow[0].sqClass === 'sq-white', '方卡需带 sq-* 类名以绘制竖色条');
assert(tokenRow[5].numText === '2', '黄金独立计在筹码行末位');
assert(rival0.pointsText === String(gridState.players[1].points), '声望以文本形式下发，不做截断');
// 折扣格恒为深色方卡，绝不能标成「浅底深墨」——否则深墨字压深底，对比度掉到 1~2
assert(discRow.every(function (c) { return c.light === false; }),
  '折扣方卡是深底，light 必须恒为 false');
// 筹码圆格统一深底 + 本色描边，数字恒白，同样不应标 light
assert(tokenRow.every(function (c) { return c.light === false; }),
  '筹码圆格是深底，light 必须恒为 false');
console.log('OK  对手卡三行结构 · 五色同序 / 黄金末位 / 零值仍可读 / 两位数降档');

/* ---------- 多贵族同时满足：挂起挑选 / 门禁 / 选择后结算 / 远端重放 ---------- */
page.startLocalGame();
const stN = page.state;
stN.current = 0;
stN.turnCount = 0;
stN.players[0].cards = [];
['white', 'blue', 'black'].forEach(function (g) {
  for (let i = 0; i < 4; i++) stN.players[0].cards.push({ gem: g, points: 0, cost: {}, name: 'x', level: 1, art: i });
});
stN.players[0].points = 0;
stN.nobles = [
  { id: 'n1', title: '霜港勋爵', points: 3, claimedBy: -1, req: { white: 4, blue: 4, green: 0, red: 0, black: 0 } },
  { id: 'n2', title: '铸币大臣', points: 3, claimedBy: -1, req: { white: 4, blue: 0, green: 0, red: 0, black: 4 } }
];
const turnBeforeNoble = stN.turnCount;
const rN = page.applyPlayerAction({ type: 'pass' });
assert(rN === true, 'pass 触发回合结束应成功');
assert(stN.pendingNoble && stN.pendingNoble.seat === 0, '本机席位满足多贵族应挂起');
assert(stN.turnCount === turnBeforeNoble, '挂起期间回合不推进');
assert(page.data.nobleChoice && page.data.nobleChoice.mine === true, '本机应弹选择卡');
assert(page.data.nobleChoice.options.length === 2, '选择卡应列出两张贵族');
assert(page.data.nobleChoice.options[0].photoClass.indexOf('noble-photo-') === 0, '贵族选项应带肖像');
assert(page.data.statusText === '请挑选 1 张贵族', '状态行应提示挑选：' + page.data.statusText);
assert(page.data.hintText.indexOf('挑选') >= 0, '提示语应引导挑选');
// 挂起期间禁止其他动作
assert(page.applyPlayerAction({ type: 'take', gems: ['white'] }) === false, '挂起期间拿筹码应被拒绝');
assert(stN.pendingNoble !== null, '被拒绝的动作不影响挂起');
// 点选贵族：+3 声望 / 贵族离桌 / 展演 / 快照回放数据
page.ui.showcase = null;
page.onChooseNoble({ currentTarget: { dataset: { id: 'n2' } } });
assert(stN.pendingNoble === null, '选择后清除挂起');
assert(stN.players[0].points === 3, '贵族 +3 声望');
assert(stN.nobles.length === 1 && stN.nobles[0].id === 'n1', '选中的贵族离桌，另一张保留');
assert(stN.turnCount === turnBeforeNoble + 1, '选择后回合推进');
assert(stN.lastAction && stN.lastAction.type === 'chooseNoble', '选贵族动作要写进快照');
assert(stN.lastAction.noble && stN.lastAction.noble.id === 'n2', '快照要带贵族数据供对端重放');
assert(page.ui.showcase && page.ui.showcase.kind === 'noble', '选贵族应播贵族展演');
assert(page.ui.showcase.nobleVM.title === '铸币大臣', '展演显示选中的贵族');
// 别人在挑：等待横幅，不弹选择卡
stN.current = 1;
stN.pendingNoble = { seat: 1, options: ['n1'] };
stN.turnCount += 1;
page.refresh('');
assert(page.data.nobleChoice && page.data.nobleChoice.waiting === true, '别人挑选时本机显示等待');
assert(page.data.nobleChoice.mine === false, '别人挑选时不弹选择卡');
assert(page.data.statusText.indexOf('正在挑选贵族') >= 0, '状态行提示他人挑选中');
// 远端选贵族动作重放
stN.pendingNoble = null;
stN.lastAction = {
  id: 'a1-noble', seat: 1, type: 'chooseNoble',
  noble: { id: 'n1', title: '霜港勋爵', points: 3, req: { white: 4, blue: 4, green: 0, red: 0, black: 0 } }
};
page.ui.showcase = null;
page._seenActionId = '';
page.replayRemoteAction(stN);
assert(page.ui.showcase && page.ui.showcase.kind === 'noble', '远端选贵族也要能重放展演');
console.log('OK  多贵族挑选 · 挂起 / 门禁 / 结算 / 等待横幅 / 远端重放');

/* ---------- 终局提示：有人到 15 但本轮未走完 ---------- */
{
  page.onLeaveRoom();
  page.ui.soloCount = 2;
  page.onStartSolo();
  const s = page.state;
  s.players[1].points = 15;
  s.endAtTurn = s.turnCount + 3;
  page.refresh('');
  const en = page.data.endNotice;
  assert(en !== null, '有人达到 15 声望时必须给出终局提示');
  assert(en.leaderSeat === 2, '提示要指名是谁达标的号位：' + en.leaderSeat);
  assert(en.leftText.indexOf('3') >= 0, '提示要说明还剩几个回合：' + en.leftText);
  assert(page.data.gameOver === false, '此时牌局还没结束');
  // 牌局真正结束后，提示消失，结算排名表接管
  s.gameOver = true;
  s.winner = 1;
  page.refresh('');
  assert(page.data.endNotice === null, '结算后不应再显示终局提示');
}
console.log('OK  终局提示 · 指名达标者 / 剩余回合 / 结算后消失');

/* ---------- 结算排名表：名次、声望构成与逐色资源 ---------- */
{
  const rb = page.data.resultBoard;
  assert(rb && rb.rows.length === 2, '结算排名表应覆盖全部玩家');
  const me = rb.rows.filter(function (r) { return r.isMe; })[0];
  const bot = rb.rows.filter(function (r) { return r.seat === 1; })[0];
  assert(me && bot, '排名表应能定位到各席位');
  assert(rb.rows[0].rank === 1, '首行应为第 1 名');
  assert(rb.rows[0].isWinner === true, '第 1 名应标记为赢家');
  assert(bot.points === 15 && bot.rank === 1, '15 声望者应排第一：' + bot.points);
  // 声望构成必须能自洽：发展卡分 + 贵族分 ≤ 总分
  rb.rows.forEach(function (r) {
    assert(typeof r.cardPoints === 'number' && typeof r.noblePoints === 'number', '应给出声望构成');
    assert(r.disc.length === 5, '排名表折扣应为 5 色');
    assert(r.tok.length === 6 && r.tok[5].isGold === true, '排名表筹码应为 5 色 + 黄金');
    assert(String(r.points) === r.pointsText || r.points >= 0, '声望应为真实数值');
  });
  assert(typeof rb.champion === 'object' && rb.champion.rank === 1, '应给出冠军行');
  console.log('OK  结算排名表 · 名次 / 声望构成 / 逐色折扣与筹码');
}

/* ---------- 主动托管：不退出对局，席位由 AI 代打 ---------- */
{
  page.onLeaveRoom();
  page.ui.roomCount = 2;
  page.onCreateRoom();
  const seats = page.room.seats;
  seats[1] = Object.assign({}, seats[1], { joined: true, ready: true, isAI: false, name: '群友甲' });
  page.room.seats = seats;
  page.onRoomStart();
  assert(page.ui.screen === 'game', '联机局开局进入牌桌');
  const st = page.state;
  assert(page.data.canAutoPlay === true, '联机局应允许托管');
  assert(page.data.meAutoPlay === false, '默认未托管');
  page.onToggleAutoPlay();
  assert(st.players[0].autoPlay === true, '开启后应写入 autoPlay');
  assert(st.players[0].isAI === false, '托管不得改动 isAI（席位仍是真人）');
  assert(page.ui.screen === 'game', '托管不退出对局');
  assert(page.data.meAutoPlay === true, '视图模型应反映托管状态');
  // 托管后该席位满足托管判定，由房主代打
  assert(st.players[0].autoPlay || st.current !== 0, '托管席位应被接管');
  page.onToggleAutoPlay();
  assert(st.players[0].autoPlay === false, '可随时收回托管');
  console.log('OK  主动托管 · 不退出对局 / isAI 不变 / 可收回');
}

/* ---------- 联机局退出＝投降并转机器人托管 ---------- */
{
  // 造一个 4 人联机牌局：本机 1 号位，其余真人，房主是本机
  page.onLeaveRoom();
  page.ui.roomCount = 4;
  page.onCreateRoom();
  assert(page.mode === 'room', '创建房间应进入 room 模式');
  const seats = page.room.seats;
  // 真人席位必须「已加入 + 已准备」，房主才允许开局
  seats[1] = Object.assign({}, seats[1], { joined: true, ready: true, isAI: false, name: '群友甲' });
  seats[2] = Object.assign({}, seats[2], { joined: true, ready: true, isAI: false, name: '群友乙' });
  seats[3] = Object.assign({}, seats[3], { joined: true, ready: true, isAI: false, name: '群友丙' });
  page.room.seats = seats;
  page.onRoomStart();
  assert(page.ui.screen === 'game', '房主开局进入牌桌');
  const st = page.state;
  assert(st.players.length === 4, '4 人局');

  // 本机投降：该席位必须转成机器人，且牌局不被解散
  const startTurn = st.current;
  page.onQuitGame();
  assert(page.ui.screen === 'home', '投降后本机回大厅');
  assert(page.room === null, '本机不再绑定房间');
  // 投降时改的是同一份 state 引用，退出后仍可取到
  assert(st.players[0].isAI === true, '投降席位应转为机器人托管');
  assert(st.players[0].joined === false, '托管席位标记为未入席');
  assert(st.gameOver === false, '投降不应直接结束牌局');
  assert(st.current === startTurn, '投降不改变当前回合归属');
  console.log('OK  联机退出 · 席位转机器人托管 / 牌局继续 / 本机回大厅');
}

// 天梯榜：结算记账必须带齐六项指标，弹层数据层在任意屏幕都能打开且离线不抛错。
// 注意：前序「联机退出」用例把 page.state 置成了 null，这里必须自己造一份完整
// 结算态，不能依赖用例之间的遗留现场（全量回归曾在此崩于 state=null）。
{
  const U2 = require(ROOT + '/utils/user.js');
  const L2 = require(ROOT + '/utils/leaderboard.js');
  const E2 = require(ROOT + '/utils/game-engine.js');
  const savedState = page.state;
  const savedMode = page.mode;
  // 天梯只收「联机 + 真人≥2」的对局，所以本用例按联机 2 真人构造：
  // 两个席位都给 isAI=false，mode 切到 room，这样 maybeRecordResult 写出的记录
  // 才会被 leaderboard 判为合格。
  const st = E2.createGame({ playerCount: 2, seats: [{ name: '我', isAI: false }, { name: '对手', isAI: false }] });
  st.players.forEach(function (p) { p.isAI = false; p.type = 'remote'; });
  page.mode = 'room';
  const meSeat = page.mySeat || 0;
  st.gameOver = true;
  st.winner = meSeat;
  st.turnCount = 20;
  st.players[meSeat].points = 16;
  st.players[meSeat].cards = [{}, {}, {}];
  st.players[meSeat].nobles = [{}];
  st.players[1 - meSeat].points = 11;
  st.players[1 - meSeat].cards = [{}, {}];
  page.state = st;
  page._resultRecorded = false;
  page._gameStartedAt = Date.now() - 100000;   // 100s 前开局 → 5s/回合
  // 用累计量差值断言，不要依赖 recs[0]：战绩按 at 倒序，同一毫秒写入时
  // 新记录未必排第一，直接取首条会读到上一局的旧指标。
  const beforeRecs = U2.getRecords().slice();
  const beforeTotals = L2.fromRecords(beforeRecs);
  page.maybeRecordResult();
  const recs = U2.getRecords();
  assert(recs.length === beforeRecs.length + 1, '结算应记一条战绩');
  const totals = L2.fromRecords(recs);
  assert(totals.games === beforeTotals.games + 1, '天梯榜应多统计一局');
  assert(totals.totalTurns === beforeTotals.totalTurns + 20, '应累计本局回合数');
  assert(totals.totalTurnMs > beforeTotals.totalTurnMs, '应累计回合平均耗时');
  assert(totals.totalCards === beforeTotals.totalCards + 3, '应累计发展卡数');
  assert(totals.totalNobles === beforeTotals.totalNobles + 1, '应累计贵族数');
  assert(totals.wins === beforeTotals.wins + 1, '本局获胜应累计胜场');
  assert(totals.bestWinScore >= 16, '最高胜场声望应取到本局 16 分');

  page.onOpenLeaderboard();
  assert(page.data.showLeaderboard === true, '应打开天梯榜弹层');
  assert(page.data.leaderboard.rows.length >= 1, '至少展示本机一行');
  assert(page.data.leaderboard.hasMe === true, '应能定位自己的行');
  assert(page.data.leaderboard.formulaText.indexOf('胜率') >= 0, '评分口径要写在界面上');
  page.onCloseLeaderboard();
  assert(page.data.showLeaderboard === false, '天梯榜可关闭');
  // 恢复现场，不要污染后面的「对局中改资料」用例
  page.state = savedState;
  page.mode = savedMode;
  page._resultRecorded = true;
  console.log('OK  天梯榜 · 结算指标落库 / 弹层 / 综合评分口径');
}

// 天梯准入：人机局即便赢了也不进榜。判定在 leaderboard.eligible，
// 记账时只负责如实写下 mode 与真人数，不在页面层做业务裁剪。
{
  const U3 = require(ROOT + '/utils/user.js');
  const L3 = require(ROOT + '/utils/leaderboard.js');
  const E3 = require(ROOT + '/utils/game-engine.js');
  const savedState = page.state;
  const savedMode = page.mode;

  // ① 人机局：本机 + 1 个机器人
  const solo = E3.createGame(2);
  solo.gameOver = true;
  solo.winner = 0;
  solo.turnCount = 10;
  solo.players[0].points = 15;
  page.state = solo;
  page.mode = 'solo';
  page.mySeat = 0;
  page._resultRecorded = false;
  page._gameStartedAt = Date.now() - 50000;
  const idsBefore = U3.getRecords().map(function (r) { return r.id; });
  page.maybeRecordResult();
  const added = U3.getRecords().filter(function (r) { return idsBefore.indexOf(r.id) < 0; });
  assert(added.length === 1, '本次结算应恰好新增 1 条记录，实际 ' + added.length);
  const soloRec = added[0];
  assert(soloRec.mode === 'solo', '人机局记录 mode=solo');
  assert(soloRec.humanCount === 1, '人机局只有 1 名真人：' + soloRec.humanCount);
  assert(L3.eligible(soloRec) === false, '人机局不进天梯');

  // ② 联机 4 人房 2 机器人补位：仍只有 2 真人，属于合格局。
  // 注意引擎约定：seat.isAI 不显式给时会按「除 0 号外都是机器人」默认，
  // 所以真人席位必须显式写 isAI:false（makeSeats 就是这么做的）。
  const room = E3.createGame({ playerCount: 4, seats: [
    { name: '我', type: 'remote', isAI: false }, { name: '好友', type: 'remote', isAI: false },
    { name: '机器人 3', isAI: true }, { name: '机器人 4', isAI: true }
  ] });
  let humans = 0;
  room.players.forEach(function (p) { if (!p.isAI) humans += 1; });
  room.gameOver = true;
  room.winner = 0;
  room.turnCount = 12;
  room.players[0].points = 15;
  page.state = room;
  page.mode = 'room';
  page._resultRecorded = false;
  page._gameStartedAt = Date.now() - 60000;
  const idsBefore2 = U3.getRecords().map(function (r) { return r.id; });
  page.maybeRecordResult();
  const added2 = U3.getRecords().filter(function (r) { return idsBefore2.indexOf(r.id) < 0; });
  assert(added2.length === 1, '本次结算应恰好新增 1 条记录');
  const roomRec = added2[0];
  assert(roomRec.humanCount === humans && humans === 2, '4 人房 2 机器人补位时真人数为 2：' + roomRec.humanCount);
  assert(L3.eligible(roomRec) === true, '联机 2 真人局进天梯');

  // ③ 联机但只有 1 真人（其余机器人）：不算合格
  const one = E3.createGame({ playerCount: 2, seats: [{ name: '我', type: 'remote' }, { name: '机器人', isAI: true }] });
  one.gameOver = true;
  one.winner = 0;
  one.turnCount = 8;
  one.players[0].points = 15;
  page.state = one;
  page.mode = 'room';
  page._resultRecorded = false;
  page._gameStartedAt = Date.now() - 40000;
  const idsBefore3 = U3.getRecords().map(function (r) { return r.id; });
  page.maybeRecordResult();
  const added3 = U3.getRecords().filter(function (r) { return idsBefore3.indexOf(r.id) < 0; });
  assert(added3.length === 1, '本次结算应恰好新增 1 条记录');
  const oneRec = added3[0];
  assert(oneRec.humanCount === 1, '联机 1 真人 1 机器人真人数为 1');
  assert(L3.eligible(oneRec) === false, '联机但只有 1 名真人不进天梯');

  page.state = savedState;
  page.mode = savedMode;
  page._resultRecorded = true;
  console.log('OK  天梯准入 · 人机局与单真人局不计入 / 2 真人合格');
}

// 榜单合并策略：本机行只在「确实比云端新」时覆盖，且 0 局不入榜。
// 这两条决定了不同玩家打开榜单看到的是不是同一份数据。
{
  const L4 = require(ROOT + '/utils/leaderboard.js');
  const R4 = require(ROOT + '/utils/room.js');
  const savedUi = page.ui.leaderboard;
  const savedShow = page.ui.showLeaderboard;
  const origGetCloud = R4.getCloud;
  const origHasCloud = R4.hasCloud;
  const myUid = page.profile.uid;
  const g = global;

  // 直接把「本机已记录的战绩」注入 leaderboard 读取路径：
  // 页面用 U.getRecords() 现算本机条目，这里替换它比写真存储更可控。
  function fakeRecords(n) {
    const list = [];
    for (let i = 0; i < n; i++) {
      list.push({ id: 'r' + i, mode: 'room', humanCount: 2, win: false, score: 9,
        cards: 5, nobles: 0, turns: 10, turnAvgMs: 5000, at: Date.now() - i });
    }
    return list;
  }

  function cloudWith(rows) {
    const q = {
      from: function () { return q; }, select: function () { return q; },
      order: function () { return q; }, limit: function () { return q; },
      then: function (ok) { return Promise.resolve({ data: rows, error: null }).then(ok); }
    };
    R4.getCloud = function () { return { database: { from: function () { return q; } } }; };
    R4.hasCloud = function () { return true; };
  }

  g.__runMergeCase = function (rows, localGames) {
    cloudWith(rows);
    g.__localGames = localGames;
    return page.loadLeaderboard();
  };

  // loadLeaderboard 内部读 U.getRecords()。这里用 monkey patch 让本机局数可控。
  const U4 = require(ROOT + '/utils/user.js');
  const origGetRecords = U4.getRecords;
  const mineOnCloud1 = L4.entryOf(myUid, '我', '', L4.fromRecords(fakeRecords(1)));
  const other1 = L4.entryOf('wx:other', '别人', '', L4.fromRecords(fakeRecords(1)));
  const mineOnCloud3 = L4.entryOf(myUid, '我', '', L4.fromRecords(fakeRecords(3)));

  (async function () {
    try {
      // ① 本机 1 局 == 云端 1 局 → 用云端，不覆盖
      U4.getRecords = function () { return fakeRecords(1); };
      page.ui.showLeaderboard = true;
      await g.__runMergeCase([L4.entryToCloud(other1), L4.entryToCloud(mineOnCloud1)], 1);
      let vm = page.ui.leaderboard;
      assert(vm && vm.rows.length === 2, '应渲染云端 2 行，实际 ' + (vm ? vm.rows.length : 'null'));
      assert(vm.rows.some(function (r) { return r.isMe; }), '应能定位我的行');

      // ② 本机 3 局 > 云端 1 局 → 用本机覆盖
      U4.getRecords = function () { return fakeRecords(3); };
      await g.__runMergeCase([L4.entryToCloud(other1), L4.entryToCloud(mineOnCloud1)], 3);
      vm = page.ui.leaderboard;
      const meRow = vm.rows.filter(function (r) { return r.isMe; })[0];
      assert(meRow && meRow.gamesText === '3', '本机较新时应用本机 3 局，实际 ' + (meRow && meRow.gamesText));

      // ③ 本机 1 局 < 云端 3 局 → 用云端，不被本机旧值拉回去
      U4.getRecords = function () { return fakeRecords(1); };
      await g.__runMergeCase([L4.entryToCloud(other1), L4.entryToCloud(mineOnCloud3)], 1);
      vm = page.ui.leaderboard;
      const meRow2 = vm.rows.filter(function (r) { return r.isMe; })[0];
      assert(meRow2 && meRow2.gamesText === '3', '云端较新时应保留云端 3 局，实际 ' + (meRow2 && meRow2.gamesText));

      // ④ 本机 0 局且云端没有我 → 不许追加
      U4.getRecords = function () { return fakeRecords(0); };
      await g.__runMergeCase([L4.entryToCloud(other1)], 0);
      vm = page.ui.leaderboard;
      assert(vm.rows.length === 1, '0 局时不得把自己追加进榜，实际 ' + vm.rows.length + ' 行');
      assert(!vm.rows.some(function (r) { return r.isMe; }), '0 局不应出现在榜单上');

      console.log('OK  榜单合并 · 云端较新用云端 / 本机较新才覆盖 / 0 局不入榜');
    } finally {
      U4.getRecords = origGetRecords;
      delete g.__runMergeCase;
      delete g.__localGames;
      R4.getCloud = origGetCloud;
      R4.hasCloud = origHasCloud;
      page.ui.leaderboard = savedUi;
      page.ui.showLeaderboard = savedShow;
    }
  })();
}

// 对局中改资料：联机快照会整份替换 state.players，资料补丁必须在每次
// refresh 前幂等重贴，否则 1.6s 轮询后就被旧快照打回原形。
{
  const oldNick = page.profile.nickname;
  const oldAvatar = page.profile.avatar;
  if (!page.state || !page.state.players) {
    page.state = { players: [{ nickname: '云端旧名', name: '云端旧名', avatar: 'a0' }] };
  }
  page.profile = Object.assign({}, page.profile, { nickname: '牌桌改名', avatar: 'a7' });
  const st = page.state;
  st.players[page.mySeat].nickname = '云端旧名';
  st.players[page.mySeat].name = '云端旧名';
  page.refresh('');
  assert(st.players[page.mySeat].nickname === '牌桌改名', '旧快照覆盖后应幂等贴回本机新昵称');
  assert(page.data.meName === '牌桌改名', '视图模型应使用新昵称');
  console.log('OK  对局中资料 · 旧快照覆盖后幂等贴回');
  // 保存路径：资料里已有头像时不能因重跑图片压缩而让昵称保存静默失效
  page.ui.profileDraft = {
    nickname: '新昵称保存', avatar: 'a7',
    avatarUrl: page.profile.avatarUrl || ''   // 与现值相同 = 本次没换头像
  };
  page.onSaveProfile();
  // Promise.then 是 microtask，setImmediate 回调一定在它之后；
  // onUnload 也必须放到这里，否则 _unloaded 会提前拦掉保存回调。
  setImmediate(function () {
    try {
      assert(page.profile.nickname === '新昵称保存', '对局中保存昵称应写回 profile');
      assert(st.players[page.mySeat].nickname === '新昵称保存', '保存后席位立即生效');
      console.log('OK  对局中资料 · 已有头像时改昵称不再被压缩失败拖死');
      page.profile = Object.assign({}, page.profile, { nickname: oldNick, avatar: oldAvatar });
      /* ---------- 一局一条：进场已结束快照 / 复位记账状态 / 伪耗时 ---------- */
      {
        const Ux = require(ROOT + '/utils/user.js');
        const Ex = require(ROOT + '/utils/game-engine.js');
        const savedState = page.state;
        const savedMode = page.mode;
        const savedRecorded = page._resultRecorded;
        const savedStarted = page._gameStartedAt;
        const beforeN = Ux.getRecords().length;

        // ① 进场撞上已结束快照：不补记战绩，也不把进场时刻当开局时刻
        const ended = Ex.createGame({ playerCount: 2, seats: [{ isAI: false }, { isAI: false }] });
        ended.gameId = 'g-enter-ended';
        ended.gameOver = true; ended.winner = 0; ended.turnCount = 101;
        page.state = null;
        page._resultRecorded = false;
        page._gameStartedAt = 123456;
        page.adoptCloudState(ended, true);
        assert(page._resultRecorded === true, '进场拿到已结束快照应阻止记账');
        assert(page._gameStartedAt === 123456, '进场不应重置计时起点');
        page.maybeRecordResult();
        assert(Ux.getRecords().length === beforeN, '已结束快照不应补记一条战绩');

        // ② 同一 gameId 被复位后仍不重复记（模拟冷启动 / 重连）
        const dup = Ex.createGame({ playerCount: 2, seats: [{ isAI: false }, { isAI: false }] });
        dup.gameId = 'g-dup-once';
        dup.gameOver = true; dup.winner = page.mySeat || 0; dup.turnCount = 20;
        page.mode = 'room';
        page.state = dup;
        page._resultRecorded = false;
        page._gameStartedAt = Date.now() - 100000;
        page.maybeRecordResult();
        assert(Ux.getRecords().length === beforeN + 1, '第一次结算记一条');
        page._resultRecorded = false;
        page.maybeRecordResult();
        assert(Ux.getRecords().length === beforeN + 1, '同一 gameId 复位后不得再记一条');

        // ③ 505ms / 101 行动这种伪耗时必须归零
        const dirty = Ex.createGame({ playerCount: 2, seats: [{ isAI: false }, { isAI: false }] });
        dirty.gameId = 'g-dirty-ms';
        dirty.gameOver = true; dirty.winner = page.mySeat || 0; dirty.turnCount = 101;
        page.state = dirty;
        page._resultRecorded = false;
        page._gameStartedAt = Date.now() - 505;
        page.maybeRecordResult();
        const dirtyRec = Ux.getRecords().filter(function (r) { return r.gameId === 'g-dirty-ms'; })[0];
        assert(dirtyRec && dirtyRec.turnAvgMs === 0,
          '伪耗时应记 0，实际 ' + (dirtyRec && dirtyRec.turnAvgMs));

        page.state = savedState;
        page.mode = savedMode;
        page._resultRecorded = savedRecorded;
        page._gameStartedAt = savedStarted;
        console.log('OK  一局一条 · 已结束快照不补记 / gameId 去重 / 伪耗时归零');
      }
      /* ---------- 房主踢人：按钮门禁 / 席位释放 / 被踢感知 ---------- */
      {
        page.onLeaveRoom();
        page.onCreateRoom();
        assert(page.data.screen === 'room', '踢人专项：应进入房间界面');
        page.room.seats[1] = Object.assign({}, page.room.seats[1], {
          joined: true, uid: 'kick-runtime-guest', name: '群友丙', nickname: '群友丙', ready: false
        });
        page.refresh('');
        assert(page.data.roomScreen.seats[1].canKick === true, '房主对已入席真人可移出');
        assert(page.data.roomScreen.seats[0].canKick === false, '房主不能移出自己 / 0 号席');
        assert(page.data.roomScreen.seats[2].canKick === false, '空席不显示移出按钮');
        tap('onRoomToggleBot', { index: 2 });
        assert(page.data.roomScreen.seats[2].canKick === false, '机器人席不显示移出按钮');
        tap('onRoomToggleBot', { index: 2 });

        // 非房主视角 / 对局态都不给按钮
        page.mySeat = 2;
        page.refresh('');
        assert(page.data.roomScreen.seats.every(function (s) { return !s.canKick; }),
          '非房主看不到任何移出按钮');
        page.mySeat = 0;
        page.room.status = 'playing';
        page.refresh('');
        assert(page.data.roomScreen.seats.every(function (s) { return !s.canKick; }),
          '牌局进行中不显示移出按钮');
        page.room.status = 'lobby';
        page.refresh('');

        // 点击移出：席位释放为空真人席，人数与空席数同步变化
        tap('onRoomKick', { index: 1 });
        const kickedSeat = page.room.seats[1];
        assert(kickedSeat.uid === '' && kickedSeat.joined === false && kickedSeat.ready === false,
          '移出后席位释放为空真人席');
        assert(kickedSeat.isAI === false, '移出不自动补机器人');
        assert(page.data.roomScreen.joinedHumans === 1, '人数回到只有房主');
        assert(page.data.roomScreen.emptyCount === page.data.roomScreen.seats.length - 1,
          '移出后除房主外全是空席，实际 ' + page.data.roomScreen.emptyCount + '/' + page.data.roomScreen.seats.length);
        assert(page.data.roomScreen.seats[1].canKick === false, '释放后不再显示移出按钮');
        const beforeEmpty = JSON.stringify(page.room.seats[2]);
        tap('onRoomKick', { index: 2 });
        assert(JSON.stringify(page.room.seats[2]) === beforeEmpty, '空席点击移出不应改动席位');

        // 被踢感知（纯逻辑）：房主永不误判；非房主 uid 消失即判定被移出
        page.room.seats[1] = Object.assign({}, page.room.seats[1], {
          joined: true, uid: page.profile.uid, name: '我', nickname: '我', ready: false
        });
        page.mySeat = 1;
        assert(page.seatStillMine(page.room.seats) === true, '席位里还有自己 uid 时未被移出');
        const afterKickSeats = page.room.seats.slice();
        afterKickSeats[1] = Object.assign({}, afterKickSeats[1], { uid: '', joined: false, ready: false });
        assert(page.seatStillMine(afterKickSeats) === false, '自己 uid 从席位表消失 = 已被移出');
        page.mySeat = 0;
        assert(page.seatStillMine(afterKickSeats) === true, '房主永不判定为被移出');

        // 被踢感知（真实轮询接线）：云端拉回「自己已不在席位表」的房间行时，
        // pollCloud 必须自动清会话回首页，而不是继续留在房间里空转。
        const Rx = require(ROOT + '/utils/room.js');
        const fakeQ = {
          select: function () { return fakeQ; },
          eq: function () { return fakeQ; },
          maybeSingle: function () {
            return Promise.resolve({ data: {
              code: 'KICK01', host_uid: 'host-uid', player_count: afterKickSeats.length,
              seats: afterKickSeats, status: 'lobby', turn_limit: 0, version: 99
            }, error: null });
          },
          then: function (resolve) { resolve({ data: [], error: null }); }
        };
        Rx.attachCloud({ database: { from: function () { return fakeQ; } } });
        page._unloaded = false;
        page.mySeat = 1;
        page.ui.screen = 'room';
        page.room.code = 'KICK01';
        page.room.status = 'lobby';
        page._cloudCode = 'KICK01';
        page._polling = false;
        page.pollCloud(true);
        console.log('OK  房主踢人 · 按钮门禁 / 席位释放 / 被踢轮询已触发');
      }
      // pollCloud 是 Promise 链，等 microtask 排空后再做最终断言与收尾
      setImmediate(function () {
        try {
          assert(page.data.screen === 'home', '轮询发现被移出后应自动回到首页');
          assert(page.room === null, '被移出后应释放房间引用');
          assert(page.ui.homeNotice.indexOf('重新输入房间号加入') > 0, '应提示可重新加入');
          require(ROOT + '/utils/room.js').attachCloud(null);
          console.log('OK  被踢感知 · 轮询自动回首页 / 会话作废 / 允许重入');
          // UI/UX 规范检查：动态非法筹码暗化 / 浮动增量 / 震动反馈
          let vibrated = 0;
          global.wx.vibrateShort = function () { vibrated += 1; };
          page.ui.soloCount = 2;
          page.onStartSolo();
          page.onTapPile({ currentTarget: { dataset: { key: 'white' } } });
          page.onTapPile({ currentTarget: { dataset: { key: 'white' } } });
          const bluePile = page.data.bankPiles.filter(function (p) { return p.key === 'blue'; })[0];
          const whitePile = page.data.bankPiles.filter(function (p) { return p.key === 'white'; })[0];
          assert(bluePile.illegal === true && whitePile.illegal === false, '选 2 枚同色后其余颜色应标 illegal 暗化');
          page.onConfirmTake();
          assert(page.data.floatTokenDeltas.length === 1 && page.data.floatTokenDeltas[0].text === '+2',
            '拿取 2 枚筹码后应产生 +2 浮动增量');
          assert(vibrated > 0, '交互与确认动作应触发 wx.vibrateShort');
          delete global.wx.vibrateShort;
          console.log('OK  UI/UX 规范 · 非法暗化 / +2 浮动增量 / wx.vibrateShort');

          /* ---------- 超时立即代打：整回合一个计时 / 自动席位不进托管 / 单点权威 ---------- */
          {
            const Rx = require(ROOT + '/utils/room.js');
            const seatRows = [
              { index: 0, uid: page.profile.uid, name: '房主', nickname: '房主', isAI: false, joined: true, ready: true, type: 'self' },
              { index: 1, uid: 'guest-a', name: '甲', nickname: '甲', isAI: false, joined: true, ready: true, type: 'remote' },
              { index: 2, uid: 'guest-b', name: '乙', nickname: '乙', isAI: false, joined: true, ready: true, type: 'remote' }
            ];
            page.onLeaveRoom();
            page.mode = 'room';
            page.mySeat = 0;
            page._cloudCode = '';
            page.room = {
              code: 'TIME01', mode: 'room', backend: 'local', status: 'lobby',
              playerCount: 3, turnLimit: 10, seats: seatRows
            };
            page.beginRoomGame();
            const st = page.state;

            // 一个回合只该有一个计时起点：退还 / 挑贵族是同一回合的子步骤
            const k0 = page.turnKeyOf(st);
            st.pendingDiscard = 3;
            assert(page.turnKeyOf(st) === k0, '退还子步骤不应重置回合计时');
            st.pendingDiscard = 0;
            st.pendingNoble = { seat: 0, options: [1, 2] };
            assert(page.turnKeyOf(st) === k0, '多贵族挑选也不应重置回合计时');
            st.pendingNoble = null;

            // 机器人席位由 scheduleAi 硬编码驱动，不进入超时托管
            st.current = 2;
            st.players[2].isAI = true;
            page._timeoutFired = false;
            const botTurn = st.turnCount;
            page.onTurnTimeout();
            assert(st.turnCount === botTurn, '机器人席位不进入超时托管');
            st.players[2].isAI = false;

            // 别人超时：拨到刚好 10 秒（over=0）就必须立即打完整个回合，
            // 旧实现在云端联机下还要再等 12 秒宽限（static.js 另有源码守卫）
            st.current = 1;
            st.turnLimit = 10;
            const realNow3 = Date.now;
            let fake3 = realNow3();
            Date.now = function () { return fake3; };
            page.resetTurnUI();
            page.refresh('');
            const beforeTimeout = st.turnCount;
            fake3 += 10000;
            page.tickClock();
            Date.now = realNow3;
            assert(page.state.turnCount > beforeTimeout,
              '倒计时归 0 立即由 AI 打完整个回合并换手，不再等 12 秒');
            assert(page.state.current !== 1 || page.state.gameOver, '代打后应换手');

            // 单点权威：云端联机的非房主设备不本地推进，避免抢写与记错结算战绩
            const origHasCloud = Rx.hasCloud;
            Rx.hasCloud = function () { return true; };
            page.mySeat = 1;
            page.state.current = 0;
            page.resetTurnUI();
            page.refresh('');
            page._timeoutFired = false;
            const guestTurn = page.state.turnCount;
            page.onTurnTimeout();
            assert(page.state.turnCount === guestTurn, '云端非房主不得本地代打');
            assert(page._timeoutFired === true, '非房主本回合只提示一次，不反复刷');
            Rx.hasCloud = origHasCloud;
            page.mySeat = 0;
            console.log('OK  超时立即代打 · 整回合单计时 / 自动席位放行 / 房主单点权威');
          }

          /* ---------- 菜单「重新开始」：人机确认 / 联机投票 ---------- */
          {
            const origModal = global.wx.showModal;
            let confirmVal = false;
            global.wx.showModal = function (opt) { opt.success({ confirm: confirmVal }); };

            // 人机局：取消确认不重开，确认才换局（用 gameId 判定，不用易变的字段）
            page.onLeaveRoom();
            page.mode = 'solo';
            page.mySeat = 0;
            page.startLocalGame();
            const soloGid = page.state.gameId;
            page._menuSuppressTapUntil = 0;
            page.ui.menuOpen = true;
            page.onMenuRestart();
            assert(page.state.gameId === soloGid, '人机局取消确认不应重开');
            confirmVal = true;
            page.onMenuRestart();
            assert(page.state.gameId !== soloGid, '人机局确认后应开新局');

            // 联机局：3 位在场真人，房主发起投票
            page.mode = 'room';
            page.mySeat = 0;
            page._cloudCode = '';
            page.room = {
              code: 'VOTE01', mode: 'room', backend: 'local', status: 'lobby',
              playerCount: 3, turnLimit: 0,
              seats: [
                { index: 0, uid: page.profile.uid, name: '房主', nickname: '房主', isAI: false, joined: true, ready: true, type: 'self' },
                { index: 1, uid: 'guest-a', name: '甲', nickname: '甲', isAI: false, joined: true, ready: true, type: 'remote' },
                { index: 2, uid: 'guest-b', name: '乙', nickname: '乙', isAI: false, joined: true, ready: true, type: 'remote' }
              ]
            };
            page.beginRoomGame();
            page._menuSuppressTapUntil = 0;
            page.onMenuRestart();
            assert(page.state && !page.state.gameOver,
              '联机菜单重开不得直接重置牌桌，应进入投票');
            const vote = page.state.resetVote;
            assert(vote && vote.status === 'open', '房主发起重开投票');
            assert(vote.votes[page.profile.uid] === true, '发起人自动赞成');
            assert(vote.gameId === page.state.gameId, '投票绑定本局 gameId');
            page.refresh('');
            const vm0 = page.data.resetVote;
            assert(vm0 && vm0.rows.length === 3, '弹层列出三位在场真人');
            assert(vm0.canAgree === false, '房主已投票，不再显示同意按钮');
            assert(vm0.note.indexOf('1/3') > 0, '票数显示 1/3：' + vm0.note);

            // 其余真人依次投票：第二人同意仍 open，第三人不同意立即否决
            const realUid = page.profile.uid;
            page.mySeat = 1; page.profile.uid = 'guest-a';
            page.onResetVoteAgree();
            assert(page.state.resetVote.votes['guest-a'] === true, '第二人同意');
            assert(page.state.resetVote.status === 'open', '还有一人未投，保持 open');
            page.mySeat = 2; page.profile.uid = 'guest-b';
            page.onResetVoteReject();
            assert(page.state.resetVote.status === 'rejected', '任一真人不同意立即否决');
            assert(page.state.resetVote.rejectedBy === '乙', '记录否决者供弹层展示');
            page.mySeat = 0; page.profile.uid = realUid;
            page.refresh('');
            assert(page.data.resetVote.status === 'rejected' && page.data.resetVote.canRestart === true,
              '否决结果可见，房主可重新发起');

            // 重新发起换 id，旧的「收起」状态不再生效
            const rejectedId = page.state.resetVote.id;
            page.onResetVoteRestart();
            assert(page.state.resetVote.status === 'open', '房主可重新发起');
            assert(page.state.resetVote.id !== rejectedId, '新投票换 id');

            // 收起只对本次 open 有效
            page.refresh('');
            page.onCloseResetVote();
            assert(page.data.resetVote === null, '收起后弹层隐藏');
            page.onMenuRestart();
            assert(page.data.resetVote && page.data.resetVote.status === 'open', '从菜单可重新展开投票');

            // 其余真人全部同意 → 房主自动回大厅重新准备
            page.state.resetVote.votes['guest-a'] = true;
            page.state.resetVote.votes['guest-b'] = true;
            page.state.resetVote.status = 'passed';
            page.refresh('');
            assert(page.ui.screen === 'room', '全员同意后房主自动回大厅');
            assert(page.state === null, '回大厅后作废本局 state');

            // 非房主不能发起
            page.beginRoomGame();
            page.mySeat = 1;
            page._menuSuppressTapUntil = 0;
            page.onMenuRestart();
            assert(!page.state.resetVote, '非房主不能发起重开投票');
            assert(page.ui.toast.indexOf('只有房主') >= 0, '提示仅房主可发起');
            page.mySeat = 0;

            // 换局失效：把旧投票挂到新 gameId 上，弹层不应再出现
            const stale = { id: 'stale', gameId: 'other-game', byUid: realUid, byName: '房主', votes: {}, status: 'open' };
            stale.votes[realUid] = true;
            page.state.resetVote = stale;
            page.refresh('');
            assert(page.data.resetVote === null, '上一局的投票不应在新局显示');

            global.wx.showModal = origModal;
            console.log('OK  菜单重开 · 人机二次确认 / 发起门禁 / 同意否决 / 全员通过回大厅 / 换局失效');
          }

          /* ---------- 昵称敏感字：所有展示出口都必须脱敏 ----------
             第四十六轮只覆盖了「榜单 + 席位 + me.nameText」三个出口，实际还有
             一堆直接读 .nickname 的地方（大厅昵称、回合提示、结算标题、终局提示、
             贵族等待、超时提示、踢人确认、邀请弹窗、分享卡片…）。逐处改完后，
             用「整份视图模型 + 页面可见文案都不许出现敏感字」反过来锁死。 */
          {
            const Nick = require(ROOT + '/utils/nickname.js');
            const RAW = '康师傅';
            const MASKED = '*师傅';
            assert(Nick.maskName(RAW) === MASKED, '前置：脱敏函数本身应命中');

            // 造一局 2 人局：自己叫 RAW，对手也带敏感字
            page.onStartSolo();
            page.ui.screen = 'game';
            page.profile.nickname = RAW;
            page.state.players[0].nickname = RAW;
            page.state.players[0].name = RAW;
            page.state.players[1].nickname = '小康';
            page.state.players[1].name = '小康';
            page.mySeat = 0;
            page.applySelfProfileToState();
            page.refresh('');

            // 1) 牌桌视图模型：除设置页输入框（按设计保留原字可编辑）外不得出现原字
            const gameData = JSON.parse(JSON.stringify(page.data));
            if (gameData.profileDialog) gameData.profileDialog.nickname = '';
            const gameJson = JSON.stringify(gameData);
            assert(gameJson.indexOf('康') < 0,
              '牌桌视图模型不得残留敏感字，出现位置：' +
              (gameJson.indexOf('康') >= 0 ? gameJson.slice(Math.max(0, gameJson.indexOf('康') - 60), gameJson.indexOf('康') + 40) : ''));

            // 2) 大厅：自己的昵称也是公开展示位
            page.ui.screen = 'home';
            page.refresh('');
            assert(page.data.home.nickname === MASKED, '大厅昵称应脱敏：' + page.data.home.nickname);
            assert(page.data.home.initial === '*', '大厅头像首字应脱敏');

            // 3) 房间大厅席位（自己的席位走 profile 分支，最容易漏）
            page.ui.screen = 'room';
            if (page.room) {
              page.room.seats[0].nickname = RAW;
              page.room.seats[0].name = RAW;
            }
            page.refresh('');
            assert(JSON.stringify(page.data.roomScreen || {}).indexOf('康') < 0, '房间层不得残留敏感字');

            // 4) 分享卡片 desc 也要脱敏（会直接显示给别人看）
            const RS = require(ROOT + '/utils/room.js');
            const share = RS.shareMessage({ code: '123456', playerCount: 2 }, { nickname: RAW });
            assert(share.desc.indexOf('康') < 0, '分享卡片描述不得出现敏感字：' + share.desc);
            assert(share.desc.indexOf(MASKED) >= 0, '分享卡片应显示脱敏后的昵称');

            // 5) 设置页必须保留原字，否则用户没法编辑自己的昵称
            page.ui.showProfile = true;
            page.refresh('');
            assert(page.data.profileDialog.nickname === RAW, '设置页输入框应保留原字可编辑');

            // 6) 聊天：发送时脱敏，气泡也不得露出原字
            page.ui.screen = 'game';
            page.refresh('');
            if (!page.ui.chatPanelOpen) page.onToggleChatPanel();
            page.ui.chatTabSwitchAt = 0;
            page.onSendQuickChat({ currentTarget: { dataset: { kind: 'text', id: 't1' } } });
            const lastMsg = page.ui.chatMessages[page.ui.chatMessages.length - 1];
            assert(lastMsg && lastMsg.name.indexOf('康') < 0, '聊天消息携带的昵称应脱敏：' + (lastMsg && lastMsg.name));
            assert(JSON.stringify(page.data.chat).indexOf('康') < 0, '聊天视图模型不得残留敏感字');

            // 还原，避免影响后续用例
            page.profile.nickname = '珠宝商';
            page.ui.showProfile = false;
            page.ui.chatMessages = [];
            page.refresh('');
            console.log('OK  昵称脱敏 · 牌桌/大厅/房间/分享/聊天全出口覆盖，设置页保留原字');
          }

          /* ---------- 娱乐模式：模式入口 / 增益 / 技能端到端 ---------- */
          {
            // 首页选娱乐模式：模式目录里应可选
            page.ui.screen = 'home';
            page.ui.lobbyMode = 'standard';
            page.onSelectMode({ currentTarget: { dataset: { key: 'entertainment' } } });
            assert(page.ui.lobbyMode === 'entertainment', '首页可选娱乐模式');
            assert(page.data.home.modes.some(function (m) { return m.key === 'entertainment' && m.available; }), 'VM 暴露娱乐模式且可用');

            // 开一局人机娱乐模式
            page.onStartSolo();
            assert(page.state && page.state.mode === 'entertainment', '开局写入娱乐模式');
            assert(page.data.isEntertainment === true, '牌桌 VM 标记娱乐模式');
            assert(page.data.buffPick.open === true, '本机未选增益时弹出选择层');
            assert(page.data.buffPick.list.length === 3, '增益选择层列出 3 个');

            // 选「富矿」
            const tokBefore = page.state.players[0].tokens;
            const total0 = ['white','blue','green','red','black','gold'].reduce(function (s, g) { return s + tokBefore[g]; }, 0);
            page.onPickBuff({ currentTarget: { dataset: { id: 'rich' } } });
            assert(page.state.entertainment.buffs[0] === 'rich', '增益写入 state');
            assert(page.data.buffPick.open === false, '选完关闭增益层');
            const total1 = ['white','blue','green','red','black','gold'].reduce(function (s, g) { return s + page.state.players[0].tokens[g]; }, 0);
            assert(total1 === total0 + 2 || total1 <= 10, '富矿增加筹码且不超 10');
            // 机器人席位自动补齐增益
            for (let i = 1; i < page.state.players.length; i++) {
              assert(!!page.state.entertainment.buffs[i], '机器人席位 ' + i + ' 自动选了增益');
            }

            // 技能面板：把当前回合设回本机，确保能开面板
            page.state.current = 0;
            page.state.pendingDiscard = 0; page.state.pendingNoble = null;
            page.onOpenSkillPanel();
            assert(page.data.skill.open === true, '本人回合可打开技能面板');
            assert(page.data.skill.list.length === 2, '列出两个技能');

            // 选窃取 -> 选目标（对手 1 号席先给点筹码）
            page.state.players[1].tokens.blue = Math.max(3, page.state.players[1].tokens.blue);
            const p0blue = page.state.players[0].tokens.blue, p1blue = page.state.players[1].tokens.blue;
            const cur = page.state.current, turn = page.state.turnCount;
            page.onSelectSkill({ currentTarget: { dataset: { id: 'steal' } } });
            assert(page.data.skill.pending === 'steal', '进入目标选择态');
            page.onPickSkillTarget({ currentTarget: { dataset: { seat: 1 } } });
            assert(page.state.players[0].tokens.blue + page.state.players[1].tokens.blue === p0blue + p1blue, '窃取双方蓝色总量守恒');
            assert(page.state.turnCount === turn + 1 || page.state.current !== cur, '技能消耗整回合');
            assert(page.data.skill.open === false, '用完后关闭技能面板');
            assert(page.state.entertainment.used[0].steal === 1, '记录技能使用次数');

            // 复原模式，避免影响后续（虽然已到末尾）
            page.ui.lobbyMode = 'standard';
            console.log('OK  娱乐模式 · 模式入口 / 增益选择 / 窃取技能 / 回合消耗');
          }

          page.onUnload();
          console.log('ALL RUNTIME CHECKS PASSED');
        } catch (e2) {
          console.error(String((e2 && e2.message) || e2));
          process.exitCode = 1;
        }
      });
    } catch (e) {
      console.error(String((e && e.message) || e));
      process.exitCode = 1;
    }
  });
}
