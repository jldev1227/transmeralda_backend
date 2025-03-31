require('dotenv').config({ path: './.env' });

module.exports = {
  development: {
    username: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD), // Forzar que sea string
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'postgres',
    logging: false
  },
  test: {
    // configuración similar...
  },
  production: {
    username: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD), // Forzar que sea string
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'postgres',
    logging: false
  }
};