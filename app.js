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
  { id: "FIN-1024", name: "삼일돌 현장 매니저", role: "현장 매니저", password: "1024", assignedGroup: "Samildol", assignedGroupLabel: "삼일돌", canEdit: true, canApprove: false, canViewAudit: false, canViewMarketingPayroll: false },
  { id: "FIN-1025", name: "삼데헌 현장 매니저", role: "현장 매니저", password: "1025", assignedGroup: "삼데헌", assignedGroupLabel: "삼데헌", canEdit: true, canApprove: false, canViewAudit: false, canViewMarketingPayroll: false },
  { id: "MGR-2201", name: "상위 매니저", role: "상위 매니저", password: "2201", canEdit: true, canApprove: false, canViewAudit: false, canViewMarketingPayroll: false },
  { id: "HR-3007", name: "인사 마스터", role: "내부 데이터 관리자", password: "3007", canEdit: true, canApprove: true, canViewAudit: true, canViewMarketingPayroll: true },
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
  integrationStatus: { attendance: ".xlsx 선택 필요", schedule: ".xlsx 선택 필요", expense: ".xlsx 선택 필요" },
};

const els = {
  loginOverlay: document.querySelector("#loginOverlay"),
  loginForm: document.querySelector("#loginForm"),
  loginUserId: document.querySelector("#loginUserId"),
  loginPassword: document.querySelector("#loginPassword"),
  loginError: document.querySelector("#loginError"),
  importIdolButton: document.querySelector("#importIdolButton"),
  resetButton: document.querySelector("#resetButton"),
  groupName: document.querySelector("#groupName"),
  currentUser: document.querySelector("#currentUser"),
  logoutButton: document.querySelector("#logoutButton"),
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
  auditPanel: document.querySelector("#auditPanel"),
  integrationPanel: document.querySelector("#integrationPanel"),
  externalExcelInput: document.querySelector("#externalExcelInput"),
  externalIdolInput: document.querySelector("#externalIdolInput"),
  attendanceIntegrationStatus: document.querySelector("#attendanceIntegrationStatus"),
  scheduleIntegrationStatus: document.querySelector("#scheduleIntegrationStatus"),
  expenseIntegrationStatus: document.querySelector("#expenseIntegrationStatus"),
  contractDetail: document.querySelector("#contractDetail"),
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
  return authenticatedUser() || INTERNAL_USERS.find((user) => user.id === state.currentUserId) || INTERNAL_USERS[0];
}

function authenticatedUser() {
  const userId = sessionStorage.getItem("foodFeeAuthUser");
  return INTERNAL_USERS.find((user) => user.id === userId) || null;
}

function isAuthenticated() {
  return Boolean(authenticatedUser());
}

function showLogin(message = "") {
  els.loginUserId.innerHTML = INTERNAL_USERS.map((user) => `<option value="${user.id}">${user.id}, ${user.name}</option>`).join("");
  els.loginUserId.value = state.currentUserId || INTERNAL_USERS[0].id;
  els.loginPassword.value = "";
  els.loginError.textContent = message;
  els.loginOverlay.classList.remove("hidden");
  setTimeout(() => els.loginPassword.focus(), 0);
}

function hideLogin() {
  els.loginOverlay.classList.add("hidden");
  els.loginError.textContent = "";
}

function ensureAuthenticated() {
  if (isAuthenticated()) return true;
  showLogin("로그인이 필요합니다.");
  return false;
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
  if (!ensureAuthenticated()) return false;
  const user = currentUser();
  if (user.canEdit) return true;
  addAudit("입력 차단", `${action}: ${user.name} 계정은 입력 권한이 없습니다.`, user);
  alert("현재 계정은 입력 권한이 없습니다.");
  render();
  return false;
}

function ensureApprovalPermission(action) {
  if (!ensureAuthenticated()) return false;
  const user = currentUser();
  if (user.canApprove) return true;
  addAudit("승인 차단", `${action}: ${user.name} 계정은 승인 권한이 없습니다.`, user);
  alert("현재 계정은 승인 권한이 없습니다.");
  render();
  return false;
}

function hasAllPermissions(user = currentUser()) {
  return user.canEdit && user.canApprove && user.canViewAudit && isHrMaster(user);
}

function canSwitchIdol(user = currentUser()) {
  return ["MGR-2201", "HR-3007"].includes(user.id);
}

function isHrMaster(user = currentUser()) {
  return user.id === "HR-3007";
}

function ensureIntegrationPermission(action) {
  if (!ensureAuthenticated()) return false;
  const user = currentUser();
  if (isHrMaster(user)) return true;
  addAudit(".xlsx Import 차단", `${action}: 인사 마스터 계정만 실행할 수 있습니다.`, user);
  alert(".xlsx Import는 인사 마스터 계정만 실행할 수 있습니다.");
  render();
  return false;
}

function ensureIdolImportPermission() {
  if (!ensureAuthenticated()) return false;
  const user = currentUser();
  if (canSwitchIdol(user)) return true;
  addAudit("다른 아이돌 연동 차단", `${user.name} 계정에는 다른 아이돌 .xlsx 연동 권한이 없습니다.`, user);
  alert("다른 아이돌 연동은 상위 매니저와 인사 마스터만 사용할 수 있습니다.");
  render();
  return false;
}

function isFoodOnlyUser(user = currentUser()) {
  return user.role === "현장 매니저";
}

function canViewMarketingPayroll(user = currentUser()) {
  return user.canViewMarketingPayroll === true;
}

function assignedStateKey(user) {
  return user?.assignedGroup ? `foodFeeState:${user.id}` : "";
}

function persistState() {
  if (!hasValidContractRateTotal()) return false;
  const serialized = JSON.stringify(state);
  localStorage.setItem("foodFeeState", serialized);
  const key = assignedStateKey(authenticatedUser());
  if (key) localStorage.setItem(key, serialized);
  return true;
}

