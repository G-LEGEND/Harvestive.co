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
    
    // Create indexes for better performance
    await depositMethods.createIndex({ enabled: 1 });
    await withdrawMethods.createIndex({ enabled: 1 });
    
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
}

// ====== DATABASE MIGRATION ======
async function migrateUserFields() {
  try {
    console.log("🔄 Checking for user migration...");
    
    // Count users without the new fields
    const usersToMigrate = await users.countDocuments({
      $or: [
        { blocked: { $exists: false } },
        { deleted: { $exists: false } }
      ]
    });
    
    if (usersToMigrate > 0) {
      console.log(`🔄 Migrating ${usersToMigrate} users...`);
      
      // Add missing fields to all existing users
      const updateResult = await users.updateMany(
        { 
          $or: [
            { blocked: { $exists: false } },
            { deleted: { $exists: false } },
            { lastLogin: { $exists: false } }
          ]
        },
        { 
          $set: { 
            blocked: false,
            deleted: false,
            lastLogin: null
          }
        }
      );
      
      console.log(`✅ Successfully migrated ${updateResult.modifiedCount} users`);
    } else {
      console.log("✅ All users already have the new fields");
    }
    
  } catch (err) {
    console.error("❌ Migration error:", err);
  }
}

// Initialize database and run migration
connectDB().then(() => {
  setTimeout(migrateUserFields, 1000); // Run after 1 second
});

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

// ====== PROFIT RATES ======
const planRates = {
  "STANDARD PLAN": 0.035,    // 3.50%
  "PREMIUM PLAN": 0.045,     // 4.50%
  "INVESTORS PLAN": 0.075,   // 7.50%
  "CONFIDENT PLAN": 0.12,    // 12.00%
};

