const mongoose = require('mongoose');
const { getMongoUri } = require('./environment');

async function connectDB() {
  const uri = getMongoUri();
  if (!uri) {
    throw new Error('Set DB_URI (or MONGO_URI) to your MongoDB connection string.');
  }
  const connection = await mongoose.connect(uri, process.env.DB_NAME ? { dbName: process.env.DB_NAME } : {});
  console.log(`MongoDB connected: ${connection.connection.host}`);
}

module.exports = connectDB;
