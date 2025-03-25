// src/migrations/YYYYMMDDHHMMSS-add-sede-trabajo-to-conductores.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Primero crear el tipo ENUM si no existe
    await queryInterface.sequelize.query(
      'CREATE TYPE "enum_conductores_sede_trabajo" AS ENUM (\'Yopal\', \'Villanueva\', \'Tauramena\');'
    ).catch(error => {
      // Ignorar error si el tipo ya existe
      console.log('Tipo ENUM ya existe o error al crearlo:', error.message);
    });

    // 2. Añadir la columna a la tabla
    return queryInterface.addColumn(
      'conductores',
      'sede_trabajo',
      {
        type: Sequelize.ENUM('Yopal', 'Villanueva', 'Tauramena'),
        allowNull: true
      }
    );
  },

  down: async (queryInterface, Sequelize) => {
    // 1. Eliminar la columna
    await queryInterface.removeColumn('conductores', 'sede_trabajo');
    
    // 2. Opcional: Eliminar el tipo ENUM si ya no se usa en ninguna otra parte
    return queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_conductores_sede_trabajo";'
    );
  }
};