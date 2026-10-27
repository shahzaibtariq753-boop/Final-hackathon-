const Notification = require('../models/Notification');

async function notifyUsers(userIds, message, type, entityId = null) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean).map(String))];
  if (!uniqueUserIds.length) return;
  await Notification.insertMany(uniqueUserIds.map((userId) => ({
    userId,
    message,
    type,
    entityId
  })));
}

module.exports = { notifyUsers };
