'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Documents', {
      id: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.DataTypes.UUID,
        defaultValue: Sequelize.literal('uuid_generate_v4()')
      },
      vehiculo_id: {
        type: Sequelize.DataTypes.UUID, // Ajusta esto según el tipo en tu tabla Vehicles
        allowNull: false,
        references: {
          model: 'vehiculos', // Asegúrate de que este nombre coincida con tu tabla de vehículos
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      documentType: {
        type: Sequelize.DataTypes.STRING,
        allowNull: false
      },
      fileOid: {
        type: Sequelize.DataTypes.BIGINT,
        allowNull: false
      },
      filename: {
        type: Sequelize.DataTypes.STRING,
        allowNull: false
      },
      mimetype: {
        type: Sequelize.DataTypes.STRING,
        allowNull: false
      },
      uploadDate: {
        type: Sequelize.DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      metadata: {
        type: Sequelize.DataTypes.JSONB,
        defaultValue: {}
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DataTypes.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DataTypes.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Asegurarse de que la extensión uuid-ossp esté habilitada
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    // Crear índice para mejorar el rendimiento de búsqueda por vehículo
    await queryInterface.addIndex('Documento', ['vehiculo_id']);
    
    // Crear índice para búsquedas por tipo de documento
    await queryInterface.addIndex('Documento', ['documentType']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('Documento');
  }
};