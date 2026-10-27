function getJwtSecret(environment = process.env) {
  return environment.JWT_SECRET || environment.SECRET_KEY;
}

function getMongoUri(environment = process.env) {
  return environment.MONGO_URI || environment.DB_URI;
}

module.exports = { getJwtSecret, getMongoUri };
