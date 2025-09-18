// server.js
const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

const app = express();
app.use(express.json());
app.use(cors());

// ====== CONFIG ======
const JWT_SECRET = "harvestive_secret_key"; // change later
const ADMIN_SECRET = "sholashola"; // admin password
const PORT = process.env.PORT || 3000;

// ====== MongoDB ======
const uri = "mongodb+srv://pippinpaul069_db_user:73EIgekzqFE55mCP@cluster0.plv2fiy.mongodb.net/";
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

let db, users, deposits, withdrawals, investments, depositMethods, withdrawMethods;

async function connectDB() {
  try {
    await client.connect();
    db = client.db("harvestive");
    users = db.collection("users");
    deposits = db.collection("deposits");
    withdrawals = db.collection("withdrawals");
    investments = db.collection("investments");
    depositMethods = db.collection("deposit_methods");
    withdrawMethods = db.collection("withdraw_methods");
    console.log("✅ Connected to MongoDB Atlas!");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
}
connectDB();

// ====== Middleware ======
function auth(req, res, next) {
  try {
    const header = req.headers["authorization"];
    const token = header?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token provided" });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) return res.status(403).json({ error: "Invalid token" });
      req.userId = decoded.id;
      req.isAdmin = decoded.isAdmin || false;
      next();
    });
  } catch {
    return res.status(401).json({ error: "Malformed auth header" });
  }
}

// Multer
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ====== STATIC FILES ======
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// ====== USER AUTH ======
app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: "Missing fields" });

    if (await users.findOne({ email })) return res.status(400).json({ error: "Email exists" });

    const hashed = await bcrypt.hash(password, 10);
    const r = await users.insertOne({
      username,
      email,
      password: hashed,
      balance: 0,
      totalDeposit: 0,
      totalWithdraw: 0,
      currentInvest: 0,
      createdAt: new Date(),
    });

    res.json({ message: "✅ Registered!", id: r.insertedId.toString() });
  } catch (err) {
    res.status(500).json({ error: "Server error register" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await users.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: "Invalid password" });

    const token = jwt.sign({ id: user._id.toString(), isAdmin: false }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token });
  } catch {
    res.status(500).json({ error: "Server error login" });
  }
});

// ====== PROFIT RATES ======
const planRates = {
  "STANDARD PLAN": 0.035,
  "PREMIUM PLAN": 0.045,
  "INVESTORS PLAN": 0.075,
  "CONFIDENT PLAN": 0.12,
};

// ====== AUTO PROFIT HANDLER ======
async function applyPendingProfits(userId) {
  const activeInvestments = await investments.find({ userId, status: "active" }).toArray();

  for (const inv of activeInvestments) {
    const now = new Date();
    const last = new Date(inv.lastProfitAt || inv.createdAt);
    const hoursPassed = (now - last) / (1000 * 60 * 60);

    if (hoursPassed >= 24) {
      const rate = planRates[inv.plan] || 0.1; // fallback 10%
      const daysMissed = Math.floor(hoursPassed / 24);
      const profit = inv.amount * rate * daysMissed;

      // Add profit to user balance
      await users.updateOne(
        { _id: new ObjectId(inv.userId) },
        { $inc: { balance: profit } }
      );

      // Update lastProfitAt
      await investments.updateOne(
        { _id: inv._id },
        { $set: { lastProfitAt: now } }
      );
    }
  }
}

// ====== DASHBOARD ======
app.get("/user/dashboard", auth, async (req, res) => {
  try {
    // 🔥 Apply profits first
    await applyPendingProfits(req.userId);

    const user = await users.findOne({ _id: new ObjectId(req.userId) }, { projection: { password: 0 } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const userDeposits = await deposits.find({ userId: req.userId }).toArray();
    const userWithdrawals = await withdrawals.find({ userId: req.userId }).toArray();
    const userInvestments = await investments.find({ userId: req.userId }).toArray();

    res.json({ user, deposits: userDeposits, withdrawals: userWithdrawals, investments: userInvestments });
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ error: "Dashboard error" });
  }
});

// ====== DEPOSIT ======
app.post("/deposit", auth, upload.single("screenshot"), async (req, res) => {
  try {
    const { amount, method } = req.body;
    const numericAmount = parseFloat(amount);
    if (!amount || !method || isNaN(numericAmount)) return res.status(400).json({ error: "Invalid fields" });

    const deposit = {
      userId: req.userId,
      amount: numericAmount,
      method,
      screenshot: req.file ? req.file.buffer.toString("base64") : null,
      status: "pending",
      createdAt: new Date(),
    };

    const r = await deposits.insertOne(deposit);
    res.json({ message: "✅ Deposit submitted", id: r.insertedId.toString() });
  } catch {
    res.status(500).json({ error: "Deposit error" });
  }
});

