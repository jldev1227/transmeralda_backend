'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Agregar el nuevo valor 'consulta' al enum de role
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_users_role" ADD VALUE IF NOT EXISTS 'consulta';
    `);
  },

  down: async (queryInterface, Sequelize) => {
    // No se puede eliminar un valor de un enum directamente en PostgreSQL
    // Necesitarías recrear el enum, lo cual es complejo y puede causar problemas
    console.log('No se puede revertir la adición de un valor a un ENUM en PostgreSQL de forma segura');
  }
};