// ====== AUTO PROFIT & INVESTMENT COMPLETION HANDLER ======
async function applyPendingProfits(userId) {
  const activeInvestments = await investments.find({ userId, status: "active" }).toArray();
  const now = new Date();

  for (const inv of activeInvestments) {
    // Check if investment has ended (30 days passed)
    const investmentEnd = new Date(inv.endDate || inv.startDate);
    investmentEnd.setDate(investmentEnd.getDate() + 30);
    
    if (now > investmentEnd && inv.status === "active") {
      // Investment completed - return capital to user
      await users.updateOne(
        { _id: new ObjectId(inv.userId) },
        { $inc: { balance: inv.amount } }
      );
      
      // Mark investment as completed
      await investments.updateOne(
        { _id: inv._id },
        { 
          $set: { 
            status: "completed",
            capitalReturned: true,
            completedAt: now
          }
        }
      );
      
      console.log(`💰 Capital returned for investment ${inv._id} - $${inv.amount}`);
      continue; // Skip profit calculation for completed investments
    }

    // Calculate daily profit if investment is still active
    const last = new Date(inv.lastProfitAt || inv.startDate);
    const hoursPassed = (now - last) / (1000 * 60 * 60);

    if (hoursPassed >= 24) {
      const rate = planRates[inv.plan] || 0.1;
      const daysMissed = Math.floor(hoursPassed / 24);
      const profit = inv.amount * rate * daysMissed;

      // Add profit to user balance
      await users.updateOne(
        { _id: new ObjectId(inv.userId) },
        { $inc: { balance: profit } }
      );

      // Update investment record
      await investments.updateOne(
        { _id: inv._id },
        { 
          $set: { lastProfitAt: now },
          $inc: { 
            daysCompleted: daysMissed,
            totalProfitEarned: profit
          }
        }
      );
    }
  }
}

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

    // Check if user is blocked
    const blockedUser = await users.findOne({ email, blocked: true });
    if (blockedUser) {
      return res.status(400).json({ error: "This account has been blocked" });
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
      blocked: false,
      deleted: false,
      lastLogin: null,
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
    
    // Check if user is blocked (backward compatible)
    if (user.blocked === true) {
      return res.status(403).json({ error: "This account has been blocked. Contact support." });
    }
    
    // Check if user is deleted (backward compatible)
    if (user.deleted === true) {
      return res.status(403).json({ error: "This account has been deleted." });
    }
    
    if (!(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ error: "Invalid password" });
    }

    // Update last login
    await users.updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() } }
    );

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
    const user = await users.findOne({ 
      _id: new ObjectId(req.userId)
    });
    
    if (!user) return res.status(404).json({ error: "User not found" });
    
    // Backward compatible check for deleted users
    if (user.deleted === true) {
      return res.status(403).json({ error: "Your account has been deleted." });
    }
    
    // Backward compatible check for blocked users
    if (user.blocked === true) {
      return res.status(403).json({ error: "Your account has been blocked. Contact support." });
    }

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
    
    // Check if user exists (backward compatible)
    const user = await users.findOne({ 
      _id: new ObjectId(req.userId)
    });
    
    if (!user) return res.status(404).json({ error: "User not found" });
    
    // Backward compatible check for deleted users
    if (user.deleted === true) return res.status(403).json({ error: "Account deleted" });
    
    // Backward compatible check for blocked users
    if (user.blocked === true) return res.status(403).json({ error: "Account blocked" });
    
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
    
    // Get user (backward compatible)
    const user = await users.findOne({ 
      _id: new ObjectId(req.userId)
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    
    // Backward compatible check for deleted users
    if (user.deleted === true) return res.status(403).json({ error: "Account deleted" });
    
    // Backward compatible check for blocked users
    if (user.blocked === true) return res.status(403).json({ error: "Account blocked" });
    
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

// ====== DASHBOARD ======
app.get("/user/dashboard", auth, async (req, res) => {
  try {
    // Check if user exists (backward compatible)
    const user = await users.findOne({ 
      _id: new ObjectId(req.userId)
    });
    
    if (!user) return res.status(404).json({ error: "User not found" });
    
    // Backward compatible check for deleted users
    if (user.deleted === true) return res.status(403).json({ error: "Account deleted" });
    
    // Backward compatible check for blocked users
    if (user.blocked === true) return res.status(403).json({ error: "Account blocked" });
    
    // 🔥 Apply profits first and check for completed investments
    await applyPendingProfits(req.userId);

    // Remove password before sending
    delete user.password;

    const userDeposits = await deposits.find({ userId: req.userId }).toArray();
    const userWithdrawals = await withdrawals.find({ userId: req.userId }).toArray();
    const userInvestments = await investments.find({ userId: req.userId }).toArray();

    // Calculate active investments total
    const activeInvestments = userInvestments.filter(inv => inv.status === "active");
    const activeInvestTotal = activeInvestments.reduce((sum, inv) => sum + inv.amount, 0);
    
    // Update user's currentInvest field
    await users.updateOne(
      { _id: new ObjectId(req.userId) },
      { $set: { currentInvest: activeInvestTotal } }
    );

    res.json({ 
      user: {
        ...user,
        currentInvest: activeInvestTotal
      }, 
      deposits: userDeposits, 
      withdrawals: userWithdrawals, 
      investments: userInvestments 
    });

  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ error: "Dashboard error" });
  }
});

