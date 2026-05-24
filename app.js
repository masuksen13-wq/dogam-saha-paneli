const DATA_VERSION = "dogam-v11";
const SERVER_MODE = location.protocol === "http:" || location.protocol === "https:";
let serverAvailable = false;
let syncTimer = null;

const DEFAULT_STAFF = [
  { name: "Mahşuk Gerde", pin: "1234", role: "Yönetici / Ziraat Mühendisi", type: "manager" },
  { name: "Mehmet", pin: "4444", role: "Yönetici", type: "manager" },
  { name: "Ali", pin: "2222", role: "Personel", type: "personnel" },
  { name: "Servet Yılmaz", pin: "3333", role: "Personel", type: "personnel" },
];

const statusLabels = {
  planned: "Planlandı",
  active: "Sahada",
  done: "Tamamlandı",
};

const paymentLabels = {
  cash: "Nakit",
  iban: "IBAN",
  debt: "Borç",
};

const memoryStore = {};

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const DEFAULT_CUSTOMERS = [];

const DEFAULT_INVENTORY = [
  { id: createId(), name: "Jel yem", quantity: 24, unit: "adet" },
  { id: createId(), name: "Fare yem istasyonu", quantity: 12, unit: "adet" },
  { id: createId(), name: "Genel ilaç", quantity: 8, unit: "litre" },
];

const DEFAULT_CHEMICAL_DELIVERIES = [];

const DEFAULT_APPOINTMENTS = [];

const DEFAULT_ROUTINES = [];

function getStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return memoryStore[key] || null;
  }
}

function setStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    memoryStore[key] = value;
  }
}

function removeStored(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    delete memoryStore[key];
  }
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function apiRequest(path, options = {}) {
  if (!SERVER_MODE) throw new Error("Sunucu modu kapalı.");

  const response = await fetch(path, {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Sunucu isteği başarısız.");
  return data;
}

function currentDataBundle() {
  return {
    staff,
    customers,
    inventory,
    chemicalDeliveries,
    appointments,
    routines,
  };
}

function applyDataBundle(data) {
  staff = Array.isArray(data.staff) ? data.staff : staff;
  customers = Array.isArray(data.customers) ? data.customers : customers;
  inventory = Array.isArray(data.inventory) ? data.inventory : inventory;
  chemicalDeliveries = Array.isArray(data.chemicalDeliveries) ? data.chemicalDeliveries : chemicalDeliveries;
  appointments = Array.isArray(data.appointments) ? data.appointments : appointments;
  routines = Array.isArray(data.routines) ? data.routines : routines;
  normalizeMoneyRecords();
  cleanupDemoData();
}

function compactBundle(data) {
  return {
    staff: Array.isArray(data.staff) ? data.staff : [],
    customers: Array.isArray(data.customers) ? data.customers : [],
    inventory: Array.isArray(data.inventory) ? data.inventory : [],
    chemicalDeliveries: Array.isArray(data.chemicalDeliveries) ? data.chemicalDeliveries : [],
    appointments: Array.isArray(data.appointments) ? data.appointments : [],
    routines: Array.isArray(data.routines) ? data.routines : [],
  };
}

function recordTimestamp(item) {
  const value = item?.deletedAt || item?.updatedAt || item?.completedAt || item?.reassignedAt || item?.createdAt || item?.lastCompleted || 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mergeByKey(serverItems, localItems, keySelector) {
  const merged = new Map();

  [...serverItems, ...localItems].forEach((item, index) => {
    const key = keySelector(item) || `item-${index}-${JSON.stringify(item)}`;
    const existing = merged.get(key);

    if (!existing || recordTimestamp(item) >= recordTimestamp(existing)) {
      merged.set(key, item);
    }
  });

  return [...merged.values()];
}

function mergeDataBundles(localData, serverData) {
  const local = compactBundle(localData);
  const server = compactBundle(serverData);

  return {
    staff: mergeByKey(server.staff, local.staff, (item) => String(item.name || "").toLocaleLowerCase("tr-TR")),
    customers: mergeByKey(server.customers, local.customers, (item) => item.id || String(item.name || "").toLocaleLowerCase("tr-TR")),
    inventory: mergeByKey(server.inventory, local.inventory, (item) => item.id || String(item.name || "").toLocaleLowerCase("tr-TR")),
    chemicalDeliveries: mergeByKey(server.chemicalDeliveries, local.chemicalDeliveries, (item) => item.id),
    appointments: mergeByKey(server.appointments, local.appointments, (item) => item.id),
    routines: mergeByKey(server.routines, local.routines, (item) => item.id),
  };
}

function sameBundle(left, right) {
  return JSON.stringify(compactBundle(left)) === JSON.stringify(compactBundle(right));
}

function sameStaffName(left, right) {
  return String(left || "").toLocaleLowerCase("tr-TR") === String(right || "").toLocaleLowerCase("tr-TR");
}

function migrateStaffProfiles() {
  let changed = false;

  DEFAULT_STAFF.forEach((defaultPerson) => {
    const existing = staff.find((person) => sameStaffName(person.name, defaultPerson.name));
    if (!existing) {
      staff.push({ ...defaultPerson });
      changed = true;
    }
  });

  if (changed) saveStaff();
  return changed;
}

async function pullServerData() {
  if (!SERVER_MODE) return false;

  try {
    const data = await apiRequest("/api/data");
    const localData = currentDataBundle();
    const serverData = compactBundle(data);
    const mergedData = mergeDataBundles(localData, serverData);
    const shouldRepairServer = !sameBundle(serverData, mergedData);

    serverAvailable = true;
    applyDataBundle(mergedData);
    const migrated = migrateStaffProfiles();
    const cleaned = cleanupDemoData();
    persistLocalSnapshot();
    if (shouldRepairServer || migrated || cleaned) scheduleServerSave();
    return true;
  } catch {
    serverAvailable = false;
    return false;
  }
}

function persistLocalSnapshot() {
  setStored("dogamDataVersion", DATA_VERSION);
  setStored("dogamStaff", JSON.stringify(staff));
  setStored("dogamCustomers", JSON.stringify(customers));
  setStored("dogamInventory", JSON.stringify(inventory));
  setStored("dogamChemicalDeliveries", JSON.stringify(chemicalDeliveries));
  setStored("dogamAppointments", JSON.stringify(appointments));
  setStored("dogamRoutines", JSON.stringify(routines));
}

function scheduleServerSave(delay = 350) {
  if (!SERVER_MODE) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushServerData, delay);
}

async function pushServerData() {
  if (!SERVER_MODE) return false;

  try {
    await apiRequest("/api/data", {
      method: "POST",
      body: JSON.stringify(currentDataBundle()),
    });
    serverAvailable = true;
    return true;
  } catch {
    serverAvailable = false;
    return false;
  }
}

function initializeDataStore() {
  setStored("dogamDataVersion", DATA_VERSION);
  if (!getStored("dogamStaff")) setStored("dogamStaff", JSON.stringify(DEFAULT_STAFF));
  if (!getStored("dogamCustomers")) setStored("dogamCustomers", JSON.stringify(DEFAULT_CUSTOMERS));
  if (!getStored("dogamInventory")) setStored("dogamInventory", JSON.stringify(DEFAULT_INVENTORY));
  if (!getStored("dogamChemicalDeliveries")) setStored("dogamChemicalDeliveries", JSON.stringify(DEFAULT_CHEMICAL_DELIVERIES));
  if (!getStored("dogamAppointments")) setStored("dogamAppointments", JSON.stringify(DEFAULT_APPOINTMENTS));
  if (!getStored("dogamRoutines")) setStored("dogamRoutines", JSON.stringify(DEFAULT_ROUTINES));
}

initializeDataStore();

let staff = loadStaff();
let customers = loadCustomers();
let inventory = loadInventory();
let chemicalDeliveries = loadChemicalDeliveries();
let appointments = loadAppointments();
let routines = loadRoutines();
let currentUser = loadCurrentUser();
let deferredInstallPrompt = null;

migrateStaffProfiles();
normalizeMoneyRecords();
cleanupDemoData();

const appShell = document.querySelector("#appShell");
const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const loginStaffValue = document.querySelector("#loginStaffValue");
const loginStaffButtons = document.querySelector("#loginStaffButtons");
const loginError = document.querySelector("#loginError");
const signedUser = document.querySelector("#signedUser");
const logoutButton = document.querySelector("#logoutButton");
const listEl = document.querySelector("#appointmentList");
const template = document.querySelector("#appointmentTemplate");
const routineTemplate = document.querySelector("#routineTemplate");
const staffFilter = document.querySelector("#staffFilter");
const statusFilter = document.querySelector("#statusFilter");
const staffFilterButtons = document.querySelector("#staffFilterButtons");
const staffSelectValue = document.querySelector("#staffSelectValue");
const staffAssignButtons = document.querySelector("#staffAssignButtons");
const routineStaffValue = document.querySelector("#routineStaffValue");
const routineStaffButtons = document.querySelector("#routineStaffButtons");
const form = document.querySelector("#appointmentForm");
const staffForm = document.querySelector("#staffForm");
const routineForm = document.querySelector("#routineForm");
const routineList = document.querySelector("#routineList");
const notificationButton = document.querySelector("#notificationButton");
const customerList = document.querySelector("#customerList");
const reportGrid = document.querySelector("#reportGrid");
const stockForm = document.querySelector("#stockForm");
const stockList = document.querySelector("#stockList");
const chemicalForm = document.querySelector("#chemicalForm");
const chemicalStaffValue = document.querySelector("#chemicalStaffValue");
const chemicalStaffButtons = document.querySelector("#chemicalStaffButtons");
const chemicalList = document.querySelector("#chemicalList");
const exportButton = document.querySelector("#exportButton");
const importData = document.querySelector("#importData");
const importButton = document.querySelector("#importButton");
const editJobDialog = document.querySelector("#editJobDialog");
const editJobForm = document.querySelector("#editJobForm");
const editStaffSelect = document.querySelector("#editStaffSelect");
const whatsappImportText = document.querySelector("#whatsappImportText");
const whatsappFillButton = document.querySelector("#whatsappFillButton");
const whatsappCreateButton = document.querySelector("#whatsappCreateButton");
const whatsappImportStatus = document.querySelector("#whatsappImportStatus");

function loadStaff() {
  return parseJson(getStored("dogamStaff"), DEFAULT_STAFF);
}

function saveStaff() {
  setStored("dogamStaff", JSON.stringify(staff));
  scheduleServerSave();
}

function loadCustomers() {
  return parseJson(getStored("dogamCustomers"), DEFAULT_CUSTOMERS);
}

function saveCustomers() {
  setStored("dogamCustomers", JSON.stringify(customers));
  scheduleServerSave();
}

function loadInventory() {
  return parseJson(getStored("dogamInventory"), DEFAULT_INVENTORY);
}

function saveInventory() {
  setStored("dogamInventory", JSON.stringify(inventory));
  scheduleServerSave();
}

function loadChemicalDeliveries() {
  return parseJson(getStored("dogamChemicalDeliveries"), DEFAULT_CHEMICAL_DELIVERIES);
}

function saveChemicalDeliveries() {
  setStored("dogamChemicalDeliveries", JSON.stringify(chemicalDeliveries));
  scheduleServerSave();
}

function loadAppointments() {
  return parseJson(getStored("dogamAppointments"), DEFAULT_APPOINTMENTS);
}

function saveAppointments(options = {}) {
  setStored("dogamAppointments", JSON.stringify(appointments));
  scheduleServerSave(options.immediate ? 0 : 350);
}

function loadRoutines() {
  return parseJson(getStored("dogamRoutines"), DEFAULT_ROUTINES);
}

function saveRoutines(options = {}) {
  setStored("dogamRoutines", JSON.stringify(routines));
  scheduleServerSave(options.immediate ? 0 : 350);
}

function loadCurrentUser() {
  const user = parseJson(getStored("dogamCurrentUser"), null);
  return staff.some((person) => person.name === user?.name && person.type === user?.type) ? user : null;
}

function saveCurrentUser(user) {
  currentUser = user;
  setStored("dogamCurrentUser", JSON.stringify(user));
}

function clearCurrentUser() {
  currentUser = null;
  removeStored("dogamCurrentUser");
}

function saveAll() {
  saveStaff();
  saveCustomers();
  saveInventory();
  saveChemicalDeliveries();
  saveAppointments();
  saveRoutines();
}

function isManager() {
  return currentUser?.type === "manager";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function currentTime() {
  return new Date().toTimeString().slice(0, 5);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    weekday: "short",
  }).format(new Date(`${date}T12:00:00`));
}

function formatDateGroup(date) {
  const label = new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "long",
    weekday: "long",
  }).format(new Date(`${date}T12:00:00`));

  if (date === todayIso()) return `Bugün - ${label}`;
  if (date === addDays(todayIso(), 1)) return `Yarın - ${label}`;
  return label;
}