function loadAssignedIdol(user) {
  if (!user?.assignedGroup) return false;
  const saved = localStorage.getItem(assignedStateKey(user));
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.version === DATA_VERSION && parsed.groupName === user.assignedGroup) {
        Object.assign(state, parsed);
        state.currentUserId = user.id;
        normalizeState();
        return true;
      }
    } catch (error) {
      console.warn("담당 아이돌 저장 데이터를 복원하지 못했습니다.", error);
    }
  }

  state.currentUserId = user.id;
  if (user.assignedGroup === "삼데헌") seedOtherIdolData();
  else seedData();
  return false;
}

function ensureGeneralEditPermission(action) {
  if (!ensureEditPermission(action)) return false;
  const user = currentUser();
  if (!isFoodOnlyUser(user)) return true;
  addAudit("업무 범위 차단", `${action}: 현장 매니저는 현재 아이돌의 식비 정산 업무만 수행할 수 있습니다.`, user);
  alert("현장 매니저는 현재 아이돌의 식비 정산 업무만 수행할 수 있습니다.");
  render();
  return false;
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
  if (!Number.isFinite(serial)) return String(value || "").slice(0, 10);
  const utc = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(utc).toISOString().slice(0, 10);
}

function excelTimeValue(value) {
  const text = String(value || "").trim();
  if (/^\d{1,2}:\d{2}$/.test(text)) return text.padStart(5, "0");
  const serial = Number(text);
  if (!Number.isFinite(serial) || serial < 0 || serial >= 1) return "12:00";
  const totalMinutes = Math.round(serial * 24 * 60) % (24 * 60);
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
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

function xlsxWorksheetPath(xmlFiles, parser, sheetName) {
  const workbookXml = xmlFiles.get("xl/workbook.xml");
  const relationshipsXml = xmlFiles.get("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relationshipsXml) return "";
  const workbookDoc = parser.parseFromString(workbookXml, "application/xml");
  const sheet = [...workbookDoc.querySelectorAll("sheet")].find((item) => item.getAttribute("name") === sheetName);
  if (!sheet) return "";
  const relationshipId = sheet.getAttribute("r:id") || sheet.getAttribute("id");
  const relationshipsDoc = parser.parseFromString(relationshipsXml, "application/xml");
  const relationship = [...relationshipsDoc.querySelectorAll("Relationship")].find((item) => item.getAttribute("Id") === relationshipId);
  const target = relationship?.getAttribute("Target") || "";
  if (!target) return "";
  if (target.startsWith("/")) return target.slice(1);
  return target.startsWith("xl/") ? target : `xl/${target}`;
}

function xlsxRows(xmlFiles, parser, sharedStrings, sheetPath) {
  const sheetXml = xmlFiles.get(sheetPath);
  if (!sheetXml) return [];
  const sheetDoc = parser.parseFromString(sheetXml, "application/xml");
  return [...sheetDoc.querySelectorAll("sheetData row")].map((row) => {
    const values = [];
    [...row.querySelectorAll("c")].forEach((cell) => {
      values[xlsxColumnIndex(cell.getAttribute("r"))] = xlsxCellValue(cell, sharedStrings);
    });
    return values.map((value) => String(value || "").trim());
  }).filter((row) => row.some(Boolean));
}

function worksheetRows(xmlFiles, parser, sharedStrings, sheetName) {
  const path = xlsxWorksheetPath(xmlFiles, parser, sheetName);
  return path ? xlsxRows(xmlFiles, parser, sharedStrings, path) : [];
}

function normalizedHeader(value) {
  return String(value || "").replace(/\s/g, "").toLowerCase();
}

function headerRowIndex(rows, requiredHeaders) {
  return rows.findIndex((row) => {
    const headers = row.map(normalizedHeader);
    return requiredHeaders.every((header) => headers.includes(normalizedHeader(header)));
  });
}

function headerColumn(headers, aliases) {
  const normalized = headers.map(normalizedHeader);
  return normalized.findIndex((header) => aliases.map(normalizedHeader).includes(header));
}

function parseActivityRows(rows, sourceName, defaultStatus) {
  const headerIndex = headerRowIndex(rows, ["날짜", "멤버"]);
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex];
  const dateIndex = headerColumn(headers, ["날짜", "date"]);
  const memberIndex = headerColumn(headers, ["멤버", "member"]);
  const statusIndex = headerColumn(headers, ["상태", "status"]);
  const sourceIndex = headerColumn(headers, ["외부시스템", "source"]);
  return rows.slice(headerIndex + 1).filter((row) => {
    if (!sourceName || sourceIndex < 0) return true;
    return row[sourceIndex] === sourceName;
  }).map((row) => ({
    id: makeId(),
    date: /^\d+(\.\d+)?$/.test(row[dateIndex]) ? excelSerialDate(row[dateIndex]) : row[dateIndex],
    member: row[memberIndex],
    status: ACTIVITY_STATES.includes(row[statusIndex]) ? row[statusIndex] : defaultStatus,
  })).filter((row) => row.date && row.member);
}

function parseScheduleRows(rows) {
  const headerIndex = headerRowIndex(rows, ["날짜", "일정명", "참여 멤버"]);
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex];
  const dateIndex = headerColumn(headers, ["날짜", "date"]);
  const titleIndex = headerColumn(headers, ["일정명", "일정", "title"]);
  const membersIndex = headerColumn(headers, ["참여 멤버", "참여멤버", "멤버", "members"]);
  return rows.slice(headerIndex + 1).map((row) => ({
    id: makeId(),
    date: /^\d+(\.\d+)?$/.test(row[dateIndex]) ? excelSerialDate(row[dateIndex]) : row[dateIndex],
    title: row[titleIndex],
    members: splitNames(row[membersIndex]),
  })).filter((row) => row.date && row.title && row.members.length);
}

