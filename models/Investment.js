const mongoose = require("mongoose");

const InvestmentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  amount: { type: Number, required: true },
  status: { type: String, default: "active" }, // active, closed
  createdAt: { type: Date, default: Date.now },
  lastPayout: { type: Date, default: null } // track last profit
});

module.exports = mongoose.model("Investment", InvestmentSchema);