// ====== DEPOSIT METHODS ======
// GET deposit methods (public endpoint - no auth required)
app.get("/user/deposit-methods", async (req, res) => {
  try {
    const methods = await depositMethods.find({ enabled: true }).toArray();
    
    // If no methods exist, create default ones
    if (methods.length === 0) {
      const defaultMethods = [
        {
          _id: new ObjectId(),
          name: "Bitcoin (BTC)",
          address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
          qr: "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          _id: new ObjectId(),
          name: "USDT (TRC20)",
          address: "TQzrAtZKcgEGeJTDPB6uUCg8jSxWTCEPyM",
          qr: "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=TQzrAtZKcgEGeJTDPB6uUCg8jSxWTCEPyM",
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          _id: new ObjectId(),
          name: "Ethereum (ETH)",
          address: "0x742d35Cc6634C0532925a3b844Bc9e0FF6e3eF53",
          qr: "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=0x742d35Cc6634C0532925a3b844Bc9e0FF6e3eF53",
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      
      // Insert default methods
      await depositMethods.insertMany(defaultMethods);
      res.json(defaultMethods);
    } else {
      res.json(methods);
    }
  } catch (err) {
    console.error("Error fetching deposit methods:", err);
    res.status(500).json({ error: "Error fetching deposit methods" });
  }
});

// ADMIN: GET all deposit methods
app.get("/admin/deposit-methods", auth, requireAdmin, async (req, res) => {
  try {
    const methods = await depositMethods.find().sort({ createdAt: -1 }).toArray();
    res.json(methods);
  } catch (err) {
    console.error("Error fetching deposit methods:", err);
    res.status(500).json({ error: "Error fetching deposit methods" });
  }
});

// ADMIN: ADD new deposit method
app.post("/admin/deposit-methods", auth, requireAdmin, upload.single("qr"), async (req, res) => {
  try {
    const { name, address } = req.body;
    
    if (!name || !address) {
      return res.status(400).json({ error: "Name and address are required" });
    }

    // Convert image to base64 if uploaded
    let qrData = null;
    if (req.file) {
      qrData = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    } else {
      // Generate QR code URL if no image provided
      qrData = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(address)}`;
    }

    const method = {
      name,
      address,
      qr: qrData,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await depositMethods.insertOne(method);
    
    res.json({ 
      success: true,
      message: "✅ Deposit method added successfully",
      methodId: result.insertedId,
      method: method
    });

  } catch (err) {
    console.error("Error adding deposit method:", err);
    res.status(500).json({ error: "Error adding deposit method" });
  }
});

// ADMIN: DELETE deposit method
app.delete("/admin/deposit-methods/:id", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await depositMethods.deleteOne({ _id: new ObjectId(id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Method not found" });
    }
    
    res.json({ 
      success: true,
      message: "✅ Deposit method deleted successfully",
      deletedId: id
    });

  } catch (err) {
    console.error("Error deleting deposit method:", err);
    res.status(500).json({ error: "Error deleting deposit method" });
  }
});

// ADMIN: TOGGLE deposit method status
app.put("/admin/deposit-methods/:id/toggle", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const method = await depositMethods.findOne({ _id: new ObjectId(id) });
    
    if (!method) {
      return res.status(404).json({ error: "Method not found" });
    }
    
    const newStatus = !method.enabled;
    await depositMethods.updateOne(
      { _id: new ObjectId(id) },
      { $set: { enabled: newStatus, updatedAt: new Date() } }
    );
    
    res.json({ 
      success: true,
      message: `✅ Method ${newStatus ? 'enabled' : 'disabled'} successfully`,
      methodId: id,
      enabled: newStatus
    });

  } catch (err) {
    console.error("Error toggling deposit method:", err);
    res.status(500).json({ error: "Error toggling deposit method" });
  }
});

// ====== WITHDRAW METHODS ======
// GET withdraw methods (public endpoint)
app.get("/user/withdraw-methods", async (req, res) => {
  try {
    const methods = await withdrawMethods.find({ enabled: true }).toArray();
    
    // If no methods exist, create default ones
    if (methods.length === 0) {
      const defaultMethods = [
        {
          _id: new ObjectId(),
          name: "Bitcoin (BTC)",
          min: 20000,
          fee: 0.001,
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          _id: new ObjectId(),
          name: "USDT (TRC20)",
          min: 20000,
          fee: 1,
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          _id: new ObjectId(),
          name: "Bank Transfer",
          min: 20000,
          fee: 0,
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      
      await withdrawMethods.insertMany(defaultMethods);
      res.json(defaultMethods);
    } else {
      res.json(methods);
    }
  } catch (err) {
    console.error("Error fetching withdraw methods:", err);
    res.status(500).json({ error: "Error fetching withdraw methods" });
  }
});

// ADMIN: GET all withdraw methods
app.get("/admin/withdraw-methods", auth, requireAdmin, async (req, res) => {
  try {
    const methods = await withdrawMethods.find().sort({ createdAt: -1 }).toArray();
    res.json(methods);
  } catch (err) {
    console.error("Error fetching withdraw methods:", err);
    res.status(500).json({ error: "Error fetching withdraw methods" });
  }
});

// ADMIN: ADD new withdraw method
app.post("/admin/withdraw-methods", auth, requireAdmin, async (req, res) => {
  try {
    const { name, min, fee } = req.body;
    
    if (!name || !min || fee === undefined) {
      return res.status(400).json({ error: "Name, minimum amount and fee are required" });
    }

    const method = {
      name,
      min: parseFloat(min),
      fee: parseFloat(fee),
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await withdrawMethods.insertOne(method);
    
    res.json({ 
      success: true,
      message: "✅ Withdraw method added successfully",
      methodId: result.insertedId,
      method: method
    });

  } catch (err) {
    console.error("Error adding withdraw method:", err);
    res.status(500).json({ error: "Error adding withdraw method" });
  }
});

// ADMIN: DELETE withdraw method
app.delete("/admin/withdraw-methods/:id", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await withdrawMethods.deleteOne({ _id: new ObjectId(id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Method not found" });
    }
    
    res.json({ 
      success: true,
      message: "✅ Withdraw method deleted successfully",
      deletedId: id
    });

  } catch (err) {
    console.error("Error deleting withdraw method:", err);
    res.status(500).json({ error: "Error deleting withdraw method" });
  }
});

// ADMIN: TOGGLE withdraw method status
app.put("/admin/withdraw-methods/:id/toggle", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const method = await withdrawMethods.findOne({ _id: new ObjectId(id) });
    
    if (!method) {
      return res.status(404).json({ error: "Method not found" });
    }
    
    const newStatus = !method.enabled;
    await withdrawMethods.updateOne(
      { _id: new ObjectId(id) },
      { $set: { enabled: newStatus, updatedAt: new Date() } }
    );
    
    res.json({ 
      success: true,
      message: `✅ Method ${newStatus ? 'enabled' : 'disabled'} successfully`,
      methodId: id,
      enabled: newStatus
    });

  } catch (err) {
    console.error("Error toggling withdraw method:", err);
    res.status(500).json({ error: "Error toggling withdraw method" });
  }
});

// ====== DEPOSIT ======
app.post("/deposit", auth, upload.single("screenshot"), async (req, res) => {
  try {
    const { amount, method } = req.body;
    const numericAmount = parseFloat(amount);
    
    if (!amount || !method || isNaN(numericAmount)) {
      return res.status(400).json({ error: "Invalid fields" });
    }

    // Validate minimum deposit
    if (numericAmount < 100) {
      return res.status(400).json({ error: "Minimum deposit is $100" });
    }

    // Verify the method exists
    const methodExists = await depositMethods.findOne({ 
      _id: new ObjectId(method), 
      enabled: true 
    });
    
    if (!methodExists) {
      return res.status(400).json({ error: "Invalid deposit method" });
    }

    // Check if user exists (backward compatible)
    const user = await users.findOne({ 
      _id: new ObjectId(req.userId)
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    
    // Backward compatible check for deleted users
    if (user.deleted === true) return res.status(403).json({ error: "Account deleted" });
    
    // Backward compatible check for blocked users
    if (user.blocked === true) return res.status(403).json({ error: "Account blocked" });

    const deposit = {
      userId: req.userId,
      amount: numericAmount,
      method: methodExists.name,
      methodId: method,
      address: methodExists.address,
      screenshot: req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}` : null,
      status: "pending",
      createdAt: new Date(),
    };

    const r = await deposits.insertOne(deposit);
    
    res.json({ 
      success: true,
      message: "✅ Deposit submitted successfully",
      id: r.insertedId.toString(),
      deposit: {
        amount: numericAmount,
        method: methodExists.name,
        status: "pending"
      }
    });

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
    
    if (!amount || !method || !address || isNaN(numericAmount)) {
      return res.status(400).json({ error: "Invalid request. All fields are required." });
    }
    
    if (numericAmount < 20000) {
      return res.status(400).json({ error: "❌ Minimum withdrawal is $20,000" });
    }

    // Check if user exists (backward compatible)
    const user = await users.findOne({ 
      _id: new ObjectId(req.userId)
    });
    
    if (!user) return res.status(404).json({ error: "User not found" });
    
    // Backward compatible check for deleted users
    if (user.deleted === true) return res.status(403).json({ error: "Account deleted. Contact support." });
    
    // Backward compatible check for blocked users
    if (user.blocked === true) return res.status(403).json({ error: "Account blocked. Contact support." });

    // Check sufficient balance
    if (user.balance < numericAmount) {
      return res.status(400).json({ error: "❌ Insufficient balance" });
    }

    // Create withdrawal record
    const withdrawal = {
      userId: req.userId,
      amount: numericAmount,
      method,
      address,
      status: "pending",
      createdAt: new Date(),
    };

    // Insert withdrawal
    const r = await withdrawals.insertOne(withdrawal);
    
    res.json({ 
      success: true,
      message: "✅ Withdraw request submitted successfully. Pending admin approval.",
      id: r.insertedId.toString(),
      withdrawal: {
        amount: numericAmount,
        method,
        address,
        status: "pending"
      }
    });

  } catch (err) {
    console.error("Withdraw error:", err);
    res.status(500).json({ error: "Withdraw error: " + err.message });
  }
});

// ====== INVEST (UPDATED FOR 30-DAY SYSTEM) ======
app.post("/invest", auth, async (req, res) => {
  try {
    const { amount, plan } = req.body;
    const numericAmount = parseFloat(amount);
    if (!amount || !plan || isNaN(numericAmount)) {
      return res.status(400).json({ error: "Invalid fields" });
    }

    // Validate plan exists
    if (!planRates[plan]) {
      return res.status(400).json({ error: "Invalid investment plan" });
    }

    // Check if user exists (backward compatible)
    const user = await users.findOne({ 
      _id: new ObjectId(req.userId)
    });
    
    if (!user) return res.status(404).json({ error: "User not found" });
    
    // Backward compatible check for deleted users
    if (user.deleted === true) return res.status(403).json({ error: "Account deleted" });
    
    // Backward compatible check for blocked users
    if (user.blocked === true) return res.status(403).json({ error: "Account blocked" });
    
    if (user.balance < numericAmount) return res.status(400).json({ error: "❌ Insufficient balance" });

    // Calculate end date (30 days from now)
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);

    // Create investment record
    const investment = {
      userId: req.userId,
      amount: numericAmount,
      plan,
      dailyRate: planRates[plan],
      status: "active",
      startDate,
      endDate,
      totalDays: 30,
      daysCompleted: 0,
      totalProfitEarned: 0,
      lastProfitAt: startDate,
      capitalReturned: false,
      createdAt: new Date(),
    };

    // Deduct from balance
    await users.updateOne(
      { _id: new ObjectId(req.userId) },
      { $inc: { balance: -numericAmount } }
    );

    // Insert investment
    const r = await investments.insertOne(investment);

    res.json({ 
      success: true,
      message: "✅ Investment successful! Plan will run for 30 days.",
      id: r.insertedId.toString(),
      investment: {
        amount: numericAmount,
        plan,
        startDate,
        endDate,
        dailyRate: planRates[plan]
      }
    });

  } catch (err) {
    console.error("Invest error:", err);
    res.status(500).json({ error: "Investment error" });
  }
});

