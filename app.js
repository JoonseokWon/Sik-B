const currency = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

const DATA_VERSION = 11;
const ROLES = ["멤버", "매니저", "스태프", "게스트"];
const EXCLUDED_ROLES = new Set(["매니저", "스태프", "게스트"]);
const REVENUE_TYPES = ["공통 매출", "개인 매출"];
const APPROVAL_STATES = ["자동 처리", "승인 대기", "승인 완료", "반려", "보류"];
const ACTIVITY_STATES = ["출근", "대기", "외부일정", "제외"];

const state = {
  version: DATA_VERSION,
  groupName: "Samildol",
  periodStart: "2026-07-01",
  periodEnd: "2026-07-15",
  approvalLimit: 30000,
  companyRate: 50,
  members: [],
  staff: [],
  revenueItems: [],
  expenses: [],
  attendance: [],
  schedules: [],
  auditLogs: [],
  selectedContractId: "",
};

const els = {
  groupName: document.querySelector("#groupName"),
  periodStart: document.querySelector("#periodStart"),
  periodEnd: document.querySelector("#periodEnd"),
  approvalLimit: document.querySelector("#approvalLimit"),
  companyRate: document.querySelector("#companyRate"),
  memberRows: document.querySelector("#memberRows"),
  revenueRows: document.querySelector("#revenueRows"),
  expenseRows: document.querySelector("#expenseRows"),
  attendanceList: document.querySelector("#attendanceList"),
  scheduleList: document.querySelector("#scheduleList"),
  auditList: document.querySelector("#auditList"),
  contractDetail: document.querySelector("#contractDetail"),
  csvInput: document.querySelector("#csvInput"),
  totalRevenue: document.querySelector("#totalRevenue"),
  totalCommonRevenue: document.querySelector("#totalCommonRevenue"),
  companyShare: document.querySelector("#companyShare"),
  rateTotal: document.querySelector("#rateTotal"),
  totalGross: document.querySelector("#totalGross"),
  totalFood: document.querySelector("#totalFood"),
  approvalCount: document.querySelector("#approvalCount"),
};

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function splitNames(value) {
  return String(value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function formatTime(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addAudit(action, detail) {
  state.auditLogs.unshift({
    id: makeId(),
    at: formatTime(),
    actor: "정산 담당자",
    action,
    detail,
  });
  state.auditLogs = state.auditLogs.slice(0, 80);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  bytes.forEach((byte) => {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });
  return (crc ^ 0xffffffff) >>> 0;
}

function stringBytes(value) {
  return new TextEncoder().encode(value);
}

function concatBytes(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });
  return output;
}

function u16(value) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value) {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = Math.max(date.getFullYear() - 1980, 0);
  return { date: (year << 9) | (month << 5) | day, time };
}

function makeZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();

  files.forEach((file) => {
    const name = stringBytes(file.name);
    const data = stringBytes(file.content);
    const crc = crc32(data);
    const localHeader = concatBytes([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name,
    ]);

    localParts.push(localHeader, data);
    centralParts.push(concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0),
      u16(0), u32(0), u32(offset), name,
    ]));
    offset += localHeader.length + data.length;
  });

  const centralDirectory = concatBytes(centralParts);
  const endRecord = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralDirectory.length), u32(offset), u16(0),
  ]);

  return concatBytes([...localParts, centralDirectory, endRecord]);
}