function formatMoney(value) {
  return `${parseMoneyValue(value).toLocaleString("tr-TR")}₺`;
}

function parseMoneyValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : 0;

  let text = String(value || "").trim().replace(/[₺\s]/g, "");
  if (!text) return 0;

  text = text.replace(/[^\d.,-]/g, "");

  const separatorMatches = [...text.matchAll(/[.,]/g)];
  if (separatorMatches.length) {
    const lastSeparator = separatorMatches[separatorMatches.length - 1];
    const decimals = text.slice(lastSeparator.index + 1).replace(/\D/g, "");
    const whole = text.slice(0, lastSeparator.index).replace(/[^\d-]/g, "");

    if (decimals.length > 0 && decimals.length <= 2 && whole) {
      text = `${whole}.${decimals}`;
    } else {
      text = text.replace(/[.,]/g, "");
    }
  }

  const number = Number(text);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function normalizeMoneyRecords() {
  appointments = appointments.map((item) => ({
    ...item,
    amount: parseMoneyValue(item.amount),
    paidAmount: parseMoneyValue(item.paidAmount),
    debtAmount: parseMoneyValue(item.debtAmount),
  }));

  routines = routines.map((item) => ({
    ...item,
    amount: parseMoneyValue(item.amount),
  }));
}

function isDemoCustomerName(value) {
  const name = String(value || "").toLocaleLowerCase("tr-TR");
  return name === "murat kaya" || name === "ece apartmanı" || name === "ece apartmani";
}

function isDemoAppointment(item) {
  const id = String(item.id || "");
  const customer = String(item.customer || "").toLocaleLowerCase("tr-TR");
  const phone = String(item.phone || "");
  const address = String(item.address || "").toLocaleLowerCase("tr-TR");
  const note = String(item.note || "").toLocaleLowerCase("tr-TR");

  return (
    id === "job-murat" ||
    (customer === "murat kaya" &&
      phone === "0532 111 22 33" &&
      address.includes("cumhuriyet mah") &&
      note.includes("mutfak ve banyo")) ||
    (customer.includes("ece apartman") &&
      phone === "0544 222 33 44" &&
      address.includes("atatürk cad") &&
      note.includes("yönetici kapıda"))
  );
}

function isDemoRoutine(item) {
  const id = String(item.id || "");
  const title = String(item.title || "").toLocaleLowerCase("tr-TR");
  const customer = String(item.customer || "").toLocaleLowerCase("tr-TR");
  const address = String(item.address || "").toLocaleLowerCase("tr-TR");

  return id === "routine-ece" || (title.includes("ece apartman") && customer.includes("ece apartman") && address.includes("atatürk cad"));
}

function isDemoChemicalDelivery(item) {
  const id = String(item.id || "");
  const note = String(item.note || "").toLocaleLowerCase("tr-TR");
  return id === "delivery-ali" || id === "delivery-servet" || note.includes("haftalık saha çıkışı") || note.includes("rutin servisler için verildi");
}

function cleanupDemoData() {
  const before = JSON.stringify({ customers, appointments, routines, chemicalDeliveries });

  appointments = appointments.filter((item) => !isDemoAppointment(item));
  routines = routines.filter((item) => !isDemoRoutine(item));
  chemicalDeliveries = chemicalDeliveries.filter((item) => !isDemoChemicalDelivery(item));
  customers = customers.filter((customer) => {
    if (!isDemoCustomerName(customer.name)) return true;
    return appointments.some((item) => item.customer === customer.name) || routines.some((item) => item.customer === customer.name);
  });

  return before !== JSON.stringify({ customers, appointments, routines, chemicalDeliveries });
}