function parseExpenseRows(rows, sourceFileName) {
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(normalizedHeader);
    return headers.includes("날짜") && headers.includes("내역") && (headers.includes("금액") || headers.includes("실제식비"));
  });
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex];
  const dateIndex = headerColumn(headers, ["날짜", "date"]);
  const timeIndex = headerColumn(headers, ["결제 시간", "결제시간", "시간", "time"]);
  const titleIndex = headerColumn(headers, ["내역", "title"]);
  const amountIndex = headerColumn(headers, ["실제 식비", "실제식비", "금액", "amount"]);
  const participantsIndex = headerColumn(headers, ["예상 식사인원", "예상식사인원", "참여 멤버", "참여멤버"]);
  const excludedIndex = headerColumn(headers, ["정산 제외", "정산제외"]);
  const statusIndex = headerColumn(headers, ["승인 상태", "승인상태"]);
  const approverIndex = headerColumn(headers, ["승인권자", "승인자"]);
  return rows.slice(headerIndex + 1).map((row) => {
    const date = /^\d+(\.\d+)?$/.test(row[dateIndex]) ? excelSerialDate(row[dateIndex]) : row[dateIndex];
    const expense = createExpense(date, row[titleIndex], Math.max(0, Math.round(Number(row[amountIndex] || 0))), timeIndex >= 0 ? excelTimeValue(row[timeIndex]) : "12:00");
    if (participantsIndex >= 0 && row[participantsIndex]) expense.participants = splitNames(row[participantsIndex]);
    expense.excluded = excludedIndex >= 0 && row[excludedIndex] ? splitNames(row[excludedIndex]) : defaultExcluded(expense.participants);
    expense.approvalStatus = statusIndex >= 0 && APPROVAL_STATES.includes(row[statusIndex]) ? row[statusIndex] : defaultApprovalStatus(expense);
    expense.approver = approverIndex >= 0 && row[approverIndex] ? row[approverIndex] : "인사 마스터";
    expense.recommendationNote = `${sourceFileName} .xlsx Import`;
    return expense;
  }).filter((expense) => expense.date && expense.title && expense.amount >= 0);
}

async function readIntegrationWorkbook(file, integrationType) {
  const xmlFiles = await unzipWorkbook(await file.arrayBuffer());
  const parser = new DOMParser();
  const sharedDoc = parser.parseFromString(xmlFiles.get("xl/sharedStrings.xml") || "<sst/>", "application/xml");
  const sharedStrings = [...sharedDoc.querySelectorAll("si")].map((node) => [...node.querySelectorAll("t")].map((text) => text.textContent).join(""));
  if (integrationType === "attendance") {
    const attendance = parseActivityRows(worksheetRows(xmlFiles, parser, sharedStrings, "활동기록"), "회사 입출 기록", "출근");
    if (!attendance.length) throw new Error("활동기록 시트에서 회사 입출 기록을 찾을 수 없습니다.");
    return { attendance, schedules: [], expenses: [] };
  }
  if (integrationType === "schedule") {
    const activityRows = worksheetRows(xmlFiles, parser, sharedStrings, "활동기록");
    const attendance = parseActivityRows(activityRows, "그룹 캘린더", "외부일정");
    const schedules = parseScheduleRows(worksheetRows(xmlFiles, parser, sharedStrings, "일정표"));
    if (!schedules.length) throw new Error("일정표 시트에서 가져올 일정을 찾을 수 없습니다.");
    return { attendance, schedules, expenses: [] };
  }
  const simpleRows = worksheetRows(xmlFiles, parser, sharedStrings, "결제내역");
  const foodSheetName = state.groupName === "삼데헌" ? "삼데헌 식사" : "Samildol 식사";
  const foodRows = worksheetRows(xmlFiles, parser, sharedStrings, foodSheetName);
  const expenses = parseExpenseRows(simpleRows.length ? simpleRows : foodRows, file.name);
  if (!expenses.length) throw new Error(`결제내역 또는 ${foodSheetName} 시트에서 식비 데이터를 찾을 수 없습니다.`);
  return { attendance: [], schedules: [], expenses };
}

function replaceByKey(currentRows, importedRows, keyFor) {
  const importedKeys = new Set(importedRows.map(keyFor));
  return [...currentRows.filter((row) => !importedKeys.has(keyFor(row))), ...importedRows];
}

async function importIntegrationWorkbook(file, integrationType) {
  if (!file) return;
  try {
    const imported = await readIntegrationWorkbook(file, integrationType);
    if (integrationType === "attendance") {
      state.attendance = replaceByKey(state.attendance, imported.attendance, (row) => `${row.date}|${row.member}`);
      state.integrationStatus.attendance = `${file.name}, ${imported.attendance.length}건`;
      state.expenses.forEach(syncExpenseRecommendation);
      addAudit("회사 출입 기록 .xlsx Import", `${file.name}에서 활동 기록 ${imported.attendance.length}건을 반영했습니다.`);
    } else if (integrationType === "schedule") {
      state.attendance = replaceByKey(state.attendance, imported.attendance, (row) => `${row.date}|${row.member}`);
      state.schedules = replaceByKey(state.schedules, imported.schedules, (row) => `${row.date}|${row.title}`);
      state.integrationStatus.schedule = `${file.name}, 일정 ${imported.schedules.length}건`;
      state.expenses.forEach(syncExpenseRecommendation);
      addAudit("그룹 캘린더 .xlsx Import", `${file.name}에서 일정 ${imported.schedules.length}건과 활동 상태 ${imported.attendance.length}건을 반영했습니다.`);
    } else {
      state.expenses = replaceByKey(state.expenses, imported.expenses, (row) => `${row.date}|${row.transactionTime}|${row.title}`);
      state.integrationStatus.expense = `${file.name}, ${imported.expenses.length}건`;
      refreshAutomaticApprovalStatuses();
      addAudit("식비 결제 .xlsx Import", `${file.name}에서 식비 결제 ${imported.expenses.length}건을 반영했습니다.`);
    }
    render();
  } catch (error) {
    addAudit(".xlsx Import 실패", `${file.name}: ${error.message || "알 수 없는 오류"}`);
    alert(`.xlsx Import에 실패했습니다.\n${error.message || "파일 형식을 확인해 주세요."}`);
    render();
  }
}

