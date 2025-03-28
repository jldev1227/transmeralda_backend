require('dotenv').config({ path: './.env' });

// Verifica que las variables se estén cargando
console.log('DB CONFIG:', {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  // No imprimas la contraseña completa en logs por seguridad
  password: process.env.DB_PASSWORD ? 'Definida' : 'No definida',
  database: process.env.DB_NAME,
});

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