// 슬랙 메시지 화면(Block Kit)을 만드는 함수들
const { CATEGORIES, catOf, prettyDate, byId } = require('./logic');

const COMPANY = '그레이츠강남 14층 · 강남역 8번 출구 쪽';

/** 맛집 한 곳 카드: 이름 / 카테고리·도보 / 출구 / 추천 / 참고 + 길안내 버튼 */
function restaurantSection(r) {
  const c = catOf(r);
  const lines = [
    `${c.emoji} *${r.name}*`,
    `${c.name} · 🚶 (회사 기준 도보) ${r.walkMin}분`,
    `🚇 강남역 ${r.exit}번 출구에서 ${r.exitMeters}m`,
    `*추천* ${r.menu}`,
  ];
  if (r.note) lines.push(`_${r.note}_`);
  return {
    type: 'section',
    text: { type: 'mrkdwn', text: lines.join('\n') },
    accessory: {
      type: 'button',
      text: { type: 'plain_text', text: '🧭 길안내', emoji: true },
      url: r.kakaoWalk,
      action_id: `route_${r.id}`,
    },
  };
}

/** 카테고리 버튼 줄 (한 줄에 버튼 최대 25개라 한 번에 들어감) */
function categoryButtons(prefix = 'cat') {
  return {
    type: 'actions',
    block_id: `${prefix}_buttons`,
    elements: CATEGORIES.map((c) => ({
      type: 'button',
      text: { type: 'plain_text', text: `${c.emoji} ${c.name}`, emoji: true },
      value: c.key,
      action_id: `${prefix}_${c.key}`,
    })),
  };
}

/** /matjip — 처음 화면: 회사 소개 + 카테고리 버튼 */
function matjipHome() {
  return [
    { type: 'header', text: { type: 'plain_text', text: '🏢 올리브인터내셔널 맛지도', emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `${COMPANY}에서 출발! 먹고 싶은 메뉴를 눌러보세요.` }] },
    categoryButtons('cat'),
  ];
}

/** /matjip 결과 목록. 슬랙 메시지 길이 제한 때문에 한 번에 최대 PAGE 곳씩 보여줍니다. */
const PAGE = 6;
function matjipList(title, list, page = 0, queryValue = '') {
  const total = list.length;
  if (!total) {
    return [
      { type: 'section', text: { type: 'mrkdwn', text: `🔍 *${title}* 에 맞는 맛집이 없어요. 다른 메뉴 이름으로 찾아보세요.` } },
      categoryButtons('cat'),
    ];
  }
  const start = page * PAGE;
  const slice = list.slice(start, start + PAGE);
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${title}* · 회사에서 가까운 순 · ${start + 1}–${start + slice.length} / ${total}곳` } },
    { type: 'divider' },
  ];
  slice.forEach((r) => blocks.push(restaurantSection(r), { type: 'divider' }));
  const nav = [];
  if (page > 0) nav.push({ type: 'button', text: { type: 'plain_text', text: '‹ 이전' }, value: JSON.stringify({ q: queryValue, p: page - 1 }), action_id: 'page_prev' });
  if (start + PAGE < total) nav.push({ type: 'button', text: { type: 'plain_text', text: '다음 ›' }, value: JSON.stringify({ q: queryValue, p: page + 1 }), action_id: 'page_next' });
  nav.push({ type: 'button', text: { type: 'plain_text', text: '🏠 처음으로' }, action_id: 'matjip_home' });
  blocks.push({ type: 'actions', elements: nav });
  return blocks;
}

/** /mwomeokji 결과 */
function pickResult(r, category) {
  if (!r) {
    return [{ type: 'section', text: { type: 'mrkdwn', text: '조건에 맞는 맛집이 없어요. 다른 메뉴로 다시 해보세요.' } }, categoryButtons('pick')];
  }
  const value = JSON.stringify({ c: category || null, last: r.id });
  return [
    { type: 'section', text: { type: 'mrkdwn', text: '🎲 *오늘 뭐 먹지?* 두구두구… 오늘은 여기!' } },
    restaurantSection(r),
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: '🔄 다시 뽑기', emoji: true }, value, action_id: 'pick_again', style: 'primary' },
        { type: 'button', text: { type: 'plain_text', text: '📣 채널에 공유', emoji: true }, value: String(r.id), action_id: 'pick_share' },
      ],
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: '메뉴를 바꾸고 싶으면 아래에서 고르세요.' }] },
    categoryButtons('pick'),
  ];
}

/** /lunchmeet — 내 화면 (나만 보임) */
function lunchmeetPanel({ round, list, me, result, isAdmin }) {
  const teams = new Set(list.map((s) => s.team));
  const mine = list.find((s) => s.userId === me);
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🤝 랜덤 런치밋', emoji: true } },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${prettyDate(round)} 점심 12:00*\n다른 팀 동료들과 랜덤으로 3~4명씩 한 조가 되어 점심을 먹어요.\n신청만 하면 조와 식당은 자동으로 정해져요.`,
      },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `🙋 신청 *${list.length}명* · 👥 참여 팀 *${teams.size}개* · 🍽️ 예상 *${list.length >= 2 ? Math.max(1, Math.round(list.length / 4)) : '-'}개 조*` }],
    },
  ];

  if (result) blocks.push(...resultBlocks(result, list, me));

  if (mine) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `🙌 *신청 완료!* ${mine.team}${mine.prefs?.length ? ' · 선호 ' + mine.prefs.map((k) => catOf({ category: k }).name).join(', ') : ''}` },
      ...(result ? {} : { accessory: { type: 'button', text: { type: 'plain_text', text: '신청 취소' }, action_id: 'lm_cancel', style: 'danger' } }),
    });
  } else if (!result) {
    blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '🙋 참여 신청하기', emoji: true }, action_id: 'lm_join_open', style: 'primary' }] });
  } else {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '이번 회차는 조 편성이 끝났어요. 다음 회차에 신청해 주세요!' }] });
  }

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: list.length ? `*신청한 동료*\n${list.map((s) => `<@${s.userId}> (${s.team})`).join('  ')}` : '_아직 신청한 사람이 없어요. 첫 번째로 신청해 보세요!_' },
  });

  if (isAdmin) {
    blocks.push(
      { type: 'divider' },
      { type: 'context', elements: [{ type: 'mrkdwn', text: '🛠️ *운영자 메뉴* (운영자에게만 보여요)' }] },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: '📣 모집 공지 올리기' }, action_id: 'lm_announce' },
          { type: 'button', text: { type: 'plain_text', text: result ? '🔀 다시 섞어서 게시' : `🎲 조 편성 후 게시 (${list.length}명)` }, action_id: 'lm_match', style: 'primary' },
          { type: 'button', text: { type: 'plain_text', text: '📅 회차 날짜 변경' }, action_id: 'lm_date_open' },
          ...(result ? [{ type: 'button', text: { type: 'plain_text', text: '결과 지우기' }, action_id: 'lm_clear', style: 'danger', confirm: { title: { type: 'plain_text', text: '결과 지우기' }, text: { type: 'mrkdwn', text: '이번 회차 조 편성 결과를 지울까요?' }, confirm: { type: 'plain_text', text: '지우기' }, deny: { type: 'plain_text', text: '취소' } } }] : []),
        ],
      },
    );
  }
  return blocks;
}

