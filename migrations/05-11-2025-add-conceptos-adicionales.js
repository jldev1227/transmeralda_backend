'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('liquidaciones', 'conceptos_adicionales', {
      type: Sequelize.JSON,
      allowNull: true,
      defaultValue: null
    });

    // Agregar índice GIN para búsquedas eficientes en PostgreSQL
    await queryInterface.addIndex('liquidaciones', {
      fields: ['conceptos_adicionales'],
      using: 'gin',
      name: 'idx_liquidaciones_conceptos_adicionales'
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Eliminar índice primero
    await queryInterface.removeIndex('liquidaciones', 'idx_liquidaciones_conceptos_adicionales');
    
    // Eliminar columna
    await queryInterface.removeColumn('liquidaciones', 'conceptos_adicionales');
  }
};