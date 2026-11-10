const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lm-')), 'lunchmeet.json');
const L = require('../src/logic');
const B = require('../src/blocks');
const store = require('../src/store');

// 슬랙 Block Kit 제한값 검사
function checkBlocks(blocks, label) {
  assert.ok(blocks.length <= 50, `${label}: 블록 ${blocks.length}개 (최대 50)`);
  const ids = new Set();
  for (const b of blocks) {
    if (b.text?.text) assert.ok(b.text.text.length <= 3000, `${label}: 글자 수 초과`);
    if (b.type === 'header') assert.ok(b.text.text.length <= 150, `${label}: 헤더 길이`);
    const els = b.type === 'actions' ? b.elements : b.accessory ? [b.accessory] : [];
    if (b.type === 'actions') assert.ok(els.length <= 25, `${label}: 버튼 ${els.length}개 (최대 25)`);
    for (const e of els) {
      if (e.text) assert.ok(e.text.text.length <= 75, `${label}: 버튼 글자 "${e.text.text}"`);
      if (e.value) assert.ok(e.value.length <= 2000, `${label}: value 길이`);
      if (e.url) assert.ok(e.url.length <= 3000 && e.url.startsWith('https://'), `${label}: url`);
      assert.ok(!ids.has(e.action_id), `${label}: action_id 중복 ${e.action_id}`);
      ids.add(e.action_id);
    }
  }
}

test('맛집 데이터 70곳, 필수 값', () => {
  assert.strictEqual(L.RESTAURANTS.length, 70);
  for (const r of L.RESTAURANTS) {
    assert.ok(r.name && r.menu && r.kakaoWalk.startsWith('https://map.kakao.com/?target=walk&rt=505550,1110328,'));
    assert.ok(r.exit >= 1 && r.exit <= 12 && r.walkMin >= 1);
    assert.ok(L.CAT[r.category], `알 수 없는 카테고리 ${r.category}`);
  }
});

test('카테고리·검색어 찾기', () => {
  assert.strictEqual(L.findCategory('일식'), '일식');
  assert.strictEqual(L.findCategory('국물찌개'), '한식-국물(찌개 포함)');
  assert.strictEqual(L.findCategory('샐러드'), '샐러드&샌드위치');
  assert.strictEqual(L.findCategory('텐동'), null);
  const jp = L.search('일식');
  assert.ok(jp.length > 0 && jp.every((r) => r.category === '일식'));
  assert.ok(jp.every((r, i) => i === 0 || jp[i - 1].distM <= r.distM), '가까운 순 정렬');
  assert.ok(L.search('텐동').some((r) => r.name.includes('온센')));
  assert.strictEqual(L.search('없는메뉴xyz').length, 0);
});

test('무작위 추천: 조건 지키고 직전 결과 피함', () => {
  for (let i = 0; i < 200; i++) {
    const r = L.pickRandom({ category: '중식', exceptId: 13 });
    assert.strictEqual(r.category, '중식');
    assert.notStrictEqual(r.id, 13);
  }
  assert.strictEqual(L.pickRandom({ category: '중식', maxWalkMin: 0 }), null);
});

test('조 편성: 전원 1번씩, 3~4명, 같은 팀 분산, 식당 중복 없음', () => {
  const teams = ['인사팀', '인사팀', '인사팀', '개발팀', '개발팀', '마케팅팀', '마케팅팀', '영업팀', '재무팀', '디자인팀', '디자인팀', '물류팀'];
  const signups = teams.map((t, i) => ({ userId: 'U' + i, team: t, prefs: i % 3 ? ['일식'] : [] }));
  for (let k = 0; k < 50; k++) {
    const g = L.makeGroups(signups);
    assert.strictEqual(g.length, 3);
    const all = g.flatMap((x) => x.members).sort();
    assert.deepStrictEqual(all, signups.map((s) => s.userId).sort());
    g.forEach((x) => assert.ok(x.members.length >= 3 && x.members.length <= 4));
    // 인사팀 3명은 서로 다른 조
    const hr = g.map((x) => x.members.filter((id) => signups.find((s) => s.userId === id).team === '인사팀').length);
    assert.ok(hr.every((c) => c === 1), '같은 팀 분산');
    const places = g.map((x) => x.placeId);
    assert.strictEqual(new Set(places).size, places.length);
    places.forEach((id) => {
      const p = L.byId(id);
      assert.ok(p.walkMin <= 10 && !L.NOT_FOR_LUNCH.has(p.category));
    });
  }
  assert.deepStrictEqual(L.makeGroups([{ userId: 'A', team: 'x' }]), []);
});

test('다음 금요일 계산 (서울 시간)', () => {
  assert.strictEqual(L.nextFriday(new Date('2026-11-10T03:00:00Z')), '2026-11-13'); // 화 → 금
  assert.strictEqual(L.nextFriday(new Date('2026-11-13T01:00:00Z')), '2026-11-20'); // 금 → 다음 주 금
  assert.strictEqual(L.prettyDate('2026-11-13'), '11월 13일 (금)');
});

test('슬랙 메시지 형식 제한', () => {
  checkBlocks(B.matjipHome(), 'home');
  for (const c of L.CATEGORIES) {
    const list = L.search(c.key);
    for (let p = 0; p * B.PAGE < list.length; p++) checkBlocks(B.matjipList(c.name, list, p, c.key), `list ${c.name} p${p}`);
  }
  checkBlocks(B.matjipList('없음', [], 0, 'x'), 'empty');
  checkBlocks(B.pickResult(L.RESTAURANTS[0], null), 'pick');
  checkBlocks(B.pickResult(null, '중식'), 'pick none');
  const list = Array.from({ length: 40 }, (_, i) => ({ userId: 'U' + i, team: 'T' + (i % 7), prefs: [] }));
  const result = { groups: L.makeGroups(list) };
  checkBlocks(B.lunchmeetPanel({ round: '2026-11-13', list, me: 'U1', result: null, isAdmin: true }), 'panel');
  checkBlocks(B.resultPost('2026-11-13', result, list), 'resultPost 40명');
  checkBlocks(B.announcement('2026-11-13'), 'announce');
  checkBlocks(B.joinModal('2026-11-13').blocks, 'modal');
});

test('저장: 신청·취소·결과', () => {
  const round = store.currentRound();
  store.join('UA', '인사팀', ['일식']);
  store.join('UB', '개발팀', []);
  store.join('UA', '인사팀', ['중식']); // 다시 신청하면 덮어쓰기
  assert.strictEqual(store.signups().length, 2);
  assert.deepStrictEqual(store.signups().find((s) => s.userId === 'UA').prefs, ['중식']);
  store.cancel('UB');
  assert.strictEqual(store.signups().length, 1);
  store.setResult([{ members: ['UA'], placeId: 1 }]);
  assert.ok(store.getResult(round));
  store.clearResult();
  assert.strictEqual(store.getResult(round), null);
  store.setRoundDate('2099-01-02');
  assert.strictEqual(store.currentRound(), '2099-01-02');
});
