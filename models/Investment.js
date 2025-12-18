const mongoose = require("mongoose");

const InvestmentSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },
  amount: { 
    type: Number, 
    required: true 
  },
  plan: {
    type: String,
    required: true,
    enum: ["STANDARD PLAN", "PREMIUM PLAN", "INVESTORS PLAN", "CONFIDENT PLAN"]
  },
  dailyRate: {
    type: Number,
    required: true
  },
  status: { 
    type: String, 
    default: "active",
    enum: ["active", "completed", "cancelled"]
  },
  startDate: { 
    type: Date, 
    default: Date.now 
  },
  endDate: {
    type: Date,
    required: true
  },
  totalDays: {
    type: Number,
    default: 30
  },
  daysCompleted: {
    type: Number,
    default: 0
  },
  totalProfitEarned: {
    type: Number,
    default: 0
  },
  lastProfitAt: { 
    type: Date, 
    default: Date.now 
  },
  capitalReturned: {
    type: Boolean,
    default: false
  }
});

module.exports = mongoose.model("Investment", InvestmentSchema);