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
  customers: [
    {
      id: "customer-murat",
      name: "Murat Kaya",
      phone: "0532 111 22 33",
      address: "Cumhuriyet Mah. 1402 Sok. No: 8 Daire: 5",
      note: "Mutfak ve banyo giderleri hassas.",
    },
    {
      id: "customer-ece",
      name: "Ece Apartmanı",
      phone: "0544 222 33 44",
      address: "Atatürk Cad. No: 21 bina girişi",
      note: "Bodrum katta yoğunluk var.",
    },
  ],
  inventory: [
    { id: "stock-jel", name: "Jel yem", quantity: 24, unit: "adet" },
    { id: "stock-istasyon", name: "Fare yem istasyonu", quantity: 12, unit: "adet" },
    { id: "stock-ilac", name: "Genel ilaç", quantity: 8, unit: "litre" },
  ],
  chemicalDeliveries: [
    {
      id: "delivery-ali",
      staff: "Ali",
      liquid: 2,
      gel: 150,
      note: "Haftalık saha çıkışı",
      date: new Date().toISOString(),
    },
    {
      id: "delivery-servet",
      staff: "Servet Yılmaz",
      liquid: 3,
      gel: 200,
      note: "Rutin servisler için verildi",
      date: new Date().toISOString(),
    },
  ],
  appointments: [
    {
      id: "job-murat",
      customer: "Murat Kaya",
      phone: "0532 111 22 33",
      address: "Cumhuriyet Mah. 1402 Sok. No: 8 Daire: 5",
      date: new Date().toISOString().slice(0, 10),
      time: "10:30",
      service: "Haşere ilaçlama",
      staff: "Ali",
      note: "Mutfak ve banyo giderleri özellikle kontrol edilecek.",
      amount: 1500,
      status: "planned",
      paymentMethod: "",
      paidAmount: 0,
      debtAmount: 1500,
      photos: [],
      stockUsage: [],
    },
  ],
  routines: [
    {
      id: "routine-ece",
      title: "Ece Apartmanı aylık servis",
      customer: "Ece Apartmanı",
      address: "Atatürk Cad. No: 21 bina girişi",
      service: "Periyodik servis",
      staff: "Servet Yılmaz",
      frequencyDays: 30,
      nextDate: new Date().toISOString().slice(0, 10),
      amount: 2500,
      note: "Bodrum ve ortak alanlar kontrol edilecek.",
      lastCompleted: "",
      lastPaymentMethod: "",
    },
  ],
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

function normalizeData(data) {
  const staffList = Array.isArray(data.staff) ? [...data.staff] : [...defaults.staff];
  defaults.staff.forEach((defaultPerson) => {
    const exists = staffList.some((person) => comparableName(person.name) === comparableName(defaultPerson.name));
    if (!exists) staffList.push(defaultPerson);
  });

  return {
    version: "dogam-server-v1",
    staff: staffList,
    customers: Array.isArray(data.customers) ? data.customers : defaults.customers,
    inventory: Array.isArray(data.inventory) ? data.inventory : defaults.inventory,
    chemicalDeliveries: Array.isArray(data.chemicalDeliveries) ? data.chemicalDeliveries : defaults.chemicalDeliveries,
    appointments: Array.isArray(data.appointments) ? data.appointments : defaults.appointments,
    routines: Array.isArray(data.routines) ? data.routines : defaults.routines,
    updatedAt: new Date().toISOString(),
  };
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
    writeDb(JSON.parse(body || "{}"));
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