// ====== WITHDRAW ======
app.post("/withdraw", auth, async (req, res) => {
  try {
    const { amount, method, address } = req.body;
    const numericAmount = parseFloat(amount);
    if (!amount || !method || !address || isNaN(numericAmount))
      return res.status(400).json({ error: "Invalid request" });
    if (numericAmount < 20000) return res.status(400).json({ error: "❌ Minimum withdrawal is 20,000" });

    const user = await users.findOne({ _id: new ObjectId(req.userId) });
    if (!user || user.balance < numericAmount) return res.status(400).json({ error: "❌ Insufficient balance" });

    const r = await withdrawals.insertOne({
      userId: req.userId,
      amount: numericAmount,
      method,
      address,
      status: "pending",
      createdAt: new Date(),
    });
    res.json({ message: "✅ Withdraw request submitted", id: r.insertedId.toString() });
  } catch {
    res.status(500).json({ error: "Withdraw error" });
  }
});

// ====== INVEST ======
app.post("/invest", auth, async (req, res) => {
  try {
    const { amount, plan } = req.body;
    const numericAmount = parseFloat(amount);
    if (!amount || !plan || isNaN(numericAmount)) {
      return res.status(400).json({ error: "Invalid fields" });
    }

    const user = await users.findOne({ _id: new ObjectId(req.userId) });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.balance < numericAmount) return res.status(400).json({ error: "❌ Insufficient balance" });

    // Deduct from balance & update currentInvest
    await users.updateOne(
      { _id: new ObjectId(req.userId) },
      { $inc: { balance: -numericAmount, currentInvest: numericAmount } }
    );

    const investment = {
      userId: req.userId,
      amount: numericAmount,
      plan,
      status: "active",
      createdAt: new Date(),
      lastProfitAt: new Date(), // 👈 important
    };

    const r = await investments.insertOne(investment);
    res.json({ message: "✅ Investment successful", id: r.insertedId.toString() });
  } catch (err) {
    console.error("Invest error:", err);
    res.status(500).json({ error: "Investment error" });
  }
});

// ====== ADMIN ======
app.post("/admin/login", (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_SECRET) return res.status(401).json({ error: "Invalid password" });

  const token = jwt.sign({ id: "admin", isAdmin: true }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token });
});

function requireAdmin(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ error: "Admin only" });
  next();
}

// --- Deposit Methods ---
app.post("/admin/deposit-methods", auth, requireAdmin, upload.single("qr"), async (req, res) => {
  try {
    const { name, address } = req.body;
    if (!name || !address || !req.file) return res.status(400).json({ error: "All fields required" });

    const method = { name, address, qr: req.file.buffer.toString("base64"), createdAt: new Date() };
    const r = await depositMethods.insertOne(method);
    res.json({ message: "✅ Method added", id: r.insertedId.toString() });
  } catch {
    res.status(500).json({ error: "Error adding method" });
  }
});

app.get("/user/deposit-methods", async (_, res) => {
  try {
    const data = await depositMethods.find().toArray();
    res.json(
      data.map((m) => ({
        _id: m._id,
        name: m.name,
        address: m.address,
        qr: m.qr ? `data:image/png;base64,${m.qr}` : null,
      }))
    );
  } catch {
    res.status(500).json({ error: "Error loading methods" });
  }
});

app.delete("/admin/deposit-methods/:id", auth, requireAdmin, async (req, res) => {
  try {
    await depositMethods.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: "✅ Method deleted" });
  } catch {
    res.status(500).json({ error: "Error deleting method" });
  }
});

// --- Deposit Approval ---
app.get("/admin/deposits", auth, requireAdmin, async (_, res) => {
  const data = await deposits.find().toArray();
  res.json(data);
});

app.post("/admin/deposit/:id/approve", auth, requireAdmin, async (req, res) => {
  const deposit = await deposits.findOne({ _id: new ObjectId(req.params.id) });
  if (!deposit || deposit.status !== "pending") return res.status(400).json({ error: "Not pending" });

  await deposits.updateOne({ _id: deposit._id }, { $set: { status: "approved" } });
  await users.updateOne(
    { _id: new ObjectId(deposit.userId) },
    { $inc: { balance: deposit.amount, totalDeposit: deposit.amount } }
  );

  res.json({ message: "✅ Approved" });
});

// --- Withdraw Approval ---
app.get("/admin/withdrawals", auth, requireAdmin, async (_, res) => {
  const data = await withdrawals.find().toArray();
  res.json(data);
});

app.post("/admin/withdraw/:id/approve", auth, requireAdmin, async (req, res) => {
  const withdrawal = await withdrawals.findOne({ _id: new ObjectId(req.params.id) });
  if (!withdrawal || withdrawal.status !== "pending") return res.status(400).json({ error: "Not pending" });

  await withdrawals.updateOne({ _id: withdrawal._id }, { $set: { status: "approved" } });
  await users.updateOne(
    { _id: new ObjectId(withdrawal.userId) },
    { $inc: { balance: -withdrawal.amount, totalWithdraw: withdrawal.amount } }
  );

  res.json({ message: "✅ Withdrawal approved" });
});

// ====== START ======
app.listen(PORT, () => console.log(`🚀 Running http://localhost:${PORT}`));