// 맛지도 슬랙 앱 — 슬랙 없이도 테스트할 수 있는 순수 로직 모음
const RESTAURANTS = require('./restaurants.json');

const CATEGORIES = [
  { key: '한식-일반', name: '한식', emoji: '🍚' },
  { key: '한식-국물(찌개 포함)', name: '국물·찌개', emoji: '🍲' },
  { key: '중식', name: '중식', emoji: '🥟' },
  { key: '일식', name: '일식', emoji: '🍣' },
  { key: '양식', name: '양식', emoji: '🍝' },
  { key: '분식', name: '분식', emoji: '🍢' },
  { key: '샐러드&샌드위치', name: '샐러드', emoji: '🥗' },
  { key: '버거', name: '버거', emoji: '🍔' },
  { key: '기타', name: '세계음식', emoji: '🌮' },
  { key: '카페', name: '카페', emoji: '🍰' },
  { key: '저녁회식장소추천', name: '회식', emoji: '🍻' },
];
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));
const catOf = (r) => CAT[r.category] || CAT['기타'];
// 런치밋 식당 후보에서 뺄 카테고리 (점심 식사에 맞지 않음)
const NOT_FOR_LUNCH = new Set(['카페', '저녁회식장소추천']);

/** 사용자가 입력한 단어를 카테고리 키로 바꿉니다. 못 찾으면 null */
function findCategory(word) {
  const w = (word || '').trim();
  if (!w) return null;
  const hit = CATEGORIES.find((c) => c.name === w || c.key === w || c.name.replace('·', '') === w.replace('·', ''));
  if (hit) return hit.key;
  const alias = { 국물: '한식-국물(찌개 포함)', 찌개: '한식-국물(찌개 포함)', 샐러드: '샐러드&샌드위치', 샌드위치: '샐러드&샌드위치', 세계: '기타', 회식: '저녁회식장소추천', 술: '저녁회식장소추천' };
  return alias[w] === undefined ? null : alias[w];
}

/** 카테고리 또는 검색어로 맛집을 찾아 회사에서 가까운 순으로 돌려줍니다. */
function search(query) {
  const q = (query || '').trim();
  const cat = findCategory(q);
  let list;
  if (!q) list = RESTAURANTS.slice();
  else if (cat) list = RESTAURANTS.filter((r) => r.category === cat);
  else {
    const low = q.toLowerCase();
    list = RESTAURANTS.filter((r) => (r.name + r.menu + r.note + catOf(r).name).toLowerCase().includes(low));
  }
  return list.sort((a, b) => a.distM - b.distM);
}

/** 조건에 맞는 맛집 중 하나를 무작위로 고릅니다. exceptId 는 직전 결과(연속 중복 방지) */
function pickRandom({ category = null, maxWalkMin = 99, exceptId = null, rand = Math.random } = {}) {
  let pool = RESTAURANTS.filter((r) => (!category || r.category === category) && r.walkMin <= maxWalkMin);
  if (pool.length > 1 && exceptId != null) pool = pool.filter((r) => r.id !== exceptId);
  if (!pool.length) return null;
  return pool[Math.floor(rand() * pool.length)];
}

function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 런치밋 조 편성.
 * signups: [{userId, team, prefs:[categoryKey]}]
 * 같은 팀은 되도록 다른 조로 흩어지게, 조당 3~4명, 조원 선호 메뉴에 맞춰 도보 10분 이내 식당을 배정합니다.
 */
function makeGroups(signups, rand = Math.random) {
  if (signups.length < 2) return [];
  const n = signups.length;
  const groupCount = Math.max(1, Math.round(n / 4));
  const byTeam = {};
  shuffle(signups, rand).forEach((s) => (byTeam[s.team] ??= []).push(s));
  const ordered = Object.values(byTeam).sort((a, b) => b.length - a.length).flat();
  const groups = Array.from({ length: groupCount }, () => []);
  ordered.forEach((s, i) => groups[i % groupCount].push(s));
  const used = new Set();
  return groups.map((members) => {
    const prefs = new Set(members.flatMap((m) => m.prefs || []));
    let pool = RESTAURANTS.filter((r) => r.walkMin <= 10 && !NOT_FOR_LUNCH.has(r.category) && !used.has(r.id));
    const preferred = pool.filter((r) => prefs.has(r.category));
    if (preferred.length) pool = preferred;
    const place = pool.length ? pool[Math.floor(rand() * pool.length)] : null;
    if (place) used.add(place.id);
    return { members: members.map((m) => m.userId), placeId: place ? place.id : null };
  });
}

/** 다음 금요일(오늘이 금요일이면 다음 주 금요일)을 YYYY-MM-DD 로. 서울 시간 기준 */
function nextFriday(now = new Date()) {
  const seoul = new Date(now.getTime() + 9 * 3600 * 1000);
  const dow = seoul.getUTCDay();
  let add = (5 - dow + 7) % 7;
  if (add === 0) add = 7;
  seoul.setUTCDate(seoul.getUTCDate() + add);
  return seoul.toISOString().slice(0, 10);
}

const DOW = '일월화수목금토';
function prettyDate(ymd) {
  const d = new Date(ymd + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${DOW[d.getUTCDay()]})`;
}

const byId = (id) => RESTAURANTS.find((r) => r.id === id) || null;

module.exports = { RESTAURANTS, CATEGORIES, CAT, catOf, findCategory, search, pickRandom, makeGroups, nextFriday, prettyDate, byId, NOT_FOR_LUNCH };
