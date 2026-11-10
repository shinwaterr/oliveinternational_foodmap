// 런치밋 신청·편성 결과를 data/lunchmeet.json 파일 하나에 저장합니다.
// 서버를 옮기거나 다시 켜도 이 파일만 있으면 내용이 유지됩니다.
const fs = require('fs');
const path = require('path');
const { nextFriday } = require('./logic');

const FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'lunchmeet.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { roundDate: null, signups: {}, results: {} };
  }
}

function save(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE); // 쓰는 도중 꺼져도 파일이 깨지지 않게
}

/** 현재 회차 날짜. 운영자가 정하지 않았으면 다음 금요일 */
function currentRound(db = load()) {
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  if (db.roundDate && db.roundDate >= today) return db.roundDate;
  return nextFriday();
}

function setRoundDate(ymd) {
  const db = load();
  db.roundDate = ymd;
  save(db);
}

/** 이번 회차 신청자 목록 */
function signups(round = currentRound()) {
  const db = load();
  return Object.values(db.signups[round] || {});
}

function join(userId, team, prefs, round = currentRound()) {
  const db = load();
  db.signups[round] ??= {};
  db.signups[round][userId] = { userId, team, prefs: prefs || [], at: new Date().toISOString() };
  save(db);
}

function cancel(userId, round = currentRound()) {
  const db = load();
  if (db.signups[round]) delete db.signups[round][userId];
  save(db);
}

function getResult(round = currentRound()) {
  return load().results[round] || null;
}

function setResult(groups, round = currentRound()) {
  const db = load();
  db.results[round] = { groups, at: new Date().toISOString() };
  save(db);
}

function clearResult(round = currentRound()) {
  const db = load();
  delete db.results[round];
  save(db);
}

module.exports = { FILE, load, currentRound, setRoundDate, signups, join, cancel, getResult, setResult, clearResult };
