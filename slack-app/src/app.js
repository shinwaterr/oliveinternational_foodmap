// 올리브인터내셔널 맛지도 슬랙 앱
//   /matjip [메뉴 또는 검색어]   맛집 찾기 (예: /matjip 일식, /matjip 텐동)
//   /mwomeokji [메뉴]            오늘 뭐 먹지? 무작위 추천
//   /lunchmeet                   랜덤 런치밋 신청·현황 (운영자는 조 편성)
// Socket Mode 로 동작하므로 공개 서버 주소(URL)가 필요 없습니다. PC나 사내 서버에서 `npm start` 만 켜 두면 됩니다.
require('dotenv').config();
const { App, LogLevel } = require('@slack/bolt');
const L = require('./logic');
const B = require('./blocks');
const store = require('./store');

const ADMINS = new Set((process.env.ADMIN_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));
const isAdmin = (userId) => ADMINS.has(userId);
const lunchChannel = (body) => process.env.LUNCHMEET_CHANNEL || body.channel?.id || body.channel_id;

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: process.env.DEBUG ? LogLevel.DEBUG : LogLevel.INFO,
});

const listTitle = (q) => {
  const k = L.findCategory(q);
  if (!q) return '전체 맛집';
  return k ? `${L.CAT[k].emoji} ${L.CAT[k].name}` : `"${q}" 검색 결과`;
};

/* ---------------- /matjip ---------------- */
app.command('/matjip', async ({ command, ack, respond }) => {
  await ack();
  const q = (command.text || '').trim();
  const blocks = q ? B.matjipList(listTitle(q), L.search(q), 0, q) : B.matjipHome();
  await respond({ response_type: 'ephemeral', text: '올리브인터내셔널 맛지도', blocks });
});

app.action(/^cat_/, async ({ ack, action, respond }) => {
  await ack();
  const key = action.value;
  await respond({ replace_original: true, text: '맛집 목록', blocks: B.matjipList(listTitle(key), L.search(key), 0, key) });
});

app.action(/^page_(prev|next)$/, async ({ ack, action, respond }) => {
  await ack();
  const { q, p } = JSON.parse(action.value);
  await respond({ replace_original: true, text: '맛집 목록', blocks: B.matjipList(listTitle(q), L.search(q), p, q) });
});

app.action('matjip_home', async ({ ack, respond }) => {
  await ack();
  await respond({ replace_original: true, text: '올리브인터내셔널 맛지도', blocks: B.matjipHome() });
});

// 길안내 버튼은 링크(카카오맵)로 바로 열리지만, 슬랙은 클릭 신호도 보내므로 응답만 해 줍니다.
app.action(/^route_/, async ({ ack }) => ack());

/* ---------------- /mwomeokji ---------------- */
app.command('/mwomeokji', async ({ command, ack, respond }) => {
  await ack();
  const category = L.findCategory(command.text);
  const r = L.pickRandom({ category });
  await respond({ response_type: 'ephemeral', text: '오늘 뭐 먹지?', blocks: B.pickResult(r, category) });
});

app.action('pick_again', async ({ ack, action, respond }) => {
  await ack();
  const { c, last } = JSON.parse(action.value);
  await respond({ replace_original: true, text: '오늘 뭐 먹지?', blocks: B.pickResult(L.pickRandom({ category: c, exceptId: last }), c) });
});

app.action(/^pick_(?!again$|share$)/, async ({ ack, action, respond }) => {
  await ack();
  const c = action.value;
  await respond({ replace_original: true, text: '오늘 뭐 먹지?', blocks: B.pickResult(L.pickRandom({ category: c }), c) });
});

app.action('pick_share', async ({ ack, action, body, respond }) => {
  await ack();
  const r = L.byId(Number(action.value));
  if (!r) return;
  await respond({
    response_type: 'in_channel',
    replace_original: false,
    text: `오늘 점심 추천: ${r.name}`,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `🎲 <@${body.user.id}> 님의 오늘 점심 추천!` } }, B.restaurantSection(r)],
  });
});

/* ---------------- /lunchmeet ---------------- */
function panel(userId) {
  const round = store.currentRound();
  return B.lunchmeetPanel({ round, list: store.signups(round), me: userId, result: store.getResult(round), isAdmin: isAdmin(userId) });
}

app.command('/lunchmeet', async ({ command, ack, respond }) => {
  await ack();
  await respond({ response_type: 'ephemeral', text: '랜덤 런치밋', blocks: panel(command.user_id) });
});

app.action('lm_status', async ({ ack, body, respond }) => {
  await ack();
  await respond({ response_type: 'ephemeral', replace_original: false, text: '랜덤 런치밋', blocks: panel(body.user.id) });
});

