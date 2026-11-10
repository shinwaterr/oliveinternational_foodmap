// 실제 슬랙 대신 가짜 Bolt 로 app.js 의 모든 명령·버튼 처리 코드를 실행해 봅니다.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const os = require('os'); const fs = require('fs'); const path = require('path');

process.env.DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lmh-')), 'lunchmeet.json');
process.env.SLACK_BOT_TOKEN = 'xoxb-test'; process.env.SLACK_APP_TOKEN = 'xapp-test';
process.env.ADMIN_USER_IDS = 'UADMIN'; process.env.LUNCHMEET_CHANNEL = 'CLUNCH';

const H = { command: {}, action: [], view: {} };
class FakeApp {
  command(n, f) { H.command[n] = f; }
  action(m, f) { H.action.push([m, f]); }
  view(n, f) { H.view[n] = f; }
  error() {}
  async start() {}
}
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@slack/bolt') return { App: FakeApp, LogLevel: {} };
  if (req === 'dotenv') return { config() {} };
  return origLoad.call(this, req, ...rest);
};
require('../src/app');

const findAction = (id) => { const h = H.action.find(([m]) => (m instanceof RegExp ? m.test(id) : m === id)); assert.ok(h, 'no handler ' + id); return h[1]; };
function ctx(extra = {}) {
  const out = { responds: [], posts: [], views: [], acks: [] };
  const c = {
    ack: async (x) => out.acks.push(x ?? true),
    respond: async (m) => out.responds.push(m),
    client: { chat: { postMessage: async (m) => out.posts.push(m), postEphemeral: async (m) => out.posts.push(m) }, views: { open: async (v) => out.views.push(v) } },
    ...extra,
  };
  return [c, out];
}
const allActionIds = (blocks) => blocks.flatMap((b) => (b.type === 'actions' ? b.elements : b.accessory ? [b.accessory] : [])).map((e) => e.action_id);

test('명령어·버튼 전체 흐름', async () => {
  let [c, o] = ctx({ command: { text: '', user_id: 'U1' } });
  await H.command['/matjip'](c); assert.strictEqual(o.responds[0].blocks[0].text.text, '🏢 올리브인터내셔널 맛지도');
  [c, o] = ctx({ command: { text: '일식', user_id: 'U1' } });
  await H.command['/matjip'](c); assert.match(o.responds[0].blocks[0].text.text, /일식/);
  const next = o.responds[0].blocks.at(-1).elements.find((e) => e.action_id === 'page_next');
  [c, o] = ctx({ action: next }); await findAction('page_next')(c); assert.match(o.responds[0].blocks[0].text.text, /7–/);
  [c, o] = ctx({ action: { action_id: 'cat_중식', value: '중식' } }); await findAction('cat_중식')(c); assert.match(o.responds[0].blocks[0].text.text, /중식/);
  [c, o] = ctx({ command: { text: '텐동', user_id: 'U1' } }); await H.command['/matjip'](c); assert.match(o.responds[0].blocks[0].text.text, /텐동/);

  [c, o] = ctx({ command: { text: '중식', user_id: 'U1' } }); await H.command['/mwomeokji'](c);
  const again = o.responds[0].blocks[2].elements[0];
  [c, o] = ctx({ action: again }); await findAction('pick_again')(c); assert.ok(o.responds[0].blocks[1].text.text.includes('🥟'));
  [c, o] = ctx({ action: { action_id: 'pick_일식', value: '일식' } }); await findAction('pick_일식')(c); assert.ok(o.responds[0].blocks[1].text.text.includes('🍣'));
  [c, o] = ctx({ action: { value: '24' }, body: { user: { id: 'U1' } } }); await findAction('pick_share')(c); assert.strictEqual(o.responds[0].response_type, 'in_channel');

  // 런치밋: 일반 사용자는 운영자 버튼 없음
  [c, o] = ctx({ command: { user_id: 'U1' } }); await H.command['/lunchmeet'](c);
  assert.ok(!allActionIds(o.responds[0].blocks).includes('lm_match'));
  [c, o] = ctx({ body: { user: { id: 'U1' }, trigger_id: 't' } }); await findAction('lm_join_open')(c); assert.strictEqual(o.views[0].view.callback_id, 'lm_join_submit');
  // 팀 빈칸이면 에러
  const view = (team, prefs = []) => ({ private_metadata: '', state: { values: { team: { v: { value: team } }, prefs: { v: { selected_options: prefs.map((v) => ({ value: v })) } } } } });
  [c, o] = ctx({ view: view(''), body: { user: { id: 'U1' } } }); await H.view['lm_join_submit'](c); assert.strictEqual(o.acks[0].response_action, 'errors');
  const teams = ['인사팀', '인사팀', '개발팀', '개발팀', '영업팀', '재무팀', '마케팅팀'];
  for (const [i, t] of teams.entries()) { [c, o] = ctx({ view: view(t, i % 2 ? ['일식'] : []), body: { user: { id: 'U' + i } } }); await H.view['lm_join_submit'](c); assert.strictEqual(o.posts.length, 1); }
  // 일반 사용자가 편성 시도 → 거절
  [c, o] = ctx({ body: { user: { id: 'U1' } } }); await findAction('lm_match')(c); assert.match(o.responds[0].text, /운영자만/);
  // 운영자: 공지·편성
  [c, o] = ctx({ body: { user: { id: 'UADMIN' }, channel: { id: 'CX' } } }); await findAction('lm_announce')(c); assert.strictEqual(o.posts[0].channel, 'CLUNCH');
  [c, o] = ctx({ body: { user: { id: 'UADMIN' }, channel: { id: 'CX' } } }); await findAction('lm_match')(c);
  assert.strictEqual(o.posts[0].channel, 'CLUNCH'); assert.strictEqual(o.posts.length, 1 + teams.length, '채널 결과 1 + 개인 알림 7');
  assert.ok(allActionIds(o.responds[0].blocks).includes('lm_clear'));
  // 편성 후 신청 → 막힘
  [c, o] = ctx({ body: { user: { id: 'U99' }, trigger_id: 't', channel: { id: 'CX' } } }); await findAction('lm_join_open')(c); assert.strictEqual(o.views.length, 0);
  [c, o] = ctx({ body: { user: { id: 'UADMIN' } } }); await findAction('lm_clear')(c);
  [c, o] = ctx({ body: { user: { id: 'U1' } } }); await findAction('lm_cancel')(c);
  // 날짜 변경
  [c, o] = ctx({ view: { state: { values: { date: { v: { selected_date: '2000-01-01' } } } } }, body: { user: { id: 'UADMIN' } } }); await H.view['lm_date_submit'](c); assert.strictEqual(o.acks[0].response_action, 'errors');
  [c, o] = ctx({ view: { state: { values: { date: { v: { selected_date: '2099-03-06' } } } } }, body: { user: { id: 'UADMIN' } } }); await H.view['lm_date_submit'](c); assert.strictEqual(o.acks[0], true);
  [c, o] = ctx({ command: { user_id: 'UADMIN' } }); await H.command['/lunchmeet'](c); assert.match(o.responds[0].blocks[1].text.text, /3월 6일/);
});