function columnName(index) {
  let name = "";
  let current = index;
  while (current > 0) {
    const mod = (current - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    current = Math.floor((current - mod) / 26);
  }
  return name;
}

function sheetCell(rowIndex, colIndex, cell) {
  const ref = `${columnName(colIndex)}${rowIndex}`;
  const style = cell.style ? ` s="${cell.style}"` : "";
  if (typeof cell.value === "number") return `<c r="${ref}"${style}><v>${cell.value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${style}><is><t>${escapeHtml(cell.value)}</t></is></c>`;
}

function sheetRow(rowIndex, cells) {
  return `<row r="${rowIndex}">${cells.map((cell, index) => sheetCell(rowIndex, index + 1, cell)).join("")}</row>`;
}

function inPeriod(dateText) {
  return dateText >= state.periodStart && dateText <= state.periodEnd;
}

function memberByName(name) {
  return state.members.find((member) => member.name === name);
}

function staffByName(name) {
  return state.staff.find((staff) => staff.name === name);
}

function personByName(name) {
  return memberByName(name) || staffByName(name);
}

function isSettlementExcluded(name) {
  const person = personByName(name);
  return !memberByName(name) || EXCLUDED_ROLES.has(person?.role) || person?.settlementExcluded === true;
}

function settlementMembers(names) {
  return [...new Set(names)].filter((name) => memberByName(name) && !isSettlementExcluded(name));
}

function revenueWeight(member) {
  if (EXCLUDED_ROLES.has(member.role)) return 0;
  return Number(member.revenueWeight || 1);
}

function activityMembersByDate(date) {
  const names = new Set();
  state.attendance
    .filter((row) => row.date === date && row.status && row.status !== "제외")
    .forEach((row) => names.add(row.member));
  state.schedules
    .filter((schedule) => schedule.date === date)
    .forEach((schedule) => schedule.members.forEach((name) => names.add(name)));
  return [...names].filter((name) => personByName(name));
}

function defaultExcluded(participants) {
  return participants.filter((name) => isSettlementExcluded(name));
}

function createExpense(date, title, amount) {
  const managers = state.staff.filter((person) => person.settlementExcluded || EXCLUDED_ROLES.has(person.role)).map((person) => person.name);
  const participants = [...new Set([...activityMembersByDate(date), ...managers])];
  const expense = {
    id: makeId(),
    date,
    title,
    amount,
    participants,
    excluded: defaultExcluded(participants),
    approver: "상위 매니저",
    approvalMemo: "",
  };
  expense.approvalStatus = defaultApprovalStatus(expense);
  return expense;
}

function createRevenue(date, title, type, amount, participants) {
  return { id: makeId(), date, title, type, amount, participants };
}

function createContract(popularityTier, traineeCost, companyInvestment, rateBasis, specialClause) {
  return {
    effectiveDate: "2026-07-01",
    contractType: "멤버 전속계약",
    popularityTier,
    traineeCost,
    companyInvestment,
    rateBasis,
    specialClause,
  };
}

function billableParticipants(expense) {
  return expense.participants.filter((name) => !expense.excluded.includes(name));
}

function expenseShare(expense) {
  const billable = billableParticipants(expense).length;
  if (billable === 0) return 0;
  return Math.ceil(Number(expense.amount || 0) / billable);
}

function expenseNeedsApproval(expense) {
  return billableParticipants(expense).length === 0 || expenseShare(expense) > Number(state.approvalLimit || 0);
}

function defaultApprovalStatus(expense) {
  if (billableParticipants(expense).length === 0) return "보류";
  return expenseNeedsApproval(expense) ? "승인 대기" : "자동 처리";
}

function expenseStatus(expense) {
  return expense.approvalStatus || defaultApprovalStatus(expense);
}

function revenueShare(item, memberName) {
  if (!inPeriod(item.date) || isSettlementExcluded(memberName) || !item.participants.includes(memberName)) return 0;
  const participants = settlementMembers(item.participants);
  if (!participants.length) return 0;
  if (item.type === "개인 매출") return Math.ceil(Number(item.amount || 0) / participants.length);
  return Number(item.amount || 0);
}

function totalRevenueInPeriod() {
  return state.revenueItems
    .filter((item) => inPeriod(item.date))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function commonRevenuePool() {
  return state.revenueItems
    .filter((item) => inPeriod(item.date) && item.type === "공통 매출")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function memberRateTotal() {
  return state.members
    .filter((member) => !EXCLUDED_ROLES.has(member.role))
    .reduce((sum, member) => sum + Number(member.rate || 0), 0);
}

function contractRateTotal() {
  return Number(state.companyRate || 0) + memberRateTotal();
}

function companyShareAmount() {
  return Math.round(totalRevenueInPeriod() * (Number(state.companyRate || 0) / 100));
}

function revenueBreakdown(member) {
  if (EXCLUDED_ROLES.has(member.role)) return { common: 0, individual: 0, total: 0, commonPayout: 0, individualPayout: 0 };
  return state.revenueItems.reduce(
    (acc, item) => {
      const share = revenueShare(item, member.name);
      if (item.type === "개인 매출") acc.individual += share;
      else acc.common += share;
      acc.commonPayout = Math.round(acc.common * (Number(member.rate || 0) / 100));
      acc.individualPayout = Math.round(acc.individual * (Number(member.rate || 0) / 100));
      acc.total = acc.commonPayout + acc.individualPayout;
      return acc;
    },
    { common: 0, individual: 0, total: 0, commonPayout: 0, individualPayout: 0 },
  );
}

function fallbackContract(member) {
  if (EXCLUDED_ROLES.has(member.role)) {
    return createContract("해당 없음", "해당 없음", "해당 없음", "정산 제외 역할입니다.", "멤버 정산 대상이 아닙니다.");
  }
  return createContract("미설정", "미설정", "미설정", "계약 조건을 확인해 지급률 근거를 입력해야 합니다.", "계약서 참조 정보가 아직 등록되지 않았습니다.");
}

function contractLine(member) {
  const contract = member.contract || fallbackContract(member);
  return `${contract.popularityTier} / ${contract.traineeCost} / ${contract.companyInvestment}`;
}

function renderContractDetail() {
  if (!els.contractDetail) return;
  const member = state.members.find((item) => item.id === state.selectedContractId) || state.members.find((item) => item.role === "멤버") || state.members[0];
  if (!member) {
    els.contractDetail.innerHTML = "";
    return;
  }
  const contract = member.contract || fallbackContract(member);
  els.contractDetail.innerHTML = `
    <div class="contract-card">
      <div>
        <span class="contract-label">계약서 참조</span>
        <h3>${escapeHtml(member.name)} ${escapeHtml(contract.contractType)}</h3>
      </div>
      <dl class="contract-grid">
        <div><dt>계약 지급률</dt><dd>${Number(member.rate || 0)}%</dd></div>
        <div><dt>개인 활동 기여도</dt><dd>${escapeHtml(contract.popularityTier)}</dd></div>
        <div><dt>연습생 생활비</dt><dd>${escapeHtml(contract.traineeCost)}</dd></div>
        <div><dt>회사 투자</dt><dd>${escapeHtml(contract.companyInvestment)}</dd></div>
      </dl>
      <p><strong>지급률 근거</strong><br>${escapeHtml(contract.rateBasis)}</p>
      <p><strong>특약</strong><br>${escapeHtml(contract.specialClause)}</p>
      <p class="contract-footnote">더미 계약서 기준일: ${escapeHtml(contract.effectiveDate)} · 실제 계약서가 아니라 PoC용 가정 문서입니다.</p>
    </div>
  `;
}

function applyContractPreset(member) {
  const contract = member.contract || fallbackContract(member);
  member.contract = contract;
}

function calculateMember(member) {
  if (EXCLUDED_ROLES.has(member.role)) {
    return { revenue: revenueBreakdown(member), mealCount: 0, gross: 0, food: 0, net: 0 };
  }
  const revenue = revenueBreakdown(member);
  const memberExpenses = state.expenses.filter(
    (expense) => inPeriod(expense.date) && expenseStatus(expense) !== "반려" && billableParticipants(expense).includes(member.name),
  );
  const food = memberExpenses.reduce((sum, expense) => sum + expenseShare(expense), 0);
  const gross = revenue.total;
  return { revenue, mealCount: memberExpenses.length, gross, food, net: gross - food };
}

function attendanceDates() {
  return [...new Set(state.attendance.map((row) => row.date))].filter(Boolean).sort();
}

function findAttendance(date, member) {
  return state.attendance.find((row) => row.date === date && row.member === member);
}

function setAttendance(date, member, status) {
  const existing = findAttendance(date, member);
  if (!status) {
    state.attendance = state.attendance.filter((row) => !(row.date === date && row.member === member));
    addAudit("활동 기록 수정", `${date} ${member} 상태를 공란으로 변경했습니다.`);
    return;
  }
  if (existing) existing.status = status;
  else state.attendance.push({ id: makeId(), date, member, status });
  addAudit("활동 기록 수정", `${date} ${member} 상태를 ${status}(으)로 변경했습니다.`);
}

function nextAttendanceDate() {
  const dates = attendanceDates();
  const last = dates.length ? dates[dates.length - 1] : state.periodStart;
  const next = new Date(`${last}T00:00:00`);
  next.setDate(next.getDate() + (dates.length ? 1 : 0));
  return next.toISOString().slice(0, 10);
}

function syncExpenseRecommendation(expense) {
  const participants = [...new Set([...activityMembersByDate(expense.date), ...expense.participants.filter((name) => isSettlementExcluded(name))])];
  const previous = expense.participants.join(", ");
  expense.participants = participants;
  expense.excluded = defaultExcluded(participants);
  expense.approvalStatus = defaultApprovalStatus(expense);
  addAudit("예상 식사인원 적용", `${expense.date} ${expense.title}: ${previous || "없음"} -> ${participants.join(", ") || "예상 없음"}`);
}

function syncInputs() {
  els.groupName.value = state.groupName;
  els.periodStart.value = state.periodStart;
  els.periodEnd.value = state.periodEnd;
  els.approvalLimit.value = state.approvalLimit;
  els.companyRate.value = state.companyRate;
}

function seedData() {
  state.version = DATA_VERSION;
  state.groupName = "Samildol";
  state.periodStart = "2026-07-01";
  state.periodEnd = "2026-07-15";
  state.approvalLimit = 30000;
  state.companyRate = 50;
  state.members = [
    {
      id: makeId(),
      name: "Haru",
      role: "멤버",
      rate: 13,
      revenueWeight: 1.3,
      contract: createContract("상", "본인 부담", "낮음", "회사 50%를 제외한 멤버 몫 50% 안에서 개인 팬덤과 예능 수요가 가장 높아 13%를 배정합니다.", "공통 매출과 개인 활동 매출 모두 Haru 계약 지급률 13%를 적용합니다."),
    },
    {
      id: makeId(),
      name: "Min",
      role: "멤버",
      rate: 11,
      revenueWeight: 1.2,
      contract: createContract("상", "본인 일부 부담", "중간", "회사 50%를 제외한 멤버 몫 50% 안에서 라디오와 방송 고정 수요를 반영해 11%를 배정합니다.", "공통 매출과 개인 DJ/방송 매출 모두 Min 계약 지급률 11%를 적용합니다."),
    },
    {
      id: makeId(),
      name: "Seo",
      role: "멤버",
      rate: 10,
      revenueWeight: 1.1,
      contract: createContract("중상", "회사 부담", "높음", "회사 50%를 제외한 멤버 몫 50% 안에서 연기 활동성과 회사 투자 회수 조건을 함께 반영해 10%를 배정합니다.", "공통 매출과 연기/카메오 매출 모두 Seo 계약 지급률 10%를 적용합니다."),
    },
    {
      id: makeId(),
      name: "Lia",
      role: "멤버",
      rate: 9,
      revenueWeight: 0.8,
      contract: createContract("중", "회사 부담", "높음", "회사 50%를 제외한 멤버 몫 50% 안에서 현재 개인 활동 기여도와 회사 투자 부담을 반영해 9%를 배정합니다.", "공통 매출과 향후 개인 매출 모두 Lia 계약 지급률 9%를 적용합니다."),
    },
    {
      id: makeId(),
      name: "Noa",
      role: "멤버",
      rate: 7,
      revenueWeight: 0.6,
      contract: createContract("하", "회사 부담", "높음", "회사 50%를 제외한 멤버 몫 50% 안에서 현재 개인 활동 기여도와 회사 선투자 비중을 반영해 7%를 배정합니다.", "투자 회수 기간 종료 후 지급률 재협상 대상입니다."),
    },
  ];
  state.staff = [
    { id: makeId(), name: "Manager Park", role: "매니저", settlementExcluded: true },
  ];
  state.selectedContractId = state.members[0].id;
  state.revenueItems = [
    createRevenue("2026-07-02", "쇼케이스 공연 수익", "공통 매출", 48000000, ["Haru", "Min", "Seo", "Lia", "Noa"]),
    createRevenue("2026-07-04", "Haru 예능 출연료", "개인 매출", 8000000, ["Haru"]),
    createRevenue("2026-07-05", "Min 라디오 DJ 출연료", "개인 매출", 5500000, ["Min"]),
    createRevenue("2026-07-08", "Seo 드라마 카메오 출연료", "개인 매출", 7200000, ["Seo"]),
    createRevenue("2026-07-10", "콘서트 수익", "공통 매출", 72000000, ["Haru", "Min", "Seo", "Lia", "Noa"]),
  ];
  state.attendance = [
    ["2026-07-01", "Haru", "출근"], ["2026-07-01", "Min", "출근"], ["2026-07-01", "Seo", "출근"], ["2026-07-01", "Lia", "출근"],
    ["2026-07-03", "Haru", "외부일정"], ["2026-07-03", "Min", "외부일정"], ["2026-07-03", "Seo", "외부일정"], ["2026-07-03", "Lia", "외부일정"], ["2026-07-03", "Noa", "외부일정"],
    ["2026-07-06", "Min", "출근"], ["2026-07-06", "Seo", "출근"],
    ["2026-07-09", "Haru", "외부일정"], ["2026-07-09", "Lia", "외부일정"], ["2026-07-09", "Noa", "외부일정"],
  ].map(([date, member, status]) => ({ id: makeId(), date, member, status }));
  state.schedules = [
    { id: makeId(), date: "2026-07-01", title: "컴백 안무 연습", members: ["Haru", "Min", "Seo", "Lia"] },
    { id: makeId(), date: "2026-07-03", title: "음악 방송 사전녹화", members: ["Haru", "Min", "Seo", "Lia", "Noa"] },
    { id: makeId(), date: "2026-07-06", title: "라디오 게스트", members: ["Min", "Seo"] },
    { id: makeId(), date: "2026-07-09", title: "안무 수정 리허설", members: ["Haru", "Lia", "Noa"] },
  ];
  state.expenses = [
    createExpense("2026-07-01", "배민 연습실 식사", 92000),
    createExpense("2026-07-03", "음악방송 도시락", 165000),
    createExpense("2026-07-06", "라디오 대기 간식", 48000),
    createExpense("2026-07-09", "안무 연습 일식", 74000),
  ];
  state.auditLogs = [
    { id: makeId(), at: "2026-07-08 09:00", actor: "정산 담당자", action: "더미 연동", detail: "Samildol 활동 기록, 일정표, 매출 항목, 식비 결제 건을 불러왔습니다." },
  ];
  syncInputs();
  render();
}

function normalizeState() {
  state.version = DATA_VERSION;
  state.approvalLimit = Number(state.approvalLimit || 30000);
  state.companyRate = Number(state.companyRate ?? 50);
  state.members = Array.isArray(state.members) ? state.members : [];
  state.staff = Array.isArray(state.staff) ? state.staff : [];
  const movedStaff = state.members.filter((member) => EXCLUDED_ROLES.has(member.role));
  if (movedStaff.length) {
    state.staff.push(...movedStaff.map((member) => ({
      id: member.id || makeId(),
      name: member.name,
      role: member.role,
      settlementExcluded: true,
    })));
    state.members = state.members.filter((member) => !EXCLUDED_ROLES.has(member.role));
  }
  const seenStaff = new Set();
  state.staff = state.staff.filter((person) => {
    const key = person.name;
    if (!key || seenStaff.has(key)) return false;
    seenStaff.add(key);
    person.role = person.role || "스태프";
    person.settlementExcluded = true;
    return true;
  });
  state.members.forEach((member) => {
    member.role = ROLES.includes(member.role) ? member.role : "멤버";
    member.rate = Number(member.rate || 0);
    member.revenueWeight = Number(member.revenueWeight ?? (EXCLUDED_ROLES.has(member.role) ? 0 : 1));
    applyContractPreset(member);
  });
  if (!state.selectedContractId && state.members.length) state.selectedContractId = state.members[0].id;
  state.revenueItems = Array.isArray(state.revenueItems) ? state.revenueItems : [];
  state.revenueItems.forEach((item) => {
    item.type = REVENUE_TYPES.includes(item.type) ? item.type : "공통 매출";
    item.amount = Number(item.amount || 0);
    item.participants = Array.isArray(item.participants) ? item.participants : [];
  });
  state.expenses = Array.isArray(state.expenses) ? state.expenses : [];
  state.expenses.forEach((expense) => {
    expense.amount = Number(expense.amount || 0);
    expense.participants = Array.isArray(expense.participants) ? expense.participants : [];
    expense.excluded = Array.isArray(expense.excluded) ? expense.excluded : [];
    expense.approvalStatus = APPROVAL_STATES.includes(expense.approvalStatus) ? expense.approvalStatus : defaultApprovalStatus(expense);
    expense.approver = expense.approver || "상위 매니저";
  });
  state.attendance = Array.isArray(state.attendance) ? state.attendance : [];
  state.schedules = Array.isArray(state.schedules) ? state.schedules : [];
  state.auditLogs = Array.isArray(state.auditLogs) ? state.auditLogs : [];
}

function renderMembers() {
  els.memberRows.innerHTML = "";
  state.members.forEach((member) => {
    const calc = calculateMember(member);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input value="${escapeHtml(member.name)}" data-field="name" data-id="${member.id}" aria-label="멤버명"></td>
      <td>
        <select data-field="role" data-id="${member.id}" aria-label="역할">
          ${ROLES.map((role) => `<option value="${role}" ${member.role === role ? "selected" : ""}>${role}</option>`).join("")}
        </select>
      </td>
      <td class="money">${currency.format(calc.revenue.common)}</td>
      <td class="money">${currency.format(calc.revenue.commonPayout)}</td>
      <td class="money">${currency.format(calc.revenue.individualPayout)}</td>
      <td><input type="number" min="0" max="100" step="0.1" value="${member.rate}" data-field="rate" data-id="${member.id}" aria-label="계약 지급률"></td>
      <td><button class="small ghost contract-button" type="button" data-show-contract="${member.id}" title="${escapeHtml(contractLine(member))}">계약 보기</button></td>
      <td>${calc.mealCount}건</td>
      <td class="money">${currency.format(calc.gross)}</td>
      <td class="money deduction">-${currency.format(calc.food)}</td>
      <td class="money net">${currency.format(calc.net)}</td>
      <td><button class="remove" type="button" data-remove-member="${member.id}" aria-label="멤버 삭제">x</button></td>
    `;
    els.memberRows.appendChild(tr);
  });
}

function renderRevenue() {
  els.revenueRows.innerHTML = "";
  state.revenueItems.forEach((item) => {
    const count = settlementMembers(item.participants).length;
    const mode = item.type === "개인 매출" ? "개인 귀속" : `공통 매출 풀 (${count}명 참여)`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="date" value="${item.date}" data-revenue-field="date" data-id="${item.id}" aria-label="매출 날짜"></td>
      <td><input value="${escapeHtml(item.title)}" data-revenue-field="title" data-id="${item.id}" aria-label="매출 내역"></td>
      <td>
        <select data-revenue-field="type" data-id="${item.id}" aria-label="매출 구분">
          ${REVENUE_TYPES.map((type) => `<option value="${type}" ${item.type === type ? "selected" : ""}>${type}</option>`).join("")}
        </select>
      </td>
      <td><input type="number" min="0" step="10000" value="${item.amount}" data-revenue-field="amount" data-id="${item.id}" aria-label="매출 금액"></td>
      <td><input value="${escapeHtml(item.participants.join(", "))}" data-revenue-field="participants" data-id="${item.id}" aria-label="매출 참여 멤버"></td>
      <td>${mode}</td>
      <td><button class="remove" type="button" data-remove-revenue="${item.id}" aria-label="매출 삭제">x</button></td>
    `;
    els.revenueRows.appendChild(tr);
  });
}

function renderExpenses() {
  els.expenseRows.innerHTML = "";
  state.expenses.forEach((expense) => {
    const share = expenseShare(expense);
    const needsApproval = expenseNeedsApproval(expense);
    const status = expenseStatus(expense);
    const billableCount = billableParticipants(expense).length;
    const tr = document.createElement("tr");
    tr.className = needsApproval && status !== "승인 완료" ? "approval-row" : "";
    tr.innerHTML = `
      <td><input type="date" value="${expense.date}" data-expense-field="date" data-id="${expense.id}" aria-label="날짜"></td>
      <td><input value="${escapeHtml(expense.title)}" data-expense-field="title" data-id="${expense.id}" aria-label="내역"></td>
      <td><input type="number" min="0" step="1000" value="${expense.amount}" data-expense-field="amount" data-id="${expense.id}" aria-label="금액"></td>
      <td><input value="${escapeHtml(expense.participants.join(", "))}" data-expense-field="participants" data-id="${expense.id}" aria-label="예상 식사인원"></td>
      <td><input value="${escapeHtml(expense.excluded.join(", "))}" data-expense-field="excluded" data-id="${expense.id}" aria-label="정산 제외"></td>
      <td>정산 대상 균등 배분 (${billableCount}명)</td>
      <td class="money">${currency.format(share)}</td>
      <td>
        <select data-expense-field="approvalStatus" data-id="${expense.id}" aria-label="승인 상태">
          ${APPROVAL_STATES.map((item) => `<option value="${item}" ${status === item ? "selected" : ""}>${item}</option>`).join("")}
        </select>
      </td>
      <td><input value="${escapeHtml(expense.approver)}" data-expense-field="approver" data-id="${expense.id}" aria-label="승인권자"></td>
      <td><button class="small recommend-button" type="button" data-recommend-expense="${expense.id}" title="같은 날짜의 출퇴근 기록과 일정표를 기준으로 예상 식사인원을 채웁니다.">예상 식사인원</button></td>
      <td><button class="remove" type="button" data-remove-expense="${expense.id}" aria-label="비용 삭제">x</button></td>
    `;
    els.expenseRows.appendChild(tr);
  });
}

function renderAttendance() {
  els.attendanceList.innerHTML = "";
  const dates = attendanceDates();
  const table = document.createElement("table");
  table.className = "attendance-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>날짜</th>
        ${state.members.map((member) => `<th>${escapeHtml(member.name)}</th>`).join("")}
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${dates.map((date) => `
        <tr>
          <td><input type="date" value="${date}" data-attendance-date="${date}" aria-label="활동 날짜"></td>
          ${state.members.map((member) => {
            const row = findAttendance(date, member.name);
            const status = row?.status || "";
            return `
              <td>
                <select data-attendance-cell-date="${date}" data-attendance-cell-member="${escapeHtml(member.name)}" aria-label="${escapeHtml(member.name)} 활동 상태">
                  <option value="" ${status === "" ? "selected" : ""}>-</option>
                  ${ACTIVITY_STATES.map((item) => `<option value="${item}" ${status === item ? "selected" : ""}>${item}</option>`).join("")}
                </select>
              </td>
            `;
          }).join("")}
          <td><button class="remove" type="button" data-remove-attendance-date="${date}" aria-label="날짜 삭제">x</button></td>
        </tr>
      `).join("")}
    </tbody>
  `;
  els.attendanceList.appendChild(table);
}

function renderSchedules() {
  els.scheduleList.innerHTML = "";
  state.schedules.forEach((row) => {
    const div = document.createElement("div");
    div.className = "record-row schedule-row";
    div.innerHTML = `
      <input type="date" value="${row.date}" data-schedule-field="date" data-id="${row.id}" aria-label="날짜">
      <input value="${escapeHtml(row.title)}" data-schedule-field="title" data-id="${row.id}" aria-label="일정명">
      <input value="${escapeHtml(row.members.join(", "))}" data-schedule-field="members" data-id="${row.id}" aria-label="참여 멤버">
      <button class="remove" type="button" data-remove-schedule="${row.id}" aria-label="일정 삭제">x</button>
    `;
    els.scheduleList.appendChild(div);
  });
}

function renderAuditLogs() {
  els.auditList.innerHTML = state.auditLogs.slice(0, 12).map((log) => `
    <div class="audit-row">
      <strong>${escapeHtml(log.action)}</strong>
      <span>${escapeHtml(log.at)} · ${escapeHtml(log.actor)}</span>
      <p>${escapeHtml(log.detail)}</p>
    </div>
  `).join("");
}

function renderTotals() {
  const totals = state.members.reduce(
    (acc, member) => {
      const calc = calculateMember(member);
      acc.revenue += calc.revenue.total;
      acc.gross += calc.gross;
      acc.food += calc.food;
      return acc;
    },
    { revenue: 0, gross: 0, food: 0 },
  );
  const commonRevenue = commonRevenuePool();
  const rateTotal = contractRateTotal();
  const approvalCount = state.expenses.filter((expense) => inPeriod(expense.date) && ["승인 대기", "보류"].includes(expenseStatus(expense))).length;
  els.totalCommonRevenue.textContent = currency.format(commonRevenue);
  els.companyShare.textContent = currency.format(companyShareAmount());
  els.rateTotal.textContent = `${rateTotal}%`;
  els.rateTotal.parentElement?.classList.toggle("warning-card", rateTotal !== 100);
  els.totalRevenue.textContent = currency.format(totals.revenue);
  els.totalGross.textContent = currency.format(totals.gross);
  els.totalFood.textContent = currency.format(totals.food);
  els.approvalCount.textContent = `${approvalCount}건`;
  document.title = `${state.groupName} Food-Fee 정산`;
}

function render() {
  normalizeState();
  localStorage.setItem("foodFeeState", JSON.stringify(state));
  renderMembers();
  renderRevenue();
  renderExpenses();
  renderAttendance();
  renderSchedules();
  renderAuditLogs();
  renderContractDetail();
  renderTotals();
}

function updateSettings() {
  state.groupName = els.groupName.value.trim() || "그룹";
  state.periodStart = els.periodStart.value;
  state.periodEnd = els.periodEnd.value;
  state.approvalLimit = Number(els.approvalLimit.value || 0);
  state.companyRate = Number(els.companyRate.value || 0);
  render();
}

function sectionRows(title, headers, rows) {
  return [[{ value: title, style: 5 }], headers.map((value) => ({ value, style: 3 })), ...rows, []];
}

function workbookRows() {
  const summary = [
    [{ value: "Food-Fee 정산 결과", style: 1 }],
    [{ value: "그룹명", style: 2 }, { value: state.groupName }],
    [{ value: "정산 기간", style: 2 }, { value: `${state.periodStart} ~ ${state.periodEnd}` }],
    [{ value: "1인 승인 기준", style: 2 }, { value: state.approvalLimit, style: 4 }],
    [{ value: "공통 매출 풀", style: 2 }, { value: commonRevenuePool(), style: 4 }],
    [{ value: "회사 몫", style: 2 }, { value: companyShareAmount(), style: 4 }],
    [{ value: "지급률 합계", style: 2 }, { value: contractRateTotal(), style: 4 }],
    [],
  ];
  const revenueRows = state.revenueItems.map((item) => [
    { value: item.date }, { value: item.title }, { value: item.type }, { value: item.amount, style: 4 },
    { value: item.participants.join(", ") }, { value: settlementMembers(item.participants).length, style: 4 },
  ]);
  const memberRows = state.members.map((member) => {
    const calc = calculateMember(member);
    return [
      { value: member.name }, { value: member.role }, { value: calc.revenue.common, style: 4 }, { value: calc.revenue.commonPayout, style: 4 },
      { value: calc.revenue.individual, style: 4 }, { value: calc.revenue.individualPayout, style: 4 }, { value: member.rate, style: 4 }, { value: contractLine(member) }, { value: calc.mealCount, style: 4 },
      { value: calc.gross, style: 4 }, { value: calc.food, style: 4 }, { value: calc.net, style: 4 },
    ];
  });
  const contractRows = state.members.map((member) => {
    const contract = member.contract || fallbackContract(member);
    return [
      { value: member.name }, { value: member.role }, { value: member.rate, style: 4 }, { value: contract.contractType },
      { value: contract.popularityTier }, { value: contract.traineeCost }, { value: contract.companyInvestment },
      { value: contract.rateBasis }, { value: contract.specialClause },
    ];
  });
  const expenseRows = state.expenses.map((expense) => [
    { value: expense.date }, { value: expense.title }, { value: expense.amount, style: 4 },
    { value: expense.participants.join(", ") }, { value: expense.excluded.join(", ") }, { value: billableParticipants(expense).join(", ") },
    { value: expenseShare(expense), style: 4 }, { value: expenseStatus(expense), style: ["승인 대기", "보류"].includes(expenseStatus(expense)) ? 7 : 6 },
    { value: expense.approver },
  ]);
  const approvalRows = state.expenses
    .filter((expense) => ["승인 대기", "보류", "반려"].includes(expenseStatus(expense)))
    .map((expense) => [
      { value: expense.date }, { value: expense.title }, { value: expense.amount, style: 4 },
      { value: expenseShare(expense), style: 4 }, { value: expenseStatus(expense), style: 7 }, { value: expense.approver },
    ]);
  const activityRows = state.attendance.map((row) => [{ value: row.date }, { value: row.member }, { value: row.status }]);
  const scheduleRows = state.schedules.map((row) => [{ value: row.date }, { value: row.title }, { value: row.members.join(", ") }]);
  const auditRows = state.auditLogs.map((log) => [{ value: log.at }, { value: log.actor }, { value: log.action }, { value: log.detail }]);
  return [
    ...summary,
    ...sectionRows("매출 항목", ["날짜", "내역", "구분", "금액", "참여 멤버", "정산 대상 수"], revenueRows),
    ...sectionRows("멤버별 정산", ["멤버", "역할", "공통 매출 풀", "공통 정산금", "개인 매출 원금", "개인 정산금", "계약 지급률", "계약 근거", "식비 건수", "공제 전", "식비 공제", "공제 후"], memberRows),
    ...sectionRows("계약서 참조", ["멤버", "역할", "계약 지급률", "계약 유형", "개인 활동 기여도", "연습생 생활비", "회사 투자", "지급률 근거", "특약"], contractRows),
    ...sectionRows("비용별 분배", ["날짜", "내역", "금액", "예상 식사인원", "정산 제외", "정산 대상", "1인 금액", "상태", "승인권자"], expenseRows),
    ...sectionRows("승인 필요 건", ["날짜", "내역", "금액", "1인 금액", "상태", "승인권자"], approvalRows),
    ...sectionRows("활동 기록", ["날짜", "멤버", "상태"], activityRows),
    ...sectionRows("일정표", ["날짜", "일정명", "참여 멤버"], scheduleRows),
    ...sectionRows("감사 로그", ["일시", "작업자", "작업", "내용"], auditRows),
  ];
}

function worksheetXml() {
  const rows = workbookRows();
  const rowXml = rows.map((row, index) => sheetRow(index + 1, row)).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <cols>
        <col min="1" max="1" width="18" customWidth="1"/>
        <col min="2" max="2" width="24" customWidth="1"/>
        <col min="3" max="10" width="18" customWidth="1"/>
      </cols>
      <sheetData>${rowXml}</sheetData>
    </worksheet>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>
      <fonts count="4">
        <font><sz val="11"/><name val="Malgun Gothic"/></font>
        <font><b/><sz val="16"/><name val="Malgun Gothic"/></font>
        <font><b/><sz val="11"/><name val="Malgun Gothic"/></font>
        <font><b/><color rgb="FF9A5B00"/><sz val="11"/><name val="Malgun Gothic"/></font>
      </fonts>
      <fills count="6">
        <fill><patternFill patternType="none"/></fill>
        <fill><patternFill patternType="gray125"/></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FFD9EDF2"/><bgColor indexed="64"/></patternFill></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FFEAF3F6"/><bgColor indexed="64"/></patternFill></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FFF2F6F8"/><bgColor indexed="64"/></patternFill></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FFFFF0D7"/><bgColor indexed="64"/></patternFill></fill>
      </fills>
      <borders count="2">
        <border><left/><right/><top/><bottom/><diagonal/></border>
        <border><left style="thin"><color rgb="FFD9E1E5"/></left><right style="thin"><color rgb="FFD9E1E5"/></right><top style="thin"><color rgb="FFD9E1E5"/></top><bottom style="thin"><color rgb="FFD9E1E5"/></bottom><diagonal/></border>
      </borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="8">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
        <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
        <xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
        <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
        <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
        <xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
        <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
        <xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
      </cellXfs>
      <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
    </styleSheet>`;
}

function buildXlsxBytes() {
  return makeZip([
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Food-Fee 정산" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/worksheets/sheet1.xml", content: worksheetXml() },
    { name: "xl/styles.xml", content: stylesXml() },
  ]);
}

function exportWorkbook() {
  const workbook = buildXlsxBytes();
  const blob = new Blob([workbook], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeGroupName = state.groupName.replace(/[\\/:*?"<>|]/g, "_") || "Food-Fee";
  a.href = url;
  a.download = `${safeGroupName}_Food-Fee_${state.periodStart}_${state.periodEnd}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

document.addEventListener("input", (event) => {
  const target = event.target;
  if ([els.groupName, els.periodStart, els.periodEnd, els.approvalLimit].includes(target)) updateSettings();
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.field) {
    const member = state.members.find((item) => item.id === target.dataset.id);
    const previousName = member.name;
    const previous = member[target.dataset.field];
    member[target.dataset.field] = ["rate", "revenueWeight"].includes(target.dataset.field) ? Number(target.value || 0) : target.value;
    if (target.dataset.field === "name") {
      state.revenueItems.forEach((item) => {
        item.participants = item.participants.map((name) => (name === previousName ? member.name : name));
      });
      state.expenses.forEach((expense) => {
        expense.participants = expense.participants.map((name) => (name === previousName ? member.name : name));
        expense.excluded = expense.excluded.map((name) => (name === previousName ? member.name : name));
      });
      state.attendance.forEach((row) => {
        if (row.member === previousName) row.member = member.name;
      });
      state.schedules.forEach((row) => {
        row.members = row.members.map((name) => (name === previousName ? member.name : name));
      });
    }
    if (target.dataset.field === "role") {
      state.expenses.forEach((expense) => {
        expense.excluded = defaultExcluded(expense.participants);
        expense.approvalStatus = defaultApprovalStatus(expense);
      });
    }
    addAudit("멤버 정보 수정", `${member.name} ${target.dataset.field}: ${previous} -> ${member[target.dataset.field]}`);
    render();
  }
  if (target.dataset.revenueField) {
    const item = state.revenueItems.find((row) => row.id === target.dataset.id);
    const previous = item[target.dataset.revenueField];
    if (target.dataset.revenueField === "amount") item.amount = Number(target.value || 0);
    else if (target.dataset.revenueField === "participants") item.participants = splitNames(target.value);
    else item[target.dataset.revenueField] = target.value;
    addAudit("매출 항목 수정", `${item.title} ${target.dataset.revenueField}: ${previous} -> ${item[target.dataset.revenueField]}`);
    render();
  }
  if (target.dataset.expenseField) {
    const expense = state.expenses.find((item) => item.id === target.dataset.id);
    const previous = expense[target.dataset.expenseField];
    if (target.dataset.expenseField === "amount") expense.amount = Number(target.value || 0);
    else if (target.dataset.expenseField === "participants") {
      expense.participants = splitNames(target.value);
      expense.excluded = defaultExcluded(expense.participants);
    } else if (target.dataset.expenseField === "excluded") expense.excluded = splitNames(target.value);
    else expense[target.dataset.expenseField] = target.value;
    if (["amount", "participants", "excluded", "date"].includes(target.dataset.expenseField) && target.dataset.expenseField !== "approvalStatus") {
      expense.approvalStatus = defaultApprovalStatus(expense);
    }
    addAudit("비용 건 수정", `${expense.title} ${target.dataset.expenseField}: ${previous} -> ${expense[target.dataset.expenseField]}`);
    render();
  }
  if (target.dataset.attendanceCellDate) {
    setAttendance(target.dataset.attendanceCellDate, target.dataset.attendanceCellMember, target.value);
    render();
  }
  if (target.dataset.attendanceDate) {
    const previousDate = target.dataset.attendanceDate;
    state.attendance.forEach((row) => {
      if (row.date === previousDate) row.date = target.value;
    });
    addAudit("활동 날짜 변경", `${previousDate} -> ${target.value}`);
    render();
  }
  if (target.dataset.scheduleField) {
    const row = state.schedules.find((item) => item.id === target.dataset.id);
    const previous = row[target.dataset.scheduleField];
    row[target.dataset.scheduleField] = target.dataset.scheduleField === "members" ? splitNames(target.value) : target.value;
    addAudit("일정표 수정", `${row.title} ${target.dataset.scheduleField}: ${previous} -> ${row[target.dataset.scheduleField]}`);
    render();
  }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (target.id === "exportButton") exportWorkbook();
  if (target.id === "seedButton") seedData();
  if (target.id === "resetButton") {
    localStorage.removeItem("foodFeeState");
    seedData();
  }
  if (target.id === "addMemberButton") {
    const member = { id: makeId(), name: "New", role: "멤버", rate: 40, revenueWeight: 1, contract: fallbackContract({ role: "멤버" }) };
    state.members.push(member);
    state.selectedContractId = member.id;
    addAudit("멤버 추가", "New 멤버를 추가했습니다.");
    render();
  }
  if (target.dataset.showContract) {
    state.selectedContractId = target.dataset.showContract;
    render();
  }
  if (target.id === "addRevenueButton") {
    const first = state.members.find((item) => item.role === "멤버")?.name || "New";
    state.revenueItems.push(createRevenue(state.periodStart, "새 매출", "공통 매출", 0, [first]));
    addAudit("매출 항목 추가", "새 매출 항목을 추가했습니다.");
    render();
  }
  if (target.id === "addExpenseButton") {
    const expense = createExpense(state.periodStart, "새 식비", 0);
    state.expenses.push(expense);
    addAudit("비용 추가", `${expense.date} 새 식비를 추가했습니다.`);
    render();
  }
  if (target.id === "addAttendanceButton") {
    const date = nextAttendanceDate();
    state.members.forEach((member) => {
      state.attendance.push({ id: makeId(), date, member: member.name, status: "출근" });
    });
    addAudit("활동 날짜 추가", `${date} 활동 기록을 추가했습니다.`);
    render();
  }
  if (target.id === "addScheduleButton") {
    const member = state.members.find((item) => item.role === "멤버")?.name || "New";
    state.schedules.push({ id: makeId(), date: state.periodStart, title: "새 일정", members: [member] });
    addAudit("일정 추가", "새 일정을 추가했습니다.");
    render();
  }
  if (target.id === "importCsvButton") {
    const rows = els.csvInput.value
      .split(/\r?\n/)
      .map((line) => line.split(",").map((cell) => cell.trim()))
      .filter((cells) => cells.length >= 2 && cells[0] && cells[1]);
    state.attendance.push(...rows.map(([date, member, status = "출근"]) => ({ id: makeId(), date, member, status })));
    addAudit("활동 기록 가져오기", `${rows.length}건을 가져왔습니다.`);
    render();
  }
  if (target.dataset.recommendExpense) {
    const expense = state.expenses.find((item) => item.id === target.dataset.recommendExpense);
    syncExpenseRecommendation(expense);
    render();
  }
  if (target.dataset.removeMember) {
    const member = state.members.find((item) => item.id === target.dataset.removeMember);
    state.members = state.members.filter((item) => item.id !== target.dataset.removeMember);
    addAudit("멤버 삭제", `${member?.name || "알 수 없음"}을 삭제했습니다.`);
    render();
  }
  if (target.dataset.removeRevenue) {
    const item = state.revenueItems.find((row) => row.id === target.dataset.removeRevenue);
    state.revenueItems = state.revenueItems.filter((row) => row.id !== target.dataset.removeRevenue);
    addAudit("매출 항목 삭제", `${item?.title || "알 수 없음"}을 삭제했습니다.`);
    render();
  }
  if (target.dataset.removeExpense) {
    const expense = state.expenses.find((item) => item.id === target.dataset.removeExpense);
    state.expenses = state.expenses.filter((item) => item.id !== target.dataset.removeExpense);
    addAudit("비용 삭제", `${expense?.title || "알 수 없음"}을 삭제했습니다.`);
    render();
  }
  if (target.dataset.removeAttendanceDate) {
    state.attendance = state.attendance.filter((row) => row.date !== target.dataset.removeAttendanceDate);
    addAudit("활동 날짜 삭제", `${target.dataset.removeAttendanceDate} 활동 기록을 삭제했습니다.`);
    render();
  }
  if (target.dataset.removeSchedule) {
    const schedule = state.schedules.find((item) => item.id === target.dataset.removeSchedule);
    state.schedules = state.schedules.filter((item) => item.id !== target.dataset.removeSchedule);
    addAudit("일정 삭제", `${schedule?.title || "알 수 없음"}을 삭제했습니다.`);
    render();
  }
});

function boot() {
  const saved = localStorage.getItem("foodFeeState");
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed.version !== DATA_VERSION) {
      seedData();
      return;
    }
    Object.assign(state, parsed);
    normalizeState();
    syncInputs();
    render();
  } else {
    seedData();
  }
}

boot();
