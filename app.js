const currency = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

const DATA_VERSION = 13;
const ROLES = ["멤버", "매니저", "스태프", "게스트"];
const EXCLUDED_ROLES = new Set(["매니저", "스태프", "게스트"]);
const REVENUE_TYPES = ["공통 매출", "개인 매출"];
const APPROVAL_STATES = ["자동 처리", "승인 대기", "승인 완료", "반려", "보류"];
const ACTIVITY_STATES = ["출근", "대기", "외부일정", "제외"];
const INTERNAL_USERS = [
  { id: "FIN-1024", name: "정산 담당자", role: "정산 담당자", canEdit: true, canExport: true, canApprove: false },
  { id: "MGR-2201", name: "상위 매니저", role: "승인권자", canEdit: false, canExport: true, canApprove: true },
  { id: "HR-3007", name: "인사 마스터", role: "내부 데이터 관리자", canEdit: true, canExport: false, canApprove: true },
];

const state = {
  version: DATA_VERSION,
  groupName: "Samildol",
  periodStart: "2026-07-01",
  periodEnd: "2026-07-15",
  approvalLimit: 30000,
  concurrentApprovalCount: 3,
  companyRate: 50,
  currentUserId: "FIN-1024",
  members: [],
  staff: [],
  revenueItems: [],
  expenses: [],
  marketingPayroll: [],
  marketingInitialized: false,
  attendance: [],
  schedules: [],
  auditLogs: [],
  selectedContractId: "",
};

