const { Sequelize } = require('sequelize');
const config = require('./config')[process.env.NODE_ENV || 'development'];

const sequelize = new Sequelize(
  config.database,
  config.username,
  config.password,
  {
    host: config.host,
    port: config.port,
    dialect: config.dialect,
    logging: config.logging,
    dialectOptions: config.dialectOptions,
    timezone: config.timezone,
  }
);

const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('Conexión a PostgreSQL establecida correctamente');
  } catch (error) {
    console.error('Error al conectar a PostgreSQL:', error);
    process.exit(1);
  }
};

const getRawConnection = async () => {
  try {
    const connection = await sequelize.connectionManager.getConnection();
    return connection;
  } catch (error) {
    console.error('Error al obtener una conexión de base de datos:', error);
    throw error;
  }
};

module.exports = { sequelize, testConnection, getRawConnection };