function addDays(date, days) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + Number(days || 30));
  return next.toISOString().slice(0, 10);
}

function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function cleanPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("90")) return digits;
  if (digits.startsWith("0")) return `90${digits.slice(1)}`;
  if (digits.startsWith("5")) return `90${digits}`;
  return digits;
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .toLocaleLowerCase("tr-TR")
    .trim();
}

function formatPhoneForForm(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("90")) digits = `0${digits.slice(2)}`;
  if (digits.startsWith("5")) digits = `0${digits}`;
  if (digits.length !== 11) return String(value || "").trim();
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9)}`;
}

function whatsappUrl(item) {
  const phone = cleanPhone(item.phone);
  const text = `Merhaba, Doğam Böcek İlaçlama randevunuz ${formatDate(item.date || todayIso())} ${item.time || ""} için planlanmıştır.`;
  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : "";
}

function personnel() {
  return staff.filter((person) => person.type === "personnel");
}

function assignableStaff() {
  return staff.filter((person) => person.type === "personnel" || person.type === "manager");
}

function validAssigneeName(value) {
  const name = String(value || "").trim();
  return assignableStaff().some((person) => person.name === name) ? name : "";
}

function ensureCustomer(name, phone, address, note = "") {
  const normalized = name.trim().toLocaleLowerCase("tr-TR");
  let customer = customers.find((item) => item.name.toLocaleLowerCase("tr-TR") === normalized);

  if (!customer) {
    customer = { id: createId(), name: name.trim(), phone: phone || "", address: address || "", note };
    customers.push(customer);
  } else {
    if (phone) customer.phone = phone;
    if (address) customer.address = address;
    if (note && !customer.note) customer.note = note;
  }

  saveCustomers();
  return customer;
}

function createAppointmentRecord(input) {
  const assignedStaff = validAssigneeName(input.staff);
  const customer = String(input.customer || "").trim();
  const address = String(input.address || "").trim();
  if (!customer || !address || !assignedStaff) return false;

  const amount = parseMoneyValue(input.amount);
  const createdAt = input.createdAt || new Date().toISOString();

  ensureCustomer(customer, input.phone || "", address, input.note || "");
  appointments.push({
    id: createId(),
    customer,
    phone: String(input.phone || "").trim(),
    address,
    date: input.date || todayIso(),
    time: input.time || currentTime(),
    service: input.service || "Haşere ilaçlama",
    staff: assignedStaff,
    note: String(input.note || "").trim(),
    amount,
    status: "planned",
    paymentMethod: "",
    paidAmount: 0,
    debtAmount: amount,
    photos: [],
    stockUsage: [],
    createdAt,
    updatedAt: createdAt,
    createdBy: currentUser.name,
  });
  saveAppointments({ immediate: true });
  return true;
}

function messageLines(text) {
  return String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function labeledValue(lines, labels) {
  const keys = labels.map(normalizeSearchText);

  for (const line of lines) {
    const match = line.match(/^([^:=-]{2,28})\s*[:=-]\s*(.+)$/);
    if (!match) continue;

    const key = normalizeSearchText(match[1]);
    if (keys.some((label) => key === label || key.includes(label))) return match[2].trim();
  }

  return "";
}

function isoDateFromParts(year, month, day) {
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return date.toISOString().slice(0, 10);
}

function parseDateFromMessage(text, lines) {
  const explicit = labeledValue(lines, ["tarih", "gün", "gun", "randevu tarihi"]);
  const source = explicit || text;
  const normalized = normalizeSearchText(source);

  if (normalized.includes("bugun")) return todayIso();
  if (normalized.includes("yarin")) return addDays(todayIso(), 1);

  const numeric = source.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
  if (numeric) {
    const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : new Date().getFullYear();
    return isoDateFromParts(year, Number(numeric[2]), Number(numeric[1]));
  }

  const months = {
    ocak: 1,
    subat: 2,
    mart: 3,
    nisan: 4,
    mayis: 5,
    haziran: 6,
    temmuz: 7,
    agustos: 8,
    eylul: 9,
    ekim: 10,
    kasim: 11,
    aralik: 12,
  };
  const monthMatch = normalized.match(/\b(\d{1,2})\s*(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\b/);
  if (monthMatch) return isoDateFromParts(new Date().getFullYear(), months[monthMatch[2]], Number(monthMatch[1]));

  const dayMatch = normalized.match(/\bayin\s*(\d{1,2})\b/);
  if (dayMatch) {
    const now = new Date();
    return isoDateFromParts(now.getFullYear(), now.getMonth() + 1, Number(dayMatch[1]));
  }

  return "";
}

function parseTimeFromMessage(text, lines) {
  const explicit = labeledValue(lines, ["saat", "randevu saati"]);
  const explicitMatch = explicit.match(/\b([01]?\d|2[0-3])(?:[:.](\d{2}))?\b/);
  if (explicitMatch) return `${explicitMatch[1].padStart(2, "0")}:${explicitMatch[2] || "00"}`;

  const withLabel = normalizeSearchText(text).match(/\bsaat\s*([01]?\d|2[0-3])(?:[:.](\d{2}))?\b/);
  if (withLabel) return `${withLabel[1].padStart(2, "0")}:${withLabel[2] || "00"}`;

  const general = text.match(/\b([01]?\d|2[0-3])[:.](\d{2})\b/);
  return general ? `${general[1].padStart(2, "0")}:${general[2]}` : "";
}

function parsePhoneFromMessage(text, lines) {
  const explicit = labeledValue(lines, ["telefon", "tel", "gsm"]);
  const source = explicit || text;
  const match = source.match(/(?:\+?90\s*)?0?5[\d\s().-]{8,16}/);
  return match ? formatPhoneForForm(match[0]) : "";
}

function parseAmountFromMessage(text, lines) {
  const explicit = labeledValue(lines, ["tutar", "fiyat", "ücret", "ucret", "bedel"]);
  if (explicit) return parseMoneyValue(explicit);

  const money = text.match(/(?:tutar|fiyat|ücret|ucret|bedel|₺|tl)\s*[:=-]?\s*([0-9][0-9\s.,]*)/i) || text.match(/([0-9][0-9\s.,]*)\s*(?:₺|tl)\b/i);
  return money ? parseMoneyValue(money[1]) : 0;
}

function parseServiceFromMessage(text) {
  const normalized = normalizeSearchText(text);
  if (normalized.includes("fare")) return "Fare mücadelesi";
  if (normalized.includes("periyodik") || normalized.includes("rutin")) return "Periyodik servis";
  if (normalized.includes("kontrol")) return "Genel kontrol";
  return "Haşere ilaçlama";
}

function staffNameFromMessage(text, lines) {
  const explicit = labeledValue(lines, ["personel", "ekip", "usta", "atanan"]);
  const source = normalizeSearchText(`${explicit} ${text}`);

  const found = assignableStaff().find((person) => {
    const name = normalizeSearchText(person.name);
    const parts = name.split(/\s+/).filter(Boolean);
    if (name && source.includes(name)) return true;
    return parts.some((part) => {
      if (part.length >= 4) return source.includes(part);
      return new RegExp(`\\b${part}\\b`).test(source);
    });
  });

  return found?.name || validAssigneeName(staffSelectValue.value) || assignableStaff()[0]?.name || "";
}

function looksLikeAddress(line) {
  const normalized = normalizeSearchText(line);
  return /\b(mah|mahalle|sok|sokak|cad|cadde|bulvar|no|apt|apartman|site|blok|kat|daire|adres|konum)\b/.test(normalized);
}

function parseAddressFromMessage(text, lines) {
  const explicit = labeledValue(lines, ["adres", "konum", "lokasyon"]);
  if (explicit) return explicit;
  return lines.filter(looksLikeAddress).join(" ").trim();
}

function parseCustomerFromMessage(text, lines) {
  const explicit = labeledValue(lines, ["müşteri", "musteri", "müşteri adı", "musteri adi", "ad soyad", "isim"]);
  if (explicit) return explicit.replace(parsePhoneFromMessage(text, lines), "").trim();

  return (
    lines.find((line) => {
      const normalized = normalizeSearchText(line);
      if (!normalized || normalized.includes("merhaba")) return false;
      if (/^([^:=-]{2,28})\s*[:=-]/.test(line)) return false;
      if (looksLikeAddress(line)) return false;
      if (parsePhoneFromMessage(line, [line])) return false;
      if (parseDateFromMessage(line, [line])) return false;
      if (parseAmountFromMessage(line, [line])) return false;
      return normalized.length >= 3 && normalized.length <= 70;
    }) || ""
  ).trim();
}

function parseWhatsappJobMessage(text) {
  const lines = messageLines(text);
  const customer = parseCustomerFromMessage(text, lines);
  const phone = parsePhoneFromMessage(text, lines);
  const address = parseAddressFromMessage(text, lines);
  const date = parseDateFromMessage(text, lines);
  const time = parseTimeFromMessage(text, lines);
  const amount = parseAmountFromMessage(text, lines);
  const staffName = staffNameFromMessage(text, lines);
  const service = parseServiceFromMessage(text);
  const noteLines = lines.filter((line) => {
    if (/^([^:=-]{2,28})\s*[:=-]/.test(line)) return false;
    if ([customer, phone, address].some((value) => value && line.includes(value))) return false;
    if (looksLikeAddress(line) || parsePhoneFromMessage(line, [line]) || parseDateFromMessage(line, [line]) || parseAmountFromMessage(line, [line])) return false;
    return true;
  });

  return {
    customer,
    phone,
    address,
    date: date || todayIso(),
    time: time || currentTime(),
    service,
    staff: staffName,
    amount,
    note: `WhatsApp'tan alındı. ${noteLines.join(" / ")}`.trim(),
  };
}