function resultBlocks(result, list, me) {
  const teamOf = (id) => (list.find((s) => s.userId === id) || {}).team || '';
  const out = [{ type: 'section', text: { type: 'mrkdwn', text: `🎉 *매칭 결과* · ${result.groups.length}개 조` } }];
  result.groups.forEach((g, i) => {
    const p = byId(g.placeId);
    const mineTag = me && g.members.includes(me) ? '  ⭐ *우리 조*' : '';
    out.push({ type: 'divider' });
    out.push({ type: 'section', text: { type: 'mrkdwn', text: `*${i + 1}조*${mineTag}\n${g.members.map((id) => `<@${id}>${teamOf(id) ? ` (${teamOf(id)})` : ''}`).join('  ')}` } });
    if (p) out.push(restaurantSection(p));
  });
  return out;
}

/** 채널에 올리는 모집 공지 */
function announcement(round) {
  return [
    { type: 'header', text: { type: 'plain_text', text: '🤝 랜덤 런치밋 참여자 모집!', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${prettyDate(round)} 점심 12:00*\n다른 팀 동료들과 랜덤으로 한 조가 되어 점심을 먹어요. 조와 식당은 자동으로 정해져요!` } },
    { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '🙋 참여 신청하기', emoji: true }, action_id: 'lm_join_open', style: 'primary' }, { type: 'button', text: { type: 'plain_text', text: '신청 현황 보기' }, action_id: 'lm_status' }] },
    { type: 'context', elements: [{ type: 'mrkdwn', text: '언제든 `/lunchmeet` 를 입력해도 신청할 수 있어요.' }] },
  ];
}

/** 채널에 올리는 편성 결과 */
function resultPost(round, result, list) {
  return [
    { type: 'header', text: { type: 'plain_text', text: `🎉 ${prettyDate(round)} 런치밋 조 편성 결과`, emoji: true } },
    ...resultBlocks(result, list, null).slice(1),
    { type: 'context', elements: [{ type: 'mrkdwn', text: '각 조 식당의 🧭 길안내를 누르면 회사에서 가는 길이 카카오맵으로 열려요. 맛있게 드세요!' }] },
  ];
}

/** 참여 신청 입력창 */
function joinModal(round) {
  return {
    type: 'modal',
    callback_id: 'lm_join_submit',
    private_metadata: round,
    title: { type: 'plain_text', text: '런치밋 참여 신청' },
    submit: { type: 'plain_text', text: '신청하기' },
    close: { type: 'plain_text', text: '닫기' },
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*${prettyDate(round)} 점심 12:00*\n같은 팀끼리는 되도록 다른 조로 나눠져요.` } },
      { type: 'input', block_id: 'team', label: { type: 'plain_text', text: '👥 소속 팀' }, element: { type: 'plain_text_input', action_id: 'v', max_length: 20, placeholder: { type: 'plain_text', text: '예: 인사팀' } } },
      {
        type: 'input',
        block_id: 'prefs',
        optional: true,
        label: { type: 'plain_text', text: '😋 이런 메뉴면 좋겠어요 (최대 3개)' },
        element: {
          type: 'multi_static_select',
          action_id: 'v',
          max_selected_items: 3,
          placeholder: { type: 'plain_text', text: '선택 안 하면 아무거나' },
          options: CATEGORIES.filter((c) => c.key !== '카페' && c.key !== '저녁회식장소추천').map((c) => ({ text: { type: 'plain_text', text: `${c.emoji} ${c.name}`, emoji: true }, value: c.key })),
        },
      },
    ],
  };
}

function dateModal(round) {
  return {
    type: 'modal',
    callback_id: 'lm_date_submit',
    title: { type: 'plain_text', text: '회차 날짜 변경' },
    submit: { type: 'plain_text', text: '저장' },
    close: { type: 'plain_text', text: '닫기' },
    blocks: [{ type: 'input', block_id: 'date', label: { type: 'plain_text', text: '런치밋 날짜' }, element: { type: 'datepicker', action_id: 'v', initial_date: round } }],
  };
}

module.exports = { restaurantSection, categoryButtons, matjipHome, matjipList, pickResult, lunchmeetPanel, announcement, resultPost, joinModal, dateModal, PAGE };