// ====== GET USER INVESTMENTS ======
app.get("/user/investments", auth, async (req, res) => {
  try {
    // Check if user exists (backward compatible)
    const user = await users.findOne({ 
      _id: new ObjectId(req.userId)
    });
    
    if (!user) return res.status(404).json({ error: "User not found" });
    
    // Backward compatible check for deleted users
    if (user.deleted === true) return res.status(403).json({ error: "Account deleted" });
    
    // Backward compatible check for blocked users
    if (user.blocked === true) return res.status(403).json({ error: "Account blocked" });

    const userInvestments = await investments.find({ userId: req.userId }).toArray();
    
    // Calculate remaining days for each investment
    const investmentsWithDetails = userInvestments.map(inv => {
      const now = new Date();
      const endDate = new Date(inv.endDate);
      const remainingDays = Math.max(0, Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)));
      
      return {
        ...inv,
        remainingDays,
        isActive: inv.status === "active",
        isCompleted: inv.status === "completed"
      };
    });

    res.json({ 
      success: true,
      investments: investmentsWithDetails 
    });
  } catch (err) {
    console.error("Error fetching investments:", err);
    res.status(500).json({ error: "Error fetching investments" });
  }
});

// ====== ADMIN ======
app.post("/admin/login", (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_SECRET) return res.status(401).json({ error: "Invalid password" });

  const token = jwt.sign({ id: "admin", isAdmin: true }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ 
    success: true,
    token,
    message: "Admin login successful"
  });
});

