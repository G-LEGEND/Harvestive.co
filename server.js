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
    const { firstName, lastName, username, email, password, dateOfBirth } = req.body;
    
    // Validate required fields
    if (!firstName || !lastName || !email || !password || !dateOfBirth) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Additional validations
    if (firstName.length < 2 || lastName.length < 2) {
      return res.status(400).json({ error: "Name must be at least 2 characters" });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    // Password validation
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Date validation
    const birthDate = new Date(dateOfBirth);
    if (isNaN(birthDate.getTime())) {
      return res.status(400).json({ error: "Invalid date of birth" });
    }

    // Age validation (optional)
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    if (age < 13) {
      return res.status(400).json({ error: "You must be at least 13 years old" });
    }

    // Check if email already exists
    if (await users.findOne({ email })) {
      return res.status(400).json({ error: "Email already registered" });
    }

    // Generate username from email if not provided
    const finalUsername = username || email.split("@")[0];

    // Hash password
    const hashed = await bcrypt.hash(password, 10);

    // Create user document with all fields
    const userDoc = {
      firstName,
      lastName,
      username: finalUsername,
      email,
      password: hashed,
      dateOfBirth: birthDate,
      balance: 0,
      totalDeposit: 0,
      totalWithdraw: 0,
      currentInvest: 0,
      createdAt: new Date(),
      displayName: `${firstName} ${lastName}`,
      profile: {
        phone: "",
        country: "",
        address: "",
        avatar: ""
      },
      settings: {
        twoFactorAuth: false,
        notifications: true,
        language: "en"
      }
    };

    const r = await users.insertOne(userDoc);

    res.json({
      message: "✅ Registration successful!",
      id: r.insertedId.toString(),
      user: {
        firstName,
        lastName,
        email,
        username: finalUsername
      }
    });

  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Server error during registration" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await users.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: "Invalid password" });

    const token = jwt.sign({ 
      id: user._id.toString(), 
      isAdmin: false,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`
    }, JWT_SECRET, { expiresIn: "7d" });
    
    res.json({ 
      token,
      user: {
        id: user._id.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username,
        displayName: user.displayName
      }
    });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error during login" });
  }
});

// ====== USER PROFILE ENDPOINTS ======
app.get("/user/profile", auth, async (req, res) => {
  try {
    const user = await users.findOne(
      { _id: new ObjectId(req.userId) }
    );
    
    if (!user) return res.status(404).json({ error: "User not found" });

    // Remove password before sending
    delete user.password;

    // Format date of birth for display
    const formattedUser = {
      ...user,
      dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().split('T')[0] : null
    };

    res.json({ user: formattedUser });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ error: "Error fetching profile" });
  }
});

app.put("/user/profile", auth, async (req, res) => {
  try {
    const { firstName, lastName, phone, country, address } = req.body;
    
    // Build update object
    const updateFields = {};
    
    if (firstName && firstName.length >= 2) {
      updateFields.firstName = firstName;
      updateFields.displayName = `${firstName} ${lastName || ''}`.trim();
    }
    
    if (lastName && lastName.length >= 2) {
      updateFields.lastName = lastName;
      if (firstName) {
        updateFields.displayName = `${firstName} ${lastName}`;
      }
    }
    
    if (phone !== undefined) {
      updateFields["profile.phone"] = phone;
    }
    
    if (country !== undefined) {
      updateFields["profile.country"] = country;
    }
    
    if (address !== undefined) {
      updateFields["profile.address"] = address;
    }
    
    // Update user
    const result = await users.updateOne(
      { _id: new ObjectId(req.userId) },
      { $set: updateFields }
    );
    
    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: "No changes made" });
    }
    
    // Get updated user
    const updatedUser = await users.findOne(
      { _id: new ObjectId(req.userId) }
    );
    
    // Remove password before sending
    delete updatedUser.password;
    
    res.json({ 
      message: "✅ Profile updated successfully", 
      user: updatedUser 
    });
    
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).json({ error: "Error updating profile" });
  }
});

app.post("/user/change-password", auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Both passwords are required" });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters" });
    }
    
    // Get user
    const user = await users.findOne({ _id: new ObjectId(req.userId) });
    if (!user) return res.status(404).json({ error: "User not found" });
    
    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) return res.status(400).json({ error: "Current password is incorrect" });
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update password
    await users.updateOne(
      { _id: new ObjectId(req.userId) },
      { $set: { password: hashedPassword } }
    );
    
    res.json({ message: "✅ Password changed successfully" });
    
  } catch (err) {
    console.error("Password change error:", err);
    res.status(500).json({ error: "Error changing password" });
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

    const user = await users.findOne(
      { _id: new ObjectId(req.userId) }
    );
    
    if (!user) return res.status(404).json({ error: "User not found" });

    // Remove password before sending
    delete user.password;

    const userDeposits = await deposits.find({ userId: req.userId }).toArray();
    const userWithdrawals = await withdrawals.find({ userId: req.userId }).toArray();
    const userInvestments = await investments.find({ userId: req.userId }).toArray();

    res.json({ 
      user, 
      deposits: userDeposits, 
      withdrawals: userWithdrawals, 
      investments: userInvestments 
    });

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

  } catch (err) {
    console.error("Deposit error:", err);
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

  } catch (err) {
    console.error("Withdraw error:", err);
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

// --- Admin Users Endpoint (FIXED - No mixed projections) ---
app.get("/admin/users", auth, requireAdmin, async (req, res) => {
  try {
    const allUsers = await users.find({}).toArray();
    
    // Remove passwords and format users
    const safeUsers = allUsers.map(user => {
      const { password, ...userWithoutPassword } = user;
      return {
        _id: user._id,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
        username: user.username || '',
        createdAt: user.createdAt,
        balance: user.balance || 0,
        totalDeposit: user.totalDeposit || 0,
        totalWithdraw: user.totalWithdraw || 0,
        currentInvest: user.currentInvest || 0,
        displayName: user.displayName || '',
        profile: user.profile || {}
      };
    });
    
    res.json(safeUsers);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: "Error fetching users" });
  }
});

// --- Admin Get Single User (FIXED - No mixed projections) ---
app.get("/admin/user/:id", auth, requireAdmin, async (req, res) => {
  try {
    const user = await users.findOne(
      { _id: new ObjectId(req.params.id) }
    );
    
    if (!user) return res.status(404).json({ error: "User not found" });
    
    // Remove password before sending
    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (err) {
    console.error("Error fetching user:", err);
    res.status(500).json({ error: "Error fetching user" });
  }
});

// --- Enhanced Deposit Methods ---
app.post("/admin/deposit-methods", auth, requireAdmin, upload.single("qr"), async (req, res) => {
  try {
    const { name, address } = req.body;
    if (!name || !address || !req.file) return res.status(400).json({ error: "All fields required" });

    const method = { name, address, qr: req.file.buffer.toString("base64"), createdAt: new Date() };
    const r = await depositMethods.insertOne(method);
    res.json({ message: "✅ Method added", id: r.insertedId.toString() });

  } catch (err) {
    console.error("Error adding method:", err);
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
  } catch (err) {
    console.error("Error loading methods:", err);
    res.status(500).json({ error: "Error loading methods" });
  }
});

app.delete("/admin/deposit-methods/:id", auth, requireAdmin, async (req, res) => {
  try {
    await depositMethods.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: "✅ Method deleted" });
  } catch (err) {
    console.error("Error deleting method:", err);
    res.status(500).json({ error: "Error deleting method" });
  }
});

// --- Enhanced Deposit Approval with User Info (UPDATED) ---
app.get("/admin/deposits", auth, requireAdmin, async (req, res) => {
  try {
    const depositsData = await deposits.find().toArray();
    
    // Get user info for each deposit
    const depositsWithUsers = await Promise.all(
      depositsData.map(async (deposit) => {
        try {
          const user = await users.findOne(
            { _id: new ObjectId(deposit.userId) }
          );
          
          return {
            ...deposit,
            user: user ? {
              fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || "Unknown",
              email: user.email || "N/A",
              username: user.username || "N/A",
              displayName: user.displayName || "N/A"
            } : {
              fullName: "Unknown User",
              email: "N/A",
              username: "N/A",
              displayName: "N/A"
            }
          };
        } catch (err) {
          return {
            ...deposit,
            user: {
              fullName: "Error loading user",
              email: "N/A",
              username: "N/A",
              displayName: "N/A"
            }
          };
        }
      })
    );
    
    res.json(depositsWithUsers);
  } catch (err) {
    console.error("Error fetching deposits:", err);
    res.status(500).json({ error: "Error fetching deposits" });
  }
});

app.post("/admin/deposit/:id/approve", auth, requireAdmin, async (req, res) => {
  try {
    const deposit = await deposits.findOne({ _id: new ObjectId(req.params.id) });
    if (!deposit || deposit.status !== "pending") return res.status(400).json({ error: "Not pending" });

    await deposits.updateOne({ _id: deposit._id }, { $set: { status: "approved", approvedAt: new Date() } });
    await users.updateOne(
      { _id: new ObjectId(deposit.userId) },
      { $inc: { balance: deposit.amount, totalDeposit: deposit.amount } }
    );

    res.json({ 
      message: "✅ Deposit approved successfully",
      depositId: deposit._id,
      amount: deposit.amount,
      userId: deposit.userId
    });
  } catch (err) {
    console.error("Error approving deposit:", err);
    res.status(500).json({ error: "Error approving deposit" });
  }
});

// --- Enhanced Withdrawal Approval with User Info (UPDATED) ---
app.get("/admin/withdrawals", auth, requireAdmin, async (req, res) => {
  try {
    const withdrawalsData = await withdrawals.find().toArray();
    
    // Get user info for each withdrawal
    const withdrawalsWithUsers = await Promise.all(
      withdrawalsData.map(async (withdrawal) => {
        try {
          const user = await users.findOne(
            { _id: new ObjectId(withdrawal.userId) }
          );
          
          return {
            ...withdrawal,
            user: user ? {
              fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || "Unknown",
              email: user.email || "N/A",
              username: user.username || "N/A",
              displayName: user.displayName || "N/A"
            } : {
              fullName: "Unknown User",
              email: "N/A",
              username: "N/A",
              displayName: "N/A"
            }
          };
        } catch (err) {
          return {
            ...withdrawal,
            user: {
              fullName: "Error loading user",
              email: "N/A",
              username: "N/A",
              displayName: "N/A"
            }
          };
        }
      })
    );
    
    res.json(withdrawalsWithUsers);
  } catch (err) {
    console.error("Error fetching withdrawals:", err);
    res.status(500).json({ error: "Error fetching withdrawals" });
  }
});

app.post("/admin/withdraw/:id/approve", auth, requireAdmin, async (req, res) => {
  try {
    const withdrawal = await withdrawals.findOne({ _id: new ObjectId(req.params.id) });
    if (!withdrawal || withdrawal.status !== "pending") return res.status(400).json({ error: "Not pending" });

    await withdrawals.updateOne({ _id: withdrawal._id }, { $set: { status: "approved", approvedAt: new Date() } });
    await users.updateOne(
      { _id: new ObjectId(withdrawal.userId) },
      { $inc: { balance: -withdrawal.amount, totalWithdraw: withdrawal.amount } }
    );

    res.json({ 
      message: "✅ Withdrawal approved successfully",
      withdrawalId: withdrawal._id,
      amount: withdrawal.amount,
      userId: withdrawal.userId
    });
  } catch (err) {
    console.error("Error approving withdrawal:", err);
    res.status(500).json({ error: "Error approving withdrawal" });
  }
});

// --- Admin Dashboard Stats (NEW) ---
app.get("/admin/stats", auth, requireAdmin, async (req, res) => {
  try {
    const totalUsers = await users.countDocuments();
    const totalDeposits = await deposits.countDocuments();
    const totalWithdrawals = await withdrawals.countDocuments();
    const totalInvestments = await investments.countDocuments();
    
    const pendingDeposits = await deposits.countDocuments({ status: "pending" });
    const pendingWithdrawals = await withdrawals.countDocuments({ status: "pending" });
    
    const totalDepositAmount = await deposits.aggregate([
      { $match: { status: "approved" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]).toArray();
    
    const totalWithdrawalAmount = await withdrawals.aggregate([
      { $match: { status: "approved" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]).toArray();
    
    const totalInvestmentAmount = await investments.aggregate([
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]).toArray();
    
    res.json({
      totalUsers,
      totalDeposits,
      totalWithdrawals,
      totalInvestments,
      pendingDeposits,
      pendingWithdrawals,
      totalDepositAmount: totalDepositAmount[0]?.total || 0,
      totalWithdrawalAmount: totalWithdrawalAmount[0]?.total || 0,
      totalInvestmentAmount: totalInvestmentAmount[0]?.total || 0,
      updatedAt: new Date()
    });
  } catch (err) {
    console.error("Error fetching admin stats:", err);
    res.status(500).json({ error: "Error fetching admin stats" });
  }
});

// ====== START ======
app.listen(PORT, () => console.log(`🚀 Running http://localhost:${PORT}`));