const els = {
  groupName: document.querySelector("#groupName"),
  currentUser: document.querySelector("#currentUser"),
  authNotice: document.querySelector("#authNotice"),
  periodStart: document.querySelector("#periodStart"),
  periodEnd: document.querySelector("#periodEnd"),
  approvalLimit: document.querySelector("#approvalLimit"),
  concurrentApprovalCount: document.querySelector("#concurrentApprovalCount"),
  companyRate: document.querySelector("#companyRate"),
  memberRows: document.querySelector("#memberRows"),
  revenueRows: document.querySelector("#revenueRows"),
  expenseRows: document.querySelector("#expenseRows"),
  marketingRows: document.querySelector("#marketingRows"),
  attendanceList: document.querySelector("#attendanceList"),
  scheduleList: document.querySelector("#scheduleList"),
  auditList: document.querySelector("#auditList"),
  contractDetail: document.querySelector("#contractDetail"),
  importIdolButton: document.querySelector("#importIdolButton"),
  syncExternalButton: document.querySelector("#syncExternalButton"),
  externalExcelInput: document.querySelector("#externalExcelInput"),
  totalRevenue: document.querySelector("#totalRevenue"),
  totalCommonRevenue: document.querySelector("#totalCommonRevenue"),
  companyShare: document.querySelector("#companyShare"),
  rateTotal: document.querySelector("#rateTotal"),
  totalGross: document.querySelector("#totalGross"),
  totalFood: document.querySelector("#totalFood"),
  totalMarketing: document.querySelector("#totalMarketing"),
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

function currentUser() {
  return INTERNAL_USERS.find((user) => user.id === state.currentUserId) || INTERNAL_USERS[0];
}

function actorLabel(user = currentUser()) {
  return `${user.id} ${user.name}(${user.role})`;
}

function addAudit(action, detail, user = currentUser()) {
  state.auditLogs.unshift({
    id: makeId(),
    at: formatTime(),
    actor: actorLabel(user),
    actorId: user.id,
    actorRole: user.role,
    action,
    detail,
  });
  state.auditLogs = state.auditLogs.slice(0, 80);
}

function ensureEditPermission(action) {
  const user = currentUser();
  if (user.canEdit) return true;
  addAudit("입력 차단", `${action}: ${user.name} 계정은 입력 권한이 없습니다.`, user);
  alert("현재 계정은 입력 권한이 없습니다.");
  render();
  return false;
}

function ensureApprovalPermission(action) {
  const user = currentUser();
  if (user.canApprove) return true;
  addAudit("승인 차단", `${action}: ${user.name} 계정은 승인 권한이 없습니다.`, user);
  alert("현재 계정은 승인 권한이 없습니다.");
  render();
  return false;
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

function readU16(data, offset) {
  return data[offset] | (data[offset + 1] << 8);
}

function readU32(data, offset) {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

async function inflateRaw(bytes) {
  if (!("DecompressionStream" in window)) throw new Error("현재 브라우저는 XLSX 압축 해제를 지원하지 않습니다.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipWorkbook(buffer) {
  const data = new Uint8Array(buffer);
  let eocd = -1;
  for (let offset = data.length - 22; offset >= 0; offset -= 1) {
    if (readU32(data, offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("엑셀 파일 구조를 찾을 수 없습니다.");
  const fileCount = readU16(data, eocd + 10);
  let cursor = readU32(data, eocd + 16);
  const files = new Map();
  const decoder = new TextDecoder("utf-8");
  for (let index = 0; index < fileCount; index += 1) {
    if (readU32(data, cursor) !== 0x02014b50) throw new Error("엑셀 중앙 디렉터리를 읽을 수 없습니다.");
    const method = readU16(data, cursor + 10);
    const compressedSize = readU32(data, cursor + 20);
    const nameLength = readU16(data, cursor + 28);
    const extraLength = readU16(data, cursor + 30);
    const commentLength = readU16(data, cursor + 32);
    const localOffset = readU32(data, cursor + 42);
    const name = decoder.decode(data.slice(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = readU16(data, localOffset + 26);
    const localExtraLength = readU16(data, localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = data.slice(start, start + compressedSize);
    const content = method === 0 ? compressed : await inflateRaw(compressed);
    files.set(name, decoder.decode(content));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function excelSerialDate(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial)) return String(value || "");
  const utc = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(utc).toISOString().slice(0, 10);
}

function xlsxCellValue(cell, sharedStrings) {
  const type = cell.getAttribute("t");
  if (type === "inlineStr") return cell.querySelector("is t")?.textContent || "";
  const raw = cell.querySelector("v")?.textContent || "";
  if (type === "s") return sharedStrings[Number(raw)] || "";
  return raw;
}

function xlsxColumnIndex(ref) {
  const letters = String(ref || "").replace(/\d/g, "");
  return [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

async function readActivityWorkbook(file) {
  const xmlFiles = await unzipWorkbook(await file.arrayBuffer());
  const parser = new DOMParser();
  const sharedDoc = parser.parseFromString(xmlFiles.get("xl/sharedStrings.xml") || "<sst/>", "application/xml");
  const sharedStrings = [...sharedDoc.querySelectorAll("si")].map((node) => [...node.querySelectorAll("t")].map((text) => text.textContent).join(""));
  const sheetXml = xmlFiles.get("xl/worksheets/sheet1.xml");
  if (!sheetXml) throw new Error("첫 번째 시트를 찾을 수 없습니다.");
  const sheetDoc = parser.parseFromString(sheetXml, "application/xml");
  const rows = [...sheetDoc.querySelectorAll("sheetData row")].map((row) => {
    const values = [];
    [...row.querySelectorAll("c")].forEach((cell) => {
      values[xlsxColumnIndex(cell.getAttribute("r"))] = xlsxCellValue(cell, sharedStrings);
    });
    return values.map((value) => String(value || "").trim());
  }).filter((row) => row.some(Boolean));
  const headers = (rows.shift() || []).map((header) => header.replace(/\s/g, ""));
  const dateIndex = headers.findIndex((header) => header === "날짜" || header.toLowerCase() === "date");
  const memberIndex = headers.findIndex((header) => header === "멤버" || header.toLowerCase() === "member");
  const statusIndex = headers.findIndex((header) => header === "상태" || header.toLowerCase() === "status");
  if (dateIndex < 0 || memberIndex < 0) throw new Error("활동 기록 시트에는 날짜, 멤버 컬럼이 필요합니다.");
  return rows.map((row) => ({
    date: /^\d+(\.\d+)?$/.test(row[dateIndex]) ? excelSerialDate(row[dateIndex]) : row[dateIndex],
    member: row[memberIndex],
    status: row[statusIndex] || "출근",
  })).filter((row) => row.date && row.member);
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

function createExpense(date, title, amount, transactionTime = "12:00") {
  const managers = state.staff.filter((person) => person.settlementExcluded || EXCLUDED_ROLES.has(person.role)).map((person) => person.name);
  const participants = [...new Set([...activityMembersByDate(date), ...managers])];
  const expense = {
    id: makeId(),
    date,
    transactionTime,
    title,
    amount,
    participants,
    excluded: defaultExcluded(participants),
    skippedParticipants: [],
    separateMealParticipants: [],
    approver: "상위 매니저",
    approvalMemo: "",
    recommendationNote: "더미 활동/일정 기준으로 생성됨",
    isExceptional: false,
    exceptionNote: "",
  };
  expense.approvalStatus = defaultApprovalStatus(expense);
  return expense;
}

function createRevenue(date, title, type, amount, participants) {
  return { id: makeId(), date, title, type, amount, participants };
}

function defaultMarketingPayroll() {
  return [
    { id: makeId(), name: "Kim Ara", role: "마케팅 팀장", monthlySalary: 4500000, hours: { Haru: 34, Min: 24, Seo: 20, Lia: 14, Noa: 8 } },
    { id: makeId(), name: "Lee Jun", role: "콘텐츠 마케터", monthlySalary: 3800000, hours: { Haru: 18, Min: 30, Seo: 26, Lia: 16, Noa: 10 } },
    { id: makeId(), name: "Choi Mina", role: "퍼포먼스 마케터", monthlySalary: 3400000, hours: { Haru: 12, Min: 16, Seo: 22, Lia: 28, Noa: 22 } },
  ];
}

function marketingEmployeeTotalHours(employee) {
  return state.members
    .filter((member) => !EXCLUDED_ROLES.has(member.role))
    .reduce((sum, member) => sum + Math.max(0, Number(employee.hours?.[member.name] || 0)), 0);
}

function marketingAllocations(employee) {
  const members = state.members.filter((member) => !EXCLUDED_ROLES.has(member.role));
  const totalHours = marketingEmployeeTotalHours(employee);
  if (!totalHours) return Object.fromEntries(members.map((member) => [member.name, 0]));
  const salary = Math.max(0, Math.round(Number(employee.monthlySalary || 0)));
  const allocations = members.map((member, index) => {
    const raw = salary * Math.max(0, Number(employee.hours?.[member.name] || 0)) / totalHours;
    return { name: member.name, amount: Math.floor(raw), remainder: raw - Math.floor(raw), index };
  });
  let remaining = salary - allocations.reduce((sum, item) => sum + item.amount, 0);
  [...allocations]
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach((item) => {
      if (remaining > 0) {
        item.amount += 1;
        remaining -= 1;
      }
    });
  return Object.fromEntries(allocations.map((item) => [item.name, item.amount]));
}

function marketingAllocation(employee, memberName) {
  return marketingAllocations(employee)[memberName] || 0;
}

function marketingCostForMember(memberName) {
  return state.marketingPayroll.reduce((sum, employee) => sum + marketingAllocation(employee, memberName), 0);
}

function totalMarketingOffset() {
  return state.members
    .filter((member) => !EXCLUDED_ROLES.has(member.role))
    .reduce((sum, member) => sum + marketingCostForMember(member.name), 0);
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
  const excluded = new Set([
    ...(expense.excluded || []),
    ...(expense.skippedParticipants || []),
    ...(expense.separateMealParticipants || []),
  ]);
  return expense.participants.filter((name) => !excluded.has(name));
}

function expenseShare(expense) {
  const billable = billableParticipants(expense).length;
  if (billable === 0) return 0;
  return Math.ceil(Number(expense.amount || 0) / billable);
}

function expenseHourKey(expense) {
  const hour = String(expense.transactionTime || "12:00").slice(0, 2).padStart(2, "0");
  return `${expense.date} ${hour}`;
}

function concurrentExpenseCount(expense) {
  const key = expenseHourKey(expense);
  const matches = state.expenses.filter((item) => item.approvalStatus !== "반려" && expenseHourKey(item) === key);
  return matches.length + (matches.some((item) => item.id === expense.id) ? 0 : 1);
}

function expenseApprovalReasons(expense) {
  const reasons = [];
  if (billableParticipants(expense).length === 0) reasons.push("정산 대상 없음");
  if (expenseShare(expense) > Number(state.approvalLimit || 0)) reasons.push(`1인 식비 ${currency.format(expenseShare(expense))}`);
  const concurrentCount = concurrentExpenseCount(expense);
  if (concurrentCount >= Number(state.concurrentApprovalCount || 3)) reasons.push(`동시간대 결제 ${concurrentCount}건`);
  return reasons;
}

function expenseNeedsApproval(expense) {
  return expenseApprovalReasons(expense).length > 0;
}

function defaultApprovalStatus(expense) {
  if (billableParticipants(expense).length === 0) return "보류";
  return expenseNeedsApproval(expense) ? "승인 대기" : "자동 처리";
}

function expenseStatus(expense) {
  return expense.approvalStatus || defaultApprovalStatus(expense);
}

function refreshAutomaticApprovalStatuses() {
  state.expenses.forEach((expense) => {
    if (["자동 처리", "승인 대기"].includes(expense.approvalStatus)) expense.approvalStatus = defaultApprovalStatus(expense);
  });
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
    return { revenue: revenueBreakdown(member), mealCount: 0, gross: 0, food: 0, marketing: 0, net: 0 };
  }
  const revenue = revenueBreakdown(member);
  const memberExpenses = state.expenses.filter(
    (expense) => inPeriod(expense.date) && expenseStatus(expense) !== "반려" && billableParticipants(expense).includes(member.name),
  );
  const food = memberExpenses.reduce((sum, expense) => sum + expenseShare(expense), 0);
  const marketing = marketingCostForMember(member.name);
  const gross = revenue.total;
  return { revenue, mealCount: memberExpenses.length, gross, food, marketing, net: gross - food - marketing };
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
  expense.skippedParticipants = (expense.skippedParticipants || []).filter((name) => participants.includes(name));
  expense.separateMealParticipants = (expense.separateMealParticipants || []).filter((name) => participants.includes(name));
  expense.approvalStatus = defaultApprovalStatus(expense);
  expense.recommendationNote = `활동 기록/일정표 기준 ${participants.length}명 적용`;
  addAudit("예상 식사인원 적용", `${expense.date} ${expense.title}: ${previous || "없음"} -> ${participants.join(", ") || "예상 없음"}`);
}

function syncInputs() {
  els.currentUser.innerHTML = INTERNAL_USERS.map((user) => `<option value="${user.id}" ${state.currentUserId === user.id ? "selected" : ""}>${user.id} · ${user.name} · ${user.role}</option>`).join("");
  const user = currentUser();
  els.authNotice.textContent = `${user.name} 계정으로 작업 중입니다. 입력 권한 ${user.canEdit ? "있음" : "없음"}, 출력 권한 ${user.canExport ? "있음" : "없음"}, 승인 권한 ${user.canApprove ? "있음" : "없음"}`;
  els.groupName.value = state.groupName;
  els.periodStart.value = state.periodStart;
  els.periodEnd.value = state.periodEnd;
  els.approvalLimit.value = state.approvalLimit;
  els.concurrentApprovalCount.value = state.concurrentApprovalCount;
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
  state.marketingPayroll = defaultMarketingPayroll();
  state.marketingInitialized = true;
  state.auditLogs = [
    { id: makeId(), at: "2026-07-08 09:00", actor: "정산 담당자", action: "더미 연동", detail: "Samildol 활동 기록, 일정표, 매출 항목, 식비 결제 건, 마케팅 사업부 급여와 아이돌별 투입시간을 불러왔습니다." },
  ];
  syncInputs();
  render();
}

function seedOtherIdolData() {
  state.version = DATA_VERSION;
  state.groupName = "삼데헌";
  state.periodStart = "2026-07-16";
  state.periodEnd = "2026-07-31";
  state.approvalLimit = 30000;
  state.concurrentApprovalCount = 3;
  state.companyRate = 50;
  state.members = [
    {
      id: makeId(), name: "Ari", role: "멤버", rate: 15, revenueWeight: 1.3,
      contract: createContract("상", "본인 일부 부담", "중간", "개인 광고와 패션 행사 기여도를 반영해 멤버 몫 중 15%를 배정합니다.", "개인 광고 매출에도 동일 지급률을 적용합니다."),
    },
    {
      id: makeId(), name: "Bora", role: "멤버", rate: 13, revenueWeight: 1.1,
      contract: createContract("중상", "회사 부담", "높음", "보컬 활동과 음원 기여도를 반영해 멤버 몫 중 13%를 배정합니다.", "OST 매출은 개인 매출로 구분합니다."),
    },
    {
      id: makeId(), name: "Yuna", role: "멤버", rate: 12, revenueWeight: 1,
      contract: createContract("중", "회사 부담", "높음", "방송과 팬 커뮤니티 기여도를 반영해 멤버 몫 중 12%를 배정합니다.", "방송 고정 출연료는 개인 매출로 구분합니다."),
    },
    {
      id: makeId(), name: "Dami", role: "멤버", rate: 10, revenueWeight: 0.8,
      contract: createContract("중", "회사 부담", "높음", "퍼포먼스와 해외 활동 기여도를 반영해 멤버 몫 중 10%를 배정합니다.", "해외 활동 증가 시 지급률 재협상 대상입니다."),
    },
  ];
  state.staff = [{ id: makeId(), name: "Manager Choi", role: "매니저", settlementExcluded: true }];
  state.selectedContractId = state.members[0].id;
  state.revenueItems = [
    createRevenue("2026-07-17", "미니앨범 쇼케이스", "공통 매출", 36000000, ["Ari", "Bora", "Yuna", "Dami"]),
    createRevenue("2026-07-20", "Ari 패션 브랜드 광고", "개인 매출", 9500000, ["Ari"]),
    createRevenue("2026-07-23", "Bora 드라마 OST", "개인 매출", 6800000, ["Bora"]),
    createRevenue("2026-07-27", "아시아 팬미팅", "공통 매출", 54000000, ["Ari", "Bora", "Yuna", "Dami"]),
    createRevenue("2026-07-29", "Yuna 예능 고정 출연료", "개인 매출", 5200000, ["Yuna"]),
  ];
  state.attendance = [
    ["2026-07-16", "Ari", "출근"], ["2026-07-16", "Bora", "출근"], ["2026-07-16", "Yuna", "출근"], ["2026-07-16", "Dami", "출근"],
    ["2026-07-18", "Ari", "외부일정"], ["2026-07-18", "Bora", "외부일정"], ["2026-07-18", "Yuna", "외부일정"], ["2026-07-18", "Dami", "외부일정"],
    ["2026-07-21", "Bora", "출근"], ["2026-07-21", "Yuna", "출근"],
    ["2026-07-25", "Ari", "외부일정"], ["2026-07-25", "Bora", "외부일정"], ["2026-07-25", "Yuna", "외부일정"], ["2026-07-25", "Dami", "외부일정"],
  ].map(([date, member, status]) => ({ id: makeId(), date, member, status }));
  state.schedules = [
    { id: makeId(), date: "2026-07-16", title: "컴백 안무 합주", members: ["Ari", "Bora", "Yuna", "Dami"] },
    { id: makeId(), date: "2026-07-18", title: "음악방송 리허설", members: ["Ari", "Bora", "Yuna", "Dami"] },
    { id: makeId(), date: "2026-07-21", title: "라디오 스페셜 DJ", members: ["Bora", "Yuna"] },
    { id: makeId(), date: "2026-07-25", title: "팬미팅 무대 점검", members: ["Ari", "Bora", "Yuna", "Dami"] },
  ];
  state.expenses = [
    createExpense("2026-07-16", "합주실 점심", 118000, "12:15"),
    createExpense("2026-07-18", "방송국 도시락", 132000, "11:40"),
    createExpense("2026-07-21", "라디오 대기 식사", 54000, "18:10"),
    createExpense("2026-07-25", "팬미팅 리허설 저녁", 126000, "19:05"),
  ];
  state.marketingPayroll = [
    { id: makeId(), name: "Han Sora", role: "마케팅 팀장", monthlySalary: 4600000, hours: { Ari: 32, Bora: 24, Yuna: 20, Dami: 16 } },
    { id: makeId(), name: "Oh Jin", role: "콘텐츠 마케터", monthlySalary: 3700000, hours: { Ari: 18, Bora: 26, Yuna: 30, Dami: 22 } },
  ];
  state.marketingInitialized = true;
  state.auditLogs = [];
  addAudit("다른 아이돌 더미 연동", "삼데헌 멤버 4명, 매출, 활동 기록, 일정, 식비, 마케팅 급여 데이터를 불러왔습니다.");
  syncInputs();
  render();
}

function syncExternalSources() {
  const attendanceRows = [
    ["2026-07-01", "Haru", "출근"], ["2026-07-01", "Min", "출근"], ["2026-07-01", "Seo", "출근"], ["2026-07-01", "Lia", "출근"],
    ["2026-07-03", "Haru", "외부일정"], ["2026-07-03", "Min", "외부일정"], ["2026-07-03", "Seo", "외부일정"], ["2026-07-03", "Lia", "외부일정"], ["2026-07-03", "Noa", "외부일정"],
    ["2026-07-06", "Min", "출근"], ["2026-07-06", "Seo", "출근"],
    ["2026-07-09", "Haru", "외부일정"], ["2026-07-09", "Lia", "외부일정"], ["2026-07-09", "Noa", "외부일정"],
    ["2026-07-10", "Haru", "외부일정"], ["2026-07-10", "Min", "외부일정"], ["2026-07-10", "Seo", "외부일정"], ["2026-07-10", "Lia", "외부일정"], ["2026-07-10", "Noa", "외부일정"],
  ];
  const schedules = [
    { date: "2026-07-01", title: "컴백 안무 연습", members: ["Haru", "Min", "Seo", "Lia"] },
    { date: "2026-07-03", title: "음악 방송 사전녹화", members: ["Haru", "Min", "Seo", "Lia", "Noa"] },
    { date: "2026-07-06", title: "라디오 게스트", members: ["Min", "Seo"] },
    { date: "2026-07-09", title: "안무 수정 리허설", members: ["Haru", "Lia", "Noa"] },
    { date: "2026-07-10", title: "콘서트 리허설", members: ["Haru", "Min", "Seo", "Lia", "Noa"] },
  ];
  state.attendance = state.attendance.filter((row) => row.date < state.periodStart || row.date > state.periodEnd);
  state.attendance.push(...attendanceRows.map(([date, member, status]) => ({ id: makeId(), date, member, status })));
  state.schedules = state.schedules.filter((row) => row.date < state.periodStart || row.date > state.periodEnd);
  state.schedules.push(...schedules.map((row) => ({ id: makeId(), ...row })));
  state.expenses.forEach(syncExpenseRecommendation);
  addAudit("외부 데이터 동기화", "회사 입출 기록, 그룹 캘린더, 결제 내역 더미 커넥터로 활동 기록과 예상 식사인원을 갱신했습니다.");
}

async function importActivityWorkbook(file) {
  if (!file) return;
  try {
    const rows = await readActivityWorkbook(file);
    if (!rows.length) throw new Error("가져올 활동 기록이 없습니다.");
    const dates = new Set(rows.map((row) => row.date));
    state.attendance = state.attendance.filter((row) => !dates.has(row.date));
    state.attendance.push(...rows.map((row) => ({ id: makeId(), ...row })));
    state.expenses.forEach(syncExpenseRecommendation);
    addAudit("외부 엑셀 가져오기", `${file.name}에서 활동 기록 ${rows.length}건을 가져와 예상 식사인원을 다시 계산했습니다.`);
    render();
  } catch (error) {
    addAudit("외부 엑셀 가져오기 실패", error.message || "알 수 없는 오류가 발생했습니다.");
    alert(`엑셀 가져오기에 실패했습니다.\n${error.message || "파일 형식을 확인해 주세요."}`);
    render();
  }
}

function openExternalFilePicker() {
  if (!ensureEditPermission("다른 아이돌 연동")) return;
  els.externalExcelInput?.click();
}

function normalizeState() {
  state.version = DATA_VERSION;
  state.approvalLimit = Number(state.approvalLimit || 30000);
  state.concurrentApprovalCount = Math.max(2, Math.round(Number(state.concurrentApprovalCount || 3)));
  state.companyRate = Number(state.companyRate ?? 50);
  state.currentUserId = state.currentUserId || "FIN-1024";
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
    expense.transactionTime = /^\d{2}:\d{2}$/.test(String(expense.transactionTime || "")) ? expense.transactionTime : "12:00";
    expense.participants = Array.isArray(expense.participants) ? expense.participants : [];
    expense.excluded = Array.isArray(expense.excluded) ? expense.excluded : [];
    expense.skippedParticipants = Array.isArray(expense.skippedParticipants) ? expense.skippedParticipants : [];
    expense.skippedParticipants = expense.skippedParticipants.filter((name) => expense.participants.includes(name));
    expense.separateMealParticipants = Array.isArray(expense.separateMealParticipants) ? expense.separateMealParticipants : [];
    expense.separateMealParticipants = expense.separateMealParticipants.filter((name) => expense.participants.includes(name));
    expense.approvalStatus = APPROVAL_STATES.includes(expense.approvalStatus) ? expense.approvalStatus : defaultApprovalStatus(expense);
    expense.approver = expense.approver || "상위 매니저";
    expense.recommendationNote = expense.recommendationNote || "날짜 기준으로 다시 계산할 수 있습니다.";
    expense.isExceptional = Boolean(expense.isExceptional);
    expense.exceptionNote = String(expense.exceptionNote || "");
  });
  refreshAutomaticApprovalStatuses();
  state.marketingPayroll = Array.isArray(state.marketingPayroll) ? state.marketingPayroll : [];
  if (!state.marketingInitialized) {
    if (!state.marketingPayroll.length) state.marketingPayroll = defaultMarketingPayroll();
    state.marketingInitialized = true;
  }
  state.marketingPayroll.forEach((employee) => {
    employee.name = String(employee.name || "마케팅 담당자");
    employee.role = String(employee.role || "마케팅 담당");
    employee.monthlySalary = Math.max(0, Math.round(Number(employee.monthlySalary || 0)));
    employee.hours = employee.hours && typeof employee.hours === "object" ? employee.hours : {};
    Object.keys(employee.hours).forEach((memberName) => {
      employee.hours[memberName] = Math.max(0, Number(employee.hours[memberName] || 0));
    });
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
      <td class="money">${currency.format(calc.revenue.commonPayout)}</td>
      <td class="money">${currency.format(calc.revenue.individualPayout)}</td>
      <td><input type="number" min="0" max="100" step="0.1" value="${member.rate}" data-field="rate" data-id="${member.id}" aria-label="계약 지급률"></td>
      <td><button class="small ghost contract-button" type="button" data-show-contract="${member.id}" title="${escapeHtml(contractLine(member))}">계약 보기</button></td>
      <td>${calc.mealCount}건</td>
      <td class="money">${currency.format(calc.gross)}</td>
      <td class="money deduction">-${currency.format(calc.food)}</td>
      <td class="money deduction">-${currency.format(calc.marketing)}</td>
      <td class="money net">${currency.format(calc.net)}</td>
      <td><button class="remove" type="button" data-remove-member="${member.id}" aria-label="멤버 삭제">x</button></td>
    `;
    els.memberRows.appendChild(tr);
  });
}

function renderRevenue() {
  els.revenueRows.innerHTML = "";
  const renderGroup = (type, title) => {
    const items = state.revenueItems.filter((item) => item.type === type);
    const section = document.createElement("section");
    section.className = "compact-section";
    const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    section.innerHTML = `
      <div class="compact-section-header">
        <h3>${title}</h3>
        <strong>${currency.format(total)}</strong>
      </div>
    `;
    items.forEach((item) => {
    const count = settlementMembers(item.participants).length;
    const mode = item.type === "개인 매출" ? "귀속 멤버" : `${count}명 참여`;
    const card = document.createElement("article");
    card.className = "compact-card";
    card.innerHTML = `
      <div class="compact-summary">
        <div>
          <span class="compact-date">${escapeHtml(item.date)}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <span class="compact-sub">${escapeHtml(mode)}</span>
        </div>
        <div class="compact-money">${currency.format(item.amount)}</div>
        <div class="compact-people">${escapeHtml(item.participants.join(", "))}</div>
        <button class="remove" type="button" data-remove-revenue="${item.id}" aria-label="매출 삭제">x</button>
      </div>
      <div class="compact-edit revenue-edit">
        <label>날짜<input type="date" value="${item.date}" data-revenue-field="date" data-id="${item.id}" aria-label="매출 날짜"></label>
        <label>내역<input value="${escapeHtml(item.title)}" data-revenue-field="title" data-id="${item.id}" aria-label="매출 내역"></label>
        <label>구분<select data-revenue-field="type" data-id="${item.id}" aria-label="매출 구분">
          ${REVENUE_TYPES.map((type) => `<option value="${type}" ${item.type === type ? "selected" : ""}>${type}</option>`).join("")}
        </select></label>
        <label>금액<input type="number" min="0" step="10000" value="${item.amount}" data-revenue-field="amount" data-id="${item.id}" aria-label="매출 금액"></label>
        <label class="wide-field">참여/귀속 멤버<input value="${escapeHtml(item.participants.join(", "))}" data-revenue-field="participants" data-id="${item.id}" aria-label="매출 참여 멤버"></label>
      </div>
    `;
      section.appendChild(card);
    });
    els.revenueRows.appendChild(section);
  };
  renderGroup("공통 매출", "공통 매출");
  renderGroup("개인 매출", "개인 매출");
}

function renderExpenses() {
  els.expenseRows.innerHTML = "";
  state.expenses.forEach((expense) => {
    const share = expenseShare(expense);
    const needsApproval = expenseNeedsApproval(expense);
    const status = expenseStatus(expense);
    const approvalReasonText = expenseApprovalReasons(expense).join(" · ") || "승인 조건 해당 없음";
    const billableCount = billableParticipants(expense).length;
    const card = document.createElement("article");
    card.className = `compact-card ${needsApproval && status !== "승인 완료" ? "approval-card" : ""}`;
    card.innerHTML = `
      <div class="compact-summary">
        <div>
          <span class="compact-date">${escapeHtml(expense.date)} ${escapeHtml(expense.transactionTime)}</span>
          <strong>${escapeHtml(expense.title)}</strong>
          <span class="compact-sub">예상 ${billableCount}명 · ${escapeHtml(expenseStatus(expense))} · ${escapeHtml(approvalReasonText)} · ${escapeHtml(expense.recommendationNote)}</span>
        </div>
        <div class="compact-money">${currency.format(expense.amount)}</div>
        <div class="compact-money">1인 ${currency.format(share)}</div>
        <button class="remove" type="button" data-remove-expense="${expense.id}" aria-label="비용 삭제">x</button>
      </div>
      <div class="compact-edit expense-edit">
        <label>날짜<input type="date" value="${expense.date}" data-expense-field="date" data-id="${expense.id}" aria-label="날짜"></label>
        <label>결제 시간<input type="time" value="${expense.transactionTime}" data-expense-field="transactionTime" data-id="${expense.id}" aria-label="결제 시간"></label>
        <label>내역<input value="${escapeHtml(expense.title)}" data-expense-field="title" data-id="${expense.id}" aria-label="내역"></label>
        <label>실제 식비<input type="number" min="0" step="100" value="${expense.amount}" data-expense-field="amount" data-id="${expense.id}" aria-label="실제 식비 금액"></label>
        <label class="wide-field">예상 식사인원
        <div class="input-action-cell">
          <input value="${escapeHtml(expense.participants.join(", "))}" data-expense-field="participants" data-id="${expense.id}" aria-label="예상 식사인원">
          <button class="small recommend-button" type="button" data-recommend-expense="${expense.id}" title="같은 날짜의 출퇴근 기록과 일정표를 기준으로 예상 식사인원을 다시 계산합니다.">불러오기</button>
        </div>
        <span class="cell-note">${escapeHtml(expense.recommendationNote)}</span></label>
        <label>기타 정산 제외<input value="${escapeHtml(expense.excluded.join(", "))}" data-expense-field="excluded" data-id="${expense.id}" aria-label="기타 정산 제외 인원"></label>
        <div class="meal-skip-field">
          <span>식사 생략 인원</span>
          <div class="meal-skip-options">
            ${expense.participants.filter((name) => !isSettlementExcluded(name)).map((name) => `
              <label>
                <input type="checkbox" data-skip-expense="${expense.id}" data-member="${escapeHtml(name)}" ${expense.skippedParticipants.includes(name) ? "checked" : ""}>
                <span>${escapeHtml(name)}</span>
              </label>
            `).join("") || '<span class="cell-note">정산 대상 멤버가 없습니다.</span>'}
          </div>
        </div>
        <div class="meal-skip-field">
          <span>별도 식사 인원</span>
          <div class="meal-skip-options">
            ${expense.participants.filter((name) => !isSettlementExcluded(name)).map((name) => `
              <label>
                <input type="checkbox" data-separate-expense="${expense.id}" data-member="${escapeHtml(name)}" ${expense.separateMealParticipants.includes(name) ? "checked" : ""}>
                <span>${escapeHtml(name)}</span>
              </label>
            `).join("") || '<span class="cell-note">정산 대상 멤버가 없습니다.</span>'}
          </div>
        </div>
        <label class="exception-check">
          <span>특이 체크</span>
          <input type="checkbox" ${expense.isExceptional ? "checked" : ""} data-expense-field="isExceptional" data-id="${expense.id}" aria-label="특이 사항 여부">
          <span>샐러드·식사 생략 등</span>
        </label>
        <label class="exception-note wide-field">비고(사유)
          <input value="${escapeHtml(expense.exceptionNote)}" data-expense-field="exceptionNote" data-id="${expense.id}" aria-label="특이 사항 사유" placeholder="예: Lia 샐러드 주문, Noa 식사 생략" ${expense.isExceptional ? "required" : "disabled"}>
          ${expense.isExceptional && !expense.exceptionNote.trim() ? '<span class="field-warning">특이 사유를 입력해 주세요.</span>' : ""}
        </label>
        <label>승인 상태<select data-expense-field="approvalStatus" data-id="${expense.id}" aria-label="승인 상태">
          ${APPROVAL_STATES.map((item) => `<option value="${item}" ${status === item ? "selected" : ""}>${item}</option>`).join("")}
        </select></label>
        <label>승인권자<input value="${escapeHtml(expense.approver)}" data-expense-field="approver" data-id="${expense.id}" aria-label="승인권자"></label>
        <div class="compact-formula">배분 방식: 정산 대상 균등 배분 (${billableCount}명)</div>
      </div>
    `;
    els.expenseRows.appendChild(card);
  });
}

function renderMarketingPayroll() {
  if (!els.marketingRows) return;
  const settlementMemberList = state.members.filter((member) => !EXCLUDED_ROLES.has(member.role));
  const table = document.createElement("table");
  table.className = "marketing-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>직원</th>
        <th>직무</th>
        <th>월 급여</th>
        ${settlementMemberList.map((member) => `<th>${escapeHtml(member.name)} 투입시간</th>`).join("")}
        <th>총 투입시간</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${state.marketingPayroll.map((employee) => `
        <tr>
          <td><input value="${escapeHtml(employee.name)}" data-marketing-field="name" data-id="${employee.id}" aria-label="마케팅 직원명"></td>
          <td><input value="${escapeHtml(employee.role)}" data-marketing-field="role" data-id="${employee.id}" aria-label="마케팅 직무"></td>
          <td><input type="number" min="0" step="100000" value="${employee.monthlySalary}" data-marketing-field="monthlySalary" data-id="${employee.id}" aria-label="${escapeHtml(employee.name)} 월 급여"></td>
          ${settlementMemberList.map((member) => `<td><input type="number" min="0" step="0.5" value="${Number(employee.hours?.[member.name] || 0)}" data-marketing-hour="${escapeHtml(member.name)}" data-id="${employee.id}" aria-label="${escapeHtml(employee.name)} ${escapeHtml(member.name)} 투입시간"></td>`).join("")}
          <td class="money">${marketingEmployeeTotalHours(employee)}시간</td>
          <td><button class="remove" type="button" data-remove-marketing="${employee.id}" aria-label="마케팅 직원 삭제">x</button></td>
        </tr>
      `).join("")}
    </tbody>
  `;
  const allocations = document.createElement("div");
  allocations.className = "marketing-allocation-grid";
  allocations.innerHTML = settlementMemberList.map((member) => `
    <article>
      <span>${escapeHtml(member.name)} 마케팅 급여 상계</span>
      <strong>${currency.format(marketingCostForMember(member.name))}</strong>
    </article>
  `).join("");
  els.marketingRows.innerHTML = "";
  els.marketingRows.appendChild(table);
  els.marketingRows.appendChild(allocations);
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
  const header = document.createElement("div");
  header.className = "record-row schedule-row record-header";
  header.innerHTML = `
    <span>날짜</span>
    <span>일정명</span>
    <span>참여 멤버</span>
    <span></span>
  `;
  els.scheduleList.appendChild(header);
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
      acc.marketing += calc.marketing;
      acc.net += calc.net;
      return acc;
    },
    { revenue: 0, gross: 0, food: 0, marketing: 0, net: 0 },
  );
  const commonRevenue = commonRevenuePool();
  const rateTotal = contractRateTotal();
  const approvalCount = state.expenses.filter((expense) => inPeriod(expense.date) && ["승인 대기", "보류"].includes(expenseStatus(expense))).length;
  els.totalCommonRevenue.textContent = currency.format(commonRevenue);
  els.companyShare.textContent = currency.format(companyShareAmount());
  els.rateTotal.textContent = `${rateTotal}%`;
  els.rateTotal.parentElement?.classList.toggle("warning-card", rateTotal !== 100);
  els.totalRevenue.textContent = currency.format(totals.net);
  els.totalGross.textContent = currency.format(totals.gross);
  els.totalFood.textContent = currency.format(totals.food);
  els.totalMarketing.textContent = currency.format(totals.marketing);
  els.approvalCount.textContent = `${approvalCount}건`;
  document.title = `${state.groupName} Food-Fee 정산`;
}

function render() {
  normalizeState();
  localStorage.setItem("foodFeeState", JSON.stringify(state));
  renderMembers();
  renderRevenue();
  renderExpenses();
  renderMarketingPayroll();
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
  state.concurrentApprovalCount = Math.max(2, Math.round(Number(els.concurrentApprovalCount.value || 3)));
  state.companyRate = Number(els.companyRate.value || 0);
  refreshAutomaticApprovalStatuses();
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
    [{ value: "동시간대 결제 승인 기준", style: 2 }, { value: `${state.concurrentApprovalCount}건/동일 시간대` }],
    [{ value: "공통 매출 풀", style: 2 }, { value: commonRevenuePool(), style: 4 }],
    [{ value: "회사 분배금", style: 2 }, { value: companyShareAmount(), style: 4 }],
    [{ value: "지급률 합계", style: 2 }, { value: contractRateTotal(), style: 4 }],
    [{ value: "마케팅 급여 상계 합계", style: 2 }, { value: totalMarketingOffset(), style: 4 }],
    [],
  ];
  const revenueRows = state.revenueItems.map((item) => [
    { value: item.date }, { value: item.title }, { value: item.type }, { value: item.amount, style: 4 },
    { value: item.participants.join(", ") }, { value: settlementMembers(item.participants).length, style: 4 },
  ]);
  const memberRows = state.members.map((member) => {
    const calc = calculateMember(member);
    return [
      { value: member.name }, { value: member.role }, { value: calc.revenue.commonPayout, style: 4 },
      { value: calc.revenue.individual, style: 4 }, { value: calc.revenue.individualPayout, style: 4 }, { value: member.rate, style: 4 }, { value: contractLine(member) }, { value: calc.mealCount, style: 4 },
      { value: calc.gross, style: 4 }, { value: calc.food, style: 4 }, { value: calc.marketing, style: 4 }, { value: calc.net, style: 4 },
    ];
  });
  const marketingRows = state.marketingPayroll.flatMap((employee) => {
    const totalHours = marketingEmployeeTotalHours(employee);
    return state.members
      .filter((member) => !EXCLUDED_ROLES.has(member.role))
      .map((member) => [
        { value: employee.name }, { value: employee.role }, { value: employee.monthlySalary, style: 4 },
        { value: member.name }, { value: Number(employee.hours?.[member.name] || 0), style: 4 },
        { value: totalHours, style: 4 }, { value: marketingAllocation(employee, member.name), style: 4 },
      ]);
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
    { value: expense.date }, { value: expense.transactionTime }, { value: expense.amount, style: 4 },
    { value: expense.participants.join(", ") }, { value: expense.skippedParticipants.join(", ") }, { value: expense.separateMealParticipants.join(", ") },
    { value: expense.excluded.join(", ") }, { value: billableParticipants(expense).join(", ") },
    { value: expenseShare(expense), style: 4 }, { value: expenseStatus(expense), style: ["승인 대기", "보류"].includes(expenseStatus(expense)) ? 7 : 6 },
    { value: expenseApprovalReasons(expense).join(", ") }, { value: expense.approver }, { value: expense.isExceptional ? "특이" : "일반" }, { value: expense.exceptionNote },
  ]);
  const approvalRows = state.expenses
    .filter((expense) => ["승인 대기", "보류", "반려"].includes(expenseStatus(expense)))
    .map((expense) => [
      { value: expense.date }, { value: expense.transactionTime }, { value: expense.amount, style: 4 },
      { value: expenseShare(expense), style: 4 }, { value: expenseStatus(expense), style: 7 },
      { value: expenseApprovalReasons(expense).join(", ") }, { value: expense.approver },
    ]);
  const activityRows = state.attendance.map((row) => [{ value: row.date }, { value: row.member }, { value: row.status }]);
  const scheduleRows = state.schedules.map((row) => [{ value: row.date }, { value: row.title }, { value: row.members.join(", ") }]);
  const auditRows = state.auditLogs.map((log) => [{ value: log.at }, { value: log.actorId || "" }, { value: log.actorRole || "" }, { value: log.actor }, { value: log.action }, { value: log.detail }]);
  return [
    ...summary,
    ...sectionRows("매출 항목", ["날짜", "내역", "구분", "금액", "참여 멤버", "정산 대상 수"], revenueRows),
    ...sectionRows("멤버별 정산", ["멤버", "역할", "공통 매출 정산금", "개인 매출 원금", "개인 매출 정산금", "계약 지급률", "계약 근거", "식비 건수", "공제 전", "식비 공제", "마케팅 급여 상계", "공제 후"], memberRows),
    ...sectionRows("마케팅 급여 배부", ["직원", "직무", "월 급여", "대상 아이돌", "투입시간", "직원 총 투입시간", "배부액"], marketingRows),
    ...sectionRows("계약서 참조", ["멤버", "역할", "계약 지급률", "계약 유형", "개인 활동 기여도", "연습생 생활비", "회사 투자", "지급률 근거", "특약"], contractRows),
    ...sectionRows("비용별 분배", ["날짜", "결제 시간", "실제 식비", "예상 식사인원", "식사 생략 인원", "별도 식사 인원", "기타 정산 제외", "정산 대상", "1인 금액", "상태", "승인 사유", "승인권자", "특이 체크", "비고(사유)"], expenseRows),
    ...sectionRows("승인 필요 건", ["날짜", "결제 시간", "금액", "1인 금액", "상태", "승인 사유", "승인권자"], approvalRows),
    ...sectionRows("활동 기록", ["날짜", "멤버", "상태"], activityRows),
    ...sectionRows("일정표", ["날짜", "일정명", "참여 멤버"], scheduleRows),
    ...sectionRows("감사 로그", ["일시", "작업자 ID", "권한", "작업자", "작업", "내용"], auditRows),
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
        <col min="3" max="14" width="18" customWidth="1"/>
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
  const user = currentUser();
  if (!user.canExport) {
    addAudit("출력 차단", `${user.name} 계정은 Excel 출력 권한이 없습니다.`, user);
    alert("현재 계정은 Excel 출력 권한이 없습니다.");
    render();
    return;
  }
  const missingExceptionReason = state.expenses.find((expense) => expense.isExceptional && !expense.exceptionNote.trim());
  if (missingExceptionReason) {
    addAudit("Excel 출력 차단", `${missingExceptionReason.date} ${missingExceptionReason.title}: 특이 체크된 식비의 비고(사유)가 입력되지 않았습니다.`, user);
    alert(`특이 체크된 식비의 비고(사유)를 입력해 주세요.\n${missingExceptionReason.date} ${missingExceptionReason.title}`);
    render();
    return;
  }
  addAudit("Excel 출력", `${state.groupName} ${state.periodStart}~${state.periodEnd} 정산 근거 파일을 출력했습니다.`, user);
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
  if (target === els.currentUser) {
    state.currentUserId = target.value;
    addAudit("내부 계정 전환", `${actorLabel()} 계정으로 전환했습니다.`);
    render();
    return;
  }
  if ([els.groupName, els.periodStart, els.periodEnd, els.approvalLimit, els.concurrentApprovalCount].includes(target)) updateSettings();
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target === els.currentUser) {
    state.currentUserId = target.value;
    addAudit("내부 계정 전환", `${actorLabel()} 계정으로 전환했습니다.`);
    render();
    return;
  }
  if (target.dataset.field) {
    if (!ensureEditPermission("멤버 정보 수정")) return;
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
        expense.skippedParticipants = (expense.skippedParticipants || []).map((name) => (name === previousName ? member.name : name));
        expense.separateMealParticipants = (expense.separateMealParticipants || []).map((name) => (name === previousName ? member.name : name));
      });
      state.attendance.forEach((row) => {
        if (row.member === previousName) row.member = member.name;
      });
      state.schedules.forEach((row) => {
        row.members = row.members.map((name) => (name === previousName ? member.name : name));
      });
      state.marketingPayroll.forEach((employee) => {
        if (Object.prototype.hasOwnProperty.call(employee.hours, previousName)) {
          employee.hours[member.name] = employee.hours[previousName];
          delete employee.hours[previousName];
        }
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
    if (!ensureEditPermission("매출 항목 수정")) return;
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
    const field = target.dataset.expenseField;
    if (target.dataset.expenseField === "approvalStatus") {
      if (!ensureApprovalPermission(`${expense.title} 승인 상태 변경`)) return;
    } else if (!ensureEditPermission("비용 건 수정")) return;
    if (field === "amount") expense.amount = Number(target.value || 0);
    else if (field === "isExceptional") {
      expense.isExceptional = target.checked;
      if (!expense.isExceptional) expense.exceptionNote = "";
    } else if (field === "participants") {
      expense.participants = splitNames(target.value);
      expense.excluded = defaultExcluded(expense.participants);
      expense.skippedParticipants = expense.skippedParticipants.filter((name) => expense.participants.includes(name));
      expense.separateMealParticipants = expense.separateMealParticipants.filter((name) => expense.participants.includes(name));
    } else if (field === "excluded") expense.excluded = splitNames(target.value);
    else expense[field] = target.value;
    if (["amount", "participants", "excluded", "date", "transactionTime"].includes(field) && field !== "approvalStatus") {
      expense.approvalStatus = defaultApprovalStatus(expense);
    }
    if (field === "date") expense.recommendationNote = "날짜가 바뀌었습니다. 불러오기를 누르면 다시 계산됩니다.";
    if (field === "participants") expense.recommendationNote = "직접 수정됨";
    if (["date", "transactionTime", "approvalStatus"].includes(field)) refreshAutomaticApprovalStatuses();
    if (field === "amount") {
      const reason = expense.isExceptional ? ` · 특이 사유: ${expense.exceptionNote || "미입력"}` : "";
      addAudit("식비 금액 직접 수정", `${expense.date} ${expense.title}: ${currency.format(Number(previous || 0))} -> ${currency.format(expense.amount)}${reason}`);
    } else if (field === "isExceptional") {
      addAudit("식비 특이 체크", `${expense.date} ${expense.title}: ${expense.isExceptional ? "특이 사항으로 표시" : "특이 표시 해제 및 비고 삭제"}`);
    } else if (field === "exceptionNote") {
      addAudit("식비 특이 사유 수정", `${expense.date} ${expense.title}: ${previous || "미입력"} -> ${expense.exceptionNote || "미입력"}`);
    } else {
      addAudit("비용 건 수정", `${expense.title} ${field}: ${previous} -> ${expense[field]}`);
    }
    render();
  }
  if (target.dataset.skipExpense) {
    if (!ensureEditPermission("식사 생략 인원 수정")) return;
    const expense = state.expenses.find((item) => item.id === target.dataset.skipExpense);
    const memberName = target.dataset.member;
    const skipped = new Set(expense.skippedParticipants || []);
    if (target.checked) skipped.add(memberName);
    else skipped.delete(memberName);
    expense.skippedParticipants = [...skipped];
    if (target.checked) {
      expense.separateMealParticipants = (expense.separateMealParticipants || []).filter((name) => name !== memberName);
      expense.isExceptional = true;
      if (!expense.exceptionNote.trim() || expense.exceptionNote === `${memberName} 별도 식사`) expense.exceptionNote = `${memberName} 식사 생략`;
    } else if (expense.exceptionNote === `${memberName} 식사 생략`) {
      expense.exceptionNote = "";
      if (!expense.skippedParticipants.length && !expense.separateMealParticipants.length) expense.isExceptional = false;
    }
    expense.approvalStatus = defaultApprovalStatus(expense);
    addAudit(
      "식사 생략 인원 수정",
      `${expense.date} ${expense.title}: ${memberName} ${target.checked ? "식사 생략" : "식사 생략 해제"} · 정산 대상 ${billableParticipants(expense).length}명 · 1인 ${currency.format(expenseShare(expense))}`,
    );
    render();
  }
  if (target.dataset.separateExpense) {
    if (!ensureEditPermission("별도 식사 인원 수정")) return;
    const expense = state.expenses.find((item) => item.id === target.dataset.separateExpense);
    const memberName = target.dataset.member;
    const separate = new Set(expense.separateMealParticipants || []);
    if (target.checked) separate.add(memberName);
    else separate.delete(memberName);
    expense.separateMealParticipants = [...separate];
    if (target.checked) {
      expense.skippedParticipants = (expense.skippedParticipants || []).filter((name) => name !== memberName);
      expense.isExceptional = true;
      if (!expense.exceptionNote.trim() || expense.exceptionNote === `${memberName} 식사 생략`) expense.exceptionNote = `${memberName} 별도 식사`;
    } else if (expense.exceptionNote === `${memberName} 별도 식사`) {
      expense.exceptionNote = "";
      if (!expense.skippedParticipants.length && !expense.separateMealParticipants.length) expense.isExceptional = false;
    }
    expense.approvalStatus = defaultApprovalStatus(expense);
    addAudit(
      "별도 식사 인원 수정",
      `${expense.date} ${expense.title}: ${memberName} ${target.checked ? "별도 식사로 배분 제외" : "별도 식사 해제"} · 정산 대상 ${billableParticipants(expense).length}명 · 1인 ${currency.format(expenseShare(expense))}`,
    );
    render();
  }
  if (target.dataset.marketingField) {
    if (!ensureEditPermission("마케팅 급여 정보 수정")) return;
    const employee = state.marketingPayroll.find((item) => item.id === target.dataset.id);
    const field = target.dataset.marketingField;
    const previous = employee[field];
    employee[field] = field === "monthlySalary" ? Math.max(0, Math.round(Number(target.value || 0))) : target.value;
    const fieldLabel = { name: "직원명", role: "직무", monthlySalary: "월 급여" }[field] || field;
    addAudit("마케팅 급여 수정", `${employee.name} ${fieldLabel}: ${previous} -> ${employee[field]}`);
    render();
  }
  if (target.dataset.marketingHour) {
    if (!ensureEditPermission("마케팅 투입시간 수정")) return;
    const employee = state.marketingPayroll.find((item) => item.id === target.dataset.id);
    const memberName = target.dataset.marketingHour;
    const previous = Number(employee.hours[memberName] || 0);
    employee.hours[memberName] = Math.max(0, Number(target.value || 0));
    addAudit("마케팅 투입시간 수정", `${employee.name} → ${memberName}: ${previous}시간 -> ${employee.hours[memberName]}시간, 배부액 ${currency.format(marketingAllocation(employee, memberName))}`);
    render();
  }
  if (target.dataset.attendanceCellDate) {
    if (!ensureEditPermission("활동 기록 수정")) return;
    setAttendance(target.dataset.attendanceCellDate, target.dataset.attendanceCellMember, target.value);
    render();
  }
  if (target.dataset.attendanceDate) {
    if (!ensureEditPermission("활동 날짜 변경")) return;
    const previousDate = target.dataset.attendanceDate;
    state.attendance.forEach((row) => {
      if (row.date === previousDate) row.date = target.value;
    });
    addAudit("활동 날짜 변경", `${previousDate} -> ${target.value}`);
    render();
  }
  if (target.dataset.scheduleField) {
    if (!ensureEditPermission("일정표 수정")) return;
    const row = state.schedules.find((item) => item.id === target.dataset.id);
    const previous = row[target.dataset.scheduleField];
    row[target.dataset.scheduleField] = target.dataset.scheduleField === "members" ? splitNames(target.value) : target.value;
    addAudit("일정표 수정", `${row.title} ${target.dataset.scheduleField}: ${previous} -> ${row[target.dataset.scheduleField]}`);
    render();
  }
  if (target === els.externalExcelInput) {
    if (!ensureEditPermission("외부 엑셀 가져오기")) {
      target.value = "";
      return;
    }
    importActivityWorkbook(target.files?.[0]).finally(() => {
      target.value = "";
    });
  }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (target.id === "exportButton") exportWorkbook();
  if (target.id === "otherDummyButton") {
    if (!ensureEditPermission("다른 아이돌 더미 연동")) return;
    seedOtherIdolData();
  }
  if (target.id === "importIdolButton") openExternalFilePicker();
  if (target.id === "resetButton") {
    localStorage.removeItem("foodFeeState");
    seedData();
  }
  if (target.id === "addMemberButton") {
    const hrUser = INTERNAL_USERS.find((user) => user.id === "HR-3007");
    addAudit("내부 멤버 동기화", `회사 내부 그룹 마스터 데이터에서 ${state.groupName} 멤버 ${state.members.length}명을 확인했습니다. 수기 추가는 허용하지 않습니다.`, hrUser);
    render();
  }
  if (target.dataset.showContract) {
    state.selectedContractId = target.dataset.showContract;
    render();
  }
  if (target.id === "addRevenueButton") {
    if (!ensureEditPermission("매출 항목 추가")) return;
    const first = state.members.find((item) => item.role === "멤버")?.name || "New";
    state.revenueItems.push(createRevenue(state.periodStart, "새 매출", "공통 매출", 0, [first]));
    addAudit("매출 항목 추가", "새 매출 항목을 추가했습니다.");
    render();
  }
  if (target.id === "addExpenseButton") {
    if (!ensureEditPermission("비용 추가")) return;
    const expense = createExpense(state.periodStart, "새 식비", 0);
    state.expenses.push(expense);
    refreshAutomaticApprovalStatuses();
    addAudit("비용 추가", `${expense.date} 새 식비를 추가했습니다.`);
    render();
  }
  if (target.id === "addMarketingButton") {
    if (!ensureEditPermission("마케팅 직원 추가")) return;
    const hours = Object.fromEntries(state.members.filter((member) => !EXCLUDED_ROLES.has(member.role)).map((member) => [member.name, 0]));
    state.marketingPayroll.push({ id: makeId(), name: "새 마케팅 직원", role: "마케팅 담당", monthlySalary: 0, hours });
    addAudit("마케팅 직원 추가", "마케팅 급여 테이블에 새 직원을 추가했습니다.");
    render();
  }
  if (target.id === "addAttendanceButton") {
    if (!ensureEditPermission("활동 날짜 추가")) return;
    const date = nextAttendanceDate();
    state.members.forEach((member) => {
      state.attendance.push({ id: makeId(), date, member: member.name, status: "출근" });
    });
    addAudit("활동 날짜 추가", `${date} 활동 기록을 추가했습니다.`);
    render();
  }
  if (target.id === "addScheduleButton") {
    if (!ensureEditPermission("일정 추가")) return;
    const member = state.members.find((item) => item.role === "멤버")?.name || "New";
    state.schedules.push({ id: makeId(), date: state.periodStart, title: "새 일정", members: [member] });
    addAudit("일정 추가", "새 일정을 추가했습니다.");
    render();
  }
  if (target.id === "syncExternalButton") {
    if (!ensureEditPermission("외부 데이터 동기화")) return;
    syncExternalSources();
    render();
  }
  if (target.dataset.recommendExpense) {
    if (!ensureEditPermission("예상 식사인원 불러오기")) return;
    const expense = state.expenses.find((item) => item.id === target.dataset.recommendExpense);
    syncExpenseRecommendation(expense);
    render();
  }
  if (target.dataset.removeMember) {
    if (!ensureEditPermission("멤버 삭제")) return;
    const member = state.members.find((item) => item.id === target.dataset.removeMember);
    state.members = state.members.filter((item) => item.id !== target.dataset.removeMember);
    addAudit("멤버 삭제", `${member?.name || "알 수 없음"}을 삭제했습니다.`);
    render();
  }
  if (target.dataset.removeRevenue) {
    if (!ensureEditPermission("매출 항목 삭제")) return;
    const item = state.revenueItems.find((row) => row.id === target.dataset.removeRevenue);
    state.revenueItems = state.revenueItems.filter((row) => row.id !== target.dataset.removeRevenue);
    addAudit("매출 항목 삭제", `${item?.title || "알 수 없음"}을 삭제했습니다.`);
    render();
  }
  if (target.dataset.removeExpense) {
    if (!ensureEditPermission("비용 삭제")) return;
    const expense = state.expenses.find((item) => item.id === target.dataset.removeExpense);
    state.expenses = state.expenses.filter((item) => item.id !== target.dataset.removeExpense);
    refreshAutomaticApprovalStatuses();
    addAudit("비용 삭제", `${expense?.title || "알 수 없음"}을 삭제했습니다.`);
    render();
  }
  if (target.dataset.removeMarketing) {
    if (!ensureEditPermission("마케팅 직원 삭제")) return;
    const employee = state.marketingPayroll.find((item) => item.id === target.dataset.removeMarketing);
    state.marketingPayroll = state.marketingPayroll.filter((item) => item.id !== target.dataset.removeMarketing);
    addAudit("마케팅 직원 삭제", `${employee?.name || "알 수 없음"}을 급여 테이블에서 삭제했습니다.`);
    render();
  }
  if (target.dataset.removeAttendanceDate) {
    if (!ensureEditPermission("활동 날짜 삭제")) return;
    state.attendance = state.attendance.filter((row) => row.date !== target.dataset.removeAttendanceDate);
    addAudit("활동 날짜 삭제", `${target.dataset.removeAttendanceDate} 활동 기록을 삭제했습니다.`);
    render();
  }
  if (target.dataset.removeSchedule) {
    if (!ensureEditPermission("일정 삭제")) return;
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