function fillAppointmentFormFromWhatsapp(parsed) {
  const fields = form.elements;
  fields.customer.value = parsed.customer || fields.customer.value;
  fields.phone.value = parsed.phone || fields.phone.value;
  fields.address.value = parsed.address || fields.address.value;
  fields.date.value = parsed.date || todayIso();
  fields.time.value = parsed.time || currentTime();
  fields.service.value = parsed.service || "Haşere ilaçlama";
  fields.amount.value = parsed.amount || "";
  fields.note.value = parsed.note || fields.note.value;

  if (validAssigneeName(parsed.staff)) {
    staffSelectValue.value = parsed.staff;
    setButtonByValue(staffAssignButtons, parsed.staff);
  }
}

function importWhatsappMessage({ direct = false } = {}) {
  const text = whatsappImportText.value.trim();
  if (!text) {
    whatsappImportStatus.textContent = "Önce WhatsApp mesajını yapıştırın.";
    return;
  }

  const parsed = parseWhatsappJobMessage(text);
  fillAppointmentFormFromWhatsapp(parsed);

  if (!direct) {
    whatsappImportStatus.textContent = "Bilgiler forma aktarıldı. Kontrol edip İşi Kaydet'e basabilirsiniz.";
    document.querySelector('[data-view="new"]').click();
    return;
  }

  const missing = [];
  if (!parsed.customer) missing.push("müşteri");
  if (!parsed.address) missing.push("adres");
  if (!validAssigneeName(parsed.staff)) missing.push("personel");

  if (missing.length) {
    whatsappImportStatus.textContent = `Eksik bilgi var: ${missing.join(", ")}. Formu tamamlayıp kaydedin.`;
    document.querySelector('[data-view="new"]').click();
    return;
  }

  createAppointmentRecord(parsed);
  whatsappImportText.value = "";
  whatsappImportStatus.textContent = "WhatsApp mesajı iş olarak kaydedildi.";
  form.reset();
  setDefaultChoices();
  document.querySelector('[data-view="appointments"]').click();
  render();
}

function renderOptions() {
  loginStaffButtons.replaceChildren();
  staffFilter.innerHTML = '<option value="all">Tümü</option>';
  staffFilterButtons.replaceChildren();
  staffAssignButtons.replaceChildren();
  routineStaffButtons.replaceChildren();
  chemicalStaffButtons.replaceChildren();
  editStaffSelect.replaceChildren();

  staff.forEach((person) => {
    const button = createChoiceButton(person.name, person.role, person.name);
    button.addEventListener("click", () => {
      setChoice(loginStaffButtons, button);
      loginStaffValue.value = person.name;
      loginError.textContent = "";
    });
    loginStaffButtons.append(button);
  });

  const allButton = createChoiceButton("Tümü", "Yönetici görünümü", "all");
  allButton.addEventListener("click", () => {
    setChoice(staffFilterButtons, allButton);
    staffFilter.value = "all";
    render();
  });
  staffFilterButtons.append(allButton);

  assignableStaff().forEach((person) => {
    staffFilter.append(new Option(person.name, person.name));
    editStaffSelect.append(new Option(person.name, person.name));

    const filterButton = createChoiceButton(person.name, "Atanan işler", person.name);
    filterButton.addEventListener("click", () => {
      setChoice(staffFilterButtons, filterButton);
      staffFilter.value = person.name;
      render();
    });
    staffFilterButtons.append(filterButton);

    const assignButton = createChoiceButton(person.name, "İşi yönlendir", person.name);
    assignButton.addEventListener("click", () => {
      setChoice(staffAssignButtons, assignButton);
      staffSelectValue.value = person.name;
    });
    staffAssignButtons.append(assignButton);

    const routineButton = createChoiceButton(person.name, "Rutin sorumlusu", person.name);
    routineButton.addEventListener("click", () => {
      setChoice(routineStaffButtons, routineButton);
      routineStaffValue.value = person.name;
    });
    routineStaffButtons.append(routineButton);

    const chemicalButton = createChoiceButton(person.name, "İlaç ver", person.name);
    chemicalButton.addEventListener("click", () => {
      setChoice(chemicalStaffButtons, chemicalButton);
      chemicalStaffValue.value = person.name;
    });
    chemicalStaffButtons.append(chemicalButton);
  });

  setDefaultChoices();
}

function createChoiceButton(title, subtitle, value) {
  const button = document.createElement("button");
  button.className = "choice-button";
  button.type = "button";
  button.dataset.value = value;
  button.innerHTML = `<strong>${title}</strong><small>${subtitle}</small>`;
  return button;
}

function setChoice(group, selectedButton) {
  group.querySelectorAll(".choice-button").forEach((button) => button.classList.remove("selected"));
  selectedButton.classList.add("selected");
}

function setButtonByValue(group, value) {
  const button = [...group.querySelectorAll(".choice-button")].find((item) => item.dataset.value === value);
  if (button) setChoice(group, button);
}

function setDefaultChoices() {
  const manager = staff.find((person) => person.type === "manager");
  const firstPersonnel = assignableStaff()[0];
  const fallbackPersonnel = firstPersonnel?.name || "";

  const loginValue = staff.some((person) => person.name === loginStaffValue.value) ? loginStaffValue.value : manager?.name;
  if (loginValue) {
    loginStaffValue.value = loginValue;
    setButtonByValue(loginStaffButtons, loginValue);
  }

  if (fallbackPersonnel) {
    const assignedStaff = validAssigneeName(staffSelectValue.value) || fallbackPersonnel;
    const routineStaff = validAssigneeName(routineStaffValue.value) || fallbackPersonnel;
    const chemicalStaff = validAssigneeName(chemicalStaffValue.value) || fallbackPersonnel;

    staffSelectValue.value = assignedStaff;
    routineStaffValue.value = routineStaff;
    chemicalStaffValue.value = chemicalStaff;
    setButtonByValue(staffAssignButtons, assignedStaff);
    setButtonByValue(routineStaffButtons, routineStaff);
    setButtonByValue(chemicalStaffButtons, chemicalStaff);
  }

  staffFilter.value = staffFilter.value === "all" || validAssigneeName(staffFilter.value) ? staffFilter.value : "all";
  setButtonByValue(staffFilterButtons, staffFilter.value);
}

function applyPermissions() {
  document.querySelectorAll(".manager-only").forEach((item) => {
    item.classList.toggle("is-hidden", !isManager());
  });

  document.querySelector(".tabs").classList.toggle("personnel-tabs", !isManager());
  staffFilter.disabled = !isManager();

  if (isManager()) {
    staffFilter.value = staffFilter.value || "all";
    setButtonByValue(staffFilterButtons, staffFilter.value);
  } else {
    staffFilter.value = currentUser.name;
    setButtonByValue(staffFilterButtons, currentUser.name);
    document.querySelector('[data-view="appointments"]').click();
  }
}

