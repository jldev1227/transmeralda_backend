// Script para ejecutar migraciones manualmente
require('dotenv').config();
const { Sequelize } = require('sequelize');
const path = require('path');

// Configurar Sequelize con la conexión a la base de datos
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false,
  }
);

async function runMigration() {
  try {
    console.log('🔌 Conectando a la base de datos...');
    await sequelize.authenticate();
    console.log('✅ Conexión establecida exitosamente');

    // Importar la migración
    const migration = require('./09-12-2025-add-kilometraje-to-dias-laborales.js');
    
    console.log('\n📦 Ejecutando migración...');
    await migration.up(sequelize.getQueryInterface(), Sequelize);
    
    console.log('\n✨ Migración completada con éxito');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error ejecutando migración:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

runMigration();
