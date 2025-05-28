'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const columnsToRemove = [
      'soat_vencimiento',
      'tecnomecanica_vencimiento',
      'tarjeta_de_operacion_vencimiento',
      'poliza_contractual_vencimiento',
      'poliza_extra_contractual_vencimiento',
      'poliza_todo_riesgo_vencimiento',
    ];

    for (const columnName of columnsToRemove) {
      await queryInterface.removeColumn('vehiculos', columnName);
    }
  },
  down: async (queryInterface, Sequelize) => {
    const columnsToRemove = [
      'soat_vencimiento',
      'tecnomecanica_vencimiento',
      'tarjeta_de_operacion_vencimiento',
      'poliza_contractual_vencimiento',
      'poliza_extra_contractual_vencimiento',
      'poliza_todo_riesgo_vencimiento',
    ];

    for (const columnName of columnsToRemove) {
      await queryInterface.removeColumn('vehiculos', columnName);
    }
  }
};
