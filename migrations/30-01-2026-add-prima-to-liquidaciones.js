'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('liquidaciones', 'prima', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: 'Valor de la prima correspondiente al período'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('liquidaciones', 'prima');
  }
};
