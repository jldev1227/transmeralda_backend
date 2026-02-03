'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('liquidaciones', 'es_cotransmeq', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Indica si la liquidación es para COTRANSMEQ',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('liquidaciones', 'es_cotransmeq');
  },
};