const IDOL_GROUPS = [
  { name: "Samildol", members: ["Haru", "Min", "Seo", "Lia", "Noa"], seed: seedData },
  { name: "삼데헌", members: ["원준석", "장현우", "김진현", "이준영"], seed: seedOtherIdolData },
];

function detectIdolGroup(attendance, schedules) {
  const importedMembers = new Set([
    ...attendance.map((row) => row.member),
    ...schedules.flatMap((row) => row.members),
  ]);
  const matches = IDOL_GROUPS.map((group) => ({
    ...group,
    score: group.members.filter((member) => importedMembers.has(member)).length,
  })).filter((group) => group.score > 0).sort((a, b) => b.score - a.score);
  if (!matches.length || (matches[1] && matches[0].score === matches[1].score)) {
    throw new Error("활동기록과 일정표의 멤버로 아이돌을 식별할 수 없습니다.");
  }
  return matches[0];
}

async function importIdolWorkbook(file) {
  if (!file) return;
  const previousState = JSON.parse(JSON.stringify(state));
  try {
    const xmlFiles = await unzipWorkbook(await file.arrayBuffer());
    const parser = new DOMParser();
    const sharedDoc = parser.parseFromString(xmlFiles.get("xl/sharedStrings.xml") || "<sst/>", "application/xml");
    const sharedStrings = [...sharedDoc.querySelectorAll("si")].map((node) => [...node.querySelectorAll("t")].map((text) => text.textContent).join(""));
    const attendance = parseActivityRows(worksheetRows(xmlFiles, parser, sharedStrings, "활동기록"), "", "출근");
    const schedules = parseScheduleRows(worksheetRows(xmlFiles, parser, sharedStrings, "일정표"));
    if (!attendance.length) throw new Error("활동기록 시트에서 가져올 출퇴근 기록을 찾을 수 없습니다.");
    if (!schedules.length) throw new Error("일정표 시트에서 가져올 일정을 찾을 수 없습니다.");

    const group = detectIdolGroup(attendance, schedules);
    const user = currentUser();
    group.seed();
    state.currentUserId = user.id;
    state.attendance = attendance;
    state.schedules = schedules;

    const paymentRows = worksheetRows(xmlFiles, parser, sharedStrings, "결제내역");
    const expenses = parseExpenseRows(paymentRows, file.name);
    if (!expenses.length) throw new Error("결제내역 시트에서 가져올 식비 결제를 찾을 수 없습니다.");
    state.expenses = expenses;

    const dates = [...attendance.map((row) => row.date), ...schedules.map((row) => row.date), ...expenses.map((row) => row.date)].filter(Boolean).sort();
    state.periodStart = dates[0] || state.periodStart;
    state.periodEnd = dates.at(-1) || state.periodEnd;
    state.integrationStatus = {
      attendance: `${file.name}, ${attendance.length}건`,
      schedule: `${file.name}, ${schedules.length}건`,
      expense: `${file.name}, ${expenses.length}건`,
    };
    refreshAutomaticApprovalStatuses();
    addAudit("다른 아이돌 .xlsx 연동", `${file.name}에서 ${group.name} 출퇴근 ${attendance.length}건, 일정 ${schedules.length}건, 식비 ${expenses.length}건을 가져왔습니다.`, user);
    syncInputs();
    render();
  } catch (error) {
    Object.assign(state, previousState);
    addAudit("다른 아이돌 .xlsx 연동 실패", `${file.name}: ${error.message || "알 수 없는 오류"}`);
    alert(`다른 아이돌 .xlsx 연동에 실패했습니다.\n${error.message || "파일 형식을 확인해 주세요."}`);
    render();
  }
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
    approver: "인사 마스터",
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
    { id: makeId(), name: "Kim Ara", role: "마케팅 팀장", monthlySalary: 4500000, nonIdolHours: 60, hours: { Haru: 34, Min: 24, Seo: 20, Lia: 14, Noa: 8 } },
    { id: makeId(), name: "Lee Jun", role: "콘텐츠 마케터", monthlySalary: 3800000, nonIdolHours: 60, hours: { Haru: 18, Min: 30, Seo: 26, Lia: 16, Noa: 10 } },
    { id: makeId(), name: "Choi Mina", role: "퍼포먼스 마케터", monthlySalary: 3400000, nonIdolHours: 60, hours: { Haru: 12, Min: 16, Seo: 22, Lia: 28, Noa: 22 } },
  ];
}

function marketingEmployeeIdolHours(employee) {
  return state.members
    .filter((member) => !EXCLUDED_ROLES.has(member.role))
    .reduce((sum, member) => sum + Math.max(0, Number(employee.hours?.[member.name] || 0)), 0);
}

function marketingEmployeeTotalHours(employee) {
  return marketingEmployeeIdolHours(employee) + Math.max(0, Number(employee.nonIdolHours || 0));
}

