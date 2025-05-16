'use strict';

/** @type {import('sequelize-cli').Migration} */
// En un archivo de migración
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('conductores', 'email', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('conductores', 'email', {
      type: Sequelize.STRING,
      allowNull: false
    });
  }
};