function renderAuthState() {
  if (currentUser) {
    loginScreen.classList.add("is-hidden");
    appShell.classList.remove("is-hidden");
    signedUser.textContent = `${currentUser.name} - ${currentUser.role}`;
    applyPermissions();
    render();
    maybeNotifyDueItems();
    return;
  }

  appShell.classList.add("is-hidden");
  loginScreen.classList.remove("is-hidden");
}

function activeAppointments() {
  return appointments.filter((item) => !item.deletedAt);
}

function visibleAppointments() {
  if (!currentUser) return [];
  const jobs = activeAppointments();
  if (!isManager()) return jobs.filter((item) => item.staff === currentUser.name);
  return staffFilter.value === "all" ? jobs : jobs.filter((item) => item.staff === staffFilter.value);
}

function visibleRoutines() {
  if (!currentUser) return [];
  if (!isManager()) return routines.filter((item) => item.staff === currentUser.name);
  return routines;
}

function renderAppointments() {
  const selectedStatus = statusFilter.value;
  const filtered = visibleAppointments()
    .filter((item) => selectedStatus === "all" || item.status === selectedStatus)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

  listEl.replaceChildren();

  if (!filtered.length) {
    listEl.append(emptyState("Bu filtreye uygun iş yok."));
    return;
  }

  const dateCounts = filtered.reduce((counts, item) => {
    counts.set(item.date, (counts.get(item.date) || 0) + 1);
    return counts;
  }, new Map());
  let activeDate = "";

  filtered.forEach((appointment) => {
    if (appointment.date !== activeDate) {
      activeDate = appointment.date;
      listEl.append(createDateDivider(activeDate, dateCounts.get(activeDate)));
    }

    const card = template.content.firstElementChild.cloneNode(true);
    card.querySelector("h2").textContent = appointment.customer;
    renderJobMeta(card.querySelector(".meta"), [
      { label: "Tarih", value: formatDate(appointment.date) },
      { label: "Saat", value: appointment.time || "-" },
      { label: "İşlem", value: appointment.service },
      { label: "Personel", value: appointment.staff },
    ]);
    card.querySelector(".note").textContent = appointment.note || "Not girilmedi.";

    const address = card.querySelector(".map-link");
    address.href = mapsUrl(appointment.address);
    address.textContent = appointment.address;

    const phoneLink = card.querySelector(".phone-link");
    phoneLink.textContent = appointment.phone || "Telefon yok";
    phoneLink.href = appointment.phone ? `tel:${appointment.phone}` : "#";

    const whatsapp = card.querySelector(".whatsapp-link");
    const whatsappHref = whatsappUrl(appointment);
    whatsapp.href = whatsappHref || "#";
    whatsapp.classList.toggle("disabled-link", !whatsappHref);

    const pill = card.querySelector(".status-pill");
    pill.textContent = statusLabels[appointment.status];
    pill.classList.add(`status-${appointment.status}`);

    const editButton = card.querySelector("[data-edit-appointment]");
    editButton.classList.toggle("is-hidden", !isManager());
    editButton.addEventListener("click", () => openEditJob(appointment.id));

    const deleteButton = card.querySelector("[data-delete-appointment]");
    deleteButton.classList.toggle("is-hidden", !isManager());
    deleteButton.addEventListener("click", () => deleteAppointment(appointment.id));

    card.querySelector(".payment-line").textContent = paymentSummary(appointment);
    card.querySelector(".location-line").innerHTML = locationSummary(appointment);
    card.querySelector(".amount-input").value = appointment.amount || 0;

    renderMediaGallery(card.querySelector(".media-gallery"), appointment);
    renderStockSelect(card.querySelector(".stock-select"));
    setupSignaturePad(card.querySelector(".signature-pad"), (signature) => {
      appointment.signature = signature;
      appointment.updatedAt = new Date().toISOString();
      saveAppointments({ immediate: true });
      render();
    });

    card.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        appointment.status = button.dataset.action;
        appointment.updatedAt = new Date().toISOString();
        saveAppointments({ immediate: true });
        render();
      });
    });

    card.querySelectorAll("[data-payment]").forEach((button) => {
      button.addEventListener("click", () => {
        const amount = parseMoneyValue(card.querySelector(".amount-input").value || appointment.amount);
        completeAppointment(appointment.id, button.dataset.payment, amount);
      });
    });

    card.querySelector("[data-location]").addEventListener("click", () => captureLocation(appointment.id));
    card.querySelector(".photo-input").addEventListener("change", (event) => addPhoto(appointment.id, event.target.files?.[0]));
    card.querySelector(".stock-use-button").addEventListener("click", () => {
      const stockId = card.querySelector(".stock-select").value;
      const quantity = Number(card.querySelector(".stock-qty").value || 0);
      useStock(appointment.id, stockId, quantity);
    });

    listEl.append(card);
  });
}

function paymentSummary(item) {
  const amount = formatMoney(item.amount || 0);
  if (!item.paymentMethod) return `Tutar: ${amount} - Tahsilat bekliyor`;
  if (item.paymentMethod === "debt") return `Tutar: ${amount} - Borç: ${formatMoney(item.debtAmount || item.amount || 0)}`;
  return `Tutar: ${amount} - Ödeme: ${paymentLabels[item.paymentMethod]} - ${item.completedBy || ""}`;
}

function renderJobMeta(container, items) {
  container.replaceChildren();
  items.forEach((item) => {
    const chip = document.createElement("span");
    chip.className = "meta-chip";

    const label = document.createElement("small");
    label.textContent = item.label;

    const value = document.createElement("strong");
    value.textContent = item.value || "-";

    chip.append(label, value);
    container.append(chip);
  });
}

function locationSummary(item) {
  if (!item.location) return "Konum doğrulanmadı";
  const url = mapsUrl(`${item.location.lat},${item.location.lng}`);
  return `Konum doğrulandı - <a href="${url}" target="_blank" rel="noopener">Haritada aç</a>`;
}

function renderMediaGallery(container, item) {
  container.replaceChildren();

  (item.photos || []).forEach((photo) => {
    const img = document.createElement("img");
    img.src = photo.dataUrl;
    img.alt = "İş fotoğrafı";
    container.append(img);
  });

  if (item.signature) {
    const img = document.createElement("img");
    img.src = item.signature;
    img.alt = "Müşteri imzası";
    img.className = "signature-image";
    container.append(img);
  }

  (item.stockUsage || []).forEach((usage) => {
    const line = document.createElement("p");
    line.className = "usage-chip";
    line.textContent = `${usage.name}: ${usage.quantity} ${usage.unit}`;
    container.append(line);
  });
}

function renderStockSelect(select) {
  select.replaceChildren(new Option("Stok seç", ""));
  inventory.forEach((item) => {
    select.append(new Option(`${item.name} (${item.quantity} ${item.unit})`, item.id));
  });
}