function marketingAllocations(employee) {
  const members = state.members.filter((member) => !EXCLUDED_ROLES.has(member.role));
  const totalHours = marketingEmployeeTotalHours(employee);
  if (!totalHours) return Object.fromEntries(members.map((member) => [member.name, 0]));
  const salary = Math.max(0, Math.round(Number(employee.monthlySalary || 0)));
  const allocatedTarget = Math.round(salary * marketingEmployeeIdolHours(employee) / totalHours);
  const allocations = members.map((member, index) => {
    const raw = salary * Math.max(0, Number(employee.hours?.[member.name] || 0)) / totalHours;
    return { name: member.name, amount: Math.floor(raw), remainder: raw - Math.floor(raw), index };
  });
  let remaining = allocatedTarget - allocations.reduce((sum, item) => sum + item.amount, 0);
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

function marketingUnallocatedSalary(employee) {
  const allocated = Object.values(marketingAllocations(employee)).reduce((sum, amount) => sum + amount, 0);
  return Math.max(0, Math.round(Number(employee.monthlySalary || 0)) - allocated);
}

function marketingCostForMember(memberName) {
  return state.marketingPayroll.reduce((sum, employee) => sum + marketingAllocation(employee, memberName), 0);
}

function totalMarketingOffset() {
  return state.members
    .filter((member) => !EXCLUDED_ROLES.has(member.role))
    .reduce((sum, member) => sum + marketingCostForMember(member.name), 0);
}

function totalMarketingUnallocated() {
  return state.marketingPayroll.reduce((sum, employee) => sum + marketingUnallocatedSalary(employee), 0);
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

function hasValidContractRateTotal() {
  return Math.abs(contractRateTotal() - 100) < 0.0001;
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
      <p class="contract-footnote">더미 계약서 기준일: ${escapeHtml(contract.effectiveDate)}, 실제 계약서가 아니라 PoC용 가정 문서입니다.</p>
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
  els.currentUser.innerHTML = INTERNAL_USERS.map((user) => `<option value="${user.id}" ${state.currentUserId === user.id ? "selected" : ""}>${user.id}, ${user.name}, ${user.role}</option>`).join("");
  const user = currentUser();
  const scopeNotice = isFoodOnlyUser(user) ? `, 담당 아이돌: ${user.assignedGroupLabel || user.assignedGroup}, 업무 범위: 담당 아이돌 식비 정산 전용` : "";
  els.authNotice.textContent = `${user.name} 계정으로 작업 중입니다. 입력 권한 ${user.canEdit ? "있음" : "없음"}, 다른 아이돌 연동 ${canSwitchIdol(user) ? "가능" : "불가"}, 승인 권한 ${user.canApprove ? "있음" : "없음"}, 로그 열람 ${user.canViewAudit ? "가능" : "불가"}${scopeNotice}`;
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
  state.integrationStatus = { attendance: ".xlsx 선택 필요", schedule: ".xlsx 선택 필요", expense: ".xlsx 선택 필요" };
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
    { id: makeId(), at: "2026-07-08 09:00", actor: "현장 매니저", action: "더미 데이터 준비", detail: "Samildol 활동 기록, 일정표, 매출 항목, 식비 결제 건, 마케팅 사업부 급여와 아이돌별 투입시간을 불러왔습니다." },
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
  state.integrationStatus = { attendance: ".xlsx 선택 필요", schedule: ".xlsx 선택 필요", expense: ".xlsx 선택 필요" };
  state.members = [
    {
      id: makeId(), name: "원준석", role: "멤버", rate: 15, revenueWeight: 1.3,
      contract: createContract("상", "본인 일부 부담", "중간", "개인 광고와 패션 행사 기여도를 반영해 멤버 몫 중 15%를 배정합니다.", "개인 광고 매출에도 동일 지급률을 적용합니다."),
    },
    {
      id: makeId(), name: "장현우", role: "멤버", rate: 13, revenueWeight: 1.1,
      contract: createContract("중상", "회사 부담", "높음", "보컬 활동과 음원 기여도를 반영해 멤버 몫 중 13%를 배정합니다.", "OST 매출은 개인 매출로 구분합니다."),
    },
    {
      id: makeId(), name: "김진현", role: "멤버", rate: 12, revenueWeight: 1,
      contract: createContract("중", "회사 부담", "높음", "방송과 팬 커뮤니티 기여도를 반영해 멤버 몫 중 12%를 배정합니다.", "방송 고정 출연료는 개인 매출로 구분합니다."),
    },
    {
      id: makeId(), name: "이준영", role: "멤버", rate: 10, revenueWeight: 0.8,
      contract: createContract("중", "회사 부담", "높음", "퍼포먼스와 해외 활동 기여도를 반영해 멤버 몫 중 10%를 배정합니다.", "해외 활동 증가 시 지급률 재협상 대상입니다."),
    },
  ];
  state.staff = [{ id: makeId(), name: "Manager Choi", role: "매니저", settlementExcluded: true }];
  state.selectedContractId = state.members[0].id;
  state.revenueItems = [
    createRevenue("2026-07-17", "미니앨범 쇼케이스", "공통 매출", 36000000, ["원준석", "장현우", "김진현", "이준영"]),
    createRevenue("2026-07-20", "원준석 패션 브랜드 광고", "개인 매출", 9500000, ["원준석"]),
    createRevenue("2026-07-23", "장현우 드라마 OST", "개인 매출", 6800000, ["장현우"]),
    createRevenue("2026-07-27", "아시아 팬미팅", "공통 매출", 54000000, ["원준석", "장현우", "김진현", "이준영"]),
    createRevenue("2026-07-29", "김진현 예능 고정 출연료", "개인 매출", 5200000, ["김진현"]),
  ];
  state.attendance = [
    ["2026-07-16", "원준석", "출근"], ["2026-07-16", "장현우", "출근"], ["2026-07-16", "김진현", "출근"], ["2026-07-16", "이준영", "출근"],
    ["2026-07-18", "원준석", "외부일정"], ["2026-07-18", "장현우", "외부일정"], ["2026-07-18", "김진현", "외부일정"], ["2026-07-18", "이준영", "외부일정"],
    ["2026-07-21", "장현우", "출근"], ["2026-07-21", "김진현", "출근"],
    ["2026-07-25", "원준석", "외부일정"], ["2026-07-25", "장현우", "외부일정"], ["2026-07-25", "김진현", "외부일정"], ["2026-07-25", "이준영", "외부일정"],
  ].map(([date, member, status]) => ({ id: makeId(), date, member, status }));
  state.schedules = [
    { id: makeId(), date: "2026-07-16", title: "컴백 안무 합주", members: ["원준석", "장현우", "김진현", "이준영"] },
    { id: makeId(), date: "2026-07-18", title: "음악방송 리허설", members: ["원준석", "장현우", "김진현", "이준영"] },
    { id: makeId(), date: "2026-07-21", title: "라디오 스페셜 DJ", members: ["장현우", "김진현"] },
    { id: makeId(), date: "2026-07-25", title: "팬미팅 무대 점검", members: ["원준석", "장현우", "김진현", "이준영"] },
  ];
  state.expenses = [
    createExpense("2026-07-16", "합주실 점심", 118000, "12:15"),
    createExpense("2026-07-18", "방송국 도시락", 132000, "11:40"),
    createExpense("2026-07-21", "라디오 대기 식사", 54000, "18:10"),
    createExpense("2026-07-25", "팬미팅 리허설 저녁", 126000, "19:05"),
  ];
  state.marketingPayroll = [
    { id: makeId(), name: "Han Sora", role: "마케팅 팀장", monthlySalary: 4600000, nonIdolHours: 68, hours: { "원준석": 32, "장현우": 24, "김진현": 20, "이준영": 16 } },
    { id: makeId(), name: "Oh Jin", role: "콘텐츠 마케터", monthlySalary: 3700000, nonIdolHours: 64, hours: { "원준석": 18, "장현우": 26, "김진현": 30, "이준영": 22 } },
  ];
  state.marketingInitialized = true;
  state.auditLogs = [];
  addAudit("담당 아이돌 데이터 준비", "삼데헌 멤버 4명, 매출, 활동 기록, 일정, 식비, 마케팅 급여 데이터를 불러왔습니다.");
  syncInputs();
  render();
}

function normalizeState() {
  state.version = DATA_VERSION;
  state.approvalLimit = Number(state.approvalLimit || 30000);
  state.concurrentApprovalCount = Math.max(2, Math.round(Number(state.concurrentApprovalCount || 3)));
  state.companyRate = Number(state.companyRate ?? 50);
  state.currentUserId = state.currentUserId || "FIN-1024";
  state.integrationStatus = state.integrationStatus && typeof state.integrationStatus === "object" ? state.integrationStatus : {};
  const normalizeImportStatus = (value) => String(value || ".xlsx 선택 필요")
    .replace("Excel 선택 필요", ".xlsx 선택 필요")
    .replace("Excel 연동", ".xlsx Import");
  state.integrationStatus.attendance = normalizeImportStatus(state.integrationStatus.attendance);
  state.integrationStatus.schedule = normalizeImportStatus(state.integrationStatus.schedule);
  state.integrationStatus.expense = normalizeImportStatus(state.integrationStatus.expense);
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
    expense.approver = !expense.approver || expense.approver === "상위 매니저" ? "인사 마스터" : expense.approver;
    expense.recommendationNote = String(expense.recommendationNote || "날짜 기준으로 다시 계산할 수 있습니다.")
      .replace("Excel 연동", ".xlsx Import");
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
    const idolHours = marketingEmployeeIdolHours(employee);
    employee.nonIdolHours = employee.nonIdolHours == null
      ? Math.max(0, 160 - idolHours)
      : Math.max(0, Number(employee.nonIdolHours || 0));
  });
  state.attendance = Array.isArray(state.attendance) ? state.attendance : [];
  state.schedules = Array.isArray(state.schedules) ? state.schedules : [];
  state.auditLogs = Array.isArray(state.auditLogs) ? state.auditLogs : [];
  state.auditLogs.forEach((log) => {
    log.actor = String(log.actor || "").replaceAll("정산 담당자", "현장 매니저");
    log.action = String(log.action || "")
      .replaceAll("Excel 연동", ".xlsx Import")
      .replaceAll("Excel 출력", "이전 버전 파일 출력");
    log.detail = String(log.detail || "")
      .replaceAll("정산 담당자", "현장 매니저")
      .replaceAll("Excel 연동", ".xlsx Import")
      .replaceAll("Excel 출력", "이전 버전 파일 출력");
  });
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
      <td class="money deduction" data-marketing-sensitive>-${currency.format(calc.marketing)}</td>
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
  const user = currentUser();
  const canApproveExpense = hasAllPermissions(user);
  state.expenses.forEach((expense) => {
    const share = expenseShare(expense);
    const needsApproval = expenseNeedsApproval(expense);
    const status = expenseStatus(expense);
    const approvalReasonText = expenseApprovalReasons(expense).join(", ") || "승인 조건 해당 없음";
    const billableCount = billableParticipants(expense).length;
    const card = document.createElement("article");
    card.className = `compact-card ${needsApproval && status !== "승인 완료" ? "approval-card" : ""}`;
    card.innerHTML = `
      <div class="compact-summary expense-summary">
        <div>
          <span class="compact-date">${escapeHtml(expense.date)} ${escapeHtml(expense.transactionTime)}</span>
          <strong>${escapeHtml(expense.title)}</strong>
          <span class="compact-sub">예상 ${billableCount}명, ${escapeHtml(expenseStatus(expense))}, ${escapeHtml(approvalReasonText)}, ${escapeHtml(expense.recommendationNote)}</span>
        </div>
        <div class="compact-money">${currency.format(expense.amount)}</div>
        <div class="compact-money">1인 ${currency.format(share)}</div>
        <div class="approval-action">
          ${canApproveExpense && needsApproval && status !== "승인 완료" ? `<button class="small approve-button" type="button" data-approve-expense="${expense.id}">승인</button>` : ""}
        </div>
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
          <span>샐러드, 식사 생략 등</span>
        </label>
        <label class="exception-note wide-field">비고(사유)
          <input value="${escapeHtml(expense.exceptionNote)}" data-expense-field="exceptionNote" data-id="${expense.id}" aria-label="특이 사항 사유" placeholder="예: Lia 샐러드 주문, Noa 식사 생략" ${expense.isExceptional ? "required" : "disabled"}>
          ${expense.isExceptional && !expense.exceptionNote.trim() ? '<span class="field-warning">특이 사유를 입력해 주세요.</span>' : ""}
        </label>
        <label>승인 상태<select data-expense-field="approvalStatus" data-id="${expense.id}" aria-label="승인 상태" ${canApproveExpense ? "" : "disabled"}>
          ${APPROVAL_STATES.map((item) => `<option value="${item}" ${status === item ? "selected" : ""}>${item}</option>`).join("")}
        </select></label>
        <label>승인권자<input value="${escapeHtml(expense.approver)}" data-expense-field="approver" data-id="${expense.id}" aria-label="승인권자" disabled></label>
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
        <th>아이돌 투입시간</th>
        <th>비아이돌 업무시간</th>
        <th>전체 업무시간</th>
        <th>비배부 급여</th>
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
          <td class="money">${marketingEmployeeIdolHours(employee)}시간</td>
          <td><input type="number" min="0" step="0.5" value="${Number(employee.nonIdolHours || 0)}" data-marketing-field="nonIdolHours" data-id="${employee.id}" aria-label="${escapeHtml(employee.name)} 비아이돌 업무시간"></td>
          <td class="money">${marketingEmployeeTotalHours(employee)}시간</td>
          <td class="money">${currency.format(marketingUnallocatedSalary(employee))}</td>
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
  `).join("") + `
    <article>
      <span>아이돌 비배부 급여 합계</span>
      <strong>${currency.format(totalMarketingUnallocated())}</strong>
    </article>
  `;
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
  if (!currentUser().canViewAudit) {
    els.auditList.innerHTML = "";
    return;
  }
  els.auditList.innerHTML = state.auditLogs.slice(0, 12).map((log) => `
    <div class="audit-row">
      <strong>${escapeHtml(log.action)}</strong>
      <span>${escapeHtml(log.at)}, ${escapeHtml(log.actor)}</span>
      <p>${escapeHtml(log.detail)}</p>
    </div>
  `).join("");
}

function applyRoleVisibility() {
  const user = currentUser();
  const foodOnly = isFoodOnlyUser(user);
  document.querySelectorAll("[data-settlement-sensitive], [data-settlement-section]").forEach((element) => {
    element.hidden = foodOnly;
  });
  document.querySelectorAll("[data-marketing-sensitive]").forEach((element) => {
    element.hidden = !canViewMarketingPayroll(user);
  });
  els.auditPanel.hidden = !user.canViewAudit;
  els.importIdolButton.hidden = !canSwitchIdol(user);
  document.querySelectorAll("[data-integration-import]").forEach((button) => {
    button.disabled = !isHrMaster(user);
    button.title = isHrMaster(user) ? ".xlsx 파일을 선택해 데이터를 Import합니다." : "인사 마스터 전용 기능입니다.";
  });
  const badge = els.integrationPanel?.querySelector(".permission-badge");
  if (badge) badge.textContent = isHrMaster(user) ? "인사 마스터 전용" : "인사 마스터만 실행 가능";
}

function renderIntegrationStatus() {
  els.attendanceIntegrationStatus.textContent = state.integrationStatus.attendance;
  els.scheduleIntegrationStatus.textContent = state.integrationStatus.schedule;
  els.expenseIntegrationStatus.textContent = state.integrationStatus.expense;
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
  els.rateTotal.parentElement?.classList.toggle("warning-card", !hasValidContractRateTotal());
  els.totalRevenue.textContent = currency.format(totals.net);
  els.totalGross.textContent = currency.format(totals.gross);
  els.totalFood.textContent = currency.format(totals.food);
  els.totalMarketing.textContent = currency.format(totals.marketing);
  els.approvalCount.textContent = `${approvalCount}건`;
  document.title = `${state.groupName} Food-Fee 정산`;
}

function render() {
  normalizeState();
  persistState();
  if (isFoodOnlyUser()) {
    els.memberRows.innerHTML = "";
    els.revenueRows.innerHTML = "";
    els.marketingRows.innerHTML = "";
    els.contractDetail.innerHTML = "";
  } else {
    renderMembers();
    renderRevenue();
    renderMarketingPayroll();
    renderContractDetail();
  }
  renderExpenses();
  renderAttendance();
  renderSchedules();
  renderAuditLogs();
  renderIntegrationStatus();
  renderTotals();
  applyRoleVisibility();
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

document.addEventListener("submit", (event) => {
  if (event.target !== els.loginForm) return;
  event.preventDefault();

  const user = INTERNAL_USERS.find((item) => item.id === els.loginUserId.value);
  if (!user || user.password !== els.loginPassword.value) {
    els.loginError.textContent = "사번 또는 비밀번호가 올바르지 않습니다.";
    els.loginPassword.focus();
    els.loginPassword.select();
    return;
  }

  state.currentUserId = user.id;
  sessionStorage.setItem("foodFeeAuthUser", user.id);
  loadAssignedIdol(user);
  const assignmentNote = user.assignedGroup ? ` 담당 아이돌 ${user.assignedGroupLabel || user.assignedGroup} 데이터를 자동 연동했습니다.` : "";
  addAudit("로그인", `${actorLabel(user)} 계정으로 로그인했습니다.${assignmentNote}`, user);
  hideLogin();
  syncInputs();
  render();
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if ([els.groupName, els.periodStart, els.periodEnd, els.approvalLimit, els.concurrentApprovalCount, els.companyRate].includes(target)) {
    const allowed = target === els.companyRate
      ? ensureGeneralEditPermission("회사 지급률 수정")
      : ensureEditPermission("식비 정산 조건 수정");
    if (!allowed) return;
    updateSettings();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.field) {
    if (!ensureGeneralEditPermission("멤버 정보 수정")) return;
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
    if (!ensureGeneralEditPermission("매출 항목 수정")) return;
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
      const reason = expense.isExceptional ? `, 특이 사유: ${expense.exceptionNote || "미입력"}` : "";
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
      `${expense.date} ${expense.title}: ${memberName} ${target.checked ? "식사 생략" : "식사 생략 해제"}, 정산 대상 ${billableParticipants(expense).length}명, 1인 ${currency.format(expenseShare(expense))}`,
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
      `${expense.date} ${expense.title}: ${memberName} ${target.checked ? "별도 식사로 배분 제외" : "별도 식사 해제"}, 정산 대상 ${billableParticipants(expense).length}명, 1인 ${currency.format(expenseShare(expense))}`,
    );
    render();
  }
  if (target.dataset.marketingField) {
    if (!ensureGeneralEditPermission("마케팅 급여 정보 수정")) return;
    const employee = state.marketingPayroll.find((item) => item.id === target.dataset.id);
    const field = target.dataset.marketingField;
    const previous = employee[field];
    employee[field] = field === "monthlySalary"
      ? Math.max(0, Math.round(Number(target.value || 0)))
      : field === "nonIdolHours"
        ? Math.max(0, Number(target.value || 0))
        : target.value;
    const fieldLabel = { name: "직원명", role: "직무", monthlySalary: "월 급여", nonIdolHours: "비아이돌 업무시간" }[field] || field;
    addAudit("마케팅 급여 수정", `${employee.name} ${fieldLabel}: ${previous} -> ${employee[field]}`);
    render();
  }
  if (target.dataset.marketingHour) {
    if (!ensureGeneralEditPermission("마케팅 투입시간 수정")) return;
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
    const integrationType = target.dataset.integrationType;
    if (!integrationType || !ensureIntegrationPermission(".xlsx Import")) {
      target.value = "";
      return;
    }
    importIntegrationWorkbook(target.files?.[0], integrationType).finally(() => {
      target.value = "";
      delete target.dataset.integrationType;
    });
  }
  if (target === els.externalIdolInput) {
    if (!ensureIdolImportPermission()) {
      target.value = "";
      return;
    }
    importIdolWorkbook(target.files?.[0]).finally(() => {
      target.value = "";
    });
  }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (target.id === "logoutButton") {
    const user = authenticatedUser();
    if (user) addAudit("로그아웃", `${actorLabel(user)} 계정에서 로그아웃했습니다.`, user);
    persistState();
    sessionStorage.removeItem("foodFeeAuthUser");
    showLogin();
    return;
  }
  if (target.id === "importIdolButton") {
    if (!ensureIdolImportPermission()) return;
    els.externalIdolInput.value = "";
    els.externalIdolInput.click();
    return;
  }
  if (target.dataset.integrationImport) {
    if (!ensureIntegrationPermission(`${target.textContent.trim()} 실행`)) return;
    els.externalExcelInput.dataset.integrationType = target.dataset.integrationImport;
    els.externalExcelInput.value = "";
    els.externalExcelInput.click();
    return;
  }
  if (target.dataset.approveExpense) {
    const expense = state.expenses.find((item) => item.id === target.dataset.approveExpense);
    if (!expense || !ensureApprovalPermission(`${expense?.title || "식비"} 승인`)) return;
    const user = currentUser();
    if (!hasAllPermissions(user)) {
      addAudit("승인 차단", `${expense.title}: 입력, 승인, 감사 로그 열람 등 모든 권한을 가진 계정만 승인할 수 있습니다.`, user);
      alert("입력, 승인, 감사 로그 열람 등 모든 권한을 가진 계정만 승인할 수 있습니다.");
      render();
      return;
    }
    expense.approvalStatus = "승인 완료";
    expense.approver = user.name;
    addAudit("식비 승인", `${expense.date} ${expense.title}: ${currency.format(expense.amount)}, 1인 ${currency.format(expenseShare(expense))}`, user);
    render();
    return;
  }
  if (target.id === "resetButton") {
    if (!ensureGeneralEditPermission("전체 데이터 초기화")) return;
    localStorage.removeItem("foodFeeState");
    seedData();
  }
  if (target.id === "addMemberButton") {
    if (!ensureGeneralEditPermission("내부 멤버 동기화")) return;
    const hrUser = INTERNAL_USERS.find((user) => user.id === "HR-3007");
    addAudit("내부 멤버 동기화", `회사 내부 그룹 마스터 데이터에서 ${state.groupName} 멤버 ${state.members.length}명을 확인했습니다. 수기 추가는 허용하지 않습니다.`, hrUser);
    render();
  }
  if (target.dataset.showContract) {
    state.selectedContractId = target.dataset.showContract;
    render();
  }
  if (target.id === "addRevenueButton") {
    if (!ensureGeneralEditPermission("매출 항목 추가")) return;
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
    if (!ensureGeneralEditPermission("마케팅 직원 추가")) return;
    const hours = Object.fromEntries(state.members.filter((member) => !EXCLUDED_ROLES.has(member.role)).map((member) => [member.name, 0]));
    state.marketingPayroll.push({ id: makeId(), name: "새 마케팅 직원", role: "마케팅 담당", monthlySalary: 0, nonIdolHours: 160, hours });
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
  if (target.dataset.recommendExpense) {
    if (!ensureEditPermission("예상 식사인원 불러오기")) return;
    const expense = state.expenses.find((item) => item.id === target.dataset.recommendExpense);
    syncExpenseRecommendation(expense);
    render();
  }
  if (target.dataset.removeMember) {
    if (!ensureGeneralEditPermission("멤버 삭제")) return;
    const member = state.members.find((item) => item.id === target.dataset.removeMember);
    state.members = state.members.filter((item) => item.id !== target.dataset.removeMember);
    addAudit("멤버 삭제", `${member?.name || "알 수 없음"}을 삭제했습니다.`);
    render();
  }
  if (target.dataset.removeRevenue) {
    if (!ensureGeneralEditPermission("매출 항목 삭제")) return;
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
    if (!ensureGeneralEditPermission("마케팅 직원 삭제")) return;
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
    } else {
      Object.assign(state, parsed);
      normalizeState();
      syncInputs();
      render();
    }
  } else {
    seedData();
  }

  const user = authenticatedUser();
  if (user) {
    state.currentUserId = user.id;
    loadAssignedIdol(user);
    hideLogin();
    syncInputs();
    render();
  } else {
    showLogin();
  }
}

boot();
