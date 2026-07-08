const currency = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

const DATA_VERSION = 4;

const state = {
  version: DATA_VERSION,
  groupName: "samildol",
  periodStart: "2026-07-01",
  periodEnd: "2026-07-15",
  approvalLimit: 30000,
  members: [],
  expenses: [],
  attendance: [],
  schedules: [],
};

const els = {
  groupName: document.querySelector("#groupName"),
  periodStart: document.querySelector("#periodStart"),
  periodEnd: document.querySelector("#periodEnd"),
  approvalLimit: document.querySelector("#approvalLimit"),
  memberRows: document.querySelector("#memberRows"),
  expenseRows: document.querySelector("#expenseRows"),
  attendanceList: document.querySelector("#attendanceList"),
  scheduleList: document.querySelector("#scheduleList"),
  csvInput: document.querySelector("#csvInput"),
  totalRevenue: document.querySelector("#totalRevenue"),
  totalGross: document.querySelector("#totalGross"),
  totalFood: document.querySelector("#totalFood"),
  approvalCount: document.querySelector("#approvalCount"),
};

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function splitNames(value) {
  return String(value)
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function seedData() {
  state.version = DATA_VERSION;
  state.groupName = "samildol";
  state.periodStart = "2026-07-01";
  state.periodEnd = "2026-07-15";
  state.approvalLimit = 30000;
  state.members = [
    { id: makeId(), name: "Haru", revenue: 21800000, rate: 45 },
    { id: makeId(), name: "Min", revenue: 19700000, rate: 43 },
    { id: makeId(), name: "Seo", revenue: 17600000, rate: 44 },
    { id: makeId(), name: "Lia", revenue: 15400000, rate: 42 },
    { id: makeId(), name: "Noa", revenue: 13300000, rate: 40 },
  ];
  state.expenses = [
    { id: makeId(), date: "2026-07-01", title: "배민 연습실 저녁", amount: 92000, participants: ["Haru", "Min", "Seo", "Lia", "Manager Park"], excluded: ["Manager Park"] },
    { id: makeId(), date: "2026-07-03", title: "음악방송 도시락", amount: 165000, participants: ["Haru", "Min", "Seo", "Lia", "Noa", "Manager Park"], excluded: ["Manager Park"] },
    { id: makeId(), date: "2026-07-06", title: "라디오 대기 간식", amount: 48000, participants: ["Min", "Seo", "Manager Park"], excluded: ["Manager Park"] },
    { id: makeId(), date: "2026-07-09", title: "안무 연습 야식", amount: 74000, participants: ["Haru", "Lia", "Noa", "Manager Park"], excluded: ["Manager Park"] },
  ];
  state.attendance = [
    { id: makeId(), date: "2026-07-01", member: "Haru", status: "출근" },
    { id: makeId(), date: "2026-07-01", member: "Min", status: "출근" },
    { id: makeId(), date: "2026-07-01", member: "Seo", status: "출근" },
    { id: makeId(), date: "2026-07-01", member: "Lia", status: "출근" },
    { id: makeId(), date: "2026-07-03", member: "Haru", status: "출근" },
    { id: makeId(), date: "2026-07-03", member: "Min", status: "출근" },
    { id: makeId(), date: "2026-07-03", member: "Seo", status: "출근" },
    { id: makeId(), date: "2026-07-03", member: "Lia", status: "출근" },
    { id: makeId(), date: "2026-07-03", member: "Noa", status: "출근" },
    { id: makeId(), date: "2026-07-06", member: "Min", status: "출근" },
    { id: makeId(), date: "2026-07-06", member: "Seo", status: "출근" },
    { id: makeId(), date: "2026-07-09", member: "Haru", status: "출근" },
    { id: makeId(), date: "2026-07-09", member: "Lia", status: "출근" },
    { id: makeId(), date: "2026-07-09", member: "Noa", status: "출근" },
  ];
  state.schedules = [
    { id: makeId(), date: "2026-07-01", title: "컴백 안무 연습", members: ["Haru", "Min", "Seo", "Lia"] },
    { id: makeId(), date: "2026-07-03", title: "음악 방송 사전녹화", members: ["Haru", "Min", "Seo", "Lia", "Noa"] },
    { id: makeId(), date: "2026-07-06", title: "라디오 게스트", members: ["Min", "Seo"] },
    { id: makeId(), date: "2026-07-09", title: "안무 수정 리허설", members: ["Haru", "Lia", "Noa"] },
  ];
  syncInputs();
  render();
}

function normalizeState() {
  state.version = DATA_VERSION;
  state.approvalLimit = Number(state.approvalLimit || 30000);
  state.members = Array.isArray(state.members) ? state.members : [];
  state.expenses = Array.isArray(state.expenses) ? state.expenses : [];
  state.expenses.forEach((expense) => {
    expense.participants = Array.isArray(expense.participants) ? expense.participants : [];
    expense.excluded = Array.isArray(expense.excluded) ? expense.excluded : [];
  });
  state.attendance = Array.isArray(state.attendance) ? state.attendance : [];
  state.schedules = Array.isArray(state.schedules) ? state.schedules : [];
}

function syncInputs() {
  els.groupName.value = state.groupName;
  els.periodStart.value = state.periodStart;
  els.periodEnd.value = state.periodEnd;
  els.approvalLimit.value = state.approvalLimit;
}

function inPeriod(dateText) {
  return dateText >= state.periodStart && dateText <= state.periodEnd;
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

function expenseStatus(expense) {
  if (billableParticipants(expense).length === 0) return "대상 없음";
  return expenseNeedsApproval(expense) ? "승인 필요" : "자동 처리";
}

function calculateMember(member) {
  const memberExpenses = state.expenses.filter(
    (expense) => inPeriod(expense.date) && billableParticipants(expense).includes(member.name),
  );
  const food = memberExpenses.reduce((sum, expense) => sum + expenseShare(expense), 0);
  const gross = Math.round(Number(member.revenue || 0) * (Number(member.rate || 0) / 100));

  return {
    mealCount: memberExpenses.length,
    gross,
    food,
    net: gross - food,
  };
}

function renderMembers() {
  els.memberRows.innerHTML = "";

  state.members.forEach((member) => {
    const calc = calculateMember(member);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input value="${escapeHtml(member.name)}" data-field="name" data-id="${member.id}" aria-label="멤버명"></td>
      <td><input type="number" min="0" step="10000" value="${member.revenue}" data-field="revenue" data-id="${member.id}" aria-label="매출액"></td>
      <td><input type="number" min="0" max="100" step="0.1" value="${member.rate}" data-field="rate" data-id="${member.id}" aria-label="정산율"></td>
      <td>${calc.mealCount}건</td>
      <td class="money">${currency.format(calc.gross)}</td>
      <td class="money deduction">-${currency.format(calc.food)}</td>
      <td class="money net">${currency.format(calc.net)}</td>
      <td><button class="remove" type="button" data-remove-member="${member.id}" aria-label="멤버 삭제">x</button></td>
    `;
    els.memberRows.appendChild(tr);
  });
}

function renderExpenses() {
  els.expenseRows.innerHTML = "";

  state.expenses.forEach((expense) => {
    const share = expenseShare(expense);
    const needsApproval = expenseNeedsApproval(expense);
    const billableCount = billableParticipants(expense).length;
    const status = expenseStatus(expense);
    const tr = document.createElement("tr");
    tr.className = needsApproval ? "approval-row" : "";
    tr.innerHTML = `
      <td><input type="date" value="${expense.date}" data-expense-field="date" data-id="${expense.id}" aria-label="날짜"></td>
      <td><input value="${escapeHtml(expense.title)}" data-expense-field="title" data-id="${expense.id}" aria-label="내역"></td>
      <td><input type="number" min="0" step="1000" value="${expense.amount}" data-expense-field="amount" data-id="${expense.id}" aria-label="금액"></td>
      <td><input value="${escapeHtml(expense.participants.join(", "))}" data-expense-field="participants" data-id="${expense.id}" aria-label="식사 인원"></td>
      <td><input value="${escapeHtml(expense.excluded.join(", "))}" data-expense-field="excluded" data-id="${expense.id}" aria-label="정산 제외 인원"></td>
      <td>제외 후 균등 배분 (${billableCount}명)</td>
      <td class="money">${currency.format(share)}</td>
      <td><span class="status ${needsApproval ? "warn" : "ok"}">${status}</span></td>
      <td><button class="remove" type="button" data-remove-expense="${expense.id}" aria-label="비용 삭제">x</button></td>
    `;
    els.expenseRows.appendChild(tr);
  });
}

function renderAttendance() {
  els.attendanceList.innerHTML = "";

  state.attendance.forEach((row) => {
    const div = document.createElement("div");
    div.className = "record-row";
    div.innerHTML = `
      <input type="date" value="${row.date}" data-attendance-field="date" data-id="${row.id}" aria-label="날짜">
      <input value="${escapeHtml(row.member)}" data-attendance-field="member" data-id="${row.id}" aria-label="멤버">
      <select data-attendance-field="status" data-id="${row.id}" aria-label="상태">
        <option ${row.status === "출근" ? "selected" : ""}>출근</option>
        <option ${row.status === "대기" ? "selected" : ""}>대기</option>
        <option ${row.status === "제외" ? "selected" : ""}>제외</option>
      </select>
      <button class="remove" type="button" data-remove-attendance="${row.id}" aria-label="기록 삭제">x</button>
    `;
    els.attendanceList.appendChild(div);
  });
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

function renderTotals() {
  const totals = state.members.reduce(
    (acc, member) => {
      const calc = calculateMember(member);
      acc.revenue += Number(member.revenue || 0);
      acc.gross += calc.gross;
      acc.food += calc.food;
      acc.net += calc.net;
      return acc;
    },
    { revenue: 0, gross: 0, food: 0, net: 0 },
  );
  const approvalCount = state.expenses.filter((expense) => inPeriod(expense.date) && expenseNeedsApproval(expense)).length;

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
  renderExpenses();
  renderAttendance();
  renderSchedules();
  renderTotals();
}

function updateSettings() {
  state.groupName = els.groupName.value.trim() || "그룹";
  state.periodStart = els.periodStart.value;
  state.periodEnd = els.periodEnd.value;
  state.approvalLimit = Number(els.approvalLimit.value || 0);
  render();
}

function buildSettlementCsv() {
  const lines = [];
  lines.push(["Food-Fee 정산 결과"].map(csvCell).join(","));
  lines.push(["그룹명", state.groupName].map(csvCell).join(","));
  lines.push(["정산 기간", `${state.periodStart} ~ ${state.periodEnd}`].map(csvCell).join(","));
  lines.push(["1인 승인 기준", state.approvalLimit].map(csvCell).join(","));
  lines.push("");
  lines.push(["멤버별 정산"].map(csvCell).join(","));
  lines.push(["멤버", "매출액", "정산율", "식비 건수", "공제 전 정산금", "식비 공제액", "공제 후 정산금"].map(csvCell).join(","));

  state.members.forEach((member) => {
    const calc = calculateMember(member);
    lines.push([
      member.name,
      member.revenue,
      member.rate,
      calc.mealCount,
      calc.gross,
      calc.food,
      calc.net,
    ].map(csvCell).join(","));
  });

  lines.push("");
  lines.push(["비용별 분배"].map(csvCell).join(","));
  lines.push(["날짜", "내역", "금액", "식사 인원", "정산 제외", "정산 대상", "1인 금액", "상태"].map(csvCell).join(","));

  state.expenses.forEach((expense) => {
    lines.push([
      expense.date,
      expense.title,
      expense.amount,
      expense.participants.join(", "),
      expense.excluded.join(", "),
      billableParticipants(expense).join(", "),
      expenseShare(expense),
      expenseStatus(expense),
    ].map(csvCell).join(","));
  });

  return lines.join("\r\n");
}

function exportCsv() {
  const csv = `\ufeff${buildSettlementCsv()}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeGroupName = state.groupName.replace(/[\\/:*?"<>|]/g, "_") || "Food-Fee";
  a.href = url;
  a.download = `${safeGroupName}_Food-Fee_${state.periodStart}_${state.periodEnd}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

document.addEventListener("input", (event) => {
  const target = event.target;

  if ([els.groupName, els.periodStart, els.periodEnd, els.approvalLimit].includes(target)) {
    updateSettings();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;

  if (target.dataset.field) {
    const member = state.members.find((item) => item.id === target.dataset.id);
    const previousName = member.name;
    member[target.dataset.field] = target.dataset.field === "name" ? target.value : Number(target.value || 0);

    if (target.dataset.field === "name") {
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
    render();
  }

  if (target.dataset.expenseField) {
    const expense = state.expenses.find((item) => item.id === target.dataset.id);
    if (target.dataset.expenseField === "amount") {
      expense.amount = Number(target.value || 0);
    } else if (target.dataset.expenseField === "participants") {
      expense.participants = splitNames(target.value);
    } else if (target.dataset.expenseField === "excluded") {
      expense.excluded = splitNames(target.value);
    } else {
      expense[target.dataset.expenseField] = target.value;
    }
    render();
  }

  if (target.dataset.attendanceField) {
    const row = state.attendance.find((item) => item.id === target.dataset.id);
    row[target.dataset.attendanceField] = target.value;
    render();
  }

  if (target.dataset.scheduleField) {
    const row = state.schedules.find((item) => item.id === target.dataset.id);
    row[target.dataset.scheduleField] =
      target.dataset.scheduleField === "members" ? splitNames(target.value) : target.value;
    render();
  }
});

document.addEventListener("click", (event) => {
  const target = event.target;

  if (target.id === "exportButton") {
    exportCsv();
  }

  if (target.id === "seedButton") {
    seedData();
  }

  if (target.id === "resetButton") {
    localStorage.removeItem("foodFeeState");
    seedData();
  }

  if (target.id === "addMemberButton") {
    state.members.push({ id: makeId(), name: "New", revenue: 0, rate: 40 });
    render();
  }

  if (target.id === "addExpenseButton") {
    const participants = state.members.slice(0, 3).map((member) => member.name);
    state.expenses.push({
      id: makeId(),
      date: state.periodStart,
      title: "새 식비",
      amount: 0,
      participants,
      excluded: [],
    });
    render();
  }

  if (target.id === "addAttendanceButton") {
    const member = state.members[0]?.name || "New";
    state.attendance.push({ id: makeId(), date: state.periodStart, member, status: "출근" });
    render();
  }

  if (target.id === "addScheduleButton") {
    const member = state.members[0]?.name || "New";
    state.schedules.push({ id: makeId(), date: state.periodStart, title: "새 일정", members: [member] });
    render();
  }

  if (target.id === "importCsvButton") {
    const rows = els.csvInput.value
      .split(/\r?\n/)
      .map((line) => line.split(",").map((cell) => cell.trim()))
      .filter((cells) => cells.length >= 2 && cells[0] && cells[1]);

    state.attendance.push(
      ...rows.map(([date, member, status = "출근"]) => ({
        id: makeId(),
        date,
        member,
        status,
      })),
    );
    render();
  }

  if (target.dataset.removeMember) {
    state.members = state.members.filter((item) => item.id !== target.dataset.removeMember);
    render();
  }

  if (target.dataset.removeExpense) {
    state.expenses = state.expenses.filter((item) => item.id !== target.dataset.removeExpense);
    render();
  }

  if (target.dataset.removeAttendance) {
    state.attendance = state.attendance.filter((item) => item.id !== target.dataset.removeAttendance);
    render();
  }

  if (target.dataset.removeSchedule) {
    state.schedules = state.schedules.filter((item) => item.id !== target.dataset.removeSchedule);
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
