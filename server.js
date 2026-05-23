const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const root = __dirname;
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, "data");
const dbPath = path.join(dataDir, "db.json");
const backupDir = path.join(dataDir, "backups");
const port = Number(process.env.PORT || 4173);

const defaults = {
  version: "dogam-server-v1",
  staff: [
    { name: "Mahşuk Gerde", pin: "1234", role: "Yönetici / Ziraat Mühendisi", type: "manager" },
    { name: "Mehmet", pin: "4444", role: "Yönetici", type: "manager" },
    { name: "Ali", pin: "2222", role: "Personel", type: "personnel" },
    { name: "Servet Yılmaz", pin: "3333", role: "Personel", type: "personnel" },
  ],
  customers: [],
  inventory: [
    { id: "stock-jel", name: "Jel yem", quantity: 24, unit: "adet" },
    { id: "stock-istasyon", name: "Fare yem istasyonu", quantity: 12, unit: "adet" },
    { id: "stock-ilac", name: "Genel ilaç", quantity: 8, unit: "litre" },
  ],
  chemicalDeliveries: [],
  appointments: [],
  routines: [],
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

function ensureData() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  if (!fs.existsSync(dbPath)) writeJson(dbPath, defaults);
}

function readDb() {
  ensureData();
  try {
    return normalizeData(JSON.parse(fs.readFileSync(dbPath, "utf8")));
  } catch {
    writeJson(dbPath, defaults);
    return { ...defaults };
  }
}

function writeDb(data) {
  ensureData();
  const current = fs.existsSync(dbPath) ? fs.readFileSync(dbPath, "utf8") : "";
  if (current) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(backupDir, `db-${stamp}.json`), current);
  }
  writeJson(dbPath, normalizeData(data));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function mergeByKey(currentItems, incomingItems, keySelector) {
  const merged = new Map();

  [...currentItems, ...incomingItems].forEach((item, index) => {
    const key = keySelector(item) || `item-${index}-${JSON.stringify(item)}`;
    const existing = merged.get(key);

    if (!existing || recordTimestamp(item) >= recordTimestamp(existing)) {
      merged.set(key, item);
    }
  });

  return [...merged.values()];
}

function mergeDataBundles(currentData, incomingData) {
  const current = compactBundle(currentData);
  const incoming = compactBundle(incomingData);

  return {
    staff: mergeByKey(current.staff, incoming.staff, (item) => comparableName(item.name)),
    customers: mergeByKey(current.customers, incoming.customers, (item) => item.id || comparableName(item.name)),
    inventory: mergeByKey(current.inventory, incoming.inventory, (item) => item.id || comparableName(item.name)),
    chemicalDeliveries: mergeByKey(current.chemicalDeliveries, incoming.chemicalDeliveries, (item) => item.id),
    appointments: mergeByKey(current.appointments, incoming.appointments, (item) => item.id),
    routines: mergeByKey(current.routines, incoming.routines, (item) => item.id),
  };
}

function normalizeData(data) {
  const staffList = Array.isArray(data.staff) ? [...data.staff] : [...defaults.staff];
  defaults.staff.forEach((defaultPerson) => {
    const exists = staffList.some((person) => comparableName(person.name) === comparableName(defaultPerson.name));
    if (!exists) staffList.push(defaultPerson);
  });

  let customers = Array.isArray(data.customers) ? data.customers : defaults.customers;
  let chemicalDeliveries = Array.isArray(data.chemicalDeliveries) ? data.chemicalDeliveries : defaults.chemicalDeliveries;
  let appointments = Array.isArray(data.appointments) ? data.appointments : defaults.appointments;
  let routines = Array.isArray(data.routines) ? data.routines : defaults.routines;

  appointments = appointments.filter((item) => !isDemoAppointment(item));
  routines = routines.filter((item) => !isDemoRoutine(item));
  chemicalDeliveries = chemicalDeliveries.filter((item) => !isDemoChemicalDelivery(item));
  customers = customers.filter((customer) => {
    if (!isDemoCustomerName(customer.name)) return true;
    return appointments.some((item) => item.customer === customer.name) || routines.some((item) => item.customer === customer.name);
  });

  return {
    version: "dogam-server-v1",
    staff: staffList,
    customers,
    inventory: Array.isArray(data.inventory) ? data.inventory : defaults.inventory,
    chemicalDeliveries,
    appointments,
    routines,
    updatedAt: new Date().toISOString(),
  };
}

function isDemoCustomerName(value) {
  const name = comparableName(value);
  return name === "murat kaya" || name === "ece apartmani";
}

function isDemoAppointment(item) {
  const id = String(item.id || "");
  const customer = comparableName(item.customer);
  const phone = String(item.phone || "");
  const address = comparableName(item.address);
  const note = comparableName(item.note);

  return (
    id === "job-murat" ||
    (customer === "murat kaya" && phone === "0532 111 22 33" && address.includes("cumhuriyet mah") && note.includes("mutfak ve banyo")) ||
    (customer.includes("ece apartman") && phone === "0544 222 33 44" && address.includes("ataturk cad") && note.includes("yonetici kapida"))
  );
}

function isDemoRoutine(item) {
  const id = String(item.id || "");
  const title = comparableName(item.title);
  const customer = comparableName(item.customer);
  const address = comparableName(item.address);
  return id === "routine-ece" || (title.includes("ece apartman") && customer.includes("ece apartman") && address.includes("ataturk cad"));
}

function isDemoChemicalDelivery(item) {
  const id = String(item.id || "");
  const note = comparableName(item.note);
  return id === "delivery-ali" || id === "delivery-servet" || note.includes("haftalik saha cikisi") || note.includes("rutin servisler icin verildi");
}

function comparableName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .toLocaleLowerCase("tr-TR")
    .trim();
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function serveStatic(request, response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const decoded = decodeURIComponent(requested);
  const filePath = path.normalize(path.join(root, decoded));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(data);
  });
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && pathname === "/api/data") {
    sendJson(response, 200, readDb());
    return;
  }

  if (request.method === "POST" && pathname === "/api/data") {
    const body = await readBody(request);
    const incoming = JSON.parse(body || "{}");
    writeDb(mergeDataBundles(readDb(), incoming));
    sendJson(response, 200, { ok: true, updatedAt: new Date().toISOString() });
    return;
  }

  if (request.method === "POST" && pathname === "/api/login") {
    const body = await readBody(request);
    const input = JSON.parse(body || "{}");
    const db = readDb();
    const person = db.staff.find(
      (item) => comparableName(item.name) === comparableName(input.staff) && String(item.pin) === String(input.pin),
    );

    if (!person) {
      sendJson(response, 401, { ok: false, error: "Personel veya PIN hatalı." });
      return;
    }

    sendJson(response, 200, {
      ok: true,
      user: { name: person.name, role: person.role, type: person.type },
    });
    return;
  }

  sendJson(response, 404, { ok: false, error: "API endpoint bulunamadı." });
}

ensureData();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url.pathname);
      return;
    }

    serveStatic(request, response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Doğam uygulaması hazır: http://localhost:${port}`);
});
