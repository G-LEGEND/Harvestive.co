const mongoose = require("mongoose");

const WithdrawMethodSchema = new mongoose.Schema({
  name: { type: String, required: true },
  address: { type: String, required: true },
  qr: { type: String } // store QR code image URL
});

module.exports = mongoose.model("WithdrawMethod", WithdrawMethodSchema);