function setupSignaturePad(canvas, onSave) {
  const context = canvas.getContext("2d");
  context.lineWidth = 2;
  context.lineCap = "round";
  context.strokeStyle = "#111412";

  let drawing = false;

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    const source = event.touches?.[0] || event;
    return {
      x: ((source.clientX - rect.left) / rect.width) * canvas.width,
      y: ((source.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(event) {
    drawing = true;
    const current = point(event);
    context.beginPath();
    context.moveTo(current.x, current.y);
    event.preventDefault();
  }

  function move(event) {
    if (!drawing) return;
    const current = point(event);
    context.lineTo(current.x, current.y);
    context.stroke();
    event.preventDefault();
  }

  function stop() {
    drawing = false;
  }

  canvas.addEventListener("pointerdown", start);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointerleave", stop);
  canvas.addEventListener("touchstart", start, { passive: false });
  canvas.addEventListener("touchmove", move, { passive: false });
  canvas.addEventListener("touchend", stop);

  const wrap = canvas.closest(".signature-wrap");
  wrap.querySelector(".signature-clear").addEventListener("click", () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
  });
  wrap.querySelector(".signature-save").addEventListener("click", () => onSave(canvas.toDataURL("image/png")));
}

function openEditJob(id) {
  if (!isManager()) return;
  const appointment = appointments.find((item) => item.id === id);
  if (!appointment) return;

  renderOptions();
  const fields = editJobForm.elements;
  fields.id.value = appointment.id;
  fields.customer.value = appointment.customer || "";
  fields.phone.value = appointment.phone || "";
  fields.address.value = appointment.address || "";
  fields.date.value = appointment.date || todayIso();
  fields.time.value = appointment.time || currentTime();
  fields.service.value = appointment.service || "Haşere ilaçlama";
  fields.amount.value = parseMoneyValue(appointment.amount);
  fields.staff.value = validAssigneeName(appointment.staff) || assignableStaff()[0]?.name || "";
  fields.status.value = appointment.status || "planned";
  fields.note.value = appointment.note || "";

  if (editJobDialog.showModal) {
    editJobDialog.showModal();
  } else {
    editJobDialog.setAttribute("open", "");
  }
}

function closeEditJob() {
  editJobForm.reset();
  if (editJobDialog.open) editJobDialog.close();
  editJobDialog.removeAttribute("open");
}

function updateAppointmentFromEdit() {
  if (!isManager()) return;

  const data = new FormData(editJobForm);
  const appointment = appointments.find((item) => item.id === data.get("id"));
  const assignedStaff = validAssigneeName(data.get("staff"));
  if (!appointment || !assignedStaff) return;

  const previousStaff = appointment.staff;
  const amount = parseMoneyValue(data.get("amount"));

  appointment.customer = data.get("customer").trim();
  appointment.phone = data.get("phone").trim();
  appointment.address = data.get("address").trim();
  appointment.date = data.get("date");
  appointment.time = data.get("time");
  appointment.service = data.get("service");
  appointment.staff = assignedStaff;
  appointment.note = data.get("note").trim();
  appointment.amount = amount;
  appointment.status = data.get("status") || "planned";
  appointment.updatedAt = new Date().toISOString();

  if (appointment.paymentMethod === "cash" || appointment.paymentMethod === "iban") {
    appointment.paidAmount = amount;
    appointment.debtAmount = 0;
  } else {
    appointment.paidAmount = 0;
    appointment.debtAmount = amount;
  }

  if (previousStaff !== assignedStaff) {
    appointment.reassignedAt = new Date().toISOString();
  }

  ensureCustomer(appointment.customer, appointment.phone, appointment.address, appointment.note);
  saveAppointments({ immediate: true });
  closeEditJob();
  render();
}

function completeAppointment(id, paymentMethod, amount) {
  const appointment = appointments.find((item) => item.id === id);
  if (!appointment) return;
  const cleanAmount = parseMoneyValue(amount);

  appointment.status = "done";
  appointment.amount = cleanAmount;
  appointment.paymentMethod = paymentMethod;
  appointment.paidAmount = paymentMethod === "debt" ? 0 : cleanAmount;
  appointment.debtAmount = paymentMethod === "debt" ? cleanAmount : 0;
  appointment.completedBy = currentUser.name;
  appointment.completedAt = new Date().toISOString();
  appointment.updatedAt = appointment.completedAt;
  saveAppointments({ immediate: true });
  render();
}

function deleteAppointment(id) {
  if (!isManager()) return;
  const appointment = appointments.find((item) => item.id === id);
  if (!appointment) return;

  const message = `${appointment.customer} işini silmek istiyor musunuz?`;
  if (!confirm(message)) return;

  appointment.status = "deleted";
  appointment.deletedAt = new Date().toISOString();
  appointment.updatedAt = appointment.deletedAt;
  appointment.deletedBy = currentUser.name;
  saveAppointments({ immediate: true });
  render();
}

function captureLocation(id) {
  const appointment = appointments.find((item) => item.id === id);
  if (!appointment || !navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(
    (position) => {
      appointment.location = {
        lat: position.coords.latitude.toFixed(6),
        lng: position.coords.longitude.toFixed(6),
        at: new Date().toISOString(),
      };
      appointment.updatedAt = new Date().toISOString();
      saveAppointments({ immediate: true });
      render();
    },
    () => {
      appointment.locationError = "Konum alınamadı";
      appointment.updatedAt = new Date().toISOString();
      saveAppointments({ immediate: true });
      render();
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

function addPhoto(id, file) {
  if (!file) return;
  const appointment = appointments.find((item) => item.id === id);
  if (!appointment) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const image = new Image();
    image.addEventListener("load", () => {
      const maxSize = 900;
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      savePhoto(appointment, canvas.toDataURL("image/jpeg", 0.76));
    });
    image.addEventListener("error", () => savePhoto(appointment, reader.result));
    image.src = reader.result;
  });
  reader.readAsDataURL(file);
}

function savePhoto(appointment, dataUrl) {
  appointment.photos = appointment.photos || [];
  appointment.photos.push({ id: createId(), dataUrl, at: new Date().toISOString() });
  appointment.updatedAt = new Date().toISOString();
  saveAppointments({ immediate: true });
  render();
}

function useStock(appointmentId, stockId, quantity) {
  if (!stockId || quantity <= 0) return;
  const item = inventory.find((stock) => stock.id === stockId);
  const appointment = appointments.find((job) => job.id === appointmentId);
  if (!item || !appointment) return;

  const used = Math.min(quantity, item.quantity);
  item.quantity = Math.max(0, item.quantity - used);
  appointment.stockUsage = appointment.stockUsage || [];
  appointment.stockUsage.push({ id: item.id, name: item.name, quantity: used, unit: item.unit });
  appointment.updatedAt = new Date().toISOString();
  saveInventory();
  saveAppointments({ immediate: true });
  render();
}

function renderRoutines() {
  const filtered = visibleRoutines().sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  routineList.replaceChildren();

  if (!filtered.length) {
    routineList.append(emptyState("Kayıtlı rutin iş yok."));
    return;
  }

  filtered.forEach((routine) => {
    const card = routineTemplate.content.firstElementChild.cloneNode(true);
    const due = routine.nextDate <= todayIso();
    card.classList.toggle("due", due);
    card.querySelector("h2").textContent = routine.title;
    renderJobMeta(card.querySelector(".meta"), [
      { label: "Sonraki", value: formatDate(routine.nextDate) },
      { label: "İşlem", value: routine.service },
      { label: "Personel", value: routine.staff },
    ]);
    card.querySelector(".note").textContent = routine.note || "Not girilmedi.";
    card.querySelector(".routine-cycle").textContent = `${routine.frequencyDays} günde bir - ${formatMoney(routine.amount || 0)}`;

    const address = card.querySelector(".map-link");
    address.href = mapsUrl(routine.address);
    address.textContent = routine.address;

    const pill = card.querySelector(".status-pill");
    pill.textContent = due ? "Günü Geldi" : "Planlı";
    pill.classList.add(due ? "status-active" : "status-planned");

    const payment = card.querySelector(".payment-line");
    payment.textContent = routine.lastPaymentMethod
      ? `Son ödeme: ${paymentLabels[routine.lastPaymentMethod]} - ${routine.completedBy || routine.staff}`
      : "Henüz tamamlanmadı";

    card.querySelectorAll("[data-routine-payment]").forEach((button) => {
      button.addEventListener("click", () => completeRoutine(routine.id, button.dataset.routinePayment));
    });

    routineList.append(card);
  });
}

function completeRoutine(id, paymentMethod) {
  const routine = routines.find((item) => item.id === id);
  if (!routine) return;

  const completedAt = new Date().toISOString();
  routine.lastCompleted = completedAt;
  routine.lastPaymentMethod = paymentMethod;
  routine.completedBy = currentUser.name;
  routine.nextDate = addDays(todayIso(), routine.frequencyDays);
  routine.updatedAt = completedAt;

  appointments.push({
    id: createId(),
    customer: routine.customer,
    phone: customers.find((customer) => customer.name === routine.customer)?.phone || "",
    address: routine.address,
    date: todayIso(),
    time: currentTime(),
    service: routine.service,
    staff: routine.staff,
    note: `Rutin iş tamamlandı. ${routine.note || ""}`.trim(),
    amount: parseMoneyValue(routine.amount),
    status: "done",
    paymentMethod,
    paidAmount: paymentMethod === "debt" ? 0 : parseMoneyValue(routine.amount),
    debtAmount: paymentMethod === "debt" ? parseMoneyValue(routine.amount) : 0,
    completedBy: currentUser.name,
    completedAt,
    updatedAt: completedAt,
    createdAt: completedAt,
    photos: [],
    stockUsage: [],
  });

  ensureCustomer(routine.customer, "", routine.address, routine.note);
  saveRoutines({ immediate: true });
  saveAppointments({ immediate: true });
  render();
}

function renderCustomers() {
  customerList.replaceChildren();

  customers.forEach((customer) => {
    const history = activeAppointments().filter((item) => item.customer === customer.name);
    const debt = history.reduce((total, item) => total + parseMoneyValue(item.debtAmount), 0);
    const paid = history.reduce((total, item) => total + parseMoneyValue(item.paidAmount), 0);
    const card = document.createElement("article");
    card.className = "appointment-card";
    card.innerHTML = `
      <div class="card-head">
        <div>
          <h2>${customer.name}</h2>
          <p class="meta">${history.length} iş - Tahsilat ${formatMoney(paid)} - Borç ${formatMoney(debt)}</p>
        </div>
      </div>
      <a class="address map-link" href="${mapsUrl(customer.address)}" target="_blank" rel="noopener">${customer.address || "Adres yok"}</a>
      <div class="quick-links">
        <a class="phone-link" href="${customer.phone ? `tel:${customer.phone}` : "#"}">${customer.phone || "Telefon yok"}</a>
        <a class="whatsapp-link" href="${customer.phone ? `https://wa.me/${cleanPhone(customer.phone)}` : "#"}" target="_blank" rel="noopener">WhatsApp</a>
      </div>
      <p class="note">${customer.note || "Not yok"}</p>
      <p class="payment-line">${history.slice(-3).map((item) => `${formatDate(item.date)} ${item.service}`).join(" / ") || "Geçmiş iş yok"}</p>
    `;
    customerList.append(card);
  });
}

function renderReports() {
  const jobs = activeAppointments();
  const totalJobs = jobs.length;
  const doneJobs = jobs.filter((item) => item.status === "done").length;
  const cash = jobs.filter((item) => item.paymentMethod === "cash").reduce((sum, item) => sum + parseMoneyValue(item.paidAmount), 0);
  const iban = jobs.filter((item) => item.paymentMethod === "iban").reduce((sum, item) => sum + parseMoneyValue(item.paidAmount), 0);
  const debt = jobs.reduce((sum, item) => sum + parseMoneyValue(item.debtAmount), 0);
  const dueRoutineCount = routines.filter((item) => item.nextDate <= todayIso()).length;
  const totalLiquid = chemicalDeliveries.reduce((sum, item) => sum + Number(item.liquid || 0), 0);
  const totalGel = chemicalDeliveries.reduce((sum, item) => sum + Number(item.gel || 0), 0);

  const staffRows = assignableStaff()
    .map((person) => {
      const staffJobs = jobs.filter((item) => item.staff === person.name);
      const completed = staffJobs.filter((item) => item.status === "done").length;
      const supplies = staffChemicalTotals(person.name);
      return `<p><strong>${person.name}</strong> ${completed}/${staffJobs.length} iş - ${formatChemicalTotals(supplies)}</p>`;
    })
    .join("");

  reportGrid.innerHTML = `
    ${reportCard("Toplam İş", totalJobs)}
    ${reportCard("Tamamlanan", doneJobs)}
    ${reportCard("Nakit", formatMoney(cash))}
    ${reportCard("IBAN", formatMoney(iban))}
    ${reportCard("Borç", formatMoney(debt))}
    ${reportCard("Günü Gelen Rutin", dueRoutineCount)}
    ${reportCard("Verilen Sıvı", `${totalLiquid.toLocaleString("tr-TR")} L`)}
    ${reportCard("Verilen Jel", `${totalGel.toLocaleString("tr-TR")} gr`)}
    <article class="report-card wide"><h2>Personel Performansı</h2>${staffRows || "<p>Personel yok</p>"}</article>
  `;
}

function reportCard(title, value) {
  return `<article class="report-card"><span>${value}</span><p>${title}</p></article>`;
}

function renderStock() {
  stockList.replaceChildren();
  chemicalList.replaceChildren();

  const sortedDeliveries = [...chemicalDeliveries].sort((a, b) => b.date.localeCompare(a.date));

  if (!sortedDeliveries.length) {
    chemicalList.append(emptyState("Personele verilmiş ilaç kaydı yok."));
  }

  sortedDeliveries.forEach((delivery) => {
    const card = document.createElement("article");
    card.className = "staff-card supply-card";
    card.innerHTML = `
      <div>
        <strong>${delivery.staff}</strong>
        <span>${new Date(delivery.date).toLocaleString("tr-TR")} - ${delivery.note || "Not yok"}</span>
        <small>Sıvı: ${Number(delivery.liquid || 0).toLocaleString("tr-TR")} L / Jel: ${Number(delivery.gel || 0).toLocaleString("tr-TR")} gr</small>
      </div>
    `;
    chemicalList.append(card);
  });

  inventory.forEach((item) => {
    const card = document.createElement("article");
    card.className = "staff-card";
    card.innerHTML = `
      <div>
        <strong>${item.name}</strong>
        <span>${item.unit}</span>
      </div>
      <b>${item.quantity}</b>
    `;
    stockList.append(card);
  });
}

function renderStaff() {
  const staffList = document.querySelector("#staffList");
  staffList.replaceChildren();

  assignableStaff().forEach((person) => {
    const openJobs = activeAppointments().filter((item) => item.staff === person.name && item.status !== "done").length;
    const routineJobs = routines.filter((item) => item.staff === person.name).length;
    const supplies = staffChemicalTotals(person.name);
    const card = document.createElement("article");
    card.className = "staff-card";
    card.innerHTML = `
      <div>
        <strong>${person.name}</strong>
        <span>${person.role} - ${routineJobs} rutin</span>
        <small>${formatChemicalTotals(supplies)}</small>
      </div>
      <b>${openJobs}</b>
    `;
    staffList.append(card);
  });
}

function staffChemicalTotals(staffName) {
  return chemicalDeliveries
    .filter((item) => item.staff === staffName)
    .reduce(
      (totals, item) => {
        totals.liquid += Number(item.liquid || 0);
        totals.gel += Number(item.gel || 0);
        return totals;
      },
      { liquid: 0, gel: 0 },
    );
}

function formatChemicalTotals(totals) {
  return `Verilen ilaç: ${totals.liquid.toLocaleString("tr-TR")} L sıvı / ${totals.gel.toLocaleString("tr-TR")} gr jel`;
}

function renderSummary() {
  const visible = visibleAppointments();
  const revenue = visible.reduce((sum, item) => sum + parseMoneyValue(item.paidAmount), 0);
  document.querySelector("#todayCount").textContent = visible.filter((item) => item.date === todayIso()).length;
  document.querySelector("#openCount").textContent = visible.filter((item) => item.status !== "done").length;
  document.querySelector("#doneCount").textContent = visible.filter((item) => item.status === "done").length;
  document.querySelector("#revenueCount").textContent = formatMoney(revenue);
}

function emptyState(text) {
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = text;
  return empty;
}

function createDateDivider(date, count) {
  const divider = document.createElement("div");
  divider.className = "date-divider";

  const title = document.createElement("strong");
  title.textContent = formatDateGroup(date);

  const badge = document.createElement("span");
  badge.textContent = `${count || 0} iş`;

  divider.append(title, badge);
  return divider;
}

function renderNotificationButton() {
  if (!("Notification" in window)) {
    notificationButton.hidden = true;
    return;
  }

  notificationButton.hidden = false;
  notificationButton.textContent = Notification.permission === "granted" ? "Bildirim Açık" : "Bildirimleri Aç";
  notificationButton.disabled = Notification.permission === "granted";
}

function maybeNotifyDueItems() {
  if (!currentUser || !("Notification" in window) || Notification.permission !== "granted") return;

  const notified = parseJson(getStored("dogamNotifications"), []);
  const assignmentNotified = parseJson(getStored("dogamAssignmentNotifications"), []);
  const assignedJobs = activeAppointments().filter(
    (item) =>
      item.staff === currentUser.name &&
      item.status !== "done" &&
      (item.createdAt || item.reassignedAt),
  );
  const dueRoutines = visibleRoutines().filter((routine) => routine.nextDate <= todayIso());
  const dueJobs = visibleAppointments().filter((item) => item.date === todayIso() && item.status !== "done");

  assignedJobs.forEach((item) => {
    const key = `${currentUser.name}:assignment:${item.id}:${item.reassignedAt || item.createdAt}`;
    if (assignmentNotified.includes(key)) return;

    new Notification("Yeni işiniz var", {
      body: `${item.customer} - ${formatDate(item.date)} ${item.time || ""}`,
    });
    assignmentNotified.push(key);
  });

  [...dueRoutines, ...dueJobs].forEach((item) => {
    const key = `${currentUser.name}:${item.id}:${item.nextDate || item.date}`;
    if (notified.includes(key)) return;

    new Notification(item.nextDate ? "Rutin iş günü geldi" : "Bugünkü iş", {
      body: `${item.title || item.customer} - ${item.staff}`,
    });
    notified.push(key);
  });

  setStored("dogamAssignmentNotifications", JSON.stringify(assignmentNotified));
  setStored("dogamNotifications", JSON.stringify(notified));
}

function render() {
  renderSummary();
  renderAppointments();
  renderRoutines();
  renderCustomers();
  renderReports();
  renderStock();
  renderStaff();
  renderNotificationButton();
  maybeNotifyDueItems();
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab, .view").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.view}View`).classList.add("active");
  });
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(loginForm);
  let person = null;

  if (serverAvailable) {
    try {
      const result = await apiRequest("/api/login", {
        method: "POST",
        body: JSON.stringify({
          staff: data.get("staff"),
          pin: data.get("pin"),
        }),
      });
      person = result.user;
    } catch (error) {
      loginError.textContent = error.message;
      return;
    }
  } else {
    person = staff.find((item) => item.name === data.get("staff") && item.pin === data.get("pin"));
  }

  if (!person) {
    loginError.textContent = "Personel veya PIN hatalı.";
    return;
  }

  loginError.textContent = "";
  saveCurrentUser({ name: person.name, role: person.role, type: person.type });
  staffFilter.value = person.type === "manager" ? "all" : person.name;
  setButtonByValue(staffFilterButtons, staffFilter.value);
  loginForm.reset();
  loginStaffValue.value = person.name;
  setButtonByValue(loginStaffButtons, person.name);
  renderAuthState();
});

logoutButton.addEventListener("click", () => {
  clearCurrentUser();
  renderAuthState();
});

statusFilter.addEventListener("change", render);
staffFilter.addEventListener("change", render);
whatsappFillButton.addEventListener("click", () => importWhatsappMessage());
whatsappCreateButton.addEventListener("click", () => importWhatsappMessage({ direct: true }));

editJobForm.addEventListener("submit", (event) => {
  event.preventDefault();
  updateAppointmentFromEdit();
});

editJobDialog.querySelector(".dialog-close").addEventListener("click", closeEditJob);
editJobDialog.addEventListener("click", (event) => {
  if (event.target === editJobDialog) closeEditJob();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isManager()) return;

  const data = new FormData(form);
  if (!createAppointmentRecord({
    customer: data.get("customer").trim(),
    phone: data.get("phone").trim(),
    address: data.get("address").trim(),
    date: data.get("date"),
    time: data.get("time"),
    service: data.get("service"),
    staff: data.get("staff"),
    note: data.get("note").trim(),
    amount: data.get("amount"),
  })) return;

  form.reset();
  setDefaultChoices();
  document.querySelector('[data-view="appointments"]').click();
  render();
});

staffForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isManager()) return;

  const data = new FormData(staffForm);
  const name = data.get("name").trim();
  const pin = data.get("pin").trim();
  const role = data.get("role").trim() || "Personel";

  if (!name || !pin) return;
  if (staff.some((person) => person.name.toLocaleLowerCase("tr-TR") === name.toLocaleLowerCase("tr-TR"))) return;

  staff.push({ name, pin, role, type: "personnel" });
  saveStaff();
  staffForm.reset();
  renderOptions();
  applyPermissions();
  render();
});

routineForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isManager()) return;

  const data = new FormData(routineForm);
  const assignedStaff = validAssigneeName(data.get("staff"));
  if (!assignedStaff) return;
  const amount = parseMoneyValue(data.get("amount"));
  const createdAt = new Date().toISOString();

  ensureCustomer(data.get("customer"), "", data.get("address"), data.get("note"));
  routines.push({
    id: createId(),
    title: data.get("title").trim(),
    customer: data.get("customer").trim(),
    address: data.get("address").trim(),
    service: data.get("service"),
    staff: assignedStaff,
    frequencyDays: Number(data.get("frequencyDays")) || 30,
    nextDate: data.get("nextDate"),
    amount,
    note: data.get("note").trim(),
    lastCompleted: "",
    lastPaymentMethod: "",
    createdAt,
    updatedAt: createdAt,
  });
  saveRoutines({ immediate: true });
  routineForm.reset();
  setDefaultChoices();
  render();
});

stockForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isManager()) return;

  const data = new FormData(stockForm);
  const name = data.get("name").trim();
  const quantity = Number(data.get("quantity") || 0);
  const unit = data.get("unit").trim() || "adet";
  const existing = inventory.find((item) => item.name.toLocaleLowerCase("tr-TR") === name.toLocaleLowerCase("tr-TR"));

  if (existing) {
    existing.quantity += quantity;
    existing.unit = unit;
  } else {
    inventory.push({ id: createId(), name, quantity, unit });
  }

  saveInventory();
  stockForm.reset();
  render();
});

chemicalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isManager()) return;

  const data = new FormData(chemicalForm);
  const assignedStaff = validAssigneeName(data.get("staff"));
  const delivery = {
    id: createId(),
    staff: assignedStaff,
    liquid: Number(data.get("liquid") || 0),
    gel: Number(data.get("gel") || 0),
    note: data.get("note").trim(),
    date: new Date().toISOString(),
  };

  if (!delivery.staff || (delivery.liquid <= 0 && delivery.gel <= 0)) return;

  chemicalDeliveries.push(delivery);
  saveChemicalDeliveries();
  chemicalForm.reset();
  setDefaultChoices();
  render();
});

notificationButton.addEventListener("click", async () => {
  if (!("Notification" in window)) return;
  await Notification.requestPermission();
  renderNotificationButton();
  maybeNotifyDueItems();
});

exportButton.addEventListener("click", () => {
  const bundle = {
    version: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    staff,
    customers,
    inventory,
    chemicalDeliveries,
    appointments,
    routines,
  };
  const text = JSON.stringify(bundle, null, 2);
  importData.value = text;

  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dogam-yedek-${todayIso()}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

importButton.addEventListener("click", () => {
  const bundle = parseJson(importData.value, null);
  if (!bundle) return;

  staff = Array.isArray(bundle.staff) ? bundle.staff : staff;
  customers = Array.isArray(bundle.customers) ? bundle.customers : customers;
  inventory = Array.isArray(bundle.inventory) ? bundle.inventory : inventory;
  chemicalDeliveries = Array.isArray(bundle.chemicalDeliveries) ? bundle.chemicalDeliveries : chemicalDeliveries;
  appointments = Array.isArray(bundle.appointments) ? bundle.appointments : appointments;
  routines = Array.isArray(bundle.routines) ? bundle.routines : routines;
  saveAll();
  renderOptions();
  applyPermissions();
  render();
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  document.querySelector("#installButton").hidden = false;
});

document.querySelector("#installButton").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("service-worker.js?v=26").then((registration) => registration.update());
}

try {
  if (location.search) {
    history.replaceState(null, "", location.href.split("?")[0]);
  }
} catch {
  // The app still works if a local file browser blocks URL cleanup.
}

async function refreshFromServer() {
  if (!SERVER_MODE || document.hidden) return;
  const activeView = document.querySelector(".tab.active")?.dataset.view;
  const activeFilter = staffFilter.value;

  if (await pullServerData()) {
    renderOptions();
    staffFilter.value = activeFilter;
    if (activeView) document.querySelector(`[data-view="${activeView}"]`)?.classList.add("active");
    applyPermissions();
    render();
  }
}

window.addEventListener("pageshow", refreshFromServer);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshFromServer();
});

async function bootApp() {
  await pullServerData();
  renderOptions();
  renderAuthState();

  if (serverAvailable) {
    setInterval(refreshFromServer, 30000);
  }
}

bootApp();