app.action('lm_join_open', async ({ ack, body, client }) => {
  await ack();
  const round = store.currentRound();
  if (store.getResult(round)) {
    await client.chat.postEphemeral({ channel: body.channel?.id || body.user.id, user: body.user.id, text: '이번 회차는 조 편성이 끝났어요. 다음 회차에 신청해 주세요!' }).catch(() => {});
    return;
  }
  await client.views.open({ trigger_id: body.trigger_id, view: B.joinModal(round) });
});

app.view('lm_join_submit', async ({ ack, view, body, client }) => {
  const team = (view.state.values.team.v.value || '').trim();
  if (!team) {
    await ack({ response_action: 'errors', errors: { team: '소속 팀을 적어주세요.' } });
    return;
  }
  await ack();
  const prefs = (view.state.values.prefs?.v?.selected_options || []).map((o) => o.value);
  const round = view.private_metadata || store.currentRound();
  store.join(body.user.id, team, prefs, round);
  await client.chat.postMessage({
    channel: body.user.id,
    text: `🙌 ${L.prettyDate(round)} 런치밋 신청 완료! 조 편성이 끝나면 알려드릴게요. 신청 현황은 /lunchmeet 에서 볼 수 있어요.`,
  });
});

app.action('lm_cancel', async ({ ack, body, respond }) => {
  await ack();
  store.cancel(body.user.id);
  await respond({ replace_original: true, text: '랜덤 런치밋', blocks: panel(body.user.id) });
});

/* ----- 운영자 전용 ----- */
async function adminOnly(body, respond) {
  if (isAdmin(body.user.id)) return true;
  await respond({ response_type: 'ephemeral', replace_original: false, text: '운영자만 쓸 수 있는 기능이에요.' });
  return false;
}

app.action('lm_announce', async ({ ack, body, client, respond }) => {
  await ack();
  if (!(await adminOnly(body, respond))) return;
  const round = store.currentRound();
  await client.chat.postMessage({ channel: lunchChannel(body), text: '랜덤 런치밋 참여자 모집!', blocks: B.announcement(round) });
});

app.action('lm_match', async ({ ack, body, client, respond }) => {
  await ack();
  if (!(await adminOnly(body, respond))) return;
  const round = store.currentRound();
  const list = store.signups(round);
  if (list.length < 2) {
    await respond({ response_type: 'ephemeral', replace_original: false, text: '2명 이상 신청해야 조를 편성할 수 있어요.' });
    return;
  }
  const groups = L.makeGroups(list);
  store.setResult(groups, round);
  const result = store.getResult(round);
  await client.chat.postMessage({ channel: lunchChannel(body), text: '런치밋 조 편성 결과', blocks: B.resultPost(round, result, list) });
  // 참여자 각자에게 우리 조 알림
  for (const [i, g] of groups.entries()) {
    const p = L.byId(g.placeId);
    const mates = g.members.map((id) => `<@${id}>`).join(' ');
    for (const id of g.members) {
      await client.chat
        .postMessage({ channel: id, text: `🎉 ${L.prettyDate(round)} 런치밋 ${i + 1}조예요! 조원: ${mates}${p ? ` · 식당: ${p.name}` : ''}`, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `🎉 *${L.prettyDate(round)} 런치밋 ${i + 1}조*\n조원: ${mates}` } }, ...(p ? [B.restaurantSection(p)] : [])] })
        .catch((e) => console.error('DM 실패', id, e.data?.error || e.message));
    }
  }
  await respond({ replace_original: true, text: '랜덤 런치밋', blocks: panel(body.user.id) });
});

app.action('lm_clear', async ({ ack, body, respond }) => {
  await ack();
  if (!(await adminOnly(body, respond))) return;
  store.clearResult();
  await respond({ replace_original: true, text: '랜덤 런치밋', blocks: panel(body.user.id) });
});

app.action('lm_date_open', async ({ ack, body, client, respond }) => {
  await ack();
  if (!(await adminOnly(body, respond))) return;
  await client.views.open({ trigger_id: body.trigger_id, view: B.dateModal(store.currentRound()) });
});

app.view('lm_date_submit', async ({ ack, view, body }) => {
  const d = view.state.values.date.v.selected_date;
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  if (!d || d < today) {
    await ack({ response_action: 'errors', errors: { date: '오늘 이후 날짜를 골라주세요.' } });
    return;
  }
  if (!isAdmin(body.user.id)) {
    await ack({ response_action: 'errors', errors: { date: '운영자만 바꿀 수 있어요.' } });
    return;
  }
  await ack();
  store.setRoundDate(d);
});

app.error(async (err) => console.error('⚠️', err));

(async () => {
  for (const k of ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN']) {
    if (!process.env[k]) {
      console.error(`.env 파일에 ${k} 가 없습니다. README 의 설치 순서를 확인해 주세요.`);
      process.exit(1);
    }
  }
  await app.start();
  console.log(`🍱 맛지도 슬랙 앱이 켜졌어요. 운영자 ${ADMINS.size}명 · 저장 파일 ${store.FILE}`);
})();