function requireAdmin(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ error: "Admin only" });
  next();
}

// --- Admin Users Endpoint ---
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
        lastLogin: user.lastLogin,
        balance: user.balance || 0,
        totalDeposit: user.totalDeposit || 0,
        totalWithdraw: user.totalWithdraw || 0,
        currentInvest: user.currentInvest || 0,
        displayName: user.displayName || '',
        blocked: user.blocked || false,
        deleted: user.deleted || false,
        profile: user.profile || {}
      };
    });
    
    res.json(safeUsers);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: "Error fetching users" });
  }
});

// --- DELETE USER PERMANENTLY ---
app.delete("/admin/users/:id", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Start a session for transaction-like behavior
    const session = client.startSession();
    
    try {
      await session.withTransaction(async () => {
        // 1. Delete user's deposits
        await deposits.deleteMany({ userId: id }, { session });
        
        // 2. Delete user's withdrawals
        await withdrawals.deleteMany({ userId: id }, { session });
        
        // 3. Delete user's investments
        await investments.deleteMany({ userId: id }, { session });
        
        // 4. Finally delete the user
        const result = await users.deleteOne({ _id: new ObjectId(id) }, { session });
        
        if (result.deletedCount === 0) {
          throw new Error("User not found");
        }
      });
      
      res.json({ 
        success: true,
        message: "✅ User and all associated data deleted permanently",
        deletedId: id
      });
      
    } finally {
      await session.endSession();
    }
    
  } catch (err) {
    console.error("Error deleting user:", err);
    res.status(500).json({ error: "Error deleting user: " + err.message });
  }
});

