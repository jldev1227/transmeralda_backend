'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('liquidaciones', 'prima_pendiente', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
      comment: 'Valor pendiente de prima por pagar (opcional)',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('liquidaciones', 'prima_pendiente');
  },
};