// --- BLOCK/UNBLOCK USER ---
app.put("/admin/users/:id/block", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { blocked } = req.body;
    
    if (typeof blocked !== 'boolean') {
      return res.status(400).json({ error: "Blocked status must be boolean" });
    }
    
    const user = await users.findOne({ _id: new ObjectId(id) });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    await users.updateOne(
      { _id: new ObjectId(id) },
      { $set: { blocked: blocked } }
    );
    
    res.json({ 
      success: true,
      message: `✅ User ${blocked ? 'blocked' : 'unblocked'} successfully`,
      userId: id,
      blocked: blocked
    });
    
  } catch (err) {
    console.error("Error blocking user:", err);
    res.status(500).json({ error: "Error blocking user" });
  }
});

// --- Enhanced Deposit Approval ---
app.get("/admin/deposits", auth, requireAdmin, async (req, res) => {
  try {
    const depositsData = await deposits.find().sort({ createdAt: -1 }).toArray();
    
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
              displayName: user.displayName || "N/A",
              blocked: user.blocked || false
            } : {
              fullName: "Unknown User",
              email: "N/A",
              username: "N/A",
              displayName: "N/A",
              blocked: false
            }
          };
        } catch (err) {
          return {
            ...deposit,
            user: {
              fullName: "Error loading user",
              email: "N/A",
              username: "N/A",
              displayName: "N/A",
              blocked: false
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

    // Check if user is blocked (backward compatible)
    const user = await users.findOne({ _id: new ObjectId(deposit.userId) });
    if (user && user.blocked === true) {
      return res.status(400).json({ error: "Cannot approve deposit for blocked user" });
    }

    await deposits.updateOne({ _id: deposit._id }, { $set: { status: "approved", approvedAt: new Date() } });
    await users.updateOne(
      { _id: new ObjectId(deposit.userId) },
      { $inc: { balance: deposit.amount, totalDeposit: deposit.amount } }
    );

    res.json({ 
      success: true,
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

// --- Enhanced Withdrawal Approval ---
app.get("/admin/withdrawals", auth, requireAdmin, async (req, res) => {
  try {
    const withdrawalsData = await withdrawals.find().sort({ createdAt: -1 }).toArray();
    
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
              displayName: user.displayName || "N/A",
              blocked: user.blocked || false
            } : {
              fullName: "Unknown User",
              email: "N/A",
              username: "N/A",
              displayName: "N/A",
              blocked: false
            }
          };
        } catch (err) {
          return {
            ...withdrawal,
            user: {
              fullName: "Error loading user",
              email: "N/A",
              username: "N/A",
              displayName: "N/A",
              blocked: false
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

    // Check if user is blocked (backward compatible)
    const user = await users.findOne({ _id: new ObjectId(withdrawal.userId) });
    if (user && user.blocked === true) {
      return res.status(400).json({ error: "Cannot approve withdrawal for blocked user" });
    }

    // Check if user has sufficient balance
    if (user && user.balance < withdrawal.amount) {
      return res.status(400).json({ error: "User has insufficient balance" });
    }

    await withdrawals.updateOne({ _id: withdrawal._id }, { $set: { status: "approved", approvedAt: new Date() } });
    await users.updateOne(
      { _id: new ObjectId(withdrawal.userId) },
      { $inc: { balance: -withdrawal.amount, totalWithdraw: withdrawal.amount } }
    );

    res.json({ 
      success: true,
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

// --- Admin Dashboard Stats ---
app.get("/admin/stats", auth, requireAdmin, async (req, res) => {
  try {
    // Count users (backward compatible - count all users except those with deleted: true)
    const allUsers = await users.find({}).toArray();
    const totalUsers = allUsers.filter(user => user.deleted !== true).length;
    
    const totalDeposits = await deposits.countDocuments();
    const totalWithdrawals = await withdrawals.countDocuments();
    const totalInvestments = await investments.countDocuments();
    
    const pendingDeposits = await deposits.countDocuments({ status: "pending" });
    const pendingWithdrawals = await withdrawals.countDocuments({ status: "pending" });
    
    // Active investments count
    const activeInvestments = await investments.countDocuments({ status: "active" });
    
    // Blocked users count (backward compatible)
    const blockedUsers = allUsers.filter(user => user.blocked === true && user.deleted !== true).length;
    
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
    
    // Calculate total profit paid
    const totalProfitPaid = await investments.aggregate([
      { $group: { _id: null, total: { $sum: "$totalProfitEarned" } } }
    ]).toArray();
    
    res.json({
      success: true,
      totalUsers,
      totalDeposits,
      totalWithdrawals,
      totalInvestments,
      activeInvestments,
      blockedUsers,
      pendingDeposits,
      pendingWithdrawals,
      totalDepositAmount: totalDepositAmount[0]?.total || 0,
      totalWithdrawalAmount: totalWithdrawalAmount[0]?.total || 0,
      totalInvestmentAmount: totalInvestmentAmount[0]?.total || 0,
      totalProfitPaid: totalProfitPaid[0]?.total || 0,
      updatedAt: new Date()
    });
  } catch (err) {
    console.error("Error fetching admin stats:", err);
    res.status(500).json({ error: "Error fetching admin stats" });
  }
});

// ====== START ======
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));